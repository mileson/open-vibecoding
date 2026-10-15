import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { checkedRect, mapViewRect, resolveAnnotations, visualGrid, imageAnnotate } from '../src/visual-assistance.js';
import { setupOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { installedSkillPath } from '../src/skill-presentation.js';

const CLI = new URL('../bin/open-vibecoding.js', import.meta.url).pathname;
const image = { width: 800, height: 600, sha256: 'synthetic-source-binding' };
const plan = () => ({ source: image, protectedRegions: [[140, 140, 140, 20]],
  targets: [{ id: 'download', rect: [120, 120, 200, 60], label: '点击下载' }] });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-visual-assistance-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'source.png');
  await sharp({ create: { width: 800, height: 600, channels: 4, background: '#f0f3f9' } }).png().toFile(source);
  const bytes = await fs.readFile(source);
  return { dir, source, bytes, binding: { width: 800, height: 600, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
}

test('coordinate mapping accounts for both crop origin and display scale without snapping', () => {
  assert.deepEqual(mapViewRect([50, 40, 100, 30], { width: 300, height: 200, crop: [100, 200, 600, 400] }, { width: 1200, height: 900 }), [200, 280, 200, 60]);
  assert.deepEqual(mapViewRect([0.5, 1, 10, 10], { width: 400, height: 300 }, image), [1, 2, 20, 20]);
  assert.throws(() => mapViewRect([1, 1, 10, 10], { width: 100, height: 100 }, image), /aspect ratio/);
  for (const rect of [[-1, 0, 1, 1], [0, 0, 0, 1], [790, 0, 20, 10], [NaN, 0, 10, 10]]) assert.throws(() => checkedRect(rect, 800, 600));
});

test('annotation layout protects text, keeps target fixed and follows semantic numbering', () => {
  const p = plan();
  p.protectedRegions.push([120, 188, 200, 40]); // block the preferred lower label
  const r = resolveAnnotations(p, image);
  assert.deepEqual(r.targets[0].rect, p.targets[0].rect);
  assert.ok(r.targets[0].labelRect[1] < 120);
  assert.equal(r.targets[0].text, '点击下载');
  const q = plan();
  q.targets = ['sequence', 'sequence', 'alternative', 'alternative'].map((kind, i) => ({ id: `t${i}`, rect: [30 + i * 190, 120, 130, 60], label: '选择', kind }));
  q.protectedRegions = [];
  assert.deepEqual(resolveAnnotations(q, image).targets.map(t => t.text), ['1. 选择', '2. 选择', 'A. 选择', 'B. 选择']);
});

test('stale bindings, clipped frames and unsafe label placements are rejected', () => {
  const stale = plan(); stale.source = { ...image, sha256: 'different-image' };
  assert.throws(() => resolveAnnotations(stale, image), /dimensions\/hash/);
  assert.throws(() => resolveAnnotations({ ...plan(), view: { width: 400, height: 300 } }, image), /source pixels/);
  const p = plan(); p.targets[0].rect[0] = 0;
  assert.throws(() => resolveAnnotations(p, image), /Frame clips/);
  const q = plan(); q.targets[0].labelRect = [130, 135, 150, 40];
  assert.throws(() => resolveAnnotations(q, image), /layout_collision/);
  const crossing = plan(); crossing.protectedRegions = [[119, 130, 5, 20]];
  assert.throws(() => resolveAnnotations(crossing, image), /protected content/);
  const noSpace = plan(); noSpace.protectedRegions = [[0, 0, 800, 600]];
  assert.throws(() => resolveAnnotations(noSpace, image));
});

test('grid and annotation write real PNGs, preserve originals and keep untouched pixels', async t => {
  const f = await fixture(t);
  const grid = await visualGrid({ source: f.source, out: path.join(f.dir, 'grid.png'), step: 100 });
  assert.deepEqual(grid.source, f.binding);
  assert.equal(grid.reviewStatus, 'awaiting_visual_review');
  const p = { ...plan(), source: f.binding };
  const result = await imageAnnotate({ source: f.source, out: path.join(f.dir, 'annotated.png'), plan: p });
  assert.equal(result.reviewRequired, true);
  assert.deepEqual(await fs.readFile(f.source), f.bytes);
  const before = await sharp(f.bytes).ensureAlpha().raw().toBuffer();
  const after = await sharp(result.output).ensureAlpha().raw().toBuffer();
  const lastPixel = (800 * 599 + 799) * 4;
  assert.deepEqual(after.subarray(lastPixel, lastPixel + 4), before.subarray(lastPixel, lastPixel + 4));
  const allowed = [result.resolvedPlan.targets[0].rect, result.resolvedPlan.targets[0].labelRect];
  for (let y = 0; y < 600; y++) for (let x = 0; x < 800; x++) {
    if (allowed.some(([rx, ry, rw, rh]) => x >= rx - 3 && y >= ry - 3 && x <= rx + rw + 3 && y <= ry + rh + 3)) continue;
    const i = (y * 800 + x) * 4;
    assert.ok(after[i] === before[i] && after[i + 1] === before[i + 1] && after[i + 2] === before[i + 2] && after[i + 3] === before[i + 3], `Unexpected change outside annotation at ${x},${y}`);
  }
  assert.notDeepEqual(after, before);
  const meta = await sharp(result.output).metadata();
  assert.equal(meta.width, 800); assert.equal(meta.height, 600); assert.equal(meta.format, 'png');
  assert.equal(meta.exif, undefined);
  await assert.rejects(imageAnnotate({ source: f.source, out: result.output, plan: p }), /EEXIST/);
  await assert.rejects(visualGrid({ source: f.source, out: f.source }), /distinct/);
  const link = path.join(f.dir, 'link.png'); await fs.symlink(f.source, link);
  await assert.rejects(visualGrid({ source: f.source, out: link }), /EEXIST/);
  await assert.rejects(visualGrid({ source: f.source, out: path.join(f.dir, 'invalid.png'), step: 0 }), /step/);
});

test('CLI reads plans, exposes source-pixel mapping and reports failures without output', async t => {
  const f = await fixture(t);
  const mapping = path.join(f.dir, 'mapping.json');
  await fs.writeFile(mapping, JSON.stringify({ source: f.binding, view: { width: 400, height: 300 }, targets: [{ id: 'a', rect: [60, 60, 100, 30] }] }));
  const call = args => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
  const g = call(['visual-grid', '--source', f.source, '--out', path.join(f.dir, 'g.png'), '--step', '50', '--json-file', mapping]);
  assert.equal(g.status, 0, g.stderr);
  assert.deepEqual(JSON.parse(g.stdout).mappedTargets[0].rect, [120, 120, 200, 60]);
  const file = path.join(f.dir, 'plan.json'); await fs.writeFile(file, JSON.stringify({ ...plan(), source: f.binding }));
  const a = call(['image-annotate', '--source', f.source, '--out', path.join(f.dir, 'a.png'), '--json-file', file]);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(JSON.parse(a.stdout).resolvedPlan.targets[0].text, '点击下载');
  const badOut = path.join(f.dir, 'bad.png');
  const bad = call(['image-annotate', '--source', f.source, '--out', badOut]);
  assert.notEqual(bad.status, 0);
  await assert.rejects(fs.access(badOut));
});

test('visual helpers install internally and remain discoverable from their consumers', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  const result = await setupOpenPrdAgentIntegration(f.dir, { tools: 'codex,claude,cursor', enableUserCodexConfig: false, openprdHome: path.join(f.dir, 'registry') });
  assert.equal(result.ok, true);
  const catalog = buildCapabilityCatalog();
  for (const id of ['visual-localization', 'image-annotation', 'visual-evidence-delivery']) {
    const skill = `open-vibecoding-${id}`;
    assert.equal(getCapability(catalog, id).userFacing, false);
    const source = await fs.readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
    const installed = await fs.readFile(path.join(f.dir, installedSkillPath(skill)), 'utf8');
    assert.ok(installed.includes(source.replace(/^---\n[\s\S]*?\n---\n/, '').trim()));
    assert.ok(!(await fs.readdir(path.join(f.dir, '.codex/skills'))).includes(skill));
    await fs.access(path.join(f.dir, '.claude/skills', skill, 'SKILL.md'));
  }
  assert.ok(getCapability(catalog, 'visual-implementation').uses.includes('visual-localization'));
  assert.ok(getCapability(catalog, 'acceptance-verification').uses.includes('image-annotation'));
  for (const id of ['interaction-review', 'visual-implementation', 'feature-implementation', 'acceptance-verification', 'ui-interaction-review', 'ui-review-and-repair']) {
    assert.ok(getCapability(catalog, id).uses.includes('visual-evidence-delivery'));
  }
  assert.ok((await fs.readFile(path.join(f.dir, 'AGENTS.md'), 'utf8')).includes(installedSkillPath('open-vibecoding-visual-evidence-delivery')));
});
