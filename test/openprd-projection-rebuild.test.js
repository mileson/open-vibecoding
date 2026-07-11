import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openProjectLedger } from '../src/kernel/project-ledger.js';

async function makeProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openprd-projection-'));
}

test('ledger rebuilds a deterministic projection from all streams and persists its checkpoint', async () => {
  const project = await makeProject();
  let tick = 0;
  const ledger = openProjectLedger(project, {
    clock: () => new Date(Date.UTC(2026, 6, 10, 12, 0, 0, tick++)),
    projectIdFactory: () => 'project-fixture',
  });

  await ledger.append('task/T001', { eventType: 'task.created', payload: { taskId: 'T001' } });
  await ledger.append('task/T002', { eventType: 'task.created', payload: { taskId: 'T002' } });
  await ledger.append('task/T001', { eventType: 'task.completed', payload: { taskId: 'T001' } });

  const reducer = (state, event) => {
    if (event.eventType === 'task.created') state[event.payload.taskId] = 'pending';
    if (event.eventType === 'task.completed') state[event.payload.taskId] = 'completed';
    return state;
  };
  const rebuilt = await ledger.rebuildProjection('task-status', reducer, {});
  const persisted = await ledger.readProjection('task-status');

  assert.deepEqual(rebuilt.state, { T001: 'completed', T002: 'pending' });
  assert.equal(rebuilt.eventsApplied, 3);
  assert.deepEqual(rebuilt.streamHeads, { 'task/T001': 2, 'task/T002': 1 });
  assert.deepEqual(persisted, rebuilt);
});

test('ledger verification detects a stale head and can rebuild it from the stream', async () => {
  const project = await makeProject();
  const ledger = openProjectLedger(project, {
    clock: () => new Date('2026-07-10T12:00:00.000Z'),
    projectIdFactory: () => 'project-fixture',
  });
  await ledger.append('task/T001', { eventType: 'task.created', payload: { taskId: 'T001' } });

  const headPath = ledger.pathsForStream('task/T001').head;
  const head = JSON.parse(await fs.readFile(headPath, 'utf8'));
  await fs.writeFile(headPath, `${JSON.stringify({ ...head, revision: 0 }, null, 2)}\n`);

  const broken = await ledger.verify();
  assert.equal(broken.ok, false);
  assert.ok(broken.errors.some((item) => item.code === 'HEAD_MISMATCH'));

  const repaired = await ledger.verify({ repairHeads: true });
  assert.equal(repaired.ok, true);
  assert.equal((await ledger.head('task/T001')).revision, 1);
});
