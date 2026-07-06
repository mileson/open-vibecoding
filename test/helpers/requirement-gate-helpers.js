import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  captureWorkspace,
  initWorkspace,
  reviewPresentationWorkspace,
  setupAgentIntegrationWorkspace,
  synthesizeWorkspace as synthesizeWorkspaceBase,
} from '../../src/openprd.js';

export async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
}

export async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true, () => false);
}

export function validReviewPresentation(seed = {}) {
  return {
    mapNodes: {
      problem: { title: '问题定义', text: '确认核心问题' },
      goal: { title: '目标', text: '确认目标结果' },
      scope: { title: '范围', text: '确认交付边界' },
      flow: { title: '流程', text: '确认主线步骤' },
      risk: { title: '风险', text: '确认风险问题' },
      ...(seed.mapNodes ?? {}),
    },
    flowNodes: seed.flowNodes ?? [
      { text: '确认入口' },
      { text: '执行主步骤' },
      { text: '校验结果' },
      { text: '处理批量场景' },
    ],
    panels: {
      flow: [{ summary: '主线确认', detail: '用户能看懂入口、步骤和结果。' }],
      function: [{ summary: '功能确认', detail: '必须交付项和约束保持清晰。' }],
      guardrail: [{ summary: '护栏确认', detail: '成本、滥用和止损边界可见。' }],
      risk: [{ summary: '风险确认', detail: '开放问题和失败路径保留。' }],
      ...(seed.panels ?? {}),
    },
  };
}

export async function writeValidReviewPresentation(project, versionId, seed = {}) {
  const presentationPath = path.join(project, `review-presentation-${versionId}.json`);
  await fs.writeFile(presentationPath, JSON.stringify({
    reviewPresentation: validReviewPresentation(seed),
  }, null, 2));
  const result = await reviewPresentationWorkspace(project, {
    version: versionId,
    presentationPath,
    write: true,
  });
  assert.equal(result.ok, true, JSON.stringify(result.presentationFeedback, null, 2));
  return result;
}

export async function synthesizeWorkspace(project, options = {}) {
  const result = await synthesizeWorkspaceBase(project, options);
  await writeValidReviewPresentation(project, result.snapshot.versionId, result.snapshot.reviewPresentation ?? {});
  return {
    ...result,
    reviewPresentationRequired: false,
  };
}

export async function captureFreshRequirementState(
  project,
  value = '用户已经确认了本轮需求的核心信息。',
  options = {}
) {
  const productType = options.productType ?? 'agent';
  const typeSpecificCaptures = productType === 'consumer'
    ? [
        ['typeSpecific.fields.persona', '希望展示自己经历与内容的个人创作者。'],
        ['typeSpecific.fields.segment', '首次访问者与回访读者。'],
        ['typeSpecific.fields.journey', ['进入首页', '阅读内容', '决定联系']],
        ['typeSpecific.fields.activationMetric', '访客完成一次详情阅读或联系点击。'],
        ['typeSpecific.fields.retentionMetric', '访客会因为内容更新而再次访问。'],
      ]
    : productType === 'b2b'
      ? [
          ['typeSpecific.fields.buyer', '业务负责人'],
          ['typeSpecific.fields.user', '一线使用者'],
          ['typeSpecific.fields.admin', '系统管理员'],
          ['typeSpecific.fields.operator', '流程运营者'],
          ['typeSpecific.fields.roles', ['业务负责人', '使用者', '管理员']],
          ['typeSpecific.fields.asIs', '当前流程依赖人工串联。'],
          ['typeSpecific.fields.toBe', '未来流程由产品统一承接。'],
          ['typeSpecific.fields.permissionMatrix', '按角色控制查看与操作权限。'],
          ['typeSpecific.fields.approvalFlow', '关键节点需要负责人确认。'],
        ]
      : [
          ['typeSpecific.fields.humanAgentContract', '高风险决定由人确认，常规整理可由 Agent 自动完成。'],
          ['typeSpecific.fields.autonomyBoundary', 'Agent 可在已确认范围内整理需求，但不能越过人类确认边界直接扩范围。'],
          ['typeSpecific.fields.toolBoundary', '可使用当前工作区内已接入的工具与 OpenPrd 命令。'],
          ['typeSpecific.fields.stateModel', '保留 requirement lane、review 状态和任务状态。'],
          ['typeSpecific.fields.evalPlan', '通过需求评审、任务验证和最终收口检查判断是否达标。'],
        ];
  const captures = [
    ['meta.title', '已确认需求'],
    ['meta.owner', 'OpenPrd'],
    ['meta.version', '0.1.0'],
    ['meta.status', 'draft'],
    ['meta.productType', productType],
    ['problem.problemStatement', value],
    ['problem.whyNow', '当前要把已确认范围整理成可执行需求。'],
    ['problem.evidence', ['用户已经确认了本轮需求范围。']],
    ['users.primaryUsers', ['一线操作员']],
    ['users.stakeholders', ['需求发起人']],
    ['goals.goals', ['完成本轮确认目标']],
    ['goals.successMetrics', ['核心路径可走通']],
    ['goals.acceptanceGoals', ['主流程可验收']],
    ['scope.inScope', ['当前确认范围']],
    ['scope.outOfScope', ['外围扩展能力']],
    ['scenarios.primaryFlows', ['用户完成主流程']],
    ['scenarios.edgeCases', ['异常输入可提示']],
    ['scenarios.failureModes', ['关键步骤失败可回退']],
    ['requirements.functional', ['支持本轮核心流程']],
    ['requirements.nonFunctional', ['文案面向普通用户']],
    ['requirements.businessRules', ['只做本轮确认范围']],
    ['constraints.technical', ['沿用当前工作区技术边界']],
    ['constraints.compliance', ['不写入敏感信息']],
    ['constraints.dependencies', ['依赖当前工作区与本地验证']],
    ['businessGuardrails.costDrivers', ['主要成本来自当前工作区内的工具调用与执行时长。']],
    ['businessGuardrails.usageLimits', ['首版按已确认范围执行，不开放无限制批量能力。']],
    ['businessGuardrails.abusePrevention', ['关键动作保留确认边界，避免越权或重复触发。']],
    ['businessGuardrails.monitoringSignals', ['关注执行成功率、失败率和异常重试。']],
    ['businessGuardrails.alertThresholds', ['异常失败率连续升高时立即停下复核。']],
    ['businessGuardrails.stopLossActions', ['发现异常时暂停自动推进，回退到人工确认。']],
    ['risks.assumptions', ['用户接受当前确认方向']],
    ['risks.risks', ['后续细节可能仍需验证']],
    ['risks.openQuestions', ['更大范围扩展另行确认']],
    ['handoff.owner', 'OpenPrd'],
    ['handoff.nextStep', '继续生成这版需求稿'],
    ['handoff.targetSystem', '当前工作区'],
    ...typeSpecificCaptures,
  ];
  for (const [field, capturedValue] of captures) {
    await captureWorkspace(project, {
      field,
      value: capturedValue,
      source: 'user-confirmed',
    });
  }
}

export function runCodexHook(project, eventName, payload) {
  const result = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), eventName], {
    cwd: project,
    input: JSON.stringify({ cwd: project, ...payload }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

export function runCodexHookWithoutCwd(project, eventName, payload, workingDirectory) {
  const result = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), eventName], {
    cwd: workingDirectory,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
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
  const activeDir = path.join(project, '.openprd', 'design', 'active');
  await fs.writeFile(path.join(activeDir, 'facts-sheet.md'), '# Facts\n\n- 开放时间：10:00-17:00\n- 中文语音导览：7 GBP\n');
  await fs.writeFile(path.join(activeDir, 'asset-spec.md'), '# Assets\n\n- 品牌资产：暂无官方素材，先用文字与中性色块表达\n');
  await fs.writeFile(path.join(activeDir, 'image-preflight.md'), '# Image preflight\n\n- 真实图片：已准备一组可用参考图\n');
  await fs.writeFile(path.join(activeDir, 'direction-plan.md'), '# Directions\n\n1. 导览叙事\n2. 编辑感故事\n3. 高密度工具\n');
  await fs.writeFile(path.join(activeDir, 'selected-direction.md'), '# Selected\n\n- lens: editorial-contrast\n- theme: warm-editorial\n- layout: story-map\n');
}

export async function seedDesignStarterEvent(project, output = 'index.html') {
  await fs.appendFile(
    path.join(project, '.openprd', 'state', 'events.jsonl'),
    `${JSON.stringify({
      type: 'design_starter_created',
      at: '2026-06-09 09:00:00',
      starterId: 'content-home',
      output,
    })}\n`,
  );
}

export async function writeCodexTranscript(project, sessionId, assistantText) {
  const transcriptDir = path.join(project, '.openprd', 'test-transcripts');
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
  const skillDir = path.join(project, '.openprd', 'knowledge', 'skills', skillName);
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
  await fs.writeFile(path.join(project, '.openprd', 'knowledge', 'index.json'), `${JSON.stringify({
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
