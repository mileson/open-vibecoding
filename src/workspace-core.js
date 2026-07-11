import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSnapshotChangeSummary } from './change-summary.js';
import { formatProductTypeDisplay, formatTemplatePackDisplay } from './product-type-copy.js';
import { buildDiagramArtifact, renderDiagramMermaidFromModel } from './diagram-core.js';
import { migrateLegacyOpenPrdArtifacts } from './openspec/migration.js';
import { analyzePrdSnapshot, buildPrdSnapshot, formatVersionId, getRequiredFieldDescriptors, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { normalizeReleaseLedger } from './release-ledger.js';
import { appendJsonl, appendText, cjoin, exists, readJson, readText, readYaml, stringifyYaml, writeJson, writeText, writeYaml } from './fs-utils.js';
import { openProjectLedger } from './kernel/index.js';
import { OPENSPEC_TASK_MAX_ITEMS_PER_FILE } from './openspec/constants.js';
import { checkStandardsWorkspace, STANDARD_DOCS } from './standards.js';
import { timestamp } from './time.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEED_WORKSPACE = path.join(PACKAGE_ROOT, '.openprd');
const REQUIRED_PRODUCT_TYPES = ['consumer', 'b2b', 'agent'];
const REQUIRED_SECTIONS = ['meta', 'problem', 'users', 'goals', 'scope', 'scenarios', 'requirements', 'constraints', 'risks', 'handoff'];
const CORE_TEMPLATE_FILES = [
  'README.md',
  'README_EN.md',
  'config.yaml',
  'design/README.md',
  'design/README_EN.md',
  'design/anti-slop.md',
  'design/lenses/frontend-lenses.md',
  'design/themes/theme-catalog.json',
  'design/layouts/layout-catalog.json',
  'design/components/component-catalog.md',
  'design/recipes/product-launch.md',
  'design/recipes/content-experience.md',
  'design/recipes/operational-tool.md',
  'design/checklists/ui-quality-gate.md',
  'design/assets/surface-presets.md',
  'design/templates/README.md',
  'design/templates/README_EN.md',
  'design/templates/content-home.html',
  'design/templates/product-launch.html',
  'design/templates/ops-dashboard.html',
  'design/active/facts-sheet.md',
  'design/active/asset-spec.md',
  'design/active/image-preflight.md',
  'design/active/direction-plan.md',
  'design/active/selected-direction.md',
  'schema/prd.schema.yaml',
  'schema/diagram-architecture.schema.yaml',
  'schema/diagram-product-flow.schema.yaml',
  'templates/manifest.yaml',
  'templates/base/prd.md',
  'templates/base/intake.md',
  'templates/diagram/architecture.contract.json',
  'templates/diagram/product-flow.contract.json',
  'templates/consumer/prd.md',
  'templates/consumer/intake.md',
  'templates/b2b/prd.md',
  'templates/b2b/intake.md',
  'templates/agent/prd.md',
  'templates/agent/intake.md',
  'templates/company/README.md',
  'templates/company/README_EN.md',
  'templates/industry/README.md',
  'templates/industry/README_EN.md',
  'templates/project/README.md',
  'templates/project/README_EN.md',
  'templates/session/README.md',
  'templates/session/README_EN.md',
  'standards/config.json',
  'standards/file-manual-template.md',
  'standards/folder-readme-template.md',
  'engagements/active/intake.md',
  'engagements/active/prd.md',
  'engagements/active/flows.md',
  'engagements/active/roles.md',
  'engagements/active/handoff.md',
  'engagements/active/decision-log.md',
  'engagements/active/open-questions.md',
  'engagements/active/progress.md',
  'engagements/active/verification.md',
  'state/task-graph.json',
  'state/events.jsonl',
];
const WORKSPACE_SEED_REFRESH_FILES = [
  'README.md',
  'README_EN.md',
  'design/README.md',
  'design/README_EN.md',
  'design/anti-slop.md',
  'design/lenses/frontend-lenses.md',
  'design/themes/theme-catalog.json',
  'design/layouts/layout-catalog.json',
  'design/components/component-catalog.md',
  'design/recipes/product-launch.md',
  'design/recipes/content-experience.md',
  'design/recipes/operational-tool.md',
  'design/checklists/ui-quality-gate.md',
  'design/assets/surface-presets.md',
  'design/templates/README.md',
  'design/templates/README_EN.md',
  'design/templates/content-home.html',
  'design/templates/product-launch.html',
  'design/templates/ops-dashboard.html',
  'schema/prd.schema.yaml',
  'schema/diagram-architecture.schema.yaml',
  'schema/diagram-product-flow.schema.yaml',
  'templates/manifest.yaml',
  'templates/base/prd.md',
  'templates/base/intake.md',
  'templates/diagram/architecture.contract.json',
  'templates/diagram/product-flow.contract.json',
  'templates/consumer/prd.md',
  'templates/consumer/intake.md',
  'templates/b2b/prd.md',
  'templates/b2b/intake.md',
  'templates/agent/prd.md',
  'templates/agent/intake.md',
  'templates/company/README.md',
  'templates/company/README_EN.md',
  'templates/industry/README.md',
  'templates/industry/README_EN.md',
  'templates/project/README.md',
  'templates/project/README_EN.md',
  'templates/session/README.md',
  'templates/session/README_EN.md',
  'standards/file-manual-template.md',
  'standards/folder-readme-template.md',
];
const WORKSPACE_SEED_COPY_IGNORE = new Set([
  'archive',
  'artifacts',
  'benchmarks/.DS_Store',
  'benchmarks/evidence',
  'benchmarks/inbox',
  'changes',
  'discovery',
  'design/active',
  'growth',
  'harness',
  'knowledge',
  'learning',
  'quality',
  'reviews',
  'specs',
  'state',
  'sessions',
  'exports',
  'engagements/active/architecture-diagram.html',
  'engagements/active/architecture-diagram.json',
  'engagements/active/architecture-diagram.mmd',
  'engagements/active/brainstorm.html',
  'engagements/active/brainstorm.json',
  'engagements/active/decision-log.md',
  'engagements/active/product-flow-diagram.html',
  'engagements/active/product-flow-diagram.json',
  'engagements/active/product-flow-diagram.mmd',
  'engagements/active/open-questions.md',
  'engagements/active/progress.md',
  'engagements/active/review.html',
  'engagements/active/verification.md',
]);
const ACTIVE_DESIGN_TEMPLATE_FILES = {
  'facts-sheet.md': `# Facts Sheet

| 字段 | 当前值 | 来源 | verifiedAt | 状态 |
| --- | --- | --- | --- | --- |
| 产品 / 项目名 | 待填写 | 待确认 | - | pending |
| 版本 / 发布状态 | 待填写 | 待确认 | - | pending |
| 关键事实 1 | 待填写 | 待确认 | - | pending |
| 关键事实 2 | 待填写 | 待确认 | - | pending |

## 备注

- 没核实到就保留 \`pending\`
- 不要把记忆当来源
`,
  'asset-spec.md': `# Asset Spec

| 类型 | 资产 | 来源 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| logo | 待填写 | 待确认 | pending |  |
| 产品图 | 待填写 | 待确认 | pending |  |
| UI 图 | 待填写 | 待确认 | pending |  |
| 功能图标 | 新入口/按钮/空态默认配图标 | UI 图标 Phosphor；实现库 Lucide/Tabler/React Icons；AI 品牌 LobeHub；技术栈 Tech Icons | pending | 开发新功能时 Agent 自动找图标并登记，不等用户要求 |
| 摄影 / 插图 | 待填写 | 待确认 | pending |  |
| 色板 / 字体 | 待填写 | 待确认 | pending |  |
| 动效节奏 | 待填写 | 待确认 | pending |  |
| 背景 / 表面 | 待填写 | 待确认 | pending |  |
| 构图记忆点 | 待填写 | 待确认 | pending |  |

## 冻结变量

- lens: 待填写
- theme: 待填写
- layout: 待填写
- aesthetic: 待填写
- memory-point: 待填写
`,
  'image-preflight.md': `# Image Preflight

| 问题 | 回答 |
| --- | --- |
| 真实图片是不是页面成立前提 | 待填写 |
| 必需图片类型 | 待填写 |
| 计划来源 | 待填写 |
| 缺失风险 | 待填写 |
| 降级方案 | 待填写 |
`,
  'direction-plan.md': `# Direction Plan

| 方向 | 生成逻辑 | lens | theme | layout | 审美主张 | 记忆点 | 为什么不同 | 适用场景 | 主要风险 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 方向 1 | contrast | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
| 方向 2 | reference-transfer | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
| 方向 3 | design-lens | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 | 待填写 |
`,
  'selected-direction.md': `# Selected Direction

- selected: 待填写
- reason: 待填写
- lens: 待填写
- theme: 待填写
- layout: 待填写
- aesthetic: 待填写
- memory-point: 待填写
- components:
  - 待填写
- follow-up risks:
  - 待填写
`,
};
const OPERATIONAL_GITIGNORE_ENTRIES = [
  '.openprd/harness/',
  '.openprd/learning/',
  '.openprd/quality/reports/',
];

const DEFAULT_DISCOVERY_CONFIG = {
  activeChange: null,
  taskSharding: {
    maxItemsPerFile: OPENSPEC_TASK_MAX_ITEMS_PER_FILE,
    handoffRequired: true,
    firstFile: 'tasks.md',
    nextFilePattern: 'tasks-###.md',
  },
  taskMetadata: {
    stableIdPattern: 'T###.##',
    required: ['done', 'verify'],
    optional: ['deps', 'type'],
    dependencyOrder: 'dependencies must appear before dependents',
  },
};

const WORKSPACE_SCENARIO_IGNORED_ENTRIES = new Set(['.openprd', '.DS_Store', '.git', '.omx']);
const WORKSPACE_SCENARIO_BOOTSTRAP_FILE_MARKERS = new Map([
  ['AGENTS.md', 'OPENPRD:AGENTS:START'],
  ['CLAUDE.md', 'OPENPRD:CLAUDE:START'],
]);
const OPENPRD_INSTALL_MANIFEST_PATH = path.join('.openprd', 'harness', 'install-manifest.json');
const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_REQUIREMENT_GATE = cjoin(OPENPRD_HARNESS_DIR, 'requirement-gate.json');
const OPENPRD_HARNESS_REQUIREMENT_GATES_DIR = cjoin(OPENPRD_HARNESS_DIR, 'requirement-gates');
const OPENPRD_HARNESS_SESSION_BINDINGS_DIR = cjoin(OPENPRD_HARNESS_DIR, 'session-bindings');
const OPENPRD_HARNESS_SESSION_STATES_DIR = cjoin(OPENPRD_HARNESS_DIR, 'session-states');

function normalizeLaneSessionId(sessionId) {
  const text = String(sessionId ?? '').trim();
  return text || null;
}

function sessionLaneFileName(sessionId) {
  const normalized = normalizeLaneSessionId(sessionId);
  if (!normalized) {
    return null;
  }
  return `${normalized.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

function sessionCurrentStatePath(projectRoot, sessionId) {
  const fileName = sessionLaneFileName(sessionId);
  if (!fileName) {
    return null;
  }
  return cjoin(projectRoot, OPENPRD_HARNESS_SESSION_STATES_DIR, fileName);
}

function sessionRequirementGatePath(projectRoot, sessionId) {
  const fileName = sessionLaneFileName(sessionId);
  if (!fileName) {
    return null;
  }
  return cjoin(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATES_DIR, fileName);
}

function sessionBindingPath(projectRoot, sessionId) {
  const fileName = sessionLaneFileName(sessionId);
  if (!fileName) {
    return null;
  }
  return cjoin(projectRoot, OPENPRD_HARNESS_SESSION_BINDINGS_DIR, fileName);
}

async function readActiveRequirementLane(projectRoot, workspaceCurrentState = null, options = {}) {
  const legacyGate = options.legacyGate ?? await readJson(cjoin(projectRoot, OPENPRD_HARNESS_REQUIREMENT_GATE)).catch(() => null);
  const explicitSessionId = normalizeLaneSessionId(options.sessionId);
  const activeSessionId = explicitSessionId
    ?? normalizeLaneSessionId(legacyGate?.active ? legacyGate.sessionId : null)
    ?? normalizeLaneSessionId(workspaceCurrentState?.laneSessionId);
  if (!activeSessionId) {
    return {
      sessionId: null,
      scope: 'workspace',
      gate: legacyGate?.active ? legacyGate : null,
      binding: null,
      sessionState: null,
      currentStatePath: null,
    };
  }
  const [scopedGate, binding, sessionState] = await Promise.all([
    readJson(sessionRequirementGatePath(projectRoot, activeSessionId)).catch(() => null),
    readJson(sessionBindingPath(projectRoot, activeSessionId)).catch(() => null),
    readJson(sessionCurrentStatePath(projectRoot, activeSessionId)).catch(() => null),
  ]);
  return {
    sessionId: activeSessionId,
    scope: 'session',
    gate: scopedGate ?? (legacyGate?.active ? legacyGate : null),
    binding,
    sessionState,
    currentStatePath: sessionCurrentStatePath(projectRoot, activeSessionId),
  };
}

function materializePersistedCurrentState(currentState, sessionId = null) {
  const normalized = normalizeLaneSessionId(sessionId);
  return {
    ...(currentState ?? {}),
    laneScope: normalized ? 'session' : 'workspace',
    laneSessionId: normalized,
  };
}

async function persistWorkspaceCurrentState(ws, currentState, options = {}) {
  const sessionId = normalizeLaneSessionId(options.sessionId ?? ws.data.currentSessionId);
  const stored = materializePersistedCurrentState(currentState, sessionId);
  if (sessionId) {
    const scopedPath = ws.paths.sessionCurrentState ?? sessionCurrentStatePath(ws.projectRoot, sessionId);
    await writeJson(scopedPath, stored);
  }
  if (!sessionId || options.writeWorkspaceMirror !== false) {
    await writeJson(ws.paths.workspaceCurrentState ?? ws.paths.currentState, stored);
  }
  return stored;
}

function buildCurrentStateSnapshot(ws, currentState, versionIndex = []) {
  const state = currentState ?? {};
  return buildPrdSnapshot(ws, {
    ...state,
    versionNumber: state.prdVersion ?? (versionIndex.at(-1)?.versionNumber ?? 0),
    versionId: state.prdVersion > 0
      ? formatVersionId(state.prdVersion)
      : (versionIndex.at(-1)?.versionId ?? 'v0000'),
    productType: state.productType ?? resolveCurrentProductType(ws),
    templatePack: state.templatePack ?? resolveActiveTemplatePack(ws),
    status: state.status ?? 'draft',
  });
}

async function loadCurrentLaneSnapshot(ws, options = {}) {
  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const fallbackToLatest = options.fallbackToLatest !== false;
  const candidateVersionIds = [
    currentState.reviewStatus?.versionId,
    currentState.latestVersionId,
    currentState.versionId,
    ws.data.sessionBinding?.versionId,
  ].map((value) => normalizeVersionId(value)).filter(Boolean);
  for (const versionId of candidateVersionIds) {
    const snapshot = await readVersionSnapshot(ws, versionId);
    if (snapshot) {
      return {
        snapshot,
        indexEntry: versionIndex.find((entry) => normalizeVersionId(entry.versionId) === versionId) ?? null,
        source: ws.data.currentSessionId ? 'session-version' : 'workspace-version',
      };
    }
  }
  if (Object.keys(currentState).length > 0) {
    return {
      snapshot: buildCurrentStateSnapshot(ws, currentState, versionIndex),
      indexEntry: null,
      source: ws.data.currentSessionId ? 'session-draft' : 'workspace-draft',
    };
  }
  if (!fallbackToLatest) {
    return null;
  }
  const latest = await loadLatestVersionSnapshot(ws);
  if (latest) {
    return {
      ...latest,
      source: ws.data.currentSessionId ? 'workspace-latest-fallback' : 'workspace-latest',
    };
  }
  return null;
}

function formatMarkdownLines(lines) {
  return lines.filter(Boolean).map((line) => `- ${line}`).join('\n');
}

function renderLogEntry(title, lines) {
  return `\n## ${title}\n\n${formatMarkdownLines(lines)}\n`;
}

function normalizeMarkdownTimestampHeadings(text) {
  return text.replace(/^##\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)\s*$/gm, (_match, isoValue) => {
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) {
      return `## ${isoValue}`;
    }
    return `## ${timestamp(parsed)}`;
  });
}

async function normalizeWorkspaceMarkdownTimestamps(projectRoot, changes) {
  const relativePaths = [
    'engagements/active/decision-log.md',
    'engagements/active/open-questions.md',
    'engagements/active/progress.md',
    'engagements/active/verification.md',
  ];
  for (const relativePath of relativePaths) {
    const targetPath = cjoin(projectRoot, '.openprd', relativePath);
    const current = await readText(targetPath).catch(() => null);
    if (current === null) {
      continue;
    }
    const next = normalizeMarkdownTimestampHeadings(current);
    if (next !== current) {
      await writeText(targetPath, next);
      changes.push({ path: cjoin('.openprd', relativePath), status: 'updated-timestamp-format' });
    }
  }
}

function buildWorkflowTaskGraph(snapshot = null, analysis = null, options = {}) {
  const productType = snapshot?.productType ?? null;
  const prdVersion = Number(snapshot?.versionNumber ?? snapshot?.prdVersion ?? 0);
  const isSynthesized = Boolean(snapshot?.digest || prdVersion > 0);
  const isFrozen = snapshot?.status === 'frozen';
  const isHandedOff = snapshot?.status === 'handed_off';
  const brainstormDone = Boolean(snapshot?.brainstormMeta?.generatedAt || snapshot?.brainstormMeta?.artifactId);
  const isInterviewComplete = Boolean(
    snapshot?.sections?.problem?.problemStatement
    && snapshot?.sections?.users?.primaryUsers?.length
    && snapshot?.sections?.goals?.goals?.length
  );

  const blockers = analysis?.missingFields?.map((field) => ({
    id: field.path,
    label: field.label,
    question: field.prompt,
    section: field.section,
    status: 'blocked',
  })) ?? [];
  const diagramState = options.diagramState ?? null;
  const diagramGateActive = Boolean(diagramState?.shouldGateFreeze);
  const prdReviewState = options.prdReviewState ?? null;
  const reviewGateActive = Boolean(prdReviewState?.shouldGateFreeze);
  const clarificationState = options.clarificationState ?? null;
  const clarifyGateActive = Boolean(clarificationState?.shouldAskUser);

  const workflow = [
    {
      id: 'brainstorm',
      label: 'brainstorm',
      kind: 'workflow-step',
      status: brainstormDone ? 'done' : 'ready',
      dependsOn: [],
    },
    {
      id: 'clarify',
      label: 'clarify',
      kind: 'workflow-step',
      status: clarifyGateActive ? 'ready' : 'done',
      dependsOn: [],
    },
    {
      id: 'classify',
      label: 'classify',
      kind: 'workflow-step',
      status: productType ? 'done' : (clarifyGateActive ? 'blocked' : 'ready'),
      dependsOn: ['clarify'],
    },
    {
      id: 'interview',
      label: 'interview',
      kind: 'workflow-step',
      status: isInterviewComplete || isSynthesized ? 'done' : (productType ? 'ready' : 'blocked'),
      dependsOn: ['classify'],
    },
    {
      id: 'synthesize',
      label: 'synthesize',
      kind: 'workflow-step',
      status: isSynthesized ? 'done' : (productType ? 'ready' : 'blocked'),
      dependsOn: ['classify', 'interview'],
    },
    {
      id: 'validate',
      label: 'validate',
      kind: 'workflow-step',
      status: isFrozen || isHandedOff ? 'done' : (isSynthesized ? 'ready' : 'blocked'),
      dependsOn: ['synthesize'],
    },
    {
      id: 'diagram',
      label: 'diagram',
      kind: 'workflow-step',
      status: !isSynthesized
        ? 'blocked'
        : (diagramGateActive ? 'ready' : 'done'),
      dependsOn: ['synthesize'],
    },
    {
      id: 'review',
      label: 'review',
      kind: 'workflow-step',
      status: !isSynthesized
        ? 'blocked'
        : (reviewGateActive ? 'ready' : 'done'),
      dependsOn: ['synthesize'],
    },
    {
      id: 'freeze',
      label: 'freeze',
      kind: 'workflow-step',
      status: isFrozen || isHandedOff ? 'done' : (snapshot?.digest && !diagramGateActive && !reviewGateActive ? 'ready' : 'blocked'),
      dependsOn: [
        'validate',
        ...(diagramGateActive ? ['diagram'] : []),
        ...(reviewGateActive ? ['review'] : []),
      ],
    },
    {
      id: 'handoff',
      label: 'handoff',
      kind: 'workflow-step',
      status: isHandedOff ? 'done' : (isFrozen ? 'ready' : 'blocked'),
      dependsOn: ['freeze'],
    },
    {
      id: 'archive',
      label: 'archive',
      kind: 'workflow-step',
      status: isHandedOff ? 'done' : 'blocked',
      dependsOn: ['handoff'],
    },
  ];

  const artifacts = [
    {
      id: 'decision-log',
      label: 'decision-log.md',
      kind: 'record',
      status: 'ready',
      dependsOn: [],
    },
    {
      id: 'brainstorm-file',
      label: 'brainstorm.html',
      kind: 'artifact',
      status: brainstormDone ? 'done' : 'ready',
      dependsOn: ['brainstorm'],
    },
    {
      id: 'open-questions',
      label: 'open-questions.md',
      kind: 'record',
      status: productType ? (analysis?.missingRequiredFields > 0 ? 'ready' : 'done') : 'ready',
      dependsOn: ['interview'],
    },
    {
      id: 'progress',
      label: 'progress.md',
      kind: 'record',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['classify'],
    },
    {
      id: 'verification',
      label: 'verification.md',
      kind: 'record',
      status: isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['freeze'],
    },
    {
      id: 'architecture-diagram',
      label: 'architecture-diagram.html',
      kind: 'artifact',
      status: diagramState?.architecture?.exists ? 'done' : (isSynthesized ? 'ready' : 'blocked'),
      dependsOn: ['diagram'],
    },
    {
      id: 'product-flow-diagram',
      label: 'product-flow-diagram.html',
      kind: 'artifact',
      status: diagramState?.productFlow?.exists ? 'done' : (isSynthesized ? 'ready' : 'blocked'),
      dependsOn: ['diagram'],
    },
    {
      id: 'prd',
      label: 'prd.md',
      kind: 'artifact',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['synthesize'],
    },
    {
      id: 'intake-reflection',
      label: 'intake-reflection.md',
      kind: 'record',
      status: clarifyGateActive ? 'ready' : 'done',
      dependsOn: ['clarify'],
    },
    {
      id: 'review-file',
      label: 'review.html',
      kind: 'artifact',
      status: isFrozen || isHandedOff
        ? 'done'
        : (isSynthesized ? (reviewGateActive ? 'ready' : 'done') : 'blocked'),
      dependsOn: ['synthesize', 'review'],
    },
    {
      id: 'flows',
      label: 'flows.md',
      kind: 'artifact',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['synthesize'],
    },
    {
      id: 'roles',
      label: 'roles.md',
      kind: 'artifact',
      status: isSynthesized || isFrozen || isHandedOff ? 'done' : 'ready',
      dependsOn: ['synthesize'],
    },
    {
      id: 'handoff',
      label: 'handoff.md',
      kind: 'artifact',
      status: isHandedOff ? 'done' : (isFrozen ? 'ready' : 'blocked'),
      dependsOn: ['freeze'],
    },
  ];

  let nextReadyNode = 'classify';
  if (clarifyGateActive) {
    nextReadyNode = 'clarify';
  } else if (!productType) {
    nextReadyNode = 'classify';
  } else if (analysis?.missingRequiredFields > 0) {
    nextReadyNode = 'interview';
  } else if (diagramGateActive) {
    nextReadyNode = 'diagram';
  } else if (reviewGateActive) {
    nextReadyNode = 'review';
  } else if (isFrozen) {
    nextReadyNode = 'handoff';
  } else if (isHandedOff) {
    nextReadyNode = 'archive';
  } else if (isSynthesized) {
    nextReadyNode = 'freeze';
  } else {
    nextReadyNode = 'synthesize';
  }

  return {
    version: 1,
    generatedAt: timestamp(),
    nextReadyNode,
    workflow,
    artifacts,
    nodes: [
      ...workflow.map((step) => ({
        id: step.id,
        label: step.label,
        kind: step.kind,
        status: step.status,
        dependsOn: step.dependsOn,
      })),
      ...artifacts.map((artifact) => ({
        id: artifact.id,
        label: artifact.label,
        kind: artifact.kind,
        status: artifact.status,
        dependsOn: artifact.dependsOn,
      })),
    ],
    edges: [
      { from: 'brainstorm', to: 'brainstorm-file', relation: 'produces' },
      { from: 'clarify', to: 'classify', relation: 'unblocks' },
      { from: 'classify', to: 'interview', relation: 'enables' },
      { from: 'interview', to: 'synthesize', relation: 'enables' },
      { from: 'synthesize', to: 'validate', relation: 'enables' },
      { from: 'synthesize', to: 'diagram', relation: 'enables' },
      { from: 'synthesize', to: 'review', relation: 'enables' },
      { from: 'diagram', to: 'freeze', relation: 'confirms' },
      { from: 'review', to: 'freeze', relation: 'confirms' },
      { from: 'validate', to: 'freeze', relation: 'guards' },
      { from: 'freeze', to: 'handoff', relation: 'enables' },
      { from: 'handoff', to: 'archive', relation: 'enables' },
      { from: 'interview', to: 'open-questions', relation: 'updates' },
      { from: 'synthesize', to: 'prd', relation: 'produces' },
      { from: 'clarify', to: 'intake-reflection', relation: 'produces' },
      { from: 'synthesize', to: 'review-file', relation: 'produces' },
      { from: 'synthesize', to: 'flows', relation: 'produces' },
      { from: 'synthesize', to: 'roles', relation: 'produces' },
      { from: 'diagram', to: 'architecture-diagram', relation: 'produces' },
      { from: 'diagram', to: 'product-flow-diagram', relation: 'produces' },
      { from: 'freeze', to: 'verification', relation: 'produces' },
      { from: 'freeze', to: 'handoff', relation: 'produces' },
    ],
    blockers,
  };
}

async function appendWorkflowEvent(ws, type, payload = {}) {
  const at = timestamp();
  const eventTypeSuffix = String(type ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'event';
  const jsonPayload = JSON.parse(JSON.stringify(payload ?? {}));
  const ledger = openProjectLedger(ws.projectRoot);
  await ledger.append(
    `workflow:${ws.data?.currentSessionId ?? 'workspace'}`,
    {
      eventType: `workflow.${eventTypeSuffix}`,
      actor: { type: 'openprd-cli' },
      payload: {
        type,
        at,
        ...jsonPayload,
      },
      metadata: {
        compatibilityProjection: path.relative(ws.projectRoot, ws.paths.eventsLog).split(path.sep).join('/'),
      },
    },
  );
  await appendJsonl(ws.paths.eventsLog, {
    type,
    at,
    ...jsonPayload,
  });
}

async function appendDecision(ws, lines) {
  await appendText(ws.paths.decisionLog, renderLogEntry(timestamp(), lines));
}

async function appendProgress(ws, lines) {
  await appendText(ws.paths.progressLog, renderLogEntry(timestamp(), lines));
}

async function appendOpenQuestions(ws, lines) {
  await appendText(ws.paths.openQuestionsLog, renderLogEntry(timestamp(), lines));
}

async function appendVerification(ws, lines) {
  await appendText(ws.paths.verificationLog, renderLogEntry(timestamp(), lines));
}

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function shouldIgnoreSeedCopy(relativePath, ignorePaths) {
  const normalized = normalizeRelativePath(relativePath);
  return ignorePaths.has(normalized)
    || [...ignorePaths].some((ignored) => normalized.startsWith(`${ignored}/`));
}

async function copyTree(sourceDir, targetDir, { overwrite = false, ignorePaths = new Set(), rootDir = sourceDir } = {}) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  let created = 0;

  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    const sourcePath = cjoin(sourceDir, entry.name);
    const targetPath = cjoin(targetDir, entry.name);
    const relativePath = path.relative(rootDir, sourcePath);
    if (shouldIgnoreSeedCopy(relativePath, ignorePaths)) {
      continue;
    }

    if (entry.isDirectory()) {
      created += await copyTree(sourcePath, targetPath, { overwrite, ignorePaths, rootDir });
      continue;
    }

    if (!overwrite && await exists(targetPath)) {
      continue;
    }

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    created += 1;
  }

  return created;
}

async function ensureWorkspaceSkeleton(projectRoot, options = {}) {
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  const created = await copyTree(SEED_WORKSPACE, workspaceRoot, {
    overwrite: Boolean(options.force),
    ignorePaths: WORKSPACE_SEED_COPY_IGNORE,
    rootDir: SEED_WORKSPACE,
  });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state', 'versions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'reviews'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'sessions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'exports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'artifacts', 'active'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'artifacts', 'archive'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'learning', 'archive'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'quality', 'reports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'lenses'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'themes'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'layouts'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'components'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'recipes'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'checklists'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'assets'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'templates'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'active'), { recursive: true });
  for (const [filename, content] of Object.entries(ACTIVE_DESIGN_TEMPLATE_FILES)) {
    const targetPath = cjoin(workspaceRoot, 'design', 'active', filename);
    if (options.force || !(await exists(targetPath))) {
      await writeText(targetPath, content);
    }
  }
  await fs.mkdir(cjoin(workspaceRoot, 'growth'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'incidents'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'patterns'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'skills'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'candidates'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'drafts'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'benchmarks', 'inbox'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'benchmarks', 'evidence'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'discovery'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'engagements', 'active'), { recursive: true });

  const defaults = [
    [cjoin(workspaceRoot, 'engagements', 'active', 'decision-log.md'), '# 决策记录\n\n- 已初始化 OpenPrd 决策跟踪。\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'open-questions.md'), '# 开放问题\n\n- 已初始化 OpenPrd 问题跟踪。\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'progress.md'), '# 进度\n\n- 已初始化 OpenPrd 进度跟踪。\n'],
    [cjoin(workspaceRoot, 'engagements', 'active', 'verification.md'), '# 验证\n\n- 已初始化 OpenPrd 验证跟踪。\n'],
    [cjoin(workspaceRoot, 'state', 'task-graph.json'), JSON.stringify(buildWorkflowTaskGraph(), null, 2) + '\n'],
    [cjoin(workspaceRoot, 'state', 'events.jsonl'), ''],
    [cjoin(workspaceRoot, 'benchmarks', 'sources.yaml'), 'version: 1\nschema: openprd.benchmarks.v1\nsources: []\n'],
    [cjoin(workspaceRoot, 'benchmarks', 'index.md'), '# OpenPrd Benchmark Registry\n\n## 规则\n\n- 项目级 approved benchmark 优先于 OpenPrd 内置 Source Map。\n- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。\n- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。\n\n## Approved Sources\n\n- 暂无已批准来源。\n\n## Candidate Sources\n\n- 暂无待确认来源。\n'],
    [cjoin(workspaceRoot, 'discovery', 'config.json'), JSON.stringify(DEFAULT_DISCOVERY_CONFIG, null, 2) + '\n'],
  ];

  for (const [filePath, content] of defaults) {
    if (!(await exists(filePath))) {
      await writeText(filePath, content);
    }
  }

  await ensureOperationalGitignore(projectRoot);

  return { workspaceRoot, created };
}

function normalizeIgnoreLine(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return '';
  }
  return trimmed
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function missingOperationalGitignoreEntries(text) {
  const present = new Set(String(text ?? '')
    .split(/\r?\n/)
    .map(normalizeIgnoreLine)
    .filter(Boolean));
  return OPERATIONAL_GITIGNORE_ENTRIES.filter((entry) => !present.has(normalizeIgnoreLine(entry)));
}

function gitignoreContainsOnlyOpenPrdOperationalEntries(text) {
  const allowed = new Set(OPERATIONAL_GITIGNORE_ENTRIES.map(normalizeIgnoreLine));
  const entries = String(text ?? '')
    .split(/\r?\n/)
    .map(normalizeIgnoreLine)
    .filter(Boolean);
  return entries.length > 0 && entries.every((entry) => allowed.has(entry));
}

async function readOperationalGitignoreStatus(projectRoot) {
  const gitignorePath = cjoin(projectRoot, '.gitignore');
  const text = await readText(gitignorePath).catch(() => '');
  const missing = missingOperationalGitignoreEntries(text);
  return {
    ok: missing.length === 0,
    path: '.gitignore',
    missing,
  };
}

async function ensureOperationalGitignore(projectRoot, changes = null) {
  const gitignorePath = cjoin(projectRoot, '.gitignore');
  const current = await readText(gitignorePath).catch(() => '');
  const missing = missingOperationalGitignoreEntries(current);
  if (missing.length === 0) {
    changes?.push({ path: '.gitignore', status: 'unchanged' });
    return { ok: true, path: '.gitignore', status: 'unchanged', missing: [] };
  }

  const prefix = current.trimEnd();
  const next = `${prefix ? `${prefix}\n` : ''}${missing.join('\n')}\n`;
  await writeText(gitignorePath, next);
  changes?.push({
    path: '.gitignore',
    status: current ? 'updated' : 'created',
    message: `added OpenPrd generated artifact ignores: ${missing.join(', ')}`,
  });
  return { ok: true, path: '.gitignore', status: current ? 'updated' : 'created', missing };
}

async function copySeedFileIfChanged(projectRoot, relativePath, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, relativePath);
  const targetPath = cjoin(projectRoot, '.openprd', relativePath);
  if (!(await exists(sourcePath))) {
    return;
  }
  const next = await readText(sourcePath);
  const current = await readText(targetPath).catch(() => null);
  if (current === next) {
    changes.push({ path: cjoin('.openprd', relativePath), status: 'unchanged' });
    return;
  }
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.openprd', relativePath), status: current === null ? 'created' : 'updated' });
}

async function migrateWorkspaceConfig(projectRoot, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, 'config.yaml');
  const targetPath = cjoin(projectRoot, '.openprd', 'config.yaml');
  const seed = await readYaml(sourcePath);
  const current = await readYaml(targetPath).catch(() => ({}));
  const next = {
    ...seed,
    ...current,
    learningReview: {
      ...(seed.learningReview ?? {}),
      ...(current.learningReview ?? {}),
      enabled: current.learningReview?.enabled ?? seed.learningReview?.enabled ?? true,
      autoOpen: current.learningReview?.autoOpen ?? seed.learningReview?.autoOpen ?? true,
      defaultGenre: current.learningReview?.defaultGenre ?? seed.learningReview?.defaultGenre ?? 'internet-product',
      sourceScope: current.learningReview?.sourceScope ?? seed.learningReview?.sourceScope ?? 'workspace',
    },
    quality: {
      ...(seed.quality ?? {}),
      ...(current.quality ?? {}),
    },
    design: {
      ...(seed.design ?? {}),
      ...(current.design ?? {}),
      enabled: current.design?.enabled ?? seed.design?.enabled ?? true,
      frameworkRoot: current.design?.frameworkRoot ?? seed.design?.frameworkRoot ?? '.openprd/design',
      templateRoot: current.design?.templateRoot ?? seed.design?.templateRoot ?? '.openprd/design/templates',
      activeArtifacts: {
        ...(seed.design?.activeArtifacts ?? {}),
        ...(current.design?.activeArtifacts ?? {}),
      },
    },
    supportedProductTypes: seed.supportedProductTypes,
    templateInheritance: seed.templateInheritance,
    workflow: seed.workflow,
    qualityGates: {
      ...(seed.qualityGates ?? {}),
      ...(current.qualityGates ?? {}),
      standards: seed.qualityGates?.standards,
      freezeRequires: seed.qualityGates?.freezeRequires,
    },
  };
  const currentText = await readText(targetPath).catch(() => null);
  const nextText = stringifyYaml(next);
  if (currentText !== nextText) {
    await writeText(targetPath, nextText);
    changes.push({ path: cjoin('.openprd', 'config.yaml'), status: currentText === null ? 'created' : 'updated' });
  } else {
    changes.push({ path: cjoin('.openprd', 'config.yaml'), status: 'unchanged' });
  }
}

function mergeStringLists(...lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) {
      continue;
    }
    for (const item of list) {
      if (typeof item !== 'string') {
        continue;
      }
      const normalized = item.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }
  }
  return merged;
}

async function migrateStandardsConfig(projectRoot, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, 'standards', 'config.json');
  const targetPath = cjoin(projectRoot, '.openprd', 'standards', 'config.json');
  const seed = await readJson(sourcePath).catch(() => null);
  if (!seed) {
    return;
  }
  const current = await readJson(targetPath).catch(() => null);
  if (!current) {
    await copySeedFileIfChanged(projectRoot, 'standards/config.json', changes);
    return;
  }

  const next = {
    ...seed,
    ...current,
    version: seed.version ?? current.version ?? 1,
    docsRoot: seed.docsRoot ?? current.docsRoot ?? 'docs/basic',
    requiredDocs: Array.isArray(seed.requiredDocs) && seed.requiredDocs.length > 0
      ? seed.requiredDocs
      : (current.requiredDocs ?? []),
    fileManual: {
      ...(seed.fileManual ?? {}),
      ...(current.fileManual ?? {}),
      ignorePaths: mergeStringLists(seed.fileManual?.ignorePaths, current.fileManual?.ignorePaths),
    },
    folderManual: {
      ...(seed.folderManual ?? {}),
      ...(current.folderManual ?? {}),
      ignorePaths: mergeStringLists(seed.folderManual?.ignorePaths, current.folderManual?.ignorePaths),
    },
    sourceManual: {
      ...(seed.sourceManual ?? {}),
      ...(current.sourceManual ?? {}),
      ignorePaths: mergeStringLists(seed.sourceManual?.ignorePaths, current.sourceManual?.ignorePaths),
    },
    developmentStandards: {
      ...(seed.developmentStandards ?? {}),
      ...(current.developmentStandards ?? {}),
      codeFileLines: {
        ...(seed.developmentStandards?.codeFileLines ?? {}),
        ...(current.developmentStandards?.codeFileLines ?? {}),
        codeFileExtensions: mergeStringLists(
          seed.developmentStandards?.codeFileLines?.codeFileExtensions,
          current.developmentStandards?.codeFileLines?.codeFileExtensions
        ),
        exemptPathSegments: mergeStringLists(
          seed.developmentStandards?.codeFileLines?.exemptPathSegments,
          current.developmentStandards?.codeFileLines?.exemptPathSegments
        ),
        exemptFilePatterns: mergeStringLists(
          seed.developmentStandards?.codeFileLines?.exemptFilePatterns,
          current.developmentStandards?.codeFileLines?.exemptFilePatterns
        ),
      },
    },
    growth: {
      ...(seed.growth ?? {}),
      ...(current.growth ?? {}),
      autoApply: {
        ...(seed.growth?.autoApply ?? {}),
        ...(current.growth?.autoApply ?? {}),
        safeTypes: mergeStringLists(seed.growth?.autoApply?.safeTypes, current.growth?.autoApply?.safeTypes),
      },
      scopes: mergeStringLists(seed.growth?.scopes, current.growth?.scopes),
      supportedCandidateTypes: mergeStringLists(seed.growth?.supportedCandidateTypes, current.growth?.supportedCandidateTypes),
    },
    externalReferences: {
      ...(seed.externalReferences ?? {}),
      ...(current.externalReferences ?? {}),
      paths: mergeStringLists(seed.externalReferences?.paths, current.externalReferences?.paths),
    },
    qualityGates: {
      ...(seed.qualityGates ?? {}),
      ...(current.qualityGates ?? {}),
    },
  };

  const currentText = await readText(targetPath).catch(() => null);
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  if (currentText !== nextText) {
    await writeText(targetPath, nextText);
    changes.push({ path: cjoin('.openprd', 'standards', 'config.json'), status: 'updated' });
  } else {
    changes.push({ path: cjoin('.openprd', 'standards', 'config.json'), status: 'unchanged' });
  }
}

function extractMarkdownSection(text, heading) {
  const start = text.indexOf(heading);
  if (start < 0) {
    return '';
  }
  const rest = text.slice(start);
  const nextHeading = rest.slice(heading.length).search(/\n##\s+/);
  if (nextHeading < 0) {
    return rest.trim();
  }
  return rest.slice(0, heading.length + nextHeading).trim();
}

async function ensureActiveFileContains(projectRoot, relativePath, requiredToken, seedFallback, changes) {
  const targetPath = cjoin(projectRoot, '.openprd', relativePath);
  const current = await readText(targetPath).catch(() => null);
  if (current?.includes(requiredToken)) {
    changes.push({ path: cjoin('.openprd', relativePath), status: 'unchanged' });
    return;
  }
  const next = current
    ? `${current.trimEnd()}\n\n---\n\n${seedFallback.trim()}\n`
    : `${seedFallback.trim()}\n`;
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.openprd', relativePath), status: current === null ? 'created' : 'updated-append' });
}

async function ensureHeadingFile(projectRoot, relativePath, heading, fallbackBody, changes) {
  const targetPath = cjoin(projectRoot, '.openprd', relativePath);
  const current = await readText(targetPath).catch(() => null);
  if (current?.includes(heading)) {
    changes.push({ path: cjoin('.openprd', relativePath), status: 'unchanged' });
    return;
  }
  const next = current
    ? `${heading}\n\n${current.trim()}\n`
    : fallbackBody;
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.openprd', relativePath), status: current === null ? 'created' : 'updated-prepend' });
}

async function migrateWorkspaceSkeleton(projectRoot, options = {}) {
  const changes = [];
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state', 'versions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'sessions'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'exports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'artifacts', 'active'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'artifacts', 'archive'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'learning', 'archive'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'quality', 'reports'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'lenses'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'themes'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'layouts'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'components'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'recipes'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'checklists'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'assets'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'templates'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'design', 'active'), { recursive: true });
  for (const [filename, content] of Object.entries(ACTIVE_DESIGN_TEMPLATE_FILES)) {
    const targetPath = cjoin(workspaceRoot, 'design', 'active', filename);
    if (!(await exists(targetPath))) {
      await writeText(targetPath, content);
      changes.push({ path: cjoin('.openprd', 'design', 'active', filename), status: 'created' });
    }
  }
  await fs.mkdir(cjoin(workspaceRoot, 'growth'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'incidents'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'patterns'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'skills'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'candidates'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'knowledge', 'drafts'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'benchmarks', 'inbox'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'benchmarks', 'evidence'), { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'engagements', 'active'), { recursive: true });

  const legacyOpenPrdMigration = await migrateLegacyOpenPrdArtifacts(projectRoot);
  changes.push(...legacyOpenPrdMigration.changes.map((change) => ({
    ...change,
    source: 'legacy-openprd-artifacts',
  })));

  await migrateWorkspaceConfig(projectRoot, changes);
  await migrateStandardsConfig(projectRoot, changes);
  for (const relativePath of WORKSPACE_SEED_REFRESH_FILES) {
    await copySeedFileIfChanged(projectRoot, relativePath, changes);
  }

  const seedIntake = await readText(cjoin(SEED_WORKSPACE, 'engagements', 'active', 'intake.md'));
  const seedPrd = await readText(cjoin(SEED_WORKSPACE, 'engagements', 'active', 'prd.md'));
  const typeSpecificBlock = extractMarkdownSection(seedPrd, '## 类型专项模块') || seedPrd;
  await ensureActiveFileContains(projectRoot, 'engagements/active/intake.md', '我们要解决什么问题？', seedIntake, changes);
  await ensureActiveFileContains(projectRoot, 'engagements/active/prd.md', '类型专项模块', typeSpecificBlock, changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/flows.md', '# 流程', '# 流程\n\n- 已初始化 OpenPrd 流程说明。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/roles.md', '# 角色', '# 角色\n\n- 已初始化 OpenPrd 角色说明。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/handoff.md', '# 交接', '# 交接\n\n- 已初始化 OpenPrd 交接摘要。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/decision-log.md', '# 决策记录', '# 决策记录\n\n- 已初始化 OpenPrd 决策跟踪。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/open-questions.md', '# 开放问题', '# 开放问题\n\n- 已初始化 OpenPrd 问题跟踪。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/progress.md', '# 进度', '# 进度\n\n- 已初始化 OpenPrd 进度跟踪。\n', changes);
  await ensureHeadingFile(projectRoot, 'engagements/active/verification.md', '# 验证', '# 验证\n\n- 已初始化 OpenPrd 验证跟踪。\n', changes);
  await normalizeWorkspaceMarkdownTimestamps(projectRoot, changes);

  const ws = await loadWorkspace(projectRoot);
  const taskGraphPath = cjoin(projectRoot, '.openprd', 'state', 'task-graph.json');
  const currentTaskGraph = await readText(taskGraphPath).catch(() => null);
  let shouldRewriteTaskGraph = currentTaskGraph === null;
  if (currentTaskGraph !== null) {
    try {
      const parsed = JSON.parse(currentTaskGraph);
      shouldRewriteTaskGraph = !Array.isArray(parsed.workflow) || !Array.isArray(parsed.nodes);
    } catch {
      shouldRewriteTaskGraph = true;
    }
  }
  if (shouldRewriteTaskGraph) {
    await writeJson(taskGraphPath, buildWorkflowTaskGraph(ws.data.currentState));
    changes.push({ path: cjoin('.openprd', 'state', 'task-graph.json'), status: currentTaskGraph === null ? 'created' : 'updated' });
  } else {
    changes.push({ path: cjoin('.openprd', 'state', 'task-graph.json'), status: 'unchanged' });
  }
  if (!(await exists(cjoin(projectRoot, '.openprd', 'state', 'events.jsonl')))) {
    await writeText(cjoin(projectRoot, '.openprd', 'state', 'events.jsonl'), '');
    changes.push({ path: cjoin('.openprd', 'state', 'events.jsonl'), status: 'created' });
  }
  if (!(await exists(cjoin(projectRoot, '.openprd', 'benchmarks', 'sources.yaml')))) {
    await writeText(cjoin(projectRoot, '.openprd', 'benchmarks', 'sources.yaml'), 'version: 1\nschema: openprd.benchmarks.v1\nsources: []\n');
    changes.push({ path: cjoin('.openprd', 'benchmarks', 'sources.yaml'), status: 'created' });
  }
  if (!(await exists(cjoin(projectRoot, '.openprd', 'benchmarks', 'index.md')))) {
    await writeText(cjoin(projectRoot, '.openprd', 'benchmarks', 'index.md'), '# OpenPrd Benchmark Registry\n\n## 规则\n\n- 项目级 approved benchmark 优先于 OpenPrd 内置 Source Map。\n- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。\n- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。\n\n## Approved Sources\n\n- 暂无已批准来源。\n\n## Candidate Sources\n\n- 暂无待确认来源。\n');
    changes.push({ path: cjoin('.openprd', 'benchmarks', 'index.md'), status: 'created' });
  }
  await ensureOperationalGitignore(projectRoot, changes);

  const changedCount = changes.filter((change) => change.status !== 'unchanged').length;
  if (options.recordEvent && changedCount > 0) {
    const nextWs = await loadWorkspace(projectRoot);
    await appendWorkflowEvent(nextWs, 'workspace_migrated', {
      changed: changedCount,
      legacyOpenPrdArtifacts: {
        migrated: legacyOpenPrdMigration.migrated,
        conflicts: legacyOpenPrdMigration.conflicts,
      },
    });
  }

  return {
    ok: legacyOpenPrdMigration.ok,
    action: 'migrate',
    projectRoot,
    workspaceRoot,
    changes,
    legacyOpenPrdMigration,
    errors: legacyOpenPrdMigration.errors,
  };
}

async function loadWorkspace(projectRoot, options = {}) {
  const workspaceRoot = cjoin(projectRoot, '.openprd');
  const paths = {
    workspaceRoot,
    config: cjoin(workspaceRoot, 'config.yaml'),
    schema: cjoin(workspaceRoot, 'schema', 'prd.schema.yaml'),
    diagramArchitectureSchema: cjoin(workspaceRoot, 'schema', 'diagram-architecture.schema.yaml'),
    diagramProductFlowSchema: cjoin(workspaceRoot, 'schema', 'diagram-product-flow.schema.yaml'),
    manifest: cjoin(workspaceRoot, 'templates', 'manifest.yaml'),
    basePrd: cjoin(workspaceRoot, 'templates', 'base', 'prd.md'),
    baseIntake: cjoin(workspaceRoot, 'templates', 'base', 'intake.md'),
    diagramArchitectureTemplate: cjoin(workspaceRoot, 'templates', 'diagram', 'architecture.contract.json'),
    diagramProductFlowTemplate: cjoin(workspaceRoot, 'templates', 'diagram', 'product-flow.contract.json'),
    consumerPrd: cjoin(workspaceRoot, 'templates', 'consumer', 'prd.md'),
    consumerIntake: cjoin(workspaceRoot, 'templates', 'consumer', 'intake.md'),
    b2bPrd: cjoin(workspaceRoot, 'templates', 'b2b', 'prd.md'),
    b2bIntake: cjoin(workspaceRoot, 'templates', 'b2b', 'intake.md'),
    agentPrd: cjoin(workspaceRoot, 'templates', 'agent', 'prd.md'),
    agentIntake: cjoin(workspaceRoot, 'templates', 'agent', 'intake.md'),
    activeIntake: cjoin(workspaceRoot, 'engagements', 'active', 'intake.md'),
    activePrd: cjoin(workspaceRoot, 'engagements', 'active', 'prd.md'),
    activeFlows: cjoin(workspaceRoot, 'engagements', 'active', 'flows.md'),
    activeRoles: cjoin(workspaceRoot, 'engagements', 'active', 'roles.md'),
    activeHandoff: cjoin(workspaceRoot, 'engagements', 'active', 'handoff.md'),
    activeBrainstormHtml: cjoin(workspaceRoot, 'engagements', 'active', 'brainstorm.html'),
    activeBrainstormState: cjoin(workspaceRoot, 'engagements', 'active', 'brainstorm.json'),
    activeReviewHtml: cjoin(workspaceRoot, 'engagements', 'active', 'review.html'),
    reviewsDir: cjoin(workspaceRoot, 'reviews'),
    artifactsActiveDir: cjoin(workspaceRoot, 'artifacts', 'active'),
    artifactsArchiveDir: cjoin(workspaceRoot, 'artifacts', 'archive'),
    learningDir: cjoin(workspaceRoot, 'learning'),
    learningArchiveDir: cjoin(workspaceRoot, 'learning', 'archive'),
    learningIndex: cjoin(workspaceRoot, 'learning', 'index.json'),
    learningCurrent: cjoin(workspaceRoot, 'learning', 'current.json'),
    qualityDir: cjoin(workspaceRoot, 'quality'),
    qualityConfig: cjoin(workspaceRoot, 'quality', 'config.json'),
    qualityReportsDir: cjoin(workspaceRoot, 'quality', 'reports'),
    qualityReportIndex: cjoin(workspaceRoot, 'quality', 'reports', 'index.json'),
    qualityReportLatest: cjoin(workspaceRoot, 'quality', 'reports', 'latest.json'),
    designRoot: cjoin(workspaceRoot, 'design'),
    designReadme: cjoin(workspaceRoot, 'design', 'README.md'),
    designLenses: cjoin(workspaceRoot, 'design', 'lenses', 'frontend-lenses.md'),
    designThemes: cjoin(workspaceRoot, 'design', 'themes', 'theme-catalog.json'),
    designLayouts: cjoin(workspaceRoot, 'design', 'layouts', 'layout-catalog.json'),
    designComponents: cjoin(workspaceRoot, 'design', 'components', 'component-catalog.md'),
    designChecklist: cjoin(workspaceRoot, 'design', 'checklists', 'ui-quality-gate.md'),
    designAntiSlop: cjoin(workspaceRoot, 'design', 'anti-slop.md'),
    designTemplatesRoot: cjoin(workspaceRoot, 'design', 'templates'),
    designTemplatesReadme: cjoin(workspaceRoot, 'design', 'templates', 'README.md'),
    designContentHomeTemplate: cjoin(workspaceRoot, 'design', 'templates', 'content-home.html'),
    designProductLaunchTemplate: cjoin(workspaceRoot, 'design', 'templates', 'product-launch.html'),
    designOpsDashboardTemplate: cjoin(workspaceRoot, 'design', 'templates', 'ops-dashboard.html'),
    designFactsSheet: cjoin(workspaceRoot, 'design', 'active', 'facts-sheet.md'),
    designAssetSpec: cjoin(workspaceRoot, 'design', 'active', 'asset-spec.md'),
    designImagePreflight: cjoin(workspaceRoot, 'design', 'active', 'image-preflight.md'),
    designDirectionPlan: cjoin(workspaceRoot, 'design', 'active', 'direction-plan.md'),
    designSelectedDirection: cjoin(workspaceRoot, 'design', 'active', 'selected-direction.md'),
    growthDir: cjoin(workspaceRoot, 'growth'),
    growthCandidates: cjoin(workspaceRoot, 'growth', 'candidates.jsonl'),
    growthAccepted: cjoin(workspaceRoot, 'growth', 'accepted.json'),
    growthRejected: cjoin(workspaceRoot, 'growth', 'rejected.json'),
    growthLocalPreferences: cjoin(workspaceRoot, 'growth', 'preferences.local.json'),
    knowledgeDir: cjoin(workspaceRoot, 'knowledge'),
    knowledgeIndex: cjoin(workspaceRoot, 'knowledge', 'index.json'),
    benchmarkDir: cjoin(workspaceRoot, 'benchmarks'),
    benchmarkInboxDir: cjoin(workspaceRoot, 'benchmarks', 'inbox'),
    benchmarkEvidenceDir: cjoin(workspaceRoot, 'benchmarks', 'evidence'),
    benchmarkSources: cjoin(workspaceRoot, 'benchmarks', 'sources.yaml'),
    benchmarkIndex: cjoin(workspaceRoot, 'benchmarks', 'index.md'),
    activeArchitectureDiagramHtml: cjoin(workspaceRoot, 'engagements', 'active', 'architecture-diagram.html'),
    activeArchitectureDiagramJson: cjoin(workspaceRoot, 'engagements', 'active', 'architecture-diagram.json'),
    activeArchitectureDiagramMermaid: cjoin(workspaceRoot, 'engagements', 'active', 'architecture-diagram.mmd'),
    activeProductFlowDiagramHtml: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.html'),
    activeProductFlowDiagramJson: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.json'),
    activeProductFlowDiagramMermaid: cjoin(workspaceRoot, 'engagements', 'active', 'product-flow-diagram.mmd'),
    decisionLog: cjoin(workspaceRoot, 'engagements', 'active', 'decision-log.md'),
    openQuestionsLog: cjoin(workspaceRoot, 'engagements', 'active', 'open-questions.md'),
    progressLog: cjoin(workspaceRoot, 'engagements', 'active', 'progress.md'),
    verificationLog: cjoin(workspaceRoot, 'engagements', 'active', 'verification.md'),
    stateDir: cjoin(workspaceRoot, 'state'),
    versionsDir: cjoin(workspaceRoot, 'state', 'versions'),
    versionIndex: cjoin(workspaceRoot, 'state', 'version-index.json'),
    releaseLedger: cjoin(workspaceRoot, 'state', 'release-ledger.json'),
    currentState: cjoin(workspaceRoot, 'state', 'current.json'),
    workspaceCurrentState: cjoin(workspaceRoot, 'state', 'current.json'),
    sessionStatesDir: cjoin(workspaceRoot, 'harness', 'session-states'),
    sessionBindingsDir: cjoin(workspaceRoot, 'harness', 'session-bindings'),
    requirementGate: cjoin(workspaceRoot, 'harness', 'requirement-gate.json'),
    requirementGatesDir: cjoin(workspaceRoot, 'harness', 'requirement-gates'),
    freezeState: cjoin(workspaceRoot, 'state', 'freeze.json'),
    taskGraph: cjoin(workspaceRoot, 'state', 'task-graph.json'),
    eventsLog: cjoin(workspaceRoot, 'state', 'events.jsonl'),
    standardsConfig: cjoin(workspaceRoot, 'standards', 'config.json'),
    standardsFileManualTemplate: cjoin(workspaceRoot, 'standards', 'file-manual-template.md'),
    standardsFolderReadmeTemplate: cjoin(workspaceRoot, 'standards', 'folder-readme-template.md'),
    exportsDir: cjoin(workspaceRoot, 'exports'),
    openprdExportDir: cjoin(workspaceRoot, 'exports', 'openprd'),
    openprdHandoffJson: cjoin(workspaceRoot, 'exports', 'openprd', 'handoff.json'),
    openprdHandoffMd: cjoin(workspaceRoot, 'exports', 'openprd', 'handoff.md'),
  };

  const workspaceCurrentState = await readJson(paths.workspaceCurrentState).catch(() => null);
  const lane = await readActiveRequirementLane(projectRoot, workspaceCurrentState, { sessionId: options.sessionId });
  if (lane.currentStatePath) {
    paths.sessionCurrentState = lane.currentStatePath;
  }

  const data = {
    config: await readYaml(paths.config).catch(() => null),
    schema: await readYaml(paths.schema).catch(() => null),
    diagramArchitectureSchema: await readYaml(paths.diagramArchitectureSchema).catch(() => null),
    diagramProductFlowSchema: await readYaml(paths.diagramProductFlowSchema).catch(() => null),
    manifest: await readYaml(paths.manifest).catch(() => null),
    currentState: lane.sessionId ? (lane.sessionState ?? {}) : workspaceCurrentState,
    workspaceCurrentState,
    currentSessionId: lane.sessionId,
    currentStateScope: lane.scope,
    sessionBinding: lane.binding,
    activeRequirementGate: lane.gate,
    freezeState: await readJson(paths.freezeState).catch(() => null),
    versionIndex: await readJson(paths.versionIndex).catch(() => []),
    releaseLedger: normalizeReleaseLedger(await readJson(paths.releaseLedger).catch(() => null)),
    learningIndex: await readJson(paths.learningIndex).catch(() => null),
    learningCurrent: await readJson(paths.learningCurrent).catch(() => null),
  };

  return { projectRoot, workspaceRoot, paths, data };
}

function isSupportedProductType(value) {
  return REQUIRED_PRODUCT_TYPES.includes(value);
}

function resolveActiveTemplatePack(ws) {
  return ws.data.currentState?.templatePack ?? ws.data.config?.activeTemplatePack ?? 'base';
}

function resolveCurrentProductType(ws) {
  return ws.data.currentState?.productType ?? null;
}

const USER_CLARIFICATION_PATHS = new Set([
  'meta.productType',
  'problem.problemStatement',
  'problem.whyNow',
  'users.primaryUsers',
  'validation.community',
  'validation.seedUsers',
  'validation.communityFit',
  'validation.currentAlternative',
  'validation.painEvidence',
  'validation.manualPath',
  'validation.manualPlaybook',
  'validation.commitmentSignals',
  'validation.firstValidationStep',
  'validation.defaultAlivePlan',
  'validation.paymentProof',
  'validation.mvpSlice',
  'validation.weekendTest',
  'validation.smallestExecution',
  'validation.productizeGate',
  'validation.firstCustomerPath',
  'validation.pricingHypothesis',
  'validation.customerOneProfitability',
  'validation.growthDiscipline',
  'validation.reversibility',
  'validation.customerTruth',
  'validation.valuesFit',
  'goals.goals',
  'goals.successMetrics',
  'scope.inScope',
  'scope.outOfScope',
  'scenarios.primaryFlows',
  'requirements.functional',
  'businessGuardrails.costDrivers',
  'businessGuardrails.usageLimits',
  'businessGuardrails.abusePrevention',
  'businessGuardrails.monitoringSignals',
  'businessGuardrails.alertThresholds',
  'businessGuardrails.stopLossActions',
  'risks.openQuestions',
  'handoff.owner',
  'handoff.nextStep',
  'handoff.targetSystem',
  'typeSpecific.fields.humanAgentContract',
  'typeSpecific.fields.autonomyBoundary',
  'typeSpecific.fields.toolBoundary',
  'typeSpecific.fields.evalPlan',
  'typeSpecific.fields.persona',
  'typeSpecific.fields.journey',
  'typeSpecific.fields.roles',
  'typeSpecific.fields.asIs',
  'typeSpecific.fields.toBe',
]);

const FIELD_PATH_TO_STATE_KEY = {
  'meta.title': 'title',
  'meta.owner': 'owner',
  'meta.status': 'status',
  'meta.version': 'versionLabel',
  'meta.productType': 'productType',
  reviewPresentation: 'reviewPresentation',
  'problem.problemStatement': 'problemStatement',
  'problem.whyNow': 'whyNow',
  'problem.evidence': 'evidence',
  'users.primaryUsers': 'primaryUsers',
  'users.secondaryUsers': 'secondaryUsers',
  'users.stakeholders': 'stakeholders',
  'validation.community': 'community',
  'validation.seedUsers': 'seedUsers',
  'validation.communityFit': 'communityFit',
  'validation.currentAlternative': 'currentAlternative',
  'validation.painEvidence': 'painEvidence',
  'validation.manualPath': 'manualPath',
  'validation.manualPlaybook': 'manualPlaybook',
  'validation.commitmentSignals': 'commitmentSignals',
  'validation.firstValidationStep': 'firstValidationStep',
  'validation.defaultAlivePlan': 'defaultAlivePlan',
  'validation.paymentProof': 'paymentProof',
  'validation.mvpSlice': 'mvpSlice',
  'validation.weekendTest': 'weekendTest',
  'validation.smallestExecution': 'smallestExecution',
  'validation.productizeGate': 'productizeGate',
  'validation.firstCustomerPath': 'firstCustomerPath',
  'validation.pricingHypothesis': 'pricingHypothesis',
  'validation.customerOneProfitability': 'customerOneProfitability',
  'validation.growthDiscipline': 'growthDiscipline',
  'validation.reversibility': 'reversibility',
  'validation.customerTruth': 'customerTruth',
  'validation.valuesFit': 'valuesFit',
  'goals.goals': 'goals',
  'goals.successMetrics': 'successMetrics',
  'goals.acceptanceGoals': 'acceptanceGoals',
  'scope.inScope': 'inScope',
  'scope.outOfScope': 'outOfScope',
  'scenarios.primaryFlows': 'primaryFlows',
  'scenarios.edgeCases': 'edgeCases',
  'scenarios.failureModes': 'failureModes',
  'requirements.functional': 'functional',
  'requirements.nonFunctional': 'nonFunctional',
  'requirements.businessRules': 'businessRules',
  'businessGuardrails.costDrivers': 'costDrivers',
  'businessGuardrails.usageLimits': 'usageLimits',
  'businessGuardrails.abusePrevention': 'abusePrevention',
  'businessGuardrails.monitoringSignals': 'monitoringSignals',
  'businessGuardrails.alertThresholds': 'alertThresholds',
  'businessGuardrails.stopLossActions': 'stopLossActions',
  'constraints.technical': 'technical',
  'constraints.compliance': 'compliance',
  'constraints.dependencies': 'dependencies',
  'risks.assumptions': 'assumptions',
  'risks.risks': 'risks',
  'risks.openQuestions': 'openQuestions',
  'handoff.owner': 'handoffOwner',
  'handoff.nextStep': 'nextStep',
  'handoff.targetSystem': 'targetSystem',
  'typeSpecific.fields.persona': 'persona',
  'typeSpecific.fields.segment': 'segment',
  'typeSpecific.fields.journey': 'journey',
  'typeSpecific.fields.activationMetric': 'activationMetric',
  'typeSpecific.fields.retentionMetric': 'retentionMetric',
  'typeSpecific.fields.buyer': 'buyer',
  'typeSpecific.fields.user': 'user',
  'typeSpecific.fields.admin': 'admin',
  'typeSpecific.fields.operator': 'operator',
  'typeSpecific.fields.roles': 'roles',
  'typeSpecific.fields.asIs': 'asIs',
  'typeSpecific.fields.toBe': 'toBe',
  'typeSpecific.fields.permissionMatrix': 'permissionMatrix',
  'typeSpecific.fields.approvalFlow': 'approvalFlow',
  'typeSpecific.fields.humanAgentContract': 'humanAgentContract',
  'typeSpecific.fields.autonomyBoundary': 'autonomyBoundary',
  'typeSpecific.fields.toolBoundary': 'toolBoundary',
  'typeSpecific.fields.stateModel': 'stateModel',
  'typeSpecific.fields.evalPlan': 'evalPlan',
};

const NON_SEMANTIC_CAPTURE_SOURCES = new Set(['agent-normalized']);
const CAPTURE_SOURCES = ['user-confirmed', 'project-derived', 'agent-inferred', 'agent-normalized'];

function captureSourceRequiresUserConfirmation(source) {
  return Boolean(source) && source !== 'user-confirmed' && !NON_SEMANTIC_CAPTURE_SOURCES.has(source);
}

function listMissing(actual, expected) {
  const actualSet = new Set(actual);
  return expected.filter((item) => !actualSet.has(item));
}

async function validateWorkspace(projectRoot, options = {}) {
  const report = {
    valid: true,
    errors: [],
    warnings: [],
    checks: [],
  };

  const ws = await loadWorkspace(projectRoot);

  if (!(await exists(ws.workspaceRoot))) {
    report.valid = false;
    report.errors.push(`Missing workspace: ${ws.workspaceRoot}`);
    return { report, ws };
  }

  const requiredFiles = [
    ws.paths.config,
    ws.paths.schema,
    ws.paths.diagramArchitectureSchema,
    ws.paths.diagramProductFlowSchema,
    ws.paths.manifest,
    ws.paths.basePrd,
    ws.paths.baseIntake,
    ws.paths.diagramArchitectureTemplate,
    ws.paths.diagramProductFlowTemplate,
    ws.paths.consumerPrd,
    ws.paths.consumerIntake,
    ws.paths.b2bPrd,
    ws.paths.b2bIntake,
    ws.paths.agentPrd,
    ws.paths.agentIntake,
    ws.paths.activeIntake,
    ws.paths.activePrd,
    ws.paths.activeFlows,
    ws.paths.activeRoles,
    ws.paths.activeHandoff,
    ws.paths.decisionLog,
    ws.paths.openQuestionsLog,
    ws.paths.progressLog,
    ws.paths.verificationLog,
    ws.paths.taskGraph,
    ws.paths.eventsLog,
    ws.paths.standardsConfig,
    ws.paths.standardsFileManualTemplate,
    ws.paths.standardsFolderReadmeTemplate,
  ];

  const missingFiles = [];
  for (const filePath of requiredFiles) {
    if (!(await exists(filePath))) {
      missingFiles.push(path.relative(ws.workspaceRoot, filePath));
    }
  }
  if (missingFiles.length > 0) {
    report.valid = false;
    report.errors.push(`Missing required files: ${missingFiles.join(', ')}`);
  }

  if (!ws.data.config) {
    report.valid = false;
    report.errors.push('Failed to parse config.yaml');
    return { report, ws };
  }

  if (!ws.data.schema) {
    report.valid = false;
    report.errors.push('Failed to parse prd.schema.yaml');
    return { report, ws };
  }

  if (!ws.data.diagramArchitectureSchema) {
    report.valid = false;
    report.errors.push('Failed to parse diagram-architecture.schema.yaml');
    return { report, ws };
  }

  if (!ws.data.diagramProductFlowSchema) {
    report.valid = false;
    report.errors.push('Failed to parse diagram-product-flow.schema.yaml');
    return { report, ws };
  }

  if (!ws.data.manifest) {
    report.valid = false;
    report.errors.push('Failed to parse templates/manifest.yaml');
    return { report, ws };
  }

  const config = ws.data.config;
  const schema = ws.data.schema;
  const manifest = ws.data.manifest;

  if (config.schema !== schema.name) {
    report.valid = false;
    report.errors.push(`config.schema (${config.schema}) must match schema.name (${schema.name})`);
  }

  const missingTypes = listMissing(config.supportedProductTypes ?? [], REQUIRED_PRODUCT_TYPES);
  if (missingTypes.length > 0) {
    report.valid = false;
    report.errors.push(`config.supportedProductTypes is missing: ${missingTypes.join(', ')}`);
  }

  const inheritance = JSON.stringify(config.templateInheritance ?? []);
  const expectedInheritance = JSON.stringify(['base', 'industry', 'company', 'project', 'session']);
  if (inheritance !== expectedInheritance) {
    report.valid = false;
    report.errors.push('config.templateInheritance must equal base -> industry -> company -> project -> session');
  }

  const sections = Object.keys(schema.sections ?? {});
  const missingSections = listMissing(sections, REQUIRED_SECTIONS);
  if (missingSections.length > 0) {
    report.valid = false;
    report.errors.push(`schema.sections is missing: ${missingSections.join(', ')}`);
  }

  const extensions = Object.keys(schema.extensions ?? {});
  const missingExtensions = listMissing(extensions, REQUIRED_PRODUCT_TYPES);
  if (missingExtensions.length > 0) {
    report.valid = false;
    report.errors.push(`schema.extensions is missing: ${missingExtensions.join(', ')}`);
  }

  const registry = manifest.registry ?? {};
  const missingRegistry = listMissing(Object.keys(registry), ['base', 'consumer', 'b2b', 'agent']);
  if (missingRegistry.length > 0) {
    report.valid = false;
    report.errors.push(`manifest.registry is missing: ${missingRegistry.join(', ')}`);
  }

  if (registry.base?.path !== 'base/prd.md') {
    report.valid = false;
    report.errors.push('manifest.registry.base.path must be base/prd.md');
  }

  for (const key of ['consumer', 'b2b', 'agent']) {
    const entry = registry[key];
    if (!entry || !Array.isArray(entry.extends) || entry.extends.length !== 1 || entry.extends[0] !== 'base') {
      report.valid = false;
      report.errors.push(`manifest.registry.${key}.extends must be ["base"]`);
    }
  }

  const basePrd = await readText(ws.paths.basePrd);
  for (const section of ['元信息', '问题', '用户与相关方', '目标与成功标准', '范围与非目标', '场景与流程', '需求', '约束、依赖与风险', '交接']) {
    if (!basePrd.includes(section)) {
      report.valid = false;
      report.errors.push(`templates/base/prd.md is missing section heading: ${section}`);
    }
  }

  const consumerPrd = await readText(ws.paths.consumerPrd);
  for (const token of ['用户画像', '用户分层', '用户旅程', '激活指标', '留存指标']) {
    if (!consumerPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/consumer/prd.md is missing field: ${token}`);
    }
  }

  const b2bPrd = await readText(ws.paths.b2bPrd);
  for (const token of ['采购方', '使用者', '管理员', '运营者', '权限矩阵', '审批流程']) {
    if (!b2bPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/b2b/prd.md is missing field: ${token}`);
    }
  }

  const agentPrd = await readText(ws.paths.agentPrd);
  for (const token of ['Human-Agent contract', '自主边界', '工具边界', '状态模型', '评估计划']) {
    if (!agentPrd.includes(token)) {
      report.valid = false;
      report.errors.push(`templates/agent/prd.md is missing field: ${token}`);
    }
  }

  const architectureTemplate = await readJson(ws.paths.diagramArchitectureTemplate).catch(() => null);
  if (!architectureTemplate || architectureTemplate.type !== 'architecture') {
    report.valid = false;
    report.errors.push('templates/diagram/architecture.contract.json is missing or invalid');
  }

  const productFlowTemplate = await readJson(ws.paths.diagramProductFlowTemplate).catch(() => null);
  if (!productFlowTemplate || productFlowTemplate.type !== 'product-flow') {
    report.valid = false;
    report.errors.push('templates/diagram/product-flow.contract.json is missing or invalid');
  }

  const activeIntake = await readText(ws.paths.activeIntake);
  if (!activeIntake.includes('我们要解决什么问题？')) {
    report.valid = false;
    report.errors.push('engagements/active/intake.md is missing the core discovery prompts');
  }

  const activePrd = await readText(ws.paths.activePrd);
  if (!activePrd.includes('类型专项模块')) {
    report.valid = false;
    report.errors.push('engagements/active/prd.md is missing the type-specific block');
  }

  const decisionLog = await readText(ws.paths.decisionLog);
  if (!decisionLog.includes('# 决策记录')) {
    report.valid = false;
    report.errors.push('engagements/active/decision-log.md is missing the decision log heading');
  }

  const openQuestionsLog = await readText(ws.paths.openQuestionsLog);
  if (!openQuestionsLog.includes('# 开放问题')) {
    report.valid = false;
    report.errors.push('engagements/active/open-questions.md is missing the open questions heading');
  }

  const progressLog = await readText(ws.paths.progressLog);
  if (!progressLog.includes('# 进度')) {
    report.valid = false;
    report.errors.push('engagements/active/progress.md is missing the progress heading');
  }

  const verificationLog = await readText(ws.paths.verificationLog);
  if (!verificationLog.includes('# 验证')) {
    report.valid = false;
    report.errors.push('engagements/active/verification.md is missing the verification heading');
  }

  const taskGraph = await readJson(ws.paths.taskGraph).catch(() => null);
  if (!taskGraph || !Array.isArray(taskGraph.nodes) || !Array.isArray(taskGraph.edges) || !Array.isArray(taskGraph.workflow) || !Array.isArray(taskGraph.artifacts) || typeof taskGraph.nextReadyNode !== 'string') {
    report.valid = false;
    report.errors.push('state/task-graph.json is missing a valid graph structure');
  }

  const eventsLog = await readText(ws.paths.eventsLog);
  if (typeof eventsLog !== 'string') {
    report.valid = false;
    report.errors.push('state/events.jsonl is missing');
  }

  const standards = await checkStandardsWorkspace(projectRoot, {
    optional: true,
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  });
  if (!standards.skipped) {
    if (standards.errors.length > 0) {
      report.valid = false;
    }
    report.errors.push(...standards.errors);
    report.warnings.push(...standards.warnings);
    report.checks.push(...standards.checks.map((check) => ({ name: `standards: ${check}`, ok: standards.ok })));
  }

  if (ws.data.currentState && ws.data.currentState.templatePack && !['base', 'consumer', 'b2b', 'agent'].includes(ws.data.currentState.templatePack)) {
    report.warnings.push(`state/current.json has unknown templatePack: ${ws.data.currentState.templatePack}`);
  }

  if (ws.data.currentState && ws.data.currentState.productType && !isSupportedProductType(ws.data.currentState.productType)) {
    report.valid = false;
    report.errors.push(`state/current.json has unknown productType: ${ws.data.currentState.productType}`);
  }

  const prdVersion = Number(ws.data.currentState?.prdVersion ?? 0);
  const versionIndex = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
  if (prdVersion > 0 && versionIndex.length === 0) {
    report.valid = false;
    report.errors.push('state/current.json indicates a synthesized PRD, but no version history exists');
  }
  if (versionIndex.length > 0) {
    const latest = versionIndex[versionIndex.length - 1];
    if (prdVersion > 0 && Number(latest.versionNumber) !== prdVersion) {
      report.warnings.push(`PRD version history latest (${latest.versionId}) does not match current prdVersion (${prdVersion})`);
    }
  }

  const releaseLedger = ws.data.releaseLedger ?? normalizeReleaseLedger(null);
  const currentRelease = releaseLedger.currentVersion
    ? releaseLedger.versions.find((entry) => entry.version === releaseLedger.currentVersion) ?? null
    : null;
  if (releaseLedger.enabled && !releaseLedger.currentVersion) {
    report.warnings.push('state/release-ledger.json 已启用，但还没有设置当前项目版本号');
  }
  if (releaseLedger.currentVersion && !currentRelease) {
    report.valid = false;
    report.errors.push(`state/release-ledger.json 当前版本 ${releaseLedger.currentVersion} 缺少对应条目`);
  }

  report.checks.push({ name: 'workspace', ok: true });
  report.checks.push({ name: 'schema', ok: true });
  report.checks.push({ name: 'manifest', ok: true });

  return { report, ws };
}

async function computeWorkspaceDigest(ws) {
  const hash = crypto.createHash('sha256');
  for (const rel of CORE_TEMPLATE_FILES) {
    const abs = cjoin(ws.workspaceRoot, rel);
    if (await exists(abs)) {
      hash.update(rel);
      hash.update('\n');
      hash.update(await readText(abs));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}


function sortVersionIndex(index) {
  return [...index].sort((a, b) => Number(a.versionNumber) - Number(b.versionNumber));
}

async function readVersionIndex(ws) {
  if (await exists(ws.paths.versionIndex)) {
    const diskIndex = await readJson(ws.paths.versionIndex).catch(() => []);
    return sortVersionIndex(Array.isArray(diskIndex) ? diskIndex : []);
  }

  const index = Array.isArray(ws.data.versionIndex) ? ws.data.versionIndex : [];
  return sortVersionIndex(index);
}

async function writeVersionIndex(ws, index) {
  await writeJson(ws.paths.versionIndex, sortVersionIndex(index));
}

function normalizeVersionId(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = `${value}`.trim();
  if (!text) {
    return null;
  }

  if (/^v\d+$/i.test(text)) {
    return text.toLowerCase();
  }

  if (/^\d+$/.test(text)) {
    return formatVersionId(Number(text));
  }

  return text;
}

function coerceCapturedValue(pathString, rawValue, append = false) {
  if (rawValue === null || rawValue === undefined) {
    return rawValue;
  }

  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === 'object') {
    return rawValue;
  }

  const text = `${rawValue}`.trim();
  if (text === '') {
    return rawValue;
  }

  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through
    }
  }

  const expectsArray = [
    'problem.evidence',
    'users.primaryUsers',
    'users.secondaryUsers',
    'users.stakeholders',
    'validation.community',
    'validation.seedUsers',
    'validation.communityFit',
    'validation.painEvidence',
    'validation.manualPath',
    'validation.manualPlaybook',
    'validation.commitmentSignals',
    'validation.defaultAlivePlan',
    'validation.paymentProof',
    'validation.smallestExecution',
    'validation.productizeGate',
    'validation.firstCustomerPath',
    'validation.growthDiscipline',
    'goals.goals',
    'goals.successMetrics',
    'goals.acceptanceGoals',
    'scope.inScope',
    'scope.outOfScope',
    'scenarios.primaryFlows',
    'scenarios.edgeCases',
    'scenarios.failureModes',
    'requirements.functional',
    'requirements.nonFunctional',
    'requirements.businessRules',
    'businessGuardrails.costDrivers',
    'businessGuardrails.usageLimits',
    'businessGuardrails.abusePrevention',
    'businessGuardrails.monitoringSignals',
    'businessGuardrails.alertThresholds',
    'businessGuardrails.stopLossActions',
    'constraints.technical',
    'constraints.compliance',
    'constraints.dependencies',
    'risks.assumptions',
    'risks.risks',
    'risks.openQuestions',
  ].includes(pathString);

  if (expectsArray || append) {
    return text.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean);
  }

  return text;
}

function normalizeScenarioRelativePath(relativePath) {
  return String(relativePath ?? '').replaceAll('\\', '/');
}

async function readScenarioManagedPaths(projectRoot) {
  const manifestPath = path.join(projectRoot, OPENPRD_INSTALL_MANIFEST_PATH);
  const manifest = await readJson(manifestPath).catch(() => null);
  const managedPaths = new Set();
  for (const entry of manifest?.managedFiles ?? []) {
    if (typeof entry?.path !== 'string') {
      continue;
    }
    const normalized = normalizeScenarioRelativePath(entry.path.trim());
    if (normalized) {
      managedPaths.add(normalized);
    }
  }
  return managedPaths;
}

async function listScenarioDirectoryFiles(projectRoot, relativeDir) {
  const normalizedDir = normalizeScenarioRelativePath(relativeDir);
  const absoluteDir = path.join(projectRoot, normalizedDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (entry.name === '.DS_Store') {
      continue;
    }
    const childRelative = normalizeScenarioRelativePath(path.posix.join(normalizedDir, entry.name));
    if (entry.isDirectory()) {
      files.push(...await listScenarioDirectoryFiles(projectRoot, childRelative));
      continue;
    }
    files.push(childRelative);
  }
  return files;
}

async function directoryContainsOnlyManagedBootstrap(projectRoot, relativeDir, managedPaths) {
  const files = await listScenarioDirectoryFiles(projectRoot, relativeDir);
  return files.length > 0 && files.every((file) => managedPaths.has(file));
}

async function docsDirectoryIsOpenPrdBootstrap(projectRoot) {
  const docsRoot = path.join(projectRoot, 'docs');
  const docsEntries = await fs.readdir(docsRoot, { withFileTypes: true }).catch(() => null);
  if (!docsEntries) {
    return false;
  }

  const visibleDocsEntries = docsEntries.filter((entry) => entry.name !== '.DS_Store');
  if (visibleDocsEntries.length !== 1 || visibleDocsEntries[0].name !== 'basic' || !visibleDocsEntries[0].isDirectory()) {
    return false;
  }

  const basicRoot = path.join(docsRoot, 'basic');
  const basicEntries = await fs.readdir(basicRoot, { withFileTypes: true }).catch(() => null);
  if (!basicEntries) {
    return false;
  }

  const visibleBasicEntries = basicEntries.filter((entry) => entry.name !== '.DS_Store');
  if (visibleBasicEntries.length !== STANDARD_DOCS.length || visibleBasicEntries.some((entry) => !entry.isFile())) {
    return false;
  }

  const expectedDocs = new Map(STANDARD_DOCS.map((doc) => [doc.fileName, doc.body.trim()]));
  for (const entry of visibleBasicEntries) {
    const expectedBody = expectedDocs.get(entry.name);
    if (!expectedBody) {
      return false;
    }
    const actualBody = await readText(path.join(basicRoot, entry.name)).catch(() => null);
    if (actualBody?.trim() !== expectedBody) {
      return false;
    }
  }

  return true;
}

async function shouldIgnoreWorkspaceScenarioEntry(projectRoot, entry, managedPaths) {
  if (WORKSPACE_SCENARIO_IGNORED_ENTRIES.has(entry.name)) {
    return true;
  }

  if (entry.isFile() && entry.name === '.gitignore') {
    const content = await readText(path.join(projectRoot, entry.name)).catch(() => null);
    return gitignoreContainsOnlyOpenPrdOperationalEntries(content);
  }

  if (entry.isFile() && WORKSPACE_SCENARIO_BOOTSTRAP_FILE_MARKERS.has(entry.name)) {
    const marker = WORKSPACE_SCENARIO_BOOTSTRAP_FILE_MARKERS.get(entry.name);
    const content = await readText(path.join(projectRoot, entry.name)).catch(() => null);
    return Boolean(content?.includes(marker));
  }

  if (!entry.isDirectory()) {
    return false;
  }

  if (entry.name === 'docs') {
    return docsDirectoryIsOpenPrdBootstrap(projectRoot);
  }

  if (['.codex', '.claude', '.cursor'].includes(entry.name)) {
    return directoryContainsOnlyManagedBootstrap(projectRoot, entry.name, managedPaths);
  }

  return false;
}

async function detectWorkspaceScenario(projectRoot, ws, versionIndex = []) {
  const currentStatus = ws.data.currentState?.status ?? 'unknown';
  if (versionIndex.length > 0 || ['synthesized', 'frozen', 'handed_off'].includes(currentStatus)) {
    return {
      id: 'continuing-workspace',
      label: '继续已有工作区',
      userParticipation: '定向确认',
      reason: '该工作区已有合成结果或历史记录，只需要补充确认增量信息。',
    };
  }

  const entries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const managedPaths = await readScenarioManagedPaths(projectRoot);
  const meaningfulEntries = [];
  for (const entry of entries) {
    if (await shouldIgnoreWorkspaceScenarioEntry(projectRoot, entry, managedPaths)) {
      continue;
    }
    meaningfulEntries.push(entry);
  }

  if (meaningfulEntries.length === 0) {
    return {
      id: 'cold-start-greenfield',
      label: '冷启动（全新项目）',
      userParticipation: '高协作',
      reason: '项目根目录基本为空，需要 Agent 与用户共同梳理初始需求形态。',
    };
  }

  return {
    id: 'cold-start-existing-project',
    label: '冷启动（已有项目）',
    userParticipation: '上下文复用加确认',
    reason: '项目已经包含资料，但 OpenPrd 工作区是新的，需要复用既有上下文并向用户确认。',
  };
}

function buildClarificationState({ snapshot, analysis, basePlan, scenario, captureMeta, prdReviewState = null, limit = 8 }) {
  const captureState = captureMeta ?? {};
  const reviewConfirmed = prdReviewState?.status === 'confirmed';
  const confirmDerived = reviewConfirmed
    ? []
    : analysis.completeFields
      .filter((field) => USER_CLARIFICATION_PATHS.has(field.path))
      .filter((field) => {
        const source = captureState[field.path]?.source;
        return captureSourceRequiresUserConfirmation(source);
      })
      .map((field) => ({
        id: field.path,
        label: field.label,
        prompt: `请确认这个推断输入：${field.label}。当前值：${Array.isArray(field.value) ? field.value.join(', ') : JSON.stringify(field.value)}`,
        reason: 'confirm-derived',
      }));

  const missingQuestions = basePlan.mustAsk.map((field) => ({
    id: field.path,
    label: field.label,
    prompt: field.prompt,
    reason: 'missing',
  }));

  let questions = [];
  if (scenario.id === 'cold-start-greenfield') {
    questions = [
      ...basePlan.kickoffQuestions.map((field) => ({
        id: field.id,
        label: field.label,
        prompt: field.prompt,
        reason: 'kickoff',
      })),
      ...missingQuestions,
      ...confirmDerived,
    ];
  } else if (scenario.id === 'cold-start-existing-project') {
    questions = [
      {
        id: 'existing-project-goal',
        label: '已有项目范围',
        prompt: '基于当前已有项目，这一轮主要是为谁改善什么问题，第一版准备先落哪一块最有价值？',
        reason: 'kickoff',
      },
      {
        id: 'reuse-boundary',
        label: '复用边界',
        prompt: '哪些既有数据、流程、体验或业务结果不能被破坏，哪些区域仍可调整？',
        reason: 'kickoff',
      },
      ...missingQuestions,
      ...confirmDerived,
    ];
  } else {
    questions = [
      ...missingQuestions,
      ...confirmDerived,
    ];
  }

  const deduped = [];
  const seen = new Set();
  for (const question of questions) {
    const key = question.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(question);
  }

  const mustAskUser = deduped.slice(0, limit);
  const canInferLater = basePlan.derived.map((field) => ({
    id: field.path,
    label: field.label,
    prompt: field.prompt,
  }));

  return {
    scenario,
    totalRequiredFields: basePlan.totalRequiredFields,
    missingRequiredFields: analysis.missingRequiredFields,
    mustAskUser,
    canInferLater,
    shouldAskUser: mustAskUser.length > 0,
  };
}

function buildClarificationPlan(snapshot, analysis) {
  const mustAsk = analysis.missingFields.filter((field) => USER_CLARIFICATION_PATHS.has(field.path));
  const derived = analysis.missingFields.filter((field) => !USER_CLARIFICATION_PATHS.has(field.path));
  const kickoffQuestions = [
    { id: 'problem.problemStatement', label: '核心问题', prompt: '我们要解决什么问题？' },
    { id: 'project-overview', label: '项目轮廓', prompt: '这件事主要是给谁用的，他们会在什么场景下最先感受到价值？' },
    { id: 'current-alternative', label: '当前替代', prompt: '他们现在主要靠什么办法、流程或替代品在解决这个问题？' },
    { id: 'first-slice', label: '首版切片', prompt: '如果先做第一版，最值得先让用户完成什么关键动作？' },
    { id: 'validation-loop', label: '验证闭环', prompt: '如果先不做完整产品，最容易先找谁验证、先怎么手工交付、什么真实承诺最能证明值得继续？' },
    { id: 'guardrails', label: '保护项', prompt: '这轮明确先不做什么，或者哪些既有体验、流程和业务结果不能被影响？' },
  ];
  return {
    totalRequiredFields: analysis.totalRequiredFields,
    missingRequiredFields: analysis.missingRequiredFields,
    mustAsk,
    derived,
    kickoffQuestions,
  };
}

function deriveGateLabels({ nextAction, diagramState, clarification }) {
  let currentGate = nextAction;
  if (nextAction === 'diagram') {
    currentGate = `${diagramState?.preferredType ?? 'architecture'} diagram review`;
  } else if (nextAction === 'review') {
    currentGate = 'prd review';
  } else if (nextAction === 'freeze') {
    currentGate = 'freeze review';
  } else if (nextAction === 'clarify-user') {
    currentGate = 'clarify-user';
  }

  let upcomingGate = null;
  if (nextAction === 'clarify-user' || nextAction === 'classify' || nextAction === 'interview' || nextAction === 'synthesize') {
    if (diagramState?.needed) {
      upcomingGate = `${diagramState.preferredType} diagram review`;
    } else {
      upcomingGate = 'freeze review';
    }
  } else if (nextAction === 'diagram') {
    upcomingGate = 'freeze review';
  } else if (nextAction === 'review') {
    upcomingGate = 'freeze review';
  } else if (nextAction === 'freeze') {
    upcomingGate = 'handoff review';
  } else if (nextAction === 'handoff') {
    upcomingGate = 'post-handoff review';
  }

  return {
    currentGate,
    upcomingGate,
  };
}

async function writeVersionSnapshot(ws, snapshot) {
  await fs.mkdir(ws.paths.versionsDir, { recursive: true });
  const jsonPath = cjoin(ws.paths.versionsDir, `${snapshot.versionId}.json`);
  const mdPath = cjoin(ws.paths.versionsDir, `${snapshot.versionId}.md`);
  await writeJson(jsonPath, snapshot);
  await writeText(mdPath, snapshot.content);
  return { jsonPath, mdPath };
}

async function readVersionSnapshot(ws, versionId) {
  const normalized = normalizeVersionId(versionId);
  if (!normalized) {
    return null;
  }

  const jsonPath = cjoin(ws.paths.versionsDir, `${normalized}.json`);
  if (!(await exists(jsonPath))) {
    return null;
  }

  return readJson(jsonPath);
}

async function loadLatestVersionSnapshot(ws) {
  const index = await readVersionIndex(ws);
  if (index.length === 0) {
    return null;
  }

  const latest = index[index.length - 1];
  const snapshot = await readVersionSnapshot(ws, latest.versionId);
  if (!snapshot) {
    return null;
  }

  return { indexEntry: latest, snapshot };
}

function renderBulletList(items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) {
    return ['- 待补充'].join('\n');
  }

  return list.map((item) => `- ${item}`).join('\n');
}

function renderFlowDoc(snapshot) {
  const { scenarios } = snapshot.sections;
  const productFlow = buildDiagramArtifact(snapshot, { type: 'product-flow' });
  const mermaid = renderDiagramMermaidFromModel('product-flow', productFlow.model);
  return `# 流程\n\n## 主流程\n\n${renderBulletList(scenarios.primaryFlows)}\n\n## Mermaid 流程图\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n## 边界情况\n\n${renderBulletList(scenarios.edgeCases)}\n\n## 失败模式\n\n${renderBulletList(scenarios.failureModes)}\n`;
}

function renderRolesDoc(snapshot) {
  const { users, typeSpecific } = snapshot.sections;
  const roleFields = typeSpecific.fields ?? {};
  const extraLines = Object.entries(roleFields)
    .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value ?? '待补充'}`)
    .join('\n') || '- 待补充';

  return `# 角色\n\n## 用户\n\n- 主要用户:\n${renderBulletList(users.primaryUsers)}\n\n- 次要用户:\n${renderBulletList(users.secondaryUsers)}\n\n- 相关方:\n${renderBulletList(users.stakeholders)}\n\n## 类型专项\n\n${extraLines}\n`;
}

function renderHandoffDoc(snapshot) {
  const { handoff } = snapshot.sections;
  const changeSummary = buildSnapshotChangeSummary(snapshot, { limit: 4 });
  const summarySection = changeSummary.markdown
    ? `\n## 变化摘要\n\n${changeSummary.markdown}\n`
    : '';
  return `# 交接\n\n- 本次内容: ${snapshot.title}\n- 产品场景: ${formatProductTypeDisplay(snapshot.productType, { fallback: '待确认' })}\n- 场景模板: ${formatTemplatePackDisplay(snapshot.templatePack, { fallback: '待确认' })}\n- 负责人: ${handoff.owner}\n- 下一步: ${handoff.nextStep}\n- 交接去向: ${handoff.targetSystem}\n${summarySection}`;
}


export {
  appendDecision,
  appendOpenQuestions,
  appendProgress,
  appendVerification,
  buildCurrentStateSnapshot,
  appendWorkflowEvent,
  buildClarificationPlan,
  buildClarificationState,
  buildWorkflowTaskGraph,
  CAPTURE_SOURCES,
  coerceCapturedValue,
  computeWorkspaceDigest,
  CORE_TEMPLATE_FILES,
  USER_CLARIFICATION_PATHS,
  deriveGateLabels,
  detectWorkspaceScenario,
  ensureWorkspaceSkeleton,
  extractMarkdownSection,
  FIELD_PATH_TO_STATE_KEY,
  isSupportedProductType,
  loadCurrentLaneSnapshot,
  loadLatestVersionSnapshot,
  loadWorkspace,
  migrateWorkspaceSkeleton,
  normalizeLaneSessionId,
  OPERATIONAL_GITIGNORE_ENTRIES,
  normalizeVersionId,
  persistWorkspaceCurrentState,
  readVersionIndex,
  readActiveRequirementLane,
  readOperationalGitignoreStatus,
  readVersionSnapshot,
  renderFlowDoc,
  renderHandoffDoc,
  renderRolesDoc,
  resolveActiveTemplatePack,
  resolveCurrentProductType,
  validateWorkspace,
  writeVersionIndex,
  writeVersionSnapshot
};
