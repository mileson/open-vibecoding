import fs from 'node:fs/promises';
import path from 'node:path';
import { labelExecutionMode, taskExecutionStrategy, describeExecutionStrategy } from './execution-strategy.js';
import { appendJsonl, appendText, cjoin, exists, readJson, readJsonl, writeJson, writeText } from './fs-utils.js';
import {
  OPENPRD_HARNESS_TURN_STATE,
  recordKnowledgeReviewSignal,
  recordKnowledgeSkillAdoption,
  resolveKnowledgeSkillMatches,
  reviewKnowledgeWorkspace,
} from './knowledge.js';
import { readSessionBinding } from './session-binding.js';
import { readSessionRegistryEntry } from './session-registry.js';
import { timestamp } from './time.js';
import { readWorkspaceRegistry } from './workspace-registry.js';

const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_RUN_STATE = cjoin(OPENPRD_HARNESS_DIR, 'run-state.json');
const OPENPRD_HARNESS_ITERATIONS = cjoin(OPENPRD_HARNESS_DIR, 'iterations.jsonl');
const OPENPRD_HARNESS_LEARNINGS = cjoin(OPENPRD_HARNESS_DIR, 'learnings.md');
const OPENPRD_HARNESS_LOOP_FEATURE_LIST = cjoin(OPENPRD_HARNESS_DIR, 'feature-list.json');
const OPENPRD_HARNESS_INSTALL_MANIFEST = cjoin(OPENPRD_HARNESS_DIR, 'install-manifest.json');
const OPENPRD_HARNESS_HOOK_STATE = cjoin(OPENPRD_HARNESS_DIR, 'hook-state.json');
const OPENPRD_HARNESS_RUNTIME_ENVIRONMENT = cjoin(OPENPRD_HARNESS_DIR, 'runtime-environment.json');
const OPENPRD_HARNESS_REQUIREMENT_GATE = cjoin(OPENPRD_HARNESS_DIR, 'requirement-gate.json');
const OPENPRD_HARNESS_REQUIREMENT_GATES_DIR = cjoin(OPENPRD_HARNESS_DIR, 'requirement-gates');
const OPENPRD_HARNESS_SESSION_BINDINGS_DIR = cjoin(OPENPRD_HARNESS_DIR, 'session-bindings');
const OPENPRD_HARNESS_EVENTS = cjoin(OPENPRD_HARNESS_DIR, 'events.jsonl');
const OPENPRD_WORK_UNITS_DIR = cjoin('.openprd', 'engagements', 'work-units');
const OPENPRD_PARALLEL_WORKER_IMPLEMENTATION_TASK_THRESHOLD = 3;
const OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD = 10;
const CONTINUATION_SESSION_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const CONTINUATION_TASK_HANDLE_PATTERN = /\b[a-z0-9._-]+:T\d{3}\.\d{2}:[a-z0-9._-]+\b/i;
const CONTINUATION_WORK_UNIT_PATTERN = /\bwu-[a-z0-9._-]+\b/i;
const CONTINUATION_EXPLICIT_PATTERN = /(?:(?:继续|续做|接着做|继续执行|继续推进)(?:这个|这条|当前)?\s*(?:对话|任务|会话|记录|历史|Codex\s*任务)|(?:对话|任务|会话|记录|历史|Codex\s*任务).{0,6}(?:继续|续做|接着做|继续执行|继续推进)|^(?:继续|续做|接着做|继续执行|继续推进)\s*(?::|：))/i;
const CONTINUATION_CURRENT_PATTERN = /(继续当前|当前(这个|这条)?(任务|会话|记录|需求|变更)|current\s+(task|change|session)|resume current)/i;
const SHORT_AFFIRMATIVE_PATTERN = /^(可以|好|行|确认|没问题|OK|ok|yes|Yes|yep|Yep)[。！!,.，\s]*$/;
const EXPLICIT_ISOLATION_NEGATION_PATTERN = /(?:(?:不要|别|不用|无需|不需要|禁止|不要再|不想).{0,8}(?:单独环境|隔离环境|独立环境|独立\s*(?:session|cwd)|独立工作树|单独\s*worktree|worktree|新分支|独立分支)|(?:单独环境|隔离环境|独立环境|独立\s*(?:session|cwd)|独立工作树|单独\s*worktree|worktree|新分支|独立分支).{0,8}(?:不要|别|不用|无需|不需要|禁止))/i;
const EXPLICIT_ISOLATION_REQUEST_PATTERNS = [
  /(?:请|麻烦|需要|希望|可以|最好|改成|按).{0,8}(?:单独环境|隔离环境|独立环境|独立\s*(?:session|cwd)|独立工作树|单独\s*worktree|worktree|新分支|独立分支).{0,12}(?:继续|处理|推进|实现|做|执行)/i,
  /(?:继续|处理|推进|实现|做|执行).{0,12}(?:单独环境|隔离环境|独立环境|独立\s*(?:session|cwd)|独立工作树|单独\s*worktree|worktree|新分支|独立分支)/i,
  /(?:use|with|in)\s+(?:an?\s+)?(?:isolated|separate|dedicated)\s+(?:environment|session|cwd|worktree|branch)/i,
];
const EXPLICIT_BRAINSTORM_REQUEST = /(脑暴|brainstorm|帮忙梳理|梳理一下|梳理下|先想清楚)/iu;
function harnessFile(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function rootsEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  return path.resolve(left) === path.resolve(right);
}

function hasExplicitIsolationRequest(message = null) {
  const text = String(message ?? '').trim();
  if (!text || EXPLICIT_ISOLATION_NEGATION_PATTERN.test(text)) {
    return false;
  }
  return EXPLICIT_ISOLATION_REQUEST_PATTERNS.some((pattern) => pattern.test(text));
}

async function ensureRunHarness(projectRoot) {
  await fs.mkdir(harnessFile(projectRoot, OPENPRD_HARNESS_DIR), { recursive: true });
  const statePath = harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE);
  if (!(await exists(statePath))) {
    await writeJson(statePath, {
      version: 1,
      active: true,
      currentIteration: 0,
      lastContextAt: null,
      lastHookAt: null,
      lastOutcome: null,
      lastRecommendation: null,
    });
  }
  const iterationsPath = harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS);
  if (!(await exists(iterationsPath))) {
    await writeText(iterationsPath, '');
  }
  const learningsPath = harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS);
  if (!(await exists(learningsPath))) {
    await writeText(learningsPath, '# OpenPrd Harness Learnings\n\nReusable patterns discovered during hook-driven runs belong here.\n');
  }
}

async function readRuntimeEnvironmentContext(projectRoot) {
  const [runtimeEnvironment, installManifest, hookState] = await Promise.all([
    readJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUNTIME_ENVIRONMENT)).catch(() => null),
    readJson(harnessFile(projectRoot, OPENPRD_HARNESS_INSTALL_MANIFEST)).catch(() => null),
    readJson(harnessFile(projectRoot, OPENPRD_HARNESS_HOOK_STATE)).catch(() => null),
  ]);
  const active = runtimeEnvironment?.active
    ?? hookState?.runtimeEnvironment
    ?? {
      activeClient: 'unknown',
      surface: 'unknown',
      confidence: 0,
      sessionId: null,
      evidence: [],
      observedCapabilities: [],
    };
  return {
    active,
    runtimeDetection: installManifest?.runtimeDetection ?? runtimeEnvironment?.runtimeDetection ?? null,
    platformCapabilityPacks: installManifest?.platformCapabilityPacks ?? runtimeEnvironment?.platformCapabilityPacks ?? [],
    files: {
      runtimeEnvironment: OPENPRD_HARNESS_RUNTIME_ENVIRONMENT,
      installManifest: OPENPRD_HARNESS_INSTALL_MANIFEST,
      hookState: OPENPRD_HARNESS_HOOK_STATE,
    },
  };
}

async function readRunState(projectRoot) {
  await ensureRunHarness(projectRoot);
  return readJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE)).catch(() => ({
    version: 1,
    active: true,
    currentIteration: 0,
  }));
}

async function readActiveRequirementGate(projectRoot) {
  const gate = await readJson(harnessFile(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATE)).catch(() => null);
  return gate?.active ? gate : null;
}

async function writeRunState(projectRoot, state) {
  await writeJson(harnessFile(projectRoot, OPENPRD_HARNESS_RUN_STATE), {
    version: 1,
    active: true,
    ...state,
    updatedAt: timestamp(),
  });
}

function compactTask(task) {
  if (!task) {
    return null;
  }
  const executionStrategy = taskExecutionStrategy(task);
  return {
    id: task.id,
    taskHandle: task.taskHandle ?? null,
    title: task.title,
    relativePath: task.relativePath,
    lineNumber: task.lineNumber,
    verify: task.metadata?.verify ?? null,
    done: task.metadata?.done ?? null,
    oracle: task.metadata?.oracle ?? null,
    deps: task.metadata?.deps ?? null,
    type: task.metadata?.type ?? task.metadata?.category ?? task.metadata?.kind ?? null,
    executionStrategy,
    executionStrategyDescription: describeExecutionStrategy(executionStrategy),
  };
}

function workerCandidateFromTask(task) {
  const executionStrategy = taskExecutionStrategy(task);
  if (executionStrategy.ownerRole !== 'worker') {
    return null;
  }
  return {
    id: task.id,
    title: task.title,
    parallelGroup: executionStrategy.parallelGroup,
    writeScope: executionStrategy.writeScope,
    localVerify: executionStrategy.localVerify,
  };
}

function buildParallelPlan({ executionMode, taskState, focusTask, worktreeRecommended = false }) {
  const eligible = executionMode !== 'serial';
  const workerCandidates = (taskState?.tasks ?? [])
    .filter((task) => !task.checked)
    .map(workerCandidateFromTask)
    .filter(Boolean);
  const groups = [...new Set(workerCandidates.map((task) => task.parallelGroup))];
  const focusCandidate = focusTask?.executionStrategy?.ownerRole === 'worker'
    ? {
        id: focusTask.id,
        title: focusTask.title,
        parallelGroup: focusTask.executionStrategy.parallelGroup,
        writeScope: focusTask.executionStrategy.writeScope,
        localVerify: focusTask.executionStrategy.localVerify,
      }
    : workerCandidates.find((task) => task.id === focusTask?.id) ?? null;

  return {
    eligible,
    coordinator: 'main-agent',
    integrationOwner: 'main-agent',
    worktreeRecommended,
    shardBasis: eligible ? 'write-scope-and-parallel-group' : 'single-thread',
    suggestedWorkers: eligible ? Math.min(workerCandidates.length, worktreeRecommended ? 4 : 3) : 0,
    workerTaskCount: workerCandidates.length,
    groups,
    focusTask: focusCandidate,
    workerCandidates: workerCandidates.slice(0, worktreeRecommended ? 4 : 3),
    summary: eligible
      ? (
          worktreeRecommended
            ? '建议主 Agent 按 write-scope 和 parallel-group 把任务分给多个隔离 worker，会后由主 Agent 统一做集成审查和总验证。'
            : '建议主 Agent 按 write-scope 和 parallel-group 分配边界清晰的 worker shard，worker 先做局部实现和局部验证，再由主 Agent 收口。'
        )
      : '当前任务保持主 Agent 串行推进即可。',
  };
}

function compactCoverageItem(item) {
  if (!item) {
    return null;
  }
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    source: item.source ?? null,
    evidence: item.evidence ?? [],
  };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function slugify(value, fallback = 'openprd-generated-change') {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || fallback;
}

function reviewMarkCommand(snapshot) {
  if (!snapshot?.versionId || !snapshot?.digest) {
    return 'openprd review . --mark confirmed';
  }
  const parts = [
    'openprd review . --mark confirmed',
    `--version ${shellQuote(snapshot.versionId)}`,
    `--digest ${shellQuote(snapshot.digest)}`,
  ];
  if (snapshot.workUnitId) {
    parts.push(`--work-unit ${shellQuote(snapshot.workUnitId)}`);
  }
  return parts.join(' ');
}

function executionGate() {
  return {
    requiresExplicitIntent: true,
    confirmationChecklistRequired: true,
    allowedIntents: ['开发', '实现', '修复', '继续任务', '落地执行', '深度调研', '深度对标', '复刻落地', '提交'],
    readOnlyIntents: ['看看', '规划', '梳理', '分析', '评估', '预计动哪些文件', '怎么改', '代码审查'],
    rule: '只有当用户当前明确要求实现、继续、深度调研、对标或提交时，才运行 executionCommand。单纯的“请帮我实现/继续实现”只表示有执行意图，不表示可以跳过 requirement 摘要确认、`capture/classify/synthesize` 写入路径或 review；只有用户明确表示“不需要进行任何确认”时，才允许静默走完整 requirement write path，并对当前精确匹配的稳定 review artifact 记录确认。即使用户授权实现，也不等于授权云端热修复、生产远端写入、业务兜底、写死逻辑或缓存补行；这些动作必须由当前用户明确批准，并说明如何同步回本地源码、配置或迁移。若还需要向用户索取执行授权，先展示 executionConfirmationChecklist，再请求明确确认；规划、分析、文件影响范围和审查类请求保持只读，并基于证据回答。',
  };
}

function buildExecutionConfirmationChecklist(recommendation) {
  if (!recommendation?.executionCommand) {
    return null;
  }
  const parallelPlan = recommendation.parallelPlan ?? null;
  const scope = [
    '只在这次已经确认的范围内继续推进',
    parallelPlan?.eligible ? '如果需要分头推进，会先划清各自负责的部分，再统一收口' : null,
  ].filter(Boolean);
  return {
    required: true,
    title: '开始动手前先确认这些',
    objective: recommendation.title ?? '继续推进本次调整',
    scope,
    implementationItems: [
      '我会先核对当前情况，再继续整理后续落地内容。',
      '我只会在这次已经确认的范围内继续，不会顺手扩到别的事项。',
      parallelPlan?.eligible ? '如果需要多人配合，我会先划清边界，再统一收口检查。' : null,
    ].filter(Boolean),
    outOfScope: [
      '不会默认处理这次范围以外的历史问题。',
      '不会默认顺带做提交、发布或额外的全局调整。',
      '不会默认做云端热修复、生产远端写入、业务兜底、写死逻辑或缓存补行。',
      '如果真的需要扩大范围，我会先单独说明。',
    ].filter(Boolean),
    verification: [
      '完成后我会补做这次调整需要的检查。',
      parallelPlan?.eligible ? '如果是分头推进，会先各自自检，再统一做总检查。' : null,
      '在宣布完成前，我会再做一次整体核对。',
    ].filter(Boolean),
    risks: [
      '这一步会正式写入当前工作区。',
      '如果牵出和本次无关的历史遗留问题，我会单列说明，不把它混成本次失败。',
      '如果确实需要临时兜底或线上热修复，我会先单独说明影响、回滚和本地同步计划，等你明确批准。',
      parallelPlan?.eligible ? '如果多人同时推进，我会避免范围互相踩踏。' : null,
    ],
    confirmationPrompt: '如果你希望我现在就按这次范围继续，我就直接往下做。',
  };
}

function recommendationNeedsExtraExecutionConfirmation(recommendation, requirementGate) {
  if (!recommendation?.executionCommand) {
    return false;
  }
  const reviewContinuationAuthorized = Boolean(requirementGate?.reviewActionAuthorization?.continueAfterReview);
  const silentReviewRecordingAuthorized = requirementGate?.status === 'review-recording-authorized';
  const implementationAlreadyAuthorized = requirementGate?.status === 'execution-authorized';
  const explicitExecution = Boolean(requirementGate?.intent?.explicitExecution);

  if (recommendation.type === 'prd-change') {
    return !(reviewContinuationAuthorized || silentReviewRecordingAuthorized);
  }
  if (recommendation.type === 'task' || recommendation.type === 'loop-task') {
    return !(implementationAlreadyAuthorized || (explicitExecution && (reviewContinuationAuthorized || silentReviewRecordingAuthorized)));
  }
  return true;
}

function withExecutionConfirmationChecklist(recommendation, options = {}) {
  if (!recommendationNeedsExtraExecutionConfirmation(recommendation, options.requirementGate)) {
    return {
      ...recommendation,
      executionConfirmationChecklist: null,
    };
  }
  const checklist = buildExecutionConfirmationChecklist(recommendation);
  if (!checklist) {
    return recommendation;
  }
  return {
    ...recommendation,
    executionConfirmationChecklist: checklist,
  };
}

function analyzeRunMessage(message = null) {
  const text = String(message ?? '').trim();
  if (!text) {
    return {
      kind: 'default',
      requested: false,
      explicit: false,
      selectorType: null,
      selector: null,
      sessionId: null,
      taskHandle: null,
      workUnitId: null,
      explicitCurrent: false,
      text: '',
    };
  }

  const sessionId = text.match(CONTINUATION_SESSION_PATTERN)?.[0] ?? null;
  const taskHandle = text.match(CONTINUATION_TASK_HANDLE_PATTERN)?.[0] ?? null;
  const workUnitId = text.match(CONTINUATION_WORK_UNIT_PATTERN)?.[0] ?? null;
  const explicit = CONTINUATION_EXPLICIT_PATTERN.test(text);
  const explicitCurrent = CONTINUATION_CURRENT_PATTERN.test(text);
  const requested = explicit || Boolean(taskHandle || workUnitId);
  if (!requested) {
    return {
      kind: 'default',
      requested: false,
      explicit: false,
      selectorType: null,
      selector: null,
      sessionId: null,
      taskHandle: null,
      workUnitId: null,
      explicitCurrent,
      text,
    };
  }

  return {
    kind: 'continuation',
    requested: true,
    explicit,
    selectorType: taskHandle ? 'task-handle' : workUnitId ? 'work-unit' : sessionId ? 'session' : 'implicit',
    selector: taskHandle ?? workUnitId ?? sessionId ?? null,
    sessionId,
    taskHandle,
    workUnitId,
    explicitCurrent,
    text,
  };
}

function inferPromptDrivenLightweightRecommendation(message = null) {
  const text = String(message ?? '').trim();
  if (!text) {
    return null;
  }
  const explicitBrainstorm = EXPLICIT_BRAINSTORM_REQUEST.test(text);
  const readOnly = /(先分析|先看看|先评估|review|审查|怎么改|规划一下|先梳理|先想清楚|会动哪些文件)/i.test(text)
    && !/(直接实现|直接做|直接改|帮我修|帮我实现|请直接实现|继续实现|直接完成)/i.test(text);
  if (explicitBrainstorm || readOnly) {
    return null;
  }
  const noConfirmationRequested = /(不需要(?:先)?(?:来回)?确认|无需(?:任何)?确认|不用确认|别再确认|不要确认|直接完成|直接做完)/i.test(text);
  const scopedFrontendSurface = /(首页|页面|界面|落地页|原型|静态单页|静态页|详情页|设置页|列表页|dashboard|hero|layout|app\s*首页)/i.test(text);
  const scopedFrontendChange = scopedFrontendSurface
    && /(实现|做一个|做个|完成|新增|增加|补一个|优化|调整|改版|重做|prototype|原型)/i.test(text);
  const tinyUiAdjustment = /(按钮|文案|颜色|圆角|位置|间距|字号|图标|标题|空格|标点|label|copy|toast|placeholder)/i.test(text)
    && /(改|调|修|优化|调整|短一点|换成|统一)/i.test(text);
  if (tinyUiAdjustment) {
    return {
      type: 'lightweight-implementation',
      nextAction: 'lightweight-l0',
      title: '按直接处理路径继续',
      command: null,
      verifyCommand: 'openprd run . --verify',
      reason: [
        '当前更像一次局部直接处理，不必先走正式 PRD/review/change/tasks。',
        '直接落地改动并补最小足够验证即可。',
      ].join(' '),
      changeId: null,
      task: null,
      coverageItem: null,
    };
  }
  if (!scopedFrontendChange) {
    return null;
  }
  return {
    type: 'lightweight-implementation',
    nextAction: 'lightweight-l1',
    title: noConfirmationRequested ? '按轻量原型路径继续实现' : '先给 mini-plan 再继续实现',
    command: null,
    verifyCommand: 'openprd run . --verify',
    reason: [
      '当前更像现有功能优化或轻量原型实现，不必先走正式 PRD/review/change/tasks。',
      noConfirmationRequested
        ? '用户已经明确表示不需要先来回确认，可以先用 3-5 行 mini-plan 自定目标、范围内、范围外和验证方式，然后继续实现。'
        : '先用 3-5 行 mini-plan 收一下目标、范围内、范围外和验证方式，再继续实现。',
      '如果是新界面或大幅首页调整，先补 `.openprd/design/active/` 下的 facts-sheet、asset-spec、image-preflight、direction-plan 和 selected-direction；空白工作区优先从 `.openprd/design/templates/` 里挑最近模板。若当前轮用户已经把页面主题、模块范围或“直接实现”的意图说清，优先改用 `openprd run . --context --message <用户原话>` 对齐建议，而不是先跑不带 message 的 context。若页面主题和模块范围已经明确，优先运行 `openprd design-starter . --starter <starter-id> --out index.html --brief "<页面主题>" --sections "<模块1|模块2|模块3>"`，让 starter 一次写实合同和首版文案；只有像个人博客、工具台、纯结构化产品页这类确认不靠真实图片成立的页面，才补 `--no-external-facts --no-brand-assets --no-real-images`。若任务更像旅游、导览、展览、博物馆、城市、自然观察或案例内容页，先不要带 `--no-real-images`，让 starter 先尝试补首批真实图片。若用户已经给了效果图、设计稿、参考截图或其他明确参考图，先把它当主参考源；只有现有 starter、theme、layout 足够接近时才复用，不接近就以参考图为准。若这类冷启动即使带 message 仍短暂返回 `clarify-user`，把它视为摘要级提醒：先用 3-5 行 mini-plan 收口，再进入 starter 后的 `Patch Mode`。`Patch Mode` 的默认动作是继续在当前 `index.html` 上补丁细化；就算想整页重写，也是在同一路径内覆盖，不做 delete-first。如果确实要整页重写，先把完整新稿写到 sibling draft，例如 `index.next.html`，确认内容成形后再覆盖回 `index.html`，不要让入口文件出现空窗。starter 一落地后，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 `docs/basic/` 或继续模板漫游。把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须出现真实写文件动作，而不是继续只读浏览、压图或停在口头承诺；必要时 hook 会把这类非写入动作挡回去。真正完成还包括：入口文件本体已改完、主要占位已清掉、已准备好的真实图片或参考约束已落进页面，不是只补合同或只下载素材。',
    ].join(' '),
    changeId: null,
    task: null,
    coverageItem: null,
  };
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[_:/.-]+/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\u4e00-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarkdownText(value) {
  return String(value ?? '')
    .replace(/\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/[`*_>#~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueItems(items) {
  return [...new Set(items.filter(Boolean))];
}

function searchTokens(value) {
  const normalized = normalizeSearchText(value);
  if (!normalized) {
    return [];
  }
  return uniqueItems(
    normalized
      .split(' ')
      .map((item) => item.trim())
      .filter((item) => item.length >= 2),
  );
}

function scoreSearchCandidate(query, fields = []) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }
  const queryTokens = searchTokens(query);
  let bestScore = 0;
  for (const field of fields) {
    const normalizedField = normalizeSearchText(field);
    if (!normalizedField) {
      continue;
    }
    if (normalizedField === normalizedQuery) {
      bestScore = Math.max(bestScore, 220);
      continue;
    }
    if (normalizedField.includes(normalizedQuery)) {
      bestScore = Math.max(bestScore, 180);
      continue;
    }
    if (normalizedQuery.includes(normalizedField) && normalizedField.length >= 6) {
      bestScore = Math.max(bestScore, 160);
      continue;
    }
    let score = 0;
    let hits = 0;
    for (const token of queryTokens) {
      if (!normalizedField.includes(token)) {
        continue;
      }
      hits += 1;
      score += token.length >= 4 ? 24 : 14;
    }
    if (hits > 0) {
      if (hits === queryTokens.length && queryTokens.length > 1) {
        score += 24;
      }
      if (normalizedField.includes(normalizedQuery.slice(0, Math.min(normalizedQuery.length, 12)))) {
        score += 12;
      }
    }
    bestScore = Math.max(bestScore, score);
  }
  return bestScore;
}

function isShortAffirmativeMessage(message) {
  return SHORT_AFFIRMATIVE_PATTERN.test(stripMarkdownText(message));
}

function requirementGateMatchesMessage(message, gate) {
  if (!gate?.active) {
    return false;
  }
  const text = String(message ?? '').trim();
  if (!text || isShortAffirmativeMessage(text)) {
    return true;
  }
  const gateFields = [
    gate.promptPreview,
    gate.reviewActionAuthorization?.promptPreview,
  ].filter(Boolean);
  if (gateFields.length === 0) {
    return true;
  }
  const queryTokens = searchTokens(text);
  const gateTokens = uniqueItems(gateFields.flatMap((field) => searchTokens(field)));
  const sharedTokens = queryTokens.filter((token) => gateTokens.includes(token));
  if (sharedTokens.some((token) => token.length >= 6)) {
    return true;
  }
  const overlapBase = Math.min(queryTokens.length, gateTokens.length);
  if (sharedTokens.length >= 2 && overlapBase > 0 && (sharedTokens.length / overlapBase) >= 0.5) {
    return true;
  }
  return scoreSearchCandidate(text, gateFields) >= 80;
}

function assessRequirementGateRelevance({ message, gate, laneRequest, resolvedTarget }) {
  if (!gate?.active) {
    return {
      active: false,
      matchedCurrentMessage: false,
      relevance: 'inactive',
      reason: null,
    };
  }
  if (laneRequest?.requested || resolvedTarget?.matched) {
    return {
      active: true,
      matchedCurrentMessage: false,
      relevance: 'background',
      reason: '当前请求正在显式继续历史会话/任务，或已定位到更具体目标；active requirement intake 仅作为背景提醒。',
    };
  }
  const matchedCurrentMessage = requirementGateMatchesMessage(message, gate);
  return {
    active: true,
    matchedCurrentMessage,
    relevance: matchedCurrentMessage ? 'primary' : 'background',
    reason: matchedCurrentMessage
      ? '当前请求与 active requirement intake 匹配，优先继续这条需求入口。'
      : '当前请求与 active requirement intake 的摘要不匹配；旧 gate 仅作为背景提醒，不抢本轮默认路线。',
  };
}

function appendRequirementGateReminder(reason, requirementGateAssessment, requirementGate) {
  if (requirementGateAssessment?.relevance !== 'background' || !requirementGate?.active) {
    return reason;
  }
  const reminder = [
    requirementGateAssessment.reason,
    requirementGate?.promptPreview ? `历史需求摘要: ${requirementGate.promptPreview}` : null,
  ].filter(Boolean).join(' ');
  return [reason, reminder].filter(Boolean).join(' ');
}

async function readFirstHeading(filePath, fallback = null) {
  const text = await fs.readFile(filePath, 'utf8').catch(() => '');
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  return heading || fallback;
}

function workUnitBindingPath(projectRoot, workUnitId) {
  if (!workUnitId) {
    return null;
  }
  return cjoin(
    projectRoot,
    OPENPRD_WORK_UNITS_DIR,
    `${String(workUnitId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`,
  );
}

async function readWorkUnitBindingRecord(projectRoot, workUnitId) {
  const filePath = workUnitBindingPath(projectRoot, workUnitId);
  if (!filePath) {
    return null;
  }
  const binding = await readJson(filePath).catch(() => null);
  return binding ? { ...binding, path: filePath } : null;
}

function extractFirstSelectorMatch(texts, pattern) {
  for (const text of texts) {
    const match = String(text ?? '').match(pattern)?.[0] ?? null;
    if (match) {
      return match;
    }
  }
  return null;
}

async function buildRunResolutionIndex(projectRoot, changes, listOpenSpecTaskWorkspace) {
  const changeRows = Array.isArray(changes?.changes) ? changes.changes : [];
  const index = {
    changes: [],
    tasks: [],
  };
  for (const change of changeRows) {
    const title = await readFirstHeading(cjoin(change.changeDir, 'proposal.md'), change.id);
    const taskState = await listOpenSpecTaskWorkspace(projectRoot, { change: change.id }).catch(() => null);
    const pendingTaskTitles = Array.isArray(taskState?.tasks)
      ? taskState.tasks
          .filter((task) => !task.checked)
          .map((task) => String(task.title ?? '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    index.changes.push({
      changeId: change.id,
      title,
      active: Boolean(change.active),
      pendingTaskTitles,
    });
    for (const task of taskState?.tasks ?? []) {
      index.tasks.push({
        changeId: change.id,
        changeTitle: title,
        checked: Boolean(task.checked),
        task: compactTask(task),
      });
    }
  }
  return index;
}

function findLoopTaskByHandle(loopFeatureList, taskHandle) {
  if (!taskHandle || !Array.isArray(loopFeatureList?.tasks)) {
    return null;
  }
  return loopFeatureList.tasks.find((task) => task.taskHandle === taskHandle) ?? null;
}

function buildTaskTarget(match, source, extra = {}) {
  if (!match) {
    return null;
  }
  return {
    matched: true,
    source,
    sessionId: extra.sessionId ?? null,
    taskId: match.task.id ?? match.taskId ?? null,
    taskHandle: match.task.taskHandle ?? match.taskHandle ?? null,
    changeId: match.changeId ?? null,
    workUnitId: extra.workUnitId ?? null,
    title: match.task.title ?? match.title ?? null,
    promptPreview: extra.promptPreview ?? null,
    reason: extra.reason ?? null,
    artifacts: extra.artifacts ?? null,
  };
}

function resolveTaskHandleTarget(taskHandle, index, loopFeatureList, extra = {}) {
  const loopTask = findLoopTaskByHandle(loopFeatureList, taskHandle);
  if (loopTask) {
    return buildTaskTarget({
      task: {
        id: loopTask.id,
        taskHandle: loopTask.taskHandle,
        title: loopTask.title,
      },
      changeId: loopTask.changeId,
    }, extra.source ?? 'task-handle', {
      ...extra,
      reason: extra.reason ?? `任务句柄 ${taskHandle} 命中 Loop 任务索引。`,
    });
  }
  const indexedTask = index?.tasks?.find((item) => item.task.taskHandle === taskHandle) ?? null;
  if (!indexedTask) {
    return {
      matched: false,
      source: extra.source ?? 'task-handle',
      sessionId: extra.sessionId ?? null,
      taskId: null,
      taskHandle,
      changeId: null,
      workUnitId: extra.workUnitId ?? null,
      title: null,
      promptPreview: extra.promptPreview ?? null,
      reason: extra.reason ?? `未在本地任务索引中找到任务句柄 ${taskHandle}。`,
      artifacts: extra.artifacts ?? null,
    };
  }
  return buildTaskTarget(indexedTask, extra.source ?? 'task-handle', {
    ...extra,
    reason: extra.reason ?? `任务句柄 ${taskHandle} 命中 OpenPrd 任务索引。`,
  });
}

function resolveSemanticTarget(query, index, extra = {}) {
  if (!String(query ?? '').trim()) {
    return null;
  }
  const candidates = [];
  for (const taskEntry of index?.tasks ?? []) {
    const score = scoreSearchCandidate(query, [
      taskEntry.task.taskHandle,
      taskEntry.task.id,
      taskEntry.task.title,
      taskEntry.changeId,
      taskEntry.changeTitle,
    ]);
    if (score > 0) {
      candidates.push({
        kind: 'task',
        score,
        source: extra.source ?? 'semantic',
        changeId: taskEntry.changeId,
        taskId: taskEntry.task.id,
        taskHandle: taskEntry.task.taskHandle,
        title: taskEntry.task.title,
      });
    }
  }
  for (const changeEntry of index?.changes ?? []) {
    const score = scoreSearchCandidate(query, [
      changeEntry.changeId,
      changeEntry.title,
      ...(changeEntry.pendingTaskTitles ?? []),
    ]);
    if (score > 0) {
      candidates.push({
        kind: 'change',
        score,
        source: extra.source ?? 'semantic',
        changeId: changeEntry.changeId,
        taskId: null,
        taskHandle: null,
        title: changeEntry.title,
      });
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => right.score - left.score);
  const best = candidates[0];
  const second = candidates[1] ?? null;
  const ambiguous = second
    && second.changeId !== best.changeId
    && best.score < (second.score + 18);
  if (best.score < 70 || ambiguous) {
    return null;
  }
  return {
    matched: true,
    source: best.source,
    sessionId: extra.sessionId ?? null,
    changeId: best.changeId,
    taskId: best.taskId,
    taskHandle: best.taskHandle,
    workUnitId: extra.workUnitId ?? null,
    title: best.title,
    promptPreview: extra.promptPreview ?? null,
    reason: extra.reason ?? `用户描述命中已有${best.kind === 'task' ? '任务' : '变更'} ${best.taskId ?? best.changeId}。`,
    score: best.score,
    artifacts: extra.artifacts ?? null,
  };
}

async function resolveWorkUnitTarget(projectRoot, workUnitId, index, extra = {}) {
  const binding = await readWorkUnitBindingRecord(projectRoot, workUnitId);
  if (!binding) {
    return {
      matched: false,
      source: extra.source ?? 'work-unit',
      sessionId: extra.sessionId ?? null,
      taskId: null,
      taskHandle: null,
      changeId: null,
      workUnitId,
      title: null,
      promptPreview: extra.promptPreview ?? null,
      reason: extra.reason ?? `未在本地 work unit 绑定中找到 ${workUnitId}。`,
      artifacts: extra.artifacts ?? null,
      binding: null,
    };
  }
  const semanticMatch = resolveSemanticTarget(
    [
      binding.title,
      binding.latestVersionId,
      extra.promptPreview,
      extra.query,
    ].filter(Boolean).join(' '),
    index,
    {
      source: extra.source ?? 'work-unit',
      sessionId: extra.sessionId ?? null,
      workUnitId,
      promptPreview: extra.promptPreview ?? null,
      artifacts: extra.artifacts ?? null,
      reason: `工作单元 ${workUnitId} 命中 ${binding.title ?? binding.latestVersionId ?? '本地绑定'}。`,
    },
  );
  if (semanticMatch) {
    return {
      ...semanticMatch,
      workUnitId,
      binding,
    };
  }
  return {
    matched: true,
    source: extra.source ?? 'work-unit',
    sessionId: extra.sessionId ?? null,
    taskId: null,
    taskHandle: null,
    changeId: null,
    workUnitId,
    title: binding.title ?? binding.latestVersionId ?? null,
    promptPreview: extra.promptPreview ?? null,
    reason: extra.reason ?? `定位到工作单元 ${workUnitId}，但还没有足够证据绑定到具体 change/task。`,
    artifacts: extra.artifacts ?? null,
    binding,
  };
}

async function readSessionRequirementGate(projectRoot, sessionId) {
  if (!sessionId) {
    return null;
  }
  return readJson(cjoin(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATES_DIR, `${sessionId}.json`)).catch(() => null);
}

async function readSessionEvents(projectRoot, sessionId) {
  if (!sessionId) {
    return [];
  }
  const events = await readJsonl(cjoin(projectRoot, OPENPRD_HARNESS_EVENTS)).catch(() => []);
  return events.filter((event) => event?.sessionId === sessionId);
}

async function readLoopFeatureList(projectRoot) {
  return readJson(harnessFile(projectRoot, OPENPRD_HARNESS_LOOP_FEATURE_LIST)).catch(() => null);
}

async function findSessionWorkspaceCandidates(projectRoot, sessionId, options = {}) {
  const registry = await readWorkspaceRegistry(options).catch(() => null);
  if (!registry) {
    return [];
  }
  const currentRoot = path.resolve(projectRoot);
  const candidates = [];
  for (const entry of registry.entries) {
    if (rootsEqual(entry.workspaceRoot, currentRoot)) {
      continue;
    }
    const bindingPath = cjoin(entry.workspaceRoot, OPENPRD_HARNESS_SESSION_BINDINGS_DIR, `${sessionId}.json`);
    const gatePath = cjoin(entry.workspaceRoot, OPENPRD_HARNESS_REQUIREMENT_GATES_DIR, `${sessionId}.json`);
    if (await exists(bindingPath)) {
      candidates.push({ workspaceRoot: entry.workspaceRoot, source: 'session-binding' });
      continue;
    }
    if (await exists(gatePath)) {
      candidates.push({ workspaceRoot: entry.workspaceRoot, source: 'requirement-gate' });
    }
  }
  return candidates;
}

async function resolveSessionTargetInWorkspace(projectRoot, sessionId, index, loopFeatureList, options = {}) {
  const binding = await readSessionBinding(projectRoot, sessionId);
  const gate = await readSessionRequirementGate(projectRoot, sessionId);
  const events = await readSessionEvents(projectRoot, sessionId);
  const directBindingArtifacts = binding ? { sessionBinding: true } : {};
  const workspaceRoot = path.resolve(projectRoot);
  if (binding?.taskHandle) {
    return {
      ...(resolveTaskHandleTarget(binding.taskHandle, index, loopFeatureList, {
      source: 'session-binding',
      sessionId,
      workUnitId: binding.workUnitId ?? null,
      promptPreview: binding.promptPreview ?? null,
      artifacts: {
        ...directBindingArtifacts,
        requirementGate: Boolean(gate),
        events: events.length,
      },
      reason: `会话 ${sessionId} 的 lane 绑定命中任务句柄 ${binding.taskHandle}。`,
      }) ?? {}),
      workspaceRoot,
      sameWorkspace: options.sameWorkspace ?? true,
    };
  }
  if (binding?.changeId) {
    return {
      matched: true,
      source: 'session-binding',
      sessionId,
      taskId: null,
      taskHandle: binding.taskHandle ?? null,
      changeId: binding.changeId,
      workUnitId: binding.workUnitId ?? null,
      title: binding.title ?? null,
      promptPreview: binding.promptPreview ?? null,
      reason: `会话 ${sessionId} 的 lane 绑定指向变更 ${binding.changeId}。`,
      artifacts: {
        ...directBindingArtifacts,
        requirementGate: Boolean(gate),
        events: events.length,
      },
      workspaceRoot,
      sameWorkspace: options.sameWorkspace ?? true,
    };
  }
  if (binding?.workUnitId) {
    const boundWorkUnitTarget = await resolveWorkUnitTarget(projectRoot, binding.workUnitId, index, {
      source: 'session-binding',
      sessionId,
      promptPreview: binding.promptPreview ?? null,
      artifacts: {
        ...directBindingArtifacts,
        requirementGate: Boolean(gate),
        events: events.length,
      },
      query: [binding.title, binding.promptPreview, gate?.promptPreview].filter(Boolean).join(' '),
      reason: `会话 ${sessionId} 的 lane 绑定命中工作单元 ${binding.workUnitId}。`,
    });
    if (boundWorkUnitTarget?.matched) {
      return {
        ...boundWorkUnitTarget,
        changeId: boundWorkUnitTarget.changeId ?? binding.changeId ?? null,
        title: boundWorkUnitTarget.title ?? binding.title ?? null,
        workspaceRoot,
        sameWorkspace: options.sameWorkspace ?? true,
      };
    }
  }
  const promptPreview = gate?.promptPreview
    ?? binding?.promptPreview
    ?? gate?.reviewActionAuthorization?.promptPreview
    ?? events.find((event) => typeof event?.preview === 'string')?.preview
    ?? null;
  const texts = [
    binding?.title,
    binding?.promptPreview,
    gate?.promptPreview,
    gate?.confirmationPreview,
    gate?.reviewActionAuthorization?.promptPreview,
    ...events.map((event) => event?.preview ?? null),
  ].filter(Boolean);
  const artifacts = {
    sessionBinding: Boolean(binding),
    requirementGate: Boolean(gate),
    events: events.length,
  };
  const taskHandle = extractFirstSelectorMatch(texts, CONTINUATION_TASK_HANDLE_PATTERN);
  if (taskHandle) {
    return {
      ...(resolveTaskHandleTarget(taskHandle, index, loopFeatureList, {
      source: 'session',
      sessionId,
      promptPreview,
      artifacts,
      reason: `会话 ${sessionId} 的本地记录命中任务句柄 ${taskHandle}。`,
      }) ?? {}),
      workspaceRoot,
      sameWorkspace: options.sameWorkspace ?? true,
    };
  }
  const workUnitId = gate?.reviewActionAuthorization?.workUnitId
    ?? extractFirstSelectorMatch(texts, CONTINUATION_WORK_UNIT_PATTERN);
  if (workUnitId) {
    const resolvedWorkUnitTarget = await resolveWorkUnitTarget(projectRoot, workUnitId, index, {
      source: 'session',
      sessionId,
      promptPreview,
      artifacts,
      query: texts.join(' '),
      reason: `会话 ${sessionId} 的本地记录命中工作单元 ${workUnitId}。`,
    });
    return {
      ...resolvedWorkUnitTarget,
      workspaceRoot,
      sameWorkspace: options.sameWorkspace ?? true,
    };
  }
  const semanticMatch = resolveSemanticTarget(texts.join(' '), index, {
    source: 'session',
    sessionId,
    promptPreview,
    artifacts,
    reason: `会话 ${sessionId} 的本地 requirement / hook 历史命中已有任务对象。`,
  });
  if (semanticMatch) {
    return {
      ...semanticMatch,
      workspaceRoot,
      sameWorkspace: options.sameWorkspace ?? true,
    };
  }
  return {
    matched: false,
    source: 'session',
    sessionId,
    taskId: null,
    taskHandle: null,
    changeId: null,
    workUnitId: null,
    title: null,
    promptPreview,
    reason: gate || events.length > 0
      ? `本地找到了会话 ${sessionId} 的 requirement gate / hook 事件，但还没有足够证据绑定到具体 change/task/work unit。`
      : `本地没有会话 ${sessionId} 的 requirement gate、hook 事件或 work unit 绑定。`,
    artifacts,
    workspaceRoot,
    sameWorkspace: options.sameWorkspace ?? true,
  };
}

async function resolveSessionTarget(projectRoot, sessionId, index, loopFeatureList, options = {}) {
  const registryEntry = await readSessionRegistryEntry(sessionId, options).catch(() => null);
  if (registryEntry?.workspaceRoot && !rootsEqual(registryEntry.workspaceRoot, projectRoot)) {
    const targetArtifacts = await options.resolveWorkspaceArtifacts?.(registryEntry.workspaceRoot) ?? {
      index,
      loopFeatureList: await readLoopFeatureList(registryEntry.workspaceRoot),
    };
    const resolved = await resolveSessionTargetInWorkspace(
      registryEntry.workspaceRoot,
      sessionId,
      targetArtifacts.index ?? index,
      targetArtifacts.loopFeatureList ?? loopFeatureList,
      { sameWorkspace: false },
    );
    return {
      ...resolved,
      workspaceRoot: registryEntry.workspaceRoot,
      registryEntry,
      reason: [
        `全局 session registry 已把会话 ${sessionId} 归属到 ${registryEntry.workspaceRoot}。`,
        resolved.reason,
      ].filter(Boolean).join(' '),
    };
  }

  const localResolution = await resolveSessionTargetInWorkspace(projectRoot, sessionId, index, loopFeatureList, {
    sameWorkspace: true,
  });
  if (localResolution.matched || registryEntry) {
    return {
      ...localResolution,
      registryEntry,
    };
  }

  const candidates = await findSessionWorkspaceCandidates(projectRoot, sessionId, options);
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const targetArtifacts = await options.resolveWorkspaceArtifacts?.(candidate.workspaceRoot) ?? {
      index,
      loopFeatureList: await readLoopFeatureList(candidate.workspaceRoot),
    };
    const resolved = await resolveSessionTargetInWorkspace(
      candidate.workspaceRoot,
      sessionId,
      targetArtifacts.index ?? index,
      targetArtifacts.loopFeatureList ?? loopFeatureList,
      { sameWorkspace: false },
    );
    return {
      ...resolved,
      workspaceRoot: candidate.workspaceRoot,
      candidates,
      reason: [
        `全局 session registry 还没有会话 ${sessionId}，已根据 repo-local 线索定位到候选工作区 ${candidate.workspaceRoot}。`,
        resolved.reason,
      ].filter(Boolean).join(' '),
    };
  }
  if (candidates.length > 1) {
    return {
      ...localResolution,
      source: 'session-candidates',
      workspaceRoot: null,
      candidates,
      reason: `全局 session registry 还没有会话 ${sessionId}，并且在多个工作区都找到了候选线索：${candidates.map((item) => item.workspaceRoot).join('、')}。`,
    };
  }
  return localResolution;
}

async function resolveRunTarget({
  projectRoot,
  message,
  request,
  index,
  loopFeatureList,
  resolveWorkspaceArtifacts,
}) {
  const text = String(message ?? '').trim();
  if (!text) {
    return null;
  }
  if (request.sessionId) {
    return resolveSessionTarget(projectRoot, request.sessionId, index, loopFeatureList, {
      resolveWorkspaceArtifacts,
    });
  }
  if (request.taskHandle) {
    return resolveTaskHandleTarget(request.taskHandle, index, loopFeatureList);
  }
  if (request.workUnitId) {
    return resolveWorkUnitTarget(projectRoot, request.workUnitId, index, {
      query: text,
    });
  }
  if (request.explicitCurrent) {
    return null;
  }
  return resolveSemanticTarget(text, index);
}

function selectFocusedChangeId(projectRoot, request, resolvedTarget, activeChange) {
  if (resolvedTarget?.changeId && (!resolvedTarget.workspaceRoot || rootsEqual(resolvedTarget.workspaceRoot, projectRoot))) {
    return resolvedTarget.changeId;
  }
  if (request.sessionId || request.taskHandle || request.workUnitId) {
    return null;
  }
  return activeChange ?? null;
}

function describeRunLane(lane) {
  if (lane?.kind === 'targeted') {
    const target = lane.target?.taskHandle
      ?? lane.target?.taskId
      ?? lane.target?.changeId
      ?? lane.target?.workUnitId
      ?? '已有对象';
    return `按用户描述定位已有对象 (${target})`;
  }
  if (lane?.kind !== 'continuation') {
    return '默认执行流';
  }
  const selectorLabel = lane.selectorType === 'task-handle'
    ? '任务句柄'
    : lane.selectorType === 'work-unit'
      ? '工作单元'
      : lane.selectorType === 'session'
        ? '历史会话'
        : '继续提示';
  const target = lane.target?.sessionId
    ?? lane.target?.taskHandle
    ?? lane.target?.taskId
    ?? lane.target?.changeId
    ?? lane.target?.workUnitId
    ?? lane.selector
    ?? '当前活动上下文';
  return `继续已有任务 (${selectorLabel}: ${target})`;
}

function buildRunLane({ message, recommendation, activeChange, latestPrd, loopFeatureList, resolvedTarget, projectRoot }) {
  const request = analyzeRunMessage(message);
  if (!request.requested) {
    if (resolvedTarget?.matched) {
      const target = {
        sessionId: resolvedTarget.sessionId ?? null,
        taskHandle: resolvedTarget.taskHandle ?? recommendation?.task?.taskHandle ?? null,
        taskId: resolvedTarget.taskId ?? recommendation?.task?.id ?? null,
        changeId: resolvedTarget.changeId ?? recommendation?.changeId ?? null,
        workUnitId: resolvedTarget.workUnitId ?? latestPrd?.workUnitId ?? null,
        workspaceRoot: resolvedTarget.workspaceRoot ?? projectRoot,
      };
      const lane = {
        kind: 'targeted',
        requested: false,
        selectorType: resolvedTarget.source ?? 'semantic',
        selector: null,
        target,
        matched: Boolean(target.sessionId || target.taskHandle || target.taskId || target.changeId || target.workUnitId),
        resolution: resolvedTarget,
        activeChange,
        currentProjectRoot: projectRoot,
      };
      return {
        ...lane,
        summary: describeRunLane(lane),
      };
    }
    return {
      kind: 'default',
      requested: false,
      summary: '默认执行流',
    };
  }

  const matchedLoopTask = request.taskHandle ? findLoopTaskByHandle(loopFeatureList, request.taskHandle) : null;
  let target;
  let matched;
  if (request.selectorType === 'session') {
    target = {
      sessionId: request.sessionId,
      taskHandle: resolvedTarget?.taskHandle ?? null,
      taskId: resolvedTarget?.taskId ?? null,
      changeId: resolvedTarget?.changeId ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? null,
      workspaceRoot: resolvedTarget?.workspaceRoot ?? projectRoot,
    };
    matched = Boolean(resolvedTarget?.matched);
  } else if (request.selectorType === 'task-handle') {
    target = {
      sessionId: null,
      taskHandle: resolvedTarget?.taskHandle ?? matchedLoopTask?.taskHandle ?? request.taskHandle ?? null,
      taskId: resolvedTarget?.taskId ?? matchedLoopTask?.id ?? null,
      changeId: resolvedTarget?.changeId ?? matchedLoopTask?.changeId ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? null,
      workspaceRoot: resolvedTarget?.workspaceRoot ?? projectRoot,
    };
    matched = Boolean(resolvedTarget?.matched || matchedLoopTask);
  } else if (request.selectorType === 'work-unit') {
    target = {
      sessionId: null,
      taskHandle: resolvedTarget?.taskHandle ?? null,
      taskId: resolvedTarget?.taskId ?? null,
      changeId: resolvedTarget?.changeId ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? request.workUnitId ?? null,
      workspaceRoot: resolvedTarget?.workspaceRoot ?? projectRoot,
    };
    matched = Boolean(resolvedTarget?.matched);
  } else {
    target = {
      sessionId: null,
      taskHandle: recommendation?.task?.taskHandle ?? null,
      taskId: recommendation?.task?.id ?? null,
      changeId: recommendation?.changeId ?? activeChange ?? null,
      workUnitId: latestPrd?.workUnitId ?? null,
      workspaceRoot: projectRoot,
    };
    matched = Boolean(target.taskHandle || target.taskId || target.changeId || target.workUnitId);
  }
  const lane = {
    ...request,
    target,
    matched,
    resolution: resolvedTarget ?? null,
    activeChange,
    currentProjectRoot: projectRoot,
  };
  return {
    ...lane,
    summary: describeRunLane(lane),
  };
}

function buildSessionContinuationRecommendation(recommendation, lane) {
  const sessionId = lane?.target?.sessionId ?? lane?.sessionId ?? lane?.selector ?? null;
  const targetWorkspaceRoot = lane?.target?.workspaceRoot ?? lane?.resolution?.workspaceRoot ?? lane?.currentProjectRoot ?? null;
  const crossWorkspace = Boolean(targetWorkspaceRoot && lane?.currentProjectRoot && !rootsEqual(targetWorkspaceRoot, lane.currentProjectRoot));
  const explicitIsolationRequest = hasExplicitIsolationRequest(lane?.text);
  const recoveredTarget = [
    lane?.target?.changeId ? `变更 ${lane.target.changeId}` : null,
    lane?.target?.taskHandle ? `任务句柄 ${lane.target.taskHandle}` : null,
    lane?.target?.workUnitId ? `工作单元 ${lane.target.workUnitId}` : null,
  ].filter(Boolean).join('、');
  return {
    type: 'session-continuation',
    title: sessionId ? `恢复历史会话 ${sessionId}` : '恢复历史会话',
    command: sessionId
      ? (
          crossWorkspace
            ? `openprd run ${shellQuote(targetWorkspaceRoot)} --context --message ${shellQuote(sessionId)}`
            : `openprd run . --context --message ${shellQuote(sessionId)}`
        )
      : 'openprd run . --context',
    verifyCommand: 'openprd run . --verify',
    reason: [
      '当前请求给出的是工具无关的会话 ID；先按全局 session registry 和 repo-local 线索恢复该会话历史，再决定后续任务对象。',
      crossWorkspace ? `该会话归属到工作区 ${targetWorkspaceRoot}，不能继续复用当前工作区的 active 状态。` : null,
      recoveredTarget ? `本地已恢复到 ${recoveredTarget}。` : (lane?.resolution?.reason ?? '本地还没有足够证据把这个会话绑定到具体 change/task/work unit。'),
      lane?.resolution?.promptPreview ? `会话摘要: ${lane.resolution.promptPreview}` : null,
      '不能用相似历史、当前 active change 或当前 requirement gate 替代这个会话 ID。',
      lane?.activeChange && lane.activeChange !== lane?.target?.changeId
        ? `当前工作区 active change ${lane.activeChange} 只作为背景提醒。`
        : null,
    ].filter(Boolean).join(' '),
    changeId: lane?.target?.changeId ?? null,
    task: lane?.target?.taskId || lane?.target?.taskHandle
      ? {
          id: lane.target.taskId ?? null,
          taskHandle: lane.target.taskHandle ?? null,
          title: lane?.resolution?.title ?? null,
        }
      : null,
    coverageItem: null,
    continuationTarget: lane.target ?? null,
    isolation: {
      required: crossWorkspace,
      worktreeRecommended: explicitIsolationRequest,
      reason: explicitIsolationRequest
        ? (
            crossWorkspace
              ? '先切回正确工作区，再按你明确要求的单独环境方式继续推进。'
              : '你已经明确要求按单独环境处理；恢复到对应上下文后，我会按隔离方式继续推进。'
          )
        : (
            crossWorkspace
              ? '先切回正确工作区继续推进，不默认追加单独环境。'
              : '历史会话恢复默认沿用当前上下文继续推进，不额外建议单独环境。'
          ),
    },
    previousRecommendation: recommendation
      ? {
          type: recommendation.type ?? null,
          title: recommendation.title ?? null,
          changeId: recommendation.changeId ?? null,
          task: recommendation.task ?? null,
        }
      : null,
  };
}

function buildUnresolvedContinuationRecommendation({ message, request, resolution, activeChange }) {
  const selectorLabel = request.selectorType === 'task-handle'
    ? '任务句柄'
    : request.selectorType === 'work-unit'
      ? '工作单元'
      : '继续目标';
  const selectorValue = request.selector ?? String(message ?? '').trim() ?? '';
  return {
    type: 'continuation-unresolved',
    title: `未能解析${selectorLabel} ${selectorValue}`,
    command: String(message ?? '').trim()
      ? `openprd run . --context --message ${shellQuote(String(message).trim())}`
      : 'openprd run . --context',
    verifyCommand: 'openprd run . --verify',
    reason: [
      `当前请求显式给出了${selectorLabel}，但本地 OpenPrd 索引还不能把它精确绑定到 change/task/work unit。`,
      resolution?.reason ?? null,
      activeChange ? `当前工作区 active change ${activeChange} 只作为背景提醒，不会自动顶替这个显式目标。` : null,
      Array.isArray(resolution?.candidates) && resolution.candidates.length > 0
        ? `候选工作区: ${resolution.candidates.map((item) => item.workspaceRoot).join('、')}。`
        : null,
    ].filter(Boolean).join(' '),
    changeId: null,
    task: null,
    coverageItem: null,
    continuationTarget: {
      sessionId: request.sessionId ?? null,
      taskHandle: request.taskHandle ?? null,
      taskId: null,
      changeId: null,
      workUnitId: request.workUnitId ?? null,
    },
  };
}

function applyLaneToRecommendation(recommendation, lane) {
  if (!recommendation || !['continuation', 'targeted'].includes(lane?.kind)) {
    return recommendation;
  }
  if (lane.selectorType === 'session') {
    return buildSessionContinuationRecommendation(recommendation, lane);
  }
  if (
    lane.kind === 'continuation'
    && ['task-handle', 'work-unit'].includes(lane.selectorType)
    && !lane.matched
  ) {
    return buildUnresolvedContinuationRecommendation({
      message: lane.text,
      request: lane,
      resolution: lane.resolution,
      activeChange: recommendation?.changeId ?? null,
    });
  }
  const targetParts = [
    lane.target?.sessionId ? `会话 ${lane.target.sessionId}` : null,
    lane.target?.taskHandle ? `任务句柄 ${lane.target.taskHandle}` : null,
    lane.target?.changeId ? `变更 ${lane.target.changeId}` : null,
    lane.target?.workUnitId ? `工作单元 ${lane.target.workUnitId}` : null,
  ].filter(Boolean);
  const prefix = lane.kind === 'targeted'
    ? `当前用户消息已经命中${targetParts.join('、') || '已有对象'}；优先围绕这个目标给出结论，再把工作区历史 debt 单列。`
    : lane.matched
      ? `当前请求是在继续已有任务；优先围绕${targetParts.join('、') || '当前活动上下文'}给出任务级结论，再把工作区历史 debt 单列。`
      : '当前请求是在继续已有任务；先恢复最接近的任务上下文，再把工作区历史 debt 单列。';
  return {
    ...recommendation,
    reason: `${prefix} ${recommendation.reason}`.trim(),
    continuationTarget: lane.target ?? null,
  };
}

function shouldSurfaceDiscoveryInRunContext(discovery) {
  const mode = String(discovery?.control?.mode ?? '').trim().toLowerCase();
  if (!mode) {
    return Boolean(discovery);
  }
  return mode !== 'reference';
}

function buildPrdPromotionRecommendation({ changes, next }) {
  if (changes?.activeChange) {
    return null;
  }

  const snapshot = next?.analysisSnapshot ?? null;
  if (!snapshot?.digest) {
    return null;
  }

  const reviewState = next?.prdReviewState ?? null;
  const suggestedChangeId = slugify(snapshot.title ?? snapshot.versionId);
  if (reviewState?.status !== 'confirmed') {
    return null;
  }

  return {
    type: 'prd-change',
    title: '整理本次调整，并拆出后续任务',
    command: 'openprd review . --open',
    executionCommand: `openprd change . --generate --change ${shellQuote(suggestedChangeId)}`,
    verifyCommand: `openprd change . --validate --change ${shellQuote(suggestedChangeId)}`,
    reason: '这版需求已经确认，下一步先整理本次调整范围，再拆出可直接执行的后续任务。',
    changeId: suggestedChangeId,
    task: null,
    coverageItem: null,
    prd: {
      versionId: snapshot.versionId,
      digest: snapshot.digest,
      workUnitId: snapshot.workUnitId ?? null,
      reviewStatus: reviewState.status,
      reviewCommand: reviewMarkCommand(snapshot),
    },
    intentGate: executionGate(),
  };
}

function buildRequirementIntakeRecommendation({ gate, next, activeChange }) {
  const nextAction = next?.recommendation?.nextAction ?? 'clarify-user';
  const brainstormSuggestion = next?.brainstormSuggestion?.recommended ? next.brainstormSuggestion : null;
  const shouldRouteToBrainstorm = Boolean(
    brainstormSuggestion
    && brainstormSuggestion.explicitTrigger === true
    && ['clarify-user', 'classify', 'interview'].includes(nextAction)
  );
  const titleByAction = {
    brainstorm: '先进入脑暴模式收敛方向',
    'clarify-user': '继续本轮需求入口澄清',
    classify: '补齐本轮需求的产品类型',
    interview: '补齐本轮需求的关键事实',
    synthesize: '生成本轮需求的确认稿',
    diagram: '生成本轮需求的可视化评审',
    review: '查看并确认本轮需求稿',
    freeze: '进入本轮需求定稿前检查',
    handoff: '导出本轮需求交接包',
  };
  return {
    type: 'requirement-intake',
    nextAction: shouldRouteToBrainstorm ? 'brainstorm' : nextAction,
    title: titleByAction[shouldRouteToBrainstorm ? 'brainstorm' : nextAction] ?? '继续本轮需求入口',
    command: shouldRouteToBrainstorm
      ? (brainstormSuggestion?.suggestedCommand ?? 'openprd brainstorm . --open')
      : (next?.recommendation?.suggestedCommand ?? 'openprd clarify .'),
    verifyCommand: 'openprd run . --verify',
    reason: [
      shouldRouteToBrainstorm
        ? '当前这条需求更适合先把方向、替代方案、目标结果和验证方式梳理清楚，再进入正式 PRD。'
        : '当前有一条还在推进中的新需求；先把需求澄清、确认，再整理本次调整和后续任务。',
      activeChange ? `之前还有一项历史事项 ${activeChange}，这里只把它当背景提醒，不抢这次主线。` : null,
      shouldRouteToBrainstorm
        ? (brainstormSuggestion?.reason ?? next?.recommendation?.reason ?? null)
        : (next?.recommendation?.reason ?? null),
    ].filter(Boolean).join(' '),
    changeId: null,
    task: null,
    coverageItem: null,
    requirementGate: {
      status: gate?.status ?? null,
      promptPreview: gate?.promptPreview ?? null,
      intakeMode: gate?.intakeMode ?? null,
      sessionId: gate?.sessionId ?? null,
    },
  };
}

function hasExplicitBrainstormRequest(message) {
  return EXPLICIT_BRAINSTORM_REQUEST.test(String(message ?? ''));
}

function buildBrainstormRunRecommendation({ next, message, activeChange, focusedChangeId }) {
  const brainstormSuggestion = next?.brainstormSuggestion?.recommended ? next.brainstormSuggestion : null;
  const nextAction = next?.recommendation?.nextAction ?? 'clarify-user';
  const explicitBrainstorm = hasExplicitBrainstormRequest(message) || brainstormSuggestion?.explicitTrigger === true;
  if (
    !explicitBrainstorm
    || !['clarify-user', 'classify', 'interview'].includes(nextAction)
  ) {
    return null;
  }
  return {
    type: 'workflow',
    nextAction: 'brainstorm',
    title: '先进入脑暴模式收敛方向',
    command: brainstormSuggestion.suggestedCommand ?? 'openprd brainstorm . --open',
    verifyCommand: 'openprd validate .',
    reason: [
      '当前这条需求更适合先把方向、替代方案、目标结果和验证方式梳理清楚，再进入正式 PRD。',
      activeChange ? `之前还有一项历史事项 ${activeChange}，这里只把它当背景提醒，不抢这次主线。` : null,
      brainstormSuggestion?.reason
        ?? (explicitBrainstorm ? '用户当前更像是在请求先梳理业务方向。' : null)
        ?? next?.recommendation?.reason
        ?? null,
    ].filter(Boolean).join(' '),
    changeId: focusedChangeId ?? activeChange,
    task: null,
    coverageItem: null,
  };
}

function buildStoredVerificationRecommendation(runState, options = {}) {
  const lastVerification = runState?.lastVerification;
  if (!lastVerification || lastVerification.taskReady !== true) {
    return null;
  }
  const workspaceReady = lastVerification.workspaceReady === true;
  const workspaceAttention = lastVerification.workspaceAttention ?? null;
  const changeId = lastVerification.changeId ?? options.focusedChangeId ?? options.activeChange ?? null;
  return {
    type: workspaceReady ? 'verification-ready' : 'verification-workspace-attention',
    title: workspaceReady ? '当前项目已完成并通过验证' : '当前任务已完成，工作区还有待处理项',
    command: 'openprd run . --verify',
    verifyCommand: 'openprd run . --verify',
    reason: workspaceReady
      ? '最近一次 run verify 已经闭环，当前没有待执行任务或待澄清入口；除非有新需求进入，否则优先复用已沉淀结果。'
      : (workspaceAttention?.detail ?? '最近一次 run verify 显示任务级验证已通过，但工作区级别还有待补证据或待收口项。'),
    changeId,
    task: null,
    coverageItem: null,
    verification: lastVerification,
  };
}

function buildVerificationRecommendation({ changeId, readiness, workspaceAttention, knowledgeReview, qualityCheck }) {
  if (readiness.taskReady !== true) {
    return {
      type: 'verification-fix',
      title: '先修复当前验证失败项',
      command: 'openprd run . --verify',
      verifyCommand: 'openprd run . --verify',
      reason: '最近一次 run verify 没有通过当前任务级验证，需要先修复标准、变更或任务级检查失败项。',
      changeId,
      task: null,
      coverageItem: null,
      verification: {
        ...readiness,
        workspaceAttention,
        knowledgeCandidateId: knowledgeReview?.candidateId ?? null,
        qualityReportPath: qualityCheck?.reportPath ?? null,
      },
    };
  }
  if (readiness.workspaceReady === true) {
    return {
      type: 'verification-ready',
      title: '当前项目已完成并通过验证',
      command: 'openprd run . --verify',
      verifyCommand: 'openprd run . --verify',
      reason: '最近一次 run verify、quality、standards 和变更验证都已闭环；当前没有新的待执行动作时，不应该再回到 clarify-user。',
      changeId,
      task: null,
      coverageItem: null,
      verification: {
        ...readiness,
        workspaceAttention,
        knowledgeCandidateId: knowledgeReview?.candidateId ?? null,
        qualityReportPath: qualityCheck?.reportPath ?? null,
      },
    };
  }
  return {
    type: 'verification-workspace-attention',
    title: '当前任务已完成，工作区还有待处理项',
    command: 'openprd run . --verify',
    verifyCommand: 'openprd run . --verify',
    reason: workspaceAttention?.detail ?? '最近一次 run verify 显示当前任务已通过，但工作区级别还有待补证据或待收口项。',
    changeId,
    task: null,
    coverageItem: null,
    verification: {
      ...readiness,
      workspaceAttention,
      knowledgeCandidateId: knowledgeReview?.candidateId ?? null,
      qualityReportPath: qualityCheck?.reportPath ?? null,
    },
  };
}

function buildRunRecommendation({
  projectRoot,
  message,
  changes,
  activeChange,
  focusedChangeId,
  taskState,
  discovery,
  next,
  loopFeatureList,
  requirementGate,
  requirementGateAssessment,
  laneRequest,
  resolvedTarget,
  runState,
}) {
  if (
    ['task-handle', 'work-unit'].includes(laneRequest?.selectorType)
    && !resolvedTarget?.matched
  ) {
    return buildUnresolvedContinuationRecommendation({
      message,
      request: laneRequest,
      resolution: resolvedTarget,
      activeChange,
    });
  }
  if (requirementGateAssessment?.relevance === 'primary') {
    return buildRequirementIntakeRecommendation({ gate: requirementGate, next, activeChange });
  }
  const brainstormRecommendation = (
    !laneRequest?.requested
    && !resolvedTarget?.matched
  )
    ? buildBrainstormRunRecommendation({ next, message, activeChange, focusedChangeId })
    : null;
  if (brainstormRecommendation) {
    return brainstormRecommendation;
  }
  if (taskState?.nextTask) {
    const task = compactTask(taskState.nextTask);
    const totalTasks = Number(taskState.summary?.total ?? taskState.tasks?.length ?? 0);
    const pendingTasks = Number(taskState.summary?.pending ?? 0);
    const implementationTasks = Number(taskState.summary?.implementation?.total ?? 0);
    const pendingImplementationTasks = Number(taskState.summary?.implementation?.pending ?? 0);
    const explicitIsolationRequest = hasExplicitIsolationRequest(message);
    const laneTargetsHistoricalContext = Boolean(
      resolvedTarget?.workspaceRoot && !rootsEqual(resolvedTarget.workspaceRoot, projectRoot)
        || ['session', 'task-handle', 'work-unit'].includes(laneRequest?.selectorType ?? '')
    );
    const executionMode = (
      implementationTasks >= OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD
      || pendingImplementationTasks >= OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD
    )
      ? 'parallel-workers-isolated'
      : (
          implementationTasks >= OPENPRD_PARALLEL_WORKER_IMPLEMENTATION_TASK_THRESHOLD
          || pendingImplementationTasks >= OPENPRD_PARALLEL_WORKER_IMPLEMENTATION_TASK_THRESHOLD
        )
          ? 'parallel-workers'
          : 'serial';
    const parallelPlan = buildParallelPlan({
      executionMode,
      taskState,
      focusTask: task,
      worktreeRecommended: explicitIsolationRequest || executionMode === 'parallel-workers-isolated',
    });
    if (
      implementationTasks >= OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD
      || pendingImplementationTasks >= OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD
    ) {
      const loopReady = loopFeatureList?.changeId === taskState.changeId && Array.isArray(loopFeatureList.tasks);
      return {
        type: 'loop-task',
        title: `继续推进：${task.title}`,
        command: `openprd tasks . --change ${shellQuote(taskState.changeId)}`,
        preparationCommand: loopReady
          ? `openprd loop . --next --item ${shellQuote(task.id)}`
          : `openprd loop . --plan --change ${shellQuote(taskState.changeId)}`,
        executionCommand: loopReady
          ? `openprd loop . --run --agent codex --item ${shellQuote(task.id)}`
          : `openprd loop . --plan --change ${shellQuote(taskState.changeId)} && openprd loop . --run --agent codex --item ${shellQuote(task.id)}`,
        commitCommand: `openprd loop . --finish --item ${shellQuote(task.id)} --commit`,
        verifyCommand: `openprd loop . --verify --item ${shellQuote(task.id)}`,
        reason: explicitIsolationRequest
          ? '你已经明确要求按单独环境继续；我会先回到对应上下文，再按长程 loop 方式推进。'
          : laneTargetsHistoricalContext
            ? '这件事来自指定历史记录；先回到对应上下文，再按长程 loop 方式拆成小任务推进。'
            : '待落地内容比较多，适合拆成一个个独立小任务推进，再统一收口检查。',
        changeId: taskState.changeId,
        task,
        coverageItem: null,
        intentGate: executionGate(),
        executionMode,
        parallelPlan,
        loop: {
          required: true,
          threshold: OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD,
          planned: loopReady,
          totalTasks,
          pendingTasks,
          implementationTasks,
          pendingImplementationTasks,
          worktreeRecommended: true,
        },
      };
    }
    const lightweightReason = explicitIsolationRequest
      ? '你已经明确要求按单独环境继续；我会沿着当前任务上下文按隔离方式推进。'
      : laneTargetsHistoricalContext
        ? '这件事来自指定历史记录；先回到对应上下文继续推进，不默认追加单独环境。'
      : executionMode === 'parallel-workers'
        ? '待处理的落地内容比较多，适合先分头推进，再统一收口检查。'
        : '已经有一项可以继续推进的后续任务；只要用户明确要继续，就可以往下做。';
    return {
      type: 'task',
      title: `继续推进：${task.title}`,
      command: `openprd tasks . --change ${shellQuote(taskState.changeId)}`,
      preparationCommand: executionMode === 'parallel-workers'
        ? `openprd loop . --plan --change ${shellQuote(taskState.changeId)}`
        : null,
      executionCommand: `openprd tasks . --change ${shellQuote(taskState.changeId)} --advance --verify --item ${shellQuote(task.id)}`,
      verifyCommand: task.verify ?? `openprd tasks . --change ${shellQuote(taskState.changeId)} --verify --item ${shellQuote(task.id)}`,
      reason: lightweightReason,
      changeId: taskState.changeId,
      task,
      coverageItem: null,
      intentGate: executionGate(),
      executionMode,
      parallelPlan,
      loop: {
        required: false,
        threshold: OPENPRD_LOOP_REQUIRED_IMPLEMENTATION_TASK_THRESHOLD,
        totalTasks,
        pendingTasks,
        implementationTasks,
        pendingImplementationTasks,
        worktreeRecommended: explicitIsolationRequest,
      },
    };
  }
  if (taskState && taskState.summary?.pending === 0 && focusedChangeId) {
    return {
      type: 'change-review',
      title: '检查本次调整是否都已补齐',
      command: `openprd change . --validate --change ${shellQuote(focusedChangeId)}`,
      verifyCommand: `openprd change . --validate --change ${shellQuote(focusedChangeId)}`,
      reason: '当前这次调整里的后续任务已经处理完了。',
      changeId: focusedChangeId,
      task: null,
      coverageItem: null,
    };
  }
  const prdPromotion = buildPrdPromotionRecommendation({ changes, next });
  if (prdPromotion) {
    return prdPromotion;
  }
  const nextCoverage = discovery?.coverageMatrix?.nextPendingItem;
  if (nextCoverage) {
    const item = compactCoverageItem(nextCoverage);
    return {
      type: 'discovery',
      title: `继续补充调研：${item.title}`,
      command: 'openprd discovery . --verify',
      executionCommand: `openprd discovery . --advance --item ${shellQuote(item.id)} --claim <evidence-backed-claim> --evidence <path>`,
      verifyCommand: 'openprd discovery . --verify',
      reason: '还有一个待补的调研点；只有用户明确要求继续深挖、对标或复刻时再推进。',
      changeId: focusedChangeId ?? activeChange,
      task: null,
      coverageItem: item,
      intentGate: executionGate(),
    };
  }
  if (discovery?.coverageMatrix?.summary?.pending === 0 && discovery?.runId) {
    return {
      type: 'discovery-review',
      title: '检查这轮调研是否已经收口',
      command: 'openprd discovery . --verify',
      verifyCommand: 'openprd discovery . --verify',
      reason: '当前这轮调研已经没有待补项了。',
      changeId: focusedChangeId ?? activeChange,
      task: null,
      coverageItem: null,
    };
  }
  const storedVerificationRecommendation = (
    requirementGateAssessment?.relevance !== 'primary'
    && !laneRequest?.requested
    && !resolvedTarget?.matched
    && (next?.recommendation?.nextAction ?? 'clarify-user') === 'clarify-user'
  )
    ? buildStoredVerificationRecommendation(runState, {
      activeChange,
      focusedChangeId,
    })
    : null;
  if (storedVerificationRecommendation) {
    return storedVerificationRecommendation;
  }
  return {
    type: 'workflow',
    title: next?.recommendation?.nextAction ?? '查看当前建议下一步',
    command: next?.recommendation?.suggestedCommand ?? 'openprd next .',
    verifyCommand: 'openprd validate .',
    reason: next?.recommendation?.reason ?? '当前没有找到可以直接继续推进的任务或调研项。',
    changeId: focusedChangeId ?? activeChange,
    task: null,
    coverageItem: null,
  };
}

async function buildRunContext(projectRoot, dependencies, options = {}) {
  const {
    listOpenPrdChangesWorkspace,
    listOpenSpecTaskWorkspace,
    nextWorkspace,
    resumeOpenSpecDiscoveryWorkspace,
    validateWorkspace,
  } = dependencies;
  await ensureRunHarness(projectRoot);
  const runState = await readRunState(projectRoot);
  const currentTurn = await readJson(harnessFile(projectRoot, OPENPRD_HARNESS_TURN_STATE)).catch(() => null);
  const runtimeEnvironment = await readRuntimeEnvironmentContext(projectRoot);
  const currentTurnPrompt = String(currentTurn?.prompt ?? '').trim();
  const fallbackPrompt = !options.hookInject
    ? (inferPromptDrivenLightweightRecommendation(currentTurnPrompt) ? currentTurnPrompt : null)
    : null;
  const effectiveMessage = String(options.message ?? '').trim()
    || fallbackPrompt
    || null;
  const laneRequest = analyzeRunMessage(effectiveMessage);
  const validation = await validateWorkspace(projectRoot)
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));
  const next = await nextWorkspace(projectRoot).catch(() => null);
  const requirementGate = await readActiveRequirementGate(projectRoot);
  const changes = await listOpenPrdChangesWorkspace(projectRoot).catch(() => null);
  const activeChange = changes?.activeChange ?? null;
  const latestPrd = next?.analysisSnapshot
    ? {
        versionId: next.analysisSnapshot.versionId ?? null,
        digest: next.analysisSnapshot.digest ?? null,
        workUnitId: next.analysisSnapshot.workUnitId ?? null,
        title: next.analysisSnapshot.title ?? null,
        status: next.analysisSnapshot.status ?? null,
      }
    : null;
  const resolutionCache = new Map();
  async function resolveWorkspaceArtifacts(targetProjectRoot) {
    const key = path.resolve(targetProjectRoot);
    if (resolutionCache.has(key)) {
      return resolutionCache.get(key);
    }
    const targetChanges = await listOpenPrdChangesWorkspace(targetProjectRoot).catch(() => null);
    const artifacts = {
      changes: targetChanges,
      index: await buildRunResolutionIndex(targetProjectRoot, targetChanges, listOpenSpecTaskWorkspace).catch(() => null),
      loopFeatureList: await readLoopFeatureList(targetProjectRoot),
    };
    resolutionCache.set(key, artifacts);
    return artifacts;
  }
  const currentWorkspaceArtifacts = await resolveWorkspaceArtifacts(projectRoot);
  const loopFeatureList = currentWorkspaceArtifacts.loopFeatureList;
  const shouldResolveTarget = Boolean(String(effectiveMessage ?? '').trim());
  const resolutionIndex = shouldResolveTarget ? currentWorkspaceArtifacts.index : null;
  const resolvedTarget = shouldResolveTarget
    ? await resolveRunTarget({
        projectRoot,
        message: effectiveMessage,
        request: laneRequest,
        index: resolutionIndex,
        loopFeatureList,
        resolveWorkspaceArtifacts,
      })
    : null;
  const requirementGateAssessment = assessRequirementGateRelevance({
    message: effectiveMessage,
    gate: requirementGate,
    laneRequest,
    resolvedTarget,
  });
  const focusedChangeId = selectFocusedChangeId(projectRoot, laneRequest, resolvedTarget, activeChange);
  const taskState = focusedChangeId
    ? await listOpenSpecTaskWorkspace(projectRoot, { change: focusedChangeId }).catch(() => null)
    : null;
  const resumedDiscovery = await resumeOpenSpecDiscoveryWorkspace(projectRoot).catch(() => null);
  const discovery = shouldSurfaceDiscoveryInRunContext(resumedDiscovery) ? resumedDiscovery : null;
  const promptDrivenRecommendation = (
    !requirementGate
    && !activeChange
    && !taskState?.nextTask
    && !discovery
    && !resolvedTarget?.matched
    && !laneRequest?.requested
  )
    ? inferPromptDrivenLightweightRecommendation(effectiveMessage)
    : null;
  const recommendation = promptDrivenRecommendation ?? buildRunRecommendation({
    projectRoot,
    message: effectiveMessage,
    changes,
    activeChange,
    focusedChangeId,
    taskState,
    discovery,
    next,
    loopFeatureList,
    requirementGate,
    requirementGateAssessment,
    laneRequest,
    resolvedTarget,
    runState,
  });
  const nextTask = compactTask(taskState?.nextTask ?? null);
  const lane = buildRunLane({
    message: effectiveMessage,
    recommendation,
    activeChange,
    latestPrd,
    loopFeatureList,
    resolvedTarget,
    projectRoot,
  });
  const recommendationWithGateReminder = {
    ...recommendation,
    reason: appendRequirementGateReminder(
      recommendation.reason,
      requirementGateAssessment,
      requirementGate,
    ),
  };
  const effectiveRecommendation = withExecutionConfirmationChecklist(
    applyLaneToRecommendation(recommendationWithGateReminder, lane),
    { requirementGate },
  );
  const knowledgeSkillMatches = await resolveKnowledgeSkillMatches(projectRoot, {
    message: effectiveMessage,
    prompt: effectiveMessage,
    recommendationTitle: effectiveRecommendation.title,
    recommendationReason: effectiveRecommendation.reason,
    activeChange,
    nextTaskTitle: nextTask?.title,
    relatedFiles: [
      focusedChangeId ? `.openprd/changes/${focusedChangeId}/tasks.md` : null,
      activeChange ? `.openprd/changes/${activeChange}` : null,
    ].filter(Boolean),
    limit: options.hookInject ? 4 : 3,
  }).catch(() => ({ matched: [], summary: { matched: 0 } }));
  const knowledgeAdoption = knowledgeSkillMatches.matched?.length > 0
    ? await recordKnowledgeSkillAdoption(projectRoot, {
      matches: knowledgeSkillMatches.matched,
      stages: options.hookInject ? ['hit', 'referenced', 'injected'] : ['hit', 'referenced'],
      source: options.hookInject ? 'run-context-hook' : 'run-context',
      sessionId: lane.target?.sessionId ?? resolvedTarget?.sessionId ?? requirementGate?.sessionId ?? null,
      promptPreview: effectiveMessage,
    }).catch(() => null)
    : null;
  const knowledgeStageBump = {
    hitCount: options.hookInject ? 1 : 1,
    referencedCount: 1,
    injectedCount: options.hookInject ? 1 : 0,
  };
  const renderedKnowledgeSkills = (knowledgeSkillMatches.matched ?? []).map((skill) => ({
    ...skill,
    adoption: skill.adoption
      ? {
          ...skill.adoption,
        hitCount: Number(skill.adoption.hitCount ?? 0) + knowledgeStageBump.hitCount,
        referencedCount: Number(skill.adoption.referencedCount ?? 0) + knowledgeStageBump.referencedCount,
        injectedCount: Number(skill.adoption.injectedCount ?? 0) + knowledgeStageBump.injectedCount,
      }
      : skill.adoption,
  }));

  const context = {
    ok: validation.valid,
    action: 'run-context',
    projectRoot,
    generatedAt: timestamp(),
    runState,
    validation: {
      valid: validation.valid,
      errors: validation.errors ?? [],
      warnings: validation.warnings ?? [],
    },
    workflow: next?.workflow ?? [],
    next: next?.recommendation ?? null,
    activeRequirementGate: requirementGate
      ? {
          status: requirementGate.status ?? null,
          promptPreview: requirementGate.promptPreview ?? null,
          intakeMode: requirementGate.intakeMode ?? null,
          sessionId: requirementGate.sessionId ?? null,
          relevance: requirementGateAssessment.relevance,
          matchedCurrentMessage: requirementGateAssessment.matchedCurrentMessage,
          relevanceReason: requirementGateAssessment.reason,
        }
      : null,
    prdReviewState: next?.prdReviewState
      ? {
          versionId: next.prdReviewState.versionId ?? null,
          status: next.prdReviewState.status ?? null,
          artifactExists: Boolean(next.prdReviewState.artifactExists),
          artifact: next.prdReviewState.artifact ?? null,
          shouldGateFreeze: Boolean(next.prdReviewState.shouldGateFreeze),
        }
      : null,
    latestPrd,
    activeChange,
    focus: {
      changeId: focusedChangeId,
      source: resolvedTarget?.source ?? null,
      workspaceRoot: resolvedTarget?.workspaceRoot ?? projectRoot,
      sessionId: resolvedTarget?.sessionId ?? lane.target?.sessionId ?? null,
      taskHandle: resolvedTarget?.taskHandle ?? null,
      workUnitId: resolvedTarget?.workUnitId ?? null,
      matched: Boolean(resolvedTarget?.matched),
      reason: resolvedTarget?.reason ?? null,
      promptPreview: resolvedTarget?.promptPreview ?? null,
    },
    taskSummary: taskState?.summary ?? null,
    nextTask,
    blockedTasks: taskState?.blockedTasks ?? [],
    discovery: discovery
      ? {
          runId: discovery.runId,
          mode: discovery.control?.mode ?? null,
          status: discovery.control?.status ?? null,
          iteration: discovery.control?.iteration ?? null,
          maxIterations: discovery.control?.maxIterations ?? null,
          summary: discovery.coverageMatrix?.summary ?? null,
          nextPendingItem: compactCoverageItem(discovery.coverageMatrix?.nextPendingItem ?? null),
        }
      : null,
    lane,
    recommendation: effectiveRecommendation,
    runtimeEnvironment,
    knowledgeSkills: {
      matched: renderedKnowledgeSkills,
      mandatoryCheck: knowledgeSkillMatches.mandatoryCheck ?? null,
      summary: {
        matched: renderedKnowledgeSkills.length,
        hookInjected: Boolean(options.hookInject && renderedKnowledgeSkills.length > 0),
        reviewRequired: Boolean(knowledgeSkillMatches.mandatoryCheck?.required),
        reviewMode: knowledgeSkillMatches.mandatoryCheck?.mode ?? null,
        adoption: knowledgeAdoption?.summary ?? null,
      },
    },
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
      runtimeEnvironment: OPENPRD_HARNESS_RUNTIME_ENVIRONMENT,
    },
  };

  await writeRunState(projectRoot, {
    ...runState,
    lastContextAt: context.generatedAt,
    lastRecommendation: effectiveRecommendation,
  });

  return context;
}

async function recordRunHook(projectRoot, options = {}) {
  await ensureRunHarness(projectRoot);
  const state = await readRunState(projectRoot);
  const runtimeEnvironment = await readRuntimeEnvironmentContext(projectRoot);
  const currentIteration = Number(state.currentIteration ?? 0) + 1;
  const event = {
    version: 1,
    at: timestamp(),
    iteration: currentIteration,
    type: 'hook',
    eventName: options.event ?? 'Unknown',
    risk: options.risk ?? 'unknown',
    outcome: options.outcome ?? 'unknown',
    preview: options.preview ?? null,
    runtimeEnvironment: runtimeEnvironment.active,
  };
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), event);
  await writeRunState(projectRoot, {
    ...state,
    currentIteration,
    lastHookAt: event.at,
    lastOutcome: event.outcome,
  });
  if (options.learn) {
    await appendText(harnessFile(projectRoot, OPENPRD_HARNESS_LEARNINGS), `\n## ${event.at}\n\n- ${options.learn}\n`);
  }
  return {
    ok: true,
    action: 'run-record-hook',
    projectRoot,
    event,
    files: {
      runState: OPENPRD_HARNESS_RUN_STATE,
      iterations: OPENPRD_HARNESS_ITERATIONS,
      learnings: OPENPRD_HARNESS_LEARNINGS,
    },
  };
}

async function verifyRunWorkspace(projectRoot, dependencies, options = {}) {
  const {
    checkStandardsWorkspace,
    validateOpenSpecChangeWorkspace,
    validateWorkspace,
    verifyOpenSpecDiscoveryWorkspace,
    verifyQualityWorkspace,
  } = dependencies;
  const summarizeWorkspaceAttention = (quality) => {
    const report = quality?.report ?? null;
    const attentionGates = Array.isArray(report?.readiness?.attentionGates)
      ? report.readiness.attentionGates.filter(Boolean)
      : [];
    const activeTasks = report?.evalHarness?.featureCoverage?.activeTasks ?? null;
    if (attentionGates.length === 1 && attentionGates[0] === 'feature-coverage' && activeTasks?.pending > 0) {
      const activeChange = activeTasks.activeChange ?? null;
      const total = Number(activeTasks.total ?? 0);
      const done = Number(activeTasks.done ?? 0);
      const pending = Number(activeTasks.pending ?? 0);
      const blocked = Number(activeTasks.blocked ?? 0);
      const progress = total > 0 ? `${done}/${total}` : `${done}`;
      const changeLabel = activeChange ? `active change ${activeChange}` : 'the active task ledger';
      return {
        kind: 'feature-coverage-ledger',
        gate: 'feature-coverage',
        gates: attentionGates,
        activeChange,
        total,
        done,
        pending,
        blocked,
        summary: 'feature-coverage ledger remains open',
        detail: `${changeLabel} still has ${pending} pending tasks (${progress} done)${blocked > 0 ? `, with ${blocked} blocked` : ''}. This usually means task bookkeeping or coverage evidence is incomplete, not that the current implementation failed.`,
      };
    }
    if (attentionGates.length > 0) {
      return {
        kind: 'quality-gates',
        gates: attentionGates,
        summary: `quality attention gates: ${attentionGates.join(', ')}`,
        detail: `Current task verification passed, but workspace-level quality still needs evidence for: ${attentionGates.join(', ')}.`,
      };
    }
    if (quality?.report?.readiness?.productionReady === false) {
      return {
        kind: 'quality-readiness',
        gates: [],
        summary: 'quality report is not production-ready',
        detail: 'Current task verification passed, but the workspace-level quality report still needs attention before overall readiness can be claimed.',
      };
    }
    return null;
  };
  const context = await buildRunContext(projectRoot, dependencies, options);
  const standards = await checkStandardsWorkspace(projectRoot);
  const validation = await validateWorkspace(projectRoot).then(({ report }) => report);
  const checks = [
    { name: 'standards', scope: 'task', ok: standards.ok, errors: standards.errors ?? [] },
    { name: 'validate', scope: 'task', ok: validation.valid, errors: validation.errors ?? [] },
  ];
  if (verifyQualityWorkspace) {
    const quality = await verifyQualityWorkspace(projectRoot, { strict: false }).catch((error) => ({
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    }));
    const productionReady = quality.report?.readiness?.productionReady ?? null;
    const workspaceAttention = summarizeWorkspaceAttention(quality);
    const qualityErrors = [
      ...(quality.errors ?? []),
      ...(productionReady === false
        ? [workspaceAttention?.detail ?? 'Quality report is not production-ready. Review required gates and evidence before claiming readiness.']
        : []),
    ];
    checks.push({
      name: 'quality',
      scope: 'workspace',
      ok: quality.ok && productionReady === true,
      errors: qualityErrors,
      reportPath: quality.reportPath ?? null,
      htmlPath: quality.htmlPath ?? null,
      productionReady,
      attentionGates: quality.report?.readiness?.attentionGates ?? [],
      workspaceAttention,
    });
  }
  const changeToVerify = context.focus?.changeId ?? context.recommendation?.changeId ?? context.activeChange ?? null;
  if (changeToVerify) {
    const change = await validateOpenSpecChangeWorkspace(projectRoot, { change: changeToVerify });
    checks.push({ name: 'change', scope: 'task', ok: change.ok, errors: change.errors ?? [] });
  }
  if (context.discovery) {
    const discovery = await verifyOpenSpecDiscoveryWorkspace(projectRoot);
    checks.push({ name: 'discovery', scope: 'task', ok: discovery.ok, errors: discovery.verification.errors ?? [] });
  }
  const taskChecks = checks.filter((check) => check.scope !== 'workspace');
  const workspaceChecks = checks;
  const taskReady = taskChecks.every((check) => check.ok);
  const workspaceReady = workspaceChecks.every((check) => check.ok);
  const qualityCheck = checks.find((check) => check.name === 'quality');
  const workspaceAttention = taskReady && !workspaceReady
    ? (qualityCheck?.workspaceAttention ?? {
      kind: 'workspace-checks',
      checks: workspaceChecks.filter((check) => !check.ok).map((check) => check.name),
      summary: `workspace attention: ${workspaceChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}`,
      detail: `Current task verification passed, but workspace-level checks still need attention: ${workspaceChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}.`,
    })
    : null;
  const ok = taskReady;
  const readiness = {
    taskReady,
    workspaceReady,
    releaseReady: workspaceReady,
    doctorReady: null,
    qualityProductionReady: qualityCheck?.productionReady ?? null,
  };
  const knowledgeSignal = {
    kind: 'run-verify',
    ok: workspaceReady,
    taskReady,
    workspaceReady,
    productionReady: qualityCheck?.productionReady ?? null,
    attentionGates: qualityCheck?.attentionGates ?? [],
    workspaceAttentionKind: workspaceAttention?.kind ?? null,
    summary: taskReady
      ? (workspaceReady ? 'run verify passed' : `run verify task-ready with workspace attention: ${workspaceAttention?.summary ?? workspaceChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}`)
      : `run verify failed: ${taskChecks.filter((check) => !check.ok).map((check) => check.name).join(', ')}`,
  };
  await recordKnowledgeReviewSignal(projectRoot, knowledgeSignal).catch(() => null);
  const reviewSource = (await exists(harnessFile(projectRoot, OPENPRD_HARNESS_TURN_STATE)))
    ? OPENPRD_HARNESS_TURN_STATE
    : (qualityCheck?.reportPath ?? null);
  const knowledgeReview = await reviewKnowledgeWorkspace(projectRoot, {
    from: reviewSource,
    signal: knowledgeSignal,
  }).catch((error) => ({
    ok: false,
    action: 'quality-knowledge-review',
      skipped: false,
      errors: [error instanceof Error ? error.message : String(error)],
  }));
  const verificationRecommendation = buildVerificationRecommendation({
    changeId: changeToVerify,
    readiness,
    workspaceAttention,
    knowledgeReview,
    qualityCheck,
  });
  const runState = await readRunState(projectRoot);
  await writeRunState(projectRoot, {
    ...runState,
    lastVerificationAt: timestamp(),
    lastVerification: {
      ...readiness,
      changeId: changeToVerify,
      workspaceAttention,
      knowledgeCandidateId: knowledgeReview?.candidateId ?? null,
      qualityReportPath: qualityCheck?.reportPath ?? null,
    },
    lastRecommendation: verificationRecommendation,
  });
  await appendJsonl(harnessFile(projectRoot, OPENPRD_HARNESS_ITERATIONS), {
    version: 1,
    at: timestamp(),
    type: 'verify',
    ok,
    readiness,
    checks: checks.map((check) => ({ name: check.name, scope: check.scope, ok: check.ok, errors: check.errors.length })),
  });
  const errors = taskChecks.flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`));
  const warnings = workspaceChecks
    .filter((check) => check.scope === 'workspace' && !check.ok)
    .flatMap((check) => check.errors.map((error) => `${check.name}: ${error}`));
  return {
    ok,
    action: 'run-verify',
    projectRoot,
    context,
    checks,
    readiness,
    workspaceAttention,
    warnings,
    knowledgeReview,
    recommendation: verificationRecommendation,
    errors,
  };
}

async function runWorkspaceImpl(projectRoot, options = {}, dependencies = {}) {
  if (options.recordHook) {
    return recordRunHook(projectRoot, options);
  }
  if (options.verify) {
    return verifyRunWorkspace(projectRoot, dependencies, options);
  }
  return buildRunContext(projectRoot, dependencies, options);
}


function createRunWorkspace(dependencies) {
  return function runWorkspace(projectRoot, options = {}) {
    return runWorkspaceImpl(projectRoot, options, dependencies);
  };
}

export { createRunWorkspace };
