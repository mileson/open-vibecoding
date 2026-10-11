/*
 * ## 核心功能
 * 汇总 Lane/Task Runtime 的稳定公共 API，供后续 CLI、Hook 与多工具 Adapter 接线。
 *
 * ## 输入
 * 无运行时输入；仅重导出 runtime 子模块的类、schema、错误和 write-set 函数。
 *
 * ## 输出
 * 对外提供 TaskRuntime、LaneStore、结构化错误码、schema 与路径交集判断 API。
 *
 * ## 定位
 * 位于 runtime 包入口，不承载业务逻辑或文件写入。
 *
 * ## 依赖
 * 依赖同目录 task-runtime、lane-store、lane-schema、errors、write-set 模块。
 *
 * ## 维护规则
 * 公共导出属于接线契约；重命名或删除前必须保留兼容别名并增加迁移测试。
 */

export {
  OPEN_VIBECODING_REVISION_CONFLICT,
  OPEN_VIBECODING_TASK_ALREADY_CLAIMED,
  OPEN_VIBECODING_WRITE_SET_CONFLICT,
  OpenPrdRuntimeError,
} from './errors.js';
export {
  assertLaneState,
  createLaneState,
  createTaskState,
  LANE_SCHEMA_VERSION,
  LANE_STATUSES,
  normalizeRuntimeId,
  TASK_STATUSES,
} from './lane-schema.js';
export { LaneStore } from './lane-store.js';
export { TaskRuntime } from './task-runtime.js';
export {
  BROAD_PATTERN,
  explainWriteSetIntersection,
  normalizeWritePattern,
  normalizeWriteSet,
  writeSetsIntersect,
} from './write-set.js';
