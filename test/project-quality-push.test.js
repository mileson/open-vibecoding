import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
const shellArg = value => "'" + value.replaceAll("'", "'\\''") + "'";

test('a real pre-push hook evaluates multiple outgoing refs instead of HEAD and preserves both attempts', async t => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-test-push-'));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const root = path.join(tmp, 'project');
  await fs.mkdir(root);
  const write = (target, data, options) => fs.writeFile(path.join(root, target), data, options);
  const shell = (command, args) => exec(command, args, { cwd: root, timeout: 30_000 });
  const git = async (...args) => (await shell('git', args)).stdout.trim();
  const config = {
    version: 1,
    checks: [{ id: 'picker', required: ['prepush'], argv: [process.execPath, 'check.mjs'] }],
  };
  async function commit(file) {
    await git('add', '.gitignore', 'check.mjs', 'open-vibecoding.quality.json');
    await git('-c', 'user.name=Verification', '-c', 'user.email=verification@example.invalid', 'commit', '-qm', file);
    return git('rev-parse', 'HEAD');
  }
  const runCli = (...args) => shell(process.execPath, [cli, 'project-quality', ...args]);
  async function reportList() {
    const dir = '.open-vibecoding/artifacts/project-quality';
    return (await fs.readdir(path.join(root, dir))).filter(name => name.includes('-push-')).sort()
      .map(name => path.join(dir, name, 'push.json'));
  }
  const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
  await git('init', '-q', '-b', 'main');
  await git('init', '--bare', '-q', path.join(tmp, 'upstream.git'));
  await git('remote', 'add', 'origin', path.join(tmp, 'upstream.git'));
  await write('.gitignore', '/.open-vibecoding/\n');
  await write('open-vibecoding.quality.json', JSON.stringify(config));
  await write('check.mjs', 'process.exit(0);\n');
  const seed = await commit('passing seed');
  await git('push', '-q', 'origin', 'main:review');
  await git('switch', '-c', 'picker');
  await write('check.mjs', 'process.exit(1);\n');
  const bad = await commit('broken snapshot');
  await git('switch', 'main');
  await write('.git/hooks/pre-push',
    '#!/bin/sh\nexec ' + shellArg(process.execPath) + ' ' + shellArg(cli) +
      ' project-quality pre-push --remote "$1" --expect picker\n',
    { mode: 0o755 });
  const blocked = await shell('git', ['push', 'origin', 'picker:review', 'main:refs/heads/extra']).catch(error => error);
  assert.equal(blocked.code, 1);
  assert.equal(await git('ls-remote', '--refs', 'origin', 'refs/heads/review'), seed + '\trefs/heads/review');
  assert.equal(await git('ls-remote', '--refs', 'origin', 'refs/heads/extra'), '');
  const [first] = await reportList();
  const failure = JSON.parse((await runCli('observe-push', '--report', first)).stdout);
  const failedRef = failure.refs.find(item => item.remoteRef === 'refs/heads/review');
  assert.equal(failedRef.commit, bad);
  assert.equal(failedRef.checks[0].status, 'failed');
  assert.equal(failure.refs.find(item => item.remoteRef === 'refs/heads/extra').checks[0].status, 'passed');
  assert.ok(failure.remoteObservation.refs.every(item => item.status === 'unchanged'));

  await git('switch', 'picker');
  await write('check.mjs', 'process.exit(0);\n');
  const fixed = await commit('repair snapshot');
  await git('switch', 'main');
  await write('check.mjs', 'process.exit(9);\n');
  await git('push', 'origin', 'picker:review', 'main:refs/heads/extra');
  const reports = await reportList();
  const second = reports.find(name => name !== first);
  assert.equal((await read(second)).remoteObservation, undefined);
  const verified = JSON.parse((await runCli('observe-push', '--report', second)).stdout);
  assert.equal(verified.status, 'ready');
  assert.equal(verified.counts.passed, 2);
  assert.ok(verified.remoteObservation.refs.every(item => item.status === 'matched'));
  assert.equal(await git('ls-remote', '--refs', 'origin', 'refs/heads/review'), fixed + '\trefs/heads/review');
  assert.match(await fs.readFile(path.join(root, verified.html), 'utf8'), /检查通过，可以推送/);
  assert.equal((await read(first)).status, 'blocked');
  assert.equal(await fs.readFile(path.join(root, 'check.mjs'), 'utf8'), 'process.exit(9);\n');

  await git('push', 'origin', ':refs/heads/extra');
  const deletion = (await reportList()).find(name => !reports.includes(name));
  const removed = JSON.parse((await runCli('observe-push', '--report', deletion)).stdout);
  assert.equal(removed.status, 'skipped');
  assert.equal(removed.remoteObservation.refs[0].status, 'deleted');
  await git('restore', 'check.mjs');
  await git('switch', '-c', 'no-required-check', 'picker');
  await write('open-vibecoding.quality.json', JSON.stringify({ version: 1, checks: [] }));
  await commit('remove required setup');
  const withoutRequired = await shell('git', ['push', 'origin', 'HEAD:refs/heads/missing']).catch(error => error);
  assert.equal(withoutRequired.code, 1);
  const missing = (await reportList()).find(name => ![...reports, deletion].includes(name));
  assert.equal((await read(missing)).refs[0].checks[0].status, 'missing');
  assert.equal(await git('ls-remote', '--refs', 'origin', 'refs/heads/missing'), '');

  await write('.git/hooks/pre-push',
    '#!/bin/sh\nexec ' + shellArg(process.execPath) + ' ' + shellArg(cli) +
      ' project-quality pre-push --remote "$1"\n', { mode: 0o755 });
  const unconfigured = await shell('git', ['push', 'origin', 'HEAD:refs/heads/missing']).catch(error => error);
  assert.equal(unconfigured.code, 1);
  const last = (await reportList()).find(name => ![...reports, deletion, missing].includes(name));
  assert.equal((await read(last)).status, 'unconfigured');

});
