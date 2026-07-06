/*
 * Core purpose
 * Resolve which conversation (thread/session/workspace) a canvas belongs to
 * and materialize the file-backed session directory for that binding.
 *
 * Inputs
 * Project root plus CLI/env binding hints (--thread/--session/--workspace),
 * with fallback to .openprd/harness/runtime-environment.json evidence.
 *
 * Outputs
 * ensureCanvasSession() creates .openprd/harness/canvas-sessions/<key>/ with
 * session.json, scene.json, ops.json, and library.json scaffolding.
 *
 * Positioning
 * Used by canvas-workspace.js; keep it transport-agnostic so Codex, Claude
 * Code, Cursor, and future clients can all bind by providing evidence.
 */
import fs from 'node:fs/promises';
import { cjoin, exists, readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';
import {
  CANVAS_SURFACE_BACKGROUND,
  buildSessionKey,
  firstPresent,
  isPlainObject,
  normalizeBindingTitle,
} from './canvas-session-store.js';

const CANVAS_SCHEMA_VERSION = 1;

async function readRuntimeEnvironment(projectRoot) {
  const runtimePath = cjoin(projectRoot, '.openprd', 'harness', 'runtime-environment.json');
  if (!(await exists(runtimePath))) {
    return { path: runtimePath, data: null };
  }
  try {
    return { path: runtimePath, data: await readJson(runtimePath) };
  } catch {
    return { path: runtimePath, data: null };
  }
}

function flattenRuntimeEvidence(runtimeEnvironment) {
  const runtime = runtimeEnvironment ?? {};
  const active = runtime.active ?? runtime.activeClient ?? runtime.current ?? {};
  const detection = runtime.runtimeDetection ?? {};
  const detectionActive = detection.active ?? detection.current ?? {};
  const session = runtime.session ?? runtime.conversation ?? detection.session ?? detectionActive.session ?? {};
  const turn = runtime.turn ?? detection.turn ?? detectionActive.turn ?? {};
  const evidence = runtime.evidence ?? detection.evidence ?? detectionActive.evidence ?? {};
  const observed = runtime.observedCapabilities ?? detection.observedCapabilities ?? detectionActive.observedCapabilities ?? [];
  return {
    active,
    detection,
    detectionActive,
    session,
    turn,
    evidence,
    observed,
  };
}

function selectRuntimeBinding(runtimeEnvironment) {
  if (!isPlainObject(runtimeEnvironment)) {
    return null;
  }
  const parts = flattenRuntimeEvidence(runtimeEnvironment);
  const threadId = firstPresent(
    parts.active.threadId,
    parts.active.thread_id,
    parts.active.conversationId,
    parts.active.conversation_id,
    parts.detectionActive.threadId,
    parts.detectionActive.thread_id,
    parts.detectionActive.conversationId,
    parts.detectionActive.conversation_id,
    parts.session.threadId,
    parts.session.thread_id,
    parts.session.conversationId,
    parts.session.conversation_id,
    parts.turn.threadId,
    parts.turn.thread_id,
    parts.evidence.threadId,
    parts.evidence.thread_id,
  );
  if (threadId) {
    const title = normalizeBindingTitle(
      parts.active.threadTitle,
      parts.active.thread_title,
      parts.active.conversationTitle,
      parts.active.conversation_title,
      parts.active.title,
      parts.active.name,
      parts.detectionActive.threadTitle,
      parts.detectionActive.thread_title,
      parts.detectionActive.conversationTitle,
      parts.detectionActive.conversation_title,
      parts.detectionActive.title,
      parts.detectionActive.name,
      parts.session.threadTitle,
      parts.session.thread_title,
      parts.session.conversationTitle,
      parts.session.conversation_title,
      parts.session.title,
      parts.session.name,
      parts.turn.threadTitle,
      parts.turn.thread_title,
      parts.turn.conversationTitle,
      parts.turn.conversation_title,
      parts.evidence.threadTitle,
      parts.evidence.thread_title,
      parts.evidence.conversationTitle,
      parts.evidence.conversation_title,
    );
    return {
      kind: 'thread',
      id: threadId,
      title,
      threadTitle: title,
      source: 'runtime-environment:thread',
      activeClient: firstPresent(parts.active.client, parts.active.activeClient, parts.detectionActive.activeClient, parts.detection.activeClient),
      surface: firstPresent(parts.active.surface, parts.detectionActive.surface, parts.detection.surface),
      confidence: firstPresent(parts.active.confidence, parts.detectionActive.confidence, parts.detection.confidence),
      observedCapabilities: parts.observed,
    };
  }

  const sessionId = firstPresent(
    parts.active.sessionId,
    parts.active.session_id,
    parts.detectionActive.sessionId,
    parts.detectionActive.session_id,
    parts.session.id,
    parts.session.sessionId,
    parts.session.session_id,
    parts.turn.sessionId,
    parts.turn.session_id,
    parts.evidence.sessionId,
    parts.evidence.session_id,
  );
  if (sessionId) {
    const title = normalizeBindingTitle(
      parts.active.sessionTitle,
      parts.active.session_title,
      parts.active.conversationTitle,
      parts.active.conversation_title,
      parts.active.title,
      parts.active.name,
      parts.detectionActive.sessionTitle,
      parts.detectionActive.session_title,
      parts.detectionActive.conversationTitle,
      parts.detectionActive.conversation_title,
      parts.detectionActive.title,
      parts.detectionActive.name,
      parts.session.sessionTitle,
      parts.session.session_title,
      parts.session.conversationTitle,
      parts.session.conversation_title,
      parts.session.title,
      parts.session.name,
      parts.turn.sessionTitle,
      parts.turn.session_title,
      parts.turn.conversationTitle,
      parts.turn.conversation_title,
      parts.evidence.sessionTitle,
      parts.evidence.session_title,
      parts.evidence.conversationTitle,
      parts.evidence.conversation_title,
    );
    return {
      kind: 'session',
      id: sessionId,
      title,
      sessionTitle: title,
      source: 'runtime-environment:session',
      activeClient: firstPresent(parts.active.client, parts.active.activeClient, parts.detectionActive.activeClient, parts.detection.activeClient),
      surface: firstPresent(parts.active.surface, parts.detectionActive.surface, parts.detection.surface),
      confidence: firstPresent(parts.active.confidence, parts.detectionActive.confidence, parts.detection.confidence),
      observedCapabilities: parts.observed,
    };
  }

  return null;
}

async function resolveCanvasSessionBinding(projectRoot, options = {}, env = process.env) {
  const explicitThread = firstPresent(options.thread, options.conversation, options.conversationId);
  if (explicitThread) {
    const title = normalizeBindingTitle(options.threadTitle, options.conversationTitle, options.title);
    return {
      kind: 'thread',
      id: explicitThread,
      displayId: explicitThread,
      title,
      threadTitle: title,
      source: 'flag:thread',
      confidence: 'explicit',
      sessionKey: buildSessionKey('thread', explicitThread),
    };
  }

  const explicitSession = firstPresent(options.session, options.sessionId);
  if (explicitSession) {
    const title = normalizeBindingTitle(options.sessionTitle, options.conversationTitle, options.title);
    return {
      kind: 'session',
      id: explicitSession,
      displayId: explicitSession,
      title,
      sessionTitle: title,
      source: 'flag:session',
      confidence: 'explicit',
      sessionKey: buildSessionKey('session', explicitSession),
    };
  }

  const envThread = firstPresent(
    env.OPENPRD_THREAD_ID,
    env.OPENPRD_CONVERSATION_ID,
    env.CODEX_THREAD_ID,
    env.CODEX_CONVERSATION_ID,
    env.CLAUDE_THREAD_ID,
    env.CURSOR_THREAD_ID,
  );
  if (envThread) {
    const title = normalizeBindingTitle(
      env.OPENPRD_THREAD_TITLE,
      env.OPENPRD_CONVERSATION_TITLE,
      env.CODEX_THREAD_TITLE,
      env.CODEX_CONVERSATION_TITLE,
      env.CLAUDE_THREAD_TITLE,
      env.CLAUDE_CONVERSATION_TITLE,
      env.CURSOR_THREAD_TITLE,
      env.CURSOR_CONVERSATION_TITLE,
    );
    return {
      kind: 'thread',
      id: envThread,
      displayId: envThread,
      title,
      threadTitle: title,
      source: 'env:thread',
      confidence: 'high',
      sessionKey: buildSessionKey('thread', envThread),
    };
  }

  const envSession = firstPresent(
    env.OPENPRD_SESSION_ID,
    env.CODEX_SESSION_ID,
    env.CLAUDE_SESSION_ID,
    env.CLAUDE_CODE_SESSION_ID,
    env.CLAUDE_CODE_CHILD_SESSION,
    env.CURSOR_SESSION_ID,
  );
  if (envSession) {
    const title = normalizeBindingTitle(
      env.OPENPRD_SESSION_TITLE,
      env.OPENPRD_CONVERSATION_TITLE,
      env.CODEX_SESSION_TITLE,
      env.CODEX_CONVERSATION_TITLE,
      env.CLAUDE_SESSION_TITLE,
      env.CLAUDE_CONVERSATION_TITLE,
      env.CURSOR_SESSION_TITLE,
      env.CURSOR_CONVERSATION_TITLE,
    );
    return {
      kind: 'session',
      id: envSession,
      displayId: envSession,
      title,
      sessionTitle: title,
      source: 'env:session',
      confidence: 'medium-high',
      sessionKey: buildSessionKey('session', envSession),
    };
  }

  const runtime = await readRuntimeEnvironment(projectRoot);
  const runtimeBinding = selectRuntimeBinding(runtime.data);
  if (runtimeBinding) {
    const binding = {
      ...runtimeBinding,
      displayId: runtimeBinding.id,
      runtimePath: runtime.path,
      sessionKey: buildSessionKey(runtimeBinding.kind, runtimeBinding.id),
    };
    const title = normalizeBindingTitle(runtimeBinding.title, runtimeBinding.threadTitle, runtimeBinding.sessionTitle, runtimeBinding.name);
    if (title) {
      binding.title = title;
      if (binding.kind === 'thread') {
        binding.threadTitle = title;
      }
      if (binding.kind === 'session') {
        binding.sessionTitle = title;
      }
    }
    return binding;
  }

  const workspaceId = shortHash(projectRoot);
  return {
    kind: 'workspace',
    id: workspaceId,
    displayId: `workspace-${workspaceId}`,
    source: 'workspace-fallback',
    confidence: 'low',
    sessionKey: buildSessionKey('workspace', workspaceId),
    note: 'No current conversation evidence was found; pass --thread or --session to avoid sharing a fallback canvas.',
  };
}

function buildCanvasSessionPaths(projectRoot, binding) {
  const sessionDir = cjoin(projectRoot, '.openprd', 'harness', 'canvas-sessions', binding.sessionKey);
  return {
    sessionDir,
    sessionFile: cjoin(sessionDir, 'session.json'),
    sceneFile: cjoin(sessionDir, 'scene.json'),
    libraryFile: cjoin(sessionDir, 'library.json'),
    opsFile: cjoin(sessionDir, 'ops.json'),
    serverFile: cjoin(sessionDir, 'server.json'),
    logFile: cjoin(sessionDir, 'server.log'),
    assetsDir: cjoin(sessionDir, 'assets'),
    exportsDir: cjoin(sessionDir, 'exports'),
    relaysDir: cjoin(sessionDir, 'relays'),
  };
}

function preserveCanvasBindingDisplayTitle(binding, existingBinding) {
  if (!isPlainObject(binding) || !isPlainObject(existingBinding)) {
    return binding;
  }
  if (binding.kind !== existingBinding.kind || binding.id !== existingBinding.id) {
    return binding;
  }
  const title = normalizeBindingTitle(
    binding.title,
    binding.threadTitle,
    binding.sessionTitle,
    binding.name,
    existingBinding.title,
    existingBinding.threadTitle,
    existingBinding.sessionTitle,
    existingBinding.name,
  );
  if (!title) {
    return binding;
  }
  const nextBinding = { ...binding, title };
  if (nextBinding.kind === 'thread') {
    nextBinding.threadTitle = title;
  }
  if (nextBinding.kind === 'session') {
    nextBinding.sessionTitle = title;
  }
  return nextBinding;
}

async function ensureCanvasSession(projectRoot, options = {}, env = process.env) {
  const binding = await resolveCanvasSessionBinding(projectRoot, options, env);
  const paths = buildCanvasSessionPaths(projectRoot, binding);
  await fs.mkdir(paths.assetsDir, { recursive: true });
  await fs.mkdir(paths.exportsDir, { recursive: true });
  await fs.mkdir(paths.relaysDir, { recursive: true });
  const existing = await readJson(paths.sessionFile).catch(() => null);
  const resolvedBinding = preserveCanvasBindingDisplayTitle(binding, existing?.binding);
  const now = timestamp();
  const session = {
    schema: `openprd.canvas.session.v${CANVAS_SCHEMA_VERSION}`,
    version: CANVAS_SCHEMA_VERSION,
    sessionKey: resolvedBinding.sessionKey,
    projectRoot,
    binding: resolvedBinding,
    paths,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await writeJson(paths.sessionFile, session);
  if (!(await exists(paths.sceneFile))) {
    await writeJson(paths.sceneFile, {
      type: 'openprd.canvas.scene.v1',
      elements: [],
      appState: {
        viewBackgroundColor: CANVAS_SURFACE_BACKGROUND,
      },
      files: {},
      savedAt: now,
    });
  }
  if (!(await exists(paths.opsFile))) {
    await writeJson(paths.opsFile, {
      type: 'openprd.canvas.ops.v1',
      nextSeq: 0,
      ops: [],
    });
  }
  if (!(await exists(paths.libraryFile))) {
    await writeJson(paths.libraryFile, {
      type: 'excalidrawlib',
      version: 2,
      source: 'https://openprd.local/canvas',
      libraryItems: [],
    });
  }
  return session;
}

export {
  CANVAS_SCHEMA_VERSION,
  buildCanvasSessionPaths,
  ensureCanvasSession,
  preserveCanvasBindingDisplayTitle,
  resolveCanvasSessionBinding,
};
