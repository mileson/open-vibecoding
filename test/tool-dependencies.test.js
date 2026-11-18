import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));

test('dependency check is read-only and ensure reuses a compatible project tool', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-tools-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const managedHome = path.join(root, 'managed');
  const env = { ...process.env, OPEN_VIBECODING_HOME: managedHome, PATH: '' };
  const run = (action, tool = 'playwright-cli') => spawnSync(process.execPath, [
    cli, 'tools', action, tool, '--root', root,
  ], { env, encoding: 'utf8' });

  const missing = run('check');
  assert.equal(missing.status, 1, missing.stderr);
  assert.equal(JSON.parse(missing.stdout).status, 'missing');
  await assert.rejects(fs.stat(managedHome), { code: 'ENOENT' });

  const packageDirectory = path.join(root, 'node_modules', 'playwright');
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.writeFile(path.join(packageDirectory, 'package.json'), JSON.stringify({ name: 'playwright', version: '1.65.1' }));
  await fs.writeFile(path.join(packageDirectory, 'cli.js'), `
    if (process.argv[2] !== 'cli') process.exit(1);
    console.log(process.argv[3] === '--help' ? 'Commands: open, snapshot' : '1.65.1');
  `);

  const ready = run('ensure');
  assert.equal(ready.status, 0, ready.stderr);
  const result = JSON.parse(ready.stdout);
  assert.equal(result.status, 'available');
  assert.equal(result.installation.source, 'project');
  assert.deepEqual(result.installation.args, [path.join(packageDirectory, 'cli.js'), 'cli']);
  await assert.rejects(fs.stat(managedHome), { code: 'ENOENT' });

  const unknown = run('ensure', 'unknown-package');
  assert.equal(unknown.status, 1);
  assert.equal(JSON.parse(unknown.stderr).status, 'error');
  await assert.rejects(fs.stat(managedHome), { code: 'ENOENT' });
});

test('Maestro check distinguishes Java, the installed CLI, and the selected iOS simulator', {
  skip: process.platform !== 'darwin',
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-maestro-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  await fs.mkdir(bin);
  const env = { ...process.env, JAVA_HOME: root, OPEN_VIBECODING_HOME: path.join(root, 'managed'), PATH: bin };
  const run = (...args) => spawnSync(process.execPath, [
    cli, 'tools', 'check', 'maestro', '--root', root, ...args,
  ], { env, encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).prerequisites.java.status, 'missing');

  await fs.writeFile(path.join(bin, 'java'), '#!/bin/sh\necho \'openjdk version "21.0.1"\' >&2\n', { mode: 0o700 });
  await fs.writeFile(path.join(bin, 'maestro'), '#!/bin/sh\necho 2.12.1\n', { mode: 0o700 });
  const device = { udid: 'target-device', isAvailable: true, state: 'Shutdown', name: 'iPhone' };
  const writeInventory = () => fs.writeFile(path.join(bin, 'xcrun'), `#!/bin/sh\necho '${JSON.stringify({
    devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [device] },
  })}'\n`, { mode: 0o700 });
  await writeInventory();

  result = run('--device', device.udid);
  assert.equal(result.status, 1);
  let report = JSON.parse(result.stdout);
  assert.equal(report.installation.version, '2.12.1');
  assert.equal(report.prerequisites.java.major, 21);
  assert.equal(report.prerequisites.simulator.status, 'not_ready');

  device.state = 'Booted';
  await writeInventory();
  result = run('--device', device.udid);
  assert.equal(result.status, 0, result.stderr);
  report = JSON.parse(result.stdout);
  assert.equal(report.prerequisites.simulator.status, 'ready');
  assert.equal(report.installation.command, path.join(bin, 'maestro'));
  await assert.rejects(fs.stat(env.OPEN_VIBECODING_HOME), { code: 'ENOENT' });
});
