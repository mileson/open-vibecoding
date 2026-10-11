import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { designReviewWorkspace } from '../src/design-review.js';
import { setupOpenPrdAgentIntegration } from '../src/agent-integration.js';

const exec = promisify(execFile);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-design-review-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const images = [];
  for (const [i, color] of ['red', 'green', 'blue'].entries()) {
    const file = path.join(root, `source-${i}.png`);
    await sharp({ create: { width: 60 + i * 20, height: 100, channels: 3, background: color } }).png().toFile(file);
    images.push({ path: file, label: `方向 ${i + 1}` });
  }
  return { root, input: { scene: 'chat', images } };
}

test('review preserves originals, numbers collage and allocates immutable versions', async (t) => {
  const { root, input } = await fixture(t);
  const first = await designReviewWorkspace(root, { action: 'save', input });
  assert.equal(first.ok, true, first.error);
  assert.equal(first.version, 'v001');
  for (const [i, original] of first.originals.entries()) assert.deepEqual(await fs.readFile(original.path), await fs.readFile(input.images[i].path));
  const collage = await sharp(first.review).metadata();
  assert.equal(collage.width, 1320);
  assert.equal(collage.height, 960);
  const pixels = await sharp(first.review).removeAlpha().raw().toBuffer();
  assert.deepEqual([...pixels.subarray((500 * 1320 + 220) * 3, (500 * 1320 + 220) * 3 + 3)], [255, 0, 0]);
  const before = await fs.readFile(first.review);
  const second = await designReviewWorkspace(root, { action: 'save', input });
  assert.equal(second.version, 'v002');
  assert.deepEqual(await fs.readFile(first.review), before);
  const index = JSON.parse(await fs.readFile(path.join(root, 'design/chat/index.json')));
  assert.equal(index.currentFinal, null);
  assert.deepEqual(index.versions, ['v001', 'v002']);
});

test('final requires explicit selection, preserves bytes and retains previous selections', async (t) => {
  const { root, input } = await fixture(t);
  await designReviewWorkspace(root, { action: 'save', input });
  const selection = { scene: 'chat', version: 'v001', option: 'option-02' };
  assert.equal((await designReviewWorkspace(root, { action: 'select', input: selection })).ok, false);
  const selected = await designReviewWorkspace(root, { action: 'select', input: { ...selection, confirmed: true } });
  assert.equal(selected.ok, true, selected.error);
  assert.deepEqual(await fs.readFile(selected.final), await fs.readFile(input.images[1].path));
  assert.equal((await designReviewWorkspace(root, { action: 'select', input: { ...selection, confirmed: true } })).ok, true);
  const changed = await designReviewWorkspace(root, { action: 'select', input: { ...selection, option: 'option-01', confirmed: true } });
  assert.equal(changed.ok, true);
  assert.deepEqual(await fs.readFile(selected.final), await fs.readFile(input.images[1].path));
  const index = JSON.parse(await fs.readFile(path.join(root, 'design/chat/index.json')));
  assert.equal(index.currentFinal.option, 'option-01');
  await fs.writeFile(changed.original, 'tampered');
  assert.equal((await designReviewWorkspace(root, { action: 'select', input: { ...selection, option: 'option-01', confirmed: true } })).ok, false);
});

test('rejects unsafe paths and invalid inputs without saving assets', async (t) => {
  const { root, input } = await fixture(t);
  assert.equal((await designReviewWorkspace(root, { action: 'save', input: { ...input, scene: '../escape' } })).ok, false);
  assert.equal((await designReviewWorkspace(root, { action: 'save', input: { ...input, images: [] } })).ok, false);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(root, 'design'));
  assert.equal((await designReviewWorkspace(root, { action: 'save', input })).ok, false);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('concurrent saves allocate distinct versions', async (t) => {
  const { root, input } = await fixture(t);
  const results = await Promise.all([1, 2].map(() => designReviewWorkspace(root, { action: 'save', input })));
  assert.ok(results.every((result) => result.ok), JSON.stringify(results));
  assert.deepEqual(results.map((result) => result.version).sort(), ['v001', 'v002']);
});

test('CLI saves and selects with JSON protocol', async (t) => {
  const { root, input } = await fixture(t);
  const plan = path.join(root, 'plan.json');
  await fs.writeFile(plan, JSON.stringify(input));
  const cli = path.resolve('bin/open-vibecoding.js');
  const saved = JSON.parse((await exec(process.execPath, [cli, 'design-review', root, '--action', 'save', '--json-file', plan])).stdout);
  assert.equal(saved.ok, true);
  await fs.writeFile(plan, JSON.stringify({ scene: 'chat', version: saved.version, option: 'option-03', confirmed: true }));
  const selected = JSON.parse((await exec(process.execPath, [cli, 'design-review', root, '--action', 'select', '--json-file', plan])).stdout);
  assert.equal(selected.ok, true);
  assert.deepEqual(await fs.readFile(selected.final), await fs.readFile(input.images[2].path));
});

test('installation includes review asset instructions and command discovery', async (t) => {
  const { root } = await fixture(t);
  await setupOpenPrdAgentIntegration(root, { tools: 'codex,claude,cursor', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') });
  for (const client of ['.codex', '.claude']) {
    const reference = path.join(root, client, 'skills/open-vibecoding-visual-direction-review/references/design-review.md');
    await fs.access(reference);
    const skill = await fs.readFile(path.join(root, client, 'skills/open-vibecoding-visual-direction-review/SKILL.md'), 'utf8');
    assert.ok(skill.includes('references/design-review.md'));
  }
  const catalog = await fs.readFile(path.join(root, '.open-vibecoding/harness/command-catalog.md'), 'utf8');
  assert.ok(catalog.includes('design-review'));
});

test('selection rejects symlink sources and conflicting existing final', async (t) => {
  const { root, input } = await fixture(t);
  const saved = await designReviewWorkspace(root, { action: 'save', input });
  const select = { scene: 'chat', version: saved.version, option: 'option-01', confirmed: true };
  const final = path.join(root, 'design/chat/v001/option-01-final.png');
  await fs.writeFile(final, 'other content');
  assert.equal((await designReviewWorkspace(root, { action: 'select', input: select })).ok, false);
  assert.equal(await fs.readFile(final, 'utf8'), 'other content');
  await fs.unlink(saved.originals[0].path);
  await fs.symlink(input.images[0].path, saved.originals[0].path);
  assert.equal((await designReviewWorkspace(root, { action: 'select', input: select })).ok, false);
});
