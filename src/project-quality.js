import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { atomicWriteJson, atomicWriteText, readJsonIfExists, withFileLock } from './kernel/atomic-store.js';
import { executeTestCommand } from './test-report-run.js';

const gitCommand = promisify(execFile);
const settingsFile = 'open-vibecoding.quality.json';
const indexFile = '.open-vibecoding/quality/project-index.json';
const skillFile = '.open-vibecoding/quality/SKILL.md';
const skillMarker = '<!-- OPEN_VIBECODING:PROJECT_QUALITY -->';
const runsDir = '.open-vibecoding/artifacts/project-quality';
const profiles = ['precommit', 'pr'];
const excluded = new Set(['node_modules', 'vendor', 'dist', 'build', 'coverage', '__pycache__', 'venv']);
const sourceFiles = ['package.json', 'pyproject.toml', 'requirements.txt', 'Makefile', 'Package.swift', 'pytest.ini'];
const controlFiles = new Set([settingsFile, 'AGENTS.md', '.pre-commit-config.yaml', '.pre-commit-config.yml']);
const docFiles = ['README.md', 'README_CN.md', 'PRD.md', 'docs'];

async function git(root, ...args) {
  const { stdout } = await gitCommand('git', args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

async function readText(file) {
  return fs.readFile(file, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
}

async function entries(folder) {
  return fs.readdir(folder, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

function containedPath(relative, field) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) ||
      relative.includes('\\') || relative.split('/').includes('..')) {
    throw new Error(field + ' must be a project-relative path');
  }
  return relative;
}

function affects(check, files) {
  return !files || !check.paths?.length || files.some(file =>
    controlFiles.has(file) || file.startsWith('.github/workflows/') || check.paths.some(scope => scope === '.' || file === scope || file.startsWith(scope + '/')));
}

const scripts = {
  lint: 'static', 'format:check': 'static', typecheck: 'type', 'type-check': 'type',
  test: 'test', 'test:unit': 'test', 'test:integration': 'integration', 'test:e2e': 'e2e',
  build: 'build',
};

async function discover(root) {
  const modules = [];
  const checks = [];
  const documents = [];
  async function visit(relative, depth) {
    const children = await entries(path.join(root, relative));
    const names = new Set(children.map(child => child.name));
    const sources = sourceFiles.filter(file => names.has(file));
    for (const name of docFiles.filter(file => names.has(file))) documents.push(path.posix.join(relative, name));
    const ecosystems = [];
    if (sources.includes('package.json')) ecosystems.push('javascript');
    if (sources.some(file => file === 'pyproject.toml' || file === 'requirements.txt')) ecosystems.push('python');
    if (sources.includes('Package.swift') || children.some(child => /\.xcodeproj$/.test(child.name))) ecosystems.push('swift');
    if (ecosystems.length) modules.push({ path: relative, ecosystems, sources });
    const add = (name, layer, argv, source) => checks.push({
      id: relative + ':' + name, module: relative, layer, argv, source: path.posix.join(relative, source),
      paths: relative === '.' ? [] : [relative],
    });
    if (ecosystems.includes('javascript')) {
      const pkg = await readJsonIfExists(path.join(root, relative, 'package.json'), {});
      const manager = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? '')?.[1] ??
        (names.has('pnpm-lock.yaml') ? 'pnpm' : names.has('yarn.lock') ? 'yarn' : 'npm');
      for (const [name, layer] of Object.entries(scripts)) {
        if (typeof pkg.scripts?.[name] === 'string' && pkg.scripts[name].trim()) {
          add('js:' + name, layer, [manager, 'run', name], 'package.json');
        }
      }
    }
    if (ecosystems.includes('python')) {
      const make = await readText(path.join(root, relative, 'Makefile'));
      const pyproject = await readText(path.join(root, relative, 'pyproject.toml'));
      if (/^lint:/m.test(make)) add('py:lint', 'static', ['make', 'lint'], 'Makefile');
      else if (/^\[tool\.ruff(?:\]|\.)/m.test(pyproject) || ['ruff.toml', '.ruff.toml'].some(file => names.has(file))) {
        const source = ['ruff.toml', '.ruff.toml'].find(file => names.has(file)) ?? 'pyproject.toml';
        add('py:lint', 'static', ['python3', '-m', 'ruff', 'check', '.'], source);
      }
      if (/^test:/m.test(make)) add('py:test', 'test', ['make', 'test'], 'Makefile');
      else if (names.has('pytest.ini') || /^\[tool\.pytest(?:\]|\.)/m.test(pyproject)) {
        const source = names.has('pytest.ini') ? 'pytest.ini' : 'pyproject.toml';
        add('py:test', 'test', ['python3', '-m', 'pytest'], source);
      }
    }
    if (depth < 4) {
      for (const child of children) {
        if (child.isDirectory() && !child.name.startsWith('.') &&
            !excluded.has(child.name) && !['test', 'tests', 'fixtures', 'assets'].includes(child.name)) {
          await visit(path.posix.join(relative, child.name), depth + 1);
        }
      }
    }
  }
  await visit('.', 0);
  return { modules, checks, documents };
}

async function loadInventory(root) {
  const { modules, checks, documents } = await discover(root);
  const config = await readJsonIfExists(path.join(root, settingsFile), null);
  if (config !== null && (config.version !== 1 || !Array.isArray(config.checks ?? []) ||
      !Array.isArray(config.rules ?? []))) throw new Error(settingsFile + ' requires version 1 and check/rule arrays');

  const registry = new Map(checks.map(check => [check.id, check]));
  const declared = new Set();
  for (const check of config?.checks ?? []) {
    if (!check || typeof check.id !== 'string' || !/^[\w.][\w./:-]*$/.test(check.id) ||
        declared.has(check.id) || !Array.isArray(check.argv) || !check.argv.length ||
        check.argv.some(arg => typeof arg !== 'string' || !arg) ||
        !Array.isArray(check.paths ?? []) || !Array.isArray(check.required ?? []) ||
        (check.required ?? []).some(profile => !profiles.includes(profile)) ||
        (check.timeoutMs !== undefined && (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs <= 0))) {
      throw new Error('Invalid or duplicate project check: ' + check?.id);
    }
    declared.add(check.id);
    const module = containedPath(check.module ?? '.', check.id + ' module');
    const paths = (check.paths ?? []).map(scope => containedPath(scope, check.id + ' paths'));
    const reportRuns = check.reportRuns;
    if (reportRuns !== undefined && (!Array.isArray(reportRuns) || !reportRuns.length ||
        reportRuns.some(run => typeof run !== 'string' || !run) || new Set(reportRuns).size !== reportRuns.length)) {
      throw new Error('Invalid E2E reportRuns for ' + check.id);
    }
    registry.set(check.id, {
      id: check.id, module, paths, argv: check.argv, layer: check.layer ?? 'test', source: settingsFile,
      required: check.required ?? [], timeoutMs: check.timeoutMs, reportRuns,
    });
  }
  const rules = config?.rules ?? [];
  const ruleIds = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.id || ruleIds.has(rule.id) ||
        typeof rule.title !== 'string' || !rule.title || typeof rule.source !== 'string' ||
        !Array.isArray(rule.cases) || !rule.cases.length || rule.cases.some(item =>
          !item || typeof item.id !== 'string' || !item.id || !Array.isArray(item.checks) ||
          !item.checks.length || item.checks.some(id => !registry.has(id)))) {
      throw new Error('Invalid business rule or unresolved check: ' + rule?.id);
    }
    ruleIds.add(rule.id);
  }
  const hook = async () => {
    const absolute = (await git(root, 'rev-parse', '--path-format=absolute', '--git-path', 'hooks/pre-commit')).trim();
    return fs.access(absolute).then(() => absolute, () => null);
  };
  const hooks = { precommit: await hook().catch(() => null), configs: [] };
  for (const file of ['.pre-commit-config.yaml', '.pre-commit-config.yml', '.husky/pre-commit', 'lefthook.yml']) {
    if (await fs.access(path.join(root, file)).then(() => true, () => false)) hooks.configs.push(file);
  }
  const ci = (await entries(path.join(root, '.github/workflows')))
    .filter(entry => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map(entry => '.github/workflows/' + entry.name).sort();
  const advice = modules.flatMap(module => ['static', 'test']
    .filter(layer => ![...registry.values()].some(check => check.module === module.path && check.layer === layer))
    .map(layer => ({ module: module.path, layer, action: layer === 'static'
      ? 'Locate the existing linter or format check for this module and register its command.'
      : 'Locate the existing module test command or register a focused test for a documented business rule.' })));
  if (!hooks.precommit && !hooks.configs.length) advice.push({
    layer: 'precommit', action: 'Register a fast precommit profile and add its run command to a project-approved hook.',
  });
  return { version: 1, modules, documents, hooks, ci, rules, checks: [...registry.values()], advice };
}

async function recentEvidence(root) {
  const latest = Object.create(null);
  const latestExecuted = Object.create(null);
  const runEntries = await entries(path.join(root, runsDir));
  for (const run of runEntries.filter(entry => entry.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const files = await entries(path.join(root, runsDir, run.name));
    for (const file of files.filter(entry => entry.isFile() && /^\d+\.json$/.test(entry.name))) {
      const relative = path.posix.join(runsDir, run.name, file.name);
      const record = await readJsonIfExists(path.join(root, relative));
      if (!record) continue;
      const { checkId, status, finishedAt, ci, evidence } = record;
      const summary = { status, finishedAt, record: relative, ...(evidence && { evidence }), ...(ci && { ci }) };
      if ((latest[checkId]?.finishedAt ?? '') <= finishedAt) latest[checkId] = summary;
      if (status !== 'skipped' && (latestExecuted[checkId]?.finishedAt ?? '') <= finishedAt) {
        latestExecuted[checkId] = summary;
      }
    }
  }
  return { latest, latestExecuted };
}

async function writeIndex(root) {
  const destination = path.join(root, indexFile);
  return withFileLock(destination + '.lock', async () => {
    const inventory = await loadInventory(root);
    const evidence = await recentEvidence(root);
    const value = { ...inventory, ...evidence };
    const prior = await readJsonIfExists(destination);
    if (JSON.stringify(prior) !== JSON.stringify(value)) await atomicWriteJson(destination, value);
    return value;
  });
}

export async function initProjectQuality(root) {
  const skill = [
    '---', 'name: project-quality',
    'description: 根据本项目的业务规则、改动范围和风险选择并执行质量检查。', '---',
    '', skillMarker, '', '# 项目质量检查', '',
    '从项目根目录读取 `' + indexFile + '`。按业务任务查 rules，查看规则来源、用例 ID 和对应检查。按实际改动选择 checks，联系调用方和涉及的模块一起验证。',
    '索引缺失或改过项目配置时，使用 AGENTS.md 登记的 CLI 执行 `project-quality refresh --root .`。检查定义可在项目的 `' + settingsFile + '` 中增量维护。',
    '查到相关检查后执行 `project-quality run --root . --check <id>`，可重复传入 `--check`。查看返回记录及 index 中 latestExecuted 和 CI 链接。实际证据在记录目录，历史失败有独立记录。',
    '本地提交前沿用已有 hook，可接入 `project-quality run --root . --profile precommit`。合并候选执行 `project-quality run --root . --profile pr`，项目确认可按改动缩小范围时传 `--base <sha>`。失败、阻塞和漏跑的必过项会返回非零。',
    '按项目已有环境准备依赖，先解决环境阻塞。发现漏测或可复用经验，按 `open-vibecoding-experience-reuse` 的既有经验候选和项目评审流程处理，核验通过后更新规则或检查。',
    '',
  ].join('\n');
  const index = await writeIndex(root);
  const destination = path.join(root, skillFile);
  const previous = await readText(destination);
  if ((!previous || previous.includes(skillMarker)) && previous !== skill) {
    await atomicWriteText(destination, skill);
  }
  return { index: indexFile, skill: skillFile, modules: index.modules.length, checks: index.checks.length };
}

async function snapshot(root) {
  const commit = await git(root, 'rev-parse', '--verify', 'HEAD').then(value => value.trim(), () => null);
  const digest = value => createHash('sha256').update(value).digest('hex');
  try {
    const [index, worktree, staged, untracked] = await Promise.all([
      git(root, 'ls-files', '--stage', '-z'),
      git(root, 'diff', '--no-ext-diff', '--binary'),
      git(root, 'diff', '--cached', '--no-ext-diff', '--name-only', '-z'),
      git(root, 'ls-files', '--others', '--exclude-standard', '-z'),
    ]);
    return { commit, stagedSnapshot: digest(index), stagedTracked: Boolean(staged), unstagedTracked: Boolean(worktree),
      worktreeDiff: worktree ? digest(worktree) : null,
      untrackedFiles: untracked.split('\0').filter(Boolean).length };
  } catch (error) {
    if (error.stderr?.includes('not a git repository')) return { commit, stagedSnapshot: null };
    throw error;
  }
}

async function pathsChanged(root, profile, base, before) {
  if (base) {
    if (!/^[a-f0-9]{7,64}$/i.test(base) || !before.commit) throw new Error('--base requires a Git commit SHA');
    const { stdout } = await gitCommand('git', ['diff', '--no-renames', '--name-only', '-z', base, before.commit, '--'], { cwd: root });
    if (before.unstagedTracked || before.stagedTracked) {
      throw new Error('--base requires a clean tracked checkout of the candidate');
    }
    return stdout.split('\0').filter(Boolean);
  }
  if (profile === 'precommit' && before.stagedSnapshot) {
    return (await git(root, 'diff', '--no-renames', '--cached', '--name-only', '-z')).split('\0').filter(Boolean);
  }
  return null;
}

async function pathsOutsideIndex(root) {
  const unstaged = await git(root, 'diff', '--no-renames', '--name-only', '-z');
  const untracked = await git(root, 'ls-files', '--others', '--exclude-standard', '-z');
  return (unstaged + untracked).split('\0').filter(Boolean);
}

function ciContext() {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_EVENT_NAME, GITHUB_REF_NAME } = process.env;
  if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) return null;
  const repository = GITHUB_SERVER_URL + '/' + GITHUB_REPOSITORY;
  const pull = /^(\d+)\/merge$/.exec(GITHUB_REF_NAME ?? '');
  return { run: repository + '/actions/runs/' + GITHUB_RUN_ID, event: GITHUB_EVENT_NAME,
    ...(pull && { pr: repository + '/pull/' + pull[1] }) };
}

async function e2eEvidence(root, evidence, expectedRuns) {
  const resultPath = path.posix.join(evidence, 'results.json');
  const report = await readJsonIfExists(path.join(root, resultPath));
  if (!Array.isArray(report?.runs)) {
    return { status: 'blocked', reason: 'The E2E runner did not produce results.json.' };
  }
  const runs = expectedRuns.map(id => {
    const matches = report.runs.filter(run => run.id === id);
    return matches.length === 1
      ? { id, status: matches[0].status, environment: matches[0].environment }
      : { id, status: 'missing' };
  });
  const accepted = ['passed', 'passed_on_retry'];
  const incomplete = runs.find(run => !['assertion_failed', ...accepted].includes(run.status));
  const failed = runs.find(run => run.status === 'assertion_failed');
  const links = { result: resultPath, html: path.posix.join(evidence, 'index.html'), runs };
  if (incomplete) return { status: 'blocked', reason: incomplete.id + ' reported ' + incomplete.status, links };
  if (failed) return { status: 'failed', reason: failed.id + ' reported a failed assertion.', links };
  return { status: 'passed', reason: null, links };
}

async function runChecks(root, values) {
  const inventory = await loadInventory(root);
  const profile = values.profile;
  if (profile && !profiles.includes(profile)) throw new Error('Unknown profile: ' + profile);
  if (!profile && !values.check?.length) throw new Error('Select --check or --profile');
  if (values.expect?.length && !profile) throw new Error('--expect requires --profile');
  if (values.base && profile !== 'pr') throw new Error('--base requires --profile pr');

  const available = profile ? inventory.checks.filter(check => check.required?.includes(profile)) : inventory.checks;
  const eligible = new Map(available.map(check => [check.id, check]));
  const selection = values.check?.length
    ? [...new Set(values.check)].map(id => eligible.get(id) ?? { id, module: '.' })
    : available;
  for (const id of new Set(values.expect ?? [])) {
    if (!selection.some(check => check.id === id)) selection.push({ id, module: '.' });
  }
  if (!selection.length) selection.push({ id: 'profile:' + profile, module: '.' });

  const before = await snapshot(root);
  const changed = await pathsChanged(root, profile, values.base, before);
  const outsideIndex = profile === 'precommit' && before.stagedSnapshot ? await pathsOutsideIndex(root) : [];
  const id = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID();
  const directory = path.posix.join(runsDir, id);
  await fs.mkdir(path.join(root, directory), { recursive: true });
  const results = [];
  const ci = ciContext();
  const invalidCandidate = profile === 'pr' && process.env.GITHUB_ACTIONS === 'true' &&
    (!process.env.GITHUB_SHA || before.commit !== process.env.GITHUB_SHA || before.stagedTracked || before.unstagedTracked);
  for (const [offset, check] of selection.entries()) {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const evidence = path.posix.join(directory, String(offset + 1));
    let status = 'passed';
    let reason = null;
    let exitCode = null;
    let log = null;
    let links;
    if (!check.argv) {
      status = 'missing';
      reason = 'No executable check is registered for ' + check.id;
    } else if (invalidCandidate) {
      status = 'blocked';
      reason = 'The tracked checkout does not match the GitHub merge candidate.';
    } else if (profile === 'precommit' && !before.stagedSnapshot) {
      status = 'blocked';
      reason = 'Pre-commit needs a Git index.';
    } else if (profile && !affects(check, changed)) {
      status = 'skipped';
      reason = 'No changed paths match the registered scope.';
    } else if (profile === 'precommit' && outsideIndex.length && affects(check, outsideIndex)) {
      status = 'blocked';
      reason = 'Unstaged or untracked files overlap the check scope.';
    } else {
      const cwd = path.join(root, check.module);
      const output = path.join(root, evidence);
      await fs.mkdir(output);
      log = path.posix.join(evidence, 'output.log');
      const handle = await fs.open(path.join(root, log), 'wx');
      try {
        const realCwd = await fs.realpath(cwd);
        if (realCwd !== root && !realCwd.startsWith(root + path.sep)) throw new Error('Check module is outside the project');
        const [command, ...args] = check.argv.map(value => value.replaceAll('{artifacts}', () => output));
        const result = await executeTestCommand(command, args, realCwd, handle, check.timeoutMs ?? 300_000);
        exitCode = result.code;
        if (result.signal) {
          status = 'blocked';
          reason = 'Runner terminated by ' + result.signal + ' (interrupted or timed out).';
        } else if (check.reportRuns) {
          const report = await e2eEvidence(root, evidence, check.reportRuns);
          ({ status, reason, links } = report);
          if (status === 'passed' && exitCode !== 0) {
            status = 'blocked';
            reason = 'The E2E report passed but its runner exited with code ' + exitCode + '.';
          }
        } else if (exitCode !== 0) {
          status = (command === 'python3' && /No module named (pytest|ruff)\b/.test(await readText(path.join(root, log)))) ||
            exitCode === 126 || exitCode === 127 ? 'blocked' : 'failed';
          reason = 'Runner exited with code ' + exitCode + '.';
        }
        const after = await snapshot(root);
        if (JSON.stringify(before) !== JSON.stringify(after) && status === 'passed') {
          status = 'blocked';
          reason = 'Checkout changed during the run. Verify the new state in a fresh run.';
        }
      } catch (error) {
        status = 'blocked';
        reason = error.message;
      } finally {
        await handle.close();
      }
    }
    const record = {
      version: 1, runId: id, checkId: check.id, module: check.module, source: check.source, profile: profile ?? null,
      environment: { platform: os.platform(), arch: os.arch(), release: os.release(), node: process.version },
      snapshot: before, scope: check.paths ?? [], startedAt, finishedAt: new Date().toISOString(), durationMs: Math.round(performance.now() - start),
      status, exitCode, reason, evidence: log ? { directory: evidence, log, ...links } : null, ...(ci && { ci }),
    };
    const recordPath = evidence + '.json';
    await atomicWriteJson(path.join(root, recordPath), record);
    results.push({ ...record, record: recordPath });
  }
  await writeIndex(root);
  return { reportDirectory: directory, results, ok: results.every(item => ['passed', 'skipped'].includes(item.status)) };
}

export async function runProjectQualityCommand(args) {
  const [action, ...rest] = args;
  if (!action || action === '--help' || rest.includes('--help')) {
    console.log([
      'open-vibecoding project-quality refresh [--root <project>]',
      'open-vibecoding project-quality run --check <id> ... [--root <project>]',
      'open-vibecoding project-quality run --profile <precommit|pr> [--check <required-id> ...] [--expect <required-id> ...] [--base <sha>] [--root <project>]',
    ].join('\n'));
    return 0;
  }
  try {
    const { values } = parseArgs({
      args: rest,
      options: { root: { type: 'string' }, check: { type: 'string', multiple: true }, profile: { type: 'string' }, base: { type: 'string' }, expect: { type: 'string', multiple: true } },
    });
    const root = await fs.realpath(values.root ?? process.cwd());
    if (action === 'refresh' && !values.check && !values.profile && !values.base && !values.expect) {
      const index = await writeIndex(root);
      console.log(JSON.stringify(index, null, 2));
      return 0;
    }
    if (action !== 'run') throw new Error('Unknown command or unsupported options: ' + action);
    const result = await runChecks(root, values);
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    return 2;
  }
}
