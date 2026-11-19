import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml as html } from './html-artifact-utils.js';
import { atomicWriteText, withFileLock } from './kernel/atomic-store.js';

const bundledTemplate = new URL('./social-report-template.html', import.meta.url);
const marker = '<!-- OPEN VIBECODING: SOCIAL LISTENING REPORT -->';
const moods = [
  { id: 'positive', value: '积极', label: '开心', css: 'pos', avatar: 'happy' },
  { id: 'neutral', value: '中立', label: '中立', css: 'neu', avatar: 'neutral' },
  { id: 'negative', value: '消极', label: '负面', css: 'neg', avatar: 'negative' },
];
const unclassified = { id: 'unclassified', label: '未分类', value: '未分类' };
const moodById = new Map([...moods, unclassified].map(mood => [mood.id, mood]));
export const platformLabels = Object.freeze({
  xiaohongshu: '小红书', douyin: '抖音', wechat_channels: '视频号', kuaishou: '快手', 'app-store': 'App Store',
});
const sourceStates = new Map([
  ['available', ''], ['partial', '部分采集'], ['login_required', '需要登录'],
  ['credential_required', '缺少凭证'], ['configuration_required', '尚未配置'],
  ['rate_limited', '采集受限'], ['unavailable', '暂无可用数据'], ['not_selected', '未采集'],
]);
const tones = new Map([['positive', 'support'], ['neutral', 'mixed'], ['negative', 'concern']]);

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return value;
}

function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be non-empty text`);
  return value.trim();
}

function list(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function imageUrl(value, field) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error(`${field} must be a PNG, JPEG or WebP base64 data URL`);
  }
  return value;
}

function platformIcon(platform) {
  if (platform.icon) return `<img class="platform-icon" src="${platform.icon}" alt="">`;
  return `<span class="platform-placeholder" aria-hidden="true">${html([...platform.label][0])}</span>`;
}

function readPlatforms(report) {
  const platforms = new Map();
  for (const item of list(report.platforms, 'platforms')) {
    const platform = object(item, 'platform');
    const id = text(platform.id, 'platform.id');
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || platforms.has(id)) throw new Error(`Invalid or duplicate platform: ${id}`);
    const defaultLabel = Object.hasOwn(platformLabels, id) ? platformLabels[id] : undefined;
    const label = text(platform.label ?? defaultLabel, 'platform.label');
    if ([...platforms.values()].some(entry => entry.label === label)) throw new Error(`Duplicate platform label: ${label}`);
    const status = platform.status ?? 'available';
    if (!sourceStates.has(status)) throw new Error(`Unknown platform status for ${id}`);
    const summary = platform.summary === undefined ? '' : text(platform.summary, `${id}.summary`);
    platforms.set(id, { label, status, summary, icon: imageUrl(platform.icon, `${id}.icon`) });
  }
  return platforms;
}

function readComments(report, platforms) {
  return list(report.comments, 'comments').map((entry, index) => {
    const field = `comments[${index}]`;
    const comment = object(entry, field);
    const platform = platforms.get(comment.platform);
    if (!platform) throw new Error(`${field}.platform must match a platform id`);
    const mood = moodById.get(comment.sentiment ?? 'unclassified');
    if (!mood) throw new Error(`${field}.sentiment is unknown`);
    const body = text(comment.text, `${field}.text`);
    const source = httpSource(comment.url, `${field}.url`);
    const topic = comment.topic === undefined ? '' : text(comment.topic, `${field}.topic`);
    const sourceTitle = comment.sourceTitle === undefined ? '' : text(comment.sourceTitle, `${field}.sourceTitle`);
    const { rating, date } = comment;
    if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
      throw new Error(`${field}.rating must be an integer from 1 to 5`);
    }
    if (date !== undefined && (typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) {
      throw new Error(`${field}.date must be a valid date`);
    }
    return { platform: comment.platform, topic, sourceTitle, body, source, mood, rating, date };
  });
}

function httpSource(value, field) {
  if (value === undefined) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {
    // Both malformed and unsupported URLs produce the same actionable error.
  }
  throw new Error(`${field} must be an HTTP or HTTPS URL`);
}

function wordData(report, size) {
  const words = list(report.wordCloud?.terms, 'wordCloud.terms');
  if (words.length > 24) throw new Error('wordCloud.terms supports at most 24 entries');
  const seen = new Set();
  const terms = words.map(entry => {
    const item = object(entry, 'wordCloud term');
    const word = text(item.word, 'wordCloud word');
    const commentRows = list(item.commentRows, 'wordCloud.commentRows');
    if (seen.has(word) || [...word].length > 18) throw new Error(`Invalid or duplicate word: ${word}`);
    seen.add(word);
    if ([...new Set(commentRows)].length !== commentRows.length ||
      commentRows.some(row => !Number.isInteger(row) || row < 1 || row > size)) {
      throw new Error(`wordCloud.commentRows must reference unique 1-based comment rows: ${word}`);
    }
    const ratio = item.ratio ?? commentRows.length / size;
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new Error(`wordCloud ratio must be between 0 and 1: ${word}`);
    return { word, ratio, commentRows };
  });
  return JSON.stringify({ sampleSize: size, terms }).replaceAll('<', '\\u003c');
}

function headerMarkup(product, date, icon) {
  const image = icon ? `<img class="product-icon" src="${icon}" alt="">` : '';
  return `<header class="panel report-header"><div><p class="report-kind">产品社媒分析报告</p><h1>${image}${html(product)}</h1></div>
  <dl class="report-date"><dt>查询日期</dt><dd><time datetime="${date}">${date}</time></dd></dl></header>`;
}

function moodTiles(comments, avatars) {
  const counts = new Map(moods.map(mood => [mood.id, 0]));
  for (const { mood } of comments) {
    if (counts.has(mood.id)) counts.set(mood.id, counts.get(mood.id) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const breakdown = moods.map(mood => {
    const count = counts.get(mood.id);
    return { ...mood, count, ratio: total ? `${(100 * count / total).toFixed(1).replace(/\.0$/, '')}%` : '—' };
  });
  const tiles = breakdown.map(mood => {
    const avatar = avatars ? `<img class="mood-avatar" src="${avatars.get(mood.id)}" alt="">` : '';
    return `<span class="mood-tile" data-emotion="${mood.value}" title="${mood.label} ${mood.count} 条">${avatar}<span>${mood.label}</span> <b>${mood.ratio}</b></span>`;
  }).join('');
  const bars = breakdown.filter(mood => mood.count)
    .map(mood => `<span class="${mood.css}" style="flex:${mood.count}"></span>`).join('');
  const label = breakdown.map(mood => `${mood.label} ${mood.ratio}`).join('，');
  return { tiles, total, bar: `<div class="bar" role="img" aria-label="${label}">${bars}</div>` };
}

function sentimentMarkup(platforms, comments, avatars) {
  const byPlatform = new Map([...platforms.keys()].map(id => [id, []]));
  for (const comment of comments) byPlatform.get(comment.platform).push(comment);
  const cards = [...platforms].map(([id, platform]) => {
    const { tiles, bar } = moodTiles(byPlatform.get(id));
    const status = sourceStates.get(platform.status);
    return `<article class="mood-platform"><h4 class="platform-heading" data-label="${html(platform.label)}">${platformIcon(platform)}${html(platform.label)}</h4>${status ? `<span class="source-status">${status}</span>` : ''}
    ${platform.summary ? `<p>${html(platform.summary)}</p>` : ''}${bar}<div class="mood-splits">${tiles}</div></article>`;
  }).join('');
  const { tiles, total } = moodTiles(comments, avatars);
  const coverage = total < comments.length ? `<small class="mood-scope">已分类 ${total}/${comments.length}</small>` : '';
  return `<section class="panel mood-section" id="sentiment" aria-labelledby="sentiment-title">
  <div class="mood-overall"><h2 id="sentiment-title">整体情绪${coverage}</h2><div class="mood-overview">${tiles}</div></div>
  ${cards ? `<h3>各平台情绪</h3><div class="mood-platforms">${cards}</div>` : ''}</section>`;
}

function findingsMarkup(report) {
  const concerns = list(report.concerns, 'concerns').map(item =>
    `<li><span class="attention-topic">${html(text(item.category, 'concern.category'))}</span><div><h4>${html(text(item.title, 'concern.title'))}</h4><p>${html(text(item.text, 'concern.text'))}</p></div></li>`).join('');
  const highlights = list(report.highlights, 'highlights').map(item =>
    `<div><strong>${html(text(item.title, 'highlight.title'))}</strong><p>${html(text(item.text, 'highlight.text'))}</p></div>`).join('');
  return `<section class="overview" aria-label="报告总览"><article class="panel lead" aria-labelledby="viewpoint">
  <h2 id="viewpoint">核心观点</h2><div class="lead-statement"><span class="quote-mark" aria-hidden="true">“</span><p>${html(text(report.summary, 'summary'))}</p></div>
  ${concerns ? `<section class="attention" aria-labelledby="attention-title"><h3 id="attention-title">值得关注的情况</h3><ul class="attention-list">${concerns}</ul></section>` : ''}
  </article><article class="panel word-cloud"><section aria-labelledby="word-cloud-title"><h2 id="word-cloud-title">用户常提到的词</h2><div class="cloud-words is-flowing" id="cloud-words"></div></section>
  ${highlights ? `<section class="highlights" aria-labelledby="highlight-title"><h2 id="highlight-title">核心亮点</h2><div class="highlight-list">${highlights}</div></section>` : ''}</article></section>`;
}

function comparisonMarkup(report, platforms) {
  const rows = list(report.comparison, 'comparison');
  if (!rows.length || !platforms.size) return '';
  const headings = [...platforms.values()].map(platform =>
    `<th scope="col"><span class="platform-heading">${platformIcon(platform)}${html(platform.label)}</span></th>`).join('');
  const body = rows.map(entry => {
    const topic = html(text(entry.topic, 'comparison.topic'));
    const views = new Map(Object.entries(object(entry.views, 'comparison.views')));
    for (const id of views.keys()) if (!platforms.has(id)) throw new Error(`Unknown comparison platform: ${id}`);
    const cells = [...platforms.keys()].map(id => {
      const view = views.get(id);
      if (!view) return '<td>—</td>';
      const copy = html(text(view.text, 'comparison view text'));
      const tone = tones.get(view.tone ?? 'neutral');
      if (!tone) throw new Error('Comparison tone must be positive, neutral or negative');
      return `<td><div class="matrix-cell" title="${copy}"><span class="cell-summary ${tone}"><span class="cell-text">${copy}</span></span></div></td>`;
    }).join('');
    return `<tr><th scope="row">${topic}</th>${cells}</tr>`;
  }).join('');
  return `<section class="panel matrix" id="compare"><div class="section-head"><h2>同一主题，各平台怎么说</h2></div>
  <div class="table-scroll"><table><thead><tr><th scope="col">讨论主题</th>${headings}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function picker(id, label, values, mode) {
  const multiple = mode === 'multi' ? ' multiple' : '';
  const search = mode === 'search' ? `<div class="filter-search"><input type="search" aria-label="搜索${label}" placeholder="搜索${label}" aria-controls="${id}-options" autocomplete="off"></div>` : '';
  const options = values.map(([value, label]) => `<option value="${html(value)}">${html(label)}</option>`).join('');
  return `<div class="filter"><select id="${id}"${multiple} hidden><option value="">全部</option>${options}</select>
  <button type="button" class="filter-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-options"><span class="filter-name">${label}</span><span class="filter-value">全部</span><span class="filter-chevron" aria-hidden="true"></span></button>
  <div class="filter-menu" id="${id}-menu" hidden>${search}<div class="filter-options" id="${id}-options" role="listbox" aria-label="${label}"${multiple ? ' aria-multiselectable="true"' : ''}></div>${search ? '<div class="filter-empty" role="status" hidden>没有匹配选项</div>' : ''}</div></div>`;
}

function commentMarkup(comment, platform) {
  const topic = html(comment.topic || '');
  const title = html(comment.sourceTitle || '');
  const source = comment.source ? `<a href="${html(comment.source)}" target="_blank" rel="noopener noreferrer">${title || '来源'}</a>` : title;
  const metadata = [
    topic, comment.rating === undefined ? '' : `${comment.rating} 星`, html(comment.date?.slice(0, 10) ?? ''),
  ].filter(Boolean).map(value => `<span>${value}</span>`).join('');
  return `<li data-p="${html(platform.label)}" data-t="${topic}" data-e="${comment.mood.value}"><div class="message"><div class="message-head">
  <span class="message-platform"><span class="message-icon">${platformIcon(platform)}</span><strong>${html(platform.label)}</strong></span>
  <span class="quote-meta emotion-tag">${comment.mood.label}</span></div><blockquote>${html(comment.body)}</blockquote>
  <div class="message-meta">${metadata}${source ? `<span class="quote-source" title="${title}">${source}</span>` : ''}</div></div></li>`;
}

function commentsMarkup(comments, platforms, csv) {
  const topics = [...new Set(comments.map(comment => comment.topic).filter(Boolean))].map(value => [value, value]);
  const moodsForFilter = comments.some(comment => comment.mood === unclassified) ? [...moods, unclassified] : moods;
  const controls = [
    picker('platform', '平台', [...platforms.values()].map(platform => [platform.label, platform.label]), 'multi'),
    picker('topic', '主题', topics, 'search'),
    picker('emotion', '情绪', moodsForFilter.map(mood => [mood.value, mood.label]), 'multi'),
    picker('keyword', '关键词', [], 'search'),
  ].join('');
  const exportLink = csv ? `<a class="export" href="data:text/csv;base64,${csv.toString('base64')}" download="product_reviews_detail.csv"><span class="export-icon" aria-hidden="true">↓</span><span>下载 CSV</span></a>` : '';
  const cards = comments.map(comment => commentMarkup(comment, platforms.get(comment.platform))).join('');
  return `<section class="panel evidence" id="comments" aria-labelledby="comment-heading">
  <div class="evidence-top"><div class="evidence-title"><h2 id="comment-heading">评论原文</h2><output class="match-count" id="match-count" aria-live="polite">${comments.length} 条评论</output></div>${exportLink}</div>
  <div class="controls">${controls}<button type="button" class="reset-filters" id="reset-filters" hidden>清除筛选</button></div>
  <div class="message-stream" id="message-stream" tabindex="0" role="region" aria-label="评论列表"><ul class="quotes">${cards}</ul>
  <p class="message-empty" id="message-empty"${cards ? ' hidden' : ''}>${cards ? '暂无符合条件的评论' : '暂无评论原文'}</p></div></section>`;
}

export async function writeSocialReport({ action, data, out, template, csv }) {
  const outPath = path.resolve(out);
  if (path.extname(outPath).toLowerCase() !== '.html') throw new Error('--out must name an HTML file');
  const source = await fs.readFile(template ?? bundledTemplate, 'utf8');
  let output = source;
  let commentCount;
  if (action === 'render') {
    const report = object(JSON.parse(await fs.readFile(data, 'utf8')), 'report');
    const product = text(report.product, 'product');
    const date = text(report.queriedAt, 'queriedAt');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toJSON()?.slice(0, 10) !== date) {
      throw new Error('queriedAt must be a valid YYYY-MM-DD date');
    }
    const platforms = readPlatforms(report);
    const comments = readComments(report, platforms);
    commentCount = comments.length;
    const avatars = new Map(await Promise.all(moods.map(async ({ id, avatar }) => [
      id, `data:image/png;base64,${await fs.readFile(new URL(`./social-report-avatars/${avatar}.png`, import.meta.url), 'base64')}`,
    ])));
    const substitutions = {
      TITLE: `${html(product)} · 产品社媒分析报告`,
      CONTENT: [
        headerMarkup(product, date, imageUrl(report.productIcon, 'productIcon')),
        sentimentMarkup(platforms, comments, avatars),
        findingsMarkup(report),
        comparisonMarkup(report, platforms),
        commentsMarkup(comments, platforms, csv ? await fs.readFile(csv) : null),
      ].join('\n'),
      WORDS: wordData(report, commentCount),
    };
    if (source.startsWith(marker)) throw new Error('Use a social report template, not a generated report');
    for (const key of Object.keys(substitutions)) {
      const token = `{{SOCIAL_${key}}}`;
      if (source.split(token).length !== 2) throw new Error(`Template requires exactly one ${token}`);
    }
    output = `${marker}\n${source.replace(/\{\{SOCIAL_(TITLE|CONTENT|WORDS)\}\}/g, (_, key) => substitutions[key])}`;
  }
  await withFileLock(`${outPath}.social-report.lock`, async () => {
    const stat = await fs.lstat(outPath).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (stat && (action === 'template' || !stat.isFile() ||
      !(await fs.readFile(outPath, 'utf8')).startsWith(marker))) {
      throw new Error(`Refusing to overwrite existing HTML: ${outPath}`);
    }
    await atomicWriteText(outPath, output);
  });
  return { ok: true, out: outPath, ...(commentCount === undefined ? {} : { comments: commentCount, csv: Boolean(csv) }) };
}
