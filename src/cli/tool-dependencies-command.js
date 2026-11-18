import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { withFileLock } from '../kernel/atomic-store.js';
import { resolveOpenPrdHome } from '../workspace-registry.js';
import { checkIosDevice, checkMaestroJava, maestroDependency } from './maestro-dependency.js';

const execute = promisify(execFile);
const installTimeoutMs = 120_000;
const toolDependencies = new Map([
  ['playwright-cli', {
    packageName: '@playwright/cli',
    version: '0.1.24',
    bin: 'playwright-cli.js',
    executable: 'playwright-cli',
    projectAlternative: { packageName: 'playwright', bin: 'cli.js', args: ['cli'] },
    acceptsHelp: output => /\bsnapshot\b/.test(output) && /\bopen\b/.test(output),
    install: installNpmTool,
  }],
  ['maestro', maestroDependency],
]);

const usage = 'open-vibecoding tools <check|ensure> <playwright-cli|maestro> [--root <project-dir>] [--device <iOS-UDID>]';

async function nodePackageInvocation(root, tool, source) {
  if (!tool?.packageName) return null;
  const { packageName, bin, args = [] } = tool;
  const directory = path.join(root, 'node_modules', packageName);
  const manifest = await fs.readFile(path.join(directory, 'package.json'), 'utf8')
    .then(JSON.parse).catch(() => null);
  if (manifest?.name !== packageName) return null;
  return { command: process.execPath, args: [path.join(directory, bin), ...args], source, packageVersion: manifest.version };
}

async function executableOnPath(executable, directory) {
  const candidate = path.join(directory, executable);
  try {
    if (!(await fs.stat(candidate)).isFile()) return null;
    await fs.access(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

async function verify(invocation, tool, cwd) {
  if (!invocation) return null;
  const result = await execute(invocation.command, [...invocation.args, '--help'], {
    cwd, timeout: 5_000, maxBuffer: 512_000, windowsHide: true,
  }).catch(() => null);
  if (!result || !tool.acceptsHelp(result.stdout)) return null;
  const version = await execute(invocation.command, [...invocation.args, '--version'], {
    cwd, timeout: 5_000, maxBuffer: 64_000, windowsHide: true,
  }).then(result => result.stdout.trim()).catch(() => '');
  return { ...invocation, version: version || invocation.packageVersion || null };
}

async function findInstalled(tool, root, cache) {
  let existing = await verify(await nodePackageInvocation(root, tool, 'project'), tool, root)
    ?? await verify(await nodePackageInvocation(root, tool.projectAlternative, 'project'), tool, root)
    ?? await verify(await nodePackageInvocation(cache, tool, 'managed'), tool, root);
  if (existing) return existing;

  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute)) {
    const executable = await executableOnPath(tool.executable, directory);
    const candidate = executable
      ? { command: executable, args: [], source: 'path' }
      : await nodePackageInvocation(directory, tool, 'path');
    existing = await verify(candidate, tool, root);
    if (existing) return existing;
  }
  return null;
}

async function npmInvocation() {
  if (process.platform !== 'win32') return { command: 'npm', args: [] };
  const directory = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates.filter(value => value && path.isAbsolute(value))) {
    if (await fs.stat(candidate).then(stat => stat.isFile()).catch(() => false)) {
      return { command: process.execPath, args: [candidate] };
    }
  }
  throw new Error('未找到 npm，请修复 Node.js 安装后再试。');
}

async function installNpmTool(tool, root, cache) {
  const existing = await findInstalled(tool, root, cache);
  if (existing) return { installation: existing, installed: false };
  const npm = await npmInvocation();
  const directory = await fs.mkdtemp(path.join(path.dirname(cache), 'install-'));
  try {
    await execute(npm.command, [
      ...npm.args, 'install', '--prefix', directory, '--no-audit', '--no-fund',
      '--ignore-scripts', '--fetch-retries=0', '--save-exact', `${tool.packageName}@${tool.version}`,
    ], { cwd: directory, timeout: installTimeoutMs, maxBuffer: 512_000, windowsHide: true }).catch(error => {
      const reason = error.code === 'ENOENT' ? '未找到 npm' : error.killed ? '下载或安装超时' : `npm 安装失败（${error.code ?? 'unknown'}）`;
      throw new Error(`${reason}。请检查 Node.js、npm 源和网络后重试。`);
    });
    const staged = await verify(await nodePackageInvocation(directory, tool, 'managed'), tool, root);
    if (staged?.packageVersion !== tool.version) throw new Error('已下载工具未通过版本和命令验证，请重试。');

    // The cache path is owned by this tool; a failed download leaves the previous installation intact.
    await fs.rm(cache, { recursive: true, force: true });
    await fs.rename(directory, cache);
    const installation = await verify(await nodePackageInvocation(cache, tool, 'managed'), tool, root);
    if (!installation) throw new Error('缓存内工具未通过复验，请重试安装。');
    return { installation, installed: true };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function resolveToolDependency(id, { root = process.cwd(), ensure = false, device } = {}) {
  const tool = toolDependencies.get(id);
  if (!tool) throw new Error(`未知工具 ${id ?? ''}。当前支持 ${[...toolDependencies.keys()].join('、')}。`);
  const project = path.resolve(root);
  if (!(await fs.stat(project).catch(() => null))?.isDirectory()) {
    throw new Error('请指定一个可读取的项目目录。');
  }
  const cache = path.join(resolveOpenPrdHome(), 'tools', id, `${tool.version}-${process.platform}-${process.arch}`);
  if (device && id !== 'maestro') throw new Error('--device 只适用于 Maestro。');
  if (id === 'maestro') {
    const java = await checkMaestroJava();
    const simulator = await checkIosDevice(device);
    const prerequisites = { java, simulator };
    if (java.status !== 'ready') return { tool: id, ok: false, status: 'blocked', installation: null, prerequisites };
    let installation = await tool.find(project, cache);
    let installed = false;
    if (!installation && ensure) {
      installation = await withFileLock(`${cache}.lock`, async () => {
        const existing = await tool.find(project, cache);
        if (existing) return existing;
        const staged = await tool.install(project, cache);
        installed = true;
        return staged;
      }, { timeoutMs: 150_000, staleLockMs: 240_000, retryDelayMs: 250 });
    }
    const deviceReady = ['not_requested', 'ready'].includes(simulator.status);
    const status = !installation ? 'missing' : !deviceReady ? 'blocked' : installed ? 'installed' : 'available';
    return { tool: id, ok: Boolean(installation && deviceReady), status, installation, prerequisites };
  }
  const installation = await findInstalled(tool, project, cache);
  if (installation || !ensure) {
    return { tool: id, ok: Boolean(installation), status: installation ? 'available' : 'missing', installation };
  }

  const result = await withFileLock(`${cache}.lock`, () => tool.install(tool, project, cache), {
    timeoutMs: installTimeoutMs + 30_000,
    staleLockMs: installTimeoutMs + 90_000,
    retryDelayMs: 250,
  });
  return { tool: id, ok: true, status: result.installed ? 'installed' : 'available', installation: result.installation };
}

export async function runToolDependenciesCommand(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage);
    return 0;
  }
  const [action, id, ...args] = argv;
  try {
    if (!['check', 'ensure'].includes(action)) throw new Error(usage);
    const { values } = parseArgs({ args, options: { root: { type: 'string' }, device: { type: 'string' } } });
    const result = await resolveToolDependency(id, { ...values, ensure: action === 'ensure' });
    console.log(JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({ tool: id, ok: false, status: 'error', message: error.message }));
    return 1;
  }
}
