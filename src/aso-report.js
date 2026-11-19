import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml } from './html-artifact-utils.js';
import { atomicWriteText, withFileLock } from './kernel/atomic-store.js';
import { readAppStoreReviews } from './app-store-reviews.js';
import { asoMarketLabels } from './aso-market-catalog.js';

const bundledTemplate = new URL('./aso-report-template.html', import.meta.url);
const generatedMarker = '<!-- OPEN-VIBECODING:ASO-REPORT -->';
const marketMatrixMarker = '<!-- ASO_MARKET_MATRIX -->';
const competitorSwitchMarker = '<!-- ASO_COMPETITOR_SWITCH -->';
const reportStatuses = new Set(['validated', 'provisional', 'blocked']);
const localeLabels = { 'zh-Hans': '简体中文', 'en-US': '美国英语' };
const supportedSources = new Map([
  ['app-store', 'App Store'], ['qimai', '七麦'], ['xiaohongshu', '小红书'], ['x', 'X'], ['reddit', 'Reddit'],
]);
const sourceDomains = new Map([
  ['app-store', 'apps.apple.com'], ['qimai', 'qimai.cn'], ['xiaohongshu', 'xiaohongshu.com'],
  ['x', 'x.com'], ['reddit', 'reddit.com'],
]);
// App Store Connect app information and platform-version information.
const keywordField = { id: 'keywords', label: '关键词', unit: '字节', max: 100 };
const fullFields = [
  { id: 'name', label: '名称', unit: '字符', min: 2, max: 30 },
  { id: 'subtitle', label: '副标题', unit: '字符', max: 30 },
  { id: 'description', label: '描述', unit: '字符', max: 4000 },
  keywordField,
];
const tableLabels = new Map([
  ['candidate keywords', '候选关键词'], ['core keywords', '核心关键词'],
  ['keyword rankings', '关键词排名'], ['keyword', '关键词'], ['keywords', '关键词'],
  ['coverage overview', '覆盖概况'], ['keyword coverage', '关键词覆盖'], ['coverage', '覆盖情况'],
  ['product rank', '本品排名'], ['competitor rank', '竞品排名'], ['rank', '排名'],
  ['metric', '指标'], ['product', '本品'], ['competitor', '竞品'], ['gap', '差距'],
  ['rating', '星级'], ['star rating', '星级'],
  ['search index', '搜索指数'], ['verdict', '判断'], ['source', '来源'], ['status', '状态'],
]);
const tableLabelText = label => tableLabels.get(label.trim().toLowerCase()) ?? label;
const legacyMarkets = new Map([['cn', 'china'], ['us', 'usa']]);
const sections = {
  social: '用户搜索表达',
  exclusions: '排除词',
  evidence: '数据来源',
};

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a nonempty string`);
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function rankMarkup(tag, value, relatedRanks) {
  const attrs = relatedRanks ? ` data-competitor-ranks="${escapeHtml(JSON.stringify(relatedRanks))}"` : '';
  return `<${tag}${attrs}>${escapeHtml((relatedRanks ? relatedRanks[0] : value) ?? '—')}</${tag}>`;
}

function ratingCell(value) {
  if (!Number.isFinite(value) || value < 0 || value > 5) return rankMarkup('td', value);
  const stars = Array.from({ length: 5 }, (_, index) => {
    const filled = Math.min(1, Math.max(0, value - index)) * 100;
    return `<span class="aso-review-star" aria-hidden="true" style="--filled:${filled.toFixed(4)}%"></span>`;
  }).join('');
  return `<td><span class="aso-review-rating" role="img" aria-label="${value} 星，满分 5 星" title="${value} / 5">${stars}</span></td>`;
}

async function resolveRatingAsset(source, content) {
  const placeholder = '{{ASO_RATING_STAR}}';
  if (!content.includes('class="aso-review-rating"')) return source.replaceAll(placeholder, '');
  if (!source.includes('id="aso-rating-styles"') && !source.includes(placeholder)) {
    const bundled = await fs.readFile(bundledTemplate, 'utf8');
    const styles = bundled.match(/<style id="aso-rating-styles">[\s\S]*?<\/style>/)?.[0];
    if (!styles) throw new Error('Bundled ASO template is missing rating styles');
    source = source.replace(/<\/head\s*>|(?=\{\{ASO_CONTENT\}\})/i, closing => styles + closing);
  }
  if (!source.includes(placeholder)) return source;
  const image = await fs.readFile(new URL('./aso-report-icons/rating-star.png', import.meta.url), 'base64');
  return source.replaceAll(placeholder, 'data:image/png;base64,' + image);
}

function tableMarkup(table, key, isMarket, competitorRanks) {
  requireObject(table, 'table');
  const { title, columns, rows } = table;
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(rows)) {
    throw new Error('A table requires column names and a rows array');
  }
  columns.forEach(column => requireText(column, 'column'));
  if (title !== undefined) requireText(title, 'table.title');
  const labels = columns.map(tableLabelText);
  const keyword = labels.indexOf('关键词');
  const competitor = labels.indexOf('竞品排名');
  if (key === 'evidence' && labels.includes('来源') && labels.includes('状态')) return '';
  const header = labels.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('');
  const body = rows.map(row => {
    if (!Array.isArray(row) || row.length !== columns.length ||
      row.some(cell => cell !== null && typeof cell !== 'string' && !Number.isFinite(cell))) {
      throw new Error('Each table row must match its columns and contain strings, numbers or null');
    }
    return `<tr>${row.map((cell, index) => labels[index] === '星级'
      ? ratingCell(cell)
      : rankMarkup('td', cell, index === competitor && keyword !== -1 ? competitorRanks?.(row[keyword], cell) : undefined)
    ).join('')}</tr>`;
  }).join('');
  const label = title ? tableLabelText(title) : '';
  const showCaption = label && !(isMarket && label === '候选关键词');
  const caption = showCaption ? `<caption>${escapeHtml(label)}</caption>` : '';
  const tableLabel = escapeHtml(label || labels.join('、'));
  return `<div class="table" role="region" aria-label="${tableLabel}" tabindex="0"><table>${caption}<thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function sourceIcon(id, icons) {
  return `<img class="source-icon" data-source="${id}" src="data:image/png;base64,${icons.get(id)}" width="22" height="22" alt="">`;
}

function readSource(source) {
  requireObject(source, 'source');
  requireText(source.title, 'source.title');
  requireText(source.url, 'source.url');
  const url = URL.parse(source.url);
  if (!url || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Source URLs must be HTTP(S) links without credentials');
  }
  const host = url.hostname.replace(/\.$/, '');
  const provider = [...sourceDomains].find(([, domain]) => host === domain || host.endsWith(`.${domain}`))?.[0];
  return { title: source.title, url, provider };
}

function sourceMarkup({ title, url, provider }, icons) {
  const icon = provider ? sourceIcon(provider, icons) : '<span class="source-link-generic" aria-hidden="true"></span>';
  return `<li><a class="source-link" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">${icon}<span class="source-link-copy"><span class="source-link-title">${escapeHtml(title)}</span><span class="source-link-host">${escapeHtml(url.hostname)}</span></span><span class="source-link-arrow" aria-hidden="true">↗</span><span class="sr-only">，在新标签页打开</span></a></li>`;
}

function sourceChecklist(collectedSources, sources, icons) {
  if (!Array.isArray(collectedSources) || collectedSources.some(id => !supportedSources.has(id))) {
    throw new Error(`report.collectedSources must be an array of supported source IDs: ${[...supportedSources.keys()].join(', ')}`);
  }
  const included = new Set([...collectedSources, ...sources.map(source => source.provider)]);
  const items = [...supportedSources].map(([id, label]) => {
    const checked = included.has(id);
    return `<li class="source-item" data-included="${checked}">${sourceIcon(id, icons)}<span>${label}</span><span class="source-inclusion">${checked ? '已包含' : '未包含'}</span></li>`;
  });
  return `<ul class="source-checklist" aria-label="本报告包含的来源">${items.join('')}</ul>`;
}

function sectionMarkup(section, key, icons, collectedSources, marketHeading, competitorRanks, reviews) {
  requireObject(section, key);
  const { tables = [], sources = [] } = section;
  const text = key === 'evidence' ? undefined : section.text;
  const isMarket = marketHeading !== undefined;
  if (text !== undefined) requireText(text, `${key}.text`);
  if (!Array.isArray(tables) || !Array.isArray(sources) || (!text && !tables.length && !sources.length && !isMarket && key !== 'evidence')) {
    throw new Error(`${key} requires text, tables or sources`);
  }
  const references = sources.map(readSource);
  const links = references.length ? `<ul class="source-links">${references.map(source => sourceMarkup(source, icons)).join('')}</ul>` : '';
  const checklist = key === 'evidence' ? sourceChecklist(collectedSources, [...references, ...(reviews?.sources ?? [])], icons) : '';
  const tableContent = tables.map(table => tableMarkup(table, key, isMarket, competitorRanks)).join('');
  const description = isMarket
    ? (tables.some(table => table.rows.length) ? '' : '<p class="market-empty">暂无可用数据</p>')
    : (text ? `<p>${escapeHtml(text)}</p>` : '');
  const heading = isMarket ? `<h3>${marketHeading}</h3>` : `<h2>${sections[key]}</h2>`;
  return `<section class="report-section" id="${key}">${heading}${description}${tableContent}${reviews?.content ?? ''}${checklist}${links}</section>`;
}

function keywordAdviceMarkup(section, icons) {
  if (section === undefined) return '';
  requireObject(section, 'candidates');
  const { text, recommendations = [], tables = [], sources = [] } = section;
  if (text !== undefined) requireText(text, 'candidates.text');
  if (![recommendations, tables, sources].every(Array.isArray)) {
    throw new Error('candidates requires recommendations, tables and sources to be arrays when provided');
  }
  const cards = recommendations.map(item => {
    requireObject(item, 'keyword recommendation');
    requireText(item.title, 'keyword recommendation.title');
    requireText(item.text, 'keyword recommendation.text');
    return `<li><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.text)}</p></li>`;
  }).join('');
  const note = text ? `<p class="keyword-advice-note">${escapeHtml(text)}</p>` : '';
  const tableContent = tables.map(table => tableMarkup(table, 'candidates', false)).join('');
  const links = sources.map(source => sourceMarkup(readSource(source), icons)).join('');
  if (!cards && !note && !tableContent && !links) return '';
  return `<section class="keyword-advice" id="candidates" aria-labelledby="keyword-advice-title"><h3 id="keyword-advice-title">关键词建议</h3>${note}${cards ? `<ul class="keyword-advice-cards">${cards}</ul>` : ''}${tableContent}${links ? `<ul class="source-links">${links}</ul>` : ''}</section>`;
}

function marketFlag(id) {
  if (!asoMarketLabels.has(id)) return '';
  const svg = readFileSync(new URL(`./aso-report-flags/${id}.svg`, import.meta.url), 'base64');
  return `<img class="market-flag" src="data:image/svg+xml;base64,${svg}" width="18" height="18" alt="">`;
}

function marketCompetitorRanks(data, ids) {
  if (!ids.length) return undefined;
  const byApp = data.competitorRanks ?? {};
  requireObject(byApp, 'market.competitorRanks');
  for (const [id, ranks] of Object.entries(byApp)) {
    if (!ids.includes(id)) throw new Error(`Unknown competitor rank ID: ${id}`);
    requireObject(ranks, `market.competitorRanks.${id}`);
    if (Object.values(ranks).some(rank => rank !== null && typeof rank !== 'string' && !Number.isFinite(rank))) {
      throw new Error('Competitor ranks must be strings, numbers or null');
    }
  }
  return (term, previousRank) => ids.map((id, index) =>
    Object.hasOwn(byApp[id] ?? {}, term) ? byApp[id][term] : (index === 0 ? previousRank : null));
}

function rankedTopics(regions) {
  const topics = new Map();
  for (const { anchor, data, competitorRanks } of regions) {
    const mapping = data.keywordTopics ?? {};
    requireObject(mapping, 'market.keywordTopics');
    for (const [keyword, theme] of Object.entries(mapping)) {
      requireText(keyword, 'market.keywordTopics keyword');
      requireText(theme, 'market.keywordTopics theme');
    }
    for (const table of data.tables ?? []) {
      const columns = table.columns.map(tableLabelText);
      const [keyword, product, competitor] = ['关键词', '本品排名', '竞品排名'].map(label => columns.indexOf(label));
      if ([keyword, product, competitor].includes(-1)) continue;
      for (const row of table.rows) {
        const term = row[keyword];
        if (typeof term !== 'string' || !term.trim()) continue;
        const topic = Object.hasOwn(mapping, term) ? mapping[term] : term;
        if (!topics.has(topic)) topics.set(topic, new Map());
        const results = topics.get(topic);
        if (!results.has(anchor)) results.set(anchor, []);
        results.get(anchor).push({
          term, product: row[product], competitor: row[competitor],
          relatedRanks: competitorRanks?.(term, row[competitor]),
        });
      }
    }
  }
  return topics;
}

function marketMatrix(regions, topics, cards) {
  const columns = regions.map(({ anchor, heading }) =>
    `<th scope="col" id="column-${anchor}" data-market-column="${anchor}"><button type="button" data-market-details="${anchor}" aria-haspopup="dialog" aria-controls="market-details" title="查看原始数据">${heading}<span class="market-detail-arrow" aria-hidden="true">↗</span><span class="sr-only">，查看原始数据</span></button></th>`).join('');
  const rows = Array.from(topics, ([topic, results]) => {
    const cells = regions.map(({ anchor }) => {
      const entries = results.get(anchor);
      const content = entries?.map(({ term, product, competitor, relatedRanks }) =>
        `<div class="market-result"><span class="market-term">${escapeHtml(term)}</span><div class="market-ranks"><span>本品 <b>${escapeHtml(product ?? '—')}</b></span><span>竞品 ${rankMarkup('b', competitor, relatedRanks)}</span></div></div>`).join('');
      return `<td data-market-column="${anchor}"${entries ? ' data-market-result' : ''}>${content ?? '<span class="market-missing">—</span>'}</td>`;
    }).join('');
    return `<tr><th scope="row">${escapeHtml(topic)}</th>${cells}</tr>`;
  }).join('');
  return `<div class="market-matrix" role="region" aria-label="各地区关键词排名" tabindex="0"><table><thead><tr><th scope="col">关键词主题</th>${columns}</tr></thead><tbody>${rows}</tbody></table></div><p class="market-ranking-empty" hidden>所选地区暂无关键词排名</p>
    <dialog id="market-details" class="market-dialog" aria-label="地区原始数据"><form method="dialog"><button class="market-close" type="submit" aria-label="关闭原始数据" autofocus><span aria-hidden="true">×</span></button></form><div class="market-raw">${cards}</div></dialog>
    <noscript><style>.market-matrix,#market-details form{display:none}#market-details{display:block;position:static;width:100%;max-width:none;max-height:none}</style></noscript>`;
}

function marketComparison(evidence, markets, icons, supportsMatrix, competitorIds) {
  if (!Array.isArray(markets)) throw new Error('report.markets must be an array');
  const entries = new Map();
  for (const [id, anchor] of legacyMarkets) {
    if (Object.hasOwn(evidence, anchor)) entries.set(id, evidence[anchor]);
  }
  const ids = new Set();
  for (const market of markets) {
    requireObject(market, 'market');
    const { id, label } = market;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error('market.id must start with a lowercase letter and use only lowercase letters, digits or hyphens');
    }
    if (label !== undefined || !asoMarketLabels.has(id)) requireText(label, 'market.label');
    if (ids.has(id)) throw new Error(`Duplicate market ID: ${id}`);
    ids.add(id);
    entries.set(id, market);
  }
  if (!entries.size) return '';

  const regions = Array.from(entries, ([id, data]) => ({
    anchor: legacyMarkets.get(id) ?? `market-${id}`,
    heading: `${marketFlag(id)}<span>${escapeHtml(asoMarketLabels.get(id) ?? data.label)}</span>`,
    competitorRanks: marketCompetitorRanks(data, competitorIds),
    data,
  }));
  const cards = regions.map(({ anchor, heading, data, competitorRanks }) => sectionMarkup(data, anchor, icons, [], heading, competitorRanks)).join('');
  const topics = supportsMatrix ? rankedTopics(regions) : new Map();
  const buttons = regions.map(({ anchor, heading }) =>
    `<button type="button" aria-controls="${topics.size ? 'column-' : ''}${anchor}" aria-pressed="true">${heading}</button>`).join('');
  const controls = regions.length > 1
    ? `<div class="market-filters" role="group" aria-label="选择对比地区" hidden><button class="market-select-all" type="button" hidden>取消全选</button>${buttons}</div><p class="market-empty market-selection-empty" hidden>请选择要对比的地区</p>`
    : '';
  const content = topics.size
    ? marketMatrix(regions, topics, cards)
    : `<div class="markets" role="region" aria-label="地区对比卡片" tabindex="0">${cards}</div>`;
  return `<section id="markets" aria-labelledby="markets-title"><h2 id="markets-title">多地区对比</h2>${controls}${content}</section>`;
}

function keywordPills(value) {
  return value.split(',').map(keyword => keyword.trim()
    ? `<span class="keyword-pill">${escapeHtml(keyword)}</span>`
    : escapeHtml(keyword)).join('<span class="keyword-delimiter">,</span><wbr>');
}

function fieldUsage({ label, unit, max, count, warning }) {
  const filled = Math.min(count, max);
  const usage = `${count} / ${max} ${unit}`;
  const meter = `<span class="field-meter" role="meter" aria-label="${label}${unit}用量" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${filled}" aria-valuetext="${usage}${warning ? `，${warning}` : ''}" data-outside="${Boolean(warning)}" style="--fill:${filled * 100 / max}%">${usage}</span>`;
  const hint = warning ? `<span class="field-warning">${warning}</span>` : '';
  return `<span class="field-usage">${hint}${meter}</span>`;
}

function fieldMarkup(field, locale) {
  const { id, label, value } = field;
  const keywordList = id === 'keywords' ? ' class="keyword-list"' : '';
  const content = id === 'keywords' ? keywordPills(value) : escapeHtml(value);
  return `<div class="plan-field" data-field="${id}"><dt>${label}${fieldUsage(field)}</dt><dd${keywordList} lang="${locale}">${content}</dd></div>`;
}

function measurePlan(plan) {
  requireObject(plan, 'plan');
  const { locale, scope, valid } = plan;
  requireText(locale, 'plan.locale');
  if (scope !== 'full' && scope !== 'keywords-only') throw new Error('plan.scope must be full or keywords-only');
  if (valid !== undefined && typeof valid !== 'boolean') throw new Error('plan.valid must be a boolean from field validation');
  const fields = scope === 'full' ? fullFields : [keywordField];
  const issues = [];
  const values = fields.map(field => {
    const { id, min, max, unit } = field;
    const value = plan[id];
    requireText(value, `plan.${id}`);
    const count = id === 'keywords' ? Buffer.byteLength(value) : [...value].length;
    const warning = count > max ? '超限' : min !== undefined && count < min ? `至少 ${min} ${unit}` : '';
    if (warning) issues.push({ locale, scope, field: id, count, min, max, unit });
    return { ...field, value, count, warning };
  });
  return { locale, scope, issues, valid: issues.length ? false : valid, fields: values };
}

function planCard({ locale, fields }) {
  const escapedLocale = escapeHtml(locale);
  const language = Object.hasOwn(localeLabels, locale) ? localeLabels[locale] : escapedLocale;
  const values = fields.map(field => fieldMarkup(field, escapedLocale)).join('');
  return `<article class="plan"><div class="plan-top"><h3>${language}</h3></div><dl>${values}</dl></article>`;
}

function planAlternatives(plans) {
  const groups = [
    { scope: 'full', title: '更新商店文案和关键词', description: '使用下方建议的名称、副标题、描述和关键词。' },
    { scope: 'keywords-only', title: '只改关键词', description: '保留商店当前的名称、副标题和描述，只替换下方关键词。' },
  ].map(group => ({ ...group, plans: plans.filter(plan => plan.scope === group.scope) }))
    .filter(group => group.plans.length);
  const tabs = groups.length > 1 ? `<div class="plan-tabs" role="tablist" aria-label="选择元数据方案" hidden>${groups.map(({ scope, title }, index) =>
    `<button type="button" id="tab-${scope}" role="tab" aria-controls="panel-${scope}" aria-selected="${index === 0}"><span>方案${index === 0 ? '一' : '二'}</span>${title}</button>`).join('')}</div>` : '';
  const panels = groups.map(({ scope, title, description, plans: groupPlans }) =>
    `<div class="plan-panel" id="panel-${scope}"><h3 class="plan-panel-title">${title}</h3><p class="plan-description">${description}</p><div class="plans">${groupPlans.map(planCard).join('')}</div></div>`).join('');
  return `${tabs}${panels}`;
}

function reportSections(evidence, markets, recommendations, collectedSources, icons, supportsMatrix, competitorIds, snapshots) {
  const items = [{ id: 'summary', title: '结论' }];
  const body = [];
  const reviews = reviewEvidenceMarkup(snapshots, icons);
  const comparison = marketComparison(evidence, markets, icons, supportsMatrix, competitorIds);
  if (comparison) items.push({ id: 'markets', title: '多地区对比' });
  for (const [key, title] of Object.entries(sections)) {
    const isEvidence = key === 'evidence';
    const hasSection = Object.hasOwn(evidence, key);
    if (!hasSection && !isEvidence) continue;
    const markup = sectionMarkup(hasSection ? evidence[key] : {}, key, icons, collectedSources, undefined, undefined, isEvidence ? reviews : undefined);
    body.push({ id: key, title, markup });
  }
  if (recommendations) body.unshift({
    id: 'plans', title: '商店元数据方案',
    markup: `<section class="report-section" id="plans"><h2>商店元数据方案</h2>${recommendations}</section>`,
  });
  items.push(...body);
  const links = items.map(({ id, title }) => `<li><a href="#${id}">${title}</a></li>`).join('');
  return {
    navigation: `<nav class="report-nav" aria-label="报告目录"><p>报告目录</p><ul>${links}</ul></nav>`,
    content: `${comparison}${body.map(({ markup }) => markup).join('')}`,
  };
}

function chineseDate(value) {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return date ? `${date[1]}年${Number(date[2])}月${Number(date[3])}日` : value;
}

function appIcon(value, field) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${field} must be a PNG, JPEG or WebP base64 data URL`);
  }
  return `<img class="report-app-icon" src="${escapeHtml(value)}" alt="">`;
}

function readComparisonApps(apps) {
  if (!Array.isArray(apps)) throw new Error('report.comparisonApps must be an array');
  const ids = new Set();
  return apps.flatMap(app => {
    requireObject(app, 'comparison app');
    const { id, name, url, icon, role = 'competitor' } = app;
    if (role === 'reference') return [];
    if (role !== 'competitor') throw new Error('comparisonApps.role must be competitor');
    if (id !== undefined) {
      requireText(id, 'comparisonApps.id');
      if (ids.has(id)) throw new Error(`Duplicate competitor ID: ${id}`);
      ids.add(id);
    }
    const { url: appUrl } = readSource({ title: name, url });
    if (appUrl.protocol !== 'https:' || appUrl.hostname !== 'apps.apple.com') {
      throw new Error('comparisonApps.url must be an App Store HTTPS link');
    }
    return [{ id, name, appUrl, icon }];
  });
}

function comparisonAppMarkup(apps, switchable) {
  const items = apps.map(({ name, appUrl, icon }, index) => {
    const content = `${appIcon(icon, 'comparisonApps.icon')}<span class="comparison-app-name">${escapeHtml(name)}</span>`;
    const href = `href="${escapeHtml(appUrl.href)}" target="_blank" rel="noopener noreferrer"`;
    if (!switchable) return `<li><a class="comparison-app" ${href}>${content}<span class="sr-only">，在新标签页打开</span></a></li>`;
    return `<li class="comparison-app-option"><button type="button" class="comparison-app" data-competitor-index="${index}" aria-pressed="${index === 0}">${content}</button><a class="competitor-store-link" ${href} aria-label="在新标签页查看 ${escapeHtml(name)} 的 App Store 页面" title="打开 App Store">↗</a></li>`;
  }).join('');
  return items ? `<div class="comparison-apps"><p id="comparison-apps-title">竞品</p><ul aria-labelledby="comparison-apps-title">${items}</ul></div>` : '';
}

function reportMarkup(report, sourceIcons, { supportsMatrix, supportsCompetitorSwitch, snapshots }) {
  requireObject(report, 'report');
  const { product, productIcon, comparisonApps = [], researchedAt, status, summary, dataDate, appId, sections: evidence = {}, markets = [], plans = [], collectedSources = [] } = report;
  requireText(product, 'report.product');
  requireText(researchedAt, 'report.researchedAt');
  requireText(summary, 'report.summary');
  const apps = readComparisonApps(comparisonApps);
  const competitorIds = supportsCompetitorSwitch && apps.length > 1 && apps.every(app => app.id !== undefined)
    ? apps.map(app => app.id)
    : [];
  if (!reportStatuses.has(status)) {
    throw new Error('report.status must be validated, provisional or blocked');
  }
  requireObject(evidence, 'report.sections');
  for (const key of Object.keys(evidence)) {
    if (['candidates', 'limitations', 'monitoring'].includes(key) || [...legacyMarkets.values()].includes(key)) continue;
    if (!Object.hasOwn(sections, key)) throw new Error(`Unknown ASO report section: ${key}`);
  }
  if (!Array.isArray(plans)) throw new Error('report.plans must be an array');
  const measuredPlans = plans.map(measurePlan);
  const limitIssues = measuredPlans.flatMap(plan => plan.issues);
  const planIds = new Set(plans.map(plan => `${plan.locale}/${plan.scope}`));
  if (planIds.size !== plans.length) throw new Error('Each locale and plan scope combination must be unique');
  if (status === 'validated' && limitIssues.length) {
    const fields = limitIssues.map(({ locale, scope, field, count, min, max }) => `${locale}/${scope}.${field}: ${count} (allowed ${min ?? 1}–${max})`);
    throw new Error(`A validated report requires field validation to pass. Invalid field lengths: ${fields.join(', ')}`);
  }
  if (status === 'validated' && (!measuredPlans.length || measuredPlans.some(plan => plan.valid !== true))) {
    throw new Error('A validated report requires field validation to pass for every plan');
  }
  const meta = [['调研日期', researchedAt], ['数据日期', dataDate], ['应用 ID', appId]]
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => {
      requireText(value, label);
      return `<div><dt>${label}</dt><dd>${escapeHtml(label === '应用 ID' ? value : chineseDate(value))}</dd></div>`;
    }).join('');
  const { navigation, content } = reportSections(evidence, markets, planAlternatives(measuredPlans), collectedSources, sourceIcons, supportsMatrix, competitorIds, snapshots);
  const advice = keywordAdviceMarkup(evidence.candidates, sourceIcons);
  return {
    title: `${escapeHtml(product)} · App Store 优化报告`,
    limitIssues,
    content: `<header class="report-header"><div class="report-heading"><p class="report-kind">${sourceIcon('app-store', sourceIcons)}App Store 优化报告</p><h1>${appIcon(productIcon, 'report.productIcon')}${escapeHtml(product)}</h1></div><dl class="meta">${meta}</dl>${comparisonAppMarkup(apps, competitorIds.length > 1)}</header>
    <div class="report-layout">${navigation}<div class="report-body"><section class="report-section" id="summary" aria-labelledby="summary-title"><h2 id="summary-title">结论</h2><div class="summary-statement"><span class="summary-quote" aria-hidden="true">“</span><p>${escapeHtml(summary)}</p></div>${advice}</section>${content}</div></div>`,
  };
}

function reviewEvidenceMarkup(snapshots, icons) {
  if (!snapshots.length) return undefined;
  const available = snapshots.filter(({ reviews }) => reviews.length > 0);
  if (!available.length) return { content: '<p class="market-empty">暂无可查看的 App Store 评论</p>' };
  const sources = [];
  const buttons = [];
  const panels = available.map(snapshot => {
    const { country, reviews } = snapshot;
    const label = asoMarketLabels.get(country) ?? country.toUpperCase();
    const id = 'review-market-' + country;
    buttons.push(`<button type="button" aria-controls="${id}" aria-pressed="true">${marketFlag(country)}<span>${escapeHtml(label)}</span></button>`);
    const title = '评论样本 · ' + label;
    const source = readSource({ title: 'App Store 公开评论（' + country.toUpperCase() + '）', url: snapshot.url });
    sources.push(source);
    const table = tableMarkup({
      columns: ['评论日期', '星级', '标题', '原文'],
      rows: reviews.map(review => [review.date.slice(0, 10), review.rating, review.title, review.text]),
    }, 'evidence', false);
    return `<section class="review-market" id="${id}" aria-label="${escapeHtml(title)}">${table}<ul class="source-links">${sourceMarkup(source, icons)}</ul></section>`;
  }).join('');
  const bulk = available.length > 1 ? '<button class="market-select-all" type="button" aria-controls="review-markets">取消全选</button>' : '';
  const filters = `<div class="review-filters" hidden><p id="review-filters-title">评论地区</p><div class="market-filters" role="group" aria-labelledby="review-filters-title">${bulk}${buttons.join('')}</div></div>`;
  return { sources, content: `${filters}<div id="review-markets">${panels}<p class="market-selection-empty" role="status" hidden>请选择要查看的评论地区</p></div>` };
}

function reviewAppId(report, snapshots) {
  if (!snapshots.length) return report;
  requireObject(report, 'report');
  const appId = report.appId ?? snapshots[0].appId;
  if (snapshots.some(snapshot => snapshot.appId !== appId)) {
    throw new Error('App Store review snapshots must match the report App ID');
  }
  if (new Set(snapshots.map(snapshot => snapshot.country)).size !== snapshots.length) {
    throw new Error('Use one App Store review snapshot per region');
  }
  return { ...report, appId };
}

export async function writeAsoReport({ action, data, out, template, appStoreReviews }) {
  const outPath = path.resolve(out);
  if (path.extname(outPath).toLowerCase() !== '.html') throw new Error('--out must name an HTML file');
  const source = await fs.readFile(template ?? bundledTemplate, 'utf8');
  let html = source;
  let status;
  let reviewRegions;
  let limitIssues = [];
  if (action === 'render') {
    const input = JSON.parse(await fs.readFile(data, 'utf8'));
    const files = [appStoreReviews ?? []].flat();
    const snapshots = await Promise.all(files.map(readAppStoreReviews));
    const report = reviewAppId(input, snapshots);
    const sourceIcons = new Map(await Promise.all([...sourceDomains.keys()].map(async id => [
      id, await fs.readFile(new URL(`./aso-report-icons/${id}.png`, import.meta.url), 'base64'),
    ])));
    const { title, content, limitIssues: issues } = reportMarkup(report, sourceIcons, {
      supportsMatrix: source.includes(marketMatrixMarker),
      supportsCompetitorSwitch: source.includes(competitorSwitchMarker),
      snapshots,
    });
    limitIssues = issues;
    for (const placeholder of ['{{ASO_TITLE}}', '{{ASO_CONTENT}}']) {
      if (source.split(placeholder).length !== 2) throw new Error(`Template requires exactly one ${placeholder}`);
    }
    if (source.includes(generatedMarker)) throw new Error('Use an ASO template, not a generated report');
    const styledSource = await resolveRatingAsset(source, content);
    html = `${generatedMarker}\n${styledSource.replace(/\{\{ASO_(TITLE|CONTENT)\}\}/g, (_, key) => key === 'TITLE' ? title : content)}`;
    status = report.status;
    if (snapshots.length) {
      reviewRegions = snapshots.map(({ country, status, reason, reviews }) => ({
        country, status, reason, comments: reviews.length, visible: reviews.length > 0,
      }));
    }
  }
  await withFileLock(`${outPath}.aso-report.lock`, async () => {
    const stat = await fs.lstat(outPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (stat && (action === 'template' || !stat.isFile() ||
      !(await fs.readFile(outPath, 'utf8')).startsWith(generatedMarker))) {
      throw new Error(`Refusing to overwrite existing HTML: ${outPath}`);
    }
    await atomicWriteText(outPath, html);
  });
  return {
    ok: true, out: outPath,
    ...(status === undefined ? {} : { status }),
    ...(reviewRegions ? { reviewRegions } : {}),
    ...(limitIssues.length ? { limitIssues } : {}),
  };
}
