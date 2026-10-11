import fs from 'node:fs/promises';
import path from 'node:path';
import { appendJsonl, cjoin, exists, readJson, readJsonl, writeJson } from './fs-utils.js';
import { listBenchmarkRecommendationsWorkspace } from './benchmark.js';

export const OPEN_VIBECODING_GROWTH_DIR = path.join('.open-vibecoding', 'growth');
export const OPEN_VIBECODING_GROWTH_CANDIDATES = path.join(OPEN_VIBECODING_GROWTH_DIR, 'candidates.jsonl');
export const OPEN_VIBECODING_GROWTH_ACCEPTED = path.join(OPEN_VIBECODING_GROWTH_DIR, 'accepted.json');
export const OPEN_VIBECODING_GROWTH_REJECTED = path.join(OPEN_VIBECODING_GROWTH_DIR, 'rejected.json');
export const OPEN_VIBECODING_GROWTH_LOCAL_PREFERENCES = path.join(OPEN_VIBECODING_GROWTH_DIR, 'preferences.local.json');
export const OPEN_VIBECODING_GROWTH_LEDGER = path.join(OPEN_VIBECODING_GROWTH_DIR, 'ledger.json');
export const OPEN_VIBECODING_GROWTH_EVENTS = path.join(OPEN_VIBECODING_GROWTH_DIR, 'events.jsonl');
export const OPEN_VIBECODING_STANDARDS_CONFIG = path.join('.open-vibecoding', 'standards', 'config.json');

export const DEFAULT_GROWTH_CONFIG = {
  enabled: true,
  reviewRequired: true,
  autoApply: {
    enabled: true,
    minConfidence: 0.8,
    safeTypes: ['code-extension'],
  },
  candidateLimit: 200,
  scopes: ['project', 'user-local', 'open-vibecoding-core'],
  supportedCandidateTypes: [
    'code-extension',
    'exempt-path-segment',
    'exempt-file-pattern',
    'user-preference',
    'workflow-gotcha',
    'standards-rule',
  ],
};

const SAFE_APPLY_TYPES = new Set(['code-extension', 'exempt-path-segment', 'exempt-file-pattern', 'user-preference']);
const AUTO_APPLY_TYPES = new Set(['code-extension']);

function normalizePosixPath(value) {
  return String(value ?? '').split(path.sep).join('/');
}

function normalizeExtension(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  return raw.startsWith('.') ? raw : `.${raw}`;
}

function slug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown';
}

export function growthCandidateId(type, key) {
  return `${slug(type)}-${slug(key)}`;
}

function growthPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function nowIso() {
  return new Date().toISOString();
}

async function readJsonIfExists(filePath, fallback) {
  if (!(await exists(filePath))) return fallback;
  return readJson(filePath).catch(() => fallback);
}

async function readJsonlIfExists(filePath) {
  if (!(await exists(filePath))) return [];
  return readJsonl(filePath).catch(() => []);
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined) : [];
}

function defaultGrowthLedger() {
  return {
    version: 1,
    updatedAt: nowIso(),
    summary: {
      eventCount: 0,
      observed: 0,
      pendingObserved: 0,
      autoApplied: 0,
      manualApplied: 0,
      reconciledAutoApplied: 0,
      rejected: 0,
      skipped: 0,
      completionCheckpoints: 0,
      skippedReasons: {},
      current: {
        total: 0,
        pending: 0,
        applied: 0,
        rejected: 0,
      },
    },
    recentEvents: [],
  };
}

function normalizeCandidate(raw = {}) {
  const type = String(raw.type ?? '').trim();
  const key = String(raw.key ?? raw.extension ?? raw.pattern ?? raw.preferenceKey ?? '').trim();
  const id = raw.id ? String(raw.id) : growthCandidateId(type || 'candidate', key || raw.title || raw.path || 'unknown');
  const scope = ['project', 'user-local', 'open-vibecoding-core'].includes(raw.scope) ? raw.scope : 'project';
  const status = ['pending', 'applied', 'rejected'].includes(raw.status) ? raw.status : 'pending';
  return {
    version: 1,
    id,
    type,
    key,
    scope,
    status,
    title: String(raw.title ?? `${type}: ${key}`).trim(),
    summary: String(raw.summary ?? '').trim(),
    evidence: normalizeArray(raw.evidence).map((item) => {
      if (typeof item === 'string') return { note: item };
      return item;
    }),
    confidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    suggestedPatch: raw.suggestedPatch ?? null,
    appliedAt: raw.appliedAt ?? null,
    appliedChanges: normalizeArray(raw.appliedChanges),
    applyMode: raw.applyMode ?? null,
    applyReason: raw.applyReason ?? null,
    rejectedAt: raw.rejectedAt ?? null,
    notes: raw.notes ?? null,
    createdAt: raw.createdAt ?? nowIso(),
    updatedAt: raw.updatedAt ?? nowIso(),
  };
}

function latestCandidates(records = []) {
  const byId = new Map();
  for (const record of records) {
    const candidate = normalizeCandidate(record);
    const previous = byId.get(candidate.id);
    if (!previous || String(candidate.updatedAt) >= String(previous.updatedAt)) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function writeCandidateEvent(projectRoot, candidate, patch = {}) {
  const event = {
    ...candidate,
    ...patch,
    updatedAt: nowIso(),
  };
  await appendJsonl(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_CANDIDATES), event);
  return normalizeCandidate(event);
}

function normalizeAutoApplyConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const defaultAuto = DEFAULT_GROWTH_CONFIG.autoApply;
  const minConfidence = Number(source.minConfidence ?? defaultAuto.minConfidence);
  return {
    enabled: source.enabled !== false,
    minConfidence: Number.isFinite(minConfidence) && minConfidence >= 0 && minConfidence <= 1
      ? minConfidence
      : defaultAuto.minConfidence,
    safeTypes: normalizeArray(source.safeTypes ?? defaultAuto.safeTypes).map((item) => String(item).trim()).filter(Boolean),
  };
}

function normalizeGrowthConfig(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...DEFAULT_GROWTH_CONFIG,
    ...source,
    scopes: normalizeArray(source.scopes ?? DEFAULT_GROWTH_CONFIG.scopes),
    supportedCandidateTypes: normalizeArray(source.supportedCandidateTypes ?? DEFAULT_GROWTH_CONFIG.supportedCandidateTypes),
    autoApply: normalizeAutoApplyConfig(source.autoApply),
  };
}

async function ensureGrowthFiles(projectRoot) {
  await fs.mkdir(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_DIR), { recursive: true });
  const acceptedPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_ACCEPTED);
  const rejectedPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_REJECTED);
  const localPreferencesPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_LOCAL_PREFERENCES);
  const ledgerPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_LEDGER);
  if (!(await exists(acceptedPath))) {
    await writeJson(acceptedPath, { version: 1, candidates: [] });
  }
  if (!(await exists(rejectedPath))) {
    await writeJson(rejectedPath, { version: 1, candidates: [] });
  }
  if (!(await exists(localPreferencesPath))) {
    await writeJson(localPreferencesPath, { version: 1, preferences: {} });
  }
  if (!(await exists(ledgerPath))) {
    await writeJson(ledgerPath, defaultGrowthLedger());
  }
}

async function readGrowthAutoApplyConfig(projectRoot) {
  const configPath = growthPath(projectRoot, OPEN_VIBECODING_STANDARDS_CONFIG);
  const config = await readJsonIfExists(configPath, null);
  return normalizeGrowthConfig(config?.growth).autoApply;
}

function normalizeGrowthLedgerEvent(event = {}) {
  return {
    version: 1,
    at: event.at ?? nowIso(),
    action: String(event.action ?? 'observe').trim() || 'observe',
    outcome: String(event.outcome ?? 'recorded').trim() || 'recorded',
    candidateId: event.candidateId ? String(event.candidateId) : null,
    candidateType: event.candidateType ? String(event.candidateType) : null,
    scope: event.scope ? String(event.scope) : null,
    autoApplied: event.autoApplied === true,
    applyMode: event.applyMode ? String(event.applyMode) : null,
    reason: event.reason ? String(event.reason) : null,
    changed: normalizeArray(event.changed).map((item) => String(item)),
  };
}

function summarizeGrowthLedgerEvents(events = [], state = { candidates: [] }) {
  const summary = defaultGrowthLedger().summary;
  summary.eventCount = events.length;
  for (const rawEvent of events) {
    const event = normalizeGrowthLedgerEvent(rawEvent);
    if (event.action === 'observe') {
      summary.observed += 1;
      if (event.outcome === 'pending-recorded') {
        summary.pendingObserved += 1;
      }
      if (event.outcome.startsWith('skipped-')) {
        summary.skipped += 1;
        const reason = event.outcome.replace(/^skipped-/, '') || 'unknown';
        summary.skippedReasons[reason] = (summary.skippedReasons[reason] ?? 0) + 1;
      }
      if (event.autoApplied) {
        summary.autoApplied += 1;
      }
    } else if (event.action === 'apply' && event.applyMode === 'manual') {
      summary.manualApplied += 1;
    } else if (event.action === 'reconcile' && event.autoApplied) {
      summary.reconciledAutoApplied += 1;
      summary.autoApplied += 1;
    } else if (event.action === 'reject') {
      summary.rejected += 1;
    } else if (event.action === 'checkpoint') {
      summary.completionCheckpoints += 1;
    }
  }
  const pending = state.candidates.filter((candidate) => candidate.status === 'pending').length;
  const applied = state.candidates.filter((candidate) => candidate.status === 'applied').length;
  const rejected = state.candidates.filter((candidate) => candidate.status === 'rejected').length;
  summary.current = {
    total: state.candidates.length,
    pending,
    applied,
    rejected,
  };
  return summary;
}

async function syncGrowthLedger(projectRoot, event = null) {
  if (event) {
    await appendJsonl(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_EVENTS), normalizeGrowthLedgerEvent(event));
  }
  const state = await readGrowthState(projectRoot);
  const events = await readJsonlIfExists(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_EVENTS));
  const normalizedEvents = events.map((entry) => normalizeGrowthLedgerEvent(entry));
  const ledger = {
    ...defaultGrowthLedger(),
    updatedAt: nowIso(),
    summary: summarizeGrowthLedgerEvents(normalizedEvents, state),
    recentEvents: normalizedEvents.slice(-12).reverse(),
  };
  await writeJson(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_LEDGER), ledger);
  return ledger;
}

export async function recordGrowthCheckpointWorkspace(projectRoot, options = {}) {
  await ensureGrowthFiles(projectRoot);
  const outcome = String(options.outcome ?? 'quality-verify').trim() || 'quality-verify';
  const reason = String(options.reason ?? outcome).trim() || outcome;
  const scope = String(options.scope ?? 'project').trim() || 'project';
  const changed = normalizeArray(options.changed).map((item) => String(item));
  const recentEvents = await readJsonlIfExists(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_EVENTS));
  const normalizedRecent = recentEvents
    .map((entry) => normalizeGrowthLedgerEvent(entry))
    .slice(-24)
    .reverse();
  const duplicate = normalizedRecent.find((event) => (
    event.action === 'checkpoint'
    && event.outcome === outcome
    && String(event.reason ?? '') === reason
    && String(event.scope ?? '') === scope
  ));
  if (duplicate) {
    const ledger = await syncGrowthLedger(projectRoot);
    return {
      ok: true,
      action: 'growth-checkpoint',
      projectRoot,
      recorded: false,
      reason: 'duplicate-checkpoint',
      event: duplicate,
      ledger,
    };
  }
  const event = normalizeGrowthLedgerEvent({
    action: 'checkpoint',
    outcome,
    reason,
    scope,
    changed,
  });
  const ledger = await syncGrowthLedger(projectRoot, event);
  return {
    ok: true,
    action: 'growth-checkpoint',
    projectRoot,
    recorded: true,
    event,
    ledger,
  };
}

async function reconcilePendingAutoApplyCandidates(projectRoot, options = {}) {
  const state = await readGrowthState(projectRoot);
  const autoApply = options.autoApply ?? await readGrowthAutoApplyConfig(projectRoot);
  const reconciled = [];
  for (const candidate of state.candidates) {
    if (candidate.status !== 'pending') {
      continue;
    }
    const autoApplyDecision = assessAutoApplyGrowthCandidate(candidate, autoApply);
    if (!autoApplyDecision.ok) {
      continue;
    }
    const applied = await applyGrowthCandidate(projectRoot, candidate, {
      mode: 'auto',
      reason: autoApplyDecision.reason,
    });
    if (applied.ok) {
      reconciled.push(applied.candidate);
    }
  }
  return reconciled;
}

export async function initGrowthWorkspace(projectRoot) {
  await ensureGrowthFiles(projectRoot);
  const reconciled = await reconcilePendingAutoApplyCandidates(projectRoot);
  for (const candidate of reconciled) {
    await syncGrowthLedger(projectRoot, {
      action: 'reconcile',
      outcome: 'auto-applied',
      candidateId: candidate.id,
      candidateType: candidate.type,
      scope: candidate.scope,
      autoApplied: true,
      applyMode: 'auto',
      reason: candidate.applyReason ?? 'safe-code-extension',
      changed: candidate.appliedChanges,
    });
  }
  const ledger = reconciled.length > 0
    ? await readJsonIfExists(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_LEDGER), defaultGrowthLedger())
    : await syncGrowthLedger(projectRoot);
  return {
    ok: true,
    action: 'growth-init',
    projectRoot,
    reconciledAutoApplied: reconciled,
    ledger,
    files: {
      dir: OPEN_VIBECODING_GROWTH_DIR,
      candidates: OPEN_VIBECODING_GROWTH_CANDIDATES,
      accepted: OPEN_VIBECODING_GROWTH_ACCEPTED,
      rejected: OPEN_VIBECODING_GROWTH_REJECTED,
      localPreferences: OPEN_VIBECODING_GROWTH_LOCAL_PREFERENCES,
      ledger: OPEN_VIBECODING_GROWTH_LEDGER,
      events: OPEN_VIBECODING_GROWTH_EVENTS,
    },
  };
}

async function readGrowthState(projectRoot) {
  await ensureGrowthFiles(projectRoot);
  const records = await readJsonlIfExists(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_CANDIDATES));
  const candidates = latestCandidates(records);
  const accepted = await readJsonIfExists(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_ACCEPTED), { version: 1, candidates: [] });
  const rejected = await readJsonIfExists(growthPath(projectRoot, OPEN_VIBECODING_GROWTH_REJECTED), { version: 1, candidates: [] });
  return {
    candidates,
    accepted: normalizeArray(accepted.candidates),
    rejected: normalizeArray(rejected.candidates),
  };
}

export async function observeGrowthWorkspace(projectRoot, rawCandidate = {}, options = {}) {
  const candidate = normalizeCandidate(rawCandidate);
  if (!candidate.type || !candidate.key) {
    const result = { ok: false, action: 'growth-observe', skipped: true, reason: 'missing-type-or-key', candidate };
    result.ledger = await syncGrowthLedger(projectRoot, {
      action: 'observe',
      outcome: 'skipped-missing-type-or-key',
      candidateId: candidate.id,
      candidateType: candidate.type,
      scope: candidate.scope,
      reason: result.reason,
    });
    return result;
  }
  await ensureGrowthFiles(projectRoot);
  const state = await readGrowthState(projectRoot);
  const existing = state.candidates.find((item) => item.id === candidate.id);
  if (existing?.status === 'applied' || existing?.status === 'rejected') {
    const result = { ok: true, action: 'growth-observe', skipped: true, reason: `candidate-${existing.status}`, candidate: existing, autoApplied: false };
    result.ledger = await syncGrowthLedger(projectRoot, {
      action: 'observe',
      outcome: `skipped-candidate-${existing.status}`,
      candidateId: existing.id,
      candidateType: existing.type,
      scope: existing.scope,
      reason: result.reason,
    });
    return result;
  }
  if (existing?.status === 'pending') {
    const autoApplyDecision = assessAutoApplyGrowthCandidate(existing, options.autoApply);
    if (autoApplyDecision.ok) {
      const applied = await applyGrowthCandidate(projectRoot, existing, {
        mode: 'auto',
        reason: autoApplyDecision.reason,
      });
      const result = {
        ...applied,
        action: 'growth-observe',
        skipped: false,
        autoApplied: true,
        autoApplyDecision,
      };
      result.ledger = await syncGrowthLedger(projectRoot, {
        action: 'observe',
        outcome: 'auto-applied',
        candidateId: applied.candidate.id,
        candidateType: applied.candidate.type,
        scope: applied.candidate.scope,
        autoApplied: true,
        applyMode: 'auto',
        reason: autoApplyDecision.reason,
        changed: applied.changed,
      });
      return result;
    }
    const result = {
      ok: true,
      action: 'growth-observe',
      skipped: true,
      reason: 'candidate-already-pending',
      candidate: existing,
      autoApplied: false,
      autoApplyDecision,
    };
    result.ledger = await syncGrowthLedger(projectRoot, {
      action: 'observe',
      outcome: 'skipped-candidate-already-pending',
      candidateId: existing.id,
      candidateType: existing.type,
      scope: existing.scope,
      reason: autoApplyDecision.reason,
    });
    return result;
  }
  const stored = await writeCandidateEvent(projectRoot, candidate);
  const autoApplyDecision = assessAutoApplyGrowthCandidate(stored, options.autoApply);
  if (autoApplyDecision.ok) {
    const applied = await applyGrowthCandidate(projectRoot, stored, {
      mode: 'auto',
      reason: autoApplyDecision.reason,
    });
    const result = {
      ...applied,
      action: 'growth-observe',
      skipped: false,
      autoApplied: true,
      autoApplyDecision,
    };
    result.ledger = await syncGrowthLedger(projectRoot, {
      action: 'observe',
      outcome: 'auto-applied',
      candidateId: applied.candidate.id,
      candidateType: applied.candidate.type,
      scope: applied.candidate.scope,
      autoApplied: true,
      applyMode: 'auto',
      reason: autoApplyDecision.reason,
      changed: applied.changed,
    });
    return result;
  }
  const result = {
    ok: true,
    action: 'growth-observe',
    skipped: false,
    candidate: stored,
    autoApplied: false,
    autoApplyDecision,
  };
  result.ledger = await syncGrowthLedger(projectRoot, {
    action: 'observe',
    outcome: 'pending-recorded',
    candidateId: stored.id,
    candidateType: stored.type,
    scope: stored.scope,
    reason: autoApplyDecision.reason,
  });
  return result;
}

export function assessAutoApplyGrowthCandidate(candidate, rawConfig = {}) {
  const config = normalizeAutoApplyConfig(rawConfig);
  if (!config.enabled) {
    return { ok: false, reason: 'auto-apply-disabled' };
  }
  if (!AUTO_APPLY_TYPES.has(candidate.type) || !config.safeTypes.includes(candidate.type)) {
    return { ok: false, reason: 'type-needs-review' };
  }
  if (candidate.scope !== 'project') {
    return { ok: false, reason: 'scope-needs-review' };
  }
  if (
    candidate.type !== 'code-extension'
    && (typeof candidate.confidence !== 'number' || candidate.confidence < config.minConfidence)
  ) {
    return { ok: false, reason: 'confidence-below-threshold' };
  }
  const extension = normalizeExtension(candidate.key);
  if (!extension || candidate.key !== extension) {
    return { ok: false, reason: 'invalid-extension' };
  }
  const patch = candidate.suggestedPatch ?? {};
  if (
    patch.file !== OPEN_VIBECODING_STANDARDS_CONFIG
    || patch.op !== 'append'
    || patch.path !== 'developmentStandards.codeFileLines.codeFileExtensions'
    || normalizeExtension(patch.value) !== extension
  ) {
    return { ok: false, reason: 'patch-needs-review' };
  }
  return { ok: true, reason: 'safe-code-extension' };
}

async function applyGrowthCandidate(projectRoot, candidate, options = {}) {
  if (!SAFE_APPLY_TYPES.has(candidate.type)) {
    return { ok: false, action: 'growth-apply', projectRoot, candidate, errors: [`Growth candidate type requires manual review: ${candidate.type}`] };
  }

  const applied = candidate.type === 'user-preference'
    ? await applyUserPreferenceCandidate(projectRoot, candidate)
    : await applyStandardsCandidate(projectRoot, candidate);
  if (!applied.ok) {
    return { ok: false, action: 'growth-apply', projectRoot, candidate, errors: applied.errors };
  }

  const stored = await writeCandidateEvent(projectRoot, candidate, {
    status: 'applied',
    appliedAt: nowIso(),
    appliedChanges: applied.changed,
    applyMode: options.mode ?? 'manual',
    applyReason: options.reason ?? null,
  });
  const acceptedPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_ACCEPTED);
  const accepted = await readJsonIfExists(acceptedPath, { version: 1, candidates: [] });
  const acceptedCandidates = normalizeArray(accepted.candidates).filter((item) => item.id !== stored.id);
  acceptedCandidates.push(stored);
  await writeJson(acceptedPath, { version: 1, candidates: acceptedCandidates });

  return {
    ok: true,
    action: 'growth-apply',
    projectRoot,
    candidate: stored,
    changed: applied.changed,
    errors: [],
  };
}

export async function reviewGrowthWorkspace(projectRoot) {
  const state = await readGrowthState(projectRoot);
  const ledger = await syncGrowthLedger(projectRoot);
  const pending = state.candidates.filter((candidate) => candidate.status === 'pending');
  const benchmarkRecommendations = await listBenchmarkRecommendationsWorkspace(projectRoot).catch(() => []);
  return {
    ok: true,
    action: 'growth-review',
    projectRoot,
    pending,
    applied: state.candidates.filter((candidate) => candidate.status === 'applied'),
    rejected: state.candidates.filter((candidate) => candidate.status === 'rejected'),
    summary: {
      pending: pending.length,
      applied: state.candidates.filter((candidate) => candidate.status === 'applied').length,
      rejected: state.candidates.filter((candidate) => candidate.status === 'rejected').length,
    },
    ledger,
    benchmarkRecommendations,
    nextActions: [
      ...(pending.length === 0
        ? ['当前没有待确认增长候选。']
        : pending.map((candidate) => `收工复盘时确认后运行 open-vibecoding grow . --apply --id ${candidate.id}；不采用则运行 open-vibecoding grow . --reject --id ${candidate.id}`)),
      ...benchmarkRecommendations.map((source) => `信源 ${source.sourceKey} 最近 ${source.windowDays} 天已被采纳 ${source.adoptedCount} 次（累计 ${source.totalAdoptedCount} 次），建议确认后运行 ${source.approveCommand} 纳入 benchmark。`),
    ],
  };
}

function ensureStandardsConfigShape(config) {
  const next = config && typeof config === 'object' ? { ...config } : {};
  next.developmentStandards = next.developmentStandards && typeof next.developmentStandards === 'object'
    ? { ...next.developmentStandards }
    : {};
  next.developmentStandards.codeFileLines = next.developmentStandards.codeFileLines && typeof next.developmentStandards.codeFileLines === 'object'
    ? { ...next.developmentStandards.codeFileLines }
    : {};
  next.growth = normalizeGrowthConfig(next.growth);
  return next;
}

function appendUnique(list, value, normalize = (item) => String(item)) {
  const next = normalizeArray(list).map((item) => normalize(item)).filter(Boolean);
  const normalized = normalize(value);
  if (normalized && !next.includes(normalized)) {
    next.push(normalized);
  }
  return next;
}

async function applyStandardsCandidate(projectRoot, candidate) {
  const configPath = growthPath(projectRoot, OPEN_VIBECODING_STANDARDS_CONFIG);
  if (!(await exists(configPath))) {
    return {
      ok: false,
      errors: [`${OPEN_VIBECODING_STANDARDS_CONFIG} is required. Run: open-vibecoding standards . --init`],
      changed: [],
    };
  }

  const config = ensureStandardsConfigShape(await readJson(configPath));
  const lineConfig = config.developmentStandards.codeFileLines;
  const changed = [];
  if (candidate.type === 'code-extension') {
    const extension = normalizeExtension(candidate.key);
    lineConfig.codeFileExtensions = appendUnique(lineConfig.codeFileExtensions, extension, normalizeExtension);
    changed.push(`developmentStandards.codeFileLines.codeFileExtensions += ${extension}`);
  } else if (candidate.type === 'exempt-path-segment') {
    lineConfig.exemptPathSegments = appendUnique(lineConfig.exemptPathSegments, candidate.key);
    changed.push(`developmentStandards.codeFileLines.exemptPathSegments += ${candidate.key}`);
  } else if (candidate.type === 'exempt-file-pattern') {
    lineConfig.exemptFilePatterns = appendUnique(lineConfig.exemptFilePatterns, candidate.key);
    changed.push(`developmentStandards.codeFileLines.exemptFilePatterns += ${candidate.key}`);
  } else {
    return { ok: false, errors: [`${candidate.type} cannot update standards config automatically.`], changed: [] };
  }
  await writeJson(configPath, config);
  return { ok: true, errors: [], changed };
}

async function applyUserPreferenceCandidate(projectRoot, candidate) {
  const preferencesPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_LOCAL_PREFERENCES);
  const current = await readJsonIfExists(preferencesPath, { version: 1, preferences: {} });
  const preferences = current.preferences && typeof current.preferences === 'object' ? { ...current.preferences } : {};
  preferences[candidate.key] = candidate.suggestedPatch?.value ?? candidate.summary ?? true;
  await writeJson(preferencesPath, { version: 1, preferences, updatedAt: nowIso() });
  return {
    ok: true,
    errors: [],
    changed: [`${OPEN_VIBECODING_GROWTH_LOCAL_PREFERENCES} preferences.${candidate.key}`],
  };
}

export async function applyGrowthCandidateWorkspace(projectRoot, options = {}) {
  const id = String(options.id ?? '').trim();
  if (!id) {
    return { ok: false, action: 'growth-apply', projectRoot, errors: ['--id is required.'] };
  }
  const state = await readGrowthState(projectRoot);
  const candidate = state.candidates.find((item) => item.id === id);
  if (!candidate) {
    return { ok: false, action: 'growth-apply', projectRoot, errors: [`Growth candidate not found: ${id}`] };
  }
  if (candidate.status !== 'pending') {
    return { ok: false, action: 'growth-apply', projectRoot, candidate, errors: [`Growth candidate is already ${candidate.status}.`] };
  }
  const result = await applyGrowthCandidate(projectRoot, candidate, { mode: 'manual' });
  if (result.ok) {
    result.ledger = await syncGrowthLedger(projectRoot, {
      action: 'apply',
      outcome: 'manual-applied',
      candidateId: result.candidate.id,
      candidateType: result.candidate.type,
      scope: result.candidate.scope,
      applyMode: 'manual',
      reason: result.candidate.applyReason,
      changed: result.changed,
    });
  }
  return result;
}

export async function rejectGrowthCandidateWorkspace(projectRoot, options = {}) {
  const id = String(options.id ?? '').trim();
  if (!id) {
    return { ok: false, action: 'growth-reject', projectRoot, errors: ['--id is required.'] };
  }
  const state = await readGrowthState(projectRoot);
  const candidate = state.candidates.find((item) => item.id === id);
  if (!candidate) {
    return { ok: false, action: 'growth-reject', projectRoot, errors: [`Growth candidate not found: ${id}`] };
  }
  if (candidate.status !== 'pending') {
    return { ok: false, action: 'growth-reject', projectRoot, candidate, errors: [`Growth candidate is already ${candidate.status}.`] };
  }
  const stored = await writeCandidateEvent(projectRoot, candidate, {
    status: 'rejected',
    rejectedAt: nowIso(),
    notes: String(options.notes ?? '').trim() || null,
  });
  const rejectedPath = growthPath(projectRoot, OPEN_VIBECODING_GROWTH_REJECTED);
  const rejected = await readJsonIfExists(rejectedPath, { version: 1, candidates: [] });
  const rejectedCandidates = normalizeArray(rejected.candidates).filter((item) => item.id !== stored.id);
  rejectedCandidates.push(stored);
  await writeJson(rejectedPath, { version: 1, candidates: rejectedCandidates });

  const result = {
    ok: true,
    action: 'growth-reject',
    projectRoot,
    candidate: stored,
    errors: [],
  };
  result.ledger = await syncGrowthLedger(projectRoot, {
    action: 'reject',
    outcome: 'rejected',
    candidateId: stored.id,
    candidateType: stored.type,
    scope: stored.scope,
    reason: stored.notes,
  });
  return result;
}

export async function checkGrowthWorkspace(projectRoot) {
  const state = await readGrowthState(projectRoot);
  const ledger = await syncGrowthLedger(projectRoot);
  const pending = state.candidates.filter((candidate) => candidate.status === 'pending');
  const applied = state.candidates.filter((candidate) => candidate.status === 'applied');
  const rejected = state.candidates.filter((candidate) => candidate.status === 'rejected');
  return {
    ok: true,
    action: 'growth-check',
    projectRoot,
    pending,
    applied,
    rejected,
    summary: {
      pending: pending.length,
      applied: applied.length,
      rejected: rejected.length,
    },
    ledger,
  };
}

export function validateGrowthConfig(config, errors = []) {
  const growth = config?.growth;
  if (!growth) return errors;
  if (growth.enabled !== undefined && typeof growth.enabled !== 'boolean') {
    errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.enabled must be a boolean.`);
  }
  if (growth.reviewRequired !== undefined && growth.reviewRequired !== true) {
    errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.reviewRequired must remain true; non-whitelisted shared rules still require wrap-up review.`);
  }
  if (growth.candidateLimit !== undefined) {
    const limit = Number(growth.candidateLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.candidateLimit must be a positive integer.`);
    }
  }
  if (growth.autoApply !== undefined) {
    const autoApply = growth.autoApply;
    if (!autoApply || typeof autoApply !== 'object' || Array.isArray(autoApply)) {
      errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.autoApply must be an object.`);
    } else {
      if (autoApply.enabled !== undefined && typeof autoApply.enabled !== 'boolean') {
        errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.autoApply.enabled must be a boolean.`);
      }
      if (autoApply.minConfidence !== undefined) {
        const minConfidence = Number(autoApply.minConfidence);
        if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
          errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.autoApply.minConfidence must be between 0 and 1.`);
        }
      }
      if (autoApply.safeTypes !== undefined && !Array.isArray(autoApply.safeTypes)) {
        errors.push(`${OPEN_VIBECODING_STANDARDS_CONFIG} growth.autoApply.safeTypes must be an array.`);
      }
    }
  }
  return errors;
}

export function buildCodeExtensionCandidate(relativePath, details = {}) {
  const normalized = normalizePosixPath(relativePath);
  const extension = normalizeExtension(path.extname(normalized));
  return normalizeCandidate({
    type: 'code-extension',
    key: extension,
    scope: 'project',
    title: `新增代码文件扩展名 ${extension}`,
    summary: `检测到 ${normalized} 看起来像代码文件，但 ${extension} 尚未纳入 Open VibeCoding dev-check 代码扩展名配置。`,
    evidence: [
      {
        path: normalized,
        lineCount: details.lineCount ?? null,
        reason: details.reason ?? 'looks-like-code',
      },
    ],
    confidence: details.confidence ?? 0.74,
    suggestedPatch: {
      file: OPEN_VIBECODING_STANDARDS_CONFIG,
      op: 'append',
      path: 'developmentStandards.codeFileLines.codeFileExtensions',
      value: extension,
    },
  });
}
