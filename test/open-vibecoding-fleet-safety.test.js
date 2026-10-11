import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFleetWorkspace } from '../src/fleet.js';
import {
  createFleetTransactionContext,
  executeFleetProjectTransaction,
  inspectFleetUpgradeSafety,
  planFleetProjectTransaction,
} from '../src/upgrade/fleet-transaction.js';

async function pathExists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

async function makeFleetRoot(prefix) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    root,
    openprdHome: path.join(root, '.isolated-open-vibecoding-home'),
  };
}

async function writeInstallManifest(projectRoot, version = '0.1.0') {
  const manifestPath = path.join(projectRoot, '.open-vibecoding', 'harness', 'install-manifest.json');
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
      const generatedPath = path.join(projectRoot, '.open-vibecoding', 'harness', 'transaction-generated.txt');
      await fs.writeFile(generatedPath, 'generated in staging\n');
      return {
        ok: true,
        changes: [{ path: '.open-vibecoding/harness/transaction-generated.txt', status: 'created' }],
        migration: { ok: true, changes: [{ path: '.open-vibecoding', status: 'updated' }] },
        doctor: { ok: true, errors: [] },
      };
    },
    backfillWorkUnitsWorkspace: async () => ({
      ok: true,
      totalVersions: 2,
      changedVersions: 1,
      changes: [{ path: '.open-vibecoding/state/versions/v0001.json', status: 'backfilled' }],
      errors: [],
    }),
    doctorWorkspace: async () => ({ ok: true, errors: [] }),
    setupAgentIntegrationWorkspace: async () => ({ ok: true, changes: [], doctor: { errors: [] } }),
    beforeFleetApply: options.beforeFleetApply,
  };
}

test('fleet scanner treats nested legacy open-vibecoding/changes as migration input, not another project', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-nested-legacy-');
  const project = path.join(root, 'real-project');
  await fs.mkdir(path.join(project, '.open-vibecoding'), { recursive: true });
  await fs.mkdir(path.join(project, 'open-vibecoding', 'changes', 'embedded-change'), { recursive: true });
  await fs.writeFile(path.join(project, 'open-vibecoding', 'changes', 'embedded-change', 'package.json'), '{"name":"not-a-project"}\n');

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
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-transaction-success-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  await fs.mkdir(path.join(project, '.open-vibecoding', 'state'), { recursive: true });
  await fs.writeFile(path.join(project, '.open-vibecoding', 'state', 'original.txt'), 'before\n');
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
  assert.equal(await fs.readFile(path.join(project, '.open-vibecoding', 'harness', 'transaction-generated.txt'), 'utf8'), 'generated in staging\n');
  assert.equal(await fs.readFile(path.join(project, 'README.md'), 'utf8'), '# untouched\n');
  const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  assert.equal(report.projects[0].backup.path, item.backup.path);
  assert.equal(report.projects[0].migration.workUnits, undefined);
  const backupManifest = JSON.parse(await fs.readFile(item.backup.manifestPath, 'utf8'));
  assert.ok(backupManifest.scopePolicy.managedRoots.includes('.open-vibecoding'));
  assert.deepEqual(backupManifest.scopePolicy.preservedRoots, ['.open-vibecoding/.derived-data', '.open-vibecoding/artifacts', '.open-vibecoding/quality/reports', '.open-vibecoding/tmp']);
  assert.deepEqual(backupManifest.scopePolicy.preservedPatterns, ['.open-vibecoding/harness/DerivedData-*']);

  const secondDryRun = await fleetWorkspace(root, {
    updateOpenprd: true,
    dryRun: true,
    maxDepth: 6,
    openprdHome,
  });
  assert.deepEqual(secondDryRun.projects.map((entry) => entry.relativePath), ['project']);
});

test('fleet update automatically restores the preimage when staged mutation fails', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-transaction-failure-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const originalPath = path.join(project, '.open-vibecoding', 'state', 'original.txt');
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await fs.writeFile(originalPath, 'before\n');
  const dependencies = successfulDependencies();
  dependencies.updateAgentIntegrationWorkspace = async (stagingRoot) => {
    await fs.writeFile(path.join(stagingRoot, '.open-vibecoding', 'state', 'original.txt'), 'broken staged value\n');
    await fs.writeFile(path.join(stagingRoot, '.open-vibecoding', 'state', 'should-not-land.txt'), 'no\n');
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
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'state', 'should-not-land.txt')), false);
  assert.ok(item.errors.some((error) => error.includes('forced staged failure')));
});

test('fleet update rolls back when checksum CAS detects a project change before apply', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-transaction-cas-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const originalPath = path.join(project, '.open-vibecoding', 'state', 'original.txt');
  await fs.mkdir(path.dirname(originalPath), { recursive: true });
  await fs.writeFile(originalPath, 'before\n');
  const preservedPath = path.join(project, '.open-vibecoding', '.derived-data', 'cache.txt');
  await fs.mkdir(path.dirname(preservedPath), { recursive: true });
  await fs.writeFile(preservedPath, 'cache before\n');
  const dependencies = successfulDependencies({
    beforeFleetApply: async () => {
      await fs.writeFile(preservedPath, 'cache concurrent change\n');
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
  assert.equal(await fs.readFile(preservedPath, 'utf8'), 'cache concurrent change\n');
});

test('fleet preserves cache and artifact symlinks across planning and update without backing them up', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-preserved-scopes-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const externalFile = path.join(root, 'external-cache.txt');
  const externalDirectory = path.join(root, 'external-artifacts');
  await fs.writeFile(externalFile, 'external cache\n');
  await fs.mkdir(externalDirectory, { recursive: true });
  await fs.writeFile(path.join(externalDirectory, 'render.txt'), 'external artifact\n');
  const cacheLink = path.join(project, '.open-vibecoding', '.derived-data', 'cache-link');
  const artifactLink = path.join(project, '.open-vibecoding', 'artifacts', 'artifact-link');
  const harnessDerivedLink = path.join(project, '.open-vibecoding', 'harness', 'DerivedData-Legacy', 'cache-link');
  const tmpDerivedLink = path.join(project, '.open-vibecoding', 'tmp', 'derived-data', 'cache-link');
  const legacyQualityReport = path.join(project, '.open-vibecoding', 'quality', 'reports', 'eval-legacy.html');
  await fs.mkdir(path.dirname(cacheLink), { recursive: true });
  await fs.mkdir(path.dirname(artifactLink), { recursive: true });
  await fs.mkdir(path.dirname(harnessDerivedLink), { recursive: true });
  await fs.mkdir(path.dirname(tmpDerivedLink), { recursive: true });
  await fs.mkdir(path.dirname(legacyQualityReport), { recursive: true });
  await fs.symlink(externalFile, cacheLink, 'file');
  await fs.symlink(externalDirectory, artifactLink, 'dir');
  await fs.symlink(externalFile, harnessDerivedLink, 'file');
  await fs.symlink(externalFile, tmpDerivedLink, 'file');
  await fs.writeFile(legacyQualityReport, '<html>legacy report</html>\n');

  const context = await createFleetTransactionContext({
    backupRoot: path.join(root, 'backups'),
    openprdHome,
  });
  const projectInput = {
    path: project,
    relativePath: 'project',
    category: 'open-vibecoding-workspace',
    plannedAction: 'update',
  };
  const dryRunPlan = await planFleetProjectTransaction(projectInput, context, { dryRun: true });
  assert.equal(dryRunPlan.eligible, true);
  assert.ok(dryRunPlan.scopePolicy.managedRoots.includes('.open-vibecoding'));
  assert.deepEqual(dryRunPlan.scopePolicy.preservedRoots, [
    '.open-vibecoding/.derived-data',
    '.open-vibecoding/artifacts',
    '.open-vibecoding/quality/reports',
    '.open-vibecoding/tmp',
    '.open-vibecoding/harness/DerivedData-Legacy',
  ]);
  assert.deepEqual(dryRunPlan.scopePolicy.preservedPatterns, ['.open-vibecoding/harness/DerivedData-*']);
  assert.equal(dryRunPlan.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/.derived-data')), false);
  assert.equal(dryRunPlan.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/artifacts')), false);
  assert.equal(dryRunPlan.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/quality/reports')), false);
  assert.equal(dryRunPlan.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/tmp')), false);
  assert.equal(dryRunPlan.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/harness/DerivedData-Legacy')), false);

  const plan = await planFleetProjectTransaction(projectInput, context);
  const result = await executeFleetProjectTransaction(plan, {
    openprdHome,
    mutate: async (stagingRoot) => {
      await fs.writeFile(path.join(stagingRoot, '.open-vibecoding', 'harness', 'transaction-generated.txt'), 'generated\n');
      await fs.mkdir(path.join(stagingRoot, '.open-vibecoding', 'artifacts', 'empty', 'skeleton'), { recursive: true });
      return { ok: true };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(await fs.readlink(cacheLink), externalFile);
  assert.equal(await fs.readlink(artifactLink), externalDirectory);
  assert.equal(await fs.readlink(harnessDerivedLink), externalFile);
  assert.equal(await fs.readlink(tmpDerivedLink), externalFile);
  assert.equal(await fs.readFile(legacyQualityReport, 'utf8'), '<html>legacy report</html>\n');
  assert.equal(await pathExists(path.join(plan.backup.path, 'preimage', '.open-vibecoding', '.derived-data')), false);
  assert.equal(await pathExists(path.join(plan.backup.path, 'preimage', '.open-vibecoding', 'artifacts')), false);
  assert.equal(await pathExists(path.join(plan.backup.path, 'preimage', '.open-vibecoding', 'quality', 'reports')), false);
  assert.equal(await pathExists(path.join(plan.backup.path, 'preimage', '.open-vibecoding', 'tmp')), false);
  assert.equal(await pathExists(path.join(plan.backup.path, 'preimage', '.open-vibecoding', 'harness', 'DerivedData-Legacy')), false);
  const manifest = JSON.parse(await fs.readFile(plan.backup.manifestPath, 'utf8'));
  assert.deepEqual(manifest.scopePolicy, plan.scopePolicy);
  assert.equal(manifest.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/.derived-data')), false);
  assert.equal(manifest.preimage.entries.some((entry) => entry.path.startsWith('.open-vibecoding/artifacts')), false);
});

test('fleet CAS ignores concurrent preserved cache changes', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-preserved-cas-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const preservedPath = path.join(project, '.open-vibecoding', '.derived-data', 'cache.txt');
  await fs.mkdir(path.dirname(preservedPath), { recursive: true });
  await fs.writeFile(preservedPath, 'before\n');
  const dependencies = successfulDependencies({
    beforeFleetApply: async () => {
      await fs.writeFile(preservedPath, 'concurrent cache change\n');
    },
  });

  const result = await createFleetWorkspace(dependencies)(root, {
    updateOpenprd: true,
    maxDepth: 2,
    openprdHome,
  });
  const item = result.projects.find((entry) => entry.relativePath === 'project');

  assert.equal(result.ok, true);
  assert.equal(item.status, 'updated');
  assert.equal(item.rollback.attempted, false);
  assert.equal(await fs.readFile(preservedPath, 'utf8'), 'concurrent cache change\n');
});

test('fleet rejects staged files in preserved scopes with a dedicated error code', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-preserved-mutation-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');
  const context = await createFleetTransactionContext({
    backupRoot: path.join(root, 'backups'),
    openprdHome,
  });
  const plan = await planFleetProjectTransaction({
    path: project,
    relativePath: 'project',
    category: 'open-vibecoding-workspace',
    plannedAction: 'update',
  }, context);

  const result = await executeFleetProjectTransaction(plan, {
    openprdHome,
    mutate: async (stagingRoot) => {
      const forbiddenPath = path.join(stagingRoot, '.open-vibecoding', 'harness', 'DerivedData-Generated', 'unexpected.txt');
      await fs.mkdir(path.dirname(forbiddenPath), { recursive: true });
      await fs.writeFile(forbiddenPath, 'must not apply\n');
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'OPEN_VIBECODING_FLEET_PRESERVED_SCOPE_MUTATION');
  assert.equal(result.plan.rollback.attempted, true);
  assert.equal(result.plan.rollback.ok, true);
  assert.equal(await pathExists(path.join(project, '.open-vibecoding', 'harness', 'DerivedData-Generated', 'unexpected.txt')), false);
});

test('fleet ignores symlinks outside Open VibeCoding-managed artifacts and nested repositories named openprd', async () => {
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-unmanaged-symlink-');
  const project = path.join(root, 'project');
  await writeInstallManifest(project, '0.1.0');

  const externalDirectory = path.join(root, 'external-directory');
  const externalFile = path.join(root, 'external-file.md');
  await fs.mkdir(externalDirectory, { recursive: true });
  await fs.writeFile(externalFile, '# external\n');
  await fs.mkdir(path.join(project, '.codex', 'tmp', 'upstream'), { recursive: true });
  await fs.symlink(externalDirectory, path.join(project, '.codex', 'tmp', 'upstream', 'skills'), 'dir');
  await fs.symlink(externalFile, path.join(project, '.codex', 'tmp', 'upstream', 'CLAUDE.md'), 'file');
  await fs.mkdir(path.join(project, 'open-vibecoding', 'node_modules', '.bin'), { recursive: true });
  await fs.writeFile(path.join(project, 'open-vibecoding', 'package.json'), '{"name":"nested-open-vibecoding-repository"}\n');
  await fs.symlink(externalFile, path.join(project, 'open-vibecoding', 'node_modules', '.bin', 'semver'), 'file');

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
  const { root, openprdHome } = await makeFleetRoot('open-vibecoding-fleet-refusal-');
  const archiveProject = path.join(root, 'codex-archive-2026-06-28', 'project');
  await writeInstallManifest(archiveProject, '0.1.0');
  const symlinkProject = path.join(root, 'symlink-project');
  await writeInstallManifest(symlinkProject, '0.1.0');
  const externalSkills = path.join(root, 'external-skills');
  await fs.mkdir(externalSkills, { recursive: true });
  await fs.mkdir(path.join(symlinkProject, '.codex'), { recursive: true });
  await fs.symlink(externalSkills, path.join(symlinkProject, '.codex', 'skills'), 'dir');
  const harnessSymlinkProject = path.join(root, 'harness-symlink-project');
  await writeInstallManifest(harnessSymlinkProject, '0.1.0');
  await fs.symlink(externalSkills, path.join(harnessSymlinkProject, '.open-vibecoding', 'harness', 'linked-tools'), 'dir');
  const stateSymlinkProject = path.join(root, 'state-symlink-project');
  await writeInstallManifest(stateSymlinkProject, '0.1.0');
  await fs.mkdir(path.join(stateSymlinkProject, '.open-vibecoding', 'state'), { recursive: true });
  await fs.symlink(externalSkills, path.join(stateSymlinkProject, '.open-vibecoding', 'state', 'linked-state'), 'dir');
  const tooNewProject = path.join(root, 'too-new-project');
  await writeInstallManifest(tooNewProject, '0.1.0');
  await fs.writeFile(path.join(tooNewProject, '.open-vibecoding', 'manifest.json'), `${JSON.stringify({
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
  assert.ok(result.projects.find((item) => item.relativePath === 'harness-symlink-project').refusal.some((item) => item.code === 'symlink-managed-path'));
  assert.ok(result.projects.find((item) => item.relativePath === 'state-symlink-project').refusal.some((item) => item.code === 'symlink-managed-path'));
  assert.ok(result.projects.find((item) => item.relativePath === 'too-new-project').refusal.some((item) => item.code === 'OPEN_VIBECODING_MANIFEST_TOO_NEW'));

  const unknown = await inspectFleetUpgradeSafety({
    path: tooNewProject,
    category: 'unknown-project',
    plannedAction: 'update',
  }, { targetVersion: '99.0.0' });
  assert.ok(unknown.refusals.some((item) => item.code === 'classification-unknown'));
});
