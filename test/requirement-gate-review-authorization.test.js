import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { buildReviewExportPayload } from '../src/html-artifacts.js';
import {
  clarifyWorkspace,
  diagramWorkspace,
  freezeWorkspace,
  generateOpenSpecChangeWorkspace,
  initWorkspace,
  nextWorkspace,
  reviewWorkspace,
  runWorkspace,
} from '../src/openprd.js';
import { readSessionRegistry } from '../src/session-registry.js';

import {
  captureFreshRequirementState,
  makeCodexHookProject,
  makeTempProject,
  pathExists,
  runCodexHook,
  synthesizeWorkspace,
} from './helpers/requirement-gate-helpers.js';

process.env.OPENPRD_HOME = path.join(os.tmpdir(), 'openprd-test-home-requirement-gate-review');

describe.skip('legacy Codex requirement gate review authorization', () => {
test('Codex hook accepts a later same-session execution instruction once review and tasks are ready', async () => {
  const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
    const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
      title: 'Team Builder',
      owner: 'PM',
      problemStatement: 'Agents need a guided team setup flow',
      whyNow: 'Configuration spans several libraries',
      primaryUsers: ['Agent operators'],
      goals: ['Guide team setup'],
      successMetrics: ['Setup succeeds'],
      acceptanceGoals: ['Operators can complete team setup'],
      inScope: ['Agent workspace team setup'],
      outOfScope: ['Billing'],
      primaryFlows: ['Operator configures a team'],
      functional: ['Create the team setup flow'],
      productType: 'agent',
    });

    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'team-builder-late-execution' });

    const blockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// still waiting for execution instruction\n*** End Patch',
    });
    assert.equal(blockedPatchPayload.decision, 'block');

    const lateExecutionPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '那你去修复吧，不需要再跟我确认。',
    });
    assert.equal(lateExecutionPromptPayload.continue, true);
    const executionGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(executionGate.active, false);
    assert.equal(executionGate.status, 'user-confirmed-for-execution');

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// execution confirmed later in the same session\n*** End Patch',
    });
  assert.equal(allowedPatchPayload.decision, undefined);
  assert.equal(allowedPatchPayload.continue, true);
  assert.equal(synthesizedTeamBuilder.snapshot.versionId, 'v0001');
});

test('Codex hook treats review-page continue copy as review authorization plus same-lane continuation intent', async () => {
  const { project } = await makeCodexHookProject();

  const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: '在【Agent管理】模块下新增一个【团队搭建】流程，放到【Agent 工区】菜单下面，让操作员可以一站式完成配置。',
  });
  assert.equal(requirementPromptPayload.continue, true);

  await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
  const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
    title: 'Team Builder',
    owner: 'PM',
    problemStatement: 'Agents need a guided team setup flow',
    whyNow: 'Configuration spans several libraries',
    primaryUsers: ['Agent operators'],
    goals: ['Guide team setup'],
    successMetrics: ['Setup succeeds'],
    acceptanceGoals: ['Operators can complete team setup'],
    inScope: ['Agent workspace team setup'],
    outOfScope: ['Billing'],
    primaryFlows: ['Operator configures a team'],
    functional: ['Create the team setup flow'],
    productType: 'agent',
  });

  const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedTeamBuilder.snapshot.versionId} --digest ${synthesizedTeamBuilder.snapshot.digest} --work-unit ${synthesizedTeamBuilder.workUnitId}`;
  const reviewCopyPrompt = [
    'OpenPrD Review: 认可并继续下一步',
    '这版需求确认稿已经通过。请先记录这次确认结果，并继续推进后续落地内容。只有后面确实需要额外授权时，再用人话说明影响和下一步。',
    '命令:',
    reviewCommand,
    '上下文:',
    JSON.stringify(buildReviewExportPayload(synthesizedTeamBuilder.snapshot), null, 2),
  ].join('\n\n');

  const reviewContinuePayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: reviewCopyPrompt,
  });
  assert.equal(reviewContinuePayload.continue, true);
  assert.ok(reviewContinuePayload.hookSpecificOutput.additionalContext.includes('用户刚刚已经确认这版需求，并且明确表示继续'));
  assert.ok(reviewContinuePayload.hookSpecificOutput.additionalContext.includes('先记录这次确认结果'));
  assert.ok(reviewContinuePayload.hookSpecificOutput.additionalContext.includes('不要再写“如果你认可”'));

  const requirementGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
  assert.equal(requirementGate.status, 'review-confirmation-authorized');
  assert.equal(requirementGate.reviewActionAuthorization.continueAfterReview, true);

  const authorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
    tool_name: 'Bash',
    tool_input: { cmd: reviewCommand },
  });
  assert.equal(authorizedReviewConfirmPayload.decision, undefined);
  assert.equal(authorizedReviewConfirmPayload.continue, true);

  await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesizedTeamBuilder.snapshot.versionId,
    digest: synthesizedTeamBuilder.snapshot.digest,
    workUnit: synthesizedTeamBuilder.workUnitId,
  });
  const runContext = await runWorkspace(project, { context: true });
  assert.equal(runContext.recommendation.type, 'requirement-intake');
  assert.ok(runContext.recommendation.reason.includes('本次调整'));
});

test('Codex hook auto-authorizes execution after review-continue copy once change and tasks are ready', async () => {
  const { project } = await makeCodexHookProject();

  const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: '在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
  });
  assert.equal(requirementPromptPayload.continue, true);

  await captureFreshRequirementState(project, '用户已经确认 Team Builder 的需求范围。');
  const synthesizedTeamBuilder = await synthesizeWorkspace(project, {
    title: 'Team Builder',
    owner: 'PM',
    problemStatement: 'Agents need a guided team setup flow',
    whyNow: 'Configuration spans several libraries',
    primaryUsers: ['Agent operators'],
    goals: ['Guide team setup'],
    successMetrics: ['Setup succeeds'],
    acceptanceGoals: ['Operators can complete team setup'],
    inScope: ['Agent workspace team setup'],
    outOfScope: ['Billing'],
    primaryFlows: ['Operator configures a team'],
    functional: ['Create the team setup flow'],
    productType: 'agent',
  });

  const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedTeamBuilder.snapshot.versionId} --digest ${synthesizedTeamBuilder.snapshot.digest} --work-unit ${synthesizedTeamBuilder.workUnitId}`;
  const reviewCopyPrompt = [
    'OpenPrD Review: 认可并继续下一步',
    '这版需求确认稿已经通过。请先记录这次确认结果，并继续推进后续落地内容。只有后面确实需要额外授权时，再用人话说明影响和下一步。',
    '命令:',
    reviewCommand,
    '上下文:',
    JSON.stringify(buildReviewExportPayload(synthesizedTeamBuilder.snapshot), null, 2),
  ].join('\n\n');

  const reviewContinuePayload = runCodexHook(project, 'UserPromptSubmit', {
    prompt: reviewCopyPrompt,
  });
  assert.equal(reviewContinuePayload.continue, true);

  const authorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
    tool_name: 'Bash',
    tool_input: { cmd: reviewCommand },
  });
  assert.equal(authorizedReviewConfirmPayload.decision, undefined);
  assert.equal(authorizedReviewConfirmPayload.continue, true);

  await reviewWorkspace(project, {
    mark: 'confirmed',
    version: synthesizedTeamBuilder.snapshot.versionId,
    digest: synthesizedTeamBuilder.snapshot.digest,
    workUnit: synthesizedTeamBuilder.workUnitId,
  });
  await generateOpenSpecChangeWorkspace(project, { change: 'team-builder-review-continue' });
  const requirementGateBeforePatch = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'session-bindings'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'session-bindings', `${requirementGateBeforePatch.sessionId}.json`), JSON.stringify({
    version: 1,
    sessionId: requirementGateBeforePatch.sessionId,
    promptPreview: requirementGateBeforePatch.promptPreview,
    gateStatus: requirementGateBeforePatch.status,
    gateActive: requirementGateBeforePatch.active,
    title: synthesizedTeamBuilder.snapshot.title,
    versionId: synthesizedTeamBuilder.snapshot.versionId,
    digest: synthesizedTeamBuilder.snapshot.digest,
    workUnitId: synthesizedTeamBuilder.workUnitId,
    reviewStatus: 'confirmed',
    changeId: 'team-builder-review-continue',
  }, null, 2));
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), JSON.stringify({
    version: 1,
    active: false,
    status: 'resolved-for-test',
  }, null, 2));

  const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
    tool_name: 'apply_patch',
    tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// review continue copy auto-authorized execution\n*** End Patch',
  });
  assert.equal(allowedPatchPayload.decision, undefined);
  assert.equal(allowedPatchPayload.continue, true);

  const requirementGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
  assert.equal(requirementGate.active, false);
  assert.equal(requirementGate.status, 'execution-authorized');
});

test('Codex hook supports silent-record review lanes when the user opts out of extra review confirmation', async () => {
  const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：新增 Agent 团队模板导入流，不需要评审，不需要确认，你直接做。',
    });
    assert.equal(requirementPromptPayload.continue, true);
    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    const requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'silent-record');
    assert.equal(requirementGate.approvalPolicy.maxClarificationQuestions, 1);

    const clarify = await clarifyWorkspace(project, {});
    assert.equal(clarify.clarification.requirementIntake.questionLimit, 1);
    assert.ok(clarify.clarification.mustAskUser.length <= 1);

    await captureFreshRequirementState(project, '用户已经确认 Agent 团队模板导入流的目标、范围与验收方式。');
    const synthesized = await synthesizeWorkspace(project, {
      title: 'Agent 团队模板导入流',
      owner: 'PM',
      problemStatement: '团队管理员需要直接导入团队模板，而不是手工逐项配置。',
      whyNow: '当前模板配置链路过长，用户已经明确要求直接落地。',
      primaryUsers: ['团队管理员'],
      goals: ['缩短团队模板导入配置时间'],
      successMetrics: ['管理员可一次性导入模板并开始使用'],
      acceptanceGoals: ['导入后生成团队模板配置', '失败时给出可恢复提示'],
      inScope: ['团队模板导入入口', '模板校验与导入结果提示'],
      outOfScope: ['模板市场排序'],
      primaryFlows: ['管理员选择模板并完成导入'],
      functional: ['提供模板导入入口', '导入后写入团队模板配置'],
      productType: 'agent',
    });

    const reviewCommand = `openprd review . --mark confirmed --version ${synthesized.snapshot.versionId} --digest ${synthesized.snapshot.digest} --work-unit ${synthesized.workUnitId}`;
    const silentRecordReviewPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: reviewCommand },
    });
    assert.equal(silentRecordReviewPayload.decision, undefined);
    assert.equal(silentRecordReviewPayload.continue, true);

    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'agent-team-template-import' });

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// silent-record implementation\n*** End Patch',
    });
    assert.equal(allowedPatchPayload.decision, undefined);
    assert.equal(allowedPatchPayload.continue, true);

    const executionAuthorizedGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(executionAuthorizedGate.active, false);
    assert.equal(executionAuthorizedGate.status, 'execution-authorized');
  });

  test('Codex hook does not open a silent-record lane when the user only waives review wording', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：新增 Agent 团队模板导入流，不需要评审，但后面该确认的你还是照常确认。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    const requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'required');
  });

  test('Codex requirement gates are scoped to the current session id', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });
    const sessionA = '019e4e72-74e5-7150-90d5-36284bf8bff3';
    const sessionB = '019e4e8f-7741-77f3-8ddb-3836de92f4f2';

    const openClawPrompt = '请直接实现：在 OpenClaw 检查和重启链路里增加配置自动修复层，避免用户关心 JSON 语法细节。';
    const feishuPrompt = '请直接实现：新增飞书渠道登录检测流程，保持固定进度条体验，不要在检测通过或失败后反复跳动。';
    const openClawGatePayload = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: openClawPrompt,
    });
    assert.equal(openClawGatePayload.continue, true);

    const scopedGatePath = path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionA}.json`);
    const scopedGate = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    assert.equal(scopedGate.active, true);
    assert.equal(scopedGate.sessionId, sessionA);
    assert.ok(scopedGate.promptPreview.includes('OpenClaw'));

    const unrelatedPatchPayload = runCodexHook(project, 'PreToolUse', {
      session_id: sessionB,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// unrelated session edit\n*** End Patch',
    });
    assert.equal(unrelatedPatchPayload.decision, undefined);
    assert.equal(unrelatedPatchPayload.continue, true);

    const sameSessionPatchPayload = runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// premature implementation\n*** End Patch',
    });
    assert.equal(sameSessionPatchPayload.decision, 'block');
    assert.ok(
      sameSessionPatchPayload.reason.includes('requirement gate is still active')
        || sameSessionPatchPayload.reason.includes('OpenPrd blocked a mutating action')
    );

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionB,
      prompt: feishuPrompt,
    });
    const feishuGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionB}.json`), 'utf8'));
    assert.equal(feishuGate.active, true);
    assert.ok(feishuGate.promptPreview.includes('飞书'));

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: {
        cmd: 'openprd clarify .',
      },
    });
    const mirroredGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(mirroredGate.sessionId, sessionA);
    assert.ok(mirroredGate.promptPreview.includes('OpenClaw'));

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionB,
      prompt: '确认',
    });
    const afterBConfirmA = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    const afterBConfirmB = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionB}.json`), 'utf8'));
    assert.equal(afterBConfirmA.active, true);
    assert.equal(afterBConfirmB.active, true);
    assert.equal(afterBConfirmB.status, 'clarification-confirmed');

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: {
        cmd: 'openprd clarify .',
      },
    });
    await captureFreshRequirementState(project, '用户已经确认 OpenClaw 自动修复配置的需求范围。');
    const synthesizedOpenClaw = await synthesizeWorkspace(project, {
      title: 'OpenClaw Auto Repair',
      owner: 'PM',
      problemStatement: 'Operators need OpenClaw checks to repair malformed config automatically.',
      whyNow: 'Manual JSON recovery interrupts the restart flow.',
      primaryUsers: ['OpenClaw operators'],
      goals: ['Repair common config issues before restart'],
      successMetrics: ['Restarts complete without manual JSON edits'],
      acceptanceGoals: ['Operators can run checks and restart without editing JSON'],
      inScope: ['OpenClaw check and restart recovery flow'],
      outOfScope: ['Account management'],
      primaryFlows: ['Operator runs checks and the system repairs safe config issues'],
      functional: ['Add safe config repair to the OpenClaw check flow'],
      productType: 'developer-tool',
    });
    const reviewCommand = `openprd review . --mark confirmed --version ${synthesizedOpenClaw.snapshot.versionId} --digest ${synthesizedOpenClaw.snapshot.digest} --work-unit ${synthesizedOpenClaw.workUnitId}`;
    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: reviewCommand,
    });
    runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: {
        cmd: reviewCommand,
      },
    });
    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'openclaw-auto-repair' });

    const afterBReadyPatch = runCodexHook(project, 'PreToolUse', {
      session_id: sessionB,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// still blocked in another session\n*** End Patch',
    });
    assert.equal(afterBReadyPatch.decision, 'block');
    const afterBFinalConfirmA = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    const afterBFinalConfirmB = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionB}.json`), 'utf8'));
    assert.equal(afterBFinalConfirmA.active, true);
    assert.equal(afterBFinalConfirmB.active, true);

    const afterAReadyPatch = runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// allowed in matching session\n*** End Patch',
    });
    assert.equal(afterAReadyPatch.decision, undefined);
    assert.equal(afterAReadyPatch.continue, true);
    const afterAConfirm = JSON.parse(await fs.readFile(scopedGatePath, 'utf8'));
    assert.equal(afterAConfirm.active, false);
    assert.equal(afterAConfirm.status, 'execution-authorized');
  });

  test('Codex requirement gate opening also registers the session globally', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019e8788-0f90-72f0-bf42-1667e3264af8';
    const prompt = '请直接实现：新增飞书渠道登录检测流程，保持固定进度条体验，不要在检测通过或失败后反复跳动。';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt,
    });
    assert.equal(
      await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionId}.json`)),
      true,
    );

    const registry = await readSessionRegistry({ openprdHome: process.env.OPENPRD_HOME });
    const entry = registry.entries.find((item) => item.sessionId === sessionId);
    assert.ok(entry);
    assert.equal(entry.workspaceRoot, project);
    assert.equal(entry.gateActive, true);
    assert.equal(entry.gateStatus, 'requires-clarification');
    assert.ok(entry.promptPreview.includes('飞书渠道登录检测流程'));
    assert.ok(entry.bindingPath.endsWith(`${sessionId}.json`));
  });

  test('session-scoped review authorization stays pinned after another session synthesizes a newer PRD', async () => {
    const { project } = await makeCodexHookProject();
    const sessionA = '019e5f21-54be-7042-bb92-9ba6b2c24757';
    const sessionB = '019e5f64-2ee1-70a3-9b26-3905dfac0d4b';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: '请直接实现：在模型入口里增加更清晰的会员权益说明。',
    });
    await captureFreshRequirementState(project, '用户已经确认模型入口会员权益说明的需求范围。');
    const synthesizedA = await synthesizeWorkspace(project, {
      title: '模型入口会员权益说明',
      owner: 'PM',
      problemStatement: '用户看不懂当前模型入口和会员权益的关系。',
      whyNow: '入口文案已经触发用户反馈。',
      primaryUsers: ['模型入口访问用户'],
      goals: ['让会员权益说明更清晰'],
      successMetrics: ['用户能理解权益差异'],
      acceptanceGoals: ['会员权益文案清晰可见'],
      inScope: ['模型入口权益说明'],
      outOfScope: ['套餐定价'],
      primaryFlows: ['用户打开模型入口并理解权益说明'],
      functional: ['在模型入口展示清晰的会员权益说明'],
      productType: 'agent',
    });

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionB,
      prompt: '请直接实现：导入的 agent 默认要给一个空模型配置，并在认领时增加模型选择。',
    });
    await captureFreshRequirementState(project, '用户已经确认导入空模型与认领模型选择的需求范围。');
    const synthesizedB = await synthesizeWorkspace(project, {
      title: '导入空模型与认领模型选择',
      owner: 'PM',
      problemStatement: '导入的 agent 没有默认模型配置，认领时也无法明确选择模型。',
      whyNow: '导入和认领链路都在产生错误预期。',
      primaryUsers: ['Agent 导入操作者'],
      goals: ['让导入与认领链路都带上模型信息'],
      successMetrics: ['导入与认领不再出现空模型状态'],
      acceptanceGoals: ['导入后存在默认模型配置', '认领时可选择模型'],
      inScope: ['导入默认模型配置', '认领模型选择'],
      outOfScope: ['模型市场排序'],
      primaryFlows: ['用户导入 agent 后直接认领并选择模型'],
      functional: ['导入后写入默认模型配置', '认领时提供模型选择'],
      productType: 'agent',
    });

    const quotedReviewCommandA = `openprd review . --mark confirmed --version '${synthesizedA.snapshot.versionId}' --digest '${synthesizedA.snapshot.digest}' --work-unit '${synthesizedA.workUnitId}'`;
    const authorizationPayload = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionA,
      prompt: quotedReviewCommandA,
    });
    assert.equal(authorizationPayload.continue, true);
    assert.ok(authorizationPayload.hookSpecificOutput.additionalContext.includes('只允许记录这次确认结果'));

    const authorizedGateA = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionA}.json`), 'utf8'));
    assert.equal(authorizedGateA.reviewActionAuthorization.versionId, synthesizedA.snapshot.versionId);
    assert.equal(authorizedGateA.reviewActionAuthorization.digest, synthesizedA.snapshot.digest);
    assert.equal(authorizedGateA.reviewActionAuthorization.workUnitId, synthesizedA.workUnitId);
    assert.notEqual(authorizedGateA.reviewActionAuthorization.versionId, synthesizedB.snapshot.versionId);

    const authorizedReviewPayload = runCodexHook(project, 'PreToolUse', {
      session_id: sessionA,
      tool_name: 'Bash',
      tool_input: { cmd: quotedReviewCommandA },
    });
    assert.equal(authorizedReviewPayload.decision, undefined);
    assert.equal(authorizedReviewPayload.continue, true);
  });

  test('Codex hook separates new requirement intake from historical active change reminders', async () => {
    const { project } = await makeCodexHookProject();

    const changeId = 'account-achievements-user-type-v1';
    const changeDir = path.join(project, '.openprd', 'changes', changeId);
    await fs.mkdir(path.join(changeDir, 'specs', 'agent-requirements'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'proposal.md'), [
      '# 我的成就与 AI探索者用户类型',
      '',
      '## 背景与原因',
      '',
      '当前账户弹窗和侧边栏只把非 Pro 用户显示为普通用户，无法体现已参与内测的用户身份；也缺少可扩展的我的成就模块。',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(changeDir, 'tasks.md'), [
      '# 任务',
      '',
      '- [ ] T001.01 评审生成的 spec 覆盖',
      '  - type: governance',
      '  - done: agent-requirements spec 已覆盖当前变更目标',
      '  - verify: openprd change . --validate --change account-achievements-user-type-v1',
      '',
      '- [ ] T001.02 补齐邀请码识别与用户类型接线',
      '  - type: implementation',
      '  - done: 邀请码识别、用户类型判断和进入应用路径已经接通',
      '  - verify: openprd run . --verify',
      '',
      '- [ ] T001.03 接通账户弹窗与我的成就入口',
      '  - type: implementation',
      '  - done: 账户弹窗菜单与我的成就入口已经可见且可进入',
      '  - verify: openprd run . --verify',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(changeDir, 'specs', 'agent-requirements', 'spec.md'), [
      '## 新增需求',
      '',
      '### 需求：我的成就与 AI探索者用户类型',
      '当前账户弹窗和侧边栏只把非 Pro 用户显示为普通用户。',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
      version: 1,
      activeChange: changeId,
      changes: {
        [changeId]: {
          id: changeId,
          status: 'active',
        },
      },
    }, null, 2)}\n`);

    const payload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '新增 iOS 自动任务强提醒播报：定时任务到点后在 iOS 端展示动画并播报内容。',
    });
    assert.equal(payload.continue, true);
    const context = payload.hookSpecificOutput.additionalContext;
    assert.ok(context.includes('OpenPrd 当前需求入口'));
    assert.ok(context.includes('本轮需求: 新增 iOS 自动任务强提醒播报'));
    assert.ok(context.includes('OpenPrd 历史需求提醒'));
    assert.ok(context.includes('历史需求: 我的成就与 AI探索者用户类型'));
    assert.ok(context.includes('需求说明: 当前账户弹窗和侧边栏只把非 Pro 用户显示为普通用户'));
    assert.ok(context.includes('待判断的需求点: 补齐邀请码识别与用户类型接线'));
    assert.ok(context.includes('本轮不会自动继续它'));
    assert.equal(context.includes(`openprd tasks . --change '${changeId}'`), false);
    assert.equal(context.includes('用 Loop 执行'), false);

    const gate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(gate.intakeMode, 'deep-reflection');

    const clarify = await clarifyWorkspace(project, {});
    assert.equal(clarify.intakeReflection.mode, 'deep');
    assert.equal(clarify.intakeReflection.rounds.length, 3);
    assert.ok(clarify.clarification.requirementIntake.reflection.rounds.some((round) => round.title.includes('第 2 轮')));
    assert.ok(clarify.clarification.mustAskUser.some((item) => item.id === 'requirement-intake.intent'));
    assert.ok(clarify.clarification.mustAskUser.length <= clarify.clarification.requirementIntake.questionLimit);
    const reflectionMarkdown = await fs.readFile(path.join(project, '.openprd', 'engagements', 'active', 'intake-reflection.md'), 'utf8');
    assert.ok(reflectionMarkdown.includes('第 1 轮：意图归一化'));
    assert.ok(reflectionMarkdown.includes('第 2 轮：项目上下文映射'));
    assert.ok(reflectionMarkdown.includes('首轮项目画像'));
    assert.equal(clarify.clarifyPresentation.mode, 'inline-with-checklist');
    assert.equal(clarify.clarifyArtifact, null);
    assert.equal(clarify.clarifyArtifactBundle, null);
    assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('需求判断：')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('第一批最容易触达')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('什么承诺才算真需求')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('主要服务对象')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 功能模块 |')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 技术部分 |')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('这轮我会重点看哪些步骤让 Agent 自主完成')));
  });

  test('clarify keeps focused active requirement intake in the conversation', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '把图标资源站参考加入 shadcn Skill。',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    const clarify = await clarifyWorkspace(project, {});
    assert.ok(clarify.clarifyPresentation.mode.startsWith('inline'));
    assert.equal(clarify.clarifyArtifact, null);
    assert.equal(clarify.clarifyArtifactBundle, null);
    assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我建议这轮先确认这一点')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('第一版先让用户做到')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 功能模块 |')));
  });

  test('clarify keeps local visual cleanup requests inline even with inferred fields', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '去掉红圈的地方，包括不限于卡片的描边布局，直接变成平铺的就行。',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    const clarify = await clarifyWorkspace(project, {});
    assert.ok(clarify.clarifyPresentation.mode.startsWith('inline'));
    assert.equal(clarify.clarifyArtifact, null);
    assert.equal(clarify.clarifyArtifactBundle, null);
    assert.equal(await pathExists(path.join(project, '.openprd', 'engagements', 'active', 'clarify.html')), false);
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('我先用产品和业务语言复述一下')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('必须守住')));
    assert.ok(clarify.inlineClarification.lines.some((line) => line.includes('| 技术部分 |')));
  });

  test('active requirement gate does not block freeze after reviewed PRD artifacts are confirmed', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '请实现一个本地习惯检查 CLI。',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await captureFreshRequirementState(project, '用户已经确认本地习惯检查 CLI 的需求范围。');
    await synthesizeWorkspace(project, {
      title: 'habit-check CLI',
      owner: 'OpenPRD 验证',
      problemStatement: '个人效率工具用户每天容易忘记查看今天还有哪些习惯没有完成。',
      whyNow: '需要用一个小型交付物验证需求澄清、评审和质量门禁是否执行到位。',
      evidence: ['用户已确认目标用户、问题、范围、主流程和异常流程。'],
      primaryUsers: ['个人效率工具用户'],
      stakeholders: ['OpenPRD 验证负责人'],
      goals: ['清楚显示今天未完成的习惯'],
      successMetrics: ['运行 CLI 后能列出所有未完成习惯'],
      acceptanceGoals: ['提供 Node.js CLI', '提供 smoke 测试'],
      inScope: ['本地 habits.json 输入', '未完成习惯列表输出'],
      outOfScope: ['联网', '账号', '数据库'],
      primaryFlows: ['读取本地 habits.json', '过滤未完成习惯', '输出名称列表'],
      edgeCases: ['所有习惯已完成'],
      failureModes: ['文件不存在', 'JSON 无效'],
      functional: ['默认从当前目录读取 habits.json', '只把 doneToday 为 false 的习惯视为未完成'],
      nonFunctional: ['只访问本地文件', '输出简短易读'],
      businessRules: ['输入无效时输出普通用户可理解的错误'],
      costDrivers: ['没有外部使用成本'],
      usageLimits: ['每次运行只读取一个本地文件'],
      abusePrevention: ['不进行网络调用'],
      monitoringSignals: ['smoke 测试结果'],
      alertThresholds: ['任何 smoke 失败都阻断就绪声明'],
      stopLossActions: ['修复失败路径并重跑测试'],
      technical: ['使用 Node.js 实现'],
      compliance: ['习惯数据只留在用户本机'],
      dependencies: ['Node.js 运行时'],
      assumptions: ['habits.json 是 JSON 数组'],
      risks: ['格式错误的习惯条目可能让用户困惑'],
      openQuestions: ['本次验证范围内没有开放问题'],
      handoffOwner: 'OpenPRD 验证',
      nextStep: '生成 change 和 tasks',
      targetSystem: 'OpenPRD',
      productType: 'consumer',
      persona: '维护轻量习惯清单的个人用户',
      segment: '个人效率用户',
      journey: '每日运行 CLI 查看剩余习惯',
      activationMetric: '第一次成功看到未完成清单',
      retentionMetric: '每天可重复运行查看状态',
    });
    await diagramWorkspace(project, { type: 'product-flow', mark: 'confirmed' });
    await reviewWorkspace(project, { mark: 'confirmed', notes: '需求事实和评审产物已确认。' });

    const next = await nextWorkspace(project);
    assert.equal(next.recommendation.nextAction, 'freeze');
    assert.equal(next.recommendation.currentGate, 'freeze review');
    assert.equal(next.clarification.requirementIntake.satisfied, true);

    const frozen = await freezeWorkspace(project);
    assert.equal(frozen.ok, true);
    assert.equal(frozen.snapshot.status, 'frozen');
  });

});
