import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  checkDevelopmentStandardsWorkspace,
  designStarterWorkspace,
  initWorkspace,
  makeTempProject,
  sharp,
} from './helpers/openprd-test-helpers.js';
import { setDevCheckAutoRefactor } from '../src/dev-standards.js';
import { visualCompareWorkspace } from '../src/visual-compare.js';

async function makeDevProject() {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  return project;
}

async function writeBigCodeFile(project, relativePath, lines = 1600) {
  const body = ['const value = 1;', ...Array.from({ length: lines }, (_, index) => `// filler line ${index}`)].join('\n');
  const filePath = path.join(project, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}\n`);
  return relativePath;
}

test('dev-check defaults to auto-refactor mode with switch hint', async () => {
  const project = await makeDevProject();
  const bigFile = await writeBigCodeFile(project, 'src/big-module.js');

  const result = await checkDevelopmentStandardsWorkspace(project, { files: [bigFile] });
  assert.equal(result.autoRefactor.enabled, true);
  assert.equal(result.autoRefactor.mode, 'auto-refactor');
  assert.equal(result.wrapUp.mode, 'auto-refactor');
  assert.equal(result.wrapUp.title, 'OpenPRD 自动优化报告');
  assert.deepEqual(result.wrapUp.columns, ['影响对象', '问题级别', '源文件规模', '优化原因', '本次处理结果', '后续建议']);
  assert.ok(result.wrapUp.switchHint.includes('--auto-refactor off'));
  assert.ok(result.wrapUp.markdownBlock.includes('OpenPRD 自动优化报告'));
  const warningFile = result.files.find((file) => file.status === 'warning');
  assert.ok(warningFile.nextAction.includes('直接执行拆分'));
  assert.ok(result.wrapUp.rows[0]['本次处理结果'].includes('拆分'));
  assert.equal(typeof result.wrapUp.rows[0]['问题级别'], 'string');
  assert.equal(typeof result.wrapUp.rows[0]['源文件规模'], 'string');
  assert.equal(typeof result.wrapUp.rows[0]['优化原因'], 'string');
});

test('dev-check auto-refactor switch persists and flips wrap-up back to recommendations', async () => {
  const project = await makeDevProject();
  const bigFile = await writeBigCodeFile(project, 'src/big-module.js');

  const toggle = await setDevCheckAutoRefactor(project, false);
  assert.equal(toggle.ok, true);
  assert.equal(toggle.autoRefactor.enabled, false);
  const config = JSON.parse(await fs.readFile(path.join(project, toggle.configPath), 'utf8'));
  assert.equal(config.developmentStandards.autoRefactor.enabled, false);

  const result = await checkDevelopmentStandardsWorkspace(project, { files: [bigFile] });
  assert.equal(result.autoRefactor.enabled, false);
  assert.equal(result.wrapUp.mode, 'recommend');
  assert.equal(result.wrapUp.title, '后续建议');
  assert.deepEqual(result.wrapUp.columns, ['影响对象', '关注程度', '规模信号', '预警原因', '本次处理结果', '后续建议']);
  assert.equal(typeof result.wrapUp.rows[0]['关注程度'], 'string');
  assert.equal(typeof result.wrapUp.rows[0]['规模信号'], 'string');
  assert.equal(typeof result.wrapUp.rows[0]['预警原因'], 'string');
  assert.ok(result.wrapUp.switchHint.includes('--auto-refactor on'));
  const warningFile = result.files.find((file) => file.status === 'warning');
  assert.ok(!warningFile.nextAction.includes('直接执行拆分'));

  const reEnabled = await setDevCheckAutoRefactor(project, true);
  assert.equal(reEnabled.autoRefactor.enabled, true);
  const restored = await checkDevelopmentStandardsWorkspace(project, { files: [bigFile] });
  assert.equal(restored.wrapUp.mode, 'auto-refactor');
});

test('dev-check reminds about visual evidence for UI files and clears after board exists', async () => {
  const project = await makeDevProject();
  const uiFile = 'src/pages/home.html';
  await fs.mkdir(path.join(project, 'src', 'pages'), { recursive: true });
  await fs.writeFile(path.join(project, uiFile), '<html><body><h1>demo</h1></body></html>\n');

  const before = await checkDevelopmentStandardsWorkspace(project, { files: [uiFile] });
  assert.equal(before.visualEvidence.required, true);
  assert.deepEqual(before.visualEvidence.uiFiles, [uiFile]);
  assert.ok(before.visualEvidence.suggestedCommands.some((command) => command.includes('alignment-board')));
  assert.ok(before.visualEvidence.chatEmbedHint.includes('!['));

  const reviewsDir = path.join(project, '.openprd', 'harness', 'visual-reviews');
  await fs.mkdir(reviewsDir, { recursive: true });
  await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg()
    .toFile(path.join(reviewsDir, 'visual-before-after-test.jpg'));

  const after = await checkDevelopmentStandardsWorkspace(project, { files: [uiFile] });
  assert.equal(after.visualEvidence.required, false);
  assert.ok(after.visualEvidence.freshEvidence.length >= 1);

  const nonUi = await checkDevelopmentStandardsWorkspace(project, { files: ['src/big.js'] }).catch(() => null);
  if (nonUi) {
    assert.equal(nonUi.visualEvidence.uiFiles.length, 0);
  }
});

test('visual-compare attaches chat embed markdown for conversation-flow display', async () => {
  const project = await makeDevProject();
  const beforePath = path.join(project, 'before.png');
  const afterPath = path.join(project, 'after.png');
  await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 220, g: 60, b: 60 } } })
    .png()
    .toFile(beforePath);
  await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 60, g: 120, b: 220 } } })
    .png()
    .toFile(afterPath);

  const result = await visualCompareWorkspace(project, { before: beforePath, after: afterPath });
  assert.ok(result.chatEmbed);
  assert.equal(result.chatEmbed.label, '修改前后对比');
  assert.ok(result.chatEmbed.markdown.startsWith('![视觉证据: 修改前后对比]('));
  assert.ok(result.chatEmbed.markdown.includes(result.outputPath));
  assert.ok(result.nextActions.some((action) => action.includes('嵌入对话流')));
});

test('design-starter asset spec includes function icon row with best-practice routing', async () => {
  const project = await makeDevProject();
  await designStarterWorkspace(project, {
    starter: 'content-home',
    out: 'index.html',
    brief: '演示页',
    sections: '模块A|模块B',
    noExternalFacts: true,
    noBrandAssets: true,
    noRealImages: true,
  });
  const assetSpec = await fs.readFile(path.join(project, '.openprd', 'design', 'active', 'asset-spec.md'), 'utf8');
  assert.ok(assetSpec.includes('功能图标'));
  assert.ok(assetSpec.includes('Phosphor'));
  assert.ok(assetSpec.includes('Lucide'));
});
