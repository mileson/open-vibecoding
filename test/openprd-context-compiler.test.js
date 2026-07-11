import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONTEXT_CAPSULE_SCHEMA_VERSION,
  CONTEXT_REQUEST_SCHEMA_VERSION,
  DEFAULT_CONTEXT_DELTA_TOKEN_BUDGET,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  buildContextCacheKey,
  compileContextCapsule,
  createContextRequest,
  createContextTelemetryEvent,
  createMemoryContextCache,
  emitContextTelemetry,
  invalidateContextCache,
  readContextCache,
  verifyContextCapsule,
  writeContextCache,
} from '../src/context/index.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test('ContextRequest and ContextCapsule v1 use deterministic authority, freshness, and relevance order', () => {
  const candidates = [
    { id: 'canonical-recent-low', content: 'D', authority: 'project-canonical', freshness: 'recent', relevance: 0.2 },
    { id: 'canonical-current', content: 'B', authority: 'project-canonical', freshness: 'current', relevance: 0.1 },
    { id: 'canonical-recent-high', content: 'C', authority: 'project-canonical', freshness: 'recent', relevance: 0.9 },
    { id: 'user-stale', content: 'A', authority: 'user-confirmed', freshness: 'stale', relevance: 0 },
  ];
  const request = createContextRequest({ revision: 'git:abc123', workspaceId: 'demo', candidates });
  assert.equal(request.schemaVersion, CONTEXT_REQUEST_SCHEMA_VERSION);
  assert.equal(request.tokenBudget, DEFAULT_CONTEXT_TOKEN_BUDGET);
  assert.equal(request.deltaTokenBudget, DEFAULT_CONTEXT_DELTA_TOKEN_BUDGET);

  const capsule = compileContextCapsule(request);
  const reversed = compileContextCapsule({
    revision: 'git:abc123',
    workspaceId: 'demo',
    candidates: [...candidates].reverse(),
  });
  assert.equal(capsule.schemaVersion, CONTEXT_CAPSULE_SCHEMA_VERSION);
  assert.deepEqual(capsule.entries.map((entry) => entry.id), [
    'user-stale',
    'canonical-current',
    'canonical-recent-high',
    'canonical-recent-low',
  ]);
  assert.deepEqual(capsule, reversed);
  assert.equal(capsule.budget.limitTokens, 800);
  assert.equal(verifyContextCapsule(capsule), true);
});

test('file candidates default to digest plus path and all emitted values redact secrets', () => {
  const capsule = compileContextCapsule({
    revision: 'r-secrets',
    candidates: [
      {
        id: 'config-file',
        kind: 'file',
        authority: 'project-canonical',
        file: {
          path: 'config/private.env',
          content: 'OPENAI_API_KEY=sk-proj-super-secret-value',
        },
      },
      {
        id: 'runtime-note',
        authority: 'runtime-observed',
        content: {
          password: 'hunter2',
          OPENAI_API_KEY: 'sk-proj-another-secret',
          note: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
          url: 'https://demo:unsafe-password@example.com/private',
        },
      },
    ],
  });

  const fileEntry = capsule.entries.find((entry) => entry.id === 'config-file');
  assert.deepEqual(Object.keys(fileEntry.value).sort(), ['digest', 'path', 'sizeBytes', 'type']);
  assert.equal(fileEntry.value.path, 'config/private.env');
  assert.match(fileEntry.value.digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(fileEntry.includedReason.includes('file-content-omitted'));

  const serialized = JSON.stringify(capsule);
  assert.doesNotMatch(serialized, /hunter2|super-secret|another-secret|unsafe-password|abcdefghijklmnopqrstuvwxyz/);
  assert.match(serialized, /REDACTED/);
  const noteEntry = capsule.entries.find((entry) => entry.id === 'runtime-note');
  assert.ok(noteEntry.includedReason.includes('secrets-redacted'));
  assert.ok(noteEntry.redactionCount >= 4);
});

test('budget decisions expose included and excluded reasons without blocking smaller candidates', () => {
  const capsule = compileContextCapsule({
    revision: 'r-budget',
    tokenBudget: 25,
    candidates: [
      { id: 'large', authority: 'user-confirmed', content: 'x'.repeat(500) },
      { id: 'small', authority: 'project-canonical', content: 'ok' },
    ],
  });

  assert.deepEqual(capsule.entries.map((entry) => entry.id), ['small']);
  assert.ok(capsule.entries[0].includedReason.includes('within-token-budget'));
  assert.equal(capsule.excluded.find((entry) => entry.id === 'large').excludedReason, 'token-budget-exceeded');
  assert.ok(capsule.budget.estimatedTokens <= capsule.budget.limitTokens);
});

test('previous capsule produces a 250-token delta with added, changed, removed, and unchanged reasons', () => {
  const previous = compileContextCapsule({
    revision: 'r1',
    candidates: [
      { id: 'unchanged', authority: 'project-canonical', content: 'same' },
      { id: 'changed', authority: 'project-canonical', content: 'before' },
      { id: 'removed', authority: 'project-derived', content: 'gone' },
    ],
  });
  const delta = compileContextCapsule({
    revision: 'r2',
    candidates: [
      { id: 'unchanged', authority: 'project-canonical', content: 'same' },
      { id: 'changed', authority: 'project-canonical', content: 'after' },
      { id: 'added', authority: 'runtime-observed', content: 'new' },
    ],
  }, { previousCapsule: previous });

  assert.equal(delta.delivery, 'delta');
  assert.equal(delta.budget.limitTokens, 250);
  assert.deepEqual(delta.entries.map((entry) => entry.id), ['changed', 'added']);
  assert.deepEqual(delta.delta.added, ['added']);
  assert.deepEqual(delta.delta.changed, ['changed']);
  assert.deepEqual(delta.delta.removed, ['removed']);
  assert.deepEqual(delta.delta.unchanged, ['unchanged']);
  assert.equal(
    delta.excluded.find((entry) => entry.id === 'unchanged').excludedReason,
    'unchanged-since-previous-capsule',
  );

  const chainedDelta = compileContextCapsule({
    revision: 'r3',
    candidates: [
      { id: 'unchanged', authority: 'project-canonical', content: 'same' },
      { id: 'changed', authority: 'project-canonical', content: 'after' },
      { id: 'added', authority: 'runtime-observed', content: 'newer' },
    ],
  }, { previousCapsule: delta });
  assert.deepEqual(chainedDelta.entries.map((entry) => entry.id), ['added']);
  assert.deepEqual(chainedDelta.delta.changed, ['added']);
  assert.deepEqual(chainedDelta.delta.unchanged, ['changed', 'unchanged']);
});

test('same request and revision have stable digest and cache key while revision invalidates identity', () => {
  const request = {
    revision: 'r1',
    candidates: [{ id: 'fact', authority: 'user-confirmed', content: 'stable' }],
  };
  const first = compileContextCapsule(request);
  const second = compileContextCapsule(structuredClone(request));
  const nextRevision = compileContextCapsule({ ...request, revision: 'r2' });

  assert.equal(first.digest, second.digest);
  assert.equal(buildContextCacheKey(request), buildContextCacheKey(structuredClone(request)));
  assert.notEqual(first.digest, nextRevision.digest);
  assert.notEqual(buildContextCacheKey(request), buildContextCacheKey({ ...request, revision: 'r2' }));
});

test('compiler is input-pure and telemetry is emitted only through the separate sink API', async () => {
  const input = deepFreeze({
    revision: 'r-pure',
    candidates: [{ id: 'fact', content: { nested: ['value'] } }],
  });
  const before = structuredClone(input);
  const events = [];
  const capsule = compileContextCapsule(input);

  assert.deepEqual(input, before);
  assert.equal(events.length, 0);
  const event = createContextTelemetryEvent({ capsule, cacheStatus: 'not-used' });
  await emitContextTelemetry((value) => events.push(value), event);
  assert.equal(events.length, 1);
  assert.equal(events[0].capsuleDigest, capsule.digest);
  assert.equal('entries' in events[0], false);
  assert.equal('value' in events[0], false);
});

test('memory and file caches support key and revision invalidation', async () => {
  const request = {
    revision: 'r-cache',
    candidates: [{ id: 'fact', content: 'cache me' }],
  };
  const capsule = compileContextCapsule(request);
  const key = buildContextCacheKey(request);
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-context-cache-'));

  await writeContextCache(cacheDir, key, capsule);
  assert.deepEqual(await readContextCache(cacheDir, key), capsule);
  const invalidated = await invalidateContextCache(cacheDir, { revision: 'r-cache' });
  assert.deepEqual(invalidated.removed, [key]);
  assert.equal(await readContextCache(cacheDir, key), null);

  const memory = createMemoryContextCache();
  await memory.write(key, capsule);
  assert.deepEqual(await memory.read(key), capsule);
  const memoryInvalidated = await memory.invalidate({ key });
  assert.deepEqual(memoryInvalidated.removed, [key]);
  assert.equal((await memory.read(key)), null);
});
