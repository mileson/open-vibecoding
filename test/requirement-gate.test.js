import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import {
  captureWorkspace,
  generateOpenSpecChangeWorkspace,
  initWorkspace,
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
  seedProjectKnowledgeSkill,
  synthesizeWorkspace,
} from './helpers/requirement-gate-helpers.js';

process.env.OPENPRD_HOME = path.join(os.tmpdir(), 'openprd-test-home-requirement-gate');

describe('Codex requirement gate', () => {
  test('synthesize blocks active requirement gate when no fresh capture or explicit PRD fields exist', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'agent' });

    await synthesizeWorkspace(project, {
      title: '历史飞书需求',
      owner: 'OpenPrd',
      problemStatement: '用户需要看到飞书安装进度。',
      whyNow: '安装等待过程容易误判为卡死。',
      productType: 'agent',
    });
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'prd-review-required',
      openedAt: '9999-01-01 00:00:00',
      updatedAt: '9999-01-01 00:00:00',
      promptPreview: 'AI跟生产线之间增加个空格',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await assert.rejects(
      () => synthesizeWorkspace(project, {}),
      /current\.json 还没有记录本轮确认答案/
    );

    await captureFreshRequirementState(project, '用户已经确认 AI 生产线命名需要保留空格。');
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'prd-review-required',
      openedAt: '2026-05-25 10:00:00',
      updatedAt: '2026-05-25 10:00:00',
      promptPreview: 'AI跟生产线之间增加个空格',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    const explicit = await synthesizeWorkspace(project, {
      title: 'AI 生产线命名空格调整',
      owner: 'OpenPrd',
      problemStatement: 'AI 生产线入口命名需要保留空格。',
      whyNow: '用户已经确认要调整中文入口命名。',
      productType: 'agent',
    });
    assert.equal(explicit.snapshot.title, 'AI 生产线命名空格调整');
    assert.equal(explicit.snapshot.versionId, 'v0002');
  });

  test('Codex hook keeps non-requirement prompts outside the requirement gate', async () => {
    const { project } = await makeCodexHookProject();

    const plainPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把这个按钮文案改短一点',
    });
    assert.equal(plainPromptPayload.continue, true);
    assert.ok(plainPromptPayload.hookSpecificOutput.additionalContext.includes('产品内文案提醒'));
    assert.ok(plainPromptPayload.hookSpecificOutput.additionalContext.includes('Localizable'));

    const simpleUiPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把设置页面的保存按钮从圆角改成方角，并从右上角移动到右下角。',
    });
    assert.deepEqual(simpleUiPromptPayload, { continue: true });
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const tinySpacingPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '到最后我只让它加一个空格，把 AI跟生产线 改成 AI 跟生产线。',
    });
    assert.deepEqual(tinySpacingPromptPayload, { continue: true });
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const learningMaterialPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请生成一份仙侠风格的学习材料',
    });
    assert.equal(learningMaterialPayload.continue, true);
    assert.ok(learningMaterialPayload.hookSpecificOutput.additionalContext.includes('学习型交付物'));
    assert.ok(learningMaterialPayload.hookSpecificOutput.additionalContext.includes('不是固定关键词表'));
    assert.ok(learningMaterialPayload.hookSpecificOutput.additionalContext.includes('openprd learn . --topic "<学习主题>" --genre xianxia --open'));
    assert.ok(learningMaterialPayload.hookSpecificOutput.additionalContext.includes('普通 Markdown 只能作为辅助讲义'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);
    const learningStopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(learningStopReminder.continue, true);
    assert.ok(learningStopReminder.hookSpecificOutput.additionalContext.includes('学习型交付物'));
    assert.ok(learningStopReminder.hookSpecificOutput.additionalContext.includes('学习包阅读器'));
    assert.ok(learningStopReminder.hookSpecificOutput.additionalContext.includes('openprd learn . --topic "<学习主题>" --genre xianxia --open'));
    assert.ok(learningStopReminder.hookSpecificOutput.additionalContext.includes('普通 Markdown'));

    const imageGenerationPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '帮我生成一张活动封面图，先给我看图片效果。',
    });
    assert.equal(imageGenerationPayload.continue, true);
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('当前用户要的是图片内容生成'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('生图路由'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('imagegen'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('GenerateImage'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('付费生图 API'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('独立素材输出（standalone asset）'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('候选效果图'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('是否符合预期'));
    assert.ok(imageGenerationPayload.hookSpecificOutput.additionalContext.includes('后续效果图/实现截图对比'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);
    const imageStopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(imageStopReminder.continue, true);
    assert.ok(imageStopReminder.hookSpecificOutput.additionalContext.includes('候选效果图'));
    assert.ok(imageStopReminder.hookSpecificOutput.additionalContext.includes('是否按此继续后续实现'));

    const largeUiDirectionPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个设置页面界面改动比较大，先用 Computer Use 截产品内页面，再给我三种设计方向效果图确认。',
    });
    assert.equal(largeUiDirectionPayload.continue, true);
    const largeUiContext = largeUiDirectionPayload.hookSpecificOutput.additionalContext;
    assert.ok(largeUiContext.includes('大界面改动视觉方案评审'));
    assert.equal(largeUiContext.split('OpenPrd 大界面改动视觉方案评审:').length - 1, 1);
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('Codex 原生 App 用 Computer Use'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('按生图路由调用内置生图工具'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('1/2/3'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('.openprd/harness/visual-reviews/'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('候选效果图'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('多对象参考处理'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('用户不需要额外提出'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('Chrome 插件的任务专用窗口'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('同一张截图作为 image-to-image 参考'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('除非用户明确要求换风格'));
    assert.ok(largeUiDirectionPayload.hookSpecificOutput.additionalContext.includes('只换颜色的伪方向'));

    const visualMismatchPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个实现跟效果图不一致，看着有点好丑，你按效果图继续复刻一下。',
    });
    assert.equal(visualMismatchPayload.continue, true);
    assert.ok(visualMismatchPayload.hookSpecificOutput.additionalContext.includes('至少先产出一份'));
    assert.ok(visualMismatchPayload.hookSpecificOutput.additionalContext.includes('focus-board'));

    const readOnlyProductPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '帮我看看这个 Agent 编排实现逻辑是不是漏了 Windows 用户场景，先分析一下。',
    });
    assert.equal(readOnlyProductPromptPayload.continue, true);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const consultativeFeedbackPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '用户反馈 OpenPrd 这个 hook 在现有功能优化上有点过度，你看什么原因，先分析一下。',
    });
    assert.equal(consultativeFeedbackPromptPayload.continue, true);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const directBugfixPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: 'Windows用户反馈，他在更新新版本的时候，出现如图的一个报错，请你排查一下什么原因，并如果能定位到原因，直接帮我修复',
    });
    assert.equal(directBugfixPromptPayload.continue, true);
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('直接处理 (L0)'));
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('需求类型 / 理由 / 推荐下一步'));
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('需求类型：直接处理（L0）'));
    assert.ok(directBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('不打开正式 PRD/review/change/tasks'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const l1PromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把设置页的信息架构和默认筛选顺序优化一下，保持现有功能边界，直接改。',
    });
    assert.equal(l1PromptPayload.continue, true);
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('现有功能优化 (L1)'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('需求类型 / 理由 / 推荐下一步'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('需求类型：现有功能优化（L1）'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('3-5 行 mini-plan'));
    assert.ok(l1PromptPayload.hookSpecificOutput.additionalContext.includes('默认不要打开正式 PRD/review/change/tasks'));
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);

    const riskyBugfixPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接修复支付回调和订单状态同步失败的问题，涉及登录态、订单回调和退款分支。',
    });
    assert.equal(riskyBugfixPromptPayload.continue, true);
    assert.ok(riskyBugfixPromptPayload.hookSpecificOutput.additionalContext.includes('runs in background'));
    const riskyBugfixGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(riskyBugfixGate.active, true);
    assert.equal(riskyBugfixGate.status, 'requires-clarification');

    await fs.rm(path.join(project, '.openprd', 'harness', 'requirement-gate.json'));

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'requires-clarification',
      promptPreview: '帮我看看这个 Agent 编排实现逻辑是不是漏了 Windows 用户场景，先分析一下。',
      intent: {
        requiresIntake: false,
        explicitExecution: false,
        confirmation: false,
        readOnly: true,
        simpleConcrete: false,
        shouldInject: true,
      },
    }, null, 2));
    const staleReadOnlyPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// small follow-up edit\n*** End Patch',
    });
    assert.equal(staleReadOnlyPatchPayload.decision, undefined);
    assert.equal(staleReadOnlyPatchPayload.continue, true);
  });

  test('Codex hook bypasses OpenPrd context and gates for unattended automation sessions', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019f01b1-64c4-78e1-93ea-automation01';
    const eventsPath = path.join(project, '.openprd', 'harness', 'events.jsonl');
    const eventsBefore = await fs.readFile(eventsPath, 'utf8');

    const automationPrompt = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: [
        'Automation: Nightly content maintenance',
        'Automation ID: nightly-content-maintenance',
        'Automation memory: /tmp/nightly-content-maintenance.md',
        '',
        '无人值守自动任务：请直接修复支付回调和订单状态同步失败的问题。',
      ].join('\n'),
    });
    assert.deepEqual(automationPrompt, { continue: true });
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionId}.json`)), false);

    const automationPatch = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// unattended automation write\n*** End Patch',
    });
    assert.deepEqual(automationPatch, { continue: true });

    const automationStop = runCodexHook(project, 'Stop', {
      session_id: sessionId,
    });
    assert.deepEqual(automationStop, { continue: true });
    assert.equal(await fs.readFile(eventsPath, 'utf8'), eventsBefore);

    const registry = await readSessionRegistry({ openprdHome: process.env.OPENPRD_HOME });
    const entry = registry.entries.find((item) => item.sessionId === sessionId);
    assert.ok(entry);
    assert.equal(entry.workspaceRoot, project);
    assert.equal(entry.laneKind, 'automation');
    assert.equal(entry.gateStatus, 'automation-safe-mode');
    assert.equal(entry.gateActive, false);

    const laterHumanPrompt = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接修复支付回调和订单状态同步失败的问题，涉及登录态、订单回调和退款分支。',
    });
    assert.equal(laterHumanPrompt.continue, true);
    assert.ok(laterHumanPrompt.hookSpecificOutput.additionalContext.includes('runs in background'));
  });

  test('Codex hook keeps OpenPrd gates enabled when automation explicitly opts in', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019f01b1-64c4-78e1-93ea-openprd01';

    const optInPrompt = runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: [
        'Automation: OpenPrd maintenance',
        'Automation ID: openprd-maintenance',
        'Automation memory: /tmp/openprd-maintenance.md',
        '',
        '这是 OpenPrd 维护任务，显式启用 OpenPrd。请直接修复支付回调和订单状态同步失败的问题，涉及登录态、订单回调和退款分支。',
      ].join('\n'),
    });
    assert.equal(optInPrompt.continue, true);
    assert.ok(optInPrompt.hookSpecificOutput.additionalContext.includes('runs in background'));

    const gate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gates', `${sessionId}.json`), 'utf8'));
    assert.equal(gate.active, true);
    assert.equal(gate.status, 'requires-clarification');
  });

  test('Codex hook keeps semantic requirement maintenance in the background', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：新增 Agent 团队模板导入流。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    let requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'required');

    const blockedCapturePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd capture . --field problem.problemStatement --value "默认假设" --source agent-inferred' },
    });
    assert.equal(blockedCapturePayload.decision, undefined);
    assert.equal(blockedCapturePayload.continue, true);
    assert.ok(JSON.stringify(blockedCapturePayload).includes('does not block'));

    const allowedNormalizedCapturePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd capture . --field reviewPresentation --value "{}" --source agent-normalized' },
    });
    assert.equal(allowedNormalizedCapturePayload.decision, undefined);
    assert.equal(allowedNormalizedCapturePayload.continue, true);

    const blockedSynthesizePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd synthesize .' },
    });
    assert.equal(blockedSynthesizePayload.decision, undefined);
    assert.equal(blockedSynthesizePayload.continue, true);
    assert.ok(JSON.stringify(blockedSynthesizePayload).includes('does not block'));

    const clarificationConfirmPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '确认',
    });
    assert.equal(clarificationConfirmPayload.continue, true);

    requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.status, 'clarification-confirmed');
    assert.ok(requirementGate.clarificationConfirmedAt);

    const allowedCapturePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd capture . --field problem.problemStatement --value "用户确认的目标" --source user-confirmed' },
    });
    assert.equal(allowedCapturePayload.decision, undefined);
    assert.equal(allowedCapturePayload.continue, true);
    await captureFreshRequirementState(project, '用户已经确认 Agent 团队模板导入流的核心范围。');

    const allowedSynthesizePayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'openprd synthesize .' },
    });
    assert.equal(allowedSynthesizePayload.decision, undefined);
    assert.equal(allowedSynthesizePayload.continue, true);
  });

  test('Codex hook treats short clarification follow-ups as confirmation', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
    });
    assert.equal(requirementPromptPayload.continue, true);

    const defaultChoicePayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '就按这个先走',
    });
    assert.equal(defaultChoicePayload.continue, true);

    const requirementGatePath = path.join(project, '.openprd', 'harness', 'requirement-gate.json');
    const requirementGate = JSON.parse(await fs.readFile(requirementGatePath, 'utf8'));
    assert.equal(requirementGate.status, 'clarification-confirmed');
  });

  test('synthesize blocks clarification-confirmed lanes until required facts are rewritten as user-confirmed', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'clarification-confirmed',
      openedAt: '2026-06-07 00:00:00',
      updatedAt: '2026-06-07 00:00:00',
      clarificationConfirmedAt: '2026-06-07 00:00:00',
      promptPreview: '请帮我实现一个个人博客网站',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await captureWorkspace(project, {
      field: 'problem.whyNow',
      value: '先用推断事实补一版。',
      source: 'agent-inferred',
    });

    await assert.rejects(
      () => synthesizeWorkspace(project, {
        title: '个人博客网站第一版',
        owner: 'OpenPrd',
        problemStatement: '从零实现一个个人博客网站。',
        whyNow: '用户已经确认先做第一版博客站。',
        primaryUsers: ['博客访问者'],
        goals: ['展示个人内容与文章'],
        successMetrics: ['访问者可打开首页并进入文章详情'],
        acceptanceGoals: ['首页和文章详情可访问'],
        inScope: ['首页与文章详情'],
        outOfScope: ['评论系统'],
        primaryFlows: ['访问首页并打开文章详情'],
        functional: ['展示个人介绍与文章内容'],
        productType: 'consumer',
      }),
      /当前需求摘要虽已确认|canonical|user-confirmed/
    );

    await captureWorkspace(project, {
      field: 'problem.problemStatement',
      value: '从零实现一个个人博客网站。',
      source: 'user-confirmed',
    });
    await captureWorkspace(project, {
      field: 'problem.whyNow',
      value: '用户已经确认先做第一版博客站。',
      source: 'user-confirmed',
    });
    await captureFreshRequirementState(project, '从零实现一个个人博客网站。', { productType: 'consumer' });

    const synthesized = await synthesizeWorkspace(project, {
      title: '个人博客网站第一版',
      owner: 'OpenPrd',
      problemStatement: '从零实现一个个人博客网站。',
      whyNow: '用户已经确认先做第一版博客站。',
      primaryUsers: ['博客访问者'],
      goals: ['展示个人内容与文章'],
      successMetrics: ['访问者可打开首页并进入文章详情'],
      acceptanceGoals: ['首页和文章详情可访问'],
      inScope: ['首页与文章详情'],
      outOfScope: ['评论系统'],
      primaryFlows: ['访问首页并打开文章详情'],
      functional: ['展示个人介绍与文章内容'],
      productType: 'consumer',
    });
    assert.equal(synthesized.snapshot.versionId, 'v0001');
  });

  test('synthesize blocks clarification-confirmed lanes when the requirement lane still recommends classify or interview', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: true,
      status: 'clarification-confirmed',
      openedAt: '2026-06-07 00:00:00',
      updatedAt: '2026-06-07 00:00:00',
      clarificationConfirmedAt: '2026-06-07 00:00:00',
      promptPreview: '请帮我实现一个个人博客网站',
      requiredFlow: ['clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks', 'implementation'],
    }, null, 2));

    await captureWorkspace(project, {
      field: 'problem.problemStatement',
      value: '需要从空白工作区实现一个个人博客网站。',
      source: 'user-confirmed',
    });
    await captureWorkspace(project, {
      field: 'problem.whyNow',
      value: '用户已经确认先做第一版博客站。',
      source: 'user-confirmed',
    });

    await assert.rejects(
      () => synthesizeWorkspace(project, {
        title: '个人博客网站第一版',
        owner: 'OpenPrd',
        problemStatement: '从零实现一个个人博客网站。',
        whyNow: '用户已经确认先做第一版博客站。',
        primaryUsers: ['博客访问者'],
        goals: ['展示个人内容与文章'],
        successMetrics: ['访问者可打开首页并进入文章详情'],
        acceptanceGoals: ['首页和文章详情可访问'],
        inScope: ['首页与文章详情'],
        outOfScope: ['评论系统'],
        primaryFlows: ['访问首页并打开文章详情'],
        functional: ['展示个人介绍与文章内容'],
        productType: 'consumer',
      }),
      /还没有离开需求补齐阶段|建议先执行: openprd (clarify|classify|interview)/
    );
  });

  test('Codex hook injects matched project knowledge skills without mutating adoption state', async () => {
    const { project } = await makeCodexHookProject();
    await seedProjectKnowledgeSkill(project);
    const knowledgeIndexPath = path.join(project, '.openprd', 'knowledge', 'index.json');
    const knowledgeIndexBefore = await fs.readFile(knowledgeIndexPath, 'utf8');

    const payload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请继续处理 src/billing-api.js 里的 traceId 透传和 webhook 回滚，直接修。',
    });
    const context = payload.hookSpecificOutput.additionalContext;
    assert.ok(context.includes('项目级经验候选: 找到 1 条'));
    assert.ok(context.includes('先做项目经验检查'));
    assert.ok(context.includes('billing-trace-rollback'));
    assert.ok(context.includes('traceId 透传'));

    assert.equal(await fs.readFile(knowledgeIndexPath, 'utf8'), knowledgeIndexBefore);
  });

  test('Codex hook keeps bare session-ID diagnostics on the lightweight read-only path', async () => {
    const { project } = await makeCodexHookProject();
    const diagnosticPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: [
        '看下这个 codex 对话记录：019e9b0e-00dc-7ca2-b673-157af1082f5c',
        'openprd 能不能将“需求类型：直接处理”显示为“需求类型：直接处理（L0）”，这样就不需要占用额外的“内部路由码”这一行，因为对用户来说好像意义不大',
        '',
        '【原文内容】',
        '需求类型：直接处理',
        '内部路由码：L0',
        '理由：已经有本机日志把问题收窄到“启动动作落到了 global Hermes，而不是 agent-45031fde profile”，现在继续只读追踪这条调用链最合适。',
        '推荐下一步：我先从 framework.hermes.start 和 framework.hermes.restart 的派发入口往下读，确认桌面在什么条件下会把 profile 级动作降成 global。',
      ].join('\n'),
    });
    assert.equal(diagnosticPromptPayload.continue, true);
    assert.equal(await pathExists(path.join(project, '.openprd', 'harness', 'requirement-gate.json')), false);
    assert.equal(diagnosticPromptPayload.hookSpecificOutput.additionalContext.includes('下一步类型: session-continuation'), false);
    assert.equal(diagnosticPromptPayload.hookSpecificOutput.additionalContext.includes('当前处理路径: 继续已有任务'), false);
  });

  test('Codex hook injects continuation lane context for historical session ID prompts', async () => {
    const { project } = await makeCodexHookProject();
    const continuationPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '继续执行这个记录：019e5ac7-088b-7ff2-86d1-4c026ff68105',
    });
    assert.equal(continuationPromptPayload.continue, true);
    assert.ok(continuationPromptPayload.hookSpecificOutput.additionalContext.includes('当前处理路径: 继续已有任务'));
    assert.equal(continuationPromptPayload.hookSpecificOutput.additionalContext.includes('下一步类型: session-continuation'), false);
    assert.ok(continuationPromptPayload.hookSpecificOutput.additionalContext.includes('会话 ID'));
  });

  test('Codex hook keeps review confirmation separate and auto-releases explicit execution after tasks are ready', async () => {
    const { project } = await makeCodexHookProject();

    const requirementPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现：在【Agent管理】模块下，我希望增加一个【团队搭建】放到【Agent 工区】菜单下面，这个模块主要是将 Agent市场、技能库和 CLI库按流程串联起来，一站式完成配置。',
    });
    assert.equal(requirementPromptPayload.continue, true);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('runs in background'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('$openprd-requirement-intake'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('面向个人消费者场景'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('面向企业服务场景'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('以 Agent 为主要使用场景'));
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('base/consumer/b2b/agent'), false);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('不要直接把 consumer / b2b / agent 当展示词'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd clarify .'));
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd clarify . --open'), false);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('需求类型判断'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('直接处理=L0'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('现有功能优化=L1'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('新功能/新流程方案=L2'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('需求判断 / 需求理解 / 功能范围 / 技术方案'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('第一批最容易触达的社区或种子用户'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('当前替代方案'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('先怎么手工交付'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('什么承诺才算真需求'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('验证阶段怎样先活下来'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('轻量主句'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('固定模板'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('Markdown tables'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('final answer'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('approval policy'));
    assert.ok(
      requirementPromptPayload.hookSpecificOutput.additionalContext.includes('Do not open clarification HTML')
        || requirementPromptPayload.hookSpecificOutput.additionalContext.includes('Do not open a clarification HTML page')
    );
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('choose inline vs artifact'), false);
    assert.equal(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('clarifyPresentation.mode is artifact'), false);
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd visual-compare'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('已确认，我按这个继续'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('确认，我们就按这个'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('先整理需求摘要给你确认'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('你回我一句我就开始实现'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('openprd learn .'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('学习包骨架'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('focus-board.json'));
    assert.ok(requirementPromptPayload.hookSpecificOutput.additionalContext.includes('组合到同一张证据板里统一验收'));
    const requirementGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(requirementGate.active, true);
    assert.equal(requirementGate.status, 'requires-clarification');
    assert.equal(requirementGate.intakeMode, 'deep-reflection');
    assert.equal(requirementGate.approvalPolicy.reviewPolicy, 'required');

    const blockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// premature implementation\n*** End Patch',
    });
    assert.equal(blockedPatchPayload.decision, 'block');
    assert.ok(
      blockedPatchPayload.reason.includes('requirement gate is still active')
        || blockedPatchPayload.reason.includes('OpenPrd blocked a mutating action')
    );

    const confirmedPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '确认修复',
    });
    assert.ok(confirmedPromptPayload.hookSpecificOutput.additionalContext.includes('需求确认稿'));
    assert.ok(confirmedPromptPayload.hookSpecificOutput.additionalContext.includes('final answer'));
    assert.ok(confirmedPromptPayload.hookSpecificOutput.additionalContext.includes('approval policy'));
    const confirmedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(confirmedGate.active, true);
    assert.equal(confirmedGate.status, 'clarification-confirmed');

    const stillBlockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// still premature implementation\n*** End Patch',
    });
    assert.equal(stillBlockedPatchPayload.decision, 'block');

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
    const unauthorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: reviewCommand },
    });
    assert.equal(unauthorizedReviewConfirmPayload.decision, 'block');
    assert.ok(unauthorizedReviewConfirmPayload.reason.includes('did not explicitly confirm this exact PRD review artifact'));

    const explicitReviewApprovalPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: reviewCommand,
    });
    assert.ok(explicitReviewApprovalPayload.hookSpecificOutput.additionalContext.includes('只允许记录这次确认结果'));
    const authorizedReviewGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(authorizedReviewGate.active, true);
    assert.equal(authorizedReviewGate.status, 'review-confirmation-authorized');

    const authorizedReviewConfirmPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: reviewCommand },
    });
    assert.equal(authorizedReviewConfirmPayload.decision, undefined);
    assert.equal(authorizedReviewConfirmPayload.continue, true);

    await reviewWorkspace(project, { mark: 'confirmed' });
    await generateOpenSpecChangeWorkspace(project, { change: 'team-builder' });

    const loopRunPromptPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: [
        '# OpenPrd 长程单任务执行会话',
        'Agent: codex',
        '模式: loop-run',
        `项目: ${project}`,
        '变更: team-builder',
        '任务: T001.01 实现团队搭建页面流程',
        '',
        '## Harness 契约',
        '你正在运行一个隔离的 OpenPrd loop 单任务会话。',
      ].join('\n'),
    });
    assert.equal(loopRunPromptPayload.continue, true);
    assert.equal(loopRunPromptPayload.hookSpecificOutput.additionalContext.includes('requirement intake gate: opened'), false);
    const loopRunEvents = await fs.readFile(path.join(project, '.openprd', 'harness', 'events.jsonl'), 'utf8');
    assert.equal(loopRunEvents.split('\n').some((line) => line.includes('模式: loop-run') && line.includes('requirement-gate-opened')), false);

    const gateBeforeImplementation = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(gateBeforeImplementation.active, false);
    assert.equal(gateBeforeImplementation.status, 'execution-authorized');

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// confirmed implementation\n*** End Patch',
    });
    assert.equal(allowedPatchPayload.decision, undefined);
    assert.equal(allowedPatchPayload.continue, true);
    const executionAuthorizedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), 'utf8'));
    assert.equal(executionAuthorizedGate.active, false);
    assert.equal(executionAuthorizedGate.status, 'execution-authorized');
  });

  test('run context keeps cold-start implementation prompts in clarify-summary mode', async () => {
    const { project } = await makeCodexHookProject();

    const result = spawnSync(process.execPath, [
      path.resolve('bin/openprd.js'),
      'run',
      project,
      '--context',
      '--message',
      '请帮我实现一个个人博客网站',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /建议下一步: (继续本轮需求入口澄清|clarify-user)/);
    assert.match(result.stdout, /当前回复目标: 先在对话里输出 requirement 摘要或只追问 1 个最高价值澄清点/);
    assert.match(result.stdout, /不要承诺“按默认方案直接实现”/);
    assert.match(result.stdout, /不要把“请帮我实现\/继续实现”当成跳过 requirement 摘要确认的依据/);

  });

  test('run context can reuse the current turn prompt for lightweight frontend implementation guidance', async () => {
    const { project } = await makeCodexHookProject();

    const hookPayload = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现一个静态单页原型：大英博物馆中文导览 App 首页，包含今日推荐、楼层浏览、路线规划、门票与到访准备。不需要先来回确认，直接完成。',
    });
    assert.equal(hookPayload.continue, true);

    const result = spawnSync(process.execPath, [
      path.resolve('bin/openprd.js'),
      'run',
      project,
      '--context',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /建议下一步: (按轻量原型路径继续实现|先给 mini-plan 再继续实现)/);
    assert.match(result.stdout, /当前回复目标: 先用 3-5 行 mini-plan 收一下目标、范围内、范围外和验证方式/);
    assert.match(result.stdout, /\.openprd\/design\/active\//);
    assert.match(result.stdout, /\.openprd\/design\/templates\//);
    assert.match(result.stdout, /openprd design-starter/);
    assert.match(result.stdout, /openprd run \. --context --message <用户原话>/);
    assert.match(result.stdout, /--brief/);
    assert.match(result.stdout, /--sections/);
    assert.match(result.stdout, /只有确认这个页面本来就不依赖外部事实、品牌素材或真实图片时，才在 active design artifacts 写清无依赖/);
    assert.match(result.stdout, /先不要急着加 `--no-real-images`/);
    assert.match(result.stdout, /先把它当主参考源/);
    assert.match(result.stdout, /Patch Mode/);
    assert.match(result.stdout, /下一步必须出现真实写文件动作/);
    assert.match(result.stdout, /index\.next\.html/);
    assert.match(result.stdout, /不要删除 `index.html` 后重起/);
    assert.match(result.stdout, /主要占位已清掉/);
    assert.doesNotMatch(result.stdout, /建议下一步: (继续本轮需求入口澄清|clarify-user)/);
  });

  test('run context routes explicit 梳理诉求 into brainstorm mode instead of stopping at clarify summary', async () => {
    const { project } = await makeCodexHookProject();

    const context = await runWorkspace(project, {
      context: true,
      message: '我想做一个给销售和产品团队用的 AI 客户访谈助手，你先帮我梳理下第一版该怎么切、值不值得先做太重。',
    });

    assert.equal(context.recommendation.type, 'workflow');
    assert.equal(context.recommendation.nextAction, 'brainstorm');
    assert.equal(context.recommendation.title, '先进入脑暴模式收敛方向');
    assert.equal(context.recommendation.command, 'openprd brainstorm . --open');

    const printResult = spawnSync(process.execPath, [
      path.resolve('bin/openprd.js'),
      'run',
      project,
      '--context',
      '--message',
      '我想做一个给销售和产品团队用的 AI 客户访谈助手，你先帮我梳理下第一版该怎么切、值不值得先做太重。',
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(printResult.status, 0, printResult.stderr);
    assert.match(printResult.stdout, /建议下一步: 先进入脑暴模式收敛方向/);
    assert.match(printResult.stdout, /内部下一步参考: openprd brainstorm \. --open/);
    assert.match(printResult.stdout, /当前回复目标: 先进入脑暴模式，把核心诉求、目标结果、当前替代方案、推荐方向和验证重点整理成脑暴页；不要只停在 requirement 摘要。/);
  });
});
