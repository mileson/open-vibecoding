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
  for (const file of ['README.md', 'README_EN.md', 'docs/visual-assistance.md', 'docs/visual-assistance.en.md', 'docs/capability-gallery.md', 'docs/capability-gallery.en.md']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.ok(!text.includes('/Users/'));
    for (const match of text.matchAll(/\]\((\.\.?\/[^)]+)\)/g)) await fs.access(path.resolve(root, path.dirname(file), match[1].split('#')[0]));
  }
});

test('bilingual galleries contain eight paired readable images and locale-correct entry links', async () => {
  const read = file => fs.readFile(path.join(root, file), 'utf8');
  const zh = await read('docs/capability-gallery.md');
  const en = await read('docs/capability-gallery.en.md');
  const images = text => [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
  const zhImages = images(zh), enImages = images(en);
  const ids = ['visual-assistance', 'icon-family', 'design-review', 'review-repair', 'user-journey', 'audio-evidence', 'diagnostic-readiness', 'review-feedback'];
  assert.deepEqual(zhImages, ids.map(id => `./assets/gallery/zh-CN/${id}.png`));
  assert.deepEqual(enImages, ['./assets/open-vibecoding-visual-assistance-concept.png', ...ids.slice(1).map(id => `./assets/gallery/${id}.png`)]);
  assert.ok(zh.includes('](./capability-gallery.en.md)'));
  assert.ok(en.includes('](./capability-gallery.md)'));
  const zhReadme = await read('README.md'), enReadme = await read('README_EN.md');
  assert.ok(zhReadme.includes('](./docs/capability-gallery.md)'));
  assert.ok(enReadme.includes('](./docs/capability-gallery.en.md)'));
  assert.equal(images(zhReadme)[0], './docs/assets/gallery/zh-CN/visual-assistance.png');
  assert.equal(images(enReadme)[0], './docs/assets/open-vibecoding-visual-assistance-concept.png');
  for (let i = 0; i < ids.length; i++) {
    const buffers = await Promise.all([zhImages[i], enImages[i]].map(file => fs.readFile(path.resolve(root, 'docs', file))));
    assert.notDeepEqual(buffers[0], buffers[1], `${ids[i]} needs a distinct localized image`);
    const metadata = await Promise.all(buffers.map(bytes => sharp(bytes).metadata()));
    for (const image of metadata) {
      assert.equal(image.format, 'png');
      assert.ok(image.width >= 1200 && image.height >= 650);
    }
    assert.ok(Math.abs(metadata[0].width / metadata[0].height - metadata[1].width / metadata[1].height) < 0.01);
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
