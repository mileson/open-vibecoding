/*
 * 核心功能
 * 渲染 growth 候选、自动补齐和 benchmark 推荐相关的人类可读输出。
 *
 * 输入
 * 接收 growth init/review/apply/reject 等结构化结果对象和候选元数据。
 *
 * 输出
 * 向终端输出候选状态、证据、拟写入内容和 benchmark 推荐摘要，或在 `--json` 模式下直出 JSON。
 *
 * 定位
 * 位于 CLI 表现层的 growth 输出模块，专门承接自我成长和规则固化反馈。
 *
 * 依赖
 * 仅依赖终端输出和候选字段契约。
 *
 * 维护规则
 * growth 输出要优先保留范围、置信度、采纳影响和拟写入内容，避免用户难以判断是否固化。
 */
function growthCandidateStatusLabel(status) {
  if (status === 'applied') return '已应用';
  if (status === 'rejected') return '已拒绝';
  return '待确认';
}

function growthCandidateApplyModeLabel(candidate) {
  if (candidate.applyMode === 'auto') return '自动补齐';
  if (candidate.applyMode === 'manual') return '手动采纳';
  return '未应用';
}

function growthCandidateScopeLabel(scope) {
  if (scope === 'user-local') return '当前用户本地偏好';
  if (scope === 'open-vibecoding-core') return 'Open VibeCoding 核心规则';
  return '项目共享规则';
}

function formatGrowthConfidence(confidence) {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return '未提供';
  }
  return `${Math.round(confidence * 100)}%`;
}

function describeGrowthCandidateImpact(candidate) {
  if (candidate.type === 'code-extension') {
    return `会把匹配 ${candidate.key} 的文件纳入代码文件识别，减少后续同类 dev-check 重复提醒。`;
  }
  if (candidate.type === 'exempt-path-segment') {
    return `会把路径片段 ${candidate.key} 加入代码行数规则豁免，影响对应目录下文件的 dev-check 判断。`;
  }
  if (candidate.type === 'exempt-file-pattern') {
    return `会把文件模式 ${candidate.key} 加入代码行数规则豁免，影响命中的文件。`;
  }
  if (candidate.type === 'user-preference') {
    return `会把偏好 ${candidate.key} 写入当前用户本地配置，不进入项目共享规则。`;
  }
  if (candidate.scope === 'open-vibecoding-core') {
    return '采纳后会进入 Open VibeCoding 核心规则，请确认是否值得作为跨项目默认行为。';
  }
  return `采纳后会写入${growthCandidateScopeLabel(candidate.scope)}，请确认这是否是你想要固化的范围。`;
}

function formatGrowthEvidenceItem(item = {}) {
  if (typeof item === 'string') {
    return item;
  }
  const parts = [];
  if (item.path) {
    parts.push(String(item.path));
  }
  if (item.lineCount !== null && item.lineCount !== undefined) {
    parts.push(`${item.lineCount} 行`);
  }
  if (item.reason) {
    parts.push(`原因: ${item.reason}`);
  }
  if (item.note) {
    parts.push(`说明: ${item.note}`);
  }
  return parts.length > 0 ? parts.join('；') : JSON.stringify(item);
}

function formatGrowthSuggestedPatch(patch) {
  if (!patch) {
    return '未提供';
  }
  if (typeof patch === 'string') {
    return patch;
  }
  const file = patch.file ? String(patch.file) : 'unknown-file';
  const pathText = patch.path ? String(patch.path) : 'unknown-path';
  const op = patch.op ? String(patch.op) : 'update';
  const value = patch.value === undefined ? '' : ` ${JSON.stringify(patch.value)}`;
  return `${file} -> ${pathText} ${op}${value}`.trim();
}

function printGrowthLedger(ledger) {
  if (!ledger?.summary) {
    return;
  }
  const summary = ledger.summary;
  console.log(`账本: events ${summary.eventCount ?? 0}，observe ${summary.observed}，pending ${summary.pendingObserved}，auto ${summary.autoApplied}，manual ${summary.manualApplied}，reconcile ${summary.reconciledAutoApplied}，checkpoint ${summary.completionCheckpoints ?? 0}，reject ${summary.rejected}，skip ${summary.skipped}`);
  if (summary.current) {
    console.log(`当前状态: ${summary.current.total} 个候选，${summary.current.pending} 待确认，${summary.current.applied} 已应用，${summary.current.rejected} 已拒绝`);
  }
  const skippedReasons = Object.entries(summary.skippedReasons ?? {});
  if (skippedReasons.length > 0) {
    console.log(`跳过原因: ${skippedReasons.map(([reason, count]) => `${reason}=${count}`).join('；')}`);
  }
}

function printGrowthResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'growth-init') {
    console.log('Open VibeCoding growth: 已初始化');
    console.log(`候选队列: ${result.files.candidates}`);
    printGrowthLedger(result.ledger);
    return;
  }

  console.log(`Open VibeCoding growth: ${result.ok ? '完成' : '失败'}`);
  if (result.summary) {
    console.log(`候选: ${result.summary.pending} 待确认，${result.summary.applied} 已应用，${result.summary.rejected} 已拒绝。`);
  }
  printGrowthLedger(result.ledger);
  const candidates = result.pending ?? (result.candidate ? [result.candidate] : []);
  for (const candidate of candidates) {
    console.log(`- ${candidate.id}: ${candidate.title}`);
    console.log(`  状态: ${growthCandidateStatusLabel(candidate.status)}`);
    console.log(`  作用范围: ${growthCandidateScopeLabel(candidate.scope)}`);
    if (candidate.status === 'applied') {
      console.log(`  应用方式: ${growthCandidateApplyModeLabel(candidate)}`);
    }
    console.log(`  置信度: ${formatGrowthConfidence(candidate.confidence)}`);
    if (candidate.summary) {
      console.log(`  摘要: ${candidate.summary}`);
    }
    console.log(`  采纳影响: ${describeGrowthCandidateImpact(candidate)}`);
    if ((candidate.evidence ?? []).length > 0) {
      console.log('  证据:');
      for (const evidence of candidate.evidence) {
        console.log(`    - ${formatGrowthEvidenceItem(evidence)}`);
      }
    }
    if (candidate.suggestedPatch) {
      console.log('  拟写入:');
      console.log(`    - ${formatGrowthSuggestedPatch(candidate.suggestedPatch)}`);
    }
    if (candidate.status === 'pending') {
      console.log(`  收工复盘采纳命令: open-vibecoding grow . --apply --id ${candidate.id}`);
      console.log(`  拒绝命令: open-vibecoding grow . --reject --id ${candidate.id}`);
    }
  }
  for (const change of result.changed ?? []) {
    console.log(`- 已更新: ${change}`);
  }
  const shouldSkipNextActions = candidates.some((candidate) => candidate.status === 'pending');
  for (const action of shouldSkipNextActions ? [] : (result.nextActions ?? [])) {
    console.log(`- 下一步: ${action}`);
  }
  for (const recommendation of result.benchmarkRecommendations ?? []) {
    console.log(`- Benchmark 推荐: ${recommendation.sourceKey} 最近 ${recommendation.windowDays} 天已采纳 ${recommendation.adoptedCount}/${recommendation.threshold} 次，累计 ${recommendation.totalAdoptedCount} 次；确认后运行 ${recommendation.approveCommand}`);
  }
  for (const error of result.errors ?? []) {
    console.log(`- ${error}`);
  }
}

export {
  printGrowthResult,
};
