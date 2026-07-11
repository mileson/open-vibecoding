import {
  CONTEXT_AUTHORITY_SCORES,
  CONTEXT_CAPSULE_SCHEMA_VERSION,
  CONTEXT_COMPILER_VERSION,
  CONTEXT_FRESHNESS_SCORES,
  CONTEXT_REQUEST_SCHEMA_VERSION,
  DEFAULT_CONTEXT_DELTA_TOKEN_BUDGET,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
} from './constants.js';
import { redactContextSecrets } from './redaction.js';
import {
  cloneStable,
  compareStableText,
  digestStable,
  digestText,
  stableStringify,
} from './stable.js';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function finiteScore(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDelivery(value) {
  return ['auto', 'full', 'delta'].includes(value) ? value : 'auto';
}

function normalizeFileContentPolicy(value) {
  return value === 'inline' ? 'inline' : 'reference';
}

function canonicalCandidateOrder(left, right) {
  return compareStableText(stableStringify(left), stableStringify(right));
}

/**
 * Build a ContextRequest v1 without mutating the caller's input.
 * A revision is mandatory so cache and delta behavior never depend on wall time.
 */
export function createContextRequest(input = {}) {
  if (input.schemaVersion && input.schemaVersion !== CONTEXT_REQUEST_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported context request schema: ${input.schemaVersion}`);
  }
  const revision = String(input.revision ?? '').trim();
  if (!revision) {
    throw new TypeError('ContextRequest v1 requires a non-empty revision.');
  }
  const rawCandidates = input.candidates ?? input.sources ?? [];
  if (!Array.isArray(rawCandidates)) {
    throw new TypeError('ContextRequest v1 candidates must be an array.');
  }

  const candidates = rawCandidates
    .map((candidate) => cloneStable(candidate && typeof candidate === 'object' ? candidate : { value: candidate }))
    .sort(canonicalCandidateOrder);
  return {
    schemaVersion: CONTEXT_REQUEST_SCHEMA_VERSION,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    workspaceId: String(input.workspaceId ?? 'workspace'),
    revision,
    taskId: input.taskId == null ? null : String(input.taskId),
    intent: input.intent == null ? null : String(input.intent),
    delivery: normalizeDelivery(input.delivery),
    tokenBudget: positiveInteger(input.tokenBudget, DEFAULT_CONTEXT_TOKEN_BUDGET),
    deltaTokenBudget: positiveInteger(input.deltaTokenBudget, DEFAULT_CONTEXT_DELTA_TOKEN_BUDGET),
    fileContentPolicy: normalizeFileContentPolicy(input.fileContentPolicy),
    candidates,
  };
}

function normalizeAuthority(value) {
  if (typeof value === 'number') {
    return { label: 'numeric', score: finiteScore(value) };
  }
  if (value && typeof value === 'object') {
    const label = String(value.label ?? value.kind ?? value.name ?? 'custom');
    const fallback = CONTEXT_AUTHORITY_SCORES[label] ?? 0;
    return { label, score: finiteScore(value.score, fallback) };
  }
  const label = String(value ?? 'unknown').trim().toLowerCase() || 'unknown';
  return { label, score: CONTEXT_AUTHORITY_SCORES[label] ?? CONTEXT_AUTHORITY_SCORES.unknown };
}

function normalizeFreshness(value) {
  if (typeof value === 'number') {
    return { value, score: finiteScore(value) };
  }
  if (value instanceof Date) {
    const iso = value.toISOString();
    return { value: iso, score: value.getTime() };
  }
  if (value && typeof value === 'object') {
    const label = String(value.value ?? value.label ?? value.kind ?? 'unknown');
    const parsedTimestamp = Date.parse(label);
    const fallback = CONTEXT_FRESHNESS_SCORES[label]
      ?? (Number.isFinite(parsedTimestamp) ? parsedTimestamp : 0);
    return { value: label, score: finiteScore(value.score, fallback) };
  }
  const label = String(value ?? 'unknown').trim().toLowerCase() || 'unknown';
  if (Object.hasOwn(CONTEXT_FRESHNESS_SCORES, label)) {
    return { value: label, score: CONTEXT_FRESHNESS_SCORES[label] };
  }
  const timestamp = Date.parse(label);
  return { value: label, score: Number.isFinite(timestamp) ? timestamp : 0 };
}

function normalizeRelevance(value) {
  return finiteScore(value, 0);
}

function estimateTokens(value) {
  return Math.max(1, Math.ceil(Buffer.byteLength(stableStringify(value), 'utf8') / 4));
}

function normalizedFileCandidate(candidate, request) {
  const file = candidate.file ?? candidate.fileRef ?? candidate;
  const pathResult = redactContextSecrets(String(file.path ?? candidate.path ?? ''));
  const rawContent = file.content ?? candidate.content;
  const contentString = rawContent == null
    ? null
    : typeof rawContent === 'string'
      ? rawContent
      : stableStringify(rawContent);
  const fileDigest = file.digest
    ? String(file.digest)
    : contentString != null
      ? digestText(contentString)
      : digestText(`path:${pathResult.value}`);
  const value = {
    type: 'file-ref',
    path: pathResult.value,
    digest: fileDigest,
    sizeBytes: file.sizeBytes == null
      ? contentString == null ? null : Buffer.byteLength(contentString, 'utf8')
      : Math.max(0, Math.floor(finiteScore(file.sizeBytes))),
  };
  const redactions = [...pathResult.redactions];
  const reasonCodes = ['file-reference'];
  if (request.fileContentPolicy === 'inline' && contentString != null) {
    const contentResult = redactContextSecrets(contentString);
    value.content = contentResult.value;
    redactions.push(...contentResult.redactions);
    reasonCodes.push('file-content-explicitly-inlined');
  } else if (contentString != null) {
    reasonCodes.push('file-content-omitted');
  }
  return { value, redactions, reasonCodes };
}

function candidateValue(candidate, request) {
  const isFile = candidate.kind === 'file'
    || candidate.file != null
    || candidate.fileRef != null
    || (candidate.path != null && candidate.content != null);
  if (isFile) {
    return normalizedFileCandidate(candidate, request);
  }
  const rawValue = candidate.data
    ?? candidate.value
    ?? candidate.content
    ?? candidate.summary
    ?? candidate.text
    ?? null;
  const result = redactContextSecrets(rawValue);
  return {
    value: result.value,
    redactions: result.redactions,
    reasonCodes: [],
  };
}

function normalizeCandidate(candidate, request) {
  const authority = normalizeAuthority(candidate.authority);
  const freshness = normalizeFreshness(candidate.freshness);
  const relevance = normalizeRelevance(candidate.relevance);
  const kind = String(candidate.kind ?? (candidate.file || candidate.fileRef ? 'file' : 'fact'));
  const normalizedValue = candidateValue(candidate, request);
  const derivedIdentity = digestStable({ kind, value: normalizedValue.value });
  const rawId = candidate.id ?? candidate.key ?? `${kind}:${derivedIdentity.slice('sha256:'.length, 'sha256:'.length + 20)}`;
  const idResult = redactContextSecrets(String(rawId));
  const redactions = [...idResult.redactions, ...normalizedValue.redactions];
  const value = normalizedValue.value;
  const digest = digestStable({ authority, freshness, id: idResult.value, kind, relevance, value });
  const estimatedTokens = estimateTokens({ id: idResult.value, kind, value });
  return {
    id: idResult.value,
    kind,
    authority,
    freshness,
    relevance,
    value,
    digest,
    estimatedTokens,
    redactionCount: redactions.length,
    redactionReasons: [...new Set(redactions.map((item) => item.reason))].sort(compareStableText),
    reasonCodes: normalizedValue.reasonCodes,
    empty: value == null || value === '',
  };
}

function compareCandidates(left, right) {
  if (left.authority.score !== right.authority.score) {
    return right.authority.score - left.authority.score;
  }
  if (left.freshness.score !== right.freshness.score) {
    return right.freshness.score - left.freshness.score;
  }
  if (left.relevance !== right.relevance) {
    return right.relevance - left.relevance;
  }
  const idOrder = compareStableText(left.id, right.id);
  if (idOrder !== 0) return idOrder;
  return compareStableText(left.digest, right.digest);
}

function uniqueRankedCandidates(candidates) {
  const ranked = [...candidates].sort(compareCandidates);
  const seen = new Set();
  const unique = [];
  const duplicates = [];
  for (const candidate of ranked) {
    if (seen.has(candidate.id)) {
      duplicates.push(candidate);
      continue;
    }
    seen.add(candidate.id);
    unique.push(candidate);
  }
  return { unique, duplicates };
}

function previousEntryMap(previousCapsule) {
  const previous = new Map();
  for (const entry of previousCapsule?.excluded ?? []) {
    if (
      entry?.id
      && entry?.digest
      && entry.excludedReason !== 'duplicate-lower-ranked-candidate'
      && entry.excludedReason !== 'empty-candidate'
    ) {
      previous.set(String(entry.id), String(entry.digest));
    }
  }
  // Delivered entries are authoritative when an older capsule contains both a
  // selected candidate and a lower-ranked duplicate exclusion with the same id.
  for (const entry of previousCapsule?.entries ?? []) {
    if (entry?.id && entry?.digest) previous.set(String(entry.id), String(entry.digest));
  }
  return previous;
}

function resolveDelivery(request, previousCapsule) {
  if (request.delivery === 'full') return 'full';
  if (request.delivery === 'delta' && previousCapsule) return 'delta';
  if (request.delivery === 'auto' && previousCapsule) return 'delta';
  return 'full';
}

function contextRequestIdentity(request, normalizedCandidates, previousCapsule, delivery) {
  return {
    schemaVersion: request.schemaVersion,
    compilerVersion: request.compilerVersion,
    workspaceId: request.workspaceId,
    revision: request.revision,
    taskId: request.taskId,
    intent: request.intent,
    delivery,
    tokenBudget: request.tokenBudget,
    deltaTokenBudget: request.deltaTokenBudget,
    fileContentPolicy: request.fileContentPolicy,
    previousCapsuleDigest: delivery === 'delta' ? previousCapsule?.digest ?? null : null,
    candidates: normalizedCandidates
      .map((candidate) => ({ id: candidate.id, digest: candidate.digest }))
      .sort((left, right) => compareStableText(left.id, right.id) || compareStableText(left.digest, right.digest)),
  };
}

export function buildContextRequestFingerprint(input, { previousCapsule = null } = {}) {
  const request = createContextRequest(input);
  const normalized = request.candidates.map((candidate) => normalizeCandidate(candidate, request));
  const { unique } = uniqueRankedCandidates(normalized);
  const delivery = resolveDelivery(request, previousCapsule);
  return digestStable(contextRequestIdentity(request, unique, previousCapsule, delivery));
}

function asIncludedEntry(candidate, rank) {
  const reasonCodes = [
    'authority-freshness-relevance-ranked',
    'within-token-budget',
    ...candidate.reasonCodes,
  ];
  if (candidate.redactionCount > 0) reasonCodes.push('secrets-redacted');
  return {
    id: candidate.id,
    kind: candidate.kind,
    authority: candidate.authority,
    freshness: candidate.freshness,
    relevance: candidate.relevance,
    value: candidate.value,
    digest: candidate.digest,
    rank,
    estimatedTokens: candidate.estimatedTokens,
    includedReason: [...new Set(reasonCodes)],
    redactionCount: candidate.redactionCount,
    redactionReasons: candidate.redactionReasons,
  };
}

function excludedEntry(candidate, rank, reason, extra = {}) {
  return {
    id: candidate.id,
    digest: candidate.digest,
    rank,
    estimatedTokens: candidate.estimatedTokens,
    excludedReason: reason,
    ...extra,
  };
}

function compareExcluded(left, right) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  return compareStableText(left.id, right.id) || compareStableText(left.excludedReason, right.excludedReason);
}

export function computeContextCapsuleDigest(capsule) {
  const { digest: _digest, ...core } = capsule;
  return digestStable(core);
}

export function verifyContextCapsule(capsule) {
  return Boolean(
    capsule
      && capsule.schemaVersion === CONTEXT_CAPSULE_SCHEMA_VERSION
      && typeof capsule.digest === 'string'
      && capsule.digest === computeContextCapsuleDigest(capsule),
  );
}

/**
 * Compile a deterministic ContextCapsule v1. This function performs no I/O and
 * does not emit telemetry; cache and telemetry side effects live in separate APIs.
 */
export function compileContextCapsule(input, { previousCapsule = null } = {}) {
  const request = createContextRequest(input);
  const normalized = request.candidates.map((candidate) => normalizeCandidate(candidate, request));
  const { unique, duplicates } = uniqueRankedCandidates(normalized);
  const delivery = resolveDelivery(request, previousCapsule);
  const requestDigest = digestStable(contextRequestIdentity(request, unique, previousCapsule, delivery));
  const previous = previousEntryMap(previousCapsule);
  const currentIds = new Set(unique.map((candidate) => candidate.id));
  const delta = {
    previousCapsuleDigest: delivery === 'delta' ? previousCapsule?.digest ?? null : null,
    added: [],
    changed: [],
    removed: delivery === 'delta'
      ? [...previous.keys()].filter((id) => !currentIds.has(id)).sort(compareStableText)
      : [],
    unchanged: [],
  };
  const excluded = [];
  duplicates.forEach((candidate) => {
    const rank = unique.findIndex((item) => item.id === candidate.id) + 1;
    excluded.push(excludedEntry(candidate, rank, 'duplicate-lower-ranked-candidate'));
  });

  const eligible = [];
  unique.forEach((candidate, index) => {
    const rank = index + 1;
    if (candidate.empty) {
      excluded.push(excludedEntry(candidate, rank, 'empty-candidate'));
      return;
    }
    if (delivery !== 'delta') {
      eligible.push({ candidate, rank });
      return;
    }
    const previousDigest = previous.get(candidate.id);
    if (previousDigest === candidate.digest) {
      delta.unchanged.push(candidate.id);
      excluded.push(excludedEntry(candidate, rank, 'unchanged-since-previous-capsule'));
      return;
    }
    if (previousDigest) delta.changed.push(candidate.id);
    else delta.added.push(candidate.id);
    eligible.push({ candidate, rank });
  });

  const limitTokens = delivery === 'delta' ? request.deltaTokenBudget : request.tokenBudget;
  let usedTokens = 0;
  const entries = [];
  for (const { candidate, rank } of eligible) {
    if (usedTokens + candidate.estimatedTokens > limitTokens) {
      excluded.push(excludedEntry(candidate, rank, 'token-budget-exceeded', {
        remainingTokens: Math.max(0, limitTokens - usedTokens),
      }));
      continue;
    }
    entries.push(asIncludedEntry(candidate, rank));
    usedTokens += candidate.estimatedTokens;
  }

  delta.added.sort(compareStableText);
  delta.changed.sort(compareStableText);
  delta.unchanged.sort(compareStableText);
  excluded.sort(compareExcluded);

  const capsule = {
    schemaVersion: CONTEXT_CAPSULE_SCHEMA_VERSION,
    compilerVersion: CONTEXT_COMPILER_VERSION,
    requestDigest,
    workspaceId: request.workspaceId,
    revision: request.revision,
    taskId: request.taskId,
    delivery,
    budget: {
      limitTokens,
      estimatedTokens: usedTokens,
      remainingTokens: Math.max(0, limitTokens - usedTokens),
    },
    entries,
    excluded,
    delta,
    summary: {
      candidateCount: normalized.length,
      includedCount: entries.length,
      excludedCount: excluded.length,
      redactionCount: entries.reduce((sum, entry) => sum + entry.redactionCount, 0),
    },
  };
  capsule.digest = computeContextCapsuleDigest(capsule);
  return capsule;
}
