/*
 * 核心功能
 * 渲染 benchmark 子命令的人类可读输出或 JSON 输出。
 *
 * 输入
 * 接收 benchmark add/observe/approve/list/verify 的结构化结果对象。
 *
 * 输出
 * 向终端输出 benchmark registry、推荐与校验结论，或在 `--json` 模式下直出 JSON。
 *
 * 定位
 * 位于 CLI 表现层的 benchmark 专属输出模块，避免继续扩大通用 print.js。
 *
 * 依赖
 * 仅依赖终端输出和 benchmark result 字段契约。
 *
 * 维护规则
 * benchmark 输出变更应优先在此处扩展，不回填到通用 barrel 文件。
 */
function printBenchmarkResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.action === 'benchmark-add') {
    console.log(`Open VibeCoding benchmark add: ${result.ok ? '已加入 candidate' : '失败'}`);
    if (result.source) {
      console.log(`ID: ${result.source.id}`);
      console.log(`标题: ${result.source.title}`);
      console.log(`来源: ${result.source.url ?? result.source.path ?? 'unknown'}`);
      console.log(`场景: ${result.source.scenarios.join(', ') || '未分类'}`);
    }
    if (result.error) {
      console.log(`错误: ${result.error}`);
    }
    return;
  }

  if (result.action === 'benchmark-observe') {
    console.log(`Open VibeCoding benchmark observe: ${result.created ? '已创建 candidate' : '已更新 candidate'}`);
    console.log(`ID: ${result.source.id}`);
    console.log(`标题: ${result.source.title}`);
    console.log(`来源: ${result.source.url ?? result.source.path ?? 'unknown'}`);
    console.log(`规范化信源: ${result.source.sourceKey ?? result.source.id}`);
    console.log(`最近 ${result.source.promotion.windowDays} 天采纳: ${result.source.recentAdoptedCount}/${result.source.promotion.threshold}`);
    console.log(`累计采纳: ${result.source.adoptedCount}`);
    if (result.recommended) {
      console.log(`推荐: 已达到阈值，确认后运行 ${result.recommendation.approveCommand}`);
    }
    return;
  }

  if (result.action === 'benchmark-approve') {
    console.log('Open VibeCoding benchmark approve: 已加入 approved registry');
    console.log(`ID: ${result.source.id}`);
    console.log(`标题: ${result.source.title}`);
    console.log(`已批准来源: ${result.counts.approved}`);
    console.log(`待确认来源: ${result.counts.candidates}`);
    return;
  }

  if (result.action === 'benchmark-verify') {
    console.log(`Open VibeCoding benchmark verify: ${result.ok ? '通过' : '失败'}`);
    for (const check of result.checks) {
      console.log(`- ${check.ok ? '通过' : '失败'}: ${check.id}`);
      for (const issue of check.issues) {
        console.log(`  ${issue.level === 'error' ? '错误' : '警告'}: ${issue.message}`);
      }
    }
    return;
  }

  console.log(`Open VibeCoding benchmark list: approved ${result.counts.approved}, candidate ${result.counts.candidates}`);
  for (const source of result.approved) {
    console.log(`- approved ${source.id}: ${source.title}`);
  }
  for (const source of result.candidates) {
    console.log(`- candidate ${source.id}: ${source.title}`);
    if (source.promotion?.recommended) {
      console.log(`  推荐: 最近 ${source.promotion.windowDays} 天已采纳 ${source.recentAdoptedCount}/${source.promotion.threshold} 次；确认后运行 ${source.promotion.approveCommand}`);
    }
  }
  for (const recommendation of result.recommendations ?? []) {
    console.log(`- 推荐纳入 benchmark: ${recommendation.sourceKey}，最近 ${recommendation.windowDays} 天 ${recommendation.adoptedCount}/${recommendation.threshold} 次，累计 ${recommendation.totalAdoptedCount} 次；命令: ${recommendation.approveCommand}`);
  }
}

export {
  printBenchmarkResult,
};
