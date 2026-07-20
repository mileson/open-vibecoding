/*
 * 核心功能
 * 渲染 run / loop 相关命令的人类可读输出或 JSON 输出。
 *
 * 输入
 * 接收 run context、run verify、loop prompt/run/finish 等结构化结果对象。
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
 * run/loop 输出字段变更时要保持任务态与验证态的展示顺序稳定；OpenPrd 不生成用户授权门槛。
 */
import { printCodexRuntimeResult } from './doctor-print.js';
import { printKnowledgeReview } from './shared-print.js';

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
      console.log(`整体就绪可声明: ${result.readiness.claimReady !== false ? '是' : '否'}`);
      console.log(`当前动作可继续: ${result.readiness.actionReady !== false ? '是' : '否'}`);
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

  console.log('OpenPrd run: 不支持该模式');
  for (const error of result.errors ?? []) console.log(`- ${error}`);
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
  printRunResult,
  printLoopResult,
};
