/*
 * 核心功能
 * 定义 project/change/work-unit/task/lane/operation 分级门禁，并把证据与明确 approval ID
 * 绑定到同一作用域和操作，避免一句泛化确认越权放行其他任务。
 *
 * 输入
 * 接收 Gate 定义、Evidence 记录、Approval 记录、待执行操作摘要与可注入时钟。
 *
 * 输出
 * 返回稳定、可审计的门禁决策；不执行写入，也不把评估行为混入项目事实。
 *
 * 定位
 * 位于控制平面的纯策略层，可由 CLI、Hook、任务运行时和升级器共同复用。
 *
 * 维护规则
 * 新增 scope 或决策码时必须保持旧码含义不变，并补跨作用域、过期和撤销负向测试。
 */

import { createHash } from 'node:crypto';
import { canonicalJson } from '../kernel/event-envelope.js';

const GATE_SCHEMA_VERSION = 1;
const SCOPE_TYPES = Object.freeze(['project', 'change', 'work-unit', 'task', 'lane', 'operation']);
const EVIDENCE_STATUSES = Object.freeze(['valid', 'revoked', 'superseded']);
const APPROVAL_STATUSES = Object.freeze(['active', 'revoked', 'consumed']);

class ScopedGateValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ScopedGateValidationError';
    this.code = 'OPEN_VIBECODING_SCOPED_GATE_INVALID';
    Object.assign(this, details);
  }
}

function stableId(prefix, value) {
  return `${prefix}_${createHash('sha256').update(canonicalJson(value)).digest('hex').slice(0, 24)}`;
}

function requiredString(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /[\0\r\n]/.test(normalized)) {
    throw new ScopedGateValidationError(`${label} 必须是安全的非空字符串。`, { field: label });
  }
  return normalized;
}

function normalizeTime(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ScopedGateValidationError(`${label} 必须是有效时间。`, { field: label });
  }
  return date.toISOString();
}

function normalizeScope(scope) {
  const type = requiredString(scope?.type, 'scope.type');
  if (!SCOPE_TYPES.includes(type)) {
    throw new ScopedGateValidationError(`不支持的门禁作用域：${type}。`, { field: 'scope.type', type });
  }
  return { type, id: requiredString(scope?.id, 'scope.id') };
}

function sameScope(left, right) {
  return left?.type === right?.type && left?.id === right?.id;
}

function createGateDefinition(input) {
  const scope = normalizeScope(input?.scope);
  const operation = requiredString(input?.operation, 'operation');
  const requiredEvidence = (input?.requiredEvidence ?? []).map((requirement, index) => ({
    kind: requiredString(requirement?.kind, `requiredEvidence[${index}].kind`),
    minCount: Math.max(1, Number(requirement?.minCount ?? 1)),
    maxAgeMs: requirement?.maxAgeMs === null || requirement?.maxAgeMs === undefined
      ? null
      : Math.max(0, Number(requirement.maxAgeMs)),
  }));
  for (const requirement of requiredEvidence) {
    if (!Number.isSafeInteger(requirement.minCount)) {
      throw new ScopedGateValidationError('requiredEvidence.minCount 必须是正整数。');
    }
    if (requirement.maxAgeMs !== null && !Number.isFinite(requirement.maxAgeMs)) {
      throw new ScopedGateValidationError('requiredEvidence.maxAgeMs 必须是非负数或 null。');
    }
  }
  const approval = {
    required: Boolean(input?.approval?.required),
    subjectDigest: input?.approval?.subjectDigest
      ? requiredString(input.approval.subjectDigest, 'approval.subjectDigest')
      : null,
    consumeOnPass: Boolean(input?.approval?.consumeOnPass),
  };
  const body = {
    schemaVersion: GATE_SCHEMA_VERSION,
    gateId: input?.gateId ?? null,
    scope,
    operation,
    risk: input?.risk ?? 'normal',
    requiredEvidence,
    approval,
    metadata: structuredClone(input?.metadata ?? {}),
  };
  body.gateId = body.gateId
    ? requiredString(body.gateId, 'gateId')
    : stableId('gate', { ...body, gateId: null });
  return body;
}

function createEvidenceRecord(input, options = {}) {
  const collectedAt = normalizeTime(input?.collectedAt ?? (options.clock?.() ?? new Date()), 'collectedAt');
  const scope = normalizeScope(input?.scope);
  const kind = requiredString(input?.kind, 'kind');
  const contentDigest = requiredString(input?.contentDigest, 'contentDigest');
  const status = input?.status ?? 'valid';
  if (!EVIDENCE_STATUSES.includes(status)) {
    throw new ScopedGateValidationError(`不支持的证据状态：${status}。`);
  }
  const body = {
    schemaVersion: GATE_SCHEMA_VERSION,
    evidenceId: input?.evidenceId ?? null,
    scope,
    operation: input?.operation ? requiredString(input.operation, 'operation') : null,
    kind,
    source: requiredString(input?.source ?? 'unknown', 'source'),
    contentDigest,
    collectedAt,
    validUntil: input?.validUntil ? normalizeTime(input.validUntil, 'validUntil') : null,
    status,
    metadata: structuredClone(input?.metadata ?? {}),
  };
  body.evidenceId = body.evidenceId
    ? requiredString(body.evidenceId, 'evidenceId')
    : stableId('evidence', { ...body, evidenceId: null });
  return body;
}

function createApprovalRecord(input, options = {}) {
  const approvalId = requiredString(input?.approvalId, 'approvalId');
  const issuedAt = normalizeTime(input?.issuedAt ?? (options.clock?.() ?? new Date()), 'issuedAt');
  const status = input?.status ?? 'active';
  if (!APPROVAL_STATUSES.includes(status)) {
    throw new ScopedGateValidationError(`不支持的审批状态：${status}。`);
  }
  return {
    schemaVersion: GATE_SCHEMA_VERSION,
    approvalId,
    scope: normalizeScope(input?.scope),
    operation: requiredString(input?.operation, 'operation'),
    subjectDigest: input?.subjectDigest ? requiredString(input.subjectDigest, 'subjectDigest') : null,
    actor: {
      type: requiredString(input?.actor?.type ?? 'user', 'actor.type'),
      id: input?.actor?.id ? requiredString(input.actor.id, 'actor.id') : null,
    },
    issuedAt,
    expiresAt: input?.expiresAt ? normalizeTime(input.expiresAt, 'expiresAt') : null,
    status,
    metadata: structuredClone(input?.metadata ?? {}),
  };
}

function evidenceUsability(record, gate, now) {
  if (record?.schemaVersion !== GATE_SCHEMA_VERSION) return { ok: false, code: 'evidence-schema-mismatch' };
  if (!sameScope(record.scope, gate.scope)) return { ok: false, code: 'evidence-scope-mismatch' };
  if (record.operation && record.operation !== gate.operation) return { ok: false, code: 'evidence-operation-mismatch' };
  if (record.status !== 'valid') return { ok: false, code: `evidence-${record.status ?? 'invalid'}` };
  const collectedAt = Date.parse(record.collectedAt);
  if (Number.isNaN(collectedAt)) return { ok: false, code: 'evidence-time-invalid' };
  if (record.validUntil && Date.parse(record.validUntil) <= now.getTime()) return { ok: false, code: 'evidence-expired' };
  return { ok: true, collectedAt };
}

function approvalUsability(record, gate, approvalId, now) {
  if (!approvalId) return { ok: false, code: 'approval-id-required' };
  if (!record || record.approvalId !== approvalId) return { ok: false, code: 'approval-id-not-found' };
  if (record.schemaVersion !== GATE_SCHEMA_VERSION) return { ok: false, code: 'approval-schema-mismatch' };
  if (!sameScope(record.scope, gate.scope)) return { ok: false, code: 'approval-scope-mismatch' };
  if (record.operation !== gate.operation) return { ok: false, code: 'approval-operation-mismatch' };
  if (record.status !== 'active') return { ok: false, code: `approval-${record.status ?? 'invalid'}` };
  if (record.expiresAt && Date.parse(record.expiresAt) <= now.getTime()) return { ok: false, code: 'approval-expired' };
  if (gate.approval.subjectDigest && record.subjectDigest !== gate.approval.subjectDigest) {
    return { ok: false, code: 'approval-subject-mismatch' };
  }
  return { ok: true };
}

function evaluateScopedGate(input, options = {}) {
  const gate = createGateDefinition(input?.gate);
  const now = options.clock?.() ?? new Date();
  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) throw new ScopedGateValidationError('clock 返回了无效时间。');
  const reasons = [];
  const acceptedEvidence = [];
  const rejectedEvidence = [];

  for (const evidence of input?.evidence ?? []) {
    const usability = evidenceUsability(evidence, gate, nowDate);
    if (usability.ok) acceptedEvidence.push({ record: evidence, collectedAt: usability.collectedAt });
    else rejectedEvidence.push({ evidenceId: evidence?.evidenceId ?? null, code: usability.code });
  }

  for (const requirement of gate.requiredEvidence) {
    const matches = acceptedEvidence.filter(({ record, collectedAt }) => (
      record.kind === requirement.kind
      && (requirement.maxAgeMs === null || nowDate.getTime() - collectedAt <= requirement.maxAgeMs)
    ));
    if (matches.length < requirement.minCount) {
      reasons.push({
        code: 'evidence-required',
        kind: requirement.kind,
        required: requirement.minCount,
        found: matches.length,
      });
    }
  }

  let approval = null;
  if (gate.approval.required) {
    approval = (input?.approvals ?? []).find((record) => record?.approvalId === input?.approvalId) ?? null;
    const usability = approvalUsability(approval, gate, input?.approvalId, nowDate);
    if (!usability.ok) reasons.push({ code: usability.code, approvalId: input?.approvalId ?? null });
  }

  const evaluatedAt = nowDate.toISOString();
  const result = {
    schemaVersion: GATE_SCHEMA_VERSION,
    gateId: gate.gateId,
    scope: gate.scope,
    operation: gate.operation,
    status: reasons.length === 0 ? 'pass' : 'blocked',
    evaluatedAt,
    approvalId: approval?.approvalId ?? null,
    approvalConsumption: reasons.length === 0 && gate.approval.consumeOnPass && approval
      ? { approvalId: approval.approvalId, nextStatus: 'consumed' }
      : null,
    acceptedEvidenceIds: acceptedEvidence.map(({ record }) => record.evidenceId).sort(),
    rejectedEvidence,
    reasons,
  };
  return {
    ...result,
    decisionId: stableId('decision', result),
  };
}

export {
  APPROVAL_STATUSES,
  EVIDENCE_STATUSES,
  GATE_SCHEMA_VERSION,
  SCOPE_TYPES,
  ScopedGateValidationError,
  createApprovalRecord,
  createEvidenceRecord,
  createGateDefinition,
  evaluateScopedGate,
  normalizeScope,
};
