/*
 * 核心功能
 * 生成提供给 Agent 集成层的 benchmark registry 摘要片段。
 *
 * 输入
 * 接收项目根目录，并读取当前 approved benchmark sources。
 *
 * 输出
 * 导出 Project Benchmark Registry Markdown section，供技能模板和上下文拼装复用。
 *
 * 定位
 * 位于 benchmark 展示适配层，连接 storage 读取结果与 agent-facing 文本输出。
 *
 * 依赖
 * 依赖 storage 提供的 workspace 初始化与 approved source 读取能力。
 *
 * 维护规则
 * 文案必须保持面向 Agent 使用场景，避免把 candidate 当成已确认事实来源写入摘要。
 */
import { ensureBenchmarkWorkspace, loadApprovedSources } from './storage.js';

async function renderApprovedBenchmarkRegistrySection(projectRoot) {
  await ensureBenchmarkWorkspace(projectRoot);
  const approved = await loadApprovedSources(projectRoot);
  if (approved.length === 0) {
    return [
      '## Project Benchmark Registry',
      '',
      '- 当前项目还没有 approved benchmark source。',
      '- 如需补充，用 `open-vibecoding benchmark add <url|repo|file>` 添加 candidate，再用 `open-vibecoding benchmark approve <id>` 纳入项目级 registry。',
      '- 被用户采纳过的外部信源可用 `open-vibecoding benchmark observe <url|repo|file> --notes <text>` 累计证据；达到阈值后仍需要用户确认 approve。',
      '- Agent 仍应先读取 `.open-vibecoding/benchmarks/index.md` 和 `.open-vibecoding/benchmarks/sources.yaml`，但 candidate inbox 不能当成长期事实来源。',
      '',
    ].join('\n');
  }

  const lines = [
    '## Project Benchmark Registry',
    '',
    '- 先读取 `.open-vibecoding/benchmarks/index.md` 和 `.open-vibecoding/benchmarks/sources.yaml`。',
    '- 项目级 approved benchmark 优先于 Open VibeCoding 内置 Source Map；`inbox/` candidate 只能作为待确认线索。',
    '- `benchmark observe` 只累计被采纳信源的证据；达到阈值后仍需用户确认 approve。',
    '- 每次最多优先挑 1-3 个与当前任务最相关的 approved source。',
    '',
    '### Approved Sources',
    '',
  ];

  for (const source of approved.slice(0, 20)) {
    const location = source.repo ? `${source.repo} (${source.url})` : (source.url ?? source.path ?? 'unknown');
    lines.push(`- \`${source.id}\` ${source.title}`);
    lines.push(`  - 场景: ${source.scenarios.join(', ') || '未分类'}`);
    lines.push(`  - 触发: ${source.triggerWhen.join('；') || '待补充'}`);
    lines.push(`  - 不适用: ${source.notFor.join('；') || '待补充'}`);
    lines.push(`  - 研究方式: ${source.researchMethod}`);
    lines.push(`  - 来源: ${location}`);
  }
  lines.push('');
  return lines.join('\n');
}

export {
  renderApprovedBenchmarkRegistrySection,
};
