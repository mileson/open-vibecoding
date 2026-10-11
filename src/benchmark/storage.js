/*
 * 核心功能
 * 管理 benchmark 工作区目录、approved/candidate 文件读取和索引落盘。
 *
 * 输入
 * 接收项目根目录以及来源列表，用于创建、读取和刷新 `.open-vibecoding/benchmarks`。
 *
 * 输出
 * 导出 benchmark workspace 初始化、source 文件路径和持久化读写能力。
 *
 * 定位
 * 位于 benchmark IO 边界，负责文件系统交互，不承载信源推断或 verify 规则。
 *
 * 依赖
 * 依赖 node:fs/promises、fs-utils、time，以及 render/source 提供的纯逻辑能力。
 *
 * 维护规则
 * 变更文件布局或落盘格式时必须兼容现有 `.open-vibecoding/benchmarks` 目录和已生成 yaml/md 文件。
 */
import fs from 'node:fs/promises';
import { cjoin, exists, readYaml, writeText, writeYaml } from '../fs-utils.js';
import { timestamp } from '../time.js';
import {
  BENCHMARK_EVIDENCE_DIR,
  BENCHMARK_INDEX_FILE,
  BENCHMARK_INBOX_DIR,
  BENCHMARK_SOURCES_FILE,
  benchmarkPath,
  defaultIndex,
  defaultSourcesFile,
} from './constants.js';
import { renderBenchmarkIndex } from './render.js';
import { normalizeSourceRecord } from './source.js';

async function ensureOpenPrdWorkspace(projectRoot) {
  const workspaceRoot = cjoin(projectRoot, '.open-vibecoding');
  if (!(await exists(workspaceRoot))) {
    throw new Error('Project is not initialized with Open VibeCoding. Run `open-vibecoding init .` first.');
  }
}

async function ensureBenchmarkWorkspace(projectRoot) {
  await ensureOpenPrdWorkspace(projectRoot);
  await fs.mkdir(benchmarkPath(projectRoot, BENCHMARK_INBOX_DIR), { recursive: true });
  await fs.mkdir(benchmarkPath(projectRoot, BENCHMARK_EVIDENCE_DIR), { recursive: true });
  if (!(await exists(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE)))) {
    await writeYaml(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE), defaultSourcesFile());
  }
  if (!(await exists(benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE)))) {
    await writeText(benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE), `${defaultIndex()}\n`);
  }
}

async function loadApprovedSources(projectRoot) {
  const payload = await readYaml(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE)).catch(() => defaultSourcesFile());
  return Array.isArray(payload.sources) ? payload.sources.map(normalizeSourceRecord) : [];
}

async function loadCandidateSources(projectRoot) {
  const inboxDir = benchmarkPath(projectRoot, BENCHMARK_INBOX_DIR);
  const entries = await fs.readdir(inboxDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(yaml|yml)$/i.test(entry.name)) {
      continue;
    }
    const filePath = cjoin(inboxDir, entry.name);
    const payload = await readYaml(filePath).catch(() => null);
    if (payload && typeof payload === 'object') {
      candidates.push(normalizeSourceRecord(payload));
    }
  }
  return candidates.sort((left, right) => left.id.localeCompare(right.id));
}

function sourceFilePath(projectRoot, id) {
  return benchmarkPath(projectRoot, cjoin(BENCHMARK_INBOX_DIR, `${id}.yaml`));
}

function evidenceFilePath(projectRoot, id) {
  return benchmarkPath(projectRoot, cjoin(BENCHMARK_EVIDENCE_DIR, `${id}.md`));
}

async function writeApprovedSources(projectRoot, sources) {
  const next = {
    ...defaultSourcesFile(),
    updatedAt: timestamp(),
    sources: sources
      .map(normalizeSourceRecord)
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
  await writeYaml(benchmarkPath(projectRoot, BENCHMARK_SOURCES_FILE), next);
}

async function refreshBenchmarkIndex(projectRoot) {
  const approved = await loadApprovedSources(projectRoot);
  const candidates = await loadCandidateSources(projectRoot);
  await writeText(benchmarkPath(projectRoot, BENCHMARK_INDEX_FILE), renderBenchmarkIndex(approved, candidates));
  return { approved, candidates };
}

async function readCandidateById(projectRoot, id) {
  const filePath = sourceFilePath(projectRoot, id);
  if (!(await exists(filePath))) {
    return null;
  }
  const payload = await readYaml(filePath);
  return normalizeSourceRecord(payload);
}

export {
  ensureBenchmarkWorkspace,
  ensureOpenPrdWorkspace,
  evidenceFilePath,
  loadApprovedSources,
  loadCandidateSources,
  readCandidateById,
  refreshBenchmarkIndex,
  sourceFilePath,
  writeApprovedSources,
};
