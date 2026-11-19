import { parseArgs } from 'node:util';
import { writeFunnelReport } from '../funnel-report.js';

const usage = [
  'open-vibecoding funnel-report template --out <template.html>',
  'open-vibecoding funnel-report render --data <report.json> --out <report.html> [--template <template.html>]',
];

export async function runFunnelReportCommand(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage.join('\n'));
    console.log('先展示总结与关键指标，再按 cards 组合流程漏斗、趋势、分组对照和同期群留存。顶层 steps、groups 及纯指标输入仍可用。');
    console.log('提醒放在 summary 中。提供 dateRange.start 和 dateRange.end 时，页首右侧仅显示日期。');
    console.log('默认使用内置模板。漏斗步骤主数字为蓝色，流失注释保持中性。');
    console.log('趋势刻度取自 dates、series[].values 和 unit。保留横向网格，左侧无竖线。实线下方带同色渐变，缺失区间用无填充虚线，表格显示「—」。');
    console.log('前五条趋势序列按位置依次为粉红、蓝、炭黑、紫、金黄。');
    return 0;
  }
  const [action, ...args] = argv;
  try {
    if (action !== 'template' && action !== 'render') throw new Error('Expected template or render');
    const options = { out: { type: 'string' } };
    if (action === 'render') {
      options.data = { type: 'string' };
      options.template = { type: 'string' };
    }
    const { values } = parseArgs({ args, options });
    for (const key of action === 'render' ? ['out', 'data'] : ['out']) {
      if (!values[key]?.trim()) throw new Error(`--${key} is required`);
    }
    console.log(JSON.stringify({ action, ...await writeFunnelReport({ action, ...values }) }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action, error: { type: 'funnel-report', message: error.message, usage } }));
    return 1;
  }
}
