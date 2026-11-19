import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-knowledge-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const global = path.join(root, 'shared');
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  for (const dir of [global, path.join(first, 'docs'), path.join(second, 'docs')]) {
    await fs.mkdir(dir, { recursive: true });
  }
  function command(project, ...args) {
    const run = spawnSync(process.execPath, [cli, 'knowledge', ...args, '--json', '--path', project], {
      env: { ...process.env, OPEN_VIBECODING_HOME: home }, encoding: 'utf8',
    });
    assert.ok(run.stdout, run.stderr);
    return { status: run.status, ...JSON.parse(run.stdout) };
  }
  function bind(project, scope, domain, id, source) {
    return command(project, 'bind', '--scope', scope, '--domain', domain, '--id', id, '--source', source, '--type', 'markdown');
  }
  return { home, global, first, second, command, bind };
}

test('empty setup asks for sources and queries both levels with source and quote', async t => {
  const { command, bind, global, first, second } = await fixture(t);
  const empty = command(first, 'search', '回归');
  assert.equal(empty.configured, false);
  assert.match(empty.hint, /请指定/);
  await fs.writeFile(path.join(global, '规范.md'), '# 验收\n\n全局回归需要记录复验入口。');
  await fs.writeFile(path.join(first, 'docs', '规范.md'), '# 验收\n\n项目回归需要验证离线恢复。');
  await fs.writeFile(path.join(second, 'docs', '规范.md'), '另一个项目的回归步骤。');
  assert.equal(bind(first, 'global', 'testing', 'qa', global).status, 0);
  assert.equal(bind(first, 'project', 'testing', 'notes', 'docs').status, 0);
  assert.equal(bind(first, 'project', 'testing', 'notes', 'docs').status, 0);
  assert.equal(bind(second, 'project', 'product', 'notes', 'docs').status, 0);

  const search = command(first, 'search', '回归', '--domain', 'testing');
  assert.equal(search.partial, false);
  assert.deepEqual(search.matches.map(item => item.scope), ['project', 'global']);
  assert.deepEqual(search.matches.map(item => item.excerpt), ['项目回归需要验证离线恢复。', '全局回归需要记录复验入口。']);
  assert.equal(search.matches[0].section, '验收');
  assert.equal(search.matches[0].line, 3);
  assert.deepEqual(command(second, 'search', '回归', '--domain', 'testing').matches.map(item => item.scope), ['global']);
  assert.equal(command(second, 'search', '回归', '--domain', 'product').matches[0].excerpt, '另一个项目的回归步骤。');
  assert.equal(command(first, 'check').sources.length, 2);
  assert.equal(command(first, 'candidates').ok, true);
});

test('missing sources, invalid shared config and out-of-tree links preserve remaining coverage', async t => {
  const { command, bind, global, first } = await fixture(t);
  await fs.writeFile(path.join(global, 'private.md'), '只用于全局查询。');
  await fs.symlink(global, path.join(first, 'escape'));
  const invalid = bind(first, 'project', 'engineering', 'outside', 'escape');
  assert.equal(invalid.status, 1);
  assert.match(invalid.error, /项目外/);
  const local = bind(first, 'project', 'engineering', 'private', global);
  assert.equal(local.binding.storage, 'local');
  assert.ok(!local.file.startsWith(first));
  assert.equal(bind(first, 'project', 'engineering', 'docs', 'docs').ok, true);
  await fs.symlink(path.join(global, 'private.md'), path.join(first, 'docs', 'linked.md'));
  const isolated = command(first, 'search', '全局', '--scope', 'project');
  assert.deepEqual(isolated.matches.map(item => item.id), ['private']);

  await fs.rm(path.join(first, 'docs'), { recursive: true });
  const check = command(first, 'check');
  assert.equal(check.status, 1);
  assert.equal(check.sources.find(item => item.id === 'docs').status, 'unavailable');
  const partial = command(first, 'search', '全局');
  assert.equal(partial.partial, true);
  assert.equal(partial.matches.length, 1);

  const sharedFile = path.join(first, '.open-vibecoding', 'knowledge', 'bindings.json');
  await fs.writeFile(sharedFile, JSON.stringify({ version: 1, bindings: [
    { id: 'unexpected', type: 'feishu', domain: 'engineering', source: 'https://example.feishu.cn/wiki/root', profile: 'unapproved', identity: 'user' },
  ] }));
  assert.equal(command(first, 'check').configs.find(item => item.storage === 'shared').status, 'invalid');
});
