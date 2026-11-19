import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { writeCodeQualityReport } from '../src/code-quality-report.js';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
const samplePath = fileURLToPath(new URL('../docs/examples/photo-selection-quality.json', import.meta.url));
const run = promisify(execFile);

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-quality-report-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('the CLI renders identical standalone HTML from the same case and preserves verified and pending Swift results', async t => {
  const dir = await workspace(t);
  const outputs = ['first.html', 'second.html'].map(name => path.join(dir, name));
  for (const out of outputs) {
    const { stdout } = await run(process.execPath, [cli, 'code-quality-report', 'render', '--data', samplePath, '--out', out]);
    assert.deepEqual(JSON.parse(stdout), { action: 'render', ok: true, out });
  }
  const [first, second] = await Promise.all(outputs.map(file => fs.readFile(file, 'utf8')));
  assert.equal(first, second);
  assert.match(first, /<p class="report-kicker">代码质量评审报告<\/p>/);
  assert.match(first, /<dl class="report-scope"><dt>评审范围<\/dt><dd>Swift 选图规则与相关测试<\/dd><\/dl>/);
  assert.ok(first.indexOf('class="report-scope"') < first.indexOf('id="report-conclusion"'));
  assert.ok(first.indexOf('id="report-conclusion"') < first.indexOf('class="overview-metrics"'));
  assert.ok(first.indexOf('class="overview-metrics"') < first.indexOf('id="complexity"'));
  assert.doesNotMatch(first, /优先事项与评审范围|report-priorities|overview-notes/);
  assert.match(first, /<tr><th scope="row"><a href="#complexity">[^<]+<\/a><\/th><td>2<\/td><td class="number-pass">1<\/td><td class="number-fail">0<\/td><td class="number-pending">1<\/td>/);
  for (const label of ['未运行', '语言不支持', '源码位置及是否重复均待核对', '恢复｜上限还原为 9']) assert.ok(first.includes(label));
  assert.doesNotMatch(first, /复验通过|评审反馈|复制评审|<form\b|<select\b|<textarea\b|OpenVibeCodingReview|<script[^>]+src=|<link[^>]+href=/);
  assert.match(first, /href="#testStrength">边界控制评审<\/a>/);
  assert.match(first, /id="heading-testStrength">边界控制评审<\/h2>/);
  for (const badge of ['clear">通过', 'risk">不通过', 'review-pending">待评审']) assert.ok(first.includes(badge));
  assert.match(first, /data-filter="failed" aria-pressed="false">不通过 <span>1<\/span>/);
});

test('confirmed findings include both duplicate locations and reference the check and verification', async t => {
  const dir = await workspace(t);
  const data = path.join(dir, 'review.json');
  const out = path.join(dir, 'review.html');
  const report = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  const candidate = report.dimensions.duplication.checks.find(check => check.id === 'compare-entries');
  report.dimensions.duplication.checks = [candidate];
  report.dimensions.duplication.findings = [];
  candidate.status = 'findings';
  report.dimensions.complexity.checks[0].status = 'no_findings';
  report.dimensions.complexity.checks[0].detail = '两条入口的边界断言均通过。';
  report.title = '选择边界 </script><script id="unexpected">';
  delete report.dimensions.testStrength.label;
  report.dimensions.duplication.label = '重复逻辑 <标签>';
  report.dimensions.duplication.findings.push({
    id: 'duplicate-limit', title: '上限分别实现', checkId: candidate.id, severity: 'high',
    evidence: '两个入口分别读取当前已选列表并比较同一上限。',
    impact: '修改一个入口后可能出现行为不一致。',
    recommendation: '共用上限规则。',
    locations: [{ path: 'Album.swift', line: 9, endLine: 13 }, { path: 'Search.swift', line: 31 }],
    verification: { status: 'pending', detail: '等待修复并重跑。' },
  });
  await fs.writeFile(data, JSON.stringify(report));
  await writeCodeQualityReport({ data, out });
  const html = await fs.readFile(out, 'utf8');
  for (const label of ['Album.swift:9–13', 'Search.swift:31', 'href="#check-compare-entries"', '未发现问题', '待验证', '严重程度 高']) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /<script id="unexpected">/);
  assert.match(html, /选择边界 &lt;\/script&gt;/);
  assert.match(html, /id="check-compare-entries" class="entry" data-result="failed"/);
  assert.match(html, /id="check-selection-branches" class="entry" data-result="passed"/);
  assert.match(html, /class="status clear">通过<\/span>/);
  assert.match(html, /class="status risk">不通过<\/span>/);
  assert.match(html, /class="status review-pending">待评审<\/span>/);
  assert.match(html, /data-filter="failed" aria-pressed="false">不通过 <span>1<\/span>/);
  assert.match(html, /href="#testStrength">测试有效性<\/a>/);
  assert.match(html, /href="#duplication">重复逻辑 &lt;标签&gt;<\/a>/);
  assert.match(html, /<dt>影响<\/dt>[\s\S]*?<dt>建议<\/dt>[\s\S]*?<details class="evidence">[\s\S]*?Album\.swift:9–13/);

  candidate.status = 'candidate';
  await fs.writeFile(data, JSON.stringify(report));
  await assert.rejects(writeCodeQualityReport({ data, out }), /must refer to a check with findings/);
  assert.equal(await fs.readFile(out, 'utf8'), html);
});

test('the CLI rejects inconsistent states and preserves unrelated HTML', async t => {
  const dir = await workspace(t);
  const data = path.join(dir, 'bad.json');
  const out = path.join(dir, 'existing.html');
  const report = JSON.parse(await fs.readFile(samplePath, 'utf8'));
  report.dimensions.testStrength.checks[1].runs[0].status = 'passed';
  await fs.writeFile(data, JSON.stringify(report));
  await fs.writeFile(out, '<h1>Existing</h1>');

  async function renderFails(input, expected) {
    await assert.rejects(
      run(process.execPath, [cli, 'code-quality-report', 'render', '--data', input, '--out', out]),
      error => error.code === 1 && expected.test(JSON.parse(error.stderr).error.message),
    );
  }
  await renderFails(data, /cannot report an executed result/);
  await renderFails(samplePath, /Refusing to overwrite/);
  assert.equal(await fs.readFile(out, 'utf8'), '<h1>Existing</h1>');
});
