/*
 * 核心功能
 * 生成局部优先的视觉证据板，使参考图与实现图在同一像素尺度下对比。
 *
 * 输入
 * focus-board 结构、左右截图及独立裁剪框。
 *
 * 输出
 * 局部参考、局部实现、差异图和小型全屏上下文，同时记录可复用的裁剪元数据。
 *
 * 定位
 * visual-compare 的 local-first 呈现层；传统整体优先 focus-board 继续保留在 visual-compare.js。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VISUAL_REVIEW_SCHEMA } from './quality-visual-review.js';
import { timestamp } from './time.js';
import {
  DEFAULT_PANEL_WIDTH,
  VISUAL_BOARD_PALETTE,
  defaultOutputPath,
  encodePipeline,
  extractCropAtScale,
  labelSvg,
  localeFromOptions,
  metadataPathForOutput,
  normalizeFormat,
  normalizeImageSpec,
  parsePositiveInteger,
  parseQuality,
  resizePanel,
  resolveCropBox,
  sectionHeaderSvg,
  titleBlockSvg,
  toWorkspacePath,
  visualCopyForLocale,
} from './visual-compare-core.js';

const MIN_LOCAL_STAGE_WIDTH = 240;
const MIN_LOCAL_STAGE_HEIGHT = 96;
const CONTEXT_MAX_WIDTH = 240;
const CONTEXT_MAX_HEIGHT = 160;

function localCopy(locale) {
  const chinese = String(locale).toLowerCase().startsWith('zh');
  return chinese
    ? { difference: '差异区域', context: '全屏上下文', contextNote: '只检查未改区域是否漂移' }
    : { difference: 'Difference', context: 'Full-screen context', contextNote: 'Only check for drift outside the edited region' };
}

async function renderStage(crop, width, height) {
  const left = Math.round((width - crop.width) / 2);
  const top = Math.round((height - crop.height) / 2);
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: VISUAL_BOARD_PALETTE.surface,
    },
  })
    .composite([{ input: crop.input, left, top }])
    .png()
    .toBuffer();
}

async function renderDifference(leftStage, rightStage) {
  return sharp(leftStage)
    .composite([{ input: rightStage, left: 0, top: 0, blend: 'difference' }])
    .png()
    .toBuffer();
}

async function renderContext(panel) {
  const { data, info } = await sharp(panel.input)
    .resize({
      width: CONTEXT_MAX_WIDTH,
      height: CONTEXT_MAX_HEIGHT,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

function fullImageBox() {
  return { unit: 'ratio', x: 0, y: 0, width: 1, height: 1 };
}

async function prepareRegion(region, index, leftPanel, rightPanel, maxPanelWidth, copy) {
  const label = String(region.label ?? region.name ?? copy.focusRegionLabel(index));
  const reason = String(region.reason ?? region.note ?? '').trim();
  const leftResolved = resolveCropBox(region.leftBox ?? region.referenceBox ?? region.box ?? fullImageBox(), leftPanel.original);
  const rightResolved = resolveCropBox(region.rightBox ?? region.actualBox ?? region.box ?? fullImageBox(), rightPanel.original);
  const largestSourceWidth = Math.max(leftResolved.absolute.width, rightResolved.absolute.width);
  const sharedScale = Math.min(1, maxPanelWidth / largestSourceWidth);
  const leftCrop = await extractCropAtScale(leftPanel.source, leftResolved.absolute, sharedScale);
  const rightCrop = await extractCropAtScale(rightPanel.source, rightResolved.absolute, sharedScale);
  const stageWidth = Math.max(MIN_LOCAL_STAGE_WIDTH, leftCrop.width, rightCrop.width);
  const stageHeight = Math.max(MIN_LOCAL_STAGE_HEIGHT, leftCrop.height, rightCrop.height);
  const leftStage = await renderStage(leftCrop, stageWidth, stageHeight);
  const rightStage = await renderStage(rightCrop, stageWidth, stageHeight);
  const differenceStage = await renderDifference(leftStage, rightStage);
  return {
    index,
    label,
    reason,
    leftResolved,
    rightResolved,
    leftCrop,
    rightCrop,
    sharedScale,
    stageWidth,
    stageHeight,
    leftStage,
    rightStage,
    differenceStage,
  };
}

export function isLocalFirstPresentation(value) {
  return ['local-first', 'crop-first', 'roi-first'].includes(String(value ?? '').trim().toLowerCase());
}

export async function renderLocalFirstFocusBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const local = localCopy(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'focus-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const leftSpec = normalizeImageSpec(projectRoot, board.payload.left ?? board.payload.reference, board.payload.leftLabel ?? copy.referenceLabel);
  const rightSpec = normalizeImageSpec(projectRoot, board.payload.right ?? board.payload.actual, board.payload.rightLabel ?? copy.actualLabel);
  const focusRegions = Array.isArray(board.payload.focusRegions ?? board.payload.regions)
    ? (board.payload.focusRegions ?? board.payload.regions)
    : [];
  if (focusRegions.length === 0) {
    throw new Error('Local-first focus board requires at least one focus region.');
  }

  const leftPanel = await resizePanel(leftSpec.path, maxPanelWidth);
  const rightPanel = await resizePanel(rightSpec.path, maxPanelWidth);
  const prepared = [];
  for (const [index, region] of focusRegions.entries()) {
    prepared.push(await prepareRegion(region, index, leftPanel, rightPanel, maxPanelWidth, copy));
  }

  const panelWidth = Math.max(...prepared.map((item) => item.stageWidth));
  const margin = 24;
  const gap = 24;
  const sectionGap = 28;
  const contentWidth = margin * 2 + panelWidth * 2 + gap;
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? copy.focusTitle),
    String(board.payload.summary ?? copy.localFocusSummary),
    copy.focusEyebrow,
  );
  const composites = [{ input: titleBlock.input, left: margin, top: margin }];
  const metadataRegions = [];
  let currentTop = margin + titleBlock.height + 18;

  for (const item of prepared) {
    const header = sectionHeaderSvg(contentWidth - margin * 2, item.index + 1, item.label, item.reason);
    const stageTop = currentTop + header.height + 12;
    const leftStageX = margin + Math.round((panelWidth - item.stageWidth) / 2);
    const rightStageX = margin + panelWidth + gap + Math.round((panelWidth - item.stageWidth) / 2);
    const differenceTop = stageTop + item.stageHeight + 14;
    const differenceX = margin + Math.round((contentWidth - margin * 2 - item.stageWidth) / 2);
    composites.push(
      { input: header.input, left: margin, top: currentTop },
      { input: item.leftStage, left: leftStageX, top: stageTop },
      { input: item.rightStage, left: rightStageX, top: stageTop },
      { input: labelSvg(leftSpec.label, { fontSize: 18, height: 40, minWidth: 112, maxWidth: item.stageWidth - 24 }), left: leftStageX + 12, top: stageTop + 12 },
      { input: labelSvg(rightSpec.label, { fontSize: 18, height: 40, minWidth: 112, maxWidth: item.stageWidth - 24 }), left: rightStageX + 12, top: stageTop + 12 },
      { input: item.differenceStage, left: differenceX, top: differenceTop },
      { input: labelSvg(local.difference, { fontSize: 18, height: 40, minWidth: 112, maxWidth: item.stageWidth - 24 }), left: differenceX + 12, top: differenceTop + 12 },
    );
    metadataRegions.push({
      index: item.index + 1,
      label: item.label,
      reason: item.reason,
      leftBox: {
        unit: item.leftResolved.unit,
        requested: item.leftResolved.requested,
        absolute: item.leftResolved.absolute,
      },
      rightBox: {
        unit: item.rightResolved.unit,
        requested: item.rightResolved.requested,
        absolute: item.rightResolved.absolute,
      },
      sharedScale: item.sharedScale,
      scaleBasis: 'source-pixels',
      stretched: false,
      leftCrop: { width: item.leftCrop.width, height: item.leftCrop.height },
      rightCrop: { width: item.rightCrop.width, height: item.rightCrop.height },
      difference: { blend: 'difference', width: item.stageWidth, height: item.stageHeight },
    });
    currentTop = differenceTop + item.stageHeight + sectionGap;
  }

  const contextHeader = sectionHeaderSvg(contentWidth - margin * 2, prepared.length + 1, local.context, local.contextNote);
  const contextTop = currentTop + contextHeader.height + 12;
  const leftContext = await renderContext(leftPanel);
  const rightContext = await renderContext(rightPanel);
  const contextHeight = Math.max(leftContext.height, rightContext.height);
  const leftContextX = margin + Math.round((panelWidth - leftContext.width) / 2);
  const rightContextX = margin + panelWidth + gap + Math.round((panelWidth - rightContext.width) / 2);
  composites.push(
    { input: contextHeader.input, left: margin, top: currentTop },
    { input: leftContext.input, left: leftContextX, top: contextTop + Math.round((contextHeight - leftContext.height) / 2) },
    { input: rightContext.input, left: rightContextX, top: contextTop + Math.round((contextHeight - rightContext.height) / 2) },
  );

  const canvasHeight = contextTop + contextHeight + margin;
  const canvas = sharp({
    create: {
      width: contentWidth,
      height: canvasHeight,
      channels: 3,
      background: VISUAL_BOARD_PALETTE.canvas,
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
    presentation: 'local-first',
    comparisonMode: board.payload.comparisonMode ?? null,
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: board.sourcePath ? toWorkspacePath(projectRoot, board.sourcePath) : null,
    title: String(board.payload.title ?? copy.focusTitle),
    labels: { reference: leftSpec.label, actual: rightSpec.label },
    reference: { path: toWorkspacePath(projectRoot, leftPanel.source), original: leftPanel.original },
    actual: { path: toWorkspacePath(projectRoot, rightPanel.source), original: rightPanel.original },
    focusRegions: metadataRegions,
    context: {
      placement: 'footer',
      role: 'provenance-and-regression-only',
      maxWidth: CONTEXT_MAX_WIDTH,
      maxHeight: CONTEXT_MAX_HEIGHT,
    },
    canvas: { width: contentWidth, height: canvasHeight },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');
  return {
    ok: true,
    action: 'visual-compare',
    mode: 'focus-board',
    presentation: 'local-first',
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
    context: reviewArtifact.context,
    canvas: reviewArtifact.canvas,
    reviewArtifact,
    nextActions: copy.localFocusNextActions,
  };
}
