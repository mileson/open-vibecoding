import test from 'node:test';

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
  applyGrowthCandidateWorkspace,
  applyOpenPrdChangeWorkspace,
  approveBenchmarkWorkspace,
  archiveOpenPrdChangeWorkspace,
  brainstormPresentationWorkspace,
  brainstormWorkspace,
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
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
  checkCodexCliHealth,
  ensureCodexCliReady,
  createRunWorkspace,
  OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER,
  OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER,
  TEST_OPEN_VIBECODING_HOME,
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
} from './helpers/open-vibecoding-test-helpers.js';
test('benchmark add/list/approve/verify and update generated benchmark guidance', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const initialBenchmarks = await listBenchmarkWorkspace(project);

  const addResult = await addBenchmarkWorkspace(project, {
    source: 'https://github.com/openprd-lab/cli-observability-patterns',
    notes: '参考 doctor、dry-run 和命令可发现性设计',
  });
  assert.equal(addResult.ok, true);
  assert.equal(addResult.source.status, 'candidate');
  assert.equal(addResult.source.sourceType, 'github');
  assert.ok(addResult.source.scenarios.includes('cli-tooling'));
  assert.ok(addResult.source.scenarios.includes('developer-experience'));
  assert.ok(addResult.source.triggerWhen.some((item) => item.includes('doctor')));

  const iconAddResult = await addBenchmarkWorkspace(project, {
    source: 'https://icon-benchmarks.example.invalid/phosphor-react-icons',
    notes: 'UI 图标站参考，Phosphor Icons / React Icons 风格',
  });
  assert.equal(iconAddResult.ok, true);
  assert.ok(iconAddResult.source.scenarios.includes('icon-resources'));
  assert.ok(iconAddResult.source.triggerWhen.some((item) => item.includes('图标')));

  const reviewLaneAdd = await addBenchmarkWorkspace(project, {
    source: 'https://review-benchmarks.example.invalid/ai-code-review-harness',
    notes: 'AI code review / PR review harness，独立审查、reviewer agreement、误报过滤、merge recommendation',
  });
  assert.equal(reviewLaneAdd.ok, true);
  assert.ok(reviewLaneAdd.source.scenarios.includes('pr-review-harness'));
  assert.ok(reviewLaneAdd.source.triggerWhen.some((item) => item.includes('merge 前高风险复核')));

  const listedAfterAdd = await listBenchmarkWorkspace(project);
  assert.equal(listedAfterAdd.counts.approved, initialBenchmarks.counts.approved);
  assert.equal(listedAfterAdd.counts.candidates, initialBenchmarks.counts.candidates + 3);
  assert.ok(listedAfterAdd.candidates.some((item) => item.id === addResult.source.id));
  assert.ok(listedAfterAdd.candidates.some((item) => item.id === iconAddResult.source.id));
  assert.ok(listedAfterAdd.candidates.some((item) => item.id === reviewLaneAdd.source.id));

  const approveResult = await approveBenchmarkWorkspace(project, { id: addResult.source.id });
  assert.equal(approveResult.ok, true);
  assert.equal(approveResult.source.status, 'approved');

  const sourcesYaml = await fs.readFile(path.join(project, '.open-vibecoding', 'benchmarks', 'sources.yaml'), 'utf8');
  assert.ok(sourcesYaml.includes(addResult.source.id));
  assert.ok(sourcesYaml.includes('approved'));

  const indexMd = await fs.readFile(path.join(project, '.open-vibecoding', 'benchmarks', 'index.md'), 'utf8');
  assert.ok(indexMd.includes('Approved Sources'));
  assert.ok(indexMd.includes(addResult.source.id));

  await updateAgentIntegrationWorkspace(project, { tools: 'codex' });
  const generatedBenchmarkSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-benchmark-router', 'SKILL.md'), 'utf8');
  assert.ok(generatedBenchmarkSkill.includes('## Project Benchmark Registry'));
  assert.ok(generatedBenchmarkSkill.includes(addResult.source.id));
  assert.ok(generatedBenchmarkSkill.includes(addResult.source.repo));
  assert.ok(generatedBenchmarkSkill.includes('AI code review / PR review harness'));
  assert.ok(generatedBenchmarkSkill.includes('merge recommendation'));
  assert.ok(generatedBenchmarkSkill.includes('change lifecycle'));
  assert.ok(generatedBenchmarkSkill.includes('mandatory skill routing'));
  assert.ok(generatedBenchmarkSkill.includes('Phosphor Icons'));
  assert.ok(generatedBenchmarkSkill.includes('React Icons'));
});

test('benchmark verify catches duplicates, unreachable sources and overbroad triggers', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const first = await addBenchmarkWorkspace(project, {
    source: 'https://github.com/Fission-AI/OpenSpec',
    notes: '参考 spec 生成与项目配置',
  });
  assert.equal(first.ok, true);

  const duplicateAdd = await addBenchmarkWorkspace(project, {
    source: 'Fission-AI/OpenSpec',
    notes: '重复来源',
  });
  assert.equal(duplicateAdd.ok, false);

  const badId = 'too-broad-source';
  await fs.writeFile(
    path.join(project, '.open-vibecoding', 'benchmarks', 'inbox', `${badId}.yaml`),
    [
      `id: ${badId}`,
      'title: Too Broad Source',
      'status: candidate',
      'sourceType: web',
      'url: http://127.0.0.1:9/missing',
      'researchMethod: official_page_first',
      'scenarios:',
      '  - agent-harness',
      'triggerWhen:',
      '  - 所有任务都可以参考',
      '',
    ].join('\n'),
    'utf8',
  );

  const verifyResult = await verifyBenchmarkWorkspace(project);
  assert.equal(verifyResult.ok, false);
  assert.ok(verifyResult.errors.some((item) => item.includes('Unreachable source')));
  assert.ok(verifyResult.warnings.some((item) => item.includes('too broad or missing')));
});

test('benchmark source observations accumulate adoption evidence and recommend approval', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const first = await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/agent-harness',
    notes: '用户采纳了 harness 复盘设计来源',
    task: 'benchmark-growth',
    threshold: 3,
  });
  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(first.source.status, 'candidate');
  assert.equal(first.source.sourceKey, 'example.com/docs');
  assert.equal(first.source.adoptedCount, 1);
  assert.equal(first.source.recentAdoptedCount, 1);
  assert.equal(first.source.promotion.windowDays, 7);
  assert.equal(first.recommended, false);

  await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/review-loop',
    notes: '同一 docs 来源再次被采纳',
    task: 'benchmark-growth',
    threshold: 3,
  });
  const third = await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/observe-source',
    notes: '第三次采纳，应该推荐 approve',
    task: 'benchmark-growth',
    threshold: 3,
  });
  assert.equal(third.created, false);
  assert.equal(third.source.id, first.source.id);
  assert.equal(third.source.adoptedCount, 3);
  assert.equal(third.source.recentAdoptedCount, 3);
  assert.equal(third.recommended, true);
  assert.equal(third.recommendation.approveCommand, `open-vibecoding benchmark approve ${first.source.id}`);

  const listed = await listBenchmarkWorkspace(project);
  assert.equal(listed.recommendations.length, 1);
  assert.equal(listed.recommendations[0].sourceKey, 'example.com/docs');
  assert.equal(listed.recommendations[0].adoptedCount, 3);
  assert.equal(listed.recommendations[0].windowDays, 7);
  assert.equal(listed.recommendations[0].totalAdoptedCount, 3);

  const growthReview = await reviewGrowthWorkspace(project);
  assert.equal(growthReview.benchmarkRecommendations.length, 1);
  assert.ok(growthReview.nextActions.some((item) => item.includes('example.com/docs')));

  const approveResult = await approveBenchmarkWorkspace(project, { id: first.source.id });
  assert.equal(approveResult.source.status, 'approved');
  assert.equal(approveResult.source.adoptedCount, 3);
});

test('benchmark recommendations use a rolling 7-day adoption window', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  const source = 'https://docs.example.com/docs/rolling-window';
  const now = Date.now();

  await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '八天前的一次采纳，不应计入最近 7 天',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now - (8 * 24 * 60 * 60 * 1000)).toISOString(),
  });
  await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '六天前的一次采纳，应计入最近 7 天',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now - (6 * 24 * 60 * 60 * 1000)).toISOString(),
  });
  const third = await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '今天的一次采纳，最近 7 天仍只有两次',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now).toISOString(),
  });

  assert.equal(third.source.adoptedCount, 3);
  assert.equal(third.source.recentAdoptedCount, 2);
  assert.equal(third.recommended, false);

  const fourth = await observeBenchmarkSourceWorkspace(project, {
    source,
    notes: '补足最近 7 天第三次采纳，才应该推荐 approve',
    task: 'benchmark-window',
    threshold: 3,
    observedAt: new Date(now - (1 * 24 * 60 * 60 * 1000)).toISOString(),
  });

  assert.equal(fourth.source.adoptedCount, 4);
  assert.equal(fourth.source.recentAdoptedCount, 3);
  assert.equal(fourth.recommended, true);

  const listed = await listBenchmarkWorkspace(project);
  assert.equal(listed.recommendations.length, 1);
  assert.equal(listed.recommendations[0].adoptedCount, 3);
  assert.equal(listed.recommendations[0].totalAdoptedCount, 4);
  assert.equal(listed.recommendations[0].windowDays, 7);
});

test('benchmark verify independently checks promotion control drift', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const observed = await observeBenchmarkSourceWorkspace(project, {
    source: 'https://docs.example.com/docs/control-drift',
    notes: '只采纳了一次，不该被推荐',
    task: 'benchmark-verify-control',
    threshold: 3,
  });

  const candidatePath = path.join(project, '.open-vibecoding', 'benchmarks', 'inbox', `${observed.source.id}.yaml`);
  const candidateText = await fs.readFile(candidatePath, 'utf8');
  await fs.writeFile(candidatePath, candidateText
    .replace('recommended: false', 'recommended: true')
    .replace('approveCommand: null', `approveCommand: open-vibecoding benchmark approve ${observed.source.id}`));

  const verifyResult = await verifyBenchmarkWorkspace(project);
  assert.equal(verifyResult.ok, false);
  const check = verifyResult.checks.find((item) => item.id === observed.source.id);
  assert.ok(check);
  assert.ok(check.issues.some((issue) => issue.code === 'promotion-control-drift'));
  assert.ok(check.issues.some((issue) => issue.code === 'stale-approve-command'));
  assert.ok(verifyResult.errors.some((item) => item.includes(observed.source.id)));
});

test('benchmark CLI commands add list approve verify', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.writeFile(
    path.join(project, '.open-vibecoding', 'benchmarks', 'sources.yaml'),
    [
      'version: 1',
      'schema: openprd.benchmarks.v1',
      'updatedAt: 2026-01-01 00:00:00',
      'sources: []',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(path.join(project, 'benchmark-cli-reference.md'), '# CLI Benchmark\n\n- doctor\n', 'utf8');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['benchmark', 'add', 'benchmark-cli-reference.md', '--path', project, '--notes', '参考 CLI doctor 触发', '--json']), 0);
    const addPayload = JSON.parse(logs.pop());
    assert.equal(addPayload.ok, true);
    assert.equal(addPayload.source.status, 'candidate');

    assert.equal(await main(['benchmark', 'list', project, '--json']), 0);
    const listPayload = JSON.parse(logs.pop());
    assert.equal(listPayload.counts.candidates, 1);

    assert.equal(await main(['benchmark', 'approve', addPayload.source.id, '--path', project, '--json']), 0);
    const approvePayload = JSON.parse(logs.pop());
    assert.equal(approvePayload.source.status, 'approved');

    assert.equal(await main(['benchmark', 'verify', project, '--json']), 0);
    const verifyPayload = JSON.parse(logs.pop());
    assert.equal(verifyPayload.ok, true);
    assert.ok(Array.isArray(verifyPayload.checks));

    assert.equal(await main(['benchmark', 'observe', 'https://docs.example.com/docs/cli-review', '--path', project, '--notes', '用户采纳', '--threshold', '1', '--json']), 0);
    const observePayload = JSON.parse(logs.pop());
    assert.equal(observePayload.ok, true);
    assert.equal(observePayload.recommended, true);
    assert.equal(observePayload.source.adoptedCount, 1);
    assert.equal(observePayload.source.recentAdoptedCount, 1);
    assert.equal(observePayload.source.promotion.windowDays, 7);
  } finally {
    console.log = originalLog;
  }
});

test('knowledge candidate lifecycle list reject archive restore and quality counts pending only', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      test: 'node --test',
      'test:smoke': 'node --test smoke.test.js',
      'perf:k6': 'k6 run perf.js',
    },
    dependencies: {
      pino: '^9.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export function app(req) { console.log({ trace_id: req.trace_id, request_id: req.request_id, task_id: req.task_id, user_session_id: req.user_session_id, error_id: req.error_id }); }\n');
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.open-vibecoding', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.open-vibecoding', 'harness', 'test-reports', 'knowledge-smoke.md'), [
    '# Knowledge lifecycle smoke',
    '',
    '- smoke: passed candidate review flow',
    '- feature coverage: no active change',
    '',
  ].join('\n'));

  async function writeCandidate(id, status, title) {
    const dir = path.join(project, '.open-vibecoding', 'knowledge', 'candidates', id);
    const draft = path.join(project, '.open-vibecoding', 'knowledge', 'drafts', `draft-${id}`, 'SKILL.md');
    await fs.mkdir(dir, { recursive: true });
    await fs.mkdir(path.dirname(draft), { recursive: true });
    await fs.writeFile(draft, `---\nname: draft-${id}\ndescription: draft\n---\n\n# ${title}\n`);
    const candidatePath = path.join(dir, 'candidate.json');
    await fs.writeFile(candidatePath, `${JSON.stringify({
      version: 1,
      candidateId: id,
      status,
      createdAt: '2026-05-30 10:00:00',
      updatedAt: '2026-05-30 10:00:00',
      sourceKind: 'diagnostic-report',
      sourceRef: id,
      title,
      files: {
        candidate: candidatePath,
        candidateDir: dir,
        draftSkill: draft,
      },
    }, null, 2)}\n`);
    return { candidatePath, draft };
  }

  const pending = await writeCandidate('candidate-pending', 'pending-review', 'Pending candidate');
  await writeCandidate('candidate-noise', 'pending-review', 'Noise candidate');
  await writeCandidate('candidate-merged', 'pending-review', 'Merged candidate');
  await fs.mkdir(path.join(project, '.open-vibecoding', 'knowledge', 'skills', 'existing-skill'), { recursive: true });
  await fs.writeFile(path.join(project, '.open-vibecoding', 'knowledge', 'skills', 'existing-skill', 'SKILL.md'), '---\nname: existing-skill\ndescription: existing\n---\n\n# Existing\n');
  await fs.writeFile(path.join(project, '.open-vibecoding', 'knowledge', 'index.json'), `${JSON.stringify({
    version: 1,
    updatedAt: '2026-05-30 10:00:00',
    incidents: [],
    patterns: [],
    skills: [
      {
        skillName: 'existing-skill',
        path: path.join(project, '.open-vibecoding', 'knowledge', 'skills', 'existing-skill', 'SKILL.md'),
        sourceKind: 'manual',
        sourceRef: 'existing',
      },
    ],
    candidates: [
      { candidateId: 'candidate-pending', status: 'pending-review', path: pending.candidatePath, title: 'Pending candidate', draftSkillPath: pending.draft },
      { candidateId: 'candidate-noise', status: 'reviewed-noise', title: 'Noise candidate' },
      { candidateId: 'candidate-merged', status: 'merged', title: 'Merged candidate' },
    ],
    drafts: [],
  }, null, 2)}\n`);

  const listed = await listKnowledgeCandidates(project);
  assert.equal(listed.counts.total, 3);
  assert.equal(listed.counts.pending, 1);
  assert.equal(listed.candidates.length, 1);
  assert.equal(listed.candidates[0].candidateId, 'candidate-pending');

  const rejected = await rejectKnowledgeCandidate(project, { id: 'candidate-pending', reason: 'UI iteration noise' });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.candidate.status, 'rejected');
  const rejectedFile = JSON.parse(await fs.readFile(pending.candidatePath, 'utf8'));
  assert.equal(rejectedFile.status, 'rejected');
  assert.equal(rejectedFile.reviewReason, 'UI iteration noise');

  const afterReject = await listKnowledgeCandidates(project);
  assert.equal(afterReject.counts.pending, 0);
  assert.equal(afterReject.counts.rejected, 1);

  const archived = await archiveKnowledgeCandidate(project, { id: 'candidate-pending', reason: 'Superseded by merged skill' });
  assert.equal(archived.candidate.status, 'archived');
  const afterArchiveAll = await listKnowledgeCandidates(project, { status: 'all' });
  assert.equal(afterArchiveAll.counts.archived, 1);

  const restored = await restoreKnowledgeCandidate(project, { id: 'candidate-pending' });
  assert.equal(restored.candidate.status, 'pending-review');
  const afterRestore = await listKnowledgeCandidates(project);
  assert.equal(afterRestore.counts.pending, 1);

  await rejectKnowledgeCandidate(project, { id: 'candidate-pending', reason: 'Not reusable' });
  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.report.knowledge.candidateCounts.total, 3);
  assert.equal(quality.report.knowledge.candidateCounts.pending, 0);
  assert.deepEqual(quality.report.knowledge.candidates, []);
  assert.equal(quality.report.knowledge.warnings.some((warning) => warning.includes('待确认 knowledge candidate')), false);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['knowledge', 'candidates', project, '--status', 'all', '--json']), 0);
    const listPayload = JSON.parse(logs.pop());
    assert.equal(listPayload.counts.total, 3);

    assert.equal(await main(['knowledge', 'restore', '--path', project, '--id', 'candidate-pending', '--json']), 0);
    const restorePayload = JSON.parse(logs.pop());
    assert.equal(restorePayload.candidate.status, 'pending-review');

    assert.equal(await main(['knowledge', 'archive', '--path', project, '--id', 'candidate-pending', '--reason', 'Handled elsewhere', '--json']), 0);
    const archivePayload = JSON.parse(logs.pop());
    assert.equal(archivePayload.candidate.status, 'archived');
    assert.equal(archivePayload.candidate.reviewReason, 'Handled elsewhere');
  } finally {
    console.log = originalLog;
  }
});

test('learning review toggles mode and generates archived reader package', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const disabled = await setLearningReviewModeWorkspace(project, false);
  assert.equal(disabled.ok, true);
  assert.equal(disabled.enabled, false);

  const skipped = await generateLearningReviewWorkspace(project, {
    topic: 'Open VibeCoding learning smoke',
    open: false,
    respectConfig: true,
  });
  assert.equal(skipped.ok, true);
  assert.equal(skipped.skipped, true);

  const enabled = await setLearningReviewModeWorkspace(project, true);
  assert.equal(enabled.ok, true);
  assert.equal(enabled.enabled, true);

  const generated = await generateLearningReviewWorkspace(project, {
    topic: 'Open VibeCoding learning smoke',
    genre: 'xianxia',
    sourceScope: 'all',
    open: true,
    respectConfig: true,
  });
  assert.equal(generated.ok, true);
  assert.equal(generated.skipped, false);
  assert.equal(generated.genre.id, 'xianxia');
  assert.equal(generated.packageMeta.styleId, 'cultivation');
  assert.equal(generated.opened, false);
  assert.equal(generated.packageMeta.autoOpen, false);
  assert.equal(generated.packageMeta.paths.readerHtml, generated.packagePaths.readerHtml);

  for (const filePath of [
    generated.packagePaths.readerHtml,
    generated.packagePaths.assetsDir,
    generated.packagePaths.packageJson,
    generated.packagePaths.contentJson,
    generated.packagePaths.contentMarkdown,
    generated.packagePaths.evidenceManifest,
    generated.packagePaths.agentContext,
    generated.packagePaths.agentPrompt,
  ]) {
    assert.ok(await fs.stat(filePath).then(() => true));
  }

  const html = await fs.readFile(generated.packagePaths.readerHtml, 'utf8');
  assert.ok(html.includes('Open VibeCoding 复盘学习阅读器'));
  assert.ok(html.includes('书籍大纲'));
  assert.ok(html.includes('还没有生成可阅读正文'));
  assert.ok(html.includes('重渲染命令'));
  assert.equal(html.includes('Evidence Manifest</p>'), false);
  const content = JSON.parse(await fs.readFile(generated.packagePaths.contentJson, 'utf8'));
  assert.equal(content.schema, 'openprd.learning-content.v1');
  assert.equal(content.authoringStatus, 'awaiting-agent-content');
  assert.equal(content.title, '');
  assert.equal(content.genre.id, 'xianxia');
  assert.equal(content.stylePromptPack.id, 'xianxia.cultivation');
  assert.equal(content.stylePromptEngineering.prompts.proseRewrite.includes('立基/观脉/破境/传功/归元'), true);
  assert.equal(content.styleTransfer.agentLoopRequired, true);
  assert.equal(Array.isArray(content.outline), true);
  assert.equal(content.outline.length, 0);
  assert.equal(content.chapters.length, 0);
  assert.equal(generated.packageMeta.genreId, 'xianxia');
  assert.equal(generated.packageMeta.needsAgentDraft, true);
  const agentContext = JSON.parse(await fs.readFile(generated.packagePaths.agentContext, 'utf8'));
  assert.equal(agentContext.schema, 'openprd.learning-agent-context.v1');
  assert.equal(agentContext.outputContract.agentOwnedFields.includes('title'), true);
  assert.equal(agentContext.paths.assetsDir.endsWith('/assets'), true);
  const agentPrompt = await fs.readFile(generated.packagePaths.agentPrompt, 'utf8');
  assert.ok(agentPrompt.includes('请你亲自完成复盘学习正文'));
  assert.ok(agentPrompt.includes('visualExplainer'));
  assert.ok(agentPrompt.includes('图片素材目录'));

  const authoredPath = path.join(project, 'authored-learning-content.json');
  const visualAssetPath = path.join(project, 'visual-explainer.svg');
  await fs.writeFile(visualAssetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#e5f1ee"/><text x="24" y="104" font-size="22" fill="#13736b">visual explainer</text></svg>\n');
  await fs.writeFile(authoredPath, `${JSON.stringify({
    schema: 'openprd.learning-content.v1',
    title: 'Agent 写出的任务复盘',
    subtitle: '围绕真实证据生成',
    learningGoals: ['看懂这次任务为什么完成。'],
    overviewParagraphs: ['这段由 Agent 根据证据写入。'],
    outline: [
      {
        id: 'chapter-1',
        depth: 1,
        title: '第 1 章 · 任务证据',
        subtitle: '从 current-state 开始',
        children: [],
      },
    ],
    chapters: [
      {
        id: 'chapter-1',
        label: '任务证据',
        semanticTitle: '从状态文件确认完成',
        summary: '复盘先回到可验证状态。',
        visualExplainer: {
          title: '像开店前先做联合质检',
          analogy: '不是马上开门营业，而是先让不同角色各自找问题。',
          scene: '产品先看用户旅程，工程再看实现风险，最后负责人再决定要不要上线。',
          whyItMatters: '读者可以先理解决策顺序，再回到具体证据。',
          takeaways: ['先独立看', '后统一判', '再决定上不上'],
          image: {
            path: visualAssetPath,
            alt: '联合质检的学习包示意图',
            caption: '图片只用于帮助理解，不替代证据。',
          },
        },
        paragraphs: ['Agent 先读取 current-state，再把任务结论写成可回溯的正文。'],
        retrievalBlocks: [
          {
            prompt: '这次复盘第一条证据是什么？',
            hint: '看 evidenceIds。',
            answer: 'current-state。',
          },
        ],
        workedExamples: [
          {
            title: '用证据写正文',
            scenario: 'Agent 需要写出任务相关内容。',
            steps: ['读取 evidence-manifest。', '引用 source id。'],
            principle: '正文跟着证据走。',
          },
        ],
        evidenceIds: ['current-state'],
      },
    ],
    nextActions: ['打开 reader.html 检查正文。'],
  }, null, 2)}\n`);
  const authored = await generateLearningReviewWorkspace(project, {
    topic: 'Open VibeCoding learning smoke',
    genre: 'xianxia',
    sourceScope: 'all',
    contentJson: authoredPath,
    open: false,
    respectConfig: true,
  });
  assert.equal(authored.ok, true);
  assert.equal(authored.content.authoringStatus, 'agent-authored');
  assert.equal(authored.content.title, 'Agent 写出的任务复盘');
  assert.equal(authored.packageMeta.needsAgentDraft, false);
  const authoredHtml = await fs.readFile(authored.packagePaths.readerHtml, 'utf8');
  assert.ok(authoredHtml.includes('Agent 写出的任务复盘'));
  assert.ok(authoredHtml.includes('一眼看懂'));
  assert.ok(authoredHtml.includes('像开店前先做联合质检'));
  assert.ok(authoredHtml.includes('图片只用于帮助理解，不替代证据。'));
  assert.ok(authoredHtml.includes('联合质检的学习包示意图'));
  assert.ok(authoredHtml.includes('Agent 先读取 current-state'));
  assert.ok(authoredHtml.includes('content: "▸"'));
  assert.ok(authoredHtml.includes('evidence-summary-title'));
  assert.ok(authoredHtml.includes('1 个来源'));
  assert.equal(authoredHtml.includes('张图卡'), false);

  const current = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'state', 'current.json'), 'utf8'));
  assert.equal(current.learningReview.lastPackageId, authored.packageId);
  assert.equal(current.learningReview.lastAuthoringStatus, 'agent-authored');
  const learningIndex = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'learning', 'index.json'), 'utf8'));
  assert.equal(learningIndex.currentPackageId, authored.packageId);
});

test('internet-product learning review steers Agent toward design principles instead of technical inventory', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const generated = await generateLearningReviewWorkspace(project, {
    topic: 'Harbor & Leaf build review',
    sourceScope: 'workspace',
    open: false,
    respectConfig: true,
  });

  assert.equal(generated.ok, true);
  assert.equal(generated.genre.id, 'internet-product');

  const content = JSON.parse(await fs.readFile(generated.packagePaths.contentJson, 'utf8'));
  assert.equal(content.genre.chapterLabels[0], '问题与价值');
  assert.equal(content.genre.chapterLabels[2], '取舍与原理');
  assert.equal(content.stylePromptPack.id, 'internet-product.teaching-brief');
  assert.equal(content.stylePromptEngineering.prompts.system.includes('产品设计思路'), true);
  assert.equal(content.stylePromptEngineering.prompts.proseRewrite.includes('不要按文件名、模块名、技术名词逐项介绍'), true);
  assert.equal(content.stylePromptEngineering.prompts.chapter.includes('visualExplainer'), true);

  const agentContext = JSON.parse(await fs.readFile(generated.packagePaths.agentContext, 'utf8'));
  assert.equal(agentContext.outputContract.rules.some((rule) => rule.includes('技术说明书')), true);
  assert.equal(agentContext.outputContract.chapterShape.optional.includes('visualExplainer'), true);

  const agentPrompt = await fs.readFile(generated.packagePaths.agentPrompt, 'utf8');
  assert.equal(agentPrompt.includes('不要把正文写成技术说明书'), true);
  assert.equal(agentPrompt.includes('为什么这样设计'), true);
  assert.equal(agentPrompt.includes('比喻卡'), true);
});

test('internet-product authored learning content rejects technical-manual narration', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const authoredPath = path.join(project, 'manualish-learning-content.json');
  await fs.writeFile(authoredPath, `${JSON.stringify({
    schema: 'openprd.learning-content.v1',
    title: 'Open VibeCoding 建站复核说明',
    subtitle: '按文件和命令逐项整理',
    learningGoals: ['看完文件路径后继续操作。'],
    overviewParagraphs: ['先看 docs/basic/file-structure.md，再看 .open-vibecoding/state/current.json，最后看 reader.html 与 script.js。'],
    outline: [
      {
        id: 'chapter-1',
        depth: 1,
        title: '第 1 章 · 文件清单',
        subtitle: '按目录顺序阅读',
        children: [],
      },
    ],
    chapters: [
      {
        id: 'chapter-1',
        label: '文件清单',
        semanticTitle: '按模块和命令顺序介绍',
        summary: '先列路径，再列脚本和命令。',
        paragraphs: [
          'docs/basic/prd.md、docs/basic/tech-stack.md、.open-vibecoding/state/current.json、reader.html、script.js 和 package.json 都要逐个介绍。',
          '最后再补 open-vibecoding learn . --content-json 与 open-vibecoding run . --verify 这些命令的执行顺序。',
        ],
        evidenceIds: ['current-state', 'docs-basic-file-structure'],
      },
    ],
    nextActions: ['继续检查 docs/basic/app-flow.md。'],
  }, null, 2)}\n`);

  await assert.rejects(
    () => generateLearningReviewWorkspace(project, {
      topic: 'Open VibeCoding manual smell',
      sourceScope: 'workspace',
      contentJson: authoredPath,
      open: false,
      respectConfig: true,
    }),
    /internet-product 复盘必须|技术说明书/
  );
});
