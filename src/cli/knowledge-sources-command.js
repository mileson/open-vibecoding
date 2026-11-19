import { parseArgs } from 'node:util';
import { knowledgeSources } from '../knowledge-sources/index.js';

export const KNOWLEDGE_SOURCE_COMMANDS = ['bind', 'bindings', 'check', 'search'];
export const KNOWLEDGE_SOURCE_USAGE = [
  'open-vibecoding knowledge bind --scope <global|project> --domain <product|engineering|testing> --id <id> --type <markdown|feishu> --source <directory|wiki-url> [--profile <profile> --as <user|bot>] [--path <project>] [--json]',
  'open-vibecoding knowledge <bindings|check> [--scope <global|project>] [--domain <product|engineering|testing>] [--path <project>] [--json]',
  'open-vibecoding knowledge search <query> [--scope <global|project>] [--domain <product|engineering|testing>] [--limit <1–20>] [--path <project>] [--json]',
];

function printResult(result) {
  if (result.binding) {
    console.log(`已绑定 ${result.binding.id}。配置文件 ${result.file}`);
    return;
  }
  if (result.hint) console.log(result.hint);
  for (const config of result.configs) {
    if (config.status === 'invalid') console.log(`请检查 ${config.file}。 ${config.message}`);
    else if (result.action === 'bindings') console.log(`${config.scope}/${config.storage}  ${config.file}`);
  }
  if (result.action === 'bindings') {
    for (const binding of result.bindings) console.log(`${binding.scope}/${binding.domain}  ${binding.id}  ${binding.source}`);
  }
  for (const source of result.sources ?? []) {
    if (result.action === 'check' || source.status !== 'ok' || source.limited) {
      const statuses = { ok: source.limited ? '已查询部分资料' : '可读取', partial: '部分资料未能读取', unavailable: '暂时无法读取' };
      console.log(`${source.id}  ${statuses[source.status]}${source.message ? ` · ${source.message}` : ''}`);
    }
  }
  for (const hit of result.matches ?? []) {
    const location = hit.url ?? `${hit.path}:${hit.line}`;
    console.log(`\n${hit.scope}/${hit.domain}  ${hit.title}${hit.section ? ` · ${hit.section}` : ''}\n${location}\n${hit.excerpt}`);
  }
  if (result.action === 'search' && result.configured && !result.matches.length) {
    console.log('本次查询没有找到可引用的资料。');
  }
}

export async function runKnowledgeSourcesCommand([action, ...args]) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(KNOWLEDGE_SOURCE_USAGE.join('\n'));
    return 0;
  }
  const json = args.includes('--json');
  try {
    const flags = ['scope', 'domain', 'path'];
    if (action === 'bind') flags.push('id', 'type', 'source', 'profile', 'as');
    if (action === 'search') flags.push('limit');
    const { values, positionals } = parseArgs({
      args, allowPositionals: action === 'search',
      options: {
        ...Object.fromEntries(flags.map(flag => [flag, { type: 'string' }])),
        json: { type: 'boolean' },
      },
    });
    const result = await knowledgeSources(action, {
      ...values, identity: values.as, query: positionals.join(' '),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else printResult(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    if (json) console.log(JSON.stringify({ ok: false, action, error: error.message }));
    else console.error(error.message);
    return 1;
  }
}
