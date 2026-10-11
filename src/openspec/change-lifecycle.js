/* Historical OpenSpec material is inspectable, never advanced or promoted. */
import fs from 'node:fs/promises';
import { isOpenSpecTaskBlocking, listOpenSpecStructuredTasks } from './tasks.js';
import {
  cjoin,
  exists,
  legacyAcceptedSpecRoot,
  listChangeDirs,
  openPrdAcceptedSpecRoot,
  readDiscoveryConfig,
} from './paths.js';

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function historicalChangeStatus(status) {
  return ['applied', 'archived', 'closed', 'historical', 'legacy-frozen'].includes(status);
}

export async function listOpenPrdChangesWorkspace(projectRoot) {
  const state = await readJson(cjoin(projectRoot, '.open-vibecoding', 'state', 'changes.json')).catch(() => ({
    activeChange: null,
    changes: {},
  }));
  const discoveryConfig = await readDiscoveryConfig(projectRoot, readJson);
  const changes = await listChangeDirs(projectRoot);
  const requestedActiveChange = state.activeChange ?? discoveryConfig.activeChange ?? null;
  const activeChange = changes.some((change) => change.id === requestedActiveChange && !change.archived)
    && !historicalChangeStatus(state.changes?.[requestedActiveChange]?.status)
    ? requestedActiveChange
    : null;

  const rows = [];
  for (const change of changes) {
    const tasks = await listOpenSpecStructuredTasks(projectRoot, { changeId: change.id })
      .then((result) => result.tasks)
      .catch(() => []);
    rows.push({
      id: change.id,
      source: change.source,
      status: change.archived ? 'archived' : (state.changes?.[change.id]?.status ?? 'draft'),
      active: !change.archived && change.id === activeChange,
      archived: change.archived,
      changeDir: change.changeDir,
      taskTotal: tasks.length,
      taskIncomplete: tasks.filter((task) => !task.checked && isOpenSpecTaskBlocking(task)).length,
      taskBackgroundIncomplete: tasks.filter((task) => !task.checked && !isOpenSpecTaskBlocking(task)).length,
    });
  }

  return { ok: true, action: 'list', projectRoot, activeChange, changes: rows };
}

export async function listAcceptedSpecsWorkspace(projectRoot) {
  const acceptedRoot = openPrdAcceptedSpecRoot(projectRoot);
  const specs = [];
  const appliedChanges = [];
  for (const root of [acceptedRoot, legacyAcceptedSpecRoot(projectRoot)]) {
    const index = await readJson(cjoin(root, 'index.json')).catch(() => ({ capabilities: {}, appliedChanges: [] }));
    appliedChanges.push(...(index.appliedChanges ?? []));
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const specPath = cjoin(root, entry.name, 'spec.md');
      if (await exists(specPath)) {
        specs.push({ capability: entry.name, specPath, metadata: index.capabilities?.[entry.name] ?? null });
      }
    }
  }
  return {
    ok: true,
    action: 'specs',
    projectRoot,
    acceptedRoot,
    specs,
    appliedChanges: [...new Set(appliedChanges)],
  };
}
