import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { atomicWriteJson, withFileLock, readJsonIfExists } from './kernel/atomic-store.js';

const digest = (data) => createHash('sha256').update(data).digest('hex');
const schema = 'open-vibecoding.design-review.v1';
const escapeXml = (value) => String(value).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

// Reject symlink output components: archives must remain inside the project.
async function safePath(root, target) {
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output outside project');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) throw new Error(`Symlink output is not allowed: ${current}`);
  }
}

async function loadImages(root, images) {
  if (!Array.isArray(images) || images.length < 1 || images.length > 9) throw new Error('Provide 1–9 images per review');
  const formats = { png: 'png', jpeg: 'jpg', webp: 'webp' };
  const result = [];
  for (const [i, image] of images.entries()) {
    if (typeof image.path !== 'string') throw new Error('Each image needs a path');
    const source = path.resolve(root, image.path);
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw new Error('Image must be a file no larger than 32 MiB');
    const data = await fs.readFile(source);
    const meta = await sharp(data).metadata();
    if (!formats[meta.format] || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || meta.width * meta.height > 40_000_000) throw new Error('Use a single-frame PNG, JPEG or WebP up to 40 megapixels');
    const option = `option-${String(i + 1).padStart(2, '0')}`;
    result.push({ data, option, label: String(image.label ?? option).slice(0, 60), file: `originals/${option}.${formats[meta.format]}`, sha256: digest(data), width: meta.width, height: meta.height });
  }
  return result;
}

async function board(images, output) {
  const width = 440;
  const height = 960;
  const columns = Math.min(3, images.length);
  const layers = [];
  for (const [i, image] of images.entries()) {
    const left = (i % columns) * width;
    const top = Math.floor(i / columns) * height;
    const preview = await sharp(image.data).rotate().resize(420, 880, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const size = await sharp(preview).metadata();
    layers.push({ input: preview, left: left + Math.floor((width - size.width) / 2), top: top + 64 + Math.floor((880 - size.height) / 2) });
    const displayLabel = [...image.label].length > 18 ? `${[...image.label].slice(0, 18).join('')}…` : image.label;
    const label = `<svg width="440" height="54"><rect width="440" height="54" fill="#f4f5f7"/><text x="14" y="32" font-size="18" fill="#17212b">${i + 1}. ${escapeXml(displayLabel)}</text></svg>`;
    layers.push({ input: Buffer.from(label), left, top });
  }
  await sharp({ create: { width: columns * width, height: Math.ceil(images.length / columns) * height, channels: 3, background: '#f4f5f7' } }).composite(layers).png().toFile(output);
}

export async function designReviewWorkspace(projectPath, { action, jsonFile, input } = {}) {
  let stage;
  try {
    const root = await fs.realpath(path.resolve(projectPath));
    const plan = input ?? JSON.parse(await fs.readFile(path.resolve(root, jsonFile), 'utf8'));
    if (!['save', 'select'].includes(action)) throw new Error('Use action save or select');
    if (typeof plan.scene !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(plan.scene)) throw new Error('scene must be a safe lowercase identifier');
    const directory = path.join(root, 'design', plan.scene);
    await safePath(root, directory);
    if (action === 'select' && plan.confirmed !== true) throw new Error('Selecting final requires explicit user confirmation (confirmed: true)');
    const images = action === 'save' ? await loadImages(root, plan.images) : null;
    if (action === 'select') await fs.access(directory);
    await fs.mkdir(directory, { recursive: true });
    const indexFile = path.join(directory, 'index.json');
    const lockFile = path.join(directory, '.review.lock');
    await safePath(root, lockFile);
    return await withFileLock(lockFile, async () => {
      await safePath(root, indexFile);
      const index = await readJsonIfExists(indexFile, { schema, versions: [], currentFinal: null });
      if (index.schema !== schema || !Array.isArray(index.versions)) throw new Error('Unsupported design index');
      if (action === 'save') {
        const names = await fs.readdir(directory);
        const next = Math.max(0, ...names.filter((name) => /^v\d+$/.test(name)).map((name) => Number(name.slice(1)))) + 1;
        const version = `v${String(next).padStart(3, '0')}`;
        const destination = path.join(directory, version);
        stage = path.join(directory, `.stage-${randomUUID()}`);
        await fs.mkdir(path.join(stage, 'originals'), { recursive: true });
        for (const image of images) await fs.writeFile(path.join(stage, image.file), image.data, { flag: 'wx' });
        await board(images, path.join(stage, 'review.png'));
        const options = images.map(({ data, ...record }) => record);
        await atomicWriteJson(path.join(stage, 'review.json'), { schema, scene: plan.scene, version, options });
        await fs.rename(stage, destination);
        stage = null;
        index.versions.push(version);
        await atomicWriteJson(indexFile, index);
        const review = path.join(destination, 'review.png');
        return { ok: true, scene: plan.scene, version, review, chatEmbed: `![视觉方向评审](${review})`, originals: options.map((option) => ({ ...option, path: path.join(destination, option.file) })) };
      }
      if (!/^v\d{3,}$/.test(plan.version ?? '') || !/^option-\d{2}$/.test(plan.option ?? '')) throw new Error('Invalid version or option');
      const versionDir = path.join(directory, plan.version);
      const manifest = path.join(versionDir, 'review.json');
      await safePath(root, manifest);
      const review = await readJsonIfExists(manifest);
      if (review?.schema !== schema || review.version !== plan.version || review.scene !== plan.scene) throw new Error('Invalid review manifest');
      const option = review.options?.find((item) => item.option === plan.option);
      if (!option || !new RegExp(`^originals/${plan.option}\\.(png|jpg|webp)$`).test(option.file)) throw new Error('Option not present in review');
      const original = path.join(versionDir, option.file);
      await safePath(root, original);
      const data = await fs.readFile(original);
      if (digest(data) !== option.sha256) throw new Error('Original image changed; refusing to mark final');
      const final = path.join(versionDir, `${plan.option}-final${path.extname(original)}`);
      await safePath(root, final);
      try { await fs.writeFile(final, data, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (digest(await fs.readFile(final)) !== option.sha256) throw new Error('Existing final differs; refusing overwrite');
      }
      index.currentFinal = { version: plan.version, option: plan.option, file: path.relative(directory, final), sha256: option.sha256 };
      await atomicWriteJson(indexFile, index);
      return { ok: true, scene: plan.scene, ...index.currentFinal, original, final, chatEmbed: `![选定设计原图](${final})` };
    });
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (stage) await fs.rm(stage, { recursive: true, force: true });
  }
}
