import test from 'node:test';
import { loadWorkspace } from '../src/workspace-core.js';

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
test('validate fails for an empty project', async () => {
  const project = await makeTempProject();

  const { report } = await validateWorkspace(project);
  assert.equal(report.valid, false);
  assert.ok(report.errors.length > 0);
});



test('init workspace seeds Chinese-default README docs with English switch files', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const workspaceReadme = await fs.readFile(path.join(project, '.open-vibecoding', 'README.md'), 'utf8');
  const workspaceReadmeEn = await fs.readFile(path.join(project, '.open-vibecoding', 'README_EN.md'), 'utf8');
  const companyReadme = await fs.readFile(path.join(project, '.open-vibecoding', 'templates', 'company', 'README.md'), 'utf8');
  const companyReadmeEn = await fs.readFile(path.join(project, '.open-vibecoding', 'templates', 'company', 'README_EN.md'), 'utf8');

  assert.ok(workspaceReadme.includes('简体中文 | [English](./README_EN.md)'));
  assert.ok(workspaceReadme.includes('`docs/basic/`'));
  assert.ok(workspaceReadmeEn.includes('[简体中文](./README.md) | English'));
  assert.ok(companyReadme.includes('公司模板层'));
  assert.ok(companyReadme.includes('简体中文 | [English](./README_EN.md)'));
  assert.ok(companyReadmeEn.includes('[简体中文](./README.md) | English'));
});

test('status reports workspace capabilities without a PRD stage', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const exitCode = await main(['status', project]);
    assert.equal(exitCode, 0);
  } finally {
    console.log = originalLog;
  }

  const text = logs.join('\n');
  assert.match(text, /场景模板:/);
  assert.doesNotMatch(text, /PRD 版本:|用户参与模式:|当前建议:/);
});
