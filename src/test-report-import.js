import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const IMPORT_FORMATS = ['xcresult', 'vitest', 'jest', 'pytest'];
const runTool = promisify(execFile);
const junitReader = fileURLToPath(new URL('./test-report-pytest.py', import.meta.url));
const nativeStatuses = new Map([
  ['passed', 'passed'], ['failed', 'failed'], ['skipped', 'skipped'], ['disabled', 'skipped'],
  ['excluded', 'skipped'], ['expected failure', 'skipped'], ['expected failures', 'skipped'],
  ['cancelled', 'cancelled'], ['canceled', 'cancelled'], ['interrupted', 'cancelled'],
  ['blocked', 'blocked'], ['pending', 'pending'], ['todo', 'pending'], ['notrun', 'pending'],
  ['not run', 'pending'], ['not executed', 'pending'], ['not supported', 'unsupported'],
  ['unsupported', 'unsupported'],
]);

const statusOf = value => nativeStatuses.get(String(value).toLowerCase()) ?? 'unknown';
const duration = (value, unit = 1) => Number.isFinite(value) && value >= 0 ? value * unit : undefined;
function epoch(value, unit = 1) {
  if (!Number.isFinite(value)) return;
  const date = new Date(value * unit);
  if (Number.isFinite(date.getTime())) return date.toISOString();
}
const list = value => Array.isArray(value) ? value : [];
const messages = values => list(values).filter(value => typeof value === 'string' && value.trim()).join('\n');
const time = (start, end, unit = 1) => Number.isFinite(start) && Number.isFinite(end)
  ? duration(end - start, unit) : undefined;

function readJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from ${label}: ${error.message}`);
  }
}

async function toolJson(command, args) {
  try {
    const { stdout } = await runTool(command, args, { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
    return readJson(stdout, command);
  } catch (error) {
    throw new Error(`${command} could not read the test artifact: ${error.stderr?.trim() || error.message}`);
  }
}

export function readJUnit(file) {
  return toolJson('python3', ['-I', junitReader, file]);
}

function metric(covered, total) {
  if (Number.isInteger(covered) && Number.isInteger(total) && covered >= 0 && total > 0 && covered <= total) {
    return { covered, total };
  }
}

function coverageFromSummary(total) {
  return Object.fromEntries(['lines', 'statements', 'functions', 'branches'].flatMap(name => {
    const value = metric(total?.[name]?.covered, total?.[name]?.total);
    return value ? [[name, value]] : [];
  }));
}

function coverageFromMap(map) {
  const counts = Object.fromEntries(['statements', 'functions', 'branches'].map(name => [name, { covered: 0, total: 0 }]));
  for (const file of Object.values(map ?? {})) {
    for (const [name, field] of [['statements', 's'], ['functions', 'f'], ['branches', 'b']]) {
      const hits = Object.values(file?.[field] ?? {}).flat().filter(value => Number.isFinite(value) && value >= 0);
      counts[name].covered += hits.filter(hit => hit > 0).length;
      counts[name].total += hits.length;
    }
  }
  return coverageFromSummary(counts);
}

function relativeFile(file, root) {
  if (typeof file !== 'string' || !file) return '';
  const posix = file.replaceAll('\\', '/');
  const posixRoot = /^[A-Za-z]:[/\\]/.test(root)
    ? root.replaceAll('\\', '/')
    : path.resolve(root).replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(posix)) return path.win32.relative(posixRoot, posix).replaceAll('\\', '/');
  if (!path.posix.isAbsolute(posix)) return path.posix.normalize(posix);
  const relative = path.posix.relative(posixRoot, posix);
  if (!(relative === '..' || relative.startsWith('../'))) return relative;
  try {
    return path.posix.relative(realpathSync(posixRoot), realpathSync(posix));
  } catch {
    return relative;
  }
}

function stackLocation(text, source, relative) {
  if (!source) return '';
  for (const line of text.split('\n')) {
    const index = line.lastIndexOf(source + ':');
    if (index === -1) continue;
    const position = line.slice(index + source.length).match(/^:\d+(?::\d+)?/);
    if (position) return relative + position[0];
  }
  return '';
}

function webResults(raw, root, format) {
  if (!Array.isArray(raw?.testResults)) throw new Error('Expected the JSON reporter testResults array');
  const items = [];
  const issues = [];
  let finishTime = raw.startTime;
  for (const suite of raw.testResults) {
    if (!Array.isArray(suite?.assertionResults)) throw new Error('Expected a suite assertionResults array');
    const file = relativeFile(suite.name, root);
    if (Number.isFinite(suite.endTime) && suite.endTime >= raw.startTime) {
      finishTime = Math.max(finishTime, suite.endTime);
    }
    if (suite.status === 'failed' && !suite.assertionResults.some(entry => entry.status === 'failed')) {
      issues.push({ status: 'blocked', detail: suite.message || `Test suite failed: ${file || 'unknown file'}` });
    }
    for (const entry of suite.assertionResults) {
      const name = entry.fullName || messages([...list(entry.ancestorTitles), entry.title]).replaceAll('\n', ' ');
      const assertion = list(entry.failureDetails).find(error => error?.matcherResult)?.matcherResult;
      const retryNotes = messages(entry.retryReasons);
      const reason = messages(entry.failureMessages);
      const declaration = entry.location?.line ? [file, entry.location.line, entry.location.column].filter(Boolean).join(':') : '';
      const location = stackLocation(reason, suite.name, file) || declaration;
      const status = format === 'jest' && entry.status === 'pending' ? 'skipped' : statusOf(entry.status);
      const observed = reason.match(/^Received:\s*(.+)$/m)?.[1];
      const expected = reason.match(/^Expected:\s*(.+)$/m)?.[1];
      items.push({
        testId: file && name ? `${file}::${name}` : undefined,
        title: name, status, nativeStatus: entry.status,
        actual: assertion && Object.hasOwn(assertion, 'actual') ? JSON.stringify(assertion.actual) : observed,
        matcherExpected: assertion && Object.hasOwn(assertion, 'expected') ? JSON.stringify(assertion.expected) : expected,
        reason, location,
        notes: retryNotes ? `运行器复测记录\n${retryNotes}` : undefined,
        executedAt: epoch(entry.startedAt ?? suite.startTime), durationMs: duration(entry.duration),
      });
    }
  }
  if (raw.wasInterrupted) issues.push({ status: 'cancelled', detail: '测试运行被中断' });
  if (raw.success === false && !issues.length && !items.some(item => item.status === 'failed')) {
    issues.push({ status: 'unknown', detail: '运行器报告执行未成功，详见原始结果' });
  }
  return {
    items, issues, coverage: coverageFromMap(raw.coverageMap),
    executedAt: epoch(raw.startTime), durationMs: finishTime > raw.startTime ? time(raw.startTime, finishTime) : undefined,
  };
}

function pytestResults(raw) {
  const items = raw.cases.map(entry => {
    const issue = entry.observations.find(item => ['error', 'failure', 'skipped'].includes(item.tag));
    const status = { error: 'blocked', failure: 'failed', skipped: 'skipped' }[issue?.tag] || 'passed';
    const notes = messages(entry.observations.map(item => item.text));
    const traceback = notes.match(/(?:^|\n)([^\n]+\.py:\d+):\s*(?:\w*Error|Failed|\w*Exception)/);
    return {
      testId: entry.name && `${entry.classname || ''}::${entry.name}`,
      title: entry.name, status, nativeStatus: issue?.tag || 'passed',
      reason: issue?.message, notes,
      location: traceback?.[1] || (entry.file ? [entry.file, entry.line === undefined ? '' : Number(entry.line) + 1].filter(Boolean).join(':') : ''),
      durationMs: duration(entry.time === undefined ? undefined : Number(entry.time), 1000),
    };
  });
  const [first] = raw.suites;
  const timestamp = first?.timestamp;
  return {
    items, issues: [],
    environment: first?.hostname ? { label: first.hostname } : undefined,
    executedAt: timestamp, durationMs: duration(first?.time === undefined ? undefined : Number(first.time), 1000),
  };
}

function xcodeCases(nodes, outsideKind = false) {
  return nodes.flatMap(node => node.nodeType === 'Test Case'
    ? [{ node, outsideKind }]
    : xcodeCases(list(node.children), outsideKind || node.nodeType === 'UI test bundle'));
}

function xcodeObservations(nodes) {
  return nodes.flatMap(node => [node, ...xcodeObservations(list(node.children))]);
}

function xcodeEnvironment(device, summary) {
  if (!device) return summary.environmentDescription || undefined;
  return {
    deviceModel: device.modelName || device.deviceName || '',
    deviceType: device.platform || '', osVersion: device.osVersion || '',
    notes: summary.environmentDescription || '',
  };
}

function xcodeResults(tree, summary) {
  if (!Array.isArray(tree.testNodes)) throw new Error('Expected xcresulttool tests output with testNodes');
  const byId = new Map();
  for (const failure of list(summary.testFailures)) {
    const identifier = failure.testIdentifierURL || failure.testIdentifierString;
    if (!identifier) continue;
    const failures = byId.get(identifier) || [];
    failures.push(failure);
    byId.set(identifier, failures);
  }
  const items = xcodeCases(tree.testNodes).map(({ node, outsideKind }) => {
    const status = statusOf(node.result);
    const failures = byId.get(node.nodeIdentifierURL) ?? byId.get(node.nodeIdentifier) ?? [];
    const observations = xcodeObservations(list(node.children));
    const diagnostics = observations.filter(child => child.nodeType === 'Failure Message');
    const locations = diagnostics.map(child => child.name?.match(/^(.+?\.swift:\d+(?::\d+)?):/)?.[1]);
    const notes = observations.map(child => [child.name, child.result, child.details].filter(Boolean).join(' · ')).join('\n');
    return {
      testId: node.nodeIdentifierURL || node.nodeIdentifier, title: node.name, status, nativeStatus: node.result,
      reason: messages(failures.map(failure => failure.failureText || failure.message)) || messages(diagnostics.map(child => child.name)),
      location: messages(failures.map(failure => failure.sourceURL || failure.sourceLocation?.url)) || messages(locations),
      notes, durationMs: duration(node.durationInSeconds, 1000), outsideKind,
    };
  });
  const overall = statusOf(summary.result);
  const issues = overall === 'failed' && !items.some(item => item.status === 'failed')
    ? [{ status: 'blocked', detail: 'Xcode 报告执行失败，详见原始结果' }] : [];
  const incomplete = {
    cancelled: '测试运行被中断',
    blocked: 'Xcode 报告测试执行受阻',
    unsupported: 'Xcode 报告当前执行不受支持',
    unknown: 'Xcode 未提供可识别的执行结论',
  };
  if (incomplete[overall]) issues.push({ status: overall, detail: incomplete[overall] });
  const devices = list(tree.devices);
  return {
    items, issues, executedAt: epoch(summary.startTime, 1000),
    durationMs: time(summary.startTime, summary.finishTime, 1000),
    environment: devices.length > 1
      ? devices.map(device => [device.modelName || device.deviceName, device.platform, device.osVersion].filter(Boolean).join(' ')).join(' / ')
      : xcodeEnvironment(devices[0], summary),
  };
}

async function readXcode(source) {
  const get = name => toolJson('xcrun', ['xcresulttool', 'get', 'test-results', name, '--path', source, '--compact']);
  // Coverage is independent of test outcomes and may be absent or unreadable.
  const available = await toolJson('xcrun', ['xcresulttool', 'get', 'content-availability', '--path', source]).catch(() => null);
  if (available?.hasTestResults === false) {
    const build = await toolJson('xcrun', ['xcresulttool', 'get', 'build-results', '--path', source]).catch(() => null);
    const blocked = Boolean(build?.errorCount || list(build?.errors).length || statusOf(build?.status) === 'failed');
    return {
      result: {
        items: [],
        environment: xcodeEnvironment(build?.destination, {}),
        executedAt: epoch(build?.startTime, 1000),
        durationMs: time(build?.startTime, build?.endTime, 1000),
        issues: [{ status: blocked ? 'blocked' : 'pending', detail: blocked ? '构建失败，测试未开始' : '结果包没有测试执行结果' }],
      },
      fingerprint: JSON.stringify([available, build]),
    };
  }
  const summary = await get('summary');
  const tree = await get('tests');
  const result = xcodeResults(tree, summary);
  let coverage;
  if (available?.hasCoverage) {
    coverage = await toolJson('xcrun', ['xccov', 'view', '--report', '--json', source]).catch(() => {
      result.issues.push({ status: 'unknown', detail: '结果包包含覆盖率，但读取失败' });
    });
    const lines = metric(coverage?.coveredLines, coverage?.executableLines);
    if (lines) result.coverage = { lines };
  }
  return { result, fingerprint: JSON.stringify([summary, tree, coverage]) };
}

export async function prepareTestImport({ format, result, runId, meta, root, coverage }) {
  if (!IMPORT_FORMATS.includes(format)) throw new Error(`--format must be one of ${IMPORT_FORMATS.join(', ')}`);
  const source = await fs.realpath(result);
  let normalized, fingerprint;
  if (format === 'xcresult') {
    if (!source.endsWith('.xcresult') || !(await fs.stat(source)).isDirectory()) throw new Error('Expected an .xcresult bundle');
    ({ result: normalized, fingerprint } = await readXcode(source));
  } else {
    fingerprint = await fs.readFile(source);
    normalized = format === 'pytest'
      ? pytestResults(await readJUnit(source))
      : webResults(readJson(fingerprint, source), root ?? process.cwd(), format);
  }
  const metadata = meta ? readJson(await fs.readFile(meta), meta) : {};
  const coverageSource = coverage ? await fs.realpath(coverage) : undefined;
  const externalCoverage = coverageSource
    ? coverageFromSummary(readJson(await fs.readFile(coverageSource), coverageSource)?.total) : {};
  if (coverageSource && !Object.keys(externalCoverage).length) throw new Error('Expected measured metrics under coverage summary total');
  const sourceDigest = createHash('sha256').update(fingerprint).digest('hex');
  return {
    format, source, runId, sourceDigest, metadata, coverageSource,
    ...normalized, coverage: { ...normalized.coverage, ...externalCoverage },
  };
}
