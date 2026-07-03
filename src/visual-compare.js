import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VISUAL_REVIEW_SCHEMA } from './quality-visual-review.js';
import { compactTimestamp, timestamp } from './time.js';
import {
  OPENPRD_FALLBACK_LOCALE,
  detectPrimaryLanguage,
  isChineseLocale,
  isEnglishHeavyText,
  normalizeOutputLocale,
} from './language-policy.js';
import {
  ALIGNMENT_CONTAINER_TOKENS,
  ALIGNMENT_CONTENT_SLOT_TOKENS,
  DEFAULT_PANEL_WIDTH,
  DEFAULT_PARALLEL_CARD_WIDTH,
  DEFAULT_PARALLEL_COLUMNS,
  FOCUS_COLORS,
  defaultOutputPath,
  encodePipeline,
  escapeXml,
  extractCrop,
  focusOverlaySvg,
  labelSvg,
  localeFromOptions,
  metadataPathForOutput,
  normalizeFormat,
  normalizeImageSpec,
  normalizeMetricList,
  normalizeVerificationItems,
  parsePositiveInteger,
  parseQuality,
  readBoardSpec,
  renderParallelCard,
  renderedBoxFromAbsolute,
  resizePanel,
  resolveBoardLocale,
  resolveComparisonInputs,
  resolveCropBox,
  sectionHeaderSvg,
  titleBlockSvg,
  toWorkspacePath,
  validateBoardVisibleLanguage,
  visualCopyForLocale,
} from './visual-compare-core.js';
import { renderCenteringBoard } from './visual-compare-centering.js';

async function renderStandardComparison(projectRoot, comparison, options = {}) {
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, comparison.mode);
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const referencePanel = await resizePanel(comparison.left, maxPanelWidth);
  const actualPanel = await resizePanel(comparison.right, maxPanelWidth);
  const panelWidth = Math.min(maxPanelWidth, Math.max(referencePanel.width, actualPanel.width));
  const maxPanelHeight = Math.max(referencePanel.height, actualPanel.height);
  const margin = 24;
  const gap = 24;
  const canvasWidth = margin * 2 + panelWidth * 2 + gap;
  const canvasHeight = margin * 2 + maxPanelHeight;
  const leftPanelX = margin;
  const rightPanelX = margin + panelWidth + gap;
  const top = margin;

  const referenceLeft = leftPanelX + Math.round((panelWidth - referencePanel.width) / 2);
  const actualLeft = rightPanelX + Math.round((panelWidth - actualPanel.width) / 2);
  const referenceTop = top + Math.round((maxPanelHeight - referencePanel.height) / 2);
  const actualTop = top + Math.round((maxPanelHeight - actualPanel.height) / 2);

  const canvas = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite([
    { input: referencePanel.input, left: referenceLeft, top: referenceTop },
    { input: actualPanel.input, left: actualLeft, top: actualTop },
    { input: labelSvg(comparison.leftLabel, { maxWidth: Math.max(32, referencePanel.width - 32) }), left: referenceLeft + 16, top: referenceTop + 16 },
    { input: labelSvg(comparison.rightLabel, { maxWidth: Math.max(32, actualPanel.width - 32) }), left: actualLeft + 16, top: actualTop + 16 },
  ]);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: comparison.mode,
    locale: comparison.locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    labels: {
      reference: comparison.leftLabel,
      actual: comparison.rightLabel,
    },
    reference: {
      path: toWorkspacePath(projectRoot, referencePanel.source),
      original: referencePanel.original,
      rendered: {
        width: referencePanel.width,
        height: referencePanel.height,
      },
    },
    actual: {
      path: toWorkspacePath(projectRoot, actualPanel.source),
      original: actualPanel.original,
      rendered: {
        width: actualPanel.width,
        height: actualPanel.height,
      },
    },
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: comparison.mode,
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    maxPanelWidth,
    labels: {
      reference: comparison.leftLabel,
      actual: comparison.rightLabel,
    },
    reference: {
      path: referencePanel.source,
      original: referencePanel.original,
      rendered: {
        width: referencePanel.width,
        height: referencePanel.height,
      },
    },
    actual: {
      path: actualPanel.source,
      original: actualPanel.original,
      rendered: {
        width: actualPanel.width,
        height: actualPanel.height,
      },
    },
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
    reviewArtifact,
    nextActions: comparison.nextActions,
  };
}

async function renderFocusBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'focus-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const leftSpec = normalizeImageSpec(projectRoot, board.payload.left ?? board.payload.reference, board.payload.leftLabel ?? copy.referenceLabel);
  const rightSpec = normalizeImageSpec(projectRoot, board.payload.right ?? board.payload.actual, board.payload.rightLabel ?? copy.actualLabel);
  const focusRegions = Array.isArray(board.payload.focusRegions ?? board.payload.regions) ? (board.payload.focusRegions ?? board.payload.regions) : [];
  if (focusRegions.length === 0) {
    throw new Error('Focus board requires focusRegions with at least one region.');
  }

  const leftPanel = await resizePanel(leftSpec.path, maxPanelWidth);
  const rightPanel = await resizePanel(rightSpec.path, maxPanelWidth);
  const panelWidth = Math.min(maxPanelWidth, Math.max(leftPanel.width, rightPanel.width));
  const overviewHeight = Math.max(leftPanel.height, rightPanel.height);
  const margin = 24;
  const gap = 24;
  const sectionGap = 28;
  const contentWidth = margin * 2 + panelWidth * 2 + gap;
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? copy.focusTitle),
    String(board.payload.summary ?? copy.focusSummary),
    copy.focusEyebrow,
  );

  const leftOverviewX = margin + Math.round((panelWidth - leftPanel.width) / 2);
  const rightOverviewX = margin + panelWidth + gap + Math.round((panelWidth - rightPanel.width) / 2);
  const overviewTop = margin + titleBlock.height + 18;
  const leftOverviewY = overviewTop + Math.round((overviewHeight - leftPanel.height) / 2);
  const rightOverviewY = overviewTop + Math.round((overviewHeight - rightPanel.height) / 2);

  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: leftPanel.input, left: leftOverviewX, top: leftOverviewY },
    { input: rightPanel.input, left: rightOverviewX, top: rightOverviewY },
    { input: labelSvg(leftSpec.label, { maxWidth: Math.max(32, leftPanel.width - 32) }), left: leftOverviewX + 16, top: leftOverviewY + 16 },
    { input: labelSvg(rightSpec.label, { maxWidth: Math.max(32, rightPanel.width - 32) }), left: rightOverviewX + 16, top: rightOverviewY + 16 },
  ];

  const metadataRegions = [];
  const leftOverlayRegions = [];
  const rightOverlayRegions = [];
  let currentTop = overviewTop + overviewHeight + sectionGap;

  for (const [index, region] of focusRegions.entries()) {
    const label = String(region.label ?? region.name ?? copy.focusRegionLabel(index));
    const reason = String(region.reason ?? region.note ?? '').trim();
    const color = FOCUS_COLORS[index % FOCUS_COLORS.length];
    const leftResolved = resolveCropBox(region.leftBox ?? region.referenceBox ?? region.box, leftPanel.original);
    const rightResolved = resolveCropBox(region.rightBox ?? region.actualBox ?? region.box, rightPanel.original);
    const leftRenderedBox = renderedBoxFromAbsolute(leftResolved.absolute, leftPanel);
    const rightRenderedBox = renderedBoxFromAbsolute(rightResolved.absolute, rightPanel);
    const leftCrop = await extractCrop(leftPanel.source, leftResolved.absolute, panelWidth);
    const rightCrop = await extractCrop(rightPanel.source, rightResolved.absolute, panelWidth);
    const header = sectionHeaderSvg(contentWidth - margin * 2, index + 1, label, reason);
    const cropTop = currentTop + header.height + 12;
    const cropHeight = Math.max(leftCrop.height, rightCrop.height);
    const leftCropX = margin + Math.round((panelWidth - leftCrop.width) / 2);
    const rightCropX = margin + panelWidth + gap + Math.round((panelWidth - rightCrop.width) / 2);
    const leftCropY = cropTop + Math.round((cropHeight - leftCrop.height) / 2);
    const rightCropY = cropTop + Math.round((cropHeight - rightCrop.height) / 2);

    composites.push(
      { input: header.input, left: margin, top: currentTop },
      { input: leftCrop.input, left: leftCropX, top: leftCropY },
      { input: rightCrop.input, left: rightCropX, top: rightCropY },
      { input: labelSvg(leftSpec.label, { fontSize: 18, height: 40, minWidth: 112, maxWidth: Math.max(32, leftCrop.width - 24) }), left: leftCropX + 12, top: leftCropY + 12 },
      { input: labelSvg(rightSpec.label, { fontSize: 18, height: 40, minWidth: 112, maxWidth: Math.max(32, rightCrop.width - 24) }), left: rightCropX + 12, top: rightCropY + 12 },
    );
    leftOverlayRegions.push({ color, box: leftRenderedBox });
    rightOverlayRegions.push({ color, box: rightRenderedBox });
    metadataRegions.push({
      index: index + 1,
      label,
      reason,
      color,
      leftBox: {
        unit: leftResolved.unit,
        requested: leftResolved.requested,
        absolute: leftResolved.absolute,
        rendered: leftRenderedBox,
      },
      rightBox: {
        unit: rightResolved.unit,
        requested: rightResolved.requested,
        absolute: rightResolved.absolute,
        rendered: rightRenderedBox,
      },
      leftCrop: {
        width: leftCrop.width,
        height: leftCrop.height,
      },
      rightCrop: {
        width: rightCrop.width,
        height: rightCrop.height,
      },
    });
    currentTop = cropTop + cropHeight + sectionGap;
  }

  composites.push(
    { input: focusOverlaySvg(leftPanel.width, leftPanel.height, leftOverlayRegions), left: leftOverviewX, top: leftOverviewY },
    { input: focusOverlaySvg(rightPanel.width, rightPanel.height, rightOverlayRegions), left: rightOverviewX, top: rightOverviewY },
  );

  const canvasHeight = currentTop + margin - sectionGap;
  const canvas = sharp({
    create: {
      width: contentWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'focus-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.focusTitle),
    labels: {
      reference: leftSpec.label,
      actual: rightSpec.label,
    },
    reference: {
      path: toWorkspacePath(projectRoot, leftPanel.source),
      original: leftPanel.original,
      rendered: {
        width: leftPanel.width,
        height: leftPanel.height,
      },
    },
    actual: {
      path: toWorkspacePath(projectRoot, rightPanel.source),
      original: rightPanel.original,
      rendered: {
        width: rightPanel.width,
        height: rightPanel.height,
      },
    },
    focusRegions: metadataRegions,
    canvas: {
      width: contentWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'focus-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    maxPanelWidth,
    labels: reviewArtifact.labels,
    reference: reviewArtifact.reference,
    actual: reviewArtifact.actual,
    focusRegions: metadataRegions,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    nextActions: copy.focusNextActions,
  };
}

async function renderParallelBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'parallel-board');
  const quality = parseQuality(options.quality);
  const items = Array.isArray(board.payload.items) ? board.payload.items : [];
  if (items.length === 0) {
    throw new Error('Parallel board requires items with at least one experiment.');
  }
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, items.length), 'columns'), 4));
  const margin = 24;
  const gap = 24;
  const titleBlock = titleBlockSvg(
    columns * cardWidth + (columns - 1) * gap,
    String(board.payload.title ?? copy.parallelTitle),
    String(board.payload.summary ?? copy.parallelSummary),
    copy.parallelEyebrow,
  );

  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, item, index, { cardWidth, locale }));
  }

  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  const canvasWidth = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const canvasHeight = margin * 2 + titleBlock.height + 18 + rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowHeights.length - 1) * gap;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
  ];
  let currentTop = margin + titleBlock.height + 18;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowCards = renderedCards.slice(row * columns, row * columns + columns);
    for (const [column, card] of rowCards.entries()) {
      composites.push({
        input: card.image,
        left: margin + column * (cardWidth + gap),
        top: currentTop,
      });
    }
    currentTop += rowHeights[row] + gap;
  }

  const canvas = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'parallel-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.parallelTitle),
    layout: {
      columns,
      cardWidth,
      rowCount: rowHeights.length,
    },
    items: renderedCards.map((card) => card.item),
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'parallel-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    items: reviewArtifact.items,
    nextActions: copy.parallelNextActions,
  };
}

async function renderVerificationBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'verification-board');
  const quality = parseQuality(options.quality);
  const items = normalizeVerificationItems(projectRoot, board.payload, locale);
  if (items.length === 0) {
    throw new Error('Verification board requires screenshots, items, or a single screenshot/path entry.');
  }
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, items.length), 'columns'), 4));
  const margin = 24;
  const gap = 24;
  const route = String(board.payload.route ?? board.payload.flow ?? board.payload.method ?? '').trim();
  const summary = String(board.payload.summary ?? copy.verificationSummary(route));
  const titleBlock = titleBlockSvg(
    columns * cardWidth + (columns - 1) * gap,
    String(board.payload.title ?? copy.verificationTitle),
    summary,
    copy.verificationEyebrow,
  );

  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, item, index, {
      cardWidth,
      eyebrow: copy.verificationCardEyebrow,
      locale,
    }));
  }

  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  const canvasWidth = margin * 2 + columns * cardWidth + (columns - 1) * gap;
  const canvasHeight = margin * 2 + titleBlock.height + 18 + rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowHeights.length - 1) * gap;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
  ];
  let currentTop = margin + titleBlock.height + 18;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowCards = renderedCards.slice(row * columns, row * columns + columns);
    for (const [column, card] of rowCards.entries()) {
      composites.push({
        input: card.image,
        left: margin + column * (cardWidth + gap),
        top: currentTop,
      });
    }
    currentTop += rowHeights[row] + gap;
  }

  const canvas = sharp({
    create: {
      width: canvasWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'verification-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.verificationTitle),
    route: route || null,
    layout: {
      columns,
      cardWidth,
      rowCount: rowHeights.length,
    },
    items: renderedCards.map((card) => card.item),
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'verification-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    items: reviewArtifact.items,
    nextActions: copy.verificationNextActions,
  };
}

function normalizeAlignmentGroups(payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const groupEntries = normalizeAlignmentGroupEntries(payload);
  const defaultThreshold = payload.thresholdPx ?? payload.threshold ?? 2;
  return groupEntries.map(({ group, fallbackLevel }, index) => {
    const threshold = group.thresholdPx ?? group.threshold ?? defaultThreshold;
    const metrics = normalizeAlignmentMetrics(group.metrics ?? group.measurements ?? group.checks, threshold, locale);
    const expected = String(group.expected ?? group.expectation ?? '').trim();
    const pattern = String(group.pattern ?? group.structure ?? '').trim();
    const level = normalizeAlignmentLevel(group.level ?? group.kind ?? group.type ?? group.scopeKind)
      ?? fallbackLevel
      ?? inferAlignmentLevel([group.label, group.title, group.subtitle, group.scope, pattern, expected, ...metrics.map((metric) => metric.label)].join(' '));
    const levelLabel = alignmentLevelLabel(level, locale);
    const notes = [
      expected ? `${copy.alignmentExpectedPrefix}${copy.separator}${expected}` : '',
      pattern ? `${copy.alignmentStructurePrefix}${copy.separator}${pattern}` : '',
      String(group.notes ?? group.note ?? '').trim(),
    ].filter(Boolean).join('\n');
    const subtitle = [
      levelLabel,
      String(group.subtitle ?? group.scope ?? group.selector ?? '').trim(),
    ].filter(Boolean).join(' / ');
    return {
      label: String(group.label ?? group.title ?? copy.alignmentGroupLabel(index)),
      subtitle,
      level,
      levelLabel,
      verdict: String(group.verdict ?? group.status ?? '').trim(),
      metrics,
      notes,
    };
  });
}

function normalizeAlignmentGroupEntries(payload) {
  const entries = [];
  const add = (groups, fallbackLevel) => {
    if (!Array.isArray(groups)) {
      return;
    }
    for (const group of groups) {
      if (group) {
        entries.push({ group, fallbackLevel });
      }
    }
  };
  if (Array.isArray(payload.groups)) {
    add(payload.groups, null);
  } else {
    add(payload.items, null);
  }
  add(payload.containerGroups ?? payload.containerTracks, 'container');
  add(payload.contentSlots ?? payload.slotGroups ?? payload.contentSlotGroups ?? payload.internalSlots, 'content-slot');
  return entries;
}

function normalizeAlignmentLevel(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (['container', 'outer', 'outer-frame', 'frame', 'grid', '容器', '外框', '网格'].includes(normalized)) {
    return 'container';
  }
  if (['content', 'content-slot', 'internal', 'internal-slot', 'slot', 'same-slot', '内容', '内容槽位', '内部槽位', '槽位'].includes(normalized)) {
    return 'content-slot';
  }
  return null;
}

function alignmentLevelLabel(level, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (level === 'container') {
    return copy.alignmentContainerLevel;
  }
  if (level === 'content-slot') {
    return copy.alignmentContentSlotLevel;
  }
  return '';
}

function inferAlignmentLevel(text) {
  const normalized = String(text ?? '').toLowerCase();
  if (ALIGNMENT_CONTENT_SLOT_TOKENS.some((token) => normalized.includes(String(token).toLowerCase()))) {
    return 'content-slot';
  }
  if (ALIGNMENT_CONTAINER_TOKENS.some((token) => normalized.includes(String(token).toLowerCase()))) {
    return 'container';
  }
  return 'custom';
}

function summarizeAlignmentScope(groups) {
  return {
    containerGroups: groups.filter((group) => group.level === 'container').map((group) => group.label),
    contentSlotGroups: groups.filter((group) => group.level === 'content-slot').map((group) => group.label),
  };
}

function normalizeAlignmentMetrics(metrics, threshold, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  if (!Array.isArray(metrics)) {
    return normalizeMetricList(metrics, locale);
  }
  return metrics
    .filter(Boolean)
    .flatMap((metric) => {
      if (typeof metric === 'string') {
        return [{ label: copy.metricTextLabel, value: metric }];
      }
      const label = String(metric.label ?? metric.name ?? metric.key ?? copy.alignmentItemLabel);
      const values = Array.isArray(metric.values)
        ? metric.values.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [];
      const metricThreshold = metric.thresholdPx ?? metric.threshold ?? threshold;
      const spread = metric.spreadPx ?? metric.spread ?? (
        values.length > 0 ? Math.max(...values) - Math.min(...values) : null
      );
      const parts = [];
      if (values.length > 0) {
        parts.push(`${values.join(', ')}px`);
      } else if (metric.value !== null && metric.value !== undefined) {
        parts.push(String(metric.value));
      }
      if (spread !== null && spread !== undefined && spread !== '') {
        const verdict = metric.verdict ?? metric.status ?? (
          Number(spread) <= Number(metricThreshold) ? copy.passVerdict : copy.reworkVerdict
        );
        parts.push(`spread=${spread}px`);
        if (metricThreshold !== null && metricThreshold !== undefined && metricThreshold !== '') {
          parts.push(`${copy.alignmentThresholdLabel}=${metricThreshold}px`);
        }
        parts.push(String(verdict));
      }
      return [{
        label,
        value: parts.filter(Boolean).join(' / '),
      }];
    })
    .filter((metric) => metric.value.trim());
}

function normalizeAlignmentGuides(payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const rawGuides = Array.isArray(payload.guides)
    ? payload.guides
    : (Array.isArray(payload.lines) ? payload.lines : []);
  return rawGuides
    .filter(Boolean)
    .map((guide, index) => ({
      ...guide,
      label: String(guide.label ?? guide.name ?? copy.alignmentGuideLabel(index)),
      color: String(guide.color ?? FOCUS_COLORS[index % FOCUS_COLORS.length]),
    }));
}

function normalizeAlignmentBoxes(payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const rawBoxes = Array.isArray(payload.boxes)
    ? payload.boxes
    : (Array.isArray(payload.regions) ? payload.regions : []);
  return rawBoxes
    .filter(Boolean)
    .map((box, index) => ({
      ...box,
      label: String(box.label ?? box.name ?? copy.alignmentRegionLabel(index)),
      color: String(box.color ?? FOCUS_COLORS[index % FOCUS_COLORS.length]),
    }));
}

function resolveGuideAxis(guide) {
  const raw = String(guide.axis ?? guide.orientation ?? '').trim().toLowerCase();
  if (['x', 'vertical', 'v', 'left', 'right', 'column'].includes(raw)) {
    return 'x';
  }
  if (['y', 'horizontal', 'h', 'top', 'bottom', 'row', 'baseline'].includes(raw)) {
    return 'y';
  }
  if (guide.x !== null && guide.x !== undefined) {
    return 'x';
  }
  return 'y';
}

function resolveGuidePosition(guide, axis, original) {
  const raw = guide.position ?? guide.value ?? (axis === 'x' ? (guide.x ?? guide.left) : (guide.y ?? guide.top));
  if (raw === null || raw === undefined || raw === '') {
    throw new Error(`Alignment guide "${guide.label}" is missing position.`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Alignment guide "${guide.label}" has invalid position.`);
  }
  const max = axis === 'x' ? original.width : original.height;
  const unit = String(guide.unit ?? 'px').trim().toLowerCase();
  if (unit === 'ratio') {
    return Math.round(value * max);
  }
  if (unit === 'percent') {
    return Math.round((value / 100) * max);
  }
  return Math.round(value);
}

function alignmentGuideOverlaySvg(panel, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const guides = normalizeAlignmentGuides(payload, locale);
  const boxes = normalizeAlignmentBoxes(payload, locale);
  const guideSvg = guides.map((guide, index) => {
    const axis = resolveGuideAxis(guide);
    const absolute = resolveGuidePosition(guide, axis, panel.original);
    const color = escapeXml(guide.color);
    const label = escapeXml(guide.label);
    if (axis === 'x') {
      const x = Math.round(absolute * (panel.width / panel.original.width));
      const labelY = 28 + (index % 5) * 28;
      return `
        <line x1="${x}" y1="0" x2="${x}" y2="${panel.height}" stroke="${color}" stroke-width="2.5" stroke-dasharray="10 8"/>
        <rect x="${Math.min(Math.max(x + 8, 8), Math.max(8, panel.width - 160))}" y="${labelY - 20}" width="148" height="24" rx="12" fill="#0f172a" fill-opacity="0.82"/>
        <text x="${Math.min(Math.max(x + 18, 18), Math.max(18, panel.width - 150))}" y="${labelY - 4}" fill="${color}" font-size="14" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${label}: x=${absolute}</text>
      `;
    }
    const y = Math.round(absolute * (panel.height / panel.original.height));
    const labelX = 14 + (index % 3) * 164;
    return `
      <line x1="0" y1="${y}" x2="${panel.width}" y2="${y}" stroke="${color}" stroke-width="2.5" stroke-dasharray="10 8"/>
      <rect x="${labelX}" y="${Math.max(8, y - 30)}" width="154" height="24" rx="12" fill="#0f172a" fill-opacity="0.82"/>
      <text x="${labelX + 10}" y="${Math.max(24, y - 14)}" fill="${color}" font-size="14" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${label}: y=${absolute}</text>
    `;
  }).join('');
  const boxSvg = boxes.map((box, index) => {
    const resolved = resolveCropBox(box.box ?? box, panel.original);
    const rendered = renderedBoxFromAbsolute(resolved.absolute, panel);
    const color = escapeXml(box.color);
    const label = escapeXml(box.label);
    const badgeY = Math.max(10, rendered.y + 10);
    const badgeX = Math.max(10, rendered.x + 10);
    return `
      <rect x="${rendered.x}" y="${rendered.y}" width="${rendered.width}" height="${rendered.height}" rx="12" fill="none" stroke="${color}" stroke-width="3"/>
      <rect x="${badgeX}" y="${badgeY}" width="${Math.max(34, 24 + label.length * 14)}" height="28" rx="14" fill="${color}" fill-opacity="0.92"/>
      <text x="${badgeX + 10}" y="${badgeY + 19}" fill="#0f172a" font-size="14" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${index + 1}. ${label}</text>
    `;
  }).join('');
  return Buffer.from(`
<svg width="${panel.width}" height="${panel.height}" viewBox="0 0 ${panel.width} ${panel.height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${panel.width}" height="${panel.height}" fill="#020617" fill-opacity="0.08"/>
  ${guideSvg}
  ${boxSvg}
</svg>`);
}

async function createAlignmentOverlayPanel(basePanel, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const overlay = alignmentGuideOverlaySvg(basePanel, payload, locale);
  const input = await sharp(basePanel.input)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return {
    ...basePanel,
    input,
  };
}

async function renderAlignmentBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'alignment-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const rawScreenshot = board.payload.screenshot ?? board.payload.actual ?? board.payload.path;
  if (!rawScreenshot && !board.payload.overlay) {
    throw new Error('Alignment board requires screenshot, actual, path, or overlay image.');
  }
  const screenshotSpec = normalizeImageSpec(
    projectRoot,
    rawScreenshot ?? board.payload.overlay,
    board.payload.screenshotLabel ?? copy.alignmentScreenshotLabel,
  );
  const overlaySpec = board.payload.overlay
    ? normalizeImageSpec(projectRoot, board.payload.overlay, board.payload.overlayLabel ?? copy.alignmentOverlayLabel)
    : null;
  const screenshotPanel = await resizePanel(screenshotSpec.path, maxPanelWidth);
  const overlayPanel = overlaySpec
    ? await resizePanel(overlaySpec.path, maxPanelWidth)
    : await createAlignmentOverlayPanel(screenshotPanel, board.payload, locale);
  const panelWidth = Math.min(maxPanelWidth, Math.max(screenshotPanel.width, overlayPanel.width));
  const overviewHeight = Math.max(screenshotPanel.height, overlayPanel.height);
  const margin = 24;
  const gap = 24;
  const groups = normalizeAlignmentGroups(board.payload, locale);
  const cardWidth = parsePositiveInteger(board.payload.cardWidth ?? options.maxPanelWidth, DEFAULT_PARALLEL_CARD_WIDTH, 'cardWidth');
  const columns = Math.max(1, Math.min(parsePositiveInteger(board.payload.columns, Math.min(DEFAULT_PARALLEL_COLUMNS, Math.max(groups.length, 1)), 'columns'), 4));
  const contentWidth = Math.max(margin * 2 + panelWidth * 2 + gap, margin * 2 + columns * cardWidth + (columns - 1) * gap);
  const summary = String(board.payload.summary ?? copy.alignmentSummary);
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? copy.alignmentTitle),
    summary,
    copy.alignmentEyebrow,
  );
  const screenshotX = margin + Math.round((panelWidth - screenshotPanel.width) / 2);
  const overlayX = margin + panelWidth + gap + Math.round((panelWidth - overlayPanel.width) / 2);
  const overviewTop = margin + titleBlock.height + 18;
  const screenshotY = overviewTop + Math.round((overviewHeight - screenshotPanel.height) / 2);
  const overlayY = overviewTop + Math.round((overviewHeight - overlayPanel.height) / 2);
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: screenshotPanel.input, left: screenshotX, top: screenshotY },
    { input: overlayPanel.input, left: overlayX, top: overlayY },
    { input: labelSvg(screenshotSpec.label, { maxWidth: Math.max(32, screenshotPanel.width - 32) }), left: screenshotX + 16, top: screenshotY + 16 },
    { input: labelSvg(overlaySpec?.label ?? copy.alignmentOverlayLabel, { maxWidth: Math.max(32, overlayPanel.width - 32) }), left: overlayX + 16, top: overlayY + 16 },
  ];
  const renderedCards = [];
  for (const [index, group] of groups.entries()) {
    renderedCards.push(await renderParallelCard(projectRoot, group, index, {
      cardWidth,
      eyebrow: copy.alignmentMeasureEyebrow,
      locale,
    }));
  }
  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  let currentTop = overviewTop + overviewHeight + 28;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowCards = renderedCards.slice(row * columns, row * columns + columns);
    for (const [column, card] of rowCards.entries()) {
      composites.push({
        input: card.image,
        left: margin + column * (cardWidth + gap),
        top: currentTop,
      });
    }
    currentTop += rowHeights[row] + gap;
  }
  const canvasHeight = currentTop + margin - (rowHeights.length > 0 ? gap : 0);
  const canvas = sharp({
    create: {
      width: contentWidth,
      height: canvasHeight,
      channels: 3,
      background: '#111827',
    },
  }).composite(composites);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await encodePipeline(canvas, format, quality).toFile(outputPath);
  const metadataPath = metadataPathForOutput(outputPath);
  const reviewArtifact = {
    version: 1,
    schema: VISUAL_REVIEW_SCHEMA,
    generatedAt: timestamp(),
    mode: 'alignment-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.alignmentTitle),
    alignmentScope: summarizeAlignmentScope(renderedCards.map((card) => card.item)),
    labels: {
      screenshot: screenshotSpec.label,
      overlay: overlaySpec?.label ?? copy.alignmentOverlayLabel,
    },
    screenshot: {
      path: toWorkspacePath(projectRoot, screenshotPanel.source),
      original: screenshotPanel.original,
      rendered: {
        width: screenshotPanel.width,
        height: screenshotPanel.height,
      },
    },
    overlay: overlaySpec ? {
      path: toWorkspacePath(projectRoot, overlayPanel.source),
      original: overlayPanel.original,
      rendered: {
        width: overlayPanel.width,
        height: overlayPanel.height,
      },
    } : {
      generatedFrom: toWorkspacePath(projectRoot, screenshotPanel.source),
      guides: normalizeAlignmentGuides(board.payload, locale),
      boxes: normalizeAlignmentBoxes(board.payload, locale),
    },
    groups: renderedCards.map((card) => card.item),
    canvas: {
      width: contentWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'alignment-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    groups: reviewArtifact.groups,
    nextActions: copy.alignmentNextActions,
  };
}

const CHAT_EMBED_MODE_LABELS = {
  'before-after': '修改前后对比',
  'reference-actual': '效果图对比',
  'focus-board': '局部焦点证据板',
  'parallel-board': '并行实验证据板',
  'verification-board': '截图实测证据板',
  'alignment-board': '网格对齐证据板',
  'centering-board': '内部居中证据板',
};

function attachChatEmbed(result) {
  if (!result?.outputPath) {
    return result;
  }
  const label = CHAT_EMBED_MODE_LABELS[result.mode] ?? '视觉证据板';
  result.chatEmbed = {
    label,
    markdown: `![视觉证据: ${label}](${result.outputPath})`,
    hint: '把这行 markdown 直接贴进最终回复，让证据板在对话流里可见；不要只报告文件路径。',
  };
  result.nextActions = [
    ...(result.nextActions ?? []),
    `用 ${result.chatEmbed.markdown} 把证据板嵌入对话流展示，再基于图上标注说明气质、层级与对齐结论。`,
  ];
  return result;
}

async function visualCompareWorkspace(projectRoot, options = {}) {
  const request = resolveComparisonInputs(options);
  if (request.mode === 'board') {
    const board = await readBoardSpec(projectRoot, request.board);
    const locale = resolveBoardLocale(options, board.payload);
    validateBoardVisibleLanguage(board, locale);
    const renderOptions = { ...options, locale };
    if (board.mode === 'focus-board') {
      return attachChatEmbed(await renderFocusBoard(projectRoot, board, renderOptions));
    }
    if (board.mode === 'parallel-board') {
      return attachChatEmbed(await renderParallelBoard(projectRoot, board, renderOptions));
    }
    if (board.mode === 'verification-board') {
      return attachChatEmbed(await renderVerificationBoard(projectRoot, board, renderOptions));
    }
    if (board.mode === 'alignment-board') {
      return attachChatEmbed(await renderAlignmentBoard(projectRoot, board, renderOptions));
    }
    if (board.mode === 'centering-board') {
      return attachChatEmbed(await renderCenteringBoard(projectRoot, board, renderOptions));
    }
    throw new Error(`Unsupported board mode: ${board.mode}`);
  }
  return attachChatEmbed(await renderStandardComparison(projectRoot, request, options));
}

export { visualCompareWorkspace };
