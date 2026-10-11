/*
 * 核心功能
 * 作为 benchmark 子系统的对外入口，组装 add/observe/list/approve/verify 与摘要渲染能力。
 *
 * 输入
 * 接收项目根目录和 benchmark action/options，并分发到对应职责模块。
 *
 * 输出
 * 导出保持兼容的 benchmark workspace API、registry 渲染函数和共享常量。
 *
 * 定位
 * 位于 Open VibeCoding CLI 应用边界，只负责模块拼装与 action 路由，不再承载具体 benchmark 细节实现。
 *
 * 依赖
 * 依赖 benchmark 子目录中的 operations、verify、registry、storage 和 constants 模块。
 *
 * 维护规则
 * 对外导出名称和返回契约必须保持稳定；新增职责优先放入子模块，再由这里做薄组装。
 */
import {
  addBenchmarkWorkspace,
  approveBenchmarkWorkspace,
  listBenchmarkRecommendationsWorkspace,
  listBenchmarkWorkspace,
  observeBenchmarkSourceWorkspace,
} from './benchmark/operations.js';
import { renderApprovedBenchmarkRegistrySection } from './benchmark/registry.js';
import { verifyBenchmarkWorkspace } from './benchmark/verify.js';
import { ensureBenchmarkWorkspace } from './benchmark/storage.js';
import {
  BENCHMARK_DIR,
  BENCHMARK_EVIDENCE_DIR,
  BENCHMARK_INDEX_FILE,
  BENCHMARK_INBOX_DIR,
  BENCHMARK_SOURCES_FILE,
  DEFAULT_ADOPTION_THRESHOLD,
} from './benchmark/constants.js';

async function benchmarkWorkspace(projectRoot, options = {}) {
  const action = options.action ?? 'list';
  if (action === 'add') {
    return addBenchmarkWorkspace(projectRoot, options);
  }
  if (action === 'approve') {
    return approveBenchmarkWorkspace(projectRoot, options);
  }
  if (action === 'observe') {
    return observeBenchmarkSourceWorkspace(projectRoot, options);
  }
  if (action === 'verify') {
    return verifyBenchmarkWorkspace(projectRoot, options);
  }
  return listBenchmarkWorkspace(projectRoot, options);
}

export {
  addBenchmarkWorkspace,
  approveBenchmarkWorkspace,
  BENCHMARK_DIR,
  BENCHMARK_EVIDENCE_DIR,
  BENCHMARK_INDEX_FILE,
  BENCHMARK_INBOX_DIR,
  BENCHMARK_SOURCES_FILE,
  benchmarkWorkspace,
  DEFAULT_ADOPTION_THRESHOLD,
  ensureBenchmarkWorkspace,
  listBenchmarkRecommendationsWorkspace,
  listBenchmarkWorkspace,
  observeBenchmarkSourceWorkspace,
  renderApprovedBenchmarkRegistrySection,
  verifyBenchmarkWorkspace,
};
