import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
const call = (cwd, ...args) => spawnSync(process.execPath, [cli, 'test-report', ...args], { cwd, encoding: 'utf8' });
const block = /<script id="report-data" type="application\/json">(.*?)<\/script>/s;
const reportArgs = kind => ['--kind', kind, '--data', 'cases.json', '--out', 'report.html'];

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-test-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    read: name => readFile(path.join(root, name), 'utf8'),
    write: (name, value) => writeFile(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value)),
  };
}

test('renders each report kind outside the repository without changing the source JSON', async t => {
  const f = await fixture(t);
  const examples = [
    ['unit', '单元测试报告', { input: '0 × 3000', expected: '空矩形' }],
    ['component', '组件测试报告', { component: 'Tabs', action: '选择第一项' }],
    ['api', '接口／集成测试报告', { request: 'GET /releases/latest', response: 'HTTP 200' }],
    ['ui', 'UI／端到端测试报告', { steps: [{ action: '打开相机', expected: '显示预览' }] }],
  ];
  for (const [kind, title, fields] of examples) {
    const data = { project: '</script><img src=x>', environment: '远程设备云', cases: [{ id: 'case-1', title: '用例', ...fields }] };
    await f.write('cases.json', data);
    const result = call(f.root, 'render', ...reportArgs(kind));
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).counts.pending, 1);
    const html = await f.read('report.html');
    assert.match(html, new RegExp(title));
    assert.match(html, /src="data:image\/webp;base64,[A-Za-z0-9+/=]+"/);
    assert.match(html, /<p>暂无用例<\/p>/);
    assert.match(html, /pending:'待测试'/);
    assert.ok(!html.includes('<img src=x>'));
    assert.deepEqual(JSON.parse(html.match(block)[1]), data);
    assert.equal(await f.read('cases.json'), JSON.stringify(data));
  }
});

test('records failure and retest, preserves history, and deduplicates retries', async t => {
  const f = await fixture(t);
  await f.write('cases.json', { project: '官网', cases: [{ id: 'case-1', title: '安装包' }] });
  const invoke = () => call(f.root, 'record', ...reportArgs('unit'), '--result', 'result.json');
  await f.write('result.json', { caseId: 'case-1', runId: '1', status: 'failed', reason: '空条目' });
  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).counts.failed, 1);
  await f.write('result.json', { caseId: 'case-1', runId: '2', status: 'passed' });
  const second = invoke();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).counts.passed, 1);
  const retry = invoke();
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(retry.stdout).appended, false);
  const data = JSON.parse(await f.read('cases.json'));
  assert.deepEqual(data.cases[0].runs.map(run => run.status), ['failed', 'passed']);
  assert.equal(data.cases[0].runs[0].reason, '空条目');
  assert.deepEqual(JSON.parse((await f.read('report.html')).match(block)[1]), data);
  await f.write('result.json', { caseId: 'case-1', runId: '2', status: 'skipped' });
  assert.match(invoke().stderr, /already has different results/);
});

test('rejects incompatible fields, invalid results, and unmanaged HTML before writing', async t => {
  const f = await fixture(t);
  const data = { project: '官网', cases: [{ id: 'case-1', title: '安装包', request: 'GET /latest' }] };
  await f.write('cases.json', data);
  assert.match(call(f.root, 'render', ...reportArgs('unit')).stderr, /does not belong/);
  await f.write('result.json', { caseId: 'case-1', runId: '1', status: 'failed' });
  const record = () => call(f.root, 'record', ...reportArgs('api'), '--result', 'result.json');
  assert.match(record().stderr, /reason must be a nonempty string/);
  await f.write('result.json', { caseId: 'case-1', runId: '1', status: 'passed' });
  await f.write('report.html', '<html>existing template</html>');
  assert.match(record().stderr, /Refusing to overwrite/);
  assert.equal(await f.read('report.html'), '<html>existing template</html>');
  assert.equal(await f.read('cases.json'), JSON.stringify(data));
});

test('keeps each execution environment and preserves inherited metadata across retries', async t => {
  const f = await fixture(t);
  const simulator = { deviceType: '模拟器', deviceModel: 'iPhone 17 Pro', os: 'iOS', osVersion: '26.5' };
  const device = { deviceType: '实体手机', deviceModel: 'Pixel 9', os: 'Android', location: '设备云' };
  await f.write('cases.json', { project: '应用', environment: simulator, version: '1.2.3', command: 'run tests', cases: [{ id: 'case-1', title: '打开预览' }] });
  const invoke = () => call(f.root, 'record', ...reportArgs('unit'), '--result', 'result.json');
  await f.write('result.json', { caseId: 'case-1', runId: 'simulator', status: 'passed', executedAt: '2026-11-18T09:00:00+08:00', durationMs: 0 });
  const first = invoke();
  assert.equal(first.status, 0, first.stderr);
  const before = JSON.parse(await f.read('cases.json'));
  assert.deepEqual(before.cases[0].runs[0].environment, simulator);
  assert.equal(before.cases[0].runs[0].version, '1.2.3');
  assert.equal(before.cases[0].runs[0].durationMs, 0);
  await f.write('cases.json', { ...before, environment: 'CI', version: '1.2.4' });
  const retried = invoke();
  assert.equal(retried.status, 0, retried.stderr);
  assert.equal(JSON.parse(retried.stdout).appended, false);
  await f.write('result.json', { caseId: 'case-1', runId: 'device', status: 'passed', environment: device });
  const second = invoke();
  assert.equal(second.status, 0, second.stderr);
  const after = JSON.parse(await f.read('cases.json'));
  assert.deepEqual(after.cases[0].runs.map(run => run.environment), [simulator, device]);
  assert.deepEqual(after.cases[0].runs.map(run => run.version), ['1.2.3', '1.2.4']);
  assert.deepEqual(JSON.parse((await f.read('report.html')).match(block)[1]), after);
  await f.write('result.json', { caseId: 'case-1', runId: 'device', status: 'passed', environment: { ...device, deviceModel: 9 } });
  assert.match(invoke().stderr, /environment.deviceModel must be a string/);
});
