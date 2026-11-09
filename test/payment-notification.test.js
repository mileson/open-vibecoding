import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCapabilityCatalog, getCapability } from '../src/capability-catalog.js';
import { setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { installedSkillPath } from '../src/skill-presentation.js';

const skill = 'open-vibecoding-payment-notification';
const relative = 'references/templates/feishu/payment-compact/v1';
const source = new URL(`../skills/${skill}/${relative}/`, import.meta.url);
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

test('payment template has a complete field contract and distinct business links', async () => {
  const card = await json(new URL('card.json', source));
  const contract = await json(new URL('fields.json', source));
  const manifest = await json(new URL('manifest.json', source));
  const variables = [...new Set([...JSON.stringify(card).matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].sort();
  assert.deepEqual(variables, Object.keys(contract.fields).sort());
  assert.ok(Object.values(contract.fields).every(f => f.required && f.handling && f.usage));
  assert.equal(card.schema, '2.0');
  assert.equal(card.config.width_mode, 'compact');
  assert.equal(card.header.template, 'green');
  assert.equal(card.config.summary.content, '{{product_name}}收到一笔 {{amount_display}} 的新收款');
  assert.ok(JSON.stringify(card.body).includes('[{{order_no}}]({{order_detail_url}})'));
  const footer = card.body.elements.at(-1);
  assert.equal(footer.columns.at(-1).elements[0].behaviors[0].default_url, '{{order_list_url}}');
  assert.equal(footer.columns[0].elements[0].img_key, '{{logo_img_key}}');
  assert.notEqual(card.config.style.color['cus-0'].light_mode, card.config.style.color['cus-0'].dark_mode);
  assert.deepEqual(Object.keys(card).sort(), ['body', 'config', 'header', 'schema']);
  assert.equal(manifest.adoption, 'opt-in-copy');
  assert.deepEqual(manifest.runtimeDependencies, []);
  for (const entry of ['card', 'fields', 'guide']) await fs.access(new URL(manifest[entry], source));
});

test('internal payment practice and versioned assets update without changing adopted project templates', async t => {
  const catalog = buildCapabilityCatalog();
  assert.equal(getCapability(catalog, 'payment-notification')?.userFacing, false);
  assert.ok(getCapability(catalog, 'practice-selection').uses.includes('payment-notification'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-payment-template-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const options = { tools: 'codex,claude,cursor', hookProfile: 'lite', enableUserCodexConfig: false, openprdHome: path.join(root, 'registry') };
  await fs.writeFile(path.join(root, 'AGENTS.md'), '# Keep business instructions\n');
  await fs.writeFile(path.join(root, '.gitignore'), '.open-vibecoding/harness/\n.open-vibecoding/learning/\n.open-vibecoding/quality/reports/\n');
  assert.equal((await setupOpenPrdAgentIntegration(root, options)).ok, true);
  const adopted = path.join(root, 'notifications/templates/feishu/payment-compact');
  await fs.mkdir(adopted, { recursive: true });
  const customized = { ...await json(new URL('card.json', source)), header: { template: 'blue', title: { tag: 'plain_text', content: '项目收款' } } };
  const businessTemplate = JSON.stringify(customized);
  await fs.writeFile(path.join(adopted, 'card.json'), businessTemplate);
  // A missing managed reference must be restored, without treating the adopted copy as managed.
  const managed = path.join(root, path.dirname(installedSkillPath(skill)), relative, 'card.json');
  await fs.unlink(managed);
  assert.equal((await updateOpenPrdAgentIntegration(root, options)).ok, true);
  assert.equal(await fs.readFile(path.join(adopted, 'card.json'), 'utf8'), businessTemplate);
  for (const adapter of ['codex', 'claude']) {
    const folder = path.join(root, path.dirname(installedSkillPath(skill, adapter)));
    const body = await fs.readFile(path.join(folder, 'SKILL.md'), 'utf8');
    if (adapter === 'claude') assert.ok(body.includes('user-invocable: false'));
    for (const file of ['card.json', 'fields.json', 'manifest.json']) {
      const { $comment, ...actual } = await json(path.join(folder, relative, file));
      assert.ok($comment.includes('OPEN_VIBECODING:GENERATED'));
      assert.deepEqual(actual, await json(new URL(file, source)));
    }
    const router = await fs.readFile(path.join(root, installedSkillPath('open-vibecoding-router', adapter)), 'utf8');
    assert.ok(router.includes(installedSkillPath(skill, adapter)));
    await fs.access(path.join(folder, 'references/feishu-setup.md'));
    await fs.access(path.join(folder, 'references/verification.md'));
  }
  await assert.rejects(fs.access(path.join(root, '.codex/skills', skill)));
  assert.ok((await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8')).startsWith('# Keep business instructions\n'));
});
