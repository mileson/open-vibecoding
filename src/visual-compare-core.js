// Shared visual-compare primitives: copy tables, locale helpers, board spec
// normalization, SVG building blocks, and image pipeline utilities.
// Split from visual-compare.js so board renderers stay focused on layout.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compactTimestamp } from './time.js';
import {
  OPENPRD_FALLBACK_LOCALE,
  detectPrimaryLanguage,
  isChineseLocale,
  isEnglishHeavyText,
  normalizeOutputLocale,
} from './language-policy.js';

export const DEFAULT_PANEL_WIDTH = 1180;
export const DEFAULT_QUALITY = 85;
export const DEFAULT_REFERENCE_LABEL = '效果图';
export const DEFAULT_ACTUAL_LABEL = '实现截图';
export const DEFAULT_BEFORE_LABEL = '修改前';
export const DEFAULT_AFTER_LABEL = '修改后';
export const DEFAULT_FOCUS_TITLE = '局部焦点证据板';
export const DEFAULT_PARALLEL_TITLE = '并行实验证据板';
export const DEFAULT_VERIFICATION_TITLE = '截图实测证据板';
export const DEFAULT_ALIGNMENT_TITLE = '对齐辅助线证据板';
export const DEFAULT_CENTERING_TITLE = '单元素内部居中证据板';
export const DEFAULT_PARALLEL_CARD_WIDTH = 380;
export const DEFAULT_PARALLEL_COLUMNS = 3;
export const OUTPUT_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export const NON_VISIBLE_BOARD_KEYS = new Set([
  'actual',
  'after',
  'before',
  'boardSource',
  'box',
  'boxes',
  'cardWidth',
  'color',
  'columns',
  'format',
  'generatedAt',
  'grid',
  'height',
  'id',
  'image',
  'mode',
  'outputPath',
  'overlay',
  'path',
  'reference',
  'schema',
  'screenshot',
  'source',
  'sourcePath',
  'targetBox',
  'unit',
  'url',
  'width',
  'x',
  'y',
]);
export const VISUAL_COPY = {
  zh: {
    separator: '：',
    materialLabel: (index) => `素材 ${index + 1}`,
    metricTextLabel: '说明',
    metricFallbackLabel: '指标',
    referenceLabel: DEFAULT_REFERENCE_LABEL,
    actualLabel: DEFAULT_ACTUAL_LABEL,
    beforeLabel: DEFAULT_BEFORE_LABEL,
    afterLabel: DEFAULT_AFTER_LABEL,
    focusTitle: DEFAULT_FOCUS_TITLE,
    parallelTitle: DEFAULT_PARALLEL_TITLE,
    verificationTitle: DEFAULT_VERIFICATION_TITLE,
    alignmentTitle: DEFAULT_ALIGNMENT_TITLE,
    centeringTitle: DEFAULT_CENTERING_TITLE,
    focusSummary: '先看整体标框，再看编号对应的局部放大；局部差异优先在这里复核。',
    localFocusSummary: '直接对比同一个有效区域：左右保持同一像素尺度，差异图用于定位返工点，全屏只作上下文。',
    focusEyebrow: '视觉验收 / 局部焦点',
    focusRegionLabel: (index) => `焦点 ${index + 1}`,
    referenceEyebrow: '视觉验收 / 效果对比',
    beforeAfterEyebrow: '视觉验收 / 修改前后',
    parallelEyebrow: '视觉验收 / 并行实验',
    parallelSummary: '把多方向产物、局部截图、GIF 首帧和指标放到一板里，方便统一审查。',
    parallelItemLabel: (index) => `方案 ${index + 1}`,
    verificationEyebrow: '视觉验收 / 截图实测',
    verificationCardEyebrow: '截图实测',
    verificationSingleLabel: '实测截图',
    verificationItemLabel: (index) => `实测截图 ${index + 1}`,
    verificationMediaLabel: (index) => `截图 ${index + 1}`,
    alignmentSummary: '用辅助线和坐标 spread 同时验证同构列表、卡片、网格或表格的容器轨道与内部内容槽位是否对齐。',
    alignmentEyebrow: '视觉验收 / 对齐辅助线',
    alignmentScreenshotLabel: '真实截图',
    alignmentOverlayLabel: '辅助线截图',
    alignmentMeasureEyebrow: '对齐量测',
    alignmentGroupLabel: (index) => `对齐分组 ${index + 1}`,
    alignmentGuideLabel: (index) => `辅助线 ${index + 1}`,
    alignmentRegionLabel: (index) => `区域 ${index + 1}`,
    alignmentContainerLevel: '容器轨道',
    alignmentContentSlotLevel: '内容槽位轨道',
    alignmentExpectedPrefix: '预期',
    alignmentStructurePrefix: '结构',
    alignmentItemLabel: '对齐项',
    alignmentThresholdLabel: '阈值',
    passVerdict: '通过',
    reworkVerdict: '需返工',
    centeringSummary: '用像素 mask 识别主体，红线是画布中心，绿色框是主体外接框，黄色点是视觉重心；同时检查外接框中心和视觉重心偏移。',
    centeringEyebrow: '视觉验收 / 内部居中',
    centeringImageLabel: '目标元素',
    centeringOverlayLabel: '量测覆盖图',
    centeringMeasureLabel: '内部居中量测',
    centeringMeasureEyebrow: '像素量测',
    centeringThresholdLabel: '阈值',
    centeringCanvasSizeLabel: '画布尺寸',
    centeringBoundsLabel: '主体外接框',
    centeringBboxOffsetLabel: '外接框中心偏移',
    centeringCentroidOffsetLabel: '视觉重心偏移',
    centeringMaxOffsetLabel: '最大偏移',
    centeringPixelRatioLabel: '主体像素占比',
    centeringCentroidLabel: '重心',
    centeringNotes: '红色=画布中心；绿色=主体外接框和外接框中心；黄色=视觉重心。若 mask 误判，改用 subject.ranges 或 subject.colors 后重跑。',
    resultPrefix: '结论',
    referenceNextActions: [
      '把输出图片作为视觉评审证据查看：左侧效果图，右侧实现截图。',
      '如果仍有明显差异，继续按效果图复刻并重新运行 visual-compare。',
      '只有对比图确认一致后，才声明本阶段界面视觉实现完成。',
    ],
    beforeAfterNextActions: [
      '把输出图片作为视觉改动自检证据查看：左侧修改前，右侧修改后。',
      '检查预期变化是否出现，以及未改区域是否有布局、颜色、密度或状态漂移。',
      '没有效果图时，这张图只证明改动前后差异已自检；大界面方向性改造仍需先完成方案评审。',
    ],
    verificationSummary: (route) => route
      ? `实测路径：${route}`
      : '把普通截图、Computer/Browser 实测路径和检查点拼到同一张板里，避免只用单张截图口头收口。',
    verificationNextActions: [
      '先核对实测路径和每张截图对应的检查点，再判断是否能声明视觉或运行态验收完成。',
      '普通截图只能作为原始素材；最终收口请引用这张截图实测证据板。',
      '如果发现局部差异，再补一张局部焦点证据板或重新生成本证据板。',
    ],
    focusNextActions: [
      '先看顶部编号框，再对照下面同编号的局部放大图复核差异。',
      '若局部区域仍有问题，优先围绕该编号返工，并重新生成焦点证据板。',
      '局部证据板适合补充整体对比，不建议只看整体图就结束界面验收。',
    ],
    localFocusNextActions: [
      '先看局部参考图和实现图，再用差异图定位尺寸、间距、字号、颜色和表面角色偏差。',
      '如果仍有明显差异，围绕该局部返工，在相同状态下重新截图并复用同一裁剪计划。',
      '底部全屏缩略图只用于检查未改区域是否漂移，不代替局部裁决。',
    ],
    parallelNextActions: [
      '横向比较每个实验卡片，再结合指标和结论判断是否要保留多条方向继续迭代。',
      '如果某个方向需要局部细看，再补一张局部焦点证据板，不要只盯整体缩略图。',
      '并行实验证据板适合在 Agent 自验收和用户评审时一起使用，减少来回口头解释。',
    ],
    alignmentNextActions: [
      '先看辅助线是否同时覆盖容器轨道和内容槽位轨道，再看每个分组里的 spread 是否低于阈值。',
      '列表、卡片、网格或表格的新功能开发，只要有同构重复单元，就把标题、副标题、描述、标签、状态、价格、按钮、图标等内部槽位作为默认量测项。',
      '如果只量了卡片外框、列宽或行顶，没有量内部内容槽位，不能声明卡片对齐已经完成。',
      '如果任一关键槽位超过阈值且没有设计解释，先返工再重新生成对齐证据板。',
    ],
    centeringNextActions: [
      '先看红色画布中心线、绿色主体外接框和黄色视觉重心点是否在同一中心附近。',
      '如果外接框中心或视觉重心偏移超过阈值，先调整元素画布、内边距或素材裁切，再重新生成内部居中证据板。',
      '如果自动 mask 把背景或阴影算进主体，改用 subject.ranges 或 subject.colors 明确主体颜色后重跑。',
      '单张原始截图或“看起来居中”的主观判断不能替代这张内部居中证据板。',
    ],
  },
  en: {
    separator: ': ',
    materialLabel: (index) => `Asset ${index + 1}`,
    metricTextLabel: 'Notes',
    metricFallbackLabel: 'Metric',
    referenceLabel: 'Reference',
    actualLabel: 'Implementation',
    beforeLabel: 'Before',
    afterLabel: 'After',
    focusTitle: 'Focus Evidence Board',
    parallelTitle: 'Parallel Experiment Board',
    verificationTitle: 'Screenshot Verification Board',
    alignmentTitle: 'Alignment Evidence Board',
    centeringTitle: 'Element Centering Board',
    focusSummary: 'Review the marked overview first, then inspect each numbered zoomed region.',
    localFocusSummary: 'Compare the same effective region at one shared pixel scale. Use the difference image to locate rework; full-screen images are context only.',
    focusEyebrow: 'Visual QA / Focus Regions',
    focusRegionLabel: (index) => `Focus ${index + 1}`,
    referenceEyebrow: 'Visual QA / Reference Comparison',
    beforeAfterEyebrow: 'Visual QA / Before and After',
    parallelEyebrow: 'Visual QA / Parallel Experiments',
    parallelSummary: 'Collect multiple directions, local screenshots, GIF key frames, and metrics on one board for review.',
    parallelItemLabel: (index) => `Option ${index + 1}`,
    verificationEyebrow: 'Visual QA / Screenshot Verification',
    verificationCardEyebrow: 'Screenshot Check',
    verificationSingleLabel: 'Verified Screenshot',
    verificationItemLabel: (index) => `Verified Screenshot ${index + 1}`,
    verificationMediaLabel: (index) => `Screenshot ${index + 1}`,
    alignmentSummary: 'Use guides and coordinate spread to verify container tracks and internal content slots across repeated UI units.',
    alignmentEyebrow: 'Visual QA / Alignment Guides',
    alignmentScreenshotLabel: 'Live Screenshot',
    alignmentOverlayLabel: 'Guide Overlay',
    alignmentMeasureEyebrow: 'Alignment Measurement',
    alignmentGroupLabel: (index) => `Alignment Group ${index + 1}`,
    alignmentGuideLabel: (index) => `Guide ${index + 1}`,
    alignmentRegionLabel: (index) => `Region ${index + 1}`,
    alignmentContainerLevel: 'Container Track',
    alignmentContentSlotLevel: 'Content Slot Track',
    alignmentExpectedPrefix: 'Expected',
    alignmentStructurePrefix: 'Structure',
    alignmentItemLabel: 'Alignment Item',
    alignmentThresholdLabel: 'Threshold',
    passVerdict: 'Pass',
    reworkVerdict: 'Needs Rework',
    centeringSummary: 'Use a pixel mask to isolate the subject: red lines mark the canvas center, the green box marks subject bounds, and the yellow dot marks visual centroid.',
    centeringEyebrow: 'Visual QA / Internal Centering',
    centeringImageLabel: 'Target Element',
    centeringOverlayLabel: 'Measurement Overlay',
    centeringMeasureLabel: 'Internal Centering Measurement',
    centeringMeasureEyebrow: 'Pixel Measurement',
    centeringThresholdLabel: 'Threshold',
    centeringCanvasSizeLabel: 'Canvas Size',
    centeringBoundsLabel: 'Subject Bounds',
    centeringBboxOffsetLabel: 'Bounds Center Offset',
    centeringCentroidOffsetLabel: 'Visual Centroid Offset',
    centeringMaxOffsetLabel: 'Max Offset',
    centeringPixelRatioLabel: 'Subject Pixel Ratio',
    centeringCentroidLabel: 'centroid',
    centeringNotes: 'Red=canvas center; green=subject bounds and bounds center; yellow=visual centroid. If the mask is wrong, rerun with subject.ranges or subject.colors.',
    resultPrefix: 'Result',
    referenceNextActions: [
      'Review the output image as visual QA evidence: reference on the left, implementation on the right.',
      'If visible differences remain, keep iterating against the reference and rerun visual-compare.',
      'Only claim this UI stage is visually complete after the comparison looks aligned.',
    ],
    beforeAfterNextActions: [
      'Review the output image as before/after evidence for the visual change.',
      'Check that the intended change appeared and unchanged areas did not drift in layout, color, density, or state.',
      'Without a reference image, this only proves a before/after self-check; large directional UI changes still need pre-implementation visual review.',
    ],
    verificationSummary: (route) => route
      ? `Checked path: ${route}`
      : 'Combine screenshots, Computer/Browser check paths, and checkpoints into one board instead of closing on a raw screenshot.',
    verificationNextActions: [
      'Review the checked path and every screenshot checkpoint before claiming visual or runtime verification is complete.',
      'Raw screenshots are only inputs; cite this screenshot verification board for final closeout.',
      'If a local difference appears, add a focus evidence board or regenerate this board.',
    ],
    focusNextActions: [
      'Review the numbered overview first, then inspect the matching zoomed regions below.',
      'If a focused region still has issues, iterate on that numbered region and regenerate the board.',
      'Use focus boards as supporting evidence for the overall comparison instead of closing on the overview alone.',
    ],
    localFocusNextActions: [
      'Compare the local reference and implementation first, then use the difference image to locate geometry, spacing, typography, color, and surface-role drift.',
      'If a meaningful difference remains, rework that region, capture the same state again, and reuse the crop plan.',
      'Use the compact full-screen thumbnails only to check for drift outside the edited region.',
    ],
    parallelNextActions: [
      'Compare each experiment card side by side, then use the metrics and verdicts to decide which directions remain.',
      'If one direction needs closer inspection, add a focus evidence board instead of relying on the thumbnail.',
      'Use this board for both agent self-checks and user review to reduce back-and-forth explanation.',
    ],
    alignmentNextActions: [
      'Check that guides cover both container tracks and content-slot tracks, then confirm each group spread is under threshold.',
      'For repeated lists, cards, grids, or tables, measure internal slots such as title, subtitle, body, badge, status, price, buttons, and icons.',
      'If only card frames, column widths, or row tops were measured, do not claim card alignment is complete.',
      'If any critical slot exceeds threshold without a design rationale, fix it and regenerate the alignment board.',
    ],
    centeringNextActions: [
      'Check whether the red canvas center lines, green subject bounds, and yellow visual centroid land near the same center.',
      'If the bounds center or visual centroid exceeds threshold, adjust the canvas, padding, or asset crop and regenerate the board.',
      'If the automatic mask includes background or shadow pixels, rerun with explicit subject.ranges or subject.colors.',
      'A raw screenshot or a subjective “looks centered” check does not replace this centering evidence board.',
    ],
  },
};
export const FOCUS_COLORS = ['#f97316', '#22c55e', '#38bdf8', '#eab308', '#fb7185', '#a78bfa'];
export const ALIGNMENT_CONTAINER_TOKENS = [
  'container',
  'outer',
  'card edge',
  'column',
  'row',
  'width',
  'height',
  '容器',
  '外框',
  '边界',
  '列',
  '行',
  '卡片宽度',
  '列间距',
  '行顶',
  '宽度',
  '高度',
];
export const ALIGNMENT_CONTENT_SLOT_TOKENS = [
  'content slot',
  'internal slot',
  'same slot',
  'title',
  'subtitle',
  'description',
  'body',
  'tag',
  'badge',
  'status',
  'price',
  'button',
  'action',
  'icon',
  '内容槽位',
  '内部槽位',
  '相同槽位',
  '文案类型',
  '组件槽位',
  '标题',
  '副标题',
  '描述',
  '正文',
  '标签',
  '状态',
  '价格',
  '按钮',
  '操作区',
  '图标',
  '基线',
];
export const MODE_PREFIX = {
  'reference-actual': 'visual-compare',
  'before-after': 'visual-before-after',
  'focus-board': 'visual-focus-board',
  'parallel-board': 'visual-parallel-board',
  'verification-board': 'visual-verification-board',
  'alignment-board': 'visual-alignment-board',
  'centering-board': 'visual-centering-board',
};
export const BOARD_MODE_ALIASES = new Map([
  ['focus', 'focus-board'],
  ['focus-board', 'focus-board'],
  ['focus-region', 'focus-board'],
  ['focus-region-board', 'focus-board'],
  ['parallel', 'parallel-board'],
  ['parallel-board', 'parallel-board'],
  ['parallel-experiment-board', 'parallel-board'],
  ['experiment-board', 'parallel-board'],
  ['verification', 'verification-board'],
  ['verification-board', 'verification-board'],
  ['screenshot-board', 'verification-board'],
  ['screenshot-evidence-board', 'verification-board'],
  ['visual-verification-board', 'verification-board'],
  ['alignment', 'alignment-board'],
  ['alignment-board', 'alignment-board'],
  ['alignment-guide-board', 'alignment-board'],
  ['grid-alignment', 'alignment-board'],
  ['grid-alignment-board', 'alignment-board'],
  ['visual-alignment-board', 'alignment-board'],
  ['center', 'centering-board'],
  ['centering', 'centering-board'],
  ['center-board', 'centering-board'],
  ['centering-board', 'centering-board'],
  ['center-evidence-board', 'centering-board'],
  ['visual-centering-board', 'centering-board'],
]);

export function visualCopyForLocale(locale) {
  return isChineseLocale(locale) ? VISUAL_COPY.zh : VISUAL_COPY.en;
}

export function localeFromOptions(options = {}) {
  return normalizeOutputLocale(options.locale ?? options.lang);
}

export function resolveBoardLocale(options = {}, payload = {}) {
  const explicit = options.locale ?? options.lang ?? payload.locale ?? payload.lang;
  if (explicit) {
    return normalizeOutputLocale(explicit);
  }
  return detectPrimaryLanguage(collectBoardVisibleTextEntries(payload).map((entry) => entry.value));
}

export function collectBoardVisibleTextEntries(value, basePath = '') {
  const entries = [];
  const visit = (node, pathKey) => {
    if (typeof node === 'string') {
      const key = pathKey.split('.').at(-1) ?? '';
      if (!NON_VISIBLE_BOARD_KEYS.has(key) && node.trim()) {
        entries.push({ path: pathKey || 'value', value: node.trim() });
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        visit(item, `${pathKey}.${index}`.replace(/^\./, ''));
      }
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, item] of Object.entries(node)) {
        if (NON_VISIBLE_BOARD_KEYS.has(key)) {
          continue;
        }
        visit(item, `${pathKey}.${key}`.replace(/^\./, ''));
      }
    }
  };
  visit(value, basePath);
  return entries;
}

export function validateBoardVisibleLanguage(board, locale) {
  if (!isChineseLocale(locale)) {
    return;
  }
  const offenders = collectBoardVisibleTextEntries(board.payload)
    .filter((entry) => isEnglishHeavyText(entry.value))
    .slice(0, 12);
  if (offenders.length === 0) {
    return;
  }
  const details = offenders
    .map((entry) => `- ${entry.path} 应跟随中文语境，当前内容偏英文: ${entry.value.slice(0, 96)}`)
    .join('\n');
  throw new Error(`Invalid visual board language for locale zh-CN:\n${details}`);
}

export function normalizeFormat(format, outPath) {
  const requested = String(format || '').trim().toLowerCase();
  if (requested) {
    if (!OUTPUT_FORMATS.has(requested)) {
      throw new Error(`Unsupported visual compare format: ${format}. Use jpg, png, or webp.`);
    }
    return requested === 'jpeg' ? 'jpg' : requested;
  }

  const ext = path.extname(String(outPath || '')).slice(1).toLowerCase();
  if (OUTPUT_FORMATS.has(ext)) {
    return ext === 'jpeg' ? 'jpg' : ext;
  }
  return 'jpg';
}

export function outputExtension(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

export function normalizeWorkspacePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

export function toWorkspacePath(projectRoot, filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizeWorkspacePath(relativePath);
  }
  return absolutePath;
}

export function resolveProjectPath(projectRoot, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

export function defaultOutputPath(projectRoot, format, mode) {
  const prefix = MODE_PREFIX[mode] ?? 'visual-compare';
  return path.join(
    projectRoot,
    '.openprd',
    'harness',
    'visual-reviews',
    `${prefix}-${compactTimestamp()}.${outputExtension(format)}`,
  );
}

export function parsePositiveInteger(value, fallback, label) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function parseQuality(value) {
  const quality = parsePositiveInteger(value, DEFAULT_QUALITY, '--quality');
  if (quality < 1 || quality > 100) {
    throw new Error('--quality must be between 1 and 100.');
  }
  return quality;
}

export function metadataPathForOutput(outputPath) {
  const ext = path.extname(outputPath);
  return ext ? outputPath.slice(0, -ext.length) + '.json' : `${outputPath}.json`;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function charCount(value) {
  return Array.from(String(value ?? '')).length;
}

export function compactLabel(value, maxChars = 14) {
  const chars = Array.from(String(value ?? ''));
  if (chars.length <= maxChars) {
    return chars.join('');
  }
  return `${chars.slice(0, Math.max(1, maxChars - 3)).join('')}...`;
}

export function wrapText(value, maxCharsPerLine) {
  const lines = [];
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return lines;
  }
  for (const rawLine of normalized.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    let buffer = '';
    for (const char of Array.from(line)) {
      if (charCount(buffer) >= maxCharsPerLine) {
        lines.push(buffer);
        buffer = '';
      }
      buffer += char;
    }
    if (buffer) {
      lines.push(buffer);
    }
  }
  return lines;
}

export function lineSvg(lines, {
  x = 0,
  y = 0,
  lineHeight = 24,
  fontSize = 18,
  fill = '#e5e7eb',
  fontWeight = 500,
} = {}) {
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" fill="${fill}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${escapeXml(line)}</text>`
  )).join('');
}

export const VISUAL_BOARD_PALETTE = Object.freeze({
  canvas: '#f4efe6',
  surface: '#fffdf8',
  ink: '#292722',
  muted: '#6f6a61',
  accent: '#c65f3f',
  success: '#39795c',
  border: '#d7cfc2',
});

export function labelSvg(label, options = {}) {
  const fontSize = options.fontSize ?? 22;
  const height = options.height ?? 46;
  const paddingX = options.paddingX ?? 21;
  const radius = options.radius ?? 14;
  const bg = options.background ?? VISUAL_BOARD_PALETTE.surface;
  const bgOpacity = options.backgroundOpacity ?? 0.94;
  const stroke = options.stroke ?? VISUAL_BOARD_PALETTE.border;
  const strokeOpacity = options.strokeOpacity ?? 1;
  const textColor = options.textColor ?? VISUAL_BOARD_PALETTE.ink;
  const maxWidth = Number.isFinite(Number(options.maxWidth)) ? Math.max(1, Number(options.maxWidth)) : Infinity;
  const minWidth = Math.min(options.minWidth ?? 126, maxWidth);
  const availableChars = Number.isFinite(maxWidth)
    ? Math.max(1, Math.floor((maxWidth - paddingX * 2) / Math.max(fontSize + 4, 1)))
    : charCount(label);
  const displayLabel = Number.isFinite(maxWidth) ? compactLabel(label, availableChars) : String(label ?? '');
  const text = escapeXml(displayLabel);
  const width = Math.min(maxWidth, Math.max(minWidth, charCount(displayLabel) * (fontSize + 4) + paddingX * 2));
  return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${bg}" fill-opacity="${bgOpacity}"/>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${Math.max(radius - 0.75, 1)}" fill="none" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="1.5"/>
  <text x="${paddingX}" y="${Math.round(height * 0.64)}" fill="${textColor}" font-size="${fontSize}" font-weight="700" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${text}</text>
</svg>`);
}

function compactEvidenceHeaderSvg(width, title, verdict = '') {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const hasVerdict = Boolean(String(verdict).trim());
  const verdictWidth = hasVerdict ? Math.min(132, Math.max(64, charCount(verdict) * 18 + 28)) : 0;
  const titleWidth = Math.max(120, contentWidth - verdictWidth - (hasVerdict ? 16 : 0));
  const titleLines = wrapText(title, Math.max(8, Math.floor(titleWidth / 18)));
  const height = Math.max(48, titleLines.length * 28 + 12);
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${lineSvg(titleLines, {
    x: 0,
    y: 28,
    lineHeight: 28,
    fontSize: 23,
    fill: VISUAL_BOARD_PALETTE.ink,
    fontWeight: 800,
  })}
  ${hasVerdict ? `<rect x="${contentWidth - verdictWidth}" y="6" width="${verdictWidth}" height="32" rx="16" fill="${VISUAL_BOARD_PALETTE.success}" fill-opacity="0.12"/><text x="${contentWidth - verdictWidth + 14}" y="28" fill="${VISUAL_BOARD_PALETTE.success}" font-size="16" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${escapeXml(verdict)}</text>` : ''}
</svg>`),
  };
}

export function titleBlockSvg(width, title, subtitle, eyebrow = null) {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const titleLines = wrapText(title, Math.max(12, Math.floor((contentWidth - 48) / 18)));
  const subtitleLines = wrapText(subtitle, Math.max(16, Math.floor((contentWidth - 48) / 16)));
  const eyebrowLines = wrapText(eyebrow, Math.max(18, Math.floor((contentWidth - 48) / 18)));
  let y = eyebrowLines.length > 0 ? 28 : 0;
  const parts = [];
  if (eyebrowLines.length > 0) {
    parts.push(lineSvg(eyebrowLines, {
      x: 0,
      y: y,
      lineHeight: 20,
      fontSize: 16,
      fill: VISUAL_BOARD_PALETTE.accent,
      fontWeight: 700,
    }));
    y += eyebrowLines.length * 20 + 14;
  }
  parts.push(lineSvg(titleLines, {
    x: 0,
    y: y + 30,
    lineHeight: 34,
    fontSize: 30,
    fill: VISUAL_BOARD_PALETTE.ink,
    fontWeight: 800,
  }));
  y += titleLines.length * 34 + 10;
  if (subtitleLines.length > 0) {
    parts.push(lineSvg(subtitleLines, {
      x: 0,
      y: y + 24,
      lineHeight: 24,
      fontSize: 18,
      fill: VISUAL_BOARD_PALETTE.muted,
      fontWeight: 500,
    }));
    y += subtitleLines.length * 24 + 6;
  }
  const height = Math.max(72, y + 16);
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${parts.join('')}
</svg>`),
  };
}

export function sectionHeaderSvg(width, index, label, reason = '') {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const titleLines = wrapText(`${index}. ${label}`, Math.max(10, Math.floor((contentWidth - 48) / 18)));
  const reasonLines = wrapText(reason, Math.max(14, Math.floor((contentWidth - 48) / 16)));
  const height = 32 + titleLines.length * 28 + (reasonLines.length > 0 ? 10 + reasonLines.length * 22 : 0);
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${contentWidth}" height="${height}" rx="18" fill="${VISUAL_BOARD_PALETTE.surface}"/>
  <rect x="0.75" y="0.75" width="${contentWidth - 1.5}" height="${height - 1.5}" rx="17.25" fill="none" stroke="${VISUAL_BOARD_PALETTE.border}" stroke-width="1.5"/>
  ${lineSvg(titleLines, {
    x: 20,
    y: 30,
    lineHeight: 28,
    fontSize: 24,
    fill: VISUAL_BOARD_PALETTE.ink,
    fontWeight: 800,
  })}
  ${reasonLines.length > 0 ? lineSvg(reasonLines, {
    x: 20,
    y: 30 + titleLines.length * 28 + 10,
    lineHeight: 22,
    fontSize: 16,
    fill: VISUAL_BOARD_PALETTE.muted,
    fontWeight: 500,
  }) : ''}
</svg>`),
  };
}

export function metricsSvg(width, metrics = [], notes = null, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const contentWidth = Math.max(Number(width) || 0, 1);
  const lines = [];
  for (const metric of metrics) {
    lines.push(`${metric.label}${copy.separator}${metric.value}`);
  }
  if (notes) {
    lines.push(...wrapText(notes, Math.max(12, Math.floor((contentWidth - 24) / 16))));
  }
  if (lines.length === 0) {
    return { height: 0, input: null };
  }
  const height = 18 + lines.length * 22;
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${lineSvg(lines, {
    x: 0,
    y: 20,
    lineHeight: 22,
    fontSize: 16,
    fill: VISUAL_BOARD_PALETTE.muted,
    fontWeight: 500,
  })}
</svg>`),
  };
}

export async function resizePanel(inputPath, panelWidth) {
  const source = path.resolve(inputPath);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Cannot read image dimensions: ${inputPath}`);
  }
  const { data, info } = await sharp(source)
    .rotate()
    .resize({
      width: panelWidth,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    original: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format ?? null,
    },
  };
}

export async function extractCrop(inputPath, box, outputWidth) {
  const source = path.resolve(inputPath);
  const { data, info } = await sharp(source)
    .rotate()
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    })
    .resize({
      width: outputWidth,
      fit: 'inside',
      withoutEnlargement: false,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    absolute: box,
  };
}

export async function extractCropAtScale(inputPath, box, scale = 1) {
  const source = path.resolve(inputPath);
  const normalizedScale = Number(scale);
  if (!Number.isFinite(normalizedScale) || normalizedScale <= 0) {
    throw new Error('Crop scale must be a positive number.');
  }
  const width = Math.max(1, Math.round(box.width * normalizedScale));
  const height = Math.max(1, Math.round(box.height * normalizedScale));
  let image = sharp(source)
    .rotate()
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    });
  if (width !== box.width || height !== box.height) {
    image = image.resize({ width, height, fit: 'fill' });
  }
  const { data, info } = await image.png().toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    absolute: box,
    scale: normalizedScale,
    stretched: false,
  };
}

export function parseCropBoxInput(value, label = 'crop box') {
  if (value && typeof value === 'object') {
    return value;
  }
  const source = String(value ?? '').trim();
  if (!source) {
    return null;
  }
  const unitMatch = source.match(/^(px|pixel|pixels|ratio|percent):(.+)$/i);
  const unit = unitMatch ? unitMatch[1].toLowerCase() : 'px';
  const dimensions = (unitMatch ? unitMatch[2] : source)
    .split(',')
    .map((item) => Number(item.trim()));
  if (dimensions.length !== 4 || dimensions.some((item) => !Number.isFinite(item))) {
    throw new Error(`${label} must use x,y,width,height, optionally prefixed with px:, ratio:, or percent:.`);
  }
  const [x, y, width, height] = dimensions;
  if (width <= 0 || height <= 0) {
    throw new Error(`${label} width and height must be positive.`);
  }
  return {
    unit: unit === 'pixel' || unit === 'pixels' ? 'px' : unit,
    x,
    y,
    width,
    height,
  };
}

export function encodePipeline(image, format, quality) {
  if (format === 'png') {
    return image.png();
  }
  if (format === 'webp') {
    return image.webp({ quality });
  }
  return image.jpeg({ quality });
}

export function resolveComparisonInputs(options) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const hasReferenceActual = Boolean(options.reference || options.actual);
  const hasBeforeAfter = Boolean(options.before || options.after);
  const hasBoard = Boolean(options.board);
  const modeCount = [hasReferenceActual, hasBeforeAfter, hasBoard].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error('Use either --reference/--actual, --before/--after, or --board, not multiple modes together.');
  }
  if (hasBeforeAfter) {
    if (!options.before) {
      throw new Error('Missing --before image path.');
    }
    if (!options.after) {
      throw new Error('Missing --after image path.');
    }
    return {
      mode: 'before-after',
      locale,
      left: options.before,
      right: options.after,
      leftLabel: options.referenceLabel || copy.beforeLabel,
      rightLabel: options.actualLabel || copy.afterLabel,
      eyebrow: copy.beforeAfterEyebrow,
      nextActions: copy.beforeAfterNextActions,
    };
  }
  if (hasReferenceActual) {
    if (!options.reference) {
      throw new Error('Missing --reference image path.');
    }
    if (!options.actual) {
      throw new Error('Missing --actual image path.');
    }
    return {
      mode: 'reference-actual',
      locale,
      left: options.reference,
      right: options.actual,
      leftLabel: options.referenceLabel || copy.referenceLabel,
      rightLabel: options.actualLabel || copy.actualLabel,
      eyebrow: copy.referenceEyebrow,
      nextActions: copy.referenceNextActions,
    };
  }
  if (hasBoard) {
    return {
      mode: 'board',
      board: options.board,
    };
  }
  throw new Error('Missing visual compare input. Use --reference/--actual, --before/--after, or --board.');
}

export function normalizeBoardMode(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return BOARD_MODE_ALIASES.get(key) ?? null;
}

export async function readBoardSpec(projectRoot, boardPath) {
  const sourcePath = resolveProjectPath(projectRoot, boardPath);
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const mode = normalizeBoardMode(payload.mode);
  if (!mode) {
    throw new Error(`Unsupported board mode in ${boardPath}. Use focus-board, parallel-board, verification-board, alignment-board, or centering-board.`);
  }
  return {
    mode,
    sourcePath,
    payload,
  };
}

export function normalizeImageSpec(projectRoot, value, fallbackLabel) {
  if (!value) {
    throw new Error('Board image spec is missing.');
  }
  if (typeof value === 'string') {
    return {
      path: resolveProjectPath(projectRoot, value),
      label: fallbackLabel,
    };
  }
  if (typeof value === 'object' && value.path) {
    return {
      path: resolveProjectPath(projectRoot, value.path),
      label: value.label ? String(value.label) : fallbackLabel,
    };
  }
  throw new Error('Board image spec must be a path string or an object with { path, label? }.');
}

export function normalizeMetricList(metrics, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (!metrics) {
    return [];
  }
  if (Array.isArray(metrics)) {
    return metrics
      .filter(Boolean)
      .map((item) => {
        if (typeof item === 'string') {
          return { label: copy.metricTextLabel, value: item };
        }
        return {
          label: String(item.label ?? item.key ?? copy.metricFallbackLabel),
          value: String(item.value ?? ''),
        };
      })
      .filter((item) => item.value.trim());
  }
  if (typeof metrics === 'object') {
    return Object.entries(metrics)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim())
      .map(([key, value]) => ({ label: key, value: String(value) }));
  }
  return [];
}

export function normalizeMediaList(projectRoot, media, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (!Array.isArray(media)) {
    return [];
  }
  return media
    .filter(Boolean)
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          path: resolveProjectPath(projectRoot, entry),
          label: copy.materialLabel(index),
        };
      }
      if (!entry.path) {
        throw new Error(`Parallel board media[${index}] is missing path.`);
      }
      return {
        path: resolveProjectPath(projectRoot, entry.path),
        label: String(entry.label ?? copy.materialLabel(index)),
      };
    });
}

export function normalizeVerificationItems(projectRoot, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  let rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0 && Array.isArray(payload.screenshots)) {
    rawItems = payload.screenshots;
  }
  if (rawItems.length === 0) {
    const singlePath = payload.screenshot ?? payload.actual ?? payload.path;
    if (singlePath) {
      rawItems = [{
        path: singlePath,
        label: payload.label ?? copy.verificationSingleLabel,
        notes: payload.notes ?? payload.note ?? payload.summary,
        checks: payload.checks ?? payload.checkpoints,
      }];
    }
  }
  return rawItems.map((item, index) => {
    if (typeof item === 'string') {
      return {
        label: copy.verificationItemLabel(index),
        subtitle: '',
        verdict: '',
        media: [{ path: item, label: copy.verificationSingleLabel }],
        metrics: [],
        notes: '',
      };
    }
    const media = Array.isArray(item.media) && item.media.length > 0
      ? item.media
      : (item.path ? [{ path: item.path, label: item.mediaLabel ?? item.label ?? copy.verificationMediaLabel(index) }] : []);
    return {
      label: String(item.label ?? item.title ?? copy.verificationItemLabel(index)),
      subtitle: String(item.subtitle ?? item.route ?? item.step ?? '').trim(),
      verdict: String(item.verdict ?? item.status ?? '').trim(),
      media,
      metrics: item.metrics ?? item.checks ?? item.checkpoints,
      notes: String(item.notes ?? item.note ?? item.expected ?? '').trim(),
    };
  });
}

export function parseCropDimension(box, key, alias) {
  const primary = box[key];
  const secondary = alias ? box[alias] : undefined;
  const value = primary ?? secondary;
  if (value === null || value === undefined || value === '') {
    throw new Error(`Missing ${key} in focus region box.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${key} in focus region box.`);
  }
  return parsed;
}

export function clampBox(box, original) {
  const x = Math.max(0, Math.min(box.x, original.width - 1));
  const y = Math.max(0, Math.min(box.y, original.height - 1));
  const width = Math.max(1, Math.min(box.width, original.width - x));
  const height = Math.max(1, Math.min(box.height, original.height - y));
  return {
    x,
    y,
    width,
    height,
  };
}

export function resolveCropBox(box, original) {
  if (!box || typeof box !== 'object') {
    throw new Error('Focus region box must be an object.');
  }
  const rawUnit = String(box.unit ?? 'ratio').trim().toLowerCase();
  const x = parseCropDimension(box, 'x', 'left');
  const y = parseCropDimension(box, 'y', 'top');
  const width = parseCropDimension(box, 'width', 'w');
  const height = parseCropDimension(box, 'height', 'h');
  let absolute;

  if (rawUnit === 'ratio') {
    absolute = {
      x: Math.round(x * original.width),
      y: Math.round(y * original.height),
      width: Math.round(width * original.width),
      height: Math.round(height * original.height),
    };
  } else if (rawUnit === 'percent') {
    absolute = {
      x: Math.round((x / 100) * original.width),
      y: Math.round((y / 100) * original.height),
      width: Math.round((width / 100) * original.width),
      height: Math.round((height / 100) * original.height),
    };
  } else if (rawUnit === 'px' || rawUnit === 'pixel' || rawUnit === 'pixels') {
    absolute = {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
    };
  } else {
    throw new Error(`Unsupported focus region unit: ${rawUnit}. Use ratio, percent, or px.`);
  }

  return {
    unit: rawUnit === 'pixel' || rawUnit === 'pixels' ? 'px' : rawUnit,
    requested: { x, y, width, height },
    absolute: clampBox(absolute, original),
  };
}

export function renderedBoxFromAbsolute(box, panel) {
  const scaleX = panel.width / panel.original.width;
  const scaleY = panel.height / panel.original.height;
  return {
    x: Math.round(box.x * scaleX),
    y: Math.round(box.y * scaleY),
    width: Math.max(2, Math.round(box.width * scaleX)),
    height: Math.max(2, Math.round(box.height * scaleY)),
  };
}

export function focusOverlaySvg(width, height, regions) {
  const overlays = regions.map((region, index) => {
    const color = region.color;
    const box = region.box;
    const badgeSize = 32;
    const badgeX = Math.max(10, box.x + 10);
    const badgeY = Math.max(10, box.y + 10);
    return `
      <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="16" fill="none" stroke="${color}" stroke-width="4"/>
      <rect x="${badgeX}" y="${badgeY}" width="${badgeSize}" height="${badgeSize}" rx="16" fill="${color}"/>
      <text x="${badgeX + 10}" y="${badgeY + 22}" fill="#0f172a" font-size="18" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${index + 1}</text>
    `;
  }).join('');
  return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  ${overlays}
</svg>`);
}


export async function renderParallelCard(projectRoot, item, index, options = {}) {
  const cardWidth = options.cardWidth;
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const contentWidth = cardWidth - 36;
  const title = String(item.label ?? item.title ?? copy.parallelItemLabel(index));
  const subtitle = String(item.subtitle ?? item.summary ?? '').trim();
  const verdict = String(item.verdict ?? '').trim();
  const mediaList = normalizeMediaList(projectRoot, item.media, locale);
  const metrics = normalizeMetricList(item.metrics ?? item.metricMap, locale);
  const notes = String(item.notes ?? item.note ?? '').trim();
  const compactEvidence = options.compactEvidence === true;
  const header = compactEvidence
    ? compactEvidenceHeaderSvg(contentWidth, title, verdict)
    : titleBlockSvg(
      contentWidth,
      `${index + 1}. ${title}`,
      subtitle,
      verdict ? `${copy.resultPrefix}${copy.separator}${verdict}` : (options.eyebrow ?? copy.parallelEyebrow),
    );
  const composites = [
    { input: header.input, left: 18, top: 18 },
  ];
  const renderedMedia = [];
  let currentTop = 18 + header.height + 12;

  for (const media of mediaList) {
    const label = compactEvidence ? null : labelSvg(media.label, {
      fontSize: 16,
      height: 36,
      minWidth: 96,
      maxWidth: contentWidth,
      paddingX: 16,
      radius: 12,
    });
    const mediaPanel = await resizePanel(media.path, contentWidth);
    const mediaTop = compactEvidence ? currentTop : currentTop + 42;
    if (label) {
      composites.push({ input: label, left: 18, top: currentTop });
    }
    composites.push({ input: mediaPanel.input, left: 18 + Math.round((contentWidth - mediaPanel.width) / 2), top: mediaTop });
    renderedMedia.push({
      path: toWorkspacePath(projectRoot, media.path),
      label: media.label,
      original: mediaPanel.original,
      rendered: {
        width: mediaPanel.width,
        height: mediaPanel.height,
      },
    });
    currentTop = mediaTop + mediaPanel.height + (compactEvidence ? 12 : 16);
  }

  const metricsBlock = metricsSvg(contentWidth, metrics, notes, locale);
  if (metricsBlock.input) {
    composites.push({ input: metricsBlock.input, left: 18, top: currentTop });
    currentTop += metricsBlock.height + 12;
  }

  const cardHeight = currentTop + 18;
  const card = sharp({
    create: {
      width: cardWidth,
      height: cardHeight,
      channels: 3,
      background: VISUAL_BOARD_PALETTE.surface,
    },
  }).composite([
    ...composites,
    {
      input: Buffer.from(`
<svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="${cardWidth - 1.5}" height="${cardHeight - 1.5}" rx="18" fill="none" stroke="${VISUAL_BOARD_PALETTE.border}" stroke-width="1.5"/>
</svg>`),
      left: 0,
      top: 0,
    },
  ]);

  return {
    image: await card.png().toBuffer(),
    width: cardWidth,
    height: cardHeight,
    item: {
      index: index + 1,
      label: title,
      subtitle,
      level: item.level ?? '',
      levelLabel: item.levelLabel ?? '',
      verdict,
      metrics,
      notes,
      media: renderedMedia,
    },
  };
}
