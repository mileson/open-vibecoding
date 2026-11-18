import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { atomicWriteJson, atomicWriteText, withFileLock } from './kernel/atomic-store.js';

export const REPORT_KINDS = ['unit', 'component', 'api', 'ui'];
const STATUSES = ['passed', 'failed', 'skipped', 'cancelled', 'blocked'];
const ENVIRONMENT_FIELDS = ['label', 'deviceType', 'deviceModel', 'os', 'osVersion', 'browser', 'browserVersion', 'location', 'target', 'notes'];
const EXECUTION_TEXT_FIELDS = ['version', 'executedAt', 'command'];
const INHERITED_EXECUTION_FIELDS = ['environment', 'version', 'command'];
const RUN_FIELDS = ['phase', 'actual', 'reason', 'evidence', ...EXECUTION_TEXT_FIELDS, 'durationMs', 'environment'];
const CASE_FIELDS = {
  unit: ['input', 'expected', 'assertion'],
  component: ['component', 'preconditions', 'action', 'expected', 'assertion'],
  api: ['preconditions', 'request', 'response', 'effects', 'assertion'],
  ui: ['environment', 'preconditions', 'expected'],
};
const SPECIALIZED_FIELDS = new Set(Object.values(CASE_FIELDS).flat());
const REPORT_DATA = /(<script id="report-data" type="application\/json">).*?(<\/script>)/s;
const GENERATED_REPORT = '<!-- OPEN-VIBECODING:TEST-REPORT -->';
const EMPTY_ART_SOURCE = 'src="empty-cases.webp"';
const templates = fileURLToPath(new URL('./test-report-templates/', import.meta.url));

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`);
}

function optionalStrings(value, fields, label) {
  for (const field of fields) {
    if (Object.hasOwn(value, field) && typeof value[field] !== 'string') {
      throw new Error(`${label}.${field} must be a string`);
    }
  }
}

function checkExecution(value, label) {
  optionalStrings(value, EXECUTION_TEXT_FIELDS, label);
  if (value.durationMs !== undefined && (!Number.isFinite(value.durationMs) || value.durationMs < 0)) {
    throw new Error(`${label}.durationMs must be a nonnegative number`);
  }
  const environment = value.environment;
  if (environment === undefined || typeof environment === 'string') return;
  const environmentLabel = `${label}.environment`;
  object(environment, environmentLabel);
  for (const field of Object.keys(environment)) {
    if (!ENVIRONMENT_FIELDS.includes(field)) throw new Error(`Unknown field: ${environmentLabel}.${field}`);
  }
  optionalStrings(environment, ENVIRONMENT_FIELDS, environmentLabel);
}

function checkRun(run, label) {
  object(run, label);
  if (!STATUSES.includes(run.status)) throw new Error(`${label}.status must be one of ${STATUSES.join(', ')}`);
  optionalStrings(run, ['phase', 'actual', 'reason', 'evidence'], label);
  checkExecution(run, label);
  if (Object.hasOwn(run, 'runId')) nonempty(run.runId, `${label}.runId`);
  if (run.status === 'failed' || run.status === 'blocked') nonempty(run.reason, `${label}.reason`);
}

function checkData(data, kind) {
  object(data, 'report');
  nonempty(data.project, 'report.project');
  optionalStrings(data, ['meta', 'scope', 'sourceLabel', 'evidence'], 'report');
  checkExecution(data, 'report');
  if (!Array.isArray(data.cases)) throw new Error('report.cases must be an array');
  const ids = new Set();
  for (const entry of data.cases) {
    object(entry, 'case');
    nonempty(entry.id, 'case.id');
    const label = `case ${entry.id}`;
    nonempty(entry.title, `${label}.title`);
    if (ids.has(entry.id)) throw new Error(`Duplicate case ID: ${entry.id}`);
    ids.add(entry.id);
    for (const field of Object.keys(entry)) {
      if (SPECIALIZED_FIELDS.has(field) && !CASE_FIELDS[kind].includes(field)) {
        throw new Error(`${label}.${field} does not belong to the ${kind} template`);
      }
    }
    optionalStrings(entry, [...CASE_FIELDS[kind], 'name', 'target'], label);
    if (Object.hasOwn(entry, 'steps')) {
      if (kind !== 'ui' || !Array.isArray(entry.steps)) throw new Error(`${label}.steps requires the ui template and an array`);
      for (const step of entry.steps) {
        object(step, `${label}.step`);
        nonempty(step.action, `${label}.step.action`);
        nonempty(step.expected, `${label}.step.expected`);
      }
    }
    if (!Object.hasOwn(entry, 'runs')) continue;
    if (!Array.isArray(entry.runs)) throw new Error(`${label}.runs must be an array`);
    const attempts = new Set();
    for (const run of entry.runs) {
      checkRun(run, `${label}.run`);
      if (run.runId === undefined) continue;
      if (attempts.has(run.runId)) throw new Error(`${label}: duplicate runId ${run.runId}`);
      attempts.add(run.runId);
    }
  }
}

async function readJson(filePath) {
  const input = await fs.readFile(filePath, 'utf8');
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

async function checkOutput(outPath) {
  if (path.extname(outPath).toLowerCase() !== '.html') throw new Error('--out must name an HTML file');
  const stat = await fs.lstat(outPath).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  if (!stat) return;
  if (!stat.isFile() || !(await fs.readFile(outPath, 'utf8')).includes(GENERATED_REPORT)) {
    throw new Error(`Refusing to overwrite an output that was not generated by test-report: ${outPath}`);
  }
}

function addResult(data, result) {
  object(result, 'result');
  const { caseId, runId, status } = result;
  nonempty(caseId, 'result.caseId');
  nonempty(runId, 'result.runId');
  checkRun(result, 'result');
  const target = data.cases.find(entry => entry.id === caseId);
  if (!target) throw new Error(`Unknown case ID: ${caseId}`);
  const history = target.runs ??= [];
  const prior = history.find(item => item.runId === runId);
  const run = { runId, status };
  for (const field of RUN_FIELDS) {
    const fallback = INHERITED_EXECUTION_FIELDS.includes(field) ? (prior || data)[field] : undefined;
    const value = result[field] ?? fallback;
    if (value !== undefined) run[field] = value;
  }
  if (prior) {
    if (['status', ...RUN_FIELDS].some(field => !isDeepStrictEqual(prior[field], run[field]))) {
      throw new Error(`runId ${runId} already has different results for case ${caseId}`);
    }
    return false;
  }
  history.push(run);
  return true;
}

export async function writeTestReport({ kind, data, out, result }) {
  if (!REPORT_KINDS.includes(kind)) throw new Error(`--kind must be one of ${REPORT_KINDS.join(', ')}`);
  const dataPath = await fs.realpath(data);
  const outPath = path.resolve(out);
  if (path.extname(dataPath).toLowerCase() !== '.json') throw new Error('--data must name a JSON file');
  const [template, emptyArt] = await Promise.all([
    fs.readFile(path.join(templates, `${kind}.html`), 'utf8'),
    fs.readFile(path.join(templates, 'empty-cases.webp'), 'base64'),
  ]);
  if (!REPORT_DATA.test(template)) throw new Error(`Missing data block in ${kind} template`);
  if (!template.includes(EMPTY_ART_SOURCE)) throw new Error(`Missing empty state in ${kind} template`);
  const resultPath = result === undefined ? undefined : await fs.realpath(result);
  if (resultPath === dataPath) throw new Error('--data and --result must point to different files');
  const record = resultPath === undefined ? undefined : await readJson(resultPath);

  return withFileLock(`${dataPath}.test-report.lock`, async () => {
    const input = await readJson(dataPath);
    checkData(input, kind);
    await checkOutput(outPath);
    const appended = record === undefined ? false : addResult(input, record);
    const json = JSON.stringify(input).replaceAll('<', '\\u003c');
    const html = template
      .replace('<!doctype html>', `<!doctype html>\n${GENERATED_REPORT}`)
      .replace(EMPTY_ART_SOURCE, `src="data:image/webp;base64,${emptyArt}"`)
      .replace(REPORT_DATA, (_, start, end) => `${start}${json}${end}`);
    if (appended) await atomicWriteJson(dataPath, input);
    try {
      await atomicWriteText(outPath, html);
    } catch (error) {
      if (appended) throw new Error(`Result saved to ${dataPath}; retry the same record to regenerate HTML. ${error.message}`);
      throw error;
    }
    const counts = { total: input.cases.length, passed: 0, failed: 0, pending: 0, skipped: 0, cancelled: 0, blocked: 0 };
    for (const entry of input.cases) counts[entry.runs?.at(-1)?.status ?? 'pending'] += 1;
    return { ok: true, kind, data: dataPath, out: outPath, appended, counts };
  });
}
