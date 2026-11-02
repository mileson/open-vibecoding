import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { CANONICAL_SKILLS } from '../src/agent-canonical-content.js';
import { setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { installedSkillPath, renderSkillInterface } from '../src/skill-presentation.js';

const id = 'resource-entitlement-design';
const skill = `open-vibecoding-${id}`;

test('resource guidance is one internal development capability reused by other scenes', () => {
  const catalog = buildCapabilityCatalog();
  const capability = getCapability(catalog, id);
  assert.equal(capability.userFacing, false);
  assert.deepEqual(capability.domains, ['development']);
  assert.equal(capability.tools, undefined);
  assert.equal(capability.uses, undefined);
  assert.equal(renderSkillInterface(skill), null);
  assert.equal(CANONICAL_SKILLS.filter(entry => entry.id === skill).length, 1);
  for (const consumer of ['product-diagnosis', 'interaction-review', 'feature-implementation',
    'test-strategy', 'acceptance-verification', 'practice-selection']) {
    assert.ok(getCapability(catalog, consumer).uses.includes(id), consumer);
  }
});

test('existing installations receive internal skill, examples and discoverable paths', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-resource-guidance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { tools: 'codex,claude,cursor', enableUserCodexConfig: false,
    openprdHome: path.join(root, 'registry') };
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Existing project guidance\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  // Model an installation from before this child capability existed.
  await fs.rm(path.join(root, path.dirname(installedSkillPath(skill))), { recursive: true });
  await fs.rm(path.join(root, '.claude/skills', skill), { recursive: true });
  assert.equal((await updateOpenPrdAgentIntegration(root, options)).ok, true);
  const source = await fs.readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const examples = await fs.readFile(new URL(`../skills/${skill}/references/business-scenarios.md`, import.meta.url), 'utf8');
  for (const adapter of ['codex', 'claude']) {
    const entry = installedSkillPath(skill, adapter);
    const installed = await fs.readFile(path.join(root, entry), 'utf8');
    assert.ok(installed.includes(body), adapter);
    const installedExamples = await fs.readFile(path.join(root, path.dirname(entry), 'references/business-scenarios.md'), 'utf8');
    assert.equal(installedExamples.replace(/^<!--[\s\S]*?-->\s*/, '').trim(), examples.trim());
    if (adapter === 'claude') assert.match(installed, /user-invocable: false/);
    const router = await fs.readFile(path.join(root, installedSkillPath('open-vibecoding-router', adapter)), 'utf8');
    assert.ok(router.includes(skill));
  }
  await assert.rejects(fs.access(path.join(root, '.codex/skills', skill)));
  const agents = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Existing project guidance\n'));
  assert.ok(agents.includes(installedSkillPath(skill)));
  const manifest = JSON.parse(await fs.readFile(path.join(root, '.open-vibecoding/harness/install-manifest.json'), 'utf8'));
  assert.ok(manifest.managedFiles.some(entry => entry.path === installedSkillPath(skill)));
});
