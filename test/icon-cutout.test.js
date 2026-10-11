import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { cutoutPixels, iconCutout } from '../src/icon-cutout.js';

test('keying removes background, keeps foreground and reports its bounds', () => {
  const rgba = Buffer.from(Array.from({ length: 9 }, (_, p) => p === 4 ? [220, 30, 40, 255] : [0, 255, 0, 255]).flat());
  const result = cutoutPixels(rgba, 3, 3, { keyColor: '#00ff00' });
  assert.deepEqual([...result.data.subarray(16, 20)], [220, 30, 40, 255]);
  assert.deepEqual(result.report.bounds, { x: 1, y: 1, width: 1, height: 1 });
  assert.deepEqual(result.report.cornerAlpha, [0, 0, 0, 0]);
  assert.equal(result.report.transparentPixels, 8);
  assert.equal(result.report.touchesEdge, false);
  assert.equal(rgba[3], 255, 'source pixels remain unchanged');
});

test('alpha preservation keeps visible colours and existing soft edges', () => {
  const source = Buffer.from([12, 34, 56, 120, 0, 0, 0, 0]);
  const result = cutoutPixels(source, 2, 1);
  assert.deepEqual(result.data, source);
  assert.equal(result.report.partialPixels, 1);
  assert.equal(result.report.mode, 'preserve-alpha');
});

test('keyed soft edge unmixes matte without increasing existing alpha', () => {
  const result = cutoutPixels(Buffer.from([0, 128, 100, 128]), 1, 1, {
    keyColor: '#00ff00', tolerance: 0, feather: 255,
  });
  assert.equal(result.data[3], 64);
  assert.ok(result.data[1] <= 2, 'green matte removed from soft edge');
  assert.ok(result.data[2] >= 198, 'foreground blue restored');
});

test('malformed colours and ranges cannot silently destroy assets', () => {
  const pixels = Buffer.from([255, 0, 0, 255]);
  for (const options of [{ keyColor: 'green' }, { tolerance: NaN }, { feather: -1 }, { tolerance: 256 }]) {
    assert.throws(() => cutoutPixels(pixels, 1, 1, options));
  }
});

test('CLI emits transparent PNG and protects originals and existing outputs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-icon-'));
  try {
    const source = path.join(root, 'key.png'), out = path.join(root, 'alpha.png');
    const pixels = Buffer.from(Array.from({ length: 9 }, (_, p) => p === 4 ? [200, 20, 30, 255] : [0, 255, 0, 255]).flat());
    await sharp(pixels, { raw: { width: 3, height: 3, channels: 4 } }).png().toFile(source);
    const original = await fs.readFile(source);
    const cli = spawnSync(process.execPath, ['bin/open-vibecoding.js', 'icon-cutout', '--source', source, '--out', out, '--key-color', '#00ff00'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    const report = JSON.parse(cli.stdout);
    assert.equal(report.transparentPixels, 8);
    const output = await sharp(out).ensureAlpha().raw().toBuffer();
    assert.equal(output[3], 0);
    assert.equal(output[19], 255);
    assert.deepEqual(await fs.readFile(source), original);
    await assert.rejects(iconCutout({ source, out, keyColor: '#00ff00' }), /EEXIST/);
    await assert.rejects(iconCutout({ source, out: source, keyColor: '#00ff00' }), /differ/);
    const noOutput = path.join(root, 'invalid.png');
    await assert.rejects(iconCutout({ source, out: noOutput }), /No fully transparent/);
    await assert.rejects(fs.access(noOutput));
    await assert.rejects(iconCutout({ source, out: noOutput, keyColor: '#00ff00', tolerance: 255 }), /entire subject/);
    await assert.rejects(fs.access(noOutput));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
