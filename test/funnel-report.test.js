import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFunnelReport } from '../src/funnel-report.js';

const base = { product: '轻拍相机', title: '首拍报告', scope: '首次打开后 24 小时' };

async function render(t, input) {
  const folder = await mkdtemp(join(tmpdir(), 'ovc-funnel-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const data = join(folder, 'data.json');
  const out = join(folder, 'report.html');
  await writeFile(data, JSON.stringify({ ...base, ...input }));
  const result = await writeFunnelReport({ action: 'render', data, out });
  return { result, html: await readFile(out, 'utf8') };
}

test('shows summary, completion cards and vertical funnel before step details', async t => {
  const { result, html } = await render(t, {
    steps: ['打开 App', '打开相机', '首拍预览成功'],
    groups: [{ label: '新版', counts: [400, 280, 210] }],
    nextSteps: ['核对相机入口曝光。'],
  });
  assert.deepEqual([result.groups, result.steps], [1, 3]);
  assert.match(html, /<h2>总结<\/h2>[^]*120 人（30%）[^]*<h2>关键指标<\/h2>[^]*52\.5%[^]*<h2>流程漏斗<\/h2>[^]*--share:100%[^]*--share:70%[^]*--share:52\.5%[^]*<h2>步骤明细<\/h2>/);
  assert.match(html, /<h2>总结<\/h2>[^]*<p>核对相机入口曝光。<\/p>/);
  assert.doesNotMatch(html, /下一步验证/);
  assert.match(html, /\.step-count\{color:var\(--blue\)\}/);
  assert.match(html, /\.caption,\.loss\{color:var\(--muted\)/);
  const steps = html.split('<h2>步骤明细</h2>')[1];
  assert.match(steps, /<strong class="step-count">400 人<\/strong>/);
  assert.match(steps, /<strong class="step-count">280 人<\/strong><span class="loss">流失 120 人 · 30%<\/span>/);
});

test('renders metrics without a funnel and preserves unknown values', async t => {
  const { result, html } = await render(t, {
    summary: '完成率待确认',
    metrics: [{ label: '完成率', value: null }, { label: '进入人数', value: '400 人' }],
  });
  assert.deepEqual([result.groups, result.steps], [0, 0]);
  assert.match(html, /<h2>总结<\/h2>[^]*完成率待确认[^]*<h2>关键指标<\/h2>[^]*<strong>—<\/strong>[^]*400 人/);
  assert.doesNotMatch(html, /<h2>流程漏斗<\/h2>|<h2>步骤明细<\/h2>/);
});

test('renders product identity and independent scope metadata in the report header', async t => {
  const { html } = await render(t, {
    productIcon: 'data:image/png;base64,AAAA',
    timezone: '北京时间',
    asOf: '2026-10-03',
    summary: '完成率待确认',
    metrics: [{ label: '完成率', value: null }],
  });
  assert.match(html, /class="report-identity"[^]*class="report-product-icon"[^]*<h1>轻拍相机<\/h1>/);
  assert.match(html, /<dt>统计范围<\/dt>[^]*<dt>时区<\/dt><dd>北京时间<\/dd>[^]*<dt>截至<\/dt><dd><time datetime="2026-10-03">2026-10-03<\/time>/);
});

test('marks missing steps and rejects a partial funnel definition', async t => {
  const { html } = await render(t, {
    steps: ['打开 App', '打开相机', '首拍预览成功'],
    groups: [{ label: '旧版', counts: [360, null, 144] }],
  });
  assert.match(html, /部分步骤人数未知/);
  assert.match(html, /流失未知/);
  assert.match(html, /class="band-unavailable"/);
  await assert.rejects(render(t, {
    summary: '完成率待确认',
    metrics: [{ label: '完成率', value: null }],
    steps: ['打开 App', '打开相机'],
  }), /groups must contain at least one group/);
});

test('composes the selected report cards after the summary and key metrics', async t => {
  const { result, html } = await render(t, {
    summary: '首拍与留存观察',
    metrics: [{ label: '进入取景', value: '280 人' }],
    cards: [
      { type: 'comparison', title: '版本对照', dimension: '版本', columns: [{ label: '完成率', unit: '%' }], groups: [{ label: '新版', values: [52.5] }] },
      { type: 'funnel', title: '首拍流程', steps: ['进入', '完成'], groups: [{ label: '新版', counts: [400, 210] }] },
      { type: 'trend', title: '每日趋势', dates: ['2026-10-01'], series: [{ label: '新版', values: [0] }] },
      { type: 'cohort', title: '按日留存', asOf: '2026-10-02', days: [1], cohorts: [{ date: '2026-10-01', size: 100, retained: [40] }] },
    ],
  });
  assert.deepEqual([result.groups, result.steps, result.cards], [0, 0, 4]);
  assert.match(html, /<h2>总结<\/h2>[^]*<h2>关键指标<\/h2>[^]*首拍流程 · 新版 · 全流程完成率[^]*<h2>版本对照<\/h2>[^]*<td>52\.5%<\/td>[^]*<h2>首拍流程<\/h2>[^]*funnel-stages[^]*<h3 class="card-detail">步骤明细<\/h3>[^]*<h2>每日趋势<\/h2>[^]*<td>0<\/td>[^]*<h2>按日留存<\/h2>[^]*40%（40\/100）/);
  assert.doesNotMatch(html, /<script\b|\b(?:src|href)=/);
});

test('combines a legacy funnel and selected cards and bridges missing dates with dashes', async t => {
  const { result, html } = await render(t, {
    summary: '先核对缺失日期',
    steps: ['进入', '完成'],
    groups: [{ label: '旧版', counts: [10, 8] }],
    cards: [{
      type: 'trend', title: '每日变化 <待核对>', unit: '%',
      dates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'],
      series: [{ label: '新版', values: [0, null, 30, 40] }],
    }],
  });
  assert.deepEqual([result.groups, result.steps, result.cards], [1, 2, 1]);
  assert.match(html, /<h2>流程漏斗<\/h2>[^]*<h2>每日变化 &lt;待核对&gt;<\/h2>/);
  assert.match(html, /class="trend-axis"[^]*class="trend-value"[^>]*>40%<[^]*class="trend-value"[^>]*>20%<[^]*class="trend-value"[^>]*>0%<[^]*class="trend-date"[^>]*>10-01<[^]*class="trend-date trend-date-inner"[^>]*>10-02<[^]*class="trend-date"[^>]*>10-04</);
  assert.match(html, /class="trend-gap" points="86,146 427\.33\d+,47"/);
  assert.match(html, /<linearGradient id="trend-cards-0-series-0"[^]*stop-opacity="0"\/>/);
  assert.match(html, /class="trend-area" points="427\.33\d+,47 598,14 598,146 427\.33\d+,146" fill="url\(#trend-cards-0-series-0\)"/);
  assert.equal((html.match(/class="trend-area"/g) ?? []).length, 1);
  assert.match(html, /class="trend-axis" d="M86 146H598"/);
  assert.match(html, /<circle cx="86" cy="146" r="4"\/><polyline points="427\.33\d+,47 598,14"\/>/);
  assert.doesNotMatch(html, /图示范围/);
  assert.match(html, /2026-10-01<\/th><td>0%<\/td>[^]*2026-10-02<\/th><td>—<\/td>/);
});

test('distinguishes mature missing retention, observed zero and immature windows', async t => {
  const { html } = await render(t, {
    summary: '第七日仍未成熟',
    cards: [{
      type: 'cohort', title: '留存', asOf: '2026-10-03', days: [1, 2, 7],
      cohorts: [{ date: '2026-10-01', size: 100, retained: [0, null, null] }],
    }],
  });
  assert.match(html, /<td>100<\/td><td>0%（0\/100）<\/td><td>—<\/td><td>未成熟<\/td>/);
  assert.match(html, /<div class="card-heading"><h2>留存<\/h2><time datetime="2026-10-03">截至 2026-10-03<\/time>/);
  assert.doesNotMatch(html, /的完整数据/);
  assert.doesNotMatch(html, /<h2>关键指标<\/h2>|<h2>流程漏斗<\/h2>/);
});

test('assigns a shared palette by series position regardless of platform label', async t => {
  const trend = {
    type: 'trend', title: '平台趋势', dates: ['2026-10-01', '2026-10-02'],
    series: [
      { label: '其他渠道', values: [1, 2] },
      { label: '抖音', values: [2, 3] },
      { label: '种草内容', platform: 'xiaohongshu', values: [3, 4] },
      { label: 'B站', values: [4, 5] },
      { label: '直接访问', values: [5, 6] },
    ],
  };
  const { html } = await render(t, {
    summary: '按渠道看趋势',
    cards: [
      { ...trend, series: trend.series.slice(0, 1) },
      { ...trend, series: trend.series.slice(0, 2) },
      { ...trend, series: trend.series.slice(0, 3) },
      { ...trend, series: trend.series.slice(0, 4) },
      trend,
      { ...trend, series: [...trend.series].reverse() },
    ],
  });
  assert.deepEqual([...html.matchAll(/<li class="tone-([^"]+)">([^<]+)<\/li>/g)].map((match) => match.slice(1)), [
    ['pink', '其他渠道'],
    ['pink', '其他渠道'], ['cyan', '抖音'],
    ['pink', '其他渠道'], ['cyan', '抖音'], ['graphite', '种草内容'],
    ['pink', '其他渠道'], ['cyan', '抖音'], ['graphite', '种草内容'], ['violet', 'B站'],
    ['pink', '其他渠道'], ['cyan', '抖音'], ['graphite', '种草内容'], ['violet', 'B站'], ['gold', '直接访问'],
    ['pink', '直接访问'], ['cyan', 'B站'], ['graphite', '种草内容'], ['violet', '抖音'], ['gold', '其他渠道'],
  ]);
  for (const [tone, hex] of [['pink', '#f23877'], ['cyan', '#009bc7'], ['graphite', '#303038'], ['violet', '#6859e8'], ['gold', '#e2a118']]) {
    assert.ok(html.includes(`.tone-${tone}{--tone:${hex}}`), tone);
  }
});

test('uses a concise date range in the header when provided', async t => {
  const { html } = await render(t, {
    dateRange: { start: '2026-11-11', end: '2026-11-17' },
    timezone: 'Asia/Shanghai',
    asOf: '2026-11-18',
    context: '按用户去重',
    summary: '按渠道看趋势',
    metrics: [{ label: '访客', value: '820 人' }],
  });
  assert.match(html, /class="report-period"><time datetime="2026-11-11">11 月 11 日<\/time> — <time datetime="2026-11-17">11 月 17 日<\/time><\/p><p class="report-context">按用户去重<\/p><\/header>/);
  assert.doesNotMatch(html, /<dt>统计范围<\/dt>|Asia\/Shanghai|2026-11-18/);
});

test('keeps metadata in the header for legacy inputs without a date range', async t => {
  const { html } = await render(t, {
    timezone: 'Asia/Shanghai',
    asOf: '2026-11-18',
    summary: '按渠道看趋势',
    metrics: [{ label: '访客', value: '820 人' }],
  });
  assert.match(html, /<dl class="report-scope"><div><dt>统计范围<\/dt><dd>首次打开后 24 小时<\/dd>[^]*<dt>时区<\/dt><dd>Asia\/Shanghai<\/dd>[^]*<dt>截至<\/dt>[^]*<time datetime="2026-11-18">/);
  assert.doesNotMatch(html, /<p class="report-period">/);
});

test('locates invalid dates, comparison widths and cohort counts in the input', async t => {
  const fail = (card, error) => assert.rejects(render(t, { summary: '数据待核对', cards: [card] }), error);
  await fail({
    type: 'trend', title: '趋势', dates: ['2026-02-30'], series: [{ label: 'A', values: [1] }],
  }, /cards\[0\]\.dates\[0\] must be a valid/);
  await fail({
    type: 'comparison', title: '对照', dimension: '渠道', columns: [{ label: '转化' }], groups: [{ label: 'A', values: [] }],
  }, /cards\[0\]\.groups\[0\]\.values must contain 1/);
  const cohort = { type: 'cohort', title: '留存', asOf: '2026-10-02', days: [1, 7] };
  await fail({ ...cohort, cohorts: [{ date: '2026-10-01', size: 100, retained: [50, 0] }] }, /retained\[1\].*immature/);
  await fail({ ...cohort, cohorts: [{ date: '2026-10-01', size: 100, retained: [101, null] }] }, /retained\[0\].*cohort size/);
  await fail({ type: 'invalid', title: '未知类型' }, /cards\[0\]\.type/);
});
