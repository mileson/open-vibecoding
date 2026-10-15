import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { imageAnnotate, visualGrid } from '../src/visual-assistance.js';

const root = new URL('../', import.meta.url).pathname;
test('public documentation links resolve without private workstation paths', async () => {
  for (const file of ['README.md', 'README_EN.md', 'docs/visual-assistance.md', 'docs/visual-assistance.en.md', 'docs/capability-gallery.md']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.ok(!text.includes('/Users/'));
    for (const match of text.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) await fs.access(path.resolve(root, path.dirname(file), match[1].split('#')[0]));
  }
});

test('published annotation plan matches the public source and reproduces the shown pixels', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-public-visual-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(root, 'docs/assets/open-vibecoding-visual-source.png');
  const plan = JSON.parse(await fs.readFile(path.join(root, 'docs/examples/visual-assistance/annotation-plan.json'), 'utf8'));
  const before = await fs.readFile(source);
  assert.equal(plan.source.sha256, crypto.createHash('sha256').update(before).digest('hex'));
  const grid = await visualGrid({ source, out: path.join(temp, 'grid.png') });
  const annotation = await imageAnnotate({ source, out: path.join(temp, 'annotated.png'), plan });
  for (const [result, name] of [[grid, 'grid'], [annotation, 'annotated']]) {
    const expected = await sharp(path.join(root, `docs/assets/open-vibecoding-visual-${name}.png`)).raw().toBuffer();
    assert.deepEqual(await sharp(result.output).raw().toBuffer(), expected);
  }
  assert.deepEqual(await fs.readFile(source), before);
});
