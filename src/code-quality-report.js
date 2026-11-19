import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml as html } from './html-artifact-utils.js';
import { atomicWriteText, withFileLock } from './kernel/atomic-store.js';

const schema = 'open-vibecoding.code-quality-report.v1';
const marker = '<!-- OPEN-VIBECODING:CODE-QUALITY-REPORT -->';
const dimensions = {
  complexity: '复杂度与覆盖',
  duplication: '重复逻辑',
  testStrength: '测试有效性',
};
const checkStatuses = {
  findings: '有已确认发现',
  no_findings: '未发现问题',
  candidate: '候选待核实',
  not_run: '未运行',
  unsupported: '语言不支持',
  blocked: '执行受阻',
};
const severities = { high: '高', medium: '中', low: '低' };
const verificationStatuses = { pending: '待验证', passed: '复验通过', failed: '复验失败', blocked: '复验受阻' };
const runStatuses = {
  passed: '测试通过',
  assertion_failed: '断言失败',
  survived: '变异存活',
  uncovered: '未覆盖',
  timeout: '超时',
  compile_error: '编译失败',
  runtime_error: '运行异常',
  not_run: '未运行',
};
const incomplete = new Set(['candidate', 'not_run', 'unsupported', 'blocked']);

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
}

function strings(value, fields, label) {
  object(value, label);
  for (const field of fields) {
    if (typeof value[field] !== 'string' || !value[field].trim()) {
      throw new Error(`${label}.${field} must be a nonempty string`);
    }
  }
}

function list(value, label, min = 0) {
  if (!Array.isArray(value) || value.length < min) throw new Error(`${label} must be an array with at least ${min} entries`);
  return value;
}

function choice(value, choices, label) {
  if (typeof value !== 'string' || !Object.hasOwn(choices, value)) {
    throw new Error(`${label} must be one of ${Object.keys(choices).join(', ')}`);
  }
}

function register(value, ids, label) {
  strings(value, ['id', 'title'], label);
  if (!/^[a-z][a-z0-9_-]*$/.test(value.id) || ids.has(value.id)) throw new Error(`${label}.id must be unique and match [a-z][a-z0-9_-]*`);
  ids.add(value.id);
}

function validate(report) {
  strings(report, ['id', 'revision', 'title', 'scope', 'conclusion'], 'report');
  if (report.schemaVersion !== schema) throw new Error(`schemaVersion must be ${schema}`);
  const ids = new Set();
  for (const [index, action] of list(report.priorities, 'priorities', 1).entries()) {
    const label = `priorities[${index}]`;
    register(action, ids, label);
    strings(action, ['action'], label);
  }

  object(report.dimensions, 'dimensions');
  for (const key of Object.keys(report.dimensions)) choice(key, dimensions, 'dimension');
  for (const key of Object.keys(dimensions)) {
    const label = `dimensions.${key}`;
    const dimension = report.dimensions[key];
    strings(dimension, ['summary'], label);
    if (dimension.label !== undefined) strings(dimension, ['label'], label);
    const checks = new Map();
    for (const [index, check] of list(dimension.checks, `${label}.checks`, 1).entries()) {
      const field = `${label}.checks[${index}]`;
      register(check, ids, field);
      strings(check, ['method', 'scope', 'detail'], field);
      choice(check.status, checkStatuses, `${field}.status`);
      if (check.runs !== undefined) {
        for (const [runIndex, run] of list(check.runs, `${field}.runs`).entries()) {
          const runLabel = `${field}.runs[${runIndex}]`;
          strings(run, ['title', 'detail'], runLabel);
          choice(run.status, runStatuses, `${runLabel}.status`);
          if (['not_run', 'unsupported'].includes(check.status) && run.status !== 'not_run') {
            throw new Error(`${runLabel} cannot report an executed result for a check that did not run`);
          }
        }
      }
      checks.set(check.id, check.status);
    }
    const linkedChecks = new Set();
    for (const [index, finding] of list(dimension.findings, `${label}.findings`).entries()) {
      const field = `${label}.findings[${index}]`;
      register(finding, ids, field);
      strings(finding, ['checkId', 'impact', 'recommendation', 'evidence'], field);
      if (checks.get(finding.checkId) !== 'findings') throw new Error(`${field}.checkId must refer to a check with findings in the same dimension`);
      linkedChecks.add(finding.checkId);
      choice(finding.severity, severities, `${field}.severity`);
      strings(finding.verification, ['detail'], `${field}.verification`);
      choice(finding.verification.status, verificationStatuses, `${field}.verification.status`);
      for (const [locationIndex, location] of list(finding.locations, `${field}.locations`, key === 'duplication' ? 2 : 1).entries()) {
        const name = `${field}.locations[${locationIndex}]`;
        strings(location, ['path'], name);
        if (!Number.isSafeInteger(location.line) || location.line < 1 ||
          (location.endLine !== undefined && (!Number.isSafeInteger(location.endLine) || location.endLine < location.line))) {
          throw new Error(`${name} must have a valid line range`);
        }
      }
    }
    for (const [id, status] of checks) {
      if (status === 'findings' && !linkedChecks.has(id)) throw new Error(`Check ${id} requires a linked finding`);
    }
  }
}

function statusLabel(status, labels, tone) {
  return `<span class="status ${tone}">${labels[status]}</span>`;
}

const resultLabels = { all: '全部', failed: '不通过', passed: '通过', pending: '待评审' };

function reviewResult(status) {
  if (status === 'findings') return 'failed';
  if (status === 'no_findings') return 'passed';
  return 'pending';
}

function renderCheck(check) {
  const result = reviewResult(check.status);
  const tone = { passed: 'clear', failed: 'risk', pending: 'review-pending' }[result];
  const runs = (check.runs ?? []).map(run => {
    const tone = run.status === 'passed' ? 'clear' : 'neutral';
    return `<li><strong>${html(run.title)}</strong> ${statusLabel(run.status, runStatuses, tone)}<p>${html(run.detail)}</p></li>`;
  }).join('');
  return `<li id="check-${check.id}" class="entry" data-result="${result}">
    <div class="entry-heading"><h3>${html(check.title)}</h3>${statusLabel(result, resultLabels, tone)}</div>
    <details class="check-details">
      <summary>检查方法与记录</summary>
      <p class="metadata">${html(check.method)} · ${html(check.scope)} · ${checkStatuses[check.status]}</p>
      <p>${html(check.detail)}</p>
      ${runs ? `<ul class="run-list">${runs}</ul>` : ''}
    </details>
  </li>`;
}

function renderFinding(finding) {
  const locations = finding.locations.map(({ path: file, line, endLine }) =>
    `<li><code>${html(file)}:${line}${endLine && endLine !== line ? `–${endLine}` : ''}</code></li>`).join('');
  const { verification } = finding;
  const verificationTone = { pending: 'open', passed: 'clear', failed: 'risk', blocked: 'open' }[verification.status];
  return `<li class="entry" data-result="failed">
    <div class="entry-heading"><h3>${html(finding.title)}</h3><span class="status ${finding.severity === 'high' ? 'risk' : 'neutral'}">严重程度 ${severities[finding.severity]}</span></div>
    <dl class="finding-details">
      <dt>影响</dt><dd>${html(finding.impact)}</dd>
      <dt>建议</dt><dd>${html(finding.recommendation)}</dd>
    </dl>
    <details class="evidence">
      <summary>源码、证据与复验</summary>
      <dl class="finding-details">
        <dt>位置</dt><dd><ul class="locations">${locations}</ul></dd>
        <dt>证据</dt><dd>${html(finding.evidence)} <a href="#check-${finding.checkId}">查看关联检查</a></dd>
        <dt>验证</dt><dd>${statusLabel(verification.status, verificationStatuses, verificationTone)} ${html(verification.detail)}</dd>
      </dl>
    </details>
  </li>`;
}

function render(report, dimensionLabels) {
  const reviewDimensions = dimensionLabels.map(([key, label]) => {
    const dimension = report.dimensions[key];
    const totals = { all: dimension.checks.length, failed: 0, passed: 0, pending: 0 };
    for (const check of dimension.checks) totals[reviewResult(check.status)]++;
    return { ...dimension, key, label, totals };
  });
  const sections = reviewDimensions.map(({ key, label, summary, checks, findings, totals }) => {
    const orderedFindings = [...findings].sort((a, b) =>
      Object.keys(severities).indexOf(a.severity) - Object.keys(severities).indexOf(b.severity));
    const filters = Object.entries(resultLabels).map(([result, text]) =>
      `<button type="button" data-filter="${result}" aria-pressed="${result === 'all'}">${text} <span>${totals[result]}</span></button>`).join('');
    return `<section class="card review-dimension" id="${key}" aria-labelledby="heading-${key}">
      <h2 id="heading-${key}">${html(label)}</h2><p class="dimension-summary">${html(summary)}</p>
      <div class="result-filters" role="group" aria-label="筛选检查结果">${filters}</div>
      ${orderedFindings.length ? `<ul class="entries" data-results>${orderedFindings.map(renderFinding).join('')}</ul>` : ''}
      <ul class="entries" data-results>${checks.map(renderCheck).join('')}</ul>
      <p class="empty-result" role="status" hidden>没有符合筛选条件的检查</p>
    </section>`;
  }).join('');
  const overviewRows = reviewDimensions.map(({ key, label, totals }) =>
    `<tr><th scope="row"><a href="#${key}">${html(label)}</a></th><td>${totals.all}</td><td class="number-pass">${totals.passed}</td><td class="number-fail">${totals.failed}</td><td class="number-pending">${totals.pending}</td></tr>`).join('');
  return `<header class="card overview" id="overview">
    <p class="report-kicker">代码质量评审报告</p>
    <h1>${html(report.title)}</h1>
    <dl class="report-scope"><dt>评审范围</dt><dd>${html(report.scope)}</dd></dl>
    <blockquote class="lead" id="report-conclusion">
      <span class="quote-mark" aria-hidden="true">“</span><p>${html(report.conclusion)}</p>
    </blockquote>
    <table class="overview-metrics" aria-label="各项评审结果">
      <thead><tr><th scope="col">评审项</th><th scope="col">总数</th><th scope="col">通过</th><th scope="col">不通过</th><th scope="col">待评审</th></tr></thead>
      <tbody>${overviewRows}</tbody>
    </table>
  </header>
  ${sections}`;
}

export async function writeCodeQualityReport({ data, out }) {
  const file = path.resolve(out);
  if (path.extname(file).toLowerCase() !== '.html') throw new Error('--out must name an HTML file');
  const report = JSON.parse(await fs.readFile(data, 'utf8'));
  validate(report);
  const template = await fs.readFile(new URL('./code-quality-report-template.html', import.meta.url), 'utf8');
  const dimensionLabels = Object.entries(dimensions).map(([key, label]) => [key, report.dimensions[key].label ?? label]);
  const navigation = [['overview', '评审概览'], ...dimensionLabels];
  const parts = {
    NAV: navigation.map(([key, label]) => `<a href="#${key}">${html(label)}</a>`).join(''),
    TITLE: html(report.title), CONTENT: render(report, dimensionLabels),
  };
  const output = `${marker}\n${template.replace(/\{\{QUALITY_(TITLE|NAV|CONTENT)\}\}/g, (_, key) => parts[key])}`;
  await withFileLock(`${file}.code-quality-report.lock`, async () => {
    const stat = await fs.lstat(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (stat && (!stat.isFile() || !(await fs.readFile(file, 'utf8')).startsWith(marker))) {
      throw new Error(`Refusing to overwrite existing HTML: ${file}`);
    }
    await atomicWriteText(file, output);
  });
  return { ok: true, out: file };
}
