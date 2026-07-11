export const CONTEXT_REQUEST_SCHEMA_VERSION = 'openprd.context-request.v1';
export const CONTEXT_CAPSULE_SCHEMA_VERSION = 'openprd.context-capsule.v1';
export const CONTEXT_CACHE_SCHEMA_VERSION = 'openprd.context-cache-entry.v1';
export const CONTEXT_TELEMETRY_SCHEMA_VERSION = 'openprd.context-telemetry.v1';

export const CONTEXT_COMPILER_VERSION = '1.0.0';
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 800;
export const DEFAULT_CONTEXT_DELTA_TOKEN_BUDGET = 250;

// Authority is intentionally explicit. Callers can still provide a numeric score,
// but named values keep cross-tool adapters aligned on the same precedence rules.
export const CONTEXT_AUTHORITY_SCORES = Object.freeze({
  'user-confirmed': 100,
  'project-canonical': 90,
  'runtime-observed': 80,
  'project-derived': 70,
  'tool-derived': 60,
  'agent-inferred': 40,
  external: 30,
  unknown: 0,
});

export const CONTEXT_FRESHNESS_SCORES = Object.freeze({
  current: 4,
  latest: 3,
  recent: 2,
  historical: 1,
  stale: 0,
  unknown: 0,
});
