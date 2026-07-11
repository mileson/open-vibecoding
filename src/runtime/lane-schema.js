/*
 * ## 核心功能
 * 定义可持久化的 Lane、Task、Claim 数据形状并统一做输入规范化。
 *
 * ## 输入
 * 接收 lane 标识、任务清单、write-set、元数据与可注入的当前时间。
 *
 * ## 输出
 * 导出 schema 常量、ID 校验、lane 初始状态构造与已存状态校验函数。
 *
 * ## 定位
 * 位于 runtime 的纯数据层，不执行文件读写、锁竞争或租约续期。
 *
 * ## 依赖
 * 依赖同目录 write-set 模块；其余均为 JavaScript 内建能力。
 *
 * ## 维护规则
 * schemaVersion 升级必须提供向后读取策略；持久化字段不得静默改义或删除。
 */

import { normalizeWriteSet } from './write-set.js';

export const LANE_SCHEMA_VERSION = 1;
export const LANE_STATUSES = Object.freeze(['active', 'paused', 'completed']);
export const TASK_STATUSES = Object.freeze(['pending', 'claimed', 'completed', 'failed', 'cancelled']);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;

function cloneJson(value, fallback) {
  if (value === undefined) return fallback;
  return structuredClone(value);
}

function isoTime(value = Date.now()) {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
  }
  const numeric = value instanceof Date ? value.valueOf() : Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError('OpenPrd runtime clock must return a Date, ISO string, or epoch milliseconds.');
  return new Date(numeric).toISOString();
}

export function normalizeRuntimeId(value, label = 'id') {
  const normalized = String(value ?? '').trim();
  if (!ID_PATTERN.test(normalized) || ['__proto__', 'prototype', 'constructor'].includes(normalized)) {
    throw new TypeError(`OpenPrd ${label} must match ${ID_PATTERN} and cannot use a reserved object key.`);
  }
  return normalized;
}

function normalizeTaskInput(value, taskIdHint, now) {
  const source = typeof value === 'string' ? { taskId: value } : (value ?? {});
  const taskId = normalizeRuntimeId(source.taskId ?? source.id ?? taskIdHint, 'taskId');
  const status = source.status ?? 'pending';
  if (!TASK_STATUSES.includes(status) || status === 'claimed') {
    throw new TypeError(`OpenPrd task ${taskId} must start as pending, completed, failed, or cancelled.`);
  }
  return {
    taskId,
    title: String(source.title ?? taskId).trim() || taskId,
    status,
    revision: 0,
    claimGeneration: 0,
    attemptCount: 0,
    writeSet: normalizeWriteSet(source.writeSet ?? source.writeScope ?? source.paths),
    claim: null,
    lastClaim: null,
    result: cloneJson(source.result, null),
    evidence: cloneJson(source.evidence, []),
    metadata: cloneJson(source.metadata, {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function createTaskState(input, clockValue = Date.now(), taskIdHint = null) {
  return normalizeTaskInput(input, taskIdHint, isoTime(clockValue));
}

function taskEntries(tasks) {
  if (Array.isArray(tasks)) return tasks.map((task) => [null, task]);
  if (tasks && typeof tasks === 'object') return Object.entries(tasks);
  return [];
}

export function createLaneState(input, clockValue = Date.now()) {
  const source = input ?? {};
  const laneId = normalizeRuntimeId(source.laneId ?? source.id, 'laneId');
  const now = isoTime(clockValue);
  const tasks = {};
  for (const [taskIdHint, taskInput] of taskEntries(source.tasks)) {
    const task = normalizeTaskInput(taskInput, taskIdHint, now);
    if (Object.hasOwn(tasks, task.taskId)) throw new TypeError(`Duplicate OpenPrd taskId: ${task.taskId}`);
    tasks[task.taskId] = task;
  }
  const status = source.status ?? 'active';
  if (!LANE_STATUSES.includes(status)) throw new TypeError(`Unsupported OpenPrd lane status: ${status}`);
  return {
    schemaVersion: LANE_SCHEMA_VERSION,
    laneId,
    title: String(source.title ?? laneId).trim() || laneId,
    status,
    revision: 0,
    metadata: cloneJson(source.metadata, {}),
    tasks,
    createdAt: now,
    updatedAt: now,
  };
}

export function assertLaneState(value, expectedLaneId = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('OpenPrd lane state must be a JSON object.');
  }
  if (value.schemaVersion !== LANE_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported OpenPrd lane schemaVersion: ${value.schemaVersion}`);
  }
  const laneId = normalizeRuntimeId(value.laneId, 'laneId');
  if (expectedLaneId !== null && laneId !== normalizeRuntimeId(expectedLaneId, 'laneId')) {
    throw new TypeError(`OpenPrd lane file contains ${laneId}, expected ${expectedLaneId}.`);
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new TypeError(`OpenPrd lane ${laneId} has an invalid revision.`);
  }
  if (!value.tasks || typeof value.tasks !== 'object' || Array.isArray(value.tasks)) {
    throw new TypeError(`OpenPrd lane ${laneId} must contain a task object.`);
  }
  for (const [taskId, task] of Object.entries(value.tasks)) {
    normalizeRuntimeId(taskId, 'taskId');
    if (!task || task.taskId !== taskId || !TASK_STATUSES.includes(task.status)) {
      throw new TypeError(`OpenPrd lane ${laneId} contains an invalid task ${taskId}.`);
    }
    if (!Number.isSafeInteger(task.revision) || task.revision < 0) {
      throw new TypeError(`OpenPrd task ${taskId} has an invalid revision.`);
    }
  }
  return value;
}

export { isoTime };
