import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cjoin, exists, readJson } from './fs-utils.js';
import { buildCodeExtensionCandidate, observeGrowthWorkspace } from './growth.js';

const DEVELOPMENT_STANDARDS_CONFIG = cjoin('.openprd', 'standards', 'config.json');
const DEV_CHECK_WRAPUP_COPY_SCRIPT = fileURLToPath(new URL('../scripts/dev-check-wrapup-copy.mjs', import.meta.url));
const DEV_CHECK_WRAPUP_FIELDS_AUTO = ['源文件规模', '优化原因', '本次处理结果', '后续建议'];
const DEV_CHECK_WRAPUP_FIELDS_RECOMMEND = ['规模信号', '预警原因', '本次处理结果', '后续建议'];
const CODE_FILE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cjs',
  '.cpp',
  '.cs',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
]);
const EXEMPT_PATH_SEGMENTS = new Set([
  '.git',
  '.openprd',
  '.openspec',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'coverage',
  'generated',
  '__fixtures__',
  'fixtures',
  'snapshots',
]);
const EXEMPT_FILE_PATTERNS = [
  /(^|\/)package-lock\.json$/i,
  /(^|\/)pnpm-lock\.yaml$/i,
  /(^|\/)yarn\.lock$/i,
  /(^|\/)bun\.lockb$/i,
  /\.min\.(js|css)$/i,
  /\.(generated|gen)\.[^.]+$/i,
  /\.snap$/i,
];

export const DEFAULT_DEVELOPMENT_STANDARDS = {
  codeFileLines: {
    enabled: true,
    okMax: 700,
    attentionMax: 1500,
    appliesTo: 'agent-touched-code-files',
  },
  autoRefactor: {
    enabled: false,
  },
};

const UI_FILE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.jsx',
  '.scss',
  '.svelte',
  '.tsx',
  '.vue',
  '.wxml',
  '.wxss',
]);
const VISUAL_REVIEWS_DIR = cjoin('.openprd', 'harness', 'visual-reviews');
const VISUAL_EVIDENCE_FRESH_MS = 24 * 60 * 60 * 1000;
const I18N_CONFIG_PATH = cjoin('.openprd', 'i18n-config.json');
const I18N_TEXT_FILE_EXTENSIONS = new Set([
  '.html', '.jsx', '.swift', '.tsx', '.vue', '.wxml', '.svelte',
  '.kt', '.java', '.dart', '.xml',
]);

function normalizePathForReport(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function countTextLines(text) {
  if (!text) return 0;
  const lineCount = text.split(/\r\n|\r|\n/).length;
  return /(\r\n|\r|\n)$/.test(text) ? lineCount - 1 : lineCount;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function normalizeExtension(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith('.') ? raw : `.${raw}`;
}

function compilePattern(value) {
  if (value instanceof RegExp) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    return new RegExp(raw, 'i');
  } catch {
    return null;
  }
}

function isCodeFile(relativePath, lineConfig) {
  return lineConfig.codeFileExtensions.has(path.extname(relativePath).toLowerCase());
}

function isExemptPath(relativePath, lineConfig) {
  const normalized = normalizePathForReport(relativePath);
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((segment) => lineConfig.exemptPathSegments.has(segment))
    || lineConfig.exemptFilePatterns.some((pattern) => pattern.test(normalized));
}

function looksLikeCodeFile(relativePath, text) {
  const extension = path.extname(relativePath);
  if (!extension || !text.trim()) {
    return { match: false, confidence: 0, reason: 'no-extension-or-empty' };
  }
  const checks = [
    { pattern: /^#!.*\b(node|deno|python|ruby|bash|sh|zsh|perl|php)\b/m, weight: 0.9, reason: 'shebang' },
    { pattern: /^\s*(import|export)\s.+from\s+['"][^'"]+['"]/m, weight: 0.85, reason: 'module-import' },
    { pattern: /^\s*(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/m, weight: 0.72, reason: 'variable-declaration' },
    { pattern: /^\s*(function|class|interface|type|enum)\s+[A-Za-z_$][\w$]*/m, weight: 0.78, reason: 'declaration' },
    { pattern: /^\s*(def|class)\s+[A-Za-z_][\w_]*\s*[\(:]/m, weight: 0.78, reason: 'python-declaration' },
    { pattern: /^\s*package\s+[A-Za-z_][\w.]*/m, weight: 0.78, reason: 'package-declaration' },
    { pattern: /<script\b[^>]*>[\s\S]{0,200}(import|export|const|let|function)\b/i, weight: 0.82, reason: 'script-block' },
    { pattern: /[{;}]\s*$/m, weight: 0.55, reason: 'code-punctuation' },
  ];
  let best = { match: false, confidence: 0, reason: 'no-code-signal' };
  for (const check of checks) {
    if (check.pattern.test(text) && check.weight > best.confidence) {
      best = { match: true, confidence: check.weight, reason: check.reason };
    }
  }
  return best;
}

function normalizeLineConfig(config = {}) {
  const source = config?.developmentStandards?.codeFileLines ?? config?.codeFileLines ?? {};
  const okMax = Number(source.okMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.okMax);
  const attentionMax = Number(source.attentionMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.attentionMax);
  const codeFileExtensions = new Set([
    ...CODE_FILE_EXTENSIONS,
    ...normalizeStringList(source.codeFileExtensions).map(normalizeExtension).filter(Boolean),
    ...normalizeStringList(source.additionalCodeFileExtensions).map(normalizeExtension).filter(Boolean),
  ]);
  const exemptPathSegments = new Set([
    ...EXEMPT_PATH_SEGMENTS,
    ...normalizeStringList(source.exemptPathSegments),
    ...normalizeStringList(source.additionalExemptPathSegments),
  ]);
  const customPatterns = [
    ...normalizeStringList(source.exemptFilePatterns),
    ...normalizeStringList(source.additionalExemptFilePatterns),
  ].map(compilePattern).filter(Boolean);
  return {
    enabled: source.enabled !== false,
    okMax: Number.isInteger(okMax) && okMax > 0 ? okMax : DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.okMax,
    attentionMax: Number.isInteger(attentionMax) && attentionMax > okMax
      ? attentionMax
      : DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.attentionMax,
    codeFileExtensions,
    exemptPathSegments,
    exemptFilePatterns: [...EXEMPT_FILE_PATTERNS, ...customPatterns],
    growthEnabled: config?.growth?.enabled !== false,
    growthAutoApply: config?.growth?.autoApply,
    autoRefactorEnabled: (config?.developmentStandards?.autoRefactor ?? config?.autoRefactor)?.enabled === true,
  };
}

export function validateDevelopmentStandardsConfig(config, errors = []) {
  const lineConfig = config?.developmentStandards?.codeFileLines;
  if (!lineConfig) return errors;
  const okMax = Number(lineConfig.okMax);
  const attentionMax = Number(lineConfig.attentionMax);
  if (!Number.isInteger(okMax) || okMax < 1) {
    errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines.okMax must be a positive integer.`);
  }
  if (!Number.isInteger(attentionMax) || attentionMax <= okMax) {
    errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines.attentionMax must be greater than okMax.`);
  }
  for (const field of ['codeFileExtensions', 'additionalCodeFileExtensions', 'exemptPathSegments', 'additionalExemptPathSegments', 'exemptFilePatterns', 'additionalExemptFilePatterns']) {
    if (lineConfig[field] !== undefined && !Array.isArray(lineConfig[field])) {
      errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines.${field} must be an array.`);
    }
  }
  for (const value of [
    ...normalizeStringList(lineConfig.exemptFilePatterns),
    ...normalizeStringList(lineConfig.additionalExemptFilePatterns),
  ]) {
    if (!compilePattern(value)) {
      errors.push(`${DEVELOPMENT_STANDARDS_CONFIG} developmentStandards.codeFileLines exempt file pattern is invalid: ${value}`);
    }
  }
  return errors;
}

async function readDevelopmentConfig(projectRoot) {
  const configPath = cjoin(projectRoot, DEVELOPMENT_STANDARDS_CONFIG);
  if (!(await exists(configPath))) {
    return {};
  }
  return readJson(configPath).catch(() => ({}));
}

function fileStatus(lineCount, lineConfig) {
  if (lineCount <= lineConfig.okMax) return 'ok';
  if (lineCount <= lineConfig.attentionMax) return 'attention';
  return 'warning';
}

function nextActionForStatus(status, lineConfig) {
  const autoMode = lineConfig?.autoRefactorEnabled === true;
  if (status === 'ok') {
    return `本轮没有显著维护风险；最终回复可简要说明已回顾本次改动文件。`;
  }
  if (status === 'attention') {
    if (autoMode) {
      return `若拆分与当前目标同范围且安全可逆，可按入口、状态、渲染或数据边界做小步优化；否则只记录建议，不扩大本轮任务。`;
    }
    return `本轮只做当前目标相关的小范围改动，并说明没有继续扩展该文件职责。`;
  }
  if (status === 'warning') {
    if (autoMode) {
      return `若当前任务本身包含结构优化，可在测试保护下按职责边界拆出独立模块并重跑验证；否则保留为工作区建议，不阻断当前任务。`;
    }
    return `先判断这次是否新增职责；如果新增了，优先拆分或解耦后再收尾；如果只是小修，说明暂不拆的原因和后续拆分建议。`;
  }
  if (status === 'exempt') {
    return `不纳入本次维护风险判断；只记录行数，不要求拆分。`;
  }
  if (status === 'not-code') {
    return `不适用；维护风险检查只面向代码文件。`;
  }
  return `无法检查；请确认文件路径。`;
}

function devCheckStatusLabel(status) {
  if (status === 'ok') return '已检查，无需关注';
  if (status === 'attention') return '🟡 低风险｜建议留意';
  if (status === 'warning') return '🟠 中风险｜建议优先关注';
  if (status === 'exempt') return '不纳入本次判断';
  if (status === 'not-code') return '不适用';
  if (status === 'error') return '🔴 高风险｜需要先处理';
  return String(status || '未知');
}

function devCheckConcernRank(file) {
  if (file.status === 'error') return 4;
  if (file.status === 'warning') return 3;
  if (file.status === 'attention') return 2;
  if (file.status === 'ok') return 1;
  return 0;
}

function devCheckThresholdText(file) {
  const thresholds = file.thresholds ?? {};
  const okMax = thresholds.okMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.okMax;
  const attentionMax = thresholds.attentionMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.attentionMax;
  const lineText = file.lineCount === null || file.lineCount === undefined ? '未知行数' : `${file.lineCount} 行`;
  if (file.status === 'warning') {
    return `${lineText}；已超过高维护风险线（>${attentionMax} 行）`;
  }
  if (file.status === 'attention') {
    return `${lineText}；已超过建议的单文件舒适区（≤${okMax} 行）`;
  }
  return `${lineText}；建议单文件舒适区 ≤${okMax} 行，高维护风险线 >${attentionMax} 行`;
}

function devCheckReason(file) {
  const thresholds = file.thresholds ?? {};
  const okMax = thresholds.okMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.okMax;
  const attentionMax = thresholds.attentionMax ?? DEFAULT_DEVELOPMENT_STANDARDS.codeFileLines.attentionMax;
  if (file.status === 'attention') {
    return `文件已经偏大，继续叠加新职责会提高评审、回归和交接成本；本轮需要说明只改了哪一小块。`;
  }
  if (file.status === 'warning') {
    return `文件已经进入高维护风险区，继续加逻辑容易放大改动范围和回归成本；需要判断是否应先拆分。`;
  }
  if (file.status === 'ok') {
    return `文件规模在建议范围内。`;
  }
  if (file.status === 'exempt') {
    return '命中生成物、依赖、快照或项目配置豁免。';
  }
  if (file.status === 'not-code') {
    return '未识别为代码文件。';
  }
  return file.nextAction || '无法完成检查。';
}

function devCheckSplitIdea(file) {
  if (file.status === 'attention') {
    return '后续如果还要继续改这个文件，按入口、状态、渲染或数据处理边界拆出更小模块。';
  }
  if (file.status === 'warning') {
    return '优先把独立职责、测试夹具或输出渲染拆出，降低下一次需求的评审和回归成本。';
  }
  if (file.status === 'ok') {
    return '无需拆分。';
  }
  if (file.status === 'exempt') {
    return '无需拆分，保持豁免原因可追踪。';
  }
  if (file.status === 'not-code') {
    return '不适用研发期代码拆分判断。';
  }
  return '先修复检查错误，再重新运行 dev-check。';
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function renderMarkdownTable(columns, rows) {
  if (!rows.length) return '';
  const header = `| ${columns.map(markdownCell).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => markdownCell(row[column])).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function countDisplayChars(value) {
  return Array.from(String(value ?? '')).length;
}

function buildCompactWrapUpRows(files, options = {}) {
  const result = spawnSync(process.execPath, [DEV_CHECK_WRAPUP_COPY_SCRIPT], {
    input: JSON.stringify({
      autoRefactor: Boolean(options.autoRefactor),
      files: files.map((file) => ({
        status: file.status,
        lineCount: file.lineCount,
        thresholds: file.thresholds,
        nextAction: file.nextAction,
      })),
    }),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'Failed to generate compact dev-check wrap-up copy.');
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch (error) {
    throw new Error(`Failed to parse compact dev-check wrap-up copy: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : null;
  const limit = Number.isInteger(payload?.limit) ? payload.limit : 20;
  if (!rows || rows.length !== files.length) {
    throw new Error('Compact dev-check wrap-up copy returned an unexpected row count.');
  }
  const expectedFields = options.autoRefactor ? DEV_CHECK_WRAPUP_FIELDS_AUTO : DEV_CHECK_WRAPUP_FIELDS_RECOMMEND;
  for (const row of rows) {
    for (const field of expectedFields) {
      if (typeof row[field] !== 'string') {
        throw new Error(`Compact dev-check wrap-up copy is missing field: ${field}`);
      }
      if (countDisplayChars(row[field]) > limit) {
        throw new Error(`Compact dev-check wrap-up copy exceeded ${limit} chars for field: ${field}`);
      }
    }
  }
  return rows;
}

function buildDevCheckWrapUp(files, lineConfig = {}) {
  const autoMode = lineConfig?.autoRefactorEnabled === true;
  const title = autoMode ? 'OpenPRD 结构优化建议' : '后续建议';
  const statusColumn = autoMode ? '问题级别' : '关注程度';
  const columns = autoMode
    ? ['影响对象', '问题级别', '源文件规模', '优化原因', '本次处理结果', '后续建议']
    : ['影响对象', '关注程度', '规模信号', '预警原因', '本次处理结果', '后续建议'];
  const attentionFiles = files
    .filter((file) => ['attention', 'warning', 'error'].includes(file.status))
    .sort((left, right) => devCheckConcernRank(right) - devCheckConcernRank(left));
  const compactRows = attentionFiles.length > 0
    ? buildCompactWrapUpRows(attentionFiles, { autoRefactor: autoMode })
    : [];
  const rows = attentionFiles.map((file, index) => ({
      影响对象: file.path,
      [statusColumn]: devCheckStatusLabel(file.status),
      ...compactRows[index],
    }));
  const markdownTable = renderMarkdownTable(columns, rows);
  const switchHint = autoMode
    ? '当前启用主动结构优化建议；它不会强制扩大任务范围。可用 `openprd dev-check . --auto-refactor off` 切回普通建议。'
    : '当前为普通建议模式。仅当用户希望在同一任务内主动做结构优化时，才使用 `openprd dev-check . --auto-refactor on`。';
  return {
    required: false,
    recommended: rows.length > 0,
    mode: autoMode ? 'auto-refactor' : 'recommend',
    reason: rows.length > 0
      ? (autoMode
        ? '存在结构优化机会；仅在与当前目标同范围时顺手处理，否则作为 workspaceAttention 保留。'
        : '存在结构维护建议；它不影响当前任务结果，也不要求用户先处理。')
      : '本轮改动文件未触发影响范围提醒；最终回复可简要说明已完成改动对象回顾。',
    title,
    columns,
    rows,
    markdownTable,
    markdownBlock: markdownTable ? `**${title}**\n\n${markdownTable}` : '',
    switchHint: rows.length > 0 ? switchHint : null,
  };
}

async function buildVisualEvidenceReminder(projectRoot, files) {
  const uiFiles = files
    .filter((file) => file.status !== 'error' && UI_FILE_EXTENSIONS.has(path.extname(file.path).toLowerCase()))
    .map((file) => file.path);
  if (uiFiles.length === 0) {
    return { required: false, uiFiles: [] };
  }
  const reviewsDir = cjoin(projectRoot, VISUAL_REVIEWS_DIR);
  let freshEvidence = [];
  const entries = await fs.readdir(reviewsDir).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    if (!/\.(jpe?g|png|webp)$/i.test(entry)) continue;
    const stat = await fs.stat(path.join(reviewsDir, entry)).catch(() => null);
    if (stat && now - stat.mtimeMs <= VISUAL_EVIDENCE_FRESH_MS) {
      freshEvidence.push(normalizePathForReport(path.join(VISUAL_REVIEWS_DIR, entry)));
    }
  }
  freshEvidence = freshEvidence.slice(-5);
  const required = freshEvidence.length === 0;
  return {
    required,
    uiFiles,
    freshEvidence,
    reason: required
      ? '本轮触达界面文件，但最近 24 小时没有任何拼图证据板产出；用户可见变化需要视觉证据，不能只靠构建通过或单张截图。'
      : '本轮触达界面文件，最近已有拼图证据板产出；确认它覆盖了本轮改动，并把证据图嵌入对话流。',
    suggestedCommands: [
      'openprd visual-compare . --before <改前截图> --after <改后截图>',
      'openprd visual-compare . --reference <参考图> --actual <实现截图> --reference-box <x,y,w,h> --actual-box <x,y,w,h> --presentation local-first（局部改动主证据）',
      'openprd visual-compare . --board <alignment-board.json>（同构列表/卡片/网格/表格对齐，含容器轨道与内容槽位）',
      '网格与基线只进入 alignment-board；普通结果画布不得自动叠加',
      'openprd visual-compare . --board <centering-board.json>（单素材内部居中/视觉重心）',
    ],
    chatEmbedHint: '生成后把证据图用 `![视觉证据](<输出路径>)` 直接嵌入最终回复，让用户在对话流里看到对齐效果。',
  };
}

async function buildI18nReminder(projectRoot, files) {
  const textFiles = files
    .filter((f) => f.status !== 'error' && I18N_TEXT_FILE_EXTENSIONS.has(path.extname(f.path).toLowerCase()))
    .map((f) => f.path);
  if (textFiles.length === 0) {
    return { required: false, textFiles: [] };
  }
  const configPath = cjoin(projectRoot, I18N_CONFIG_PATH);
  const config = await readJson(configPath).catch(() => null);
  if (config && config.enforceOnDevCheck === false) {
    return { required: false, textFiles, reason: 'i18n 检查已被用户关闭 (enforceOnDevCheck: false)。' };
  }
  const defaultLang = config?.defaultLanguage ?? 'zh-Hans';
  const supported = Array.isArray(config?.supportedLanguages) ? config.supportedLanguages : ['zh-Hans', 'en'];
  const platforms = Array.isArray(config?.platforms) ? config.platforms : [];
  const copyGuideline = '目标语言文案不要逐字翻译；按钮、Tab、菜单和短标签按母语软件产品习惯紧凑改写，只使用无歧义的常见缩写，并在真实控件中检查语义、截断、异常换行、布局挤压与 Accessibility Label。';
  return {
    required: true,
    textFiles,
    defaultLanguage: defaultLang,
    supportedLanguages: supported,
    platforms,
    configExists: config !== null,
    reason: config
      ? `本轮触达 ${textFiles.length} 个可能包含用户文案的文件；请检查新增/修改的文案是否已使用 i18n 框架，基准语言 ${defaultLang}，需支持 ${supported.join(', ')}。${copyGuideline}`
      : `本轮触达 ${textFiles.length} 个可能包含用户文案的文件，但项目尚未配置 .openprd/i18n-config.json。如需启用多语言检查，可运行 openprd i18n-init . 或手动创建配置文件。${copyGuideline}`,
    copyGuideline,
    guideline: 'docs/basic/i18n-guidelines.md',
  };
}

async function analyzeDevelopmentFile(projectRoot, targetPath, lineConfig) {
  const absolutePath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : cjoin(projectRoot, targetPath);
  const relativePath = normalizePathForReport(path.relative(projectRoot, absolutePath));

  if (!relativePath || relativePath.startsWith('..')) {
    return {
      path: targetPath,
      status: 'error',
      lineCount: null,
      nextAction: '文件必须位于当前项目内。',
      error: 'file-outside-project',
    };
  }

  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat) {
    return {
      path: relativePath,
      status: 'error',
      lineCount: null,
      nextAction: '文件不存在；请确认路径后重试。',
      error: 'file-missing',
    };
  }
  if (!stat.isFile()) {
    return {
      path: relativePath,
      status: 'error',
      lineCount: null,
      nextAction: '目标不是文件；请传入具体代码文件。',
      error: 'not-a-file',
    };
  }

  const text = await fs.readFile(absolutePath, 'utf8').catch(() => '');
  const lineCount = countTextLines(text);
  const codeFile = isCodeFile(relativePath, lineConfig);
  const exempt = isExemptPath(relativePath, lineConfig);
  const codeSignal = codeFile || exempt ? { match: false, confidence: 0, reason: null } : looksLikeCodeFile(relativePath, text);
  const candidateCode = !codeFile && !exempt && codeSignal.match;
  const status = exempt ? 'exempt' : (codeFile || candidateCode ? fileStatus(lineCount, lineConfig) : 'not-code');
  let growthCandidate = null;
  let growthObservation = null;
  if (candidateCode) {
    growthCandidate = buildCodeExtensionCandidate(relativePath, {
      lineCount,
      confidence: codeSignal.confidence,
      reason: codeSignal.reason,
    });
    if (lineConfig.growthEnabled) {
      growthObservation = await observeGrowthWorkspace(projectRoot, growthCandidate, {
        autoApply: lineConfig.growthAutoApply,
      });
      growthCandidate = growthObservation.candidate ?? growthCandidate;
    }
  }
  const baseAction = nextActionForStatus(status, lineConfig);
  const nextAction = growthObservation?.autoApplied
    ? `${baseAction} 另外：已自动补齐 ${growthCandidate.key} 代码文件识别规则，后续同类文件会直接纳入 dev-check。`
    : growthCandidate
    ? `${baseAction} 另外：该扩展名尚未固化为代码文件识别规则，先按代码候选处理；本轮收工复盘时运行 openprd grow . --review 集中确认。`
    : baseAction;

  return {
    path: relativePath,
    absolutePath,
    status,
    statusLabel: devCheckStatusLabel(status),
    fileKind: exempt ? 'exempt' : (codeFile ? 'code' : (candidateCode ? 'candidate-code' : 'non-code')),
    lineCount,
    sizeBytes: stat.size,
    thresholds: {
      okMax: lineConfig.okMax,
      attentionMax: lineConfig.attentionMax,
    },
    growthCandidate,
    growthObservation,
    nextAction,
    wrapUp: ['attention', 'warning'].includes(status)
      ? {
        threshold: devCheckThresholdText({ status, lineCount, thresholds: { okMax: lineConfig.okMax, attentionMax: lineConfig.attentionMax } }),
        reason: devCheckReason({ status, lineCount, thresholds: { okMax: lineConfig.okMax, attentionMax: lineConfig.attentionMax }, nextAction }),
        splitIdea: devCheckSplitIdea({ status }),
      }
      : null,
  };
}

export async function checkDevelopmentStandardsWorkspace(projectRoot, options = {}) {
  const targets = Array.isArray(options.files) ? options.files.filter(Boolean) : [];
  const errors = [];
  if (targets.length === 0) {
    errors.push('No files provided. Usage: openprd dev-check [project] <file...>');
  }

  const config = await readDevelopmentConfig(projectRoot);
  const lineConfig = normalizeLineConfig(config);
  const files = [];
  if (lineConfig.enabled) {
    for (const target of targets) {
      files.push(await analyzeDevelopmentFile(projectRoot, target, lineConfig));
    }
  }

  const statusCounts = files.reduce((counts, file) => {
    counts[file.status] = (counts[file.status] ?? 0) + 1;
    return counts;
  }, {});
  errors.push(...files.filter((file) => file.status === 'error').map((file) => `${file.path}: ${file.nextAction}`));
  return {
    ok: errors.length === 0,
    action: 'dev-check',
    projectRoot,
    enabled: lineConfig.enabled,
    autoRefactor: {
      enabled: lineConfig.autoRefactorEnabled,
      mode: lineConfig.autoRefactorEnabled ? 'auto-refactor' : 'recommend',
    },
    thresholds: {
      okMax: lineConfig.okMax,
      attentionMax: lineConfig.attentionMax,
      warningAbove: lineConfig.attentionMax,
    },
    summary: {
      total: files.length,
      statusCounts,
      attention: statusCounts.attention ?? 0,
      warning: statusCounts.warning ?? 0,
    },
    files,
    wrapUp: buildDevCheckWrapUp(files, lineConfig),
    visualEvidence: await buildVisualEvidenceReminder(projectRoot, files),
    i18nReminder: await buildI18nReminder(projectRoot, files),
    errors,
  };
}

export async function setDevCheckAutoRefactor(projectRoot, enabled) {
  const configPath = cjoin(projectRoot, DEVELOPMENT_STANDARDS_CONFIG);
  const config = (await exists(configPath)) ? await readJson(configPath).catch(() => ({})) : {};
  const developmentStandards = config.developmentStandards && typeof config.developmentStandards === 'object'
    ? config.developmentStandards
    : {};
  const autoRefactor = developmentStandards.autoRefactor && typeof developmentStandards.autoRefactor === 'object'
    ? developmentStandards.autoRefactor
    : {};
  const next = {
    ...config,
    developmentStandards: {
      ...developmentStandards,
      autoRefactor: {
        ...autoRefactor,
        enabled: Boolean(enabled),
      },
    },
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    action: 'dev-check-auto-refactor',
    projectRoot,
    configPath: normalizePathForReport(path.relative(projectRoot, configPath)),
    autoRefactor: {
      enabled: Boolean(enabled),
      mode: enabled ? 'auto-refactor' : 'recommend',
    },
  };
}

export async function initI18nConfig(projectRoot, options = {}) {
  const configPath = cjoin(projectRoot, I18N_CONFIG_PATH);
  const existing = await readJson(configPath).catch(() => null);
  if (existing) {
    return { created: false, configPath: normalizePathForReport(I18N_CONFIG_PATH), config: existing };
  }
  const defaultLang = options.defaultLanguage ?? 'zh-Hans';
  const config = {
    version: 1,
    defaultLanguage: defaultLang,
    supportedLanguages: [defaultLang, ...(defaultLang === 'en' ? ['zh-Hans'] : ['en'])],
    enforceOnDevCheck: true,
    platforms: [],
    translationStrategy: 'key-value-file',
    notes: '用户可随时修改此文件来调整默认语言、支持语种和检查策略',
  };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { created: true, configPath: normalizePathForReport(I18N_CONFIG_PATH), config };
}
