/*
 * 核心功能
 * 定义 benchmark 子系统共享常量、目录路径和默认 registry 模板。
 *
 * 输入
 * 接收项目根目录、路径片段和用于生成默认 sources/index 的当前时间。
 *
 * 输出
 * 导出 benchmark 工作区路径、采纳阈值常量、slugify 和默认文件内容生成器。
 *
 * 定位
 * 位于 benchmark 模块最底层，不处理业务判断，只提供稳定的共享基座。
 *
 * 依赖
 * 依赖 fs-utils 的路径拼接和 time 的时间戳工具；被 source、storage、operations 复用。
 *
 * 维护规则
 * 修改路径常量或默认模板时必须保持与已有 workspace 文件布局和 CLI 文案兼容。
 */
import { cjoin } from '../fs-utils.js';
import { timestamp } from '../time.js';

const BENCHMARK_DIR = cjoin('.open-vibecoding', 'benchmarks');
const BENCHMARK_INBOX_DIR = cjoin(BENCHMARK_DIR, 'inbox');
const BENCHMARK_EVIDENCE_DIR = cjoin(BENCHMARK_DIR, 'evidence');
const BENCHMARK_SOURCES_FILE = cjoin(BENCHMARK_DIR, 'sources.yaml');
const BENCHMARK_INDEX_FILE = cjoin(BENCHMARK_DIR, 'index.md');
const DEFAULT_ADOPTION_THRESHOLD = 3;
const DEFAULT_ADOPTION_WINDOW_DAYS = 7;
const MAX_ADOPTION_EVIDENCE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const OVERBROAD_TRIGGER_TOKENS = [
  'all',
  'any',
  'everything',
  'generic',
  'general',
  '所有',
  '任何',
  '全部',
  '通用',
  '任意任务',
  '任何任务',
  '所有任务',
];

function benchmarkPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function slugify(value, fallback = 'benchmark') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function defaultSourcesFile() {
  return {
    version: 1,
    schema: 'openprd.benchmarks.v1',
    updatedAt: timestamp(),
    sources: [],
  };
}

function defaultIndex() {
  return [
    '# Open VibeCoding Benchmark Registry',
    '',
    '## 规则',
    '',
    '- 项目级 approved benchmark 优先于 Open VibeCoding 内置 Source Map。',
    '- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。',
    '- 被采纳信源先用 `open-vibecoding benchmark observe <url|repo|file>` 累计证据，达到阈值后只推荐 approve，不自动晋级。',
    '- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。',
    '',
    '## Approved Sources',
    '',
    '- 暂无已批准来源。',
    '',
    '## Candidate Sources',
    '',
    '- 暂无待确认来源。',
    '',
  ].join('\n');
}

export {
  BENCHMARK_DIR,
  BENCHMARK_EVIDENCE_DIR,
  BENCHMARK_INDEX_FILE,
  BENCHMARK_INBOX_DIR,
  BENCHMARK_SOURCES_FILE,
  DAY_MS,
  DEFAULT_ADOPTION_THRESHOLD,
  DEFAULT_ADOPTION_WINDOW_DAYS,
  MAX_ADOPTION_EVIDENCE,
  OVERBROAD_TRIGGER_TOKENS,
  benchmarkPath,
  defaultIndex,
  defaultSourcesFile,
  slugify,
};
