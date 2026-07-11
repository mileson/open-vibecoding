import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContextCacheKey,
  createMemoryContextCache,
  runContextCacheBenchmark,
} from '../src/context/index.js';

test('context compiler cold/warm benchmark uses cache operation counts instead of wall-clock thresholds', async () => {
  const candidates = Array.from({ length: 1_000 }, (_, index) => ({
    id: `candidate-${String(index).padStart(4, '0')}`,
    authority: index % 10 === 0 ? 'user-confirmed' : 'project-derived',
    freshness: index,
    relevance: (index % 100) / 100,
    content: `fact-${index}`,
  }));
  const request = { revision: 'large-revision', candidates };
  const cache = createMemoryContextCache();
  const benchmark = await runContextCacheBenchmark(request, { cache });

  assert.equal(benchmark.cold.cacheStatus, 'miss');
  assert.equal(benchmark.cold.compiled, true);
  assert.equal(benchmark.warm.cacheStatus, 'hit');
  assert.equal(benchmark.warm.compiled, false);
  assert.equal(benchmark.sameDigest, true);
  assert.deepEqual(benchmark.cacheStats, {
    reads: 2,
    writes: 1,
    hits: 1,
    misses: 1,
    invalidations: 0,
    size: 1,
  });
  assert.ok(benchmark.cold.includedCount > 0);
  assert.equal(benchmark.cold.includedCount, benchmark.warm.includedCount);

  // Cache identity is stable even when an adapter discovers the same candidates
  // in a different filesystem or tool iteration order.
  assert.equal(
    buildContextCacheKey(request),
    buildContextCacheKey({ ...request, candidates: [...candidates].reverse() }),
  );
});
