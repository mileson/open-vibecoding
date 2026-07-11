import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  buildContextRequestFingerprint,
  compileContextCapsule,
  verifyContextCapsule,
} from './compiler.js';
import {
  CONTEXT_CACHE_SCHEMA_VERSION,
  CONTEXT_COMPILER_VERSION,
} from './constants.js';
import { cloneStable, compareStableText, digestStable } from './stable.js';

function assertCacheKey(key) {
  const normalized = String(key ?? '');
  if (!/^context-v1-[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`Invalid context cache key: ${normalized}`);
  }
  return normalized;
}

export function buildContextCacheKey(input, { previousCapsule = null } = {}) {
  const fingerprint = buildContextRequestFingerprint(input, { previousCapsule });
  const hash = digestStable({
    compilerVersion: CONTEXT_COMPILER_VERSION,
    fingerprint,
  }).slice('sha256:'.length);
  return `context-v1-${hash}`;
}

export function contextCachePath(cacheDir, key) {
  return path.join(cacheDir, `${assertCacheKey(key)}.json`);
}

function cacheEnvelope(key, capsule) {
  if (!verifyContextCapsule(capsule)) {
    throw new TypeError('Refusing to cache an invalid ContextCapsule.');
  }
  return {
    schemaVersion: CONTEXT_CACHE_SCHEMA_VERSION,
    key: assertCacheKey(key),
    revision: capsule.revision,
    capsuleDigest: capsule.digest,
    capsule,
  };
}

function validEnvelope(value, key) {
  return Boolean(
    value
      && value.schemaVersion === CONTEXT_CACHE_SCHEMA_VERSION
      && value.key === key
      && value.capsuleDigest === value.capsule?.digest
      && verifyContextCapsule(value.capsule),
  );
}

export async function readContextCache(cacheDir, key) {
  const normalizedKey = assertCacheKey(key);
  try {
    const parsed = JSON.parse(await fs.readFile(contextCachePath(cacheDir, normalizedKey), 'utf8'));
    return validEnvelope(parsed, normalizedKey) ? parsed.capsule : null;
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function writeContextCache(cacheDir, key, capsule) {
  const normalizedKey = assertCacheKey(key);
  const target = contextCachePath(cacheDir, normalizedKey);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const envelope = cacheEnvelope(normalizedKey, capsule);
  await fs.mkdir(cacheDir, { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(envelope)}\n`, 'utf8');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
  return target;
}

function normalizeInvalidationSelector(selector = {}) {
  const keys = new Set();
  if (selector.key) keys.add(assertCacheKey(selector.key));
  for (const key of selector.keys ?? []) keys.add(assertCacheKey(key));
  return {
    keys,
    revision: selector.revision == null ? null : String(selector.revision),
    all: selector.all === true,
  };
}

export async function invalidateContextCache(cacheDir, selector = {}) {
  const normalized = normalizeInvalidationSelector(selector);
  let names;
  try {
    names = await fs.readdir(cacheDir);
  } catch (error) {
    if (error?.code === 'ENOENT') return { removed: [], kept: [], errors: [] };
    throw error;
  }
  const removed = [];
  const kept = [];
  const errors = [];
  for (const name of names.filter((item) => /^context-v1-[a-f0-9]{64}\.json$/.test(item)).sort()) {
    const key = name.slice(0, -'.json'.length);
    let shouldRemove = normalized.all || normalized.keys.has(key);
    if (!shouldRemove && normalized.revision != null) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(cacheDir, name), 'utf8'));
        shouldRemove = parsed.revision === normalized.revision;
      } catch (error) {
        errors.push({ key, error: error?.code ?? error?.name ?? 'read-error' });
      }
    }
    if (!shouldRemove) {
      kept.push(key);
      continue;
    }
    try {
      await fs.rm(path.join(cacheDir, name), { force: true });
      removed.push(key);
    } catch (error) {
      errors.push({ key, error: error?.code ?? error?.name ?? 'remove-error' });
    }
  }
  return { removed, kept, errors };
}

export function createMemoryContextCache() {
  const records = new Map();
  const counters = { reads: 0, writes: 0, hits: 0, misses: 0, invalidations: 0 };
  return {
    async read(key) {
      const normalizedKey = assertCacheKey(key);
      counters.reads += 1;
      if (!records.has(normalizedKey)) {
        counters.misses += 1;
        return null;
      }
      counters.hits += 1;
      return cloneStable(records.get(normalizedKey).capsule);
    },
    async write(key, capsule) {
      const normalizedKey = assertCacheKey(key);
      records.set(normalizedKey, cacheEnvelope(normalizedKey, cloneStable(capsule)));
      counters.writes += 1;
    },
    async invalidate(selector = {}) {
      const normalized = normalizeInvalidationSelector(selector);
      const removed = [];
      const kept = [];
      for (const [key, envelope] of [...records.entries()].sort(([left], [right]) => compareStableText(left, right))) {
        const shouldRemove = normalized.all
          || normalized.keys.has(key)
          || (normalized.revision != null && envelope.revision === normalized.revision);
        if (shouldRemove) {
          records.delete(key);
          removed.push(key);
        } else {
          kept.push(key);
        }
      }
      counters.invalidations += removed.length;
      return { removed, kept, errors: [] };
    },
    stats() {
      return { ...counters, size: records.size };
    },
  };
}

export function createFileContextCache(cacheDir) {
  const counters = { reads: 0, writes: 0, hits: 0, misses: 0, invalidations: 0 };
  return {
    async read(key) {
      counters.reads += 1;
      const capsule = await readContextCache(cacheDir, key);
      if (capsule) counters.hits += 1;
      else counters.misses += 1;
      return capsule;
    },
    async write(key, capsule) {
      counters.writes += 1;
      return writeContextCache(cacheDir, key, capsule);
    },
    async invalidate(selector = {}) {
      const result = await invalidateContextCache(cacheDir, selector);
      counters.invalidations += result.removed.length;
      return result;
    },
    stats() {
      return { ...counters };
    },
  };
}

export async function compileContextWithCache(input, {
  cache,
  previousCapsule = null,
} = {}) {
  if (!cache || typeof cache.read !== 'function' || typeof cache.write !== 'function') {
    throw new TypeError('compileContextWithCache requires a cache with read() and write().');
  }
  const cacheKey = buildContextCacheKey(input, { previousCapsule });
  const cached = await cache.read(cacheKey);
  if (cached && verifyContextCapsule(cached)) {
    return { capsule: cached, cacheKey, cacheStatus: 'hit', compiled: false };
  }
  const capsule = compileContextCapsule(input, { previousCapsule });
  await cache.write(cacheKey, capsule);
  return { capsule, cacheKey, cacheStatus: 'miss', compiled: true };
}

/**
 * A structural cold/warm benchmark. It deliberately reports operation counts
 * rather than wall-clock thresholds, which keeps CI stable across machines.
 */
export async function runContextCacheBenchmark(input, {
  cache = createMemoryContextCache(),
  previousCapsule = null,
} = {}) {
  const cold = await compileContextWithCache(input, { cache, previousCapsule });
  const warm = await compileContextWithCache(input, { cache, previousCapsule });
  return {
    cold: {
      cacheStatus: cold.cacheStatus,
      compiled: cold.compiled,
      digest: cold.capsule.digest,
      includedCount: cold.capsule.entries.length,
    },
    warm: {
      cacheStatus: warm.cacheStatus,
      compiled: warm.compiled,
      digest: warm.capsule.digest,
      includedCount: warm.capsule.entries.length,
    },
    sameDigest: cold.capsule.digest === warm.capsule.digest,
    cacheStats: typeof cache.stats === 'function' ? cache.stats() : null,
  };
}
