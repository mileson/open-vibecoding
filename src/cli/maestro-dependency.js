import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const version = '2.12.1';
const releaseUrl = `https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${version}/maestro.zip`;
const probeOptions = { timeout: 8_000, maxBuffer: 512_000, windowsHide: true };

export async function checkMaestroJava() {
  const command = process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const detected = await execute(command, ['-version'], probeOptions)
    .then(({ stdout, stderr }) => /version "(?:1\.)?(\d+)[^"]*"/.exec(stderr + stdout))
    .catch(() => null);
  if (!detected) return { status: 'missing', message: '未找到可用的 Java，请检查 JAVA_HOME 或 PATH。' };
  const major = Number(detected[1]);
  return major >= 17 ? { status: 'ready', major } : {
    status: 'incompatible', major, message: 'Maestro 需要 Java 17 或更高版本。',
  };
}

export async function checkIosDevice(id) {
  if (!id) return { status: 'not_requested' };
  if (process.platform !== 'darwin') return { status: 'unavailable', id, message: 'iOS 模拟器需要 macOS 和 Xcode。' };
  const inventory = await execute('xcrun', ['simctl', 'list', 'devices', '-j'], probeOptions)
    .then(({ stdout }) => JSON.parse(stdout).devices).catch(() => null);
  if (!inventory) return { status: 'unavailable', id, message: '无法读取 iOS 模拟器，请检查 Xcode 和 simctl。' };
  const simulator = Object.entries(inventory).filter(([runtime]) => runtime.includes('.iOS-'))
    .flatMap(([, entries]) => entries).find(device => device.udid === id && device.isAvailable);
  if (simulator?.state === 'Booted') return { status: 'ready', id, name: simulator.name };
  return { status: 'not_ready', id, message: simulator ? '指定的 iOS 模拟器尚未启动。' : '未找到指定的可用 iOS 模拟器。' };
}

async function verifyMaestro(command, source, root) {
  const output = await execute(command, ['--version'], { ...probeOptions, cwd: root })
    .then(({ stdout }) => stdout.trim()).catch(() => '');
  const found = /^(?:Maestro\s+(?:CLI\s+)?)?v?(\d+)\.(\d+)\.(\d+)$/i.exec(output);
  if (!found || Number(found[1]) !== 2 || Number(found[2]) < 12) return null;
  return { command, args: [], source, version: found.slice(1).join('.') };
}

async function findMaestro(root, cache) {
  const lookup = [
    [path.join(root, '.maestro', 'bin', 'maestro'), 'project'],
    [path.join(cache, 'maestro', 'bin', 'maestro'), 'managed'],
    ...(process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute)
      .map(directory => [path.join(directory, 'maestro'), 'path']),
    [path.join(os.homedir(), '.maestro', 'bin', 'maestro'), 'user'],
  ];
  for (const [command, source] of lookup) {
    const installation = await verifyMaestro(command, source, root);
    if (installation) return installation;
  }
  return null;
}

async function installMaestro(root, cache) {
  if (!['darwin', 'linux'].includes(process.platform)) {
    throw new Error('此平台的 Maestro 自动安装尚未接入，请参考官方安装文档。');
  }
  const directory = await fs.mkdtemp(path.join(path.dirname(cache), 'install-'));
  const archive = path.join(directory, 'maestro.zip');
  try {
    await execute('curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '90', '--output', archive, releaseUrl], {
      timeout: 95_000, maxBuffer: 512_000,
    }).catch(() => { throw new Error('无法下载 Maestro 官方发行包，请检查 curl 和网络后重试。'); });
    await execute('unzip', ['-q', archive, '-d', directory], { timeout: 20_000, maxBuffer: 512_000 })
      .catch(() => { throw new Error('无法解压 Maestro 发行包，请检查 unzip 和磁盘空间。'); });
    const staged = await verifyMaestro(path.join(directory, 'maestro', 'bin', 'maestro'), 'managed', root);
    if (staged?.version !== version) throw new Error('Maestro 发行包未通过版本验证。');
    await fs.unlink(archive);
    await fs.rm(cache, { recursive: true, force: true });
    await fs.rename(directory, cache);
    return { ...staged, command: path.join(cache, 'maestro', 'bin', 'maestro') };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export const maestroDependency = { version, find: findMaestro, install: installMaestro };
