import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAppStoreReviews } from '../src/app-store-reviews.js';

const url = 'https://apps.apple.com/cn/app/camera/id123?see-all=reviews';
const review = { id: 'r1', rating: 2, date: '2026-11-01T00:00:00Z', title: '建议', contents: '相机…' };
const complete = { ...review, contents: '相机界面可以增加说明。' };
const item = { review: { ...review, moreAction: { pageData: { shelves: [{ items: [complete] }] } } } };

function page(responseUrl, items, status = 200) {
  const data = { data: [{ data: { shelfMapping: { allProductReviews: { items } } } }] };
  return {
    url: responseUrl, status, ok: status === 200,
    text: async () => `<script type="application/json" id="serialized-server-data">${JSON.stringify(data)}</script>`,
  };
}

test('collects and deduplicates complete public reviews for the requested storefront', async () => {
  const result = await collectAppStoreReviews({ id: '123', country: 'CN', fetchPage: async () => page(url, [item, item]) });
  assert.equal(result.status, 'partial');
  assert.equal(result.country, 'cn');
  assert.deepEqual(result.reviews, [{ id: 'r1', rating: 2, date: review.date, title: '建议', text: complete.contents }]);
});

test('distinguishes empty shelves from redirects, schema changes and HTTP throttling', async () => {
  const collect = fetchPage => collectAppStoreReviews({ id: '123', country: 'cn', fetchPage });
  assert.equal((await collect(async () => page(url, []))).status, 'empty');
  assert.equal((await collect(async () => page('https://apps.apple.com/us/app/id123?see-all=reviews', [item]))).reason, 'storefront_or_app_mismatch');
  assert.equal((await collect(async () => page(url, [null]))).reason, 'review_schema_changed');
  assert.equal((await collect(async () => page(url, [], 429))).status, 'rate_limited');
  await assert.rejects(collectAppStoreReviews({ id: '123/abc', country: 'cn' }), /numeric/);
});

test('both report commands consume the same snapshot without deriving sentiment from stars', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-app-reviews-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
  const call = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  const save = (file, value) => writeFile(path.join(cwd, file), JSON.stringify(value));
  const snapshot = await collectAppStoreReviews({ id: '123', country: 'cn', fetchPage: async () => page(url, [item]) });
  await save('reviews.json', snapshot);
  await save('aso.json', { product: 'Camera', researchedAt: '2026-11-19', summary: '用户提到入门说明', status: 'provisional' });
  const aso = call('aso-report', 'render', '--data', 'aso.json', '--app-store-reviews', 'reviews.json', '--out', 'aso.html');
  assert.equal(aso.status, 0, aso.stderr);
  const asoHtml = await readFile(path.join(cwd, 'aso.html'), 'utf8');
  assert.match(asoHtml, /id="review-market-cn" aria-label="评论样本 · 中国区".*相机界面可以增加说明。/s);
  assert.doesNotMatch(asoHtml, /<caption>评论样本/);
  assert.doesNotMatch(asoHtml, /采集时间（UTC）|样本条数/);
  const other = { ...snapshot, country: 'us', url: url.replace('/cn/', '/us/'), reviews: [
    { ...snapshot.reviews[0], text: 'US review text' },
  ] };
  await save('us.json', other);
  const multi = call('aso-report', 'render', '--data', 'aso.json', '--app-store-reviews', 'reviews.json',
    '--app-store-reviews', 'us.json', '--out', 'multi.html');
  assert.equal(multi.status, 0, multi.stderr);
  const multiHtml = await readFile(path.join(cwd, 'multi.html'), 'utf8');
  assert.match(multiHtml, /id="evidence"><h2>数据来源<\/h2><div class="review-filters"/);
  assert.doesNotMatch(multiHtml, /<nav class="report-nav"[^>]*>(?:(?!<\/nav>).)*review-filters/s);
  assert.match(multiHtml, /aria-controls="review-market-cn" aria-pressed="true"/);
  assert.match(multiHtml, /aria-controls="review-market-us" aria-pressed="true"/);
  assert.match(multiHtml, /id="review-market-us"[^>]*>.*US review text.*apps\.apple\.com\/us\//s);
  await save('empty-us.json', { ...other, status: 'unavailable', reviews: [] });
  const partial = call('aso-report', 'render', '--data', 'aso.json', '--app-store-reviews', 'reviews.json',
    '--app-store-reviews', 'empty-us.json', '--out', 'partial.html');
  assert.equal(partial.status, 0, partial.stderr);
  assert.deepEqual(JSON.parse(partial.stdout).reviewRegions, [
    { country: 'cn', status: 'partial', comments: 1, visible: true },
    { country: 'us', status: 'unavailable', comments: 0, visible: false },
  ]);
  const partialHtml = await readFile(path.join(cwd, 'partial.html'), 'utf8');
  assert.match(partialHtml, /aria-controls="review-market-cn"/);
  assert.doesNotMatch(partialHtml, /review-market-us|<button class="market-select-all"/);
  const duplicate = call('aso-report', 'render', '--data', 'aso.json', '--app-store-reviews', 'reviews.json',
    '--app-store-reviews', 'reviews.json', '--out', 'duplicate.html');
  assert.match(duplicate.stderr, /one App Store review snapshot per region/);
  await save('analysis.json', { product: 'Camera', queriedAt: '2026-11-19', summary: '用户提到入门说明' });
  const imported = call('social-listening', 'import', '--from', '.', '--analysis', 'analysis.json',
    '--app-store-reviews', 'reviews.json', '--out', 'social.json');
  assert.equal(imported.status, 0, imported.stderr);
  const data = JSON.parse(await readFile(path.join(cwd, 'social.json'), 'utf8'));
  assert.equal(data.comments[0].rating, 2);
  assert.equal(data.comments[0].sentiment, 'unclassified');
  assert.equal(data.platforms[0].status, 'partial');
  const social = call('social-listening', 'render', '--data', 'social.json', '--out', 'social.html');
  assert.equal(social.status, 0, social.stderr);
  const html = await readFile(path.join(cwd, 'social.html'), 'utf8');
  assert.match(html, /相机界面可以增加说明。.*2 星/s);
  assert.match(html, /已分类 0\/1/);
});
