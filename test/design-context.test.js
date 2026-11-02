import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'yaml';
import { CANONICAL_SKILLS } from '../src/agent-canonical-content.js';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { installedSkillPath, USER_SKILL_PRESENTATION } from '../src/skill-presentation.js';

const metadata = text => parse(text.match(/^---\n([\s\S]*?)\n---/)[1]);
const skill = 'open-vibecoding-design-context';

test('design context is independently discoverable and shared by proposal, interaction and implementation', () => {
  const catalog = buildCapabilityCatalog();
  assert.equal(getCapability(catalog, 'design-context')?.userFacing, false);
  for (const id of ['interaction-review', 'visual-direction-review', 'visual-implementation']) {
    assert.ok(getCapability(catalog, id).uses?.includes('design-context'), id);
  }
});

test('project update preserves full skill discovery descriptions separately from short menu copy', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-design-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { tools: 'codex,claude,cursor', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') };
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Keep project guidance\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  const name = 'open-vibecoding-visual-direction-review';
  const file = path.join(root, installedSkillPath(name));
  const old = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, old.replace(/^description:.*$/m, `description: ${USER_SKILL_PRESENTATION[name].description}`));
  assert.equal((await updateOpenPrdAgentIntegration(root, options)).ok, true);
  for (const adapter of ['codex', 'claude']) {
    for (const name of Object.keys(USER_SKILL_PRESENTATION)) {
      const source = await fs.readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
      const installed = await fs.readFile(path.join(root, installedSkillPath(name, adapter)), 'utf8');
      assert.equal(metadata(installed).description, CANONICAL_SKILLS.find(s => s.id === name).sourceSkill ? metadata(source).description : CANONICAL_SKILLS.find(s => s.id === name).description, name);
    }
    const body = await fs.readFile(path.join(root, installedSkillPath(skill, adapter)), 'utf8');
    assert.equal(metadata(body).name, skill);
    if (adapter === 'claude') assert.equal(metadata(body)['user-invocable'], false);
    const router = await fs.readFile(path.join(root, installedSkillPath('open-vibecoding-router', adapter)), 'utf8');
    assert.ok(router.includes(installedSkillPath(skill, adapter)));
  }
  for (const adapter of ['codex', 'claude']) {
    const file = path.join(root, installedSkillPath('open-vibecoding-public-content-boundary', adapter));
    assert.equal(metadata(await fs.readFile(file, 'utf8')).name, 'open-vibecoding-public-content-boundary');
  }
  await assert.rejects(fs.access(path.join(root, '.codex/skills/open-vibecoding-public-content-boundary')));
  const menu = parse(await fs.readFile(path.join(root, '.codex/skills', name, 'agents/openai.yaml'), 'utf8'));
  assert.equal(menu.interface.short_description, USER_SKILL_PRESENTATION[name].description);
  assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Keep project guidance\n'));
  await assert.rejects(fs.access(path.join(root, '.codex/skills', skill)));
});


test('public content boundary is internal and composed across user-facing work', () => {
  const catalog = buildCapabilityCatalog();
  assert.equal(getCapability(catalog, 'public-content-boundary')?.userFacing, false);
  for (const id of ['product-document', 'interaction-review', 'visual-direction-review', 'visual-implementation', 'feature-implementation', 'acceptance-verification', 'ui-interaction-review']) {
    assert.ok(getCapability(catalog, id).uses.includes('public-content-boundary'), id);
  }
});
