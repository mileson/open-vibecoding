/*
 * 核心功能
 * 把已确认的参考图预处理为 reference-set，包括规则切片、contact sheet 和后续视觉对比模板。
 *
 * 输入
 * 接收项目根目录、参考图路径，以及 grid 或 boxes 形式的裁剪计划。
 *
 * 输出
 * 在 `.open-vibecoding/harness/visual-reviews/reference-sets/<id>/` 下写入 staged source、crops、reference-set.json、contact-sheet 和 board 模板。
 *
 * 定位
 * 位于视觉验收的准备层，负责“整板 / 多子图 / 网格图”到可比对 reference-set 的确定性几何处理。
 *
 * 依赖
 * 依赖 `sharp` 做图片解码、裁剪和合成，依赖 `time` 生成稳定时间戳。
 *
 * 维护规则
 * 只做确定性裁剪、登记和模板生成；不要在这里引入无法审计的自动识别或主观视觉判断。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compactTimestamp, timestamp } from './time.js';

const REFERENCE_SET_SCHEMA = 'openprd.reference-set.v1';
const VISUAL_PREPARE_PLAN_SCHEMA = 'openprd.visual-prepare.plan.v1';
const DEFAULT_REFERENCE_SET_DIR = path.join('.open-vibecoding', 'harness', 'visual-reviews', 'reference-sets');
const DEFAULT_SOURCE_FILENAME = 'source.png';
const DEFAULT_CONTACT_SHEET_FILENAME = 'contact-sheet.jpg';
const DEFAULT_REFERENCE_SET_FILENAME = 'reference-set.json';
const DEFAULT_COMPARE_PLAN_FILENAME = 'compare-plan.json';
const DEFAULT_FOCUS_BOARD_TEMPLATE = 'focus-board.template.json';
const DEFAULT_PARALLEL_BOARD_TEMPLATE = 'parallel-board.template.json';
const DEFAULT_IMPLEMENTATION_PLACEHOLDER = '__REPLACE_WITH_IMPLEMENTATION_SCREENSHOT__';
const DEFAULT_OVERVIEW_WIDTH = 960;
const DEFAULT_THUMB_WIDTH = 260;
const DEFAULT_CARD_COLUMNS = 3;
const FOCUS_COLORS = ['#f97316', '#22c55e', '#38bdf8', '#eab308', '#fb7185', '#a78bfa'];

function normalizeWorkspacePath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function toWorkspacePath(projectRoot, filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return normalizeWorkspacePath(relativePath);
  }
  return absolutePath;
}

function resolveProjectPath(projectRoot, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
}

function slugify(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'reference-set';
}

function sanitizeItemId(value, fallback) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return fallback;
  }
  const normalized = raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function sha256File(filePath) {
  const buffer = await fs.readFile(filePath);
  return sha256Buffer(buffer);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function charCount(value) {
  return Array.from(String(value ?? '')).length;
}

function wrapText(value, maxCharsPerLine) {
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

function lineSvg(lines, {
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

function labelSvg(label, options = {}) {
  const text = escapeXml(label);
  const fontSize = options.fontSize ?? 22;
  const height = options.height ?? 46;
  const paddingX = options.paddingX ?? 21;
  const radius = options.radius ?? 14;
  const bg = options.background ?? '#111827';
  const bgOpacity = options.backgroundOpacity ?? 0.82;
  const stroke = options.stroke ?? '#ffffff';
  const strokeOpacity = options.strokeOpacity ?? 0.22;
  const width = Math.max(options.minWidth ?? 126, charCount(label) * (fontSize + 4) + paddingX * 2);
  return Buffer.from(`
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${bg}" fill-opacity="${bgOpacity}"/>
  <rect x="0.75" y="0.75" width="${width - 1.5}" height="${height - 1.5}" rx="${Math.max(radius - 0.75, 1)}" fill="none" stroke="${stroke}" stroke-opacity="${strokeOpacity}" stroke-width="1.5"/>
  <text x="${paddingX}" y="${Math.round(height * 0.64)}" fill="#ffffff" font-size="${fontSize}" font-weight="700" font-family="PingFang SC, Noto Sans CJK SC, Microsoft YaHei, Arial Unicode MS, sans-serif">${text}</text>
</svg>`);
}

function titleBlockSvg(width, title, subtitle, eyebrow = null) {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const titleLines = wrapText(title, Math.max(12, Math.floor((contentWidth - 48) / 18)));
  const subtitleLines = wrapText(subtitle, Math.max(16, Math.floor((contentWidth - 48) / 16)));
  const eyebrowLines = wrapText(eyebrow, Math.max(18, Math.floor((contentWidth - 48) / 18)));
  let y = eyebrowLines.length > 0 ? 28 : 0;
  const parts = [];
  if (eyebrowLines.length > 0) {
    parts.push(lineSvg(eyebrowLines, {
      x: 0,
      y,
      lineHeight: 20,
      fontSize: 16,
      fill: '#93c5fd',
      fontWeight: 700,
    }));
    y += eyebrowLines.length * 20 + 14;
  }
  parts.push(lineSvg(titleLines, {
    x: 0,
    y: y + 30,
    lineHeight: 34,
    fontSize: 30,
    fill: '#f8fafc',
    fontWeight: 800,
  }));
  y += titleLines.length * 34 + 10;
  if (subtitleLines.length > 0) {
    parts.push(lineSvg(subtitleLines, {
      x: 0,
      y: y + 24,
      lineHeight: 24,
      fontSize: 18,
      fill: '#cbd5e1',
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

function sectionHeaderSvg(width, index, label, reason = '') {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const titleLines = wrapText(`${index}. ${label}`, Math.max(10, Math.floor((contentWidth - 48) / 18)));
  const reasonLines = wrapText(reason, Math.max(14, Math.floor((contentWidth - 48) / 16)));
  const height = 32 + titleLines.length * 28 + (reasonLines.length > 0 ? 10 + reasonLines.length * 22 : 0);
  return {
    height,
    input: Buffer.from(`
<svg width="${contentWidth}" height="${height}" viewBox="0 0 ${contentWidth} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="${contentWidth}" height="${height}" rx="18" fill="#0f172a" fill-opacity="0.92"/>
  <rect x="0.75" y="0.75" width="${contentWidth - 1.5}" height="${height - 1.5}" rx="17.25" fill="none" stroke="#475569" stroke-opacity="0.45" stroke-width="1.5"/>
  ${lineSvg(titleLines, {
    x: 20,
    y: 30,
    lineHeight: 28,
    fontSize: 24,
    fill: '#f8fafc',
    fontWeight: 800,
  })}
  ${reasonLines.length > 0 ? lineSvg(reasonLines, {
    x: 20,
    y: 30 + titleLines.length * 28 + 10,
    lineHeight: 22,
    fontSize: 16,
    fill: '#cbd5e1',
    fontWeight: 500,
  }) : ''}
</svg>`),
  };
}

function metricsSvg(width, metrics = [], notes = null) {
  const contentWidth = Math.max(Number(width) || 0, 1);
  const lines = [];
  for (const metric of metrics) {
    lines.push(`${metric.label}：${metric.value}`);
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
    fill: '#cbd5e1',
    fontWeight: 500,
  })}
</svg>`),
  };
}

async function resizePanel(inputPath, panelWidth) {
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

function parseCropDimension(box, key, alias) {
  const primary = box[key];
  const secondary = alias ? box[alias] : undefined;
  const value = primary ?? secondary;
  if (value === null || value === undefined || value === '') {
    throw new Error(`Missing ${key} in crop box.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${key} in crop box.`);
  }
  return parsed;
}

function clampBox(box, original) {
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

function resolveCropBox(box, original) {
  if (!box || typeof box !== 'object') {
    throw new Error('Crop box must be an object.');
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
    throw new Error(`Unsupported crop unit: ${rawUnit}. Use ratio, percent, or px.`);
  }

  return {
    unit: rawUnit === 'pixel' || rawUnit === 'pixels' ? 'px' : rawUnit,
    requested: { x, y, width, height },
    absolute: clampBox(absolute, original),
  };
}

function renderedBoxFromAbsolute(box, panel) {
  const scaleX = panel.width / panel.original.width;
  const scaleY = panel.height / panel.original.height;
  return {
    x: Math.round(box.x * scaleX),
    y: Math.round(box.y * scaleY),
    width: Math.max(2, Math.round(box.width * scaleX)),
    height: Math.max(2, Math.round(box.height * scaleY)),
  };
}

function absoluteToRatio(box, original) {
  return {
    unit: 'ratio',
    x: Number((box.x / original.width).toFixed(6)),
    y: Number((box.y / original.height).toFixed(6)),
    width: Number((box.width / original.width).toFixed(6)),
    height: Number((box.height / original.height).toFixed(6)),
  };
}

function focusOverlaySvg(width, height, regions) {
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

function parseGridSpec(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*x\s*(\d+)$/u);
  if (!match) {
    throw new Error(`Invalid --grid value: ${value}. Use <columns>x<rows>, for example 2x5.`);
  }
  const columns = Number.parseInt(match[1], 10);
  const rows = Number.parseInt(match[2], 10);
  if (columns <= 0 || rows <= 0) {
    throw new Error('--grid requires positive columns and rows.');
  }
  return { columns, rows };
}

function zeroPadWidth(count) {
  return Math.max(2, String(count).length);
}

function buildGridItems(original, grid, options = {}) {
  const total = grid.columns * grid.rows;
  const width = zeroPadWidth(total);
  const items = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const order = items.length + 1;
      const id = String(order).padStart(width, '0');
      const left = Math.round((column / grid.columns) * original.width);
      const right = Math.round(((column + 1) / grid.columns) * original.width);
      const top = Math.round((row / grid.rows) * original.height);
      const bottom = Math.round(((row + 1) / grid.rows) * original.height);
      const absolute = clampBox({
        x: left,
        y: top,
        width: Math.max(1, right - left),
        height: Math.max(1, bottom - top),
      }, original);
      items.push({
        order,
        id,
        label: `${options.labelPrefix ?? '对象'} ${id}`,
        note: `${column + 1}/${grid.columns} 列 · ${row + 1}/${grid.rows} 行`,
        cropBox: absoluteToRatio(absolute, original),
        absoluteBox: absolute,
        requestedBox: absoluteToRatio(absolute, original),
        requestedUnit: 'ratio',
      });
    }
  }
  return items;
}

function resolveRawBox(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid boxes entry.');
  }
  if (raw.box && typeof raw.box === 'object') {
    return raw.box;
  }
  if (raw.crop && typeof raw.crop === 'object') {
    return raw.crop;
  }
  if (raw.region && typeof raw.region === 'object') {
    return raw.region;
  }
  return raw;
}

async function loadBoxItems(projectRoot, boxesPath, original) {
  const sourcePath = resolveProjectPath(projectRoot, boxesPath);
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const container = Array.isArray(payload) ? { items: payload } : payload;
  const rawItems = container.items ?? container.boxes ?? container.regions ?? container.cells ?? container.slices;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error(`Box plan in ${boxesPath} must provide a non-empty items/boxes/regions array.`);
  }
  const width = zeroPadWidth(rawItems.length);
  const items = rawItems.map((raw, index) => {
    const order = index + 1;
    const fallbackId = String(order).padStart(width, '0');
    const resolved = resolveCropBox(resolveRawBox(raw), original);
    const absolute = resolved.absolute;
    const cropBox = absoluteToRatio(absolute, original);
    const label = String(raw.label ?? raw.name ?? raw.title ?? fallbackId);
    return {
      order,
      id: sanitizeItemId(raw.id, fallbackId),
      label,
      note: String(raw.note ?? raw.reason ?? '').trim(),
      cropBox,
      absoluteBox: absolute,
      requestedBox: resolved.requested,
      requestedUnit: resolved.unit,
    };
  });
  return {
    sourcePath,
    title: typeof container.title === 'string' ? container.title.trim() : '',
    summary: typeof container.summary === 'string' ? container.summary.trim() : '',
    items,
  };
}

function parseIncludeTokens(include) {
  return new Set(
    String(include ?? '')
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

function filterItemsByInclude(items, include) {
  if (!include) {
    return items;
  }
  const tokens = parseIncludeTokens(include);
  const filtered = items.filter((item) => (
    tokens.has(String(item.order).toLowerCase())
    || tokens.has(String(item.id).toLowerCase())
    || tokens.has(String(item.label).toLowerCase())
  ));
  if (filtered.length === 0) {
    throw new Error(`--include did not match any crop item. Available ids: ${items.map((item) => item.id).join(', ')}`);
  }
  return filtered;
}

function ensureUniqueItemIds(items) {
  const seen = new Set();
  for (const item of items) {
    const key = String(item.id);
    if (seen.has(key)) {
      throw new Error(`Duplicate crop id detected: ${item.id}`);
    }
    seen.add(key);
  }
}

async function stageReferenceSource(referencePath, outputPath) {
  const sourcePath = path.resolve(referencePath);
  const sourceMetadata = await sharp(sourcePath).metadata();
  if (!sourceMetadata.width || !sourceMetadata.height) {
    throw new Error(`Cannot read image dimensions: ${referencePath}`);
  }
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  await fs.writeFile(outputPath, data);
  return {
    originalPath: sourcePath,
    originalSha256: await sha256File(sourcePath),
    originalMetadata: {
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      format: sourceMetadata.format ?? null,
    },
    stagedPath: outputPath,
    stagedSha256: sha256Buffer(data),
    stagedMetadata: {
      width: info.width,
      height: info.height,
      format: info.format,
    },
  };
}

async function writeCrop(sourcePath, box, outputPath) {
  const { data, info } = await sharp(sourcePath)
    .extract({
      left: box.x,
      top: box.y,
      width: box.width,
      height: box.height,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  await fs.writeFile(outputPath, data);
  return {
    path: outputPath,
    sha256: sha256Buffer(data),
    metadata: {
      width: info.width,
      height: info.height,
      format: info.format,
    },
  };
}

async function renderReferenceCard(projectRoot, item, index, options = {}) {
  const cardWidth = options.cardWidth;
  const contentWidth = cardWidth - 36;
  const header = sectionHeaderSvg(
    contentWidth,
    index + 1,
    `${item.id} · ${item.label}`,
    item.note || `裁剪 ${item.crop.metadata.width}x${item.crop.metadata.height}px`,
  );
  const composites = [
    { input: header.input, left: 18, top: 18 },
  ];
  const panel = await resizePanel(item.crop.path, Math.min(DEFAULT_THUMB_WIDTH, contentWidth));
  const panelTop = 18 + header.height + 12;
  composites.push(
    { input: panel.input, left: 18 + Math.round((contentWidth - panel.width) / 2), top: panelTop },
    { input: labelSvg(`参考 ${item.id}`, { fontSize: 16, height: 36, minWidth: 96, paddingX: 16, radius: 12 }), left: 30, top: panelTop + 12 },
  );
  const metrics = metricsSvg(contentWidth, [
    { label: '裁剪', value: `${item.crop.metadata.width}x${item.crop.metadata.height}px` },
    { label: '位置', value: `${item.absoluteBox.x},${item.absoluteBox.y},${item.absoluteBox.width},${item.absoluteBox.height}` },
  ]);
  let currentTop = panelTop + panel.height + 16;
  if (metrics.input) {
    composites.push({ input: metrics.input, left: 18, top: currentTop });
    currentTop += metrics.height + 12;
  }
  const cardHeight = currentTop + 18;
  const card = sharp({
    create: {
      width: cardWidth,
      height: cardHeight,
      channels: 3,
      background: '#0f172a',
    },
  }).composite([
    ...composites,
    {
      input: Buffer.from(`
<svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}" xmlns="http://www.w3.org/2000/svg">
  <rect x="0.75" y="0.75" width="${cardWidth - 1.5}" height="${cardHeight - 1.5}" rx="22" fill="none" stroke="#334155" stroke-width="1.5"/>
</svg>`),
      left: 0,
      top: 0,
    },
  ]);
  return {
    image: await card.png().toBuffer(),
    width: cardWidth,
    height: cardHeight,
  };
}

async function renderContactSheet(projectRoot, sourcePath, items, outputPath, options = {}) {
  const overview = await resizePanel(sourcePath, DEFAULT_OVERVIEW_WIDTH);
  const margin = 24;
  const gap = 24;
  const columns = Math.max(1, Math.min(DEFAULT_CARD_COLUMNS, items.length));
  const cardWidth = 320;
  const contentWidth = Math.max(overview.width, columns * cardWidth + (columns - 1) * gap);
  const titleBlock = titleBlockSvg(
    contentWidth,
    options.title ?? '参考图预处理',
    options.summary ?? `先检查整板编号和每个裁剪块是否完整，再决定哪些对象纳入后续视觉对比。当前共 ${items.length} 个参考对象。`,
    '视觉验收 / Reference Set',
  );
  const overviewTop = margin + titleBlock.height + 18;
  const overviewLeft = margin + Math.round((contentWidth - overview.width) / 2);
  const overlayRegions = items.map((item, index) => ({
    color: FOCUS_COLORS[index % FOCUS_COLORS.length],
    box: renderedBoxFromAbsolute(item.absoluteBox, overview),
  }));
  const renderedCards = [];
  for (const [index, item] of items.entries()) {
    renderedCards.push(await renderReferenceCard(projectRoot, item, index, { cardWidth }));
  }
  const rowHeights = [];
  for (let index = 0; index < renderedCards.length; index += columns) {
    rowHeights.push(Math.max(...renderedCards.slice(index, index + columns).map((card) => card.height)));
  }
  const overviewBottom = overviewTop + overview.height;
  const cardsTop = overviewBottom + 28;
  const cardsHeight = rowHeights.reduce((sum, value) => sum + value, 0) + Math.max(0, rowHeights.length - 1) * gap;
  const canvasWidth = contentWidth + margin * 2;
  const canvasHeight = cardsTop + cardsHeight + margin;
  const composites = [
    { input: titleBlock.input, left: margin, top: margin },
    { input: overview.input, left: overviewLeft, top: overviewTop },
    { input: labelSvg('参考整板'), left: overviewLeft + 16, top: overviewTop + 16 },
    { input: focusOverlaySvg(overview.width, overview.height, overlayRegions), left: overviewLeft, top: overviewTop },
  ];
  let currentTop = cardsTop;
  for (let row = 0; row < rowHeights.length; row += 1) {
    const rowCards = renderedCards.slice(row * columns, row * columns + columns);
    const rowWidth = rowCards.length * cardWidth + Math.max(0, rowCards.length - 1) * gap;
    const rowLeft = margin + Math.round((contentWidth - rowWidth) / 2);
    for (const [column, card] of rowCards.entries()) {
      composites.push({
        input: card.image,
        left: rowLeft + column * (cardWidth + gap),
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
  await canvas.jpeg({ quality: 85 }).toFile(outputPath);
}

function buildFocusBoardTemplate(paths, title, items) {
  return {
    mode: 'focus-board',
    presentation: items.length === 1 ? 'local-first' : 'detailed',
    title: `${title} 局部焦点模板`,
    summary: items.length === 1
      ? '局部优先对比：把 right.path 替换成实现截图，使用独立 rightBox 定位同一语义对象，左右保持同一像素尺度。'
      : '把 right.path 替换成实现截图；如果实现截图布局与参考图不同，再分别调整 rightBox。',
    left: {
      path: paths.source,
      label: '参考整板',
    },
    right: {
      path: DEFAULT_IMPLEMENTATION_PLACEHOLDER,
      label: '实现截图',
    },
    focusRegions: items.map((item) => ({
      label: item.label,
      reason: item.note || `由 reference-set ${item.id} 自动生成，可按需微调 rightBox。`,
      leftBox: item.cropBox,
      rightBox: item.cropBox,
    })),
  };
}

function buildParallelBoardTemplate(title, items) {
  return {
    mode: 'parallel-board',
    title: `${title} 参考映射模板`,
    summary: '每张卡先挂参考 crop。要做多对象、多方向或多页面统一验收时，在对应卡片里继续补实现截图、指标或备注。',
    columns: Math.max(1, Math.min(DEFAULT_CARD_COLUMNS, items.length)),
    cardWidth: 360,
    items: items.map((item) => ({
      label: item.label,
      subtitle: `参考对象 ${item.id}`,
      verdict: '待补实现截图',
      media: [
        { path: item.crop.workspacePath, label: '参考 crop' },
      ],
      notes: '需要时可继续补实现截图、指标或阶段性结论。',
    })),
  };
}

function buildComparePlan(referenceSetPath, title, items, artifacts) {
  return {
    version: 1,
    schema: VISUAL_PREPARE_PLAN_SCHEMA,
    generatedAt: timestamp(),
    title: `${title} 对比计划`,
    referenceSet: referenceSetPath,
    artifacts,
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      reference: item.crop.workspacePath,
      suggestedActual: DEFAULT_IMPLEMENTATION_PLACEHOLDER,
      suggestedCommand: `open-vibecoding visual-compare . --reference ${item.crop.workspacePath} --actual ${DEFAULT_IMPLEMENTATION_PLACEHOLDER}`,
    })),
  };
}

function inferReferenceTitle(referencePath, explicitTitle) {
  if (explicitTitle) {
    return String(explicitTitle).trim();
  }
  const base = path.basename(referencePath, path.extname(referencePath)).replace(/[-_]+/g, ' ').trim();
  return base || '参考图预处理';
}

function inferReferenceSetId(referencePath, explicitId) {
  if (explicitId) {
    return slugify(explicitId);
  }
  return `${slugify(path.basename(referencePath, path.extname(referencePath)))}-${compactTimestamp()}`;
}

async function visualPrepareWorkspace(projectRoot, options = {}) {
  if (!options.reference) {
    throw new Error('Missing --reference image path.');
  }
  const hasGrid = Boolean(options.grid);
  const hasBoxes = Boolean(options.boxes);
  if (hasGrid === hasBoxes) {
    throw new Error('Use exactly one prepare mode: --grid <columns>x<rows> or --boxes <plan.json>.');
  }

  const referencePath = resolveProjectPath(projectRoot, options.reference);
  const referenceTitle = inferReferenceTitle(referencePath, options.title);
  const setId = inferReferenceSetId(referencePath, options.id);
  const outputDir = options.out
    ? resolveProjectPath(projectRoot, options.out)
    : path.join(projectRoot, DEFAULT_REFERENCE_SET_DIR, setId);
  const cropsDir = path.join(outputDir, 'crops');
  await fs.mkdir(cropsDir, { recursive: true });

  const stagedSourcePath = path.join(outputDir, DEFAULT_SOURCE_FILENAME);
  const staged = await stageReferenceSource(referencePath, stagedSourcePath);
  const original = staged.stagedMetadata;

  let mode;
  let grid = null;
  let boxesSourcePath = null;
  let summary = '';
  let items;
  if (hasGrid) {
    mode = 'grid';
    grid = parseGridSpec(options.grid);
    items = buildGridItems(original, grid, { labelPrefix: '对象' });
    summary = `${grid.columns}x${grid.rows} 网格切片，共 ${items.length} 个参考对象。`;
  } else {
    mode = 'boxes';
    const loaded = await loadBoxItems(projectRoot, options.boxes, original);
    boxesSourcePath = loaded.sourcePath;
    summary = loaded.summary || `${loaded.items.length} 个手工裁剪对象。`;
    items = loaded.items;
  }

  items = filterItemsByInclude(items, options.include);
  ensureUniqueItemIds(items);

  const itemResults = [];
  for (const item of items) {
    const cropPath = path.join(cropsDir, `${item.id}.png`);
    const crop = await writeCrop(stagedSourcePath, item.absoluteBox, cropPath);
    itemResults.push({
      ...item,
      crop: {
        ...crop,
        workspacePath: toWorkspacePath(projectRoot, crop.path),
      },
    });
  }

  const contactSheetPath = path.join(outputDir, DEFAULT_CONTACT_SHEET_FILENAME);
  await renderContactSheet(projectRoot, stagedSourcePath, itemResults, contactSheetPath, {
    title: referenceTitle,
    summary,
  });

  const paths = {
    source: toWorkspacePath(projectRoot, stagedSourcePath),
    contactSheet: toWorkspacePath(projectRoot, contactSheetPath),
    referenceSet: normalizeWorkspacePath(path.join(toWorkspacePath(projectRoot, outputDir), DEFAULT_REFERENCE_SET_FILENAME)),
    focusBoardTemplate: normalizeWorkspacePath(path.join(toWorkspacePath(projectRoot, outputDir), DEFAULT_FOCUS_BOARD_TEMPLATE)),
    parallelBoardTemplate: normalizeWorkspacePath(path.join(toWorkspacePath(projectRoot, outputDir), DEFAULT_PARALLEL_BOARD_TEMPLATE)),
    comparePlan: normalizeWorkspacePath(path.join(toWorkspacePath(projectRoot, outputDir), DEFAULT_COMPARE_PLAN_FILENAME)),
  };

  const focusBoardTemplate = buildFocusBoardTemplate(paths, referenceTitle, itemResults);
  const parallelBoardTemplate = buildParallelBoardTemplate(referenceTitle, itemResults);
  const comparePlan = buildComparePlan(paths.referenceSet, referenceTitle, itemResults, {
    focusBoardTemplate: paths.focusBoardTemplate,
    parallelBoardTemplate: paths.parallelBoardTemplate,
  });

  const referenceSet = {
    version: 1,
    schema: REFERENCE_SET_SCHEMA,
    generatedAt: timestamp(),
    id: setId,
    title: referenceTitle,
    mode,
    summary,
    source: {
      originalPath: referencePath,
      originalSha256: staged.originalSha256,
      originalMetadata: staged.originalMetadata,
      stagedPath: paths.source,
      stagedSha256: staged.stagedSha256,
      stagedMetadata: staged.stagedMetadata,
    },
    selection: mode === 'grid'
      ? { mode, grid, include: options.include ?? null }
      : { mode, boxesPath: boxesSourcePath ? toWorkspacePath(projectRoot, boxesSourcePath) : null, include: options.include ?? null },
    artifacts: {
      contactSheet: paths.contactSheet,
      focusBoardTemplate: paths.focusBoardTemplate,
      parallelBoardTemplate: paths.parallelBoardTemplate,
      comparePlan: paths.comparePlan,
    },
    items: itemResults.map((item) => ({
      order: item.order,
      id: item.id,
      label: item.label,
      note: item.note,
      cropPath: item.crop.workspacePath,
      cropSha256: item.crop.sha256,
      cropMetadata: item.crop.metadata,
      cropBox: item.cropBox,
      absoluteBox: item.absoluteBox,
      requestedUnit: item.requestedUnit,
      requestedBox: item.requestedBox,
    })),
  };

  await fs.writeFile(path.join(outputDir, DEFAULT_REFERENCE_SET_FILENAME), `${JSON.stringify(referenceSet, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, DEFAULT_FOCUS_BOARD_TEMPLATE), `${JSON.stringify(focusBoardTemplate, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, DEFAULT_PARALLEL_BOARD_TEMPLATE), `${JSON.stringify(parallelBoardTemplate, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(outputDir, DEFAULT_COMPARE_PLAN_FILENAME), `${JSON.stringify(comparePlan, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    action: 'visual-prepare',
    projectRoot,
    setId,
    title: referenceTitle,
    mode,
    outputDir,
    referenceSetPath: path.join(outputDir, DEFAULT_REFERENCE_SET_FILENAME),
    contactSheetPath,
    focusBoardTemplatePath: path.join(outputDir, DEFAULT_FOCUS_BOARD_TEMPLATE),
    parallelBoardTemplatePath: path.join(outputDir, DEFAULT_PARALLEL_BOARD_TEMPLATE),
    comparePlanPath: path.join(outputDir, DEFAULT_COMPARE_PLAN_FILENAME),
    itemCount: itemResults.length,
    items: itemResults.map((item) => ({
      id: item.id,
      label: item.label,
      cropPath: item.crop.path,
      cropMetadata: item.crop.metadata,
      cropBox: item.cropBox,
    })),
    source: {
      originalPath: referencePath,
      stagedPath: stagedSourcePath,
      metadata: staged.stagedMetadata,
    },
    nextActions: [
      '先打开 contact-sheet 检查编号、边界和裁剪是否完整，确认没有漏裁、裁偏或跨对象。',
      '如果只需要其中一部分对象纳入后续验收，重新运行 visual-prepare 并用 --include 收紧范围，或改用 --boxes 精细定义。',
      '多对象逐项对比时优先使用 compare-plan.json 里的单项 reference 命令；同一整板局部验收时再编辑 focus-board.template.json。',
    ],
  };
}

export {
  visualPrepareWorkspace,
};
