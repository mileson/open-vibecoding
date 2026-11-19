import { escapeHtml } from './html-artifact-utils.js';

export function field(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${name} 需要填写非空文本`);
  }
  return value.trim();
}

export function items(value, name, optional = false) {
  if (value === undefined && optional) return [];
  if (!Array.isArray(value) || (!optional && value.length === 0)) {
    throw new TypeError(`${name} 需要填写${optional ? '' : '非空'}数组`);
  }
  return value;
}

export function texts(value, name, optional = false) {
  return items(value, name, optional).map((item, index) => field(item, `${name}[${index}]`));
}

export function rowIdentifiers(rows, name, legacy = () => false) {
  const used = new Set();
  return rows.map((entry, index) => {
    if (legacy(entry)) return '';
    const path = `${name}[${index}].id`;
    const id = field(entry?.id, path);
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
      throw new TypeError(`${path} 应以英文字母开头，只能包含字母、数字、连字符或下划线`);
    }
    if (used.has(id)) throw new TypeError(`${path} 与已有编号 ${id} 重复`);
    used.add(id);
    return id;
  });
}
export function referenceLink(kind, id, label) {
  return `<a href="#${kind}-${id}">${escapeHtml(label)}</a>`;
}
