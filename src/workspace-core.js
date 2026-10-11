import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { formatVersionId } from './prd-core.js';
import { normalizeReleaseLedger } from './release-ledger.js';
import { appendJsonl, cjoin, exists, readJson, readText, readYaml, stringifyYaml, writeJson, writeText, writeYaml } from './fs-utils.js';
import { openProjectLedger } from './kernel/index.js';
import { checkStandardsWorkspace, STANDARD_DOCS } from './standards.js';
import { timestamp } from './time.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SEED_WORKSPACE = path.join(PACKAGE_ROOT, '.open-vibecoding');
const REQUIRED_PRODUCT_TYPES = ['consumer', 'b2b', 'agent'];
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
  'design/active/task-scope.md',
  'design/active/facts-sheet.md',
  'design/active/asset-spec.md',
  'design/active/image-preflight.md',
  'design/active/direction-plan.md',
  'design/active/selected-direction.md',
  'schema/diagram-architecture.schema.yaml',
  'schema/diagram-product-flow.schema.yaml',
  'templates/diagram/architecture.contract.json',
  'templates/diagram/product-flow.contract.json',
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
  'schema/diagram-architecture.schema.yaml',
  'schema/diagram-product-flow.schema.yaml',
  'templates/diagram/architecture.contract.json',
  'templates/diagram/product-flow.contract.json',
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
  'schema/prd.schema.yaml',
  'templates/base/prd.md',
  'templates/base/intake.md',
  'templates/consumer/prd.md',
  'templates/consumer/intake.md',
  'templates/b2b/prd.md',
  'templates/b2b/intake.md',
  'templates/agent/prd.md',
  'templates/agent/intake.md',
  'templates/manifest.yaml',
  'engagements/active/intake.md',
  'engagements/active/prd.md',
  'engagements/active/flows.md',
  'engagements/active/roles.md',
  'engagements/active/handoff.md',
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
  'task-scope.md': `# Active Design Task Scope

- task-scope: 待填写
- source: current-user-task
- status: pending

## Read Boundary

- 本目录顶层五份设计合同只是当前任务投影，不是跨任务风格记忆库。
- 开始新任务时先填写本文件；只读取与 task-scope 一致的顶层合同。
- 历史子目录、旧任务截图和旧 selected-direction 仅在当前任务显式引用时可采用，不得静默继承。
- 旧的未命名合同视为 legacy-context-only；先核对当前需求、原始素材和消费组件，再决定是否迁移。
`,
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

- task-scope: 待填写

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

## 位图像素合同

| 资产 | rendering-mode | 原始素材 / 消费组件证据 | 源像素约束 | 验证 |
| --- | --- | --- | --- | --- |
| 头像或单物件 UI 位图 | 待填写：transparent-cutout 或 opaque-full-bleed-tile | 待检查 | 待填写 | 待填写 |

- \`transparent-cutout\`: 背景透明、四角 alpha=0，并保留安全裁切；不得混用 full-bleed 的四角检查。
- \`opaque-full-bleed-tile\`: 背景覆盖四边四角，四角必须不透明；禁止图片内圆角卡片、白色外边、透明角。
- UI 的圆角、边框、阴影默认属于消费容器，不得写进源位图；只有原始素材检查明确证明已烘焙时才可继承。
- 参考截图不能单独证明像素合同；必须检查原始素材、消费组件/CSS，或在本表显式锁定 rendering-mode。

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

- task-scope: 待填写
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
  '.open-vibecoding/harness/',
  '.open-vibecoding/learning/',
  '.open-vibecoding/quality/reports/',
];

const WORKSPACE_SCENARIO_IGNORED_ENTRIES = new Set(['.open-vibecoding', '.DS_Store', '.git', '.omx']);
const WORKSPACE_SCENARIO_BOOTSTRAP_FILE_MARKERS = new Map([
  ['AGENTS.md', 'OPEN_VIBECODING:AGENTS:START'],
  ['CLAUDE.md', 'OPEN_VIBECODING:CLAUDE:START'],
]);
const OPEN_VIBECODING_INSTALL_MANIFEST_PATH = path.join('.open-vibecoding', 'harness', 'install-manifest.json');
const OPEN_VIBECODING_HARNESS_DIR = cjoin('.open-vibecoding', 'harness');



async function appendWorkflowEvent(ws, type, payload = {}) {
  const at = timestamp();
  const eventTypeSuffix = String(type ?? 'event')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '') || 'event';
  const jsonPayload = JSON.parse(JSON.stringify(payload ?? {}));
  const ledger = openProjectLedger(ws.projectRoot);
  await ledger.append(
    'workflow:workspace',
    {
      eventType: `workflow.${eventTypeSuffix}`,
      actor: { type: 'open-vibecoding-cli' },
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
  const workspaceRoot = cjoin(projectRoot, '.open-vibecoding');
  const created = await copyTree(SEED_WORKSPACE, workspaceRoot, {
    overwrite: Boolean(options.force),
    ignorePaths: WORKSPACE_SEED_COPY_IGNORE,
    rootDir: SEED_WORKSPACE,
  });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
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

  const defaults = [
    [cjoin(workspaceRoot, 'state', 'events.jsonl'), ''],
    [cjoin(workspaceRoot, 'benchmarks', 'sources.yaml'), 'version: 1\nschema: openprd.benchmarks.v1\nsources: []\n'],
    [cjoin(workspaceRoot, 'benchmarks', 'index.md'), '# Open VibeCoding Benchmark Registry\n\n## 规则\n\n- 项目级 approved benchmark 优先于 Open VibeCoding 内置 Source Map。\n- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。\n- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。\n\n## Approved Sources\n\n- 暂无已批准来源。\n\n## Candidate Sources\n\n- 暂无待确认来源。\n'],
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
    message: `added Open VibeCoding generated artifact ignores: ${missing.join(', ')}`,
  });
  return { ok: true, path: '.gitignore', status: current ? 'updated' : 'created', missing };
}

async function copySeedFileIfChanged(projectRoot, relativePath, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, relativePath);
  const targetPath = cjoin(projectRoot, '.open-vibecoding', relativePath);
  if (!(await exists(sourcePath))) {
    return;
  }
  const next = await readText(sourcePath);
  const current = await readText(targetPath).catch(() => null);
  if (current === next) {
    changes.push({ path: cjoin('.open-vibecoding', relativePath), status: 'unchanged' });
    return;
  }
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.open-vibecoding', relativePath), status: current === null ? 'created' : 'updated' });
}

async function migrateWorkspaceConfig(projectRoot, changes) {
  const sourcePath = cjoin(SEED_WORKSPACE, 'config.yaml');
  const targetPath = cjoin(projectRoot, '.open-vibecoding', 'config.yaml');
  const seed = await readYaml(sourcePath);
  const current = await readYaml(targetPath).catch(() => ({}));
  const { schema: legacySchema, workflow: legacyWorkflow, ...currentWithoutLegacyWorkflow } = current;
  const next = {
    ...seed,
    ...currentWithoutLegacyWorkflow,
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
      frameworkRoot: current.design?.frameworkRoot ?? seed.design?.frameworkRoot ?? '.open-vibecoding/design',
      templateRoot: current.design?.templateRoot ?? seed.design?.templateRoot ?? '.open-vibecoding/design/templates',
      activeArtifacts: {
        ...(seed.design?.activeArtifacts ?? {}),
        ...(current.design?.activeArtifacts ?? {}),
      },
    },
    supportedProductTypes: seed.supportedProductTypes,
    templateInheritance: seed.templateInheritance,
    qualityGates: {
      ...(seed.qualityGates ?? {}),
      ...(current.qualityGates ?? {}),
      standards: seed.qualityGates?.standards,
    },
  };
  delete next.qualityGates.freezeRequires;
  const currentText = await readText(targetPath).catch(() => null);
  const nextText = stringifyYaml(next);
  if (currentText !== nextText) {
    await writeText(targetPath, nextText);
    changes.push({ path: cjoin('.open-vibecoding', 'config.yaml'), status: currentText === null ? 'created' : 'updated' });
  } else {
    changes.push({ path: cjoin('.open-vibecoding', 'config.yaml'), status: 'unchanged' });
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
  const targetPath = cjoin(projectRoot, '.open-vibecoding', 'standards', 'config.json');
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
    changes.push({ path: cjoin('.open-vibecoding', 'standards', 'config.json'), status: 'updated' });
  } else {
    changes.push({ path: cjoin('.open-vibecoding', 'standards', 'config.json'), status: 'unchanged' });
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
  const targetPath = cjoin(projectRoot, '.open-vibecoding', relativePath);
  const current = await readText(targetPath).catch(() => null);
  if (current?.includes(requiredToken)) {
    changes.push({ path: cjoin('.open-vibecoding', relativePath), status: 'unchanged' });
    return;
  }
  const next = current
    ? `${current.trimEnd()}\n\n---\n\n${seedFallback.trim()}\n`
    : `${seedFallback.trim()}\n`;
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.open-vibecoding', relativePath), status: current === null ? 'created' : 'updated-append' });
}

async function ensureHeadingFile(projectRoot, relativePath, heading, fallbackBody, changes) {
  const targetPath = cjoin(projectRoot, '.open-vibecoding', relativePath);
  const current = await readText(targetPath).catch(() => null);
  if (current?.includes(heading)) {
    changes.push({ path: cjoin('.open-vibecoding', relativePath), status: 'unchanged' });
    return;
  }
  const next = current
    ? `${heading}\n\n${current.trim()}\n`
    : fallbackBody;
  await writeText(targetPath, next);
  changes.push({ path: cjoin('.open-vibecoding', relativePath), status: current === null ? 'created' : 'updated-prepend' });
}

async function migrateWorkspaceSkeleton(projectRoot, options = {}) {
  const changes = [];
  const workspaceRoot = cjoin(projectRoot, '.open-vibecoding');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(cjoin(workspaceRoot, 'state'), { recursive: true });
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
      changes.push({ path: cjoin('.open-vibecoding', 'design', 'active', filename), status: 'created' });
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

  const legacyOpenPrdMigration = {
    ok: true,
    action: 'historical-read-only',
    migrated: 0,
    conflicts: 0,
    changes: [],
    errors: [],
  };

  await migrateWorkspaceConfig(projectRoot, changes);
  await migrateStandardsConfig(projectRoot, changes);
  for (const relativePath of WORKSPACE_SEED_REFRESH_FILES) {
    await copySeedFileIfChanged(projectRoot, relativePath, changes);
  }


  if (!(await exists(cjoin(projectRoot, '.open-vibecoding', 'state', 'events.jsonl')))) {
    await writeText(cjoin(projectRoot, '.open-vibecoding', 'state', 'events.jsonl'), '');
    changes.push({ path: cjoin('.open-vibecoding', 'state', 'events.jsonl'), status: 'created' });
  }
  if (!(await exists(cjoin(projectRoot, '.open-vibecoding', 'benchmarks', 'sources.yaml')))) {
    await writeText(cjoin(projectRoot, '.open-vibecoding', 'benchmarks', 'sources.yaml'), 'version: 1\nschema: openprd.benchmarks.v1\nsources: []\n');
    changes.push({ path: cjoin('.open-vibecoding', 'benchmarks', 'sources.yaml'), status: 'created' });
  }
  if (!(await exists(cjoin(projectRoot, '.open-vibecoding', 'benchmarks', 'index.md')))) {
    await writeText(cjoin(projectRoot, '.open-vibecoding', 'benchmarks', 'index.md'), '# Open VibeCoding Benchmark Registry\n\n## 规则\n\n- 项目级 approved benchmark 优先于 Open VibeCoding 内置 Source Map。\n- `inbox/` 里的 candidate 只表示待确认线索，不表示长期最佳实践。\n- 每次只挑 1-3 个高相关来源；来源目录不是事实来源。\n\n## Approved Sources\n\n- 暂无已批准来源。\n\n## Candidate Sources\n\n- 暂无待确认来源。\n');
    changes.push({ path: cjoin('.open-vibecoding', 'benchmarks', 'index.md'), status: 'created' });
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
  const workspaceRoot = cjoin(projectRoot, '.open-vibecoding');
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
    designTaskScope: cjoin(workspaceRoot, 'design', 'active', 'task-scope.md'),
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
    taskGraph: cjoin(workspaceRoot, 'state', 'task-graph.json'),
    eventsLog: cjoin(workspaceRoot, 'state', 'events.jsonl'),
    standardsConfig: cjoin(workspaceRoot, 'standards', 'config.json'),
    standardsFileManualTemplate: cjoin(workspaceRoot, 'standards', 'file-manual-template.md'),
    standardsFolderReadmeTemplate: cjoin(workspaceRoot, 'standards', 'folder-readme-template.md'),
    exportsDir: cjoin(workspaceRoot, 'exports'),
    openprdExportDir: cjoin(workspaceRoot, 'exports', 'open-vibecoding'),
    openprdHandoffJson: cjoin(workspaceRoot, 'exports', 'open-vibecoding', 'handoff.json'),
    openprdHandoffMd: cjoin(workspaceRoot, 'exports', 'open-vibecoding', 'handoff.md'),
  };

  const workspaceCurrentState = await readJson(paths.workspaceCurrentState).catch(() => null);
  const data = {
    config: await readYaml(paths.config).catch(() => null),
    schema: await readYaml(paths.schema).catch(() => null),
    diagramArchitectureSchema: await readYaml(paths.diagramArchitectureSchema).catch(() => null),
    diagramProductFlowSchema: await readYaml(paths.diagramProductFlowSchema).catch(() => null),
    manifest: await readYaml(paths.manifest).catch(() => null),
    currentState: workspaceCurrentState,
    workspaceCurrentState,
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




function excludeKnownErrors(errors, excludedErrors) {
  const remaining = new Map();
  for (const error of excludedErrors) {
    remaining.set(error, (remaining.get(error) ?? 0) + 1);
  }
  return errors.filter((error) => {
    const count = remaining.get(error) ?? 0;
    if (count === 0) {
      return true;
    }
    remaining.set(error, count - 1);
    return false;
  });
}

function finalizeWorkspaceValidationReport(report, options = {}) {
  const workspaceExists = options.workspaceExists !== false;
  const standards = options.standards ?? null;
  const standardsErrors = standards?.errors ?? [];
  const structuralErrors = excludeKnownErrors(report.errors, standardsErrors);
  const structuralValid = workspaceExists && structuralErrors.length === 0;
  const workspaceReady = report.valid;
  const actionReady = workspaceExists;
  const claimReady = workspaceReady;
  const workspaceAttention = workspaceReady
    ? null
    : {
        kind: structuralValid ? 'workspace-validation' : 'workspace-structure',
        blocking: false,
        summary: standardsErrors.length > 0 && structuralErrors.length === 0
          ? 'standards and documentation need attention'
          : 'workspace validation needs attention',
        detail: structuralValid
          ? 'Workspace-wide standards debt is reported separately and does not make the current task fail or revoke a user-authorized action.'
          : 'Core workspace structure needs repair before structure readiness can be claimed. This workspace-level failure does not by itself revoke an unrelated user-authorized task.',
        checks: [
          { name: 'structure', ok: structuralValid, errors: structuralErrors.length },
          ...(standards ? [{ name: 'standards', ok: standards.ok, errors: standardsErrors.length }] : []),
        ],
      };

  return {
    ...report,
    structuralValid,
    structuralErrors,
    standardsReady: standards ? standards.ok : null,
    standardsErrors,
    workspaceReady,
    actionReady,
    claimReady,
    workspaceClaimReady: workspaceReady,
    workspaceAttention,
    readiness: {
      structuralReady: structuralValid,
      standardsReady: standards ? standards.ok : null,
      workspaceReady,
      actionReady,
      claimReady,
      workspaceClaimReady: workspaceReady,
    },
  };
}

async function validateWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  const report = { valid: true, errors: [], warnings: [], checks: [] };
  if (!(await exists(ws.workspaceRoot))) {
    report.valid = false;
    report.errors.push(`Missing workspace: ${ws.workspaceRoot}`);
    return { report: finalizeWorkspaceValidationReport(report, { workspaceExists: false }), ws };
  }

  const requiredFiles = [
    ws.paths.config,
    ws.paths.diagramArchitectureSchema,
    ws.paths.diagramProductFlowSchema,
    ws.paths.diagramArchitectureTemplate,
    ws.paths.diagramProductFlowTemplate,
    ws.paths.standardsConfig,
  ];
  const missing = [];
  for (const filePath of requiredFiles) {
    if (!(await exists(filePath))) missing.push(path.relative(ws.workspaceRoot, filePath));
  }
  if (missing.length) {
    report.valid = false;
    report.errors.push(`Missing required files: ${missing.join(', ')}`);
  }
  if (!ws.data.config) {
    report.valid = false;
    report.errors.push('Failed to parse config.yaml');
  }

  const standards = await checkStandardsWorkspace(projectRoot, {
    optional: true,
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  });
  if (!standards.skipped) {
    if (standards.errors.length) report.valid = false;
    report.errors.push(...standards.errors);
    report.warnings.push(...standards.warnings);
    report.checks.push(...standards.checks.map((check) => ({ name: `standards: ${check}`, ok: standards.ok })));
  }

  const releaseLedger = ws.data.releaseLedger ?? normalizeReleaseLedger(null);
  if (releaseLedger.enabled && !releaseLedger.currentVersion) {
    report.warnings.push('项目版本跟踪已启用，但尚未设置当前版本号');
  }
  if (releaseLedger.currentVersion && !releaseLedger.versions.some((entry) => entry.version === releaseLedger.currentVersion)) {
    report.valid = false;
    report.errors.push(`当前版本 ${releaseLedger.currentVersion} 缺少版本记录`);
  }
  report.checks.push({ name: 'workspace', ok: missing.length === 0 && Boolean(ws.data.config) });
  return { report: finalizeWorkspaceValidationReport(report, { standards }), ws };
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


function normalizeScenarioRelativePath(relativePath) {
  return String(relativePath ?? '').replaceAll('\\', '/');
}

async function readScenarioManagedPaths(projectRoot) {
  const manifestPath = path.join(projectRoot, OPEN_VIBECODING_INSTALL_MANIFEST_PATH);
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
      userParticipation: '定向补充（不阻断）',
      reason: '该工作区已有合成结果或历史记录；Agent 复用可验证上下文，用户可按需补充增量信息。',
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
      userParticipation: 'Agent 主导、用户可选补充',
      reason: '项目根目录基本为空；Agent 先采用可逆默认假设形成第一版，用户可随时覆盖。',
    };
  }

  return {
    id: 'cold-start-existing-project',
    label: '冷启动（已有项目）',
    userParticipation: '上下文复用、用户可选补充',
    reason: '项目已经包含资料但 Open VibeCoding 工作区是新的；Agent 先复用可验证上下文，不把补充信息变成停顿。',
  };
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
export {
  appendWorkflowEvent,
  computeWorkspaceDigest,
  CORE_TEMPLATE_FILES,
  detectWorkspaceScenario,
  ensureWorkspaceSkeleton,
  extractMarkdownSection,
  isSupportedProductType,
  loadLatestVersionSnapshot,
  loadWorkspace,
  migrateWorkspaceSkeleton,
  OPERATIONAL_GITIGNORE_ENTRIES,
  normalizeVersionId,
  readVersionIndex,
  readOperationalGitignoreStatus,
  readVersionSnapshot,
  resolveActiveTemplatePack,
  resolveCurrentProductType,
  validateWorkspace
};
