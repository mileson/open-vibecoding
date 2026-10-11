/* Historical PRD snapshots remain readable without recreating the old workflow. */
import { diffSnapshots } from './prd-core.js';
import { exists } from './fs-utils.js';
import { loadWorkspace, normalizeVersionId, readVersionIndex, readVersionSnapshot } from './workspace-core.js';

export async function historyWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  return { ws, versions: await readVersionIndex(ws) };
}

export async function diffWorkspace(projectRoot, options = {}) {
  const { ws, versions } = await historyWorkspace(projectRoot);
  const fromId = normalizeVersionId(options.from);
  const toId = normalizeVersionId(options.to);
  const beforeEntry = fromId
    ? versions.find((entry) => normalizeVersionId(entry.versionId) === fromId)
    : versions.at(-2);
  const afterEntry = toId
    ? versions.find((entry) => normalizeVersionId(entry.versionId) === toId)
    : versions.at(-1);
  if (!beforeEntry || !afterEntry) throw new Error('Need two existing historical PRD versions to diff.');
  const [before, after] = await Promise.all([
    readVersionSnapshot(ws, beforeEntry.versionId),
    readVersionSnapshot(ws, afterEntry.versionId),
  ]);
  if (!before || !after) throw new Error('Unable to read one or both historical PRD snapshots.');
  return { ws, before, after, diff: diffSnapshots(before, after) };
}
