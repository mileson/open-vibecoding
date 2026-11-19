import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));

async function workspace(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'vibecoding-social-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return {
    call: (...args) => spawnSync(process.execPath, [cli, 'social-listening', ...args], { cwd, encoding: 'utf8' }),
    save: (name, value) => writeFile(path.join(cwd, name), value),
    read: name => readFile(path.join(cwd, name), 'utf8'),
    directory: name => mkdir(path.join(cwd, name)),
  };
}

test('renders portable HTML and protects arbitrary and previously rendered files', async t => {
  const { call, save, read } = await workspace(t);
  assert.equal(call('template', '--out', 'template.html').status, 0);
  assert.equal(call('template', '--out', 'template.html').status, 1);
  const icon = await readFile(new URL('../src/social-report-avatars/happy.png', import.meta.url), 'base64');
  const data = {
    product: '相机 <产品>', queriedAt: '2026-11-18', productIcon: `data:image/png;base64,${icon}`, summary: '模板受到认可',
    platforms: [{ id: 'xiaohongshu' }, { id: 'wechat_channels', status: 'credential_required' }],
    comments: [{ platform: 'xiaohongshu', topic: '模板', text: '<b>好用</b>', sentiment: 'positive', url: 'https://example.com/post' }],
    wordCloud: { terms: [{ word: '</script>', commentRows: [1] }] },
  };
  const saveData = () => save('data.json', JSON.stringify(data));
  await saveData();
  const csv = '\ufeff平台,标题\r\n小红书,跟拍\r\n';
  await save('data.csv', csv);
  await save('unrelated.html', 'other output');
  const render = (name = 'report.html') => call('render', '--data', 'data.json', '--csv', 'data.csv', '--out', name, '--template', 'template.html');
  assert.equal(render('unrelated.html').status, 1);
  assert.equal(await read('unrelated.html'), 'other output');
  const result = render();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).comments, 1);
  const original = await read('report.html');
  assert.match(original, /<h1><img class="product-icon"[^>]+>相机 &lt;产品&gt;<\/h1>/);
  assert.match(original, /缺少凭证/);
  assert.match(original, /<blockquote>&lt;b&gt;好用&lt;\/b&gt;<\/blockquote>/);
  assert.match(original, /<select id="platform" multiple hidden/);
  const csvPayload = original.match(/data:text\/csv;base64,([A-Za-z0-9+/=]+)"/)[1];
  assert.equal(Buffer.from(csvPayload, 'base64').toString('utf8'), csv);
  const payload = original.match(/id="word-cloud-data">([^<]+)<\/script>/)[1];
  assert.deepEqual(JSON.parse(payload).terms, [{ word: '</script>', ratio: 1, commentRows: [1] }]);
  data.wordCloud.terms[0].ratio = 2;
  await saveData();
  assert.match(render().stderr, /wordCloud ratio/);
  assert.equal(await read('report.html'), original);
  data.wordCloud.terms[0].ratio = 0.7;
  data.comments[0].url = 'javascript:alert(1)';
  await saveData();
  assert.match(render().stderr, /HTTP or HTTPS/);
  data.comments[0].url = 'https://example.com/post';
  await saveData();
  assert.equal(render().status, 0);
  assert.match(await read('report.html'), /"ratio":0.7/);
});

test('plans collection with no configured provider or missing credentials and keeps the initial plan', async t => {
  const { call, save, read } = await workspace(t);
  const result = JSON.parse(call('check').stdout).platforms;
  assert.equal(result[0].status, 'browser_check_required');
  assert.deepEqual(result[2].missing, ['platforms.wechat_channels.provider', 'platforms.wechat_channels.tokenEnv', 'platforms.wechat_channels.budgetUsd']);
  await save('config.json', JSON.stringify({ platforms: { xiaohongshu: { enabled: false }, wechat_channels: {
    provider: 'tikhub', tokenEnv: 'OPEN_VIBECODING_TEST_TOKEN_UNSET_XYZ', budgetUsd: 0.25, sort: 'latest', searchTopN: 12, detailTopN: 4,
  } } }));
  const args = ['run', '--product', '相机', '--out', 'research', '--config', 'config.json'];
  const run = call(...args);
  assert.equal(run.status, 0, run.stderr);
  const plan = JSON.parse(await read('research/collection-plan.json'));
  assert.equal(plan.platforms[0].status, 'not_selected');
  assert.equal(plan.platforms[2].status, 'credential_required');
  assert.equal(plan.platforms[2].sampling.sort, 'latest');
  assert.equal(plan.platforms[2].sampling.detailTopN, 4);
  assert.equal(call(...args).status, 1);
  assert.deepEqual(JSON.parse(await read('research/collection-plan.json')), plan);
});

test('shows unknown sentiment for a blocked source with no comments', async t => {
  const { call, save, read } = await workspace(t);
  await save('data.json', JSON.stringify({
    product: '相机', queriedAt: '2026-11-18', summary: '需要登录',
    platforms: [{ id: 'douyin', status: 'login_required' }],
  }));
  const result = call('render', '--data', 'data.json', '--out', 'report.html');
  assert.equal(result.status, 0, result.stderr);
  const report = await read('report.html');
  assert.match(report, /<span>开心<\/span> <b>—<\/b>/);
  assert.match(report, /暂无评论原文/);
  assert.doesNotMatch(report, /下载 CSV/);
});

test('imports collector evidence and authored findings for the HTML report', async t => {
  const { call, save, read, directory } = await workspace(t);
  assert.equal(call('run', '--product', '相机', '--out', 'research').status, 0);
  await directory('research/raw');
  await save('research/raw/douyin.canonical.json', JSON.stringify({
    platform: '抖音', availability: 'login_required', contents: [],
  }));
  await save('research/processed_rows.json', JSON.stringify([
    { 平台: '小红书', 一级评论内容: '夜景有噪音', 功能分类: '夜景', 情感分类: '消极', 内容地址: 'https://example.com/post', 覆盖状态: 'partial' },
    { 平台: '小红书', 一级评论内容: '会员可以试用吗？', 内容地址: 'content_id:123' },
  ]));
  await save('research/product_reviews_detail.csv', '平台,内容\n小红书,夜景有噪音\n');
  await save('analysis.json', JSON.stringify({
    queriedAt: '2026-11-18', summary: '夜景体验仍需改善',
    platforms: [{ id: 'xiaohongshu', summary: '有用户提到夜景噪音' }, { id: 'wechat_channels' }],
    wordCloud: { terms: [{ word: '噪点', aliases: ['噪音'] }] },
  }));
  const args = ['import', '--from', 'research', '--analysis', 'analysis.json', '--out', 'data.json'];
  const result = call(...args);
  assert.equal(result.status, 0, result.stderr);
  const imported = JSON.parse(result.stdout);
  assert.equal(imported.comments, 2);
  assert.equal(imported.sourceFiles, 1);
  assert.match(imported.csv, /product_reviews_detail\.csv$/);
  const data = JSON.parse(await read('data.json'));
  assert.equal(data.product, '相机');
  assert.deepEqual(Object.fromEntries(data.platforms.map(({ id, status }) => [id, status])), {
    xiaohongshu: 'partial', douyin: 'login_required', wechat_channels: 'configuration_required',
  });
  assert.deepEqual(data.wordCloud.terms, [{ word: '噪点', commentRows: [1] }]);
  assert.equal(data.comments[0].sentiment, 'negative');
  assert.equal(data.comments[0].url, 'https://example.com/post');
  assert.equal(data.comments[1].sentiment, 'unclassified');
  assert.equal(data.comments[1].url, undefined);
  assert.match(call(...args).stderr, /already exists/);
  const render = call('render', '--data', 'data.json', '--csv', imported.csv, '--out', 'report.html');
  assert.equal(render.status, 0, render.stderr);
  assert.match(await read('report.html'), /夜景体验仍需改善/);
});
