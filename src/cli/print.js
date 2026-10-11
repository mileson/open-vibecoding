/* CLI presentation exports for current capabilities and read-only history. */
export {
  printValidation,
  printStatus,
  printLearningResult,
  printInitResult,
  printReleaseResult,
} from './basic-print.js';
export { printBenchmarkResult } from './benchmark-print.js';
export { printCanvasResult } from './canvas-print.js';
export {
  printAcceptedSpecsResult,
  printOpenPrdChangesResult,
  printOpenSpecChangeValidationResult,
  printOpenSpecTaskResult,
} from './change-print.js';
export {
  printAgentIntegrationResult,
  printDoctorResult,
  printFleetResult,
  printSelfUpdateResult,
  printUpgradeResult,
} from './doctor-print.js';
export { printGrowthResult } from './growth-print.js';
export {
  printDesignStarterResult,
  printDevelopmentStandardsResult,
  printKnowledgeResult,
  printQualityResult,
  printVisualPrepareResult,
  printStandardsResult,
  printVisualCompareResult,
} from './quality-print.js';
export { printRunResult } from './run-print.js';
export {
  printBrainstormResult,
  printDiagramResult,
  printDiffResult,
  printHistoryResult,
} from './workflow-print.js';
