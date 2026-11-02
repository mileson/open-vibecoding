import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { installedSkillPath } from '../src/skill-presentation.js';
import { setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from '../src/agent-integration.js';

test('competitive research exposes two independent product entries and composes a hidden evidence helper', () => {
  const catalog = buildCapabilityCatalog();
  for (const id of ['competitor-growth-analysis', 'competitor-tracking']) {
    const item = getCapability(catalog, id);
    assert.equal(item.userFacing, true);
    assert.deepEqual(item.domains, ['product']);
    assert.deepEqual(item.uses, ['competitive-evidence']);
  }
  assert.equal(getCapability(catalog, 'competitive-evidence').userFacing, false);
  assert.deepEqual(getCapability(catalog, 'competitive-evidence').uses, ['tool-selection']);
});

test('update restores research capabilities for both adapters without replacing custom project guidance', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-research-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Custom project guidance\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  const options = { tools: 'codex,claude', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') };
  assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  const ids = ['competitor-growth-analysis', 'competitor-tracking', 'competitive-evidence'];
  await fs.unlink(path.join(root, installedSkillPath('open-vibecoding-competitor-tracking')));
  assert.equal((await updateOpenPrdAgentIntegration(root, options)).ok, true);
  assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Custom project guidance\n'));
  for (const id of ids) {
    const skill = `open-vibecoding-${id}`;
    const body = (await fs.readFile(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '').trim();
    for (const adapter of ['codex', 'claude']) {
      assert.ok((await fs.readFile(path.join(root, installedSkillPath(skill, adapter)), 'utf8')).includes(body));
    }
  }
  await assert.rejects(fs.access(path.join(root, '.codex/skills/open-vibecoding-competitive-evidence')));
});
