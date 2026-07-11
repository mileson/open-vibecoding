import path from 'node:path';
import { readJson, writeJson } from './fs-utils.js';
import { upsertSessionRegistryEntry } from './session-registry.js';
import { timestamp } from './time.js';

const OPENPRD_HARNESS_DIR = path.join('.openprd', 'harness');
const OPENPRD_HARNESS_REQUIREMENT_GATE = path.join(OPENPRD_HARNESS_DIR, 'requirement-gate.json');
const OPENPRD_HARNESS_SESSION_BINDINGS_DIR = path.join(OPENPRD_HARNESS_DIR, 'session-bindings');
const OPENPRD_STATE_CURRENT = path.join('.openprd', 'state', 'current.json');

let sessionBindingWriteEnabled = true;

function setSessionBindingWriteEnabled(enabled) {
  sessionBindingWriteEnabled = enabled;
}

function isSessionBindingWriteEnabled() {
  return sessionBindingWriteEnabled;
}

function normalizeSessionId(sessionId) {
  const text = String(sessionId ?? '').trim();
  return text || null;
}

function sessionBindingPath(projectRoot, sessionId) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) {
    return null;
  }
  return path.join(
    projectRoot,
    OPENPRD_HARNESS_SESSION_BINDINGS_DIR,
    `${normalized.replace(/[^A-Za-z0-9._-]/g, '_')}.json`,
  );
}

async function readLegacyRequirementGate(projectRoot) {
  return readJson(path.join(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATE)).catch(() => null);
}

async function readWorkspaceCurrentState(projectRoot) {
  return readJson(path.join(projectRoot, OPENPRD_STATE_CURRENT)).catch(() => null);
}

async function resolveBindingSessionId(projectRoot, options = {}, legacyGate = null) {
  const workspaceCurrentState = await readWorkspaceCurrentState(projectRoot);
  return normalizeSessionId(
    options.sessionId
      ?? options.currentSessionId
      ?? workspaceCurrentState?.laneSessionId
      ?? legacyGate?.sessionId
  );
}

async function readSessionBinding(projectRoot, sessionId) {
  const filePath = sessionBindingPath(projectRoot, sessionId);
  if (!filePath) {
    return null;
  }
  const binding = await readJson(filePath).catch(() => null);
  return binding ? { ...binding, path: filePath } : null;
}

async function upsertSessionBinding(projectRoot, sessionId, patch = {}) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) {
    return null;
  }
  if (!sessionBindingWriteEnabled) {
    return { sessionId: normalized, path: null, skipped: true, reason: 'session-binding-write-disabled' };
  }
  const filePath = sessionBindingPath(projectRoot, normalized);
  const previous = await readJson(filePath).catch(() => null);
  const next = {
    ...(previous ?? {}),
    version: 1,
    sessionId: normalized,
    ...patch,
    createdAt: previous?.createdAt ?? patch.createdAt ?? timestamp(),
    updatedAt: patch.updatedAt ?? timestamp(),
  };
  await writeJson(filePath, next);
  await upsertSessionRegistryEntry(projectRoot, normalized, {
    laneKind: patch.laneKind ?? previous?.laneKind ?? 'requirement',
    tool: patch.tool ?? previous?.tool ?? 'codex',
    threadId: patch.threadId ?? previous?.threadId ?? null,
    changeId: patch.changeId ?? next.changeId ?? null,
    taskHandle: patch.taskHandle ?? next.taskHandle ?? null,
    workUnitId: patch.workUnitId ?? next.workUnitId ?? null,
    versionId: patch.versionId ?? next.versionId ?? null,
    digest: patch.digest ?? next.digest ?? null,
    title: patch.title ?? next.title ?? null,
    targetRoot: patch.targetRoot ?? next.targetRoot ?? null,
    promptPreview: patch.promptPreview ?? next.promptPreview ?? null,
    reviewStatus: patch.reviewStatus ?? next.reviewStatus ?? null,
    gateStatus: patch.gateStatus ?? next.gateStatus ?? null,
    gateActive: patch.gateActive ?? next.gateActive ?? false,
    bindingPath: filePath,
    statePath: path.join(projectRoot, '.openprd', 'harness', 'session-states', `${normalized.replace(/[^A-Za-z0-9._-]/g, '_')}.json`),
    updatedAt: next.updatedAt,
  });
  return {
    ...next,
    path: filePath,
  };
}

async function syncSessionBindingFromSnapshot(projectRoot, snapshot, options = {}) {
  const legacyGate = await readLegacyRequirementGate(projectRoot);
  const sessionId = await resolveBindingSessionId(projectRoot, options, legacyGate);
  if (!sessionId || !snapshot?.versionId) {
    return null;
  }
  return upsertSessionBinding(projectRoot, sessionId, {
    promptPreview: options.promptPreview ?? legacyGate?.promptPreview ?? null,
    gateStatus: legacyGate?.status ?? null,
    gateActive: Boolean(legacyGate?.active),
    title: snapshot.title ?? null,
    versionId: snapshot.versionId,
    digest: snapshot.digest ?? null,
    workUnitId: snapshot.workUnitId ?? null,
    targetRoot: options.targetRoot ?? snapshot.targetRoot ?? null,
    reviewStatus: options.reviewStatus ?? 'pending-confirmation',
    reviewPath: options.reviewPath ?? options.stableReviewArtifact ?? null,
    activeReviewPath: options.activeReviewPath ?? options.reviewArtifact ?? null,
    reviewArtifact: options.reviewArtifact ?? options.activeReviewPath ?? null,
    stableReviewArtifact: options.stableReviewArtifact ?? options.reviewPath ?? null,
    changeId: options.preserveChangeId ? (options.changeId ?? null) : null,
  });
}

async function syncSessionBindingFromReview(projectRoot, snapshot, options = {}) {
  const legacyGate = await readLegacyRequirementGate(projectRoot);
  const sessionId = await resolveBindingSessionId(projectRoot, options, legacyGate);
  if (!sessionId || !snapshot?.versionId) {
    return null;
  }
  return upsertSessionBinding(projectRoot, sessionId, {
    promptPreview: options.promptPreview ?? legacyGate?.promptPreview ?? null,
    gateStatus: legacyGate?.status ?? null,
    gateActive: Boolean(legacyGate?.active),
    title: snapshot.title ?? null,
    versionId: snapshot.versionId,
    digest: snapshot.digest ?? null,
    workUnitId: snapshot.workUnitId ?? null,
    targetRoot: options.targetRoot ?? snapshot.targetRoot ?? null,
    reviewStatus: options.reviewStatus ?? null,
    reviewPath: options.reviewPath ?? options.stableReviewArtifact ?? null,
    activeReviewPath: options.activeReviewPath ?? options.reviewArtifact ?? null,
    reviewArtifact: options.reviewArtifact ?? options.activeReviewPath ?? null,
    stableReviewArtifact: options.stableReviewArtifact ?? options.reviewPath ?? null,
  });
}

async function syncSessionBindingFromChange(projectRoot, changeId, options = {}) {
  const legacyGate = await readLegacyRequirementGate(projectRoot);
  const sessionId = await resolveBindingSessionId(projectRoot, options, legacyGate);
  if (!sessionId || !changeId) {
    return null;
  }
  return upsertSessionBinding(projectRoot, sessionId, {
    promptPreview: options.promptPreview ?? legacyGate?.promptPreview ?? null,
    gateStatus: legacyGate?.status ?? null,
    gateActive: Boolean(legacyGate?.active),
    title: options.title ?? null,
    versionId: options.versionId ?? null,
    digest: options.digest ?? null,
    workUnitId: options.workUnitId ?? null,
    targetRoot: options.targetRoot ?? null,
    reviewStatus: options.reviewStatus ?? null,
    reviewPath: options.reviewPath ?? options.stableReviewArtifact ?? null,
    activeReviewPath: options.activeReviewPath ?? options.reviewArtifact ?? null,
    reviewArtifact: options.reviewArtifact ?? options.activeReviewPath ?? null,
    stableReviewArtifact: options.stableReviewArtifact ?? options.reviewPath ?? null,
    changeId,
  });
}

export {
  isSessionBindingWriteEnabled,
  readLegacyRequirementGate,
  readSessionBinding,
  sessionBindingPath,
  setSessionBindingWriteEnabled,
  syncSessionBindingFromChange,
  syncSessionBindingFromReview,
  syncSessionBindingFromSnapshot,
  upsertSessionBinding,
};
