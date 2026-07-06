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
import {
  CANVAS_SURFACE_BACKGROUND,
  HANDOFF_TEXT_MAX,
  appendOperation,
  firstPresent,
  isPlainObject,
  normalizeBindingTitle,
  normalizeStringArray,
  readOps,
  sanitizeSessionSegment,
  trimString,
} from './canvas-session-store.js';
import {
  buildCanvasSessionPaths,
  ensureCanvasSession,
  resolveCanvasSessionBinding,
} from './canvas-binding.js';
import {
  CODEX_AGENT_BRIDGE_TRANSPORT,
  CODEX_DELEGATION_RELAY_TRANSPORT,
  claimCodexAgentBridgeItem,
  codexRelayNeedsAgentBridgeFallback,
  listCodexAgentBridgeOutbox,
  markCodexAgentBridgeItem,
  queueCodexAgentBridge,
  queueCodexThreadRelay,
} from './canvas-codex-relay.js';
import {
  buildCanvasSelectionPayload,
  dataUrlToBuffer,
  extensionFromMime,
  insertAnchoredCanvasImage,
  materializeImage,
  mimeFromPath,
  normalizeCanvasScene,
  normalizeCanvasSizeContract,
  appendLibraryItem,
  readLibrary,
  writeLibrary,
} from './canvas-scene.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0;
const DEFAULT_DAEMON_PORT = 4767;
const BODY_LIMIT_BYTES = 35 * 1024 * 1024;
const DAEMON_READY_TIMEOUT_MS = 7000;
const CLI_BIN_PATH = cjoin(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'openprd.js');
const CANVAS_OPEN_TARGETS = new Set(['auto', 'system', 'codex-browser']);
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

  if (req.method === 'GET' && pathname === '/api/selection') {
    const scene = normalizeCanvasScene(await readJson(session.paths.sceneFile).catch(() => null));
    jsonResponse(res, 200, buildCanvasSelectionPayload(scene));
    return;
  }

  if (req.method === 'POST' && pathname === '/api/insert-image') {
    const body = await readRequestJson(req);
    const inserted = await insertAnchoredCanvasImage(session, body);
    jsonResponse(res, 200, {
      ok: true,
      ...inserted,
    });
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
      sourceImageElementIds: normalizeStringArray(body.sourceImageElementIds),
      annotationElementIds: normalizeStringArray(body.annotationElementIds),
      sizeContract: normalizeCanvasSizeContract(body.sizeContract),
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
