import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createSelfUpdateWorkspace } from '../src/self-update.js';

// 核心功能: 验证 Open VibeCoding CLI 自更新与 upgrade 编排，不触发真实安装。
// 输入: 注入的 package 信息、子进程 runner、PATH 解析结果和临时项目路径。
// 输出: 对 self-update / upgrade 阶段结果、命令参数和失败短路行为的断言。
// 定位: 覆盖 src/self-update.js 的纯 orchestration 逻辑。
// 依赖: node:test、临时目录和 createSelfUpdateWorkspace 的依赖注入接口。
// 维护规则: 不允许执行真实 npm install -g；新增场景必须继续用假 runner。

function fakePackageInfo() {
  return {
    name: 'open-vibecoding',
    version: '0.1.0',
    packageRoot: '/tmp/open-vibecoding-package',
    packageJsonPath: '/tmp/open-vibecoding-package/package.json',
  };
}

function fakeWorkspaceRegistry(entries = []) {
  return {
    registryPath: '/tmp/.open-vibecoding/registry/workspaces.jsonl',
    staleEntries: [],
    entries,
  };
}

function createWorkspaceWithCalls(options = {}) {
  const calls = [];
  const workspace = createSelfUpdateWorkspace({
    readPackageInfo: async () => fakePackageInfo(),
    isLocalSourceCheckout: async () => Boolean(options.localCheckout),
    resolveOpenPrdExecutable: async () => ({ ok: true, executable: '/tmp/bin/openprd', error: null }),
    readWorkspaceRegistry: async () => fakeWorkspaceRegistry(options.registryEntries),
    runCommand: async (command, args) => {
      calls.push({ command, args });
      if (command === 'npm' && args[0] === 'view') {
        const stdout = options.publishedVersionJson ?? JSON.stringify(options.publishedVersion ?? '0.1.0');
        return {
          ok: true,
          command,
          args,
          exitCode: 0,
          stdout,
          stderr: '',
        };
      }
      if (command === '/tmp/bin/openprd' && args[0] === '--version') {
        return {
          ok: true,
          command,
          args,
          exitCode: 0,
          stdout: options.installedVersion ?? '0.1.0',
          stderr: '',
        };
      }
      const ok = options.failInstall ? calls.length > 1 : !options.failAll;
      return {
        ok,
        command,
        args,
        exitCode: ok ? 0 : 1,
        stdout: '',
        stderr: ok ? '' : 'install failed',
      };
    },
  });
  return { calls, workspace };
}

async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-self-update-test-'));
  const project = path.join(dir, 'project');
  await fs.mkdir(project, { recursive: true });
  return project;
}

test('self-update dry-run plans the public npm install without running it', async () => {
  const { calls, workspace } = createWorkspaceWithCalls();

  const result = await workspace.selfUpdateWorkspace({ dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.skipReason, 'dry-run');
  assert.equal(result.installCommand.command, 'npm');
  assert.deepEqual(result.installCommand.args, ['install', '-g', 'open-vibecoding@latest']);
  assert.equal(calls.length, 0);
});

test('upgrade runs self-update before refreshing a single project with the resolved CLI', async () => {
  const project = await makeTempProject();
  const { calls, workspace } = createWorkspaceWithCalls();

  const result = await workspace.upgradeWorkspace(project, {
    tools: 'codex',
    hookProfile: 'guarded',
    force: true,
    json: true,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { command: 'npm', args: ['install', '-g', 'open-vibecoding@latest'] },
    { command: '/tmp/bin/openprd', args: ['--version'] },
    { command: '/tmp/bin/openprd', args: ['update', project, '--tools', 'codex', '--hook-profile', 'guarded', '--force', '--json'] },
  ]);
  assert.deepEqual(result.stages, { selfUpdateOk: true, projectRefreshOk: true });
});

test('upgrade fleet mode refreshes historical Open VibeCoding projects through fleet update', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-upgrade-fleet-test-'));
  const { calls, workspace } = createWorkspaceWithCalls();

  const result = await workspace.upgradeWorkspace(root, {
    fleet: true,
    tools: 'all',
    maxDepth: 2,
    include: 'client-*',
    exclude: 'archive',
    report: 'fleet-report.json',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls[2], {
    command: '/tmp/bin/openprd',
    args: ['fleet', root, '--update-open-vibecoding', '--max-depth', '2', '--include', 'client-*', '--exclude', 'archive', '--report', 'fleet-report.json', '--tools', 'all'],
  });
});

test('upgrade does not refresh projects when self-update fails', async () => {
  const project = await makeTempProject();
  const { calls, workspace } = createWorkspaceWithCalls({ failAll: true });

  const result = await workspace.upgradeWorkspace(project);

  assert.equal(result.ok, false);
  assert.deepEqual(result.stages, { selfUpdateOk: false, projectRefreshOk: false });
  assert.equal(result.projectRefresh.skipped, true);
  assert.equal(calls.length, 1);
});

test('self-update check reads the published version and lists older workspace refresh candidates', async () => {
  const { calls, workspace } = createWorkspaceWithCalls({
    publishedVersionJson: JSON.stringify(['0.1.10']),
    registryEntries: [
      {
        workspaceRoot: '/tmp/ws-a',
        workspaceName: 'ws-a',
        openprdVersion: '0.1.8',
      },
      {
        workspaceRoot: '/tmp/ws-b',
        workspaceName: 'ws-b',
        openprdVersion: '0.1.10',
      },
      {
        workspaceRoot: '/tmp/archive/ws-c',
        workspaceName: 'ws-c',
        openprdVersion: '0.1.7',
      },
    ],
  });

  const result = await workspace.selfUpdateWorkspace({ check: true });

  assert.equal(result.ok, true);
  assert.equal(result.checkOnly, true);
  assert.equal(result.publishedVersion, '0.1.10');
  assert.equal(result.comparison, 'behind');
  assert.equal(result.refreshCandidates.total, 2);
  assert.deepEqual(result.refreshCandidates.projects.map((item) => ({
    workspaceRoot: item.workspaceRoot,
    currentVersion: item.currentVersion,
    targetVersion: item.targetVersion,
    note: item.note,
  })), [
    {
      workspaceRoot: '/tmp/archive/ws-c',
      currentVersion: '0.1.7',
      targetVersion: '0.1.10',
      note: '归档项目，建议先确认',
    },
    {
      workspaceRoot: '/tmp/ws-a',
      currentVersion: '0.1.8',
      targetVersion: '0.1.10',
      note: '可直接处理',
    },
  ]);
  assert.deepEqual(calls, [
    { command: 'npm', args: ['view', 'open-vibecoding', 'version', '--json'] },
  ]);
});

test('self-update records installed version and refresh candidates after install', async () => {
  const { workspace } = createWorkspaceWithCalls({
    installedVersion: '0.1.10',
    registryEntries: [
      {
        workspaceRoot: '/tmp/ws-a',
        workspaceName: 'ws-a',
        openprdVersion: '0.1.9',
      },
    ],
  });

  const result = await workspace.selfUpdateWorkspace({});

  assert.equal(result.ok, true);
  assert.equal(result.installedVersion.version, '0.1.10');
  assert.equal(result.refreshCandidates.total, 1);
  assert.equal(result.refreshCandidates.projects[0].workspaceRoot, '/tmp/ws-a');
  assert.equal(result.nextActions[0], 'If you want to refresh older workspaces too, review the refreshCandidates list before running fleet or per-project updates.');
});
