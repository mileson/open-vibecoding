import { parseArgs } from 'node:util';
import { listAsoMarkets } from '../aso-market-catalog.js';
import { writeAsoReport } from '../aso-report.js';

const usage = [
  'open-vibecoding aso-report markets',
  'open-vibecoding aso-report template --out <template.html>',
  'open-vibecoding aso-report render --data <report.json> --out <report.html> [--template <template.html>] [--app-store-reviews <reviews.json>]…',
];

export async function runAsoReportCommand(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage.join('\n'));
    console.log('用 aso-report markets 查看地区代码。在 report.json 的 markets 中填写所选 id，可附 tables 和 sources。');
    console.log('每个评论地区传一份文件，多地区重复传 --app-store-reviews。报告仅列出有评论的地区。');
    console.log('返回 JSON 的 reviewRegions 包含每个传入地区的采集状态、评论条数和是否在报告显示。');
    console.log('在 report.json 的 collectedSources 中填写本次已采集的来源 ID。');
    return 0;
  }
  const [action, ...args] = argv;
  try {
    if (action === 'markets') {
      parseArgs({ args });
      console.log(JSON.stringify({ action, ok: true, markets: listAsoMarkets() }, null, 2));
      return 0;
    }
    if (action !== 'template' && action !== 'render') throw new Error('Expected markets, template or render');
    const options = { out: { type: 'string' } };
    if (action === 'render') {
      options.data = { type: 'string' };
      options.template = { type: 'string' };
      options['app-store-reviews'] = { type: 'string', multiple: true };
    }
    const { values } = parseArgs({ args, options });
    const required = action === 'render' ? ['out', 'data'] : ['out'];
    for (const key of required) {
      if (!values[key]?.trim()) throw new Error(`--${key} is required`);
    }
    console.log(JSON.stringify({ action, ...await writeAsoReport({ action, ...values, appStoreReviews: values['app-store-reviews'] }) }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action, error: { type: 'aso-report', message: error.message, usage } }));
    return 1;
  }
}
