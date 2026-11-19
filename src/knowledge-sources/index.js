import { bindingLocations, loadBindings, saveBinding, DOMAINS, SCOPES } from './config.js';
import { feishuRoot, searchFeishu } from './feishu.js';
import { markdownRoot, queryTerms, searchMarkdown } from './markdown.js';

const configurationHint = '请指定要绑定的本地 Markdown 目录或飞书 Wiki 节点，并说明它适用于当前项目还是多个项目。';

async function probe(binding, root) {
  if (binding.type === 'markdown') return { directory: await markdownRoot(binding, root) };
  const { node, firstPage } = await feishuRoot(binding);
  return { title: node.title, visibleChildren: firstPage.nodes.length, hasMore: Boolean(firstPage.cursor) };
}

export async function knowledgeSources(action, options) {
  const { scope, domain } = options;
  if (scope !== undefined && !SCOPES.includes(scope)) throw new Error('请选择 --scope global 或 project。');
  if (domain !== undefined && !DOMAINS.includes(domain)) throw new Error('请选择 --domain product、engineering 或 testing。');
  const locations = await bindingLocations(options.path ?? process.cwd());
  if (action === 'bind') return { ok: true, action, ...await saveBinding(locations, options, probe) };

  const { bindings, configs } = await loadBindings(locations, options);
  const configured = bindings.length > 0;
  const result = {
    ok: configs.every(config => config.status === 'ok'),
    action,
    projectRoot: locations.root,
    configured,
    configs,
    bindings,
    ...(configured ? {} : { hint: configurationHint }),
  };
  if (action === 'bindings') return result;

  const query = options.query?.trim();
  const limit = options.limit === undefined ? 6 : Number(options.limit);
  if (action === 'search' && (!query || query.length > 180 || !Number.isInteger(limit) || limit < 1 || limit > 20)) {
    throw new Error('请提供不超过 180 字的查询，并将 --limit 设为 1 到 20。');
  }
  const hits = [];
  const sources = [];
  const terms = query ? queryTerms(query) : [];
  for (const binding of bindings) {
    const source = { id: binding.id, scope: binding.scope, domain: binding.domain, storage: binding.storage };
    try {
      if (action === 'check') {
        sources.push({ ...source, status: 'ok', ...await probe(binding, locations.root) });
        continue;
      }
      const { matches, limited, failures = [] } = binding.type === 'markdown'
        ? await searchMarkdown(binding, locations.root, terms)
        : await searchFeishu(binding, terms);
      for (const match of matches) hits.push({ ...source, ...match });
      sources.push({ ...source, status: failures.length ? 'partial' : 'ok', limited, warnings: failures });
    } catch (error) {
      sources.push({ ...source, status: 'unavailable', message: error.message });
    }
  }

  if (action === 'check') return { ...result, ok: result.ok && sources.every(item => item.status === 'ok'), sources };

  hits.sort((a, b) => Number(b.scope === 'project') - Number(a.scope === 'project') ||
    b.score - a.score || a.title.localeCompare(b.title, 'zh'));
  const unique = new Set();
  const matches = [];
  for (const hit of hits) {
    const key = hit.path ?? hit.url;
    if (unique.has(key)) continue;
    unique.add(key);
    const { score, ...citation } = hit;
    matches.push(citation);
    if (matches.length >= limit) break;
  }
  return { ...result, sources, query, matches, partial: !result.ok || sources.some(item => item.status !== 'ok' || item.limited) };
}
