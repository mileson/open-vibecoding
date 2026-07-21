import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTaskScopedDesignRecords, validateBitmapPixelContract } from '../src/design-asset-contract.js';

test('bitmap contract rejects baked rounded-square backgrounds', () => {
  const result = validateBitmapPixelContract({
    mode: 'opaque-full-bleed-tile',
    prompt: 'full-bleed edge-to-edge portrait fully contained inside a muted solid-color rounded-square background; no white outer margin; no transparent corners',
    cornerAlpha: [255, 255, 255, 255],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /bakes a rounded UI container/);
});

test('bitmap contract keeps transparent and full-bleed corner validation separate', () => {
  const fullBleedMismatch = validateBitmapPixelContract({
    mode: 'opaque-full-bleed-tile',
    prompt: 'full-bleed edge-to-edge; no rounded rectangle; no white outer margin; no transparent corners',
    cornerAlpha: [255, 0, 255, 255],
  });
  assert.equal(fullBleedMismatch.ok, false);
  assert.match(fullBleedMismatch.errors.join('\n'), /all four corners to be opaque/);

  const cutoutMismatch = validateBitmapPixelContract({
    mode: 'transparent-cutout',
    prompt: 'standalone subject with safe crop',
    cornerAlpha: [0, 0, 255, 0],
  });
  assert.equal(cutoutMismatch.ok, false);
  assert.match(cutoutMismatch.errors.join('\n'), /all four corners to be transparent/);
});

test('task-scoped design records do not inherit an older clay direction', () => {
  const records = [
    { taskScope: 'demo-world', aesthetic: '3D soft-clay', explicitlyReferenced: true },
    { taskScope: 'market-avatar-20260721', aesthetic: 'flat editorial portrait', explicitlyReferenced: true },
    { taskScope: '', aesthetic: 'legacy clay aggregate', explicitlyReferenced: true },
  ];
  assert.deepEqual(selectTaskScopedDesignRecords(records, 'market-avatar-20260721'), [records[1]]);
});
