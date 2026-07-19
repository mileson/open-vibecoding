import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { canonicalReviewPath, defaultReviewArtifactPath } from './html-artifacts.js';
import { summarizeSnapshot } from './prd-core.js';
import { appendWorkflowEvent, loadWorkspace, readVersionIndex, readVersionSnapshot, writeVersionIndex, writeVersionSnapshot } from './workspace-core.js';
import { exists, readText, writeJson } from './fs-utils.js';
import { readWorkUnitBinding, writeWorkUnitBinding } from './work-unit.js';
import { timestamp } from './time.js';

const LEGACY_FROZEN_STATUS = 'legacy-frozen';

function legacyWorkUnitId(ws, snapshot) {
  const versionId = snapshot.versionId ?? 'v0000';
  const source = [
    ws.projectRoot,
    versionId,
    snapshot.digest ?? '',
    snapshot.title ?? '',
  ].join('\0');
  const suffix = crypto.createHash('sha256').update(source).digest('hex').slice(0, 8);
  return `wu-legacy-${versionId}-${suffix}`;
}

function sortVersionIds(versionIds) {
  return [...versionIds].sort((a, b) => {
    const numberA = Number(String(a).replace(/^v/i, ''));
    const numberB = Number(String(b).replace(/^v/i, ''));
    if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) {
      return numberA - numberB;
    }
    return String(a).localeCompare(String(b));
  });
}

async function collectVersionIds(ws) {
  const index = await readVersionIndex(ws);
  const ids = new Set(index.map((entry) => entry.versionId).filter(Boolean));
  const files = await fs.readdir(ws.paths.versionsDir).catch(() => []);
  for (const file of files) {
    if (file.endsWith('.json')) {
      ids.add(path.basename(file, '.json'));
    }
  }
  return sortVersionIds(ids);
}

async function loadBackfillSnapshot(ws, versionId) {
  const snapshot = await readVersionSnapshot(ws, versionId);
  if (!snapshot) {
    return null;
  }
  if (snapshot.content) {
    return snapshot;
  }
  const markdownPath = path.join(ws.paths.versionsDir, `${versionId}.md`);
  const content = await readText(markdownPath).catch(() => null);
  return content ? { ...snapshot, content } : snapshot;
}

function resolveBackfillStatus(ws, snapshot, isLatest) {
  if (snapshot.lifecycleStatus === LEGACY_FROZEN_STATUS) {
    return LEGACY_FROZEN_STATUS;
  }
  const currentState = ws.data.currentState ?? {};
  const stored = currentState.reviewStatus;
  if (isLatest && stored?.versionId === snapshot.versionId && stored.status) {
    return stored.status;
  }
  if (isLatest && ['frozen', 'handed_off'].includes(currentState.status)) {
    return 'confirmed';
  }
  return 'pending-confirmation';
}

function buildBackfilledSnapshot(ws, snapshot, isLatest) {
  const content = snapshot.content ?? '';
  const digest = snapshot.digest ?? crypto.createHash('sha256').update(content).digest('hex');
  const isLegacy = snapshot.lifecycleStatus === LEGACY_FROZEN_STATUS
    || !snapshot.digest
    || !snapshot.workUnitId
    || !snapshot.targetRoot;
  return {
    ...snapshot,
    digest,
    workUnitId: snapshot.workUnitId ?? legacyWorkUnitId(ws, { ...snapshot, digest }),
    targetRoot: snapshot.targetRoot ?? (isLatest ? ws.data.currentState?.targetRoot : null) ?? ws.projectRoot,
    ...(isLegacy ? {
      lifecycleStatus: LEGACY_FROZEN_STATUS,
      semanticMode: 'context-only',
      backfillPolicy: 'metadata-only',
    } : {}),
  };
}

function resolveStoredArtifactPath(ws, value) {
  if (!value) {
    return null;
  }
  return path.isAbsolute(value) ? value : path.resolve(ws.projectRoot, value);
}

function workUnitBindingPath(ws, workUnitId) {
  const fileName = `${String(workUnitId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
  return path.join(ws.workspaceRoot, 'engagements', 'work-units', fileName);
}

function bindingNeedsMetadataUpdate(binding, snapshot, status, reviewReferences) {
  return !binding
    || binding.latestVersionId !== snapshot.versionId
    || binding.latestVersionDigest !== snapshot.digest
    || binding.targetRoot !== snapshot.targetRoot
    || binding.status !== status
    || (binding.reviewPath ?? null) !== reviewReferences.reviewPath
    || (binding.activeReviewPath ?? null) !== reviewReferences.activeReviewPath;
}

async function resolveExistingReviewReferences(ws, snapshot, isLatest, binding) {
  const currentReview = isLatest && ws.data.currentState?.reviewStatus?.versionId === snapshot.versionId
    ? ws.data.currentState.reviewStatus
    : null;
  const reviewCandidates = [
    binding?.reviewPath,
    binding?.reviewArtifact,
    currentReview?.reviewPath,
    currentReview?.stableArtifact,
    canonicalReviewPath(ws, snapshot.versionId),
  ];
  const activeCandidates = [
    binding?.activeReviewPath,
    binding?.activeReviewArtifact,
    currentReview?.entryPath,
    currentReview?.artifact,
    isLatest ? defaultReviewArtifactPath(ws) : null,
  ];
  const firstExisting = async (candidates) => {
    for (const candidate of candidates) {
      const resolved = resolveStoredArtifactPath(ws, candidate);
      if (resolved && await exists(resolved)) {
        return resolved;
      }
    }
    return null;
  };
  return {
    reviewPath: await firstExisting(reviewCandidates),
    activeReviewPath: await firstExisting(activeCandidates),
  };
}

function snapshotNeedsIdentityUpdate(before, after) {
  return before.digest !== after.digest
    || before.workUnitId !== after.workUnitId
    || before.targetRoot !== after.targetRoot
    || before.lifecycleStatus !== after.lifecycleStatus
    || before.semanticMode !== after.semanticMode
    || before.backfillPolicy !== after.backfillPolicy;
}

async function backfillWorkUnitsWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const dryRun = Boolean(options.dryRun);
  const versionIds = await collectVersionIds(ws);
  const latestVersionId = versionIds.at(-1) ?? null;
  const changes = [];
  const bindings = [];
  const errors = [];
  let changedVersions = 0;

  for (const versionId of versionIds) {
    const snapshot = await loadBackfillSnapshot(ws, versionId);
    if (!snapshot) {
      errors.push(`Missing version snapshot: ${versionId}`);
      continue;
    }

    const isLatest = versionId === latestVersionId;
    const nextSnapshot = buildBackfilledSnapshot(ws, snapshot, isLatest);
    const needsSnapshotUpdate = snapshotNeedsIdentityUpdate(snapshot, nextSnapshot);
    const status = resolveBackfillStatus(ws, nextSnapshot, isLatest);
    const bindingBefore = await readWorkUnitBinding(ws, nextSnapshot.workUnitId);
    const reviewReferences = await resolveExistingReviewReferences(ws, nextSnapshot, isLatest, bindingBefore);
    const needsBindingUpdate = bindingNeedsMetadataUpdate(bindingBefore, nextSnapshot, status, reviewReferences);

    changes.push({
      path: path.relative(ws.projectRoot, path.join(ws.paths.versionsDir, `${versionId}.json`)),
      status: dryRun ? 'planned' : (needsSnapshotUpdate ? 'updated' : 'unchanged'),
      versionId,
      workUnitId: nextSnapshot.workUnitId,
    });
    changes.push({
      path: path.relative(ws.projectRoot, workUnitBindingPath(ws, nextSnapshot.workUnitId)),
      status: dryRun ? (needsBindingUpdate ? 'planned' : 'unchanged') : (needsBindingUpdate ? 'updated' : 'unchanged'),
      versionId,
      workUnitId: nextSnapshot.workUnitId,
    });

    if (dryRun) {
      if (needsSnapshotUpdate || needsBindingUpdate) {
        changedVersions += 1;
      }
      continue;
    }

    if (needsSnapshotUpdate) {
      await writeVersionSnapshot(ws, nextSnapshot);
    }
    const binding = needsBindingUpdate
      ? await writeWorkUnitBinding(ws, {
        snapshot: nextSnapshot,
        reviewPath: reviewReferences.reviewPath,
        activeReviewPath: reviewReferences.activeReviewPath,
        targetRoot: nextSnapshot.targetRoot,
        status,
      })
      : (bindingBefore ? { ...bindingBefore, path: workUnitBindingPath(ws, nextSnapshot.workUnitId) } : null);
    if (binding) {
      bindings.push(binding);
    }

    if (needsSnapshotUpdate || needsBindingUpdate) {
      changedVersions += 1;
    }
  }

  if (!dryRun && versionIds.length > 0) {
    const snapshots = [];
    for (const versionId of versionIds) {
      const snapshot = await readVersionSnapshot(ws, versionId);
      if (snapshot) {
        snapshots.push({
          ...summarizeSnapshot(snapshot),
          lifecycleStatus: snapshot.lifecycleStatus ?? null,
          semanticMode: snapshot.semanticMode ?? null,
        });
      }
    }
    await writeVersionIndex(ws, snapshots);

    const latestSnapshot = await readVersionSnapshot(ws, latestVersionId);
    if (latestSnapshot) {
      const currentState = ws.data.currentState ?? {};
      const status = resolveBackfillStatus(ws, latestSnapshot, true);
      const legacyFrozen = status === LEGACY_FROZEN_STATUS;
      const nextState = {
        ...currentState,
        latestVersionId: latestSnapshot.versionId,
        latestVersionDigest: latestSnapshot.digest,
        activeWorkUnitId: latestSnapshot.workUnitId,
        targetRoot: latestSnapshot.targetRoot,
        ...(legacyFrozen ? {
          lifecycleStatus: LEGACY_FROZEN_STATUS,
          semanticMode: 'context-only',
        } : {}),
        reviewStatus: {
          ...(currentState.reviewStatus ?? {}),
          versionId: latestSnapshot.versionId,
          workUnitId: latestSnapshot.workUnitId,
          status,
          ...(legacyFrozen ? {
            historicalContextOnly: true,
            lifecycleStatus: LEGACY_FROZEN_STATUS,
          } : {}),
          updatedAt: currentState.reviewStatus?.updatedAt ?? timestamp(),
        },
      };
      await writeJson(ws.paths.currentState, nextState);
    }

    await appendWorkflowEvent(ws, 'work_units_backfilled', {
      versions: versionIds.length,
      changedVersions,
    });
  }

  return {
    ok: errors.length === 0,
    action: 'backfill-work-units',
    projectRoot: ws.projectRoot,
    workspaceRoot: ws.workspaceRoot,
    dryRun,
    totalVersions: versionIds.length,
    changedVersions,
    bindings,
    changes,
    errors,
  };
}

export { backfillWorkUnitsWorkspace };
