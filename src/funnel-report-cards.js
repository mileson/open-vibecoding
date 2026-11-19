import { escapeHtml } from './html-artifact-utils.js';

const dayMilliseconds = 86_400_000;
const number = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 });
const percent = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
const trendPalette = ['pink', 'cyan', 'graphite', 'violet', 'gold', 'crimson', 'gray'];

export function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be non-empty text`);
  return value.trim();
}

function list(value, field) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`);
  return value;
}

function seriesValues(value, size, field, parse) {
  if (!Array.isArray(value) || value.length !== size) throw new Error(`${field} must contain ${size} values`);
  return value.map((item, i) => item === null ? null : parse(item, `${field}[${i}]`));
}

function finite(value, field) {
  if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number or null`);
  return value;
}

function count(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

export function date(value, field) {
  const epoch = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return epoch / dayMilliseconds;
}

function ascending(values, field) {
  if (values.some((value, i) => i > 0 && value <= values[i - 1])) throw new Error(`${field} must be strictly increasing`);
  return values;
}

function labeledRows(value, field, parse) {
  const labels = new Set();
  return list(value, field).map((row, i) => {
    const location = `${field}[${i}]`;
    const label = text(row?.label, `${location}.label`);
    if (labels.has(label)) throw new Error(`${location}.label must be unique`);
    labels.add(label);
    return { label, ...parse(row, location) };
  });
}

function optionalUnit(value, field) {
  return value === undefined ? '' : text(value, field);
}

function valueText(value, unit = '') {
  if (value === null) return '—';
  const label = number.format(value);
  return unit === '%' ? `${label}%` : `${label}${unit ? ` ${unit}` : ''}`;
}

function table(columns, rows, title) {
  const headings = columns.map((label) => `<th scope="col">${escapeHtml(label)}</th>`).join('');
  const body = rows.map(([label, ...cells]) => `<tr><th scope="row">${escapeHtml(label)}</th>${cells.map(
    (cell) => `<td>${escapeHtml(cell)}</td>`,
  ).join('')}</tr>`).join('');
  return `<div class="table-wrap" tabindex="0" aria-label="${escapeHtml(title)}"><table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function axisValue(value, unit) {
  const magnitude = Math.abs(value);
  const label = magnitude >= 1e6 || (magnitude > 0 && magnitude < 1e-4)
    ? value.toExponential(2) : number.format(value);
  return unit === '%' ? `${label}%` : `${label}${unit ? ` ${unit}` : ''}`;
}

function trendTone(index) {
  const tone = trendPalette[index];
  if (tone) return `class="tone-${tone}"`;
  const hue = Math.round((index - trendPalette.length) * 137.508 + 145) % 360;
  return `style="--tone:hsl(${hue} 70% 38%)"`;
}

function trendChart(dates, timeline, series, unit, chartId) {
  let min = Infinity;
  let max = -Infinity;
  for (const { values } of series) {
    for (const value of values) {
      if (value === null) continue;
      min = Math.min(value, min);
      max = Math.max(value, max);
    }
  }
  if (min === Infinity) return '';
  const scale = Math.max(Math.abs(min), Math.abs(max), 1);
  const span = max / scale - min / scale;
  const left = 86;
  const right = 598;
  const top = 14;
  const bottom = 146;
  const interval = timeline.at(-1) - timeline[0];
  const position = (i) => interval ? (timeline[i] - timeline[0]) / interval : 0.5;
  const x = (i) => left + (right - left) * position(i);
  const y = (value) => span ? bottom - (bottom - top) * ((value / scale - min / scale) / span) : (top + bottom) / 2;
  let previousTick = 0;
  const includeYear = dates[0].slice(0, 4) !== dates.at(-1).slice(0, 4);
  const dateTicks = dates.map((label, i) => {
    const at = position(i);
    const edge = i === 0 || i === dates.length - 1;
    if (!edge && (at - previousTick < 0.155 || 1 - at < 0.155)) return '';
    previousTick = at;
    return `<text class="trend-date${edge ? '' : ' trend-date-inner'}" x="${x(i)}" y="170" text-anchor="middle">${includeYear ? label : label.slice(5)}</text>`;
  }).join('');
  const ticks = min === max ? [min] : [...new Set([max, min / 2 + max / 2, min])];
  const valueTicks = ticks.map((value) => {
    const at = y(value);
    return `<path class="trend-grid" d="M${left} ${at}H${right}"/><text class="trend-value" x="${left - 9}" y="${at}" dominant-baseline="middle" text-anchor="end">${escapeHtml(axisValue(value, unit))}</text>`;
  }).join('');
  const tones = series.map((_, index) => trendTone(index));
  const fillOpacity = 0.27 * Math.min(1, Math.sqrt(2 / series.length));
  const layers = series.map(({ values }, index) => {
    const segments = [[]];
    values.forEach((value, i) => {
      if (value === null) segments.push([]);
      else segments.at(-1).push([x(i), y(value)]);
    });
    const observed = segments.filter((segment) => segment.length);
    const shapes = observed.map((segment) => segment.length === 1
      ? `<circle cx="${segment[0][0]}" cy="${segment[0][1]}" r="4"/>`
      : `<polyline points="${segment.map((point) => point.join(',')).join(' ')}"/>`).join('');
    const bridges = observed.slice(1).map((segment, i) =>
      `<polyline class="trend-gap" points="${observed[i].at(-1).join(',')} ${segment[0].join(',')}"/>`).join('');
    const gradientId = `${chartId}-series-${index}`;
    const areas = observed.filter((segment) => segment.length > 1).map((segment) => {
      const points = [...segment, [segment.at(-1)[0], bottom], [segment[0][0], bottom]];
      return `<polygon class="trend-area" points="${points.map((point) => point.join(',')).join(' ')}" fill="url(#${gradientId})"/>`;
    }).join('');
    const appearance = tones[index];
    const gradient = areas
      ? `<linearGradient id="${gradientId}" ${appearance} x2="0%" y2="100%"><stop offset="0%" stop-opacity="${fillOpacity.toFixed(3)}"/><stop offset="64%" stop-opacity="${(fillOpacity / 3).toFixed(3)}"/><stop offset="100%" stop-opacity="0"/></linearGradient>` : '';
    return { gradient, areas, trace: `<g class="trend-series"><g ${appearance}>${bridges}${shapes}</g></g>` };
  });
  const defs = layers.map(({ gradient }) => gradient).join('');
  const areas = layers.map((layer) => layer.areas).join('');
  const traces = layers.map(({ trace }) => trace).join('');
  const legend = series.map(({ label }, index) => `<li ${tones[index]}>${escapeHtml(label)}</li>`).join('');
  return `<div class="trend-chart" aria-hidden="true"><svg viewBox="0 0 640 182" focusable="false">${defs ? `<defs>${defs}</defs>` : ''}<path class="trend-axis" d="M${left} ${bottom}H${right}"/>${valueTicks}${dateTicks}${areas}${traces}</svg><ul class="trend-legend">${legend}</ul></div>`;
}

function trend(card, title, field) {
  const dates = list(card.dates, `${field}.dates`);
  const timeline = ascending(dates.map((value, i) => date(value, `${field}.dates[${i}]`)), `${field}.dates`);
  const unit = optionalUnit(card.unit, `${field}.unit`);
  const series = labeledRows(card.series, `${field}.series`, (row, location) => ({
    values: seriesValues(row.values, dates.length, `${location}.values`, finite),
  }));
  const rows = dates.map((label, i) => [label, ...series.map(({ values }) => valueText(values[i], unit))]);
  const chartId = `trend-${field.replace(/\[(\d+)\]/, '-$1')}`;
  return trendChart(dates, timeline, series, unit, chartId) + table(['日期', ...series.map(({ label }) => label)], rows, title);
}

function comparison(card, title, field) {
  const dimension = text(card.dimension, `${field}.dimension`);
  const columns = labeledRows(card.columns, `${field}.columns`, (row, location) =>
    ({ unit: optionalUnit(row.unit, `${location}.unit`) }));
  const groups = labeledRows(card.groups, `${field}.groups`, (row, location) =>
    ({ values: seriesValues(row.values, columns.length, `${location}.values`, finite) }));
  const rows = groups.map(({ label, values }) => [label, ...values.map((value, i) => valueText(value, columns[i].unit))]);
  return table([dimension, ...columns.map(({ label }) => label)], rows, title);
}

function cohort(card, title, field) {
  const asOf = date(card.asOf, `${field}.asOf`);
  const days = ascending(list(card.days, `${field}.days`).map((value, i) => count(value, `${field}.days[${i}]`)), `${field}.days`);
  const seen = new Set();
  const rows = list(card.cohorts, `${field}.cohorts`).map((row, i) => {
    const location = `${field}.cohorts[${i}]`;
    const start = date(row?.date, `${location}.date`);
    if (start > asOf) throw new Error(`${location}.date cannot be later than asOf`);
    if (seen.has(start)) throw new Error(`${location}.date must be unique`);
    seen.add(start);
    const size = count(row.size, `${location}.size`);
    const retained = seriesValues(row.retained, days.length, `${location}.retained`, count);
    const cells = retained.map((value, index) => {
      const cell = `${location}.retained[${index}]`;
      if (days[index] > asOf - start) {
        if (value !== null) throw new Error(`${cell} must be null because the observation window is immature`);
        return '未成熟';
      }
      if (value > size) throw new Error(`${cell} cannot exceed cohort size`);
      return value === null || size === 0 ? '—' : `${percent.format(value / size)}（${number.format(value)}/${number.format(size)}）`;
    });
    return [row.date, number.format(size), ...cells];
  });
  return table(['同期群日期', '人数', ...days.map((day) => `第 ${day} 日`)], rows, title);
}

const renderers = new Map([['trend', trend], ['comparison', comparison], ['cohort', cohort]]);

export function renderDataCard(card, type, title, field) {
  const render = renderers.get(type);
  if (!render) throw new Error(`${field}.type must be funnel, trend, comparison or cohort`);
  return render(card, title, field);
}
