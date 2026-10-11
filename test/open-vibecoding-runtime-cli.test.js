import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const CLI = path.resolve('bin/open-vibecoding.js');

async function runCli(args, env) {
  const { stdout } = await execFileAsync(process.execPath, [CLI, ...args], {
    cwd: path.dirname(CLI),
    env: { ...process.env, ...env },
  });
  return JSON.parse(stdout);
}

test('runtime CLI creates, claims, heartbeats, and finishes a scoped task', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-runtime-cli-'));
  const project = path.join(root, 'project');
  const openprdHome = path.join(root, 'home');
  await fs.mkdir(project, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { OPEN_VIBECODING_HOME: openprdHome };

  const lane = await runCli([
    'runtime', project, '--action', 'create-lane', '--lane', 'lane-a', '--json',
  ], env);
  assert.equal(lane.ok, true);

  const added = await runCli([
    'runtime', project, '--action', 'add-task', '--lane', 'lane-a', '--task', 'task-a',
    '--write-set', 'src/**,test/**', '--json',
  ], env);
  assert.equal(added.result.task.status, 'pending');

  const claimed = await runCli([
    'runtime', project, '--action', 'claim', '--lane', 'lane-a', '--task', 'task-a',
    '--claim-id', 'claim-a', '--client', 'codex', '--session', 'session-a',
    '--write-set', 'src/**', '--lease-ms', '60000', '--json',
  ], env);
  assert.equal(claimed.result.task.status, 'claimed');
  assert.equal(claimed.result.claim.client, 'codex');

  const heartbeat = await runCli([
    'runtime', project, '--action', 'heartbeat', '--lane', 'lane-a', '--task', 'task-a',
    '--claim-id', 'claim-a', '--expected-revision', String(claimed.result.task.revision), '--json',
  ], env);
  assert.equal(heartbeat.result.claim.heartbeatSequence, 1);

  const finished = await runCli([
    'runtime', project, '--action', 'finish', '--lane', 'lane-a', '--task', 'task-a',
    '--claim-id', 'claim-a', '--status', 'completed', '--evidence', 'report.json', '--json',
  ], env);
  assert.equal(finished.result.task.status, 'completed');
  assert.deepEqual(finished.result.task.evidence, ['report.json']);
});

test('runtime CLI preserves structured write-set conflict codes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-runtime-conflict-'));
  const project = path.join(root, 'project');
  await fs.mkdir(project, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { OPEN_VIBECODING_HOME: path.join(root, 'home') };
  await runCli(['runtime', project, '--action', 'create-lane', '--lane', 'lane-a', '--json'], env);
  for (const taskId of ['task-a', 'task-b']) {
    await runCli([
      'runtime', project, '--action', 'add-task', '--lane', 'lane-a', '--task', taskId,
      '--write-set', 'src/**', '--json',
    ], env);
  }
  await runCli([
    'runtime', project, '--action', 'claim', '--lane', 'lane-a', '--task', 'task-a',
    '--claim-id', 'claim-a', '--write-set', 'src/**', '--json',
  ], env);
  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI, 'runtime', project, '--action', 'claim', '--lane', 'lane-a', '--task', 'task-b',
      '--claim-id', 'claim-b', '--write-set', 'src/run-harness.js', '--json',
    ], { cwd: path.dirname(CLI), env: { ...process.env, ...env } }),
    (error) => {
      const result = JSON.parse(error.stdout);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'OPEN_VIBECODING_WRITE_SET_CONFLICT');
      return true;
    },
  );
});
