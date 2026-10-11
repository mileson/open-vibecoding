import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  appendJsonlAtomic,
  atomicWriteJson,
  readJsonIfExists,
  readJsonlRecovered,
  withFileLock,
} from './atomic-store.js';
import {
  assertEventEnvelope,
  canonicalJson,
  createEventEnvelope,
  validateEventEnvelope,
} from './event-envelope.js';
import { ensureProjectManifest, readProjectManifest } from './project-manifest.js';

const LEDGER_SCHEMA = 'openprd.project-ledger';
const LEDGER_VERSION = 1;
const STREAM_HEAD_SCHEMA = 'openprd.stream-head';
const PROJECTION_SCHEMA = 'openprd.projection';

class RevisionConflictError extends Error {
  constructor(streamId, expectedRevision, actualRevision) {
    super(`Revision conflict for ${streamId}: expected ${expectedRevision}, found ${actualRevision}`);
    this.name = 'RevisionConflictError';
    this.code = 'OPEN_VIBECODING_LEDGER_REVISION_CONFLICT';
    this.streamId = streamId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

class IdempotencyConflictError extends Error {
  constructor(idempotencyKey, existingEventId) {
    super(`Idempotency key ${idempotencyKey} was already used by ${existingEventId} with different content`);
    this.name = 'IdempotencyConflictError';
    this.code = 'OPEN_VIBECODING_LEDGER_IDEMPOTENCY_CONFLICT';
    this.idempotencyKey = idempotencyKey;
    this.existingEventId = existingEventId;
  }
}

function hashName(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function validateLogicalId(value, label) {
  if (
    typeof value !== 'string'
    || !value.trim()
    || value.includes('..')
    || /[\0\r\n]/.test(value)
  ) {
    throw new TypeError(`${label} must be a safe non-empty logical ID`);
  }
  return value;
}

function normalizeProjectionName(name) {
  validateLogicalId(name, 'projection name');
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'projection';
  return `${slug.slice(0, 48)}-${hashName(name).slice(0, 8)}`;
}

function ledgerPaths(projectRoot) {
  const root = path.join(path.resolve(projectRoot), '.open-vibecoding', 'ledger');
  return {
    root,
    events: path.join(root, 'events.jsonl'),
    heads: path.join(root, 'heads'),
    projections: path.join(root, 'projections'),
    lock: path.join(root, 'locks', 'ledger.lock'),
  };
}

function streamPaths(projectRoot, streamId) {
  validateLogicalId(streamId, 'streamId');
  const paths = ledgerPaths(projectRoot);
  const key = hashName(streamId);
  return {
    ...paths,
    stream: paths.events,
    head: path.join(paths.heads, `${key}.json`),
    key,
  };
}

function projectionPath(projectRoot, name) {
  return path.join(ledgerPaths(projectRoot).projections, `${normalizeProjectionName(name)}.json`);
}

function eventInputFingerprint(streamId, input) {
  const metadata = { ...(input?.metadata ?? {}) };
  delete metadata.idempotencyKey;
  delete metadata.idempotencyFingerprint;
  delete metadata.ledgerPosition;
  return createHash('sha256').update(canonicalJson({
    streamId,
    eventType: input?.eventType,
    actor: input?.actor ?? { type: 'system' },
    causationId: input?.causationId ?? null,
    correlationId: input?.correlationId ?? null,
    payload: input?.payload ?? {},
    metadata,
  })).digest('hex');
}

function deriveHeads(events) {
  const heads = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    heads.set(event.streamId, {
      schema: STREAM_HEAD_SCHEMA,
      version: LEDGER_VERSION,
      projectId: event.projectId,
      streamId: event.streamId,
      revision: event.revision,
      lastEventId: event.eventId,
      ledgerPosition: event.metadata?.ledgerPosition ?? index + 1,
      updatedAt: event.occurredAt,
    });
  }
  return heads;
}

function emptyHead(streamId) {
  return {
    schema: STREAM_HEAD_SCHEMA,
    version: LEDGER_VERSION,
    projectId: null,
    streamId,
    revision: 0,
    lastEventId: null,
    ledgerPosition: 0,
    updatedAt: null,
  };
}

function sameHead(left, right) {
  return left?.schema === right?.schema
    && left?.version === right?.version
    && left?.projectId === right?.projectId
    && left?.streamId === right?.streamId
    && left?.revision === right?.revision
    && left?.lastEventId === right?.lastEventId
    && left?.ledgerPosition === right?.ledgerPosition
    && left?.updatedAt === right?.updatedAt;
}

function openProjectLedger(projectRoot, options = {}) {
  const resolvedRoot = path.resolve(projectRoot);
  const paths = ledgerPaths(resolvedRoot);
  const clock = options.clock ?? (() => new Date());

  const ensureManifest = () => ensureProjectManifest(resolvedRoot, {
    clock,
    idFactory: options.projectIdFactory,
    readerVersion: options.readerVersion,
    writerVersion: options.writerVersion,
    formats: options.formats,
  });

  const readManifest = () => readProjectManifest(resolvedRoot, {
    mode: 'read',
    readerVersion: options.readerVersion,
    writerVersion: options.writerVersion,
    formats: options.formats,
  });

  async function readRaw(optionsForRead = {}) {
    return withFileLock(`${paths.events}.lock`, () => readJsonlRecovered(paths.events, {
      repair: optionsForRead.repairTail === true,
    }), { ...options, clock });
  }

  async function readAll(optionsForRead = {}) {
    await readManifest();
    const { records } = await readRaw(optionsForRead);
    for (const event of records) assertEventEnvelope(event);
    return records.filter((event) => {
      if (optionsForRead.fromPosition && event.metadata?.ledgerPosition < optionsForRead.fromPosition) return false;
      if (optionsForRead.toPosition && event.metadata?.ledgerPosition > optionsForRead.toPosition) return false;
      return true;
    });
  }

  async function readStream(streamId, optionsForRead = {}) {
    validateLogicalId(streamId, 'streamId');
    const events = (await readAll(optionsForRead)).filter((event) => event.streamId === streamId);
    for (const event of events) assertEventEnvelope(event);
    const fromRevision = optionsForRead.fromRevision ?? 1;
    const toRevision = optionsForRead.toRevision ?? Number.POSITIVE_INFINITY;
    return events.filter((event) => event.revision >= fromRevision && event.revision <= toRevision);
  }

  async function head(streamId, headOptions = {}) {
    await readManifest();
    const streamPath = streamPaths(resolvedRoot, streamId);
    if (!headOptions.authoritative) {
      const persisted = await readJsonIfExists(streamPath.head, null);
      if (persisted !== null) return persisted;
    }
    const events = await readStream(streamId);
    return deriveHeads(events).get(streamId) ?? emptyHead(streamId);
  }

  async function append(streamId, input, appendOptions = {}) {
    validateLogicalId(streamId, 'streamId');
    if (
      appendOptions.expectedRevision !== undefined
      && (!Number.isSafeInteger(appendOptions.expectedRevision) || appendOptions.expectedRevision < 0)
    ) {
      throw new TypeError('expectedRevision must be a non-negative safe integer');
    }
    const idempotencyKey = appendOptions.idempotencyKey === undefined
      ? null
      : validateLogicalId(appendOptions.idempotencyKey, 'idempotencyKey');
    const fingerprint = eventInputFingerprint(streamId, input);

    return withFileLock(paths.lock, async () => {
      const manifest = await ensureManifest();
      const { records: events } = await readRaw({ repairTail: true });
      if (idempotencyKey) {
        const existing = events.find((event) => event.metadata?.idempotencyKey === idempotencyKey);
        if (existing) {
          if (existing.metadata?.idempotencyFingerprint !== fingerprint) {
            throw new IdempotencyConflictError(idempotencyKey, existing.eventId);
          }
          return {
            event: existing,
            head: deriveHeads(events).get(existing.streamId),
            idempotent: true,
          };
        }
      }

      const currentHead = deriveHeads(events).get(streamId) ?? emptyHead(streamId);
      if (
        appendOptions.expectedRevision !== undefined
        && appendOptions.expectedRevision !== currentHead.revision
      ) {
        throw new RevisionConflictError(streamId, appendOptions.expectedRevision, currentHead.revision);
      }
      const metadata = {
        ...(input?.metadata ?? {}),
        ledgerPosition: events.length + 1,
      };
      if (idempotencyKey) {
        metadata.idempotencyKey = idempotencyKey;
        metadata.idempotencyFingerprint = fingerprint;
      }
      const event = createEventEnvelope({
        ...input,
        projectId: manifest.projectId,
        streamId,
        revision: currentHead.revision + 1,
        metadata,
      }, {
        clock,
        idFactory: options.eventIdFactory,
      });
      await appendJsonlAtomic(paths.events, event, {
        ...appendOptions,
        lockPath: `${paths.events}.lock`,
        clock,
      });
      const nextHead = deriveHeads([...events, event]).get(streamId);
      await atomicWriteJson(streamPaths(resolvedRoot, streamId).head, nextHead);
      return { event, head: nextHead, idempotent: false };
    }, { ...options, ...appendOptions, clock });
  }

  async function verifyUnlocked(verifyOptions = {}) {
    const errors = [];
    const warnings = [];
    let events;
    try {
      ({ records: events } = await readRaw({ repairTail: verifyOptions.repairTail === true }));
    } catch (error) {
      return {
        ok: false,
        errors: [{ code: error.code ?? 'LEDGER_READ_FAILED', message: error.message }],
        warnings,
        eventCount: 0,
        streams: 0,
        heads: {},
      };
    }
    let manifest = null;
    try {
      manifest = await readManifest();
    } catch (error) {
      errors.push({ code: error.code ?? 'MANIFEST_READ_FAILED', message: error.message });
    }
    const revisions = new Map();
    const eventIds = new Set();
    const idempotencyKeys = new Map();
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      const validation = validateEventEnvelope(event);
      if (!validation.ok) {
        errors.push({
          code: 'INVALID_EVENT',
          position: index + 1,
          eventId: event?.eventId ?? null,
          details: validation.errors,
        });
        continue;
      }
      if (manifest && event.projectId !== manifest.projectId) {
        errors.push({
          code: 'PROJECT_ID_MISMATCH',
          eventId: event.eventId,
          expectedProjectId: manifest.projectId,
          actualProjectId: event.projectId,
        });
      }
      const expectedRevision = (revisions.get(event.streamId) ?? 0) + 1;
      if (event.revision !== expectedRevision) {
        errors.push({
          code: 'REVISION_GAP',
          streamId: event.streamId,
          expectedRevision,
          actualRevision: event.revision,
        });
      }
      revisions.set(event.streamId, event.revision);
      if (event.metadata?.ledgerPosition !== index + 1) {
        errors.push({
          code: 'POSITION_MISMATCH',
          eventId: event.eventId,
          expectedPosition: index + 1,
          actualPosition: event.metadata?.ledgerPosition ?? null,
        });
      }
      if (eventIds.has(event.eventId)) errors.push({ code: 'DUPLICATE_EVENT_ID', eventId: event.eventId });
      eventIds.add(event.eventId);
      const idempotencyKey = event.metadata?.idempotencyKey;
      if (idempotencyKey) {
        if (idempotencyKeys.has(idempotencyKey)) {
          errors.push({
            code: 'DUPLICATE_IDEMPOTENCY_KEY',
            idempotencyKey,
            eventIds: [idempotencyKeys.get(idempotencyKey), event.eventId],
          });
        }
        idempotencyKeys.set(idempotencyKey, event.eventId);
      }
    }

    const expectedHeads = deriveHeads(events.filter((event) => validateEventEnvelope(event).ok));
    for (const [streamId, expectedHead] of expectedHeads) {
      const headPath = streamPaths(resolvedRoot, streamId).head;
      const actualHead = await readJsonIfExists(headPath, null).catch((error) => {
        errors.push({ code: 'HEAD_READ_FAILED', streamId, message: error.message });
        return null;
      });
      if (!sameHead(actualHead, expectedHead)) {
        if (verifyOptions.repairHeads) {
          await atomicWriteJson(headPath, expectedHead);
          warnings.push({ code: 'HEAD_REBUILT', streamId });
        } else {
          errors.push({ code: 'HEAD_MISMATCH', streamId, expected: expectedHead, actual: actualHead });
        }
      }
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      eventCount: events.length,
      streams: expectedHeads.size,
      heads: Object.fromEntries(Array.from(expectedHeads, ([streamId, value]) => [streamId, value.revision])),
    };
  }

  async function verify(verifyOptions = {}) {
    return withFileLock(paths.lock, () => verifyUnlocked(verifyOptions), {
      ...options,
      ...verifyOptions,
      clock,
    });
  }

  async function rebuildProjection(name, reducer, initialState, projectionOptions = {}) {
    if (typeof reducer !== 'function') throw new TypeError('projection reducer must be a function');
    const events = await readAll();
    let state = structuredClone(initialState);
    let eventsApplied = 0;
    const selectedStreams = projectionOptions.streams ? new Set(projectionOptions.streams) : null;
    for (const event of events) {
      if (selectedStreams && !selectedStreams.has(event.streamId)) continue;
      const reduced = await reducer(state, event);
      if (reduced !== undefined) state = reduced;
      eventsApplied += 1;
    }
    const selectedEvents = selectedStreams
      ? events.filter((event) => selectedStreams.has(event.streamId))
      : events;
    const streamHeads = Object.fromEntries(
      Array.from(deriveHeads(selectedEvents), ([streamId, value]) => [streamId, value.revision])
        .sort(([left], [right]) => left.localeCompare(right)),
    );
    const timestampValue = clock();
    const rebuiltAt = (timestampValue instanceof Date ? timestampValue : new Date(timestampValue)).toISOString();
    const projection = {
      schema: PROJECTION_SCHEMA,
      version: LEDGER_VERSION,
      name,
      rebuiltAt,
      eventsApplied,
      lastLedgerPosition: selectedEvents.at(-1)?.metadata?.ledgerPosition ?? 0,
      streamHeads,
      state,
    };
    if (projectionOptions.persist !== false) await atomicWriteJson(projectionPath(resolvedRoot, name), projection);
    return projection;
  }

  async function readProjection(name) {
    await readManifest();
    const filePath = projectionPath(resolvedRoot, name);
    const projection = await readJsonIfExists(filePath, null);
    if (projection === null) {
      const error = new Error(`Projection ${name} does not exist at ${filePath}`);
      error.code = 'OPEN_VIBECODING_PROJECTION_NOT_FOUND';
      throw error;
    }
    return projection;
  }

  async function listStreams() {
    return Array.from(deriveHeads(await readAll()).keys()).sort();
  }

  return {
    schema: LEDGER_SCHEMA,
    version: LEDGER_VERSION,
    projectRoot: resolvedRoot,
    paths,
    append,
    head,
    listStreams,
    pathsForStream: (streamId) => streamPaths(resolvedRoot, streamId),
    projectionPath: (name) => projectionPath(resolvedRoot, name),
    readAll,
    readProjection,
    readStream,
    rebuildProjection,
    verify,
  };
}

export {
  IdempotencyConflictError,
  LEDGER_SCHEMA,
  LEDGER_VERSION,
  PROJECTION_SCHEMA,
  RevisionConflictError,
  STREAM_HEAD_SCHEMA,
  ledgerPaths,
  openProjectLedger,
  projectionPath,
  streamPaths,
};
