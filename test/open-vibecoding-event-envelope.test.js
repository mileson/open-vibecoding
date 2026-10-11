import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EVENT_ENVELOPE_SCHEMA,
  EVENT_ENVELOPE_VERSION,
  EventEnvelopeValidationError,
  assertEventEnvelope,
  createEventEnvelope,
  createStableEventId,
  validateEventEnvelope,
} from '../src/kernel/event-envelope.js';

const baseEvent = {
  eventType: 'task.claimed',
  projectId: 'project-1',
  streamId: 'task/T001',
  revision: 1,
  actor: { type: 'agent', id: 'codex/thread-1' },
  payload: { taskId: 'T001', leaseMs: 30_000 },
};

test('event envelope v1 injects time and produces a stable content ID', () => {
  const options = { clock: () => new Date('2026-07-10T12:00:00.000Z') };
  const first = createEventEnvelope(baseEvent, options);
  const reordered = createEventEnvelope({
    ...baseEvent,
    payload: { leaseMs: 30_000, taskId: 'T001' },
  }, options);

  assert.equal(first.schema, EVENT_ENVELOPE_SCHEMA);
  assert.equal(first.version, EVENT_ENVELOPE_VERSION);
  assert.equal(first.occurredAt, '2026-07-10T12:00:00.000Z');
  assert.match(first.eventId, /^evt_[a-f0-9]{32}$/);
  assert.equal(first.eventId, reordered.eventId);
  assert.equal(createStableEventId({ ...first, eventId: undefined }), first.eventId);
  assert.deepEqual(validateEventEnvelope(first), { ok: true, errors: [] });
  assert.equal(assertEventEnvelope(first), first);
});

test('event envelope supports deterministic test injectors without weakening validation', () => {
  const envelope = createEventEnvelope(baseEvent, {
    clock: () => '2026-07-10T12:00:00Z',
    idFactory: () => 'evt_fixture_1',
  });

  assert.equal(envelope.occurredAt, '2026-07-10T12:00:00.000Z');
  assert.equal(envelope.eventId, 'evt_fixture_1');
  assert.deepEqual(validateEventEnvelope(envelope), { ok: true, errors: [] });
});

test('event envelope validation reports every contract violation and assert throws a typed error', () => {
  const invalid = {
    schema: EVENT_ENVELOPE_SCHEMA,
    version: 2,
    eventId: '',
    eventType: '',
    projectId: '',
    streamId: '../outside',
    revision: 0,
    occurredAt: 'not-a-date',
    actor: { type: '' },
    payload: { bad: undefined },
    metadata: [],
  };
  const result = validateEventEnvelope(invalid);

  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 8);
  assert.ok(result.errors.some((item) => item.path === 'version'));
  assert.ok(result.errors.some((item) => item.path === 'payload'));
  assert.throws(
    () => assertEventEnvelope(invalid),
    (error) => error instanceof EventEnvelopeValidationError && error.errors.length === result.errors.length,
  );
});
