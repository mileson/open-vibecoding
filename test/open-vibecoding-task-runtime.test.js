/*
 * ## 核心功能
 * 验证 Lane/Task Runtime 的 schema、CAS、write-set、claim 绑定与租约生命周期。
 *
 * ## 输入
 * 使用临时目录、可控时钟和不同 lane/task/claim 组合调用 runtime 公共 API。
 *
 * ## 输出
 * 断言持久化结构、结构化错误、heartbeat/release/recover 与 finish 幂等契约。
 *
 * ## 定位
 * runtime 的领域与存储契约测试，不覆盖 CLI 或现有 session/loop 接线。
 *
 * ## 依赖
 * 依赖 Node.js test/assert/fs/os/path 与 src/runtime/index.js。
 *
 * ## 维护规则
 * 公共 runtime 契约变更必须先更新兼容策略，再调整本测试的明确断言。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LaneStore,
  OPEN_VIBECODING_REVISION_CONFLICT,
  OPEN_VIBECODING_TASK_ALREADY_CLAIMED,
  OPEN_VIBECODING_WRITE_SET_CONFLICT,
  TaskRuntime,
  normalizeWriteSet,
  writeSetsIntersect,
} from '../src/runtime/index.js';

async function runtimeFixture(options = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-task-runtime-'));
  let now = Date.UTC(2026, 6, 10, 0, 0, 0);
  const clock = { now: () => now };
  const runtime = new TaskRuntime(rootDir, {
    clock,
    defaultLeaseDurationMs: 1_000,
    lockRetryMs: 1,
    ...options,
  });
  return {
    rootDir,
    runtime,
    clock,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

test('write-set normalization is project-relative, deterministic, and exclusion-aware', () => {
  assert.deepEqual(normalizeWriteSet({
    includes: ['./src/runtime/**', 'src\\runtime\\**', 'docs/'],
    excludes: ['./src/runtime/generated/**', './src/runtime/generated/**'],
  }), {
    include: ['docs/**', 'src/runtime/**'],
    exclude: ['src/runtime/generated/**'],
  });
  assert.deepEqual(normalizeWriteSet(), { include: ['**/*'], exclude: [] });
  assert.throws(() => normalizeWriteSet(['/tmp/outside']), /project-relative/);
  assert.throws(() => normalizeWriteSet(['../outside']), /cannot escape/);

  assert.equal(writeSetsIntersect(['src/runtime/**'], ['docs/**']), false);
  assert.equal(writeSetsIntersect(['src/**'], ['src/runtime/**']), true);
  assert.equal(writeSetsIntersect(['src/[ab].js'], ['src/a.js']), true);
  assert.equal(writeSetsIntersect(
    { include: ['src/**'], exclude: ['src/runtime/**'] },
    { include: ['src/runtime/**'] },
  ), false);
  assert.equal(writeSetsIntersect(['src/*/index.js'], ['src/**/index.js']), true);
});

test('LaneStore persists schema and rejects stale lane revisions', async () => {
  const { rootDir, clock } = await runtimeFixture();
  const store = new LaneStore(rootDir, { clock, lockRetryMs: 1 });
  const lane = await store.create({
    laneId: 'lane-store',
    title: 'Runtime lane',
    metadata: { source: 'unit-test' },
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });

  assert.equal(lane.schemaVersion, 1);
  assert.equal(lane.revision, 0);
  assert.equal(lane.tasks.T001.revision, 0);
  assert.deepEqual(lane.tasks.T001.writeSet, { include: ['src/runtime/**'], exclude: [] });

  lane.title = 'Updated runtime lane';
  const saved = await store.save(lane, { expectedRevision: 0 });
  assert.equal(saved.revision, 1);
  await assert.rejects(
    () => store.save(lane, { expectedRevision: 0 }),
    (error) => error.code === OPEN_VIBECODING_REVISION_CONFLICT
      && error.details.expectedRevision === 0
      && error.details.actualRevision === 1,
  );
});

test('claim binds tool identity, code position, lease, write-set, and evidence', async () => {
  const { runtime } = await runtimeFixture();
  await runtime.createLane({
    laneId: 'binding-lane',
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });

  const claimed = await runtime.claimTask('binding-lane', 'T001', {
    claimId: 'claim-binding-1',
    client: 'codex',
    session: 'session-1',
    thread: 'thread-1',
    worktree: '/repo/.worktrees/runtime',
    branch: 'codex/runtime',
    baseCommit: '0123456789abcdef',
    evidence: [{ kind: 'test-plan', path: 'test/open-vibecoding-task-runtime.test.js' }],
  });

  assert.equal(claimed.task.status, 'claimed');
  assert.equal(claimed.task.revision, 1);
  assert.deepEqual(claimed.claim, claimed.task.claim);
  assert.equal(claimed.claim.client, 'codex');
  assert.equal(claimed.claim.clientId, 'codex');
  assert.equal(claimed.claim.session, 'session-1');
  assert.equal(claimed.claim.thread, 'thread-1');
  assert.equal(claimed.claim.worktree, '/repo/.worktrees/runtime');
  assert.equal(claimed.claim.branch, 'codex/runtime');
  assert.equal(claimed.claim.baseCommit, '0123456789abcdef');
  assert.deepEqual(claimed.claim.writeSet, { include: ['src/runtime/**'], exclude: [] });
  assert.deepEqual(claimed.claim.evidence, [{ kind: 'test-plan', path: 'test/open-vibecoding-task-runtime.test.js' }]);
});

test('task revision CAS protects heartbeat, and release returns the task to pending', async () => {
  const { runtime, advance } = await runtimeFixture();
  await runtime.createLane({
    laneId: 'heartbeat-lane',
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });
  const claimed = await runtime.claimTask('heartbeat-lane', 'T001', {
    claimId: 'claim-heartbeat-1',
    clientId: 'claude-code',
    sessionId: 'session-heartbeat',
  });
  advance(100);

  await assert.rejects(
    () => runtime.heartbeatTask('heartbeat-lane', 'T001', claimed.claim, { expectedRevision: 0 }),
    (error) => error.code === OPEN_VIBECODING_REVISION_CONFLICT
      && error.details.actualRevision === 1,
  );

  const heartbeat = await runtime.heartbeatTask('heartbeat-lane', 'T001', claimed.claim, {
    expectedRevision: 1,
    evidence: 'unit heartbeat',
  });
  assert.equal(heartbeat.task.revision, 2);
  assert.equal(heartbeat.claim.heartbeatSequence, 1);
  assert.deepEqual(heartbeat.claim.evidence, ['unit heartbeat']);

  const released = await runtime.releaseTask('heartbeat-lane', 'T001', claimed.claim, {
    expectedRevision: 2,
    reason: 'handoff',
  });
  assert.equal(released.task.status, 'pending');
  assert.equal(released.task.claim, null);
  assert.equal(released.task.lastClaim.outcome, 'released');
  assert.equal(released.task.lastClaim.reason, 'handoff');

  const repeated = await runtime.releaseTask('heartbeat-lane', 'T001', claimed.claim);
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.task.revision, released.task.revision);
});

test('expired claims recover explicitly and finish is retry-idempotent', async () => {
  const { runtime, advance } = await runtimeFixture();
  await runtime.createLane({
    laneId: 'recovery-lane',
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });
  const first = await runtime.claimTask('recovery-lane', 'T001', {
    claimId: 'claim-expiring',
    leaseDurationMs: 100,
    client: 'cursor',
  });
  advance(101);

  const recovered = await runtime.recoverExpired('recovery-lane', {
    taskId: 'T001',
    expectedRevision: first.task.revision,
  });
  assert.equal(recovered.changed, true);
  assert.equal(recovered.recovered.length, 1);
  assert.equal(recovered.recovered[0].claimId, 'claim-expiring');

  const second = await runtime.claimTask('recovery-lane', 'T001', {
    claimId: 'claim-finishing',
    client: 'codex',
    evidence: 'claim evidence',
  });
  const finished = await runtime.finishTask('recovery-lane', 'T001', second.claim, {
    expectedRevision: second.task.revision,
    result: { tests: 'passed' },
    evidence: 'finish evidence',
  });
  assert.equal(finished.task.status, 'completed');
  assert.deepEqual(finished.task.result, { tests: 'passed' });
  assert.deepEqual(finished.task.evidence, ['claim evidence', 'finish evidence']);

  const repeated = await runtime.finishTask('recovery-lane', 'T001', second.claim, {
    result: { tests: 'passed' },
  });
  assert.equal(repeated.idempotent, true);
  assert.equal(repeated.task.revision, finished.task.revision);

  await assert.rejects(
    () => runtime.finishTask('recovery-lane', 'T001', second.claim, { result: { tests: 'failed' } }),
    (error) => error.code === OPEN_VIBECODING_REVISION_CONFLICT
      && error.details.reason === 'idempotent-payload-mismatch',
  );
});

test('structured claim and write-set conflicts expose stable machine codes', async () => {
  const { runtime } = await runtimeFixture();
  await runtime.createLane({
    laneId: 'error-lane',
    tasks: [
      { taskId: 'T001', writeSet: ['src/runtime/**'] },
      { taskId: 'T002', writeSet: ['src/runtime/errors.js'] },
    ],
  });
  await runtime.claimTask('error-lane', 'T001', { claimId: 'claim-owner', client: 'codex' });

  await assert.rejects(
    () => runtime.claimTask('error-lane', 'T001', { claimId: 'claim-loser', client: 'cursor' }),
    (error) => error.code === OPEN_VIBECODING_TASK_ALREADY_CLAIMED
      && error.toJSON().details.activeClaimId === 'claim-owner',
  );
  await assert.rejects(
    () => runtime.claimTask('error-lane', 'T002', { claimId: 'claim-overlap', client: 'claude-code' }),
    (error) => error.code === OPEN_VIBECODING_WRITE_SET_CONFLICT
      && error.details.conflictingTaskId === 'T001'
      && error.details.overlap.requestedPattern === 'src/runtime/errors.js',
  );
});
