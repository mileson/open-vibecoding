import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFleetWorkspace } from '../src/fleet.js';
import {
  inspectFleetUpgradeSafety,
} from '../src/upgrade/fleet-transaction.js';

async function pathExists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

async function makeFleetRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    openprdHome: path.join(root, '.isolated-openprd-home'),
  };
}

async function writeInstallManifest(projectRoot, version = '0.1.0') {
  const manifestPath = path.join(projectRoot, '.openprd', 'harness', 'install-manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify({
    version: 1,
    openprdVersion: version,
    generatedAt: '2026-07-10T00:00:00.000Z',
    tools: [],
    hooks: { profile: 'lite' },
    managedFiles: [],
  }, null, 2)}\n`);
  return manifestPath;
}

function successfulDependencies(options = {}) {
  return {
    updateAgentIntegrationWorkspace: async (projectRoot) => {
      options.onUpdate?.(projectRoot);
      const targetVersion = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
      await writeInstallManifest(projectRoot, targetVersion);
      const generatedPath = path.join(projectRoot, '.openprd', 'harness', 'transaction-generated.txt');
      await fs.writeFile(generatedPath, 'generated in staging\n');
      return {
        ok: true,
        changes: [{ path: '.openprd/harness/transaction-generated.txt', status: 'created' }],
        migration: { ok: true, changes: [{ path: '.openprd', status: 'updated' }] },
        doctor: { ok: true, errors: [] },
      };
    },
    backfillWorkUnitsWorkspace: async () => ({
      ok: true,
      totalVersions: 2,
      changedVersions: 1,
      changes: [{ path: '.openprd/state/versions/v0001.json', status: 'backfilled' }],
      errors: [],
    }),
    doctorWorkspace: async () => ({ ok: true, errors: [] }),
    setupAgentIntegrationWorkspace: async () => ({ ok: true, changes: [], doctor: { errors: [] } }),
    beforeFleetApply: options.beforeFleetApply,
  };
}

test('fleet scanner treats nested legacy openprd/changes as migration input, not another project', async () => {
  const { root, openprdHome } = await makeFleetRoot('openprd-fleet-nested-legacy-');
  const project = path.join(root, 'real-project');
  await fs.mkdir(path.join(project, '.openprd'), { recursive: true });
  await fs.mkdir(path.join(project, 'openprd', 'changes', 'embedded-change'), { recursive: true });
  await fs.writeFile(path.join(project, 'openprd', 'changes', 'embedded-change', 'package.json'), '{"name":"not-a-project"}\n');

  const fleetWorkspace = createFleetWorkspace(successfulDependencies());
  const result = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 6,
    openprdHome,
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.openprd, 1);
  assert.deepEqual(result.projects.map((item) => item.relativePath), ['real-project']);
  assert.match(result.projects[0].checksum.before, /^[a-f0-9]{64}$/);
  assert.equal(result.projects[0].backup.status, 'planned');
  assert.equal(await pathExists(result.upgrade.backupRoot), false);
});

test('fleet update stages changes, verifies backup checksum, and atomically applies a successful project', async () => {
  const { root, openprdHome } = await makeFleetRoot('openprd-fleet-transaction-success-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  await fs.mkdir(path.join(project, '.openprd', 'state'), { recursive: true });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'original.txt'), 'before\n');
  await fs.writeFile(path.join(project, 'README.md'), '# untouched\n');
  const reportPath = path.join(root, 'fleet-report.json');

  const fleetWorkspace = createFleetWorkspace(successfulDependencies());
  const result = await fleetWorkspace(root, {
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
    report: reportPath,
  });
  const item = result.projects.find((entry) => entry.relativePath === 'project');

  assert.equal(result.ok, true);
  assert.equal(item.status, 'updated');
  assert.equal(item.backup.status, 'verified');
  assert.equal(await pathExists(item.backup.manifestPath), true);
  assert.equal(item.backup.checksum, item.checksum.before);
  assert.match(item.checksum.after, /^[a-f0-9]{64}$/);
  assert.notEqual(item.checksum.after, item.checksum.before);
  assert.equal(item.checksum.staged, item.checksum.after);
  assert.equal(item.version.after, result.upgrade.targetVersion);
  assert.equal(item.rollback.attempted, false);
  assert.equal(item.backup.stagingStatus, 'removed-after-apply');
  assert.equal(await pathExists(path.join(item.backup.path, 'staging')), false);
  assert.equal(await fs.readFile(path.join(project, '.openprd', 'harness', 'transaction-generated.txt'), 'utf8'), 'generated in staging\n');
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), '# untouched\n');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.projects[0].backup.path, item.backup.path);
  assert.equal(report.projects[0].migration.workUnits.changedVersions, 1);

  const secondDryRun = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 6,
    openprdHome,
  });
  assert.deepEqual(secondDryRun.projects.map((entry) => entry.relativePath), ['project']);
});

test('fleet update automatically restores the preimage when staged mutation fails', async () => {
  const { root, openprdHome } = await makeFleetRoot('openprd-fleet-transaction-failure-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const originalPath = path.join(project, '.openprd', 'state', 'original.txt');
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await fs.writeFile(originalPath, 'before\n');
  const dependencies = successfulDependencies();
  dependencies.updateAgentIntegrationWorkspace = async (stagingRoot) => {
    await fs.writeFile(path.join(stagingRoot, '.openprd', 'state', 'original.txt'), 'broken staged value\n');
    await fs.writeFile(path.join(stagingRoot, '.openprd', 'state', 'should-not-land.txt'), 'no\n');
    return { ok: false, errors: ['forced staged failure'] };
  };

  const result = await createFleetWorkspace(dependencies)(root, {
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  const item = result.projects.find((entry) => entry.relativePath === 'project');

  assert.equal(result.ok, false);
  assert.equal(item.status, 'failed');
  assert.equal(item.rollback.attempted, true);
  assert.equal(item.rollback.ok, true);
  assert.equal(item.rollback.checksum, item.checksum.before);
  assert.equal(await fs.readFile(originalPath, 'utf8'), 'before\n');
  assert.equal(await pathExists(path.join(project, '.openprd', 'state', 'should-not-land.txt')), false);
  assert.ok(item.errors.some((error) => error.includes('forced staged failure')));
});

test('fleet update rolls back when checksum CAS detects a project change before apply', async () => {
  const { root, openprdHome } = await makeFleetRoot('openprd-fleet-transaction-cas-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const originalPath = path.join(project, '.openprd', 'state', 'original.txt');
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await fs.writeFile(originalPath, 'before\n');
  const dependencies = successfulDependencies({
    beforeFleetApply: async () => {
      await fs.writeFile(originalPath, 'concurrent change\n');
    },
  });

  const result = await createFleetWorkspace(dependencies)(root, {
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  const item = result.projects.find((entry) => entry.relativePath === 'project');

  assert.equal(result.ok, false);
  assert.equal(item.rollback.attempted, true);
  assert.equal(item.rollback.ok, true);
  assert.ok(item.errors.some((error) => error.includes('Project changed before atomic apply')));
  assert.equal(await fs.readFile(originalPath, 'utf8'), 'before\n');
});

test('fleet ignores symlinks outside OpenPrd-managed artifacts and nested repositories named openprd', async () => {
  const { root, openprdHome } = await makeFleetRoot('openprd-fleet-unmanaged-symlink-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');

  const externalDirectory = path.join(root, 'external-directory');
  const externalFile = path.join(root, 'external-file.md');
  await fs.mkdir(externalDirectory, { recursive: true });
  await fs.writeFile(externalFile, '# external\n');
  await fs.mkdir(path.join(project, '.codex', 'tmp', 'upstream'), { recursive: true });
  await fs.symlink(externalDirectory, path.join(project, '.codex', 'tmp', 'upstream', 'skills'), 'dir');
  await fs.symlink(externalFile, path.join(project, '.codex', 'tmp', 'upstream', 'CLAUDE.md'), 'file');
  await fs.mkdir(path.join(project, 'openprd', 'node_modules', '.bin'), { recursive: true });
  await fs.writeFile(path.join(project, 'openprd', 'package.json'), '{"name":"nested-openprd-repository"}\n');
  await fs.symlink(externalFile, path.join(project, 'openprd', 'node_modules', '.bin', 'semver'), 'file');

  const result = await createFleetWorkspace(successfulDependencies())(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 1,
    openprdHome,
  });

  assert.equal(result.ok, true);
  const item = result.projects.find((entry) => entry.relativePath === 'project');
  assert.equal(item.status, 'planned');
  assert.equal(item.refusal.length, 0);
  assert.match(item.checksum.before, /^[a-f0-9]{64}$/);
});

test('fleet refuses archives, unknown classifications, symlinked managed paths, and too-new schemas', async () => {
  const { root, openprdHome } = await makeFleetRoot('openprd-fleet-refusal-');
  const archiveProject = path.join(root, 'codex-archive-2026-06-28', 'project');
  await writeInstallManifest(archiveProject, '0.1.0');
  const symlinkProject = path.join(root, 'symlink-project');
  await writeInstallManifest(symlinkProject, '0.1.0');
  const externalSkills = path.join(root, 'external-skills');
  await fs.mkdir(externalSkills, { recursive: true });
  await fs.mkdir(path.join(symlinkProject, '.codex'), { recursive: true });
  await fs.symlink(externalSkills, path.join(symlinkProject, '.codex', 'skills'), 'dir');
  const tooNewProject = path.join(root, 'too-new-project');
  await writeInstallManifest(tooNewProject, '0.1.0');
  await fs.writeFile(path.join(tooNewProject, '.openprd', 'manifest.json'), `${JSON.stringify({
    schema: 'openprd.project-manifest',
    schemaVersion: 99,
    projectId: 'too-new',
    createdAt: '2026-07-10T00:00:00.000Z',
    compatibility: { minimumReaderVersion: 1, minimumWriterVersion: 1 },
    formats: { eventEnvelope: 1, ledger: 1, projection: 1 },
  }, null, 2)}\n`);
  let updateCalls = 0;
  const dependencies = successfulDependencies({ onUpdate: () => { updateCalls += 1; } });

  const result = await createFleetWorkspace(dependencies)(root, {
    updateOpenprd: true,
    maxDepth: 3,
    openprdHome,
  });

  assert.equal(result.ok, false);
  assert.equal(updateCalls, 0);
  assert.ok(result.projects.find((item) => item.relativePath === 'codex-archive-2026-06-28/project').refusal.some((item) => item.code === 'archive-project'));
  assert.ok(result.projects.find((item) => item.relativePath === 'symlink-project').refusal.some((item) => item.code === 'symlink-managed-path'));
  assert.ok(result.projects.find((item) => item.relativePath === 'too-new-project').refusal.some((item) => item.code === 'OPENPRD_MANIFEST_TOO_NEW'));

  const unknown = await inspectFleetUpgradeSafety({
    path: tooNewProject,
    category: 'unknown-project',
    plannedAction: 'update',
  }, { targetVersion: '99.0.0' });
  assert.ok(unknown.refusals.some((item) => item.code === 'classification-unknown'));
});
