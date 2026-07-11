import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  AtomicStoreConflictError,
  appendJsonlAtomic,
  compareAndSwapJson,
  readJsonlRecovered,
  withFileLock,
} from '../src/kernel/atomic-store.js';
import {
  IdempotencyConflictError,
  RevisionConflictError,
  openProjectLedger,
} from '../src/kernel/project-ledger.js';

async function makeProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openprd-ledger-'));
}

const fixtureOptions = {
  clock: () => new Date('2026-07-10T12:00:00.000Z'),
  projectIdFactory: () => 'project-fixture',
};

test('project ledger enforces stream revisions and idempotency', async () => {
  const project = await makeProject();
  const ledger = openProjectLedger(project, fixtureOptions);

  const first = await ledger.append('task/T001', {
    eventType: 'task.claimed',
    actor: { type: 'agent', id: 'codex/thread-1' },
    payload: { taskId: 'T001' },
  }, { expectedRevision: 0, idempotencyKey: 'claim-T001-thread-1' });
  const replay = await ledger.append('task/T001', {
    eventType: 'task.claimed',
    actor: { type: 'agent', id: 'codex/thread-1' },
    payload: { taskId: 'T001' },
  }, { expectedRevision: 0, idempotencyKey: 'claim-T001-thread-1' });
  const second = await ledger.append('task/T001', {
    eventType: 'task.completed',
    payload: { taskId: 'T001', evidence: ['test:pass'] },
  }, { expectedRevision: 1 });

  assert.equal(first.event.revision, 1);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.event.eventId, first.event.eventId);
  assert.equal(second.event.revision, 2);
  assert.deepEqual((await ledger.readStream('task/T001')).map((event) => event.revision), [1, 2]);
  assert.equal((await ledger.head('task/T001')).revision, 2);

  await assert.rejects(
    ledger.append('task/T001', { eventType: 'task.reopened', payload: {} }, { expectedRevision: 0 }),
    (error) => error instanceof RevisionConflictError && error.actualRevision === 2,
  );
  await assert.rejects(
    ledger.append('task/T001', {
      eventType: 'task.claimed',
      actor: { type: 'agent', id: 'codex/thread-2' },
      payload: { taskId: 'T001' },
    }, { idempotencyKey: 'claim-T001-thread-1' }),
    (error) => error instanceof IdempotencyConflictError,
  );

  const verification = await ledger.verify();
  assert.equal(verification.ok, true);
  assert.equal(verification.eventCount, 2);
  assert.equal(verification.streams, 1);
});

test('project ledger serializes concurrent writers without dropping revisions', async () => {
  const project = await makeProject();
  const ledger = openProjectLedger(project, {
    ...fixtureOptions,
    clock: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 6, 10, 12, 0, 0, tick++));
    })(),
  });

  await Promise.all(Array.from({ length: 20 }, (_, index) => ledger.append('runtime/shared', {
    eventType: 'runtime.observed',
    payload: { index },
  }, { idempotencyKey: `event-${index}` })));

  const events = await ledger.readStream('runtime/shared');
  assert.deepEqual(events.map((event) => event.revision), Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(new Set(events.map((event) => event.payload.index)).size, 20);
  assert.equal((await ledger.verify()).ok, true);
});

test('atomic store supports CAS, stale lock recovery, and damaged JSONL tail recovery', async () => {
  const project = await makeProject();
  const statePath = path.join(project, 'state.json');
  const lockPath = path.join(project, 'state.lock');
  const logPath = path.join(project, 'events.jsonl');

  await compareAndSwapJson(statePath, {
    expectedRevision: 0,
    nextValue: { revision: 1, value: 'first' },
  });
  await assert.rejects(
    compareAndSwapJson(statePath, {
      expectedRevision: 0,
      nextValue: { revision: 2, value: 'stale' },
    }),
    (error) => error instanceof AtomicStoreConflictError && error.actualRevision === 1,
  );

  await fs.writeFile(lockPath, JSON.stringify({ token: 'abandoned', createdAt: '2020-01-01T00:00:00.000Z' }));
  const old = new Date('2020-01-01T00:00:00.000Z');
  await fs.utimes(lockPath, old, old);
  const lockResult = await withFileLock(lockPath, async () => 'recovered', {
    staleLockMs: 10,
    timeoutMs: 500,
  });
  assert.equal(lockResult, 'recovered');

  await fs.writeFile(logPath, '{"ok":1}\n{"partial":');
  const recovered = await readJsonlRecovered(logPath, { repair: true });
  assert.deepEqual(recovered.records, [{ ok: 1 }]);
  assert.equal(recovered.recovered, true);
  await appendJsonlAtomic(logPath, { ok: 2 });
  assert.deepEqual((await readJsonlRecovered(logPath)).records, [{ ok: 1 }, { ok: 2 }]);
});
