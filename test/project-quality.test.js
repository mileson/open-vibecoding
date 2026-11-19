import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { initWorkspace } from '../src/open-vibecoding.js';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));

async function project(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-project-quality-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const write = (name, value) => fs.writeFile(path.join(root, name), typeof value === 'string' ? value : JSON.stringify(value));
  const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
  const git = async (...args) => (await exec('git', args, { cwd: root })).stdout.trim();
  async function commit(message) {
    await git('add', '.');
    await git('-c', 'user.name=Verification', '-c', 'user.email=verification@example.invalid', 'commit', '-qm', message);
    return git('rev-parse', 'HEAD');
  }
  async function run(...args) {
    const result = await exec(process.execPath, [cli, 'project-quality', ...args], { cwd: root }).catch(error => error);
    return { exit: result.code ?? 0, outcome: JSON.parse(result.stdout) };
  }
  await git('init', '-q');
  await write('.gitignore', '/.open-vibecoding/\n/.codex/\n/.claude/\n');
  return { root, write, read, git, commit, run };
}

test('init indexes mixed modules and candidate checks can fail, recover, skip, or be missing', async t => {
  const fixture = await project(t);
  const { root, write, read, git, commit, run } = fixture;
  await fs.mkdir(path.join(root, 'web'));
  await fs.mkdir(path.join(root, 'backend'));
  await write('web/package.json', { scripts: { lint: 'eslint .', test: 'vitest run' } });
  await write('backend/pyproject.toml', '[tool.ruff]\n[tool.pytest.ini_options]\n');
  await write('web/expected', 'broken');
  await write('README.md', '# App\n');
  await write('open-vibecoding.quality.json', {
    version: 1,
    checks: [{
      id: 'web.required', module: 'web', paths: ['web'], required: ['pr', 'precommit'],
      argv: [process.execPath, '-e', 'process.exit(require("fs").readFileSync("expected", "utf8") === "good" ? 0 : 1)'],
    }],
    rules: [{ id: 'PICKER', title: 'Pick photos', source: 'README.md', cases: [{ id: 'limit', checks: ['web.required'] }] }],
  });
  const initialized = await initWorkspace(root, { tools: 'codex', enableUserCodexConfig: false });
  const indexPath = initialized.projectQuality.index;
  assert.match(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), /quality\/SKILL\.md/);
  assert.ok((await fs.readFile(path.join(root, '.gitignore'), 'utf8')).includes(indexPath));
  const inventory = await read(indexPath);
  assert.deepEqual(inventory.modules.flatMap(module => module.ecosystems).sort(), ['javascript', 'python']);
  assert.deepEqual(inventory.rules[0].cases[0].checks, ['web.required']);
  assert.ok(inventory.checks.some(check => check.id === 'backend:py:lint'));
  await commit('candidate with a broken assertion');

  const failed = await run('run', '--profile', 'pr', '--expect', 'web.required');
  assert.equal(failed.exit, 1);
  assert.equal(failed.outcome.results[0].status, 'failed');
  assert.ok(failed.outcome.results[0].snapshot.commit);

  await write('web/expected', 'good');
  await git('add', 'web/expected');
  await write('web/expected', 'unstaged');
  const blocked = await run('run', '--profile', 'precommit', '--expect', 'web.required');
  assert.equal(blocked.exit, 1);
  assert.equal(blocked.outcome.results[0].status, 'blocked');
  await write('web/expected', 'good');
  await write('README.md', '# Unrelated work still unstaged\n');
  const staged = await run('run', '--profile', 'precommit', '--expect', 'web.required');
  assert.equal(staged.exit, 0);
  assert.equal(staged.outcome.results[0].status, 'passed');
  assert.equal(staged.outcome.results[0].snapshot.unstagedTracked, true);
  assert.deepEqual(staged.outcome.results[0].scope, ['web']);

  const fixed = await commit('candidate with the fix');
  const passed = await run('run', '--profile', 'pr', '--expect', 'web.required');
  assert.equal(passed.exit, 0);
  assert.equal(passed.outcome.results[0].status, 'passed');

  await write('README.md', '# App notes\n');
  await commit('unrelated documentation');
  const skipped = await run('run', '--profile', 'pr', '--base', fixed, '--expect', 'web.required');
  assert.equal(skipped.exit, 0);
  assert.equal(skipped.outcome.results[0].status, 'skipped');
  assert.ok(skipped.outcome.results[0].reason);

  const filtered = await run('run', '--profile', 'pr', '--check', 'web.required');
  assert.equal(filtered.exit, 0);
  assert.deepEqual(filtered.outcome.results.map(item => item.checkId), ['web.required']);

  const missing = await run('run', '--profile', 'pr', '--expect', 'removed.required');
  assert.equal(missing.exit, 1);
  assert.equal(missing.outcome.results.find(item => item.checkId === 'removed.required').status, 'missing');
  assert.equal((await read(failed.outcome.results[0].record)).status, 'failed');
  assert.equal((await read(indexPath)).latestExecuted['web.required'].status, 'passed');
});

test('registered E2E checks require the requested native run and preserve failure type', async t => {
  const { write, run } = await project(t);
  const checks = ['assertion_failed', 'environment_error', 'not_run', 'passed'].map(status => ({
    id: status,
    reportRuns: ['selected'],
    argv: [process.execPath, '-e',
      'require("fs").writeFileSync(process.argv[1] + "/results.json", JSON.stringify({runs:[{id:"selected",status:process.argv[2]}]}))',
      '{artifacts}', status],
  }));
  await write('open-vibecoding.quality.json', { version: 1, checks });
  const result = await run('run', ...checks.flatMap(check => ['--check', check.id]));
  assert.equal(result.exit, 1);
  assert.deepEqual(result.outcome.results.map(item => item.status), ['failed', 'blocked', 'blocked', 'passed']);
  assert.equal(result.outcome.results[0].evidence.runs[0].status, 'assertion_failed');
});
