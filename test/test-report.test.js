import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

test('imports reporter observations only by stable identity, keeps failures and deduplicates a retry', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'selection.test.js');
  await f.write('selection.test.js', '');
  const entry = (name, status, fields) => ({ fullName: name, status, ...fields });
  const original = {
    success: false,
    testResults: [{
      name: file,
      assertionResults: [
        entry('allows ninth', 'passed'),
        entry('rejects tenth', 'failed', {
          failureMessages: ['Expected: false\nReceived: true\n    at ' + file + ':5:25'],
        }),
        entry('permissions', 'pending'),
        entry('omitted from the plan', 'passed'),
        entry('ambiguous', 'passed'),
        entry('ambiguous', 'failed'),
        entry('future runner status', 'future-state'),
      ],
    }],
  };
  await f.write('cases.json', {
    project: '选图',
    cases: [
      { id: 'ninth', title: '第 9 张', testIds: { jest: 'selection.test.js::allows ninth' } },
      { id: 'selection.test.js::rejects tenth', title: '第 10 张' },
      { id: 'selection.test.js::permissions', title: '权限' },
      { id: 'selection.test.js::ambiguous', title: '重名用例' },
      { id: 'selection.test.js::future runner status', title: '未识别状态' },
    ],
  });
  await f.write('native.json', original);
  await f.write('metadata.json', { exitCode: 1, command: 'jest --json', version: '2.1', environment: 'CI' });
  await f.write('coverage.json', { total: { lines: { covered: 7, total: 10 } } });
  const invoke = id => call(f.root, 'import', ...reportArgs('unit'), '--format', 'jest',
    '--result', 'native.json', '--meta', 'metadata.json', '--coverage', 'coverage.json', '--run-id', id);
  const first = invoke('initial');
  assert.equal(first.status, 0, first.stderr);
  const imported = JSON.parse(first.stdout);
  assert.deepEqual(imported.counts, {
    total: 5, passed: 1, failed: 1, pending: 1, skipped: 1, cancelled: 0, blocked: 0, unknown: 1,
  });
  assert.deepEqual(imported.imported.unmatched.map(item => item.match), ['unmapped', 'ambiguous', 'ambiguous']);
  const retry = invoke('initial');
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(JSON.parse(retry.stdout).appended, false);

  const firstData = JSON.parse(await f.read('cases.json'));
  assert.deepEqual(firstData.imports[0].coverage.lines, { covered: 7, total: 10 });
  const failure = firstData.cases[1].runs[0];
  assert.deepEqual([failure.location, failure.actual, failure.matcherExpected, failure.exitCode],
    ['selection.test.js:5:25', 'true', 'false', 1]);

  await f.write('native.json', {
    success: true,
    testResults: [{ name: file, assertionResults: [entry('rejects tenth', 'passed')] }],
  });
  await f.write('metadata.json', { exitCode: 0, command: 'jest --json' });
  assert.match(invoke('initial').stderr, /already has different imported results/);
  const retest = invoke('retest');
  assert.equal(retest.status, 0, retest.stderr);
  assert.equal(JSON.parse(retest.stdout).counts.failed, 0);
  assert.deepEqual(JSON.parse(await f.read('cases.json')).cases[1].runs.map(run => run.status), ['failed', 'passed']);
});

test('keeps missing case observations pending when an imported run is cancelled or unsupported', async t => {
  const f = await fixture(t);
  await f.write('cases.json', { project: '选图', cases: [{ id: 'remaining', title: '取消后补选' }] });
  await f.write('native.json', { testResults: [], wasInterrupted: true, success: false });
  const invoke = id => call(f.root, 'import', ...reportArgs('unit'), '--format', 'vitest',
    '--result', 'native.json', '--meta', 'metadata.json', '--run-id', id);
  await f.write('metadata.json', { exitCode: 130 });
  let response = invoke('interrupted');
  assert.equal(response.status, 0, response.stderr);
  let result = JSON.parse(response.stdout);
  assert.equal(result.imported.status, 'cancelled');
  assert.equal(result.counts.pending, 1);

  await f.write('native.json', { testResults: [] });
  await f.write('metadata.json', { status: 'unsupported', reason: '该环境不支持测试目标' });
  response = invoke('unsupported');
  assert.equal(response.status, 0, response.stderr);
  result = JSON.parse(response.stdout);
  assert.equal(result.imported.status, 'unsupported');
  assert.equal(result.counts.pending, 1);
});

test('executes planned groups with bounded concurrency and does not reuse missing results', async t => {
  const f = await fixture(t);
  const groups = [
    { id: 'alpha', resources: ['shared'] },
    { id: 'beta' },
    { id: 'gamma', resources: ['shared'] },
    { id: 'bad' },
    { id: 'dependent', dependsOn: ['bad'] },
  ].map(group => ({
    ...group, title: group.id, rules: [{ id: 'rule-' + group.id, title: '规则 ' + group.id }],
    runner: { format: 'jest', argv: [process.execPath, 'runner.cjs', group.id, '{result}'] },
  }));
  const cases = groups.map(({ id }) => ({
    id, ruleId: 'rule-' + id, title: id, input: '准备', action: '执行', expected: '预期', assertion: '断言',
    testIds: { jest: 'fixture.test.js::' + id },
  }));
  cases.at(-1).runs = [{ runId: 'prior', status: 'passed' }];
  await f.write('cases.json', { project: '分组单测', testPlan: { groups }, cases });
  await f.write('runner.cjs', `
    const fs = require('node:fs');
    const path = require('node:path');
    const [id, report] = process.argv.slice(2);
    const dir = path.dirname(report);
    const start = Date.now();
    fs.writeFileSync(path.join(dir, id + '.start'), String(start));
    if (id === 'bad') process.exit(2);
    async function run() {
      if (id === 'alpha' || id === 'beta') {
        const peer = path.join(dir, (id === 'alpha' ? 'beta' : 'alpha') + '.start');
        for (let tries = 0; !fs.existsSync(peer); tries++) {
          if (tries === 100) throw new Error('Independent groups did not overlap');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      fs.writeFileSync(report, JSON.stringify({ testResults: [{ name: 'fixture.test.js', assertionResults:
        [{ fullName: id, status: 'passed' }] }] }));
      fs.writeFileSync(path.join(dir, id + '.end'), String(Date.now()));
    }
    run().catch(error => { console.error(error); process.exitCode = 2; });
  `);
  const preview = call(f.root, 'plan', '--data', 'cases.json');
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(JSON.parse(preview.stdout).groups.length, 5);
  const result = call(f.root, 'run', '--data', 'cases.json', '--out', 'report.html', '--jobs', '2');
  assert.equal(result.status, 1, result.stderr);
  const info = JSON.parse(result.stdout);
  assert.equal(info.counts.passed, 3);
  assert.equal(info.counts.blocked, 2);
  assert.deepEqual(info.incomplete.sort(), ['bad', 'dependent']);
  const time = async file => Number(await readFile(path.join(info.artifactDir, file), 'utf8'));
  assert.ok(await time('gamma.start') >= await time('alpha.end'));
  const data = JSON.parse(await f.read('cases.json'));
  assert.deepEqual(data.cases.at(-1).runs.map(run => run.status), ['passed', 'blocked']);
  await assert.rejects(readFile(path.join(info.artifactDir, 'dependent.start')), { code: 'ENOENT' });
  assert.equal(info.batches.length, 5);
  const only = call(f.root, 'run', '--data', 'cases.json', '--out', 'report.html', '--group', 'gamma');
  assert.equal(only.status, 0, only.stderr);
  assert.equal(JSON.parse(only.stdout).batches.length, 1);
});

test('checks plan dependencies, assertion details and evidence before executing commands', async t => {
  const f = await fixture(t);
  const group = {
    id: 'a', title: 'A', dependsOn: ['a'], rules: [{ id: 'rule', title: '规则' }],
    runner: { format: 'jest', argv: ['unneeded-executable', '{result}'] },
  };
  const data = { project: '单测', testPlan: { groups: [group] }, cases: [] };
  const plan = async pattern => {
    await f.write('cases.json', data);
    const outcome = call(f.root, 'plan', '--data', 'cases.json');
    assert.equal(outcome.status, 1);
    assert.match(outcome.stderr, pattern);
  };
  await plan(/Circular test group dependency/);
  group.dependsOn = [];
  data.cases.push({ id: 'case', title: '用例', ruleId: 'rule', input: '已准备', action: '执行', expected: '有结果' });
  await plan(/case.assertion/);
  data.cases[0].assertion = '有断言';
  data.testPlan.findings = [{ ruleId: 'rule', kind: 'assertion', detail: '缺少关键断言' }];
  await plan(/finding.evidence/);
});

test('E2E execution records assertion failure, retry recovery, environment failure and selection', async t => {
  const f = await fixture(t);
  const entry = { id: 'ids', title: '<照片身份>', expected: ['P01'] };
  const testResult = (status, actual) => ({
    status, duration: 10, attachments: [{
      name: 'ovc-observation',
      body: Buffer.from(JSON.stringify({ actual })).toString('base64'),
    }],
    errors: status === 'failed' ? [{ message: 'Error: expect(received).toEqual(expected)' }] : [],
  });
  const report = retries => ({
    suites: [{ specs: [{ title: 'ids', tests: [{ expectedStatus: 'passed', results: retries }] }] }],
  });
  await f.write('failed.json', report([testResult('failed', ['P10'])]));
  await f.write('retry.json', report([testResult('failed', ['P10']), testResult('passed', ['P01'])]));
  await f.write('success.xml', '<testsuites><testsuite><testcase name="ids" time="0.1"/></testsuite></testsuites>');
  await f.write('native-observation.json', { cases: { ids: { actual: ['P01'] } }, environment: { osVersion: 'test' } });
  await f.write('runner.mjs', `
    import { copyFile } from 'node:fs/promises';
    const [source, target, observations] = process.argv.slice(2);
    await copyFile(source, target);
    if (observations) await copyFile('native-observation.json', observations);
    if (source === 'failed.json') process.exitCode = 1;
  `);
  const run = (id, source, engine = 'playwright') => ({
    id, label: id, engine, cases: [entry],
    environment: { target: '选图', deviceType: engine === 'maestro' ? '模拟器' : '电脑' },
    argv: [process.execPath, 'runner.mjs', source, '{result}', ...(engine === 'maestro' ? ['{observations}'] : [])],
  });
  await f.write('manifest.json', { schemaVersion: 1, project: '选图', runs: [
    run('failed', 'failed.json'), run('retry', 'retry.json'), run('environment', 'missing.json'),
    run('not-selected', 'missing.json'), run('native', 'success.xml', 'maestro'),
  ] });
  const args = ['e2e', '--data', 'manifest.json', '--out', 'e2e-report'];
  const result = call(f.root, ...args, '--run', 'failed', '--run', 'retry', '--run', 'environment', '--run', 'native');
  assert.equal(result.status, 1, result.stderr);
  const model = JSON.parse(await f.read('e2e-report/results.json'));
  assert.deepEqual(model.runs.map(item => item.status),
    ['assertion_failed', 'passed_on_retry', 'environment_error', 'not_run', 'passed']);
  assert.deepEqual(model.runs[0].cases[0].actual, ['P10']);
  assert.deepEqual(model.runs[1].cases[0].attempts.map(item => item.status), ['assertion_failed', 'passed']);
  assert.deepEqual(model.runs[4].cases[0].actual, ['P01']);
  assert.equal(model.runs[4].environment.osVersion, 'test');
  assert.ok(model.runs[4].evidence.some(file => file.endsWith('maestro.xml')));
  const html = await f.read('e2e-report/index.html');
  assert.match(html, /&lt;照片身份&gt;/);
  assert.match(html, /data-metric="total"><strong>5<\/strong>/);
  assert.match(html, /data-metric="passed"><strong>2<\/strong>/);
  assert.match(html, /data-metric="failed"><strong>1<\/strong>/);
  assert.match(html, /data-metric="error"><strong>1<\/strong>/);
  assert.match(html, /data-metric="pending"><strong>1<\/strong>/);
  assert.match(html, /执行记录（2）/);
  assert.doesNotMatch(html, /执行记录（1）/);
  assert.equal(call(f.root, ...args, '--run', 'retry').status, 0);
  await f.write('e2e-report/setup.log', 'device unavailable');
  const blocked = call(f.root, ...args, '--run', 'retry', '--setup-error', 'Simulator could not boot');
  assert.equal(blocked.status, 1, blocked.stderr);
  const blockedModel = JSON.parse(await f.read('e2e-report/results.json'));
  const blockedRun = blockedModel.runs.find(item => item.id === 'retry');
  assert.deepEqual(blockedRun.evidence, ['setup.log']);
  assert.equal(blockedRun.cases[0].status, 'environment_error');
  assert.equal(blockedRun.cases[0].attempts.length, 0);
});

test('E2E worktree guard rejects the main checkout and a manifest from another checkout', async t => {
  const f = await fixture(t);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: f.root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  const nativeReport = { suites: [{ specs: [{ title: 'sample', tests: [
    { expectedStatus: 'passed', results: [{ status: 'passed', duration: 1 }] },
  ] }] }] };
  await f.write('runner.mjs', `import { writeFileSync } from 'node:fs'; writeFileSync(process.argv[2], ${JSON.stringify(JSON.stringify(nativeReport))});`);
  await f.write('manifest.json', { schemaVersion: 1, project: '隔离测试', runs: [{
    id: 'web', label: 'Web', engine: 'playwright', environment: { target: 'Web', deviceType: '电脑' },
    argv: [process.execPath, 'runner.mjs', '{result}'], cases: [{ id: 'sample', title: '验收项', expected: true }],
  }] });
  git('add', 'manifest.json', 'runner.mjs');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgSign=false', 'commit', '-qm', 'Test fixture');
  git('worktree', 'add', '-q', '--detach', 'linked', 'HEAD');
  const args = ['e2e', '--out', 'e2e-report', '--require-worktree'];
  const main = call(f.root, ...args, '--data', 'manifest.json');
  assert.equal(main.status, 1);
  assert.match(main.stderr, /inside a linked Git worktree/);
  const mixed = call(f.root, ...args, '--root', 'linked', '--data', 'manifest.json');
  assert.equal(mixed.status, 1);
  assert.match(mixed.stderr, /inside the same Git worktree/);
  await assert.rejects(f.read('e2e-report/results.json'), { code: 'ENOENT' });
  const isolated = call(f.root, ...args, '--root', 'linked', '--data', 'linked/manifest.json');
  assert.equal(isolated.status, 0, isolated.stderr);
  assert.equal(JSON.parse(await f.read('e2e-report/results.json')).runs[0].status, 'passed');
});

test('renders a standalone planning checklist and rejects invalid case data without overwriting it', async t => {
  const f = await fixture(t);
  const sample = JSON.parse(await readFile(new URL('../docs/examples/photo-selection-test-cases.json', import.meta.url), 'utf8'));
  sample.summary += ' </script><img src=x>';
  await f.write('cases.json', sample);
  const args = reportArgs('cases');
  const result = call(f.root, 'render', ...args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).appended, false);
  assert.equal(Object.hasOwn(JSON.parse(result.stdout), 'counts'), false);
  const html = await f.read('report.html');
  assert.deepEqual(JSON.parse(html.match(block)[1]), sample);
  assert.equal(await f.read('cases.json'), JSON.stringify(sample));
  assert.doesNotMatch(html, /尚未执行/);
  assert.doesNotMatch(html, /<img src=x>|<script src=|<link rel="stylesheet"/);

  for (const [badInput, message] of [
    [{ ...sample, cases: [] }, /cases must be a nonempty array/],
    [{ ...sample, cases: [sample.cases[0], sample.cases[0]] }, /Duplicate case ID: allow-ninth/],
    [{ ...sample, cases: [{ ...sample.cases[0], layer: 'mobile' }] }, /cases\[0\]\.layer/],
    [{ ...sample, cases: [{ ...sample.cases[0], assertions: [' '] }] }, /cases\[0\]\.assertions\[0\]/],
    [{ ...sample, cases: [{ ...sample.cases[0], runs: [{ status: 'passed' }] }] }, /cases\[0\]\.runs/],
  ]) {
    await f.write('cases.json', badInput);
    const rejected = call(f.root, 'render', ...args);
    assert.equal(rejected.status, 1, rejected.stderr);
    assert.match(JSON.parse(rejected.stderr).error.message, message);
    assert.equal(await f.read('report.html'), html);
  }
  const record = call(f.root, 'record', ...args, '--result', 'results.json');
  assert.equal(record.status, 1);
  assert.match(JSON.parse(record.stderr).error.message, /--kind must be one of unit, component, api, ui/);
});

test('runs registered data preparation before E2E and blocks only affected runs', async t => {
  const f = await fixture(t);
  await f.write('prepare.mjs', `
    import fs from 'node:fs';
    fs.writeFileSync(process.env.OVC_E2E_DATA_DIR + '/seed.json', JSON.stringify({ selected: [] }));
  `);
  await f.write('verify.mjs', `
    import fs from 'node:fs';
    const seed = fs.readFileSync(process.env.OVC_E2E_DATA_DIR + '/seed.json', 'utf8');
    fs.writeFileSync(process.env.OVC_E2E_DATA_OBSERVATIONS, seed);
  `);
  await f.write('bad-prepare.mjs', "console.error('Fixture provider unavailable'); process.exitCode = 7;");
  await f.write('runner.mjs', `
    import fs from 'node:fs';
    fs.readFileSync(process.env.OVC_E2E_DATA_DIR + '/seed.json', 'utf8');
    fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({
      suites: [{ specs: [{title: 'selection', tests: [{expectedStatus: 'passed', results: [{status: 'passed'}]}]}] }]
    }));
  `);
  const preparation = {
    label: '准备空选中状态', prepare: 'prepare.mjs', verify: 'verify.mjs',
    checks: [{ id: 'selected', title: '实际已选照片', expected: [] }],
  };
  const target = id => ({
    id, label: id, engine: 'playwright', environment: { target: '测试', deviceType: '电脑' },
    argv: [process.execPath, 'runner.mjs'], dataPreparation: id,
    cases: [{id: 'selection', title: '选图用例', expected: []}],
  });
  const manifest = {
    schemaVersion: 1, project: '数据准备', dataPreparations: {
      ready: preparation,
      mismatch: { ...preparation, checks: [{...preparation.checks[0], expected: ['P01']}] },
      unavailable: { ...preparation, prepare: 'bad-prepare.mjs' },
    },
    runs: ['ready', 'mismatch', 'unavailable'].map(target),
  };
  await f.write('manifest.json', manifest);
  const args = ['e2e', '--data', 'manifest.json', '--out', 'data-report'];
  const result = call(f.root, ...args);
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).runs.map(run => run.dataPreparationStatus),
    ['passed', 'verify_failed', 'prepare_failed']);
  const { runs: [ready, mismatch, unavailable] } = JSON.parse(await f.read('data-report/results.json'));
  assert.equal(ready.status, 'passed');
  assert.equal(ready.dataPreparation.status, 'passed');
  assert.deepEqual(ready.dataPreparation.checks[0].actual, []);
  assert.equal(mismatch.dataPreparation.status, 'verify_failed');
  assert.deepEqual(mismatch.dataPreparation.checks[0], {
    id: 'selected', title: '实际已选照片', expected: ['P01'], actual: [], status: 'mismatch',
  });
  assert.equal(unavailable.dataPreparation.status, 'prepare_failed');
  assert.match(unavailable.dataPreparation.error, /7/);
  assert.ok(unavailable.dataPreparation.evidence.some(file => file.endsWith('prepare.log')));
  assert.ok(unavailable.dataPreparation.evidence.every(file => !file.endsWith('verify.log')));
  for (const blocked of [mismatch, unavailable]) {
    assert.equal(blocked.status, 'environment_error');
    assert.equal(blocked.cases[0].status, 'not_run');
    assert.deepEqual(blocked.cases[0].attempts, []);
    assert.equal(blocked.evidence.some(file => file.endsWith('playwright.json')), false);
  }
  const html = await f.read('data-report/index.html');
  assert.doesNotMatch(html, /测试数据已核对/);
  assert.match(html, /测试数据校验失败/);
  assert.match(html, /测试数据准备失败/);
  assert.match(html, /未执行的用例/);
  await f.write('manifest.json', {
    ...manifest, dataPreparations: { ...manifest.dataPreparations, ready: { ...preparation, prepare: '../outside.mjs' } },
  });
  const rejected = call(f.root, ...args);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /project-relative/);

  const outside = await fixture(t);
  await outside.write('external.mjs', "throw new Error('external script must never run');");
  await symlink(path.join(outside.root, 'external.mjs'), path.join(f.root, 'escaped.mjs'));
  await f.write('manifest.json', {
    ...manifest, dataPreparations: { ...manifest.dataPreparations, ready: { ...preparation, prepare: 'escaped.mjs' } },
  });
  const escaped = call(f.root, ...args, '--run', 'ready');
  assert.equal(escaped.status, 1, escaped.stderr);
  const escapedRun = JSON.parse(await f.read('data-report/results.json')).runs[0];
  assert.equal(escapedRun.dataPreparation.status, 'prepare_failed');
  assert.match(escapedRun.dataPreparation.error, /项目根目录内/);
});
