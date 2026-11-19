import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));

test('copies the bundled ASO template and renders a standalone report from results', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-aso-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const call = (...args) => spawnSync(process.execPath, [cli, 'aso-report', ...args], { cwd, encoding: 'utf8' });
  const catalog = call('markets');
  assert.equal(catalog.status, 0, catalog.stderr);
  const { markets: catalogEntries } = JSON.parse(catalog.stdout);
  const catalogLabels = new Map(catalogEntries.map(({ id, label }) => [id, label]));
  assert.equal(catalogEntries.length, 249);
  const flagFiles = await readdir(new URL('../src/aso-report-flags/', import.meta.url));
  assert.deepEqual(
    flagFiles.filter(file => file.endsWith('.svg')).sort(),
    [...catalogLabels.keys()].map(id => `${id}.svg`).sort(),
  );
  for (const [id, label] of [['tw', '中国台湾'], ['hk', '中国香港'], ['mo', '中国澳门']]) {
    assert.equal(catalogLabels.get(id), label);
  }
  const template = call('template', '--out', 'template.html');
  assert.equal(template.status, 0, template.stderr);
  const originalTemplate = await readFile(path.join(cwd, 'template.html'), 'utf8');
  assert.notEqual(call('template', '--out', 'template.html').status, 0);
  assert.match(originalTemplate, /<style id="aso-rating-styles">/);
  assert.match(originalTemplate, /\{\{ASO_RATING_STAR\}\}/);

  const report = {
    product: '相机 <example>',
    researchedAt: '2026-11-18',
    status: 'provisional',
    summary: '优先验证拍摄场景词',
    collectedSources: ['xiaohongshu', 'reddit'],
    sections: {
      evidence: {
        text: '旧版数据来源说明',
        tables: [
          { columns: ['来源', '状态'], rows: [['七麦', '待导出']] },
          { columns: ['星级'], rows: [[3.5], [5], [null]] },
        ],
        sources: [
          { title: '原帖', url: 'https://example.com/post' },
          { title: 'App Store', url: 'https://apps.apple.com/cn/app/id6738299859' },
          { title: '七麦数据', url: 'https://www.qimai.cn/app/keyword/' },
          { title: '其他出处', url: 'https://qimai.cn.example.com/post' },
        ],
      },
      china: { text: '旧地区说明', tables: [{ columns: ['关键词', '排名'], rows: [['拍照', 3]] }] },
      usa: { tables: [
        { title: 'Candidate keywords', columns: ['Keyword', 'Product Rank', 'Competitor Rank'], rows: [['photo composition', null, 4]] },
        { title: 'Coverage overview', columns: ['Metric', 'Product'], rows: [['前十关键词数', 4]] },
      ] },
      limitations: { text: '美国区关键词覆盖待核验' },
      candidates: {
        text: '优先比较同类搜索意图',
        recommendations: [{ title: '优先验证', text: '关注拍照构图词' }],
      },
      monitoring: { text: '更新后观察 7 天' },
    },
    plans: [
      { locale: 'zh-Hans', scope: 'keywords-only', keywords: '拍照,构图', valid: true },
      { locale: 'en-US', scope: 'full', name: 'Camera', subtitle: 'Photo Guide', description: 'Frame your photo.', keywords: 'photo,guide' },
      { locale: 'en-US', scope: 'keywords-only', keywords: 'a'.repeat(101), valid: false },
    ],
  };
  const dataPath = path.join(cwd, 'report.json');
  const save = value => writeFile(dataPath, JSON.stringify(value));
  await save(report);
  const render = (out = 'report.html') => call('render', '--data', 'report.json', '--out', out, '--template', 'template.html');
  const result = render();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'provisional');
  assert.deepEqual(JSON.parse(result.stdout).limitIssues, [{ locale: 'en-US', scope: 'keywords-only', field: 'keywords', count: 101, max: 100, unit: '字节' }]);
  const html = await readFile(path.join(cwd, 'report.html'), 'utf8');
  const half = html.match(/aria-label="3.5 星，满分 5 星"[^>]*>(.*?)<\/td>/)?.[1];
  assert.deepEqual([...half.matchAll(/--filled:([\d.]+)%/g)].map(([, value]) => Number(value)), [100, 100, 100, 50, 0]);
  assert.match(html, /aria-label="5 星，满分 5 星"/);
  assert.match(html, /<td>—<\/td>/);
  assert.equal(html.split('id="aso-rating-styles"').length, 2);
  assert.match(html, /--star-image: url\("data:image\/png;base64,/);
  assert.match(html, /<dl class="meta"><div><dt>调研日期<\/dt><dd>2026年11月18日<\/dd>/);
  assert.doesNotMatch(html, /report-status/);
  assert.doesNotMatch(html, /<th scope="col">状态<\/th>|待导出/);
  assert.match(html, /<a class="source-link" href="https:\/\/example.com\/post" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /<span class="source-link-title">原帖<\/span><span class="source-link-host">example.com<\/span>/);
  assert.match(html, /<h2>数据来源<\/h2><div class="table"/);
  assert.doesNotMatch(html, /旧版数据来源说明/);
  assert.equal([...html.matchAll(/class="source-item" data-included="true"/g)].length, 4);
  assert.match(html, /data-included="true"><img[^>]*data-source="xiaohongshu"[^>]*><span>小红书<\/span><span class="source-inclusion">已包含<\/span>/);
  assert.match(html, /data-included="true"><img[^>]*data-source="reddit"[^>]*><span>Reddit<\/span><span class="source-inclusion">已包含<\/span>/);
  assert.match(html, /data-included="true"><img[^>]*data-source="qimai"[^>]*><span>七麦<\/span><span class="source-inclusion">已包含<\/span>/);
  assert.match(html, /data-included="true"><img[^>]*data-source="app-store"[^>]*><span>App Store<\/span><span class="source-inclusion">已包含<\/span>/);
  assert.match(html, /data-included="false"><img[^>]*data-source="x"[^>]*><span>X<\/span><span class="source-inclusion">未包含<\/span>/);
  assert.match(html, /<p class="report-kind"><img[^>]*data-source="app-store"[^>]*>App Store 优化报告<\/p>/);
  assert.equal([...html.matchAll(/class="source-icon"[^>]*src="data:image\/png;base64,iVBORw0KGgo/g)].length, 8);
  assert.match(html, /href="https:\/\/apps.apple.com\/[^\"]+"[^>]+><img[^>]+data-source="app-store"/);
  assert.match(html, /href="https:\/\/www.qimai.cn\/[^\"]+"[^>]+><img[^>]+data-source="qimai"/);
  assert.match(html, /href="https:\/\/qimai.cn.example.com\/post"[^>]+><span class="source-link-generic"/);
  assert.ok(html.indexOf('<ul class="source-checklist"') < html.indexOf('<ul class="source-links"'));
  assert.match(html, /相机 &lt;example&gt;/);
  assert.match(html, /aria-controls="column-china" aria-pressed="true"><img class="market-flag"[^>]+><span>中国区<\/span><\/button>/);
  assert.match(html, /aria-controls="column-usa" aria-pressed="true"><img class="market-flag"[^>]+><span>美国区<\/span><\/button>/);
  assert.match(html, /<th scope="row">photo composition<\/th><td data-market-column="china"><span class="market-missing">—<\/span>/);
  assert.match(html, /<dialog id="market-details"/);
  assert.doesNotMatch(html, /旧地区说明|暂无可用数据/);
  assert.doesNotMatch(html, /<caption>候选关键词<\/caption>/);
  assert.match(html, /<caption>覆盖概况<\/caption>/);
  assert.match(html, /<th scope="col">本品排名<\/th>/);
  assert.match(html, /<td>photo composition<\/td>/);
  assert.doesNotMatch(html, /Candidate keywords|Product Rank|Competitor Rank/);
  assert.match(html, /<td>3<\/td>/);
  assert.match(html, /aria-valuenow="13" aria-valuetext="13 \/ 100 字节" data-outside="false"/);
  assert.match(html, /aria-valuenow="100" aria-valuetext="101 \/ 100 字节，超限" data-outside="true"/);
  assert.match(html, /6 \/ 30 字符/);
  assert.match(html, /17 \/ 4000 字符/);
  assert.match(html, /class="keyword-pill">拍照<\/span>.*?class="keyword-pill">构图<\/span>/);
  assert.match(html, /<h3>简体中文<\/h3>/);
  assert.equal([...html.matchAll(/<article class="plan">/g)].length, 3);
  assert.equal([...html.matchAll(/data-field="keywords"/g)].length, 3);
  assert.match(html, /role="tab" aria-controls="panel-full" aria-selected="true"><span>方案一<\/span>更新商店文案和关键词/);
  assert.match(html, /role="tab" aria-controls="panel-keywords-only" aria-selected="false"><span>方案二<\/span>只改关键词/);
  const keywordPanel = html.split('id="panel-keywords-only"')[1].split('</section>')[0];
  assert.doesNotMatch(keywordPanel, /data-field="(?:name|subtitle|description)"/);
  assert.match(html, /href="#markets">多地区对比/);
  assert.doesNotMatch(html, /href="#(?:china|usa)"/);
  assert.doesNotMatch(html, /href="#social"/);
  assert.doesNotMatch(html, /证据边界|#limitations|美国区关键词覆盖待核验/);
  assert.match(html, /id="summary".*summary-statement.*id="candidates".*关键词建议.*优先比较同类搜索意图.*优先验证.*关注拍照构图词/);
  assert.doesNotMatch(html, /候选词评分|下一轮复测|更新后观察 7 天|href="#(?:candidates|monitoring)"/);
  assert.ok(html.indexOf('id="china"') < html.indexOf('id="plans"'));
  assert.doesNotMatch(html, /字段待校验|字段校验通过|字段校验未通过/);
  assert.match(html, /Frame your photo/);
  assert.equal(await readFile(dataPath, 'utf8'), JSON.stringify(report));
  assert.equal(await readFile(path.join(cwd, 'template.html'), 'utf8'), originalTemplate);
  assert.equal(render().status, 0);
  assert.match(render('template.html').stderr, /Refusing to overwrite/);

  await save({ ...report, status: 'validated' });
  assert.match(render().stderr, /field validation/);
  await save({ ...report, status: ['validated'] });
  assert.match(render().stderr, /report.status/);
  await save({ ...report, collectedSources: ['unrecognized'] });
  assert.match(render().stderr, /supported source IDs/);
  await save({ ...report, sections: { evidence: { sources: [{ title: '来源', url: 'javascript:alert(1)' }] } } });
  assert.match(render().stderr, /Source URLs must be HTTP/);
  assert.equal(await readFile(path.join(cwd, 'report.html'), 'utf8'), html);

  const atLimit = { locale: 'zh-Hans', scope: 'full', valid: true, name: '相'.repeat(30), subtitle: '机'.repeat(30), description: '图'.repeat(4000), keywords: `${'景'.repeat(33)}a` };
  const sameKeywords = { locale: 'zh-Hans', scope: 'keywords-only', valid: true, keywords: atLimit.keywords };
  await save({ ...report, status: 'validated', plans: [sameKeywords, atLimit] });
  const accepted = render();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).limitIssues, undefined);
  const bothPlans = await readFile(path.join(cwd, 'report.html'), 'utf8');
  assert.equal([...bothPlans.matchAll(/class="keyword-list"/g)].length, 2);
  assert.match(bothPlans, /data-field="name"/);
  const tooLong = { ...atLimit, name: `${atLimit.name}机`, subtitle: `${atLimit.subtitle}图`, description: `${atLimit.description}像`, keywords: `${atLimit.keywords}b` };
  const tooShort = { ...atLimit, locale: 'en-US', name: 'A' };
  const invalid = { ...report, plans: [tooLong, tooShort], sections: { ...report.sections, usa: {} } };
  await save({ ...invalid, status: 'validated' });
  assert.match(render().stderr, /Invalid field lengths:.*\.name: 31.*\.subtitle: 31.*\.description: 4001.*\.keywords: 101.*\.name: 1/);
  await save(invalid);
  const provisional = render();
  assert.equal(provisional.status, 0, provisional.stderr);
  assert.deepEqual(JSON.parse(provisional.stdout).limitIssues.map(({ field, count }) => [field, count]), [
    ['name', 31], ['subtitle', 31], ['description', 4001], ['keywords', 101], ['name', 1],
  ]);
  const flagged = await readFile(path.join(cwd, 'report.html'), 'utf8');
  assert.match(flagged, /id="usa"><h3><img class="market-flag"[^>]+><span>美国区<\/span><\/h3><p class="market-empty">暂无可用数据<\/p>/);
  assert.doesNotMatch(flagged, /role="tablist"/);
  assert.match(flagged, /至少 2 字符/);
  assert.doesNotMatch(flagged, /字段校验通过/);

  const japan = { id: 'jp', tables: [{ columns: ['关键词'], rows: [['撮影']] }] };
  await save({ ...report, markets: [japan, { id: 'hk' }, { id: 'mo' }, { id: 'tw', label: '旧名称' }, { id: 'custom', label: '自定义地区' }] });
  assert.equal(render().status, 0);
  const expanded = await readFile(path.join(cwd, 'report.html'), 'utf8');
  assert.match(expanded, /aria-controls="column-market-jp" aria-pressed="true"><img class="market-flag" src="data:image\/svg\+xml;base64,[^"]+"[^>]+><span>日本区<\/span><\/button>/);
  assert.match(expanded, /id="market-jp"><h3><img class="market-flag"[^>]+><span>日本区<\/span><\/h3>/);
  assert.match(expanded, /<span>中国台湾<\/span>/);
  assert.match(expanded, /<span>中国香港<\/span>/);
  assert.match(expanded, /<span>中国澳门<\/span>/);
  assert.doesNotMatch(expanded, /旧名称/);
  assert.match(expanded, /id="market-custom"><h3><span>自定义地区<\/span><\/h3>/);
  assert.match(expanded, /撮影/);

  const rankedColumns = ['关键词', '本品排名', '竞品排名'];
  const productIcon = `data:image/png;base64,${await readFile(new URL('../src/aso-report-icons/app-store.png', import.meta.url), 'base64')}`;
  await save({ ...report, productIcon, comparisonApps: [
    { name: '姿势照相机', url: 'https://apps.apple.com/cn/app/id6743343202', icon: productIcon },
    { name: '可颂', role: 'reference', url: 'https://apps.apple.com/cn/app/id6479338276' },
  ], sections: {}, markets: [
    { id: 'cn', keywordTopics: { 拍照姿势: '姿势参考' }, tables: [{ columns: rankedColumns, rows: [['拍照姿势', 8, 4]] }] },
    { id: 'us', keywordTopics: { 'photo poses': '姿势参考' }, tables: [{ columns: rankedColumns, rows: [['photo poses', 12, 7]] }] },
  ] });
  assert.equal(render().status, 0);
  const joined = await readFile(path.join(cwd, 'report.html'), 'utf8');
  assert.match(joined, /<th scope="row">姿势参考<\/th><td data-market-column="china" data-market-result>.*拍照姿势.*<td data-market-column="usa" data-market-result>.*photo poses/);
  assert.match(joined, /<h1><img class="report-app-icon"[^>]+>相机 &lt;example&gt;<\/h1>/);
  assert.match(joined, /id="comparison-apps-title">竞品<\/p>/);
  assert.match(joined, /href="https:\/\/apps.apple.com\/cn\/app\/id6743343202"[^>]+>.*姿势照相机<\/span>/);
  assert.doesNotMatch(joined, /可颂|内容参考/);
  assert.ok(joined.indexOf('class="comparison-apps"') < joined.indexOf('id="summary"'));

  await save({ ...report, sections: {}, comparisonApps: [
    { id: 'first', name: '姿势照相机', url: 'https://apps.apple.com/cn/app/id6743343202' },
    { id: 'second', name: 'Pose 相机', url: 'https://apps.apple.com/cn/app/id1482461383' },
  ], markets: [{
    id: 'cn',
    tables: [{ columns: rankedColumns, rows: [['拍照姿势', 8, 4], ['姿势模板', 6, 9]] }],
    competitorRanks: { second: { 拍照姿势: 11 } },
  }] });
  assert.equal(render().status, 0);
  const competitors = await readFile(path.join(cwd, 'report.html'), 'utf8');
  assert.match(competitors, /data-competitor-index="0" aria-pressed="true"/);
  assert.match(competitors, /data-competitor-index="1" aria-pressed="false"/);
  assert.match(competitors, /<b data-competitor-ranks="\[4,11\]">4<\/b>/);
  assert.match(competitors, /<td data-competitor-ranks="\[4,11\]">4<\/td>/);
  assert.match(competitors, /data-competitor-ranks="\[9,null\]"/);

  await save({ ...report, productIcon: 'data:image/svg+xml;base64,PHN2Zz4=' });
  assert.match(render().stderr, /report.productIcon must be a PNG, JPEG or WebP/);

  await save({ ...report, markets: [japan, japan] });
  assert.match(render().stderr, /Duplicate market ID: jp/);

  await save({ ...report, markets: catalogEntries.map(({ id }) => ({ id })) });
  const fullCatalog = render();
  assert.equal(fullCatalog.status, 0, fullCatalog.stderr);
  const fullCatalogHtml = await readFile(path.join(cwd, 'report.html'), 'utf8');
  assert.equal([...fullCatalogHtml.matchAll(/class="market-flag" src="data:image\/svg\+xml;base64,/g)].length, 498);
});
