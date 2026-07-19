import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

import { initWorkspace } from '../src/openprd.js';

import {
  makeCodexHookProject,
  makeTempProject,
  runCodexHook,
  runCodexHookWithoutCwd,
  seedDesignStarterEvent,
  seedReadyFrontendDesignArtifacts,
  writeCodexTranscript,
} from './helpers/requirement-gate-helpers.js';

process.env.OPENPRD_HOME = path.join(os.tmpdir(), 'openprd-test-home-requirement-gate-safety');

describe('Codex hook safety and design gates', () => {
  test('Codex hook keeps skill visualization advisory without blocking edits', async () => {
    const { project } = await makeCodexHookProject();

    const skillPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '先分析一下并准备修改 skills/openprd-shared/SKILL.md 和 AGENTS.md，优化这个 skill workflow。',
    });
    assert.equal(skillPrompt.continue, true);
    assert.ok(skillPrompt.hookSpecificOutput.additionalContext.includes('可视化注意项'));
    assert.ok(skillPrompt.hookSpecificOutput.additionalContext.includes('彩色 Mermaid'));
    const skillGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'skill-visualization-gate.json'), 'utf8'));
    assert.equal(skillGate.active, true);

    const blockedSkillPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: skills/openprd-shared/SKILL.md\n@@\n+- pending edit\n*** End Patch',
    });
    assert.equal(blockedSkillPatch.decision, undefined);
    assert.equal(blockedSkillPatch.continue, true);
    assert.ok(JSON.stringify(blockedSkillPatch).includes('visualization attention'));

    const confirmed = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '确认执行',
    });
    assert.equal(confirmed.continue, true);
    const confirmedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'skill-visualization-gate.json'), 'utf8'));
    assert.equal(confirmedGate.active, false);
    assert.equal(confirmedGate.status, 'user-confirmed-after-visualization');

    const allowedSkillPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: skills/openprd-shared/SKILL.md\n@@\n+- confirmed edit\n*** End Patch',
    });
    assert.equal(allowedSkillPatch.continue, true);
  });

  test('Codex hook keeps DeepWiki and Context7 evidence as advisory attention while allowing in-scope mutations', async () => {
    const { project } = await makeCodexHookProject();

    const repoPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请参考 github.com/vercel/next.js 这个公开仓库的整体架构，对标下我们的 CLI 设计，然后直接修改实现。',
    });
    assert.equal(repoPrompt.continue, true);
    assert.ok(repoPrompt.hookSpecificOutput.additionalContext.includes('外部仓库证据注意项'));
    let researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.kind, 'deepwiki');
    assert.equal(researchGate.active, true);

    const repoPatchWithAttention = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// mutate before deepwiki\n*** End Patch',
    });
    assert.equal(repoPatchWithAttention.decision, undefined);
    assert.equal(repoPatchWithAttention.continue, true);
    assert.ok(JSON.stringify(repoPatchWithAttention).includes('research attention'));
    assert.ok(JSON.stringify(repoPatchWithAttention).includes('read_wiki_structure'));

    runCodexHook(project, 'PreToolUse', {
      tool_name: 'deepwiki__read_wiki_structure',
      tool_input: { repo: 'vercel/next.js' },
    });
    runCodexHook(project, 'PreToolUse', {
      tool_name: 'deepwiki__ask_question',
      tool_input: { question: 'What are the main subsystems?' },
    });
    researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.active, false);
    assert.equal(researchGate.status, 'evidence-collected');

    const contextPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个第三方 SDK 和 CLI 的配置、限制和迁移路径需要确认一下，然后直接改我们的集成实现。',
    });
    assert.equal(contextPrompt.continue, true);
    assert.ok(contextPrompt.hookSpecificOutput.additionalContext.includes('外部技术证据注意项'));
    researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.kind, 'context7');
    assert.equal(researchGate.active, true);

    const contextPatchWithAttention = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: src/app.ts\n@@\n+// mutate before context7\n*** End Patch',
    });
    assert.equal(contextPatchWithAttention.decision, undefined);
    assert.equal(contextPatchWithAttention.continue, true);
    assert.ok(JSON.stringify(contextPatchWithAttention).includes('research attention'));
    assert.ok(JSON.stringify(contextPatchWithAttention).includes('resolve_library_id'));

    runCodexHook(project, 'PreToolUse', {
      tool_name: 'context7__resolve_library_id',
      tool_input: { libraryName: 'example-sdk' },
    });
    runCodexHook(project, 'PreToolUse', {
      tool_name: 'context7__query_docs',
      tool_input: { question: 'How do I configure migration steps?' },
    });
    researchGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'research-gate.json'), 'utf8'));
    assert.equal(researchGate.active, false);
    assert.equal(researchGate.status, 'evidence-collected');
  });

  test('Codex hook allows frontend writes while active design contracts are maintained in background', async () => {
    const { project } = await makeCodexHookProject();

    const frontendPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请直接实现一个大英博物馆中文导览 App 首页静态原型，包含今日推荐、楼层浏览、路线规划、门票和到访准备。已知事实：开放时间 10:00-17:00，中文语音导览 7 GBP，会员优先。不要做成通用极简 SaaS 风。',
    });
    assert.equal(frontendPrompt.continue, true);

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-08 00:00:00',
    }, null, 2));

    const blockedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Add File: index.html',
        '+<!doctype html>',
        '+<html lang="zh-CN">',
        '+<body>museum prototype</body>',
        '+</html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(blockedPatchPayload.decision, undefined);
    assert.equal(blockedPatchPayload.continue, true);
    assert.ok(JSON.stringify(blockedPatchPayload).includes('design attention'));

    const activeDir = path.join(project, '.openprd', 'design', 'active');
    await fs.writeFile(path.join(activeDir, 'facts-sheet.md'), '# Facts\n\n- 开放时间：10:00-17:00\n- 中文语音导览：7 GBP\n- 会员优先：已知用户输入\n');
    await fs.writeFile(path.join(activeDir, 'asset-spec.md'), '# Assets\n\n- 品牌资产：暂无官方素材，先用文字与中性色块表达\n');
    await fs.writeFile(path.join(activeDir, 'image-preflight.md'), '# Image preflight\n\n- 真实馆藏图片：当前缺失\n- 降级方案：先用明确的馆藏卡片占位并标记待替换\n');
    await fs.writeFile(path.join(activeDir, 'direction-plan.md'), '# Directions\n\n1. 馆藏导览\n2. 编辑感叙事\n3. 高密度工具型\n');
    await fs.writeFile(path.join(activeDir, 'selected-direction.md'), '# Selected\n\n- lens: catalog-clarity\n- theme: warm-editorial\n- layout: story-map\n');

    const allowedPatchPayload = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Add File: index.html',
        '+<!doctype html>',
        '+<html lang="zh-CN">',
        '+<body>museum prototype</body>',
        '+</html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(allowedPatchPayload.decision, undefined);
    assert.equal(allowedPatchPayload.continue, true);
  });

  test('Codex hook keeps Patch Mode hover advisory and releases after target write lands', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0001';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');
    const transcriptPath = await writeCodexTranscript(
      project,
      sessionId,
      '我现在开始覆盖入口文件，下一步直接重写 index.html，把真实内容和图片约束落进去。'
    );

    const readWithAttention = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'docs', 'basic', 'frontend-guidelines.md'),
      },
    });
    assert.equal(readWithAttention.decision, undefined);
    assert.equal(readWithAttention.continue, true);
    assert.ok(JSON.stringify(readWithAttention).includes('Patch Mode attention'));
    assert.ok(JSON.stringify(readWithAttention).includes('index.html'));
    assert.ok(JSON.stringify(readWithAttention).includes('index.next.html'));

    const allowedWrite = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Add File: index.next.html',
        '+<!doctype html>',
        '+<html lang="zh-CN"><body>rewrite draft</body></html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(allowedWrite.decision, undefined);
    assert.equal(allowedWrite.continue, true);

    const armedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(armedGate.active, true);
    assert.equal(armedGate.status, 'write-attempted');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await fs.writeFile(path.join(project, 'index.next.html'), '<!doctype html><html lang="zh-CN"><body>rewrite draft</body></html>\n');

    const releasedRead = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'index.html'),
      },
    });
    assert.equal(releasedRead.decision, undefined);
    assert.equal(releasedRead.continue, true);

    const closedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(closedGate.active, false);
    assert.equal(closedGate.status, 'write-observed');
  });

  test('Codex hook records post-starter focus exhaustion as Patch Mode attention without blocking', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0003';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    const firstFocus = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'index.html'),
      },
    });
    assert.equal(firstFocus.decision, undefined);
    assert.equal(firstFocus.continue, true);

    const secondFocus = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'Bash',
      tool_input: {
        command: "sed -n '1,80p' .openprd/design/active/facts-sheet.md",
      },
    });
    assert.equal(secondFocus.decision, undefined);
    assert.equal(secondFocus.continue, true);

    const gateAfterFocus = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(gateAfterFocus.active, true);
    assert.equal(gateAfterFocus.phase, 'handoff');
    assert.equal(gateAfterFocus.status, 'handoff-awaiting-entry-write');
    assert.equal(gateAfterFocus.focusAllowanceRemaining, 0);

    const searchWithAttention = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'WebSearch',
      tool_input: {
        query: '西双版纳 观鸟 官方',
      },
    });
    assert.equal(searchWithAttention.decision, undefined);
    assert.equal(searchWithAttention.continue, true);
    assert.ok(JSON.stringify(searchWithAttention).includes('Patch Mode attention'));
    assert.ok(JSON.stringify(searchWithAttention).includes('index.next.html'));

    const allowedWrite = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Update File: index.html',
        '@@',
        '-<!doctype html><html lang="zh-CN"><body>starter</body></html>',
        '+<!doctype html><html lang="zh-CN"><body>rainforest guide</body></html>',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(allowedWrite.decision, undefined);
    assert.equal(allowedWrite.continue, true);

    const armedGate = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(armedGate.active, true);
    assert.equal(armedGate.status, 'write-attempted');
  });

  test('Codex hook treats nested tool_input.command shell reads as allowed handoff focus', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0005';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    const focusRead = runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_input: {
        command: "sed -n '1,120p' index.html",
      },
    });
    assert.equal(focusRead.decision, undefined);
    assert.equal(focusRead.continue, true);

    const gateAfterFocus = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(gateAfterFocus.active, true);
    assert.equal(gateAfterFocus.phase, 'handoff');
    assert.equal(gateAfterFocus.status, 'handoff-focus-read');
    assert.equal(gateAfterFocus.focusAllowanceRemaining, 1);
  });

  test('Codex hook can still arm Patch Mode from the hook script path when PreToolUse payload omits cwd', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0006';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    const focusRead = runCodexHookWithoutCwd(project, 'PreToolUse', {
      tool_input: {
        command: "sed -n '1,120p' index.html",
      },
    }, path.resolve('..'));
    assert.equal(focusRead.decision, undefined);
    assert.equal(focusRead.continue, true);

    const gateAfterFocus = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'harness', 'patch-mode-gate.json'), 'utf8'));
    assert.equal(gateAfterFocus.active, true);
    assert.equal(gateAfterFocus.phase, 'handoff');
    assert.equal(gateAfterFocus.status, 'handoff-focus-read');
    assert.equal(gateAfterFocus.focusAllowanceRemaining, 1);
  });

  test('Stop hook reminds when Patch Mode overwrite was announced but no entry write landed', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0002';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');
    const transcriptPath = await writeCodexTranscript(
      project,
      sessionId,
      '我现在开始覆盖入口文件，下一步直接重写 index.html，把真实内容落进去。'
    );

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      transcript_path: transcriptPath,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'docs', 'basic', 'frontend-guidelines.md'),
      },
    });

    const stop = runCodexHook(project, 'Stop', {
      session_id: sessionId,
    });
    assert.equal(stop.continue, true);
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('还没有观察到对应页面写入'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('index.html'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('index.next.html'));
  });

  test('Stop hook reminds when design-starter landed but Patch Mode handoff never wrote the entry', async () => {
    const { project } = await makeCodexHookProject();
    const sessionId = '019ea999-0000-7000-8000-patchmode0004';

    runCodexHook(project, 'UserPromptSubmit', {
      session_id: sessionId,
      prompt: '请直接实现一个西双版纳雨林观鸟导览首页，不要停下来问问题。',
    });

    await fs.writeFile(path.join(project, '.openprd', 'harness', 'requirement-gate.json'), JSON.stringify({
      version: 1,
      active: false,
      status: 'not-required',
      reason: 'test override',
      updatedAt: '2026-06-09 00:00:00',
    }, null, 2));
    await seedReadyFrontendDesignArtifacts(project);
    await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html lang="zh-CN"><body>starter</body></html>\n');
    await seedDesignStarterEvent(project, 'index.html');

    runCodexHook(project, 'PreToolUse', {
      session_id: sessionId,
      tool_name: 'Read',
      tool_input: {
        file_path: path.join(project, 'index.html'),
      },
    });

    const stop = runCodexHook(project, 'Stop', {
      session_id: sessionId,
    });
    assert.equal(stop.continue, true);
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('design-starter 已经落地'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('完成度提醒'));
    assert.ok(stop.hookSpecificOutput.additionalContext.includes('index.html'));
  });

  test('Codex hook protects vault reads and reminds about browser, copy, and weapp rules', async () => {
    const { project } = await makeCodexHookProject();

    const credentialPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '这个任务需要 API key 和 token，先帮我拿一下凭证。',
    });
    assert.equal(credentialPrompt.continue, true);
    assert.ok(credentialPrompt.hookSpecificOutput.additionalContext.includes('secrets-vault'));

    const blockedVaultRead = runCodexHook(project, 'PreToolUse', {
      tool_name: 'Bash',
      tool_input: { cmd: 'cat ~/.vault/secrets.json' },
    });
    assert.equal(blockedVaultRead.decision, 'block');
    assert.ok(blockedVaultRead.reason.includes('raw vault read'));

    const browserPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '请用 Computer Use 打开浏览器页面并点击提交订单按钮。',
    });
    assert.equal(browserPrompt.continue, true);
    assert.ok(browserPrompt.hookSpecificOutput.additionalContext.includes('Codex-owned browser window'));

    const browserReminder = runCodexHook(project, 'PreToolUse', {
      tool_name: 'computer_click',
      tool_input: { action: 'submit order button' },
    });
    assert.equal(browserReminder.continue, true);
    assert.ok(browserReminder.hookSpecificOutput.additionalContext.includes('窗口归属'));

    const copyPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把这个错误文案改成普通用户能看懂的，并同步检查 i18n。',
    });
    assert.equal(copyPrompt.continue, true);
    assert.ok(copyPrompt.hookSpecificOutput.additionalContext.includes('Localizable'));

    const weappPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '微信小程序这个页面按钮点了没反应，直接帮我修一下并验证。',
    });
    assert.equal(weappPrompt.continue, true);
    assert.ok(weappPrompt.hookSpecificOutput.additionalContext.includes('本地小程序运行态验证'));
    assert.ok(weappPrompt.hookSpecificOutput.additionalContext.includes('不要为了验证自动重开应用'));
    assert.equal(weappPrompt.hookSpecificOutput.additionalContext.includes('weapp-dev-mcp'), false);
    const weappPatch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: '*** Begin Patch\n*** Update File: miniprogram/pages/index.js\n@@\n+// fix tap handler\n*** End Patch',
    });
    assert.equal(weappPatch.continue, true);
    const stopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(stopReminder.continue, true);
    assert.ok(stopReminder.hookSpecificOutput.additionalContext.includes('小程序运行态验证仍未完成'));
    assert.equal(stopReminder.hookSpecificOutput.additionalContext.includes('weapp-dev-mcp'), false);
    const weappCopyPrompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把微信小程序首页按钮文案改短一点。',
    });
    assert.equal(weappCopyPrompt.continue, true);
    assert.equal(weappCopyPrompt.hookSpecificOutput.additionalContext.includes('本地小程序运行态验证'), false);
    const copyStopReminder = runCodexHook(project, 'Stop', {});
    assert.equal(copyStopReminder.continue, true);
    assert.equal(copyStopReminder.hookSpecificOutput?.additionalContext?.includes('小程序运行态验证仍未完成') ?? false, false);
  });

  test('Codex hook requires a visual evidence board for raw screenshot validation', async () => {
    const { project } = await makeCodexHookProject();
    await seedReadyFrontendDesignArtifacts(project);

    const prompt = runCodexHook(project, 'UserPromptSubmit', {
      prompt: '把设置页面卡片间距调一下，并用 Computer 实测截图验证。',
    });
    assert.equal(prompt.continue, true);

    const patch = runCodexHook(project, 'PreToolUse', {
      tool_name: 'apply_patch',
      tool_input: [
        '*** Begin Patch',
        '*** Update File: src/App.tsx',
        '@@',
        '+export const settingsCardGap = 12;',
        '*** End Patch',
      ].join('\n'),
    });
    assert.equal(patch.continue, true);

    const rawScreenshot = runCodexHook(project, 'PostToolUse', {
      tool_name: 'computer_screenshot',
      tool_input: { path: 'actual-settings.png' },
      tool_response: 'Computer 实测截图已保存 actual-settings.png',
    });
    assert.deepEqual(rawScreenshot, { continue: true });

    const missingBoardStop = runCodexHook(project, 'Stop', {});
    assert.equal(missingBoardStop.continue, true);
    assert.ok(missingBoardStop.hookSpecificOutput.additionalContext.includes('截图实测证据板'));
    assert.ok(missingBoardStop.hookSpecificOutput.additionalContext.includes('普通截图和 Computer 实测截图只能作为原始素材'));
    assert.ok(missingBoardStop.hookSpecificOutput.additionalContext.includes('verification-board.json'));

    const boardSignal = runCodexHook(project, 'PostToolUse', {
      tool_name: 'Bash',
      tool_input: {
        cmd: 'openprd visual-compare . --board verification-board.json --json',
      },
      tool_response: '{"mode":"verification-board","outputPath":".openprd/harness/visual-reviews/visual-verification-board-test.jpg"}',
    });
    assert.deepEqual(boardSignal, { continue: true });

    const afterBoardStop = runCodexHook(project, 'Stop', {});
    assert.equal(afterBoardStop.continue, true);
    assert.equal(
      afterBoardStop.hookSpecificOutput?.additionalContext.includes('普通截图和 Computer 实测截图只能作为原始素材') ?? false,
      false
    );
  });

  test('Stop hook reminds about project-level closeout when final verification artifacts are missing', async () => {
    const project = await makeTempProject();
    await initWorkspace(project, { templatePack: 'consumer' });
    await fs.mkdir(path.join(project, 'src'), { recursive: true });
    await fs.writeFile(path.join(project, 'src', 'closeout.js'), 'export const closeout = true;\n');
    await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
      version: 1,
      prompt: '继续把这轮实现完整收口。',
      touchedFiles: ['src/closeout.js'],
      reviewSignals: [
        {
          id: 'loop-finish-signal',
          kind: 'loop-finish',
          ok: true,
          summary: 'task scoped evidence is ready',
          touchedFiles: ['src/closeout.js'],
        },
      ],
    }, null, 2)}\n`);

    const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
      cwd: project,
      input: JSON.stringify({ cwd: project, hook_event_name: 'Stop' }),
      encoding: 'utf8',
      env: {
        ...process.env,
        OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
      },
    });
    assert.equal(stop.status, 0);
    const payload = JSON.parse(stop.stdout);
    const context = payload.hookSpecificOutput.additionalContext;
    assert.match(context, /项目级收口证据还没补齐/);
    assert.match(context, /openprd quality \. --verify/);
    assert.match(context, /openprd run \. --verify/);
    assert.match(context, /Markdown \/ HTML 测试报告/);
  });

  test('Codex hook reserves blockHook for the raw vault safety boundary only', async () => {
    const source = await fs.readFile(new URL('../src/codex-hook-runner-template.mjs', import.meta.url), 'utf8');
    assert.equal((source.match(/return blockHook\(/g) ?? []).length, 1);
    const callIndex = source.indexOf('return blockHook(');
    const safetyContext = source.slice(Math.max(0, callIndex - 500), callIndex + 500);
    assert.match(safetyContext, /isRawVaultReadAttempt/);
    assert.match(safetyContext, /blocked-raw-vault-read/);
  });
});
