/*
 * Core purpose
 * Scene-level domain logic for the Open VibeCoding canvas: scene/library
 * normalization, structured selection payloads, size-contract handling,
 * anchored image placement math, and asset materialization (data URL, local
 * path, or remote URL into the session assets directory).
 *
 * Positioning
 * Used by canvas-workspace.js request handlers. Keep HTTP concerns out of
 * this module; it only deals with scene data and session files.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';
import {
  CANVAS_SURFACE_BACKGROUND,
  LEGACY_CANVAS_BACKGROUNDS,
  appendOperation,
  firstPresent,
  isPlainObject,
  shortHash,
  trimString,
} from './canvas-session-store.js';

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

const CANVAS_ANCHOR_PLACEMENTS = new Set(['right', 'left', 'below', 'above']);

function summarizeCanvasElement(element) {
  const summary = {
    id: element.id,
    type: element.type ?? null,
    x: Math.round(Number(element.x ?? 0)),
    y: Math.round(Number(element.y ?? 0)),
    width: Math.round(Number(element.width ?? 0)),
    height: Math.round(Number(element.height ?? 0)),
  };
  if (Number(element.angle ?? 0) !== 0) {
    summary.angle = Number(element.angle);
  }
  if (typeof element.text === 'string' && element.text.trim()) {
    summary.text = trimString(element.text, 500);
  }
  if (element.fileId) {
    summary.fileId = element.fileId;
  }
  const role = element.customData?.openprdRole;
  if (role) {
    summary.openprdRole = role;
  }
  const groupIds = Array.isArray(element.groupIds) ? element.groupIds.filter(Boolean) : [];
  if (groupIds.length > 0) {
    summary.groupIds = groupIds;
  }
  return summary;
}

function buildCanvasSelectionPayload(scene) {
  const elements = Array.isArray(scene?.elements) ? scene.elements : [];
  const selectedIds = isPlainObject(scene?.appState?.selectedElementIds) ? scene.appState.selectedElementIds : {};
  const selected = elements.filter((element) => element && !element.isDeleted && selectedIds[element.id]);
  const payload = {
    ok: true,
    savedAt: scene?.savedAt ?? null,
    count: selected.length,
    elements: selected.map(summarizeCanvasElement),
  };
  if (selected.length > 0) {
    const minX = Math.min(...selected.map((element) => Number(element.x ?? 0)));
    const minY = Math.min(...selected.map((element) => Number(element.y ?? 0)));
    const maxX = Math.max(...selected.map((element) => Number(element.x ?? 0) + Number(element.width ?? 0)));
    const maxY = Math.max(...selected.map((element) => Number(element.y ?? 0) + Number(element.height ?? 0)));
    payload.bounds = {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
    };
  } else {
    payload.hint = 'No canvas selection right now. Ask the user to select elements on the canvas, or read /api/scene for the full scene.';
  }
  return payload;
}

function normalizeCanvasSizeContract(input) {
  if (!isPlainObject(input)) {
    return null;
  }
  const contract = {};
  const width = Number(input.width);
  const height = Number(input.height);
  const aspectRatio = Number(input.aspectRatio);
  if (Number.isFinite(width) && width > 0) {
    contract.width = Math.round(width);
  }
  if (Number.isFinite(height) && height > 0) {
    contract.height = Math.round(height);
  }
  if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
    contract.aspectRatio = aspectRatio;
  }
  return Object.keys(contract).length > 0 ? contract : null;
}

function computeAnchoredCanvasBox(anchor, placement, input = {}) {
  const gap = Number.isFinite(Number(input.gap)) ? Number(input.gap) : 48;
  const anchorX = Number(anchor.x ?? 0);
  const anchorY = Number(anchor.y ?? 0);
  const anchorWidth = Math.max(1, Number(anchor.width ?? 320));
  const anchorHeight = Math.max(1, Number(anchor.height ?? 240));
  const ratio = Number(input.aspectRatio);
  const width = Number.isFinite(Number(input.width)) && Number(input.width) > 0
    ? Number(input.width)
    : anchorWidth;
  const height = Number.isFinite(Number(input.height)) && Number(input.height) > 0
    ? Number(input.height)
    : (Number.isFinite(ratio) && ratio > 0 ? width / ratio : anchorHeight);
  let x = anchorX;
  let y = anchorY;
  if (placement === 'right') {
    x = anchorX + anchorWidth + gap;
  } else if (placement === 'left') {
    x = anchorX - gap - width;
  } else if (placement === 'below') {
    y = anchorY + anchorHeight + gap;
  } else if (placement === 'above') {
    y = anchorY - gap - height;
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
}

async function insertAnchoredCanvasImage(session, input) {
  const anchorElementId = firstPresent(input.anchorElementId, input.anchorShapeId);
  let anchor = null;
  let placement = null;
  let box = null;
  if (anchorElementId) {
    const scene = normalizeCanvasScene(await readJson(session.paths.sceneFile).catch(() => null));
    anchor = scene.elements.find((element) => element && element.id === anchorElementId && !element.isDeleted) ?? null;
    if (!anchor) {
      const error = new Error(`Anchor element not found on the canvas: ${anchorElementId}`);
      error.statusCode = 404;
      throw error;
    }
    placement = CANVAS_ANCHOR_PLACEMENTS.has(input.placement) ? input.placement : 'right';
    box = computeAnchoredCanvasBox(anchor, placement, input);
  }
  const asset = await materializeImage(session, input);
  const operation = await appendOperation(session.paths, {
    type: 'image',
    mode: input.mode === 'replace' ? 'replace' : 'append',
    aspectRatio: input.aspectRatio ?? null,
    placeholderId: input.placeholderId ?? null,
    anchorElementId: anchor?.id ?? null,
    placement,
    box,
    sizeContract: normalizeCanvasSizeContract(input.sizeContract),
    note: input.note ?? 'insert-image',
    assetUrl: asset.assetUrl,
    assetPath: asset.assetPath,
    sourcePath: asset.sourcePath,
    sourceUrl: asset.sourceUrl,
    mimeType: asset.mimeType,
    fileId: `open-vibecoding-${asset.digest}`,
  });
  return {
    operation,
    asset,
    anchor: anchor ? summarizeCanvasElement(anchor) : null,
    box,
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

export {
  CANVAS_ANCHOR_PLACEMENTS,
  MIME_TYPES,
  appendLibraryItem,
  buildCanvasSelectionPayload,
  computeAnchoredCanvasBox,
  dataUrlToBuffer,
  extensionFromMime,
  insertAnchoredCanvasImage,
  materializeImage,
  mimeFromPath,
  normalizeCanvasLibrary,
  normalizeCanvasScene,
  normalizeCanvasSizeContract,
  readLibrary,
  summarizeCanvasElement,
  writeLibrary,
};
