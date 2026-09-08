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

test('quality verify returns explicit diagnostics without writing eval artifacts or automatic candidates', async () => {
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
      '@opentelemetry/api': '^1.0.0',
      pino: '^9.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'src', 'api'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'api', 'handler.js'), 'export function handler(req) { console.log({ trace_id: req.trace_id, span_id: req.span_id, request_id: req.request_id, task_id: req.task_id, user_session_id: req.user_session_id, error_id: req.error_id }); }\n');
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'evo-smoke.md'), [
    '# EVO smoke report',
    '',
    '- smoke: passed main flow',
    '- feature coverage: no active change',
    '',
  ].join('\n'));

  const initQuality = await initQualityWorkspace(project);
  assert.equal(initQuality.ok, true);
  assert.equal(initQuality.changed, 'unchanged');
  const reportsBefore = await fs.readdir(path.join(project, '.openprd', 'quality', 'reports')).catch(() => []);
  const candidatesBefore = await fs.readdir(path.join(project, '.openprd', 'knowledge', 'candidates')).catch(() => []);

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.ok, true);
  assert.deepEqual(quality.effectiveEnforcement, {
    mode: 'advisory',
    source: '.openprd/quality/config.json',
    configuredMode: 'advisory',
    scope: 'workspace-claim',
    purpose: 'overall-readiness-claim',
  });
  assert.equal(quality.report.readiness.scope, 'workspace-claim');
  assert.equal(quality.reportPath, null);
  assert.equal(quality.htmlPath, null);
  assert.equal(quality.indexPath, null);
  assert.equal(quality.artifactGeneration.enabled, false);
  assert.equal(quality.report.observability.centralizedTools.includes('@opentelemetry/'), true);
  assert.equal(quality.report.gates.some((gate) => gate.id === 'business-guardrails' && gate.status === 'pass'), true);
  assert.equal(quality.report.evalHarness.smoke.present, true);
  assert.equal(quality.report.evalHarness.performance.present, true);
  assert.equal(quality.report.evalHarness.extremeData.present, true);
  assert.deepEqual(quality.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage']);
  assert.equal(quality.report.readiness.productionReady, true);
  assert.equal(quality.knowledgeReview, null);
  assert.equal(quality.growthCheckpoint, null);
  const evalArtifacts = await fs.readdir(path.join(project, '.openprd', 'quality', 'reports')).catch(() => []);
  assert.deepEqual(evalArtifacts, reportsBefore);
  const candidates = await fs.readdir(path.join(project, '.openprd', 'knowledge', 'candidates')).catch(() => []);
  assert.deepEqual(candidates, candidatesBefore);
});

test('knowledge review reuses the same candidate id within one turn instead of promoting a later weaker doc-only candidate', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.mkdir(path.join(project, 'docs', 'basic'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'main.js'), 'export const main = true;\n');
  await fs.writeFile(path.join(project, 'docs', 'basic', 'learning.md'), '# learning\n');

  const turnStatePath = path.join(project, '.openprd', 'harness', 'turn-state.json');
  await fs.writeFile(turnStatePath, `${JSON.stringify({
    version: 1,
    id: 'turn-knowledge-reuse',
    prompt: '继续把这轮实现收口，并整理成后续可复用经验。',
    touchedFiles: ['src/main.js'],
    reviewSignals: [
      {
        id: 'run-verify-pass',
        kind: 'run-verify',
        ok: true,
        productionReady: true,
        summary: 'current task is ready for reuse',
        touchedFiles: ['src/main.js'],
      },
    ],
  }, null, 2)}\n`);

  const firstReview = await reviewKnowledgeWorkspace(project, {
    from: '.openprd/harness/turn-state.json',
    touchedFiles: ['src/main.js'],
    signal: {
      id: 'run-verify-pass',
      kind: 'run-verify',
      ok: true,
      productionReady: true,
      summary: 'current task is ready for reuse',
      touchedFiles: ['src/main.js'],
    },
  });
  assert.equal(firstReview.ok, true);
  assert.equal(firstReview.skipped, false);

  await fs.writeFile(turnStatePath, `${JSON.stringify({
    version: 1,
    id: 'turn-knowledge-reuse',
    knowledgeCandidateId: firstReview.candidateId,
    prompt: '继续把这轮实现收口，并整理成后续可复用经验。',
    touchedFiles: ['docs/basic/learning.md'],
    reviewSignals: [
      {
        id: 'run-verify-pass-docs',
        kind: 'run-verify',
        ok: true,
        productionReady: true,
        summary: 'docs follow-up is also ready',
        touchedFiles: ['docs/basic/learning.md'],
      },
    ],
  }, null, 2)}\n`);

  const secondReview = await reviewKnowledgeWorkspace(project, {
    from: '.openprd/harness/turn-state.json',
    touchedFiles: ['docs/basic/learning.md'],
    signal: {
      id: 'run-verify-pass-docs',
      kind: 'run-verify',
      ok: true,
      productionReady: true,
      summary: 'docs follow-up is also ready',
      touchedFiles: ['docs/basic/learning.md'],
    },
  });
  assert.equal(secondReview.ok, true);
  assert.equal(secondReview.skipped, false);
  assert.equal(secondReview.candidateId, firstReview.candidateId);
  assert.doesNotMatch(secondReview.skillName, /learning/);
});

test('quality learn can digest diagnostic bundles and observability recognizes diagnostic surfaces', async () => {
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
  await fs.mkdir(path.join(project, 'src', 'runtime'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'runtime', 'diagnostics.js'), [
    'export function appendRuntimeEvent(event) {',
    '  return {',
    '    event: event.event,',
    '    trace_id: event.trace_id,',
    '    span_id: event.span_id,',
    '    request_id: event.request_id,',
    '    task_id: event.task_id,',
    '    user_session_id: event.user_session_id,',
    '    error_id: event.error_id,',
    '  };',
    '}',
    '',
    'export function exportDiagnostics(snapshot) {',
    '  return {',
    '    runtimeEvents: snapshot.runtimeEvents,',
    '    timeline: snapshot.timeline,',
    '    rootCauseCandidates: snapshot.rootCauseCandidates,',
    '    diagnosticReport: snapshot.diagnosticReport,',
    '  };',
    '}',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'bundle-smoke.md'), [
    '# Bundle smoke report',
    '',
    '- smoke: passed channel delivery flow',
    '- feature coverage: no active change',
    '',
  ].join('\n'));

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.ok, true);
  assert.equal(quality.report.observability.status, 'pass');
  assert.ok(quality.report.observability.diagnosticSurfaces.includes('runtime-events'));
  assert.ok(quality.report.observability.diagnosticSurfaces.includes('diagnostic-report'));

  const diagnosticsDir = path.join(project, 'diagnostics', 'incident-channel-delivery');
  await fs.mkdir(path.join(diagnosticsDir, 'runtime-events'), { recursive: true });
  await fs.mkdir(path.join(diagnosticsDir, 'timeline'), { recursive: true });
  await fs.writeFile(path.join(diagnosticsDir, 'diagnostic-report.json'), `${JSON.stringify({
    schema: 'project.diagnostic-report.v1',
    title: 'Channel delivery failed after login reuse',
    status: 'needs-attention',
    summary: {
      headline: 'delivery flow stalled after session reuse',
      status: 'needs-attention',
    },
    problem: 'Message delivery stops after the channel session expires.',
    rootCauseCandidates: [
      {
        title: 'Channel session expired',
        evidence: ['runtime-events captured channel.auth.expired before delivery retry'],
        nextSteps: ['refresh the channel session', 'retry the delivery path'],
      },
    ],
  }, null, 2)}\n`);
  await fs.writeFile(path.join(diagnosticsDir, 'root-cause-candidates.json'), `${JSON.stringify([
    {
      title: 'Channel session expired',
      category: 'auth',
      evidence: ['timeline shows auth expired before channel.delivery.failed'],
      nextSteps: ['refresh the channel session', 'verify retry logs stay correlated'],
    },
  ], null, 2)}\n`);
  await fs.writeFile(path.join(diagnosticsDir, 'runtime-events', 'events.jsonl'), [
    JSON.stringify({
      event: 'channel.delivery.start',
      trace_id: 'trace-1',
      span_id: 'span-1',
      request_id: 'req-1',
      task_id: 'task-1',
      user_session_id: 'user-1',
      error_id: 'err-1',
    }),
    JSON.stringify({
      event: 'channel.auth.expired',
      trace_id: 'trace-1',
      span_id: 'span-2',
      request_id: 'req-1',
      task_id: 'task-1',
      user_session_id: 'user-1',
      error_id: 'err-1',
    }),
    JSON.stringify({
      event: 'channel.delivery.failed',
      trace_id: 'trace-1',
      span_id: 'span-3',
      request_id: 'req-1',
      task_id: 'task-1',
      user_session_id: 'user-1',
      error_id: 'err-1',
    }),
  ].join('\n') + '\n');
  await fs.writeFile(path.join(diagnosticsDir, 'timeline', 'timeline.json'), `${JSON.stringify([
    { event: 'channel.delivery.start', ts: '2026-05-24T10:00:00.000Z' },
    { event: 'channel.auth.expired', ts: '2026-05-24T10:00:01.000Z' },
    { event: 'channel.delivery.failed', ts: '2026-05-24T10:00:02.000Z' },
  ], null, 2)}\n`);

  const learned = await learnQualityWorkspace(project, { from: diagnosticsDir });
  assert.equal(learned.ok, true);
  assert.equal(learned.sourceKind, 'diagnostic-bundle');

  const incident = JSON.parse(await fs.readFile(learned.files.incident, 'utf8'));
  assert.equal(incident.sourceKind, 'diagnostic-bundle');
  assert.ok(incident.correlationFields.includes('trace_id'));
  assert.ok(incident.correlationFields.includes('request_id'));
  assert.deepEqual(incident.missingCorrelationFields, []);
  assert.ok(incident.eventNames.includes('channel.delivery.failed'));
  assert.ok(incident.rootCauseCandidates.some((item) => item.title === 'Channel session expired'));

  const pattern = JSON.parse(await fs.readFile(learned.files.pattern, 'utf8'));
  assert.ok(pattern.preferredEvidenceOrder.includes('runtime-events'));
  assert.ok(pattern.rootCauseLabels.includes('Channel session expired'));

  const skill = await fs.readFile(learned.files.skill, 'utf8');
  assert.ok(skill.includes('## 关联字段'));
  assert.ok(skill.includes('runtime-events'));
  assert.ok(skill.includes('channel.delivery.failed'));

  const index = JSON.parse(await fs.readFile(path.join(project, '.openprd', 'knowledge', 'index.json'), 'utf8'));
  assert.equal(index.skills[0].sourceKind, 'diagnostic-bundle');
});

test('quality ignores generated tmp and build trees when sampling traceability sources', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: null,
    changes: {},
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
    activeChange: null,
    taskSharding: {
      maxItemsPerFile: 25,
      handoffRequired: true,
      firstFile: 'tasks.md',
      nextFilePattern: 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: 'T###.##',
      required: ['done', 'verify'],
      optional: ['deps', 'type'],
      dependencyOrder: 'dependencies must appear before dependents',
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
      'perf:k6': 'k6 run perf.js',
    },
    dependencies: {
      '@opentelemetry/api': '^1.0.0',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, 'docs', 'basic'), { recursive: true });
  await fs.writeFile(path.join(project, 'docs', 'basic', 'backend-structure.md'), [
    '# Backend structure',
    '',
    '- observability correlation fields: trace_id, span_id, request_id, task_id, user_session_id, error_id.',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, 'test', 'fixtures'), { recursive: true });
  await fs.writeFile(path.join(project, 'test', 'fixtures', 'extreme.json'), '{"items":[1,2,3]}\n');
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke: passed main flow.',
    '- feature coverage: no active change.',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, '.tmp', 'generated'), { recursive: true });
  for (let index = 0; index < 650; index += 1) {
    await fs.writeFile(
      path.join(project, '.tmp', 'generated', `sample-${String(index).padStart(4, '0')}.md`),
      `# generated ${index}\n\nplaceholder artifact\n`,
    );
  }

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.ok, true);
  assert.equal(quality.report.observability.status, 'pass');
  assert.deepEqual(quality.report.observability.missingCorrelation, []);
  assert.equal(quality.report.readiness.productionReady, true);
});

test('explicit quality diagnostics can flag smoke evidence without affecting run verify', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: null,
    changes: {},
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
    activeChange: null,
    taskSharding: {
      maxItemsPerFile: 25,
      handoffRequired: true,
      firstFile: 'tasks.md',
      nextFilePattern: 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: 'T###.##',
      required: ['done', 'verify'],
      optional: ['deps', 'type'],
      dependencyOrder: 'dependencies must appear before dependents',
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);

  const reportsBefore = await fs.readdir(path.join(project, '.openprd', 'quality', 'reports')).catch(() => []);
  const quality = await verifyQualityWorkspace(project);
  const smokeGate = quality.report.gates.find((gate) => gate.id === 'smoke');
  assert.equal(quality.ok, true);
  assert.equal(quality.effectiveEnforcement.mode, 'advisory');
  assert.equal(quality.report.readiness.productionReady, false);
  assert.equal(smokeGate.required, true);
  assert.equal(smokeGate.status, 'needs-evidence');

  const verified = await runWorkspace(project, { verify: true });
  const qualityCheck = verified.checks.find((check) => check.name === 'quality');
  assert.equal(verified.ok, true);
  assert.equal(verified.readiness.taskReady, true);
  assert.equal(verified.readiness.workspaceReady, true);
  assert.equal(qualityCheck, undefined);
  assert.equal(verified.errors.length, 0);
  assert.deepEqual(verified.warnings, []);
  const reportsAfter = await fs.readdir(path.join(project, '.openprd', 'quality', 'reports')).catch(() => []);
  assert.deepEqual(reportsAfter, reportsBefore);
});

test('run verify validates task structure without re-evaluating the quality feature-coverage ledger', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'quality', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'quality', 'evidence', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke: passed main flow.',
    '',
  ].join('\n'));
  await writeMinimalChange(project, 'ledger-gap', {
    title: 'Ledger Gap',
    requirementTitle: 'Ledger gap follow-up',
    taskTitle: 'Close the remaining feature coverage ledger',
  });
  await fs.writeFile(path.join(project, '.openprd', 'changes', 'ledger-gap', 'tasks.md'), [
    '# Tasks',
    '',
    '- [x] T001.01 Ship the current endpoint',
    '  - type: implementation',
    '  - done: endpoint is implemented and locally verified',
    '  - verify: pnpm test:smoke',
    '- [ ] T001.02 Record the remaining coverage evidence',
    '  - type: governance',
    '  - done: feature coverage evidence is recorded for the remaining task',
    '  - verify: openprd tasks . --change ledger-gap --advance --verify --item T001.02',
    '- [ ] T001.03 Capture the dependent follow-up note',
    '  - type: governance',
    '  - deps: T001.02',
    '  - done: dependent follow-up note is recorded after the remaining evidence is captured',
    '  - verify: openprd tasks . --change ledger-gap --advance --verify --item T001.03',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'changes', 'ledger-gap', 'specs', 'ledger-gap', 'spec.md'), [
    '## ADDED Requirements',
    '',
    '### Requirement: Ledger gap follow-up',
    'The remaining feature coverage evidence must be recorded before workspace-wide readiness is claimed.',
    '',
    '#### Scenario: Coverage ledger remains pending',
    '- **WHEN** implementation is complete but one task ledger entry is still pending',
    '- **THEN** run verify reports task readiness separately from workspace attention',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: 'ledger-gap',
    changes: {
      'ledger-gap': { id: 'ledger-gap', status: 'active' },
    },
  }, null, 2)}\n`);

  const quality = await verifyQualityWorkspace(project);
  const featureCoverageGate = quality.report.gates.find((gate) => gate.id === 'feature-coverage');
  const strategyTask = quality.report.evalHarness.testStrategy.tasks.find((task) => task.id === 'T001.01');
  assert.equal(quality.report.readiness.productionReady, false);
  assert.deepEqual(quality.report.readiness.attentionGates, ['feature-coverage']);
  assert.equal(quality.report.evalHarness.featureCoverage.activeTasks.pending, 2);
  assert.equal(quality.report.evalHarness.featureCoverage.activeTasks.blocked, 1);
  assert.equal(strategyTask?.done, true);
  assert.ok(featureCoverageGate?.warnings?.[0].includes('不等于当前实现失败'));
  assert.equal(quality.ok, true);
  assert.deepEqual(quality.errors, []);
  assert.equal(quality.effectiveEnforcement.mode, 'advisory');

  const verified = await runWorkspace(project, { verify: true });
  const qualityCheck = verified.checks.find((check) => check.name === 'quality');
  assert.equal(verified.ok, true);
  assert.equal(verified.readiness.taskReady, true);
  assert.equal(verified.readiness.workspaceReady, true);
  assert.equal(qualityCheck, undefined);
  assert.equal(verified.workspaceAttention, null);
  assert.deepEqual(verified.warnings, []);
});

test('quality excludes historical active changes from current feature coverage', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'historical-ledger', {
    title: 'Historical ledger',
    requirementTitle: 'Historical task remains context only',
    taskTitle: 'Do not reopen this historical task',
  });
  await fs.writeFile(path.join(project, '.openprd', 'changes', 'historical-ledger', 'tasks.md'), [
    '# Tasks',
    '',
    '- [ ] T001.01 Historical unfinished bookkeeping',
    '  - done: old bookkeeping is complete',
    '  - verify: node --test',
    '',
  ].join('\n'));

  for (const status of ['applied', 'archived', 'closed', 'historical', 'legacy-frozen']) {
    await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
      version: 1,
      activeChange: 'historical-ledger',
      changes: {
        'historical-ledger': { id: 'historical-ledger', status },
      },
    }, null, 2)}\n`);
    const quality = await verifyQualityWorkspace(project);
    const activeTasks = quality.report.evalHarness.featureCoverage.activeTasks;
    const featureCoverageGate = quality.report.gates.find((gate) => gate.id === 'feature-coverage');
    assert.equal(activeTasks.activeChange, null);
    assert.equal(activeTasks.pending, 0);
    assert.equal(activeTasks.excludedActiveChange.id, 'historical-ledger');
    assert.equal(activeTasks.excludedActiveChange.status, status);
    assert.equal(featureCoverageGate.scope, 'workspace-claim');
    assert.notEqual(featureCoverageGate.status, 'needs-attention');
  }
});

test('quality excludes legacy-frozen task metadata without hiding current tasks', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'mixed-ledger', {
    title: 'Mixed ledger',
    requirementTitle: 'Only current task coverage counts',
    taskTitle: 'Current completed task',
  });
  await fs.writeFile(path.join(project, '.openprd', 'changes', 'mixed-ledger', 'tasks.md'), [
    '# Tasks',
    '',
    '- [ ] T001.01 Historical unfinished task',
    '  - lifecycle: legacy-frozen',
    '  - done: historical context only',
    '  - verify: node --test',
    '- [x] T001.02 Current completed task',
    '  - lifecycle: active',
    '  - done: current task is complete',
    '  - verify: node --test',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: 'mixed-ledger',
    changes: {
      'mixed-ledger': { id: 'mixed-ledger', status: 'active' },
    },
  }, null, 2)}\n`);

  const quality = await verifyQualityWorkspace(project);
  const activeTasks = quality.report.evalHarness.featureCoverage.activeTasks;
  assert.equal(quality.report.evalHarness.featureCoverage.scope, 'workspace-claim');
  assert.equal(activeTasks.total, 1);
  assert.equal(activeTasks.done, 1);
  assert.equal(activeTasks.pending, 0);
  assert.equal(activeTasks.excludedTasks.length, 1);
  assert.equal(activeTasks.excludedTasks[0].id, 'T001.01');
});

test('quality requires reference-driven visual evidence for frontend changes', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: 'settings-visual-refresh',
    changes: {},
  }, null, 2)}\n`);
  const changeDir = path.join(project, '.openprd', 'changes', 'settings-visual-refresh');
  await fs.mkdir(path.join(changeDir, 'specs', 'settings-visual-refresh'), { recursive: true });
  await fs.writeFile(path.join(changeDir, 'proposal.md'), [
    '# Proposal',
    '',
    '## Why',
    '设置页面需要按参考图和设计稿做一次明显的界面改版。',
    '',
    '## What Changes',
    '- Refresh the settings page UI using the provided reference image and design mockup.',
    '',
    '## Impact',
    '- 页面布局、视觉层级和主要交互密度需要与参考图对齐。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'specs', 'settings-visual-refresh', 'spec.md'), [
    '# settings-visual-refresh spec',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: 设置页面视觉还原需要对照参考图',
    '实现阶段必须对照参考图和设计稿完成视觉比对。',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(changeDir, 'tasks.md'), [
    '- [x] T001.01 Refresh settings page visual layout',
    '  - type: implementation',
    '  - done: settings page matches the provided reference image and design mockup',
    '  - verify: openprd tasks . --change settings-visual-refresh --item T001.01 --evidence-required',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'harness', 'test-reports'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'harness', 'test-reports', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke: passed settings main flow.',
    '- feature coverage: openprd tasks done.',
    '',
  ].join('\n'));

  const missing = await verifyQualityWorkspace(project);
  const missingGate = missing.report.gates.find((gate) => gate.id === 'visual-review');
  assert.equal(missing.ok, true);
  assert.equal(missing.effectiveEnforcement.mode, 'advisory');
  assert.deepEqual(missing.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage', 'visual-review']);
  assert.equal(missing.report.visualReview.relevant, true);
  assert.equal(missing.report.visualReview.expectsReferenceCompare, true);
  assert.equal(missingGate.required, true);
  assert.equal(missingGate.status, 'needs-evidence');

  const before = path.join(project, 'before.png');
  const after = path.join(project, 'after.png');
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#d97706',
    },
  }).png().toFile(before);
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#2563eb',
    },
  }).png().toFile(after);
  const beforeAfter = await visualCompareWorkspace(project, {
    before,
    after,
    maxPanelWidth: 100,
  });
  assert.ok(beforeAfter.metadataPath.endsWith('.json'));
  const beforeAfterGate = (await verifyQualityWorkspace(project)).report.gates.find((gate) => gate.id === 'visual-review');
  assert.equal(beforeAfterGate.status, 'needs-evidence');

  const reference = path.join(project, 'reference.png');
  const actual = path.join(project, 'actual.png');
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#111827',
    },
  }).png().toFile(reference);
  await sharp({
    create: {
      width: 180,
      height: 120,
      channels: 3,
      background: '#10b981',
    },
  }).png().toFile(actual);
  const compare = await visualCompareWorkspace(project, {
    reference,
    actual,
    maxPanelWidth: 100,
  });
  const compareMetadata = JSON.parse(await fs.readFile(compare.metadataPath, 'utf8'));
  assert.equal(compareMetadata.schema, 'openprd.visual-review.v1');
  assert.equal(compareMetadata.mode, 'reference-actual');

  const passed = await verifyQualityWorkspace(project);
  const visualGate = passed.report.gates.find((gate) => gate.id === 'visual-review');
  assert.equal(passed.ok, true);
  assert.equal(passed.report.readiness.productionReady, true);
  assert.equal(visualGate.status, 'pass');
  assert.equal(visualGate.evidence.present, true);
  assert.ok(visualGate.evidence.sources.some((source) => source.path.endsWith(path.basename(compare.outputPath))));
});

test.skip('legacy high-risk OpenPrd blocking behavior (superseded by advisory-only risk context)', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  const fakeCodexBin = await writeFakeCodexBin(project);
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: null,
    changes: {},
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'discovery', 'config.json'), `${JSON.stringify({
    activeChange: null,
    taskSharding: {
      maxItemsPerFile: 25,
      handoffRequired: true,
      firstFile: 'tasks.md',
      nextFilePattern: 'tasks-###.md',
    },
    taskMetadata: {
      stableIdPattern: 'T###.##',
      required: ['done', 'verify'],
      optional: ['deps', 'type'],
      dependencyOrder: 'dependencies must appear before dependents',
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    type: 'module',
    scripts: {
      'test:smoke': 'node --test smoke.test.js',
    },
  }, null, 2)}\n`);

  const hookResult = spawnSync(process.execPath, [path.join(project, '.codex', 'hooks', 'openprd-hook.mjs'), 'PreToolUse'], {
    cwd: project,
    input: JSON.stringify({
      cwd: project,
      tool_input: {
        cmd: 'git commit -m "test"',
      },
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeCodexBin}${path.delimiter}${process.env.PATH}`,
      OPENPRD_CLI: path.resolve('openprd/bin/openprd.js'),
    },
  });
  assert.equal(hookResult.status, 0);
  const hookPayload = JSON.parse(hookResult.stdout);
  assert.equal(hookPayload.decision, 'block');
  assert.ok(hookPayload.reason.includes('workspace is not fully ready'));
  assert.ok(hookPayload.reason.includes('quality attention gates: smoke'));
  assert.ok(hookPayload.reason.includes('resolve the workspace-level debt'));
});

test('quality does not treat OpenPRD freeze and handoff wording as a release gate', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({
    scripts: {
      'test:smoke': 'node --test test/smoke.test.js',
    },
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'changes', 'habit-check-cli'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'changes', 'habit-check-cli', 'tasks.md'), [
    '# Tasks',
    '',
    '- [x] freeze 后生成任务拆解',
    '- [x] handoff 前确认 smoke evidence',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    activeChange: 'habit-check-cli',
  }, null, 2)}\n`);
  await fs.mkdir(path.join(project, '.openprd', 'quality', 'evidence'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'quality', 'evidence', 'smoke.md'), [
    '# smoke evidence',
    '',
    '- smoke passed: main flow and invalid JSON path.',
    '- feature coverage: openprd tasks done.',
    '',
  ].join('\n'));

  const quality = await verifyQualityWorkspace(project);
  assert.equal(quality.report.qualityPolicy.scenarioTags.includes('release'), false);
  assert.deepEqual(quality.report.qualityPolicy.requiredGates, ['smoke', 'feature-coverage']);
  assert.equal(quality.report.readiness.productionReady, true);
});

test('quality flags missing business guardrails for free metered AI usage', async () => {
  const project = await makeTempProject();
  await initQualityWorkspace(project);
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'ai.js'), 'export const feature = "Free users can trigger AI generation with third-party model calls";\n');

  const missing = await verifyQualityWorkspace(project);
  const missingGate = missing.report.gates.find((gate) => gate.id === 'business-guardrails');
  assert.equal(missing.report.businessGuardrails.riskDetected, true);
  assert.equal(missingGate.status, 'needs-attention');
  assert.ok(missing.report.businessGuardrails.missingEvidence.includes('usageLimits'));
  assert.ok(missing.report.businessGuardrails.missingEvidence.includes('stopLossActions'));

  await fs.mkdir(path.join(project, 'docs', 'ops'), { recursive: true });
  await fs.writeFile(path.join(project, 'docs', 'ops', 'business-guardrails.md'), [
    '# Business guardrails',
    '',
    '- quota: free tier users have a daily limit and monthly limit.',
    '- abuse: negative test covers bypass, replay, concurrent, and unauthorized requests.',
    '- usage metric: dashboard tracks tokens_used and cost_usd spend.',
    '- alert: budget threshold alarm fires on anomaly growth.',
    '- kill switch: feature flag can disable, degrade, pause, or shutdown AI generation.',
    '',
  ].join('\n'));

  const covered = await verifyQualityWorkspace(project);
  const coveredGate = covered.report.gates.find((gate) => gate.id === 'business-guardrails');
  assert.equal(coveredGate.status, 'pass');
  assert.deepEqual(covered.report.businessGuardrails.missingEvidence, []);
});

test('standards require concrete docs plus file and folder manuals for source files', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export const app = true;\n');

  const missingManuals = await checkStandardsWorkspace(project);
  assert.equal(missingManuals.ok, false);
  assert.ok(missingManuals.errors.some((error) => error.includes('docs/basic/file-structure.md 仍包含模板占位内容')));
  assert.ok(missingManuals.errors.some((error) => error.includes('src/app.js 缺少文件说明书')));
  assert.ok(missingManuals.errors.some((error) => error.includes('src/project_src_README.md')));

  for (const doc of [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 当前没有交互。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', '# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- `src/app.js` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 `node src/app.js` 运行，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n'],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 无运行时依赖。\n\n## 工具链\n\n- `node --check`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ]) {
    await fs.writeFile(path.join(project, 'docs', 'basic', doc[0]), doc[1]);
  }

  const manual = [
    '/*',
    '## 核心功能',
    '提供示例入口。',
    '## 输入',
    '无。',
    '## 输出',
    '导出 app 常量。',
    '## 定位',
    '位于源码入口。',
    '## 依赖',
    '无。',
    '## 维护规则',
    '修改行为后更新说明书。',
    '*/',
    'export const app = true;',
    '',
  ].join('\n');
  await fs.writeFile(path.join(project, 'src', 'app.js'), manual);
  const folderReadmeName = `${path.basename(project)}_src_README.md`;
  await fs.writeFile(path.join(project, 'src', folderReadmeName), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('源文件说明书: 1/1。')));
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('workspace standards debt stays visible without failing run context or current-task readiness', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'src', 'app.js'), 'export const app = true;\n');

  const standards = await checkStandardsWorkspace(project);
  assert.equal(standards.ok, false);
  assert.equal(standards.scope, 'workspace');
  assert.equal(standards.blocking, false);
  assert.equal(standards.readiness.workspaceReady, false);
  assert.equal(standards.readiness.actionReady, true);

  const { report } = await validateWorkspace(project);
  assert.equal(report.valid, false);
  assert.equal(report.structuralValid, true);
  assert.equal(report.workspaceReady, false);
  assert.equal(report.actionReady, true);
  assert.equal(report.claimReady, false);
  assert.equal(report.workspaceAttention?.kind, 'workspace-validation');

  const verified = await runWorkspace(project, { verify: true });
  assert.equal(verified.ok, true);
  assert.equal(verified.readiness.taskReady, true);
  assert.equal(verified.readiness.claimReady, false);
  assert.equal(verified.readiness.actionReady, true);
  assert.equal(verified.readiness.workspaceReady, false);
  assert.equal(verified.readiness.workspaceClaimReady, false);
  assert.equal(verified.errors.length, 0);
  assert.equal(verified.checks.find((check) => check.name === 'standards')?.scope, 'workspace');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['run', project, '--verify']), 0);
    assert.equal(await main(['standards', project, '--verify']), 0);
    assert.equal(await main(['standards', project, '--verify', '--fail-on-violation']), 1);
    assert.equal(await main(['quality', project, '--verify']), 0);
    assert.equal(await main(['quality', project, '--verify', '--fail-on-violation']), 1);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('当前任务通过，工作区待关注')));
  assert.equal(logs.some((line) => line.includes('开始动手前提')), false);
});

test('standards and quality CLI still fail on missing structural configuration', async () => {
  const project = await makeTempProject();
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    assert.equal(await main(['standards', project, '--verify']), 1);
    assert.equal(await main(['quality', project, '--verify']), 1);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('.openprd/standards/config.json is required')));
  assert.ok(logs.some((line) => line.includes('.openprd/quality/config.json is required')));
});

test('standards prefer package.json name over worktree folder name for folder manuals', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: 'moticlaw', type: 'module' }, null, 2)}\n`);
  await writeConcreteBasicDocs(project, 'src/app.js');
  await writeSourceManual(path.join(project, 'src', 'app.js'), 'export const app = true;');
  await fs.writeFile(path.join(project, 'src', 'moticlaw_src_README.md'), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('standards allow folder manual moduleName override when package name differs', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: '@scope/wrong-name', type: 'module' }, null, 2)}\n`);
  await writeConcreteBasicDocs(project, 'src/app.js');
  await writeSourceManual(path.join(project, 'src', 'app.js'), 'export const app = true;');
  const configPath = path.join(project, '.openprd', 'standards', 'config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.folderManual.moduleName = 'moticlaw';
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.writeFile(path.join(project, 'src', 'moticlaw_src_README.md'), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('standards use the normalized module name for the project root folder manual', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.writeFile(path.join(project, 'package.json'), `${JSON.stringify({ name: 'moticlaw', type: 'module' }, null, 2)}\n`);
  await writeConcreteBasicDocs(project, 'root-entry.js');
  await writeSourceManual(path.join(project, 'root-entry.js'), 'export const rootEntry = true;');
  await fs.writeFile(path.join(project, 'moticlaw_moticlaw_README.md'), [
    '# 项目根目录说明书',
    '',
    '## 核心功能',
    '承载项目级源码与配置入口。',
    '',
    '## 输入',
    '开发者维护项目根目录文件。',
    '',
    '## 输出',
    '对外提供项目级入口。',
    '',
    '## 定位',
    '项目根目录。',
    '',
    '## 依赖',
    'Node.js 运行时。',
    '',
    '## 维护规则',
    '新增根目录源码后更新本说明书。',
    '',
  ].join('\n'));

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.ok(passed.checks.some((check) => check.includes('文件夹说明书: 1/1。')));
});

test('standards ignore non-owned generated and marketplace source trees', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });

  for (const doc of [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 当前没有交互。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', '# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- `src/app.js` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 `node src/app.js` 运行，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n'],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 无运行时依赖。\n\n## 工具链\n\n- `node --check`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ]) {
    await fs.writeFile(path.join(project, 'docs', 'basic', doc[0]), doc[1]);
  }

  await fs.writeFile(path.join(project, 'src', 'app.js'), [
    '/*',
    '## 核心功能',
    '提供示例入口。',
    '## 输入',
    '无。',
    '## 输出',
    '导出 app 常量。',
    '## 定位',
    '位于源码入口。',
    '## 依赖',
    '无。',
    '## 维护规则',
    '修改行为后更新说明书。',
    '*/',
    'export const app = true;',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'src', `${path.basename(project)}_src_README.md`), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  await fs.mkdir(path.join(project, '.tmp', 'marketplace-sources', 'skill'), { recursive: true });
  await fs.writeFile(path.join(project, '.tmp', 'marketplace-sources', 'skill', 'script.py'), 'print("cached")\n');
  await fs.mkdir(path.join(project, 'resources', 'marketplace-candidates', 'skill-sources', 'demo'), { recursive: true });
  await fs.writeFile(path.join(project, 'resources', 'marketplace-candidates', 'skill-sources', 'demo', 'tool.ts'), 'export const cached = true;\n');
  await fs.mkdir(path.join(project, 'resources', 'legacy-data', 'workspace', 'skills', 'demo'), { recursive: true });
  await fs.writeFile(path.join(project, 'resources', 'legacy-data', 'workspace', 'skills', 'demo', 'legacy.js'), 'export const legacy = true;\n');
  await fs.mkdir(path.join(project, 'fixtures', 'demo'), { recursive: true });
  await fs.writeFile(path.join(project, 'fixtures', 'demo', 'example.ts'), 'export const fixture = true;\n');

  const report = await checkStandardsWorkspace(project);
  assert.equal(report.ok, true);
  assert.deepEqual(report.manualReport.sourceFiles, ['src/app.js']);
  assert.ok(report.manualReport.ignorePatterns.includes('**/marketplace-sources/**'));
});

test('standards can classify nested reference repositories as external source', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await fs.mkdir(path.join(project, 'src'), { recursive: true });

  for (const doc of [
    ['file-structure.md', '# 项目文件结构\n\n## 项目定位\n\n测试项目。\n\n## 核心目录\n\n- `src/`: 示例源码。\n- `research/`: 外部参考源码，只作为调研证据。\n\n## 文件组织规则\n\n- 源码放在 `src/`。\n\n## 维护规则\n\n- 修改源码后更新说明书。\n'],
    ['app-flow.md', '# 产品流程说明\n\n## 核心流程\n\n用户运行示例。\n\n## 用户路径\n\n- 打开项目并执行命令。\n\n## 状态变化\n\n- 示例从未运行到已运行。\n\n## 维护规则\n\n- 流程变化后更新本文档。\n'],
    ['prd.md', '# 产品逻辑说明\n\n## 问题与目标\n\n提供最小示例。\n\n## 用户故事\n\n- 用户可以运行示例。\n\n## 功能范围\n\n- 示例入口。\n\n## 验收标准\n\n- 命令可执行。\n\n## 维护规则\n\n- 需求变化后更新本文档。\n'],
    ['frontend-guidelines.md', '# 前端开发规范\n\n## 适用范围\n\n无前端界面。\n\n## 界面结构\n\n- 当前没有页面。\n\n## 交互规范\n\n- 当前没有交互。\n\n## 维护规则\n\n- 新增界面后更新本文档。\n'],
    ['backend-structure.md', '# 后端架构设计\n\n## 适用范围\n\n示例脚本。\n\n## 服务边界\n\n- `src/app.js` 提供入口。\n\n## CLI 接入面\n\n- 当前通过 `node src/app.js` 运行，不提供独立 CLI 子命令。\n\n## API 接入面\n\n- 当前不提供 HTTP 或 RPC API。\n\n## 数据流\n\n- 无外部数据。\n\n## 维护规则\n\n- 模块或 CLI/API 接入面变化后更新本文档。\n'],
    ['tech-stack.md', '# 项目技术栈\n\n## 运行环境\n\n- Node.js。\n\n## 核心依赖\n\n- 无运行时依赖。\n\n## 工具链\n\n- `node --check`。\n\n## 维护规则\n\n- 依赖变化后更新本文档。\n'],
  ]) {
    await fs.writeFile(path.join(project, 'docs', 'basic', doc[0]), doc[1]);
  }

  await fs.writeFile(path.join(project, 'src', 'app.js'), [
    '/*',
    '## 核心功能',
    '提供示例入口。',
    '## 输入',
    '无。',
    '## 输出',
    '导出 app 常量。',
    '## 定位',
    '位于源码入口。',
    '## 依赖',
    '无。',
    '## 维护规则',
    '修改行为后更新说明书。',
    '*/',
    'export const app = true;',
    '',
  ].join('\n'));
  await fs.writeFile(path.join(project, 'src', `${path.basename(project)}_src_README.md`), [
    '# src 文件夹说明书',
    '',
    '## 核心功能',
    '承载示例源码。',
    '',
    '## 输入',
    '开发者编辑源码。',
    '',
    '## 输出',
    '对外提供示例入口。',
    '',
    '## 定位',
    '项目源码目录。',
    '',
    '## 依赖',
    '无。',
    '',
    '## 维护规则',
    '- 新增源码后更新本文档。',
    '',
  ].join('\n'));

  await fs.mkdir(path.join(project, 'research', 'cat-bedtime', '.git'), { recursive: true });
  for (const fileName of ['one.py', 'two.py', 'three.py', 'four.py', 'five.py']) {
    await fs.writeFile(path.join(project, 'research', 'cat-bedtime', fileName), 'print("reference")\n');
  }

  const missing = await checkStandardsWorkspace(project);
  assert.equal(missing.ok, true);
  assert.deepEqual(missing.manualReport.sourceFiles, ['src/app.js']);
  assert.deepEqual(missing.manualReport.provisionalExternalReferencePaths, ['research/cat-bedtime']);
  assert.equal(missing.manualReport.externalReferenceCandidates[0].path, 'research/cat-bedtime');
  assert.equal(missing.manualReport.externalReferenceCandidates[0].reason, 'nested-git');
  assert.ok(missing.checks.some((check) => check.includes('外部参考候选: 1 个已暂按候选跳过逐文件说明书')));

  const classified = await classifyExternalReferenceWorkspace(project, { externalReference: 'research/cat-bedtime' });
  assert.equal(classified.ok, true);
  assert.equal(classified.path, 'research/cat-bedtime');

  const passed = await checkStandardsWorkspace(project);
  assert.equal(passed.ok, true);
  assert.deepEqual(passed.manualReport.sourceFiles, ['src/app.js']);
  assert.deepEqual(passed.manualReport.externalReferencePaths, ['research/cat-bedtime']);
  assert.ok(passed.checks.some((check) => check.includes('外部参考源码: 1 个已跳过逐文件说明书。')));
});
