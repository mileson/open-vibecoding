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

test('dev-check reports code file line status and next actions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'generated'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'small.js'), `${Array.from({ length: 700 }, (_, index) => `export const small${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, 'src', 'medium.js'), `${Array.from({ length: 701 }, (_, index) => `export const medium${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, 'src', 'large.js'), `${Array.from({ length: 1501 }, (_, index) => `export const large${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, 'generated', 'bundle.js'), `${Array.from({ length: 2000 }, () => 'console.log("generated");').join('\n')}\n`);
  await fs.writeFile(path.join(project, 'README.md'), '# Readme\n');

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/small.js', 'src/medium.js', 'src/large.js', 'generated/bundle.js', 'README.md'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.thresholds.okMax, 700);
  assert.equal(result.thresholds.attentionMax, 1500);
  assert.equal(result.files.find((file) => file.path === 'src/small.js').status, 'ok');
  assert.equal(result.files.find((file) => file.path === 'src/medium.js').status, 'attention');
  assert.match(result.files.find((file) => file.path === 'src/medium.js').nextAction, /当前目标/);
  assert.equal(result.files.find((file) => file.path === 'src/medium.js').statusLabel, '🟡 低风险｜建议留意');
  assert.match(result.files.find((file) => file.path === 'src/medium.js').wrapUp.reason, /评审、回归和交接成本/);
  assert.equal(result.files.find((file) => file.path === 'src/large.js').status, 'warning');
  assert.equal(result.files.find((file) => file.path === 'src/large.js').statusLabel, '🟠 中风险｜建议优先关注');
  assert.match(result.files.find((file) => file.path === 'src/large.js').nextAction, /拆分/);
  assert.equal(result.wrapUp.required, false);
  assert.equal(result.wrapUp.recommended, true);
  assert.deepEqual(result.wrapUp.columns, ['影响对象', '关注程度', '规模信号', '预警原因', '本次处理结果', '后续建议']);
  assert.equal(result.wrapUp.rows.length, 2);
  assert.equal(result.wrapUp.rows[0].影响对象, 'src/large.js');
  assert.equal(result.wrapUp.rows[0].关注程度, '🟠 中风险｜建议优先关注');
  assert.equal(result.wrapUp.rows[0].规模信号, '1501 行（> 1500 行/文件）');
  assert.equal(result.wrapUp.rows[0].预警原因, '文件太大，后续改动风险高');
  assert.equal(result.wrapUp.rows[0].本次处理结果, '当前任务不受影响');
  assert.equal(result.wrapUp.rows[0].后续建议, '后续按职责拆分');
  assert.equal(result.wrapUp.rows[1].影响对象, 'src/medium.js');
  assert.equal(result.wrapUp.rows[1].规模信号, '701 行（> 700 行/文件）');
  assert.equal(result.wrapUp.rows[1].预警原因, '文件偏大，维护成本升');
  assert.equal(result.wrapUp.rows[1].本次处理结果, '本轮小改，未扩职责');
  assert.equal(result.wrapUp.rows[1].后续建议, '继续演进时再拆小');
  assert.equal(result.wrapUp.mode, 'recommend');
  assert.match(result.wrapUp.markdownBlock, /^\*\*后续建议\*\*/);
  assert.match(result.wrapUp.markdownTable, /\| 影响对象 \| 关注程度 \| 规模信号 \| 预警原因 \| 本次处理结果 \| 后续建议 \|/);
  assert.match(result.wrapUp.markdownTable, /src\/large\.js/);
  assert.match(result.wrapUp.markdownTable, /1501 行（> 1500 行\/文件）/);
  for (const row of result.wrapUp.rows) {
    assert.ok(Array.from(row.规模信号).length <= 20);
    assert.ok(Array.from(row.预警原因).length <= 20);
    assert.ok(Array.from(row.本次处理结果).length <= 20);
    assert.ok(Array.from(row.后续建议).length <= 20);
  }
  assert.equal(result.files.find((file) => file.path === 'generated/bundle.js').status, 'exempt');
  assert.equal(result.files.find((file) => file.path === 'README.md').status, 'ok');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['dev-check', project, 'src/large.js', '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.files[0].status, 'warning');
  assert.equal(cliResult.wrapUp.required, false);
  assert.equal(cliResult.wrapUp.recommended, true);
  assert.match(cliResult.wrapUp.markdownTable, /src\/large\.js/);

  const cwdLogs = [];
  const originalCwd = process.cwd();
  console.log = (...args) => cwdLogs.push(args.join(' '));
  try {
    process.chdir(project);
    assert.equal(await main(['dev-check', 'src/small.js', 'src/medium.js', '--json']), 0);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
  }
  const cwdCliResult = JSON.parse(cwdLogs.join('\n'));
  assert.equal(await fs.realpath(cwdCliResult.projectRoot), await fs.realpath(project));
  assert.deepEqual(cwdCliResult.files.map((file) => file.path), ['src/small.js', 'src/medium.js']);
  assert.equal(cwdCliResult.wrapUp.required, false);
  assert.equal(cwdCliResult.wrapUp.recommended, true);
  assert.equal(cwdCliResult.wrapUp.rows[0].影响对象, 'src/medium.js');
  assert.equal(cwdCliResult.wrapUp.rows[0].关注程度, '🟡 低风险｜建议留意');

  const userLogs = [];
  console.log = (...args) => userLogs.push(args.join(' '));
  try {
    assert.equal(await main(['dev-check', project, 'src/small.js', 'src/medium.js']), 0);
  } finally {
    console.log = originalLog;
  }
  const userOutput = userLogs.join('\n');
  assert.match(userOutput, /🟡 低风险｜建议留意/);
  assert.doesNotMatch(userOutput, /🔵/);
  assert.doesNotMatch(userOutput, /无明显影响/);
});

test('dev-check knowledge review attributes current touched files instead of stale turn state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'agent-current.js'), `${Array.from({ length: 701 }, (_, index) => `export const current${index} = ${index};`).join('\n')}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    id: 'turn-stale',
    title: 'Stale inherited turn',
    touchedFiles: [
      'src/old-agent-one.js',
      'src/old-agent-two.js',
      'src/old-agent-three.js',
    ],
    reviewSignals: [
      {
        id: 'old-dev-check',
        kind: 'dev-check',
        ok: true,
        summary: 'old signal',
        touchedFiles: ['src/old-agent-one.js', 'src/old-agent-two.js'],
      },
    ],
  }, null, 2)}\n`);

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/agent-current.js'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.knowledgeReview.skipped, false);
  assert.match(result.knowledgeReview.summary, /本轮围绕 1 个可沉淀文件生成回顾/);
  const candidate = JSON.parse(await fs.readFile(result.knowledgeReview.files.candidate, 'utf8'));
  assert.deepEqual(candidate.touchedFiles, ['src/agent-current.js']);
  assert.doesNotMatch(candidate.summary, /old-agent/);
  assert.equal(candidate.reviewSignals.some((signal) => signal.touchedFiles?.includes('src/old-agent-one.js')), false);
});

test('Stop hook injects nonblocking dev-check advice for touched large files', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'large.js'), `${Array.from({ length: 1501 }, (_, index) => `export const large${index} = ${index};`).join('\n')}\n`);

  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    prompt: '直接帮我改这个大文件里的一个小问题。',
    touchedFiles: ['src/large.js'],
  }, null, 2)}\n`);

  const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      hook_event_name: 'Stop',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(stop.status, 0);
  const payload = JSON.parse(stop.stdout);
  assert.equal(payload.continue, true);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(payload.hookSpecificOutput.additionalContext, /建议，不是收尾门禁/);
  assert.match(payload.hookSpecificOutput.additionalContext, /工作区规模债归入 workspaceAttention/);
  assert.match(payload.hookSpecificOutput.additionalContext, /当前为普通建议模式/);
  assert.match(payload.hookSpecificOutput.additionalContext, /\*\*后续建议\*\*/);
  assert.match(payload.hookSpecificOutput.additionalContext, /\| 影响对象 \| 关注程度 \| 规模信号 \| 预警原因 \| 本次处理结果 \| 后续建议 \|/);
  assert.match(payload.hookSpecificOutput.additionalContext, /src\/large\.js/);
  assert.match(payload.hookSpecificOutput.additionalContext, /🟠 中风险｜建议优先关注/);
  assert.match(payload.hookSpecificOutput.additionalContext, /1501 行（> 1500 行\/文件）/);
});

test('Stop hook reminds lightweight visible UI fixes need visual evidence', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src', 'styles'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'styles', 'cards.css'), '.card { max-width: 720px; }\n');

  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    prompt: '这个间距留着有点多，是不是可以考虑卡片的宽度都增大一些',
    touchedFiles: ['src/styles/cards.css'],
  }, null, 2)}\n`);

  const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      hook_event_name: 'Stop',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(stop.status, 0);
  const payload = JSON.parse(stop.stdout);
  assert.equal(payload.continue, true);
  const context = payload.hookSpecificOutput.additionalContext;
  assert.match(context, /卡片宽度、间距、留白/);
  assert.match(context, /轻量可视优化/);
  assert.match(context, /build、package 和 dev-check/);
  assert.match(context, /--before\/--after/);
  assert.match(context, /verification-board/);
});

test('Stop hook asks for project-level experience in structured plain language', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'experience.js'), 'export const experience = true;\n');

  await fs.writeFile(path.join(project, '.openprd', 'harness', 'turn-state.json'), `${JSON.stringify({
    version: 1,
    id: 'turn-project-experience',
    prompt: '把这次收尾体验也一起优化掉。',
    touchedFiles: ['src/experience.js'],
    reviewSignals: [
      {
        id: 'run-verify-pass',
        kind: 'run-verify',
        ok: true,
        productionReady: true,
        summary: '本轮收尾方式已经稳定，可作为后续默认处理方式',
        touchedFiles: ['src/experience.js'],
      },
    ],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'knowledge', 'review-signals.jsonl'), `${JSON.stringify({
    id: 'run-verify-pass',
    kind: 'run-verify',
    ok: true,
    productionReady: true,
    summary: '本轮收尾方式已经稳定，可作为后续默认处理方式',
    touchedFiles: ['src/experience.js'],
  })}\n`);

  const stop = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'Stop'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      hook_event_name: 'Stop',
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(stop.status, 0);
  const payload = JSON.parse(stop.stdout);
  const context = payload.hookSpecificOutput.additionalContext;
  assert.equal(payload.continue, true);
  assert.match(context, /这次我观察到一个以后可能重复出现的情况：/);
  assert.match(context, /我计划保留一条项目经验：/);
  assert.match(context, /这条经验只会保留在当前项目里。/);
  assert.doesNotMatch(context, /要我把它一起保留下来吗？/);
  assert.doesNotMatch(context, /Draft Skill:/);
  assert.doesNotMatch(context, /Promote:/);
});

test('dev-check wrap-up copy script keeps copy compact', () => {
  const scriptPath = path.resolve('scripts/dev-check-wrapup-copy.mjs');
  const run = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify({
      files: [
        { status: 'warning', lineCount: 2507, thresholds: { okMax: 700, attentionMax: 1500 } },
        { status: 'attention', lineCount: 1313, thresholds: { okMax: 700, attentionMax: 1500 } },
      ],
    }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 0);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.limit, 20);
  assert.deepEqual(payload.rows[0], {
    规模信号: '2507 行（> 1500 行/文件）',
    预警原因: '文件太大，后续改动风险高',
    本次处理结果: '当前任务不受影响',
    后续建议: '后续按职责拆分',
  });
  assert.deepEqual(payload.rows[1], {
    规模信号: '1313 行（> 700 行/文件）',
    预警原因: '文件偏大，维护成本升',
    本次处理结果: '本轮小改，未扩职责',
    后续建议: '继续演进时再拆小',
  });
  for (const row of payload.rows) {
    assert.ok(Array.from(row.规模信号).length <= payload.limit);
    assert.ok(Array.from(row.预警原因).length <= payload.limit);
    assert.ok(Array.from(row.本次处理结果).length <= payload.limit);
    assert.ok(Array.from(row.后续建议).length <= payload.limit);
  }
});

test('dev-check wrap-up copy validate mode fails fast on overlong fields', () => {
  const scriptPath = path.resolve('scripts/dev-check-wrapup-copy.mjs');
  const run = spawnSync(process.execPath, [scriptPath, '--validate'], {
    input: JSON.stringify({
      rows: [
        {
          影响对象: 'src/large.js',
          规模信号: '2507 行（> 1500 行/文件）',
          预警原因: '这条预警原因已经超过二十个字限制请继续缩短处理',
          本次处理结果: '这次先完成需求，暂不拆分',
          后续建议: '优先拆出独立职责',
        },
      ],
    }),
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /src\/large\.js/);
  assert.match(run.stderr, /预警原因/);
  assert.match(run.stderr, /超过 20 字上限/);
  assert.match(run.stderr, /请缩短后重试/);
});
test('dev-check auto-applies detected unknown code extensions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'component.astro'), [
    '---',
    'const title = "Hello";',
    '---',
    '<script>',
    'export const hydrate = true;',
    '</script>',
    '<h1>{title}</h1>',
    '',
  ].join('\n'));

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/component.astro'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.files[0].status, 'ok');
  assert.equal(result.files[0].fileKind, 'candidate-code');
  assert.equal(result.files[0].growthCandidate.id, 'code-extension-astro');
  assert.equal(result.files[0].growthObservation.autoApplied, true);
  assert.match(result.files[0].nextAction, /已自动补齐 \.astro/);

  const review = await reviewGrowthWorkspace(project);
  assert.equal(review.summary.pending, 0);
  assert.equal(review.summary.applied, 1);
  assert.equal(review.applied[0].id, 'code-extension-astro');
  assert.equal(review.applied[0].applyMode, 'auto');
  assert.equal(review.ledger.summary.autoApplied, 1);
  assert.equal(review.ledger.summary.current.applied, 1);

  const reviewLogs = [];
  const originalLog = console.log;
  console.log = (...args) => reviewLogs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review']), 0);
  } finally {
    console.log = originalLog;
  }
  const reviewText = reviewLogs.join('\n');
  assert.doesNotMatch(reviewText, /状态: 待确认/);
  assert.match(reviewText, /候选: 0 待确认，1 已应用，0 已拒绝。/);
  assert.match(reviewText, /账本: events 1，observe 1，pending 0，auto 1，manual 0，reconcile 0，checkpoint 0，reject 0，skip 0/);
  assert.match(reviewText, /下一步: 当前没有待确认增长候选。/);

  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.json', '.md', '.astro']);

  const recognized = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/component.astro'],
  });
  assert.equal(recognized.files[0].fileKind, 'code');
  assert.equal(recognized.files[0].growthCandidate, null);

  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review', '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.summary.applied, 1);
});

test('dev-check also auto-applies low-confidence unknown code extensions', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'maybe.tpl'), [
    'title;',
    '',
  ].join('\n'));

  const result = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/maybe.tpl'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.files[0].status, 'ok');
  assert.equal(result.files[0].fileKind, 'candidate-code');
  assert.equal(result.files[0].growthCandidate.id, 'code-extension-tpl');
  assert.equal(result.files[0].growthObservation.autoApplied, true);
  assert.match(result.files[0].nextAction, /已自动补齐 \.tpl/);

  const review = await reviewGrowthWorkspace(project);
  assert.equal(review.summary.pending, 0);
  assert.equal(review.summary.applied, 1);
  assert.equal(review.applied[0].id, 'code-extension-tpl');
  assert.equal(review.ledger.summary.autoApplied, 1);

  const reviewLogs = [];
  const originalLog = console.log;
  console.log = (...args) => reviewLogs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review']), 0);
  } finally {
    console.log = originalLog;
  }
  const reviewText = reviewLogs.join('\n');
  assert.doesNotMatch(reviewText, /状态: 待确认/);
  assert.match(reviewText, /候选: 0 待确认，1 已应用，0 已拒绝。/);
  assert.match(reviewText, /账本: events 1，observe 1，pending 0，auto 1，manual 0，reconcile 0，checkpoint 0，reject 0，skip 0/);

  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.json', '.md', '.tpl']);

  const recognized = await checkDevelopmentStandardsWorkspace(project, {
    files: ['src/maybe.tpl'],
  });
  assert.equal(recognized.files[0].fileKind, 'code');
  assert.equal(recognized.files[0].growthCandidate, null);

  const logs = [];
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['grow', project, '--review', '--json']), 0);
  } finally {
    console.log = originalLog;
  }
  const cliResult = JSON.parse(logs.join('\n'));
  assert.equal(cliResult.summary.pending, 0);
  assert.equal(cliResult.summary.applied, 1);
});

test('growth init reconciles older pending code-extension candidates into auto-applied state', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const candidate = buildCodeExtensionCandidate('README.md', {
    lineCount: 10,
    confidence: 0.55,
    reason: 'code-punctuation',
  });
  const observed = await observeGrowthWorkspace(project, candidate, {
    autoApply: { enabled: false, safeTypes: ['code-extension'] },
  });
  assert.equal(observed.autoApplied, false);

  const before = await reviewGrowthWorkspace(project);
  assert.equal(before.summary.pending, 1);
  assert.equal(before.pending[0].id, 'code-extension-md');

  const growth = await initGrowthWorkspace(project);
  assert.equal(growth.reconciledAutoApplied.length, 1);
  assert.equal(growth.reconciledAutoApplied[0].id, 'code-extension-md');
  assert.equal(growth.ledger.summary.reconciledAutoApplied, 1);
  assert.equal(growth.ledger.summary.autoApplied, 1);

  const after = await reviewGrowthWorkspace(project);
  assert.equal(after.summary.pending, 0);
  assert.equal(after.summary.applied, 1);
  assert.equal(after.applied[0].applyMode, 'auto');
  assert.equal(after.ledger.summary.reconciledAutoApplied, 1);

  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'standards', 'config.json'), 'utf8'));
  assert.deepEqual(standardsConfig.developmentStandards.codeFileLines.codeFileExtensions, ['.json', '.md']);
});
