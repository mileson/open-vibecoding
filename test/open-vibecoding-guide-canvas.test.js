import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  captureWorkspace,
  initWorkspace,
  makeTempProject,
  reviewWorkspace,
  synthesizeWorkspace,
  writeAnswersFile,
  writeValidReviewPresentation,
} from './helpers/open-vibecoding-test-helpers.js';
import { guideWorkspace, GUIDE_STAGES } from '../src/guide.js';
import { buildReviewDirectionsPayload } from '../src/canvas-workspace.js';
import { renderReviewArtifact } from '../src/html-artifacts.js';

const DESIGN_DIRECTIONS = {
  directions: [
    { id: 'direction-1', title: '沉浸单列流', image: '.open-vibecoding/design/active/direction-1.png', summary: '单列大图沉浸浏览，聚焦逐条确认', tradeoff: '信息密度较低' },
    { id: 'direction-2', title: '双栏对照板', image: '.open-vibecoding/design/active/direction-2.png', summary: '左侧列表右侧详情，适合快速对照', tradeoff: '小屏体验一般' },
  ],
};

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function makeReviewedProject() {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await captureWorkspace(project, {
    jsonFile: await writeAnswersFile(project, 'guide-answers.json', {
      'meta.title': { value: '流程指引测试', source: 'user-confirmed' },
      'problem.problemStatement': { value: '产品经理需要清晰的流程指引来推进评审。', source: 'user-confirmed' },
      'scenarios.primaryFlows': {
        value: ['查看当前阶段', '对比交互方向', '选定方向继续'],
        source: 'user-confirmed',
      },
    }),
  });
  const synth = await synthesizeWorkspace(project, {});
  return { project, versionId: synth.snapshot.versionId };
}

test('guide offers non-linear capabilities on a fresh workspace', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const result = await guideWorkspace(project);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'contextual');
  assert.equal(result.totalStages, null);
  assert.equal(result.currentStage.id, 'contextual');
  assert.equal(result.stages.length, GUIDE_STAGES.length);
  assert.ok(result.stages.every((stage) => stage.status === 'available'));
  assert.ok(!result.nextAction.includes('capture'));
});

test('canvas review-directions payload reports missing directions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const payload = await buildReviewDirectionsPayload(project);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.directions, []);
});

test('review artifact renders the stage rail with direction step when applicable', () => {
  const withDirections = renderReviewArtifact({
    snapshot: {
      versionId: 'v0001',
      digest: 'abc123',
      title: '阶段条测试',
      sections: {},
      reviewPresentation: { designDirections: DESIGN_DIRECTIONS },
    },
  });
  assert.ok(withDirections.includes('review-stage-rail'));
  assert.ok(withDirections.includes('方向选择'));
  assert.ok(withDirections.includes('你在这里'));

  const withoutDirections = renderReviewArtifact({
    snapshot: {
      versionId: 'v0002',
      digest: 'def456',
      title: '阶段条测试',
      sections: {},
    },
  });
  assert.ok(withoutDirections.includes('review-stage-rail'));
  assert.ok(!withoutDirections.includes('方向选择'));
});
