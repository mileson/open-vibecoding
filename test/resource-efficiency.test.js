import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { CANONICAL_SKILLS } from '../src/agent-canonical-content.js';
import { installedSkillPath, renderSkillInterface } from '../src/skill-presentation.js';
import { setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from '../src/agent-integration.js';

const id = 'resource-efficiency';
const skill = `open-vibecoding-${id}`;

test('resource efficiency is a distinct internal helper, not a cleanup command or entitlement rule', () => {
  const catalog = buildCapabilityCatalog();
  const capability = getCapability(catalog, id);
  assert.deepEqual(capability.domains, ['development', 'vibe-enhancement']);
  assert.equal(capability.userFacing, false);
  assert.equal(capability.tools, undefined);
  assert.equal(capability.uses, undefined);
  assert.equal(renderSkillInterface(skill), null);
  assert.equal(CANONICAL_SKILLS.filter(entry => entry.id === skill).length, 1);
  assert.notEqual(capability.skill, getCapability(catalog, 'resource-entitlement-design').skill);
  for (const consumer of ['feature-implementation', 'refactoring', 'tool-selection', 'acceptance-verification', 'practice-selection']) {
    assert.ok(getCapability(catalog, consumer).uses.includes(id), consumer);
  }
});

test('update restores the internal helper and its examples while preserving project instructions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-resource-efficiency-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { tools: 'codex,claude,cursor', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') };
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Project-specific guidance\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  await fs.rm(path.join(root, path.dirname(installedSkillPath(skill))), { recursive: true });
  await fs.rm(path.join(root, '.claude/skills', skill), { recursive: true });
  assert.equal((await updateOpenPrdAgentIntegration(root, options)).ok, true);
  const body = (await fs.readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const examples = (await fs.readFile(new URL(`../skills/${skill}/references/business-scenarios.md`, import.meta.url), 'utf8')).trim();
  for (const adapter of ['codex', 'claude']) {
    const entry = installedSkillPath(skill, adapter);
    const installed = await fs.readFile(path.join(root, entry), 'utf8');
    assert.ok(installed.includes(body));
    if (adapter === 'claude') assert.match(installed, /user-invocable: false/);
    const ref = await fs.readFile(path.join(root, path.dirname(entry), 'references/business-scenarios.md'), 'utf8');
    assert.equal(ref.replace(/^<!--[\s\S]*?-->\s*/, '').trim(), examples);
    const router = await fs.readFile(path.join(root, installedSkillPath('open-vibecoding-router', adapter)), 'utf8');
    assert.ok(router.includes(skill));
  }
  await assert.rejects(fs.access(path.join(root, '.codex/skills', skill)));
  const agents = await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Project-specific guidance\n'));
  assert.ok(agents.includes(installedSkillPath(skill)));
});
