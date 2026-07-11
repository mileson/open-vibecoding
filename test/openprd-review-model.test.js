import assert from 'node:assert/strict';
import test from 'node:test';

import { buildReviewExportPayload, renderReviewArtifact } from '../src/html-artifacts.js';
import {
  REVIEW_APPROVAL_SCHEMA,
  REVIEW_MODEL_SCHEMA,
  buildReviewModel,
  projectReviewModel,
} from '../src/review-model.js';

function reviewFixture(overrides = {}) {
  return {
    versionId: 'v0042',
    digest: 'snapshot-digest-42',
    workUnitId: 'wu-42',
    targetRoot: '/tmp/openprd-project',
    title: '双轨评审样例',
    createdAt: '2026-07-10T00:00:00.000Z',
    reviewPresentation: {
      panels: {
        flow: [{ summary: '优化评审', detail: '用户先看结论，需要时再核对依据。' }],
        function: [{ summary: '新增双视图', detail: '业务和工程使用同一份确认内容。' }],
        guardrail: [{ summary: '保持一致', detail: '切换视图不会改变确认基线。' }],
        risk: [{ summary: '避免两套真相', detail: '两个视图不能各自生成结论。' }],
      },
      designDirections: {
        directions: [
          { id: 'dual-track', title: '双轨证据工作台', summary: '同一结论，两种读法', tradeoff: '默认先展示业务结论' },
        ],
      },
    },
    sections: {
      problem: {
        problemStatement: '业务用户难以从工程信息里快速看懂这次要做什么。',
        whyNow: '需要降低评审门槛，同时保留工程追溯。',
        evidence: [
          '近一个月的评审里，同一项目多次重复解释相同背景。',
          { id: 'evidence-thread-audit', title: '线程审计', summary: '评审入口需要区分业务结论和工程证据。', path: 'reports/thread-audit.md' },
        ],
      },
      goals: {
        goals: ['让业务用户先看懂价值、范围、流程和风险。'],
        successMetrics: ['两个视图的确认指纹完全一致。'],
        acceptanceGoals: ['业务视图不显示内部字段名。', '工程视图可以定位到原始依据。'],
      },
      scope: {
        inScope: ['双视图、共享时间线、证据定位。'],
        outOfScope: ['不改变现有确认命令。'],
      },
      scenarios: {
        primaryFlows: ['用户打开评审页，默认阅读业务视图。'],
        edgeCases: ['需要核对细节时切换工程视图。'],
        failureModes: ['找不到依据时明确显示尚未登记。'],
      },
      requirements: {
        functional: ['提供业务视图和工程视图。'],
        nonFunctional: ['保持旧评审输入兼容。'],
      },
      constraints: {
        technical: ['复用现有 Review HTML 视觉系统。'],
        compliance: ['业务视图不暴露内部技术字段。'],
        dependencies: ['现有 snapshot 与 reviewPresentation。'],
      },
      handoff: {
        owner: 'OpenPrd',
        nextStep: '确认后进入任务拆解。',
        targetSystem: 'Review Studio',
      },
      risks: {
        risks: ['双视图可能产生两套结论。'],
        openQuestions: ['工程证据何时补齐。'],
      },
    },
    tasks: [
      { id: 'T-1', title: '实现双轨评审', status: 'in-progress', files: ['src/html-artifacts.js'] },
    ],
    ...overrides,
  };
}

test('canonical ReviewModel deterministically drives business and engineering projections', () => {
  const first = buildReviewModel(reviewFixture());
  const second = buildReviewModel(reviewFixture({
    createdAt: '2030-01-01T00:00:00.000Z',
    reviewPresentationMeta: { renderedAt: '2030-01-01T00:00:00.000Z' },
  }));
  const business = projectReviewModel(first, 'business');
  const engineering = projectReviewModel(first, 'engineering');
  const changedPresentation = buildReviewModel(reviewFixture({
    reviewPresentation: {
      ...reviewFixture().reviewPresentation,
      mapNodes: { problem: { title: '当前问题', text: '可见评审结论已经变化' } },
    },
  }));

  assert.equal(first.schema, REVIEW_MODEL_SCHEMA);
  assert.equal(first.digest, second.digest, 'render metadata must not change the decision digest');
  assert.notEqual(first.digest, changedPresentation.digest, 'visible decision copy must change the decision digest');
  assert.equal(business.modelDigest, first.digest);
  assert.equal(engineering.modelDigest, first.digest);
  assert.deepEqual(business.timeline, engineering.timeline);
  assert.deepEqual(business.approvalContract, engineering.approvalContract);
  assert.equal(first.approvalContract.schema, REVIEW_APPROVAL_SCHEMA);
  assert.match(first.approvalContract.approvalId, /^review:v0042:[a-f0-9]{16}$/u);
  assert.equal(first.approvalContract.snapshotDigest, 'snapshot-digest-42');
  assert.equal(first.evidenceReferences.length, 2);
  assert.equal(engineering.sections.tasks[0].id, 'T-1');
  assert.deepEqual(engineering.sections.files, ['src/html-artifacts.js', 'reports/thread-audit.md']);

  const businessCopy = JSON.stringify(business.sections);
  assert.doesNotMatch(businessCopy, /targetRoot|workUnitId|snapshotDigest|versionId/u);
});
test('review HTML defaults to the business projection and exposes working dual-view controls', () => {
  const snapshot = reviewFixture();
  const model = buildReviewModel(snapshot);
  const html = renderReviewArtifact({ snapshot });
  const businessStart = html.indexOf('id="reviewBusinessView"');
  const engineeringStart = html.indexOf('id="reviewEngineeringView"');
  const businessHtml = html.slice(businessStart, engineeringStart);

  assert.ok(html.includes('双轨证据工作台'));
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('data-review-tab="business"'));
  assert.ok(html.includes('data-review-tab="engineering"'));
  assert.ok(html.includes('id="reviewEngineeringView"'));
  assert.ok(html.includes('data-review-view="engineering"'));
  assert.match(html, /data-review-view="engineering"[\s\S]*?hidden/u);
  assert.ok(html.includes('id="reviewEngineeringFilter"'));
  assert.ok(html.includes('data-review-filter-item'));
  assert.ok(html.includes('data-review-locate="review-evidence-'));
  assert.ok(html.includes("behavior: prefersReducedMotion ? 'auto' : 'smooth'"));
  assert.ok(html.includes(`data-review-model-digest="${model.digest}"`));
  assert.ok(html.indexOf('aria-label="共享决策时间线"') < businessStart);
  assert.ok(businessHtml.includes('这些结论有 2 条依据可核对'));
  assert.equal(businessHtml.includes('工作单元'), false);
  assert.equal(businessHtml.includes('项目位置'), false);
  assert.equal(businessHtml.includes('内容指纹'), false);
  assert.ok(html.includes('openprd review . --mark confirmed'));
  assert.ok(html.includes("--digest &#39;snapshot-digest-42&#39;"));

  const payload = buildReviewExportPayload(snapshot);
  assert.equal(payload.reviewModel.digest, model.digest);
  assert.deepEqual(payload.reviewModel.approvalContract, model.approvalContract);
});

test('legacy review snapshots without trace or presentation still render both projections', () => {
  const snapshot = {
    versionId: 'v0001',
    title: '旧评审稿',
    sections: {
      problem: { problemStatement: '旧评审只有基础需求内容。' },
      scenarios: { primaryFlows: ['打开评审页并确认内容。'] },
    },
  };
  const model = buildReviewModel(snapshot);
  const html = renderReviewArtifact({ snapshot });

  assert.match(model.digest, /^[a-f0-9]{64}$/u);
  assert.equal(model.approvalContract.snapshotDigest, null);
  assert.ok(html.includes('业务视图'));
  assert.ok(html.includes('工程视图'));
  assert.ok(html.includes('旧版评审未记录'));
  assert.ok(html.includes('当前评审稿尚未绑定具体任务'));
});
