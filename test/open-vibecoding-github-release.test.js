import test from 'node:test';
import { buildGitHubReleasePayload, writeGitHubReleaseNotes } from '../src/github-release.js';
import { assert, fs, path, initWorkspace, makeTempProject, releaseWorkspace } from './helpers/open-vibecoding-test-helpers.js';

test('github release payload renders from the matching release ledger entry', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    name: '@open-vibecoding/cli',
    version: '0.1.23',
    type: 'module',
  }, null, 2)}\n`);

  await releaseWorkspace(project, {
    setVersion: '0.1.23',
    notes: '新增 GitHub Release 发布说明自动渲染',
  });
  await releaseWorkspace(project, {
    notes: '优化版本发布流程，推 tag 后自动创建或更新 GitHub Release',
  });

  const payload = await buildGitHubReleasePayload(project, { tag: 'v0.1.23' });
  assert.equal(payload.ok, true);
  assert.equal(payload.version, '0.1.23');
  assert.equal(payload.tag, 'v0.1.23');
  assert.equal(payload.title, 'Open VibeCoding 0.1.23');
  assert.ok(payload.markdown.includes('npm install -g @open-vibecoding/cli@0.1.23'));
  assert.ok(payload.markdown.includes('GitHub Release'));

  const out = path.join(project, 'release-notes.md');
  const written = await writeGitHubReleaseNotes(project, { tag: 'v0.1.23', out });
  assert.equal(written.ok, true);
  assert.equal(written.out, out);
  assert.ok((await fs.readFile(out, 'utf8')).includes('## 本次更新'));
});

test('github release payload fails when the version is missing from the release ledger', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    name: '@open-vibecoding/cli',
    version: '0.1.23',
    type: 'module',
  }, null, 2)}\n`);

  await releaseWorkspace(project, {
    setVersion: '0.1.22',
    notes: '新增上一个版本的占位说明',
  });

  const payload = await buildGitHubReleasePayload(project, { tag: '0.1.23' });
  assert.equal(payload.ok, false);
  assert.ok(payload.error.includes('Missing release-ledger entry'));
});

test('new package release payload uses Open VibeCoding naming without rewriting legacy releases', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    name: 'open-vibecoding',
    version: '0.5.0',
    type: 'module',
  }, null, 2)}\n`);
  await releaseWorkspace(project, { setVersion: '0.5.0', notes: '新增统一产品入口' });

  const payload = await buildGitHubReleasePayload(project, { tag: 'v0.5.0' });
  assert.equal(payload.ok, true);
  assert.equal(payload.title, 'Open VibeCoding 0.5.0');
  assert.equal(payload.packageName, 'open-vibecoding');
  assert.ok(payload.markdown.includes('npm install -g open-vibecoding@0.5.0'));
});
