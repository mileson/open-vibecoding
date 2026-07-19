import fs from 'node:fs/promises';
import path from 'node:path';
import { validateOpenSpecChangeWorkspace, resolveOpenSpecChangeId } from './change-validate.js';
import { isOpenSpecTaskBlocking, listOpenSpecStructuredTasks } from './tasks.js';
import { timestamp } from '../time.js';
import {
  cjoin,
  exists,
  listChangeDirs,
  openPrdAcceptedSpecRoot,
  openPrdArchiveChangeRoot,
  openPrdDiscoveryConfigPath,
  readDiscoveryConfig,
  resolveChangeDir,
} from './paths.js';

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  const text = await readText(filePath);
  return JSON.parse(text);
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, 'utf8');
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function changesStatePath(projectRoot) {
  return cjoin(projectRoot, '.openprd', 'state', 'changes.json');
}

async function readChangesState(projectRoot) {
  return (await readJson(changesStatePath(projectRoot)).catch(() => null)) ?? {
    version: 1,
    activeChange: null,
    changes: {},
  };
}

async function writeChangesState(projectRoot, state) {
  await writeJson(changesStatePath(projectRoot), {
    version: 1,
    activeChange: state.activeChange ?? null,
    updatedAt: timestamp(),
    changes: state.changes ?? {},
  });
}

async function writeActiveChange(projectRoot, changeId) {
  const state = await readChangesState(projectRoot);
  state.activeChange = changeId;
  state.changes[changeId] = {
    ...(state.changes[changeId] ?? {}),
    id: changeId,
    status: 'active',
    activatedAt: timestamp(),
  };
  await writeChangesState(projectRoot, state);

  const config = await readDiscoveryConfig(projectRoot, readJson);
  await writeJson(openPrdDiscoveryConfigPath(projectRoot), {
    ...config,
    activeChange: changeId,
  });

  return state;
}

async function readAcceptedIndex(projectRoot) {
  const indexPath = cjoin(openPrdAcceptedSpecRoot(projectRoot), 'index.json');
  return (await readJson(indexPath).catch(() => null)) ?? {
    version: 1,
    updatedAt: null,
    capabilities: {},
    appliedChanges: [],
  };
}

async function writeAcceptedIndex(projectRoot, index) {
  await writeJson(cjoin(openPrdAcceptedSpecRoot(projectRoot), 'index.json'), {
    version: 1,
    updatedAt: timestamp(),
    capabilities: index.capabilities ?? {},
    appliedChanges: index.appliedChanges ?? [],
  });
}

function historicalChangeStatus(status) {
  return ['applied', 'archived', 'closed', 'historical', 'legacy-frozen'].includes(status);
}

async function detectAcceptedSpecConflicts(projectRoot, specs, acceptedIndex) {
  const acceptedRoot = openPrdAcceptedSpecRoot(projectRoot);
  const conflicts = [];
  for (const spec of specs) {
    const targetPath = cjoin(acceptedRoot, spec.capability, 'spec.md');
    const indexed = acceptedIndex.capabilities?.[spec.capability] ?? null;
    const indexedPath = indexed?.specPath ? path.resolve(projectRoot, indexed.specPath) : null;
    if (indexedPath && indexedPath !== path.resolve(targetPath)) {
      conflicts.push({
        capability: spec.capability,
        code: 'accepted-index-path-mismatch',
        targetPath,
        indexedPath,
      });
      continue;
    }
    if (!indexed && await exists(targetPath)) {
      const [incoming, existing] = await Promise.all([
        readText(spec.sourcePath),
        readText(targetPath),
      ]);
      if (incoming !== existing) {
        conflicts.push({
          capability: spec.capability,
          code: 'untracked-accepted-spec',
          targetPath,
          indexedPath: null,
        });
      }
    }
  }
  return conflicts;
}

async function collectChangeSpecs(changeDir) {
  const specsRoot = cjoin(changeDir, 'specs');
  const specs = [];
  let entries = [];
  try {
    entries = await fs.readdir(specsRoot, { withFileTypes: true });
  } catch {
    return specs;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const sourcePath = cjoin(specsRoot, entry.name, 'spec.md');
    if (await exists(sourcePath)) {
      specs.push({
        capability: entry.name,
        sourcePath,
      });
    }
  }

  return specs;
}

async function allStructuredTasksComplete(projectRoot, changeId) {
  const { tasks } = await listOpenSpecStructuredTasks(projectRoot, { changeId });
  if (tasks.length === 0) {
    return { complete: true, total: 0, incomplete: [], backgroundIncomplete: [] };
  }
  const incomplete = tasks.filter((task) => !task.checked && isOpenSpecTaskBlocking(task));
  const backgroundIncomplete = tasks.filter((task) => !task.checked && !isOpenSpecTaskBlocking(task));
  return {
    complete: incomplete.length === 0,
    total: tasks.length,
    incomplete: incomplete.map((task) => task.id),
    backgroundIncomplete: backgroundIncomplete.map((task) => task.id),
  };
}

async function updateChangeStatus(projectRoot, changeId, status, extra = {}) {
  const state = await readChangesState(projectRoot);
  state.changes[changeId] = {
    ...(state.changes[changeId] ?? {}),
    id: changeId,
    status,
    updatedAt: timestamp(),
    ...extra,
  };
  if (status === 'active') {
    state.activeChange = changeId;
  }
  if ((status === 'closed' || status === 'archived' || status === 'applied') && state.activeChange === changeId) {
    state.activeChange = null;
  }
  await writeChangesState(projectRoot, state);
  return state;
}

export async function listOpenPrdChangesWorkspace(projectRoot) {
  const state = await readChangesState(projectRoot);
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const changes = await listChangeDirs(projectRoot);
  const requestedActiveChange = state.activeChange ?? discoveryConfig.activeChange ?? null;
  const activeChange = changes.some((change) => change.id === requestedActiveChange && !change.archived)
    && !historicalChangeStatus(state.changes?.[requestedActiveChange]?.status)
    ? requestedActiveChange
    : null;
  const rows = [];

  for (const change of changes) {
    const taskState = await allStructuredTasksComplete(projectRoot, change.id).catch(() => ({ total: 0, incomplete: [] }));
    rows.push({
      id: change.id,
      source: change.source,
      status: change.archived ? 'archived' : (state.changes?.[change.id]?.status ?? 'draft'),
      active: !change.archived && change.id === activeChange,
      archived: change.archived,
      changeDir: change.changeDir,
      taskTotal: taskState.total,
      taskIncomplete: taskState.incomplete.length,
      taskBackgroundIncomplete: taskState.backgroundIncomplete?.length ?? 0,
    });
  }

  return {
    ok: true,
    action: 'list',
    projectRoot,
    activeChange,
    changes: rows,
  };
}

export async function activateOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  if (!(await exists(changeDir))) {
    throw new Error(`Missing OpenPrd change directory: ${path.relative(projectRoot, changeDir)}`);
  }
  const state = await readChangesState(projectRoot);
  const archivedRoot = path.resolve(openPrdArchiveChangeRoot(projectRoot));
  const resolvedChangeDir = path.resolve(changeDir);
  const archived = resolvedChangeDir === archivedRoot || resolvedChangeDir.startsWith(`${archivedRoot}${path.sep}`);
  if (archived || historicalChangeStatus(state.changes?.[changeId]?.status)) {
    throw new Error(`Change ${changeId} 已是 legacy-frozen 历史上下文，不能重新激活；请创建新的当前 change，并把旧材料仅作为 context。`);
  }
  await writeActiveChange(projectRoot, changeId);
  return {
    ok: true,
    action: 'activate',
    projectRoot,
    changeId,
    changeDir,
  };
}

export async function closeOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const current = await readChangesState(projectRoot);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  const archivedRoot = path.resolve(openPrdArchiveChangeRoot(projectRoot));
  const resolvedChangeDir = path.resolve(changeDir);
  const archived = resolvedChangeDir === archivedRoot || resolvedChangeDir.startsWith(`${archivedRoot}${path.sep}`);
  if (archived || historicalChangeStatus(current.changes?.[changeId]?.status)) {
    return {
      ok: false,
      action: 'close',
      projectRoot,
      changeId,
      historicalContextOnly: true,
      errors: [`Change ${changeId} 已是 legacy-frozen 历史上下文，不能改写其生命周期状态。`],
    };
  }
  const state = await updateChangeStatus(projectRoot, changeId, 'closed', {
    closedAt: timestamp(),
    reason: options.notes ?? null,
  });
  return {
    ok: true,
    action: 'close',
    projectRoot,
    changeId,
    activeChange: state.activeChange,
  };
}

export async function applyOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const state = await readChangesState(projectRoot);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  const archivedRoot = path.resolve(openPrdArchiveChangeRoot(projectRoot));
  const resolvedChangeDir = path.resolve(changeDir);
  const archived = resolvedChangeDir === archivedRoot || resolvedChangeDir.startsWith(`${archivedRoot}${path.sep}`);
  if (archived || historicalChangeStatus(state.changes?.[changeId]?.status)) {
    return {
      ok: false,
      action: 'apply',
      projectRoot,
      changeId,
      historicalContextOnly: true,
      appliedSpecs: [],
      errors: [`Change ${changeId} 已是 legacy-frozen 历史上下文，不能再次应用；请创建新的当前 change，并把旧材料仅作为 context。`],
    };
  }
  const validation = await validateOpenSpecChangeWorkspace(projectRoot, { change: changeId });
  if (!validation.ok) {
    return {
      ok: false,
      action: 'apply',
      projectRoot,
      changeId,
      validation,
      appliedSpecs: [],
      errors: validation.errors,
    };
  }

  const taskState = await allStructuredTasksComplete(projectRoot, changeId);
  if (!taskState.complete && !options.force) {
    return {
      ok: false,
      action: 'apply',
      projectRoot,
      changeId,
      validation,
      appliedSpecs: [],
      errors: [`Change ${changeId} 仍有未完成任务: ${taskState.incomplete.join(', ')}。如需强制应用，请使用 --force。`],
    };
  }

  const specs = await collectChangeSpecs(changeDir);
  const acceptedRoot = openPrdAcceptedSpecRoot(projectRoot);
  const acceptedIndex = await readAcceptedIndex(projectRoot);
  const conflicts = await detectAcceptedSpecConflicts(projectRoot, specs, acceptedIndex);
  if (conflicts.length > 0 && !options.force) {
    return {
      ok: false,
      action: 'apply',
      projectRoot,
      changeId,
      validation,
      appliedSpecs: [],
      conflicts,
      errors: conflicts.map((conflict) => (
        conflict.code === 'untracked-accepted-spec'
          ? `Capability ${conflict.capability} 的 accepted spec 已存在但未登记到 index；为避免覆盖未知历史，请先核对差异或显式使用 --force。`
          : `Capability ${conflict.capability} 的 accepted index 路径与目标路径冲突；请先修复 index 或显式使用 --force。`
      )),
    };
  }
  const appliedSpecs = [];
  const now = timestamp();

  for (const spec of specs) {
    const targetPath = cjoin(acceptedRoot, spec.capability, 'spec.md');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(spec.sourcePath, targetPath);
    acceptedIndex.capabilities[spec.capability] = {
      capability: spec.capability,
      specPath: path.relative(projectRoot, targetPath),
      sourceChange: changeId,
      appliedAt: now,
    };
    appliedSpecs.push({
      capability: spec.capability,
      specPath: targetPath,
    });
  }

  acceptedIndex.appliedChanges.push({
    changeId,
    appliedAt: now,
    forced: Boolean(options.force),
    capabilities: appliedSpecs.map((spec) => spec.capability),
  });
  await writeAcceptedIndex(projectRoot, acceptedIndex);
  await updateChangeStatus(projectRoot, changeId, 'applied', {
    appliedAt: now,
    forced: Boolean(options.force),
    acceptedSpecCount: appliedSpecs.length,
  });

  return {
    ok: true,
    action: 'apply',
    projectRoot,
    changeId,
    validation,
    appliedSpecs,
    acceptedRoot,
    taskState,
    conflicts,
    workspaceAttention: [
      ...(validation.workspaceAttention ?? []),
      ...(taskState.backgroundIncomplete.length > 0
        ? [{
            id: 'background-change-tasks',
            ok: false,
            summary: `${taskState.backgroundIncomplete.length} 个后台治理或文档任务尚未完成`,
            items: taskState.backgroundIncomplete,
            blocking: false,
          }]
        : []),
    ],
  };
}

export async function archiveOpenPrdChangeWorkspace(projectRoot, options = {}) {
  const changeId = await resolveOpenSpecChangeId(projectRoot, options.change);
  const state = await readChangesState(projectRoot);
  const changeDir = await resolveChangeDir(projectRoot, changeId);
  if (!(await exists(changeDir))) {
    throw new Error(`Missing OpenPrd change directory: ${path.relative(projectRoot, changeDir)}`);
  }
  const archiveDir = cjoin(openPrdArchiveChangeRoot(projectRoot), changeId);
  const resolvedChangeDir = path.resolve(changeDir);
  const resolvedArchiveDir = path.resolve(archiveDir);
  const status = state.changes?.[changeId]?.status ?? null;
  const immutableHistoricalStatus = ['archived', 'closed', 'historical', 'legacy-frozen'].includes(status);
  if (
    resolvedChangeDir === resolvedArchiveDir
    || immutableHistoricalStatus
    || await exists(archiveDir)
  ) {
    throw new Error(
      `Change ${changeId} 已是 legacy-frozen 历史上下文，不能再次归档或覆盖历史快照；--force 也不会绕过此边界。请为当前工作创建新的 change，并仅引用旧材料。`,
    );
  }
  await fs.mkdir(path.dirname(archiveDir), { recursive: true });
  await fs.cp(changeDir, archiveDir, { recursive: true });
  if (!options.keep) {
    await fs.rm(changeDir, { recursive: true, force: true });
  }
  await updateChangeStatus(projectRoot, changeId, 'archived', {
    archivedAt: timestamp(),
    archiveDir: path.relative(projectRoot, archiveDir),
    sourceDir: path.relative(projectRoot, changeDir),
    keptSource: Boolean(options.keep),
  });

  return {
    ok: true,
    action: 'archive',
    projectRoot,
    changeId,
    archiveDir,
    removedSource: !options.keep,
  };
}

export async function listAcceptedSpecsWorkspace(projectRoot) {
  const acceptedRoot = openPrdAcceptedSpecRoot(projectRoot);
  const index = await readAcceptedIndex(projectRoot);
  const specs = [];

  let entries = [];
  try {
    entries = await fs.readdir(acceptedRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue;
    }
    const specPath = cjoin(acceptedRoot, entry.name, 'spec.md');
    if (await exists(specPath)) {
      specs.push({
        capability: entry.name,
        specPath,
        metadata: index.capabilities?.[entry.name] ?? null,
      });
    }
  }

  return {
    ok: true,
    action: 'specs',
    projectRoot,
    acceptedRoot,
    specs,
    appliedChanges: index.appliedChanges ?? [],
  };
}
