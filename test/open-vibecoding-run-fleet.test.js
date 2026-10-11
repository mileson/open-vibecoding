import test from 'node:test';

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

async function seedKnowledgeSkill(project, skillName = 'billing-trace-rollback') {
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
    '## 可复用模式',
    '- 先确认 traceId 在 API 和 webhook 链路里一致透传',
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
  const iterations = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'iterations.jsonl'), 'utf8');
  assert.match(iterations, /UserPromptSubmit/);
  assert.match(iterations, /prompt-observed/);

  assert.equal(await main(['run', project]), 1);
});
test('run verify ignores historical active changes without selecting Agent context', async () => {
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
  assert.deepEqual(validatedChanges, []);
  assert.equal(result.scope.changeId, null);
  assert.equal('context' in result, false);
});
test('fleet sync-registry backfills known workspaces and reports registry scope outside the current root', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-fleet-registry-test-'));
  const openprdHome = path.join(workspaceRoot, '.open-vibecoding-home');
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

test('fleet update discovers legacy root open-vibecoding artifacts and leaves them in place', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-fleet-legacy-root-test-'));
  const legacyProject = path.join(root, 'legacy-open-vibecoding-project');
  const legacyChange = path.join(legacyProject, 'open-vibecoding', 'changes', 'legacy-root-change');
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
  const planned = dryRun.projects.find((project) => project.relativePath === 'legacy-open-vibecoding-project');
  assert.equal(planned.plannedAction, 'update');
  assert.ok(planned.markers.includes('open-vibecoding-legacy-artifacts'));

  const updated = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 2,
  });

  assert.equal(updated.ok, true);
  assert.equal(updated.summary.updated, 1);
  assert.equal(await pathExists(path.join(legacyProject, '.open-vibecoding', 'changes', 'legacy-root-change', 'tasks.md')), false);
  assert.equal(await pathExists(path.join(legacyProject, 'open-vibecoding', 'changes', 'legacy-root-change', 'tasks.md')), true);
  const item = updated.projects.find((project) => project.relativePath === 'legacy-open-vibecoding-project');
  assert.ok(item.status === 'updated');
});

test('doctor reports registry hygiene warnings for overbroad and nested workspaces', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-registry-hygiene-test-'));
  const openprdHome = path.join(root, '.open-vibecoding-home');
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


test('fleet update preserves standards external reference paths', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-fleet-standards-config-test-'));
  const openprdHome = path.join(root, '.open-vibecoding-home');
  const existing = path.join(root, 'existing-openprd');
  await fs.mkdir(existing, { recursive: true });

  await initWorkspace(existing, { templatePack: 'agent', openprdHome });
  await fs.mkdir(path.join(existing, 'research', 'reference-repo'), { recursive: true });
  await fs.mkdir(path.join(existing, 'resources', 'toolkit-sources'), { recursive: true });

  const standardsConfigPath = path.join(existing, '.open-vibecoding', 'standards', 'config.json');
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
