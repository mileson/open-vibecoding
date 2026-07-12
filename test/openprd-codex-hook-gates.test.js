import test from 'node:test';

import {
  assert,
  spawnSync,
  fs,
  path,
  setupAgentIntegrationWorkspace,
  makeTempProject,
  pathExists,
} from './helpers/openprd-test-helpers.js';

function makeHookRunner(project, hookPath, extraInput = {}) {
  return (eventName, input) => {
    const result = spawnSync(process.execPath, [hookPath, eventName], {
      cwd: project,
      input: JSON.stringify({
        cwd: project,
        hook_event_name: eventName,
        ...extraInput,
        ...input,
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
}

test('Codex hook keeps autonomy risks advisory without adding OpenPrd approval gates', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const hookPath = path.join(project, '.codex', 'hooks', 'openprd-hook.mjs');
  const runHook = makeHookRunner(project, hookPath);

  const patchPayload = {
    tool_name: 'apply_patch',
    tool_input: {
      patch: [
        '*** Begin Patch',
        '*** Update File: src/entitlements.js',
        '@@',
        '+const fallbackMembership = { entitlement: "unlimited", membership: "pro" };',
        '*** End Patch',
        '',
      ].join('\n'),
    },
  };

  runHook('UserPromptSubmit', {
    prompt: '请直接修复会员权益，但除非我明确要求，不要写兜底或写死逻辑。',
  });
  const blockedFallback = runHook('PreToolUse', patchPayload);
  assert.equal(blockedFallback.continue, true);
  assert.equal(blockedFallback.decision, undefined);
  assert.ok(JSON.stringify(blockedFallback).includes('Agent 责任'));
  assert.ok(JSON.stringify(blockedFallback).includes('OpenPrd 不阻断工具调用'));

  runHook('UserPromptSubmit', {
    prompt: '请直接修复会员权益，这次明确允许临时兜底，后续同步回服务端配置。',
  });
  const allowedFallback = runHook('PreToolUse', patchPayload);
  assert.equal(allowedFallback.continue, true);
  assert.equal(allowedFallback.decision, undefined);

  runHook('UserPromptSubmit', {
    prompt: '请直接修复线上问题，但不要未经确认自己云端热修复。',
  });
  const blockedCloudHotfix = runHook('PreToolUse', {
    tool_input: {
      cmd: 'ssh prod "node scripts/fix-entitlement.js"',
    },
  });
  assert.equal(blockedCloudHotfix.decision, undefined);
  assert.equal(blockedCloudHotfix.continue, true);
  assert.ok(JSON.stringify(blockedCloudHotfix).includes('云端/生产远端写入'));
  assert.ok(JSON.stringify(blockedCloudHotfix).includes('OpenPrd 不阻断工具调用'));
});

test('Codex hook escalates confirmations, keeps requirement materials advisory, demotes tooling asks, and heals stale reviews', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const hookPath = path.join(project, '.codex', 'hooks', 'openprd-hook.mjs');
  const runHook = makeHookRunner(project, hookPath);
  const gatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
  const readGate = async () => JSON.parse(await fs.readFile(gatePath, 'utf8'));

  // 现有脚本/CLI 优化不应仅因“增加”动词被升成 L2 重流程。
  runHook('UserPromptSubmit', {
    prompt: '给发布上传脚本增加按版本筛选的参数支持，顺便清理旧目录',
  });
  const demotedGateExists = await pathExists(gatePath);
  if (demotedGateExists) {
    const demotedGate = await readGate();
    assert.notEqual(demotedGate.active, true, 'existing tooling optimization should not open the L2 requirement gate');
  }

  // autonomy-risk 收窄：普通安装器 fallback 代码不再被误判为业务兜底。
  runHook('UserPromptSubmit', { prompt: '继续完善安装器的容错处理' });
  const infraFallbackPatch = runHook('PreToolUse', {
    tool_name: 'apply_patch',
    tool_input: {
      patch: [
        '*** Begin Patch',
        '*** Update File: scripts/installer.js',
        '@@',
        '+// fallback to mirror server when the client cache config is missing',
        '+const fallbackServer = config.server || defaultMirror;',
        '*** End Patch',
        '',
      ].join('\n'),
    },
  });
  assert.notEqual(infraFallbackPatch.decision, 'block', JSON.stringify(infraFallbackPatch).slice(0, 400));

  // 打开一个真正的 L2 需求门禁。
  runHook('UserPromptSubmit', {
    prompt: '新增一个团队协作审批工作流模块，串联多个入口和流程编排，做成一站式平台能力',
  });
  let gate = await readGate();
  assert.equal(gate.active, true);
  assert.equal(gate.approvalPolicy.reviewPolicy, 'required');

  // 第一次确认：记录需求摘要确认。
  runHook('UserPromptSubmit', { prompt: '确认这版需求摘要' });
  gate = await readGate();
  assert.ok(gate.clarificationConfirmedAt, 'first confirmation should record clarification confirmation');
  assert.equal(gate.approvalPolicy.reviewPolicy, 'required');

  // 第二次确认：升级为 silent-record + 自动执行授权，不再重复索取确认。
  runHook('UserPromptSubmit', { prompt: '确定' });
  gate = await readGate();
  assert.equal(gate.approvalPolicy.reviewPolicy, 'silent-record');
  assert.equal(gate.approvalPolicy.executionMode, 'auto-after-review-and-tasks');
  assert.equal(gate.executionIntent.source, 'repeated-user-confirmation');
  assert.ok(Number(gate.confirmationCount) >= 2);

  // 需求材料由 Agent 后台维护，第一次实现写入就应直接放行。
  const patchPayload = {
    tool_name: 'apply_patch',
    tool_input: {
      patch: [
        '*** Begin Patch',
        '*** Update File: src/uploader.js',
        '@@',
        '+export function selectReleaseObjects(version) { return [version]; }',
        '*** End Patch',
        '',
      ].join('\n'),
    },
  };
  const firstWrite = runHook('PreToolUse', patchPayload);
  assert.equal(firstWrite.decision, undefined, JSON.stringify(firstWrite));
  assert.equal(firstWrite.continue, true);
  assert.ok(JSON.stringify(firstWrite).includes('does not block'));

  // 僵尸稿自愈：全局 current.json 残留其他会话的确认稿时，不再要求确认旧稿。
  const staleProject = await makeTempProject();
  await setupAgentIntegrationWorkspace(staleProject, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome: path.join(staleProject, 'codex-home'),
  });
  const staleHookPath = path.join(staleProject, '.codex', 'hooks', 'openprd-hook.mjs');
  const runStaleHook = makeHookRunner(staleProject, staleHookPath, {
    session_id: 'session-current-000001',
  });
  await fs.mkdir(path.join(staleProject, '.openprd', 'state'), { recursive: true });
  await fs.writeFile(path.join(staleProject, '.openprd', 'state', 'current.json'), JSON.stringify({
    laneSessionId: 'session-other-000001',
    latestVersionId: 'v0099',
    latestVersionDigest: 'f'.repeat(64),
    activeWorkUnitId: 'wu-stale-0001',
    reviewStatus: {
      versionId: 'v0099',
      workUnitId: 'wu-stale-0001',
      status: 'pending-confirmation',
    },
  }, null, 2));
  runStaleHook('UserPromptSubmit', {
    prompt: '新增一个团队协作审批工作流模块，串联多个入口和流程编排，做成一站式平台能力',
  });
  const staleWrite = runStaleHook('PreToolUse', patchPayload);
  assert.equal(staleWrite.decision, undefined);
  assert.equal(staleWrite.continue, true);
  assert.ok(!JSON.stringify(staleWrite).includes('version v0099'));
  assert.ok(JSON.stringify(staleWrite).includes('does not block'));
});

test('Codex hook turns one natural-language review confirmation into full-chain authorization', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const hookPath = path.join(project, '.codex', 'hooks', 'openprd-hook.mjs');
  const runHook = makeHookRunner(project, hookPath);
  const gatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
  const readGate = async () => JSON.parse(await fs.readFile(gatePath, 'utf8'));

  runHook('UserPromptSubmit', {
    prompt: '新增一个团队协作审批工作流模块，串联多个入口和流程编排，做成一站式平台能力',
  });
  let gate = await readGate();
  assert.equal(gate.active, true);

  // 模拟已合成待确认的稳定评审稿。
  const digest = '1'.repeat(64);
  await fs.mkdir(path.join(project, '.openprd', 'state'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'current.json'), JSON.stringify({
    latestVersionId: 'v0276',
    latestVersionDigest: digest,
    activeWorkUnitId: 'wu-tail-0001',
    reviewStatus: {
      versionId: 'v0276',
      workUnitId: 'wu-tail-0001',
      status: 'pending-confirmation',
    },
  }, null, 2));

  // 评审记录也是 Agent 后台维护材料，不应反过来阻塞用户已要求的工作。
  const prematureMark = runHook('PreToolUse', {
    tool_name: 'shell',
    tool_input: {
      command: `openprd review . --mark confirmed --version v0276 --digest ${digest} --work-unit wu-tail-0001`,
    },
  });
  assert.equal(prematureMark.decision, undefined);
  assert.equal(prematureMark.continue, true);
  assert.ok(JSON.stringify(prematureMark).includes('does not block'));

  // 一句自然语言确认（带版本号 + 继续执行）应当同时授权评审记录并升级整条链。
  runHook('UserPromptSubmit', { prompt: '确认 v0276 评审稿，继续执行' });
  gate = await readGate();
  assert.equal(gate.status, 'review-confirmation-authorized');
  assert.equal(gate.reviewActionAuthorization?.versionId, 'v0276');
  assert.equal(gate.reviewActionAuthorization?.digest, digest);
  assert.equal(gate.reviewActionAuthorization?.workUnitId, 'wu-tail-0001');
  assert.equal(gate.reviewActionAuthorization?.continueAfterReview, true);
  assert.equal(gate.approvalPolicy.reviewPolicy, 'silent-record');
  assert.equal(gate.approvalPolicy.executionMode, 'auto-after-review-and-tasks');

  // 评审记录命令由 agent 自己带精确 artifact 执行，不再被拦。
  const authorizedMark = runHook('PreToolUse', {
    tool_name: 'shell',
    tool_input: {
      command: `openprd review . --mark confirmed --version v0276 --digest ${digest} --work-unit wu-tail-0001`,
    },
  });
  assert.notEqual(authorizedMark.decision, 'block', JSON.stringify(authorizedMark).slice(0, 400));
});

test('Codex hook routes image generation by surface and honors persisted user preference', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  // 安装清单与运行时环境要携带生图路由协议。
  const manifest = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.imageGenerationRouting?.preferencePath, '.openprd/harness/image-generation-preference.json');
  assert.ok(manifest.imageGenerationRouting?.surfaceBuiltins?.codex?.includes('imagegen'));
  assert.ok(manifest.imageGenerationRouting?.surfaceBuiltins?.cursor?.includes('GenerateImage'));
  const runtimeEnvironment = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'runtime-environment.json'), 'utf8'));
  assert.equal(runtimeEnvironment.imageGenerationRouting?.preferencePath, '.openprd/harness/image-generation-preference.json');

  const hookPath = path.join(project, '.codex', 'hooks', 'openprd-hook.mjs');
  const runHook = makeHookRunner(project, hookPath);

  // 图片请求上下文必须包含生图路由与成本护栏。
  const mockupContext = runHook('UserPromptSubmit', { prompt: '帮我生成一张 App 首页封面图先看看样子' });
  const mockupText = JSON.stringify(mockupContext);
  assert.ok(mockupText.includes('生图路由'), mockupText.slice(0, 400));
  assert.ok(mockupText.includes('GenerateImage'), mockupText.slice(0, 400));
  assert.ok(mockupText.includes('付费生图 API'), mockupText.slice(0, 400));

  // 写入用户已确认偏好后，上下文要展示该偏好并要求不再重复询问。
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'image-generation-preference.json'), JSON.stringify({
    provider: 'GenerateImage',
    source: 'user-confirmed',
    updatedAt: new Date().toISOString(),
  }, null, 2));
  const preferredContext = runHook('UserPromptSubmit', { prompt: '再帮我生成一张活动海报看看样子' });
  const preferredText = JSON.stringify(preferredContext);
  assert.ok(preferredText.includes('当前已保存的用户生图偏好'), preferredText.slice(0, 400));
  assert.ok(preferredText.includes('不要再重复询问'), preferredText.slice(0, 400));
});

test('Codex hook injects canvas collaboration guidance for annotation-driven requests', async () => {
  const project = await makeTempProject();
  const codexHome = path.join(project, 'codex-home');
  await setupAgentIntegrationWorkspace(project, {
    tools: 'codex',
    templatePack: 'agent',
    enableUserCodexConfig: true,
    codexHome,
  });

  const hookPath = path.join(project, '.codex', 'hooks', 'openprd-hook.mjs');
  const runHook = makeHookRunner(project, hookPath);

  // 画布协同请求要注入结构化读写接口、标注改图闭环和尺寸契约指引。
  const canvasContext = runHook('UserPromptSubmit', { prompt: '我在画布上给这张图画了标注，请按标注改图后放回画布' });
  const canvasText = JSON.stringify(canvasContext);
  assert.ok(canvasText.includes('画布协同'), canvasText.slice(0, 400));
  assert.ok(canvasText.includes('/api/selection'), canvasText.slice(0, 400));
  assert.ok(canvasText.includes('/api/insert-image'), canvasText.slice(0, 400));
  assert.ok(canvasText.includes('annotation-edit'), canvasText.slice(0, 400));
  assert.ok(canvasText.includes('sizeContract'), canvasText.slice(0, 400));

  // 普通实现请求不应注入画布协同指引。
  const plainContext = runHook('UserPromptSubmit', { prompt: '帮我修复登录页的按钮样式问题' });
  const plainText = JSON.stringify(plainContext);
  assert.ok(!plainText.includes('/api/insert-image'), plainText.slice(0, 400));
});
