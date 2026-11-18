import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { prepareTestImport } from './test-report-import.js';
import { checkUnitPlan } from './test-report-plan.js';
import { runUnitPlan } from './test-report-run.js';
import { atomicWriteJson, atomicWriteText, withFileLock } from './kernel/atomic-store.js';

export const REPORT_KINDS = ['unit', 'component', 'api', 'ui'];
export const RENDER_KINDS = [...REPORT_KINDS, 'cases'];
const CASE_LAYERS = ['unit', 'component', 'api', 'e2e'];
const CASE_PRIORITIES = ['high', 'medium', 'low'];
const CASE_LIST_FIELDS = ['id', 'feature', 'title', 'layer', 'priority', 'input', 'steps', 'expected', 'assertions', 'target'];
const LEGACY_STATUSES = ['passed', 'failed', 'skipped', 'cancelled', 'blocked'];
const STATUSES = [...LEGACY_STATUSES, 'pending', 'unknown', 'unsupported'];
const ENVIRONMENT_FIELDS = ['label', 'deviceType', 'deviceModel', 'os', 'osVersion', 'browser', 'browserVersion', 'location', 'target', 'notes'];
const EXECUTION_TEXT_FIELDS = ['version', 'executedAt', 'command'];
const INHERITED_EXECUTION_FIELDS = ['environment', 'version', 'command'];
const RUN_TEXT_FIELDS = ['phase', 'actual', 'matcherExpected', 'reason', 'evidence', 'location', 'notes', 'testId', 'nativeStatus'];
const RUN_FIELDS = [...RUN_TEXT_FIELDS, ...EXECUTION_TEXT_FIELDS, 'durationMs', 'environment', 'exitCode'];
const CASE_FIELDS = {
  unit: ['feature', 'input', 'action', 'expected', 'assertion', 'ruleId'],
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

function checkCaseList(data) {
  object(data, 'report');
  for (const field of Object.keys(data)) {
    if (!['project', 'scope', 'summary', 'cases'].includes(field)) throw new Error(`Unknown field: report.${field}`);
  }
  for (const field of ['project', 'scope', 'summary']) nonempty(data[field], `report.${field}`);
  if (!Array.isArray(data.cases) || !data.cases.length) throw new Error('report.cases must be a nonempty array');
  const ids = new Set();
  for (const [index, entry] of data.cases.entries()) {
    const label = `report.cases[${index}]`;
    object(entry, label);
    for (const field of Object.keys(entry)) {
      if (!CASE_LIST_FIELDS.includes(field)) throw new Error(`Unknown field: ${label}.${field}`);
    }
    for (const field of ['id', 'feature', 'title', 'input', 'expected']) nonempty(entry[field], `${label}.${field}`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(entry.id)) throw new Error(`${label}.id must contain only letters, numbers, dots, underscores or dashes, starting with a letter or number`);
    if (ids.has(entry.id)) throw new Error(`Duplicate case ID: ${entry.id}`);
    ids.add(entry.id);
    if (!CASE_LAYERS.includes(entry.layer)) throw new Error(`${label}.layer must be one of ${CASE_LAYERS.join(', ')}`);
    if (!CASE_PRIORITIES.includes(entry.priority)) throw new Error(`${label}.priority must be one of ${CASE_PRIORITIES.join(', ')}`);
    for (const field of ['steps', 'assertions']) {
      if (!Array.isArray(entry[field]) || !entry[field].length) throw new Error(`${label}.${field} must be a nonempty array`);
      entry[field].forEach((value, position) => nonempty(value, `${label}.${field}[${position}]`));
    }
    if (Object.hasOwn(entry, 'target')) nonempty(entry.target, `${label}.target`);
  }
}

function checkExecution(value, label) {
  optionalStrings(value, EXECUTION_TEXT_FIELDS, label);
  if (value.durationMs !== undefined && (!Number.isFinite(value.durationMs) || value.durationMs < 0)) {
    throw new Error(`${label}.durationMs must be a nonnegative number`);
  }
  if (value.exitCode !== undefined && (!Number.isInteger(value.exitCode) || value.exitCode < 0)) {
    throw new Error(`${label}.exitCode must be a nonnegative integer`);
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

function checkRun(run, label, statuses = STATUSES) {
  object(run, label);
  if (!statuses.includes(run.status)) throw new Error(`${label}.status must be one of ${statuses.join(', ')}`);
  optionalStrings(run, RUN_TEXT_FIELDS, label);
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
  if (kind === 'unit' && data.imports !== undefined) {
    if (!Array.isArray(data.imports)) throw new Error('report.imports must be an array');
    for (const batch of data.imports) {
      object(batch, 'import');
      nonempty(batch.runId, 'import.runId');
      if (!Array.isArray(batch.unmatched) || !Array.isArray(batch.issues)) throw new Error('Expected import.unmatched and import.issues arrays');
      checkExecution(batch, 'import');
    }
  }
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
    if (Object.hasOwn(entry, 'testIds')) {
      object(entry.testIds, `${label}.testIds`);
      for (const [format, identifier] of Object.entries(entry.testIds)) nonempty(identifier, `${label}.testIds.${format}`);
    }
    if (!Object.hasOwn(entry, 'runs')) continue;
    if (!Array.isArray(entry.runs)) throw new Error(`${label}.runs must be an array`);
    const attempts = new Set();
    for (const run of entry.runs) {
      checkRun(run, `${label}.run`, kind === 'unit' ? STATUSES : LEGACY_STATUSES);
      if (run.runId === undefined) continue;
      if (attempts.has(run.runId)) throw new Error(`${label}: duplicate runId ${run.runId}`);
      attempts.add(run.runId);
    }
  }
  if (kind === 'unit') {
    const plan = checkUnitPlan(data);
    for (const group of plan?.groups.values() ?? []) {
      if (group.runner) checkExecution(group.runner, group.id + '.runner');
    }
    return plan;
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

function addResult(data, result, kind) {
  object(result, 'result');
  const { caseId, runId, status } = result;
  nonempty(caseId, 'result.caseId');
  nonempty(runId, 'result.runId');
  checkRun(result, 'result', kind === 'unit' ? STATUSES : LEGACY_STATUSES);
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

function importSummary(batch) {
  const { unmatched, issues, matched, runId, status } = batch;
  return { runId, status, matched, unmatched, issues };
}

function mergeImport(data, incoming, plan) {
  const { format, source, sourceDigest, runId, metadata, coverage, coverageSource, items } = incoming;
  nonempty(runId, 'runId');
  object(metadata, 'import metadata');
  checkExecution(metadata, 'import metadata');
  optionalStrings(metadata, ['phase', 'reason', 'evidence', 'runnerVersion'], 'import metadata');
  if (metadata.status !== undefined && !STATUSES.includes(metadata.status)) {
    throw new Error(`import metadata.status must be one of ${STATUSES.join(', ')}`);
  }
  const imports = data.imports ??= [];
  const previous = imports.find(batch => batch.runId === runId);
  if (previous) {
    if (previous.format !== format || previous.sourceDigest !== sourceDigest ||
        !isDeepStrictEqual(previous.metadata, metadata) || !isDeepStrictEqual(previous.coverage, coverage) ||
        !isDeepStrictEqual(previous.testIds, items.map(item => item.testId ?? null))) {
      throw new Error(`runId ${runId} already has different imported results`);
    }
    return { appended: false, summary: importSummary(previous) };
  }

  const index = new Map();
  const { groupId } = metadata;
  if (groupId && !plan?.groups.has(groupId)) throw new Error('Unknown import group: ' + groupId);
  const cases = groupId ? data.cases.filter(entry => plan.rules.get(entry.ruleId) === groupId) : data.cases;
  for (const entry of cases) {
    const identifier = entry.testIds?.[format] ?? entry.id;
    const matches = index.get(identifier) ?? [];
    matches.push(entry);
    index.set(identifier, matches);
  }
  const occurrences = new Map();
  for (const { testId, outsideKind } of items) {
    if (!outsideKind) occurrences.set(testId, (occurrences.get(testId) ?? 0) + 1);
  }

  const execution = {
    command: metadata.command ?? data.command,
    version: metadata.version ?? data.version,
    environment: metadata.environment ?? incoming.environment ?? data.environment,
    executedAt: metadata.executedAt ?? incoming.executedAt,
    durationMs: metadata.durationMs ?? incoming.durationMs,
    exitCode: metadata.exitCode,
    evidence: metadata.evidence ? `${source} · ${metadata.evidence}` : source,
  };
  const issues = [...incoming.issues];
  if (execution.exitCode > 0 && !issues.length && !items.some(item => item.status === 'failed' || item.status === 'blocked')) {
    issues.push({ status: 'unknown', detail: '测试命令返回非零退出码，详见原始结果' });
  }
  const batch = {
    runId, format, source, sourceDigest, metadata, ...execution, coverage, coverageSource, issues,
    testIds: items.map(item => item.testId ?? null), matched: 0, unmatched: [],
  };
  const observed = new Set();
  for (const item of items) {
    const matching = index.get(item.testId) ?? [];
    const ambiguous = matching.length > 1 || occurrences.get(item.testId) > 1;
    const match = item.outsideKind ? 'outside-kind'
      : !item.testId ? 'missing-id' : ambiguous ? 'ambiguous' : matching.length === 0 ? 'unmapped' : undefined;
    if (match) {
      batch.unmatched.push({ ...item, match });
      continue;
    }
    const [entry] = matching;
    if (entry.runs?.some(run => run.runId === runId)) throw new Error(`runId ${runId} already exists for case ${entry.id}`);
    const needsReason = item.status === 'failed' || item.status === 'blocked';
    const attempt = {
      ...execution, ...item, caseId: entry.id, runId,
      executedAt: item.executedAt ?? execution.executedAt, durationMs: item.durationMs,
      phase: metadata.phase ?? format,
      reason: item.reason?.trim() || (needsReason ? '详见原始测试结果' : undefined),
    };
    addResult(data, Object.fromEntries(Object.entries(attempt).filter(([, value]) => value !== undefined)), 'unit');
    observed.add(entry.id);
    batch.matched += 1;
  }
  if (groupId) {
    const blocked = issues.find(issue => issue.status === 'blocked');
    for (const entry of cases) {
      if (observed.has(entry.id)) continue;
      const status = blocked ? 'blocked' : metadata.status === 'cancelled' ? 'cancelled' : 'pending';
      const reason = blocked?.detail ?? '本次运行未返回可匹配的用例结果。';
      addResult(data, { caseId: entry.id, runId, status, reason, phase: metadata.phase }, 'unit');
    }
  }
  const statuses = new Set(items.filter(item => !item.outsideKind).map(item => item.status));
  const evidenceStatuses = [...issues.map(issue => issue.status), ...statuses];
  if (metadata.status && metadata.status !== 'passed') evidenceStatuses.push(metadata.status);
  batch.status = ['failed', 'blocked', 'cancelled', 'unsupported', 'unknown', 'pending', 'passed', 'skipped']
    .find(status => evidenceStatuses.includes(status)) ?? 'pending';
  if (metadata.reason) batch.reason = metadata.reason;
  imports.push(batch);
  return { appended: true, summary: importSummary(batch) };
}

export async function writeTestReport({ kind, data, out, result, ...options }) {
  if (!RENDER_KINDS.includes(kind)) throw new Error(`--kind must be one of ${RENDER_KINDS.join(', ')}`);
  const caseList = kind === 'cases';
  if (caseList && (result !== undefined || options.format || options.batches)) throw new Error('--kind cases supports render only');
  const dataPath = await fs.realpath(data);
  const outPath = path.resolve(out);
  if (options.format && kind !== 'unit') throw new Error('Import requires --kind unit');
  if (path.extname(dataPath).toLowerCase() !== '.json') throw new Error('--data must name a JSON file');
  const [template, emptyArt] = await Promise.all([
    fs.readFile(path.join(templates, `${kind}.html`), 'utf8'),
    caseList ? undefined : fs.readFile(path.join(templates, 'empty-cases.webp'), 'base64'),
  ]);
  if (!REPORT_DATA.test(template)) throw new Error(`Missing data block in ${kind} template`);
  if (!caseList && !template.includes(EMPTY_ART_SOURCE)) throw new Error(`Missing empty state in ${kind} template`);
  const resultPath = result === undefined ? undefined : await fs.realpath(result);
  if (resultPath === dataPath) throw new Error('--data and --result must point to different files');
  if (options.format && resultPath === undefined) throw new Error('--result is required');
  const incoming = options.format ? await prepareTestImport({ ...options, result: resultPath }) : undefined;
  const record = !incoming && resultPath !== undefined ? await readJson(resultPath) : undefined;

  return withFileLock(`${dataPath}.test-report.lock`, async () => {
    const input = await readJson(dataPath);
    const plan = caseList ? checkCaseList(input) : checkData(input, kind);
    await checkOutput(outPath);
    if (options.planSnapshot && !isDeepStrictEqual(planSnapshot(input), options.planSnapshot)) {
      throw new Error('Test plan or case definitions changed during execution. Original test artifacts were kept.');
    }
    const batches = options.batches ?? (incoming ? [incoming] : []);
    const imports = batches.map(batch => mergeImport(input, batch, plan));
    const appended = imports.some(entry => entry.appended) || (record !== undefined && addResult(input, record, kind));
    const json = JSON.stringify(input).replaceAll('<', '\\u003c');
    const html = (caseList ? template : template.replace(EMPTY_ART_SOURCE, `src="data:image/webp;base64,${emptyArt}"`))
      .replace('<!doctype html>', `<!doctype html>\n${GENERATED_REPORT}`)
      .replace(REPORT_DATA, (_, start, end) => `${start}${json}${end}`);
    if (appended) await atomicWriteJson(dataPath, input);
    try {
      await atomicWriteText(outPath, html);
    } catch (error) {
      if (appended) throw new Error(`Result saved to ${dataPath}; retry the same command to regenerate HTML. ${error.message}`);
      throw error;
    }
    if (caseList) return { ok: true, kind, data: dataPath, out: outPath, appended: false };
    const counts = { total: input.cases.length, passed: 0, failed: 0, pending: 0, skipped: 0, cancelled: 0, blocked: 0 };
    for (const entry of input.cases) {
      const status = entry.runs?.at(-1)?.status ?? 'pending';
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return { ok: true, kind, data: dataPath, out: outPath, appended, counts,
      ...(incoming && { imported: imports[0].summary }),
      ...(options.batches && { batches: imports.map(entry => entry.summary) }) };
  });
}

function planSnapshot(input) {
  return {
    plan: input.testPlan, environment: input.environment, version: input.version,
    cases: input.cases.map(({ runs, ...entry }) => entry),
  };
}

export async function executeTestReportPlan({ data, out, root, requested, jobs, dryRun }) {
  const dataPath = await fs.realpath(data);
  if (path.extname(dataPath).toLowerCase() !== '.json') throw new Error('--data must name a JSON file');
  const input = await readJson(dataPath);
  const plan = checkData(input, 'unit');
  if (!plan) throw new Error('No testPlan in the report data');
  if (dryRun) return {
    ok: true, groups: [...plan.groups.values()].map(({ id, title, dependsOn, resources, runner }) =>
      ({ id, title, dependsOn: dependsOn ?? [], resources: resources ?? [], executable: Boolean(runner) })),
    rules: plan.rules.size, cases: input.cases.length,
  };
  const workdir = await fs.realpath(root ?? process.cwd());
  if (!(await fs.stat(workdir)).isDirectory()) throw new Error('--root must name a directory');
  const output = path.resolve(out);
  await checkOutput(output);
  const { batches, artifactDir, incomplete } = await runUnitPlan({
    data: input, plan, root: workdir, output, requested, jobs,
  });
  try {
    const report = await writeTestReport({ kind: 'unit', data: dataPath, out: output,
      planSnapshot: planSnapshot(input), batches });
    return { ...report, artifactDir, incomplete, ok: incomplete.length === 0 };
  } catch (error) {
    throw new Error(`${error.message} Test artifacts: ${artifactDir}`, { cause: error });
  }
}
