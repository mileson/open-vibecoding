import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { initWorkspace, setupAgentIntegrationWorkspace } from '../../src/open-vibecoding.js';

export async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
}

export async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true, () => false);
}


export function runCodexHook(project, eventName, payload) {
  const result = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), eventName], {
    cwd: project,
    input: JSON.stringify({ cwd: project, ...payload }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export function runCodexHookWithoutCwd(project, eventName, payload, workingDirectory) {
  const result = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), eventName], {
    cwd: workingDirectory,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export async function makeCodexHookProject() {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await initWorkspace(project, {
    templatePack: 'agent',
  });
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });
  return { project, codexHome };
}

export async function seedReadyFrontendDesignArtifacts(project) {
  const activeDir = path.join(project, '.open-vibecoding', 'design', 'active');
  await fs.writeFile(path.join(activeDir, 'facts-sheet.md'), '# Facts\n\n- 开放时间：10:00-17:00\n- 中文语音导览：7 GBP\n');
  await fs.writeFile(path.join(activeDir, 'asset-spec.md'), '# Assets\n\n- 品牌资产：暂无官方素材，先用文字与中性色块表达\n');
  await fs.writeFile(path.join(activeDir, 'image-preflight.md'), '# Image preflight\n\n- 真实图片：已准备一组可用参考图\n');
  await fs.writeFile(path.join(activeDir, 'direction-plan.md'), '# Directions\n\n1. 导览叙事\n2. 编辑感故事\n3. 高密度工具\n');
  await fs.writeFile(path.join(activeDir, 'selected-direction.md'), '# Selected\n\n- lens: editorial-contrast\n- theme: warm-editorial\n- layout: story-map\n');
}

export async function seedDesignStarterEvent(project, output = 'index.html') {
  await fs.appendFile(
    path.join(project, '.open-vibecoding', 'state', 'events.jsonl'),
    `${JSON.stringify({
      type: 'design_starter_created',
      at: '2026-06-09 09:00:00',
      starterId: 'content-home',
      output,
    })}\n`,
  );
}

export async function writeCodexTranscript(project, sessionId, assistantText) {
  const transcriptDir = path.join(project, '.open-vibecoding', 'test-transcripts');
  await fs.mkdir(transcriptDir, { recursive: true });
  const transcriptPath = path.join(transcriptDir, `${sessionId}.jsonl`);
  await fs.writeFile(transcriptPath, `${JSON.stringify({
    timestamp: '2026-06-09T01:00:00.000Z',
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'assistant',
      phase: 'commentary',
      content: [{ type: 'output_text', text: assistantText }],
    },
  })}\n`);
  return transcriptPath;
}

export async function seedProjectKnowledgeSkill(project, skillName = 'billing-trace-rollback') {
  const skillDir = path.join(project, '.open-vibecoding', 'knowledge', 'skills', skillName);
  const skillPath = path.join(skillDir, 'SKILL.md');
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillPath, [
    '---',
    `name: ${skillName}`,
    'description: Use when the current task touches billing-api.js, traceId propagation, or webhook rollback and should reuse this verified project diagnosis path.',
    'use_when: Use when the current task touches billing-api.js, traceId propagation, or webhook rollback and should reuse this verified project diagnosis path.',
    '---',
    '',
    `# ${skillName}`,
    '',
    '## 触发条件',
    '- 修改 `src/billing-api.js`',
    '- 处理 traceId 透传',
    '- 修 webhook 回滚',
    '',
    '## 适用范围',
    '- 适用于支付链路里 traceId 透传、回滚修复和 webhook 对账排查。',
    '',
    '## 先看什么',
    '- `src/billing-api.js`',
    '- `docs/basic/backend-structure.md`',
    '',
    '## 不要直接套用',
    '- 如果当前任务只是同仓库里的别的支付逻辑改动，不要因为文件名相似就套用。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.open-vibecoding', 'knowledge', 'index.json'), `${JSON.stringify({
    version: 2,
    updatedAt: '2026-06-05 15:10:00',
    incidents: [],
    patterns: [],
    skills: [
      {
        skillName,
        path: skillPath,
        sourceKind: 'manual',
        sourceRef: 'seeded-test-skill',
        touchedFiles: ['src/billing-api.js'],
        triggerHints: ['traceId 透传', 'webhook 回滚'],
      },
    ],
    candidates: [],
    drafts: [],
  }, null, 2)}\n`);
}
