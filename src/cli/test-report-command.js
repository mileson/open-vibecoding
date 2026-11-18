import { parseArgs } from 'node:util';
import { REPORT_KINDS, writeTestReport } from '../test-report.js';

export const TEST_REPORT_USAGE = [
  'open-vibecoding test-report render --kind <unit|component|api|ui> --data <cases.json> --out <report.html>',
  'open-vibecoding test-report record --kind <unit|component|api|ui> --data <cases.json> --result <result.json> --out <report.html>',
];

export async function runTestReportCommand(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(TEST_REPORT_USAGE.join('\n'));
    return 0;
  }
  const [action, ...args] = argv;
  try {
    if (action !== 'render' && action !== 'record') throw new Error('Expected render or record');
    const options = { kind: { type: 'string' }, data: { type: 'string' }, out: { type: 'string' } };
    if (action === 'record') options.result = { type: 'string' };
    const { values } = parseArgs({ args, options });
    for (const key of Object.keys(options)) {
      if (!values[key]?.trim()) throw new Error(`--${key} is required`);
    }
    if (!REPORT_KINDS.includes(values.kind)) throw new Error(`--kind must be one of ${REPORT_KINDS.join(', ')}`);
    try {
      console.log(JSON.stringify({ action, ...await writeTestReport(values) }, null, 2));
      return 0;
    } catch (error) {
      console.error(JSON.stringify({ ok: false, action, error: { type: 'test-report', message: error.message } }));
      return 1;
    }
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: { type: 'usage', message: error.message, usage: TEST_REPORT_USAGE } }));
    return 1;
  }
}
