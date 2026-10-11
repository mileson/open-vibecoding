import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildChangeEntry, buildTaskCommitMessage, USER_CHANGE_SUMMARY_GUIDE } from '../src/change-summary.js';
import { printInitResult } from '../src/cli/print.js';

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
  designStarterWorkspace,
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
  releaseWorkspace,
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

test('change summary formatter prefers user-visible verbs for commits and summaries', () => {
  const entry = buildChangeEntry('支持用户直接查看版本说明', { fallbackType: '新增' });
  assert.equal(entry?.type, '新增');
  assert.equal(entry?.summary.startsWith('新增'), true);
  assert.equal(entry?.detail.includes('用户直接查看版本说明'), true);

  const commitMessage = buildTaskCommitMessage({
    id: 'T001.02',
    title: '统一 review 摘要文案',
    done: '让用户先看懂新增、修复、优化结果',
  });
  assert.equal(commitMessage.startsWith('优化'), true);
  assert.ok(commitMessage.includes('- 优化：让用户先看懂新增、修复、优化结果'));
  assert.ok(commitMessage.includes('- 任务：T001.02 统一 review 摘要文案'));
  assert.equal(commitMessage.includes('Complete T001.02'), false);
  assert.deepEqual(USER_CHANGE_SUMMARY_GUIDE.preferredVerbs, ['新增', '修复', '优化', '调整', '移除']);
});

test('isolated Codex worker script bypasses noisy user Codex home and preserves outputs', async () => {
  const project = await makeTempProject();
  const noisyCodexHome = path.join(project, 'noisy-codex-home');
  const legacyBin = path.join(project, 'legacy-bin');
  const modernBin = path.join(project, 'modern-bin');
  const legacyCodexPath = path.join(legacyBin, 'codex');
  const modernCodexPath = path.join(modernBin, 'codex');
  const promptFile = path.join(project, 'prompt.txt');
  const outputJsonl = path.join(project, 'artifacts', 'worker-output.jsonl');
  const outputLastMessage = path.join(project, 'artifacts', 'last-message.txt');
  const fakeCodexLog = path.join(project, 'fake-codex-log.json');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedWorkerScript = path.join(repoRoot, 'scripts', 'open-vibecoding-codex-isolated-worker.mjs');

  await fs.mkdir(noisyCodexHome, { recursive: true });
  await fs.writeFile(path.join(noisyCodexHome, 'auth.json'), JSON.stringify({ access_token: 'test-token' }, null, 2));
  await fs.writeFile(path.join(noisyCodexHome, 'config.toml'), [
    'model = "gpt-5.4"',
    'service_tier = "default"',
    '',
  ].join('\n'));
  await fs.mkdir(legacyBin, { recursive: true });
  await fs.writeFile(legacyCodexPath, [
    '#!/usr/bin/env node',
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n');",
    '  process.exit(0);',
    '}',
    "console.error('legacy codex should not be executed');",
    'process.exit(97);',
    '',
  ].join('\n'));
  await fs.chmod(legacyCodexPath, 0o755);
  await fs.mkdir(modernBin, { recursive: true });
  await fs.writeFile(modernCodexPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n      --dangerously-bypass-hook-trust\\n');",
    '  process.exit(0);',
    '}',
    "const stdin = fs.readFileSync(0, 'utf8');",
    'const payload = {',
    '  args,',
    '  stdin,',
    '  cwd: process.cwd(),',
    '  commandPath: process.argv[1],',
    '  env: {',
    '    CODEX_HOME: process.env.CODEX_HOME,',
    '    OPEN_VIBECODING_CODEX_HOME: process.env.OPEN_VIBECODING_CODEX_HOME,',
    '  },',
    '};',
    'fs.writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(payload, null, 2));',
    'if (process.env.CODEX_HOME === process.env.FAKE_NOISY_CODEX_HOME) {',
    "  console.error(\"Error loading config.toml: unknown variant 'default'\");",
    '  process.exit(64);',
    '}',
    "const outputIndex = args.indexOf('-o');",
    'if (outputIndex >= 0 && args[outputIndex + 1]) {',
    '  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });',
    "  fs.writeFileSync(args[outputIndex + 1], 'final response\\n');",
    '}',
    "if (args.includes('--json')) {",
    "  process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }) + '\\n');",
    "  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'final response' } }) + '\\n');",
    '} else {',
    "  process.stdout.write('final response\\n');",
    '}',
    '',
  ].join('\n'));
  await fs.chmod(modernCodexPath, 0o755);
  await fs.writeFile(promptFile, 'reply with ok\n');

  const result = spawnSync('node', [
    isolatedWorkerScript,
    '--cwd', project,
    '--prompt-file', promptFile,
    '--output-jsonl', outputJsonl,
    '--output-last-message', outputLastMessage,
    '--source-codex-home', noisyCodexHome,
    '--full-auto',
    '--skip-git-repo-check',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${legacyBin}:${modernBin}:${process.env.PATH}`,
      FAKE_CODEX_LOG: fakeCodexLog,
      FAKE_NOISY_CODEX_HOME: noisyCodexHome,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const log = JSON.parse(await fs.readFile(fakeCodexLog, 'utf8'));
  assert.equal(log.commandPath, modernCodexPath);
  assert.equal(log.env.CODEX_HOME === noisyCodexHome, false);
  assert.equal(log.env.CODEX_HOME, log.env.OPEN_VIBECODING_CODEX_HOME);
  assert.ok(log.env.CODEX_HOME.includes('open-vibecoding-codex-home-'));
  assert.equal(await pathExists(log.env.CODEX_HOME), false);
  assert.equal(log.cwd, await fs.realpath(project));
  assert.ok(log.args.includes('--json'));
  assert.ok(log.args.includes('--skip-git-repo-check'));
  assert.ok(log.args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(log.args.includes('--dangerously-bypass-hook-trust'));
  assert.ok(log.args.includes('--model'));
  assert.ok(log.args.includes('gpt-5.4'));
  assert.equal(log.stdin, 'reply with ok\n');
  assert.ok((await fs.readFile(outputJsonl, 'utf8')).includes('"thread.started"'));
  assert.equal((await fs.readFile(outputLastMessage, 'utf8')).trim(), 'final response');
});

test('isolated Codex worker script auto-resumes when starter output never gets overwritten', async () => {
  const project = await makeTempProject();
  const noisyCodexHome = path.join(project, 'noisy-codex-home');
  const fakeBin = path.join(project, 'fake-bin');
  const fakeCodexPath = path.join(fakeBin, 'codex');
  const promptFile = path.join(project, 'prompt.txt');
  const outputJsonl = path.join(project, 'artifacts', 'worker-output.jsonl');
  const outputLastMessage = path.join(project, 'artifacts', 'last-message.txt');
  const fakeCodexLog = path.join(project, 'fake-codex-log.jsonl');
  const fakeCodexCounter = path.join(project, 'fake-codex-counter.txt');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedWorkerScript = path.join(repoRoot, 'scripts', 'open-vibecoding-codex-isolated-worker.mjs');

  await fs.mkdir(noisyCodexHome, { recursive: true });
  await fs.writeFile(path.join(noisyCodexHome, 'auth.json'), JSON.stringify({ access_token: 'test-token' }, null, 2));
  await fs.writeFile(path.join(noisyCodexHome, 'config.toml'), 'model = "gpt-5.4"\n');
  await fs.mkdir(path.join(project, '.open-vibecoding', 'state'), { recursive: true });
  await fs.writeFile(path.join(project, '.open-vibecoding', 'state', 'events.jsonl'), `${JSON.stringify({
    type: 'design_starter_created',
    at: '2026-06-09 10:02:37',
    output: 'index.html',
  })}\n`);
  await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html><body>starter</body></html>\n');
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(fakeCodexPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n      --dangerously-bypass-hook-trust\\n');",
    '  process.exit(0);',
    '}',
    "const stdin = fs.readFileSync(0, 'utf8');",
    'const counterPath = process.env.FAKE_CODEX_COUNTER;',
    'let count = 0;',
    'try {',
    "  count = Number(fs.readFileSync(counterPath, 'utf8').trim()) || 0;",
    '} catch {}',
    'count += 1;',
    "fs.writeFileSync(counterPath, String(count));",
    'const payload = {',
    '  invocation: count,',
    '  args,',
    '  stdin,',
    '  cwd: process.cwd(),',
    '};',
    "fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(payload) + '\\n');",
    "const outputIndex = args.indexOf('-o');",
    'if (outputIndex >= 0 && args[outputIndex + 1]) {',
    '  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });',
    "  fs.writeFileSync(args[outputIndex + 1], count === 1 ? 'first pass\\n' : 'second pass\\n');",
    '}',
    'if (count === 2) {',
    "  fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><html><body>landed</body></html>\\n');",
    '}',
    "process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: `item_${count}`, type: 'agent_message', text: count === 1 ? 'first pass' : 'second pass' } }) + '\\n');",
    '',
  ].join('\n'));
  await fs.chmod(fakeCodexPath, 0o755);
  await fs.writeFile(promptFile, 'reply with ok\n');

  const result = spawnSync('node', [
    isolatedWorkerScript,
    '--cwd', project,
    '--prompt-file', promptFile,
    '--output-jsonl', outputJsonl,
    '--output-last-message', outputLastMessage,
    '--source-codex-home', noisyCodexHome,
    '--full-auto',
    '--skip-git-repo-check',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_CODEX_LOG: fakeCodexLog,
      FAKE_CODEX_COUNTER: fakeCodexCounter,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const invocations = await readJsonl(fakeCodexLog);
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[0].args.slice(0, 2), ['exec', '--json']);
  assert.deepEqual(invocations[1].args.slice(0, 3), ['exec', 'resume', 'thread_test']);
  assert.ok(invocations[1].stdin.includes('不要继续搜集资料'));
  assert.equal((await fs.readFile(path.join(project, 'index.html'), 'utf8')).includes('landed'), true);
  const output = await fs.readFile(outputJsonl, 'utf8');
  assert.ok(output.includes('thread_test'));
  assert.equal((await fs.readFile(outputLastMessage, 'utf8')).trim(), 'second pass');
});

test('isolated Codex worker script auto-resumes when Patch Mode stalls after a write attempt', async () => {
  const project = await makeTempProject();
  const noisyCodexHome = path.join(project, 'noisy-codex-home');
  const fakeBin = path.join(project, 'fake-bin');
  const fakeCodexPath = path.join(fakeBin, 'codex');
  const promptFile = path.join(project, 'prompt.txt');
  const outputJsonl = path.join(project, 'artifacts', 'worker-output.jsonl');
  const outputLastMessage = path.join(project, 'artifacts', 'last-message.txt');
  const fakeCodexLog = path.join(project, 'fake-codex-log.jsonl');
  const fakeCodexCounter = path.join(project, 'fake-codex-counter.txt');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const isolatedWorkerScript = path.join(repoRoot, 'scripts', 'open-vibecoding-codex-isolated-worker.mjs');

  await fs.mkdir(noisyCodexHome, { recursive: true });
  await fs.writeFile(path.join(noisyCodexHome, 'auth.json'), JSON.stringify({ access_token: 'test-token' }, null, 2));
  await fs.writeFile(path.join(noisyCodexHome, 'config.toml'), 'model = "gpt-5.4"\n');
  await fs.mkdir(path.join(project, '.open-vibecoding', 'state'), { recursive: true });
  await fs.mkdir(path.join(project, '.open-vibecoding', 'harness'), { recursive: true });
  await fs.writeFile(path.join(project, '.open-vibecoding', 'state', 'events.jsonl'), `${JSON.stringify({
    type: 'design_starter_created',
    at: '2026-06-09 10:02:37',
    output: 'index.html',
  })}\n`);
  await fs.writeFile(path.join(project, 'index.html'), '<!doctype html><html><body>starter</body></html>\n');
  const nowMs = Date.now();
  await fs.writeFile(path.join(project, '.open-vibecoding', 'harness', 'patch-mode-gate.json'), JSON.stringify({
    version: 1,
    active: true,
    status: 'write-attempted',
    phase: 'strict',
    targetFile: 'index.html',
    targetHashAtArm: '8666f166dbf8513f',
    fileHashesAtArm: {
      'index.html': '8666f166dbf8513f',
    },
    draftFiles: [],
    armedAtMs: nowMs,
    lastWriteAttemptAtMs: nowMs,
  }, null, 2));
  await fs.mkdir(fakeBin, { recursive: true });
  await fs.writeFile(fakeCodexPath, [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('Usage: codex exec [OPTIONS] [PROMPT]\\n      --dangerously-bypass-hook-trust\\n');",
    '  process.exit(0);',
    '}',
    'const counterPath = process.env.FAKE_CODEX_COUNTER;',
    'let count = 0;',
    'try {',
    "  count = Number(fs.readFileSync(counterPath, 'utf8').trim()) || 0;",
    '} catch {}',
    'count += 1;',
    "fs.writeFileSync(counterPath, String(count));",
    "const stdin = fs.readFileSync(0, 'utf8');",
    'const payload = {',
    '  invocation: count,',
    '  args,',
    '  stdin,',
    '  cwd: process.cwd(),',
    '};',
    "fs.appendFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify(payload) + '\\n');",
    "const outputIndex = args.indexOf('-o');",
    'if (outputIndex >= 0 && args[outputIndex + 1]) {',
    '  fs.mkdirSync(path.dirname(args[outputIndex + 1]), { recursive: true });',
    "  fs.writeFileSync(args[outputIndex + 1], count === 1 ? 'stalled pass\\n' : 'resumed pass\\n');",
    '}',
    "process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: 'thread_test' }) + '\\n');",
    "process.stdout.write(JSON.stringify({ type: 'item.completed', item: { id: `item_${count}`, type: 'agent_message', text: count === 1 ? 'stalled pass' : 'resumed pass' } }) + '\\n');",
    'if (count === 1) {',
    '  setInterval(() => {}, 1000);',
    '} else {',
    "  fs.writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><html><body>landed after stall</body></html>\\n');",
    '}',
    '',
  ].join('\n'));
  await fs.chmod(fakeCodexPath, 0o755);
  await fs.writeFile(promptFile, 'reply with ok\n');

  const result = spawnSync('node', [
    isolatedWorkerScript,
    '--cwd', project,
    '--prompt-file', promptFile,
    '--output-jsonl', outputJsonl,
    '--output-last-message', outputLastMessage,
    '--source-codex-home', noisyCodexHome,
    '--full-auto',
    '--skip-git-repo-check',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      FAKE_CODEX_LOG: fakeCodexLog,
      FAKE_CODEX_COUNTER: fakeCodexCounter,
      OPEN_VIBECODING_PATCH_MODE_MONITOR_INTERVAL_MS: '25',
      OPEN_VIBECODING_PATCH_MODE_ENTRY_STALL_MS: '400',
      OPEN_VIBECODING_PATCH_MODE_WRITE_ATTEMPT_STALL_MS: '150',
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const invocations = await readJsonl(fakeCodexLog);
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations[1].args.slice(0, 3), ['exec', 'resume', 'thread_test']);
  assert.ok(invocations[1].stdin.includes('不要再 web search'));
  assert.ok(invocations[1].stdin.includes('不要 delete-first'));
  assert.equal((await fs.readFile(path.join(project, 'index.html'), 'utf8')).includes('landed after stall'), true);
  assert.equal((await fs.readFile(outputLastMessage, 'utf8')).trim(), 'resumed pass');
});

test('release workspace tracks current project version and version items', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'agent' });

  let release = await releaseWorkspace(project, {});
  assert.equal(release.ok, true);
  assert.equal(release.summary.enabled, false);
  assert.equal(release.summary.currentVersion, null);

  release = await releaseWorkspace(project, {
    setVersion: 'v0.1.23',
    notes: '新增版本内变化摘要入口',
  });
  assert.equal(release.ok, true);
  assert.equal(release.summary.enabled, true);
  assert.equal(release.summary.currentVersion, '0.1.23');
  assert.equal(release.summary.currentStatus, 'current');
  assert.equal(release.summary.itemCount, 1);
  assert.ok(release.changeSummary.items.some((item) => item.sentence.includes('新增')));

  release = await releaseWorkspace(project, { setVersion: '0.1.24' });
  assert.equal(release.ok, true);
  assert.equal(release.summary.currentVersion, '0.1.24');

  const ledger = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'state', 'release-ledger.json'), 'utf8'));
  assert.equal(ledger.currentVersion, '0.1.24');
  assert.equal(ledger.versions.find((item) => item.version === '0.1.23').status, 'released');
  assert.equal(ledger.versions.find((item) => item.version === '0.1.24').status, 'current');
});

test('init without template pack defaults to base and points scene confirmation later', async () => {
  const project = await makeTempProject();

  const initResult = await initWorkspace(project, {});
  assert.equal(initResult.currentState.templatePack, 'base');
  assert.equal(initResult.currentState.productType, null);
  assert.equal(initResult.templatePackGuidance.source, 'default');
  assert.ok(initResult.templatePackGuidance.message.includes('未指定场景模板'));
  assert.ok(initResult.templatePackGuidance.message.includes('后续需求澄清或场景分类'));
  assert.ok(initResult.templatePackGuidance.message.includes('个人消费者、企业服务或 Agent 场景'));

  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'engagements', 'active', 'progress.md')), false);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    printInitResult(initResult, false);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes(`场景确认: ${initResult.templatePackGuidance.message}`)));
});

test('init creates a workspace and validate passes', async () => {
  const project = await makeTempProject();

  const initResult = await initWorkspace(project, { templatePack: 'consumer' });
  assert.equal(initResult.currentState.templatePack, 'consumer');
  assert.equal(initResult.templatePackGuidance.source, 'explicit');
  assert.ok(initResult.templatePackGuidance.message.includes('已按指定场景模板'));
  assert.ok(initResult.templatePackGuidance.message.includes('仍可按用户确认调整产品场景'));
  assert.equal(initResult.agentIntegration.ok, true);
  assert.deepEqual(initResult.agentIntegration.tools, ['codex', 'claude', 'cursor']);
  const gitignore = await fs.readFile(path.join(project, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('.open-vibecoding/harness/'));
  assert.ok(gitignore.includes('.open-vibecoding/learning/'));
  assert.ok(gitignore.includes('.open-vibecoding/quality/reports/'));

  const { report } = await validateWorkspace(project);
  assert.equal(report.valid, true);
  assert.equal(report.errors.length, 0);

  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'engagements', 'active', 'decision-log.md')), false);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'engagements', 'active', 'intake.md')), false);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'engagements', 'active', 'prd.md')), false);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'state', 'task-graph.json')), false);

  const standards = await checkStandardsWorkspace(project);
  assert.equal(standards.ok, true);
  assert.equal(standards.docsRoot, path.join('docs', 'basic'));
  assert.equal(standards.requiredDocs.length, 6);
  assert.ok(standards.checks.some((check) => check.includes('Development standards: code files ok <= 700 lines')));
  const standardsConfig = JSON.parse(await fs.readFile(path.join(project, '.open-vibecoding', 'standards', 'config.json'), 'utf8'));
  assert.equal(standardsConfig.developmentStandards.codeFileLines.okMax, 700);
  assert.equal(standardsConfig.developmentStandards.codeFileLines.attentionMax, 1500);
  assert.ok(await fs.stat(path.join(project, 'docs', 'basic', 'file-structure.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'standards', 'file-manual-template.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'quality', 'config.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'quality', 'reports')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'knowledge', 'index.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'benchmarks', 'sources.yaml')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'benchmarks', 'index.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'README.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'themes', 'theme-catalog.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'layouts', 'layout-catalog.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'templates', 'README.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'templates', 'content-home.html')).then(() => true));
  assert.ok((await fs.readFile(path.join(project, '.open-vibecoding', 'design', 'templates', 'README.md'), 'utf8')).includes('推荐起步组合'));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'active', 'facts-sheet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'design', 'active', 'selected-direction.md')).then(() => true));
  assert.deepEqual(await fs.readdir(path.join(project, '.open-vibecoding', 'benchmarks', 'inbox')), []);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'learning', 'current.json')), false);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'learning', 'index.json')), false);
  assert.deepEqual(await fs.readdir(path.join(project, '.open-vibecoding', 'learning', 'archive')), []);
  assert.deepEqual(await fs.readdir(path.join(project, '.open-vibecoding', 'quality', 'reports')), []);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'engagements', 'active', 'clarify.html')), false);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'engagements', 'active', 'review.html')), false);
  const codexConfig = await fs.readFile(path.join(project, '.codex', 'config.toml'), 'utf8');
  assert.equal(hasTomlFeatureKey(codexConfig, 'hooks'), true);
  assert.equal(hasTomlFeatureKey(codexConfig, 'codex_hooks'), false);
  const hooksJson = JSON.parse(await fs.readFile(path.join(project, '.codex', 'hooks.json'), 'utf8'));
  assert.equal(hooksJson.UserPromptSubmit.some((group) => group.hooks?.some((hook) => hook.command.includes('open-vibecoding-hook.mjs'))), true);
  assert.equal(findOpenPrdHookGroup(hooksJson.PreToolUse)?.matcher, OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER);
  assert.equal(Boolean(hooksJson.PostToolUse?.some((group) => group.hooks?.some((hook) => hook.command.includes('open-vibecoding-hook.mjs')))), false);
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'harness', 'install-manifest.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'harness', 'hook-state.json')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.open-vibecoding', 'harness', 'events.jsonl')).then(() => true));
  const registryEvents = await readJsonl(path.join(TEST_OPEN_VIBECODING_HOME, 'registry', 'workspaces.jsonl'));
  const registryEntry = registryEvents.find((entry) => entry.workspaceRoot === project);
  assert.ok(registryEntry);
  assert.equal(registryEntry.openprdVersion != null, true);
  assert.deepEqual(registryEntry.tools, ['codex', 'claude', 'cursor']);
  assert.equal((await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-harness', 'SKILL.md'), 'utf8')).startsWith('---\n'), true);
  const requirementIntakeSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-requirement-intake', 'SKILL.md'), 'utf8');
  assert.equal(requirementIntakeSkill.startsWith('---\n'), true);
  assert.ok(requirementIntakeSkill.includes('直接处理（L0）'));
  assert.ok(requirementIntakeSkill.includes('不运行 `capture -> classify -> synthesize -> review -> change -> tasks`'));
  assert.equal(await pathExists(path.join(project, '.codex', 'skills', 'open-vibecoding-requirement-intake', 'references', 'routing-rubric.md')), false);
  assert.equal(await pathExists(path.join(project, '.codex', 'skills', 'open-vibecoding-requirement-intake', 'references', 'prd-template-lenses.md')), false);
  const frontendDesignSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-frontend-design', 'SKILL.md'), 'utf8');
  assert.equal(frontendDesignSkill.startsWith('---\n'), true);
  assert.ok(frontendDesignSkill.includes('.open-vibecoding/design/'));
  assert.ok(frontendDesignSkill.includes('只有视觉候选、用户选中的参考、像素合同、实际截图或比较结果需要跨轮复核时'));
  const directionSkill = await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-visual-direction-review', 'SKILL.md'), 'utf8');
  assert.ok(directionSkill.includes('三个有实质差异的方向'));
  assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'open-vibecoding-frontend-design', 'references', 'design-asset-contract.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'skills', 'open-vibecoding-frontend-design', 'references', 'direction-engine.md')).then(() => true));
  assert.equal((await fs.readFile(path.join(project, '.codex', 'skills', 'open-vibecoding-benchmark-router', 'SKILL.md'), 'utf8')).startsWith('---\n'), true);
  const workspaceConfig = await fs.readFile(path.join(project, '.open-vibecoding', 'config.yaml'), 'utf8');
  assert.ok(workspaceConfig.includes('design:'));
  assert.ok(workspaceConfig.includes('frameworkRoot: .open-vibecoding/design'));
  assert.ok(workspaceConfig.includes('templateRoot: .open-vibecoding/design/templates'));
  assert.equal((await fs.readFile(path.join(project, '.cursor', 'rules', 'open-vibecoding.mdc'), 'utf8')).startsWith('---\n'), true);
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'open-vibecoding-verify.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'open-vibecoding-run.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'open-vibecoding', 'repair.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'open-vibecoding', 'run.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'open-vibecoding-guard.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'open-vibecoding-run.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'open-vibecoding-fleet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'open-vibecoding', 'fleet.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'open-vibecoding-fleet.md')).then(() => true));
  assert.equal(await pathExists(path.join(project, '.codex', 'prompts', 'open-vibecoding-loop.md')), false);
  assert.equal(await pathExists(path.join(project, '.claude', 'commands', 'open-vibecoding', 'loop.md')), false);
  assert.equal(await pathExists(path.join(project, '.cursor', 'commands', 'open-vibecoding-loop.md')), false);
  assert.ok(await fs.stat(path.join(project, '.codex', 'prompts', 'open-vibecoding-visual-compare.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.claude', 'commands', 'open-vibecoding', 'visual-compare.md')).then(() => true));
  assert.ok(await fs.stat(path.join(project, '.cursor', 'commands', 'open-vibecoding-visual-compare.md')).then(() => true));
  const hookRunner = await fs.readFile(path.join(project, '.codex', 'hooks', 'open-vibecoding-hook.mjs'), 'utf8');
  assert.equal(hookRunner.startsWith('/* OPEN_VIBECODING:GENERATED'), true);
  assert.equal(hookRunner.includes('#!/usr/bin/env node'), false);

  const doctor = await doctorWorkspace(project);
  assert.equal(doctor.ok, true);

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
  assert.equal(await main(['standards', project, '--verify']), 0);
  } finally {
    console.log = originalLog;
  }
  assert.ok(logs.some((line) => line.includes('Open VibeCoding standards: 通过')));
});

test('design starter turns a bundled template into a real page entry', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });

  const starter = await designStarterWorkspace(project, {
    starter: 'content-home',
    out: 'index.html',
  });
  assert.equal(starter.ok, true);
  assert.equal(starter.starterId, 'content-home');
  assert.equal(starter.relativeOutputPath, 'index.html');
  assert.deepEqual(starter.defaults, {
    lens: 'editorial-contrast',
    theme: 'warm-editorial',
    layout: 'story-map',
  });
  const indexHtml = await fs.readFile(path.join(project, 'index.html'), 'utf8');
  assert.ok(indexHtml.includes('starter-defaults: lens=editorial-contrast theme=warm-editorial layout=story-map'));

  const result = spawnSync(process.execPath, [
    path.resolve('bin/open-vibecoding.js'),
    'design-starter',
    project,
    '--starter',
    'ops-dashboard',
    '--out',
    'dashboard.html',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Open VibeCoding design starter: 已生成/);
  assert.match(result.stdout, /默认组合: lens=operational-density theme=tool-neutral layout=ops-density-grid/);
  assert.match(result.stdout, /只有确认当前页不依赖外部事实、品牌素材或真实图片时，才直接写清无依赖/);
  assert.match(result.stdout, /先不要急着加 `--no-real-images`/);
  assert.match(result.stdout, /禁止删除后重起/);
  assert.ok(await pathExists(path.join(project, 'dashboard.html')));

  const hydratedProject = await makeTempProject();
  await initWorkspace(hydratedProject, { templatePack: 'consumer' });

  const hydratedResult = spawnSync(process.execPath, [
    path.resolve('bin/open-vibecoding.js'),
    'design-starter',
    hydratedProject,
    '--starter',
    'content-home',
    '--out',
    'hydrated.html',
    '--title',
    'One Person Build',
    '--brief',
    '写给独立开发者的个人博客首页',
    '--sections',
    '精选文章|写作主题|关于作者|订阅入口',
    '--no-external-facts',
    '--no-brand-assets',
    '--no-real-images',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(hydratedResult.status, 0, hydratedResult.stderr);
  assert.match(hydratedResult.stdout, /active design contracts: 已同步写实/);
  assert.match(hydratedResult.stdout, /docs\/basic: 已同步写实/);
  assert.match(hydratedResult.stdout, /文件说明书: 已补到 hydrated\.html/);
  const hydratedHtml = await fs.readFile(path.join(hydratedProject, 'hydrated.html'), 'utf8');
  assert.ok(hydratedHtml.startsWith('<!--\n## 核心功能'));
  assert.ok(hydratedHtml.includes('One Person Build'));
  assert.ok(hydratedHtml.includes('必须在当前入口文件上继续补丁修改'));
  assert.equal(hydratedHtml.includes('长期写作首页'), false);
  assert.equal(hydratedHtml.includes('阅读精选文章'), false);
  assert.equal(hydratedHtml.includes('这一周我为什么先修产品边界，再补界面细节'), false);
  assert.equal(hydratedHtml.includes('[品牌名 / 首页主题]'), false);
  const factsSheet = await fs.readFile(path.join(hydratedProject, '.open-vibecoding', 'design', 'active', 'facts-sheet.md'), 'utf8');
  assert.ok(factsSheet.includes('写给独立开发者的个人博客首页'));
  assert.equal(factsSheet.includes('待填写'), false);
  const assetSpec = await fs.readFile(path.join(hydratedProject, '.open-vibecoding', 'design', 'active', 'asset-spec.md'), 'utf8');
  assert.ok(assetSpec.includes('动效节奏'));
  assert.ok(assetSpec.includes('构图记忆点'));
  assert.ok(assetSpec.includes('memory-point'));
  const directionPlan = await fs.readFile(path.join(hydratedProject, '.open-vibecoding', 'design', 'active', 'direction-plan.md'), 'utf8');
  assert.ok(directionPlan.includes('审美主张'));
  assert.ok(directionPlan.includes('记忆点'));
  assert.ok(directionPlan.includes('温暖编辑感'));
  const selectedDirection = await fs.readFile(path.join(hydratedProject, '.open-vibecoding', 'design', 'active', 'selected-direction.md'), 'utf8');
  assert.ok(selectedDirection.includes('aesthetic:'));
  assert.ok(selectedDirection.includes('memory-point:'));
  assert.ok(selectedDirection.includes('anti-slop'));
  const frontendGuidelines = await fs.readFile(path.join(hydratedProject, 'docs', 'basic', 'frontend-guidelines.md'), 'utf8');
  assert.equal(frontendGuidelines.includes('待补充'), false);
  assert.ok(frontendGuidelines.includes('审美主张'));
  assert.ok(frontendGuidelines.includes('anti-slop'));
  const rootReadmes = (await fs.readdir(hydratedProject)).filter((name) => name.endsWith('_README.md'));
  assert.ok(rootReadmes.length > 0);

  const guideProject = await makeTempProject();
  await initWorkspace(guideProject, { templatePack: 'consumer' });
  const blockedGuide = spawnSync(process.execPath, [
    path.resolve('bin/open-vibecoding.js'),
    'design-starter',
    guideProject,
    '--starter',
    'content-home',
    '--out',
    'guide.html',
    '--brief',
    '西双版纳雨林观鸟导览首页',
    '--sections',
    '今日路线|关键物种|装备准备|最佳时段|预约提醒|订阅入口',
    '--no-external-facts',
    '--no-brand-assets',
    '--no-real-images',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(blockedGuide.status, 1);
  assert.match(blockedGuide.stdout, /不建议带 `--no-real-images`/);
  assert.equal(await pathExists(path.join(guideProject, 'guide.html')), false);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('commons.wikimedia.org/w/api.php')) {
      return {
        ok: true,
        async json() {
          return {
            query: {
              pages: {
                1: {
                  title: 'File:Xishuangbanna rainforest canopy.jpg',
                  imageinfo: [{
                    thumburl: 'https://example.com/image-1.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Xishuangbanna_rainforest_canopy.jpg',
                    extmetadata: {
                      ImageDescription: { value: '西双版纳雨林 canopy' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }],
                },
                2: {
                  title: 'File:Birdwatching trail.jpg',
                  imageinfo: [{
                    thumburl: 'https://example.com/image-2.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Birdwatching_trail.jpg',
                    extmetadata: {
                      ImageDescription: { value: '观鸟栈道' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }],
                },
                3: {
                  title: 'File:Tropical bird.jpg',
                  imageinfo: [{
                    thumburl: 'https://example.com/image-3.jpg',
                    descriptionurl: 'https://commons.wikimedia.org/wiki/File:Tropical_bird.jpg',
                    extmetadata: {
                      ImageDescription: { value: '热带鸟类' },
                      LicenseShortName: { value: 'CC BY-SA 4.0' },
                    },
                  }],
                },
              },
            },
          };
        },
      };
    }
    return {
      ok: true,
      async arrayBuffer() {
        return new Uint8Array([255, 216, 255, 217]).buffer;
      },
      headers: {
        get(name) {
          return String(name).toLowerCase() === 'content-type' ? 'image/jpeg' : null;
        },
      },
    };
  };
  try {
    const guideResult = await designStarterWorkspace(guideProject, {
      starter: 'content-home',
      out: 'guide.html',
      brief: '西双版纳雨林观鸟导览首页',
      sections: '今日路线|关键物种|装备准备|最佳时段|预约提醒|订阅入口',
      noExternalFacts: true,
      noBrandAssets: true,
    });
    assert.equal(guideResult.ok, true);
    assert.equal(guideResult.fetchedImageCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const guideHtml = await fs.readFile(path.join(guideProject, 'guide.html'), 'utf8');
  assert.ok(guideHtml.includes('专题导览首页'));
  assert.ok(guideHtml.includes('今日路线'));
  assert.ok(guideHtml.includes('关键物种'));
  assert.ok(guideHtml.includes('装备准备'));
  assert.ok(guideHtml.includes('订阅后续更新'));
  assert.equal(guideHtml.includes('独立开发者写作首页'), false);
  assert.equal(guideHtml.includes('长期写作首页'), false);
  const guideImagePreflight = await fs.readFile(path.join(guideProject, '.open-vibecoding', 'design', 'active', 'image-preflight.md'), 'utf8');
  assert.ok(guideImagePreflight.includes('这一版已经按内容主题补齐首批真实图片'));
  const guideManifest = JSON.parse(
    await fs.readFile(path.join(guideProject, '.open-vibecoding', 'design', 'assets', 'fetched', 'content-home', 'manifest.json'), 'utf8')
  );
  assert.equal(guideManifest.assets.length, 3);

  const standardsResult = spawnSync(process.execPath, [
    path.resolve('bin/open-vibecoding.js'),
    'standards',
    hydratedProject,
    '--verify',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(standardsResult.status, 0, standardsResult.stderr);
  assert.match(standardsResult.stdout, /Open VibeCoding standards: 通过/);

  const dashboardProject = await makeTempProject();
  await initWorkspace(dashboardProject, { templatePack: 'consumer' });
  const dashboardHydratedResult = spawnSync(process.execPath, [
    path.resolve('bin/open-vibecoding.js'),
    'design-starter',
    dashboardProject,
    '--starter',
    'ops-dashboard',
    '--out',
    'index.html',
    '--title',
    '独立开发者内容发布工作台',
    '--brief',
    '为独立开发者提供安静、耐看、信息密度高的内容发布首页，帮助每天快速处理待发布事项、跟进草稿、查看订阅变化和选题推进。',
    '--sections',
    '今日待处理|草稿队列|本周指标|最近订阅变化|选题状态',
    '--no-external-facts',
    '--no-brand-assets',
    '--no-real-images',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.equal(dashboardHydratedResult.status, 0, dashboardHydratedResult.stderr);
  const dashboardHtml = await fs.readFile(path.join(dashboardProject, 'index.html'), 'utf8');
  assert.equal(dashboardHtml.includes('总览一'), false);
  assert.equal(dashboardHtml.includes('关键指标'), false);
  assert.ok(dashboardHtml.includes('最近订阅变化'));
  assert.ok(dashboardHtml.includes('选题状态'));
  assert.ok(dashboardHtml.includes('AI 协作复盘: 继续写'));
});

test('review relationship map stays compact with pill tags and left aligned copy', () => {
  const longProblem = '用户需要先看清核心问题，再决定是否进入实现，并且希望图里不要靠模板裁剪破坏语义';
  const reviewHtml = renderReviewArtifact({
    snapshot: {
      versionId: 'v0001',
      title: '关系图紧凑样例',
      sections: {
        problem: { problemStatement: longProblem },
        goals: { goals: ['让用户快速理解本次需求目标，并能判断是不是值得继续推进'] },
        scope: { inScope: ['只调整评审页图谱展示，不改变评审状态命令'] },
        scenarios: { primaryFlows: ['用户打开评审页并扫读关系图'] },
        risks: { risks: ['图谱信息太密会降低评审意愿'] },
      },
    },
  });
  assert.ok(reviewHtml.includes('需求关系图'));
  assert.ok(reviewHtml.includes('viewBox="0 0 960 336"'));
  assert.ok(reviewHtml.includes('review-map-tag-pill'));
  assert.ok(reviewHtml.includes('width="244" height="86"'));
  assert.ok(reviewHtml.includes('text-anchor="start"'));
  assert.equal(reviewHtml.includes('viewBox="0 0 960 480"'), false);
  const mindMapSvg = reviewHtml.match(/<svg viewBox="0 0 960 336"[\s\S]*?<\/svg>/)?.[0] ?? '';
  assert.ok(mindMapSvg.includes('review-map-center-group'));
  assert.ok(mindMapSvg.indexOf('review-map-link') < mindMapSvg.indexOf('review-map-node node-1'));
  assert.ok(mindMapSvg.indexOf('review-map-node node-4') < mindMapSvg.indexOf('review-map-center-group'));
  const reviewMapTags = Array.from(
    reviewHtml.matchAll(/<text class="review-map-tag[^"]*"[^>]*>([^<]*)<\/text>/g),
    ([, text]) => text
  );
  assert.ok(reviewMapTags.length > 0);
  assert.ok(reviewMapTags.every((text) => Array.from(text).length <= 15));
  const reviewMapLabels = Array.from(
    reviewHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.ok(reviewMapLabels.length > 0);
  assert.ok(reviewMapLabels.some((text) => Array.from(text).length > 30));
  const exportPayload = buildReviewExportPayload({
    versionId: 'v0001',
    title: '关系图紧凑样例',
    sections: {
      problem: { problemStatement: longProblem },
      goals: { goals: ['让用户快速理解本次需求目标，并能判断是不是值得继续推进'] },
      scope: { inScope: ['只调整评审页图谱展示，不改变评审状态命令'] },
      scenarios: { primaryFlows: ['用户打开评审页并扫读关系图'] },
      risks: { risks: ['图谱信息太密会降低评审意愿'] },
    },
  });
  assert.deepEqual(exportPayload.summaryStyle.preferredVerbs, USER_CHANGE_SUMMARY_GUIDE.preferredVerbs);
  assert.ok(exportPayload.presentationContract.rules.some((rule) => rule.id === 'review-map-card-text' && rule.maxChars === 30));
  assert.ok(exportPayload.presentationContract.rules.some((rule) => rule.id === 'review-panel-detail-format' && rule.format === '- **摘要内容**：明细一句话'));
  assert.ok(exportPayload.presentationFeedback.some((item) => item.ruleId === 'review-map-card-text' && item.currentChars > item.maxChars));
  assert.ok(exportPayload.presentationFeedback.some((item) => item.ruleId === 'review-panel-detail-format' && item.expectedFormat === '- **摘要内容**：明细一句话'));

  const flowHtml = renderReviewArtifact({
    snapshot: {
      versionId: 'v0002',
      title: '流程图紧凑样例',
      reviewPresentation: {
        diagram: { type: 'flow' },
        flowNodes: [
          { id: 'step1', text: '用户先扫关系图' },
          { id: 'step2', text: '确认流程覆盖' },
          { id: 'step3', text: '补充业务限制' },
        ],
        flowEdges: [
          { from: 'step1', to: 'step2' },
          { from: 'step2', to: 'step3' },
        ],
      },
      sections: {
        scenarios: {
          primaryFlows: [
            '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进',
            '用户确认主流程是否覆盖关键动作、异常情况和恢复路径',
            '用户判断是否需要补充业务限制、成本边界或开放问题',
          ],
        },
      },
    },
  });
  assert.ok(flowHtml.includes('需求流程图'));
  assert.ok(flowHtml.includes('review-map-arrow'));
  const flowMapLabels = Array.from(
    flowHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.ok(flowMapLabels.length > 0);
  assert.ok(flowMapLabels.every((text) => Array.from(text).length <= 30));
  const flowExportPayload = buildReviewExportPayload({
    versionId: 'v0002',
    title: '流程图紧凑样例',
    reviewPresentation: {
      diagram: { type: 'flow' },
      flowNodes: [
        { id: 'step1', text: '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进' },
        { id: 'step2', text: '确认流程覆盖' },
        { id: 'step3', text: '补充业务限制' },
      ],
    },
    sections: {
      scenarios: {
        primaryFlows: [
          '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进',
          '用户确认主流程是否覆盖关键动作、异常情况和恢复路径',
          '用户判断是否需要补充业务限制、成本边界或开放问题',
        ],
      },
    },
  });
  assert.ok(flowExportPayload.presentationFeedback.some((item) => item.area === '需求流程图' && item.ruleId === 'review-map-card-text'));

  const presentedSnapshot = {
    versionId: 'v0003',
    title: '展示文案样例',
    reviewPresentation: {
      mapNodes: {
        problem: { title: '问题定义', text: '分类位置影响查找' },
        goal: { title: '目标', text: '先搜索再选分类' },
        scope: { title: '范围', text: '只调整评审展示' },
        flow: { title: '流程', text: '打开页面后扫关系图' },
        risk: { title: '风险', text: '超限时反馈重写' },
      },
    },
    sections: {
      problem: { problemStatement: longProblem },
      goals: { goals: ['让用户快速理解本次需求目标，并能判断是不是值得继续推进'] },
      scope: { inScope: ['只调整评审页图谱展示，不改变评审状态命令'] },
      scenarios: { primaryFlows: ['用户打开评审页并扫读关系图'] },
      risks: { risks: ['图谱信息太密会降低评审意愿'] },
    },
  };
  const presentedHtml = renderReviewArtifact({ snapshot: presentedSnapshot });
  const presentedSvg = presentedHtml.match(/<svg viewBox="0 0 960 336"[\s\S]*?<\/svg>/)?.[0] ?? '';
  const presentedMapLabels = Array.from(
    presentedSvg.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.equal(presentedMapLabels.length, 5);
  assert.ok(presentedMapLabels.every((text) => Array.from(text).length <= 30));
  const presentedExportPayload = buildReviewExportPayload(presentedSnapshot);
  assert.equal(
    presentedExportPayload.presentationFeedback.some((item) => item.ruleId === 'review-map-card-text'),
    false
  );

  const presentedFlowSnapshot = {
    versionId: 'v0004',
    title: '流程展示文案样例',
    reviewPresentation: {
      diagram: { type: 'flow' },
      flowNodes: [
        { id: 'step1', text: '打开评审页先扫图' },
        { id: 'step2', text: '确认主流程覆盖' },
        { id: 'step3', text: '补充风险和边界' },
      ],
      flowEdges: [
        { from: 'step1', to: 'step2' },
        { from: 'step2', to: 'step3' },
      ],
    },
    sections: {
      scenarios: {
        primaryFlows: [
          '用户打开评审页面后先扫读当前需求关系图和核心卡片内容并判断是否继续推进',
          '用户确认主流程是否覆盖关键动作、异常情况和恢复路径',
          '用户判断是否需要补充业务限制、成本边界或开放问题',
        ],
      },
    },
  };
  const presentedFlowHtml = renderReviewArtifact({ snapshot: presentedFlowSnapshot });
  const presentedFlowLabels = Array.from(
    presentedFlowHtml.matchAll(/<text class="review-map-label[^"]*"[^>]*>([\s\S]*?)<\/text>/g),
    ([, text]) => text.replace(/<[^>]+>/g, '')
  );
  assert.equal(presentedFlowLabels.length, 3);
  assert.ok(presentedFlowLabels.every((text) => Array.from(text).length <= 30));
  const presentedFlowExportPayload = buildReviewExportPayload(presentedFlowSnapshot);
  assert.equal(
    presentedFlowExportPayload.presentationFeedback.some((item) => item.area === '需求流程图' && item.ruleId === 'review-map-card-text'),
    false
  );

  const defaultMapSnapshot = {
    versionId: 'v0005',
    title: '默认关系图样例',
    reviewPresentation: {
      mapNodes: {
        problem: { title: '问题定义', text: '确认核心问题' },
        goal: { title: '目标', text: '确认目标结果' },
        scope: { title: '范围', text: '确认交付边界' },
        flow: { title: '流程', text: '确认关键路径' },
        risk: { title: '风险', text: '确认主要风险' },
      },
    },
    sections: {
      scenarios: {
        primaryFlows: [
          '第一条不一定是流程箭头',
          '第二条也可能只是要点',
          '第三条仍然作为关系图信息',
        ],
      },
    },
  };
  const defaultMapHtml = renderReviewArtifact({ snapshot: defaultMapSnapshot });
  assert.ok(defaultMapHtml.includes('需求关系图'));
  assert.equal(/<path class="review-map-arrow"/u.test(defaultMapHtml), false);
});

test('review artifact shows project version badge only when current project version exists', () => {
  const snapshot = {
    versionId: 'v0006',
    title: '项目版本展示样例',
    sections: {
      problem: { problemStatement: '需要把项目版本放到评审页顶部。' },
    },
  };

  const noVersionHtml = renderReviewArtifact({ snapshot });
  assert.equal(noVersionHtml.includes('aria-label="项目版本"'), false);

  const withVersionHtml = renderReviewArtifact({
    snapshot,
    projectRelease: {
      currentVersion: '0.1.23',
      currentStatus: 'current',
      itemCount: 3,
    },
  });
  assert.ok(withVersionHtml.includes('aria-label="项目版本"'));
  assert.ok(withVersionHtml.includes('项目版本'));
  assert.ok(withVersionHtml.includes('0.1.23'));
  assert.ok(withVersionHtml.includes('3 条变化'));
});
