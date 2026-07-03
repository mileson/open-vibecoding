/*
 * Core purpose
 * Provide the OpenPrd local canvas service and conversation-bound storage.
 *
 * Inputs
 * Receives a project root plus optional CLI flags such as --thread,
 * --thread-title, --session, --host, --port, --daemon, --stop, --open,
 * --open-target, and --dry-run.
 *
 * Outputs
 * Creates `.openprd/harness/canvas-sessions/<session-key>/`, serves a local
 * Excalidraw browser app, persists scene state, and accepts agent image/card
 * operations for that specific conversation binding.
 *
 * Positioning
 * This is the product boundary for canvas collaboration. It intentionally does
 * not depend on Codex-only globals; Codex, Claude Code, Cursor, and future
 * clients can all bind a canvas by providing session evidence.
 *
 * Maintenance rules
 * Keep the HTTP API small and file-backed. If realtime collaboration is added,
 * preserve this file-backed session format as the review/archive source.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderCanvasAppHtml } from './canvas-app.html.js';
import { cjoin, exists, readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';

const CANVAS_SCHEMA_VERSION = 1;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0;
const DEFAULT_DAEMON_PORT = 4767;
const BODY_LIMIT_BYTES = 35 * 1024 * 1024;
const SESSION_KEY_MAX = 84;
const DAEMON_READY_TIMEOUT_MS = 7000;
const HANDOFF_TEXT_MAX = 24000;
const CLI_BIN_PATH = cjoin(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'openprd.js');
const CODEX_APP_SERVER_RELAY_WORKER_PATH = cjoin(path.dirname(fileURLToPath(import.meta.url)), 'codex-app-server-relay.js');
const CODEX_APP_SERVER_RELAY_TIMEOUT_MS = 20 * 60 * 1000;
const CODEX_APP_SERVER_RELAY_START_WAIT_MS = 0;
const CODEX_APP_BUNDLE_BIN_PATH = '/Applications/Codex.app/Contents/Resources/codex';
const CODEX_DELEGATION_RELAY_TRANSPORT = 'codex-app-server-codex-delegation-turn-start';
const CODEX_AGENT_BRIDGE_TRANSPORT = 'codex-agent-send-message-to-thread';
const CANVAS_SURFACE_BACKGROUND = '#ffffff';
const LEGACY_CANVAS_BACKGROUNDS = new Set(['#fbfaf7', '#fffdf9', '#f8f6f1']);
const CANVAS_OPEN_TARGETS = new Set(['auto', 'system', 'codex-browser']);
const CODEX_RELAY_DELIVERED_STATUSES = new Set(['completed']);
const CODEX_RELAY_ACCEPTED_STATUSES = new Set([...CODEX_RELAY_DELIVERED_STATUSES, 'started']);
const CODEX_RELAY_PENDING_STATUSES = new Set(['queued', 'starting', 'resuming', 'connecting', 'started']);
const CODEX_RELAY_WAIT_READY_STATUSES = new Set([
  ...CODEX_RELAY_ACCEPTED_STATUSES,
  'failed',
  'timeout-before-start',
  'timeout-after-start',
  'closed-before-start',
  'closed-after-start',
]);
const CODEX_RELAY_AGENT_FALLBACK_STATUSES = new Set([
  'failed',
  'timeout-before-start',
  'closed-before-start',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.excalidraw': 'application/json; charset=utf-8',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCanvasSceneAppState(appState) {
  const nextAppState = isPlainObject(appState) ? { ...appState } : {};
  const current = String(nextAppState.viewBackgroundColor ?? '').trim().toLowerCase();
  if (!current || LEGACY_CANVAS_BACKGROUNDS.has(current)) {
    nextAppState.viewBackgroundColor = CANVAS_SURFACE_BACKGROUND;
  }
  return nextAppState;
}

function normalizeCanvasScene(scene = {}) {
  const input = isPlainObject(scene) ? scene : {};
  return {
    type: input.type ?? 'openprd.canvas.scene.v1',
    elements: Array.isArray(input.elements) ? input.elements : [],
    appState: normalizeCanvasSceneAppState(input.appState),
    files: isPlainObject(input.files) ? input.files : {},
    savedAt: input.savedAt ?? timestamp(),
  };
}

function normalizeCanvasLibrary(input = {}) {
  const body = isPlainObject(input) ? input : {};
  const rawItems = Array.isArray(body.libraryItems)
    ? body.libraryItems
    : (Array.isArray(body.items) ? body.items : []);
  return {
    type: 'excalidrawlib',
    version: Number.isFinite(Number(body.version)) ? Number(body.version) : 2,
    source: body.source ?? 'https://openprd.local/canvas',
    libraryItems: rawItems.map(normalizeLibraryItem).filter(Boolean),
  };
}

function normalizeLibraryItem(item) {
  if (!isPlainObject(item) || !Array.isArray(item.elements) || item.elements.length === 0) {
    return null;
  }
  const id = String(item.id || `lib-${Date.now()}-${shortHash(JSON.stringify(item.elements))}`);
  const status = item.status === 'published' ? 'published' : 'unpublished';
  const created = Number.isFinite(Number(item.created)) ? Number(item.created) : Date.now();
  const nextItem = {
    id,
    status,
    elements: item.elements,
    created,
  };
  if (typeof item.name === 'string' && item.name.trim()) {
    nextItem.name = trimString(item.name, 120);
  }
  if (typeof item.error === 'string' && item.error.trim()) {
    nextItem.error = trimString(item.error, 500);
  }
  return nextItem;
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 10);
}

function sanitizeSessionSegment(value, fallback = 'workspace') {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[/\\:]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SESSION_KEY_MAX);
  return normalized || fallback;
}

function buildSessionKey(kind, id) {
  const safeKind = sanitizeSessionSegment(kind, 'session');
  const safeId = sanitizeSessionSegment(id, 'workspace');
  return `${safeKind}-${safeId}-${shortHash(`${kind}:${id}`)}`;
}

function firstPresent(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeBindingTitle(...values) {
  const title = firstPresent(...values);
  if (!title) {
    return null;
  }
  return title.length > 160 ? `${title.slice(0, 157)}...` : title;
}

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

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function textResponse(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(text);
}

async function readRequestJson(req, limitBytes = BODY_LIMIT_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) {
    return {};
  }
  return JSON.parse(text);
}

async function readOps(paths) {
  const ops = await readJson(paths.opsFile).catch(() => null);
  if (!ops || !Array.isArray(ops.ops)) {
    return { type: 'openprd.canvas.ops.v1', nextSeq: 0, ops: [] };
  }
  return ops;
}

async function appendOperation(paths, operation) {
  const ops = await readOps(paths);
  const seq = Number(ops.nextSeq ?? ops.ops.length) + 1;
  const nextOperation = {
    id: operation.id ?? `op-${seq}-${shortHash(JSON.stringify(operation))}`,
    seq,
    createdAt: timestamp(),
    ...operation,
  };
  const nextOps = {
    ...ops,
    nextSeq: seq,
    ops: [...ops.ops, nextOperation],
  };
  await writeJson(paths.opsFile, nextOps);
  return nextOperation;
}

async function updateOperation(paths, operationId, patch) {
  const ops = await readOps(paths);
  let updatedOperation = null;
  const nextOperations = ops.ops.map((op) => {
    if (op.id !== operationId) {
      return op;
    }
    updatedOperation = {
      ...op,
      ...patch,
      updatedAt: timestamp(),
    };
    return updatedOperation;
  });
  if (!updatedOperation) {
    const error = new Error(`Canvas operation not found: ${operationId}`);
    error.statusCode = 404;
    throw error;
  }
  await writeJson(paths.opsFile, {
    ...ops,
    ops: nextOperations,
  });
  return updatedOperation;
}

async function readLibrary(paths) {
  return normalizeCanvasLibrary(await readJson(paths.libraryFile).catch(() => ({
    type: 'openprd.canvas.library.v1',
    items: [],
  })));
}

async function writeLibrary(paths, library) {
  const nextLibrary = normalizeCanvasLibrary(library);
  await writeJson(paths.libraryFile, nextLibrary);
  return nextLibrary;
}

async function appendLibraryItem(session, input) {
  const elements = Array.isArray(input.elements) ? input.elements : [];
  if (elements.length === 0) {
    const error = new Error('Expected at least one element for a library item.');
    error.statusCode = 400;
    throw error;
  }
  const library = await readLibrary(session.paths);
  const id = `lib-${Date.now()}-${shortHash(JSON.stringify(elements))}`;
  const item = {
    id,
    status: input.status === 'published' ? 'published' : 'unpublished',
    created: Date.now(),
    elements,
  };
  if (input.name) {
    item.name = trimString(input.name, 120);
  }
  const nextItems = [item, ...library.libraryItems].slice(0, 80);
  const nextLibrary = await writeLibrary(session.paths, {
    ...library,
    libraryItems: nextItems,
  });
  return { item, library: nextLibrary };
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/i.exec(String(dataUrl ?? ''));
  if (!match) {
    throw new Error('Expected a data URL.');
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const raw = match[3] ?? '';
  const buffer = isBase64 ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw), 'utf8');
  return { buffer, mimeType };
}

function extensionFromMime(mimeType, fallback = '.bin') {
  const normalized = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/svg+xml') return '.svg';
  if (normalized === 'application/json') return '.json';
  return fallback;
}

function mimeFromPath(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function trimString(value, maxLength = HANDOFF_TEXT_MAX) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}

function escapeCodexDelegationXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildCodexDelegationText(sourceThreadId, inputText) {
  const sourceId = trimString(sourceThreadId || 'openprd-canvas', 200);
  const text = trimString(inputText || 'Please continue from this OpenPrd Canvas handoff.');
  return [
    '<codex_delegation>',
    `  <source_thread_id>${escapeCodexDelegationXml(sourceId)}</source_thread_id>`,
    `  <input>${escapeCodexDelegationXml(text)}</input>`,
    '</codex_delegation>',
  ].join('\n');
}

function parsePositiveInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter(Boolean);
}

function downloadsDir(env = process.env) {
  return env.OPENPRD_DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');
}

function clipboardCommandCandidates(platform = process.platform) {
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [] }];
  }
  if (platform === 'win32') {
    return [{ command: 'clip.exe', args: [] }];
  }
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ];
}

async function writeTextToSystemClipboard(text, options = {}) {
  const value = trimString(text, HANDOFF_TEXT_MAX);
  const candidates = clipboardCommandCandidates(options.platform);
  if (options.dryRun) {
    return {
      ok: true,
      command: candidates[0]?.command ?? null,
      platform: options.platform ?? process.platform,
      dryRun: true,
    };
  }
  let lastError = null;
  for (const candidate of candidates) {
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(candidate.command, candidate.args, { stdio: ['pipe', 'ignore', 'ignore'] });
        child.once('error', reject);
        child.once('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`${candidate.command} exited with code ${code}`));
        });
        child.stdin.end(value);
      });
      return {
        ok: true,
        command: candidate.command,
        platform: options.platform ?? process.platform,
        dryRun: false,
      };
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error(`Could not write to system clipboard: ${lastError?.message ?? 'no clipboard command available'}`);
  error.statusCode = 500;
  throw error;
}

function relayTimeoutMs(env = process.env) {
  return parsePositiveInteger(env.OPENPRD_CANVAS_CODEX_RELAY_TIMEOUT_MS, CODEX_APP_SERVER_RELAY_TIMEOUT_MS);
}

function relayStartWaitMs(options = {}, env = process.env) {
  if (options.relayWaitMs != null) {
    return parsePositiveInteger(options.relayWaitMs, 0);
  }
  return parsePositiveInteger(env.OPENPRD_CANVAS_CODEX_RELAY_START_WAIT_MS, CODEX_APP_SERVER_RELAY_START_WAIT_MS);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCodexRelayStart(statusPath, waitMs) {
  const timeoutMs = parsePositiveInteger(waitMs, 0);
  if (!timeoutMs) {
    return null;
  }
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() <= deadline) {
    latest = await readJson(statusPath).catch(() => latest);
    if (latest?.status && CODEX_RELAY_WAIT_READY_STATUSES.has(latest.status)) {
      return latest;
    }
    await sleep(350);
  }
  latest = await readJson(statusPath).catch(() => latest);
  return latest ? { ...latest, waitTimedOut: true } : {
    status: 'queued',
    waitTimedOut: true,
  };
}

function relayStatusSummary(statusDoc) {
  if (!statusDoc) {
    return {};
  }
  const status = statusDoc.status ?? 'queued';
  return {
    status,
    phase: statusDoc.phase ?? null,
    turn: statusDoc.turn ?? null,
    resolvedThread: statusDoc.resolvedThread ?? null,
    error: statusDoc.error ?? null,
    waitTimedOut: Boolean(statusDoc.waitTimedOut),
    delivered: CODEX_RELAY_DELIVERED_STATUSES.has(status),
    pending: Boolean(statusDoc.waitTimedOut) || CODEX_RELAY_PENDING_STATUSES.has(status),
    accepted: CODEX_RELAY_ACCEPTED_STATUSES.has(status),
  };
}

async function resolveCodexAppServerBin(env = process.env) {
  if (env.OPENPRD_CODEX_APP_SERVER_BIN) {
    return env.OPENPRD_CODEX_APP_SERVER_BIN;
  }
  if (process.platform === 'darwin' && await exists(CODEX_APP_BUNDLE_BIN_PATH)) {
    return CODEX_APP_BUNDLE_BIN_PATH;
  }
  return 'codex';
}

function codexRelaySkipReason(session, op, options = {}, env = process.env) {
  if (options.relay === false || options.disableRelay === true) {
    return 'disabled-by-request';
  }
  if (env.OPENPRD_CANVAS_CODEX_RELAY === '0') {
    return 'disabled-by-env';
  }
  if (String(op.target ?? '').toLowerCase() !== 'codex') {
    return 'unsupported-target';
  }
  if (session.binding?.kind !== 'thread' || !session.binding?.id) {
    return 'not-thread-bound';
  }
  return null;
}

function buildCodexRelayInput(session, op) {
  const input = [];
  const text = trimString(op.promptText || op.instruction || 'Please continue from this OpenPrd Canvas handoff.');
  if (text.trim()) {
    const sourceThreadId = session.binding?.id || op.binding?.id || op.threadId || 'openprd-canvas';
    input.push({ type: 'text', text: buildCodexDelegationText(sourceThreadId, text) });
  }
  const exportPath = String(op.exportPath ?? '').trim();
  if (exportPath) {
    input.push({ type: 'localImage', path: exportPath });
  }
  return input;
}

function buildCodexAgentBridgePrompt(session, op) {
  const text = trimString(op.promptText || op.instruction || 'Please continue from this OpenPrd Canvas handoff.');
  const sourceThreadId = session.binding?.id || op.binding?.id || op.threadId || 'openprd-canvas';
  return buildCodexDelegationText(sourceThreadId, text);
}

function summarizeAgentBridgeOperation(op) {
  if (!op) {
    return null;
  }
  return {
    id: op.id,
    seq: op.seq ?? null,
    status: op.status ?? 'pending',
    target: op.target ?? 'codex',
    transport: op.transport ?? CODEX_AGENT_BRIDGE_TRANSPORT,
    handoffOperationId: op.handoffOperationId ?? null,
    threadId: op.threadId ?? null,
    threadTitle: op.threadTitle ?? null,
    prompt: op.prompt ?? null,
    promptText: op.promptText ?? null,
    exportPath: op.exportPath ?? null,
    exportUrl: op.exportUrl ?? null,
    selection: op.selection ?? null,
    placeholderId: op.placeholderId ?? null,
    elementCount: op.elementCount ?? null,
    selectedElementIds: Array.isArray(op.selectedElementIds) ? op.selectedElementIds : [],
    createdAt: op.createdAt ?? null,
    updatedAt: op.updatedAt ?? null,
    claimedAt: op.claimedAt ?? null,
    sentAt: op.sentAt ?? null,
    failedAt: op.failedAt ?? null,
    reason: op.reason ?? null,
    requiresAgentTool: op.requiresAgentTool ?? 'codex_app.send_message_to_thread',
  };
}

function codexRelayNeedsAgentBridgeFallback(relay) {
  if (!relay || relay.status === 'skipped') {
    return true;
  }
  const status = String(relay.status ?? '');
  if (CODEX_RELAY_AGENT_FALLBACK_STATUSES.has(status)) {
    return true;
  }
  return Boolean(relay.waitTimedOut && ['queued', 'starting', 'resuming'].includes(status));
}

async function queueCodexAgentBridge(session, op, options = {}) {
  const requested = Boolean(options.agentBridge || options.foregroundBridge);
  const base = {
    target: op.target ?? 'codex',
    transport: CODEX_AGENT_BRIDGE_TRANSPORT,
    supportsForegroundMessage: false,
    requiresAgentTool: 'codex_app.send_message_to_thread',
  };
  if (options.agentBridgeSkipReason) {
    return {
      ...base,
      status: 'skipped',
      reason: options.agentBridgeSkipReason,
      directRelayStatus: options.directRelay?.status ?? null,
      directRelayTransport: options.directRelay?.transport ?? CODEX_DELEGATION_RELAY_TRANSPORT,
    };
  }
  if (!requested) {
    return {
      ...base,
      status: 'skipped',
      reason: 'not-requested',
    };
  }
  if (String(op.target ?? '').toLowerCase() !== 'codex') {
    return {
      ...base,
      status: 'skipped',
      reason: 'unsupported-target',
    };
  }
  if (session.binding?.kind !== 'thread' || !session.binding?.id) {
    return {
      ...base,
      status: 'skipped',
      reason: 'not-thread-bound',
    };
  }
  const bridgeOp = await appendOperation(session.paths, {
    type: 'agent-foreground-relay',
    target: 'codex',
    transport: CODEX_AGENT_BRIDGE_TRANSPORT,
    status: 'pending',
    handoffOperationId: op.id,
    threadId: session.binding.id,
    threadTitle: session.binding.title || session.binding.threadTitle || null,
    prompt: buildCodexAgentBridgePrompt(session, op),
    promptText: op.promptText ?? null,
    exportPath: op.exportPath ?? null,
    exportUrl: op.exportUrl ?? null,
    selection: op.selection ?? null,
    placeholderId: op.placeholderId ?? null,
    elementCount: op.elementCount ?? null,
    selectedElementIds: Array.isArray(op.selectedElementIds) ? op.selectedElementIds : [],
    locale: op.locale ?? null,
    note: op.note ?? null,
    requiresAgentTool: 'codex_app.send_message_to_thread',
    supportsForegroundMessage: true,
  });
  return {
    ...base,
    ...summarizeAgentBridgeOperation(bridgeOp),
    status: 'pending',
    supportsForegroundMessage: true,
  };
}

async function listCodexAgentBridgeOutbox(session, options = {}) {
  const includeAll = Boolean(options.all);
  const ops = await readOps(session.paths);
  const items = ops.ops
    .filter((op) => op.type === 'agent-foreground-relay')
    .filter((op) => includeAll || ['pending', 'claimed'].includes(op.status ?? 'pending'))
    .map(summarizeAgentBridgeOperation)
    .filter(Boolean);
  return items;
}

async function claimCodexAgentBridgeItem(session, claim = 'next') {
  const items = await listCodexAgentBridgeOutbox(session);
  const value = String(claim || 'next');
  const item = value === 'next'
    ? items.find((candidate) => candidate.status === 'pending')
    : items.find((candidate) => candidate.id === value);
  if (!item) {
    return null;
  }
  const updated = await updateOperation(session.paths, item.id, {
    status: 'claimed',
    claimedAt: timestamp(),
  });
  await appendOperation(session.paths, {
    type: 'agent-foreground-relay-status',
    bridgeOperationId: item.id,
    status: 'claimed',
  });
  return summarizeAgentBridgeOperation(updated);
}

async function markCodexAgentBridgeItem(session, id, status, options = {}) {
  if (!id) {
    const error = new Error('Expected --id for canvas bridge status update.');
    error.statusCode = 400;
    throw error;
  }
  const normalizedStatus = status === 'failed' ? 'failed' : 'sent';
  const timestampField = normalizedStatus === 'failed' ? 'failedAt' : 'sentAt';
  const updated = await updateOperation(session.paths, id, {
    status: normalizedStatus,
    [timestampField]: timestamp(),
    reason: options.reason ?? null,
    sentThreadId: options.threadId ?? session.binding?.id ?? null,
  });
  await appendOperation(session.paths, {
    type: 'agent-foreground-relay-status',
    bridgeOperationId: id,
    status: normalizedStatus,
    reason: options.reason ?? null,
    threadId: options.threadId ?? session.binding?.id ?? null,
  });
  return summarizeAgentBridgeOperation(updated);
}

async function queueCodexThreadRelay(session, op, options = {}, env = process.env) {
  const skipReason = codexRelaySkipReason(session, op, options, env);
  const input = buildCodexRelayInput(session, op);
  const supportsDirectAttachment = input.some((item) => item.type === 'localImage');
  const base = {
    target: op.target ?? 'codex',
    transport: CODEX_DELEGATION_RELAY_TRANSPORT,
    supportsDirectMessage: !skipReason,
    supportsDirectAttachment: !skipReason && supportsDirectAttachment,
    inputTypes: input.map((item) => item.type),
    promptText: op.promptText,
    delivered: false,
    pending: false,
    accepted: false,
  };
  if (skipReason) {
    return {
      ...base,
      status: 'skipped',
      reason: skipReason,
      supportsDirectMessage: false,
      supportsDirectAttachment: false,
    };
  }

  await fs.mkdir(session.paths.relaysDir, { recursive: true });
  const relayName = sanitizeSessionSegment(op.id || `handoff-${Date.now()}`, 'handoff');
  const payloadPath = cjoin(session.paths.relaysDir, `${relayName}.payload.json`);
  const statusPath = cjoin(session.paths.relaysDir, `${relayName}.status.json`);
  const logPath = cjoin(session.paths.relaysDir, `${relayName}.log`);
  const payload = {
    schema: 'openprd.codex.app-server-relay.v1',
    createdAt: timestamp(),
    handoffOperationId: op.id,
    threadId: session.binding.id,
    threadTitle: session.binding.title || session.binding.threadTitle || null,
    cwd: session.projectRoot,
    input,
    payloadPath,
    statusPath,
    logPath,
    codexBin: await resolveCodexAppServerBin(env),
    timeoutMs: relayTimeoutMs(env),
  };
  await writeJson(payloadPath, payload);
  await writeJson(statusPath, {
    schema: 'openprd.codex.app-server-relay.status.v1',
    status: 'queued',
    createdAt: payload.createdAt,
    updatedAt: timestamp(),
    handoffOperationId: op.id,
    threadId: session.binding.id,
  });

  if (options.relayDryRun || env.OPENPRD_CANVAS_CODEX_RELAY_DRY_RUN === '1') {
    return {
      ...base,
      ...relayStatusSummary({ status: 'queued' }),
      status: 'queued',
      dryRun: true,
      payloadPath,
      statusPath,
      logPath,
    };
  }

  const child = spawn(process.execPath, [CODEX_APP_SERVER_RELAY_WORKER_PATH, payloadPath], {
    cwd: session.projectRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const waitedStatus = await waitForCodexRelayStart(statusPath, relayStartWaitMs(options, env));
  const statusSummary = relayStatusSummary(waitedStatus || { status: 'queued' });
  return {
    ...base,
    status: statusSummary.status ?? 'queued',
    payloadPath,
    statusPath,
    logPath,
    pid: child.pid ?? null,
    ...statusSummary,
  };
}

async function materializeImage(session, input) {
  const paths = session.paths;
  let buffer = null;
  let mimeType = null;
  let sourcePath = null;
  let sourceUrl = null;
  let extension = '.png';

  if (input.dataUrl) {
    const parsed = dataUrlToBuffer(input.dataUrl);
    buffer = parsed.buffer;
    mimeType = parsed.mimeType;
    extension = extensionFromMime(mimeType, '.png');
  } else if (input.path) {
    sourcePath = path.isAbsolute(input.path) ? input.path : path.resolve(session.projectRoot, input.path);
    buffer = await fs.readFile(sourcePath);
    extension = path.extname(sourcePath) || '.png';
    mimeType = mimeFromPath(sourcePath);
  } else if (input.url) {
    sourceUrl = input.url;
    const response = await fetch(input.url);
    if (!response.ok) {
      throw new Error(`Unable to fetch image URL: ${response.status} ${response.statusText}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
    mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
    extension = extensionFromMime(mimeType, path.extname(decodeURIComponent(new URL(input.url).pathname)) || '.png');
  } else {
    throw new Error('Expected one of: dataUrl, path, url.');
  }

  const safeExt = extension.startsWith('.') ? extension : `.${extension}`;
  const digest = shortHash(buffer);
  const fileName = `image-${Date.now()}-${digest}${safeExt.toLowerCase()}`;
  const assetPath = cjoin(paths.assetsDir, fileName);
  await fs.writeFile(assetPath, buffer);
  return {
    fileName,
    assetPath,
    assetUrl: `/assets/${encodeURIComponent(fileName)}`,
    mimeType,
    sourcePath,
    sourceUrl,
    digest,
  };
}

async function materializeExport(session, input) {
  if (!input.dataUrl) {
    throw new Error('Expected dataUrl for export.');
  }
  const parsed = dataUrlToBuffer(input.dataUrl);
  const extension = extensionFromMime(parsed.mimeType, '.png');
  const baseName = sanitizeSessionSegment(input.filename || `canvas-export-${Date.now()}`, 'canvas-export');
  const fileName = baseName.endsWith(extension) ? baseName : `${baseName}${extension}`;
  const exportPath = cjoin(session.paths.exportsDir, fileName);
  await fs.writeFile(exportPath, parsed.buffer);
  return {
    fileName,
    exportPath,
    exportUrl: `/exports/${encodeURIComponent(fileName)}`,
    mimeType: parsed.mimeType,
  };
}

function safeDownloadFileName(value, fallback = `openprd-canvas-${Date.now()}.excalidraw`) {
  const requestedName = String(value ?? fallback).trim() || fallback;
  const baseName = path.basename(requestedName);
  if (baseName !== requestedName || baseName.includes('/') || baseName.includes('\\') || baseName.includes('..')) {
    const error = new Error('Invalid download filename.');
    error.statusCode = 400;
    throw error;
  }
  return baseName;
}

async function materializeDownloadFile(input) {
  const content = String(input.content ?? '');
  if (!content.trim()) {
    throw new Error('Expected content for file save.');
  }
  const targetDir = downloadsDir();
  await fs.mkdir(targetDir, { recursive: true });
  const fileName = safeDownloadFileName(input.filename);
  const filePath = path.join(targetDir, fileName);
  await fs.writeFile(filePath, content, 'utf8');
  return {
    fileName,
    filePath,
    folderPath: targetDir,
    mimeType: input.mimeType || 'application/json; charset=utf-8',
  };
}

function isInsideDirectory(parentDir, targetPath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function resolveCanvasSessionFile(session, requestedPath, allowedDirs = []) {
  if (!requestedPath) {
    const error = new Error('Expected source path.');
    error.statusCode = 400;
    throw error;
  }
  const targetPath = path.resolve(String(requestedPath));
  const allowed = allowedDirs.some((dir) => isInsideDirectory(dir, targetPath));
  if (!allowed) {
    const error = new Error('Path is outside this canvas session.');
    error.statusCode = 403;
    throw error;
  }
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat?.isFile()) {
    const error = new Error('Path does not exist.');
    error.statusCode = 404;
    throw error;
  }
  return targetPath;
}

async function materializeDownloadImage(session, input) {
  const sourcePath = await resolveCanvasSessionFile(
    session,
    input.path || input.exportPath || input.assetPath,
    [session.paths.exportsDir, session.paths.assetsDir],
  );
  const targetDir = downloadsDir();
  await fs.mkdir(targetDir, { recursive: true });
  const extension = path.extname(sourcePath) || extensionFromMime(input.mimeType || mimeFromPath(sourcePath), '.png');
  const fallback = `openprd-canvas-image-${Date.now()}${extension}`;
  const requestedName = safeDownloadFileName(input.filename || input.fileName, fallback);
  const fileName = path.extname(requestedName) ? requestedName : `${requestedName}${extension}`;
  const filePath = path.join(targetDir, fileName);
  await fs.copyFile(sourcePath, filePath);
  return {
    fileName,
    filePath,
    folderPath: targetDir,
    sourcePath,
    mimeType: mimeFromPath(filePath),
  };
}

async function resolveOpenFolderTarget(session, requestedPath) {
  if (!requestedPath) {
    const error = new Error('Expected path.');
    error.statusCode = 400;
    throw error;
  }
  const sessionRoot = path.resolve(session.paths.sessionDir);
  const targetPath = path.resolve(String(requestedPath));
  const relative = path.relative(sessionRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error('Path is outside this canvas session.');
    error.statusCode = 403;
    throw error;
  }
  const stat = await fs.stat(targetPath).catch(() => null);
  if (!stat) {
    const error = new Error('Path does not exist.');
    error.statusCode = 404;
    throw error;
  }
  const isFile = stat.isFile();
  return {
    targetPath,
    folderPath: isFile ? path.dirname(targetPath) : targetPath,
    isFile,
  };
}

async function resolveDownloadsFolderTarget(fileName) {
  const targetDir = downloadsDir();
  const requestedName = String(fileName ?? '').trim();
  if (!requestedName) {
    return {
      targetPath: targetDir,
      folderPath: targetDir,
      isFile: false,
      fileName: null,
    };
  }
  const safeName = safeDownloadFileName(requestedName);
  const targetPath = path.join(targetDir, safeName);
  const stat = await fs.stat(targetPath).catch(() => null);
  if (stat?.isFile()) {
    return {
      targetPath,
      folderPath: targetDir,
      isFile: true,
      fileName: safeName,
    };
  }
  return {
    targetPath: targetDir,
    folderPath: targetDir,
    isFile: false,
    fileName: safeName,
    missingFile: true,
  };
}

function safeStaticName(urlPathname, prefix) {
  const raw = decodeURIComponent(urlPathname.slice(prefix.length));
  if (!raw || raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    return null;
  }
  return raw;
}

async function serveStaticFile(res, filePath) {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    textResponse(res, 404, 'Not found');
    return;
  }
  res.writeHead(200, {
    'content-type': mimeFromPath(filePath),
    'content-length': stat.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(filePath).pipe(res);
}

async function buildReviewDirectionsPayload(projectRoot) {
  const versionIndexPath = cjoin(projectRoot, '.openprd', 'state', 'version-index.json');
  const versionIndex = await readJson(versionIndexPath).catch(() => []);
  const latestVersionId = Array.isArray(versionIndex) ? versionIndex.at(-1)?.versionId : null;
  if (!latestVersionId) {
    return { ok: false, reason: 'no-version', directions: [] };
  }
  const snapshot = await readJson(cjoin(projectRoot, '.openprd', 'state', 'versions', `${latestVersionId}.json`)).catch(() => null);
  const block = snapshot?.reviewPresentation?.designDirections;
  const rawDirections = Array.isArray(block?.directions) ? block.directions : [];
  if (rawDirections.length === 0) {
    return { ok: false, reason: 'no-directions', versionId: latestVersionId, directions: [] };
  }
  const resolvedRoot = path.resolve(projectRoot);
  const directions = [];
  for (const direction of rawDirections) {
    if (!direction || typeof direction !== 'object') {
      continue;
    }
    const entry = {
      id: String(direction.id || ''),
      title: String(direction.title || ''),
      summary: String(direction.summary || ''),
      tradeoff: String(direction.tradeoff || ''),
      image: null,
    };
    const imagePath = typeof direction.image === 'string' ? direction.image.trim() : '';
    if (imagePath) {
      const resolvedImage = path.resolve(resolvedRoot, imagePath);
      if (resolvedImage.startsWith(`${resolvedRoot}${path.sep}`) && await exists(resolvedImage)) {
        const buffer = await fs.readFile(resolvedImage).catch(() => null);
        if (buffer) {
          const mimeType = mimeFromPath(resolvedImage);
          entry.image = {
            path: imagePath,
            mimeType,
            dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
          };
        }
      }
    }
    directions.push(entry);
  }
  return {
    ok: directions.length > 0,
    versionId: latestVersionId,
    title: snapshot?.title || '',
    selectedDirectionId: (await readJson(cjoin(projectRoot, '.openprd', 'state', 'current.json')).catch(() => null))?.reviewStatus?.designDirection?.id
      || null,
    directions,
  };
}

async function handleCanvasRequest(session, req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/') {
    if (req.method === 'HEAD') {
      textResponse(res, 200, '', 'text/html; charset=utf-8');
      return;
    }
    textResponse(res, 200, renderCanvasAppHtml(session), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && pathname === '/api/session') {
    jsonResponse(res, 200, session);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/guide') {
    try {
      const { guideWorkspace } = await import('./guide.js');
      jsonResponse(res, 200, await guideWorkspace(session.projectRoot));
    } catch (error) {
      jsonResponse(res, 200, { ok: false, error: error?.message || String(error) });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/review-directions') {
    try {
      jsonResponse(res, 200, await buildReviewDirectionsPayload(session.projectRoot));
    } catch (error) {
      jsonResponse(res, 200, { ok: false, error: error?.message || String(error) });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/scene') {
    const scene = normalizeCanvasScene(await readJson(session.paths.sceneFile).catch(() => ({
      type: 'openprd.canvas.scene.v1',
      elements: [],
      appState: { viewBackgroundColor: CANVAS_SURFACE_BACKGROUND },
      files: {},
    })));
    jsonResponse(res, 200, scene);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/scene') {
    const body = await readRequestJson(req);
    await writeJson(session.paths.sceneFile, normalizeCanvasScene({
      type: 'openprd.canvas.scene.v1',
      elements: Array.isArray(body.elements) ? body.elements : [],
      appState: isPlainObject(body.appState) ? body.appState : {},
      files: isPlainObject(body.files) ? body.files : {},
      savedAt: timestamp(),
    }));
    jsonResponse(res, 200, { ok: true, scenePath: session.paths.sceneFile });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/ops') {
    const after = Number(url.searchParams.get('after') ?? -1);
    const ops = await readOps(session.paths);
    jsonResponse(res, 200, {
      ok: true,
      nextSeq: ops.nextSeq,
      ops: ops.ops.filter((op) => Number(op.seq ?? 0) > after),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/agent-bridge') {
    const pending = await listCodexAgentBridgeOutbox(session);
    jsonResponse(res, 200, {
      ok: true,
      transport: CODEX_AGENT_BRIDGE_TRANSPORT,
      requiresAgentTool: 'codex_app.send_message_to_thread',
      pending,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/library') {
    const library = await readLibrary(session.paths);
    jsonResponse(res, 200, {
      ok: true,
      ...library,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/library') {
    const body = await readRequestJson(req);
    if (Array.isArray(body.libraryItems) || Array.isArray(body.items)) {
      const library = await writeLibrary(session.paths, body);
      const op = await appendOperation(session.paths, {
        type: 'library',
        intent: body.intent ?? 'sync-excalidraw-library',
        itemCount: library.libraryItems.length,
        locale: body.locale ?? null,
      });
      jsonResponse(res, 200, {
        ok: true,
        operation: op,
        ...library,
      });
      return;
    }
    const result = await appendLibraryItem(session, body);
    const op = await appendOperation(session.paths, {
      type: 'library',
      intent: body.intent ?? 'add-selection-to-library',
      libraryItemId: result.item.id,
      elementCount: result.item.elements.length,
      locale: body.locale ?? null,
    });
    jsonResponse(res, 200, {
      ok: true,
      operation: op,
      item: result.item,
      ...result.library,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/images') {
    const body = await readRequestJson(req);
    const asset = await materializeImage(session, body);
    const op = await appendOperation(session.paths, {
      type: 'image',
      mode: body.mode ?? 'replace',
      aspectRatio: body.aspectRatio ?? null,
      placeholderId: body.placeholderId ?? null,
      note: body.note ?? null,
      assetUrl: asset.assetUrl,
      assetPath: asset.assetPath,
      sourcePath: asset.sourcePath,
      sourceUrl: asset.sourceUrl,
      mimeType: asset.mimeType,
      fileId: `openprd-${asset.digest}`,
    });
    jsonResponse(res, 200, {
      ok: true,
      operation: op,
      asset,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/cards') {
    const body = await readRequestJson(req).catch(() => ({}));
    const op = await appendOperation(session.paths, {
      type: 'card',
      source: body.source ?? 'agent',
      note: body.note ?? null,
    });
    jsonResponse(res, 200, { ok: true, operation: op });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/exports') {
    const body = await readRequestJson(req);
    const exported = await materializeExport(session, body);
    const op = await appendOperation(session.paths, {
      type: 'export',
      intent: body.intent ?? 'manual-export',
      exportPath: exported.exportPath,
      exportUrl: exported.exportUrl,
      selection: body.selection ?? null,
      elementCount: Number.isFinite(Number(body.elementCount)) ? Number(body.elementCount) : null,
      selectedElementIds: normalizeStringArray(body.selectedElementIds),
      locale: body.locale ?? null,
    });
    jsonResponse(res, 200, {
      ok: true,
      operation: op,
      export: exported,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/download-file') {
    const body = await readRequestJson(req);
    const file = await materializeDownloadFile(body);
    jsonResponse(res, 200, {
      ok: true,
      file,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/download-image') {
    const body = await readRequestJson(req);
    const file = await materializeDownloadImage(session, body);
    jsonResponse(res, 200, {
      ok: true,
      file,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/open-folder') {
    const body = await readRequestJson(req);
    const target = await resolveOpenFolderTarget(session, body.path || body.targetPath);
    openPathInFileManager(target);
    jsonResponse(res, 200, {
      ok: true,
      opened: true,
      platform: process.platform,
      ...target,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/open-download') {
    const body = await readRequestJson(req);
    const target = await resolveDownloadsFolderTarget(body.filename || body.fileName);
    openPathInFileManager(target);
    jsonResponse(res, 200, {
      ok: true,
      opened: true,
      platform: process.platform,
      ...target,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/clipboard') {
    const body = await readRequestJson(req, 256 * 1024);
    const result = await writeTextToSystemClipboard(body.text ?? body.value ?? '', {
      dryRun: Boolean(body.dryRun),
      platform: body.platform,
    });
    jsonResponse(res, 200, {
      ok: true,
      clipboard: result,
    });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/handoffs') {
    const body = await readRequestJson(req);
    const target = body.target ?? body.targetClient ?? 'codex';
    const requestedTransport = body.transport ?? CODEX_DELEGATION_RELAY_TRANSPORT;
    const transport = String(target).toLowerCase() === 'codex'
      ? CODEX_DELEGATION_RELAY_TRANSPORT
      : requestedTransport;
    const op = await appendOperation(session.paths, {
      type: 'handoff',
      target,
      transport,
      status: 'prepared',
      exportOperationId: body.exportOperationId ?? null,
      exportPath: body.exportPath ?? null,
      exportUrl: body.exportUrl ?? null,
      promptText: trimString(body.promptText),
      instruction: trimString(body.instruction, 4000),
      selection: body.selection ?? null,
      placeholderId: body.placeholderId ?? null,
      aspectRatio: body.aspectRatio ?? null,
      mode: body.mode ?? null,
      elementCount: Number.isFinite(Number(body.elementCount)) ? Number(body.elementCount) : null,
      selectedElementIds: normalizeStringArray(body.selectedElementIds),
      locale: body.locale ?? null,
      binding: {
        kind: session.binding?.kind ?? null,
        id: session.binding?.id ?? null,
        displayId: session.binding?.displayId ?? null,
        title: session.binding?.title ?? null,
        threadTitle: session.binding?.threadTitle ?? null,
        sessionTitle: session.binding?.sessionTitle ?? null,
        source: session.binding?.source ?? null,
      },
      note: body.note ?? null,
    });
    const relay = await queueCodexThreadRelay(session, op, body);
    if (relay.status !== 'skipped') {
      await appendOperation(session.paths, {
        type: 'handoff-relay',
        handoffOperationId: op.id,
        target,
        transport: relay.transport,
        status: relay.status,
        dryRun: Boolean(relay.dryRun),
        payloadPath: relay.payloadPath ?? null,
        statusPath: relay.statusPath ?? null,
        logPath: relay.logPath ?? null,
        pid: relay.pid ?? null,
        inputTypes: relay.inputTypes ?? [],
      });
    }
    const agentBridgeRequested = Boolean(body.agentBridge || body.foregroundBridge);
    const agentBridge = await queueCodexAgentBridge(
      session,
      op,
      agentBridgeRequested && !codexRelayNeedsAgentBridgeFallback(relay)
        ? {
          ...body,
          agentBridgeSkipReason: 'direct-relay-active',
          directRelay: {
            status: relay.status,
            transport: relay.transport,
          },
        }
        : body,
    );
    jsonResponse(res, 200, {
      ok: true,
      operation: op,
      agentBridge,
      relay,
    });
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/assets/')) {
    const name = safeStaticName(pathname, '/assets/');
    if (!name) {
      textResponse(res, 400, 'Invalid asset path');
      return;
    }
    await serveStaticFile(res, cjoin(session.paths.assetsDir, name));
    return;
  }

  if (req.method === 'GET' && pathname.startsWith('/exports/')) {
    const name = safeStaticName(pathname, '/exports/');
    if (!name) {
      textResponse(res, 400, 'Invalid export path');
      return;
    }
    await serveStaticFile(res, cjoin(session.paths.exportsDir, name));
    return;
  }

  textResponse(res, 404, 'Not found');
}

function normalizeCanvasOpenTarget(value, env = process.env) {
  const requested = firstPresent(value, env.OPENPRD_CANVAS_OPEN_TARGET, env.OPENPRD_OPEN_TARGET, 'auto');
  const normalized = String(requested).trim().toLowerCase();
  if (!CANVAS_OPEN_TARGETS.has(normalized)) {
    throw new Error(`Invalid canvas open target: ${requested}. Expected auto, system, or codex-browser.`);
  }
  return normalized;
}

function bindingHasCodexBrowserEvidence(binding = {}) {
  const activeClient = String(binding.activeClient ?? '').toLowerCase();
  const surface = String(binding.surface ?? '').toLowerCase();
  const observedCapabilities = Array.isArray(binding.observedCapabilities) ? binding.observedCapabilities : [];
  return (
    activeClient === 'codex'
    && (surface.includes('desktop') || surface.includes('browser') || surface.includes('app'))
    && observedCapabilities.some((capability) => String(capability).toLowerCase().includes('browser'))
  );
}

function resolveCanvasOpenTarget(session, options = {}, env = process.env) {
  const requestedTarget = normalizeCanvasOpenTarget(options.openTarget, env);
  if (requestedTarget === 'codex-browser') {
    return {
      requestedTarget,
      target: 'codex-browser',
      reason: 'explicit-open-target',
    };
  }
  if (requestedTarget === 'system') {
    return {
      requestedTarget,
      target: 'system',
      reason: 'explicit-open-target',
    };
  }
  if (bindingHasCodexBrowserEvidence(session?.binding)) {
    return {
      requestedTarget,
      target: 'codex-browser',
      reason: 'runtime-evidence',
    };
  }
  return {
    requestedTarget,
    target: 'system',
    reason: 'no-codex-browser-evidence',
  };
}

function openSystemUrl(url) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }
  if (platform === 'win32') {
    const child = spawn('cmd', ['/d', '/s', '/c', 'start', '', url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }
  const child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

function openPathInFileManager(target) {
  const platform = process.platform;
  if (platform === 'darwin') {
    const args = target.isFile ? ['-R', target.targetPath] : [target.folderPath];
    const child = spawn('open', args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }
  if (platform === 'win32') {
    const args = target.isFile ? [`/select,${target.targetPath}`] : [target.folderPath];
    const child = spawn('explorer.exe', args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  }
  const child = spawn('xdg-open', [target.folderPath], { detached: true, stdio: 'ignore' });
  child.unref();
  return true;
}

function openCanvasUrl(url, session, options = {}, env = process.env) {
  const target = resolveCanvasOpenTarget(session, options, env);
  if (target.target === 'codex-browser') {
    return {
      ...target,
      status: 'requires-agent-browser',
      opened: false,
      url,
      message: 'Use the Codex in-app Browser tool to open this URL; the CLI will not launch the system browser for this target.',
    };
  }
  openSystemUrl(url);
  return {
    ...target,
    status: 'opened',
    opened: true,
    url,
  };
}

async function listen(server, host, port) {
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  return server.address();
}

function normalizePort(port, fallback = DEFAULT_PORT) {
  if (port === null || port === undefined || port === '') {
    return fallback;
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid canvas port: ${port}`);
  }
  return parsed;
}

function canvasUrl(host, port) {
  const urlHost = host === '::' ? '127.0.0.1' : host;
  return `http://${urlHost}:${port}/`;
}

function processIsAlive(pid) {
  if (!pid || !Number.isInteger(Number(pid))) {
    return false;
  }
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function fetchCanvasSession(url) {
  const response = await fetch(new URL('/api/session', url));
  if (!response.ok) {
    return null;
  }
  return response.json();
}

function sameBinding(left, right) {
  return Boolean(left?.kind && right?.kind && left.kind === right.kind && left.id === right.id);
}

async function waitForCanvasServer(url, expectedBinding, timeoutMs = DAEMON_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const remoteSession = await fetchCanvasSession(url);
      if (sameBinding(remoteSession?.binding, expectedBinding)) {
        return remoteSession;
      }
      lastError = new Error('Canvas server responded with a different session binding.');
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Canvas daemon did not become ready at ${url}: ${lastError?.message ?? 'timeout'}`);
}

async function writeServerMetadata(session, metadata) {
  await writeJson(session.paths.serverFile, {
    type: 'openprd.canvas.server.v1',
    sessionKey: session.sessionKey,
    binding: session.binding,
    updatedAt: timestamp(),
    ...metadata,
  });
}

async function removeServerMetadata(session) {
  await fs.rm(session.paths.serverFile, { force: true }).catch(() => {});
}

function canvasBindingArgs(session) {
  if (session.binding?.kind === 'thread') {
    const args = ['--thread', session.binding.id];
    const title = normalizeBindingTitle(session.binding.title, session.binding.threadTitle, session.binding.name);
    if (title) {
      args.push('--thread-title', title);
    }
    return args;
  }
  if (session.binding?.kind === 'session') {
    const args = ['--session', session.binding.id];
    const title = normalizeBindingTitle(session.binding.title, session.binding.sessionTitle, session.binding.name);
    if (title) {
      args.push('--session-title', title);
    }
    return args;
  }
  throw new Error('Persistent canvas requires thread/session evidence. Pass --thread <id> or --session <id>.');
}

function canvasDaemonArgs(projectRoot, session, options = {}) {
  const args = [
    CLI_BIN_PATH,
    'canvas',
    projectRoot,
    '--host',
    options.host,
    '--port',
    String(options.port),
    ...canvasBindingArgs(session),
  ];
  if (options.json) {
    args.push('--json');
  }
  return args;
}

async function existingCanvasServer(session, url) {
  const metadata = await readJson(session.paths.serverFile).catch(() => null);
  if (!metadata?.pid || !processIsAlive(metadata.pid)) {
    return null;
  }
  try {
    const remoteSession = await fetchCanvasSession(metadata.url ?? url);
    if (sameBinding(remoteSession?.binding, session.binding)) {
      return metadata;
    }
  } catch {
    return null;
  }
  return null;
}

async function startCanvasDaemon(projectRoot, session, options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = normalizePort(options.port, DEFAULT_DAEMON_PORT);
  if (port === 0) {
    throw new Error('Persistent canvas requires a fixed port. Pass --port <number>.');
  }
  const url = canvasUrl(host, port);
  const existing = await existingCanvasServer(session, url);
  if (existing) {
    const openResult = options.open ? openCanvasUrl(existing.url ?? url, session, options) : null;
    if (options.open) {
      await writeServerMetadata(session, {
        ...existing,
        openResult,
      }).catch(() => {});
    }
    return {
      ok: true,
      action: 'canvas',
      daemon: true,
      alreadyRunning: true,
      dryRun: false,
      projectRoot,
      session,
      paths: session.paths,
      url: existing.url ?? url,
      host,
      port,
      pid: existing.pid,
      logPath: session.paths.logFile,
      openResult,
    };
  }

  await fs.mkdir(session.paths.sessionDir, { recursive: true });
  const logHandle = await fs.open(session.paths.logFile, 'a');
  const child = spawn(process.execPath, canvasDaemonArgs(projectRoot, session, { ...options, host, port, json: false }), {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logHandle.fd, logHandle.fd],
    env: {
      ...process.env,
      OPENPRD_CANVAS_DAEMON: '1',
    },
  });
  await logHandle.close().catch(() => {});
  child.unref();

  await waitForCanvasServer(url, session.binding);
  await writeServerMetadata(session, {
    mode: 'daemon',
    pid: child.pid,
    url,
    host,
    port,
    logPath: session.paths.logFile,
    startedAt: timestamp(),
    openTarget: normalizeCanvasOpenTarget(options.openTarget),
  });

  const openResult = options.open ? openCanvasUrl(url, session, options) : null;
  if (options.open) {
    await writeServerMetadata(session, {
      mode: 'daemon',
      pid: child.pid,
      url,
      host,
      port,
      logPath: session.paths.logFile,
      startedAt: timestamp(),
      openTarget: normalizeCanvasOpenTarget(options.openTarget),
      openResult,
    }).catch(() => {});
  }

  return {
    ok: true,
    action: 'canvas',
    daemon: true,
    alreadyRunning: false,
    dryRun: false,
    projectRoot,
    session,
    paths: session.paths,
    url,
    host,
    port,
    pid: child.pid,
    logPath: session.paths.logFile,
    openResult,
  };
}

async function stopCanvasDaemon(session) {
  const metadata = await readJson(session.paths.serverFile).catch(() => null);
  if (!metadata?.pid) {
    return {
      ok: true,
      action: 'canvas-stop',
      stopped: false,
      reason: 'not-running',
      session,
      paths: session.paths,
    };
  }
  const pid = Number(metadata.pid);
  if (processIsAlive(pid)) {
    process.kill(pid, 'SIGTERM');
    const startedAt = Date.now();
    while (processIsAlive(pid) && Date.now() - startedAt < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  await removeServerMetadata(session);
  return {
    ok: true,
    action: 'canvas-stop',
    stopped: true,
    session,
    paths: session.paths,
    pid,
    url: metadata.url ?? null,
  };
}

async function canvasWorkspace(projectRoot, options = {}) {
  const session = await ensureCanvasSession(projectRoot, options);
  const host = options.host || DEFAULT_HOST;
  const port = normalizePort(options.port, DEFAULT_PORT);
  const baseResult = {
    ok: true,
    action: 'canvas',
    dryRun: Boolean(options.dryRun),
    projectRoot,
    session,
    paths: session.paths,
  };

  if (options.bridgeOutbox || options.bridgeSent || options.bridgeFailed) {
    if (options.bridgeSent || options.bridgeFailed) {
      const item = await markCodexAgentBridgeItem(session, options.id, options.bridgeFailed ? 'failed' : 'sent', {
        reason: options.reason,
        threadId: session.binding?.id ?? null,
      });
      return {
        ...baseResult,
        action: 'canvas-agent-bridge',
        bridgeAction: options.bridgeFailed ? 'failed' : 'sent',
        item,
      };
    }
    if (options.claim) {
      const item = await claimCodexAgentBridgeItem(session, options.claim);
      return {
        ...baseResult,
        action: 'canvas-agent-bridge',
        bridgeAction: 'claim',
        item,
        pending: item ? [item] : [],
      };
    }
    const pending = await listCodexAgentBridgeOutbox(session);
    return {
      ...baseResult,
      action: 'canvas-agent-bridge',
      bridgeAction: 'outbox',
      pending,
    };
  }

  if (options.stop) {
    return stopCanvasDaemon(session);
  }

  if (options.dryRun) {
    return {
      ...baseResult,
      url: null,
      host,
      port,
    };
  }

  if (options.daemon) {
    return startCanvasDaemon(projectRoot, session, { ...options, host });
  }

  const server = http.createServer((req, res) => {
    handleCanvasRequest(session, req, res).catch((error) => {
      const statusCode = Number(error.statusCode ?? 500);
      jsonResponse(res, statusCode, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  const address = await listen(server, host, port);
  const actualHost = typeof address === 'object' && address ? address.address : host;
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = canvasUrl(actualHost, actualPort);
  await writeServerMetadata(session, {
    mode: process.env.OPENPRD_CANVAS_DAEMON === '1' ? 'daemon-child' : 'foreground',
    pid: process.pid,
    url,
    host: actualHost,
    port: actualPort,
    logPath: session.paths.logFile,
    startedAt: timestamp(),
    openTarget: normalizeCanvasOpenTarget(options.openTarget),
  });
  server.once('close', () => {
    removeServerMetadata(session);
  });
  const result = {
    ...baseResult,
    url,
    host: actualHost,
    port: actualPort,
  };
  Object.defineProperty(result, 'server', {
    value: server,
    enumerable: false,
  });

  result.openResult = options.open ? openCanvasUrl(url, session, options) : null;
  return result;
}

function toPrintableCanvasResult(result) {
  if (!result) {
    return result;
  }
  const { server, ...printable } = result;
  return printable;
}

export {
  buildCanvasSessionPaths,
  buildReviewDirectionsPayload,
  canvasWorkspace,
  ensureCanvasSession,
  resolveCanvasOpenTarget,
  resolveDownloadsFolderTarget,
  resolveOpenFolderTarget,
  resolveCanvasSessionBinding,
  sanitizeSessionSegment,
  stopCanvasDaemon,
  toPrintableCanvasResult,
};
