import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { setupOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { safeWriteText } from '../src/adapters/install-safety.js';

async function makePhysicalTemp(prefix) {
  const physicalTemp = await fs.realpath(os.tmpdir());
  return fs.mkdtemp(path.join(physicalTemp, prefix));
}

async function makeProject(prefix) {
  const project = await makePhysicalTemp(prefix);
  await fs.mkdir(path.join(project, '.open-vibecoding'), { recursive: true });
  await fs.writeFile(path.join(project, '.gitignore'), [
    '.open-vibecoding/harness/',
    '.open-vibecoding/quality/reports/',
    '.open-vibecoding/quality/evidence/',
    '.open-vibecoding/engagements/active/review.html',
    '',
  ].join('\n'), 'utf8');
  return project;
}

function setupOptions(project, overrides = {}) {
  return {
    openprdHome: path.join(project, 'open-vibecoding-home'),
    codexHome: path.join(project, 'codex-home'),
    cursorHome: path.join(project, 'cursor-home'),
    ...overrides,
  };
}

test('managed writes block before following a symlinked ancestor', async () => {
  const root = await makePhysicalTemp('open-vibecoding-install-safety-block-');
  const project = path.join(root, 'project');
  const canonical = path.join(root, 'canonical-skill');
  await fs.mkdir(path.join(project, '.codex', 'skills'), { recursive: true });
  await fs.mkdir(canonical, { recursive: true });
  await fs.writeFile(path.join(canonical, 'SKILL.md'), 'canonical source\n', 'utf8');
  const linkedSkill = path.join(project, '.codex', 'skills', 'open-vibecoding-router');
  await fs.symlink(canonical, linkedSkill, 'dir');

  await assert.rejects(
    safeWriteText(path.join(linkedSkill, 'SKILL.md'), 'replacement\n', {
      projectRoot: project,
      managedWriteRoots: [project],
    }),
    (error) => {
      assert.equal(error.code, 'OPEN_VIBECODING_UNSAFE_MANAGED_WRITE_SYMLINK');
      assert.equal(error.symlinkPath, linkedSkill);
      return true;
    },
  );
  assert.equal(await fs.readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'canonical source\n');
  assert.equal((await fs.lstat(linkedSkill)).isSymbolicLink(), true);
});

test('materialize strategy snapshots a linked skill before updating the local copy', async () => {
  const project = await makeProject('open-vibecoding-install-safety-materialize-');
  const canonical = await makePhysicalTemp('open-vibecoding-canonical-skill-');
  await fs.writeFile(path.join(canonical, 'SKILL.md'), 'canonical source\n', 'utf8');
  await fs.mkdir(path.join(project, '.claude', 'skills'), { recursive: true });
  const linkedSkill = path.join(project, '.claude', 'skills', 'open-vibecoding-router');
  await fs.symlink(canonical, linkedSkill, 'dir');
  const backupRoot = path.join(project, 'install-safety-backups');

  const result = await setupOpenPrdAgentIntegration(project, setupOptions(project, {
    tools: 'claude',
    force: true,
    symlinkStrategy: 'materialize',
    installSafetyBackupRoot: backupRoot,
  }));

  assert.equal((await fs.lstat(linkedSkill)).isSymbolicLink(), false);
  assert.equal((await fs.lstat(linkedSkill)).isDirectory(), true);
  assert.equal(await fs.readFile(path.join(canonical, 'SKILL.md'), 'utf8'), 'canonical source\n');
  const localSkill = await fs.readFile(path.join(linkedSkill, 'SKILL.md'), 'utf8');
  assert.match(localSkill, /OPEN_VIBECODING:GENERATED/);
  assert.match(localSkill, /adapter=shared/);

  const manifest = JSON.parse(await fs.readFile(
    path.join(project, '.open-vibecoding', 'harness', 'install-manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.installSafety.symlinkStrategy, 'materialize');
  assert.equal(manifest.installSafety.materializationCount, 1);
  assert.equal(manifest.installSafety.materializations[0].path, '.claude/skills/open-vibecoding-router');
  const backups = await fs.readdir(backupRoot);
  assert.equal(backups.length, 1);
  const metadata = JSON.parse(await fs.readFile(path.join(backupRoot, backups[0], 'metadata.json'), 'utf8'));
  assert.equal(metadata.symlinkPath, linkedSkill);
  assert.equal(await fs.readFile(path.join(backupRoot, backups[0], 'snapshot', 'SKILL.md'), 'utf8'), 'canonical source\n');
  assert.equal(result.manifest.installSafety.materializationCount, 1);
});

test('user-scoped Codex config writes also block on symlinks', async () => {
  const project = await makeProject('open-vibecoding-user-config-safety-');
  const codexHome = path.join(project, 'codex-home');
  const externalConfig = path.join(project, 'external-codex-config.toml');
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(externalConfig, '[features]\ncodex_hooks = true\n', 'utf8');
  await fs.symlink(externalConfig, path.join(codexHome, 'config.toml'), 'file');

  await assert.rejects(
    setupOpenPrdAgentIntegration(project, setupOptions(project, {
      tools: 'codex',
      enableUserCodexConfig: true,
      codexHome,
    })),
    (error) => {
      assert.equal(error.code, 'OPEN_VIBECODING_UNSAFE_MANAGED_WRITE_SYMLINK');
      assert.equal(error.symlinkPath, path.join(codexHome, 'config.toml'));
      return true;
    },
  );
  assert.equal(await fs.readFile(externalConfig, 'utf8'), '[features]\ncodex_hooks = true\n');
  assert.equal((await fs.lstat(path.join(codexHome, 'config.toml'))).isSymbolicLink(), true);
});

test('shared methods are preserved while visibility and commands remain platform-specific', async () => {
  const project = await makeProject('open-vibecoding-adapter-content-');
  const result = await setupOpenPrdAgentIntegration(project, setupOptions(project, {
    tools: 'all',
  }));

  const codexSkill = await fs.readFile(
    path.join(project, '.open-vibecoding', 'harness', 'internal-skills', 'open-vibecoding-router', 'SKILL.md'),
    'utf8',
  );
  const claudeSkill = await fs.readFile(
    path.join(project, '.claude', 'skills', 'open-vibecoding-router', 'SKILL.md'),
    'utf8',
  );
  assert.ok(codexSkill.includes('不要求五域全部经过'));
  assert.ok(claudeSkill.includes('不要求五域全部经过'));
  assert.match(claudeSkill, /user-invocable: false/);
  assert.match(codexSkill, /adapter=shared/);

  const codexCommand = await fs.readFile(path.join(project, '.codex', 'prompts', 'open-vibecoding-standards.md'), 'utf8');
  const claudeCommand = await fs.readFile(path.join(project, '.claude', 'commands', 'open-vibecoding', 'standards.md'), 'utf8');
  const cursorCommand = await fs.readFile(path.join(project, '.cursor', 'commands', 'open-vibecoding-standards.md'), 'utf8');
  assert.match(codexCommand, /adapter=codex/);
  assert.match(claudeCommand, /adapter=claude/);
  assert.match(cursorCommand, /adapter=cursor/);

  const protocol = result.manifest.adapterProtocol;
  assert.equal(protocol.schema, 'openprd.adapter-protocol.v1');
  assert.equal(protocol.protocolVersion, 1);
  assert.match(protocol.contractDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(protocol.generatedContent.sharedSkillConsumers, ['codex', 'claude']);
  assert.deepEqual(protocol.clients.map((client) => client.client), ['codex', 'claude', 'cursor']);
  const claude = protocol.clients.find((client) => client.client === 'claude');
  assert.ok(claude.capabilityGaps.some((gap) => gap.capability === 'hooks' && gap.status === 'unsupported'));
  const codex = protocol.clients.find((client) => client.client === 'codex');
  assert.ok(codex.capabilityGaps.some((gap) => gap.capability === 'imageGeneration' && gap.status === 'surface-dependent'));
  assert.equal(result.manifest.platformCapabilityPacks.every((pack) => pack.adapterContractVersion === 1), true);
});
