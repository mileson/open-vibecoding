import { createHash } from 'node:crypto';

function normalizeStableValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError('Context values must not contain circular references.');
    }
    seen.add(value);
    const normalized = value.map((item) => (
      item === undefined || typeof item === 'function' || typeof item === 'symbol'
        ? null
        : normalizeStableValue(item, seen)
    ));
    seen.delete(value);
    return normalized;
  }
  if (typeof value !== 'object' || value === undefined) {
    return null;
  }
  if (seen.has(value)) {
    throw new TypeError('Context values must not contain circular references.');
  }
  seen.add(value);
  const normalized = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
      continue;
    }
    normalized[key] = normalizeStableValue(item, seen);
  }
  seen.delete(value);
  return normalized;
}

export function stableStringify(value) {
  return JSON.stringify(normalizeStableValue(value));
}

export function digestText(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

export function digestStable(value) {
  return digestText(stableStringify(value));
}

export function compareStableText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function cloneStable(value) {
  return JSON.parse(stableStringify(value));
}
