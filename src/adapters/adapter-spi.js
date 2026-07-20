import crypto from 'node:crypto';
import {
  ADAPTER_CONTRACT_VERSION,
  capabilityAvailable,
  describeCapabilities,
  normalizeClient,
} from './capability-envelope.js';
import { normalizeLifecycleEvent } from './event-normalizer.js';

const DETECTION_PRIORITY = Object.freeze({
  'hook-payload': 100,
  'session-binding': 95,
  'explicit-launcher': 90,
  'sdk-session': 80,
  'process-env': 50,
  'config-probe': 20,
  'agent-self-report': 10,
});

function normalizedEvidenceList(evidence) {
  const list = Array.isArray(evidence) ? evidence : [evidence];
  return list
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => ({
      source: String(item.source ?? 'agent-self-report'),
      client: item.client ? String(item.client).toLowerCase() : null,
      surface: item.surface ?? 'unknown',
      executionMode: item.executionMode ?? 'interactive',
      sessionId: item.sessionId ?? null,
      threadId: item.threadId ?? null,
      observedCapabilities: Array.isArray(item.observedCapabilities) ? item.observedCapabilities : [],
      confidence: Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : null,
      index,
    }))
    .filter((item) => ['codex', 'claude', 'cursor'].includes(item.client));
}

function detectRuntime(evidence = []) {
  const candidates = normalizedEvidenceList(evidence)
    .map((item) => {
      const priority = DETECTION_PRIORITY[item.source] ?? 0;
      return {
        ...item,
        priority,
        confidence: item.confidence ?? Math.min(1, Math.max(0.1, priority / 100)),
      };
    })
    .sort((left, right) => right.priority - left.priority
      || right.confidence - left.confidence
      || left.index - right.index);
  const selected = candidates[0] ?? null;
  if (!selected) {
    return {
      schema: 'openprd.runtime-detection.v1',
      activeClient: 'unknown',
      surface: 'unknown',
      executionMode: 'interactive',
      sessionId: null,
      threadId: null,
      confidence: 0,
      evidence: [],
      capabilityEnvelope: null,
    };
  }
  return {
    schema: 'openprd.runtime-detection.v1',
    activeClient: selected.client,
    surface: selected.surface,
    executionMode: selected.executionMode,
    sessionId: selected.sessionId,
    threadId: selected.threadId,
    confidence: selected.confidence,
    evidence: candidates,
    capabilityEnvelope: describeCapabilities(selected.client, {
      surface: selected.surface,
      observedCapabilities: selected.observedCapabilities,
    }),
  };
}

function renderDecision(client, decision = {}) {
  const normalized = normalizeClient(client);
  const allowed = decision.decision === 'allow' || decision.allowed === true;
  return {
    schema: 'openprd.adapter-decision.v1',
    adapterVersion: ADAPTER_CONTRACT_VERSION,
    client: normalized,
    allowed,
    approvalId: decision.approvalId ?? null,
    message: decision.message ?? (allowed ? '已允许继续当前操作。' : '当前操作尚未获准。'),
    reason: decision.reason ?? null,
  };
}

function createAdapter(client, overrides = {}) {
  const normalized = normalizeClient(client);
  return Object.freeze({
    client: normalized,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    detectRuntime: overrides.detectRuntime ?? detectRuntime,
    describeCapabilities: (options = {}) => describeCapabilities(normalized, options),
    normalizeLifecycleEvent: (raw) => normalizeLifecycleEvent(normalized, raw),
    renderDecision: overrides.renderDecision ?? ((decision) => renderDecision(normalized, decision)),
    can: (capability, options = {}) => capabilityAvailable(describeCapabilities(normalized, options), capability),
  });
}

function adapterContractDigest() {
  const contract = ['codex', 'claude', 'cursor'].map((client) => describeCapabilities(client));
  return crypto.createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

export {
  ADAPTER_CONTRACT_VERSION,
  DETECTION_PRIORITY,
  adapterContractDigest,
  createAdapter,
  detectRuntime,
  renderDecision,
};
