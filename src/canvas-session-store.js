/*
 * Core purpose
 * Shared low-level primitives for the Open VibeCoding canvas subsystem: session key
 * hashing, string/JSON normalization helpers, and the file-backed ops ledger
 * (read/append/update operations in ops.json).
 *
 * Positioning
 * Imported by canvas-workspace.js, canvas-binding.js, and
 * canvas-codex-relay.js. Keep this module dependency-light (no HTTP, no
 * process spawning) so every canvas module can safely depend on it.
 */
import crypto from 'node:crypto';
import { readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';

const SESSION_KEY_MAX = 84;
const HANDOFF_TEXT_MAX = 24000;
const CANVAS_SURFACE_BACKGROUND = '#ffffff';
const LEGACY_CANVAS_BACKGROUNDS = new Set(['#fbfaf7', '#fffdf9', '#f8f6f1']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

function trimString(value, maxLength = HANDOFF_TEXT_MAX) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
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

export {
  HANDOFF_TEXT_MAX,
  SESSION_KEY_MAX,
  CANVAS_SURFACE_BACKGROUND,
  LEGACY_CANVAS_BACKGROUNDS,
  appendOperation,
  buildSessionKey,
  firstPresent,
  isPlainObject,
  normalizeBindingTitle,
  normalizeStringArray,
  parsePositiveInteger,
  readOps,
  sanitizeSessionSegment,
  shortHash,
  trimString,
  updateOperation,
};
