/*
 * 核心功能
 * 将 Lane/Task Runtime 公共 API 暴露为稳定 CLI workspace 契约。
 *
 * 输入
 * 接收 action、lane/task、claim/lease、write-set 与客户端绑定信息。
 *
 * 输出
 * 返回结构化运行时结果与稳定错误码，供 Codex、Claude Code、Cursor 共用。
 *
 * 定位
 * 位于 CLI 应用层与 runtime 领域层之间，不实现锁和 claim 规则。
 *
 * 维护规则
 * 新 action 必须保留 JSON 返回字段与退出码兼容；所有测试必须使用临时项目目录。
 */

import path from 'node:path';
import { ensureProjectManifest, readProjectManifest } from '../kernel/index.js';
import { TaskRuntime } from './task-runtime.js';

const MUTATING_ACTIONS = new Set([
  'create-lane',
  'ensure-lane',
  'add-task',
  'claim',
  'heartbeat',
  'release',
  'finish',
  'recover',
]);

function list(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function required(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError(`runtime ${label} is required.`);
  return normalized;
}

function number(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError('runtime numeric option must be finite.');
  return parsed;
}

function runtimeRoot(projectRoot) {
  return path.join(path.resolve(projectRoot), '.openprd', 'runtime');
}

async function taskRuntimeWorkspaceImpl(projectRoot, options = {}) {
  const action = String(options.action ?? 'status').trim() || 'status';
  if (MUTATING_ACTIONS.has(action)) await ensureProjectManifest(projectRoot);
  else await readProjectManifest(projectRoot, { mode: 'read' });
  const runtime = new TaskRuntime(runtimeRoot(projectRoot), {
    defaultLeaseDurationMs: number(options.leaseDurationMs) ?? 300_000,
  });
  const laneId = options.laneId ?? options.lane;
  const taskId = options.taskId ?? options.task;
  let result;

  if (action === 'status') {
    result = laneId ? await runtime.getLane(laneId) : await runtime.listLanes();
  } else if (action === 'create-lane' || action === 'ensure-lane') {
    const input = {
      laneId: required(laneId, 'lane'),
      title: options.title ?? laneId,
      tasks: options.tasks ?? [],
      metadata: options.metadata ?? {},
    };
    result = action === 'create-lane'
      ? await runtime.createLane(input)
      : await runtime.ensureLane(input);
  } else if (action === 'add-task') {
    result = await runtime.addTask(required(laneId, 'lane'), {
      taskId: required(taskId, 'task'),
      title: options.title ?? taskId,
      writeSet: list(options.writeSet),
      metadata: options.metadata ?? {},
    }, {
      expectedLaneRevision: number(options.expectedLaneRevision),
    });
  } else if (action === 'claim') {
    result = await runtime.claimTask(required(laneId, 'lane'), required(taskId, 'task'), {
      claimId: options.claimId,
      client: options.client ?? options.agent,
      session: options.session,
      thread: options.thread,
      worktree: options.worktree,
      branch: options.branch,
      baseCommit: options.baseCommit,
      evidence: options.evidence,
      writeSet: list(options.writeSet),
      leaseDurationMs: number(options.leaseDurationMs),
      expectedRevision: number(options.expectedRevision),
      expectedLaneRevision: number(options.expectedLaneRevision),
    });
  } else if (action === 'heartbeat') {
    result = await runtime.heartbeatTask(
      required(laneId, 'lane'),
      required(taskId, 'task'),
      required(options.claimId, 'claim-id'),
      {
      evidence: options.evidence,
      leaseDurationMs: number(options.leaseDurationMs),
      expectedRevision: number(options.expectedRevision),
      expectedLaneRevision: number(options.expectedLaneRevision),
      },
    );
  } else if (action === 'release') {
    result = await runtime.releaseTask(
      required(laneId, 'lane'),
      required(taskId, 'task'),
      required(options.claimId, 'claim-id'),
      {
      reason: options.reason,
      evidence: options.evidence,
      expectedRevision: number(options.expectedRevision),
      expectedLaneRevision: number(options.expectedLaneRevision),
      },
    );
  } else if (action === 'finish') {
    result = await runtime.finishTask(
      required(laneId, 'lane'),
      required(taskId, 'task'),
      required(options.claimId, 'claim-id'),
      {
      status: options.status ?? 'completed',
      result: options.result ?? null,
      evidence: options.evidence,
      expectedRevision: number(options.expectedRevision),
      expectedLaneRevision: number(options.expectedLaneRevision),
      },
    );
  } else if (action === 'recover') {
    result = await runtime.recoverExpired(required(laneId, 'lane'), {
      ...(taskId ? { taskId } : {}),
      expectedLaneRevision: number(options.expectedLaneRevision),
    });
  } else {
    throw new TypeError(`Unsupported runtime action: ${action}`);
  }

  return {
    ok: true,
    action: `runtime-${action}`,
    projectRoot: path.resolve(projectRoot),
    runtimeRoot: runtimeRoot(projectRoot),
    laneId: laneId ?? result?.laneId ?? null,
    taskId: taskId ?? result?.task?.taskId ?? null,
    result,
  };
}

async function taskRuntimeWorkspace(projectRoot, options = {}) {
  try {
    return await taskRuntimeWorkspaceImpl(projectRoot, options);
  } catch (error) {
    return {
      ok: false,
      action: `runtime-${options.action ?? 'status'}`,
      projectRoot: path.resolve(projectRoot),
      runtimeRoot: runtimeRoot(projectRoot),
      laneId: options.laneId ?? options.lane ?? null,
      taskId: options.taskId ?? options.task ?? null,
      error: {
        code: error?.code ?? 'OPENPRD_RUNTIME_ERROR',
        message: error instanceof Error ? error.message : String(error),
        details: Object.fromEntries(Object.entries(error ?? {}).filter(([key]) => key !== 'stack')),
      },
    };
  }
}

export { MUTATING_ACTIONS, runtimeRoot, taskRuntimeWorkspace, taskRuntimeWorkspaceImpl };
