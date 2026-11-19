import { parseArgs } from 'node:util';
import { writeCodeQualityReport } from '../code-quality-report.js';

const usage = 'open-vibecoding code-quality-report render --data <report.json> --out <report.html>';

export async function runCodeQualityReportCommand(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    return 0;
  }

  const [action, ...args] = argv;
  let options;
  try {
    if (action !== 'render') throw new Error('Expected render');
    ({ values: options } = parseArgs({
      args, options: { data: { type: 'string' }, out: { type: 'string' } },
    }));
    for (const key of ['data', 'out']) {
      if (!options[key]?.trim()) throw new Error(`--${key} is required`);
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: { type: 'usage', message: error.message, usage } }));
    return 1;
  }

  try {
    console.log(JSON.stringify({ action, ...await writeCodeQualityReport(options) }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action, error: { type: 'code-quality-report', message: error.message } }));
    return 1;
  }
}
