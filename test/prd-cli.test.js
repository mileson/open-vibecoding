import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renderPrd } from '../src/prd-html.js';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
const call = (cwd, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('advertises PRD CLI and renders the exported first-photo JSON offline', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-prd-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  assert.match(call(cwd, '--help').stdout, /open-vibecoding prd <template\|render>/);
  assert.match(call(cwd, 'prd', 'render', '--help').stdout, /--data <requirements.json>/);

  const exported = call(cwd, 'prd', 'template', '--out', 'drafts/input.json');
  assert.equal(exported.status, 0, exported.stderr);
  const root = await realpath(cwd);
  const input = path.join(root, 'drafts/input.json');
  assert.deepEqual(JSON.parse(exported.stdout), { ok: true, action: 'template', format: 'json', out: input });
  const data = JSON.parse(await readFile(input, 'utf8'));
  assert.equal(data.product, '轻拍相机');
  assert.deepEqual(data.personas.map(({ type }) => type), ['ToC']);

  const rendered = call(cwd, 'prd', 'render', '--data', input, '--out', 'out/prd.html');
  assert.equal(rendered.status, 0, rendered.stderr);
  const output = path.join(root, 'out/prd.html');
  assert.deepEqual(JSON.parse(rendered.stdout), { ok: true, action: 'render', format: 'html', out: output });
  const html = await readFile(output, 'utf8');
  assert.equal(html, renderPrd(data));
  for (const heading of ['业务目标与指标', '异常处理', '验收附录', '性能目标', '修订人', '待确认']) {
    assert.ok(html.includes(heading), heading);
  }
  assert.match(html, /capture_completed/);
  assert.match(html, /目标用户与使用场景/);
  assert.match(html, /href="#scenario-CAM-S02"/);
  assert.doesNotMatch(html, /<script\b|\bsrc\s*=|href="(?!#)/);
});

test('supports an exported HTML template and refuses existing outputs', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-prd-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const prd = (...args) => call(cwd, 'prd', ...args);
  assert.equal(prd('template', '--out', 'template.html').status, 0);
  assert.equal(prd('template', '--out', 'requirements.json').status, 0);

  const templatePath = path.join(cwd, 'template.html');
  const inputPath = path.join(cwd, 'requirements.json');
  const outputPath = path.join(cwd, 'note.html');
  const custom = (await readFile(templatePath, 'utf8')).replace('<main>', '<main data-layout="custom">');
  await writeFile(templatePath, custom);
  await writeFile(outputPath, '<p>Existing user file</p>');
  assert.equal(prd('render', '--data', inputPath, '--template', templatePath, '--out', 'prd.html').status, 0);
  assert.match(await readFile(path.join(cwd, 'prd.html'), 'utf8'), /data-layout="custom"/);

  for (const command of [
    ['template', '--out', templatePath],
    ['template', '--out', inputPath],
    ['render', '--data', inputPath, '--out', outputPath],
    ['render', '--data', inputPath, '--out', 'prd.html'],
  ]) {
    const result = prd(...command);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error.message, /输出已存在/);
  }
  assert.equal(await readFile(outputPath, 'utf8'), '<p>Existing user file</p>');
  assert.equal(await readFile(templatePath, 'utf8'), custom);
});

test('reports input paths and exact invalid fields before creating an output', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-prd-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const prd = (...args) => call(cwd, 'prd', ...args);
  assert.equal(prd('template', '--out', 'requirements.json').status, 0);
  const input = path.join(cwd, 'requirements.json');
  const output = path.join(cwd, 'out.html');
  const data = JSON.parse(await readFile(input, 'utf8'));
  data.scenarios[0].personaId = 'MISSING';
  await writeFile(input, JSON.stringify(data));
  const invalidPersona = prd('render', '--data', input, '--out', output);
  assert.equal(invalidPersona.status, 1);
  assert.match(JSON.parse(invalidPersona.stderr).error.message, /requirements\.json.*scenarios\[0\]\.personaId.*MISSING/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });

  data.scenarios[0].personaId = 'CAM-USER-01';
  data.exceptions[0].requirementIds = ['MISSING'];
  await writeFile(input, JSON.stringify(data));
  const invalidField = prd('render', '--data', input, '--out', output);
  assert.equal(invalidField.status, 1);
  assert.match(JSON.parse(invalidField.stderr).error.message, /requirements\.json.*exceptions\[0\]\.requirementIds.*MISSING/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });

  await writeFile(input, '{');
  const invalidJson = prd('render', '--data', input, '--out', output);
  assert.equal(invalidJson.status, 1);
  assert.match(JSON.parse(invalidJson.stderr).error.message, /JSON 解析失败.*requirements\.json/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });

  data.exceptions[0].requirementIds = ['CAM-03'];
  await writeFile(input, JSON.stringify(data));
  await writeFile(path.join(cwd, 'broken.html'), '<main>{{PRD_CONTENT}}</main>');
  const invalidTemplate = prd('render', '--data', input, '--template', 'broken.html', '--out', output);
  assert.equal(invalidTemplate.status, 1);
  assert.match(JSON.parse(invalidTemplate.stderr).error.message, /broken\.html.*\{\{PRD_TITLE\}\}/);
  await assert.rejects(readFile(output), { code: 'ENOENT' });
});
