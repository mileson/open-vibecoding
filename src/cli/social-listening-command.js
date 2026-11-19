import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { atomicWriteJson, withFileLock } from '../kernel/atomic-store.js';
import { platformLabels, writeSocialReport } from '../social-report.js';
import { importSocialReport } from '../social-report-import.js';

const usage = [
  'open-vibecoding social-listening check [--config <config.json>]',
  'open-vibecoding social-listening run --product <name> --out <run-dir> [--config <config.json>]',
  'open-vibecoding social-listening import --from <run-dir> --analysis <analysis.json> --out <report.json> [--app-store-reviews <reviews.json>]',
  'open-vibecoding social-listening template --out <template.html>',
  'open-vibecoding social-listening render --data <report.json> --out <report.html> [--csv <detail.csv>] [--template <template.html>]',
];
const optionsByAction = {
  check: { config: { type: 'string' } },
  run: { product: { type: 'string' }, out: { type: 'string' }, config: { type: 'string' } },
  import: { from: { type: 'string' }, analysis: { type: 'string' }, out: { type: 'string' }, 'app-store-reviews': { type: 'string' } },
  template: { out: { type: 'string' } },
  render: { out: { type: 'string' }, data: { type: 'string' }, csv: { type: 'string' }, template: { type: 'string' } },
};
const requiredByAction = { check: [], run: ['product', 'out'], import: ['from', 'analysis', 'out'], template: ['out'], render: ['data', 'out'] };

function sampling(config, defaults) {
  return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) => {
    const value = config[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
    return [name, value];
  }));
}

function browserPlan(id, config, defaults) {
  return {
    id, label: platformLabels[id], tool: 'ego-browser',
    status: config.enabled === false ? 'not_selected' : 'browser_check_required',
    sampling: sampling(config, defaults),
  };
}

function channelFilters({ sort = 'hot', publishTime = 'all', duration = 'all' }) {
  const supported = { sort: ['default', 'latest', 'hot'], publishTime: ['all', 'day', 'week', 'half_year'], duration: ['all', 'short', 'medium', 'long'] };
  const filters = { sort, publishTime, duration };
  for (const [name, choices] of Object.entries(supported)) {
    if (!choices.includes(filters[name])) throw new Error(`Invalid wechat_channels.${name}`);
  }
  return filters;
}

function channelsPlan(config) {
  const { enabled, provider, tokenEnv, budgetUsd } = config;
  const id = 'wechat_channels';
  const base = { id, label: platformLabels[id], tool: provider || null };
  const samplingParams = sampling(config, { searchTopN: 10, detailTopN: 3, commentPages: 1, timeoutSeconds: 45 });
  if (samplingParams.detailTopN > samplingParams.searchTopN) throw new Error('detailTopN cannot exceed searchTopN');
  if (enabled === false) return { ...base, status: 'not_selected' };
  if (provider && provider !== 'tikhub') throw new Error('wechat_channels.provider must be tikhub or empty');
  if (tokenEnv && !/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) throw new Error('tokenEnv must name an environment variable');
  if (budgetUsd != null && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)) throw new Error('budgetUsd must be positive or empty');
  const missing = [
    ...(!provider ? ['provider'] : []),
    ...(!tokenEnv ? ['tokenEnv'] : []),
    ...(budgetUsd == null ? ['budgetUsd'] : []),
  ];
  const plan = { ...base, sampling: { ...samplingParams, ...channelFilters(config) }, tokenEnv: tokenEnv || null, budgetUsd: budgetUsd ?? null };
  if (missing.length) return {
    ...plan, status: 'configuration_required', missing: missing.map(key => `platforms.wechat_channels.${key}`),
    nextAction: '选择 TikHub，填入凭证的环境变量名和费用上限。',
  };
  if (!process.env[tokenEnv]?.trim()) return {
    ...plan, status: 'credential_required', nextAction: `在本机配置 ${tokenEnv} 后重新检查。`,
  };
  return { ...plan, status: 'approval_required', nextAction: '在宿主采集工具中预览请求数和费用，确认后执行。' };
}

async function planSources(configPath) {
  const config = configPath ? JSON.parse(await fs.readFile(configPath, 'utf8')) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('config must be an object');
  const configured = config.platforms ?? {};
  if (typeof configured !== 'object' || Array.isArray(configured)) throw new Error('config.platforms must be an object');
  const { xiaohongshu = {}, douyin = {}, wechat_channels: channels = {} } = configured;
  for (const [label, value] of Object.entries({ xiaohongshu, douyin, wechat_channels: channels })) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} config must be an object`);
  }
  return [
    browserPlan('xiaohongshu', xiaohongshu, { contentTopN: 10 }),
    browserPlan('douyin', douyin, { contentTopN: 10, maxCommentsPerContent: 1000, noGrowthRounds: 3, maxRuntimeMinutes: 90 }),
    channelsPlan(channels),
  ];
}

async function runPlan(values) {
  const platforms = await planSources(values.config);
  const plan = { schemaVersion: 1, product: values.product.trim(), platforms };
  const directory = path.resolve(values.out);
  const manifest = path.join(directory, 'collection-plan.json');
  await withFileLock(`${manifest}.lock`, async () => {
    const existing = await fs.lstat(manifest).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (existing) throw new Error(`Collection plan already exists: ${manifest}`);
    await atomicWriteJson(manifest, plan);
  });
  return { ok: true, out: manifest, ...plan };
}

export async function runSocialListeningCommand(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage.join('\n'));
    console.log('run 生成采集计划，import 读取采集产物。render 从现有分析数据生成可离线打开的 HTML。输入说明见 docs/social-report.md。');
    return 0;
  }
  const [action, ...args] = argv;
  try {
    if (!Object.hasOwn(optionsByAction, action)) throw new Error('Expected check, run, import, template or render');
    const { values } = parseArgs({ args, options: optionsByAction[action] });
    for (const name of requiredByAction[action]) {
      if (!values[name]?.trim()) throw new Error(`--${name} is required`);
    }
    let result;
    if (action === 'check') result = { ok: true, platforms: await planSources(values.config) };
    else if (action === 'run') result = await runPlan(values);
    else if (action === 'import') result = await importSocialReport({ ...values, appStoreReviews: values['app-store-reviews'] });
    else result = await writeSocialReport({ action, ...values });
    console.log(JSON.stringify({ action, ...result }, null, 2));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, action, error: { type: 'social-listening', message: error.message, usage } }));
    return 1;
  }
}
