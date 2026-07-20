import test from 'node:test';
import { upsertSessionBinding } from '../src/session-binding.js';

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
  OPENPRD_LITE_WRITE_TOOL_MATCHER,
  OPENPRD_GUARDED_WRITE_TOOL_MATCHER,
  TEST_OPENPRD_HOME,
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
} from './helpers/openprd-test-helpers.js';

async function seedKnowledgeSkill(project, skillName = 'billing-trace-rollback') {
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
    '## 可复用模式',
    '- 先确认 traceId 在 API 和 webhook 链路里一致透传',
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
  return { skillDir, skillPath };
}

test('run only verifies state or records hook evidence', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const unsupported = await runWorkspace(project, {});
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.action, 'run-unsupported');
  assert.match(unsupported.errors[0], /不再管理 Agent 上下文/);

  const recorded = await runWorkspace(project, {
    recordHook: true,
    event: 'UserPromptSubmit',
    risk: 'low',
    outcome: 'prompt-observed',
    preview: 'start run',
  });
  assert.equal(recorded.ok, true);
  const iterations = await fs.readFile(path.join(project, '.openprd', 'harness', 'iterations.jsonl'), 'utf8');
  assert.match(iterations, /UserPromptSubmit/);
  assert.match(iterations, /prompt-observed/);

  assert.equal(await main(['run', project]), 1);
});
test('run verify validates the active change without selecting Agent context', async () => {
  const project = await makeTempProject();
  const validatedChanges = [];
  const run = createRunWorkspace({
    checkStandardsWorkspace: async () => ({ ok: true, errors: [] }),
    listOpenPrdChangesWorkspace: async () => ({ ok: true, activeChange: 'active-change', changes: [] }),
    resumeOpenSpecDiscoveryWorkspace: async () => null,
    validateOpenSpecChangeWorkspace: async (_projectRoot, options = {}) => {
      validatedChanges.push(options.change);
      return { ok: true, errors: [], standards: { errors: [] } };
    },
    validateWorkspace: async () => ({ report: { valid: true, errors: [], warnings: [] } }),
    verifyOpenSpecDiscoveryWorkspace: async () => ({ ok: true, verification: { errors: [] } }),
    verifyQualityWorkspace: async () => ({
      ok: true,
      errors: [],
      report: { readiness: { productionReady: true, attentionGates: [] } },
    }),
  });

  const result = await run(project, { verify: true, message: 'ignored user prompt' });
  assert.equal(result.ok, true);
  assert.deepEqual(validatedChanges, ['active-change']);
  assert.equal(result.scope.changeId, 'active-change');
  assert.equal('context' in result, false);
});
test('run verify ignores reference discovery by default', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await synthesizeWorkspace(project, {
    title: 'Reference Discovery Boundary',
    owner: 'PM',
    problemStatement: 'Reference discovery should not pollute primary run verification',
    whyNow: 'Verify output needs to stay scoped to the current project',
    primaryUsers: ['Project maintainers'],
    goals: ['Keep primary verify scoped'],
    successMetrics: ['Run context keeps the implementation recommendation'],
    acceptanceGoals: ['Reference discovery stays outside default run verify'],
    inScope: ['Run context', 'Run verify'],
    outOfScope: ['Reference mining workflows'],
    primaryFlows: ['Maintainer reads run context'],
    functional: Array.from({ length: 10 }, (_, index) => `Expose implementation slice ${index + 1}`),
    productType: 'consumer',
  });
  await reviewWorkspace(project, { mark: 'confirmed' });
  await generateOpenSpecChangeWorkspace(project, { change: 'reference-boundary' });

  const tasksPath = path.join(project, '.openprd', 'changes', 'reference-boundary', 'tasks.md');
  const tasksText = await fs.readFile(tasksPath, 'utf8');
  await fs.writeFile(tasksPath, tasksText.replace(/- \[ \]/g, '- [x]'));
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'reference-boundary-smoke.md'), [
    '# EVO reference boundary report',
    '',
    '- smoke: passed scoped verify flow',
    '- feature coverage: tasks done',
    '',
  ].join('\n'));

  const referenceProject = path.join(project, 'research', 'reference-repo');
  await fs.mkdir(path.join(referenceProject, '.git'), { recursive: true });
  await fs.writeFile(path.join(referenceProject, 'ref.js'), 'export const reference = true;\n');
  await openspecDiscoveryWorkspace(project, {
    mode: 'reference',
    reference: 'research/reference-repo',
  });

  const verified = await runWorkspace(project, { verify: true });
  assert.equal(verified.scope.discoveryRunId, null);
  assert.equal(verified.checks.some((check) => check.name === 'discovery'), false);
  assert.equal(verified.errors.some((error) => error.startsWith('discovery:')), false);
});

test('fleet dry-run plans historical updates without auto-claiming agent-only projects', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const existing = path.join(root, 'existing-openprd');
  const agentOnly = path.join(root, 'agent-only');
  const plain = path.join(root, 'plain-project');
  await fs.mkdir(existing, { recursive: true });
  await fs.mkdir(path.join(agentOnly, '.codex'), { recursive: true });
  await fs.mkdir(plain, { recursive: true });
  await fs.writeFile(path.join(agentOnly, 'AGENTS.md'), '# Local Agent Notes\n');
  await fs.writeFile(path.join(plain, 'package.json'), '{"name":"plain-project"}\n');

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  const synthesized = await synthesizeWorkspace(existing, {
    title: '历史需求',
    owner: 'PM',
    problemStatement: '历史项目缺少稳定需求身份',
    whyNow: '多 Agent 并行后容易串需求',
    primaryUsers: ['维护者'],
    goals: ['历史确认命令可校验'],
    inScope: ['补历史 work unit'],
    outOfScope: ['接管 agent-only 项目'],
    functional: ['历史评审产物带工作单元 ID'],
  });
  const legacyVersionPath = path.join(existing, '.openprd', 'state', 'versions', 'v0001.json');
  const legacyReviewPath = path.join(existing, '.openprd', 'reviews', 'v0001.html');
  const legacyReviewBefore = await fs.readFile(legacyReviewPath, 'utf8');
  const taskGraphPath = path.join(existing, '.openprd', 'state', 'task-graph.json');
  const taskGraphBefore = await fs.readFile(taskGraphPath, 'utf8');
  const legacySnapshot = JSON.parse(await fs.readFile(legacyVersionPath, 'utf8'));
  delete legacySnapshot.workUnitId;
  delete legacySnapshot.targetRoot;
  await fs.writeFile(legacyVersionPath, `${JSON.stringify(legacySnapshot, null, 2)}\n`);
  await fs.rm(path.join(existing, '.openprd', 'engagements', 'work-units'), { recursive: true, force: true });
  const legacyStatePath = path.join(existing, '.openprd', 'state', 'current.json');
  const legacyState = JSON.parse(await fs.readFile(legacyStatePath, 'utf8'));
  delete legacyState.activeWorkUnitId;
  delete legacyState.targetRoot;
  delete legacyState.reviewStatus.workUnitId;
  delete legacyState.reviewStatus.stableArtifact;
  await fs.writeFile(legacyStatePath, `${JSON.stringify(legacyState, null, 2)}\n`);
  await fs.appendFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
  await fs.writeFile(path.join(existing, '.openprd', 'templates', 'base', 'prd.md'), '# PRD\n\n## 1. Problem\n');
  await fs.writeFile(path.join(existing, '.openprd', 'engagements', 'active', 'intake.md'), '# Intake\n\n## Questions\n\n- What problem are we solving?\n');

  const dryRun = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.summary.openprd, 1);
  assert.equal(dryRun.summary.agentConfigured, 1);
  assert.equal(dryRun.projects.find((project) => project.relativePath === 'existing-openprd').plannedAction, 'update');
  assert.equal(dryRun.projects.find((project) => project.relativePath === 'agent-only').plannedAction, 'report');
  assert.equal(await fs.stat(path.join(agentOnly, '.openprd')).then(() => true).catch(() => false), false);

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(updated.summary.updated, 1);
  assert.equal(updated.summary.backfilled, 1);
  assert.equal(updated.summary.setup, 0);
  assert.equal(updated.projects.find((project) => project.relativePath === 'agent-only').status, 'skipped');
  assert.equal(await fs.stat(path.join(agentOnly, '.openprd')).then(() => true).catch(() => false), false);

  const doctor = await doctorWorkspace(existing);
  assert.equal(doctor.ok, true);
  assert.equal(doctor.agentIntegration.drift.ok, true);
  assert.ok((await fs.readFile(path.join(existing, '.openprd', 'templates', 'base', 'prd.md'), 'utf8')).includes('元信息'));
  assert.ok((await fs.readFile(path.join(existing, '.openprd', 'engagements', 'active', 'intake.md'), 'utf8')).includes('我们要解决什么问题？'));
  const backfilledSnapshot = JSON.parse(await fs.readFile(legacyVersionPath, 'utf8'));
  assert.match(backfilledSnapshot.workUnitId, /^wu-legacy-v0001-[a-f0-9]{8}$/);
  assert.equal(backfilledSnapshot.digest, synthesized.snapshot.digest);
  assert.equal(backfilledSnapshot.lifecycleStatus, 'legacy-frozen');
  assert.equal(backfilledSnapshot.semanticMode, 'context-only');
  assert.equal(backfilledSnapshot.backfillPolicy, 'metadata-only');
  const backfilledHtml = await fs.readFile(legacyReviewPath, 'utf8');
  assert.equal(backfilledHtml, legacyReviewBefore);
  assert.equal(backfilledHtml.includes(`--work-unit &#39;${backfilledSnapshot.workUnitId}&#39;`), false);
  assert.equal(await fs.readFile(taskGraphPath, 'utf8'), taskGraphBefore);
  const workUnitPath = path.join(existing, '.openprd', 'engagements', 'work-units', `${backfilledSnapshot.workUnitId}.json`);
  assert.equal(
    await fs.stat(workUnitPath).then(() => true),
    true
  );
  const binding = JSON.parse(await fs.readFile(workUnitPath, 'utf8'));
  assert.equal(binding.status, 'legacy-frozen');
  assert.equal(binding.reviewPath, legacyReviewPath);
  const backfilledState = JSON.parse(await fs.readFile(legacyStatePath, 'utf8'));
  assert.equal(backfilledState.lifecycleStatus, 'legacy-frozen');
  assert.equal(backfilledState.semanticMode, 'context-only');
  assert.equal(backfilledState.reviewStatus.status, 'legacy-frozen');
  assert.equal(backfilledState.reviewStatus.historicalContextOnly, true);

  const cliLogs = [];
  const originalLog = console.log;
  console.log = (...args) => cliLogs.push(args.join(' '));
  try {
    assert.equal(await main(['fleet', root, '--dry-run', '--update-openprd', '--max-depth', '2']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(cliLogs.some((line) => line.includes('OpenPrd fleet: 通过')));
});

test('fleet sync-registry backfills known workspaces and reports registry scope outside the current root', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-registry-test-'));
  const openprdHome = path.join(workspaceRoot, '.openprd-home');
  const scopedRoot = path.join(workspaceRoot, 'scoped');
  const otherRoot = path.join(workspaceRoot, 'other');
  const scopedProject = path.join(scopedRoot, 'existing-openprd');
  const otherProject = path.join(otherRoot, 'another-openprd');
  await fs.mkdir(scopedProject, { recursive: true });
  await fs.mkdir(otherProject, { recursive: true });

  await initWorkspace(scopedProject, { templatePack: 'agent', openprdHome });
  await initWorkspace(otherProject, { templatePack: 'agent', openprdHome });
  await fs.rm(path.join(openprdHome, 'registry'), { recursive: true, force: true });

  const synced = await fleetWorkspace(scopedRoot, {
    syncRegistry: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(synced.ok, true);
  assert.equal(synced.summary.synced, 1);
  assert.equal(synced.registry.knownTotal, 1);
  assert.equal(synced.registry.outsideRoot, 0);

  await updateAgentIntegrationWorkspace(otherProject, { openprdHome });

  const scopedDryRun = await fleetWorkspace(scopedRoot, {
    dryRun: true,
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  assert.equal(scopedDryRun.registry.knownTotal, 2);
  assert.equal(scopedDryRun.registry.scopedKnown, 1);
  assert.equal(scopedDryRun.registry.outsideRoot, 1);
});

test('fleet update discovers legacy root openprd artifacts and migrates them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-legacy-root-test-'));
  const legacyProject = path.join(root, 'legacy-openprd-project');
  const legacyChange = path.join(legacyProject, 'openprd', 'changes', 'legacy-root-change');
  await fs.mkdir(path.join(legacyChange, 'specs', 'legacy-root-change'), { recursive: true });
  await fs.writeFile(path.join(legacyChange, 'proposal.md'), '# Legacy root change\n');
  await fs.writeFile(path.join(legacyChange, 'tasks.md'), '- [ ] T001.01 Migrate legacy root\n');
  await fs.writeFile(path.join(legacyChange, 'specs', 'legacy-root-change', 'spec.md'), '# Legacy root spec\n');

  const dryRun = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 2,
  });

  assert.equal(dryRun.ok, true);
  assert.equal(dryRun.summary.openprd, 1);
  const planned = dryRun.projects.find((project) => project.relativePath === 'legacy-openprd-project');
  assert.equal(planned.plannedAction, 'update');
  assert.ok(planned.markers.includes('openprd-legacy-artifacts'));

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 2,
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.summary.updated, 1);
  assert.equal(await pathExists(path.join(legacyProject, '.openprd', 'changes', 'legacy-root-change', 'tasks.md')), true);
  assert.equal(await pathExists(path.join(legacyProject, 'openprd')), false);
  const item = updated.projects.find((project) => project.relativePath === 'legacy-openprd-project');
  assert.ok(item.changes.some((change) => change.source === 'workspace' && change.from?.includes(path.join('openprd', 'changes'))));
});

test('doctor reports registry hygiene warnings for overbroad and nested workspaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-registry-hygiene-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const parent = path.join(root, 'parent');
  const child = path.join(parent, 'child');
  await fs.mkdir(child, { recursive: true });
  await initWorkspace(parent, { templatePack: 'consumer' });
  await initWorkspace(child, { templatePack: 'consumer' });

  const registryPath = path.join(openprdHome, 'registry', 'workspaces.jsonl');
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, [
    JSON.stringify({ version: 1, workspaceRoot: os.homedir(), realpath: os.homedir(), recordedAt: '2026-06-02 12:00:00' }),
    JSON.stringify({ version: 1, workspaceRoot: parent, realpath: parent, recordedAt: '2026-06-02 12:00:01' }),
    JSON.stringify({ version: 1, workspaceRoot: child, realpath: child, recordedAt: '2026-06-02 12:00:02' }),
    '',
  ].join('\n'));

  const doctor = await doctorWorkspace(parent, { openprdHome });
  assert.equal(doctor.registry.hygiene.ok, false);
  assert.ok(doctor.registry.hygiene.issues.some((issue) => issue.kind === 'overbroad-root'));
  assert.ok(doctor.registry.hygiene.issues.some((issue) => issue.kind === 'ambiguous-nesting'));
  assert.ok(doctor.warnings.some((warning) => warning.includes('过宽')));
  assert.ok(doctor.warnings.some((warning) => warning.includes('父子嵌套')));
});

test('fleet update backfills missing active artifacts and ignores legacy content-doc debt in batch health', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-health-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const existing = path.join(root, 'existing-openprd');
  await fs.mkdir(existing, { recursive: true });

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  await fs.appendFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), '\nmanual drift\n');
  await fs.writeFile(path.join(existing, 'docs', 'basic', 'backend-structure.md'), '# Backend\n', 'utf8');
  await fs.mkdir(path.join(existing, 'Output', 'wechat'), { recursive: true });
  await fs.writeFile(path.join(existing, 'Output', 'wechat', 'article.html'), '<article>legacy output</article>\n');
  await fs.rm(path.join(existing, '.openprd', 'engagements', 'active', 'flows.md'));
  await fs.rm(path.join(existing, '.openprd', 'engagements', 'active', 'roles.md'));
  await fs.rm(path.join(existing, '.openprd', 'engagements', 'active', 'handoff.md'));

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 1,
    openprdHome,
  });
  const project = updated.projects.find((item) => item.relativePath === 'existing-openprd');
  assert.equal(updated.ok, true);
  assert.equal(updated.summary.updated, 1);
  assert.equal(updated.summary.failed, 0);
  assert.equal(updated.summary.healthAttention, 0);
  assert.equal(updated.errors.length, 0);
  assert.equal(project.status, 'updated');
  assert.equal(project.ok, true);
  assert.equal(project.healthOk, true);
  assert.deepEqual(project.healthErrors ?? [], []);
  assert.ok((await fs.readFile(path.join(existing, '.codex', 'skills', 'openprd-harness', 'SKILL.md'), 'utf8')).includes('OPENPRD:GENERATED'));
  assert.ok(await fs.stat(path.join(existing, '.openprd', 'engagements', 'active', 'flows.md')).then(() => true));
  assert.ok(await fs.stat(path.join(existing, '.openprd', 'engagements', 'active', 'roles.md')).then(() => true));
  assert.ok(await fs.stat(path.join(existing, '.openprd', 'engagements', 'active', 'handoff.md')).then(() => true));

  const strictDoctor = await doctorWorkspace(existing, { openprdHome });
  assert.equal(strictDoctor.ok, true);
  assert.equal(strictDoctor.readiness.integrationsReady, true);
  assert.equal(strictDoctor.readiness.structuralReady, true);
  assert.equal(strictDoctor.readiness.standardsReady, false);
  assert.equal(strictDoctor.readiness.workspaceReady, false);
  assert.equal(strictDoctor.readiness.actionReady, true);
  assert.equal(strictDoctor.errors.length, 0);
  assert.ok(strictDoctor.standardsAttention.errors.some((error) => error.includes('docs/basic/backend-structure.md')));
  assert.ok(strictDoctor.standardsAttention.errors.some((error) => error.includes('Output/wechat/article.html')));

  const cliLogs = [];
  const originalLog = console.log;
  console.log = (...args) => cliLogs.push(args.join(' '));
  try {
    assert.equal(await main(['fleet', root, '--update-openprd', '--max-depth', '1']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(cliLogs.some((line) => line.includes('OpenPrd fleet: 通过')));
  assert.ok(cliLogs.some((line) => line.includes('失败 0')));
  assert.ok(cliLogs.every((line) => !line.includes('项目健康:')));
});

test('fleet update preserves standards external reference paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-fleet-standards-config-test-'));
  const openprdHome = path.join(root, '.openprd-home');
  const existing = path.join(root, 'existing-openprd');
  await fs.mkdir(existing, { recursive: true });

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  await fs.mkdir(path.join(existing, 'research', 'reference-repo'), { recursive: true });
  await fs.mkdir(path.join(existing, 'resources', 'toolkit-sources'), { recursive: true });

  const standardsConfigPath = path.join(existing, '.openprd', 'standards', 'config.json');
  const standardsConfig = JSON.parse(await fs.readFile(standardsConfigPath, 'utf8'));
  standardsConfig.externalReferences = {
    ...(standardsConfig.externalReferences ?? {}),
    paths: ['research', 'resources/toolkit-sources'],
  };
  await fs.writeFile(standardsConfigPath, `${JSON.stringify(standardsConfig, null, 2)}\n`);

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 1,
    openprdHome,
  });
  assert.equal(updated.summary.updated, 1);

  const nextConfig = JSON.parse(await fs.readFile(standardsConfigPath, 'utf8'));
  assert.deepEqual(nextConfig.externalReferences?.paths, ['research', 'resources/toolkit-sources']);
});

test('freeze writes a snapshot and handoff exports openprd bundle', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'b2b' });
  await synthesizeWorkspace(project, {
    title: '企业客户交接',
    owner: 'PM',
    problemStatement: '销售团队在企业客户导入时容易丢失上下文',
    whyNow: '线索量正在增长',
    evidence: ['CRM 备注'],
    primaryUsers: ['销售运营'],
    stakeholders: ['销售团队', '客户成功团队'],
    goals: ['减少客户导入遗漏'],
    successMetrics: ['交接完成率超过 95%'],
    acceptanceGoals: ['团队可以检查每个导入字段'],
    inScope: ['企业客户导入检查清单'],
    outOfScope: ['账单迁移'],
    primaryFlows: ['销售运营检查客户导入信息'],
    edgeCases: ['必填字段缺失'],
    failureModes: ['CRM 导入失败'],
    functional: ['创建导入检查记录'],
    nonFunctional: ['p95 < 2s'],
    businessRules: ['只有客户负责人可以批准'],
    technical: ['复用当前 CRM 同步'],
    compliance: ['SOC2 审计日志'],
    dependencies: ['CRM API'],
    assumptions: ['CRM 客户已存在'],
    risks: ['负责人分配错误'],
    openQuestions: ['是否需要法务批准？'],
    handoffOwner: 'PM',
    nextStep: '冻结并交接',
    targetSystem: 'OpenPrd',
    productType: 'b2b',
    buyer: '销售负责人',
    user: '销售运营',
    admin: '系统管理员',
    operator: '客户成功运营',
    roles: '销售负责人、销售运营、客户成功运营、系统管理员',
    asIs: '销售运营手动检查 CRM 备注后转交客户成功',
    toBe: '系统生成检查清单并要求负责人确认后交接',
    permissionMatrix: '客户负责人可批准，运营可编辑，客户成功可查看',
    approvalFlow: '销售负责人确认后进入客户成功交接',
  });
  await diagramWorkspace(project, { open: false, type: 'architecture', mark: 'confirmed' });
  await reviewWorkspace(project, { mark: 'confirmed' });
  await releaseWorkspace(project, {
    setVersion: '0.1.23',
    notes: '新增企业客户交接版本说明',
  });

  const freezeResult = await freezeWorkspace(project);
  assert.equal(freezeResult.ok, true);
  assert.equal(freezeResult.snapshot.prdVersion, 1);
  assert.ok(freezeResult.snapshot.digest.length > 0);

  const handoffResult = await handoffWorkspace(project, 'openprd');
  assert.equal(handoffResult.ok, true);
  assert.equal(handoffResult.handoff.versionId, 'v0001');
  assert.ok(handoffResult.handoff.digest.length > 0);

  const handoffJsonPath = path.join(project, '.openprd', 'exports', 'openprd', 'handoff.json');
  const handoffJson = JSON.parse(await fs.readFile(handoffJsonPath, 'utf8'));
  const handoffMd = await fs.readFile(path.join(project, '.openprd', 'exports', 'openprd', 'handoff.md'), 'utf8');
  const activeHandoff = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'handoff.md'), 'utf8');
  assert.equal(handoffJson.target, 'openprd');
  assert.equal(handoffJson.templatePack, 'b2b');
  assert.equal(handoffJson.versionId, 'v0001');
  assert.equal(handoffJson.projectVersion, '0.1.23');
  assert.equal(Array.isArray(handoffJson.changeSummary.items), true);
  assert.ok(handoffJson.changeSummary.items.length > 0);
  assert.ok(handoffJson.releaseNotes.every((item) => item.includes('：')));
  assert.ok(handoffJson.releaseNotes.some((item) => item.includes('版本说明')));
  assert.ok(handoffMd.includes('项目版本: 0.1.23'));
  assert.ok(handoffMd.includes('## 变化摘要'));
  assert.ok(activeHandoff.includes('项目版本: 0.1.23'));
  assert.ok(activeHandoff.includes('## 变化摘要'));
});

test('change generation, freeze, and handoff treat review and workspace standards as nonblocking attention', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const synthesized = await synthesizeWorkspace(project, {
    title: '个人任务收口',
    owner: 'PM',
    problemStatement: '用户需要把当前任务继续推进到可交接状态',
    whyNow: '当前实现已经开始，需要保持动作连续性',
    primaryUsers: ['个人用户'],
    goals: ['完成当前任务并交接'],
    successMetrics: ['当前任务可以继续执行'],
    acceptanceGoals: ['生成的 change 与当前版本绑定'],
    inScope: ['当前任务'],
    outOfScope: ['历史工作区债务'],
    primaryFlows: ['继续实现后生成交接包'],
    functional: ['继续当前任务'],
    productType: 'consumer',
  });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export const app = true;\n');

  const generated = await generateOpenSpecChangeWorkspace(project, { change: 'current-task' });
  assert.equal(generated.ok, true);
  assert.equal(generated.snapshot.versionId, synthesized.snapshot.versionId);
  assert.equal(generated.snapshot.digest, synthesized.snapshot.digest);
  assert.equal(generated.reviewAttention?.blocking, false);
  assert.equal(generated.validation.taskReady, true);
  assert.equal(generated.validation.workspaceReady, false);
  assert.equal(generated.validation.claimReady, false);

  const frozen = await freezeWorkspace(project);
  assert.equal(frozen.ok, true);
  assert.equal(frozen.actionReady, true);
  assert.equal(frozen.claimReady, false);
  assert.equal(frozen.workspaceReady, false);
  assert.ok(frozen.workspaceAttention);

  const handedOff = await handoffWorkspace(project, 'openprd');
  assert.equal(handedOff.ok, true);
  assert.equal(handedOff.actionReady, true);
  assert.equal(handedOff.workspaceReady, false);
  assert.equal(handedOff.handoff.versionId, synthesized.snapshot.versionId);

  const invalidTarget = await handoffWorkspace(project, '../outside');
  assert.equal(invalidTarget.ok, false);
  assert.equal(invalidTarget.actionReady, false);
  assert.match(invalidTarget.errors[0], /Handoff target/);
});
