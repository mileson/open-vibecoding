import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compactWorkspaceRegistry,
  readWorkspaceRegistry,
  upsertWorkspaceRegistryEntry,
} from '../src/workspace-registry.js';
import {
  compactSessionRegistry,
  readSessionRegistry,
  upsertSessionRegistryEntry,
} from '../src/session-registry.js';

test('registry compaction keeps one current event, prunes stale entries, and writes preimage backups', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-registry-compact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const openprdHome = path.join(root, 'home');
  const live = path.join(root, 'live');
  const stale = path.join(root, 'stale');
  await fs.mkdir(path.join(live, '.openprd', 'harness', 'session-bindings'), { recursive: true });
  await fs.mkdir(path.join(live, '.openprd', 'harness', 'session-states'), { recursive: true });
  const binding = path.join(live, '.openprd', 'harness', 'session-bindings', 'session-live.json');
  const state = path.join(live, '.openprd', 'harness', 'session-states', 'session-live.json');
  await fs.writeFile(binding, '{}\n');
  await fs.writeFile(state, '{}\n');

  for (let index = 0; index < 3; index += 1) {
    await upsertWorkspaceRegistryEntry(live, { openprdHome, action: `update-${index}` });
  }
  await upsertWorkspaceRegistryEntry(stale, { openprdHome, action: 'stale' });
  for (let index = 0; index < 3; index += 1) {
    await upsertSessionRegistryEntry(live, 'session-live', {
      bindingPath: binding,
      statePath: state,
      title: `live-${index}`,
    }, { openprdHome });
  }
  await upsertSessionRegistryEntry(stale, 'session-stale', {}, { openprdHome });

  const workspaceBefore = await readWorkspaceRegistry({ openprdHome });
  const sessionBefore = await readSessionRegistry({ openprdHome });
  assert.equal(workspaceBefore.totalEvents, 4);
  assert.equal(sessionBefore.totalEvents, 4);
  assert.equal(workspaceBefore.staleEntries.length, 1);
  assert.equal(sessionBefore.staleEntries.length, 1);

  const backupDir = path.join(openprdHome, 'registry', 'backups', 'test-run');
  const workspaceResult = await compactWorkspaceRegistry({ openprdHome, backupDir });
  const sessionResult = await compactSessionRegistry({ openprdHome, backupDir });
  assert.equal(workspaceResult.afterEvents, 1);
  assert.equal(sessionResult.afterEvents, 1);
  assert.equal(workspaceResult.pruned, 1);
  assert.equal(sessionResult.pruned, 1);
  assert.ok((await fs.stat(workspaceResult.backupPath)).size > 0);
  assert.ok((await fs.stat(sessionResult.backupPath)).size > 0);

  const workspaceAfter = await readWorkspaceRegistry({ openprdHome });
  const sessionAfter = await readSessionRegistry({ openprdHome });
  assert.equal(workspaceAfter.totalEvents, 1);
  assert.equal(sessionAfter.totalEvents, 1);
  assert.equal(workspaceAfter.entries[0].workspaceRoot, live);
  assert.equal(sessionAfter.entries[0].sessionId, 'session-live');
});

test('session registry classifies missing binding or state paths as stale', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-session-stale-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = path.join(root, 'project');
  const openprdHome = path.join(root, 'home');
  await fs.mkdir(path.join(project, '.openprd'), { recursive: true });
  await upsertSessionRegistryEntry(project, 'session-a', {
    bindingPath: path.join(project, '.openprd', 'missing-binding.json'),
  }, { openprdHome });
  const registry = await readSessionRegistry({ openprdHome });
  assert.equal(registry.staleEntries[0].reason, 'missing-binding');
});
