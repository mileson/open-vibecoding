import test from 'node:test';
import { buildProcessInvocation } from '../src/codex-runtime.js';

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
test('setup enables Codex hooks while preserving user hook groups', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const previousCodexHome = process.env.OPEN_VIBECODING_CODEX_HOME;
  const previousOpenPrdHome = process.env.OPEN_VIBECODING_HOME;
  process.env.OPEN_VIBECODING_CODEX_HOME = codexHome;
  process.env.OPEN_VIBECODING_HOME = path.join(project, 'open-vibecoding-home');
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex', 'hooks.json'), JSON.stringify({
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          {
            type: 'command',
            command: 'echo user-hook',
          },
        ],
      },
    ],
  }, null, 2) + '\n');

  try {
    const result = await setupAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
    });
    assert.equal(result.ok, true);
    assert.equal(result.initialized, true);
    assert.deepEqual(result.tools, ['codex']);

    const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
    assert.ok(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command === 'echo user-hook')));
    assert.equal(hooks.PostToolUse.some((group) => group.hooks?.some((hook) => hook.command.includes('open-vibecoding-hook.mjs'))), false);
    assert.equal(Boolean(hooks.SessionStart?.some((group) => group.hooks?.some((hook) => hook.command.includes('open-vibecoding-hook.mjs')))), false);
    assert.ok(findOpenPrdHookGroup(hooks.UserPromptSubmit));
    assert.equal(findOpenPrdHookGroup(hooks.PreToolUse)?.matcher, OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER);

    const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
    assert.equal(hasTomlFeatureKey(config, 'hooks'), true);
    assert.equal(hasTomlFeatureKey(config, 'codex_hooks'), false);
    assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
    assert.ok(config.includes('[[hooks.UserPromptSubmit.hooks]]'));
    assert.ok(config.includes('[[hooks.PreToolUse]]'));
    assert.ok(config.includes('[[hooks.PreToolUse.hooks]]'));
    assert.ok(config.includes('[[hooks.Stop]]'));
    assert.ok(config.includes('[[hooks.Stop.hooks]]'));
    assert.ok(config.includes(`matcher = "${OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER}"`));
    assert.equal(config.includes('matcher = "*"'), false);
    assert.equal(config.includes('[[hooks.PostToolUse]]'), false);
    const userConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
    assert.equal(hasTomlFeatureKey(userConfig, 'hooks'), true);
    assert.equal(hasTomlFeatureKey(userConfig, 'codex_hooks'), false);
    const manifest = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'install-manifest.json'), 'utf8'));
    assert.equal(manifest.hooks.profile, 'lite');
    assert.deepEqual(manifest.hooks.events, ['UserPromptSubmit', 'PreToolUse', 'Stop']);
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/hooks/open-vibecoding-hook.mjs'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.open-vibecoding/harness/command-catalog.md'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/skills/open-vibecoding-frontend-design/SKILL.md'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/skills/open-vibecoding-product-diagnosis/SKILL.md'));
    assert.ok(manifest.managedFiles.some((file) => file.path === '.codex/skills/open-vibecoding-interaction-design/SKILL.md'));
    assert.equal(manifest.hooks.runtimeEnvironment, '.open-vibecoding/harness/runtime-environment.json');
    assert.equal(manifest.runtimeDetection.version, 1);
    assert.equal(manifest.runtimeDetection.activeEvidencePriority[0].id, 'hook-session-payload');
    assert.equal(Array.isArray(manifest.platformCapabilityPacks), true);
    const codexCapabilityPack = manifest.platformCapabilityPacks.find((pack) => pack.id === 'codex');
    assert.ok(codexCapabilityPack);
    assert.ok(codexCapabilityPack.capabilities.some((capability) => capability.id === 'native-image-generation'));
    assert.ok(codexCapabilityPack.capabilities.some((capability) => capability.id === 'computer-use'));
    assert.ok(codexCapabilityPack.capabilities.some((capability) => capability.id === 'conversation-canvas'));
    const codexThreadRelay = codexCapabilityPack.capabilities.find((capability) => capability.id === 'codex-current-thread-relay');
    assert.ok(codexThreadRelay);
    assert.equal(codexThreadRelay.status, 'surface-dependent-agent-tool');
    assert.ok(codexThreadRelay.evidence.includes('codex app-server turn/start'));
    assert.ok(codexThreadRelay.evidence.includes('.open-vibecoding/harness/canvas-sessions/<session-key>/relays/*.status.json'));
    assert.match(codexThreadRelay.note, /text \+ localImage/);
    assert.equal(Array.isArray(manifest.optionalCapabilities), true);
    assert.deepEqual(manifest.optionalCapabilities.map((capability) => capability.id), ['context7', 'deepwiki']);
    assert.ok(manifest.optionalCapabilities.every((capability) => capability.status === 'recommended'));
    assert.ok(manifest.optionalCapabilities.every((capability) => capability.checkedLocations.some((location) => location.path === '.codex/config.toml')));
    const runtimeEnvironment = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'runtime-environment.json'), 'utf8'));
    assert.equal(runtimeEnvironment.runtimeDetection.version, 1);
    assert.ok(runtimeEnvironment.runtimeDetection.outputFields.includes('executionMode'));
    assert.equal(runtimeEnvironment.active.executionMode, 'interactive');
    assert.ok(runtimeEnvironment.platformCapabilityPacks.some((pack) => pack.id === 'codex'));
    const generatedAgents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
    assert.ok(generatedAgents.includes('Agent 自主理解、拆解、执行和验证'));
    assert.ok(generatedAgents.includes('不要求生成 requirement、PRD、review.html、change 或 tasks'));
    assert.ok(generatedAgents.includes('open-vibecoding capabilities list'));
    assert.ok(generatedAgents.includes('不用固定关键词匹配'));
    assert.ok((await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-product-diagnosis', 'SKILL.md'), 'utf8')).includes('# 产品诊断'));
    assert.ok((await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-product-research', 'SKILL.md'), 'utf8')).includes('# 用户与市场调研'));
    const generatedRouterSkill = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-router', 'SKILL.md'), 'utf8');
    assert.ok(generatedRouterSkill.includes('不以 PRD、change、tasks 或 review.html 为默认产物'));
    const generatedIntakeSkill = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-requirement-intake', 'SKILL.md'), 'utf8');
    assert.ok(generatedIntakeSkill.includes('不运行 `capture -> classify -> synthesize -> review -> change -> tasks`'));
    const generatedHarnessSkill = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-harness', 'SKILL.md'), 'utf8');
    assert.ok(generatedHarnessSkill.includes('不要求固定起手指令或线性流程'));
    const generatedTestSkill = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-test-strategy', 'SKILL.md'), 'utf8');
    assert.ok(generatedTestSkill.includes('不要求创建 tasks、evidence-plan、Markdown/HTML 测试报告'));
    const generatedHook = await fs.readFile(path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'utf8');
    assert.ok(generatedHook.includes('不再为每条 L2 提示创建 requirement 状态文件'));
    const commandCatalog = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'command-catalog.md'), 'utf8');
    assert.ok(commandCatalog.includes('只读查阅既有历史资料'));
    assert.ok(!commandCatalog.includes('change . --generate'));
    const fakeCodexBin = await writeFakeCodexBin(project);

    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    const previousPathForDoctor = process.env.PATH;
    try {
      process.env.PATH = `${fakeCodexBin}${path.delimiter}${previousPathForDoctor}`;
      assert.equal(await main(['doctor', project, '--tools', 'codex', '--json']), 0);
    } finally {
      process.env.PATH = previousPathForDoctor;
      console.log = originalLog;
    }
    assert.ok(JSON.parse(logs.join('\n')).ok);

    await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
      type: 'module',
      scripts: {
        'test:smoke': 'node --test smoke.test.js',
      },
    }, null, 2)}\n`);
    await fs.mkdir(path.join(project, 'docs', 'basic'), { recursive: true });
    await writeConcreteBasicDocs(project);
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await writeSourceManual(path.join(project, 'src', 'app.js'), 'export const app = true;');
    await writeFolderManual(path.join(project, 'src'), project, 'src');
    await fs.mkdir(path.join(project, '.open-vibecoding', 'harness', 'test-reports'), { recursive: true });
    await fs.writeFile(path.join(project, '.open-vibecoding', 'harness', 'test-reports', 'setup-smoke.md'), [
      '# EVO setup report',
      '',
      '- smoke: passed setup hook flow',
      '- feature coverage: no active change',
      '',
    ].join('\n'));

    const hookResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'PreToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'git commit -m "test"',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeCodexBin}${path.delimiter}${process.env.PATH}`,
        OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
      },
    });
    assert.equal(hookResult.status, 0);
    const hookPayload = JSON.parse(hookResult.stdout);
    assert.equal(hookPayload.continue, true);
    assert.equal(hookPayload.should_stop, undefined);
    assert.equal(hookPayload.additional_contexts, undefined);
    assert.equal(hookPayload.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(hookPayload.hookSpecificOutput.additionalContext.includes('high-risk gate passed'));

    const lowRiskResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'PreToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'ls',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
      },
    });
    assert.equal(lowRiskResult.status, 0);
    assert.deepEqual(JSON.parse(lowRiskResult.stdout), { continue: true });

    const successPostResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'PostToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        tool_input: {
          cmd: 'ls',
        },
        tool_response: {
          stdout: 'README.md',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
      },
    });
    assert.equal(successPostResult.status, 0);
    assert.deepEqual(JSON.parse(successPostResult.stdout), { continue: true });

    const sessionStartResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'SessionStart'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        hook_event_name: 'SessionStart',
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
      },
    });
    assert.equal(sessionStartResult.status, 0);
    const sessionStartPayload = JSON.parse(sessionStartResult.stdout);
    assert.equal(sessionStartPayload.continue, true);
    assert.equal(sessionStartPayload.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.ok(sessionStartPayload.hookSpecificOutput.additionalContext.includes(path.join(project, '.open-vibecoding/harness/internal-skills/open-vibecoding-router/SKILL.md')));

    for (const eventName of ['UserPromptSubmit']) {
      const eventResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), eventName], {
        cwd: project,
        input: JSON.stringify({
          cwd: project,
          hook_event_name: eventName,
          prompt: eventName === 'UserPromptSubmit' ? '继续推进 Open VibeCoding' : undefined,
        }),
        encoding: 'utf8',
        env: {
          ...process.env,
          OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
        },
      });
      assert.equal(eventResult.status, 0);
      const eventPayload = JSON.parse(eventResult.stdout);
      assert.equal(eventPayload.continue, true);
      assert.equal(eventPayload.should_stop, undefined);
      assert.equal(eventPayload.additional_contexts, undefined);
      assert.equal(eventPayload.hookSpecificOutput.hookEventName, eventName);
      assert.ok(eventPayload.hookSpecificOutput.additionalContext.includes('不按固定关键词派发'));
    }
    const productCopyPrompt = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'UserPromptSubmit'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        hook_event_name: 'UserPromptSubmit',
        prompt: '把这个英文按钮按英语母语软件产品习惯缩短，不要直译',
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
      },
    });
    assert.equal(productCopyPrompt.status, 0);
    const productCopyWrite = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'PreToolUse'], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        hook_event_name: 'PreToolUse',
        tool_name: 'apply_patch',
        tool_input: {
          patch: '*** Begin Patch\n*** Update File: src/app.js\n*** End Patch',
        },
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPEN_VIBECODING_CLI: path.resolve('open-vibecoding/bin/open-vibecoding.js'),
      },
    });
    assert.equal(productCopyWrite.status, 0);
    const productCopyPayload = JSON.parse(productCopyWrite.stdout);
    assert.equal(productCopyPayload.continue, true);
    assert.ok(productCopyPayload.hookSpecificOutput.additionalContext.includes('多语言文案不得逐字翻译'));
    assert.ok(productCopyPayload.hookSpecificOutput.additionalContext.includes('Auto Edit'));
    assert.ok(productCopyPayload.hookSpecificOutput.additionalContext.includes('Accessibility Label'));
    const events = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'events.jsonl'), 'utf8');
    assert.ok(events.includes('allowed-high-risk'));
    assert.ok(events.includes('allowed-with-product-copy-attention'));
    assert.equal(events.includes('allowed-low-risk'), false);
    assert.equal(events.includes('tool-complete'), false);
    const observedRuntimeEnvironment = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'runtime-environment.json'), 'utf8'));
    assert.equal(observedRuntimeEnvironment.active.activeClient, 'codex');
    assert.equal(observedRuntimeEnvironment.active.surface, 'codex-hook');
    assert.ok(observedRuntimeEnvironment.active.confidence >= 0.9);
    assert.ok(observedRuntimeEnvironment.active.evidence.includes('hook.cwd'));
    assert.ok(observedRuntimeEnvironment.active.observedCapabilities.includes('codex-hooks'));
    const hookState = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'hook-state.json'), 'utf8'));
    assert.equal(hookState.runtimeEnvironment.activeClient, 'codex');
    await fs.appendFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-harness', 'SKILL.md'), '\nmanual drift\n');
    const drifted = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(drifted.ok, false);
    assert.ok(drifted.agentIntegration.drift.errors.some((error) => error.includes('checksum-drift')));
    const updated = await updateAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
    });
    assert.equal(updated.ok, true);
    const repaired = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
    assert.equal(repaired.ok, true);
    assert.equal(repaired.agentIntegration.drift.ok, true);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.OPEN_VIBECODING_CODEX_HOME;
    } else {
      process.env.OPEN_VIBECODING_CODEX_HOME = previousCodexHome;
    }
    if (previousOpenPrdHome === undefined) {
      delete process.env.OPEN_VIBECODING_HOME;
    } else {
      process.env.OPEN_VIBECODING_HOME = previousOpenPrdHome;
    }
  }
});

test('doctor reports missing generated artifact ignores and update repairs them', async () => {
  const project = await makeTempProject();
  const setup = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
  });
  assert.equal(setup.ok, true);

  await fs.writeFile(path.join(project, '.gitignore'), 'node_modules/\n');
  const doctor = await doctorWorkspace(project, { tools: 'codex' });
  assert.equal(doctor.ok, false);
  const ignoreCheck = doctor.agentIntegration.checks.find((check) => check.path === '.gitignore');
  assert.equal(ignoreCheck?.ok, false);
  assert.equal(ignoreCheck?.reason, 'missing-open-vibecoding-generated-artifact-ignores');
  assert.ok(ignoreCheck?.message.includes('.open-vibecoding/quality/reports/'));

  const updated = await updateAgentIntegrationWorkspace(project, { tools: 'codex' });
  assert.equal(updated.ok, true);
  assert.ok(updated.migration.changes.some((change) => change.path === '.gitignore' && change.status === 'updated'));
  const gitignore = await fs.readFile(path.join(project, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.open-vibecoding/harness/'));
  assert.ok(gitignore.includes('.open-vibecoding/learning/'));
  assert.ok(gitignore.includes('.open-vibecoding/quality/reports/'));
});

test('update preserves legacy root artifacts in place and keeps them readable', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const legacyChange = path.join(project, 'open-vibecoding', 'changes', 'legacy-ui');
  await fs.mkdir(path.join(legacyChange, 'specs', 'legacy-ui'), { recursive: true });
  await fs.writeFile(path.join(legacyChange, 'proposal.md'), '# Legacy UI\n');
  await fs.writeFile(path.join(legacyChange, 'tasks.md'), '- [ ] T001.01 Move legacy task\n');
  await fs.writeFile(path.join(legacyChange, 'specs', 'legacy-ui', 'spec.md'), '# Legacy spec\n');
  await fs.mkdir(path.join(project, 'open-vibecoding', 'specs', 'legacy-ui'), { recursive: true });
  await fs.writeFile(path.join(project, 'open-vibecoding', 'specs', 'legacy-ui', 'spec.md'), '# Accepted legacy spec\n');
  await fs.mkdir(path.join(project, 'open-vibecoding', 'archive', 'changes', 'archived-ui'), { recursive: true });
  await fs.writeFile(path.join(project, 'open-vibecoding', 'archive', 'changes', 'archived-ui', 'tasks.md'), '- [x] T001.01 Archived task\n');

  const updated = await updateAgentIntegrationWorkspace(project, { tools: 'codex' });

  assert.equal(updated.ok, true);
  assert.equal(updated.migration.legacyOpenPrdMigration.ok, true);
  assert.equal(await pathExists(path.join(project, 'open-vibecoding', 'changes', 'legacy-ui', 'tasks.md')), true);
  assert.equal(await pathExists(path.join(project, 'open-vibecoding', 'specs', 'legacy-ui', 'spec.md')), true);
  assert.equal(await pathExists(path.join(project, 'open-vibecoding', 'archive', 'changes', 'archived-ui', 'tasks.md')), true);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'changes', 'legacy-ui')), false);
  const changes = await listOpenPrdChangesWorkspace(project);
  assert.ok(changes.changes.some((change) => change.id === 'legacy-ui'));
  const specs = await listAcceptedSpecsWorkspace(project);
  assert.ok(specs.specs.some((spec) => spec.capability === 'legacy-ui'));
});

test('setup emits Windows-safe Codex hook commands with double-quoted paths', async () => {
  const originalProject = await makeTempProject();
  const project = path.join(path.dirname(originalProject), 'project with spaces');
  const codexHome = path.join(project, 'codex-home');
  const previousCodexHome = process.env.OPEN_VIBECODING_CODEX_HOME;
  process.env.OPEN_VIBECODING_CODEX_HOME = codexHome;
  await fs.rename(originalProject, project);

  try {
    const result = await setupAgentIntegrationWorkspace(project, {
      tools: 'codex',
      templatePack: 'agent',
      enableUserCodexConfig: true,
      codexHome,
      platform: 'win32',
    });
    assert.equal(result.ok, true);

    const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
    const promptGroup = findOpenPrdHookGroup(hooks.UserPromptSubmit);
    assert.ok(promptGroup);
    assert.equal(promptGroup.hooks[0].command.startsWith('node "'), true);
    assert.ok(promptGroup.hooks[0].command.includes('/project with spaces/.codex/hooks/open-vibecoding-hook.mjs" UserPromptSubmit'));
    assert.equal(/node '.*open-vibecoding-hook\.mjs'/.test(promptGroup.hooks[0].command), false);

    const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
    assert.ok(config.includes('command = "node \\"'));
    assert.ok(config.includes('project with spaces'));
    assert.equal(/node '.*open-vibecoding-hook\.mjs'/.test(config), false);
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.OPEN_VIBECODING_CODEX_HOME;
    } else {
      process.env.OPEN_VIBECODING_CODEX_HOME = previousCodexHome;
    }
  }
});

test('doctor reports optional capabilities without making them blocking and detects configured locations', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const cursorHome = path.join(project, 'cursor-home');

  await setupAgentIntegrationWorkspace(project, {
    tools: 'all',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
    cursorHome,
  });

  await fs.writeFile(path.join(project, '.cursor', 'mcp.json'), `${JSON.stringify({
    mcpServers: {
      context7: {
        url: 'https://mcp.context7.com/mcp',
      },
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.mcp.json'), `${JSON.stringify({
    mcpServers: {
      deepwiki: {
        url: 'https://mcp.deepwiki.com/mcp',
      },
    },
  }, null, 2)}\n`);

  const doctor = await doctorWorkspace(project, {
    tools: 'all',
    enableUserCodexConfig: true,
    codexHome,
    cursorHome,
  });
  assert.equal(doctor.ok, true, JSON.stringify(doctor.errors ?? doctor.agentIntegration?.errors ?? []));

  const context7 = doctor.agentIntegration.optionalCapabilities.find((capability) => capability.id === 'context7');
  const deepwiki = doctor.agentIntegration.optionalCapabilities.find((capability) => capability.id === 'deepwiki');
  assert.equal(context7?.status, 'configured');
  assert.ok(context7?.configuredLocations.some((location) => location.path === '.cursor/mcp.json'));
  assert.equal(deepwiki?.status, 'configured');
  assert.ok(deepwiki?.configuredLocations.some((location) => location.path === '.mcp.json'));
});


test('doctor fails when Codex hook emits legacy output schema', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  await fs.writeFile(
    path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'),
    'console.log(JSON.stringify({ should_stop: false, additional_contexts: [] }));\n',
  );

  const result = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(result.ok, false);
  assert.ok(result.agentIntegration.checks.some((check) => (
    check.path === '.codex/hooks/open-vibecoding-hook.mjs:smoke'
      && check.ok === false
      && check.message.includes('legacy fields')
  )));
});

test('doctor distinguishes unmanaged generated skill files from missing files', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const skillPath = path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-requirement-intake', 'SKILL.md');
  await fs.writeFile(skillPath, '# Local custom intake skill\n');

  const doctor = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(doctor.ok, false);
  const check = doctor.agentIntegration.checks.find((item) => item.path === '.open-vibecoding/harness/internal-skills/open-vibecoding-requirement-intake/SKILL.md');
  assert.equal(check.ok, false);
  assert.equal(check.reason, 'missing-generated-marker');
  assert.ok(check.message.includes('lacks OPEN_VIBECODING:GENERATED'));
  assert.ok(check.repairHint.includes('open-vibecoding update . --force'));
  assert.ok(doctor.errors.some((error) => error.includes('missing-generated-marker') || error.includes('OPEN_VIBECODING:GENERATED')));

  const update = await updateAgentIntegrationWorkspace(project, {
    tools: 'codex',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(update.ok, false);
  const skipped = update.changes.find((change) => change.path === '.open-vibecoding/harness/internal-skills/open-vibecoding-requirement-intake/SKILL.md');
  assert.equal(skipped.status, 'skipped-user-file');
  assert.equal(skipped.reason, 'missing-generated-marker');
  assert.ok(skipped.repairHint.includes('open-vibecoding update . --force'));
  assert.equal(await fs.readFile(skillPath, 'utf8'), '# Local custom intake skill\n');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['doctor', project, '--tools', 'codex']), 1);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('未受管') && line.includes('.open-vibecoding/harness/internal-skills/open-vibecoding-requirement-intake/SKILL.md')));
  assert.ok(logs.some((line) => line.includes('missing-generated-marker')));
  assert.ok(logs.some((line) => line.includes('修复建议') && line.includes('open-vibecoding update . --force')));
});

test('setup strips legacy Codex hook feature flags and keeps other feature keys', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await fs.mkdir(path.join(project, '.codex'), { recursive: true });
  await fs.writeFile(path.join(project, '.codex', 'config.toml'), '[features]\nhooks = true\ncodex_hooks = true\nchild_agents_md = true\n');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, 'config.toml'), '[features]\nhooks = true\ncodex_hooks = true\n');

  const result = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(result.ok, true);

  const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.equal(hasTomlFeatureKey(config, 'hooks'), true);
  assert.ok(config.includes('child_agents_md = true'));
  assert.equal(hasTomlFeatureKey(config, 'codex_hooks'), false);

  const userConfig = await fs.readFile(path.join(codexHome, 'config.toml'), 'utf8');
  assert.equal(hasTomlFeatureKey(userConfig, 'hooks'), true);
  assert.equal(hasTomlFeatureKey(userConfig, 'codex_hooks'), false);
});

test('Codex runtime health diagnoses optional dependency failure without repairing by default', async () => {
  const calls = [];
  const runtime = await ensureCodexCliReady({
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.\nReinstall Codex: npm install -g @openai/codex@latest\n',
      };
    },
  });

  assert.equal(runtime.ok, false);
  assert.equal(runtime.repairAttempted, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { command: 'codex', args: ['--version'] });
  assert.equal(runtime.preflight.diagnostic.type, 'missing-optional-dependency');
  assert.equal(runtime.preflight.diagnostic.missingPackage, '@openai/codex-darwin-arm64');
  assert.equal(runtime.repairCommand.display, 'npm install -g @openai/codex@latest');
  assert.ok(runtime.errors.some((error) => error.includes('--repair-agent')));
});

test('Codex runtime health bounds a hung version command with a timeout', async () => {
  const startedAt = Date.now();
  const health = await checkCodexCliHealth({
    codexCommand: process.execPath,
    versionArgs: ['-e', 'setInterval(() => {}, 1000)'],
    timeoutMs: 40,
    killGraceMs: 20,
  });

  assert.equal(health.ok, false);
  assert.equal(health.result.timedOut, true);
  assert.equal(health.diagnostic.type, 'version-check-timeout');
  assert.ok(Date.now() - startedAt < 2000);
});

test('Codex runtime wraps bare Windows commands through cmd.exe for npm shims', () => {
  const invocation = buildProcessInvocation('codex', ['--version'], {
    platform: 'win32',
    env: {
      ...process.env,
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    },
  });

  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args, ['/d', '/s', '/c', 'codex --version']);
  assert.equal(invocation.display, 'codex --version');
  assert.equal(invocation.shell, false);
});

test('Codex runtime repair runs explicit npm install and rechecks version', async () => {
  const calls = [];
  const runtime = await ensureCodexCliReady({
    repair: true,
    runCommand: async (command, args) => {
      calls.push({ command, args });
      if (calls.length === 1) {
        return {
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
        };
      }
      if (calls.length === 2) {
        return { ok: true, exitCode: 0, stdout: 'installed\n', stderr: '' };
      }
      return { ok: true, exitCode: 0, stdout: 'codex 0.200.0\n', stderr: '' };
    },
  });

  assert.equal(runtime.ok, true);
  assert.equal(runtime.repairAttempted, true);
  assert.deepEqual(calls, [
    { command: 'codex', args: ['--version'] },
    { command: 'npm', args: ['install', '-g', '@openai/codex@latest'] },
    { command: 'codex', args: ['--version'] },
  ]);
  assert.equal(runtime.repair.ok, true);
  assert.equal(runtime.repair.recheck.version, 'codex 0.200.0');
});

test('doctor checks Codex CLI runtime and only repairs with --fix', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const failed = await doctorWorkspace(project, {
    tools: 'codex',
    checkCodexRuntime: true,
    enableUserCodexConfig: true,
    codexHome,
    codexRunCommand: async () => ({
      ok: false,
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
    }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.codexRuntime.preflight.diagnostic.missingPackage, '@openai/codex-darwin-arm64');
  assert.equal(failed.codexRuntime.repairAttempted, false);
  assert.ok(failed.errors.some((error) => error.includes('codex-runtime')));

  const calls = [];
  const repaired = await doctorWorkspace(project, {
    tools: 'codex',
    fix: true,
    checkCodexRuntime: true,
    enableUserCodexConfig: true,
    codexHome,
    codexRunCommand: async (command, args) => {
      calls.push({ command, args });
      if (calls.length === 1) {
        return {
          ok: false,
          exitCode: 1,
          stdout: '',
          stderr: 'Error: Missing optional dependency @openai/codex-darwin-arm64.',
        };
      }
      if (calls.length === 2) {
        return { ok: true, exitCode: 0, stdout: 'installed\n', stderr: '' };
      }
      return { ok: true, exitCode: 0, stdout: 'codex 0.200.0\n', stderr: '' };
    },
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.codexRuntime.repairAttempted, true);
  assert.equal(repaired.codexRuntime.repair.command.display, 'npm install -g @openai/codex@latest');
  assert.deepEqual(calls.map((call) => call.command), ['codex', 'npm', 'codex']);
});

test('setup can opt into guarded Codex hook profile', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  const result = await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    hookProfile: 'guarded',
    enableUserCodexConfig: true,
    codexHome,
  });
  assert.equal(result.ok, true);
  assert.equal(result.hookProfile, 'guarded');

  const hooks = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
  assert.ok(findOpenPrdHookGroup(hooks.UserPromptSubmit));
  assert.equal(findOpenPrdHookGroup(hooks.PreToolUse)?.matcher, OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER);
  assert.equal(Boolean(hooks.PostToolUse?.some((group) => group.hooks?.some((hook) => hook.command.includes('open-vibecoding-hook.mjs')))), false);

  const config = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.ok(config.includes('[[hooks.UserPromptSubmit]]'));
  assert.ok(config.includes('[[hooks.PreToolUse]]'));
  assert.ok(config.includes('[[hooks.Stop]]'));
  assert.ok(config.includes(`matcher = "${OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER}"`));
  assert.equal(config.includes('[[hooks.PostToolUse]]'), false);

  const manifest = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.hooks.profile, 'guarded');
  assert.deepEqual(manifest.hooks.events, ['UserPromptSubmit', 'PreToolUse', 'Stop']);

  const doctor = await doctorWorkspace(project, { tools: 'codex', enableUserCodexConfig: true, codexHome });
  assert.equal(doctor.agentIntegration.hookProfile, 'guarded');
  assert.equal(doctor.ok, true);
});

test('generated skills keep legacy records read-only across adapters', async () => {
  const project = await makeTempProject();
  await setupAgentIntegrationWorkspace(project, { tools: 'all' });
  for (const skillId of ['open-vibecoding-router', 'open-vibecoding-requirement-intake', 'open-vibecoding-shared', 'open-vibecoding-harness']) {
    const codex = await fs.readFile(path.join(project, '.codex', 'skills', skillId, 'SKILL.md'), 'utf8');
    const claude = await fs.readFile(path.join(project, '.claude', 'skills', skillId, 'SKILL.md'), 'utf8');
    const strip = (text) => text.replace(/<!-- OPEN_VIBECODING:GENERATED\n[^]*?-->\n?/g, '').trim();
    assert.equal(strip(codex), strip(claude));
    assert.ok(!codex.includes('由 Agent 在后台维护 PRD/review/change/tasks'));
  }
  const catalog = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'command-catalog.md'), 'utf8');
  assert.ok(catalog.includes('生成与推进实现已移除'));
});

test('generated guidance leaves review artifact choice to the Agent', async () => {
  const project = await makeTempProject();
  await setupAgentIntegrationWorkspace(project, { tools: 'all' });
  const agents = await fs.readFile(path.join(project, 'AGENTS.md'), 'utf8');
  const router = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-router', 'SKILL.md'), 'utf8');
  const harness = await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-harness', 'SKILL.md'), 'utf8');
  assert.ok(agents.includes('普通任务不为留痕生成文件'));
  assert.ok(router.includes('用户明确要文档、设计稿或审查界面时再作为交付物制作'));
  assert.ok(harness.includes('普通任务不生成 `review.html`'));
});

test('generated hook accepts Open VibeCoding automation opt-in and respects a negative request', async () => {
  const project = await makeTempProject();
  await setupAgentIntegrationWorkspace(project, { tools: 'codex' });
  const hook = path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs');
  const invoke = (sessionId, prompt) => spawnSync(process.execPath, [hook, 'UserPromptSubmit'], {
    input: JSON.stringify({ cwd: project, session_id: sessionId, automation_id: 'brand-test', prompt }),
    encoding: 'utf8',
    env: { ...process.env, CODEX_AUTOMATION_ID: 'brand-test' },
  });

  const optedIn = invoke('brand-opt-in', '这是 Open VibeCoding 维护任务');
  assert.equal(optedIn.status, 0, optedIn.stderr);
  const optInBinding = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'session-bindings', 'brand-opt-in.json'), 'utf8'));
  assert.equal(optInBinding.laneKind, 'open-vibecoding-maintenance');

  const optedOut = invoke('brand-opt-out', '不要启用 Open VibeCoding');
  assert.equal(optedOut.status, 0, optedOut.stderr);
  const optOutBinding = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'session-bindings', 'brand-opt-out.json'), 'utf8'));
  assert.equal(optOutBinding.laneKind, 'automation');
});
