import { CONTEXT_TELEMETRY_SCHEMA_VERSION } from './constants.js';

export function createContextTelemetryEvent({
  capsule,
  cacheStatus = 'not-used',
  eventType = 'context.compiled',
} = {}) {
  if (!capsule?.digest) {
    throw new TypeError('Context telemetry requires a compiled capsule.');
  }
  return {
    schemaVersion: CONTEXT_TELEMETRY_SCHEMA_VERSION,
    eventType,
    requestDigest: capsule.requestDigest,
    capsuleDigest: capsule.digest,
    workspaceId: capsule.workspaceId,
    revision: capsule.revision,
    taskId: capsule.taskId,
    delivery: capsule.delivery,
    cacheStatus,
    metrics: {
      candidateCount: capsule.summary.candidateCount,
      includedCount: capsule.summary.includedCount,
      excludedCount: capsule.summary.excludedCount,
      redactionCount: capsule.summary.redactionCount,
      estimatedTokens: capsule.budget.estimatedTokens,
      limitTokens: capsule.budget.limitTokens,
    },
  };
}

export async function emitContextTelemetry(sink, event) {
  if (typeof sink === 'function') {
    await sink(event);
    return;
  }
  if (sink && typeof sink.record === 'function') {
    await sink.record(event);
    return;
  }
  throw new TypeError('Context telemetry sink must be a function or expose record().');
}
