import test from 'node:test';
import { isOpenSpecTaskBlocking } from '../src/openspec/tasks.js';

import {
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
  captureWorkspace,
  checkDevelopmentStandardsWorkspace,
  checkStandardsWorkspace,
  clarifyWorkspace,
  classifyExternalReferenceWorkspace,
  classifyWorkspace,
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
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  checkCodexCliHealth,
  ensureCodexCliReady,
  createRunWorkspace,
  OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER,
  OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER,
  TEST_OPEN_VIBECODING_HOME,
  hasTomlFeatureKey,
  findOpenPrdHookGroup,
  makeTempProject,
  pathExists,
  readJsonl,
  writeAnswersFile,
  writeConcreteBasicDocs,
  writeSourceManual,
  writeFolderManual,
  writeFakeCodexBin,
  writeLoopProject,
  mergeReviewPresentation,
  validReviewPresentation,
  writeValidReviewPresentation,
  synthesizeWorkspace,
  writeMinimalChange,
} from './helpers/open-vibecoding-test-helpers.js';

test('explicit blocking metadata keeps a user-requested documentation task in current-task validation', () => {
  assert.equal(isOpenSpecTaskBlocking({
    metadata: { type: 'documentation', blocking: 'true' },
  }), true);
  assert.equal(isOpenSpecTaskBlocking({
    metadata: { type: 'documentation', blocking: 'false' },
  }), false);
  assert.equal(isOpenSpecTaskBlocking({
    metadata: { type: 'documentation' },
  }), false);
});

test('open-vibecoding validates change structure without external spec cli', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const changeDir = path.join(project, '.open-vibecoding', 'changes', 'desktop-rebuild');
  await fs.mkdir(path.join(changeDir, 'specs', 'desktop-shell'), { recursive: true });
  await fs.writeFile(path.join(changeDir, '.open-vibecoding.yaml'), 'schema: openprd.change.v1\n');
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '## Why',
    '',
    'The desktop shell needs a durable Open VibeCoding-owned validation path.',
    '',
    '## What Changes',
    '',
    '- Add an internal Open VibeCoding change validator.',
    '',
    '## Capabilities',
    '',
    '- `desktop-shell`: Desktop shell behavior.',
    '',
    '## Impact',
    '',
    '- Agents can use Open VibeCoding as the only entry point.',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'design.md'), '## Context\n\nInternal validation belongs to Open VibeCoding.\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 评审生成的 spec 覆盖',
    '  - type: governance',
    '  - done: Open VibeCoding change 结构已覆盖桌面壳校验需求',
    '  - verify: open-vibecoding change . --validate --change desktop-rebuild',
    '- [ ] T001.02 补齐桌面壳校验入口',
    '  - type: implementation',
    '  - deps: T001.01',
    '  - done: 桌面壳校验入口已经接到 Open VibeCoding 自有校验路径',
    '  - verify: open-vibecoding run . --verify',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## 新增需求',
    '',
    '### 需求：桌面壳校验通过 Open VibeCoding 执行',
    '桌面壳校验应由 Open VibeCoding 内置能力完成，不依赖第三方 spec CLI。',
    '',
    '#### 场景：Agent 检查变更',
    '- **当** Agent 运行 Open VibeCoding 校验',
    '- **则** Open VibeCoding change 应被完整检查',
    '',
  ].join('\n'));

  const result = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(result.ok, true);
  assert.equal(result.valid, true);
  assert.ok(result.checks.some((check) => check.includes('Open VibeCoding change desktop-rebuild')));

  await fs.rm(path.join(project, 'docs', 'basic', 'prd.md'));
  const workspaceDebt = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(workspaceDebt.ok, true);
  assert.equal(workspaceDebt.errors.length, 0);
  assert.equal(workspaceDebt.workspaceAttention.find((item) => item.id === 'standards')?.ok, false);
  assert.ok(workspaceDebt.workspaceAttention.find((item) => item.id === 'standards')?.errors.some((error) => error.includes('docs/basic/prd.md')));

  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## 新增需求',
    '',
    '### 需求：桌面壳校验通过 Open VibeCoding 执行',
    '桌面壳校验应由 Open VibeCoding 内置能力完成，不依赖第三方 spec CLI。',
    '',
  ].join('\n'));

  const failed = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('必须至少包含一个场景')));
});

test('open-vibecoding validates spec structure without enforcing body language policy', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const changeDir = path.join(project, '.open-vibecoding', 'changes', 'desktop-rebuild');
  await fs.mkdir(path.join(changeDir, 'specs', 'desktop-shell'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '## 背景与原因',
    '',
    '需要验证 spec 正文语言。',
    '',
    '## 变更内容',
    '',
    '- `desktop-shell`: 校验语言规则。',
    '',
    '## 影响范围',
    '',
    '- Open VibeCoding change 校验。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 评审 spec 语言约束',
    '  - type: governance',
    '  - done: spec 语言规则已覆盖',
    '  - verify: open-vibecoding change . --validate --change desktop-rebuild',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'desktop-shell', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Desktop shell SHALL validate through Open VibeCoding',
    'The shell validation SHALL not require a third-party spec CLI.',
    '',
    '#### Scenario: Agent 检查变更',
    '- **WHEN** Agent 运行 Open VibeCoding 校验',
    '- **THEN** Open VibeCoding change 应被完整检查',
    '',
  ].join('\n'));

  const englishHeavySpec = await validateOpenSpecChangeWorkspace(project, { change: 'desktop-rebuild' });
  assert.equal(englishHeavySpec.ok, true);
  assert.equal(englishHeavySpec.valid, true);
});

test('new CLI retires change generation while preserving history listings', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const originalLog = console.log;
  console.log = () => {};
  try {
    assert.equal(await main(['change', project, '--generate', '--change', 'profile-settings', '--json']), 1);
    assert.equal(await main(['change', project, '--apply', '--change', 'profile-settings', '--json']), 1);
    assert.equal(await main(['changes', project, '--json']), 0);
    assert.equal(await main(['specs', project, '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'changes', 'profile-settings')), false);
});

test('legacy task verification remains readable but task advancement is retired', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, '.open-vibecoding', 'changes', 'evidence-gate');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Wire focused task evidence',
    '  - type: implementation',
    '  - done: evidence gate is wired',
    '  - verify: open-vibecoding tasks . --change evidence-gate --item T001.01 --evidence-required',
    '',
  ].join('\n'));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['tasks', project, '--change', 'evidence-gate', '--json']), 0);
    assert.equal(await main(['tasks', project, '--change', 'evidence-gate', '--item', 'T001.01', '--verify', '--json']), 1);
    assert.equal(await main(['tasks', project, '--change', 'evidence-gate', '--item', 'T001.01', '--advance', '--verify', '--evidence', 'node --test test/evidence.test.js', '--json']), 1);
  } finally {
    console.log = originalLog;
  }

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[ \] T001\.01 Wire focused task evidence/);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'quality', 'reports', 'latest.json')), false);
  assert.ok(logs.some((line) => line.includes('removed-workflow')));
});

test('legacy per-task verification does not advance task state', async () => {
  const project = await makeTempProject();
  const changeDir = path.join(project, '.open-vibecoding', 'changes', 'legacy-full-verify');
  await fs.mkdir(changeDir, { recursive: true });
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [ ] T001.01 Complete legacy generated task',
    '  - type: implementation',
    '  - done: legacy generated task is complete',
    '  - verify: open-vibecoding run . --verify',
    '',
  ].join('\n'));

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['tasks', project, '--change', 'legacy-full-verify', '--item', 'T001.01', '--verify', '--json']), 1);
    assert.equal(await main(['tasks', project, '--change', 'legacy-full-verify', '--item', 'T001.01', '--advance', '--verify', '--evidence', 'legacy task smoke evidence', '--json']), 1);
  } finally {
    console.log = originalLog;
  }

  const tasksText = await fs.readFile(path.join(changeDir, 'tasks.md'), 'utf8');
  assert.match(tasksText, /- \[ \] T001\.01 Complete legacy generated task/);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'quality', 'reports', 'latest.json')), false);
  assert.ok(logs.some((line) => line.includes('removed-workflow')));
});
