import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openGateStore } from '../src/gates/index.js';

const CLOCK = () => new Date('2026-07-10T12:00:00.000Z');

test('gate store atomically records and consumes one-operation approval', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-gate-store-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = openGateStore(root, { clock: CLOCK });
  const scope = { type: 'operation', id: 'fleet:0.1.20:batch-home' };
  await store.recordGate({
    gateId: 'gate-fleet-home',
    scope,
    operation: 'fleet-update',
    requiredEvidence: [{ kind: 'backup-plan' }],
    approval: { required: true, subjectDigest: 'sha256:plan', consumeOnPass: true },
  });
  await store.recordEvidence({
    evidenceId: 'evidence-backup',
    scope,
    operation: 'fleet-update',
    kind: 'backup-plan',
    source: 'plan.json',
    contentDigest: 'sha256:backup',
  });
  await store.recordApproval({
    approvalId: 'approval-fleet-home',
    scope,
    operation: 'fleet-update',
    subjectDigest: 'sha256:plan',
    actor: { type: 'user', id: 'owner' },
  });
  const passed = await store.evaluate({ gateId: 'gate-fleet-home', approvalId: 'approval-fleet-home' });
  assert.equal(passed.status, 'pass');
  const state = await store.read();
  assert.equal(state.approvals['approval-fleet-home'].status, 'consumed');
  const blocked = await store.evaluate({ gateId: 'gate-fleet-home', approvalId: 'approval-fleet-home' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reasons[0].code, 'approval-consumed');
});

test('gate store rejects same ID with different content', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-gate-conflict-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = openGateStore(root, { clock: CLOCK });
  await store.recordGate({
    gateId: 'gate-a',
    scope: { type: 'task', id: 'task-a' },
    operation: 'finish',
  });
  await assert.rejects(store.recordGate({
    gateId: 'gate-a',
    scope: { type: 'task', id: 'task-b' },
    operation: 'finish',
  }), (error) => error.code === 'OPENPRD_GATE_ID_CONFLICT');
});
