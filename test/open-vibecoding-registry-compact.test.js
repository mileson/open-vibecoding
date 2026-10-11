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

test('workspace registry compaction keeps one current event and writes a preimage backup', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-registry-compact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const openprdHome = path.join(root, 'home');
  const live = path.join(root, 'live');
  const stale = path.join(root, 'stale');
  await fs.mkdir(path.join(live, '.open-vibecoding'), { recursive: true });

  for (let index = 0; index < 3; index += 1) {
    await upsertWorkspaceRegistryEntry(live, { openprdHome, action: `update-${index}` });
  }
  await upsertWorkspaceRegistryEntry(stale, { openprdHome, action: 'stale' });

  const before = await readWorkspaceRegistry({ openprdHome });
  assert.equal(before.totalEvents, 4);
  assert.equal(before.staleEntries.length, 1);

  const backupDir = path.join(openprdHome, 'registry', 'backups', 'test-run');
  const result = await compactWorkspaceRegistry({ openprdHome, backupDir });
  assert.equal(result.afterEvents, 1);
  assert.equal(result.pruned, 1);
  assert.ok((await fs.stat(result.backupPath)).size > 0);

  const after = await readWorkspaceRegistry({ openprdHome });
  assert.equal(after.totalEvents, 1);
  assert.equal(after.entries[0].workspaceRoot, live);
});
