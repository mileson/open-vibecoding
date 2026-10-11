import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { USER_SKILL_PRESENTATION, installedSkillPath } from '../src/skill-presentation.js';

test('user menu shows business scenes while internal audio, router and resources remain readable', async () => {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'vibecoding-presentation-'));
  try {
    await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
    const options = { tools: 'codex,claude', openprdHome: path.join(root, 'registry'), enableUserCodexConfig: false };
    // Model an already installed managed internal skill, including a user-added resource.
    const old = path.join(root, '.codex/skills/open-vibecoding-audio-evidence');
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(path.join(old, 'SKILL.md'), '<!-- OPEN_VIBECODING:GENERATED -->\nold method');
    await fs.writeFile(path.join(old, 'user-note.txt'), 'preserved');
    const result = await setupOpenPrdAgentIntegration(root, options);
    assert.equal(result.ok, true, JSON.stringify(result.doctor.checks.filter(x => !x.ok)));
    assert.equal(result.manifest.skillEntries.filter(x => x.userFacing).length, 20);
    const native = await fs.readdir(path.join(root, '.codex/skills'));
    assert.deepEqual(native.sort(), Object.keys(USER_SKILL_PRESENTATION).sort());
    for (const id of ['open-vibecoding-router', 'open-vibecoding-audio-evidence', 'open-vibecoding-diagnostic-readiness']) {
      assert.ok((await fs.readFile(path.join(root, installedSkillPath(id)), 'utf8')).includes(`name: ${id}`));
      assert.ok((await fs.readFile(path.join(root, installedSkillPath(id, 'claude')), 'utf8')).includes('user-invocable: false'));
    }
    assert.equal(await fs.readFile(path.join(root, path.dirname(installedSkillPath('open-vibecoding-audio-evidence')), 'user-note.txt'), 'utf8'), 'preserved');
    const router = await fs.readFile(path.join(root, installedSkillPath('open-vibecoding-router')), 'utf8');
    assert.ok(router.includes(installedSkillPath('open-vibecoding-audio-evidence')));
    for (const [id, info] of Object.entries(USER_SKILL_PRESENTATION)) {
      const yaml = await fs.readFile(path.join(root, '.codex/skills', id, 'agents/openai.yaml'), 'utf8');
      assert.ok(yaml.includes(JSON.stringify(info.displayName)));
      assert.ok(!yaml.includes('allow_implicit_invocation: false'));
    }
    assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
