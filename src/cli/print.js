/*
 * 核心功能
 * 汇总 OpenPrd CLI 各子模块的终端输出函数，并保持对外 named exports 稳定。
 *
 * 输入
 * 接收各 CLI 子模块导出的打印函数集合。
 *
 * 输出
 * 作为统一 barrel 对外导出基础、工作流、诊断、运行、质量、growth、change 与 benchmark 输出函数。
 *
 * 定位
 * 位于 CLI 表现层的汇总入口，不再承载具体格式化逻辑。
 *
 * 依赖
 * 依赖同目录下的分域 print 模块。
 *
 * 维护规则
 * 新增打印函数时优先放入对应子模块，再由这里补充导出，避免 barrel 重新膨胀。
 */
import {
  printCaptureResult,
  printClarifyResult,
  printClassifyResult,
  printInitResult,
  printInterviewResult,
  printLearningResult,
  printPlaygroundResult,
  printReleaseResult,
  printStatus,
  printValidation,
} from './basic-print.js';
import { printBenchmarkResult } from './benchmark-print.js';
import { printCanvasResult } from './canvas-print.js';
import {
  printAcceptedSpecsResult,
  printOpenPrdChangeActionResult,
  printOpenPrdChangesResult,
  printOpenSpecChangeValidationResult,
  printOpenSpecDiscoveryResult,
  printOpenSpecGenerateResult,
  printOpenSpecTaskResult,
} from './change-print.js';
import {
  printAgentIntegrationResult,
  printDoctorResult,
  printFleetResult,
  printSelfUpdateResult,
  printUpgradeResult,
} from './doctor-print.js';
import { printGrowthResult } from './growth-print.js';
import {
  printDesignStarterResult,
  printDevelopmentStandardsResult,
  printKnowledgeResult,
  printQualityResult,
  printVisualPrepareResult,
  printStandardsResult,
  printVisualCompareResult,
} from './quality-print.js';
import {
  printLoopResult,
  printRunResult,
} from './run-print.js';
import {
  printBrainstormResult,
  printDiagramResult,
  printDiffResult,
  printFreezeResult,
  printHandoffResult,
  printHistoryResult,
  printNextResult,
  printReviewResult,
  printSynthesizeResult,
} from './workflow-print.js';

export {
  printValidation,
  printStatus,
  printClassifyResult,
  printClarifyResult,
  printCaptureResult,
  printInterviewResult,
  printPlaygroundResult,
  printLearningResult,
  printReleaseResult,
  printSynthesizeResult,
  printBrainstormResult,
  printReviewResult,
  printHistoryResult,
  printDiffResult,
  printNextResult,
  printInitResult,
  printAgentIntegrationResult,
  printDoctorResult,
  printFleetResult,
  printSelfUpdateResult,
  printUpgradeResult,
  printRunResult,
  printLoopResult,
  printStandardsResult,
  printDevelopmentStandardsResult,
  printDesignStarterResult,
  printGrowthResult,
  printQualityResult,
  printKnowledgeResult,
  printVisualPrepareResult,
  printVisualCompareResult,
  printFreezeResult,
  printDiagramResult,
  printHandoffResult,
  printOpenSpecDiscoveryResult,
  printOpenSpecChangeValidationResult,
  printOpenSpecGenerateResult,
  printOpenSpecTaskResult,
  printOpenPrdChangesResult,
  printOpenPrdChangeActionResult,
  printAcceptedSpecsResult,
  printBenchmarkResult,
  printCanvasResult,
};
