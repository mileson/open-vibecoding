import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { IMPORT_FORMATS } from '../test-report-import.js';
import { executeTestReportPlan, RENDER_KINDS, REPORT_KINDS, writeTestReport } from '../test-report.js';
import { runE2EReport } from '../test-report-e2e.js';

export const TEST_REPORT_USAGE = [
  'open-vibecoding test-report render --kind <unit|component|api|ui|cases> --data <cases.json> --out <report.html>',
  'open-vibecoding test-report record --kind <unit|component|api|ui> --data <cases.json> --result <result.json> --out <report.html>',
  'open-vibecoding test-report import --kind unit --data <cases.json> --format <xcresult|vitest|jest|pytest> --result <artifact> --run-id <id> --out <report.html> [--root <project-dir>] [--meta <execution.json>] [--coverage <coverage-summary.json>]',
  'open-vibecoding test-report plan --data <cases.json>',
  'open-vibecoding test-report run --data <cases.json> --out <report.html> [--root <project-dir>] [--jobs <count>] [--group <id> ...]',
  'open-vibecoding test-report e2e --data <manifest.json> --out <report-directory> [--root <project-dir>] [--require-worktree] [--run <id> ...] [--setup-error <message>]',
];

async function requireLinkedWorktree(root, manifest) {
  const git = promisify(execFile);
  const location = await git('git', [
    'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel',
  ], { cwd: root }).catch(() => null);
  const [gitDir, commonDir, top] = location?.stdout.trimEnd().split('\n') ?? [];
  if (!gitDir || !commonDir || !top || await realpath(gitDir) === await realpath(commonDir)) {
    throw new Error('--require-worktree requires --root or the current directory to be inside a linked Git worktree');
  }
  const relative = path.relative(await realpath(top), await realpath(manifest));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('--require-worktree requires --data to be inside the same Git worktree as --root');
  }
}

export async function runTestReportCommand(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(TEST_REPORT_USAGE.join('\n'));
    return 0;
  }
  const [action, ...args] = argv;
  try {
    if (action === 'e2e') {
      const { values } = parseArgs({ args, options: {
        data: { type: 'string' }, out: { type: 'string' }, root: { type: 'string' },
        run: { type: 'string', multiple: true, default: [] }, 'setup-error': { type: 'string' },
        'require-worktree': { type: 'boolean', default: false },
      } });
      if (!values.data?.trim() || !values.out?.trim()) throw new Error('--data and --out are required');
      if (values['require-worktree']) await requireLinkedWorktree(values.root ?? process.cwd(), values.data);
      const result = await runE2EReport({ ...values, setupError: values['setup-error']?.trim() });
      console.log(JSON.stringify({ action, ...result }, null, 2));
      return result.ok ? 0 : 1;
    }
    if (action === 'plan' || action === 'run') {
      const running = action === 'run';
      const options = { data: { type: 'string' } };
      if (running) Object.assign(options, {
        out: { type: 'string' }, root: { type: 'string' },
        jobs: { type: 'string', default: '1' }, group: { type: 'string', multiple: true, default: [] },
      });
      const { values } = parseArgs({ args, options });
      if (!values.data?.trim()) throw new Error('--data is required');
      if (running && !values.out?.trim()) throw new Error('--out is required');
      if (running && (!/^\d+$/.test(values.jobs) || !Number.isSafeInteger(Number(values.jobs)) || Number(values.jobs) < 1)) {
        throw new Error('--jobs must be a positive integer');
      }
      const result = await executeTestReportPlan({
        ...values, jobs: Number(values.jobs), requested: values.group, dryRun: !running,
      });
      console.log(JSON.stringify({ action, ...result }, null, 2));
      return result.ok ? 0 : 1;
    }
    if (!['render', 'record', 'import'].includes(action)) throw new Error('Expected render, record or import');
    const required = ['kind', 'data', 'out'];
    if (action !== 'render') required.push('result');
    if (action === 'import') required.push('format', 'run-id');
    const optional = action === 'import' ? ['root', 'meta', 'coverage'] : [];
    const options = Object.fromEntries([...required, ...optional].map(name => [name, { type: 'string' }]));
    const { values } = parseArgs({ args, options });
    for (const key of required) {
      if (!values[key]?.trim()) throw new Error(`--${key} is required`);
    }
    const kinds = action === 'render' ? RENDER_KINDS : REPORT_KINDS;
    if (!kinds.includes(values.kind)) throw new Error(`--kind must be one of ${kinds.join(', ')}`);
    if (action === 'import' && !IMPORT_FORMATS.includes(values.format)) {
      throw new Error(`--format must be one of ${IMPORT_FORMATS.join(', ')}`);
    }
    const { 'run-id': runId, ...report } = values;
    try {
      console.log(JSON.stringify({ action, ...await writeTestReport({ ...report, runId }) }, null, 2));
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
