import { createHash } from 'node:crypto';

const EVENT_ENVELOPE_SCHEMA = 'openprd.event';
const EVENT_ENVELOPE_VERSION = 1;

class EventEnvelopeValidationError extends Error {
  constructor(errors) {
    super(`Invalid OpenPrd event envelope: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    this.name = 'EventEnvelopeValidationError';
    this.code = 'OPENPRD_INVALID_EVENT_ENVELOPE';
    this.errors = errors;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'must not contain non-finite numbers';
  if (typeof value !== 'object') return `must not contain ${typeof value} values`;
  if (seen.has(value)) return 'must not contain circular references';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = inspectJsonValue(item, seen);
      if (error) return error;
    }
    seen.delete(value);
    return null;
  }
  if (!isPlainObject(value)) return 'must contain only plain JSON objects';
  for (const item of Object.values(value)) {
    const error = inspectJsonValue(item, seen);
    if (error) return error;
  }
  seen.delete(value);
  return null;
}

function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function canonicalJson(value) {
  const error = inspectJsonValue(value);
  if (error) throw new TypeError(`Value is not canonical JSON: ${error}`);
  return JSON.stringify(canonicalize(value));
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? '') : date.toISOString();
}

function eventIdentitySeed(value) {
  const { eventId: _eventId, ...seed } = value ?? {};
  return seed;
}

function createStableEventId(value) {
  const digest = createHash('sha256')
    .update(canonicalJson(eventIdentitySeed(value)))
    .digest('hex');
  return `evt_${digest.slice(0, 32)}`;
}

function validateEventEnvelope(envelope) {
  const errors = [];
  const add = (path, message) => errors.push({ path, message });
  if (!isPlainObject(envelope)) {
    add('$', 'must be a plain object');
    return { ok: false, errors };
  }
  if (envelope.schema !== EVENT_ENVELOPE_SCHEMA) add('schema', `must equal ${EVENT_ENVELOPE_SCHEMA}`);
  if (envelope.version !== EVENT_ENVELOPE_VERSION) add('version', `must equal ${EVENT_ENVELOPE_VERSION}`);
  if (typeof envelope.eventId !== 'string' || !envelope.eventId.trim()) add('eventId', 'must be a non-empty string');
  if (typeof envelope.eventType !== 'string' || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/i.test(envelope.eventType)) {
    add('eventType', 'must be a dotted, underscored, or dashed event name');
  }
  if (typeof envelope.projectId !== 'string' || !envelope.projectId.trim()) add('projectId', 'must be a non-empty string');
  if (
    typeof envelope.streamId !== 'string'
    || !envelope.streamId.trim()
    || envelope.streamId.includes('..')
    || /[\0\r\n]/.test(envelope.streamId)
  ) {
    add('streamId', 'must be a safe non-empty logical stream ID');
  }
  if (!Number.isSafeInteger(envelope.revision) || envelope.revision < 1) add('revision', 'must be a positive safe integer');
  if (typeof envelope.occurredAt !== 'string' || Number.isNaN(Date.parse(envelope.occurredAt))) {
    add('occurredAt', 'must be an ISO-compatible timestamp');
  }
  if (!isPlainObject(envelope.actor) || typeof envelope.actor.type !== 'string' || !envelope.actor.type.trim()) {
    add('actor', 'must be an object with a non-empty type');
  } else if (envelope.actor.id !== undefined && (typeof envelope.actor.id !== 'string' || !envelope.actor.id.trim())) {
    add('actor.id', 'must be a non-empty string when present');
  } else {
    const actorError = inspectJsonValue(envelope.actor);
    if (actorError) add('actor', actorError);
  }
  const payloadError = inspectJsonValue(envelope.payload);
  if (!isPlainObject(envelope.payload) || payloadError) add('payload', payloadError ?? 'must be a plain object');
  const metadataError = inspectJsonValue(envelope.metadata);
  if (!isPlainObject(envelope.metadata) || metadataError) add('metadata', metadataError ?? 'must be a plain object');
  for (const field of ['causationId', 'correlationId']) {
    if (envelope[field] !== null && envelope[field] !== undefined && (typeof envelope[field] !== 'string' || !envelope[field].trim())) {
      add(field, 'must be a non-empty string or null');
    }
  }
  return { ok: errors.length === 0, errors };
}

function assertEventEnvelope(envelope) {
  const validation = validateEventEnvelope(envelope);
  if (!validation.ok) throw new EventEnvelopeValidationError(validation.errors);
  return envelope;
}

function createEventEnvelope(input, options = {}) {
  const clock = options.clock ?? (() => new Date());
  const occurredAt = normalizeTimestamp(input?.occurredAt ?? clock());
  const envelopeWithoutId = {
    schema: EVENT_ENVELOPE_SCHEMA,
    version: EVENT_ENVELOPE_VERSION,
    eventType: input?.eventType,
    projectId: input?.projectId,
    streamId: input?.streamId,
    revision: input?.revision,
    occurredAt,
    actor: input?.actor ?? { type: 'system' },
    causationId: input?.causationId ?? null,
    correlationId: input?.correlationId ?? null,
    payload: input?.payload ?? {},
    metadata: input?.metadata ?? {},
  };
  const idFactory = options.idFactory ?? createStableEventId;
  assertEventEnvelope({ ...envelopeWithoutId, eventId: input?.eventId ?? 'evt_pending' });
  const envelope = {
    ...envelopeWithoutId,
    eventId: input?.eventId ?? idFactory(envelopeWithoutId),
  };
  return assertEventEnvelope(envelope);
}

export {
  EVENT_ENVELOPE_SCHEMA,
  EVENT_ENVELOPE_VERSION,
  EventEnvelopeValidationError,
  assertEventEnvelope,
  canonicalJson,
  createEventEnvelope,
  createStableEventId,
  validateEventEnvelope,
};
