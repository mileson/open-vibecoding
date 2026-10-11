/*
 * ## 核心功能
 * 为 Lane/Task Runtime 提供稳定、可机器判断的结构化错误契约。
 *
 * ## 输入
 * 接收错误码、面向人的错误说明，以及冲突任务、claim 或 revision 等诊断细节。
 *
 * ## 输出
 * 导出带 code/details/toJSON 的 OpenPrdRuntimeError 与三类并发冲突构造器。
 *
 * ## 定位
 * 位于 runtime 子系统的协议边界，不负责存储、重试或冲突判定。
 *
 * ## 依赖
 * 仅依赖 JavaScript Error 基类，不依赖第三方包。
 *
 * ## 维护规则
 * 错误码属于跨 CLI、Hook 与 Adapter 的稳定协议；新增错误时保持旧 code 与 details 字段兼容。
 */

export const OPEN_VIBECODING_TASK_ALREADY_CLAIMED = 'OPEN_VIBECODING_TASK_ALREADY_CLAIMED';
export const OPEN_VIBECODING_WRITE_SET_CONFLICT = 'OPEN_VIBECODING_WRITE_SET_CONFLICT';
export const OPEN_VIBECODING_REVISION_CONFLICT = 'OPEN_VIBECODING_REVISION_CONFLICT';

export class OpenPrdRuntimeError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = 'OpenPrdRuntimeError';
    this.code = code;
    this.details = structuredClone(details ?? {});
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: structuredClone(this.details),
    };
  }
}

export function taskAlreadyClaimedError(details = {}) {
  const taskId = details.taskId ? ` ${details.taskId}` : '';
  return new OpenPrdRuntimeError(
    OPEN_VIBECODING_TASK_ALREADY_CLAIMED,
    `Open VibeCoding task${taskId} is already claimed or the supplied claim is no longer current.`,
    details,
  );
}

export function writeSetConflictError(details = {}) {
  return new OpenPrdRuntimeError(
    OPEN_VIBECODING_WRITE_SET_CONFLICT,
    'Open VibeCoding cannot claim this task because its write-set overlaps an active claim.',
    details,
  );
}

export function revisionConflictError(details = {}) {
  return new OpenPrdRuntimeError(
    OPEN_VIBECODING_REVISION_CONFLICT,
    `Open VibeCoding revision conflict: expected ${details.expectedRevision}, current ${details.actualRevision}.`,
    details,
  );
}
