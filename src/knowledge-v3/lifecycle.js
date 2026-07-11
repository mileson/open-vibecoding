/*
 * 核心功能
 * 提供 Knowledge v3 的验证、晋升、废弃、替代与预算化检索生命周期。
 *
 * 输入
 * 接收带作用域、证据、有效期、reviewer 和替代链的知识条目。
 *
 * 输出
 * 返回不可变的新条目或带 included/excluded reason 的查询结果，不写 telemetry。
 *
 * 定位
 * 位于项目事实与上下文编译器之间；只有 active 且未过期知识可进入 Agent 上下文。
 *
 * 维护规则
 * promotion 必须保留 reviewer 与证据，supersede 必须双向可追溯，查询预算不得静默超限。
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../kernel/event-envelope.js';

const KNOWLEDGE_V3_SCHEMA_VERSION = 3;
const KNOWLEDGE_STATUSES = Object.freeze(['draft', 'active', 'deprecated', 'superseded']);
const KNOWLEDGE_SCOPE_TYPES = Object.freeze(['project', 'change', 'work-unit', 'task', 'lane']);

class KnowledgeLifecycleError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'KnowledgeLifecycleError';
    this.code = 'OPENPRD_KNOWLEDGE_LIFECYCLE_INVALID';
    Object.assign(this, details);
  }
}

function stableId(value) {
  return `knowledge_${createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 24)}`;
}

function text(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /[\0\r]/.test(normalized)) throw new KnowledgeLifecycleError(`${field} 必须是非空文本。`, { field });
  return normalized;
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new KnowledgeLifecycleError(`${field} 必须是有效时间。`, { field });
  return date.toISOString();
}

function normalizeScope(scope) {
  const type = text(scope?.type, 'scope.type');
  if (!KNOWLEDGE_SCOPE_TYPES.includes(type)) throw new KnowledgeLifecycleError(`不支持的知识作用域：${type}。`);
  return { type, id: text(scope?.id, 'scope.id') };
}

function normalizeEvidence(evidence = []) {
  return evidence.map((item, index) => ({
    ref: text(item?.ref, `evidence[${index}].ref`),
    digest: text(item?.digest, `evidence[${index}].digest`),
    kind: text(item?.kind ?? 'artifact', `evidence[${index}].kind`),
    observedAt: item?.observedAt ? iso(item.observedAt, `evidence[${index}].observedAt`) : null,
  }));
}

function normalizeReviewer(reviewer) {
  if (!reviewer) return null;
  return {
    type: text(reviewer.type ?? 'user', 'reviewer.type'),
    id: text(reviewer.id, 'reviewer.id'),
  };
}

function createKnowledgeDraft(input, options = {}) {
  const createdAt = iso(input?.createdAt ?? (options.clock?.() ?? new Date()), 'createdAt');
  const base = {
    schemaVersion: KNOWLEDGE_V3_SCHEMA_VERSION,
    knowledgeId: input?.knowledgeId ?? null,
    scope: normalizeScope(input?.scope),
    title: text(input?.title, 'title'),
    statement: text(input?.statement, 'statement'),
    status: 'draft',
    authority: Math.max(0, Math.min(100, Number(input?.authority ?? 50))),
    tags: [...new Set((input?.tags ?? []).map((item) => text(item, 'tag'))) ],
    evidence: normalizeEvidence(input?.evidence ?? []),
    reviewer: null,
    validFrom: input?.validFrom ? iso(input.validFrom, 'validFrom') : createdAt,
    validUntil: input?.validUntil ? iso(input.validUntil, 'validUntil') : null,
    supersedes: input?.supersedes ? text(input.supersedes, 'supersedes') : null,
    supersededBy: null,
    createdAt,
    updatedAt: createdAt,
    metadata: structuredClone(input?.metadata ?? {}),
  };
  if (!Number.isFinite(base.authority)) throw new KnowledgeLifecycleError('authority 必须是 0 到 100 的数字。');
  if (base.validUntil && Date.parse(base.validUntil) <= Date.parse(base.validFrom)) {
    throw new KnowledgeLifecycleError('validUntil 必须晚于 validFrom。');
  }
  base.knowledgeId = base.knowledgeId ? text(base.knowledgeId, 'knowledgeId') : stableId({ ...base, knowledgeId: null });
  return base;
}

function validateKnowledgeEntry(entry, options = {}) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (entry?.schemaVersion !== KNOWLEDGE_V3_SCHEMA_VERSION) add('schema-version', 'schemaVersion 必须为 3。');
  if (!KNOWLEDGE_STATUSES.includes(entry?.status)) add('status', '知识状态无效。');
  try { normalizeScope(entry?.scope); } catch (error) { add('scope', error.message); }
  for (const field of ['knowledgeId', 'title', 'statement', 'createdAt', 'updatedAt']) {
    try {
      if (field.endsWith('At')) iso(entry?.[field], field);
      else text(entry?.[field], field);
    } catch (error) { add(field, error.message); }
  }
  if (options.requireEvidence !== false && (!Array.isArray(entry?.evidence) || entry.evidence.length === 0)) {
    add('evidence-required', '知识晋升需要至少一条可追溯证据。');
  } else {
    try { normalizeEvidence(entry?.evidence ?? []); } catch (error) { add('evidence', error.message); }
  }
  if (options.requireReviewer && !entry?.reviewer) add('reviewer-required', '知识晋升需要明确 reviewer。');
  if (entry?.status === 'superseded' && !entry?.supersededBy) add('superseded-by-required', '已替代知识必须记录 supersededBy。');
  if (entry?.validUntil && Date.parse(entry.validUntil) <= Date.parse(entry.validFrom)) add('validity-window', '有效期窗口无效。');
  return { ok: errors.length === 0, errors };
}

function assertValid(entry, options) {
  const validation = validateKnowledgeEntry(entry, options);
  if (!validation.ok) throw new KnowledgeLifecycleError(validation.errors.map((item) => item.message).join('；'), { errors: validation.errors });
  return entry;
}

function promoteKnowledgeEntry(entry, input, options = {}) {
  if (entry?.status !== 'draft' && entry?.status !== 'deprecated') {
    throw new KnowledgeLifecycleError('只有 draft 或 deprecated 条目可以晋升。');
  }
  const promotedAt = iso(input?.promotedAt ?? (options.clock?.() ?? new Date()), 'promotedAt');
  const promoted = {
    ...structuredClone(entry),
    status: 'active',
    reviewer: normalizeReviewer(input?.reviewer),
    updatedAt: promotedAt,
    promotion: {
      approvalId: text(input?.approvalId, 'approvalId'),
      promotedAt,
    },
  };
  return assertValid(promoted, { requireEvidence: true, requireReviewer: true });
}

function deprecateKnowledgeEntry(entry, input = {}, options = {}) {
  if (entry?.status !== 'active') throw new KnowledgeLifecycleError('只有 active 条目可以废弃。');
  const deprecatedAt = iso(input?.deprecatedAt ?? (options.clock?.() ?? new Date()), 'deprecatedAt');
  return {
    ...structuredClone(entry),
    status: 'deprecated',
    updatedAt: deprecatedAt,
    deprecation: {
      reason: text(input?.reason, 'reason'),
      approvalId: text(input?.approvalId, 'approvalId'),
      deprecatedAt,
    },
  };
}

function supersedeKnowledgeEntry(previous, replacement, input = {}, options = {}) {
  if (previous?.status !== 'active') throw new KnowledgeLifecycleError('只有 active 条目可以被替代。');
  if (replacement?.status !== 'active') throw new KnowledgeLifecycleError('替代条目必须先完成晋升。');
  if (previous.knowledgeId === replacement.knowledgeId) throw new KnowledgeLifecycleError('条目不能替代自身。');
  if (previous.scope?.type !== replacement.scope?.type || previous.scope?.id !== replacement.scope?.id) {
    throw new KnowledgeLifecycleError('替代链必须保持同一知识作用域。');
  }
  const at = iso(input?.supersededAt ?? (options.clock?.() ?? new Date()), 'supersededAt');
  const approvalId = text(input?.approvalId, 'approvalId');
  return {
    previous: {
      ...structuredClone(previous),
      status: 'superseded',
      supersededBy: replacement.knowledgeId,
      updatedAt: at,
      supersession: { approvalId, at },
    },
    replacement: {
      ...structuredClone(replacement),
      supersedes: previous.knowledgeId,
      updatedAt: at,
      supersession: { approvalId, at },
    },
  };
}

function tokenize(value) {
  const normalized = String(value ?? '').toLowerCase();
  return [...new Set([
    ...(normalized.match(/[a-z0-9][a-z0-9._-]{1,}/g) ?? []),
    ...(normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? []),
  ])];
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4));
}

function queryKnowledge(entries, request = {}, options = {}) {
  const now = options.clock?.() ?? new Date();
  const nowMs = new Date(now).getTime();
  if (Number.isNaN(nowMs)) throw new KnowledgeLifecycleError('clock 返回了无效时间。');
  const scope = normalizeScope(request.scope);
  const queryTokens = tokenize(request.query ?? '');
  const limit = Math.max(1, Math.min(50, Number(request.limit ?? 8)));
  const tokenBudget = Math.max(1, Number(request.tokenBudget ?? 400));
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(tokenBudget)) {
    throw new KnowledgeLifecycleError('limit 与 tokenBudget 必须是正整数。');
  }
  const candidates = [];
  const excluded = [];

  for (const entry of entries ?? []) {
    let reason = null;
    if (entry?.schemaVersion !== KNOWLEDGE_V3_SCHEMA_VERSION) reason = 'schema-mismatch';
    else if (entry.status !== 'active') reason = `status-${entry.status ?? 'invalid'}`;
    else if (entry.scope?.type !== scope.type || entry.scope?.id !== scope.id) reason = 'scope-mismatch';
    else if (Date.parse(entry.validFrom) > nowMs) reason = 'not-yet-valid';
    else if (entry.validUntil && Date.parse(entry.validUntil) <= nowMs) reason = 'expired';
    if (reason) {
      excluded.push({ knowledgeId: entry?.knowledgeId ?? null, reason });
      continue;
    }
    const haystack = tokenize([entry.title, entry.statement, ...(entry.tags ?? [])].join(' '));
    const relevance = queryTokens.length === 0
      ? 1
      : queryTokens.filter((token) => haystack.some((candidate) => (
        candidate === token || candidate.includes(token) || token.includes(candidate)
      ))).length;
    if (queryTokens.length > 0 && relevance === 0) {
      excluded.push({ knowledgeId: entry.knowledgeId, reason: 'not-relevant' });
      continue;
    }
    candidates.push({
      entry,
      relevance,
      authority: Number(entry.authority ?? 0),
      updatedAt: Date.parse(entry.updatedAt) || 0,
      tokens: estimateTokens({ title: entry.title, statement: entry.statement, evidence: entry.evidence }),
    });
  }

  candidates.sort((left, right) => (
    right.relevance - left.relevance
    || right.authority - left.authority
    || right.updatedAt - left.updatedAt
    || left.entry.knowledgeId.localeCompare(right.entry.knowledgeId)
  ));

  const included = [];
  let usedTokens = 0;
  for (const candidate of candidates) {
    if (included.length >= limit) {
      excluded.push({ knowledgeId: candidate.entry.knowledgeId, reason: 'result-limit' });
      continue;
    }
    if (usedTokens + candidate.tokens > tokenBudget) {
      excluded.push({ knowledgeId: candidate.entry.knowledgeId, reason: 'token-budget' });
      continue;
    }
    included.push({ ...structuredClone(candidate.entry), retrieval: { reason: 'scope-relevance-authority', tokens: candidate.tokens } });
    usedTokens += candidate.tokens;
  }

  return {
    schemaVersion: KNOWLEDGE_V3_SCHEMA_VERSION,
    scope,
    query: String(request.query ?? ''),
    tokenBudget,
    usedTokens,
    included,
    excluded,
  };
}

export {
  KNOWLEDGE_SCOPE_TYPES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_V3_SCHEMA_VERSION,
  KnowledgeLifecycleError,
  createKnowledgeDraft,
  deprecateKnowledgeEntry,
  promoteKnowledgeEntry,
  queryKnowledge,
  supersedeKnowledgeEntry,
  validateKnowledgeEntry,
};
