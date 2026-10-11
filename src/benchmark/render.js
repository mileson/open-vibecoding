/*
 * 核心功能
 * 负责 benchmark registry、source card 和 evidence 文本渲染。
 *
 * 输入
 * 接收已经归一化的 approved/candidate source 数据。
 *
 * 输出
 * 导出 index.md 和 evidence.md 所需的稳定 Markdown 片段。
 *
 * 定位
 * 位于 benchmark 展示层，只做字符串组装，不参与 IO、校验或业务状态变更。
 *
 * 依赖
 * 无外部业务依赖；由 storage、operations 和 registry 复用。
 *
 * 维护规则
 * 修改渲染文案时必须保持现有字段含义不变，避免影响生成 skill、CLI 输出和历史 benchmark 文件阅读。
 */
function renderSourceCard(source) {
  const location = source.url ?? source.path ?? 'unknown';
  const scenarios = source.scenarios.length > 0 ? source.scenarios.join(', ') : '未分类';
  const triggerWhen = source.triggerWhen.length > 0 ? source.triggerWhen.join('；') : '待补充';
  const notFor = source.notFor.length > 0 ? source.notFor.join('；') : '待补充';
  const lines = [
    `### ${source.title} \`${source.id}\``,
    '',
    `- 状态: ${source.status}`,
    `- 来源类型: ${source.sourceType}`,
    `- 场景: ${scenarios}`,
    `- 触发: ${triggerWhen}`,
    `- 不适用: ${notFor}`,
    `- 研究方式: ${source.researchMethod}`,
    `- 来源: ${location}`,
    `- 规范化信源: ${source.sourceKey ?? source.id}`,
    `- 最近 ${source.promotion.windowDays} 天采纳: ${source.recentAdoptedCount}`,
    `- 累计采纳: ${source.adoptedCount}`,
  ];
  if (source.lastUsedAt) {
    lines.push(`- 最近采纳时间: ${source.lastUsedAt}`);
  }
  if (source.promotion?.recommended) {
    lines.push(`- 推荐: 最近 ${source.promotion.windowDays} 天已达到 ${source.recentAdoptedCount}/${source.promotion.threshold} 次采纳，建议确认后运行 \`${source.promotion.approveCommand}\``);
  }
  if (source.note) {
    lines.push(`- 备注: ${source.note}`);
  }
  if (source.value) {
    lines.push(`- 价值: ${source.value}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderBenchmarkIndex(approved, candidates) {
  const lines = [
    '# Open VibeCoding Benchmark Registry',
    '',
    '## 规则',
    '',
    '- 项目级 approved benchmark 优先于 Open VibeCoding 内置 Source Map。',
    '- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。',
    '- 被采纳信源先累计证据，达到阈值后只推荐 approve，不自动晋级。',
    '- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。',
    '',
    '## Approved Sources',
    '',
  ];
  if (approved.length === 0) {
    lines.push('- 暂无已批准来源。', '');
  } else {
    for (const source of approved) {
      lines.push(renderSourceCard(source));
    }
  }

  lines.push('## Candidate Sources', '');
  if (candidates.length === 0) {
    lines.push('- 暂无待确认来源。', '');
  } else {
    for (const source of candidates) {
      lines.push(renderSourceCard(source));
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderEvidence(source) {
  return [
    `# ${source.title}`,
    '',
    `- ID: ${source.id}`,
    `- 状态: ${source.status}`,
    `- 场景: ${source.scenarios.join(', ') || '未分类'}`,
    `- 触发: ${source.triggerWhen.join('；') || '待补充'}`,
    `- 不适用: ${source.notFor.join('；') || '待补充'}`,
    `- 研究方式: ${source.researchMethod}`,
    `- 来源: ${source.url ?? source.path ?? 'unknown'}`,
    `- 规范化信源: ${source.sourceKey ?? source.id}`,
    `- 最近 ${source.promotion.windowDays} 天采纳: ${source.recentAdoptedCount}`,
    `- 累计采纳: ${source.adoptedCount}`,
    source.lastUsedAt ? `- 最近采纳时间: ${source.lastUsedAt}` : null,
    source.promotion?.recommended ? `- 推荐命令: ${source.promotion.approveCommand}` : null,
    '',
    '## 备注',
    '',
    source.note ?? '待补充',
    '',
  ].filter((line) => line !== null).join('\n');
}

export {
  renderBenchmarkIndex,
  renderEvidence,
};
