import test from 'node:test';
import { reviewKnowledgeWorkspace } from '../src/knowledge.js';
import {
  buildCodeExtensionCandidate,
  initGrowthWorkspace,
  observeGrowthWorkspace,
} from '../src/growth.js';

import {
  assert,
  spawnSync,
  fs,
  os,
  path,
  sharp,
  buildReviewExportPayload,
  renderReviewArtifact,
  addBenchmarkWorkspace,
  advanceOpenSpecTaskWorkspace,
  applyOpenPrdChangeWorkspace,
  approveBenchmarkWorkspace,
  archiveOpenPrdChangeWorkspace,
  captureWorkspace,
  checkDevelopmentStandardsWorkspace,
  checkStandardsWorkspace,
  clarifyWorkspace,
  classifyExternalReferenceWorkspace,
  classifyWorkspace,
  diagramWorkspace,
  diffWorkspace,
  doctorWorkspace,
  finishLoopWorkspace,
  fleetWorkspace,
  freezeWorkspace,
  generateLearningReviewWorkspace,
  generateOpenSpecChangeWorkspace,
  handoffWorkspace,
  historyWorkspace,
  initLoopWorkspace,
  initQualityWorkspace,
  initWorkspace,
  interviewWorkspace,
  learnQualityWorkspace,
  listAcceptedSpecsWorkspace,
  listBenchmarkWorkspace,
  listOpenPrdChangesWorkspace,
  listOpenSpecTaskWorkspace,
  main,
  nextLoopWorkspace,
  nextWorkspace,
  observeBenchmarkSourceWorkspace,
  openspecDiscoveryWorkspace,
  planLoopWorkspace,
  playgroundWorkspace,
  promptLoopWorkspace,
  reviewGrowthWorkspace,
  reviewPresentationWorkspace,
  reviewWorkspace,
  runLoopWorkspace,
  runWorkspace,
  setLearningReviewModeWorkspace,
  setupAgentIntegrationWorkspace,
  statusLoopWorkspace,
  synthesizeWorkspaceBase,
  updateAgentIntegrationWorkspace,
  validateOpenSpecChangeWorkspace,
  validateWorkspace,
  verifyBenchmarkWorkspace,
  verifyLoopWorkspace,
  verifyQualityWorkspace,
  visualCompareWorkspace,
  visualPrepareWorkspace,
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  checkCodexCliHealth,
  ensureCodexCliReady,
  createRunWorkspace,
  OPENPRD_LITE_WRITE_TOOL_MATCHER,
  OPENPRD_GUARDED_WRITE_TOOL_MATCHER,
  TEST_OPENPRD_HOME,
  hasTomlFeatureKey,
  findOpenPrdHookGroup,
  makeTempProject,
  pathExists,
  readJsonl,
  writeAnswersFile,
  writeConcreteBasicDocs,
  writeSourceManual,
  writeFolderManual,
  writeFakeCodexBin,
  writeLoopProject,
  mergeReviewPresentation,
  validReviewPresentation,
  writeValidReviewPresentation,
  synthesizeWorkspace,
  writeMinimalChange,
} from './helpers/openprd-test-helpers.js';
import {
  detectVisualReview,
  listVisualReviewArtifacts,
} from '../src/quality-visual-review.js';

test('visual-prepare writes reference-set crops, contact sheet, and board templates', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const reference = path.join(project, 'reference-board.png');

  await sharp({
    create: {
      width: 400,
      height: 240,
      channels: 3,
      background: '#1d4ed8',
    },
  }).png().toFile(reference);

  const result = await visualPrepareWorkspace(project, {
    reference,
    grid: '2x2',
    include: '01,04',
    title: '登录候选图',
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'grid');
  assert.equal(result.itemCount, 2);
  assert.ok(result.referenceSetPath.includes(path.join('.openprd', 'harness', 'visual-reviews', 'reference-sets')));
  assert.equal((await sharp(result.contactSheetPath).metadata()).format, 'jpeg');

  const referenceSet = JSON.parse(await fs.readFile(result.referenceSetPath, 'utf8'));
  assert.equal(referenceSet.schema, 'openprd.reference-set.v1');
  assert.deepEqual(referenceSet.selection.grid, { columns: 2, rows: 2 });
  assert.equal(referenceSet.items.length, 2);
  assert.deepEqual(referenceSet.items.map((item) => item.id), ['01', '04']);
  assert.ok(referenceSet.artifacts.comparePlan.endsWith('compare-plan.json'));

  const focusBoard = JSON.parse(await fs.readFile(result.focusBoardTemplatePath, 'utf8'));
  assert.equal(focusBoard.mode, 'focus-board');
  assert.equal(focusBoard.focusRegions.length, 2);
  assert.equal(focusBoard.left.path, referenceSet.source.stagedPath);

  const parallelBoard = JSON.parse(await fs.readFile(result.parallelBoardTemplatePath, 'utf8'));
  assert.equal(parallelBoard.mode, 'parallel-board');
  assert.equal(parallelBoard.items.length, 2);
  assert.equal(parallelBoard.items[0].media[0].path, referenceSet.items[0].cropPath);

  const comparePlan = JSON.parse(await fs.readFile(result.comparePlanPath, 'utf8'));
  assert.equal(comparePlan.schema, 'openprd.visual-prepare.plan.v1');
  assert.equal(comparePlan.items.length, 2);
  assert.ok(comparePlan.items[0].suggestedCommand.includes('openprd visual-compare . --reference'));

  const cropMetadata = await sharp(result.items[0].cropPath).metadata();
  assert.equal(cropMetadata.format, 'png');
  assert.ok(cropMetadata.width > 0);
  assert.ok(cropMetadata.height > 0);

  const boxesPlan = path.join(project, 'boxes-plan.json');
  await fs.writeFile(boxesPlan, `${JSON.stringify({
    title: '手工映射',
    summary: '测试 boxes 模式。',
    items: [
      {
        id: 'hero',
        label: '首屏 Hero',
        box: { unit: 'ratio', x: 0, y: 0, width: 0.5, height: 0.5 },
      },
      {
        id: 'cta',
        label: 'CTA 区',
        box: { unit: 'ratio', x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
      },
    ],
  }, null, 2)}\n`);
  const cliLogs = [];
  const originalLog = console.log;
  console.log = (...args) => cliLogs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-prepare',
      project,
      '--reference',
      reference,
      '--boxes',
      boxesPlan,
      '--id',
      'manual-boxes',
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(cliLogs.join('\n'));
  assert.equal(cliResult.mode, 'boxes');
  assert.equal(cliResult.setId, 'manual-boxes');
  assert.equal(cliResult.itemCount, 2);
  const cliReferenceSet = JSON.parse(await fs.readFile(cliResult.referenceSetPath, 'utf8'));
  assert.equal(cliReferenceSet.selection.boxesPath, 'boxes-plan.json');
  assert.deepEqual(cliReferenceSet.items.map((item) => item.id), ['hero', 'cta']);
});

test('visual-compare writes side-by-side review images', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const reference = path.join(project, 'reference.png');
  const actual = path.join(project, 'actual.jpg');

  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#d4af37',
    },
  }).png().toFile(reference);
  await sharp({
    create: {
      width: 240,
      height: 140,
      channels: 3,
      background: '#2f80ed',
    },
  }).jpeg({ quality: 90 }).toFile(actual);

  const result = await visualCompareWorkspace(project, {
    reference,
    actual,
    maxPanelWidth: 100,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'reference-actual');
  assert.equal(result.format, 'jpg');
  assert.equal(result.quality, 85);
  assert.equal(result.labels.reference, '效果图');
  assert.equal(result.labels.actual, '实现截图');
  assert.equal(result.reviewArtifact.locale, 'zh-CN');
  assert.equal(result.outputPath.includes(path.join('.openprd', 'harness', 'visual-reviews')), true);
  assert.ok(result.metadataPath.endsWith('.json'));
  const metadata = JSON.parse(await fs.readFile(result.metadataPath, 'utf8'));
  assert.equal(metadata.schema, 'openprd.visual-review.v1');
  assert.equal(metadata.mode, 'reference-actual');
  assert.equal(result.outputPath.endsWith('.jpg'), true);
  const jpgMetadata = await sharp(result.outputPath).metadata();
  assert.equal(jpgMetadata.format, 'jpeg');
  assert.ok(jpgMetadata.width > jpgMetadata.height);

  const pngOut = path.join(project, '.openprd', 'harness', 'visual-reviews', 'manual.png');
  const pngResult = await visualCompareWorkspace(project, {
    reference,
    actual,
    out: pngOut,
    format: 'png',
    maxPanelWidth: 100,
  });
  assert.equal(pngResult.outputPath, pngOut);
  assert.equal(pngResult.quality, null);
  assert.equal((await sharp(pngResult.outputPath).metadata()).format, 'png');

  const relativeOutResult = await visualCompareWorkspace(project, {
    reference,
    actual,
    out: path.join('.openprd', 'harness', 'visual-reviews', 'relative.webp'),
    maxPanelWidth: 100,
  });
  assert.equal(relativeOutResult.outputPath, path.join(project, '.openprd', 'harness', 'visual-reviews', 'relative.webp'));
  assert.equal(relativeOutResult.format, 'webp');
  assert.equal((await sharp(relativeOutResult.outputPath).metadata()).format, 'webp');

  const beforeAfterResult = await visualCompareWorkspace(project, {
    before: reference,
    after: actual,
    maxPanelWidth: 100,
  });
  assert.equal(beforeAfterResult.mode, 'before-after');
  assert.equal(beforeAfterResult.labels.reference, '修改前');
  assert.equal(beforeAfterResult.labels.actual, '修改后');
  assert.equal(beforeAfterResult.reviewArtifact.mode, 'before-after');
  assert.ok(path.basename(beforeAfterResult.outputPath).startsWith('visual-before-after-'));
  assert.ok(beforeAfterResult.nextActions.join('\n').includes('未改区域'));

  const englishResult = await visualCompareWorkspace(project, {
    reference,
    actual,
    locale: 'en',
    maxPanelWidth: 100,
  });
  assert.equal(englishResult.labels.reference, 'Reference');
  assert.equal(englishResult.labels.actual, 'Implementation');
  assert.equal(englishResult.reviewArtifact.locale, 'en');
  assert.ok(englishResult.nextActions.join('\n').includes('implementation'));

  const cliOut = path.join(project, '.openprd', 'harness', 'visual-reviews', 'cli.jpg');
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-compare',
      project,
      '--reference',
      reference,
      '--actual',
      actual,
      '--out',
      cliOut,
      '--quality',
      '82',
      '--max-panel-width',
      '100',
      '--locale',
      'en',
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.outputPath, cliOut);
  assert.equal(cliResult.mode, 'reference-actual');
  assert.equal(cliResult.quality, 82);
  assert.equal(cliResult.labels.reference, 'Reference');
  assert.equal(cliResult.labels.actual, 'Implementation');
  assert.equal((await sharp(cliOut).metadata()).format, 'jpeg');

  const beforeAfterCliOut = path.join(project, '.openprd', 'harness', 'visual-reviews', 'cli-before-after.jpg');
  const beforeAfterLogs = [];
  console.log = (...args) => beforeAfterLogs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-compare',
      project,
      '--before',
      reference,
      '--after',
      actual,
      '--out',
      beforeAfterCliOut,
      '--max-panel-width',
      '100',
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const beforeAfterCliResult = JSON.parse(beforeAfterLogs.join('\n'));
  assert.equal(beforeAfterCliResult.outputPath, beforeAfterCliOut);
  assert.equal(beforeAfterCliResult.mode, 'before-after');
  assert.equal(beforeAfterCliResult.labels.reference, '修改前');
  assert.equal(beforeAfterCliResult.labels.actual, '修改后');
  assert.equal((await sharp(beforeAfterCliOut).metadata()).format, 'jpeg');
});

test('visual-compare writes focus and parallel review boards and quality can detect them', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const reference = path.join(project, 'reference.png');
  const actual = path.join(project, 'actual.png');
  const experimentA = path.join(project, 'experiment-a.png');
  const experimentB = path.join(project, 'experiment-b.png');

  await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: '#f59e0b',
    },
  }).png().toFile(reference);
  await sharp({
    create: {
      width: 320,
      height: 200,
      channels: 3,
      background: '#2563eb',
    },
  }).png().toFile(actual);
  await sharp({
    create: {
      width: 220,
      height: 180,
      channels: 3,
      background: '#0f766e',
    },
  }).png().toFile(experimentA);
  await sharp({
    create: {
      width: 220,
      height: 180,
      channels: 3,
      background: '#7c3aed',
    },
  }).png().toFile(experimentB);

  const focusBoardPath = path.join(project, 'focus-board.json');
  await fs.writeFile(focusBoardPath, `${JSON.stringify({
    mode: 'focus-board',
    title: '登录卡片局部验收',
    left: {
      path: reference,
      label: '效果图',
    },
    right: {
      path: actual,
      label: '实现截图',
    },
    focusRegions: [
      {
        label: '主按钮区',
        reason: '检查文案长度和对齐',
        leftBox: { unit: 'ratio', x: 0.18, y: 0.56, width: 0.28, height: 0.18 },
        rightBox: { unit: 'ratio', x: 0.2, y: 0.58, width: 0.28, height: 0.18 },
      },
      {
        label: '标题区',
        reason: '检查字号和间距',
        leftBox: { unit: 'ratio', x: 0.14, y: 0.12, width: 0.42, height: 0.2 },
        rightBox: { unit: 'ratio', x: 0.14, y: 0.12, width: 0.42, height: 0.2 },
      },
    ],
  }, null, 2)}\n`);

  const focusResult = await visualCompareWorkspace(project, {
    board: focusBoardPath,
    maxPanelWidth: 180,
  });
  assert.equal(focusResult.mode, 'focus-board');
  assert.equal(focusResult.focusRegions.length, 2);
  assert.equal(focusResult.reviewArtifact.mode, 'focus-board');
  assert.equal((await sharp(focusResult.outputPath).metadata()).format, 'jpeg');

  const parallelBoardPath = path.join(project, 'parallel-board.json');
  await fs.writeFile(parallelBoardPath, `${JSON.stringify({
    mode: 'parallel-board',
    title: '登录方案并行实验',
    summary: '把方案截图和指标放到一个审查板里。',
    columns: 2,
    cardWidth: 240,
    items: [
      {
        label: '方案 A',
        subtitle: '更紧凑的按钮布局',
        verdict: '继续观察',
        media: [
          { path: experimentA, label: '整体截图' },
        ],
        metrics: [
          { label: '首屏耗时', value: '420ms' },
          { label: '按钮高度', value: '44px' },
        ],
      },
      {
        label: '方案 B',
        subtitle: '更宽的按钮和更大留白',
        verdict: '优先评审',
        media: [
          { path: experimentB, label: '整体截图' },
        ],
        metrics: [
          { label: '首屏耗时', value: '438ms' },
          { label: '按钮高度', value: '48px' },
        ],
        notes: '继续看视觉一致性',
      },
    ],
  }, null, 2)}\n`);

  const parallelLogs = [];
  const originalLog = console.log;
  console.log = (...args) => parallelLogs.push(args.join(' '));
  try {
    assert.equal(await main([
      'visual-compare',
      project,
      '--board',
      parallelBoardPath,
      '--json',
    ]), 0);
  } finally {
    console.log = originalLog;
  }
  const parallelResult = JSON.parse(parallelLogs.join('\n'));
  assert.equal(parallelResult.mode, 'parallel-board');
  assert.equal(parallelResult.items.length, 2);
  assert.equal((await sharp(parallelResult.outputPath).metadata()).format, 'jpeg');

  const verificationBoardPath = path.join(project, 'verification-board.json');
  await fs.writeFile(verificationBoardPath, `${JSON.stringify({
    mode: 'verification-board',
    title: '设置页截图实测',
    route: 'Computer Use 打开设置页并检查保存状态',
    columns: 2,
    cardWidth: 240,
    screenshots: [
      {
        path: experimentA,
        label: '初始状态截图',
        status: '通过',
        checks: [
          { label: '入口', value: '设置页可打开' },
          { label: '按钮', value: '保存按钮可见' },
        ],
      },
      {
        path: experimentB,
        label: '保存后截图',
        status: '通过',
        checks: [
          { label: '反馈', value: '保存状态可见' },
          { label: '布局', value: '未出现明显漂移' },
        ],
      },
    ],
  }, null, 2)}\n`);
  const verificationResult = await visualCompareWorkspace(project, {
    board: verificationBoardPath,
    maxPanelWidth: 180,
  });
  assert.equal(verificationResult.mode, 'verification-board');
  assert.equal(verificationResult.items.length, 2);
  assert.equal(verificationResult.reviewArtifact.mode, 'verification-board');
  assert.equal(verificationResult.reviewArtifact.presentation, 'compact-result');
  assert.equal(verificationResult.reviewArtifact.alignmentGuidesApplied, false);
  assert.equal(verificationResult.reviewArtifact.locale, 'zh-CN');
  assert.equal((await sharp(verificationResult.outputPath).metadata()).format, 'jpeg');

  const englishVerificationBoardPath = path.join(project, 'english-verification-board.json');
  await fs.writeFile(englishVerificationBoardPath, `${JSON.stringify({
    mode: 'verification-board',
    title: 'Settings Screenshot Verification',
    route: 'Open settings and confirm saved state',
    screenshots: [
      {
        path: experimentA,
        label: 'Initial State',
        status: 'Pass',
        checks: [
          { label: 'Entry', value: 'Settings opens' },
          { label: 'Button', value: 'Save button is visible' },
        ],
      },
    ],
  }, null, 2)}\n`);
  const englishVerificationResult = await visualCompareWorkspace(project, {
    board: englishVerificationBoardPath,
    locale: 'en',
    maxPanelWidth: 180,
  });
  assert.equal(englishVerificationResult.reviewArtifact.locale, 'en');
  assert.equal(englishVerificationResult.reviewArtifact.title, 'Settings Screenshot Verification');
  assert.ok(englishVerificationResult.nextActions.join('\n').includes('screenshot verification board'));

  const invalidLanguageBoardPath = path.join(project, 'invalid-language-board.json');
  await fs.writeFile(invalidLanguageBoardPath, `${JSON.stringify({
    mode: 'verification-board',
    title: 'Settings Screenshot Verification',
    summary: 'Validate the settings page screenshot and saved state visually',
    screenshot: experimentA,
  }, null, 2)}\n`);
  await assert.rejects(
    () => visualCompareWorkspace(project, {
      board: invalidLanguageBoardPath,
      locale: 'zh-CN',
      maxPanelWidth: 180,
    }),
    /Invalid visual board language for locale zh-CN[\s\S]*应跟随中文语境/,
  );

  const alignmentBoardPath = path.join(project, 'alignment-board.json');
  await fs.writeFile(alignmentBoardPath, `${JSON.stringify({
    mode: 'alignment-board',
    title: '市场卡片对齐验收',
    screenshot: actual,
    screenshotLabel: '真实页面截图',
    guides: [
      { axis: 'x', position: 32, label: '卡片左边界' },
      { axis: 'y', position: 44, label: '标题基线' },
      { axis: 'y', position: 96, label: '描述基线' },
    ],
    boxes: [
      { label: '第一张卡片', x: 24, y: 24, width: 86, height: 132 },
      { label: '第二张卡片', x: 118, y: 24, width: 86, height: 132 },
    ],
    containerGroups: [
      {
        label: '卡片容器轨道',
        pattern: '同构列表卡片外框',
        expected: '卡片左边界、宽度和行顶对齐',
        thresholdPx: 2,
        metrics: [
          { label: '卡片左边界 x', values: [32, 32, 32], thresholdPx: 2 },
          { label: '卡片宽度', values: [86, 86, 86], thresholdPx: 2 },
        ],
      },
    ],
    contentSlots: [
      {
        label: '第一行列表卡片内部内容槽位',
        pattern: '同构列表卡片',
        expected: '标题、标签、描述、状态、价格和按钮相同槽位对齐',
        thresholdPx: 2,
        metrics: [
          { label: '标题 y', values: [44, 44, 44], thresholdPx: 2 },
          { label: '描述 y', values: [96, 97, 96], thresholdPx: 2 },
          { label: '价格 y', values: [126, 126, 126], thresholdPx: 2 },
          { label: '操作区 x', values: [248, 248, 248], thresholdPx: 2 },
        ],
      },
    ],
  }, null, 2)}\n`);
  const alignmentResult = await visualCompareWorkspace(project, {
    board: alignmentBoardPath,
    maxPanelWidth: 180,
  });
  assert.equal(alignmentResult.mode, 'alignment-board');
  assert.equal(alignmentResult.groups.length, 2);
  assert.equal(alignmentResult.reviewArtifact.mode, 'alignment-board');
  assert.deepEqual(alignmentResult.reviewArtifact.alignmentScope.contentSlotGroups, ['第一行列表卡片内部内容槽位']);
  assert.ok(alignmentResult.groups.some((group) => group.level === 'container'));
  assert.ok(alignmentResult.groups.some((group) => group.level === 'content-slot'));
  assert.match(alignmentResult.groups.find((group) => group.level === 'content-slot').metrics[0].value, /spread=0px/);
  assert.equal((await sharp(alignmentResult.outputPath).metadata()).format, 'jpeg');

  const centeredIcon = path.join(project, 'centered-icon.png');
  await sharp({
    create: {
      width: 120,
      height: 120,
      channels: 3,
      background: '#ffffff',
    },
  }).composite([
    {
      input: Buffer.from(`
<svg width="120" height="120" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
  <rect x="35" y="35" width="50" height="50" rx="10" fill="#111827"/>
</svg>`),
      left: 0,
      top: 0,
    },
  ]).png().toFile(centeredIcon);

  const centeringBoardPath = path.join(project, 'centering-board.json');
  await fs.writeFile(centeringBoardPath, `${JSON.stringify({
    mode: 'centering-board',
    title: '图标内部居中验收',
    image: centeredIcon,
    imageLabel: '图标裁切',
    thresholdPx: 2,
    subject: {
      mode: 'auto',
      weight: 'contrast',
    },
  }, null, 2)}\n`);
  const centeringResult = await visualCompareWorkspace(project, {
    board: centeringBoardPath,
    maxPanelWidth: 180,
  });
  assert.equal(centeringResult.mode, 'centering-board');
  assert.equal(centeringResult.reviewArtifact.mode, 'centering-board');
  assert.equal(centeringResult.centering.passed, true);
  assert.deepEqual(centeringResult.centering.bboxCenterOffset, { x: 0, y: 0 });
  assert.deepEqual(centeringResult.centering.visualCentroidOffset, { x: 0, y: 0 });
  assert.equal((await sharp(centeringResult.outputPath).metadata()).format, 'jpeg');

  const visualArtifacts = await listVisualReviewArtifacts(project);
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'focus-board'));
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'parallel-board'));
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'verification-board'));
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'alignment-board'));
  assert.ok(visualArtifacts.some((artifact) => artifact.mode === 'centering-board'));

  const includesAny = (text, patterns) => {
    const haystack = String(text ?? '').toLowerCase();
    return patterns.some((pattern) => {
      if (pattern instanceof RegExp) {
        return pattern.test(text);
      }
      return haystack.includes(String(pattern).toLowerCase());
    });
  };

  const focusReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次主要做登录按钮局部对比，需要看局部细节和焦点区域。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(focusReview.status, 'pass');
  assert.equal(focusReview.expectsFocusBoard, true);
  assert.ok(focusReview.matchingArtifacts.some((artifact) => artifact.mode === 'focus-board'));

  const parallelReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次在并行实验多个优化方向，需要一张并行实验方案证据板。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(parallelReview.status, 'pass');
  assert.equal(parallelReview.expectsParallelBoard, true);
  assert.ok(parallelReview.matchingArtifacts.some((artifact) => artifact.mode === 'parallel-board'));

  const verificationReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次用普通截图和 Computer 实测截图做验收，需要截图实测证据板。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(verificationReview.status, 'pass');
  assert.equal(verificationReview.expectsVerificationBoard, true);
  assert.ok(verificationReview.matchingArtifacts.some((artifact) => artifact.mode === 'verification-board'));

  const alignmentReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次新开发列表卡片，包含同构重复单元，需要检查相同文案类型和相同槽位的对齐辅助线。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(alignmentReview.status, 'pass');
  assert.equal(alignmentReview.expectsAlignmentBoard, true);
  assert.equal(alignmentReview.expectsContentSlotAlignment, true);
  assert.ok(alignmentReview.matchingArtifacts.some((artifact) => artifact.mode === 'alignment-board'));

  const centeringReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '用户反馈这个单个图标内部不居中，需要检查画布中心、主体外接框和视觉重心是否偏心。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts,
    includesAny,
  });
  assert.equal(centeringReview.status, 'pass');
  assert.equal(centeringReview.expectsCenteringBoard, true);
  assert.ok(centeringReview.matchingArtifacts.some((artifact) => artifact.mode === 'centering-board'));

  const containerOnlyAlignmentReview = detectVisualReview({
    policy: {
      requiredGates: ['visual-review'],
    },
    activeChangeContext: {
      text: '这次新开发卡片网格，需要检查标题、描述、价格和按钮这些内部内容槽位是否对齐。',
    },
    activeTasks: {
      tasks: [],
    },
    visualArtifacts: [
      {
        mode: 'alignment-board',
        path: '.openprd/harness/visual-reviews/container-only-alignment-board.jpg',
        groups: [
          {
            label: '卡片外框轨道',
            metrics: [
              { label: '列间距 spread', value: '16, 16px / spread=0px / 阈值=2px / 通过' },
            ],
          },
        ],
      },
    ],
    includesAny,
  });
  assert.equal(containerOnlyAlignmentReview.status, 'needs-evidence');
  assert.equal(containerOnlyAlignmentReview.expectsContentSlotAlignment, true);
  assert.match(containerOnlyAlignmentReview.warnings.join('\n'), /内部内容槽位/);

  for (const text of [
    '这次新开发卡片网格，需要检查相同槽位对齐。',
    '用户反馈页面排版漂移，需要对齐辅助线复核。',
    '用户说这些元素对齐有问题，需要量坐标偏差。',
  ]) {
    const naturalLanguageAlignmentReview = detectVisualReview({
      policy: {
        requiredGates: ['visual-review'],
      },
      activeChangeContext: {
        text,
      },
      activeTasks: {
        tasks: [],
      },
      visualArtifacts,
      includesAny,
    });
    assert.equal(naturalLanguageAlignmentReview.status, 'pass');
    assert.equal(naturalLanguageAlignmentReview.expectsAlignmentBoard, true);
    assert.ok(naturalLanguageAlignmentReview.matchingArtifacts.some((artifact) => artifact.mode === 'alignment-board'));
  }
});
