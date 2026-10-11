/*
 * 核心功能
 * 渲染 run 验证和 hook 记录的人类可读输出或 JSON 输出。
 *
 * 输入
 * 接收 run verify 与 hook 记录的结构化结果对象。
 *
 * 输出
 * 向终端输出工作区验证、任务级提醒和知识回顾摘要。
 *
 * 定位
 * 位于 CLI 表现层的运行验证输出模块。
 *
 * 依赖
 * 依赖 shared-print 与 doctor-print 提供的复用 helper，不承担实际执行。
 *
 * 维护规则
 * 验证输出要区分任务态和工作区态；不生成用户授权门槛。
 */
import { printKnowledgeReview } from './shared-print.js';


function printRunResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'run-record-hook') {
    console.log(`Open VibeCoding run hook 已记录: ${result.event.eventName} -> ${result.event.outcome}`);
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
    console.log(`Open VibeCoding run verify: ${status}`);
    if (result.readiness) {
      console.log(`任务就绪: ${taskReady ? '是' : '否'}`);
      console.log(`工作区就绪: ${workspaceReady ? '是' : '否'}`);
      console.log(`整体就绪可声明: ${result.readiness.claimReady !== false ? '是' : '否'}`);
      console.log(`当前动作可继续: ${result.readiness.actionReady !== false ? '是' : '否'}`);
    }
    for (const check of result.checks) {
      const scope = check.scope === 'workspace' ? '工作区' : '任务';
      console.log(`- ${check.ok ? '通过' : '失败'}: ${check.name} [${scope}]`);
    }
    if (workspaceAttention?.summary) {
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

  console.log('Open VibeCoding run: 不支持该模式');
  for (const error of result.errors ?? []) console.log(`- ${error}`);
}


export {
  printRunResult,
};
