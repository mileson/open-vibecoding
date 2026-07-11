/*
 * ## 核心功能
 * 提供可跨 Agent/进程安全竞争的 Task claim、租约心跳、释放、完成与过期恢复流程。
 *
 * ## 输入
 * 接收 lane/task 标识、claim 绑定信息、write-set、lease、expectedRevision 与完成证据。
 *
 * ## 输出
 * 导出 TaskRuntime；所有变更返回最新 lane/task/claim revision，冲突返回结构化错误码。
 *
 * ## 定位
 * 位于 runtime 领域层，在 LaneStore 原子事务之上实现任务所有权和并行写范围规则。
 *
 * ## 依赖
 * 依赖 Node.js crypto，以及同目录 lane-store、lane-schema、write-set、errors 模块。
 *
 * ## 维护规则
 * claim token 与 task revision 校验顺序不可弱化；过期或旧 claim 的 heartbeat 永远不能覆盖新 claim。
 */

import crypto from 'node:crypto';

import {
  revisionConflictError,
  taskAlreadyClaimedError,
  writeSetConflictError,
} from './errors.js';
import { createTaskState, isoTime, normalizeRuntimeId } from './lane-schema.js';
import { LaneStore } from './lane-store.js';
import { explainWriteSetIntersection, normalizeWriteSet } from './write-set.js';

const FINISH_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function clone(value) {
  return structuredClone(value);
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeEvidence(value) {
  if (value === null || value === undefined) return [];
  return clone(Array.isArray(value) ? value : [value]);
}

function mergeEvidence(...lists) {
  return lists.flatMap((value) => normalizeEvidence(value));
}

function milliseconds(value) {
  if (typeof value === 'string') return Date.parse(value);
  if (value instanceof Date) return value.valueOf();
  return Number(value);
}

function requirePositiveDuration(value, label = 'leaseDurationMs') {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`OpenPrd ${label} must be a positive number.`);
  return Math.round(number);
}

function taskFrom(lane, taskIdValue) {
  const taskId = normalizeRuntimeId(taskIdValue, 'taskId');
  if (!Object.hasOwn(lane.tasks, taskId)) {
    const error = new Error(`OpenPrd task not found: ${lane.laneId}/${taskId}`);
    error.code = 'ENOENT';
    throw error;
  }
  return lane.tasks[taskId];
}

function claimIdFrom(value) {
  const claimId = normalizeOptionalText(
    typeof value === 'string' ? value : (value?.claimId ?? value?.token),
  );
  if (!claimId) throw new TypeError('OpenPrd claimId is required.');
  return claimId;
}

function claimBinding(options) {
  const client = normalizeOptionalText(options.client ?? options.clientId);
  const session = normalizeOptionalText(options.session ?? options.sessionId);
  const thread = normalizeOptionalText(options.thread ?? options.threadId);
  return {
    client,
    clientId: client,
    session,
    sessionId: session,
    thread,
    threadId: thread,
    worktree: normalizeOptionalText(options.worktree ?? options.worktreePath),
    branch: normalizeOptionalText(options.branch),
    baseCommit: normalizeOptionalText(options.baseCommit),
    evidence: normalizeEvidence(options.evidence),
  };
}

function activeClaim(task, nowMs) {
  return task.status === 'claimed'
    && task.claim
    && milliseconds(task.claim.leaseExpiresAt) > nowMs;
}

function revisionCheck(laneId, task, expectedRevision, operation) {
  if (expectedRevision === undefined || expectedRevision === task.revision) return;
  throw revisionConflictError({
    laneId,
    taskId: task.taskId,
    expectedRevision,
    actualRevision: task.revision,
    operation,
  });
}

function assertCurrentClaim(lane, task, claimId, nowMs, operation) {
  if (!task.claim || task.claim.claimId !== claimId) {
    throw taskAlreadyClaimedError({
      laneId: lane.laneId,
      taskId: task.taskId,
      suppliedClaimId: claimId,
      activeClaimId: task.claim?.claimId ?? null,
      activeBinding: task.claim ? claimBinding(task.claim) : null,
      reason: task.claim ? 'claim-mismatch' : 'claim-not-active',
      operation,
    });
  }
  if (!activeClaim(task, nowMs)) {
    throw taskAlreadyClaimedError({
      laneId: lane.laneId,
      taskId: task.taskId,
      suppliedClaimId: claimId,
      activeClaimId: task.claim.claimId,
      leaseExpiresAt: task.claim.leaseExpiresAt,
      reason: 'lease-expired',
      operation,
    });
  }
  return task.claim;
}

function recoverExpiredClaims(lane, nowMs, nowIso, onlyTaskId = null) {
  const recovered = [];
  for (const task of Object.values(lane.tasks)) {
    if (onlyTaskId !== null && task.taskId !== onlyTaskId) continue;
    if (task.status !== 'claimed' || !task.claim) continue;
    if (milliseconds(task.claim.leaseExpiresAt) > nowMs) continue;
    const expiredClaim = clone(task.claim);
    task.status = 'pending';
    task.claim = null;
    task.lastClaim = {
      ...expiredClaim,
      outcome: 'expired',
      endedAt: nowIso,
    };
    task.revision += 1;
    task.updatedAt = nowIso;
    recovered.push({
      taskId: task.taskId,
      claimId: expiredClaim.claimId,
      generation: expiredClaim.generation,
      leaseExpiresAt: expiredClaim.leaseExpiresAt,
      revision: task.revision,
    });
  }
  return recovered;
}

function taskResult(transaction, taskId, extra = {}) {
  return {
    laneId: transaction.lane.laneId,
    laneRevision: transaction.lane.revision,
    task: clone(transaction.lane.tasks[taskId]),
    ...extra,
  };
}

export class TaskRuntime {
  constructor(rootOrStore, options = {}) {
    this.store = rootOrStore instanceof LaneStore
      ? rootOrStore
      : new LaneStore(rootOrStore, options);
    this.clock = options.clock ?? this.store.clock;
    this.defaultLeaseDurationMs = requirePositiveDuration(options.defaultLeaseDurationMs ?? 300_000);
  }

  nowMs() {
    const now = milliseconds(this.clock.now());
    if (!Number.isFinite(now)) throw new TypeError('OpenPrd runtime clock returned an invalid time.');
    return now;
  }

  createLane(input) {
    return this.store.create(input);
  }

  ensureLane(input) {
    return this.store.ensure(input);
  }

  getLane(laneId) {
    return this.store.read(laneId);
  }

  listLanes() {
    return this.store.list();
  }

  async addTask(laneId, input, options = {}) {
    const nowMs = this.nowMs();
    const task = createTaskState(input, nowMs);
    const transaction = await this.store.transact(laneId, {
      expectedRevision: options.expectedLaneRevision,
      operation: 'add-task',
    }, (lane) => {
      if (Object.hasOwn(lane.tasks, task.taskId)) {
        throw revisionConflictError({
          laneId: lane.laneId,
          taskId: task.taskId,
          expectedRevision: -1,
          actualRevision: lane.tasks[task.taskId].revision,
          operation: 'add-task',
        });
      }
      lane.tasks[task.taskId] = task;
      return { result: { taskId: task.taskId } };
    });
    return taskResult(transaction, task.taskId);
  }

  async claimTask(laneId, taskIdValue, options = {}) {
    const taskId = normalizeRuntimeId(taskIdValue, 'taskId');
    const nowMs = this.nowMs();
    const nowIso = isoTime(nowMs);
    const leaseDurationMs = requirePositiveDuration(options.leaseDurationMs ?? this.defaultLeaseDurationMs);
    const transaction = await this.store.transact(laneId, {
      expectedRevision: options.expectedLaneRevision,
      operation: 'claim-task',
    }, (lane) => {
      const recovered = recoverExpiredClaims(lane, nowMs, nowIso);
      const task = taskFrom(lane, taskId);
      revisionCheck(lane.laneId, task, options.expectedRevision, 'claim-task');

      if (activeClaim(task, nowMs)) {
        throw taskAlreadyClaimedError({
          laneId: lane.laneId,
          taskId,
          activeClaimId: task.claim.claimId,
          activeBinding: claimBinding(task.claim),
          leaseExpiresAt: task.claim.leaseExpiresAt,
          reason: 'active-claim',
          operation: 'claim-task',
        });
      }
      if (task.status !== 'pending') {
        throw taskAlreadyClaimedError({
          laneId: lane.laneId,
          taskId,
          activeClaimId: null,
          taskStatus: task.status,
          reason: 'terminal-task',
          operation: 'claim-task',
        });
      }

      const writeSet = normalizeWriteSet(options.writeSet ?? task.writeSet);
      for (const otherTask of Object.values(lane.tasks)) {
        if (otherTask.taskId === taskId || !activeClaim(otherTask, nowMs)) continue;
        const comparison = explainWriteSetIntersection(writeSet, otherTask.claim.writeSet ?? otherTask.writeSet);
        if (!comparison.intersects) continue;
        throw writeSetConflictError({
          laneId: lane.laneId,
          taskId,
          writeSet,
          conflictingTaskId: otherTask.taskId,
          conflictingClaimId: otherTask.claim.claimId,
          conflictingBinding: claimBinding(otherTask.claim),
          conflictingWriteSet: otherTask.claim.writeSet ?? otherTask.writeSet,
          overlap: {
            requestedPattern: comparison.leftPattern,
            activePattern: comparison.rightPattern,
            overlapPattern: comparison.overlapPattern,
            conservative: comparison.conservative,
          },
        });
      }

      task.claimGeneration += 1;
      task.attemptCount += 1;
      const claim = {
        claimId: normalizeOptionalText(options.claimId) ?? crypto.randomUUID(),
        generation: task.claimGeneration,
        ...claimBinding(options),
        writeSet,
        claimedAt: nowIso,
        heartbeatAt: nowIso,
        heartbeatSequence: 0,
        leaseDurationMs,
        leaseExpiresAt: isoTime(nowMs + leaseDurationMs),
      };
      task.status = 'claimed';
      task.claim = claim;
      task.revision += 1;
      task.updatedAt = nowIso;
      return { result: { claim: clone(claim), recovered } };
    });
    return taskResult(transaction, taskId, {
      claim: clone(transaction.result.claim),
      recovered: clone(transaction.result.recovered),
    });
  }

  async heartbeatTask(laneId, taskIdValue, claimValue, options = {}) {
    const taskId = normalizeRuntimeId(taskIdValue, 'taskId');
    const claimId = claimIdFrom(claimValue);
    const nowMs = this.nowMs();
    const nowIso = isoTime(nowMs);
    const transaction = await this.store.transact(laneId, {
      expectedRevision: options.expectedLaneRevision,
      operation: 'heartbeat-task',
    }, (lane) => {
      const task = taskFrom(lane, taskId);
      const claim = assertCurrentClaim(lane, task, claimId, nowMs, 'heartbeat-task');
      revisionCheck(lane.laneId, task, options.expectedRevision, 'heartbeat-task');
      const leaseDurationMs = requirePositiveDuration(options.leaseDurationMs ?? claim.leaseDurationMs);
      claim.heartbeatAt = nowIso;
      claim.heartbeatSequence = Number(claim.heartbeatSequence ?? 0) + 1;
      claim.leaseDurationMs = leaseDurationMs;
      claim.leaseExpiresAt = isoTime(nowMs + leaseDurationMs);
      if (options.evidence !== undefined) {
        claim.evidence = mergeEvidence(claim.evidence, options.evidence);
      }
      task.revision += 1;
      task.updatedAt = nowIso;
      return { result: { claim: clone(claim) } };
    });
    return taskResult(transaction, taskId, { claim: clone(transaction.result.claim) });
  }

  async releaseTask(laneId, taskIdValue, claimValue, options = {}) {
    const taskId = normalizeRuntimeId(taskIdValue, 'taskId');
    const claimId = claimIdFrom(claimValue);
    const nowMs = this.nowMs();
    const nowIso = isoTime(nowMs);
    const transaction = await this.store.transact(laneId, {
      expectedRevision: options.expectedLaneRevision,
      operation: 'release-task',
    }, (lane) => {
      const task = taskFrom(lane, taskId);
      if (!task.claim && task.lastClaim?.claimId === claimId && task.lastClaim?.outcome === 'released') {
        return { changed: false, result: { idempotent: true } };
      }
      const claim = assertCurrentClaim(lane, task, claimId, nowMs, 'release-task');
      revisionCheck(lane.laneId, task, options.expectedRevision, 'release-task');
      task.status = 'pending';
      task.claim = null;
      task.lastClaim = {
        ...clone(claim),
        outcome: 'released',
        reason: normalizeOptionalText(options.reason),
        evidence: mergeEvidence(claim.evidence, options.evidence),
        endedAt: nowIso,
      };
      task.revision += 1;
      task.updatedAt = nowIso;
      return { result: { idempotent: false } };
    });
    return taskResult(transaction, taskId, { idempotent: transaction.result.idempotent });
  }

  async finishTask(laneId, taskIdValue, claimValue, options = {}) {
    const taskId = normalizeRuntimeId(taskIdValue, 'taskId');
    const claimId = claimIdFrom(claimValue);
    const nowMs = this.nowMs();
    const nowIso = isoTime(nowMs);
    const finishStatus = options.status ?? 'completed';
    if (!FINISH_STATUSES.has(finishStatus)) throw new TypeError(`Unsupported OpenPrd finish status: ${finishStatus}`);

    const transaction = await this.store.transact(laneId, {
      expectedRevision: options.expectedLaneRevision,
      operation: 'finish-task',
    }, (lane) => {
      const task = taskFrom(lane, taskId);
      const previous = task.lastClaim;
      if (!task.claim && previous?.claimId === claimId && previous?.outcome === 'finished') {
        if ((options.status !== undefined && previous.status !== finishStatus)
          || (options.result !== undefined && JSON.stringify(previous.result) !== JSON.stringify(options.result))) {
          throw revisionConflictError({
            laneId: lane.laneId,
            taskId,
            expectedRevision: options.expectedRevision ?? task.revision,
            actualRevision: task.revision,
            operation: 'finish-task',
            reason: 'idempotent-payload-mismatch',
          });
        }
        return { changed: false, result: { idempotent: true } };
      }

      const claim = assertCurrentClaim(lane, task, claimId, nowMs, 'finish-task');
      revisionCheck(lane.laneId, task, options.expectedRevision, 'finish-task');
      const evidence = mergeEvidence(claim.evidence, options.evidence);
      const result = clone(options.result ?? null);
      task.status = finishStatus;
      task.claim = null;
      task.result = result;
      task.evidence = mergeEvidence(task.evidence, evidence);
      task.lastClaim = {
        ...clone(claim),
        outcome: 'finished',
        status: finishStatus,
        result,
        evidence,
        endedAt: nowIso,
      };
      task.revision += 1;
      task.updatedAt = nowIso;
      return { result: { idempotent: false } };
    });
    return taskResult(transaction, taskId, { idempotent: transaction.result.idempotent });
  }

  async recoverExpired(laneId, options = {}) {
    const nowMs = this.nowMs();
    const nowIso = isoTime(nowMs);
    const onlyTaskId = options.taskId === undefined ? null : normalizeRuntimeId(options.taskId, 'taskId');
    const transaction = await this.store.transact(laneId, {
      expectedRevision: options.expectedLaneRevision,
      operation: 'recover-expired',
    }, (lane) => {
      if (onlyTaskId !== null) {
        const task = taskFrom(lane, onlyTaskId);
        revisionCheck(lane.laneId, task, options.expectedRevision, 'recover-expired');
      }
      const recovered = recoverExpiredClaims(lane, nowMs, nowIso, onlyTaskId);
      return recovered.length > 0
        ? { result: { recovered } }
        : { changed: false, result: { recovered: [] } };
    });
    return {
      laneId: transaction.lane.laneId,
      laneRevision: transaction.lane.revision,
      recovered: clone(transaction.result.recovered),
      changed: transaction.changed,
    };
  }
}
