import fs from 'node:fs/promises';
import path from 'node:path';
import { escapeHtml } from './html-artifact-utils.js';
import { atomicWriteText, withFileLock } from './kernel/atomic-store.js';
import { date, renderDataCard, text } from './funnel-report-cards.js';

const templateFile = new URL('./funnel-report-template.html', import.meta.url);
const generatedMarker = '<!-- OPEN-VIBECODING:FUNNEL-REPORT -->';
const number = new Intl.NumberFormat('zh-CN');
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });

function renderMetrics(metrics = []) {
  if (!Array.isArray(metrics)) throw new Error('metrics must be an array');
  return metrics.map((metric, i) => {
    const label = escapeHtml(text(metric?.label, `metrics[${i}].label`));
    const value = metric.value === null ? '—' : escapeHtml(text(metric.value, `metrics[${i}].value`));
    const detail = metric.detail === undefined ? '' : escapeHtml(text(metric.detail, `metrics[${i}].detail`));
    return metricCard(label, value, detail);
  });
}

function metricCard(label, value, detail) {
  return `<article class="metric-card"><h3>${label}</h3><strong>${value}</strong>${detail ? `<p>${detail}</p>` : ''}</article>`;
}

function renderFunnel(report, { field = '', title = '流程漏斗', note = '' } = {}) {
  const prefix = field ? `${field}.` : '';
  if (!Array.isArray(report.steps) || report.steps.length < 2) throw new Error(`${prefix}steps must contain at least two labels`);
  const steps = report.steps.map((label, i) => text(label, `${prefix}steps[${i}]`));
  if (new Set(steps).size !== steps.length) throw new Error(`${prefix}steps must have unique labels`);
  if (!Array.isArray(report.groups) || !report.groups.length) throw new Error(`${prefix}groups must contain at least one group`);

  const findings = [];
  const metrics = [];
  const rows = [];
  const groups = new Set();
  const charts = report.groups.map((group, index) => {
    const location = `${prefix}groups[${index}]`;
    const label = text(group?.label, `${location}.label`);
    if (groups.has(label)) throw new Error(`${location}.label must be unique`);
    groups.add(label);
    const counts = group.counts;
    if (!Array.isArray(counts) || counts.length !== steps.length) {
      throw new Error(`${location}.counts must contain one value per step`);
    }
    let lastKnown = Infinity;
    for (const count of counts) {
      if (count === null) continue;
      if (!Number.isSafeInteger(count) || count < 0 || count > lastKnown) {
        throw new Error(`${location}.counts must be non-negative, non-increasing integers or null`);
      }
      lastKnown = count;
    }

    const total = counts[0];
    const last = counts.at(-1);
    const escapedLabel = escapeHtml(label);
    const completion = total > 0 && last !== null ? percent.format(last / total) : '—';
    const countText = count => count === null ? '—' : `${number.format(count)} 人`;
    const metricLabel = field ? `${escapeHtml(title)} · ${escapedLabel}` : escapedLabel;
    metrics.push(metricCard(`${metricLabel} · 全流程完成率`, completion, `${countText(last)}完成 / ${countText(total)}进入`));

    let largestLoss = 0;
    let largestStep = 0;
    let hasMissingTransitions = false;
    const stages = counts.map((count, i) => {
      const previous = i > 0 ? counts[i - 1] : null;
      const loss = count === null || previous === null ? null : previous - count;
      if (i > 0 && loss === null) hasMissingTransitions = true;
      if (loss > largestLoss) {
        largestLoss = loss;
        largestStep = i;
      }
      const rate = loss !== null && previous > 0 ? percent.format(loss / previous) : '—';
      const detail = i === 0 ? '' : (loss === null ? '流失未知' : `流失 ${number.format(loss)} 人 · ${rate}`);
      const width = total > 0 && count !== null ? count / total * 100 : null;
      return { title: escapeHtml(steps[i]), count: countText(count), detail, width };
    });
    if (largestStep) {
      const route = escapeHtml(`${steps[largestStep - 1]} → ${steps[largestStep]}`);
      const qualifier = hasMissingTransitions ? '已知流失最多' : '流失最多';
      const rate = percent.format(largestLoss / counts[largestStep - 1]);
      findings.push(`<li><strong>${escapedLabel}</strong> · ${qualifier}在「${route}」，${number.format(largestLoss)} 人（${rate}）</li>`);
    } else {
      const finding = hasMissingTransitions ? '部分步骤人数未知，无法定位主要流失。' :
        total === 0 ? '起点人数为零，无法计算完成率。' : '各步到达人数相同，未观察到流失。';
      findings.push(`<li><strong>${escapedLabel}</strong> · ${finding}</li>`);
    }
    const cells = stages.map(stage => `<td><strong${stage.count === '—' ? '' : ' class="step-count"'}>${stage.count}</strong>${stage.detail ? `<span class="loss">${stage.detail}</span>` : ''}</td>`).join('');
    rows.push(`<tr><th scope="row">${escapedLabel}</th>${cells}</tr>`);
    const chart = stages.map(({ title, count, detail, width }) => {
      const band = width === null ? '<span class="band-unavailable"></span>' :
        `<span class="band" style="--share:${width}%"></span>`;
      return `<li>${detail ? `<p class="transition">↓ <span>${detail}</span></p>` : ''}<p class="stage-label"><span>${title}</span><strong>${count}</strong></p><div class="band-track" aria-hidden="true">${band}</div></li>`;
    }).join('');
    return `<article class="funnel-card"><h3>${escapedLabel}</h3><ol class="funnel-stages">${chart}</ol></article>`;
  });
  const columns = steps.map(step => `<th scope="col">${escapeHtml(step)}</th>`).join('');
  const chart = `<h2>${escapeHtml(title)}</h2>${note}<p class="caption">各组以第一步到达人数为基准显示宽度。</p><div class="funnel-grid">${charts.join('')}</div>`;
  const details = `<div class="table-wrap" tabindex="0"><table><thead><tr><th scope="col">分组</th>${columns}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  return {
    groups: groups.size,
    steps: steps.length,
    findings,
    metrics,
    chart: field
      ? `<section>${chart}<h3 class="card-detail">步骤明细</h3>${details}</section>`
      : `<section>${chart}</section>\n<section><h2>步骤明细</h2>${details}</section>`,
  };
}

function renderCards(value = []) {
  if (!Array.isArray(value)) throw new Error('cards must be an array');
  return value.map((card, i) => {
    const field = `cards[${i}]`;
    const type = text(card?.type, `${field}.type`);
    const title = text(card.title, `${field}.title`);
    const note = card.note === undefined ? '' : `<p class="caption">${escapeHtml(text(card.note, `${field}.note`))}</p>`;
    if (type === 'funnel') return renderFunnel(card, { field, title, note });
    const details = renderDataCard(card, type, title, field);
    const heading = `<h2>${escapeHtml(title)}</h2>`;
    const header = type === 'cohort'
      ? `<div class="card-heading">${heading}<time datetime="${card.asOf}">截至 ${card.asOf}</time></div>` : heading;
    return { metrics: [], chart: `<section>${header}${note}${details}</section>` };
  });
}

function dateRangeMarkup(range) {
  const start = date(range?.start, 'dateRange.start');
  const end = date(range?.end, 'dateRange.end');
  if (end < start) throw new Error('dateRange.end cannot be earlier than dateRange.start');
  const includeYear = range.start.slice(0, 4) !== range.end.slice(0, 4);
  const format = (value) => {
    const [year, month, day] = value.split('-');
    return `<time datetime="${value}">${includeYear ? `${year} 年 ` : ''}${Number(month)} 月 ${Number(day)} 日</time>`;
  };
  return `<p class="report-period">${format(range.start)}${end === start ? '' : ` — ${format(range.end)}`}</p>`;
}

function reportHeader(report, product, title) {
  const scope = escapeHtml(text(report.scope, 'scope'));
  const icon = report.productIcon;
  if (icon !== undefined && (typeof icon !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(icon))) {
    throw new Error('productIcon must be an embedded PNG, JPEG or WebP image');
  }
  const image = icon ? `<img class="report-product-icon" src="${icon}" alt="">` : '';
  const zone = report.timezone === undefined ? '' :
    `<div><dt>时区</dt><dd>${escapeHtml(text(report.timezone, 'timezone'))}</dd></div>`;
  let cutoff = '';
  if (report.asOf !== undefined) {
    date(report.asOf, 'asOf');
    cutoff = `<div><dt>截至</dt><dd><time datetime="${report.asOf}">${report.asOf}</time></dd></div>`;
  }
  const context = report.context === undefined ? '' : `<p class="report-context">${escapeHtml(text(report.context, 'context'))}</p>`;
  const metadata = report.dateRange === undefined
    ? `<dl class="report-scope"><div><dt>统计范围</dt><dd>${scope}</dd></div>${zone}${cutoff}</dl>`
    : dateRangeMarkup(report.dateRange);
  return `<header class="report-header"><div class="report-identity">${image}<div><p class="report-kind">${title}</p><h1>${product}</h1></div></div>
${metadata}${context}</header>`;
}

function renderReport(report) {
  const product = escapeHtml(text(report?.product, 'product'));
  const title = escapeHtml(text(report.title, 'title'));
  const header = reportHeader(report, product, title);
  const metrics = renderMetrics(report.metrics);
  const analyses = renderCards(report.cards);
  const funnel = report.steps === undefined && report.groups === undefined && (metrics.length || analyses.length)
    ? null : renderFunnel(report);
  const cards = [...metrics, ...(funnel?.metrics ?? []), ...analyses.flatMap((card) => card.metrics)];
  const next = report.nextSteps ?? [];
  if (!Array.isArray(next)) throw new Error('nextSteps must be an array');
  const legacyNotes = next.map((item, i) => text(item, `nextSteps[${i}]`));
  const summary = escapeHtml(report.summary === undefined && funnel && !analyses.length
    ? legacyNotes.join(' ') : text(report.summary, 'summary'));
  const findings = funnel?.findings ?? [];
  return {
    title: `${product} · ${title}`,
    content: `${header}
${summary || findings.length ? `<section><h2>总结</h2>${summary ? `<blockquote class="lead"><span aria-hidden="true">“</span><p>${summary}</p></blockquote>` : ''}${findings.length ? `<ul class="findings">${findings.join('')}</ul>` : ''}</section>` : ''}
${cards.length ? `<section><h2>关键指标</h2><div class="metric-grid">${cards.join('')}</div></section>` : ''}
${funnel?.chart ?? ''}
${analyses.map((card) => card.chart).join('\n')}`,
    groups: funnel?.groups ?? 0,
    steps: funnel?.steps ?? 0,
    ...(report.cards !== undefined && { cards: analyses.length }),
  };
}

export async function writeFunnelReport({ action, data, out, template }) {
  const file = path.resolve(out);
  if (path.extname(file).toLowerCase() !== '.html') throw new Error('--out must name an HTML file');
  const source = await fs.readFile(template ?? templateFile, 'utf8');
  let report;
  let html = source;
  if (action === 'render') {
    for (const marker of ['{{FUNNEL_TITLE}}', '{{FUNNEL_CONTENT}}']) {
      if (source.split(marker).length !== 2) throw new Error(`Template requires exactly one ${marker}`);
    }
    report = renderReport(JSON.parse(await fs.readFile(data, 'utf8')));
    html = `${generatedMarker}\n${source.replace(/\{\{FUNNEL_(TITLE|CONTENT)\}\}/g, (_, key) => report[key.toLowerCase()])}`;
  }

  await withFileLock(`${file}.funnel-report.lock`, async () => {
    const stat = await fs.lstat(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (stat && (action === 'template' || !stat.isFile() ||
      !(await fs.readFile(file, 'utf8')).startsWith(generatedMarker))) {
      throw new Error(`Refusing to overwrite existing HTML: ${file}`);
    }
    await atomicWriteText(file, html);
  });
  return { ok: true, out: file, ...(report && {
    groups: report.groups, steps: report.steps, ...(report.cards !== undefined && { cards: report.cards }),
  }) };
}
