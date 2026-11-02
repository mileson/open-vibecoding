import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { installedSkillPath } from '../src/skill-presentation.js';

const helpers = ['code-quality', 'code-complexity-review', 'code-duplication-review', 'test-strength-review'];

test('engineering discipline composes independently discoverable internal quality capabilities', () => {
  const catalog = buildCapabilityCatalog();
  for (const id of helpers) assert.equal(getCapability(catalog, id).userFacing, false);
  assert.deepEqual(getCapability(catalog, 'code-quality').uses, helpers.slice(1));
  for (const id of ['feature-implementation', 'debugging', 'refactoring']) {
    assert.ok(getCapability(catalog, id).uses.includes('code-quality'));
  }
  assert.ok(getCapability(catalog, 'test-strategy').uses.includes('test-strength-review'));
});

test('updating an existing project distributes the quality guides without installing external tools', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-code-quality-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { tools: 'codex,claude,cursor', hookProfile: 'lite', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') };
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Project instructions\nKeep the business rules.\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  await fs.writeFile(path.join(root, 'business.js'), 'export const unchanged = true;\n');
  assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  for (const id of helpers) {
    for (const adapter of ['codex', 'claude']) {
      await fs.rm(path.dirname(path.join(root, installedSkillPath(`open-vibecoding-${id}`, adapter))), { recursive: true, force: true });
    }
  }
  const result = await updateOpenPrdAgentIntegration(root, options);
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest.tools, ['codex', 'claude', 'cursor']);
  for (const adapter of ['codex', 'claude']) {
    for (const id of helpers) {
      const name = `open-vibecoding-${id}`;
      const actual = await fs.readFile(path.join(root, installedSkillPath(name, adapter)), 'utf8');
      const source = (await fs.readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8')).replace(/^---\n[\s\S]*?\n---\n/, '').trim();
      assert.ok(actual.includes(source));
      if (adapter === 'claude') assert.match(actual, /user-invocable: false/);
    }
    for (const file of ['principles.md', 'quality-tools.md']) {
      const relative = path.join(path.dirname(installedSkillPath('open-vibecoding-code-quality', adapter)), 'references', file);
      const installed = (await fs.readFile(path.join(root, relative), 'utf8')).replace(/^<!--[\s\S]*?-->\s*/, '').trim();
      assert.equal(installed, (await fs.readFile(new URL(`../skills/open-vibecoding-code-quality/references/${file}`, import.meta.url), 'utf8')).trim());
    }
  }
  assert.equal(await fs.readFile(path.join(root, 'business.js'), 'utf8'), 'export const unchanged = true;\n');
  assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Project instructions\nKeep the business rules.\n'));
  for (const id of helpers) await assert.rejects(fs.access(path.join(root, '.codex/skills', `open-vibecoding-${id}`)));
  for (const entry of ['.venv', 'crapper', 'dryer', 'mutator', '.metrics']) await assert.rejects(fs.access(path.join(root, entry)));
});
