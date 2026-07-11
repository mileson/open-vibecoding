import { randomUUID } from 'node:crypto';
import path from 'node:path';

import {
  atomicWriteJson,
  readJsonIfExists,
  withFileLock,
} from './atomic-store.js';

const PROJECT_MANIFEST_SCHEMA = 'openprd.project-manifest';
const PROJECT_MANIFEST_VERSION = 1;
const CURRENT_READER_VERSION = 1;
const CURRENT_WRITER_VERSION = 1;
const CURRENT_COMPATIBILITY = Object.freeze({
  minimumReaderVersion: 1,
  minimumWriterVersion: 1,
});
const REQUIRED_FORMATS = Object.freeze(['eventEnvelope', 'ledger', 'projection']);
const CURRENT_FORMATS = Object.freeze({
  eventEnvelope: 1,
  ledger: 1,
  projection: 1,
  contextCapsule: 1,
  taskRuntime: 1,
  scopedGate: 1,
  reviewModel: 1,
  knowledge: 3,
  adapter: 1,
});

class ProjectManifestValidationError extends Error {
  constructor(errors) {
    super(`Invalid OpenPrd project manifest: ${errors.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    this.name = 'ProjectManifestValidationError';
    this.code = 'OPENPRD_INVALID_PROJECT_MANIFEST';
    this.errors = errors;
  }
}

class ManifestCompatibilityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ManifestCompatibilityError';
    this.code = code;
    Object.assign(this, details);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveVersion(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function projectManifestPath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.openprd', 'manifest.json');
}

function validateProjectManifest(manifest) {
  const errors = [];
  const add = (pathName, message) => errors.push({ path: pathName, message });
  if (!isPlainObject(manifest)) {
    add('$', 'must be a plain object');
    return { ok: false, errors };
  }
  if (manifest.schema !== PROJECT_MANIFEST_SCHEMA) add('schema', `must equal ${PROJECT_MANIFEST_SCHEMA}`);
  if (!positiveVersion(manifest.schemaVersion)) add('schemaVersion', 'must be a positive integer');
  if (typeof manifest.projectId !== 'string' || !manifest.projectId.trim()) add('projectId', 'must be a non-empty string');
  if (typeof manifest.createdAt !== 'string' || Number.isNaN(Date.parse(manifest.createdAt))) {
    add('createdAt', 'must be an ISO-compatible timestamp');
  }
  if (!isPlainObject(manifest.compatibility)) {
    add('compatibility', 'must be a plain object');
  }
  for (const field of ['minimumReaderVersion', 'minimumWriterVersion']) {
    if (!positiveVersion(manifest.compatibility?.[field])) add(`compatibility.${field}`, 'must be a positive integer');
  }
  if (!isPlainObject(manifest.formats)) add('formats', 'must be a plain object');
  for (const field of REQUIRED_FORMATS) {
    if (!positiveVersion(manifest.formats?.[field])) add(`formats.${field}`, 'must be a positive integer');
  }
  return { ok: errors.length === 0, errors };
}

function assertValidProjectManifest(manifest) {
  const validation = validateProjectManifest(manifest);
  if (!validation.ok) throw new ProjectManifestValidationError(validation.errors);
  return manifest;
}

function assertProjectManifestCompatible(manifest, options = {}) {
  assertValidProjectManifest(manifest);
  const mode = options.mode ?? 'read';
  const readerVersion = options.readerVersion ?? CURRENT_READER_VERSION;
  const writerVersion = options.writerVersion ?? CURRENT_WRITER_VERSION;
  const supportedManifestVersion = options.manifestVersion ?? PROJECT_MANIFEST_VERSION;
  const supportedFormats = options.formats ?? CURRENT_FORMATS;

  if (manifest.schemaVersion > supportedManifestVersion) {
    throw new ManifestCompatibilityError(
      'OPENPRD_MANIFEST_TOO_NEW',
      `Manifest schema ${manifest.schemaVersion} requires a newer OpenPrd reader`,
      { requiredVersion: manifest.schemaVersion, supportedVersion: supportedManifestVersion },
    );
  }
  if (manifest.compatibility.minimumReaderVersion > readerVersion) {
    throw new ManifestCompatibilityError(
      'OPENPRD_READER_TOO_OLD',
      `Project requires reader ${manifest.compatibility.minimumReaderVersion}, current reader is ${readerVersion}`,
      { requiredVersion: manifest.compatibility.minimumReaderVersion, supportedVersion: readerVersion },
    );
  }
  if (mode === 'write' && manifest.compatibility.minimumWriterVersion > writerVersion) {
    throw new ManifestCompatibilityError(
      'OPENPRD_WRITER_TOO_OLD',
      `Project requires writer ${manifest.compatibility.minimumWriterVersion}, current writer is ${writerVersion}`,
      { requiredVersion: manifest.compatibility.minimumWriterVersion, supportedVersion: writerVersion },
    );
  }
  for (const [format, requiredVersion] of Object.entries(manifest.formats)) {
    const supportedVersion = supportedFormats[format];
    if (!positiveVersion(supportedVersion) || requiredVersion > supportedVersion) {
      throw new ManifestCompatibilityError(
        'OPENPRD_FORMAT_TOO_NEW',
        `Project format ${format}@${requiredVersion} is newer than supported ${supportedVersion ?? 0}`,
        { format, requiredVersion, supportedVersion: supportedVersion ?? 0 },
      );
    }
  }
  return manifest;
}

function normalizeCreatedAt(clock) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Project manifest clock must return a valid date');
  return date.toISOString();
}

function createProjectManifest(options = {}) {
  const clock = options.clock ?? (() => new Date());
  const idFactory = options.idFactory ?? (() => `project_${randomUUID()}`);
  const manifest = {
    schema: PROJECT_MANIFEST_SCHEMA,
    schemaVersion: PROJECT_MANIFEST_VERSION,
    projectId: options.projectId ?? idFactory(),
    createdAt: normalizeCreatedAt(clock),
    compatibility: {
      ...CURRENT_COMPATIBILITY,
      ...(options.compatibility ?? {}),
    },
    formats: {
      ...CURRENT_FORMATS,
      ...(options.formats ?? {}),
    },
  };
  return assertValidProjectManifest(manifest);
}

async function readProjectManifest(projectRoot, options = {}) {
  const manifestPath = projectManifestPath(projectRoot);
  const manifest = await readJsonIfExists(manifestPath, null);
  if (manifest === null) {
    const error = new Error(`OpenPrd project manifest does not exist at ${manifestPath}`);
    error.code = 'OPENPRD_MANIFEST_NOT_FOUND';
    throw error;
  }
  return assertProjectManifestCompatible(manifest, options);
}

async function ensureProjectManifest(projectRoot, options = {}) {
  const manifestPath = projectManifestPath(projectRoot);
  const lockPath = `${manifestPath}.lock`;
  return withFileLock(lockPath, async () => {
    const existing = await readJsonIfExists(manifestPath, null);
    if (existing !== null) return assertProjectManifestCompatible(existing, { ...options, mode: 'write' });
    const manifest = createProjectManifest(options);
    assertProjectManifestCompatible(manifest, { ...options, mode: 'write' });
    await atomicWriteJson(manifestPath, manifest);
    return manifest;
  }, options);
}

export {
  CURRENT_COMPATIBILITY,
  CURRENT_FORMATS,
  CURRENT_READER_VERSION,
  CURRENT_WRITER_VERSION,
  REQUIRED_FORMATS,
  ManifestCompatibilityError,
  PROJECT_MANIFEST_SCHEMA,
  PROJECT_MANIFEST_VERSION,
  ProjectManifestValidationError,
  assertProjectManifestCompatible,
  assertValidProjectManifest,
  createProjectManifest,
  ensureProjectManifest,
  projectManifestPath,
  readProjectManifest,
  validateProjectManifest,
};
