import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  checkStandardsWorkspace,
  initWorkspace,
  makeTempProject,
  reviewWorkspace,
  synthesizeWorkspace,
  writeConcreteBasicDocs,
  writeAnswersFile,
  captureWorkspace,
  writeValidReviewPresentation,
} from './helpers/openprd-test-helpers.js';
import { docsCompactWorkspace } from '../src/docs-compact.js';
import { buildReviewPresentationFeedback, renderReviewArtifact } from '../src/html-artifacts.js';
import { pruneQualityReports } from '../src/quality.js';

async function makeStandardsProject() {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeConcreteBasicDocs(project);
  return project;
}

const VALID_DESIGN_DIRECTIONS = {
  directions: [
    { id: 'direction-1', title: '沉浸单列流', image: '.openprd/design/active/direction-1.png', summary: '单列大图沉浸浏览，聚焦逐条确认', tradeoff: '信息密度较低' },
    { id: 'direction-2', title: '双栏对照板', image: '.openprd/design/active/direction-2.png', summary: '左侧列表右侧详情，适合快速对照', tradeoff: '小屏体验一般' },
    { id: 'direction-3', title: '卡片速览墙', image: '.openprd/design/active/direction-3.png', summary: '卡片网格速览全部方向，一屏总览', tradeoff: '单卡信息有限' },
  ],
};

test('standards verify warns on mega-lines and reports docs quality stats', async () => {
  const project = await makeStandardsProject();
  const docPath = path.join(project, 'docs', 'basic', 'backend-structure.md');
  const original = await fs.readFile(docPath, 'utf8');
  const megaLine = `- 追加说明：${'这个模块承接了很多历史逻辑，'.repeat(30)}`;
  await fs.writeFile(docPath, `${original}\n${megaLine}\n`);

  const report = await checkStandardsWorkspace(project);
  assert.ok(report.warnings.some((warning) => warning.includes('backend-structure.md') && warning.includes('巨行')));
  assert.ok(Array.isArray(report.docsQuality));
  const docStats = report.docsQuality.find((doc) => doc.path.includes('backend-structure.md'));
  assert.ok(docStats);
  assert.ok(docStats.megaLines >= 1);
  assert.ok(report.checks.some((check) => check.includes('Docs quality')));
});

test('standards verify stays clean for healthy docs', async () => {
  const project = await makeStandardsProject();
  const report = await checkStandardsWorkspace(project);
  assert.equal(report.warnings.filter((warning) => warning.includes('巨行')).length, 0);
});

test('docs-compact reports mega-line suggestions with line numbers', async () => {
  const project = await makeStandardsProject();
  const docPath = path.join(project, 'docs', 'basic', 'app-flow.md');
  const original = await fs.readFile(docPath, 'utf8');
  const megaLine = `流程更新：${'先做这个再做那个然后回填状态；'.repeat(30)}`;
  await fs.writeFile(docPath, `${original}\n${megaLine}\n`);

  const result = await docsCompactWorkspace(project);
  assert.equal(result.ok, true);
  const doc = result.docs.find((item) => item.path.includes('app-flow.md'));
  assert.ok(doc);
  assert.equal(doc.status, 'needs-compaction');
  assert.ok(doc.suggestions.length >= 1);
  assert.ok(doc.suggestions[0].line > 0);
  assert.ok(result.recommendations.some((item) => item.includes('app-flow.md')));
});

test('review presentation accepts valid designDirections and rejects bad ones', () => {
  const validFeedback = buildReviewPresentationFeedback({
    sections: {},
    reviewPresentation: { designDirections: VALID_DESIGN_DIRECTIONS },
  });
  assert.equal(validFeedback.violations.filter((item) => item.area === '交互方向评审').length, 0);

  const invalidFeedback = buildReviewPresentationFeedback({
    sections: {},
    reviewPresentation: {
      designDirections: {
        directions: [
          { id: 'direction-1', title: '这是一个远远超过十五个字符限制的方向名称标题', image: '', summary: '正常卖点' },
        ],
      },
    },
  });
  const areas = invalidFeedback.violations.filter((item) => item.area === '交互方向评审');
  assert.ok(areas.some((item) => item.ruleId === 'review-design-direction-count'));
  assert.ok(areas.some((item) => item.jsonPath?.endsWith('.title')));
  assert.ok(areas.some((item) => item.jsonPath?.endsWith('.image')));
});

test('review artifact renders design direction cards with selection commands', () => {
  const html = renderReviewArtifact({
    snapshot: {
      versionId: 'v0001',
      digest: 'abc123',
      title: '测试评审',
      sections: {},
      reviewPresentation: { designDirections: VALID_DESIGN_DIRECTIONS },
    },
  });
  assert.ok(html.includes('交互方向评审'));
  assert.ok(html.includes('沉浸单列流'));
  assert.ok(html.includes('--direction &#39;direction-2&#39;') || html.includes("--direction 'direction-2'"));
  assert.ok(html.includes('../../.openprd/design/active/direction-3.png'));
});

test('review --direction records the selected design direction', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await captureWorkspace(project, {
    jsonFile: await writeAnswersFile(project, 'direction-answers.json', {
      'meta.title': { value: '方向选择测试', source: 'user-confirmed' },
      'problem.problemStatement': { value: '界面需求需要在评审时确认交互方向。', source: 'user-confirmed' },
      'scenarios.primaryFlows': {
        value: ['打开评审面板', '浏览三个交互方向', '选定一个方向继续'],
        source: 'user-confirmed',
      },
    }),
  });
  const synth = await synthesizeWorkspace(project, {});
  const versionId = synth.snapshot.versionId;
  await writeValidReviewPresentation(project, versionId, { designDirections: VALID_DESIGN_DIRECTIONS });

  const blocked = await reviewWorkspace(project, { direction: 'direction-2' });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.errors.some((error) => error.includes('--mark')));

  const missing = await reviewWorkspace(project, { mark: 'confirmed', direction: 'direction-9' });
  assert.equal(missing.ok, false);
  assert.ok(missing.errors.some((error) => error.includes('direction-9')));

  const confirmed = await reviewWorkspace(project, { mark: 'confirmed', direction: 'direction-2' });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.designDirection?.id, 'direction-2');
  const currentState = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'state', 'current.json'), 'utf8'));
  assert.equal(currentState.reviewStatus.designDirection.id, 'direction-2');
});

test('quality report retention prunes stale eval files but keeps indexed ones', async () => {
  const project = await makeTempProject();
  const reportsDir = path.join(project, '.openprd', 'quality', 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const retained = [];
  for (let index = 4; index >= 0; index -= 1) {
    const reportId = `eval-2026070100000${index}`;
    await fs.writeFile(path.join(reportsDir, `${reportId}.json`), '{}');
    await fs.writeFile(path.join(reportsDir, `${reportId}.html`), '<html></html>');
    retained.push({ reportId });
  }
  await fs.writeFile(path.join(reportsDir, 'index.json'), '{}');

  const result = await pruneQualityReports(project, retained, { reports: { retentionEnabled: true, retentionMaxReports: 2 } });
  assert.equal(result.pruned, 6);
  const remaining = (await fs.readdir(reportsDir)).sort();
  assert.deepEqual(remaining, ['eval-20260701000003.html', 'eval-20260701000003.json', 'eval-20260701000004.html', 'eval-20260701000004.json', 'index.json'].sort());
});
