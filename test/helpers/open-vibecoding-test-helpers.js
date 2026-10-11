import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import { buildReviewExportPayload, renderReviewArtifact } from '../../src/html-artifacts.js';
import * as openprd from '../../src/open-vibecoding.js';
const { addBenchmarkWorkspace, advanceOpenSpecTaskWorkspace, applyGrowthCandidateWorkspace, applyOpenPrdChangeWorkspace, approveBenchmarkWorkspace, archiveOpenPrdChangeWorkspace, brainstormPresentationWorkspace, brainstormWorkspace, captureWorkspace, checkDevelopmentStandardsWorkspace, checkStandardsWorkspace, clarifyWorkspace, classifyExternalReferenceWorkspace, classifyWorkspace, designStarterWorkspace, diagramWorkspace, diffWorkspace, doctorWorkspace, finishLoopWorkspace, fleetWorkspace, freezeWorkspace, generateLearningReviewWorkspace, generateOpenSpecChangeWorkspace, handoffWorkspace, historyWorkspace, initLoopWorkspace, initQualityWorkspace, initWorkspace, interviewWorkspace, learnQualityWorkspace, listAcceptedSpecsWorkspace, listBenchmarkWorkspace, listOpenPrdChangesWorkspace, listOpenSpecTaskWorkspace, main, nextLoopWorkspace, nextWorkspace, observeBenchmarkSourceWorkspace, openspecDiscoveryWorkspace, planLoopWorkspace, playgroundWorkspace, promptLoopWorkspace, releaseWorkspace, reviewGrowthWorkspace, reviewPresentationWorkspace, reviewWorkspace, runLoopWorkspace, runWorkspace, setLearningReviewModeWorkspace, setupAgentIntegrationWorkspace, statusLoopWorkspace, synthesizeWorkspace: synthesizeWorkspaceBase, updateAgentIntegrationWorkspace, validateOpenSpecChangeWorkspace, validateWorkspace, verifyBenchmarkWorkspace, verifyLoopWorkspace, verifyQualityWorkspace, visualCompareWorkspace, visualPrepareWorkspace } = openprd;
import { archiveKnowledgeCandidate, listKnowledgeCandidates, rejectKnowledgeCandidate, restoreKnowledgeCandidate } from '../../src/knowledge.js';
import { checkCodexCliHealth, ensureCodexCliReady } from '../../src/codex-runtime.js';
import { createRunWorkspace } from '../../src/run-harness.js';

export {
  assert,
  spawnSync,
  fs,
  os,
  path,
  sharp,
  buildReviewExportPayload,
  renderReviewArtifact,
  addBenchmarkWorkspace,
  advanceOpenSpecTaskWorkspace,
  applyGrowthCandidateWorkspace,
  applyOpenPrdChangeWorkspace,
  approveBenchmarkWorkspace,
  archiveOpenPrdChangeWorkspace,
  brainstormPresentationWorkspace,
  brainstormWorkspace,
  captureWorkspace,
  checkDevelopmentStandardsWorkspace,
  checkStandardsWorkspace,
  clarifyWorkspace,
  classifyExternalReferenceWorkspace,
  classifyWorkspace,
  designStarterWorkspace,
  diagramWorkspace,
  diffWorkspace,
  doctorWorkspace,
  finishLoopWorkspace,
  fleetWorkspace,
  freezeWorkspace,
  generateLearningReviewWorkspace,
  generateOpenSpecChangeWorkspace,
  handoffWorkspace,
  historyWorkspace,
  initLoopWorkspace,
  initQualityWorkspace,
  initWorkspace,
  interviewWorkspace,
  learnQualityWorkspace,
  listAcceptedSpecsWorkspace,
  listBenchmarkWorkspace,
  listOpenPrdChangesWorkspace,
  listOpenSpecTaskWorkspace,
  main,
  nextLoopWorkspace,
  nextWorkspace,
  observeBenchmarkSourceWorkspace,
  openspecDiscoveryWorkspace,
  planLoopWorkspace,
  playgroundWorkspace,
  promptLoopWorkspace,
  releaseWorkspace,
  reviewGrowthWorkspace,
  reviewPresentationWorkspace,
  reviewWorkspace,
  runLoopWorkspace,
  runWorkspace,
  setLearningReviewModeWorkspace,
  setupAgentIntegrationWorkspace,
  statusLoopWorkspace,
  synthesizeWorkspaceBase,
  updateAgentIntegrationWorkspace,
  validateOpenSpecChangeWorkspace,
  validateWorkspace,
  verifyBenchmarkWorkspace,
  verifyLoopWorkspace,
  verifyQualityWorkspace,
  visualCompareWorkspace,
  visualPrepareWorkspace,
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  checkCodexCliHealth,
  ensureCodexCliReady,
  createRunWorkspace,
};

export const OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER = '^(Bash|Read|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
export const OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER = '^(Bash|Read|Glob|Grep|LS|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
export const TEST_OPEN_VIBECODING_HOME = path.join(os.tmpdir(), 'open-vibecoding-test-home');

process.env.OPEN_VIBECODING_HOME = TEST_OPEN_VIBECODING_HOME;

export function hasTomlFeatureKey(text, key) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[features]');
  if (start < 0) return false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^\[.+\]$/.test(line)) break;
    if (new RegExp(`^${key}\\s*=`).test(line)) return true;
  }
  return false;
}

export function findOpenPrdHookGroup(groups) {
  return groups?.find((group) => group.hooks?.some((hook) => hook.command.includes('open-vibecoding-hook.mjs')));
}

export async function makeTempProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-test-'));
  await fs.mkdir(path.join(dir, 'project'), { recursive: true });
  return path.join(dir, 'project');
}

export async function pathExists(filePath) {
  return fs.stat(filePath).then(() => true, () => false);
}

export async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function writeAnswersFile(project, filename, payload) {
  const filePath = path.join(project, filename);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

export async function writeConcreteBasicDocs(project, sourceFile = 'src/app.js') {
  const docs = [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 新增界面后更新本文档。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', `# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- \`${sourceFile}\` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 Node.js 测试脚本验证，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n`],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 测试使用 Node.js 内置能力。\n\n## 工具链\n\n- `node --test`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ];
  for (const [file, text] of docs) {
    await fs.writeFile(path.join(project, 'docs', 'basic', file), text);
  }
}

export async function writeSourceManual(filePath, code) {
  await fs.writeFile(filePath, [
    '/*',
    '## 核心功能',
    '提供测试项目源码入口。',
    '## 输入',
    '调用方传入测试请求对象。',
    '## 输出',
    '导出测试函数或常量。',
    '## 定位',
    '位于测试项目源码目录。',
    '## 依赖',
    '仅依赖 Node.js 运行时。',
    '## 维护规则',
    '修改行为后同步更新说明书。',
    '*/',
    code,
    '',
  ].join('\n'));
}

export async function writeFolderManual(dirPath, project, label) {
  await fs.writeFile(path.join(dirPath, `${path.basename(project)}_${label}_README.md`), [
    `# ${label} 文件夹说明书`,
    '',
    '## 核心功能',
    '承载测试项目源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供测试入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    'Node.js 运行时。',
    '',
    '## 维护规则',
    '新增源码后更新本说明书。',
    '',
  ].join('\n'));
}

export async function writeFakeCodexBin(project) {
  const binDir = path.join(project, 'fake-bin');
  await fs.mkdir(binDir, { recursive: true });
  const codexPath = path.join(binDir, 'codex');
  await fs.writeFile(codexPath, '#!/usr/bin/env sh\nprintf "codex 0.200.0\\n"\n');
  await fs.chmod(codexPath, 0o755);
  return binDir;
}

export async function writeLoopProject(project, changeId = 'loop-demo') {
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeConcreteBasicDocs(project, 'src/api/handler.js');
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      test: 'node --test',
      'test:smoke': 'node --test smoke.test.js',
      'perf:k6': 'k6 run perf.js',
    },
    dependencies: {
      '@opentelemetry/api': '^1.0.0',
      pino: '^9.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'src', 'api'), { recursive: true });
  await writeSourceManual(path.join(project, 'src', 'api', 'handler.js'), 'export function handler(req) { console.log({ trace_id: req.trace_id, span_id: req.span_id, request_id: req.request_id, task_id: req.task_id, user_session_id: req.user_session_id, error_id: req.error_id }); }');
  await writeFolderManual(path.join(project, 'src'), project, 'src');
  await writeFolderManual(path.join(project, 'src', 'api'), project, 'api');
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.open-vibecoding', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.open-vibecoding', 'harness', 'test-reports', `${changeId}-smoke.md`), [
    '# EVO loop smoke report',
    '',
    '- smoke: passed main flow',
    '- feature coverage: no active change',
    '- redaction: token redacted and pii masked',
    '- performance: k6 baseline p95 stable',
    '- extreme: large-data stress fixture passed',
    '',
  ].join('\n'));
  const changeDir = path.join(project, '.open-vibecoding', 'changes', changeId);
  await fs.mkdir(path.join(changeDir, 'specs', changeId), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# Proposal',
    '',
    '## Why',
    'Long-running agent work needs isolated task sessions.',
    '',
    '## What Changes',
    `- \`${changeId}\`: Add a loop-driven implementation path.`,
    '',
    '## Impact',
    'Agent execution gains deterministic task boundaries.',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', changeId, 'spec.md'), [
    '# loop-demo 规格',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: Loop 任务会话保持隔离',
    '每个实现任务都应在独立 Agent 会话中执行。',
    '',
    '#### Scenario: Agent 启动下一项任务',
    '- **WHEN** 选中一个 Loop 任务',
    '- **THEN** 提示词会把 Agent 限制在该单一任务内',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Prepare loop state',
    '  - done: loop state is ready',
    '  - verify: node -e "process.exit(0)"',
    '- [ ] T001.02 Launch one-task session',
    '  - deps: T001.01',
    '  - done: one-task session is launchable',
    '  - verify: node -e "process.exit(0)"',
    '',
  ].join('\n'));
  return changeDir;
}

export function mergeReviewPresentation(base, seed) {
  return {
    ...base,
    ...seed,
    mapNodes: {
      ...(base.mapNodes ?? {}),
      ...(seed?.mapNodes ?? {}),
    },
    panels: {
      ...(base.panels ?? {}),
      ...(seed?.panels ?? {}),
    },
    diagram: seed?.diagram ?? base.diagram,
    flowNodes: seed?.flowNodes ?? base.flowNodes,
    flowEdges: seed?.flowEdges ?? base.flowEdges,
  };
}

export function validReviewPresentation(seed = {}) {
  return mergeReviewPresentation({
    diagram: { type: 'flow' },
    mapNodes: {
      problem: { title: '问题定义', text: '确认核心问题' },
      goal: { title: '目标', text: '确认目标结果' },
      scope: { title: '范围', text: '确认交付边界' },
      flow: { title: '流程', text: '确认主线步骤' },
      risk: { title: '风险', text: '确认风险问题' },
    },
    flowNodes: [
      { id: 'step1', text: '确认入口' },
      { id: 'step2', text: '执行主步骤' },
      { id: 'step3', text: '校验结果' },
      { id: 'step4', text: '处理批量场景' },
    ],
    flowEdges: [
      { from: 'step1', to: 'step2' },
      { from: 'step2', to: 'step3' },
      { from: 'step3', to: 'step4' },
    ],
    panels: {
      flow: [{ summary: '主线确认', detail: '用户能看懂入口、步骤和结果。' }],
      function: [{ summary: '功能确认', detail: '必须交付项和约束保持清晰。' }],
      guardrail: [{ summary: '护栏确认', detail: '成本、滥用和止损边界可见。' }],
      risk: [{ summary: '风险确认', detail: '开放问题和失败路径保留。' }],
    },
  }, seed);
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
  const reviewResult = await writeValidReviewPresentation(project, result.snapshot.versionId, result.snapshot.reviewPresentation ?? {});
  return {
    ...result,
    reviewArtifact: reviewResult.reviewEntryPath,
    stableReviewArtifact: reviewResult.reviewPath,
    reviewPath: reviewResult.reviewPath,
    reviewEntryPath: reviewResult.reviewEntryPath,
    reviewPresentationRequired: false,
  };
}

export async function writeMinimalChange(project, changeId, {
  title,
  requirementTitle = title,
  taskId = 'T001.01',
  taskTitle = title,
  verifyCommand = 'node -e "process.exit(0)"',
} = {}) {
  const changeDir = path.join(project, '.open-vibecoding', 'changes', changeId);
  const capability = changeId.split('-').slice(0, 2).join('-') || changeId;
  await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    `# ${title}`,
    '',
    '## Why',
    `${title} needs an isolated routing target.`,
    '',
    '## What Changes',
    `- ${title}`,
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', capability, 'spec.md'), [
    `# ${capability} spec`,
    '',
    '## ADDED Requirements',
    '',
    `### Requirement: ${requirementTitle}`,
    `${title} must remain addressable by routing.`,
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    `- [ ] ${taskId} ${taskTitle}`,
    `  - done: ${taskTitle} is complete`,
    `  - verify: ${verifyCommand}`,
    '',
  ].join('\n'));
  return changeDir;
}
