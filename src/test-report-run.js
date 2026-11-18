import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareTestImport } from './test-report-import.js';

function selectedGroups(groups, requested) {
  const selection = new Set();
  function include(id) {
    if (selection.has(id)) return;
    const group = groups.get(id);
    if (!group) throw new Error('Unknown test group: ' + id);
    if (!group.runner) throw new Error(id + ': no test runner configured');
    selection.add(id);
    for (const dependency of group.dependsOn ?? []) include(dependency);
  }
  const targets = requested.length ? requested : [...groups.values()].filter(group => group.runner).map(group => group.id);
  for (const id of targets) include(id);
  if (!selection.size) throw new Error('No executable test groups');
  return [...groups.values()].filter(group => selection.has(group.id));
}

export function executeTestCommand(command, args, cwd, log, timeout, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', log.fd, log.fd], timeout, env });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
}

async function runGroup(group, root, artifactDir, cases, blockedBy, environment) {
  const groupId = group.id;
  const runId = path.basename(artifactDir) + '-' + groupId;
  const { argv, format, version, runnerVersion, timeoutMs } = group.runner;
  const runEnvironment = group.runner.environment ?? environment;
  const extension = { pytest: '.xml', xcresult: '.xcresult' }[format] ?? '.json';
  const artifact = path.join(artifactDir, groupId + extension);
  const logPath = path.join(artifactDir, groupId + '.log');
  const [command, ...args] = argv.map(argument => argument.replaceAll('{result}', () => artifact));
  const metadata = {
    groupId, phase: group.title, executedAt: new Date().toISOString(),
    command: [command, ...args].map(argument => JSON.stringify(argument)).join(' '),
    ...(version && { version }), ...(runnerVersion && { runnerVersion }),
    ...(runEnvironment !== undefined && { environment: runEnvironment }),
  };
  const blocked = detail => ({
    format, runId, metadata, source: logPath, sourceDigest: runId, items: [], issues: [{ status: 'blocked', detail }],
  });
  if (!cases.length || blockedBy.length) {
    const detail = !cases.length ? '此组暂未登记用例。' : '前置测试组未通过：' + blockedBy.join('、');
    await fs.writeFile(logPath, detail + '\n', { flag: 'wx' });
    return blocked(detail);
  }
  const log = await fs.open(logPath, 'wx');
  const start = performance.now();
  try {
    const { code, signal } = await executeTestCommand(command, args, root, log, timeoutMs);
    metadata.durationMs = Math.round(performance.now() - start);
    if (code !== null) metadata.exitCode = code;
    if (signal) metadata.status = 'cancelled';
    const result = await prepareTestImport({ format, result: artifact, runId, root });
    return { ...result, metadata: { ...metadata, evidence: logPath } };
  } catch (error) {
    await log.appendFile('\n' + error.message + '\n');
    return blocked('无法读取本组测试结果，详见运行日志。');
  } finally {
    await log.close();
  }
}

function succeeded(result, cases) {
  if (result.metadata.exitCode !== 0 || result.issues.length || !cases.length) return false;
  const expected = new Set(cases.map(entry => entry.testIds?.[result.format] ?? entry.id));
  const items = result.items.filter(item => !item.outsideKind);
  return items.length === cases.length && expected.size === cases.length &&
    items.every(item => item.status === 'passed' && expected.delete(item.testId));
}

export async function runUnitPlan({ data, plan, root, output, requested, jobs }) {
  const pending = selectedGroups(plan.groups, requested);
  const artifactDir = await fs.mkdtemp(path.join(path.dirname(path.resolve(output)), 'unit-run-'));
  const casesByGroup = new Map(pending.map(group => [group.id, []]));
  for (const entry of data.cases) casesByGroup.get(plan.rules.get(entry.ruleId))?.push(entry);
  const done = new Map();
  const active = new Map();
  while (pending.length || active.size) {
    for (const group of pending.slice()) {
      if (active.size >= jobs) break;
      const dependencies = group.dependsOn ?? [];
      if (!dependencies.every(id => done.has(id))) continue;
      const resources = new Set(group.resources ?? []);
      if (group.runner.format === 'xcresult') resources.add('apple-test-runner');
      if ([...active.values()].some(task => [...task.resources].some(resource => resources.has(resource)))) continue;
      pending.splice(pending.indexOf(group), 1);
      const blockedBy = dependencies.filter(id => !succeeded(done.get(id), casesByGroup.get(id)));
      const promise = runGroup(group, root, artifactDir, casesByGroup.get(group.id), blockedBy, data.environment)
        .then(result => ({ id: group.id, result }), error => ({ id: group.id, error }));
      active.set(group.id, { resources, promise });
    }
    if (!active.size) throw new Error('No test group can be scheduled');
    const { id, result, error } = await Promise.race([...active.values()].map(task => task.promise));
    active.delete(id);
    if (error) {
      await Promise.all([...active.values()].map(task => task.promise));
      throw error;
    }
    done.set(id, result);
  }
  const incomplete = [...done].filter(([id, result]) => !succeeded(result, casesByGroup.get(id))).map(([id]) => id);
  return { artifactDir, batches: [...done.values()], incomplete };
}
