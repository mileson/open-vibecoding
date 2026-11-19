import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteJson, readJsonIfExists, withFileLock } from '../kernel/atomic-store.js';
import { resolveOpenPrdHome } from '../workspace-registry.js';

export const PROJECT_BINDINGS = '.open-vibecoding/knowledge/bindings.json';
export const EMPTY_BINDINGS = Object.freeze({ version: 1, bindings: Object.freeze([]) });
export const DOMAINS = ['product', 'engineering', 'testing'];
export const SCOPES = ['project', 'global'];

export function isWithin(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function bindingLocations(directory, options = {}) {
  const start = await fs.realpath(directory);
  let root = start;
  while (!options.path && !(await fs.stat(path.join(root, '.open-vibecoding')).catch(() => null))?.isDirectory()) {
    const parent = path.dirname(root);
    if (parent === root || await fs.lstat(path.join(root, '.git')).catch(() => null)) {
      root = start;
      break;
    }
    root = parent;
  }
  const home = resolveOpenPrdHome(options);
  const projectKey = createHash('sha256').update(root).digest('hex');
  return {
    root,
    files: [
      { scope: 'project', storage: 'shared', file: path.join(root, PROJECT_BINDINGS) },
      { scope: 'project', storage: 'local', file: path.join(home, 'knowledge', 'projects', projectKey + '.json') },
      { scope: 'global', storage: 'local', file: path.join(home, 'knowledge', 'bindings.json') },
    ],
  };
}

export function validateBinding(binding, location, root) {
  if (!binding || typeof binding !== 'object') throw new Error('请填写知识库绑定对象。');
  const { id, domain, type, source, profile, identity } = binding;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    throw new Error('绑定 ID 需由字母、数字、短横线或下划线组成。');
  }
  if (!DOMAINS.includes(domain)) throw new Error('请选择 product、engineering 或 testing。');
  if (typeof source !== 'string' || !source.trim() || /[\0\r\n]/.test(source)) {
    throw new Error('请指定 Markdown 目录或飞书 Wiki 节点链接。');
  }
  if (type === 'markdown') {
    if (location.storage === 'shared' && (path.isAbsolute(source) || !isWithin(root, path.resolve(root, source)))) {
      throw new Error('仓库配置只接受项目内的相对目录。');
    }
    if (location.storage === 'local' && !path.isAbsolute(source)) throw new Error('本机配置需要绝对路径。');
    return { id, domain, type, source };
  }
  if (type !== 'feishu' || location.storage !== 'local') {
    throw new Error('仓库配置只接受 Markdown。飞书 Wiki 请通过 knowledge bind 写入本机配置。');
  }
  const url = URL.canParse(source) ? new URL(source) : null;
  if (url?.protocol !== 'https:' || url.port || url.username || url.password ||
      !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname) || !/^\/wiki\/[\w-]+\/?$/.test(url.pathname)) {
    throw new Error('请指定飞书或 Lark 的 Wiki 节点链接。');
  }
  if (typeof profile !== 'string' || !profile.trim() || !['user', 'bot'].includes(identity)) {
    throw new Error('飞书绑定需要明确指定已核实的 --profile 和 --as user|bot。');
  }
  return { id, domain, type, source: url.origin + url.pathname.replace(/\/$/, ''), profile, identity };
}

async function readBindings(location, root) {
  if (location.storage === 'shared') {
    const actual = await fs.realpath(location.file).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (actual && !isWithin(root, actual)) throw new Error('仓库知识库配置必须位于项目内。');
  }
  const config = await readJsonIfExists(location.file, EMPTY_BINDINGS);
  if (config?.version !== 1 || !Array.isArray(config.bindings)) {
    throw new Error('知识库配置需要 version: 1 和 bindings 数组。');
  }
  const bindings = config.bindings.map(binding => validateBinding(binding, location, root));
  if (new Set(bindings.map(binding => binding.id)).size !== bindings.length) {
    throw new Error('同一配置文件中的绑定 ID 必须唯一。');
  }
  return bindings;
}

export async function loadBindings(locations, filters = {}) {
  const bindings = [];
  const configs = [];
  for (const location of locations.files.filter(item => !filters.scope || item.scope === filters.scope)) {
    try {
      const items = await readBindings(location, locations.root);
      configs.push({ ...location, status: 'ok' });
      for (const item of items.filter(binding => !filters.domain || binding.domain === filters.domain)) {
        bindings.push({ ...item, scope: location.scope, storage: location.storage });
      }
    } catch (error) {
      configs.push({ ...location, status: 'invalid', message: error.message });
    }
  }
  return { bindings, configs };
}

export async function saveBinding(locations, options, probe) {
  const { scope, id, domain, type, source, profile, identity } = options;
  if (!SCOPES.includes(scope)) throw new Error('请选择 --scope global 或 project。');
  const storage = scope === 'global' || type === 'feishu' || path.isAbsolute(source ?? '') ? 'local' : 'shared';
  const location = locations.files.find(item => item.scope === scope && item.storage === storage);
  const binding = validateBinding({ id, domain, type, source, profile, identity }, location, locations.root);
  await probe({ ...binding, scope, storage }, locations.root);
  if (storage === 'shared') {
    for (const directory of ['.open-vibecoding', '.open-vibecoding/knowledge']) {
      const target = path.join(locations.root, directory);
      const info = await fs.lstat(target).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info && !info.isDirectory()) throw new Error('项目知识库配置目录必须是项目内的实际目录。');
    }
  }
  await withFileLock(location.file + '.lock', async () => {
    const current = await readBindings(location, locations.root);
    const existing = current.find(item => item.id === id);
    if (existing && JSON.stringify(existing) === JSON.stringify(binding)) return;
    if (existing) throw new Error('此配置已使用该绑定 ID。请选择新 ID，或直接编辑该配置。');
    await atomicWriteJson(location.file, { version: 1, bindings: [...current, binding] });
  });
  return { binding: { ...binding, scope, storage }, file: location.file };
}
