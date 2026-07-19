/*
 * 核心功能
 * 渲染 PRD 工作流中 synthesize、review、history、diff、next、freeze、diagram、handoff 等阶段输出。
 *
 * 输入
 * 接收版本快照、评审状态、流程建议和图表 artifact 等结构化结果对象。
 *
 * 输出
 * 向终端输出工作流摘要或 JSON，帮助用户理解当前阶段和下一步动作。
 *
 * 定位
 * 位于 CLI 表现层的工作流输出模块，负责版本化 PRD 生命周期的呈现。
 *
 * 依赖
 * 仅依赖终端输出和工作流 result 契约，不承担写入或规则计算。
 *
 * 维护规则
 * 变更评审或交接相关字段时，必须同步维护普通输出与 JSON 输出的一致性。
 */
import { formatProductTypeDisplay } from '../product-type-copy.js';

function printSynthesizeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('已整理出一版可评审的需求稿');
  console.log(`标题: ${result.snapshot.title}`);
  console.log(`产品场景: ${formatProductTypeDisplay(result.snapshot.productType, { fallback: '待确认' })}`);
  if (!result.reviewPresentationRequired && (result.reviewPath ?? result.stableReviewArtifact)) {
    console.log('评审页面: 已生成');
  }
  console.log(`已自动打开评审页面: ${result.opened ? '是' : '否'}`);
  if (result.reviewPresentationRequired) {
    console.log('评审页面: 展示信息待完善');
    console.log('后台建议: Agent 可随当前工作补齐展示文案并重新生成；这不影响当前实现。');
    const feedback = result.reviewPresentationGate?.violations ?? [];
    for (const item of feedback.slice(0, 6)) {
      const pathHint = item.jsonPath ? `${item.jsonPath}: ` : '';
      console.log(`- ${pathHint}${item.action}`);
    }
  } else if (result.reviewPath ?? result.stableReviewArtifact) {
    console.log('评审页面可用于记录反馈；没有反馈时 Agent 可按可逆默认方向继续，页面状态不影响当前实现。');
  }
}

function printReviewResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!result.ok) {
    console.log('PRD 评审状态不可用');
    for (const error of result.errors ?? []) {
      console.log(`- ${error}`);
    }
    if (result.requiredCommand) {
      console.log(`下一步: ${result.requiredCommand}`);
    }
    for (const item of (result.presentationFeedback ?? []).slice(0, 6)) {
      const pathHint = item.jsonPath ? `${item.jsonPath}: ` : '';
      console.log(`- ${pathHint}${item.action}`);
    }
    return;
  }

  console.log(`评审记录: ${result.status}`);
  console.log('评审页面: 已就绪');
  if (result.marked) {
    console.log(`状态已从 ${result.previousStatus} 更新为 ${result.status}`);
  }
  if (result.designDirection) {
    console.log(`选定交互方向: ${result.designDirection.id}（${result.designDirection.title}）`);
  }
  if (result.opened) {
    console.log('已打开评审页面');
  }
}

function printBrainstormResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('脑暴工作台已生成');
  console.log(`主题: ${result.record.topic}`);
  console.log(`推荐方向: ${result.record.summary?.recommendedDirection ?? '待补充'}`);
  console.log(`脑暴页面: ${result.htmlPath}`);
  console.log(`Markdown 数据源: ${result.markdownPath}`);
  console.log(`Capture Patch: ${result.patchPath}`);
  console.log(`状态文件: ${result.statePath}`);
  console.log(`已自动打开: ${result.opened ? '是' : '否'}`);
}

function printHistoryResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`版本历史: ${result.ws.workspaceRoot}`);
  for (const entry of result.versions) {
    console.log(`- ${entry.versionId} | ${entry.title} | ${formatProductTypeDisplay(entry.productType, { fallback: '待确认' })} | ${entry.createdAt}`);
  }
}

function printDiffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result.diff, null, 2));
    return;
  }

  console.log(`差异 ${result.diff.fromVersionId} -> ${result.diff.toVersionId}`);
  console.log(`变更章节: ${result.diff.changedSections.length > 0 ? result.diff.changedSections.join(', ') : '无'}`);
  for (const change of result.diff.changes) {
    console.log(`- ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`);
  }
}

function printNextResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { recommendation, analysis, workflow, taskGraph } = result;
  console.log(`下一步动作: ${recommendation.nextAction}`);
  if (recommendation.currentStage ?? recommendation.currentGate) {
    console.log(`当前建议: ${recommendation.currentStage ?? recommendation.currentGate}`);
  }
  if (recommendation.upcomingStage ?? recommendation.upcomingGate) {
    console.log(`后续参考: ${recommendation.upcomingStage ?? recommendation.upcomingGate}`);
  }
  console.log(`原因: ${recommendation.reason}`);
  console.log(`建议命令: ${recommendation.suggestedCommand}`);
  console.log(`完成度: ${analysis.completedRequiredFields}/${analysis.totalRequiredFields}`);
  if (taskGraph?.nextReadyNode) {
    console.log(`下一个就绪节点: ${taskGraph.nextReadyNode}`);
  }
  if (result.brainstormSuggestion?.recommended) {
    console.log(`脑暴模式建议: ${result.brainstormSuggestion.reason}`);
    console.log(`脑暴命令: ${result.brainstormSuggestion.suggestedCommand}`);
  }
  if (result.diagramState?.needed) {
    console.log(`图表建议: ${result.diagramState.shouldGateFreeze ? '建议优先查看' : '后台参考'}`);
    console.log(`建议图表: ${result.diagramState.preferredType}`);
  }
  console.log('工作流:');
  console.log(`  ${workflow.join(' -> ')}`);
  if (recommendation.suggestedQuestions.length > 0) {
    console.log('建议问题:');
    for (const question of recommendation.suggestedQuestions) {
      console.log(`- ${question}`);
    }
  }
}

function printFreezeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('这版需求已经定稿，可以进入交接准备');
  console.log(`定稿对象: ${result.snapshot.title ?? result.ws.workspaceRoot}`);
}

function printDiagramResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.snapshot) {
    console.log(`已为 ${result.snapshot.title} 生成${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  } else {
    console.log(`已更新${result.type === 'product-flow' ? '产品流程' : '架构'}图`);
  }
  console.log(`HTML: ${result.htmlPath}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Mermaid: ${result.mermaidPath}`);
  if (result.inputPath) {
    console.log(`输入 contract: ${result.inputPath}`);
  }
  if (result.marked) {
    console.log(`评审状态: ${result.marked}`);
  } else if (result.model?.metadata?.reviewStatus) {
    console.log(`评审状态: ${result.model.metadata.reviewStatus}`);
  }
  console.log(`已打开: ${result.opened ? '是' : '否'}`);
}

function printHandoffResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('交接资料已经生成');
  console.log(`交接去向: ${result.handoff.target}`);
  if (result.handoff.nextStep) {
    console.log(`建议下一步: ${result.handoff.nextStep}`);
  }
}

export {
  printBrainstormResult,
  printSynthesizeResult,
  printReviewResult,
  printHistoryResult,
  printDiffResult,
  printNextResult,
  printFreezeResult,
  printDiagramResult,
  printHandoffResult,
};
