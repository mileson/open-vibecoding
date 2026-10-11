/* Deterministic local icon alpha processing. Reuses sharp; never calls an image API. */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export function cutoutPixels(input, width, height, { keyColor, tolerance = 30, feather = 35 } = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || input.length !== width * height * 4) {
    throw new Error('Expected RGBA pixels with valid dimensions');
  }
  if (![tolerance, feather].every((value) => Number.isFinite(value) && value >= 0 && value <= 255)) {
    throw new Error('tolerance and feather must be between 0 and 255');
  }
  if (keyColor !== undefined && !/^#[0-9a-f]{6}$/i.test(keyColor)) throw new Error('key-color must be #RRGGBB');
  const key = keyColor ? [1, 3, 5].map((offset) => parseInt(keyColor.slice(offset, offset + 2), 16)) : null;
  const data = Buffer.from(input);
  let transparent = 0, partial = 0, visible = 0;
  let left = width, top = height, right = -1, bottom = -1;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (key && data[i + 3]) {
      const distance = Math.max(...key.map((color, channel) => Math.abs(data[i + channel] - color)));
      const opacity = feather === 0 ? Number(distance > tolerance) : Math.max(0, Math.min(1, (distance - tolerance) / feather));
      if (opacity > 0 && opacity < 1) {
        // Unmix the known matte colour from partially covered edge pixels.
        for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round((data[i + c] - (1 - opacity) * key[c]) / opacity)));
      }
      data[i + 3] = Math.round(data[i + 3] * opacity);
    }
    const alpha = data[i + 3];
    if (!alpha) {
      transparent++;
      data[i] = data[i + 1] = data[i + 2] = 0;
    } else {
      visible++;
      if (alpha < 255) partial++;
      const x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const corners = [0, width - 1, (height - 1) * width, width * height - 1].map((p) => data[p * 4 + 3]);
  const bounds = visible ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } : null;
  return { data, report: {
    width, height, mode: key ? 'chroma-key' : 'preserve-alpha', keyColor: keyColor ?? null,
    transparentPixels: transparent, partialPixels: partial, visiblePixels: visible,
    cornerAlpha: corners, bounds,
    touchesEdge: visible ? left === 0 || top === 0 || right === width - 1 || bottom === height - 1 : false,
  } };
}

export async function iconCutout({ source, out, keyColor, tolerance, feather }) {
  if (!source || !out) throw new Error('source and out are required');
  const sourcePath = path.resolve(source), outputPath = path.resolve(out);
  if (sourcePath === outputPath) throw new Error('Output must differ from the original');
  if (path.extname(outputPath).toLowerCase() !== '.png') throw new Error('Output must be a PNG');
  const { data, info } = await sharp(sourcePath, { limitInputPixels: 16777216 })
    .rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) throw new Error('Expected four decoded RGBA channels');
  const processed = cutoutPixels(data, info.width, info.height, { keyColor, tolerance, feather });
  if (!processed.report.visiblePixels) throw new Error('Key removed the entire subject; no output written');
  if (!processed.report.transparentPixels) throw new Error('No fully transparent background found; specify a contrasting key colour or review the source');
  const png = await sharp(processed.data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  // Exclusive write protects both existing files and symlink destinations.
  await fs.writeFile(outputPath, png, { flag: 'wx' });
  const warnings = [];
  if (processed.report.cornerAlpha.some((alpha) => alpha !== 0)) warnings.push('Some corners are not transparent; inspect the background');
  if (processed.report.touchesEdge) warnings.push('Visible pixels touch the canvas edge; inspect possible clipping');
  return { ok: true, source: sourcePath, output: outputPath, ...processed.report, warnings,
    reviewRequired: true, note: 'Pixel checks do not establish subject integrity, visual centering or style consistency.' };
}
