import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { escapeHtml as html } from './html-artifact-utils.js';
import { field, items, referenceLink, rowIdentifiers, texts } from './prd-fields.js';

export const designStatuses = new Map([
  ['pending-design', '待设计'],
  ['pending-review', '待确认'],
  ['selected', '已选稿'],
]);

const imageTypes = new Map([['.png', 'png'], ['.jpg', 'jpeg'], ['.jpeg', 'jpeg'], ['.webp', 'webp']]);

function imageFormat(bytes) {
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.toString('ascii', 12, 16) === 'IHDR') return 'png';
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
    && bytes.readUInt32LE(4) + 8 <= bytes.length) return 'webp';
  return '';
}

function loadImage(image, name, baseDir, embed) {
  const imagePath = field(image?.path, `${name}.path`);
  const alt = field(image.alt, `${name}.alt`);
  const type = imageTypes.get(path.extname(imagePath).toLowerCase());
  if (!type) throw new TypeError(`${name}.path 需要本地 PNG、JPEG 或 WebP 文件`);
  const file = path.resolve(baseDir, imagePath);
  let bytes;
  try {
    if (!statSync(file).isFile()) throw new Error('不是普通文件');
    bytes = readFileSync(file);
  } catch (error) {
    throw new Error(`${name}.path 无法读取图片 ${file}（${error.code ?? error.message}）`);
  }
  if (imageFormat(bytes) !== type) throw new TypeError(`${name}.path 图片格式无效或与扩展名不一致：${file}`);
  return { alt, ...(embed && { src: `data:image/${type};base64,${bytes.toString('base64')}` }) };
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} 需要填写对象`);
  return value;
}

function designRows(value, name, optional = false) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} 需要填写数组`);
  return value;
}

function references(value, name, known) {
  const ids = texts(value, name, true);
  const unique = new Set();
  ids.forEach((id, index) => {
    const location = `${name}[${index}]`;
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new TypeError(`${location} 编号格式无效：${id}`);
    if (unique.has(id)) throw new TypeError(`${location} 编号重复：${id}`);
    if (known && !known.has(id)) throw new TypeError(`${location} 引用了未知编号 ${id}`);
    unique.add(id);
  });
  return ids;
}

export function validateDesigns(value, { baseDir = process.cwd(), requirementIds, scenarioIds, embed = false } = {}) {
  const rows = designRows(value, 'designs', true);
  const ids = rowIdentifiers(rows, 'designs');
  return rows.map((row, index) => {
    const prefix = `designs[${index}]`;
    const title = field(row.title, `${prefix}.title`);
    const status = field(row.status, `${prefix}.status`);
    if (!designStatuses.has(status)) throw new TypeError(`${prefix}.status 应为 pending-design、pending-review 或 selected`);
    const description = row.description === undefined ? '' : field(row.description, `${prefix}.description`);
    const requirements = references(row.requirementIds, `${prefix}.requirementIds`, requirementIds);
    const scenarios = references(row.scenarioIds, `${prefix}.scenarioIds`, scenarioIds);
    if (status === 'selected' && row.image == null) throw new TypeError(`${prefix}.image 已选稿需要本地图`);
    const image = row.image == null ? null : loadImage(object(row.image, `${prefix}.image`), `${prefix}.image`, baseDir, embed);
    return { id: ids[index], title, status, description, requirementIds: requirements, scenarioIds: scenarios, image };
  });
}

export function standaloneDesigns(manifest, baseDir) {
  return validateDesigns(designRows(manifest?.designs, 'designs'), { baseDir });
}

function rebaseImage(row, from, to) {
  const imagePath = row.image?.path;
  if (typeof imagePath !== 'string' || !imagePath.trim() || path.isAbsolute(imagePath.trim())) return row;
  return { ...row, image: { ...row.image, path: path.relative(to, path.resolve(from, imagePath.trim())) } };
}

export function mergePrdDesigns(prd, manifest, { prdDir, designDir, outDir }) {
  object(prd, 'PRD');
  const existing = designRows(prd.designs, 'PRD.designs', true);
  const incoming = designRows(manifest?.designs, 'designs');
  const existingIds = rowIdentifiers(existing, 'PRD.designs');
  const incomingIds = rowIdentifiers(incoming, 'designs');
  const merged = new Map(existing.map((item, index) => [existingIds[index], rebaseImage(item, prdDir, outDir)]));
  for (const [index, item] of incoming.entries()) {
    const id = incomingIds[index];
    if (item.image != null) object(item.image, `designs[${index}].image`);
    const next = rebaseImage(item, designDir, outDir);
    const current = merged.get(id);
    const result = { ...current, ...next };
    if (next.image && current?.image) result.image = { ...current.image, ...next.image };
    merged.set(id, result);
  }
  const designs = [...merged.values()];
  const requirementIds = rowIdentifiers(items(prd.requirements, 'requirements', true), 'requirements', (row) => row?.id === undefined);
  const scenarioIds = rowIdentifiers(items(prd.scenarios, 'scenarios', true), 'scenarios', (row) => typeof row === 'string');
  const validated = validateDesigns(designs, { baseDir: outDir, requirementIds: new Set(requirementIds), scenarioIds: new Set(scenarioIds) });
  return { prd: { ...prd, designs }, designs: validated };
}

function links(ids, kind, labels) {
  return ids.map((id) => referenceLink(kind, id, labels.get(id))).join('、');
}

export function designMarkup(designs, requirementNames, scenarioTitles) {
  return designs.map(({ id, title, status, description, requirementIds, scenarioIds, image }) => {
    const detail = description ? `<p>${html(description)}</p>` : '';
    const requirements = requirementIds.length ? `<div><dt>关联需求</dt><dd>${links(requirementIds, 'requirement', requirementNames)}</dd></div>` : '';
    const scenarios = scenarioIds.length ? `<div><dt>对应场景</dt><dd>${links(scenarioIds, 'scenario', scenarioTitles)}</dd></div>` : '';
    const related = requirements || scenarios ? `<dl class="design-references">${requirements}${scenarios}</dl>` : '';
    const icon = `<svg class="design-preview-icon" viewBox="0 0 24 24" role="img"><title>放大或收起交互稿</title><path class="design-preview-expand" d="M9 5H5v4m10-4h4v4M5 15v4h4m10-4v4h-4"/><path class="design-preview-collapse" d="M5 9h4V5m10 4h-4V5M9 19v-4H5m10 4v-4h4"/></svg>`;
    const picture = image ? `<details class="design-preview" name="prd-design-preview"><summary><img src="${image.src}" alt="${html(image.alt)}" loading="lazy" decoding="async">${icon}</summary></details>` : '';
    const statusLabel = status === 'selected' ? '' : `<span>${id} · ${designStatuses.get(status)}</span>`;
    return `<article class="design-card" id="design-${id}">${picture}<div class="design-heading"><h3>${html(title)}</h3>${statusLabel}</div>${detail}${related}</article>`;
  }).join('');
}

export function designLinksByRequirement(designs) {
  const linked = new Map();
  for (const { id, title, requirementIds } of designs) {
    for (const requirementId of requirementIds) {
      if (!linked.has(requirementId)) linked.set(requirementId, []);
      linked.get(requirementId).push(referenceLink('design', id, title));
    }
  }
  return new Map(Array.from(linked, ([id, links]) => [id, links.join('、')]));
}
