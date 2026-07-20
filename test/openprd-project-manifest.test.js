import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CURRENT_COMPATIBILITY,
  ManifestCompatibilityError,
  ensureProjectManifest,
  projectManifestPath,
  readProjectManifest,
  validateProjectManifest,
} from '../src/kernel/project-manifest.js';

async function makeProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'openprd-manifest-'));
}

test('ensureProjectManifest creates an idempotent compatible manifest', async () => {
  const project = await makeProject();
  const options = {
    clock: () => new Date('2026-07-10T12:00:00.000Z'),
    idFactory: () => 'project-fixture',
  };

  const first = await ensureProjectManifest(project, options);
  const second = await ensureProjectManifest(project, {
    clock: () => new Date('2027-01-01T00:00:00.000Z'),
    idFactory: () => 'must-not-replace-existing-id',
  });

  assert.deepEqual(second, first);
  assert.equal(first.projectId, 'project-fixture');
  assert.deepEqual(first.compatibility, CURRENT_COMPATIBILITY);
  assert.deepEqual(validateProjectManifest(first), { ok: true, errors: [] });
  assert.deepEqual(await readProjectManifest(project), first);
  assert.equal(JSON.parse(await fs.readFile(projectManifestPath(project), 'utf8')).projectId, 'project-fixture');
});

test('manifest compatibility rejects data requiring a newer reader or writer', async () => {
  const project = await makeProject();
  const manifest = await ensureProjectManifest(project, {
    clock: () => new Date('2026-07-10T12:00:00.000Z'),
    idFactory: () => 'project-fixture',
  });

  await fs.writeFile(projectManifestPath(project), `${JSON.stringify({
    ...manifest,
    compatibility: { ...manifest.compatibility, minimumReaderVersion: 2 },
  }, null, 2)}\n`);
  await assert.rejects(
    readProjectManifest(project, { mode: 'read' }),
    (error) => error instanceof ManifestCompatibilityError && error.code === 'OPENPRD_READER_TOO_OLD',
  );

  await fs.writeFile(projectManifestPath(project), `${JSON.stringify({
    ...manifest,
    compatibility: { ...manifest.compatibility, minimumWriterVersion: 2 },
  }, null, 2)}\n`);
  await assert.rejects(
    readProjectManifest(project, { mode: 'write' }),
    (error) => error instanceof ManifestCompatibilityError && error.code === 'OPENPRD_WRITER_TOO_OLD',
  );
});

test('manifest validation is structural and side-effect free', () => {
  const result = validateProjectManifest({
    schema: 'other',
    schemaVersion: 0,
    projectId: '',
    createdAt: 'yesterday',
    compatibility: {},
    formats: { eventEnvelope: 0 },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.path === 'schema'));
  assert.ok(result.errors.some((item) => item.path === 'compatibility.minimumReaderVersion'));
  assert.ok(result.errors.some((item) => item.path === 'formats.ledger'));
});

test('manifest keeps N-1 core-only readers compatible while rejecting too-new optional formats', async () => {
  const project = await makeProject();
  const manifest = await ensureProjectManifest(project, {
    clock: () => new Date('2026-07-10T12:00:00.000Z'),
    idFactory: () => 'project-fixture',
  });
  const legacy = {
    ...manifest,
    formats: { eventEnvelope: 1, ledger: 1, projection: 1 },
  };
  await fs.writeFile(projectManifestPath(project), `${JSON.stringify(legacy, null, 2)}\n`);
  assert.deepEqual(await readProjectManifest(project), legacy);

  await fs.writeFile(projectManifestPath(project), `${JSON.stringify({
    ...manifest,
    formats: { ...manifest.formats, knowledge: 4 },
  }, null, 2)}\n`);
  await assert.rejects(
    readProjectManifest(project),
    (error) => error instanceof ManifestCompatibilityError && error.code === 'OPENPRD_FORMAT_TOO_NEW',
  );
});

test('ensureProjectManifest removes the retired context capsule format from old projects', async () => {
  const project = await makeProject();
  const manifest = await ensureProjectManifest(project, {
    clock: () => new Date('2026-07-10T12:00:00.000Z'),
    idFactory: () => 'project-fixture',
  });
  await fs.writeFile(projectManifestPath(project), `${JSON.stringify({
    ...manifest,
    formats: { ...manifest.formats, contextCapsule: 1 },
  }, null, 2)}\n`);

  const migrated = await ensureProjectManifest(project);
  assert.equal(Object.hasOwn(migrated.formats, 'contextCapsule'), false);
  assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(projectManifestPath(project), 'utf8')).formats, 'contextCapsule'), false);
});
