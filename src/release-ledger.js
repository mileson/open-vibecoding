/*
 * 核心功能
 * 维护可选的项目级 release/version ledger，统一记录当前版本、版本状态、版本内变化项与本地 tag 元数据。
 *
 * 输入
 * 接收项目根目录、版本号、变化说明、tag 同步结果等项目级 release 信息。
 *
 * 输出
 * 读写 `.open-vibecoding/state/release-ledger.json`，并返回 handoff、status、commit 可复用的结构化版本摘要。
 *
 * 定位
 * 位于 Open VibeCoding 的项目发布事实层，刻意与内部 PRD `v000x` 快照版本分离。
 *
 * 依赖
 * 依赖 fs-utils、change-summary 和基础时间工具，不依赖 workspace workflow。
 *
 * 维护规则
 * 版本号默认按 semver 提示，但必须允许项目保留自己的版本体系；不可把远端 tag 风险静默吞掉。
 */
import { buildChangeEntries, buildChangeEntry, buildChangeSummaryFromEntries } from './change-summary.js';
import { cjoin, readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';

export const RELEASE_LEDGER_STATUSES = ['draft', 'current', 'released'];
export const RELEASE_LEDGER_STRATEGY = 'semver';
export const RELEASE_SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;

function normalizeReleaseStatus(status, fallback = 'current') {
  return RELEASE_LEDGER_STATUSES.includes(status) ? status : fallback;
}

function normalizeReleaseVersionInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/iu.test(text)) {
    return text.slice(1);
  }
  return text;
}

function buildSemverHint(version) {
  const normalized = normalizeReleaseVersionInput(version);
  if (!normalized) {
    return { matchesSemver: false, normalizedVersion: normalized, warning: '未设置项目版本号。' };
  }
  if (RELEASE_SEMVER_PATTERN.test(normalized)) {
    return { matchesSemver: true, normalizedVersion: normalized, warning: null };
  }
  return {
    matchesSemver: false,
    normalizedVersion: normalized,
    warning: `当前项目版本 ${normalized} 未匹配 x.y.z 形式；Open VibeCoding 仍会保留它，但不会把 semver 当成强校验。`,
  };
}

function normalizeReleaseTag(tag) {
  if (!tag || typeof tag !== 'object' || Array.isArray(tag)) return null;
  return {
    name: typeof tag.name === 'string' ? tag.name.trim() : null,
    localSha: typeof tag.localSha === 'string' && tag.localSha.trim() ? tag.localSha.trim() : null,
    remoteSha: typeof tag.remoteSha === 'string' && tag.remoteSha.trim() ? tag.remoteSha.trim() : null,
    remoteStatus: typeof tag.remoteStatus === 'string' && tag.remoteStatus.trim() ? tag.remoteStatus.trim() : null,
    updatedAt: typeof tag.updatedAt === 'string' && tag.updatedAt.trim() ? tag.updatedAt.trim() : null,
    warning: typeof tag.warning === 'string' && tag.warning.trim() ? tag.warning.trim() : null,
  };
}

function normalizeReleaseSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const next = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      next[key] = trimmed;
      continue;
    }
    next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : null;
}

function normalizeReleaseItem(raw) {
  if (!raw) return null;

  const entry = buildChangeEntry(
    typeof raw === 'string'
      ? raw
      : raw.sentence ?? raw.detail ?? raw.summary ?? raw.title ?? '',
    { fallbackType: raw.type ?? '调整', summaryMaxLength: 15 },
  );
  if (!entry) return null;

  return {
    type: entry.type,
    summary: entry.summary,
    detail: entry.detail,
    sentence: entry.sentence,
    recordedAt: typeof raw.recordedAt === 'string' && raw.recordedAt.trim() ? raw.recordedAt.trim() : null,
    source: normalizeReleaseSource(raw.source),
  };
}

function normalizeReleaseVersionEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const version = normalizeReleaseVersionInput(raw.version);
  if (!version) return null;
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => normalizeReleaseItem(item)).filter(Boolean)
    : [];
  return {
    version,
    status: normalizeReleaseStatus(raw.status),
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : null,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : null,
    notes: typeof raw.notes === 'string' && raw.notes.trim() ? raw.notes.trim() : null,
    items,
    tag: normalizeReleaseTag(raw.tag),
  };
}

function normalizeReleaseVersions(values) {
  const items = Array.isArray(values) ? values : [];
  const versions = [];
  const seen = new Set();
  for (const item of items) {
    const entry = normalizeReleaseVersionEntry(item);
    if (!entry) continue;
    if (seen.has(entry.version)) continue;
    seen.add(entry.version);
    versions.push(entry);
  }
  return versions;
}

export function defaultReleaseLedger() {
  return {
    version: 1,
    enabled: false,
    strategy: RELEASE_LEDGER_STRATEGY,
    currentVersion: null,
    versions: [],
    createdAt: null,
    updatedAt: null,
  };
}

export function normalizeReleaseLedger(raw) {
  const defaults = defaultReleaseLedger();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return defaults;
  }
  const versions = normalizeReleaseVersions(raw.versions);
  const currentVersion = normalizeReleaseVersionInput(raw.currentVersion);
  return {
    version: 1,
    enabled: raw.enabled === true,
    strategy: typeof raw.strategy === 'string' && raw.strategy.trim() ? raw.strategy.trim() : RELEASE_LEDGER_STRATEGY,
    currentVersion: versions.some((entry) => entry.version === currentVersion) ? currentVersion : (currentVersion || null),
    versions,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt.trim() : null,
    updatedAt: typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt.trim() : null,
  };
}

export function releaseLedgerPath(projectRoot) {
  return cjoin(projectRoot, '.open-vibecoding', 'state', 'release-ledger.json');
}

export async function loadReleaseLedger(projectRoot) {
  const filePath = releaseLedgerPath(projectRoot);
  const raw = await readJson(filePath).catch(() => null);
  return {
    filePath,
    exists: raw !== null,
    ledger: normalizeReleaseLedger(raw),
  };
}

export async function saveReleaseLedger(projectRoot, ledger) {
  const filePath = releaseLedgerPath(projectRoot);
  const normalized = normalizeReleaseLedger({
    ...ledger,
    updatedAt: timestamp(),
    createdAt: ledger?.createdAt ?? timestamp(),
  });
  await writeJson(filePath, normalized);
  return { filePath, ledger: normalized };
}

export function findReleaseVersionEntry(ledger, version) {
  const normalized = normalizeReleaseVersionInput(version);
  return normalizeReleaseLedger(ledger).versions.find((entry) => entry.version === normalized) ?? null;
}

export function getCurrentReleaseEntry(ledger) {
  const normalized = normalizeReleaseLedger(ledger);
  return normalized.currentVersion
    ? normalized.versions.find((entry) => entry.version === normalized.currentVersion) ?? null
    : null;
}

function ensureReleaseLedgerEntry(ledger, version, options = {}) {
  const normalizedLedger = normalizeReleaseLedger(ledger);
  const normalizedVersion = normalizeReleaseVersionInput(version);
  if (!normalizedVersion) {
    throw new Error('项目版本号不能为空。');
  }
  let entry = normalizedLedger.versions.find((item) => item.version === normalizedVersion) ?? null;
  const now = timestamp();
  if (!entry) {
    entry = {
      version: normalizedVersion,
      status: normalizeReleaseStatus(options.status),
      createdAt: now,
      updatedAt: now,
      notes: options.notes ?? null,
      items: [],
      tag: null,
    };
    normalizedLedger.versions.push(entry);
  }
  if (options.status) {
    entry.status = normalizeReleaseStatus(options.status, entry.status);
  }
  entry.updatedAt = now;
  if (!entry.createdAt) entry.createdAt = now;
  return { ledger: normalizedLedger, entry };
}

export function setReleaseLedgerEnabled(ledger, enabled) {
  const normalized = normalizeReleaseLedger(ledger);
  const next = {
    ...normalized,
    enabled: Boolean(enabled),
    createdAt: normalized.createdAt ?? timestamp(),
    updatedAt: timestamp(),
  };
  return { ledger: next };
}

export function setCurrentReleaseVersion(ledger, version, options = {}) {
  const normalized = normalizeReleaseLedger(ledger);
  const nextVersion = normalizeReleaseVersionInput(version);
  if (!nextVersion) {
    throw new Error('项目版本号不能为空。');
  }
  const previousCurrent = getCurrentReleaseEntry(normalized);
  const ensured = ensureReleaseLedgerEntry(normalized, nextVersion, {
    status: options.status ?? 'current',
    notes: options.notes ?? null,
  });
  const next = ensured.ledger;
  for (const item of next.versions) {
    if (item.version === nextVersion) {
      item.status = normalizeReleaseStatus(options.status ?? 'current');
      item.updatedAt = timestamp();
      continue;
    }
    if (item.status === 'current') {
      item.status = normalizeReleaseStatus(options.previousStatus ?? 'released', 'released');
      item.updatedAt = timestamp();
    }
  }
  next.enabled = true;
  next.currentVersion = nextVersion;
  next.createdAt = next.createdAt ?? timestamp();
  next.updatedAt = timestamp();
  return {
    ledger: next,
    entry: ensured.entry,
    previousVersion: previousCurrent && previousCurrent.version !== nextVersion ? previousCurrent.version : null,
    semver: buildSemverHint(nextVersion),
  };
}

export function setReleaseVersionStatus(ledger, status, options = {}) {
  const normalized = normalizeReleaseLedger(ledger);
  const targetVersion = normalizeReleaseVersionInput(options.version ?? normalized.currentVersion);
  if (!targetVersion) {
    throw new Error('还没有可更新状态的项目版本；请先设置当前版本号。');
  }
  const ensured = ensureReleaseLedgerEntry(normalized, targetVersion, { status });
  const next = ensured.ledger;
  ensured.entry.status = normalizeReleaseStatus(status);
  ensured.entry.updatedAt = timestamp();
  if (ensured.entry.status === 'current') {
    next.currentVersion = targetVersion;
    for (const entry of next.versions) {
      if (entry.version !== targetVersion && entry.status === 'current') {
        entry.status = 'released';
        entry.updatedAt = timestamp();
      }
    }
  }
  next.enabled = true;
  next.createdAt = next.createdAt ?? timestamp();
  next.updatedAt = timestamp();
  return { ledger: next, entry: ensured.entry };
}

function releaseItemKey(item) {
  return [
    item.type,
    item.detail,
    item.source?.kind ?? '',
    item.source?.taskId ?? '',
    item.source?.manualId ?? '',
  ].join('::');
}

export function appendReleaseEntry(ledger, rawValue, options = {}) {
  const normalized = normalizeReleaseLedger(ledger);
  const targetVersion = normalizeReleaseVersionInput(options.version ?? normalized.currentVersion);
  if (!targetVersion) {
    throw new Error('还没有当前项目版本；请先设置版本号再累计变化条目。');
  }
  const ensured = ensureReleaseLedgerEntry(normalized, targetVersion, { status: options.status ?? undefined });
  const next = ensured.ledger;
  next.enabled = true;
  if (!next.currentVersion) {
    next.currentVersion = targetVersion;
  }

  const entries = buildChangeEntries(Array.isArray(rawValue) ? rawValue : [rawValue], {
    fallbackType: options.fallbackType ?? '调整',
    summaryMaxLength: 15,
  });
  const now = timestamp();
  const added = [];
  for (const item of entries) {
    const candidate = normalizeReleaseItem({
      ...item,
      recordedAt: now,
      source: options.source ?? null,
    });
    if (!candidate) continue;
    const existing = ensured.entry.items.find((entry) => releaseItemKey(entry) === releaseItemKey(candidate));
    if (existing) {
      existing.recordedAt = now;
      existing.source = normalizeReleaseSource({ ...(existing.source ?? {}), ...(options.source ?? {}) });
      continue;
    }
    ensured.entry.items.push(candidate);
    added.push(candidate);
  }
  ensured.entry.updatedAt = now;
  next.updatedAt = now;
  next.createdAt = next.createdAt ?? now;
  return { ledger: next, entry: ensured.entry, added };
}

export function updateReleaseTag(ledger, options = {}) {
  const normalized = normalizeReleaseLedger(ledger);
  const targetVersion = normalizeReleaseVersionInput(options.version ?? normalized.currentVersion);
  if (!targetVersion) {
    throw new Error('还没有当前项目版本；无法记录 tag 状态。');
  }
  const ensured = ensureReleaseLedgerEntry(normalized, targetVersion, {});
  ensured.entry.tag = normalizeReleaseTag({
    ...(ensured.entry.tag ?? {}),
    name: options.name ?? targetVersion,
    localSha: options.localSha ?? ensured.entry.tag?.localSha ?? null,
    remoteSha: options.remoteSha ?? ensured.entry.tag?.remoteSha ?? null,
    remoteStatus: options.remoteStatus ?? ensured.entry.tag?.remoteStatus ?? null,
    updatedAt: options.updatedAt ?? timestamp(),
    warning: options.warning ?? null,
  });
  ensured.entry.updatedAt = timestamp();
  ensured.ledger.updatedAt = timestamp();
  ensured.ledger.createdAt = ensured.ledger.createdAt ?? timestamp();
  return { ledger: ensured.ledger, entry: ensured.entry };
}

export function buildReleaseLedgerSummary(ledger, options = {}) {
  const normalized = normalizeReleaseLedger(ledger);
  const current = options.version
    ? findReleaseVersionEntry(normalized, options.version)
    : getCurrentReleaseEntry(normalized);
  const semver = buildSemverHint(current?.version ?? normalized.currentVersion);
  return {
    enabled: normalized.enabled,
    strategy: normalized.strategy,
    currentVersion: current?.version ?? normalized.currentVersion ?? null,
    currentStatus: current?.status ?? null,
    versionCount: normalized.versions.length,
    itemCount: current?.items?.length ?? 0,
    items: current?.items ?? [],
    semver,
    tag: current?.tag ?? null,
  };
}

export function buildReleaseChangeSummary(ledger, options = {}) {
  const normalized = normalizeReleaseLedger(ledger);
  const entry = options.version
    ? findReleaseVersionEntry(normalized, options.version)
    : getCurrentReleaseEntry(normalized);
  if (!entry || entry.items.length === 0) {
    return {
      title: `${options.version ?? normalized.currentVersion ?? '当前版本'}变化摘要`,
      perspective: null,
      preferredVerbs: [],
      items: [],
      markdown: '',
    };
  }
  return buildChangeSummaryFromEntries(entry.items, {
    title: `${entry.version} 变化摘要`,
    limit: options.limit,
  });
}
