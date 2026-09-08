import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cjoin, exists, readJson, readText, writeJson, writeText } from './fs-utils.js';
import { parseOpenSpecTaskDeps } from './openspec/tasks.js';
import { renderExperienceSkill, resolveQualityLearningSource } from './quality-learning.js';
import {
  detectTestStrategyCapabilities,
  summarizeTaskTestStrategies,
} from './test-strategy.js';
import {
  detectVisualReview,
  listVisualReviewArtifacts,
} from './quality-visual-review.js';
import {
  buildKnowledgeAdoptionSummary,
  deriveKnowledgeNames,
  ensureKnowledgeWorkspace,
  listKnowledgeCandidates,
  KNOWLEDGE_CANDIDATES_DIR,
  KNOWLEDGE_DRAFTS_DIR,
  markKnowledgeCandidatePromoted,
  reviewKnowledgeWorkspace,
} from './knowledge.js';
import { OPENPRD_GROWTH_LEDGER } from './growth.js';
import { timestamp } from './time.js';

const QUALITY_DIR = cjoin('.openprd', 'quality');
const QUALITY_REPORTS_DIR = cjoin(QUALITY_DIR, 'reports');
const QUALITY_CONFIG = cjoin(QUALITY_DIR, 'config.json');
const QUALITY_LATEST = cjoin(QUALITY_REPORTS_DIR, 'latest.json');
const KNOWLEDGE_DIR = cjoin('.openprd', 'knowledge');
const KNOWLEDGE_INDEX = cjoin(KNOWLEDGE_DIR, 'index.json');
const HISTORICAL_LIFECYCLE_STATUSES = new Set(['applied', 'archived', 'closed', 'historical', 'legacy-frozen']);
const HISTORICAL_TASK_METADATA_VALUES = new Set([...HISTORICAL_LIFECYCLE_STATUSES, 'context-only']);

const IGNORE_DIRS = new Set([
  '.git',
  '.codex',
  '.claude',
  '.cursor',
  '.openprd',
  '.tmp',
  '.wrangler',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'out',
  'release',
  'test-results',
  'tmp',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.css',
  '.html',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
]);

const IGNORE_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
]);

const QUALITY_GATE_IDS = [
  'traceability',
  'redaction',
  'business-guardrails',
  'test-strategy',
  'smoke',
  'feature-coverage',
  'visual-review',
  'normal-performance',
  'extreme-performance',
  'knowledge',
  'growth',
];

const EVIDENCE_EXTENSIONS = new Set(['.json', '.md', '.txt', '.log', '.xml', '.html', '.csv', '.srt', '.vtt']);
const MEDIA_CLAIM_SCOPES = new Set([
  'acoustic-quality',
  'audio-edit',
  'mix-export',
  'transcription-accuracy',
  'transcription-timing',
  'rendered-subtitles',
]);
const MEDIA_EVIDENCE_ARTIFACT_ROLES = new Set([
  'baseline-measurement',
  'final-measurement',
  'annotation',
  'gold-transcript',
  'manual-review',
  'subtitle',
  'review-html',
  'log',
  'report',
]);

const EVIDENCE_TOKENS = {
  traceability: ['trace_id', 'span_id', 'request_id', 'task_id', 'error_id', 'trace verified', '链路', '追踪'],
  redaction: ['redaction', 'redact', 'mask', 'masked', 'pii', 'secret', 'token redacted', '脱敏', '敏感字段'],
  'business-guardrails': ['quota', 'rate limit', 'abuse', 'budget', 'kill switch', 'cost_usd', '额度', '限流', '滥用', '止损'],
  'test-strategy': ['test-layer', 'test-size', 'test-scope', 'evidence-plan', 'media-flow', 'testing pyramid', '测试策略', '测试分流', '单元测试', '集成测试', '端到端'],
  smoke: ['smoke', 'e2e', 'playwright', 'cypress', 'main flow', 'happy path', '冒烟', '主流程'],
  'feature-coverage': ['feature coverage', 'acceptance', 'tasks done', 'openprd tasks', '验收', '功能覆盖', '任务完成'],
  'visual-review': ['visual-compare', 'visual-before-after', 'visual-focus-board', 'visual-parallel-board', 'visual-verification-board', 'visual-alignment-board', 'visual-centering-board', 'reference-actual', 'before-after', 'focus-board', 'parallel-board', 'verification-board', 'alignment-board', 'centering-board', 'center-board', '效果图', '实现截图', '修改前', '修改后', '视觉对比', '局部焦点证据板', '并行实验证据板', '截图实测证据板', '对齐辅助线证据板', '内部居中证据板', '内容槽位', '内部槽位', '视觉重心', '主体外接框', '画布中心', '偏心'],
  'normal-performance': ['performance', 'perf', 'benchmark', 'latency', 'p95', 'lighthouse', 'k6', '性能', '耗时'],
  'extreme-performance': ['extreme', 'stress', 'load test', 'large-data', 'pressure', 'k6', '压力', '极端', '大数据'],
  knowledge: ['quality learn', 'incident', 'pattern', 'skill', '复盘', '经验', '沉淀'],
  growth: ['growth ledger', 'completion checkpoint', 'openprd grow', 'workflow-gotcha', 'code-extension', '自我成长', '账本', '候选'],
};

const DIAGNOSTIC_SURFACE_LABELS = {
  'runtime-events': '运行事件记录',
  timeline: '问题时间线',
  'root-cause-candidates': '根因排查线索',
  'diagnostic-report': '诊断报告',
};

function qualityPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function reportId() {
  return `eval-${timestamp().replace(/[-: ]/g, '').slice(0, 15)}`;
}

function defaultQualityConfig() {
  return {
    version: 1,
    schema: 'openprd.quality.v1',
    updatedAt: timestamp(),
    enforcement: 'advisory',
    observability: {
      centralizedLoggingRequired: true,
      requiredSignals: ['logs', 'traces', 'metrics', 'errors'],
      requiredCorrelationFields: ['trace_id', 'span_id', 'request_id', 'task_id', 'user_session_id', 'error_id'],
      requiredSurfaces: ['frontend', 'backend', 'agent'],
      redactionRequired: true,
      retentionDays: 30,
      samplingPolicy: 'errors and high-risk flows are never sampled out; routine success logs may be sampled',
      queryExamplesRequired: true,
    },
    evalHarness: {
      smokeRequired: true,
      featureCoverageRequired: true,
      normalPerformanceRequired: true,
      extremePerformanceRequired: true,
      currentEvidenceRequired: true,
      evidenceSources: [
        '.openprd/harness/test-reports',
        '.openprd/harness/visual-reviews',
        '.openprd/quality/evidence',
        'test-results',
        'tests/reports',
        'coverage',
      ],
      scenarioProfiles: {
        core: ['smoke', 'feature-coverage'],
        frontend: ['smoke', 'visual-review'],
        desktop: ['smoke', 'visual-review'],
        backend: ['smoke', 'traceability'],
        media: ['test-strategy'],
        businessCost: ['business-guardrails'],
        security: ['redaction'],
        performance: ['normal-performance'],
        extreme: ['extreme-performance'],
        release: ['traceability', 'redaction', 'business-guardrails', 'smoke', 'feature-coverage', 'normal-performance', 'extreme-performance', 'knowledge'],
      },
      baselinePolicy: 'agent-initialized average baseline; user may override; agent ratchet may only tighten thresholds',
      projectBaseline: {
        normal: {
          cpuPercentP95Max: 70,
          memoryMBP95Max: 512,
          pageLoadMsP95Max: 2500,
          apiLatencyMsP95Max: 500,
          errorRatePercentMax: 0.1,
        },
        extreme: {
          cpuPercentP95Max: 85,
          memoryMBP95Max: 1024,
          pageLoadMsP95Max: 5000,
          apiLatencyMsP95Max: 1200,
          errorRatePercentMax: 1,
        },
      },
    },
    businessGuardrails: {
      enabled: true,
      riskIndicators: [
        'free user',
        'free tier',
        'trial',
        'quota',
        'usage limit',
        'rate limit',
        'credit',
        'token',
        'metered',
        'cost',
        'spend',
        'third-party cost',
        'third-party api',
        'ai generation',
        'model call',
        'openai',
        'anthropic',
        '免费用户',
        '免费额度',
        '试用',
        '额度',
        '用量',
        '限流',
        '积分',
        '点数',
        '令牌',
        '成本',
        '消耗',
        '第三方成本',
        '第三方调用',
        '第三方 API',
        '大模型',
        '模型调用',
        'AI 生成',
        '图像生成',
        '内容生成',
        '薅',
        '滥用',
      ],
      requiredEvidence: {
        usageLimits: ['quota', 'usage limit', 'rate limit', 'daily limit', 'monthly limit', 'allowance', 'free tier', '额度', '用量限制', '限流', '每日上限', '月度上限', '免费额度'],
        abusePrevention: ['abuse', 'bypass', 'fraud', 'replay', 'concurrent', 'unauthorized', 'negative test', '越权', '滥用', '绕过', '并发', '重复请求', '负向测试'],
        monitoringSignals: ['usage metric', 'cost metric', 'billing metric', 'tokens_used', 'cost_usd', 'spend', 'dashboard', 'monitor', '监控', '指标', '用量', '成本', '看板'],
        alertThresholds: ['alert', 'alarm', 'threshold', 'budget', 'anomaly', '报警', '告警', '阈值', '预算', '异常增长'],
        stopLossActions: ['kill switch', 'feature flag', 'circuit breaker', 'disable', 'degrade', 'pause', 'shutdown', '止损', '关闭', '降级', '暂停', '熔断'],
      },
    },
    knowledge: {
      enabled: true,
      skillGenerationRequiredFor: ['repeated-issue', 'high-impact-fix', 'hidden-debug-knowledge', 'agent-misjudgment'],
      skillDir: '.openprd/knowledge/skills',
      candidateDir: '.openprd/knowledge/candidates',
      draftDir: '.openprd/knowledge/drafts',
      abstractionRequired: true,
    },
    growth: {
      enabled: true,
      ledgerPath: OPENPRD_GROWTH_LEDGER,
      completionCheckpointRequired: true,
    },
  };
}

function normalizeQualityConfig(config = {}) {
  const defaults = defaultQualityConfig();
  const enforcement = ['blocking', 'advisory'].includes(config.enforcement)
    ? config.enforcement
    : defaults.enforcement;
  return {
    ...defaults,
    ...config,
    enforcement,
    observability: {
      ...defaults.observability,
      ...(config.observability ?? {}),
    },
    evalHarness: {
      ...defaults.evalHarness,
      ...(config.evalHarness ?? {}),
      scenarioProfiles: {
        ...defaults.evalHarness.scenarioProfiles,
        ...(config.evalHarness?.scenarioProfiles ?? {}),
      },
      projectBaseline: {
        ...defaults.evalHarness.projectBaseline,
        ...(config.evalHarness?.projectBaseline ?? {}),
        normal: {
          ...defaults.evalHarness.projectBaseline.normal,
          ...(config.evalHarness?.projectBaseline?.normal ?? {}),
        },
        extreme: {
          ...defaults.evalHarness.projectBaseline.extreme,
          ...(config.evalHarness?.projectBaseline?.extreme ?? {}),
        },
      },
    },
    businessGuardrails: {
      ...defaults.businessGuardrails,
      ...(config.businessGuardrails ?? {}),
      requiredEvidence: {
        ...defaults.businessGuardrails.requiredEvidence,
        ...(config.businessGuardrails?.requiredEvidence ?? {}),
      },
    },
    knowledge: {
      ...defaults.knowledge,
      ...(config.knowledge ?? {}),
    },
    growth: {
      ...defaults.growth,
      ...(config.growth ?? {}),
    },
  };
}

async function ensureQualityDirs(projectRoot) {
  await fs.mkdir(qualityPath(projectRoot, QUALITY_DIR), { recursive: true });
  await ensureKnowledgeWorkspace(projectRoot);
}

async function mergeQualityConfig(projectRoot, options = {}) {
  await ensureQualityDirs(projectRoot);
  const configPath = qualityPath(projectRoot, QUALITY_CONFIG);
  const current = await readJson(configPath).catch(() => null);
  const next = normalizeQualityConfig({ ...(current ?? {}), updatedAt: timestamp() });
  if (options.force || current === null) {
    await writeJson(configPath, next);
    return { config: next, changed: current === null ? 'created' : 'updated' };
  }
  return { config: next, changed: 'unchanged' };
}

async function walkProject(projectRoot, dir = projectRoot, collected = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = cjoin(dir, entry.name);
    const relativePath = path.relative(projectRoot, fullPath);
    if (entry.isDirectory()) {
      const normalized = relativePath.split(path.sep).join('/');
      if ([...IGNORE_DIRS].some((ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`))) {
        continue;
      }
      await walkProject(projectRoot, fullPath, collected);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (IGNORE_FILES.has(entry.name)) {
      continue;
    }
    const ext = path.extname(entry.name);
    if (SOURCE_EXTENSIONS.has(ext)) {
      collected.push({ path: relativePath, ext });
    }
  }
  return collected;
}

async function readProjectTexts(projectRoot, files) {
  const texts = [];
  for (const file of files.slice(0, 500)) {
    const fullPath = cjoin(projectRoot, file.path);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || stat.size > 512 * 1024) {
      continue;
    }
    const text = await readText(fullPath).catch(() => '');
    texts.push({ ...file, text: text.slice(0, 200000) });
  }
  return texts;
}

async function collectEvidenceFile(projectRoot, source, fullPath, collected) {
  if (collected.length >= 120) {
    return;
  }
  const stat = await fs.stat(fullPath).catch(() => null);
  if (!stat || !stat.isFile() || stat.size > 512 * 1024) {
    return;
  }
  const ext = path.extname(fullPath);
  if (!EVIDENCE_EXTENSIONS.has(ext)) {
    return;
  }
  const text = await readText(fullPath).catch(() => '');
  collected.push({
    path: path.relative(projectRoot, fullPath),
    source,
    size: stat.size,
    contentSha256: createHash('sha256').update(text).digest('hex'),
    text: text.slice(0, 120000),
  });
}

async function walkEvidenceSource(projectRoot, source, dir, collected) {
  if (collected.length >= 120) {
    return;
  }
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = cjoin(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', '.next', 'dist', 'build'].includes(entry.name)) {
        continue;
      }
      await walkEvidenceSource(projectRoot, source, fullPath, collected);
      continue;
    }
    await collectEvidenceFile(projectRoot, source, fullPath, collected);
  }
}

async function readEvidenceFiles(projectRoot, config) {
  const sources = Array.isArray(config.evalHarness.evidenceSources)
    ? config.evalHarness.evidenceSources
    : defaultQualityConfig().evalHarness.evidenceSources;
  const collected = [];
  for (const source of sources) {
    const fullPath = cjoin(projectRoot, source);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      await walkEvidenceSource(projectRoot, source, fullPath, collected);
    } else {
      await collectEvidenceFile(projectRoot, source, fullPath, collected);
    }
  }
  return collected;
}

function packageSignals(packageJson) {
  const scripts = packageJson?.scripts ?? {};
  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
    ...(packageJson?.peerDependencies ?? {}),
  };
  const dependencyNames = Object.keys(dependencies);
  return { scripts, dependencyNames };
}

function includesAny(text, tokens) {
  const normalized = String(text ?? '').toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}

async function readActiveChangeContext(projectRoot, activeChange) {
  if (!activeChange) {
    return { activeChange: null, files: [], text: '' };
  }
  const roots = [
    cjoin('.openprd', 'changes', activeChange),
  ];
  const files = [];
  async function walk(root, dir) {
    if (files.length >= 80) {
      return;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = cjoin(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(root, fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const ext = path.extname(entry.name);
      if (!['.md', '.json', '.yaml', '.yml', '.txt'].includes(ext)) {
        continue;
      }
      const stat = await fs.stat(fullPath).catch(() => null);
      if (!stat || stat.size > 512 * 1024) {
        continue;
      }
      const text = await readText(fullPath).catch(() => '');
      files.push({
        path: path.relative(projectRoot, fullPath),
        text: text.slice(0, 120000),
      });
    }
  }
  for (const root of roots) {
    await walk(root, cjoin(projectRoot, root));
  }
  return {
    activeChange,
    files,
    text: files.map((file) => `# ${file.path}\n${file.text}`).join('\n'),
  };
}

function detectScenarioTags({ activeChangeContext, activeTasks, businessGuardrails }) {
  const haystack = [
    activeChangeContext.text,
    activeChangeContext.files.map((file) => file.path).join('\n'),
    activeTasks.tasks.map((task) => task.title).join('\n'),
  ].join('\n');
  const tags = new Set(['core']);
  if (includesAny(haystack, ['frontend', 'user interface', 'ui screen', 'ui flow', 'screen', 'component', 'modal', 'button', 'form field', 'stylesheet', '.css', '.tsx', '.jsx', '文案', '界面', '前端', '交互', '页面', '组件', '国际化', 'i18n'])) {
    tags.add('frontend');
  }
  if (includesAny(haystack, ['electron', 'desktop', 'preload', 'main process', 'renderer', 'macos', 'windows', '桌面端', '客户端'])) {
    tags.add('desktop');
  }
  if (includesAny(haystack, ['backend service', 'api endpoint', 'api route', 'http api', 'server route', 'request handler', 'worker', 'database', 'migration', 'queue', '后端接口', '后端服务', '服务端', '数据库', '队列'])) {
    tags.add('backend');
  }
  if (businessGuardrails.riskDetected || includesAny(haystack, ['free tier', 'quota', 'rate limit', 'billing', 'cost', 'token', 'third-party api', 'ai generation', '免费', '额度', '限流', '成本', '用量', '第三方', '模型调用'])) {
    tags.add('businessCost');
  }
  if (includesAny(haystack, ['auth', 'permission', 'privacy', 'secret', 'token', 'credential', 'redaction', 'pii', '安全', '权限', '隐私', '凭证', '脱敏', '敏感'])) {
    tags.add('security');
  }
  if (includesAny(haystack, ['performance', 'latency', 'p95', 'benchmark', 'lighthouse', 'load time', '性能', '耗时', '延迟', '基线'])) {
    tags.add('performance');
  }
  if (includesAny(haystack, ['extreme', 'stress', 'load test', 'large-data', 'batch', 'concurrency', 'pressure', '极端', '压力', '大数据', '批量', '并发'])) {
    tags.add('extreme');
  }
  if (includesAny(haystack, ['release', 'publish', 'deploy', 'production rollout', 'production release', 'go-live', '上线', '发布', '部署', '投产'])) {
    tags.add('release');
  }
  return [...tags];
}

function isSubstantiveCompletionFile(relativePath) {
  const normalized = String(relativePath ?? '').split(path.sep).join('/');
  if (!normalized) {
    return false;
  }
  if (/^(src|app|lib|server|scripts|test|tests|templates)\//.test(normalized)) {
    return true;
  }
  return ['package.json', 'README.md', 'AGENTS.md'].includes(normalized);
}

function detectCompletionState({ files, activeTasks, evidenceFiles }) {
  const substantiveFiles = files.filter((file) => isSubstantiveCompletionFile(file.path));
  const hasEvidence = evidenceFiles.length > 0;
  const activeTaskLedgerSettled = !activeTasks.activeChange || Number(activeTasks.pending ?? 0) === 0;
  const postCompletionRequired = substantiveFiles.length > 0 && hasEvidence && activeTaskLedgerSettled;
  return {
    postCompletionRequired,
    substantiveFiles: substantiveFiles.slice(0, 12).map((file) => file.path),
    substantiveFileCount: substantiveFiles.length,
    activeTaskLedgerSettled,
    hasEvidence,
  };
}

function buildQualityPolicy({ config, activeChangeContext, activeTasks, businessGuardrails, evalHarness }) {
  const scenarioTags = detectScenarioTags({ activeChangeContext, activeTasks, businessGuardrails });
  if (evalHarness?.testStrategy?.mediaEvidence?.required && !scenarioTags.includes('media')) {
    scenarioTags.push('media');
  }
  const profiles = config.evalHarness.scenarioProfiles ?? defaultQualityConfig().evalHarness.scenarioProfiles;
  const required = new Set();
  for (const tag of scenarioTags) {
    for (const gate of profiles[tag] ?? []) {
      required.add(gate);
    }
  }
  if (businessGuardrails.riskDetected) {
    required.add('business-guardrails');
  }
  if (!config.evalHarness.smokeRequired) {
    required.delete('smoke');
  }
  if (!config.evalHarness.featureCoverageRequired) {
    required.delete('feature-coverage');
  }
  if (!config.evalHarness.normalPerformanceRequired) {
    required.delete('normal-performance');
  }
  if (!config.evalHarness.extremePerformanceRequired) {
    required.delete('extreme-performance');
  }
  if (!config.knowledge.enabled) {
    required.delete('knowledge');
  }
  return {
    scenarioTags,
    requiredGates: QUALITY_GATE_IDS.filter((gate) => required.has(gate)),
    optionalGates: QUALITY_GATE_IDS.filter((gate) => !required.has(gate)),
    evidenceRequired: config.evalHarness.currentEvidenceRequired !== false,
  };
}

function buildEvidenceLedger({ evidenceFiles, activeTasks, observability, businessGuardrails, knowledge, growth, visualReview, mediaEvidence }) {
  const ledger = Object.fromEntries(QUALITY_GATE_IDS.map((gate) => {
    const tokens = EVIDENCE_TOKENS[gate] ?? [];
    const matches = evidenceFiles
      .filter((file) => includesAny(`${file.path}\n${file.text}`, tokens))
      .slice(0, 12)
      .map((file) => ({ path: file.path, source: file.source }));
    return [gate, {
      present: matches.length > 0,
      sources: matches,
      summary: matches.length > 0 ? `${matches.length} 个证据文件` : '未找到本次执行证据',
    }];
  }));

  if ((mediaEvidence?.bundles ?? []).length > 0) {
    const mediaSources = mediaEvidence.bundles
      .map((bundle) => ({ path: bundle.path, source: 'openprd-media-evidence' }));
    const existingSources = ledger['test-strategy'].sources ?? [];
    const byPath = new Map([...mediaSources, ...existingSources].map((source) => [source.path, source]));
    ledger['test-strategy'] = {
      present: true,
      sources: [...byPath.values()].slice(0, 12),
      summary: `${mediaEvidence.bundles.length} 个结构化媒体证据包`,
    };
  }

  if (activeTasks.total === 0 || activeTasks.pending === 0) {
    ledger['feature-coverage'] = {
      ...ledger['feature-coverage'],
      present: true,
      sources: [
        ...ledger['feature-coverage'].sources,
        { path: activeTasks.activeChange ? `${activeTasks.activeChange}/tasks.md` : 'no-active-change', source: 'openprd-tasks' },
      ].slice(0, 12),
      summary: activeTasks.total === 0 ? '当前没有激活任务清单' : `任务清单已完成 ${activeTasks.done}/${activeTasks.total}`,
    };
  }
  if (observability.status === 'pass') {
    const toolCount = observability.centralizedTools.length;
    const surfaceLabels = (observability.diagnosticSurfaces ?? [])
      .map((surface) => DIAGNOSTIC_SURFACE_LABELS[surface] ?? surface);
    const signalSummary = [
      toolCount > 0 ? `${toolCount} 类日志或追踪工具` : '',
      surfaceLabels.length > 0 ? `${surfaceLabels.length} 类诊断记录` : '',
    ].filter(Boolean).join('和');
    ledger.traceability = {
      ...ledger.traceability,
      present: true,
      sources: [
        ...ledger.traceability.sources,
        { path: '项目内的日志与追踪配置', source: signalSummary ? `检测到${signalSummary}` : '日志追踪检查' },
      ].slice(0, 12),
      summary: `出问题时可以追查：检测到 ${observability.correlationFields.length} 个追踪线索${surfaceLabels.length > 0 ? `，并留有${surfaceLabels.join('、')}` : ''}`,
    };
  }
  if (!businessGuardrails.riskDetected || businessGuardrails.status === 'pass') {
    ledger['business-guardrails'] = {
      ...ledger['business-guardrails'],
      present: true,
      sources: [
        ...ledger['business-guardrails'].sources,
        { path: businessGuardrails.riskDetected ? 'business-guardrails-evidence' : 'no-cost-risk-detected', source: 'project-scan' },
      ].slice(0, 12),
      summary: businessGuardrails.riskDetected ? '成本与滥用护栏证据完整' : '当前场景未检测到成本风险',
    };
  }
  if (knowledge.skills.length > 0) {
    ledger.knowledge = {
      ...ledger.knowledge,
      present: true,
      sources: [
        ...ledger.knowledge.sources,
        ...knowledge.skills.slice(0, 6).map((skill) => ({ path: skill, source: 'openprd-knowledge' })),
        ...knowledge.candidates.slice(0, 3).map((candidate) => ({ path: candidate, source: 'openprd-knowledge-candidate' })),
      ].slice(0, 12),
      summary: knowledge.candidates.length > 0
        ? `已沉淀 ${knowledge.skills.length} 条项目经验，近期被实际复用 ${knowledge.adoption?.totals?.referenced ?? 0} 次，另有 ${knowledge.candidates.length} 条经验草案等确认`
        : `已沉淀 ${knowledge.skills.length} 条项目经验，近期被实际复用 ${knowledge.adoption?.totals?.referenced ?? 0} 次`,
    };
  } else if (knowledge.candidates.length > 0) {
    ledger.knowledge = {
      ...ledger.knowledge,
      present: true,
      sources: [
        ...ledger.knowledge.sources,
        ...knowledge.candidates.slice(0, 6).map((candidate) => ({ path: candidate, source: 'openprd-knowledge-candidate' })),
      ].slice(0, 12),
      summary: `已有 ${knowledge.candidates.length} 条经验草案等确认，确认后会成为可复用的项目经验`,
    };
  }
  if (growth?.summary) {
    const lifecycleCount = Number(growth.summary.lifecycleCount ?? 0);
    const completionCheckpoints = Number(growth.summary.completionCheckpoints ?? 0);
    if (lifecycleCount > 0 || completionCheckpoints > 0) {
      ledger.growth = {
        ...ledger.growth,
        present: true,
        sources: [
          ...ledger.growth.sources,
          { path: growth.ledgerPath ?? OPENPRD_GROWTH_LEDGER, source: 'openprd-growth-ledger' },
        ].slice(0, 12),
        summary: `成长记录已有 ${growth.summary.eventCount ?? 0} 条，其中收尾检查记录 ${completionCheckpoints} 条`,
      };
    }
  }
  if (visualReview?.evidence) {
    ledger['visual-review'] = {
      ...ledger['visual-review'],
      ...visualReview.evidence,
    };
  }
  return ledger;
}

function describeFeatureCoverageLedger(activeTasks = {}) {
  const total = Number(activeTasks.total ?? 0);
  const done = Number(activeTasks.done ?? 0);
  const pending = Number(activeTasks.pending ?? 0);
  const blocked = Number(activeTasks.blocked ?? 0);
  if (pending <= 0) {
    return null;
  }
  const progress = total > 0 ? `${done}/${total}` : `${done}`;
  const changeLabel = activeTasks.activeChange ? `当前变更 ${activeTasks.activeChange}` : '当前任务账本';
  const blockedText = blocked > 0 ? `，其中 ${blocked} 个因依赖阻塞` : '';
  return `${changeLabel} 仍有 ${pending} 个未完成任务（已完成 ${progress}${blockedText}）。这通常表示任务账本尚未收口或覆盖证据未补齐，不等于当前实现失败。`;
}

function detectObservability({ config, files, texts, packageJson }) {
  const { dependencyNames } = packageSignals(packageJson);
  const haystack = [
    ...dependencyNames,
    ...files.map((file) => file.path),
    ...texts.map((file) => file.text),
  ].join('\n');
  const centralizedTools = [
    '@opentelemetry/',
    'opentelemetry',
    'sentry',
    'datadog',
    'newrelic',
    'rollbar',
    'logtail',
    'grafana',
    'loki',
    'elastic-apm',
    'cloudwatch',
    'azure monitor',
  ].filter((token) => includesAny(haystack, [token]));
  const diagnosticSurfaces = [
    { id: 'runtime-events', tokens: ['runtime-events', 'appendruntimeevent', 'events.jsonl', 'runtime event'] },
    { id: 'timeline', tokens: ['timeline', 'event timeline', 'diagnostic timeline'] },
    { id: 'root-cause-candidates', tokens: ['root-cause-candidates', 'root cause candidate', 'root cause'] },
    { id: 'diagnostic-report', tokens: ['diagnostic-report', 'framework-runtime-diagnostics', 'exportdiagnostics', 'export diagnostics'] },
  ]
    .filter((surface) => includesAny(haystack, surface.tokens))
    .map((surface) => surface.id);
  const localLoggers = ['pino', 'winston', 'bunyan', 'log4js', 'console.'].filter((token) => includesAny(haystack, [token]));
  const correlationFields = config.observability.requiredCorrelationFields
    .filter((field) => includesAny(haystack, [field, field.replace(/_/g, ''), field.replace(/_id$/, 'Id')]));
  const surfaces = {
    frontend: files.some((file) => /\.(tsx|jsx|css|html)$/.test(file.path) || /src\/(app|pages|components|ui)\//.test(file.path)),
    backend: files.some((file) => /\.(js|ts|py|go|rs|java|kt)$/.test(file.path) && /(server|api|route|controller|service|worker|handler)/i.test(file.path)),
    agent: files.some((file) => /(agent|harness|tool|skill|prompt|workflow)/i.test(file.path)),
  };
  const warnings = [];
  if (centralizedTools.length === 0 && diagnosticSurfaces.length === 0) {
    warnings.push('未检测到中心化日志/追踪/错误系统依赖或配置；需要确认是否由平台层统一提供。');
  }
  if (localLoggers.length > 0 && centralizedTools.length === 0 && diagnosticSurfaces.length === 0) {
    warnings.push('检测到本地日志调用，但未看到中心化采集出口。');
  }
  const missingCorrelation = config.observability.requiredCorrelationFields.filter((field) => !correlationFields.includes(field));
  if (missingCorrelation.length > 0) {
    warnings.push(`链路关联字段缺失或未显式出现: ${missingCorrelation.join(', ')}。`);
  }
  return {
    status: (centralizedTools.length > 0 || diagnosticSurfaces.length > 0) && missingCorrelation.length === 0 ? 'pass' : 'needs-attention',
    centralizedTools,
    diagnosticSurfaces,
    localLoggers,
    correlationFields,
    missingCorrelation,
    surfaces,
    requiredSurfaces: config.observability.requiredSurfaces,
    redactionRequired: config.observability.redactionRequired,
    recommendations: [
      '为前端交互、后端入口、异步任务、Agent 工具调用统一注入 trace/request/task/error 关联字段。',
      '错误日志必须能回查用户会话、任务、请求、下游调用和异常栈，敏感字段默认脱敏。',
      '关键路径默认沉淀 runtime-events、timeline、root-cause-candidates、diagnostic-report 四类诊断证据。',
      '每个新增功能在实现阶段都要自评是否需要新增结构化日志、查询样例或诊断导出入口。',
    ],
    warnings,
  };
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/i.test(String(value ?? ''));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCompleteMeasurement(value) {
  return hasObjectKeys(value, ['id', 'value', 'unit', 'method'])
    && isNonEmptyString(value.id)
    && value.value !== null
    && ['number', 'string', 'boolean'].includes(typeof value.value)
    && isNonEmptyString(value.unit)
    && isNonEmptyString(value.method);
}

function isCompleteTool(value) {
  return hasObjectKeys(value, ['name', 'version', 'configDigest'])
    && isNonEmptyString(value.name)
    && isNonEmptyString(value.version)
    && isSha256(value.configDigest);
}

function hasCompleteErrorDistribution(value) {
  return hasObjectKeys(value, ['p50', 'p95', 'max'])
    && isNonNegativeNumber(value.p50)
    && isNonNegativeNumber(value.p95)
    && isNonNegativeNumber(value.max);
}

function hasCompleteClaimResults(value) {
  if (!Array.isArray(value?.claimScopes) || !Array.isArray(value?.claimResults)) return false;
  const scopes = new Set(value.claimScopes);
  const resultScopes = new Set(value.claimResults.map((result) => result?.scope));
  return scopes.size === value.claimScopes.length
    && [...scopes].every((scope) => MEDIA_CLAIM_SCOPES.has(scope))
    && value.claimResults.length === value.claimScopes.length
    && resultScopes.size === value.claimResults.length
    && [...scopes].every((scope) => resultScopes.has(scope))
    && [...resultScopes].every((scope) => MEDIA_CLAIM_SCOPES.has(scope))
    && value.claimResults.every((result) => (
      ['pass', 'baseline-only', 'blocked', 'waived', 'unknown'].includes(result?.status)
      && Array.isArray(result?.evidenceRefs)
      && result.evidenceRefs.every(isNonEmptyString)
      && Object.hasOwn(result, 'remainingRisk')
    ));
}

function normalizeEvidencePath(value) {
  if (!isNonEmptyString(value) || path.isAbsolute(value)) return null;
  const normalized = path.posix.normalize(String(value).replaceAll('\\', '/'));
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized.replace(/^\.\//, '');
}

function evidenceFileSha256(file) {
  if (isSha256(file?.contentSha256)) return String(file.contentSha256).toLowerCase();
  return createHash('sha256').update(String(file?.text ?? '')).digest('hex');
}

function mediaEvidenceArtifactIntegrity(value, evidenceFiles) {
  if (!Array.isArray(value?.evidenceArtifacts)) {
    return { valid: false, structureValid: false, referencesValid: false, digestsValid: false };
  }
  const filesByPath = new Map(evidenceFiles.map((file) => [normalizeEvidencePath(file.path), file]));
  const ids = new Set();
  const artifactsById = new Map();
  let structureValid = true;
  let digestsValid = true;
  for (const artifact of value.evidenceArtifacts) {
    const normalizedPath = normalizeEvidencePath(artifact?.path);
    if (
      !isNonEmptyString(artifact?.id)
      || ids.has(artifact.id)
      || !normalizedPath
      || !isSha256(artifact?.sha256)
      || !MEDIA_EVIDENCE_ARTIFACT_ROLES.has(artifact?.role)
    ) {
      structureValid = false;
      continue;
    }
    ids.add(artifact.id);
    artifactsById.set(artifact.id, { ...artifact, path: normalizedPath });
    const file = filesByPath.get(normalizedPath);
    if (!file || evidenceFileSha256(file) !== String(artifact.sha256).toLowerCase()) {
      digestsValid = false;
    }
  }

  const refs = [
    ...(value.claimResults ?? []).flatMap((result) => result?.evidenceRefs ?? []),
    ...(value.hypotheses ?? []).flatMap((hypothesis) => hypothesis?.evidenceRefs ?? []),
    ...(value.baseline?.rawEvidence ?? []),
    ...(value.finalOutput?.rawEvidence ?? []),
    ...(value.manualReview?.reviews ?? []).flatMap((review) => [review?.baselineRef, review?.finalRef]),
    ...(value.renderedSubtitles?.frameEvidence ?? []),
    value.renderedSubtitles?.bindingEvidence,
    value.artifacts?.baselineHtml,
    value.artifacts?.comparisonHtml,
  ].filter(isNonEmptyString);
  const referencesValid = refs.every((ref) => artifactsById.has(ref));

  const refsHaveRoles = (artifactRefs, allowedRoles) => artifactRefs.every((ref) => (
    !isNonEmptyString(ref) || allowedRoles.has(artifactsById.get(ref)?.role)
  ));
  const semanticRolesValid = refsHaveRoles(
    value.baseline?.rawEvidence ?? [],
    new Set(['baseline-measurement']),
  ) && refsHaveRoles(
    value.finalOutput?.rawEvidence ?? [],
    new Set(['final-measurement']),
  ) && refsHaveRoles(
    (value.hypotheses ?? []).flatMap((hypothesis) => hypothesis?.evidenceRefs ?? []),
    new Set(['baseline-measurement', 'annotation', 'gold-transcript', 'log', 'report']),
  ) && refsHaveRoles(
    (value.claimResults ?? [])
      .filter((result) => result?.status === 'pass')
      .flatMap((result) => result?.evidenceRefs ?? []),
    new Set(['final-measurement', 'annotation', 'gold-transcript', 'manual-review', 'subtitle', 'review-html', 'report']),
  ) && refsHaveRoles(
    (value.manualReview?.reviews ?? []).flatMap((review) => [review?.baselineRef, review?.finalRef]),
    new Set(['manual-review', 'review-html', 'report']),
  ) && refsHaveRoles(
    [value.artifacts?.baselineHtml, value.artifacts?.comparisonHtml],
    new Set(['review-html']),
  ) && refsHaveRoles(
    value.renderedSubtitles?.frameEvidence ?? [],
    new Set(['manual-review', 'review-html', 'report']),
  ) && refsHaveRoles(
    [value.renderedSubtitles?.bindingEvidence],
    new Set(['subtitle', 'review-html', 'report']),
  );

  const hasMatchingArtifact = (artifactPath, sha256, allowedRoles) => {
    const normalizedPath = normalizeEvidencePath(artifactPath);
    return Boolean(normalizedPath && isSha256(sha256) && [...artifactsById.values()].some((artifact) => (
      artifact.path === normalizedPath
      && artifact.sha256.toLowerCase() === String(sha256).toLowerCase()
      && allowedRoles.has(artifact.role)
    )));
  };
  const timingDigestValid = !value.claimScopes?.includes('transcription-timing') || hasMatchingArtifact(
    value.transcription?.timingEvaluation?.annotationSourcePath,
    value.transcription?.timingEvaluation?.annotationSourceSha256,
    new Set(['annotation']),
  );
  const accuracyDigestValid = !value.claimScopes?.includes('transcription-accuracy') || hasMatchingArtifact(
    value.transcription?.goldTranscriptPath,
    value.transcription?.goldTranscriptSha256,
    new Set(['gold-transcript']),
  );
  const renderedDigestValid = !value.claimScopes?.includes('rendered-subtitles') || hasMatchingArtifact(
    value.renderedSubtitles?.artifactPath,
    value.renderedSubtitles?.artifactSha256,
    new Set(['subtitle']),
  );
  const directDigestsValid = timingDigestValid && accuracyDigestValid && renderedDigestValid;
  return {
    valid: structureValid && referencesValid && semanticRolesValid && digestsValid && directDigestsValid,
    structureValid,
    referencesValid: referencesValid && semanticRolesValid,
    digestsValid: digestsValid && directDigestsValid,
  };
}

function hasObjectKeys(value, keys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && keys.every((key) => Object.hasOwn(value, key));
}

function mediaEvidenceCoreValid(value, evidenceFiles) {
  const statusValid = ['baseline-only', 'comparison-complete', 'waived', 'blocked'].includes(value?.status);
  const sourceValid = hasObjectKeys(value?.source, ['path', 'sha256', 'provenance', 'durationSeconds', 'trackIndex', 'privacy'])
    && hasObjectKeys(value.source.privacy, ['containsPersonalData', 'reportRedacted']);
  const measurementPolicyValid = hasObjectKeys(value?.measurementPolicy, ['tools', 'timebase', 'windowPolicy', 'finalRemeasured', 'sameSettings'])
    && Array.isArray(value.measurementPolicy.tools);
  const baselineValid = hasObjectKeys(value?.baseline, ['measurements', 'rawEvidence'])
    && Array.isArray(value.baseline.measurements)
    && Array.isArray(value.baseline.rawEvidence);
  const hypothesesValid = Array.isArray(value?.hypotheses)
    && value.hypotheses.every((hypothesis) => (
      hasObjectKeys(hypothesis, [
        'id',
        'claim',
        'evidenceRefs',
        'alternatives',
        'predictedEffect',
        'rollbackPlan',
      ])
      && isNonEmptyString(hypothesis.id)
      && isNonEmptyString(hypothesis.claim)
      && Array.isArray(hypothesis.evidenceRefs)
      && hypothesis.evidenceRefs.every(isNonEmptyString)
      && Array.isArray(hypothesis.alternatives)
      && hypothesis.alternatives.every(isNonEmptyString)
      && isNonEmptyString(hypothesis.predictedEffect)
      && isNonEmptyString(hypothesis.rollbackPlan)
    ));
  const lifecycleValid = (
    value?.status === 'comparison-complete'
    || (value?.status === 'baseline-only' && value.claimResults?.some((result) => result.status === 'baseline-only'))
    || (
      value?.status === 'blocked'
      && value.claimResults?.some((result) => result.status === 'blocked')
      && Array.isArray(value.blockers)
      && value.blockers.length > 0
      && value.blockers.every(isNonEmptyString)
    )
    || (
      value?.status === 'waived'
      && value.claimResults?.every((result) => result.status === 'waived')
      && isNonEmptyString(value.waiver?.reason)
      && isNonEmptyString(value.waiver?.remainingRisk)
    )
  );
  return value?.schema === 'openprd.media-evidence.v1'
    && statusValid
    && Boolean(value?.task?.id)
    && Boolean(value?.task?.title)
    && Array.isArray(value?.claimScopes)
    && value.claimScopes.length > 0
    && hasCompleteClaimResults(value)
    && mediaEvidenceArtifactIntegrity(value, evidenceFiles).structureValid
    && sourceValid
    && measurementPolicyValid
    && baselineValid
    && hypothesesValid
    && lifecycleValid
    && hasObjectKeys(value?.artifacts, ['baselineHtml', 'comparisonHtml'])
    && Array.isArray(value?.unknownClaims);
}

function mediaEvidenceComparisonComplete(value, contractValid, artifactIntegrity) {
  if (!contractValid || value.status !== 'comparison-complete') {
    return false;
  }
  const sourceValid = isNonEmptyString(value.source?.path)
    && isSha256(value.source?.sha256)
    && isNonEmptyString(value.source?.provenance)
    && typeof value.source?.durationSeconds === 'number'
    && value.source.durationSeconds > 0
    && Number.isInteger(value.source?.trackIndex)
    && value.source.trackIndex >= 0
    && isNonEmptyString(value.source?.codec)
    && typeof value.source?.sampleRateHz === 'number'
    && value.source.sampleRateHz > 0
    && Number.isInteger(value.source?.channels)
    && value.source.channels > 0
    && typeof value.source?.privacy?.containsPersonalData === 'boolean'
    && typeof value.source?.privacy?.reportRedacted === 'boolean';
  const mediaStructure = value.finalOutput?.mediaStructure;
  const finalOutputValid = isNonEmptyString(value.finalOutput?.path)
    && isSha256(value.finalOutput?.sha256)
    && hasObjectKeys(mediaStructure, [
      'container',
      'durationSeconds',
      'trackIndex',
      'codec',
      'sampleRateHz',
      'channels',
      'timebase',
    ])
    && isNonEmptyString(mediaStructure.container)
    && typeof mediaStructure.durationSeconds === 'number'
    && mediaStructure.durationSeconds > 0
    && Number.isInteger(mediaStructure.trackIndex)
    && mediaStructure.trackIndex >= 0
    && isNonEmptyString(mediaStructure.codec)
    && typeof mediaStructure.sampleRateHz === 'number'
    && mediaStructure.sampleRateHz > 0
    && Number.isInteger(mediaStructure.channels)
    && mediaStructure.channels > 0
    && isNonEmptyString(mediaStructure.timebase)
    && isNonEmptyString(value.finalOutput?.extraction?.method)
    && value.finalOutput?.extraction?.cacheReused === false
    && Array.isArray(value.finalOutput?.measurements)
    && value.finalOutput.measurements.length > 0
    && value.finalOutput.measurements.every(isCompleteMeasurement)
    && Array.isArray(value.finalOutput?.rawEvidence)
    && value.finalOutput.rawEvidence.length > 0
    && value.finalOutput.rawEvidence.every(isNonEmptyString);
  const comparisonValid = Array.isArray(value.comparison?.metricDeltas)
    && value.comparison.metricDeltas.length > 0
    && value.comparison.metricDeltas.every((delta) => (
      hasObjectKeys(delta, ['id', 'baseline', 'final', 'unit', 'assessment'])
      && isNonEmptyString(delta.id)
      && delta.baseline !== null
      && delta.final !== null
      && isNonEmptyString(delta.unit)
      && ['expected-improvement', 'unchanged'].includes(delta.assessment)
    ))
    && Array.isArray(value.comparison?.regressions)
    && value.comparison.regressions.length === 0;
  const acousticReviewValid = !value.claimScopes.includes('acoustic-quality')
    || (
      isNonEmptyString(value.manualReview?.gainPolicy)
      && isNonEmptyString(value.manualReview?.playbackEnvironment)
      && isNonEmptyString(value.manualReview?.rubric)
      && isNonEmptyString(value.manualReview?.acceptanceRule)
      && Array.isArray(value.manualReview?.reviews)
      && ['target', 'boundary', 'control'].every((role) => value.manualReview.reviews.some((review) => review.clipRole === role))
      && value.manualReview.reviews.every((review) => (
        isNonEmptyString(review?.clipId)
        && isNonEmptyString(review?.baselineRef)
        && isNonEmptyString(review?.finalRef)
        && review?.result === 'pass'
      ))
    );
  const timingValid = !value.claimScopes.includes('transcription-timing')
    || (
      ['human-gold', 'human-reference', 'engine-reference'].includes(value.transcription?.timingEvaluation?.referenceType)
      && hasObjectKeys(value.transcription?.timingEvaluation, [
        'annotationSourcePath',
        'annotationSourceSha256',
        'toleranceMs',
        'absoluteStartErrorMs',
        'absoluteEndErrorMs',
      ])
      && isNonEmptyString(value.transcription.timingEvaluation.annotationSourcePath)
      && isSha256(value.transcription.timingEvaluation.annotationSourceSha256)
      && isNonNegativeNumber(value.transcription.timingEvaluation.toleranceMs)
      && hasCompleteErrorDistribution(value.transcription.timingEvaluation.absoluteStartErrorMs)
      && hasCompleteErrorDistribution(value.transcription.timingEvaluation.absoluteEndErrorMs)
    );
  const accuracyValid = !value.claimScopes.includes('transcription-accuracy')
    || (
      isNonEmptyString(value.transcription?.engine)
      && isNonEmptyString(value.transcription?.model)
      && isNonEmptyString(value.transcription?.version)
      && isNonEmptyString(value.transcription?.language)
      && isNonEmptyString(value.transcription?.normalizationPolicy)
      && isNonEmptyString(value.transcription?.goldTranscriptPath)
      && isSha256(value.transcription?.goldTranscriptSha256)
      && (isNonNegativeNumber(value.transcription?.wer) || isNonNegativeNumber(value.transcription?.cer))
      && Number.isInteger(value.transcription?.insertions)
      && value.transcription.insertions >= 0
      && Number.isInteger(value.transcription?.deletions)
      && value.transcription.deletions >= 0
      && Number.isInteger(value.transcription?.substitutions)
      && value.transcription.substitutions >= 0
    );
  const renderedSubtitlesValid = !value.claimScopes.includes('rendered-subtitles')
    || (
      ['burned-in', 'embedded-stream', 'sidecar'].includes(value.renderedSubtitles?.mode)
      && isNonEmptyString(value.renderedSubtitles?.extractionMethod)
      && isNonEmptyString(value.renderedSubtitles?.artifactPath)
      && isSha256(value.renderedSubtitles?.artifactSha256)
      && isNonEmptyString(value.renderedSubtitles?.bindingEvidence)
      && Array.isArray(value.renderedSubtitles?.frameEvidence)
      && (
        value.renderedSubtitles.mode !== 'burned-in'
        || value.renderedSubtitles.frameEvidence.length >= 2
      )
      && (
        value.renderedSubtitles.mode !== 'embedded-stream'
        || (Number.isInteger(value.renderedSubtitles.subtitleStreamIndex) && value.renderedSubtitles.subtitleStreamIndex >= 0)
      )
    );
  return value.measurementPolicy.finalRemeasured === true
    && value.measurementPolicy.sameSettings === true
    && Array.isArray(value.measurementPolicy.tools)
    && value.measurementPolicy.tools.length > 0
    && value.measurementPolicy.tools.every(isCompleteTool)
    && isNonEmptyString(value.measurementPolicy.timebase)
    && isNonEmptyString(value.measurementPolicy.windowPolicy)
    && sourceValid
    && value.claimResults.every((result) => result.status === 'pass' && result.evidenceRefs.length > 0)
    && value.baseline.measurements.length > 0
    && value.baseline.measurements.every(isCompleteMeasurement)
    && value.baseline.rawEvidence.length > 0
    && value.baseline.rawEvidence.every(isNonEmptyString)
    && value.hypotheses.length > 0
    && value.evidenceArtifacts.length > 0
    && artifactIntegrity.valid
    && isNonEmptyString(value.artifacts?.baselineHtml)
    && isNonEmptyString(value.artifacts?.comparisonHtml)
    && finalOutputValid
    && comparisonValid
    && acousticReviewValid
    && accuracyValid
    && timingValid
    && renderedSubtitlesValid;
}

export function detectMediaEvidence({ testStrategy = {}, evidenceFiles = [] } = {}) {
  const mediaTasks = (testStrategy.tasks ?? []).filter((task) => task.scope === 'media-flow');
  const parsedBundles = evidenceFiles.flatMap((file) => {
    if (path.extname(file.path).toLowerCase() !== '.json' || !String(file.text ?? '').includes('openprd.media-evidence.v1')) {
      return [];
    }
    try {
      const value = JSON.parse(file.text);
      if (value?.schema !== 'openprd.media-evidence.v1') {
        return [];
      }
      const artifactIntegrity = mediaEvidenceArtifactIntegrity(value, evidenceFiles);
      const contractValid = mediaEvidenceCoreValid(value, evidenceFiles);
      const comparisonComplete = mediaEvidenceComparisonComplete(value, contractValid, artifactIntegrity);
      const accuracyClaimed = Array.isArray(value.claimScopes) && value.claimScopes.includes('transcription-accuracy');
      const hasGoldTranscript = Boolean(value.transcription?.goldTranscriptPath && value.transcription?.goldTranscriptSha256);
      const accuracyMarkedUnknown = (value.unknownClaims ?? []).some((claim) => /accuracy|准确/i.test(String(claim)));
      return [{
        path: file.path,
        taskId: value.task?.id ?? null,
        status: value.status ?? null,
        contractValid,
        comparisonComplete,
        evidenceArtifactsValid: artifactIntegrity.valid,
        accuracyClaimed,
        hasGoldTranscript,
        accuracyMarkedUnknown,
      }];
    } catch {
      return [];
    }
  });

  const taskIds = new Set(mediaTasks.map((task) => task.id).filter(Boolean));
  const bundles = taskIds.size > 0
    ? parsedBundles.filter((bundle) => taskIds.has(bundle.taskId))
    : parsedBundles;

  if (mediaTasks.length === 0) {
    return {
      required: false,
      status: bundles.length > 0 ? 'available' : 'not-required',
      taskCount: 0,
      bundles,
      warnings: [],
    };
  }

  const warnings = [];
  const genericWaivers = mediaTasks.filter((task) => task.waiver);
  if (genericWaivers.length > 0) {
    warnings.push(`有 ${genericWaivers.length} 个 media-flow 任务使用了通用 waiver；媒体声明必须用结构化证据包表达 waived，没有样本或运行条件时应标为 blocked。`);
  }
  const invalidLayers = mediaTasks.filter((task) => !task.layers?.includes('integration') || !task.layers?.includes('manual'));
  if (invalidLayers.length > 0) {
    warnings.push(`有 ${invalidLayers.length} 个 media-flow 任务没有同时声明 integration 与 manual 验证层。`);
  }
  if (bundles.length === 0) {
    warnings.push('检测到 media-flow 任务，但当前 evidence sources 中没有 openprd.media-evidence.v1 结构化证据包。');
  }
  const invalidContracts = bundles.filter((bundle) => !bundle.contractValid);
  if (invalidContracts.length > 0) {
    warnings.push(`有 ${invalidContracts.length} 个媒体证据包不满足 openprd.media-evidence.v1 核心合同。`);
  }
  const invalidArtifacts = bundles.filter((bundle) => !bundle.evidenceArtifactsValid);
  if (invalidArtifacts.length > 0) {
    warnings.push(`有 ${invalidArtifacts.length} 个媒体证据包包含未解析的证据引用、缺失文件或摘要不匹配。`);
  }
  const incomplete = bundles.filter((bundle) => !bundle.comparisonComplete && !(bundle.contractValid && bundle.status === 'waived'));
  if (incomplete.length > 0) {
    warnings.push(`有 ${incomplete.length} 个媒体证据包尚未完成最终媒体重新提取、同口径复测或来源/输出摘要锁定。`);
  }
  const unsupportedAccuracy = bundles.filter((bundle) => bundle.accuracyClaimed && !bundle.hasGoldTranscript && !bundle.accuracyMarkedUnknown);
  if (unsupportedAccuracy.length > 0) {
    warnings.push(`有 ${unsupportedAccuracy.length} 个转写准确率声明既没有人工 gold transcript，也没有标记为 unknown。`);
  }
  const bundleTaskIds = new Set(bundles.map((bundle) => bundle.taskId).filter(Boolean));
  const unmatchedTaskIds = [...taskIds].filter((taskId) => !bundleTaskIds.has(taskId));
  if (unmatchedTaskIds.length > 0) {
    warnings.push(`有 ${unmatchedTaskIds.length} 个 media-flow 任务没有按 task.id 对应到媒体证据包。`);
  }

  return {
    required: true,
    status: warnings.length === 0 ? 'pass' : (bundles.length === 0 ? 'needs-evidence' : 'needs-attention'),
    taskCount: mediaTasks.length,
    bundles,
    unmatchedTaskIds,
    warnings,
  };
}

function detectEvalHarness({ config, files, texts, packageJson, activeTasks, evidenceFiles = [] }) {
  const { scripts, dependencyNames } = packageSignals(packageJson);
  const scriptEntries = Object.entries(scripts);
  const commandText = scriptEntries.map(([name, command]) => `${name}: ${command}`).join('\n');
  const hasTest = scriptEntries.some(([name]) => /(^|:)(test|check)$/.test(name)) || includesAny(commandText, ['node --test', 'vitest', 'jest', 'pytest']);
  const testStrategy = summarizeTaskTestStrategies(activeTasks.tasks ?? []);
  const testCapabilities = detectTestStrategyCapabilities({ scripts, files, dependencyNames });
  const smokeCommands = scriptEntries
    .filter(([name, command]) => /smoke|e2e|playwright|cypress|test:ui/i.test(`${name} ${command}`))
    .map(([name, command]) => `${name}: ${command}`);
  const perfCommands = scriptEntries
    .filter(([name, command]) => /perf|performance|load|stress|k6|lighthouse|autocannon|wrk/i.test(`${name} ${command}`))
    .map(([name, command]) => `${name}: ${command}`);
  const hasSmoke = smokeCommands.length > 0
    || files.some((file) => /playwright\.config|cypress\.config|e2e|smoke/i.test(file.path))
    || dependencyNames.some((name) => /playwright|cypress/i.test(name));
  const hasPerf = perfCommands.length > 0
    || files.some((file) => /k6|lighthouse|load|stress|performance/i.test(file.path))
    || dependencyNames.some((name) => /k6|lighthouse|autocannon/i.test(name));
  const hasExtremeFixtures = files.some((file) => /fixtures|extreme|stress|load|large-data|seed/i.test(file.path));
  const normalBaseline = config.evalHarness.projectBaseline.normal;
  const extremeBaseline = config.evalHarness.projectBaseline.extreme;
  const warnings = [];
  if (!hasSmoke) {
    warnings.push('未检测到明确的冒烟/e2e 测试体系。');
  }
  if (!hasPerf) {
    warnings.push('未检测到性能/压力测试命令或脚本。');
  }
  if (!hasExtremeFixtures) {
    warnings.push('未检测到极端数据 fixtures 或压力场景数据。');
  }
  if (activeTasks.total > 0 && activeTasks.pending > 0) {
    warnings.push(describeFeatureCoverageLedger(activeTasks) ?? `当前任务清单仍有 ${activeTasks.pending} 个未完成条目，功能覆盖不能判定为完整。`);
  }
  const mediaEvidence = detectMediaEvidence({ testStrategy, evidenceFiles });
  const testStrategyWarnings = [...testStrategy.warnings, ...mediaEvidence.warnings];
  warnings.push(...testStrategyWarnings);
  return {
    status: hasSmoke && hasPerf && hasExtremeFixtures && activeTasks.pending === 0 ? 'pass' : 'needs-attention',
    hasUnitOrCommandTests: hasTest,
    testStrategy: {
      ...testStrategy,
      status: testStrategy.total === 0 || testStrategyWarnings.length > 0 ? 'needs-attention' : 'pass',
      warnings: testStrategyWarnings,
      mediaEvidence,
      capabilities: testCapabilities,
    },
    smoke: {
      present: hasSmoke,
      commands: smokeCommands,
    },
    performance: {
      present: hasPerf,
      commands: perfCommands,
      normalBaseline,
      extremeBaseline,
      ratchetPolicy: config.evalHarness.baselinePolicy,
    },
    extremeData: {
      present: hasExtremeFixtures,
      evidence: files.filter((file) => /fixtures|extreme|stress|load|large-data|seed/i.test(file.path)).slice(0, 20).map((file) => file.path),
    },
    featureCoverage: {
      scope: 'workspace-claim',
      activeTasks,
      requiredFlows: ['主流程', '异常流程', '逆向流程', '边界条件'],
    },
    warnings,
    recommendations: [
      '如果项目没有冒烟测试，优先补一组最短主流程用例，并让后续功能持续补充。',
      '每次阶段性开发结束都要把任务清单映射到主流程、异常流程、逆向流程和边界条件。',
      '性能标准从项目级 baseline 开始，功能级可以加严；Agent 自动更新阈值时只能更严格。',
    ],
  };
}

function detectBusinessGuardrails({ config, files, texts, packageJson }) {
  const { scripts, dependencyNames } = packageSignals(packageJson);
  const haystack = [
    ...dependencyNames,
    ...Object.entries(scripts).map(([name, command]) => `${name}: ${command}`),
    ...files.map((file) => file.path),
    ...texts.map((file) => file.text),
  ].join('\n');
  const businessConfig = config.businessGuardrails ?? defaultQualityConfig().businessGuardrails;
  const riskIndicators = businessConfig.riskIndicators ?? [];
  const matchedRiskIndicators = riskIndicators.filter((token) => includesAny(haystack, [token]));
  const riskDetected = matchedRiskIndicators.length > 0;
  const evidenceConfig = businessConfig.requiredEvidence ?? {};
  const evidence = Object.fromEntries(
    Object.entries(evidenceConfig).map(([key, tokens]) => {
      const matched = (Array.isArray(tokens) ? tokens : []).filter((token) => includesAny(haystack, [token]));
      return [key, { present: matched.length > 0, matched }];
    }),
  );
  const missingEvidence = Object.entries(evidence)
    .filter(([, value]) => !value.present)
    .map(([key]) => key);
  const warnings = [];
  if (riskDetected && missingEvidence.includes('usageLimits')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到明确的额度、频率、并发或总量限制证据。');
  }
  if (riskDetected && missingEvidence.includes('abusePrevention')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到滥用、越权、重复请求或并发绕过的负向验证证据。');
  }
  if (riskDetected && missingEvidence.includes('monitoringSignals')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到用量、成本、调用量或异常行为监控信号。');
  }
  if (riskDetected && missingEvidence.includes('alertThresholds')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到成本、用量或异常增长报警阈值。');
  }
  if (riskDetected && missingEvidence.includes('stopLossActions')) {
    warnings.push('检测到消耗型或免费额度风险，但未看到关闭、降级、暂停或熔断等止损动作。');
  }
  return {
    status: !businessConfig.enabled || !riskDetected || missingEvidence.length === 0 ? 'pass' : 'needs-attention',
    enabled: businessConfig.enabled,
    riskDetected,
    matchedRiskIndicators,
    evidence,
    missingEvidence,
    recommendations: [
      '涉及免费用户、额度、AI 调用、第三方 API、生成、存储或下载时，先写明成本来源和用户级限制。',
      '为免费、试用或低权限用户覆盖额度绕过、并发请求、重复请求、越权身份和异常恢复等负向场景。',
      '上线前明确成本/用量指标、报警阈值、负责人和可执行止损动作。',
    ],
    warnings,
  };
}

async function readActiveTasks(projectRoot) {
  const state = await readJson(cjoin(projectRoot, '.openprd', 'state', 'changes.json')).catch(() => null);
  const activeChange = state?.activeChange ?? null;
  if (!activeChange) {
    return {
      activeChange: null,
      total: 0,
      done: 0,
      pending: 0,
      blocked: 0,
      tasks: [],
      excludedTasks: [],
      excludedActiveChange: null,
    };
  }
  const lifecycleStatus = String(state?.changes?.[activeChange]?.status ?? '').trim().toLowerCase();
  const currentChangeDir = cjoin(projectRoot, '.openprd', 'changes', activeChange);
  const archivedChangeDir = cjoin(projectRoot, '.openprd', 'archive', 'changes', activeChange);
  const archivedOnDisk = !(await exists(currentChangeDir)) && await exists(archivedChangeDir);
  if (HISTORICAL_LIFECYCLE_STATUSES.has(lifecycleStatus) || archivedOnDisk) {
    return {
      activeChange: null,
      total: 0,
      done: 0,
      pending: 0,
      blocked: 0,
      tasks: [],
      excludedTasks: [],
      excludedActiveChange: {
        id: activeChange,
        status: archivedOnDisk ? 'archived' : lifecycleStatus,
        reason: 'historical-context-only',
      },
    };
  }
  const taskFiles = [];
  for (const root of [
    cjoin('.openprd', 'changes', activeChange),
  ]) {
    const dir = cjoin(projectRoot, root);
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (/^tasks.*\.md$/.test(entry)) {
        taskFiles.push(cjoin(root, entry));
      }
    }
  }
  const tasks = [];
  for (const relativePath of taskFiles) {
    const text = await readText(cjoin(projectRoot, relativePath)).catch(() => '');
    const lines = text.split(/\r?\n/);
    let currentTask = null;
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^\s*-\s+\[([ xX~-])\]\s+(.+)$/);
      if (match) {
        const done = /x/i.test(match[1]);
        const blocked = match[1] === '~' || /blocked|阻塞/i.test(match[2]);
        const title = match[2].trim();
        const structured = title.match(/^(T\d{3}\.\d+)\s+(.+)$/);
        currentTask = {
          id: structured?.[1] ?? null,
          title: structured?.[2]?.trim() ?? title,
          done,
          blocked,
          source: relativePath,
          line: index + 1,
          metadata: {},
        };
        tasks.push(currentTask);
        continue;
      }
      const metadataMatch = lines[index].match(/^\s{2,}-\s+([a-z0-9_-]+):\s*(.*)$/i);
      if (currentTask && metadataMatch) {
        currentTask.metadata[metadataMatch[1].toLowerCase()] = metadataMatch[2].trim();
      }
    }
  }
  const historicalMetadataKeys = ['status', 'lifecycle', 'lifecycle-status', 'lifecycle_status', 'history', 'mode', 'scope'];
  const excludedTasks = tasks.filter((task) => historicalMetadataKeys.some((key) => (
    HISTORICAL_TASK_METADATA_VALUES.has(String(task.metadata?.[key] ?? '').trim().toLowerCase())
  )));
  const excludedTaskSet = new Set(excludedTasks);
  const currentTasks = tasks.filter((task) => !excludedTaskSet.has(task));
  const taskById = new Map(currentTasks.filter((task) => task.id).map((task) => [task.id, task]));
  const blockedTasks = currentTasks
    .filter((task) => !task.done)
    .map((task) => {
      const deps = parseOpenSpecTaskDeps(task.metadata?.deps);
      const missing = [];
      const incomplete = [];
      for (const depId of deps) {
        const dependency = taskById.get(depId);
        if (!dependency) {
          missing.push(depId);
          continue;
        }
        if (!dependency.done) {
          incomplete.push(depId);
        }
      }
      return {
        task,
        deps,
        missing,
        incomplete,
        ready: missing.length === 0 && incomplete.length === 0,
      };
    })
    .filter((item) => !item.ready);
  return {
    activeChange,
    total: currentTasks.length,
    done: currentTasks.filter((task) => task.done).length,
    pending: currentTasks.filter((task) => !task.done).length,
    blocked: blockedTasks.length,
    tasks: currentTasks,
    excludedTasks,
    excludedActiveChange: null,
  };
}

async function listKnowledgeFiles(projectRoot) {
  const knowledgeRoot = cjoin(projectRoot, '.openprd', 'knowledge');
  const collected = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = cjoin(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        collected.push({ path: path.relative(projectRoot, fullPath) });
      }
    }
  }
  await walk(knowledgeRoot);
  return collected;
}

function detectKnowledge({ config, knowledgeFiles, candidateState, knowledgeIndex }) {
  const skillDir = config.knowledge.skillDir ?? '.openprd/knowledge/skills';
  const candidateDir = config.knowledge.candidateDir ?? KNOWLEDGE_CANDIDATES_DIR;
  const draftDir = config.knowledge.draftDir ?? KNOWLEDGE_DRAFTS_DIR;
  const skills = knowledgeFiles
    .filter((file) => file.path.startsWith(skillDir.replace(/\//g, path.sep)) || file.path.startsWith(skillDir))
    .filter((file) => file.path.endsWith('SKILL.md'))
    .map((file) => file.path);
  const candidateFiles = knowledgeFiles
    .filter((file) => file.path.startsWith(candidateDir.replace(/\//g, path.sep)) || file.path.startsWith(candidateDir))
    .filter((file) => file.path.endsWith('candidate.json'))
    .map((file) => file.path);
  const pendingCandidates = (candidateState?.pending ?? []).map((candidate) => candidate.path).filter(Boolean);
  const reviewedCandidates = (candidateState?.reviewed ?? []).map((candidate) => candidate.path).filter(Boolean);
  const drafts = knowledgeFiles
    .filter((file) => file.path.startsWith(draftDir.replace(/\//g, path.sep)) || file.path.startsWith(draftDir))
    .filter((file) => file.path.endsWith('SKILL.md'))
    .map((file) => file.path);
  const incidents = knowledgeFiles.filter((file) => /\.openprd[\\/]knowledge[\\/]incidents[\\/].+\.json$/.test(file.path));
  const adoption = buildKnowledgeAdoptionSummary(Array.isArray(knowledgeIndex?.skills) ? knowledgeIndex.skills : []);
  const warnings = [];
  const hasReusableArtifact = skills.length > 0 || pendingCandidates.length > 0 || Number(candidateState?.counts?.total ?? 0) > 0;
  if (config.knowledge.enabled && skills.length === 0 && !hasReusableArtifact) {
    warnings.push('项目级经验 skill 库尚为空；只有重复、高影响或难以重新发现的问题才需要显式沉淀。');
  }
  if (config.knowledge.enabled && pendingCandidates.length > 0) {
    warnings.push(`当前有 ${pendingCandidates.length} 个历史待确认 knowledge candidate；它们不影响本次任务或默认收口。`);
  }
  if (config.knowledge.enabled && skills.length > 0 && adoption.totals.referenced === 0) {
    warnings.push('项目级经验 skill 已产出，但还没有任何 run-context 引用记录；优先接入候选召回与判断注入链路。');
  }
  return {
    status: !config.knowledge.enabled || hasReusableArtifact ? 'pass' : 'needs-attention',
    enabled: config.knowledge.enabled,
    skillDir,
    candidateDir,
    draftDir,
    skills,
    candidates: pendingCandidates,
    candidateFiles,
    candidateCounts: candidateState?.counts ?? {
      total: candidateFiles.length,
      pending: pendingCandidates.length,
      promoted: 0,
      rejected: 0,
      archived: 0,
      reviewed: reviewedCandidates.length,
      byStatus: {},
    },
    reviewedCandidates,
    candidateDetails: candidateState?.candidates ?? [],
    adoption,
    drafts,
    incidents: incidents.map((file) => file.path),
    recommendations: [
      '每次问题修复后记录症状、排查路径、根因模式、修复方式、验证证据和下次触发条件。',
      '只有重复、高影响、隐性知识或 Agent 误判类问题才升级为项目级 skill。',
      '生成 skill 时按抽象模式写触发条件和验证步骤，避免只记录一次性事故流水账。',
    ],
    warnings,
  };
}

function detectGrowth({ config, growthLedger }) {
  const summary = growthLedger?.summary ?? {};
  const lifecycleCount = Number(summary.observed ?? 0)
    + Number(summary.manualApplied ?? 0)
    + Number(summary.autoApplied ?? 0)
    + Number(summary.reconciledAutoApplied ?? 0)
    + Number(summary.rejected ?? 0)
    + Number(summary.skipped ?? 0);
  const completionCheckpoints = Number(summary.completionCheckpoints ?? 0);
  const eventCount = Number(summary.eventCount ?? 0);
  const warnings = [];
  if (config.growth?.enabled && lifecycleCount === 0) {
    warnings.push('当前没有显式 growth 观察；只有确实形成可复用配置或偏好时才需要记录。');
  }
  return {
    status: 'pass',
    enabled: config.growth?.enabled !== false,
    ledgerPath: config.growth?.ledgerPath ?? OPENPRD_GROWTH_LEDGER,
    summary: {
      eventCount,
      lifecycleCount,
      completionCheckpoints,
      current: summary.current ?? { total: 0, pending: 0, applied: 0, rejected: 0 },
    },
    warnings,
  };
}

function buildGate({ id, label, baseStatus, baseWarnings, policy, evidenceLedger, scope = 'workspace-claim' }) {
  const required = policy.requiredGates.includes(id);
  const evidence = evidenceLedger[id] ?? { present: false, sources: [], summary: '未找到本次执行证据' };
  let status = baseStatus;
  const warnings = [...baseWarnings];
  if (!required && status !== 'pass') {
    status = 'advisory';
    warnings.push('当前场景未要求阻断此门禁；若准备发布或该风险进入范围，需要补齐证据。');
  }
  if (required && policy.evidenceRequired && status === 'pass' && !evidence.present) {
    status = 'needs-evidence';
    warnings.push('当前场景要求此门禁，但未找到本次执行或明确豁免证据。');
  }
  return {
    id,
    label,
    scope,
    status,
    required,
    evidence,
    warnings,
  };
}

function buildGates({ observability, evalHarness, businessGuardrails, knowledge, growth, visualReview, policy, evidenceLedger }) {
  return [
    buildGate({
      id: 'traceability',
      label: '日志链路可追踪',
      baseStatus: observability.status,
      baseWarnings: observability.warnings,
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'redaction',
      label: '日志脱敏策略',
      baseStatus: observability.redactionRequired ? (evidenceLedger.redaction?.present ? 'pass' : 'needs-evidence') : 'pass',
      baseWarnings: observability.redactionRequired ? ['需要在项目文档、平台配置或本次测试证据中确认敏感字段脱敏策略。'] : [],
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'business-guardrails',
      label: '业务成本与滥用护栏',
      baseStatus: businessGuardrails.status,
      baseWarnings: businessGuardrails.warnings,
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'test-strategy',
      label: '分层测试策略',
      baseStatus: evalHarness.testStrategy.status,
      baseWarnings: evalHarness.testStrategy.warnings,
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'smoke',
      label: '冒烟测试体系',
      baseStatus: evalHarness.smoke.present ? 'pass' : 'needs-attention',
      baseWarnings: evalHarness.smoke.present ? [] : ['缺少冒烟/e2e 体系或本次冒烟验证入口。'],
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'feature-coverage',
      label: '任务与功能覆盖',
      baseStatus: evalHarness.featureCoverage.activeTasks.pending === 0 ? 'pass' : 'needs-attention',
      baseWarnings: evalHarness.featureCoverage.activeTasks.pending === 0
        ? []
        : [describeFeatureCoverageLedger(evalHarness.featureCoverage.activeTasks) ?? '仍有未完成任务或缺少任务覆盖证据。'],
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'visual-review',
      label: '视觉对比与自检',
      baseStatus: visualReview.status,
      baseWarnings: visualReview.warnings,
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'normal-performance',
      label: '正常性能基线',
      baseStatus: evalHarness.performance.present ? 'pass' : 'needs-attention',
      baseWarnings: evalHarness.performance.present ? [] : ['缺少性能测试命令或正常性能基线证据。'],
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'extreme-performance',
      label: '极端场景压力',
      baseStatus: evalHarness.extremeData.present ? 'pass' : 'needs-attention',
      baseWarnings: evalHarness.extremeData.present ? [] : ['缺少极端数据或压力场景。'],
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'knowledge',
      label: '经验 Skill 沉淀',
      baseStatus: knowledge.status,
      baseWarnings: knowledge.warnings,
      policy,
      evidenceLedger,
    }),
    buildGate({
      id: 'growth',
      label: '自我成长账本',
      baseStatus: growth.status,
      baseWarnings: growth.warnings,
      policy,
      evidenceLedger,
    }),
  ];
}

async function loadPackageJson(projectRoot) {
  return readJson(cjoin(projectRoot, 'package.json')).catch(() => null);
}

async function buildQualityReport(projectRoot, config, options = {}) {
  const id = options.reportId ?? reportId();
  const normalizedConfig = normalizeQualityConfig(config);
  const files = await walkProject(projectRoot);
  const texts = await readProjectTexts(projectRoot, files);
  const packageJson = await loadPackageJson(projectRoot);
  const activeTasks = await readActiveTasks(projectRoot);
  const activeChangeContext = await readActiveChangeContext(projectRoot, activeTasks.activeChange);
  const evidenceFiles = await readEvidenceFiles(projectRoot, normalizedConfig);
  const visualArtifacts = await listVisualReviewArtifacts(projectRoot);
  const knowledgeFiles = await listKnowledgeFiles(projectRoot);
  const knowledgeIndex = await readJson(qualityPath(projectRoot, KNOWLEDGE_INDEX)).catch(() => ({ version: 1, skills: [] }));
  const growthLedger = await readJson(qualityPath(projectRoot, normalizedConfig.growth?.ledgerPath ?? OPENPRD_GROWTH_LEDGER)).catch(() => null);
  const completionState = detectCompletionState({ files, activeTasks, evidenceFiles });
  const observability = detectObservability({ config: normalizedConfig, files, texts, packageJson });
  const evalHarness = detectEvalHarness({ config: normalizedConfig, files, texts, packageJson, activeTasks, evidenceFiles });
  const businessGuardrails = detectBusinessGuardrails({ config: normalizedConfig, files, texts, packageJson });
  const candidateState = await listKnowledgeCandidates(projectRoot, { status: 'all' }).catch(() => null);
  const knowledge = detectKnowledge({ config: normalizedConfig, knowledgeFiles, candidateState, knowledgeIndex });
  const growth = detectGrowth({ config: normalizedConfig, growthLedger });
  const policy = buildQualityPolicy({ config: normalizedConfig, activeChangeContext, activeTasks, businessGuardrails, evalHarness });
  const visualReview = detectVisualReview({ policy, activeChangeContext, activeTasks, visualArtifacts, includesAny });
  const evidenceLedger = buildEvidenceLedger({ evidenceFiles, activeTasks, observability, businessGuardrails, knowledge, growth, visualReview, mediaEvidence: evalHarness.testStrategy.mediaEvidence });
  const gates = buildGates({ observability, evalHarness, businessGuardrails, knowledge, growth, visualReview, policy, evidenceLedger });
  const blockingStatuses = new Set(['fail']);
  const attentionStatuses = new Set(['needs-attention', 'needs-evidence']);
  const readiness = {
    scope: 'workspace-claim',
    ok: !gates.some((gate) => blockingStatuses.has(gate.status)),
    productionReady: !gates.some((gate) => attentionStatuses.has(gate.status) || blockingStatuses.has(gate.status)),
    enforcement: normalizedConfig.enforcement,
    effectiveEnforcement: options.effectiveEnforcement ?? {
      mode: normalizedConfig.enforcement,
      source: QUALITY_CONFIG,
      scope: 'workspace-claim',
    },
    failingGates: gates.filter((gate) => blockingStatuses.has(gate.status)).map((gate) => gate.id),
    attentionGates: gates.filter((gate) => attentionStatuses.has(gate.status)).map((gate) => gate.id),
  };
  evalHarness.executionEvidence = {
    sources: evidenceFiles.map((file) => ({ path: file.path, source: file.source, size: file.size })).slice(0, 120),
    ledger: Object.fromEntries(['test-strategy', 'smoke', 'feature-coverage', 'visual-review', 'normal-performance', 'extreme-performance'].map((gate) => [gate, evidenceLedger[gate]])),
  };
  return {
    version: 1,
    schema: 'openprd.eval-report.v1',
    id,
    generatedAt: timestamp(),
    projectRoot,
    summary: {
      status: readiness.productionReady ? 'production-ready' : 'needs-attention',
      filesScanned: files.length,
      activeChange: activeTasks.activeChange,
      gateCount: gates.length,
      attentionCount: readiness.attentionGates.length,
    },
    readiness,
    qualityPolicy: policy,
    evidenceLedger,
    gates,
    observability,
    evalHarness,
    businessGuardrails,
    visualReview,
    knowledge,
    growth,
    completionState,
    configSnapshot: normalizedConfig,
  };
}

export async function initQualityWorkspace(projectRoot, options = {}) {
  const { config, changed } = await mergeQualityConfig(projectRoot, { force: Boolean(options.force) });
  const knowledgeIndexPath = qualityPath(projectRoot, KNOWLEDGE_INDEX);
  if (!(await exists(knowledgeIndexPath))) {
    await writeJson(knowledgeIndexPath, {
      version: 1,
      updatedAt: timestamp(),
      incidents: [],
      patterns: [],
      skills: [],
      candidates: [],
      drafts: [],
    });
  }
  return {
    ok: true,
    action: 'quality-init',
    projectRoot,
    config,
    changed,
    files: {
      config: qualityPath(projectRoot, QUALITY_CONFIG),
      knowledgeIndex: knowledgeIndexPath,
    },
  };
}

export async function verifyQualityWorkspace(projectRoot, options = {}) {
  const configPath = qualityPath(projectRoot, QUALITY_CONFIG);
  if (!(await exists(configPath))) {
    return {
      ok: false,
      action: 'quality-verify',
      projectRoot,
      errors: [`${QUALITY_CONFIG} is required. Run: openprd quality . --init`],
    };
  }
  const config = normalizeQualityConfig(await readJson(configPath));
  const strict = options.strict === true;
  const advisory = options.advisory === true && !strict;
  const effectiveEnforcement = {
    mode: strict ? 'blocking' : advisory ? 'advisory' : config.enforcement,
    source: strict ? 'invocation.strict' : advisory ? 'invocation.advisory' : QUALITY_CONFIG,
    configuredMode: config.enforcement,
    scope: 'workspace-claim',
    purpose: 'overall-readiness-claim',
  };
  await ensureQualityDirs(projectRoot);
  const report = await buildQualityReport(projectRoot, config, { effectiveEnforcement });
  const blocking = effectiveEnforcement.mode === 'blocking' && !report.readiness.productionReady;
  const featureCoverageOnly = report.readiness.failingGates.length === 0
    && report.readiness.attentionGates.length === 1
    && report.readiness.attentionGates[0] === 'feature-coverage';
  return {
    ok: !blocking,
    action: 'quality-verify',
    projectRoot,
    scope: 'workspace-claim',
    effectiveEnforcement,
    report,
    summary: {
      status: report.summary.status,
      productionReady: report.readiness.productionReady,
      requiredChecks: report.gates.filter((gate) => gate.required).map((gate) => ({
        id: gate.id,
        status: gate.status,
      })),
      attention: report.readiness.attentionGates,
    },
    artifactGeneration: {
      enabled: false,
      reason: 'OpenPrd quality verification returns an in-memory summary and no longer writes eval JSON/HTML artifacts.',
      preservedLegacyReportsDir: qualityPath(projectRoot, QUALITY_REPORTS_DIR),
    },
    reportPath: null,
    htmlPath: null,
    indexPath: null,
    growthCheckpoint: null,
    knowledgeReview: null,
    errors: blocking
      ? [
        featureCoverageOnly
          ? (describeFeatureCoverageLedger(report.evalHarness?.featureCoverage?.activeTasks ?? null)
            ?? '当前 feature-coverage 账本尚未收口，不等于当前实现失败。')
          : 'Quality readiness is not production-ready; one or more required gates need evidence or attention.',
      ]
      : [],
  };
}

export async function learnQualityWorkspace(projectRoot, options = {}) {
  await ensureQualityDirs(projectRoot);
  const configPath = qualityPath(projectRoot, QUALITY_CONFIG);
  const config = normalizeQualityConfig(await readJson(configPath).catch(() => defaultQualityConfig()));
  const latest = await readJson(qualityPath(projectRoot, QUALITY_LATEST)).catch(() => null);
  const resolved = await resolveQualityLearningSource(projectRoot, {
    from: options.from,
    latestReportPath: latest?.jsonPath ?? null,
    requiredCorrelationFields: config.observability.requiredCorrelationFields,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      action: 'quality-learn',
      projectRoot,
      errors: [resolved.error],
    };
  }
  const source = resolved.source;
  const { incidentId, patternId, skillName } = deriveKnowledgeNames(source, { stablePattern: true });
  const incidentPath = qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'incidents', `${incidentId}.json`));
  const patternPath = qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'patterns', `${patternId}.json`));
  const skillDir = qualityPath(projectRoot, cjoin(KNOWLEDGE_DIR, 'skills', skillName));
  const skillPath = cjoin(skillDir, 'SKILL.md');
  await writeJson(incidentPath, {
    version: 1,
    incidentId,
    sourceKind: source.kind,
    sourceRef: source.sourceId,
    sourcePath: source.sourcePath,
    sourcePaths: source.sourcePaths,
    capturedAt: timestamp(),
    title: source.title,
    status: source.status,
    symptoms: source.symptoms,
    attentionGates: source.attentionGates,
    correlationFields: source.correlationFields,
    extraContextFields: source.extraContextFields,
    missingCorrelationFields: source.missingCorrelationFields,
    eventNames: source.eventNames,
    evidenceSources: source.evidenceSources,
    rootCauseCandidates: source.rootCauseCandidates,
    queryExamples: source.queryExamples,
    verification: {
      fixed: false,
      evidence: [],
      recommendedSteps: source.verificationSteps,
    },
  });
  await writeJson(patternPath, {
    version: 1,
    patternId,
    sourceKind: source.kind,
    sourceRef: source.sourceId,
    abstractPattern: source.abstractPattern,
    triggers: source.triggers,
    requiredCorrelationFields: source.correlationFields,
    missingCorrelationFields: source.missingCorrelationFields,
    preferredEvidenceOrder: source.evidenceSources.map((item) => item.kind),
    keyEvents: source.eventNames,
    rootCauseLabels: source.rootCauseCandidates.map((item) => item.title),
    prevention: source.prevention,
    verificationSteps: source.verificationSteps,
    updatedAt: timestamp(),
  });
  await writeText(skillPath, renderExperienceSkill({ skillName, source }));
  const indexPath = qualityPath(projectRoot, KNOWLEDGE_INDEX);
  const index = await readJson(indexPath).catch(() => ({ version: 1, incidents: [], patterns: [], skills: [], candidates: [], drafts: [] }));
  const upsert = (items, key, value) => [value, ...(Array.isArray(items) ? items.filter((item) => item[key] !== value[key]) : [])].slice(0, 200);
  await writeJson(indexPath, {
    version: 1,
    updatedAt: timestamp(),
    incidents: upsert(index.incidents, 'incidentId', { incidentId, path: incidentPath, sourceKind: source.kind, sourceRef: source.sourceId }),
    patterns: upsert(index.patterns, 'patternId', { patternId, path: patternPath, sourceKind: source.kind, sourceRef: source.sourceId }),
    skills: upsert(index.skills, 'skillName', { skillName, path: skillPath, sourceKind: source.kind, sourceRef: source.sourceId }),
    candidates: Array.isArray(index.candidates) ? index.candidates : [],
    drafts: Array.isArray(index.drafts) ? index.drafts : [],
  });
  await markKnowledgeCandidatePromoted(projectRoot, {
    sourcePath: source.sourcePath,
    sourcePaths: source.sourcePaths,
    skillPath,
    incidentPath,
    patternPath,
  }).catch(() => null);
  return {
    ok: true,
    action: 'quality-learn',
    projectRoot,
    sourceKind: source.kind,
    sourcePath: source.sourcePath,
    sourcePaths: source.sourcePaths,
    sourceReportPath: source.kind === 'quality-report' ? source.sourcePath : null,
    incidentId,
    patternId,
    skillName,
    files: {
      incident: incidentPath,
      pattern: patternPath,
      skill: skillPath,
      index: indexPath,
    },
  };
}

export async function qualityWorkspace(projectRoot, options = {}) {
  if (options.init) {
    return initQualityWorkspace(projectRoot, options);
  }
  if (options.learn && options.review) {
    const config = normalizeQualityConfig(await readJson(qualityPath(projectRoot, QUALITY_CONFIG)).catch(() => defaultQualityConfig()));
    return reviewKnowledgeWorkspace(projectRoot, {
      from: options.from,
      requiredCorrelationFields: config.observability.requiredCorrelationFields,
    });
  }
  if (options.learn) {
    return learnQualityWorkspace(projectRoot, options);
  }
  return verifyQualityWorkspace(projectRoot, options);
}
