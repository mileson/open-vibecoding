import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferTestStrategyForTask,
  summarizeTaskTestStrategies,
  taskTestStrategy,
  validateTaskTestStrategy,
} from '../src/test-strategy.js';

test('explicit user-journey evidence is not penalized for lacking lower test layers', () => {
  for (const layer of ['e2e', 'visual', 'weapp']) {
    const summary = summarizeTaskTestStrategies([{
      title: '核对用户实际取得的结果',
      metadata: {
        'test-layer': layer,
        'test-size': 'large',
        'test-scope': 'user-flow',
        evidence: '在隔离测试环境完成受影响路径并检查结果',
      },
    }]);
    assert.equal(summary.layerCounts[layer], 1);
    assert.equal(summary.layerCounts.unit, 0);
    assert.equal(summary.evidencePresent, 1);
    assert.deepEqual(summary.warnings, []);
  }
});

test('inferTestStrategyForTask only upgrades to weapp runtime for explicit runtime validation intent', () => {
  const runtimeStrategy = inferTestStrategyForTask({
    title: '微信小程序结果页按钮没反应，直接修一下并验证截图',
  });
  assert.deepEqual(runtimeStrategy.layers, ['integration', 'weapp']);
  assert.equal(runtimeStrategy.scope, 'weapp-runtime');
  assert.ok(runtimeStrategy.evidencePlan.includes('小程序运行态截图'));

  const copyStrategy = inferTestStrategyForTask({
    title: '微信小程序首页会员文案改短一点',
  });
  assert.notDeepEqual(copyStrategy.layers, ['integration', 'weapp']);
  assert.notEqual(copyStrategy.scope, 'weapp-runtime');
});

test('inferTestStrategyForTask treats lightweight visible UI fixes as visual flow', () => {
  const strategy = inferTestStrategyForTask({
    title: '这个间距留着有点多，把卡片宽度增大一些',
  });

  assert.deepEqual(strategy.layers, ['integration', 'e2e']);
  assert.equal(strategy.scope, 'visual-flow');
  assert.match(strategy.evidencePlan, /before\/after|verification-board/);
  assert.match(strategy.upgradeReason, /轻量 UI 可视优化/);
});

test('inferTestStrategyForTask routes single element internal centering to centering-board evidence', () => {
  const strategy = inferTestStrategyForTask({
    title: '这个图标内部不居中，视觉重心有点偏心，需要重新对齐',
  });

  assert.deepEqual(strategy.layers, ['integration', 'e2e']);
  assert.equal(strategy.scope, 'visual-flow');
  assert.match(strategy.evidencePlan, /centering-board/);
  assert.match(strategy.evidencePlan, /视觉重心/);
});

test('inferTestStrategyForTask routes real audio and ASR claims to media evidence', () => {
  const asr = inferTestStrategyForTask({
    title: '验证 ASR 词级时间戳与最终视频音轨同步，并复测字幕漂移',
  });
  assert.deepEqual(asr.layers, ['integration', 'manual']);
  assert.equal(asr.scope, 'media-flow');
  assert.match(asr.evidencePlan, /openprd\.media-evidence\.v1/);
  assert.match(asr.evidencePlan, /最终交付媒体重新提取/);
  assert.match(asr.evidencePlan, /gold transcript.*unknown/);

  const acoustic = inferTestStrategyForTask({
    title: '优化导出音轨的响度和底噪，检查削波与静音断点',
  });
  assert.deepEqual(acoustic.layers, ['integration', 'manual']);
  assert.equal(acoustic.scope, 'media-flow');
});

test('audio evidence profile provides an explicit semantic route and validates its contract', () => {
  const strategy = taskTestStrategy({
    title: '验证处理结果',
    metadata: {
      'evidence-profile': 'audio-asr',
      'test-layer': 'integration, manual',
      'test-size': 'medium',
      'test-scope': 'media-flow',
      'evidence-plan': 'write openprd.media-evidence.v1',
    },
  });
  assert.equal(strategy.scope, 'media-flow');
  assert.equal(strategy.evidenceProfile, 'audio-asr');
  assert.deepEqual(strategy.layers, ['integration', 'manual']);
  assert.deepEqual(validateTaskTestStrategy({
    metadata: {
      'evidence-profile': 'audio-asr',
      'test-layer': 'integration, manual',
      'test-size': 'medium',
      'test-scope': 'media-flow',
      'evidence-plan': 'write openprd.media-evidence.v1',
    },
  }), []);
  assert.match(validateTaskTestStrategy({
    metadata: {
      'evidence-profile': 'unknown-media-profile',
      'evidence-plan': 'unknown',
    },
  }).join('\n'), /evidence-profile 无效/);
  assert.match(validateTaskTestStrategy({
    metadata: {
      'evidence-profile': 'audio-asr',
      'test-layer': 'integration, manual',
      'test-scope': 'media-flow',
      'waiver-reason': '没有样本',
    },
  }).join('\n'), /不接受通用 waiver.*blocked/);
});

test('subtitle copy and UI changes do not trigger media evidence without a real media claim', () => {
  for (const title of [
    '把这句字幕翻译成英文并修正错别字',
    '只调整 ASR 字幕的字体、字号、颜色和卡片布局',
    '修改音量按钮颜色和播放控件布局',
    '写一段 AI 口播稿，不处理录音',
    '沉淀音频转字幕分析与优化方法论和证据 schema',
  ]) {
    const strategy = inferTestStrategyForTask({ title });
    assert.notEqual(strategy.scope, 'media-flow', title);
  }

  const subtitleUi = inferTestStrategyForTask({
    title: '只调整 ASR 字幕的字体、字号、颜色和卡片布局',
  });
  assert.equal(subtitleUi.scope, 'visual-flow');
});
