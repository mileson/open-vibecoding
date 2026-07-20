/*
 * OpenPrd run verification and hook evidence recording.
 *
 * Agent context selection and injection deliberately live outside OpenPrd. The
 * run command only verifies repository state or records hook evidence.
 */
import fs from 'node:fs/promises';
import { detectRuntime } from './adapters/index.js';
import { appendJsonl, appendText, cjoin, exists, readJson, writeJson, writeText } from './fs-utils.js';
import {
  OPENPRD_HARNESS_TURN_STATE,
  recordKnowledgeReviewSignal,
  reviewKnowledgeWorkspace,
} from './knowledge.js';
import { timestamp } from './time.js';

const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_RUN_STATE = cjoin(OPENPRD_HARNESS_DIR, 'run-state.json');
const OPENPRD_HARNESS_ITERATIONS = cjoin(OPENPRD_HARNESS_DIR, 'iterations.jsonl');
const OPENPRD_HARNESS_LEARNINGS = cjoin(OPENPRD_HARNESS_DIR, 'learnings.md');
const OPENPRD_HARNESS_INSTALL_MANIFEST = cjoin(OPENPRD_HARNESS_DIR, 'install-manifest.json');
const OPENPRD_HARNESS_HOOK_STATE = cjoin(OPENPRD_HARNESS_DIR, 'hook-state.json');
const OPENPRD_HARNESS_RUNTIME_ENVIRONMENT = cjoin(OPENPRD_HARNESS_DIR, 'runtime-environment.json');

function harnessFile(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

async function ensureRunHarness(projectRoot) {
  await fs.mkdir(harnessFile(projectRoot, OPENPRD_HARNESS_DIR), { recursive: true });
  const statePath = harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE);
  if (!(await exists(statePath))) {
    await writeJson(statePath, {
      version: 1,
      active: true,
      currentIteration: 0,
      lastHookAt: null,
      lastOutcome: null,
      lastRecommendation: null,
    });
  }
  const iterationsPath = harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS);
  if (!(await exists(iterationsPath))) await writeText(iterationsPath, '');
  const learningsPath = harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS);
  if (!(await exists(learningsPath))) {
    await writeText(learningsPath, '# OpenPrd Harness Learnings\n\nReusable patterns discovered during hook-driven runs belong here.\n');
  }
}

function normalizeAdapterClient(value) {
  const client = String(value ?? '').trim().toLowerCase();
  if (client === 'claude-code') return 'claude';
  return ['codex', 'claude', 'cursor'].includes(client) ? client : null;
}

function runtimeEvidenceCandidate(value, source) {
  const client = normalizeAdapterClient(value?.activeClient ?? value?.client ?? value?.agentType);
  if (!client) return null;
  return {
    source,
    client,
    surface: value?.surface ?? 'unknown',
    executionMode: value?.executionMode ?? 'interactive',
    sessionId: value?.sessionId ?? null,
    threadId: value?.threadId ?? null,
    observedCapabilities: Array.isArray(value?.observedCapabilities) ? value.observedCapabilities : [],
    confidence: Number.isFinite(value?.confidence) ? value.confidence : null,
    turnId: value?.turnId ?? null,
    agentType: value?.agentType ?? null,
    model: value?.model ?? null,
  };
}

async function readRuntimeEnvironment(projectRoot) {
  const [runtimeEnvironment, installManifest, hookState] = await Promise.all([
    readJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUNTIME_ENVIRONMENT)).catch(() => null),
    readJson(harnessFile(projectRoot, OPENPRD_HARNESS_INSTALL_MANIFEST)).catch(() => null),
    readJson(harnessFile(projectRoot, OPENPRD_HARNESS_HOOK_STATE)).catch(() => null),
  ]);
  const candidates = [
    runtimeEvidenceCandidate(hookState?.runtimeEnvironment, 'hook-payload'),
    runtimeEvidenceCandidate(runtimeEnvironment?.active, 'session-binding'),
  ].filter(Boolean);
  const detected = detectRuntime(candidates);
  return {
    active: detected,
    runtimeDetection: installManifest?.runtimeDetection ?? runtimeEnvironment?.runtimeDetection ?? null,
    platformCapabilityPacks: installManifest?.platformCapabilityPacks ?? runtimeEnvironment?.platformCapabilityPacks ?? [],
  };
}

async function readRunState(projectRoot) {
  await ensureRunHarness(projectRoot);
  return readJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE)).catch(() => ({
    version: 1,
    active: true,
    currentIteration: 0,
  }));
}

async function writeRunState(projectRoot, state) {
  await writeJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE), state);
}

function summarizeWorkspaceAttention(quality) {
  const report = quality?.report ?? null;
  const attentionGates = Array.isArray(report?.readiness?.attentionGates)
    ? report.readiness.attentionGates.filter(Boolean)
    : [];
  const activeTasks = report?.evalHarness?.featureCoverage?.activeTasks ?? null;
  if (attentionGates.length === 1 && attentionGates[0] === 'feature-coverage' && activeTasks?.pending > 0) {
    const activeChange = activeTasks.activeChange ?? null;
    const total = Number(activeTasks.total ?? 0);
    const done = Number(activeTasks.done ?? 0);
    const pending = Number(activeTasks.pending ?? 0);
    const blocked = Number(activeTasks.blocked ?? 0);
    const progress = total > 0 ? `${done}/${total}` : `${done}`;
    const changeLabel = activeChange ? `active change ${activeChange}` : 'the active task ledger';
    return {
      kind: 'feature-coverage-ledger',
      gate: 'feature-coverage',
      gates: attentionGates,
      activeChange,
      total,
      done,
      pending,
      blocked,
      summary: 'feature-coverage ledger remains open',
      detail: `${changeLabel} still has ${pending} pending tasks (${progress} done)${blocked > 0 ? `, with ${blocked} blocked` : ''}. This usually means task bookkeeping or coverage evidence is incomplete, not that the current implementation failed.`,
    };
  }
  if (attentionGates.length > 0) {
    return {
      kind: 'quality-gates',
      gates: attentionGates,
      summary: `quality attention gates: ${attentionGates.join(', ')}`,
      detail: `Current task verification passed, but workspace-level quality still needs evidence for: ${attentionGates.join(', ')}.`,
    };
  }
  if (report?.readiness?.productionReady === false) {
    return {
      kind: 'quality-readiness',
      gates: [],
      summary: 'quality report is not production-ready',
      detail: 'Current task verification passed, but the workspace-level quality report still needs attention before overall readiness can be claimed.',
    };
  }
  return null;
}

function buildVerificationRecommendation({ changeId, readiness, workspaceAttention, knowledgeReview, qualityCheck }) {
  const verification = {
    ...readiness,
    workspaceAttention,
    knowledgeCandidateId: knowledgeReview?.candidateId ?? null,
    qualityReportPath: qualityCheck?.reportPath ?? null,
  };
  if (!readiness.taskReady) {
    return {
      type: 'verification-fix',
      title: '先修复当前验证失败项',
      command: 'openprd run . --verify',
      verifyCommand: 'openprd run . --verify',
      reason: '最近一次 run verify 没有通过当前任务级验证。',
      changeId,
      verification,
    };
  }
  if (readiness.workspaceReady) {
    return {
      type: 'verification-ready',
      title: '当前项目已完成并通过验证',
      command: 'openprd run . --verify',
      verifyCommand: 'openprd run . --verify',
      reason: '当前任务和工作区验证都已闭环。',
      changeId,
      verification,
    };
  }
  return {
    type: 'verification-workspace-attention',
    title: '当前任务已完成，工作区还有待处理项',
    command: 'openprd run . --verify',
    verifyCommand: 'openprd run . --verify',
    reason: workspaceAttention?.detail ?? '当前任务验证通过，但工作区级别还有待补证据或待收口项。',
    changeId,
    verification,
  };
}

async function recordRunHook(projectRoot, options = {}) {
  const state = await readRunState(projectRoot);
  const runtimeEnvironment = await readRuntimeEnvironment(projectRoot);
  const event = {
    version: 1,
    at: timestamp(),
    iteration: Number(state.currentIteration ?? 0) + 1,
    type: 'hook',
    eventName: options.event ?? 'Unknown',
    risk: options.risk ?? 'unknown',
    outcome: options.outcome ?? 'unknown',
    preview: options.preview ?? null,
    runtimeEnvironment: runtimeEnvironment.active,
  };
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), event);
  await writeRunState(projectRoot, {
    ...state,
    currentIteration: event.iteration,
    lastHookAt: event.at,
    lastOutcome: event.outcome,
  });
  if (options.learn) {
    await appendText(harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS), `\n## ${event.at}\n\n- ${options.learn}\n`);
  }
  return {
    ok: true,
    action: 'run-record-hook',
    projectRoot,
    event,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };
}

async function verifyRunWorkspace(projectRoot, dependencies) {
  const {
    checkStandardsWorkspace,
    listOpenPrdChangesWorkspace,
    resumeOpenSpecDiscoveryWorkspace,
    validateOpenSpecChangeWorkspace,
    validateWorkspace,
    verifyOpenSpecDiscoveryWorkspace,
    verifyQualityWorkspace,
  } = dependencies;
  await ensureRunHarness(projectRoot);
  const [standards, validation, changes, discoveryState] = await Promise.all([
    checkStandardsWorkspace(projectRoot),
    validateWorkspace(projectRoot).then(({ report }) => report),
    listOpenPrdChangesWorkspace(projectRoot).catch(() => null),
    resumeOpenSpecDiscoveryWorkspace(projectRoot).catch(() => null),
  ]);
  const checks = [
    { name: 'standards', scope: 'workspace', ok: standards.ok, errors: standards.errors ?? [] },
    {
      name: 'validate',
      scope: 'workspace',
      ok: validation.structuralValid ?? validation.valid,
      errors: validation.structuralErrors ?? validation.errors ?? [],
    },
  ];
  if (verifyQualityWorkspace) {
    const quality = await verifyQualityWorkspace(projectRoot, { strict: false }).catch((error) => ({
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }));
    const productionReady = quality.report?.readiness?.productionReady ?? null;
    const workspaceAttention = summarizeWorkspaceAttention(quality);
    checks.push({
      name: 'quality',
      scope: 'workspace',
      ok: quality.ok && productionReady === true,
      errors: [
        ...(quality.errors ?? []),
        ...(productionReady === false
          ? [workspaceAttention?.detail ?? 'Quality report is not production-ready.']
          : []),
      ],
      reportPath: quality.reportPath ?? null,
      htmlPath: quality.htmlPath ?? null,
      productionReady,
      attentionGates: quality.report?.readiness?.attentionGates ?? [],
      workspaceAttention,
    });
  }
  const changeToVerify = changes?.activeChange ?? null;
  if (changeToVerify) {
    const change = await validateOpenSpecChangeWorkspace(projectRoot, { change: changeToVerify });
    const standardsErrors = new Set(change.standards?.errors ?? []);
    const taskErrors = (change.errors ?? []).filter((error) => !standardsErrors.has(error));
    const workspaceOnly = !change.ok && taskErrors.length === 0 && standardsErrors.size > 0;
    checks.push({
      name: 'change',
      scope: 'task',
      ok: change.ok || workspaceOnly,
      errors: taskErrors,
      workspaceAttention: workspaceOnly ? 'standards' : null,
    });
  }
  const discoveryToVerify = discoveryState && discoveryState.control?.mode !== 'reference';
  if (discoveryToVerify) {
    const discovery = await verifyOpenSpecDiscoveryWorkspace(projectRoot);
    const standardsErrors = new Set([
      ...(discovery.standards?.errors ?? []),
      ...(discovery.openSpecChange?.standards?.errors ?? []),
    ]);
    const taskErrors = (discovery.verification?.errors ?? []).filter((error) => !standardsErrors.has(error));
    const workspaceOnly = !discovery.ok && taskErrors.length === 0 && standardsErrors.size > 0;
    checks.push({
      name: 'discovery',
      scope: 'task',
      ok: discovery.ok || workspaceOnly,
      errors: taskErrors,
      workspaceAttention: workspaceOnly ? 'standards' : null,
    });
  }
  const taskChecks = checks.filter((check) => check.scope !== 'workspace');
  const taskReady = taskChecks.every((check) => check.ok);
  const workspaceReady = checks.every((check) => check.ok);
  const qualityCheck = checks.find((check) => check.name === 'quality');
  const failedWorkspaceChecks = checks.filter((check) => check.scope === 'workspace' && !check.ok);
  const workspaceAttention = taskReady && !workspaceReady
    ? (failedWorkspaceChecks.length === 1 && failedWorkspaceChecks[0].name === 'quality' && qualityCheck?.workspaceAttention
      ? qualityCheck.workspaceAttention
      : {
          kind: 'workspace-checks',
          checks: failedWorkspaceChecks.map((check) => check.name),
          summary: `workspace attention: ${failedWorkspaceChecks.map((check) => check.name).join(', ')}`,
          detail: `Current task verification passed. Workspace-wide checks still need attention: ${failedWorkspaceChecks.map((check) => check.name).join(', ')}.`,
        })
    : null;
  const readiness = {
    taskReady,
    workspaceReady,
    claimReady: workspaceReady,
    actionReady: taskReady,
    workspaceClaimReady: workspaceReady,
    releaseReady: null,
    actionScope: 'current-task-verification',
    doctorReady: null,
    qualityProductionReady: qualityCheck?.productionReady ?? null,
  };
  const knowledgeSignal = {
    kind: 'run-verify',
    ok: workspaceReady,
    taskReady,
    workspaceReady,
    claimReady: workspaceReady,
    actionReady: taskReady,
    productionReady: qualityCheck?.productionReady ?? null,
    attentionGates: qualityCheck?.attentionGates ?? [],
    workspaceAttentionKind: workspaceAttention?.kind ?? null,
    summary: taskReady
      ? (workspaceReady ? 'run verify passed' : `run verify task-ready with workspace attention: ${workspaceAttention?.summary ?? 'workspace checks'}`)
      : `run verify failed: ${taskChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}`,
  };
  await recordKnowledgeReviewSignal(projectRoot, knowledgeSignal).catch(() => null);
  const reviewSource = (await exists(harnessFile(projectRoot, OPENPRD_HARNESS_TURN_STATE)))
    ? OPENPRD_HARNESS_TURN_STATE
    : (qualityCheck?.reportPath ?? null);
  const knowledgeReview = await reviewKnowledgeWorkspace(projectRoot, {
    from: reviewSource,
    signal: knowledgeSignal,
  }).catch((error) => ({
    ok: false,
    action: 'quality-knowledge-review',
    skipped: false,
    errors: [error instanceof Error ? error.message : String(error)],
  }));
  const recommendation = buildVerificationRecommendation({
    changeId: changeToVerify,
    readiness,
    workspaceAttention,
    knowledgeReview,
    qualityCheck,
  });
  const runState = await readRunState(projectRoot);
  await writeRunState(projectRoot, {
    ...runState,
    lastVerificationAt: timestamp(),
    lastVerification: {
      ...readiness,
      changeId: changeToVerify,
      discoveryRunId: discoveryToVerify ? discoveryState.runId : null,
      workspaceAttention,
      knowledgeCandidateId: knowledgeReview?.candidateId ?? null,
      qualityReportPath: qualityCheck?.reportPath ?? null,
    },
    lastRecommendation: recommendation,
  });
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), {
    version: 1,
    at: timestamp(),
    type: 'verify',
    ok: taskReady,
    readiness,
    checks: checks.map((check) => ({ name: check.name, scope: check.scope, ok: check.ok, errors: check.errors.length })),
  });
  return {
    ok: taskReady,
    action: 'run-verify',
    projectRoot,
    scope: {
      changeId: changeToVerify,
      discoveryRunId: discoveryToVerify ? discoveryState.runId : null,
    },
    checks,
    readiness,
    workspaceAttention,
    warnings: checks
      .filter((check) => check.scope === 'workspace' && !check.ok)
      .flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`)),
    knowledgeReview,
    recommendation,
    errors: taskChecks.flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`)),
  };
}

async function runWorkspaceImpl(projectRoot, options = {}, dependencies = {}) {
  if (options.recordHook) return recordRunHook(projectRoot, options);
  if (options.verify) return verifyRunWorkspace(projectRoot, dependencies);
  return {
    ok: false,
    action: 'run-unsupported',
    projectRoot,
    errors: ['OpenPrd 不再管理 Agent 上下文。请使用 openprd run . --verify，或由 hooks 使用 --record-hook 记录证据。'],
  };
}

function createRunWorkspace(dependencies) {
  return function runWorkspace(projectRoot, options = {}) {
    return runWorkspaceImpl(projectRoot, options, dependencies);
  };
}

export { createRunWorkspace };
