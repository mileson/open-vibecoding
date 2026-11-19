import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractExcerpt, matchText } from './markdown.js';

const run = promisify(execFile);
const MAX_NODES = 60;
const MAX_DOCUMENTS = 5;
const TOKEN = /^[a-zA-Z0-9_-]+$/;

function responseJson(output) {
  try {
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function request(binding, args) {
  try {
    const { stdout } = await run('lark-cli', [
      ...args, '--profile', binding.profile, '--as', binding.identity, '--format', 'json',
    ], { timeout: 12_000, maxBuffer: 2 * 1024 * 1024 });
    const response = responseJson(stdout);
    if (response?.ok === true && response.identity === binding.identity) return response.data;
    throw new Error('飞书返回了无法确认身份或读取状态的响应。');
  } catch (error) {
    const detail = responseJson(error.stderr)?.error;
    if (error.code === 'ENOENT') throw new Error('找不到 lark-cli。请先配置飞书连接。');
    if (error.killed) throw new Error('飞书响应超时。');
    if (detail) {
      const status = [detail.type, detail.subtype].filter(value => /^[a-z_]+$/.test(value)).join('/');
      throw new Error(status ? `飞书读取失败（${status}）。请检查网络、登录状态和目录权限。` : '飞书读取失败。请检查网络、登录状态和目录权限。');
    }
    if (error.stderr !== undefined) throw new Error('飞书读取失败。请检查连接、登录状态和目录权限。');
    throw error;
  }
}

async function listChildren(binding, spaceId, nodeToken, cursor) {
  const data = await request(binding, [
    'wiki', '+node-list', '--space-id', spaceId, '--parent-node-token', nodeToken,
    '--page-size', '20', ...(cursor ? ['--page-token', cursor] : []),
  ]);
  const nodes = data?.nodes ?? data?.items;
  if (!Array.isArray(nodes)) throw new Error('飞书未返回目录内容。');
  return { nodes, cursor: data.has_more ? data.page_token : null };
}

export async function feishuRoot(binding) {
  const data = await request(binding, ['wiki', '+node-get', '--node-token', binding.source]);
  const node = data?.node ?? data;
  if (!TOKEN.test(node?.node_token ?? '') || !/^\d+$/.test(node?.space_id ?? '')) {
    throw new Error('飞书未返回可读取的 Wiki 节点。');
  }
  const firstPage = await listChildren(binding, node.space_id, node.node_token);
  return { node, firstPage };
}

async function wikiDocuments(binding) {
  const { node, firstPage } = await feishuRoot(binding);
  const pending = [{ token: node.node_token, depth: 0, page: firstPage }];
  const seen = new Set([node.node_token]);
  const documents = [];
  let limited = false;
  let visited = 0;
  let pages = 0;
  while (pending.length && visited < MAX_NODES && pages < 10) {
    pages += 1;
    const { token, depth, cursor, page } = pending.shift();
    const children = page ?? await listChildren(binding, node.space_id, token, cursor);
    for (const child of children.nodes) {
      if (visited++ >= MAX_NODES) {
        limited = true;
        break;
      }
      if (!TOKEN.test(child?.node_token ?? '') || seen.has(child.node_token)) continue;
      seen.add(child.node_token);
      if (child.node_type === 'shortcut') continue;
      if (child.obj_type === 'docx') documents.push(child);
      if (child.has_child && depth < 3) pending.push({ token: child.node_token, depth: depth + 1 });
      if (child.has_child && depth >= 3) limited = true;
    }
    if (children.cursor) pending.push({ token, depth, cursor: children.cursor });
  }
  return { documents, limited: limited || pending.length > 0 };
}

export async function searchFeishu(binding, terms) {
  const { documents, limited } = await wikiDocuments(binding);
  const matches = [];
  const failures = [];
  const ordered = documents.sort((a, b) => matchText(b.title ?? '', terms) - matchText(a.title ?? '', terms));
  const keyword = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const origin = new URL(binding.source).origin;
  for (const item of ordered.slice(0, MAX_DOCUMENTS)) {
    const url = `${origin}/wiki/${item.node_token}`;
    try {
      const data = await request(binding, [
        'docs', '+fetch', '--doc', url, '--doc-format', 'markdown', '--scope', 'keyword',
        '--keyword', keyword, '--context-before', '0', '--context-after', '1',
      ]);
      const doc = data?.document;
      if (typeof doc?.content !== 'string') throw new Error('飞书未返回可引用的正文。');
      const title = item.title || item.node_token;
      const match = extractExcerpt(doc.content, title, terms);
      if (match && matchText(match.excerpt, terms)) {
        const { line, ...excerpt } = match;
        matches.push({ ...excerpt, title, url, revision: doc.revision_id ?? null });
      }
    } catch (error) {
      failures.push(error.message);
    }
  }
  return { matches, limited: limited || documents.length > MAX_DOCUMENTS, failures: [...new Set(failures)] };
}
