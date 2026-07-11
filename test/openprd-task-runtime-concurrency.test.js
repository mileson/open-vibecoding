/*
 * ## 核心功能
 * 压测 Task Runtime 在高并发 claim、write-set 并行与租约换代场景下的所有权正确性。
 *
 * ## 输入
 * 使用同一临时 lane 发起 100 路 Promise 竞争、并行不同任务与过期 claim 的旧 heartbeat。
 *
 * ## 输出
 * 断言单任务只有一个赢家、不相交任务可同时持有、旧 claim 无法覆盖新 claim。
 *
 * ## 定位
 * runtime 的竞争条件回归测试，不测试性能阈值或 CLI 展示。
 *
 * ## 依赖
 * 依赖 Node.js test/assert/fs/os/path 与 src/runtime/index.js。
 *
 * ## 维护规则
 * 不得降低竞争数量或把并发调用改成串行；发现偶发失败应修复原子性而非增加测试重试。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OPENPRD_TASK_ALREADY_CLAIMED,
  OPENPRD_WRITE_SET_CONFLICT,
  TaskRuntime,
} from '../src/runtime/index.js';

async function fixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-task-concurrency-'));
  let now = Date.UTC(2026, 6, 10, 8, 0, 0);
  const clock = { now: () => now };
  const runtime = new TaskRuntime(rootDir, {
    clock,
    defaultLeaseDurationMs: 1_000,
    lockRetryMs: 1,
    lockTimeoutMs: 20_000,
  });
  return {
    runtime,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

test('100 concurrent claim attempts produce exactly one owner', async () => {
  const { runtime } = await fixture();
  await runtime.createLane({
    laneId: 'hundred-way-race',
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });

  const attempts = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => (
    runtime.claimTask('hundred-way-race', 'T001', {
      claimId: `claim-${index}`,
      client: index % 3 === 0 ? 'codex' : (index % 3 === 1 ? 'cursor' : 'claude-code'),
      session: `session-${index}`,
      thread: `thread-${index}`,
    })
  )));

  const winners = attempts.filter((result) => result.status === 'fulfilled');
  const losers = attempts.filter((result) => result.status === 'rejected');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 99);
  assert.ok(losers.every((result) => result.reason.code === OPENPRD_TASK_ALREADY_CLAIMED));

  const stored = await runtime.getLane('hundred-way-race');
  assert.equal(stored.tasks.T001.claim.claimId, winners[0].value.claim.claimId);
  assert.equal(stored.tasks.T001.attemptCount, 1);
  assert.equal(stored.tasks.T001.revision, 1);
});

test('disjoint write-sets stay concurrently active while overlapping work is rejected', async () => {
  const { runtime } = await fixture();
  await runtime.createLane({
    laneId: 'write-set-race',
    tasks: [
      { taskId: 'T001', writeSet: ['src/runtime/**'] },
      { taskId: 'T002', writeSet: ['docs/basic/**'] },
      { taskId: 'T003', writeSet: ['src/runtime/task-runtime.js'] },
    ],
  });

  const [sourceClaim, docsClaim] = await Promise.all([
    runtime.claimTask('write-set-race', 'T001', { claimId: 'claim-source', client: 'codex' }),
    runtime.claimTask('write-set-race', 'T002', { claimId: 'claim-docs', client: 'cursor' }),
  ]);
  assert.equal(sourceClaim.task.status, 'claimed');
  assert.equal(docsClaim.task.status, 'claimed');

  const stored = await runtime.getLane('write-set-race');
  assert.equal(stored.tasks.T001.claim.claimId, 'claim-source');
  assert.equal(stored.tasks.T002.claim.claimId, 'claim-docs');

  await assert.rejects(
    () => runtime.claimTask('write-set-race', 'T003', { claimId: 'claim-overlap', client: 'claude-code' }),
    (error) => error.code === OPENPRD_WRITE_SET_CONFLICT
      && error.details.conflictingTaskId === 'T001',
  );
});

test('heartbeat from an expired generation cannot overwrite its replacement claim', async () => {
  const { runtime, advance } = await fixture();
  await runtime.createLane({
    laneId: 'generation-race',
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });

  const oldClaim = await runtime.claimTask('generation-race', 'T001', {
    claimId: 'old-claim',
    client: 'cursor',
    leaseDurationMs: 25,
  });
  advance(26);
  await runtime.recoverExpired('generation-race');
  const newClaim = await runtime.claimTask('generation-race', 'T001', {
    claimId: 'new-claim',
    client: 'codex',
    leaseDurationMs: 1_000,
  });

  await assert.rejects(
    () => runtime.heartbeatTask('generation-race', 'T001', oldClaim.claim, { leaseDurationMs: 10_000 }),
    (error) => error.code === OPENPRD_TASK_ALREADY_CLAIMED
      && error.details.activeClaimId === 'new-claim'
      && error.details.reason === 'claim-mismatch',
  );

  const stored = await runtime.getLane('generation-race');
  assert.equal(stored.tasks.T001.claim.claimId, 'new-claim');
  assert.equal(stored.tasks.T001.claim.generation, 2);
  assert.equal(stored.tasks.T001.claim.leaseExpiresAt, newClaim.claim.leaseExpiresAt);
  assert.equal(stored.tasks.T001.claim.heartbeatSequence, 0);
});

test('concurrent finish retries are idempotent and increment revision once', async () => {
  const { runtime } = await fixture();
  await runtime.createLane({
    laneId: 'finish-race',
    tasks: [{ taskId: 'T001', writeSet: ['src/runtime/**'] }],
  });
  const claimed = await runtime.claimTask('finish-race', 'T001', {
    claimId: 'finish-once',
    client: 'codex',
  });

  const results = await Promise.all(Array.from({ length: 20 }, () => (
    runtime.finishTask('finish-race', 'T001', claimed.claim, { result: { tests: 'passed' } })
  )));
  assert.equal(results.filter((result) => result.idempotent === false).length, 1);
  assert.equal(results.filter((result) => result.idempotent === true).length, 19);

  const stored = await runtime.getLane('finish-race');
  assert.equal(stored.tasks.T001.status, 'completed');
  assert.equal(stored.tasks.T001.revision, 2);
  assert.deepEqual(stored.tasks.T001.result, { tests: 'passed' });
});
