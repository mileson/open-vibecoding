import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJsonIfExists, withFileLock } from './kernel/atomic-store.js';
import { executeTestCommand } from './test-report-run.js';
import { writePushReport } from './project-quality-push-report.js';

const exec = promisify(execFile);
const settings = 'open-vibecoding.quality.json';
const zero = /^0+$/;
const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const stamp = () => new Date().toISOString();
const fingerprint = value => createHash('sha256').update(value).digest('hex');

async function git(root, args, env = process.env) {
  const { stdout } = await exec('git', args, { cwd: root, env, maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
  return stdout;
}

async function readRefs(input = process.stdin) {
  if (input.isTTY) throw new Error('Pass Git pre-push input on stdin.');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of input) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 1024 * 1024) throw new Error('Git pre-push input exceeds 1 MiB.');
    chunks.push(Buffer.from(chunk));
  }
  const lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean);
  const seen = new Set();
  return lines.map(line => {
    const [localRef, object, remoteRef, previous, extra] = line.split(' ');
    if (!localRef || !oid.test(object) || !remoteRef?.startsWith('refs/') ||
        /[\x00-\x20]/.test(remoteRef) || !oid.test(previous) || object.length !== previous.length ||
        extra !== undefined || seen.has(remoteRef) || (localRef === '(delete)') !== zero.test(object)) {
      throw new Error('Invalid or duplicate ref in Git pre-push input.');
    }
    seen.add(remoteRef);
    return {
      localRef, remoteRef, object: zero.test(object) ? null : object,
      previousOid: zero.test(previous) ? null : previous,
    };
  });
}

async function prepareSnapshot(root, preparation, output, env) {
  if (preparation === undefined) return;
  const { argv, timeoutMs = 300_000 } = preparation ?? {};
  if (!Array.isArray(argv) || !argv.length || argv.some(arg => typeof arg !== 'string' || !arg) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid prepush.prepare command.');
  const handle = await fs.open(output, 'wx');
  try {
    const [command, ...args] = argv;
    const result = await executeTestCommand(command, args, root, handle, timeoutMs, env);
    if (result.code !== 0) throw new Error('Snapshot preparation failed. See prepare.log.');
  } finally {
    await handle.close();
  }
}

async function runRef(root, ref, directory, values, runChecks) {
  try {
    await git(root, ['check-ref-format', ref.remoteRef]);
  } catch {
    return { ...ref, status: 'blocked', commit: null, checks: [], reason: 'Invalid target ref.' };
  }
  if (!ref.object) return { ...ref, status: 'skipped', commit: null, checks: [], reason: '删除引用，无提交可检查。' };

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-prepush-'));
  let commit = null;
  let prepareLog;
  try {
    const tree = await fs.realpath(temp);
    const checkout = path.join(tree, 'checkout');
    await fs.mkdir(checkout);
    const isolatedEnv = { ...process.env };
    for (const name of (await git(root, ['rev-parse', '--local-env-vars'])).trim().split('\n')) {
      delete isolatedEnv[name];
    }
    const indexEnv = {
      ...isolatedEnv, GIT_INDEX_FILE: path.join(tree, 'index'),
      GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1',
    };
    const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
    const indexGit = (...args) => git(root, [
      '--git-dir', gitDir, '--work-tree', checkout, '-c', 'core.sparseCheckout=false', ...args,
    ], indexEnv);
    commit = (await indexGit('rev-parse', '--verify', ref.object + '^{commit}')).trim();
    await indexGit('read-tree', commit);
    const staged = await indexGit('ls-files', '--stage', '-z');
    if (staged.split('\0').some(line => line.startsWith('160000 '))) {
      throw new Error('The commit contains submodules. No isolated submodule checkout was prepared.');
    }
    await indexGit('checkout-index', '--all', '--index');
    const base = { commit, tree: (await indexGit('rev-parse', commit + '^{tree}')).trim(), isolated: true };
    const inspect = async () => {
      const trackedChanges = await indexGit('diff-files', '--name-only', '-z');
      return trackedChanges ? { ...base, changed: true } : base;
    };
    if ((await inspect()).changed) throw new Error('The materialized checkout differs from the pushed commit.');
    const file = path.join(checkout, settings);
    const stat = await fs.lstat(file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat && !stat.isFile()) throw new Error('The project quality configuration must be a tracked regular file.');
    const config = await readJsonIfExists(file, null);
    if (config?.prepush?.prepare !== undefined) {
      prepareLog = path.posix.join(directory, 'prepare.log');
      await prepareSnapshot(checkout, config.prepush.prepare, path.join(root, prepareLog), isolatedEnv);
      if ((await inspect()).changed) throw new Error('Preparation modified tracked files in the pushed commit.');
    }
    if (!values.expect?.length && !config?.checks?.some(check => check?.required?.includes('prepush'))) {
      return { ...ref, commit, status: 'unconfigured', checks: [], reason: '该提交未登记推送前必过检查。' };
    }
    const report = await runChecks(checkout, { profile: 'prepush', expect: values.expect }, {
      outputRoot: root, snapshot: base, inspect, env: isolatedEnv,
      push: { localRef: ref.localRef, remoteRef: ref.remoteRef, previousOid: ref.previousOid, object: ref.object },
    });
    return { ...ref, commit, status: report.ok ? 'passed' : 'blocked', checks: report.results,
      ...(prepareLog && { prepareLog }) };
  } catch (error) {
    const reason = error.cmd?.startsWith('git ') ? 'Unable to materialize or verify the pushed Git object.' : error.message;
    return { ...ref, commit, status: 'blocked', checks: [], reason, ...(prepareLog && { prepareLog }) };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function pushDestination(root, name) {
  if (!name || !/^[\w./-]+$/.test(name) || name.startsWith('-')) return null;
  const remotes = (await git(root, ['remote'])).trim().split('\n');
  if (!remotes.includes(name)) return null;
  const urls = (await git(root, ['remote', 'get-url', '--push', '--all', name])).trim().split('\n');
  return urls.length === 1 && urls[0] ? urls[0] : null;
}

function countChecks(refs) {
  const counts = { total: 0, passed: 0, failed: 0, blocked: 0, missing: 0, skipped: 0 };
  for (const ref of refs) {
    for (const check of ref.checks) {
      counts.total++;
      counts[check.status]++;
    }
  }
  return counts;
}

export async function handlePrePush(root, values, { runChecks, writeIndex, runsDir }) {
  const startedAt = stamp();
  const started = performance.now();
  const directory = path.posix.join(runsDir, startedAt.replaceAll(':', '-') + '-push-' + randomUUID());
  await fs.mkdir(path.join(root, directory), { recursive: true });
  const refs = [];
  let reason;
  let remote;
  try {
    const actualRoot = await fs.realpath((await git(root, ['rev-parse', '--show-toplevel'])).trim());
    if (actualRoot !== root) throw new Error('Use the repository root for project-quality pre-push.');
    const pending = await readRefs();
    const destination = await pushDestination(root, values.remote);
    if (destination) remote = { name: values.remote, destinationFingerprint: fingerprint(destination) };
    for (const [offset, ref] of pending.entries()) {
      const refDir = path.posix.join(directory, String(offset + 1));
      await fs.mkdir(path.join(root, refDir));
      refs.push(await runRef(root, ref, refDir, values, runChecks));
    }
  } catch (error) {
    reason = error.cmd?.startsWith('git ') ? 'Unable to read the repository for pre-push.' : error.message;
  }

  let status = 'ready';
  if (reason || refs.some(ref => ref.status === 'blocked')) status = 'blocked';
  else if (refs.some(ref => ref.status === 'unconfigured')) status = 'unconfigured';
  else if (refs.every(ref => ref.status === 'skipped')) status = 'skipped';
  const result = {
    version: 1, stage: 'prepush', status, ok: ['ready', 'skipped'].includes(status),
    startedAt, finishedAt: stamp(), durationMs: Math.round(performance.now() - started), reason, refs, counts: countChecks(refs), remote,
    report: path.posix.join(directory, 'push.json'), html: path.posix.join(directory, 'index.html'),
  };
  await writePushReport(root, result);
  await writeIndex(root).catch(() => {});
  return result;
}

export async function observePush(root, report, runsDir) {
  const input = await fs.realpath(path.resolve(root, report));
  const relative = path.relative(root, input).split(path.sep).join('/');
  if (!relative.startsWith(runsDir + '/') || path.basename(input) !== 'push.json') {
    throw new Error('Select a push.json report produced inside this project.');
  }
  return withFileLock(input + '.lock', async () => {
    const data = await readJsonIfExists(input);
    if (!data?.remote || data.stage !== 'prepush' || data.report !== relative ||
        data.html !== path.posix.join(path.posix.dirname(relative), 'index.html')) {
      throw new Error('This report does not identify a single named push destination.');
    }
    const destination = await pushDestination(root, data.remote.name);
    if (!destination || fingerprint(destination) !== data.remote.destinationFingerprint) {
      throw new Error('The configured push destination changed. Use the original remote.');
    }
    if (!data.refs.length) throw new Error('This report has no refs to read back.');
    const observed = new Map();
    try {
      const refs = await git(root, ['ls-remote', '--refs', '--', destination, ...data.refs.map(ref => ref.remoteRef)]);
      for (const line of refs.trim().split('\n')) {
        const [object, ref] = line.split('\t');
        if (oid.test(object) && ref) observed.set(ref, object);
      }
    } catch {
      throw new Error('Unable to read the original push destination.');
    }
    const observation = { observedAt: stamp(), refs: data.refs.map(ref => {
      const observedOid = observed.get(ref.remoteRef) ?? null;
      const status = observedOid === ref.object ? (ref.object ? 'matched' : 'deleted') :
        observedOid === ref.previousOid ? 'unchanged' : 'different';
      return { remoteRef: ref.remoteRef, observedOid, status };
    }) };
    data.remoteObservations = [...(data.remoteObservations ?? []), observation];
    data.remoteObservation = observation;
    await writePushReport(root, data);
    return data;
  });
}
