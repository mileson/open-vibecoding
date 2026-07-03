// Centering-board renderer: analyzes a single asset for canvas-center offset,
// subject bounding-box offset, and visual weight drift, then renders the board.
// Split from visual-compare.js.

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { VISUAL_REVIEW_SCHEMA } from './quality-visual-review.js';
import { timestamp } from './time.js';
import {
  DEFAULT_PANEL_WIDTH,
  charCount,
  compactLabel,
  defaultOutputPath,
  encodePipeline,
  escapeXml,
  labelSvg,
  localeFromOptions,
  metadataPathForOutput,
  normalizeFormat,
  normalizeImageSpec,
  parsePositiveInteger,
  parseQuality,
  renderParallelCard,
  resolveCropBox,
  titleBlockSvg,
  toWorkspacePath,
  visualCopyForLocale,
} from './visual-compare-core.js';

function round1(value) {
  const rounded = Math.round(Number(value) * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function formatSignedPx(value) {
  const rounded = round1(value);
  return `${rounded >= 0 ? '+' : ''}${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}px`;
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function colorDistance(r, g, b, color) {
  return Math.sqrt(
    ((r - color.r) ** 2)
    + ((g - color.g) ** 2)
    + ((b - color.b) ** 2),
  );
}

function parseChannelRange(range, key) {
  const raw = range?.[key];
  if (raw === null || raw === undefined || raw === '') {
    return [key === 'a' ? 1 : 0, 255];
  }
  if (Array.isArray(raw)) {
    return [
      Math.max(0, Math.min(255, Number(raw[0] ?? 0))),
      Math.max(0, Math.min(255, Number(raw[1] ?? 255))),
    ];
  }
  if (typeof raw === 'object') {
    return [
      Math.max(0, Math.min(255, Number(raw.min ?? raw.from ?? 0))),
      Math.max(0, Math.min(255, Number(raw.max ?? raw.to ?? 255))),
    ];
  }
  const value = Math.max(0, Math.min(255, Number(raw)));
  return [value, value];
}

function pixelInRange(r, g, b, a, range) {
  const [rMin, rMax] = parseChannelRange(range, 'r');
  const [gMin, gMax] = parseChannelRange(range, 'g');
  const [bMin, bMax] = parseChannelRange(range, 'b');
  const [aMin, aMax] = parseChannelRange(range, 'a');
  return r >= rMin && r <= rMax
    && g >= gMin && g <= gMax
    && b >= bMin && b <= bMax
    && a >= aMin && a <= aMax;
}

function parseColorSpec(value, fallbackTolerance) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const hex = value.trim().replace(/^#/u, '');
    if (/^[0-9a-f]{6}$/iu.test(hex)) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        tolerance: fallbackTolerance,
      };
    }
    return null;
  }
  if (typeof value !== 'object') {
    return null;
  }
  const fromHex = parseColorSpec(value.hex ?? value.color, fallbackTolerance);
  if (fromHex) {
    return {
      ...fromHex,
      tolerance: Number(value.tolerance ?? value.threshold ?? fallbackTolerance),
    };
  }
  const r = Number(value.r);
  const g = Number(value.g);
  const b = Number(value.b);
  if (![r, g, b].every(Number.isFinite)) {
    return null;
  }
  return {
    r: Math.max(0, Math.min(255, r)),
    g: Math.max(0, Math.min(255, g)),
    b: Math.max(0, Math.min(255, b)),
    tolerance: Number(value.tolerance ?? value.threshold ?? fallbackTolerance),
  };
}

function normalizeColorSpecs(subject, fallbackTolerance) {
  const raw = subject.colors ?? subject.color ?? subject.includeColors;
  const entries = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  return entries
    .map((entry) => parseColorSpec(entry, fallbackTolerance))
    .filter(Boolean);
}

function normalizeCenteringSubject(payload) {
  const subject = (payload.subject && typeof payload.subject === 'object')
    ? payload.subject
    : ((payload.mask && typeof payload.mask === 'object') ? payload.mask : {});
  const mode = String(subject.mode ?? payload.maskMode ?? 'auto').trim().toLowerCase();
  const colorDistanceThreshold = Number(subject.colorDistanceThreshold ?? subject.colorThreshold ?? payload.colorDistanceThreshold ?? 28);
  const lumaThreshold = Number(subject.lumaThreshold ?? payload.lumaThreshold ?? 22);
  return {
    mode: ['alpha', 'range', 'ranges', 'color', 'colors'].includes(mode)
      ? (mode === 'ranges' ? 'range' : (mode === 'colors' ? 'color' : mode))
      : 'auto',
    alphaThreshold: Number(subject.alphaThreshold ?? payload.alphaThreshold ?? 8),
    colorDistanceThreshold,
    lumaThreshold,
    weight: String(subject.weight ?? payload.weight ?? 'contrast').trim().toLowerCase(),
    ranges: Array.isArray(subject.ranges ?? subject.include)
      ? (subject.ranges ?? subject.include)
      : (subject.range ? [subject.range] : []),
    colors: normalizeColorSpecs(subject, colorDistanceThreshold),
  };
}

function estimateCornerBackground(data, width, height, channels) {
  const sample = Math.max(2, Math.min(12, Math.floor(Math.min(width, height) * 0.06)));
  const points = [];
  for (const yStart of [0, Math.max(0, height - sample)]) {
    for (const xStart of [0, Math.max(0, width - sample)]) {
      for (let y = yStart; y < Math.min(height, yStart + sample); y += 1) {
        for (let x = xStart; x < Math.min(width, xStart + sample); x += 1) {
          points.push((y * width + x) * channels);
        }
      }
    }
  }
  const totals = { r: 0, g: 0, b: 0, a: 0 };
  for (const index of points) {
    totals.r += data[index];
    totals.g += data[index + 1];
    totals.b += data[index + 2];
    totals.a += data[index + 3] ?? 255;
  }
  const count = Math.max(points.length, 1);
  return {
    r: totals.r / count,
    g: totals.g / count,
    b: totals.b / count,
    a: totals.a / count,
  };
}

function centerPoint(width, height) {
  return {
    x: width / 2,
    y: height / 2,
  };
}

function centeringPixelActive(r, g, b, a, subject, background) {
  if (a <= subject.alphaThreshold) {
    return false;
  }
  if (subject.mode === 'alpha') {
    return true;
  }
  if (subject.mode === 'range') {
    return subject.ranges.some((range) => pixelInRange(r, g, b, a, range));
  }
  if (subject.mode === 'color') {
    return subject.colors.some((color) => colorDistance(r, g, b, color) <= color.tolerance);
  }
  if (background.a <= subject.alphaThreshold) {
    return true;
  }
  return colorDistance(r, g, b, background) >= subject.colorDistanceThreshold
    || Math.abs(luminance(r, g, b) - luminance(background.r, background.g, background.b)) >= subject.lumaThreshold;
}

function centeringPixelWeight(r, g, b, a, subject, background) {
  if (subject.weight === 'presence') {
    return 1;
  }
  if (subject.weight === 'alpha') {
    return Math.max(a / 255, 0.01);
  }
  if (subject.weight === 'luma') {
    return Math.max(luminance(r, g, b) / 255, 0.01);
  }
  return Math.max(colorDistance(r, g, b, background), 1);
}

async function loadCenteringRaw(sourcePath, box) {
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  };
}

async function extractCenteringTargetPanel(inputPath, box, outputWidth, sourceOriginal) {
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
      withoutEnlargement: true,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    input: data,
    width: info.width,
    height: info.height,
    source,
    absolute: box,
    original: {
      width: box.width,
      height: box.height,
      sourceWidth: sourceOriginal.width,
      sourceHeight: sourceOriginal.height,
      format: sourceOriginal.format ?? null,
    },
  };
}

async function analyzeCenteringTarget(sourcePath, box, payload, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const raw = await loadCenteringRaw(sourcePath, box);
  const subject = normalizeCenteringSubject(payload);
  if (subject.mode === 'range' && subject.ranges.length === 0) {
    throw new Error('Centering board subject.mode=range requires subject.ranges or subject.include.');
  }
  if (subject.mode === 'color' && subject.colors.length === 0) {
    throw new Error('Centering board subject.mode=color requires subject.colors or subject.color.');
  }
  const background = estimateCornerBackground(raw.data, raw.width, raw.height, raw.channels);
  let minX = raw.width;
  let minY = raw.height;
  let maxX = -1;
  let maxY = -1;
  let activePixelCount = 0;
  let weightSum = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (let y = 0; y < raw.height; y += 1) {
    for (let x = 0; x < raw.width; x += 1) {
      const index = (y * raw.width + x) * raw.channels;
      const r = raw.data[index];
      const g = raw.data[index + 1];
      const b = raw.data[index + 2];
      const a = raw.data[index + 3] ?? 255;
      if (!centeringPixelActive(r, g, b, a, subject, background)) {
        continue;
      }
      activePixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const weight = centeringPixelWeight(r, g, b, a, subject, background);
      weightSum += weight;
      weightedX += (x + 0.5) * weight;
      weightedY += (y + 0.5) * weight;
    }
  }

  if (activePixelCount === 0) {
    throw new Error('Centering board could not isolate active subject pixels. Use subject.mode=range or subject.mode=color with explicit ranges/colors.');
  }

  const bounds = {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
  const canvasCenter = centerPoint(raw.width, raw.height);
  const bboxCenter = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const visualCentroid = {
    x: weightedX / Math.max(weightSum, 1),
    y: weightedY / Math.max(weightSum, 1),
  };
  const bboxCenterOffset = {
    x: round1(bboxCenter.x - canvasCenter.x),
    y: round1(bboxCenter.y - canvasCenter.y),
  };
  const visualCentroidOffset = {
    x: round1(visualCentroid.x - canvasCenter.x),
    y: round1(visualCentroid.y - canvasCenter.y),
  };
  const thresholdPx = Number(payload.thresholdPx ?? payload.threshold ?? 8);
  const maxAbsOffset = Math.max(
    Math.abs(bboxCenterOffset.x),
    Math.abs(bboxCenterOffset.y),
    Math.abs(visualCentroidOffset.x),
    Math.abs(visualCentroidOffset.y),
  );
  const passed = maxAbsOffset <= thresholdPx;
  return {
    thresholdPx,
    verdict: passed ? copy.passVerdict : copy.reworkVerdict,
    passed,
    maxAbsOffset: round1(maxAbsOffset),
    canvas: {
      width: raw.width,
      height: raw.height,
    },
    canvasCenter: {
      x: round1(canvasCenter.x),
      y: round1(canvasCenter.y),
    },
    activeBounds: bounds,
    bboxCenter: {
      x: round1(bboxCenter.x),
      y: round1(bboxCenter.y),
    },
    bboxCenterOffset,
    visualCentroid: {
      x: round1(visualCentroid.x),
      y: round1(visualCentroid.y),
    },
    visualCentroidOffset,
    activePixelCount,
    activePixelRatio: round1((activePixelCount / Math.max(raw.width * raw.height, 1)) * 100),
    subject: {
      mode: subject.mode,
      weight: subject.weight,
      alphaThreshold: subject.alphaThreshold,
      colorDistanceThreshold: subject.colorDistanceThreshold,
      lumaThreshold: subject.lumaThreshold,
      rangeCount: subject.ranges.length,
      colorCount: subject.colors.length,
    },
    background: {
      r: round1(background.r),
      g: round1(background.g),
      b: round1(background.b),
      a: round1(background.a),
    },
  };
}

function centeringOverlaySvg(panel, analysis, locale = OPENPRD_FALLBACK_LOCALE) {
  const copy = visualCopyForLocale(locale);
  const scaleX = panel.width / analysis.canvas.width;
  const scaleY = panel.height / analysis.canvas.height;
  const centerX = round1(analysis.canvasCenter.x * scaleX);
  const centerY = round1(analysis.canvasCenter.y * scaleY);
  const bounds = {
    x: round1(analysis.activeBounds.x * scaleX),
    y: round1(analysis.activeBounds.y * scaleY),
    width: Math.max(2, round1(analysis.activeBounds.width * scaleX)),
    height: Math.max(2, round1(analysis.activeBounds.height * scaleY)),
  };
  const bboxCenterX = round1(analysis.bboxCenter.x * scaleX);
  const bboxCenterY = round1(analysis.bboxCenter.y * scaleY);
  const centroidX = round1(analysis.visualCentroid.x * scaleX);
  const centroidY = round1(analysis.visualCentroid.y * scaleY);
  const gridLines = [];
  for (const ratio of [0.25, 0.5, 0.75]) {
    const x = round1(panel.width * ratio);
    const y = round1(panel.height * ratio);
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${panel.height}" stroke="#94a3b8" stroke-opacity="0.22" stroke-width="1"/>`);
    gridLines.push(`<line x1="0" y1="${y}" x2="${panel.width}" y2="${y}" stroke="#94a3b8" stroke-opacity="0.22" stroke-width="1"/>`);
  }
  const bboxText = `bbox ${formatSignedPx(analysis.bboxCenterOffset.x)}, ${formatSignedPx(analysis.bboxCenterOffset.y)}`;
  const centroidText = `${copy.centeringCentroidLabel} ${formatSignedPx(analysis.visualCentroidOffset.x)}, ${formatSignedPx(analysis.visualCentroidOffset.y)}`;
  const badgeText = panel.width < 360 ? bboxText : `${bboxText} / ${centroidText}`;
  const badgeWidth = Math.max(24, Math.min(Math.max(24, panel.width - 24), Math.max(320, charCount(badgeText) * 13 + 32)));
  return Buffer.from(`
<svg width="${panel.width}" height="${panel.height}" viewBox="0 0 ${panel.width} ${panel.height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${panel.width}" height="${panel.height}" fill="#020617" fill-opacity="0.06"/>
  ${gridLines.join('')}
  <line x1="${centerX}" y1="0" x2="${centerX}" y2="${panel.height}" stroke="#ef4444" stroke-width="3" stroke-dasharray="12 8"/>
  <line x1="0" y1="${centerY}" x2="${panel.width}" y2="${centerY}" stroke="#ef4444" stroke-width="3" stroke-dasharray="12 8"/>
  <rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="8" fill="none" stroke="#22c55e" stroke-width="4"/>
  <line x1="${bboxCenterX - 16}" y1="${bboxCenterY}" x2="${bboxCenterX + 16}" y2="${bboxCenterY}" stroke="#22c55e" stroke-width="4"/>
  <line x1="${bboxCenterX}" y1="${bboxCenterY - 16}" x2="${bboxCenterX}" y2="${bboxCenterY + 16}" stroke="#22c55e" stroke-width="4"/>
  <circle cx="${centroidX}" cy="${centroidY}" r="9" fill="#facc15" stroke="#111827" stroke-width="3"/>
  <rect x="12" y="12" width="${badgeWidth}" height="34" rx="17" fill="#0f172a" fill-opacity="0.88"/>
  <text x="28" y="35" fill="#f8fafc" font-size="16" font-weight="800" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${escapeXml(badgeText)}</text>
  <rect x="0.75" y="0.75" width="${panel.width - 1.5}" height="${panel.height - 1.5}" rx="12" fill="none" stroke="#475569" stroke-opacity="0.6" stroke-width="1.5"/>
</svg>`);
}

async function createCenteringOverlayPanel(targetPanel, analysis, locale = OPENPRD_FALLBACK_LOCALE) {
  const overlay = centeringOverlaySvg(targetPanel, analysis, locale);
  const input = await sharp(targetPanel.input)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
  return {
    ...targetPanel,
    input,
  };
}

function normalizeCenteringTargetBox(rawBox, original) {
  if (!rawBox) {
    const width = Math.max(1, Math.round(original.width));
    const height = Math.max(1, Math.round(original.height));
    return {
      unit: 'px',
      requested: { x: 0, y: 0, width, height },
      absolute: { x: 0, y: 0, width, height },
    };
  }
  return resolveCropBox(rawBox, original);
}

export async function renderCenteringBoard(projectRoot, board, options = {}) {
  const locale = localeFromOptions(options);
  const copy = visualCopyForLocale(locale);
  const format = normalizeFormat(options.format, options.out);
  const outputPath = options.out
    ? path.resolve(projectRoot, options.out)
    : defaultOutputPath(projectRoot, format, 'centering-board');
  const quality = parseQuality(options.quality);
  const maxPanelWidth = parsePositiveInteger(options.maxPanelWidth, DEFAULT_PANEL_WIDTH, '--max-panel-width');
  const rawImage = board.payload.image ?? board.payload.screenshot ?? board.payload.actual ?? board.payload.path;
  if (!rawImage) {
    throw new Error('Centering board requires image, screenshot, actual, or path.');
  }
  const imageSpec = normalizeImageSpec(
    projectRoot,
    rawImage,
    board.payload.imageLabel ?? board.payload.screenshotLabel ?? copy.centeringImageLabel,
  );
  const sourceMetadata = await sharp(imageSpec.path).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error(`Cannot read image dimensions: ${imageSpec.path}`);
  }
  const sourceOriginal = {
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    format: sourceMetadata.format ?? null,
  };
  const targetBox = normalizeCenteringTargetBox(
    board.payload.targetBox ?? board.payload.box ?? board.payload.region,
    sourceOriginal,
  );
  const targetPanel = await extractCenteringTargetPanel(
    imageSpec.path,
    targetBox.absolute,
    maxPanelWidth,
    sourceOriginal,
  );
  const analysis = await analyzeCenteringTarget(imageSpec.path, targetBox.absolute, board.payload, locale);
  const overlayPanel = await createCenteringOverlayPanel(targetPanel, analysis, locale);
  const panelWidth = Math.min(maxPanelWidth, Math.max(targetPanel.width, overlayPanel.width, 180));
  const overviewHeight = Math.max(targetPanel.height, overlayPanel.height);
  const margin = 24;
  const gap = 24;
  const contentWidth = Math.max(560, margin * 2 + panelWidth * 2 + gap);
  const summary = String(board.payload.summary ?? copy.centeringSummary);
  const titleBlock = titleBlockSvg(
    contentWidth - margin * 2,
    String(board.payload.title ?? copy.centeringTitle),
    summary,
    copy.centeringEyebrow,
  );
  const targetX = margin + Math.round((panelWidth - targetPanel.width) / 2);
  const overlayX = margin + panelWidth + gap + Math.round((panelWidth - overlayPanel.width) / 2);
  const overviewTop = margin + titleBlock.height + 18;
  const targetY = overviewTop + Math.round((overviewHeight - targetPanel.height) / 2);
  const overlayY = overviewTop + Math.round((overviewHeight - overlayPanel.height) / 2);
  const metricsCard = await renderParallelCard(projectRoot, {
    label: copy.centeringMeasureLabel,
    subtitle: `${copy.centeringThresholdLabel} ${analysis.thresholdPx}px / ${analysis.verdict}`,
    verdict: analysis.verdict,
    metrics: [
      { label: copy.centeringCanvasSizeLabel, value: `${analysis.canvas.width}x${analysis.canvas.height}px` },
      { label: copy.centeringBoundsLabel, value: `x=${analysis.activeBounds.x}, y=${analysis.activeBounds.y}, ${analysis.activeBounds.width}x${analysis.activeBounds.height}px` },
      { label: copy.centeringBboxOffsetLabel, value: `${formatSignedPx(analysis.bboxCenterOffset.x)}, ${formatSignedPx(analysis.bboxCenterOffset.y)}` },
      { label: copy.centeringCentroidOffsetLabel, value: `${formatSignedPx(analysis.visualCentroidOffset.x)}, ${formatSignedPx(analysis.visualCentroidOffset.y)}` },
      { label: copy.centeringMaxOffsetLabel, value: `${analysis.maxAbsOffset}px` },
      { label: copy.centeringPixelRatioLabel, value: `${analysis.activePixelRatio}%` },
      { label: 'mask', value: `${analysis.subject.mode} / weight=${analysis.subject.weight}` },
    ],
    notes: copy.centeringNotes,
  }, 0, {
    cardWidth: Math.min(contentWidth - margin * 2, Math.max(560, panelWidth * 2 + gap)),
    eyebrow: copy.centeringMeasureEyebrow,
    locale,
  });
  const metricsTop = overviewTop + overviewHeight + 28;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: targetPanel.input, left: targetX, top: targetY },
    { input: overlayPanel.input, left: overlayX, top: overlayY },
    {
      input: labelSvg(compactLabel(imageSpec.label), {
        fontSize: 14,
        height: 32,
        paddingX: 12,
        radius: 10,
        minWidth: 80,
        maxWidth: Math.max(32, targetPanel.width - 32),
      }),
      left: targetX + 16,
      top: targetY + 16,
    },
    { input: metricsCard.image, left: margin, top: metricsTop },
  ];
  const canvasHeight = metricsTop + metricsCard.height + margin;
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
    mode: 'centering-board',
    locale,
    outputPath: toWorkspacePath(projectRoot, outputPath),
    format,
    boardSource: toWorkspacePath(projectRoot, board.sourcePath),
    title: String(board.payload.title ?? copy.centeringTitle),
    labels: {
      image: imageSpec.label,
      overlay: copy.centeringOverlayLabel,
    },
    target: {
      path: toWorkspacePath(projectRoot, imageSpec.path),
      original: sourceOriginal,
      box: {
        unit: targetBox.unit,
        requested: targetBox.requested,
        absolute: targetBox.absolute,
      },
      rendered: {
        width: targetPanel.width,
        height: targetPanel.height,
      },
    },
    centering: analysis,
    canvas: {
      width: contentWidth,
      height: canvasHeight,
    },
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(reviewArtifact, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-compare',
    mode: 'centering-board',
    projectRoot,
    outputPath,
    metadataPath,
    format,
    quality: format === 'png' ? null : quality,
    canvas: reviewArtifact.canvas,
    target: reviewArtifact.target,
    centering: analysis,
    reviewArtifact,
    nextActions: copy.centeringNextActions,
  };
}
