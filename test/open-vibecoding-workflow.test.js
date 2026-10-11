import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { brainstormWorkspace, initWorkspace, setupAgentIntegrationWorkspace } from '../src/open-vibecoding.js';
import { guideWorkspace } from '../src/guide.js';
import { setupWorkspaceCapabilityEntry } from '../src/agent-integration.js';

const cli = path.resolve('bin/open-vibecoding.js');

test('new workspace does not seed PRD drafts, change files, or a workflow task graph', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-init-'));
  try {
    await initWorkspace(project, { tools: 'codex' });
    for (const relativePath of [
      '.open-vibecoding/engagements/active/prd.md',
      '.open-vibecoding/schema/prd.schema.yaml',
      '.open-vibecoding/state/task-graph.json',
      '.open-vibecoding/state/versions',
      '.open-vibecoding/changes',
    ]) {
      await assert.rejects(fs.stat(path.join(project, relativePath)), { code: 'ENOENT' });
    }
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('legacy PRD/change/tasks write implementations are removed without creating workspace files', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-retired-'));
  try {
    for (const args of [
      ['synthesize'],
      ['change', '--generate'],
      ['tasks', '--advance'],
      ['openspec-generate'],
      ['freeze'],
      ['handoff'],
      ['loop', '--plan'],
    ]) {
      const result = spawnSync(process.execPath, [cli, ...args, project, '--json'], { encoding: 'utf8' });
      assert.equal(result.status, 1, args.join(' '));
      assert.equal(JSON.parse(result.stdout).error.type, 'removed-workflow');
    }
    await assert.rejects(fs.stat(path.join(project, '.open-vibecoding')), { code: 'ENOENT' });
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('generated guidance and guide leave task decomposition to the Agent', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-guidance-'));
  try {
    await setupAgentIntegrationWorkspace(project, { tools: 'codex' });
    const agents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
    const catalog = await fs.readFile(path.join(project, '.open-vibecoding/harness/command-catalog.md'), 'utf8');
    const intake = await fs.readFile(path.join(project, '.open-vibecoding/harness/internal-skills/open-vibecoding-requirement-intake/SKILL.md'), 'utf8');
    const testing = await fs.readFile(path.join(project, '.open-vibecoding/harness/internal-skills/open-vibecoding-test-strategy/SKILL.md'), 'utf8');
    assert.ok(agents.includes('Agent 自主理解、拆解、执行和验证'));
    assert.ok(agents.includes('不要求生成 requirement、PRD、review.html、change 或 tasks'));
    assert.ok(intake.includes('不运行 `capture -> classify -> synthesize -> review -> change -> tasks`'));
    assert.ok(testing.includes('不要求创建 tasks、evidence-plan、Markdown/HTML 测试报告'));
    assert.ok(!catalog.includes('change . --generate'));
    const guide = await guideWorkspace(project);
    assert.equal(guide.mode, 'contextual');
    assert.equal(guide.totalStages, null);
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('a complex prompt does not create a requirement gate or PRD state', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-hook-'));
  try {
    await setupAgentIntegrationWorkspace(project, { tools: 'codex' });
    const hook = path.join(project, '.codex/hooks/open-vibecoding-hook.mjs');
    const result = spawnSync(process.execPath, [hook, 'UserPromptSubmit'], {
      input: JSON.stringify({
        cwd: project,
        session_id: 'complex-prompt-test',
        prompt: '请实现一个新的多角色审批工作流，包含权限、通知和失败恢复。',
      }),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout);
    assert.equal(response.continue, true);
    assert.ok(response.hookSpecificOutput.additionalContext.includes(path.join(project, '.open-vibecoding/harness/internal-skills/open-vibecoding-router/SKILL.md')));
    assert.ok(response.hookSpecificOutput.additionalContext.includes('真实用户业务结果'));
    await assert.rejects(fs.stat(path.join(project, '.open-vibecoding/harness/requirement-gates/complex-prompt-test.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(project, '.open-vibecoding/state/versions')), { code: 'ENOENT' });
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});

test('workspace entry resolves installed child skills and preserves custom rules', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-workspace-entry-'));
  try {
    const project = path.join(workspace, 'app');
    await setupAgentIntegrationWorkspace(project, { tools: 'codex' });
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), '用户自定义规则\n');
    await setupWorkspaceCapabilityEntry(workspace, [project]);
    await setupWorkspaceCapabilityEntry(workspace, [project]);
    const guidance = await fs.readFile(path.join(workspace, 'AGENTS.md'), 'utf8');
    assert.ok(guidance.startsWith('用户自定义规则'));
    assert.equal(guidance.split('OPEN_VIBECODING:WORKSPACE:START').length, 2);
    assert.ok(guidance.includes('app/.open-vibecoding/harness/internal-skills/open-vibecoding-router/SKILL.md'));
    const agents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes('`.open-vibecoding/harness/internal-skills/open-vibecoding-router/SKILL.md`'));
    assert.ok(!agents.includes('`skills/open-vibecoding-router/SKILL.md`'));
    await assert.rejects(setupWorkspaceCapabilityEntry(workspace, [path.dirname(workspace)]));
    await assert.rejects(fs.stat(path.join(workspace, '.open-vibecoding')), { code: 'ENOENT' });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

test('brainstorm produces its own artifact without advancing legacy current state', async () => {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-brainstorm-'));
  try {
    await initWorkspace(project, { tools: 'codex' });
    const currentPath = path.join(project, '.open-vibecoding/state/current.json');
    const before = await fs.readFile(currentPath, 'utf8');
    const result = await brainstormWorkspace(project, { topic: '新产品机会', json: true, open: false });
    assert.ok(result.htmlPath);
    assert.equal(await fs.readFile(currentPath, 'utf8'), before);
    assert.ok((await fs.stat(result.htmlPath)).isFile());
  } finally {
    await fs.rm(project, { recursive: true, force: true });
  }
});
