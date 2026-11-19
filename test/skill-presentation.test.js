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
    await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n.open-vibecoding/quality/project-index.json\n.open-vibecoding/quality/project-index.json.lock\n');
    const options = { tools: 'codex,claude,cursor', openprdHome: path.join(root, 'registry'), enableUserCodexConfig: false };
    // Model an already installed managed internal skill, including a user-added resource.
    const old = path.join(root, '.codex/skills/open-vibecoding-audio-evidence');
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(path.join(old, 'SKILL.md'), '---\nname: open-vibecoding-audio-evidence\ndescription: Customized audio workflow\n---\nold method');
    await fs.writeFile(path.join(old, 'user-note.txt'), 'preserved');
    const result = await setupOpenPrdAgentIntegration(root, options);
    assert.equal(result.ok, true, JSON.stringify(result.doctor.checks.filter(x => !x.ok)));
    assert.deepEqual(result.manifest.skillEntries.filter(x => x.userFacing).map(x => x.id).sort(), Object.keys(USER_SKILL_PRESENTATION).sort());
    const native = await fs.readdir(path.join(root, '.agents/skills'));
    assert.deepEqual(native.filter(id=>id!=='project-quality').sort(), Object.keys(USER_SKILL_PRESENTATION).sort());
    for (const id of ['open-vibecoding-router', 'open-vibecoding-audio-evidence', 'open-vibecoding-diagnostic-readiness']) {
      assert.ok((await fs.readFile(path.join(root, installedSkillPath(id)), 'utf8')).includes(`name: ${id}`));
      assert.equal(installedSkillPath(id, 'claude'), installedSkillPath(id));
    }
    assert.equal(await fs.readFile(path.join(root, path.dirname(installedSkillPath('open-vibecoding-audio-evidence')), 'user-note.txt'), 'utf8'), 'preserved');
    const router = await fs.readFile(path.join(root, installedSkillPath('open-vibecoding-router')), 'utf8');
    assert.ok(router.includes(installedSkillPath('open-vibecoding-audio-evidence')));
    assert.ok(router.includes('open-vibecoding-unit-test-generation'));
    assert.ok(router.includes('open-vibecoding-unit-test-run-and-repair'));
    const caseSkill = 'open-vibecoding-test-case-generation';
    assert.match(router, /制定策略并生成测试用例[^\n]*\$open-vibecoding-test-case-generation/);
    for (const adapter of ['codex', 'claude']) {
      const installed = await fs.readFile(path.join(root, installedSkillPath(caseSkill, adapter)), 'utf8');
      assert.match(installed, /先读 `\$open-vibecoding-test-strategy`/);
      assert.match(installed, /第 10 张被拦截，原名单保持，发起页收到 P01–P09/);
      for (const existing of ['open-vibecoding-test-strategy', 'open-vibecoding-unit-test-generation']) {
        assert.ok((await fs.readFile(path.join(root, installedSkillPath(existing, adapter)), 'utf8')).includes(`name: ${existing}`));
      }
    }
    for (const command of [
      `.codex/prompts/${caseSkill}.md`,
      '.claude/commands/open-vibecoding/test-case-generation.md',
      `.cursor/commands/${caseSkill}.md`,
    ]) {
      assert.ok((await fs.readFile(path.join(root, command), 'utf8')).includes(`$${caseSkill}`));
    }
    for (const [id, info] of Object.entries(USER_SKILL_PRESENTATION)) {
      const yaml = await fs.readFile(path.join(root, '.agents/skills', id, 'agents/openai.yaml'), 'utf8');
      assert.ok(yaml.includes(JSON.stringify(info.displayName)));
      assert.ok(!yaml.includes('allow_implicit_invocation: false'));
    }
    assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
