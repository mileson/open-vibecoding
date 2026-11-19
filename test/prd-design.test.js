import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderPrd } from '../src/prd-html.js';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
const firstPhoto = JSON.parse(await readFile(new URL('./fixtures/prd-camera-first-photo.json', import.meta.url), 'utf8'));
const initialDesign = {
  id: 'CAM-UI-01', title: '首页拍照入口', status: 'pending-design',
  requirementIds: ['CAM-01', 'CAM-02'], scenarioIds: ['CAM-S01'],
};

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-prd-design-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = (name) => path.join(root, name);
  return {
    file,
    call: (...args) => spawnSync(process.execPath, [cli, 'prd', ...args], { cwd: root, encoding: 'utf8' }),
    json: (name, data) => writeFile(file(name), JSON.stringify(data)),
  };
}

function success(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('renders pending designs with bidirectional links and omits an empty design section', () => {
  assert.doesNotMatch(renderPrd(firstPhoto), /id="interaction-design"|href="#interaction-design"/);
  assert.doesNotMatch(renderPrd({ ...firstPhoto, designs: [] }), /id="interaction-design"|href="#interaction-design"/);
  const html = renderPrd({
    ...firstPhoto,
    designs: [initialDesign, { id: 'CAM-UI-02', title: '权限提示', status: 'pending-review', requirementIds: ['CAM-02'] }],
  });
  assert.match(html, /href="#flow"[^]*href="#interaction-design">交互设计[^]*href="#requirements"/);
  assert.match(html, /id="flow"[^]*id="interaction-design"[^]*id="requirements"/);
  const design = html.split('<section id="interaction-design"')[1].split('</section>')[0];
  assert.match(design, /CAM-UI-01 · 待设计[^]*href="#requirement-CAM-01">首页拍照入口<[^]*href="#requirement-CAM-02">权限处理<[^]*href="#scenario-CAM-S01">首次进入首页，想快速拍一张</);
  assert.match(design, /CAM-UI-02 · 待确认/);
  assert.doesNotMatch(design, /<img/);
  const requirements = html.split('<section id="requirements"')[1].split('</section>')[0];
  const permission = requirements.split('<tr id="requirement-CAM-02">')[1].split('</tr>')[0];
  assert.match(permission, /href="#design-CAM-UI-01">首页拍照入口<[^]*href="#design-CAM-UI-02">权限提示</);
});

test('validates a design-first manifest and merges selected images in batches into new files', async (t) => {
  const { file, call, json } = await workspace(t);
  await mkdir(file('product/assets'), { recursive: true });
  await mkdir(file('design-team/assets'), { recursive: true });
  const source = sharp({ create: { width: 4, height: 6, channels: 3, background: '#336699' } });
  await source.clone().png().toFile(file('product/assets/old.png'));
  await source.clone().jpeg().toFile(file('design-team/assets/home.jpg'));
  await source.clone().webp().toFile(file('design-team/assets/permission.webp'));
  const original = { ...firstPhoto, designs: [{
    ...initialDesign,
    description: '保留这条交互说明',
    image: { path: 'assets/old.png', alt: '旧候选' },
  }, { id: 'CAM-UI-KEEP', title: '已有预览', status: 'selected', image: { path: 'assets/old.png', alt: '先前已选' } }] };
  await json('product/prd.json', original);

  const independent = {
    id: 'CAM-UI-02', title: '权限提示', status: 'pending-review',
    requirementIds: ['CAM-02'], scenarioIds: ['CAM-S02'],
    image: { path: 'assets/permission.webp', alt: '前往设置和返回首页' },
  };
  await json('design-team/design-first.json', { designs: [independent] });
  const checked = success(call('design', 'validate', '--design', 'design-team/design-first.json'));
  assert.equal(checked.referencesChecked, false);
  assert.deepEqual(checked.designs, [{
    id: independent.id, title: independent.title, status: independent.status, requirementIds: independent.requirementIds,
    scenarioIds: independent.scenarioIds, hasImage: true,
  }]);

  await json('design-team/batch.json', { designs: [
    { id: initialDesign.id, status: 'selected', image: { path: 'assets/home.jpg', alt: '入口 <确认>' } },
    independent,
  ] });
  const args = ['--design', 'design-team/batch.json', '--data', 'product/prd.json'];
  const validated = success(call('design', 'validate', ...args));
  assert.equal(validated.referencesChecked, true);
  success(call('design', 'merge', ...args, '--out', 'deliverables/first.json'));
  const written = JSON.parse(await readFile(file('deliverables/first.json'), 'utf8'));
  assert.equal(written.designs.length, 3);
  assert.equal(written.designs[0].description, '保留这条交互说明');
  assert.deepEqual(written.designs[0].requirementIds, initialDesign.requirementIds);
  assert.equal(written.designs[0].image.path, '../design-team/assets/home.jpg');
  assert.equal(written.designs[1].image.path, '../product/assets/old.png');
  assert.deepEqual(written.requirements, original.requirements);
  assert.deepEqual(JSON.parse(await readFile(file('product/prd.json'), 'utf8')), original);

  await json('design-team/next.json', { designs: [{ id: independent.id, status: 'selected' }] });
  const next = ['design', 'merge', '--data', 'deliverables/first.json', '--design', 'design-team/next.json'];
  success(call(...next, '--out', 'deliverables/final/data.json'));
  const refused = call(...next, '--out', 'deliverables/first.json');
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stderr).error.message, /输出已存在/);
  assert.deepEqual(JSON.parse(await readFile(file('deliverables/first.json'), 'utf8')), written);
  success(call('render', '--data', 'deliverables/final/data.json', '--out', 'reports/prd.html'));
  const rendered = await readFile(file('reports/prd.html'), 'utf8');
  for (const type of ['png', 'jpeg', 'webp']) {
    const encoded = rendered.match(new RegExp(`src="data:image/${type};base64,([^"]+)"`))?.[1];
    assert.ok(encoded, type);
    assert.equal((await sharp(Buffer.from(encoded, 'base64')).metadata()).format, type);
  }
  assert.match(rendered, /alt="入口 &lt;确认&gt;"/);
  assert.doesNotMatch(rendered, /已选稿/);
  assert.match(rendered, /class="design-preview-icon"[^]*<dt>关联需求<\/dt><dd>[^]*<dt>对应场景<\/dt><dd>/);
  assert.doesNotMatch(rendered, /assets\/|href="(?!#)|<script\b/);
});

test('reports duplicate IDs, invalid references, and unusable images without writing an output', async (t) => {
  const { file, call, json } = await workspace(t);
  await json('prd.json', firstPhoto);
  await writeFile(file('invalid.png'), 'This is not a PNG');
  const cases = [
    [[initialDesign, initialDesign], /designs\[1\]\.id.*重复/],
    [[{ ...initialDesign, requirementIds: ['MISSING'] }], /designs\[0\]\.requirementIds\[0\].*MISSING/],
    [[{ ...initialDesign, scenarioIds: ['MISSING'] }], /designs\[0\]\.scenarioIds\[0\].*MISSING/],
    [[{ ...initialDesign, status: 'selected' }], /designs\[0\]\.image.*已选稿/],
    [[{ ...initialDesign, image: { path: 'missing.png', alt: '入口' } }], /designs\[0\]\.image\.path.*missing\.png/],
    [[{ ...initialDesign, image: { path: 'invalid.png', alt: '入口' } }], /designs\[0\]\.image\.path.*格式无效/],
  ];
  for (const [designs, message] of cases) {
    await json('designs.json', { designs });
    const result = call('design', 'merge', '--data', 'prd.json', '--design', 'designs.json', '--out', 'new.json');
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).error.message, message);
    await assert.rejects(readFile(file('new.json')), { code: 'ENOENT' });
  }
});
