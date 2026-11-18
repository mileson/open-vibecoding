import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { executeTestCommand } from './test-report-run.js';

const scriptTypes = { '.sh': 'bash', '.js': process.execPath, '.mjs': process.execPath };
const contained = (root, file) => {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && Boolean(value.trim());

export function validateDataPreparation(spec, runId) {
  const prefix = runId + '.dataPreparation';
  if (!plainObject(spec) || !nonempty(spec.label) || !Array.isArray(spec.checks) || !spec.checks.length ||
      (spec.timeoutMs !== undefined && (!Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs <= 0))) {
    throw new Error(prefix + ': expected label, scripts and nonempty checks');
  }
  for (const stage of ['prepare', 'verify']) {
    const file = spec[stage];
    if (!nonempty(file) || path.isAbsolute(file) || path.win32.isAbsolute(file) ||
        file.split(/[\\/]/).includes('..') || !Object.hasOwn(scriptTypes, path.extname(file))) {
      throw new Error(prefix + '.' + stage + ': expected a project-relative .sh, .js or .mjs script');
    }
  }
  const ids = new Set();
  for (const check of spec.checks) {
    if (!plainObject(check) || !nonempty(check.id) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(check.id) ||
        ids.has(check.id) || !nonempty(check.title) || !Object.hasOwn(check, 'expected')) {
      throw new Error(prefix + ': invalid or duplicate check ' + check?.id);
    }
    ids.add(check.id);
  }
}

async function executeStage(stage, spec, { directory, root, env }) {
  const log = await fs.open(path.join(directory, stage + '.log'), 'wx');
  try {
    const script = await fs.realpath(path.resolve(root, spec[stage]));
    if (!contained(root, script) || !(await fs.stat(script)).isFile()) {
      throw new Error('准备或校验脚本必须是项目根目录内的文件');
    }
    const command = scriptTypes[path.extname(spec[stage])];
    const { code, signal } = await executeTestCommand(command, [script], root, log, spec.timeoutMs ?? 60_000, env);
    if (code !== 0 || signal) throw new Error(signal ? '脚本已中断 · ' + signal : '脚本退出码 ' + code);
  } catch (error) {
    await log.appendFile(error.message + '\n');
    throw error;
  } finally {
    await log.close();
  }
}

export async function prepareRunData(spec, context) {
  const { directory, env } = context;
  const root = await fs.realpath(context.root);
  const scoped = { ...context, root, env };
  const report = { label: spec.label, status: 'prepare_failed', checks: [] };
  try {
    await executeStage('prepare', spec, scoped);
    report.status = 'verify_failed';
    await executeStage('verify', spec, scoped);
    const actual = JSON.parse(await fs.readFile(env.OVC_E2E_DATA_OBSERVATIONS, 'utf8'));
    if (!plainObject(actual)) throw new Error('校验脚本须输出以检查项 ID 为键的观测值对象');
    report.checks = spec.checks.map(({ id, title, expected }) => {
      const found = Object.hasOwn(actual, id);
      const status = found ? (isDeepStrictEqual(actual[id], expected) ? 'passed' : 'mismatch') : 'missing';
      return { id, title, expected, actual: found ? actual[id] : null, status };
    });
    const failed = report.checks.filter(check => check.status !== 'passed');
    if (failed.length) throw new Error('初始状态与预期不一致 · ' + failed.map(check => check.title).join('、'));
    report.status = 'passed';
  } catch (error) {
    report.error = error.message;
  }
  return report;
}
