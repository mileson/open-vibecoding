/*
 * ## 核心功能
 * 规范化任务写入范围，并以安全优先的方式判断两个 write-set 是否可能相交。
 *
 * ## 输入
 * 接收 include/exclude 路径或 glob；数组简写等价于 include，空范围按全项目处理。
 *
 * ## 输出
 * 导出 normalizeWriteSet、writeSetsIntersect 与包含冲突路径的 explainWriteSetIntersection。
 *
 * ## 定位
 * 位于 runtime 并发控制层；只计算路径集合，不读取文件系统或修改 claim。
 *
 * ## 依赖
 * 仅使用 Node.js path 模块完成 POSIX 路径标准化。
 *
 * ## 维护规则
 * 判定必须避免漏报写冲突；不能证明互斥的复杂 glob 应保守返回相交。
 */

import path from 'node:path';

const BROAD_PATTERN = '**/*';
const GLOB_TOKEN = /[*?[]/;

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function listFrom(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function normalizeWritePattern(value) {
  const original = String(value ?? '').trim();
  if (!original) return null;

  const slashNormalized = original.replaceAll('\\', '/');
  if (slashNormalized.includes('\0')) {
    throw new TypeError('Open VibeCoding write-set patterns cannot contain null bytes.');
  }
  if (path.posix.isAbsolute(slashNormalized) || /^[A-Za-z]:\//.test(slashNormalized)) {
    throw new TypeError(`Open VibeCoding write-set patterns must be project-relative: ${original}`);
  }

  const hadTrailingSlash = slashNormalized.endsWith('/');
  let normalized = slashNormalized.replace(/^(?:\.\/)+/, '');
  normalized = path.posix.normalize(normalized);
  if (normalized === '.' || normalized === '') return BROAD_PATTERN;
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new TypeError(`Open VibeCoding write-set patterns cannot escape the project root: ${original}`);
  }
  if (hadTrailingSlash) normalized = `${normalized.replace(/\/+$/, '')}/**`;
  if (normalized === '**') return BROAD_PATTERN;
  return normalized;
}

export function normalizeWriteSet(value = null) {
  const source = Array.isArray(value) || typeof value === 'string'
    ? { include: value }
    : (value ?? {});
  const includeSource = source.include ?? source.includes ?? source.paths;
  const excludeSource = source.exclude ?? source.excludes;
  const include = uniqueSorted(listFrom(includeSource).map(normalizeWritePattern).filter(Boolean));
  const exclude = uniqueSorted(listFrom(excludeSource).map(normalizeWritePattern).filter(Boolean));
  return {
    include: include.length > 0 ? include : [BROAD_PATTERN],
    exclude,
  };
}

function hasGlob(pattern) {
  return GLOB_TOKEN.test(pattern);
}

function globRegExp(pattern) {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    const next = pattern[index + 1];
    if (character === '*' && next === '*') {
      const after = pattern[index + 2];
      if (after === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (character === '*') {
      source += '[^/]*';
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    if ('\\^$+?.()|{}[]'.includes(character)) source += `\\${character}`;
    else source += character;
  }
  source += '$';
  return new RegExp(source);
}

function patternMatches(pattern, candidate) {
  return globRegExp(pattern).test(candidate);
}

function staticRoot(pattern) {
  const wildcardIndex = pattern.search(GLOB_TOKEN);
  const raw = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  return raw.replace(/\/+$/, '');
}

function pathWithin(candidate, parent) {
  if (!parent) return true;
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function prefixGlobRoot(pattern) {
  if (pattern === BROAD_PATTERN) return '';
  if (pattern.endsWith('/**/*')) return pattern.slice(0, -5).replace(/\/+$/, '');
  if (pattern.endsWith('/**')) return pattern.slice(0, -3).replace(/\/+$/, '');
  return null;
}

function patternContainedBy(candidate, cover) {
  if (candidate === cover || cover === BROAD_PATTERN) return true;
  if (!hasGlob(candidate)) return patternMatches(cover, candidate);

  const coverRoot = prefixGlobRoot(cover);
  if (coverRoot !== null) {
    const candidateRoot = staticRoot(candidate);
    return pathWithin(candidateRoot, coverRoot);
  }
  return false;
}

function patternsMayIntersect(left, right) {
  if (left === right || left === BROAD_PATTERN || right === BROAD_PATTERN) return true;
  if (!hasGlob(left)) {
    if (!right.includes('[')) return patternMatches(right, left);
    return pathWithin(staticRoot(left), staticRoot(right)) || pathWithin(staticRoot(right), staticRoot(left));
  }
  if (!hasGlob(right)) {
    if (!left.includes('[')) return patternMatches(left, right);
    return pathWithin(staticRoot(left), staticRoot(right)) || pathWithin(staticRoot(right), staticRoot(left));
  }

  const leftRoot = staticRoot(left);
  const rightRoot = staticRoot(right);
  if (!leftRoot || !rightRoot) return true;
  return pathWithin(leftRoot, rightRoot) || pathWithin(rightRoot, leftRoot);
}

function overlapPattern(left, right) {
  if (patternContainedBy(left, right)) return left;
  if (patternContainedBy(right, left)) return right;
  if (!hasGlob(left) && patternMatches(right, left)) return left;
  if (!hasGlob(right) && patternMatches(left, right)) return right;
  return null;
}

function overlapIsExcluded(pattern, writeSet) {
  if (!pattern) return false;
  return writeSet.exclude.some((excluded) => patternContainedBy(pattern, excluded));
}

export function explainWriteSetIntersection(leftValue, rightValue) {
  const left = normalizeWriteSet(leftValue);
  const right = normalizeWriteSet(rightValue);
  for (const leftPattern of left.include) {
    for (const rightPattern of right.include) {
      if (!patternsMayIntersect(leftPattern, rightPattern)) continue;
      const overlap = overlapPattern(leftPattern, rightPattern);
      if (overlapIsExcluded(overlap, left) || overlapIsExcluded(overlap, right)) continue;
      return {
        intersects: true,
        left,
        right,
        leftPattern,
        rightPattern,
        overlapPattern: overlap,
        conservative: overlap === null,
      };
    }
  }
  return {
    intersects: false,
    left,
    right,
    leftPattern: null,
    rightPattern: null,
    overlapPattern: null,
    conservative: false,
  };
}

export function writeSetsIntersect(left, right) {
  return explainWriteSetIntersection(left, right).intersects;
}

export { BROAD_PATTERN };
