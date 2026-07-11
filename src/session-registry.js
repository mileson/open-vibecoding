import fs from 'node:fs/promises';
import path from 'node:path';
import { appendJsonl, cjoin, exists, readJsonl } from './fs-utils.js';
import { atomicWriteText, withFileLock } from './kernel/atomic-store.js';
import { timestamp } from './time.js';
import { resolveOpenPrdHome } from './workspace-registry.js';

const OPENPRD_SESSION_REGISTRY = cjoin('registry', 'sessions.jsonl');

let registryWriteEnabled = true;

function setRegistryWriteEnabled(enabled) {
  registryWriteEnabled = enabled;
}

function normalizeSessionId(sessionId) {
  const text = String(sessionId ?? '').trim();
  return text || null;
}

function sessionRegistryFilePath(options = {}) {
  return cjoin(resolveOpenPrdHome(options), OPENPRD_SESSION_REGISTRY);
}

function normalizeSessionRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  const sessionId = normalizeSessionId(entry.sessionId);
  const workspaceRoot = entry.workspaceRoot ? path.resolve(String(entry.workspaceRoot)) : null;
  if (!sessionId || !workspaceRoot) {
    return null;
  }
  const realpath = entry.realpath ? path.resolve(String(entry.realpath)) : workspaceRoot;
  const lastUpdatedAt = entry.lastUpdatedAt ?? entry.updatedAt ?? entry.recordedAt ?? null;
  const firstRegisteredAt = entry.firstRegisteredAt ?? entry.recordedAt ?? lastUpdatedAt;
  return {
    version: 1,
    sessionId,
    workspaceRoot,
    realpath,
    laneKind: entry.laneKind ? String(entry.laneKind) : 'requirement',
    tool: entry.tool ? String(entry.tool) : null,
    threadId: entry.threadId ? String(entry.threadId) : null,
    changeId: entry.changeId ? String(entry.changeId) : null,
    taskHandle: entry.taskHandle ? String(entry.taskHandle) : null,
    workUnitId: entry.workUnitId ? String(entry.workUnitId) : null,
    versionId: entry.versionId ? String(entry.versionId) : null,
    digest: entry.digest ? String(entry.digest) : null,
    title: entry.title ? String(entry.title) : null,
    targetRoot: entry.targetRoot ? path.resolve(String(entry.targetRoot)) : null,
    promptPreview: entry.promptPreview ? String(entry.promptPreview) : null,
    reviewStatus: entry.reviewStatus ? String(entry.reviewStatus) : null,
    gateStatus: entry.gateStatus ? String(entry.gateStatus) : null,
    gateActive: entry.gateActive === true,
    statePath: entry.statePath ? path.resolve(String(entry.statePath)) : null,
    bindingPath: entry.bindingPath ? path.resolve(String(entry.bindingPath)) : null,
    firstRegisteredAt,
    lastRegisteredAt: entry.lastRegisteredAt ?? entry.recordedAt ?? lastUpdatedAt,
    lastUpdatedAt,
  };
}

async function readSessionRegistry(options = {}) {
  const home = resolveOpenPrdHome(options);
  const registryPath = sessionRegistryFilePath({ openprdHome: home });
  const events = await readJsonl(registryPath).catch(() => []);
  const currentBySession = new Map();
  for (const event of events) {
    const entry = normalizeSessionRegistryEntry(event);
    if (!entry) {
      continue;
    }
    currentBySession.set(entry.sessionId, entry);
  }
  const entries = Array.from(currentBySession.values())
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const staleEntries = [];
  for (const entry of entries) {
    const workspaceExists = await exists(entry.workspaceRoot);
    if (!workspaceExists) {
      staleEntries.push({
        ...entry,
        reason: 'missing-workspace',
      });
      continue;
    }
    const markerExists = await exists(cjoin(entry.workspaceRoot, '.openprd'));
    if (!markerExists) {
      staleEntries.push({
        ...entry,
        reason: 'missing-openprd-marker',
      });
      continue;
    }
    if (entry.bindingPath && !(await exists(entry.bindingPath))) {
      staleEntries.push({
        ...entry,
        reason: 'missing-binding',
      });
      continue;
    }
    if (entry.statePath && !(await exists(entry.statePath))) {
      staleEntries.push({
        ...entry,
        reason: 'missing-state',
      });
    }
  }
  return {
    home,
    registryPath,
    totalEvents: events.length,
    entries,
    staleEntries,
  };
}

async function readSessionRegistryEntry(sessionId, options = {}) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) {
    return null;
  }
  const registry = await readSessionRegistry(options);
  return registry.entries.find((entry) => entry.sessionId === normalized) ?? null;
}

async function upsertSessionRegistryEntry(projectRoot, sessionId, patch = {}, options = {}) {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) {
    return null;
  }
  if (!registryWriteEnabled) {
    return { home: null, registryPath: null, entry: { sessionId: normalized }, status: 'skipped', reason: 'registry-write-disabled' };
  }
  const registry = await readSessionRegistry(options);
  const workspaceRoot = path.resolve(projectRoot);
  const realpath = await fs.realpath(workspaceRoot).catch(() => workspaceRoot);
  const existing = registry.entries.find((entry) => entry.sessionId === normalized) ?? null;
  const recordedAt = options.recordedAt ?? timestamp();
  const entry = normalizeSessionRegistryEntry({
    ...existing,
    sessionId: normalized,
    workspaceRoot,
    realpath,
    laneKind: patch.laneKind ?? existing?.laneKind ?? 'requirement',
    tool: patch.tool ?? existing?.tool ?? null,
    threadId: patch.threadId ?? existing?.threadId ?? null,
    changeId: patch.changeId ?? existing?.changeId ?? null,
    taskHandle: patch.taskHandle ?? existing?.taskHandle ?? null,
    workUnitId: patch.workUnitId ?? existing?.workUnitId ?? null,
    versionId: patch.versionId ?? existing?.versionId ?? null,
    digest: patch.digest ?? existing?.digest ?? null,
    title: patch.title ?? existing?.title ?? null,
    targetRoot: patch.targetRoot ?? existing?.targetRoot ?? null,
    promptPreview: patch.promptPreview ?? existing?.promptPreview ?? null,
    reviewStatus: patch.reviewStatus ?? existing?.reviewStatus ?? null,
    gateStatus: patch.gateStatus ?? existing?.gateStatus ?? null,
    gateActive: patch.gateActive ?? existing?.gateActive ?? false,
    statePath: patch.statePath ?? existing?.statePath ?? null,
    bindingPath: patch.bindingPath ?? existing?.bindingPath ?? null,
    firstRegisteredAt: existing?.firstRegisteredAt ?? recordedAt,
    lastRegisteredAt: recordedAt,
    lastUpdatedAt: patch.updatedAt ?? recordedAt,
    recordedAt,
  });
  await withFileLock(`${registry.registryPath}.lock`, () => appendJsonl(registry.registryPath, entry));
  return {
    home: registry.home,
    registryPath: registry.registryPath,
    entry,
    status: existing ? 'updated' : 'created',
    knownTotal: existing ? registry.entries.length : registry.entries.length + 1,
  };
}

function registryBackupName() {
  return `sessions-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
}

async function compactSessionRegistry(options = {}) {
  const registryPath = sessionRegistryFilePath(options);
  return withFileLock(`${registryPath}.lock`, async () => {
    const registry = await readSessionRegistry(options);
    const staleIds = new Set((registry.staleEntries ?? []).map((entry) => entry.sessionId));
    const entries = options.pruneStale === false
      ? registry.entries
      : registry.entries.filter((entry) => !staleIds.has(entry.sessionId));
    const backupDir = path.resolve(options.backupDir ?? cjoin(registry.home, 'registry', 'backups'));
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = cjoin(backupDir, registryBackupName());
    if (await exists(registryPath)) await fs.copyFile(registryPath, backupPath);
    else await atomicWriteText(backupPath, '');
    const body = entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n` : '';
    await atomicWriteText(registryPath, body);
    return {
      ok: true,
      registryPath,
      backupPath,
      beforeEvents: registry.totalEvents,
      afterEvents: entries.length,
      kept: entries.length,
      pruned: registry.entries.length - entries.length,
      stale: registry.staleEntries.length,
    };
  });
}

export {
  normalizeSessionId,
  compactSessionRegistry,
  readSessionRegistry,
  readSessionRegistryEntry,
  sessionRegistryFilePath,
  setRegistryWriteEnabled,
  upsertSessionRegistryEntry,
};
