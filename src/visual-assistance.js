import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const MAX_PIXELS = 16777216;
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const xml = (value) => String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

export function checkedRect(rect, width, height) {
  if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(Number.isFinite)
    || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0
    || rect[0] + rect[2] > width || rect[1] + rect[3] > height) throw new Error('Rectangle must be [x,y,width,height] inside the image');
  return [...rect];
}

// view describes the displayed image content itself, excluding toolbars/letterboxing.
export function mapViewRect(rect, view, image) {
  if (!view || !Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width <= 0 || view.height <= 0) throw new Error('Declare the displayed image content size');
  const crop = checkedRect(view.crop ?? [0, 0, image.width, image.height], image.width, image.height);
  checkedRect(rect, view.width, view.height);
  const sx = crop[2] / view.width, sy = crop[3] / view.height;
  if (Math.abs(sx / sy - 1) > 0.001) throw new Error('Image aspect ratio differs; account for letterboxing or distortion first');
  return checkedRect([crop[0] + rect[0] * sx, crop[1] + rect[1] * sy, rect[2] * sx, rect[3] * sy], image.width, image.height);
}

async function sourceImage(source, out) {
  if (!source || !out) throw new Error('source and out are required');
  const input = path.resolve(source), output = path.resolve(out);
  if (input === output || path.extname(output).toLowerCase() !== '.png') throw new Error('Choose a new PNG output, distinct from the original');
  const stat = await fs.stat(input);
  if (stat.size > 64 * 1024 * 1024) throw new Error('Input exceeds 64 MiB');
  const bytes = await fs.readFile(input);
  const meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
  if (!['png', 'jpeg', 'webp'].includes(meta.format) || (meta.pages ?? 1) !== 1) throw new Error('Only single-frame PNG, JPEG and WebP are supported');
  if (meta.orientation && meta.orientation !== 1) throw new Error('Normalize image orientation into a new source before choosing coordinates');
  if (!meta.width || !meta.height || meta.width * meta.height > MAX_PIXELS) throw new Error('Image exceeds pixel budget');
  return { bytes, output, source: { width: meta.width, height: meta.height, sha256: hash(bytes) } };
}

function binding(plan, source) {
  if (!plan?.source || plan.source.width !== source.width || plan.source.height !== source.height || plan.source.sha256 !== source.sha256) throw new Error('Plan source dimensions/hash do not match the current image; remeasure instead of reusing stale coordinates');
}

async function writeOverlay(image, overlay) {
  const result = await sharp(image.bytes, { limitInputPixels: MAX_PIXELS })
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${image.source.width}" height="${image.source.height}">${overlay}</svg>`) }])
    .png().toBuffer();
  // Never overwrite originals, previous versions, or symlink destinations.
  await fs.writeFile(image.output, result, { flag: 'wx' });
  return { ok: true, output: image.output, source: image.source, outputSha256: hash(result),
    reviewRequired: true, reviewStatus: 'awaiting_visual_review' };
}

export async function visualGrid({ source, out, step = 100, plan }) {
  if (!Number.isInteger(step) || step < 10 || step > 5000) throw new Error('step must be an integer between 10 and 5000');
  const image = await sourceImage(source, out);
  const { width, height } = image.source;
  if (Math.ceil(width / step) + Math.ceil(height / step) > 2000) throw new Error('Too many grid lines; use a coarser grid or a smaller source');
  const mappedTargets = [];
  if (plan) {
    binding(plan, image.source);
    if (!Array.isArray(plan.targets) || plan.targets.length > 64) throw new Error('Provide up to 64 coordinate targets');
    for (const target of plan.targets) mappedTargets.push({ id: target.id, rect: mapViewRect(target.rect, plan.view, image.source) });
  }
  const parts = [];
  for (let x = 0; x < width; x += step) parts.push(`<path d="M${x} 0V${height}" stroke="#e62323" stroke-opacity=".55"/><text x="${x + 2}" y="14" font-size="12" fill="#b00000" stroke="white" stroke-width="3" paint-order="stroke">${x}</text>`);
  for (let y = 0; y < height; y += step) parts.push(`<path d="M0 ${y}H${width}" stroke="#e62323" stroke-opacity=".55"/><text x="2" y="${Math.min(y + 14, height - 2)}" font-size="12" fill="#b00000" stroke="white" stroke-width="3" paint-order="stroke">${y}</text>`);
  return { ...await writeOverlay(image, parts.join('')), role: 'coordinate-guide-only', step, mappedTargets,
    note: 'View the grid and original. Grid coordinates are image pixels, not screen clicks or CSS positions.' };
}

const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const inCanvas = (r, w, h) => r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0 && r[0] + r[2] <= w && r[1] + r[3] <= h;

export function resolveAnnotations(plan, source) {
  binding(plan, source);
  if (plan.view) throw new Error('Annotation coordinates must already be source pixels; map the preview first');
  const { width, height } = source;
  if (!Array.isArray(plan.targets) || !plan.targets.length || plan.targets.length > 64) throw new Error('Provide 1 to 64 annotation targets');
  const fontSize = plan.fontSize ?? 20;
  if (!Number.isInteger(fontSize) || fontSize < 12 || fontSize > 96) throw new Error('fontSize must be 12 to 96');
  const protectedRegions = (plan.protectedRegions ?? []).map(r => checkedRect(r, width, height));
  if (protectedRegions.length > 2000) throw new Error('Too many protected regions');
  const ids = new Set();
  let sequence = 0, alternative = 0;
  const targets = plan.targets.map(target => {
    if (typeof target.id !== 'string' || !target.id.trim() || ids.has(target.id)) throw new Error('Targets need unique nonempty ids');
    ids.add(target.id);
    const rect = checkedRect(target.rect, width, height);
    const kind = target.kind ?? 'single';
    if (!['single', 'sequence', 'alternative'].includes(kind)) throw new Error('Unknown annotation kind');
    if (typeof target.label !== 'string' || !target.label.trim() || target.label.length > 80 || /[\x00-\x1f]/.test(target.label)) throw new Error('Provide a short, single-line action or result label');
    const prefix = kind === 'sequence' ? `${++sequence}. ` : kind === 'alternative' ? `${String.fromCharCode(65 + alternative++)}. ` : '';
    if (alternative > 26) throw new Error('Split more than 26 alternatives into separate images');
    return { id: target.id, rect, kind, text: prefix + target.label, requestedLabelRect: target.labelRect };
  });
  const placed = [];
  for (const target of targets) {
    const [x, y, w, h] = target.rect;
    // The actual 3px frame stroke, not the entire target, must avoid protected text.
    const bands = [[x - 1.5, y - 1.5, w + 3, 3], [x - 1.5, y + h - 1.5, w + 3, 3], [x - 1.5, y - 1.5, 3, h + 3], [x + w - 1.5, y - 1.5, 3, h + 3]];
    if (bands.some(b => !inCanvas(b, width, height) || protectedRegions.some(r => overlaps(b, r)))) throw new Error(`Frame clips the image or crosses protected content: ${target.id}`);
    const textWidth = [...target.text].reduce((sum, c) => sum + (/[^\x00-\x7f]/.test(c) ? 1 : 0.65) * fontSize, 0);
    const lw = Math.ceil(textWidth + 20), lh = fontSize + 18;
    const candidates = target.requestedLabelRect ? [checkedRect(target.requestedLabelRect, width, height)]
      : [[x, y + h + 8, lw, lh], [x, y - lh - 8, lw, lh], [x + w + 8, y, lw, lh], [x - lw - 8, y, lw, lh]];
    const expanded = r => [r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2];
    const labelRect = candidates.find(r => r[2] >= lw && r[3] >= lh && inCanvas(expanded(r), width, height)
      && !protectedRegions.some(p => overlaps(expanded(r), p)) && !targets.some(t => overlaps(expanded(r), t.rect)) && !placed.some(t => overlaps(expanded(r), expanded(t.labelRect))));
    if (!labelRect) throw new Error(`layout_collision: shorten the label, supply a safe labelRect, or split the image: ${target.id}`);
    const dx = Math.max(x - (labelRect[0] + labelRect[2]), labelRect[0] - (x + w), 0);
    const dy = Math.max(y - (labelRect[1] + labelRect[3]), labelRect[1] - (y + h), 0);
    if (Math.hypot(dx, dy) > Math.max(80, fontSize * 4)) throw new Error(`Label is too far from its target: ${target.id}`);
    placed.push({ id: target.id, rect: target.rect, kind: target.kind, text: target.text, labelRect });
  }
  return { fontSize, targets: placed, protectedRegionCount: protectedRegions.length };
}

export async function imageAnnotate({ source, out, plan }) {
  const image = await sourceImage(source, out);
  const resolved = resolveAnnotations(plan, image.source);
  const color = plan.color ?? '#e62323';
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('color must be #RRGGBB');
  const overlay = resolved.targets.map(t => {
    const [x, y, w, h] = t.rect, [lx, ly, lw, lh] = t.labelRect;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${color}" stroke-width="3"/>`
      + `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="8" fill="white" stroke="${color}" stroke-width="2"/>`
      + `<text x="${lx + 10}" y="${ly + (lh + resolved.fontSize) / 2 - 3}" font-family="sans-serif" font-size="${resolved.fontSize}" fill="${color}">${xml(t.text)}</text>`;
  }).join('');
  return { ...await writeOverlay(image, overlay), resolvedPlan: resolved,
    note: 'Geometry checks do not prove correct targets, OCR coverage, font fit or readability. Open the full output and local crops before accepting it.' };
}
