import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson, atomicWriteText, withFileLock } from './kernel/atomic-store.js';
import { readJUnit } from './test-report-import.js';
import { executeTestCommand } from './test-report-run.js';
import { renderE2EReport } from './test-report-e2e-html.js';
import { prepareRunData, validateDataPreparation } from './test-report-data-preparation.js';

const engines = { playwright: 'playwright.json', maestro: 'maestro.xml' };
const outcomes = new Set(['passed', 'passed_on_retry']);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const validId = id => typeof id === 'string' && idPattern.test(id);
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || typeof manifest.project !== 'string' || !manifest.project.trim() ||
      !Array.isArray(manifest.runs) || !manifest.runs.length) throw new Error('Expected an E2E manifest with schemaVersion 1, project and runs');
  const ids = new Set();
  const preparations = manifest.dataPreparations ?? {};
  if (typeof preparations !== 'object' || Array.isArray(preparations)) throw new Error('dataPreparations must be an object');
  for (const [id, spec] of Object.entries(preparations)) {
    if (!validId(id)) throw new Error('Invalid data preparation ID: ' + id);
    validateDataPreparation(spec, id);
  }
  for (const run of manifest.runs) {
    if (!run || !validId(run.id) || ids.has(run.id) || !Object.hasOwn(engines, run.engine) ||
        !Array.isArray(run.argv) || !run.argv.length || !run.argv.every(value => typeof value === 'string' && value.length) ||
        typeof run.label !== 'string' || !run.label.trim() ||
        typeof run.environment?.target !== 'string' || !run.environment.target.trim() ||
        typeof run.environment?.deviceType !== 'string' || !run.environment.deviceType.trim() ||
        !Array.isArray(run.cases) || !run.cases.length ||
        (run.timeoutMs !== undefined && (!Number.isSafeInteger(run.timeoutMs) || run.timeoutMs <= 0))) {
      throw new Error('Invalid or duplicate E2E run: ' + run?.id);
    }
    ids.add(run.id);
    if (run.dataPreparation !== undefined && (!validId(run.dataPreparation) || !Object.hasOwn(preparations, run.dataPreparation))) {
      throw new Error(run.id + ': unknown data preparation ' + run.dataPreparation);
    }
    const caseIds = new Set();
    for (const entry of run.cases) {
      if (!entry || !validId(entry.id) || caseIds.has(entry.id) || typeof entry.title !== 'string' || !entry.title.trim() ||
          !Object.hasOwn(entry, 'expected')) throw new Error(run.id + ': invalid or duplicate acceptance case ' + entry?.id);
      caseIds.add(entry.id);
    }
  }
  return ids;
}

function playwrightAttempt(result) {
  const attachment = result.attachments?.find(item => item.name === 'ovc-observation');
  const observation = attachment?.body ? JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8')) : undefined;
  const findings = result.errors?.length ? result.errors : (result.error ? [result.error] : []);
  const reason = findings.map(error => error.message ?? error.stack).filter(Boolean).join('\n');
  let status = 'environment_error';
  if (result.status === 'passed') status = 'passed';
  if (result.status === 'skipped' || result.status === 'interrupted') status = 'not_run';
  if (result.status === 'failed' && findings.some(error =>
    error.matcherResult || /\bexpect\(.*\)[.\s]|\bAssertionError\b/.test(error.message ?? ''))) status = 'assertion_failed';
  return { status, actual: observation?.actual ?? null, environment: observation?.environment,
    reason, durationMs: result.duration, nativeStatus: result.status };
}

function playwrightCases(report) {
  if (!Array.isArray(report.suites)) throw new Error('Invalid Playwright JSON report');
  const cases = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const attempts = test.results.map(playwrightAttempt);
        if (test.expectedStatus !== 'passed' && test.expectedStatus !== 'skipped' && attempts.length) {
          Object.assign(attempts.at(-1), { status: 'environment_error', reason: '此验收项被标记为预期失败' });
        }
        cases.push({ id: spec.title, attempts });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  report.suites.forEach(visit);
  return { cases, errors: (report.errors ?? []).map(error => error.message ?? error.stack) };
}

function maestroCases(report, observations) {
  const cases = report.cases.map(entry => {
    const diagnostic = entry.observations.find(item => ['error', 'failure', 'skipped'].includes(item.tag));
    const reason = [diagnostic?.message, diagnostic?.text].filter(Boolean).join('\n').trim();
    const nativeStatus = entry.status ?? diagnostic?.tag ?? 'success';
    let status = nativeStatus.toLowerCase() === 'success' ? 'passed' : 'environment_error';
    if (diagnostic?.tag === 'skipped' || /^(skipped|cancelled|canceled)$/i.test(nativeStatus)) status = 'not_run';
    if (diagnostic?.tag === 'error') status = 'environment_error';
    if (diagnostic?.tag === 'failure') {
      status = /Assertion is false|Assertion failed/i.test(reason) ? 'assertion_failed' : 'environment_error';
    }
    return { id: entry.name, attempts: [{ status, actual: observations[entry.name]?.actual ?? null,
      reason, durationMs: entry.time ? Number(entry.time) * 1000 : undefined,
      nativeStatus }] };
  });
  return { cases, errors: [] };
}

async function evidenceFiles(directory, output, scratch) {
  const evidence = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && file !== scratch) evidence.push(...await evidenceFiles(file, output, scratch));
    if (entry.isFile() && /\.(json|xml|png|zip|log|webm|ndjson|txt)$/i.test(entry.name)) {
      evidence.push(path.relative(output, file).split(path.sep).join('/'));
    }
  }
  return evidence.sort();
}

function caseResults(definitions, nativeCases, error) {
  const seen = new Map();
  for (const item of nativeCases) {
    if (seen.has(item.id)) seen.set(item.id, [{ status: 'environment_error', actual: null, reason: '执行器返回了重复的用例标识' }]);
    else seen.set(item.id, item.attempts);
  }
  return definitions.map(definition => {
    const attempts = seen.get(definition.id) ?? [];
    const last = attempts.at(-1);
    let status = last?.status ?? (error ? 'environment_error' : 'not_run');
    if (status === 'passed' && attempts.slice(0, -1).some(attempt => !outcomes.has(attempt.status))) status = 'passed_on_retry';
    return { ...definition, status, actual: last?.actual ?? null, reason: last?.reason || (!last && error) || undefined, attempts };
  });
}

async function executeRun(run, root, output, artifacts) {
  const directory = path.join(artifacts, run.id);
  await fs.mkdir(directory);
  const nativeReport = path.join(directory, engines[run.engine]);
  const observationPath = path.join(directory, 'observations.json');
  const env = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: nativeReport, PLAYWRIGHT_JSON_ONLY_FAILURES: '0' };
  let dataPreparation;
  if (run.dataPreparation) {
    const dataDirectory = path.join(directory, 'data');
    await fs.mkdir(dataDirectory);
    env.OVC_E2E_DATA_DIR = dataDirectory;
    env.OVC_E2E_DATA_OBSERVATIONS = path.join(dataDirectory, 'data-observations.json');
    dataPreparation = await prepareRunData(run.dataPreparation, { directory: dataDirectory, root, env });
    dataPreparation.evidence = await evidenceFiles(dataDirectory, output, path.join(dataDirectory, '.fixture'));
    if (dataPreparation.status !== 'passed') {
      return { id: run.id, label: run.label, engine: run.engine, environment: run.environment,
        status: 'environment_error', dataPreparation, evidence: dataPreparation.evidence, cases: caseResults(run.cases, []) };
    }
  }
  const [command, ...args] = run.argv.map(argument => argument.replaceAll('{artifacts}', () => directory)
    .replaceAll('{result}', () => nativeReport).replaceAll('{observations}', () => observationPath));
  const log = await fs.open(path.join(directory, 'runner.log'), 'wx');
  const executedAt = new Date().toISOString();
  const started = performance.now();
  let execution;
  let nativeCases = [];
  let observedEnvironment;
  let error;
  try {
    execution = await executeTestCommand(command, args, root, log, run.timeoutMs ?? 300_000, env);
    if (execution.signal) throw new Error('执行已中断 · ' + execution.signal);
    let reported;
    if (run.engine === 'playwright') {
      reported = playwrightCases(await readJson(nativeReport));
    } else {
      const observations = await readJson(observationPath).catch(problem => {
        if (problem.code === 'ENOENT') return {};
        throw problem;
      });
      observedEnvironment = observations.environment;
      reported = maestroCases(await readJUnit(nativeReport), observations.cases ?? {});
    }
    nativeCases = reported.cases;
    const expectedIds = new Set(run.cases.map(entry => entry.id));
    const unmatched = nativeCases.filter(entry => !expectedIds.has(entry.id)).map(entry => entry.id);
    error = [...reported.errors, unmatched.length ? '未登记的执行结果 · ' + unmatched.join(', ') : ''].filter(Boolean).join('\n') || undefined;
    if (execution.code !== 0 && !nativeCases.some(entry => entry.attempts.at(-1)?.status === 'assertion_failed')) {
      error ||= '执行器退出码 ' + execution.code;
    }
  } catch (problem) {
    error = problem.message;
  } finally {
    if (error) await log.appendFile('\n' + error + '\n');
    await log.close();
  }
  const cases = caseResults(run.cases, nativeCases, error);
  const environment = { location: process.env.GITHUB_ACTIONS === 'true' ? 'GitHub Actions' : '本机',
    ...run.environment, hostOS: os.platform(), hostRelease: os.release(), architecture: os.arch(),
    ...nativeCases.flatMap(entry => entry.attempts).find(attempt => attempt.environment)?.environment, ...observedEnvironment };
  let status = 'passed';
  if (error || cases.some(entry => entry.status === 'environment_error')) status = 'environment_error';
  else if (cases.some(entry => entry.status === 'assertion_failed')) status = 'assertion_failed';
  else if (cases.some(entry => entry.status === 'not_run')) status = 'not_run';
  else if (cases.some(entry => entry.status === 'passed_on_retry')) status = 'passed_on_retry';
  return { id: run.id, label: run.label, engine: run.engine, environment, status, executedAt, dataPreparation,
    durationMs: Math.round(performance.now() - started), exitCode: execution?.code, error,
    evidence: await evidenceFiles(directory, output, dataPreparation && path.join(directory, 'data', '.fixture')), cases };
}

export async function runE2EReport({ data, out, root = process.cwd(), run: selectedIds = [], setupError }) {
  const manifest = await readJson(path.resolve(data));
  const ids = validateManifest(manifest);
  const selected = new Set(selectedIds.length ? selectedIds : ids);
  for (const id of selected) if (!ids.has(id)) throw new Error('Unknown E2E run: ' + id);

  const output = path.resolve(out);
  await fs.mkdir(output, { recursive: true });
  const artifacts = !setupError && await fs.mkdtemp(path.join(output, 'run-'));
  const setupLog = setupError && await fs.stat(path.join(output, 'setup.log')).catch(problem => {
    if (problem.code === 'ENOENT') return null;
    throw problem;
  });
  const runs = [];
  for (const run of manifest.runs) {
    const requested = selected.has(run.id);
    if (requested && !setupError) {
      const dataPreparation = run.dataPreparation ? manifest.dataPreparations[run.dataPreparation] : undefined;
      runs.push(await executeRun({ ...run, dataPreparation }, path.resolve(root), output, artifacts));
    } else {
      const error = requested && setupError ? setupError : undefined;
      runs.push({ id: run.id, label: run.label, engine: run.engine, environment: run.environment,
        status: error ? 'environment_error' : 'not_run', error,
        evidence: error && setupLog?.isFile() ? ['setup.log'] : [], cases: caseResults(run.cases, [], error) });
    }
  }
  const report = { schemaVersion: 1, project: manifest.project, generatedAt: new Date().toISOString(), runs };
  const html = path.join(output, 'index.html');
  const results = path.join(output, 'results.json');
  await withFileLock(path.join(output, '.report.lock'), async () => {
    const existing = await fs.readFile(html, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (existing && !existing.startsWith('<!-- OPEN-VIBECODING:E2E-REPORT -->')) throw new Error('Output directory already contains an unrelated index.html');
    const prior = await readJson(results).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (prior && (!Array.isArray(prior.runs) || prior.schemaVersion !== 1 || prior.project !== manifest.project)) {
      throw new Error('Output directory already contains unrelated results.json');
    }
    await atomicWriteJson(results, report);
    await atomicWriteText(html, renderE2EReport(report));
  });
  return { ok: runs.every(run => !selected.has(run.id) || outcomes.has(run.status)),
    html, results, runs: runs.map(({ id, status, dataPreparation }) => ({
      id, status, ...(dataPreparation && { dataPreparationStatus: dataPreparation.status }),
    })) };
}
