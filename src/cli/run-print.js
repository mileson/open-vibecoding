/*
 * 核心功能
 * 渲染 run / loop 相关命令的人类可读输出或 JSON 输出。
 *
 * 输入
 * 接收 run context、run verify、loop prompt/run/finish 和执行确认清单等结构化结果对象。
 *
 * 输出
 * 向终端输出当前执行流、任务状态、Loop 运行信息和知识回顾摘要。
 *
 * 定位
 * 位于 CLI 表现层的执行路径输出模块，专门承接 run/loop 相关的密集终端信息。
 *
 * 依赖
 * 依赖 shared-print 与 doctor-print 提供的复用 helper，不承担实际执行。
 *
 * 维护规则
 * run/loop 输出字段变更时要保持任务态、验证态和确认清单的展示顺序稳定，避免遗漏执行门槛。
 */
import { labelExecutionMode } from '../execution-strategy.js';
import { printCodexRuntimeResult } from './doctor-print.js';
import { printKnowledgeReview, printKnowledgeSkillMatches } from './shared-print.js';

function printLoopWorkspaceMeta(result, fallbackProjectRoot = null) {
  const workspacePath = result.workspace?.path ?? result.commit?.worktreePath ?? fallbackProjectRoot;
  const branch = result.workspace?.branch ?? result.commit?.branch ?? null;
  if (workspacePath) {
    console.log(`工作区: ${workspacePath}`);
  }
  if (branch) {
    console.log(`分支: ${branch}`);
  }
  if (result.workspace?.created) {
    console.log('隔离 worktree: 已创建');
  }
}

function printExecutionConfirmationChecklist(checklist) {
  if (!checklist?.required) {
    return;
  }
  console.log(`${checklist.title ?? '开始动手前先确认这些'}:`);
  if (checklist.objective) {
    console.log(`- 这次要做什么: ${checklist.objective}`);
  }
  if (checklist.scope?.length > 0) {
    console.log(`- 这次范围: ${checklist.scope.join('；')}`);
  }
  if (checklist.implementationItems?.length > 0) {
    console.log(`- 我会这样推进: ${checklist.implementationItems.join('；')}`);
  }
  if (checklist.outOfScope?.length > 0) {
    console.log(`- 这次先不做: ${checklist.outOfScope.join('；')}`);
  }
  if (checklist.verification?.length > 0) {
    console.log(`- 完成后会检查: ${checklist.verification.join('；')}`);
  }
  if (checklist.risks?.length > 0) {
    console.log(`- 需要提前知道: ${checklist.risks.join('；')}`);
  }
  if (checklist.confirmationPrompt) {
    console.log(`- 如果要我现在继续: ${checklist.confirmationPrompt}`);
  }
}

function printRunResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'run-record-hook') {
    console.log(`OpenPrd run hook 已记录: ${result.event.eventName} -> ${result.event.outcome}`);
    console.log(`迭代记录: ${result.files.iterations}`);
    return;
  }

  if (result.action === 'run-verify') {
    const taskReady = result.readiness?.taskReady !== false;
    const workspaceReady = result.readiness?.workspaceReady !== false;
    const workspaceAttention = result.workspaceAttention ?? null;
    const status = taskReady
      ? (workspaceReady ? '通过' : '当前任务通过，工作区待关注')
      : '当前任务失败';
    console.log(`OpenPrd run verify: ${status}`);
    if (result.readiness) {
      console.log(`任务就绪: ${taskReady ? '是' : '否'}`);
      console.log(`工作区就绪: ${workspaceReady ? '是' : '否'}`);
      if (result.readiness.qualityProductionReady !== null) {
        console.log(`质量门禁: ${result.readiness.qualityProductionReady ? 'production-ready' : '待补证据'}`);
      }
    }
    for (const check of result.checks) {
      const scope = check.scope === 'workspace' ? '工作区' : '任务';
      const detail = check.name === 'quality' && check.productionReady === false
        ? ' (production-ready=false)'
        : '';
      console.log(`- ${check.ok ? '通过' : '失败'}: ${check.name} [${scope}]${detail}`);
    }
    if (workspaceAttention?.kind === 'feature-coverage-ledger') {
      const changeLabel = workspaceAttention.activeChange
        ? `激活变更 ${workspaceAttention.activeChange}`
        : '当前激活任务';
      const progress = workspaceAttention.total > 0
        ? `${workspaceAttention.done}/${workspaceAttention.total}`
        : `${workspaceAttention.done}`;
      console.log('工作区待关注原因: feature-coverage 账本未收口');
      console.log(`- ${changeLabel} 已完成 ${progress}，待处理 ${workspaceAttention.pending}${workspaceAttention.blocked > 0 ? `，阻塞 ${workspaceAttention.blocked}` : ''}`);
      console.log('- 这通常表示任务账本或覆盖证据还没补齐，不等于本次功能失败。');
    } else if (workspaceAttention?.summary) {
      console.log(`工作区待关注原因: ${workspaceAttention.summary}`);
    }
    printKnowledgeReview(result.knowledgeReview);
    const extraWarnings = workspaceAttention?.detail
      ? result.warnings.filter((warning) => warning !== `quality: ${workspaceAttention.detail}`)
      : result.warnings;
    if (extraWarnings.length > 0) {
      console.log('工作区待关注:');
      for (const warning of extraWarnings) {
        console.log(`- ${warning}`);
      }
    }
    if (result.errors.length > 0) {
      console.log('错误:');
      for (const error of result.errors) {
        console.log(`- ${error}`);
      }
    }
    return;
  }

  console.log('当前进展参考');
  console.log(`当前项目: ${result.projectRoot}`);
  if (result.runtimeEnvironment?.active?.activeClient && result.runtimeEnvironment.active.activeClient !== 'unknown') {
    const active = result.runtimeEnvironment.active;
    const confidence = typeof active.confidence === 'number' ? `，置信度 ${active.confidence}` : '';
    console.log(`当前 Agent 环境: ${active.activeClient}${active.surface ? ` / ${active.surface}` : ''}${confidence}`);
  }
  console.log(`基础检查: ${result.validation.valid ? '通过' : '失败'}`);
  if (result.lane?.summary) {
    console.log(`当前处理路径: ${result.lane.summary}`);
  }
  if (result.activeChange) {
    const label = result.recommendation?.type === 'requirement-intake' ? '历史聚焦事项' : '当前聚焦事项';
    console.log(`${label}: ${result.activeChange}`);
  }
  if (result.focus?.changeId && result.focus.changeId !== result.activeChange) {
    console.log(`当前补充焦点: ${result.focus.changeId}`);
  }
  if (result.activeRequirementGate) {
    const gateStatus = result.activeRequirementGate.status ?? 'active';
    const gateSuffix = result.activeRequirementGate.relevance === 'background' ? '（仅背景提醒）' : '';
    console.log(`当前处理阶段: ${gateStatus}${gateSuffix}`);
  }
  if (result.taskSummary) {
    console.log(`后续任务进度: ${result.taskSummary.completed}/${result.taskSummary.total} 完成，${result.taskSummary.pending} 待处理，${result.taskSummary.blocked} 阻塞`);
    if (result.taskSummary.implementation) {
      console.log(`待落地任务: ${result.taskSummary.implementation.completed}/${result.taskSummary.implementation.total} 完成，${result.taskSummary.implementation.pending} 待处理`);
    }
  }
  if (result.discovery) {
    console.log(`调研进度: ${result.discovery.runId} 已覆盖 ${result.discovery.summary.covered}/${result.discovery.summary.total}，待处理 ${result.discovery.summary.pending}`);
  }
  printKnowledgeSkillMatches(result.knowledgeSkills);
  console.log('对外表达: 面向用户时，请优先说“本次调整”“后续任务”“继续落地”“完成后检查”这类人话，不要直接复述内部编号、命令、路径、版本号或流程术语。');
  console.log(`建议下一步: ${result.recommendation.title}`);
  if (result.recommendation.executionMode) {
    console.log(`推进方式: ${labelExecutionMode(result.recommendation.executionMode)}`);
  }
  if (result.recommendation.parallelPlan?.eligible) {
    console.log(`协作建议: ${result.recommendation.parallelPlan.summary}`);
  }
  console.log(`这样安排的原因: ${result.recommendation.reason}`);
  if (
    result.recommendation.command
    && !result.recommendation.preparationCommand
    && !result.recommendation.executionCommand
    && !result.recommendation.commitCommand
  ) {
    console.log(`内部下一步参考: ${result.recommendation.command}`);
  }
  if (
    result.recommendation.nextAction === 'brainstorm'
    || result.recommendation.title === '先进入脑暴模式收敛方向'
    || result.recommendation.command === 'openprd brainstorm . --open'
  ) {
    console.log('当前回复目标: 先进入脑暴模式，把核心诉求、目标结果、当前替代方案、推荐方向和验证重点整理成脑暴页；不要只停在 requirement 摘要。');
  } else if (result.recommendation.nextAction === 'lightweight-l1') {
    console.log('当前回复目标: 先用 3-5 行 mini-plan 收一下目标、范围内、范围外和验证方式；如果用户已经明确不需要确认，就按这个轻量路径继续实现，不要再回到 clarify-user。空白工作区先补 `.openprd/design/active/`，再从 `.openprd/design/templates/` 选最近模板；若页面主题和模块范围已经明确，优先把它们带进 `openprd design-starter --brief/--sections`，让 starter 一次落合同和首版内容。只有确认这个页面本来就不依赖外部事实、品牌素材或真实图片时，才在 active design artifacts 写清无依赖；如果题目更像旅游、导览、展览、博物馆、城市或自然观察内容页，先不要急着加 `--no-real-images`。后续必须继续在生成的入口文件上补丁修改；即使结构要大改，也不要删除 `index.html` 后重起。');
  } else if (result.recommendation.nextAction === 'lightweight-l0') {
    console.log('当前回复目标: 直接处理这次局部改动，做最小足够验证，并在完成后用人话说明本次调整。');
  } else if (
    result.recommendation.nextAction === 'clarify-user'
    || result.recommendation.title === 'clarify-user'
    || result.recommendation.title === '继续本轮需求入口澄清'
  ) {
    console.log('当前回复目标: 先在对话里输出 requirement 摘要或只追问 1 个最高价值澄清点；不要承诺“按默认方案直接实现”，也不要把“请帮我实现/继续实现”当成跳过 requirement 摘要确认的依据。');
  }
  if (result.recommendation.preparationCommand || result.recommendation.executionCommand || result.recommendation.commitCommand) {
    console.log('开始动手前提: 只有在用户明确要求继续落地、实现、修复、深挖或提交时，才继续往下做；如果还缺这一步，就先用人话说明范围和影响。');
  }
  printExecutionConfirmationChecklist(result.recommendation.executionConfirmationChecklist);
  if (result.recommendation.preparationCommand) {
    console.log(`内部准备参考: ${result.recommendation.preparationCommand}`);
  }
  if (result.recommendation.executionCommand) {
    console.log(`内部执行参考: ${result.recommendation.executionCommand}`);
  }
  if (result.recommendation.commitCommand) {
    console.log(`内部提交参考: ${result.recommendation.commitCommand}`);
  }
  if (result.recommendation.loop?.worktreeRecommended || result.recommendation.isolation?.worktreeRecommended) {
    console.log('环境建议: 最好放到单独环境里继续，避免和别的事项串线。');
  }
  console.log(`内部检查参考: ${result.recommendation.verifyCommand}`);
  console.log(`内部状态参考: ${result.files.runState}`);
}

function printLoopResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'loop-prompt') {
    console.log(`OpenPrd loop 提示词: ${result.ok ? '就绪' : '阻塞'}`);
    if (result.task) {
      console.log(`任务: ${result.task.id} ${result.task.title}`);
      if (result.task.taskHandle) console.log(`任务句柄: ${result.task.taskHandle}`);
    }
    printLoopWorkspaceMeta(result, result.projectRoot);
    if (result.promptPath) {
      console.log(`提示词: ${result.promptPath}`);
    }
    if (result.invocation?.display) {
      console.log(`执行: ${result.invocation.display}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'loop-run') {
    console.log(`OpenPrd loop 运行: ${result.ok ? '通过' : '失败'}${result.dryRun ? ' (dry-run)' : ''}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.task?.taskHandle) console.log(`任务句柄: ${result.task.taskHandle}`);
    printLoopWorkspaceMeta(result, result.projectRoot);
    if (result.promptPath) console.log(`提示词: ${result.promptPath}`);
    if (result.invocation?.display) console.log(`执行: ${result.invocation.display}`);
    if (result.codexRuntime || result.preflight) {
      printCodexRuntimeResult(result.codexRuntime ?? {
        ok: result.preflight.ok,
        preflight: result.preflight,
        repair: result.repair,
        repairAttempted: Boolean(result.repairAttempted),
      });
    }
    if (result.finish?.commit) {
      console.log(`提交: ${result.finish.commit.skipped ? '跳过' : result.finish.commit.sha}`);
    }
    if (result.finish?.projectRelease?.version) {
      console.log(`项目版本: ${result.finish.projectRelease.version}`);
      if (result.finish.projectRelease.tag?.tagName) {
        const localSha = result.finish.projectRelease.tag.localSha ? ` -> ${result.finish.projectRelease.tag.localSha}` : '';
        console.log(`版本 tag: ${result.finish.projectRelease.tag.tagName}${localSha}`);
      }
    }
    if (result.finish?.testReport) {
      console.log(`测试报告: ${result.finish.testReport}`);
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  if (result.action === 'loop-finish') {
    console.log(`OpenPrd loop finish: ${result.ok ? '通过' : '失败'}`);
    if (result.task) console.log(`任务: ${result.task.id} ${result.task.title}`);
    if (result.task?.taskHandle) console.log(`任务句柄: ${result.task.taskHandle}`);
    printLoopWorkspaceMeta(result, result.projectRoot);
    if (result.commit) console.log(`提交: ${result.commit.skipped ? '跳过' : result.commit.sha}`);
    if (result.projectRelease?.version) {
      console.log(`项目版本: ${result.projectRelease.version}`);
      if (result.projectRelease.tag?.tagName) {
        const localSha = result.projectRelease.tag.localSha ? ` -> ${result.projectRelease.tag.localSha}` : '';
        console.log(`版本 tag: ${result.projectRelease.tag.tagName}${localSha}`);
      }
    }
    if (result.testReport) console.log(`测试报告: ${result.testReport}`);
    if (result.learningReview) {
      if (result.learningReview.skipped) {
        console.log(`复盘学习包: 已跳过 (${result.learningReview.reason})`);
      } else if (result.learningReview.ok === false) {
        console.log(`复盘学习包: 生成失败 (${result.learningReview.errors?.[0] ?? 'unknown'})`);
      } else {
        console.log(`复盘学习包: ${result.learningReview.packageId}`);
        console.log(`HTML: ${result.learningReview.packagePaths?.readerHtml ?? '无'}`);
        console.log(`题材: ${result.learningReview.genre?.label ?? '未知'}`);
        if (result.learningReview.packageMeta?.styleLabel) console.log(`子风格: ${result.learningReview.packageMeta.styleLabel}`);
        if (result.learningReview.packageMeta?.authoringStatus) console.log(`写作状态: ${result.learningReview.packageMeta.authoringStatus}`);
        if (result.learningReview.packagePaths?.agentPrompt) console.log(`Agent 写作提示: ${result.learningReview.packagePaths.agentPrompt}`);
        console.log(`已打开: ${result.learningReview.opened ? '是' : '否'}`);
      }
    }
    printKnowledgeReview(result.knowledgeReview);
    if (result.next) {
      console.log(`下一任务: ${result.next.id} ${result.next.title}`);
      if (result.next.taskHandle) console.log(`下一任务句柄: ${result.next.taskHandle}`);
    }
    if (result.projectRelease?.warnings?.length) {
      for (const warning of result.projectRelease.warnings) {
        console.log(`- ${warning}`);
      }
    }
    if (result.errors?.length) {
      for (const error of result.errors) console.log(`- ${error}`);
    }
    return;
  }

  console.log(`OpenPrd loop: ${result.action} ${result.ok ? '通过' : '失败'}`);
  if (result.changeId) console.log(`变更: ${result.changeId}`);
  if (result.summary) {
    console.log(`任务: ${result.summary.done}/${result.summary.total} 完成，${result.summary.pending} 待处理，${result.summary.failed} 失败，${result.summary.blocked} 阻塞`);
  }
  if (result.next) {
    console.log(`下一任务: ${result.next.id} ${result.next.title}`);
    if (result.next.taskHandle) console.log(`下一任务句柄: ${result.next.taskHandle}`);
  }
  if (result.files) {
    console.log(`任务清单: ${result.files.featureList}`);
  }
  if (result.errors?.length) {
    for (const error of result.errors) console.log(`- ${error}`);
  }
}

export {
  printExecutionConfirmationChecklist,
  printRunResult,
  printLoopResult,
};
