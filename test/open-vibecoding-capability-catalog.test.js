import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANONICAL_SKILLS } from '../src/agent-canonical-content.js';
import { installedSkillPath } from '../src/skill-presentation.js';
import { CAPABILITY_CONTRIBUTIONS_SCHEMA, CAPABILITY_HANDOFF_SCHEMA, buildCapabilityCatalog, getCapability, loadProjectCapabilityCatalog, validateCapabilityHandoff } from '../src/capability-catalog.js';

const CLI = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));
const BRANDED_CLI = fileURLToPath(new URL('../bin/open-vibecoding.js', import.meta.url));

test('Open VibeCoding is the only published executable', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, 'open-vibecoding');
  assert.equal(lock.name, pkg.name);
  assert.deepEqual(lock.packages[''].bin, pkg.bin);
  assert.equal(pkg.bin['open-vibecoding'], 'bin/open-vibecoding.js');
  assert.deepEqual(Object.keys(pkg.bin), ['open-vibecoding']);
  const help = spawnSync(process.execPath, [BRANDED_CLI, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /^Open VibeCoding CLI/);
  assert.match(help.stdout, /open-vibecoding capabilities <list\|get/);
  const capabilities = spawnSync(process.execPath, [BRANDED_CLI, 'capabilities', 'list'], { encoding: 'utf8' });
  assert.equal(capabilities.status, 0, capabilities.stderr);
  assert.equal(JSON.parse(capabilities.stdout).product, 'open-vibecoding');
});

test('capability catalog keeps five execution domains plus cross-cutting best practices and supports extensions', () => {
  const catalog = buildCapabilityCatalog([{ scenarios: [{
    id: 'content-audit',
    title: '内容检查',
    skill: 'open-vibecoding-content-audit',
    domains: ['product', 'interaction'],
    accepts: ['现有内容'],
    produces: ['内容缺口'],
  }] }]);
  assert.deepEqual(catalog.domains.map((item) => item.id), [
    'product', 'interaction', 'development', 'testing', 'vibe-enhancement', 'best-practices',
  ]);
  assert.equal(getCapability(catalog, 'content-audit')?.skill, 'open-vibecoding-content-audit');
  assert.equal(catalog.orchestrator, 'open-vibecoding-router');
  assert.throws(() => buildCapabilityCatalog([{ domains: [{
    id: 'product', title: '重复', responsibility: '重复', commands: ['status'],
  }] }]), /重复 domain/);
  assert.throws(() => buildCapabilityCatalog([{ scenarios: [{
    id: 'bad-scene', title: '无效', skill: 'skill', domains: ['missing'],
    accepts: ['输入'], produces: ['输出'],
  }] }]), /未知 domain/);
  assert.throws(() => buildCapabilityCatalog([{ scenarios: [{
    id: 'product', title: '重名', skill: 'skill', domains: ['product'],
    accepts: ['输入'], produces: ['输出'],
  }] }]), /重复 capability/);
});

test('review repair composes independent capabilities and validates extension graphs', () => {
  const catalog = buildCapabilityCatalog();
  assert.deepEqual(getCapability(catalog, 'ui-review-and-repair').uses, ['ui-interaction-review', 'debugging', 'visual-evidence-delivery']);
  assert.deepEqual(getCapability(catalog, 'ui-interaction-review').uses, ['visual-evidence-delivery']);
  const scene = (id, uses) => ({
    id, title: id, skill: `example-${id}`, domains: ['testing'],
    accepts: ['目标'], produces: ['结果'], uses,
  });
  const nested = buildCapabilityCatalog([{ scenarios: [
    scene('outer', ['inner', 'ui-interaction-review']),
    scene('inner', ['ui-review-and-repair']),
  ] }]);
  assert.deepEqual(getCapability(nested, 'outer').uses, ['inner', 'ui-interaction-review']);
  for (const uses of [null, [], 'debugging', [''], [42]]) {
    assert.throws(() => buildCapabilityCatalog([{ scenarios: [scene('invalid', uses)] }]), /uses.*非空字符串数组/);
  }
  assert.throws(() => buildCapabilityCatalog([{ scenarios: [scene('invalid', ['missing'])] }]), /未知子能力/);
  assert.throws(() => buildCapabilityCatalog([{ scenarios: [scene('invalid', ['debugging', 'debugging'])] }]), /重复场景/);
  assert.throws(() => buildCapabilityCatalog([{ scenarios: [scene('self', ['self'])] }]), /循环引用/);
  assert.throws(() => buildCapabilityCatalog([{ scenarios: [scene('first', ['second']), scene('second', ['first'])] }]), /循环引用/);
});

test('each built-in scenario has a distinct, installable child skill', () => {
  const catalog = buildCapabilityCatalog();
  const ids = catalog.scenarios.map((scenario) => scenario.skill);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(CANONICAL_SKILLS.map(skill => skill.id)).size, CANONICAL_SKILLS.length);
  assert.equal(CANONICAL_SKILLS.every(skill => skill.id.startsWith('open-vibecoding-')), true);
  for (const scenario of catalog.scenarios) {
    assert.equal(CANONICAL_SKILLS.some((skill) => skill.id === scenario.skill), true, scenario.id);
    const canonical = CANONICAL_SKILLS.find((skill) => skill.id === scenario.skill);
    if (canonical.sourceSkill) {
      const skillFile = fileURLToPath(new URL(`../skills/${canonical.sourceSkill}/SKILL.md`, import.meta.url));
      assert.equal(existsSync(skillFile), true, scenario.id);
    }
    assert.equal('triggerKeywords' in scenario, false);
  }
  for (const domain of catalog.domains) {
    assert.ok(catalog.scenarios.filter((scenario) => scenario.domains.includes(domain.id)).length >= 2, domain.id);
  }
});

test('diagnostic readiness is internal and reused across development and acceptance', () => {
  const catalog = buildCapabilityCatalog();
  const capability = getCapability(catalog, 'diagnostic-readiness');
  assert.equal(capability.userFacing, false);
  assert.deepEqual(capability.domains, ['development', 'testing']);
  assert.equal(capability.tools, undefined);
  for (const id of ['debugging', 'feature-implementation', 'refactoring', 'acceptance-verification']) {
    assert.ok(getCapability(catalog, id).uses.includes('diagnostic-readiness'));
  }
  assert.equal(catalog.scenarios.filter(s => s.skill === capability.skill).length, 1);
});

test('data analysis scenes are independently discoverable without external providers', () => {
  const catalog = buildCapabilityCatalog();
  for (const [id, domain] of [
    ['product-data-analysis', 'product'],
    ['production-anomaly-analysis', 'testing'],
  ]) {
    const scenario = getCapability(catalog, id);
    assert.deepEqual(scenario.domains, [domain]);
    assert.deepEqual(scenario.uses, ['tool-selection']);
    assert.equal(scenario.tools, undefined);
    const selected = spawnSync(process.execPath, [BRANDED_CLI, 'capabilities', 'get', id], { encoding: 'utf8' });
    assert.equal(selected.status, 0, selected.stderr);
    assert.deepEqual(JSON.parse(selected.stdout).capability, scenario);
  }
});

test('project contribution is discoverable by CLI without changing built-ins', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-capabilities-'));
  try {
    const skillDir = path.join(root, 'skills', 'example-content-audit');
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: example-content-audit\ndescription: 内容检查。\n---\n\n# 内容检查\n');
    await writeFile(path.join(root, 'open-vibecoding.capabilities.json'), JSON.stringify({
      schema: CAPABILITY_CONTRIBUTIONS_SCHEMA,
      scenarios: [{
        id: 'content-audit', title: '内容检查', skill: 'example-content-audit',
        domains: ['product', 'interaction'], accepts: ['现有内容'], produces: ['内容缺口'],
      }],
    }));
    assert.equal(getCapability(await loadProjectCapabilityCatalog(root), 'content-audit')?.skill, 'example-content-audit');
    const listed = spawnSync(process.execPath, [BRANDED_CLI, 'capabilities', 'list', '--path', root], { encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).scenarios.some((item) => item.id === 'content-audit'), true);
    const initialized = spawnSync(process.execPath, [BRANDED_CLI, 'init', root, '--tools', 'codex,claude'], { encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(existsSync(path.join(root, '.openprd')), false);
    const manifest = JSON.parse(readFileSync(path.join(root, '.open-vibecoding', 'harness', 'install-manifest.json'), 'utf8'));
    assert.equal(existsSync(manifest.cliEntry), true);
    assert.equal(path.basename(manifest.cliEntry), 'open-vibecoding.js');
    assert.equal(existsSync(path.join(root, '.codex', 'skills', 'example-content-audit', 'SKILL.md')), true);
    assert.equal(existsSync(path.join(root, '.claude', 'skills', 'example-content-audit', 'SKILL.md')), true);
    for (const tool of ['.codex', '.claude']) {
      for (const skill of ['open-vibecoding-test-strategy', 'open-vibecoding-ui-interaction-review', 'open-vibecoding-ui-review-and-repair',
        'open-vibecoding-audio-evidence', 'open-vibecoding-audio-evidence', 'open-vibecoding-icon-system',
        'open-vibecoding-icon-source', 'open-vibecoding-icon-svg', 'open-vibecoding-icon-image', 'open-vibecoding-icon-cutout',
        'open-vibecoding-best-practices', 'open-vibecoding-ios-localization']) {
        const installed = readFileSync(path.join(root, installedSkillPath(skill, tool.slice(1))), 'utf8');
        assert.ok(installed.includes(`name: ${skill}`));
      }
      const strategySource = readFileSync(new URL('../skills/open-vibecoding-test-strategy/SKILL.md', import.meta.url), 'utf8');
      const strategyBody = strategySource.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
      const installedStrategy = readFileSync(path.join(root, installedSkillPath('open-vibecoding-test-strategy', tool.slice(1))), 'utf8');
      assert.ok(installedStrategy.includes(strategyBody), `${tool} receives the complete canonical methodology`);
      const examplesSource = readFileSync(new URL('../skills/open-vibecoding-test-strategy/references/user-journey-examples.md', import.meta.url), 'utf8').trim();
      const installedExamples = readFileSync(path.join(root, path.dirname(installedSkillPath('open-vibecoding-test-strategy', tool.slice(1))), 'references/user-journey-examples.md'), 'utf8');
      assert.ok(installedExamples.includes(examplesSource), `${tool} receives the linked business examples`);
      for (const skill of ['open-vibecoding-product-data-analysis', 'open-vibecoding-production-anomaly-analysis', 'open-vibecoding-tool-selection']) {
        const source = readFileSync(new URL(`../skills/${skill}/SKILL.md`, import.meta.url), 'utf8');
        const body = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
        const installed = readFileSync(path.join(root, installedSkillPath(skill, tool.slice(1))), 'utf8');
        assert.ok(installed.includes(`name: ${skill}`));
        assert.ok(installed.includes(body), `${tool} receives the complete ${skill} guide`);
      }
      const optionalToolsRef = 'open-vibecoding-tool-selection/references/optional-external-tools.md';
      const optionalToolsSource = readFileSync(new URL(`../skills/${optionalToolsRef}`, import.meta.url), 'utf8').trim();
      const installedOptionalTools = readFileSync(path.join(root, path.dirname(installedSkillPath('open-vibecoding-tool-selection', tool.slice(1))), 'references/optional-external-tools.md'), 'utf8');
      assert.ok(installedOptionalTools.includes(optionalToolsSource), `${tool} receives the optional tool reference`);
      assert.equal(existsSync(path.join(root, path.dirname(installedSkillPath('open-vibecoding-audio-evidence', tool.slice(1))), 'references/media-evidence.schema.json')), true);
      assert.equal(existsSync(path.join(root, path.dirname(installedSkillPath('open-vibecoding-icon-source', tool.slice(1))), 'references/sources.md')), true);
      assert.equal(existsSync(path.join(root, tool, 'skills', 'open-vibecoding-ios-localization', 'references', 'apple-localization.md')), true);
    }
    await rm(path.join(skillDir, 'SKILL.md'));
    const invalid = spawnSync(process.execPath, [BRANDED_CLI, 'capabilities', 'list', '--path', root], { encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.equal(JSON.parse(invalid.stderr).error.type, 'invalid-contribution');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handoff contract preserves unknowns separately from facts and evidence', () => {
  const handoff = {
    schema: CAPABILITY_HANDOFF_SCHEMA,
    scenarioId: 'product-diagnosis',
    status: 'partial',
    sourceRefs: ['user-feedback-1'],
    facts: ['用户未找到导出入口'],
    assumptions: ['入口名称可能难懂'],
    unknowns: ['用户是否看到过该入口'],
    decisions: [],
    artifactRefs: [],
    evidenceRefs: [],
    nextActions: ['观察一次真实导出任务'],
  };
  assert.deepEqual(validateCapabilityHandoff(handoff), []);
  assert.match(validateCapabilityHandoff({ ...handoff, unknowns: null }).join(' '), /unknowns/);
  assert.match(validateCapabilityHandoff({ ...handoff, status: 'successfully-triggered' }).join(' '), /status/);
});

test('capabilities CLI exposes registered scenes and structured not-found errors', () => {
  const listed = spawnSync(process.execPath, [CLI, 'capabilities', 'list'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const catalog = JSON.parse(listed.stdout);
  assert.equal(catalog.ok, true);
  assert.equal(catalog.scenarios.some((item) => item.id === 'interaction-review'), true);

  const selected = spawnSync(process.execPath, [CLI, 'capabilities', 'get', 'product-diagnosis'], { encoding: 'utf8' });
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(JSON.parse(selected.stdout).capability.skill, 'open-vibecoding-product-diagnosis');

  const composite = spawnSync(process.execPath, [CLI, 'capabilities', 'get', 'ui-review-and-repair'], { encoding: 'utf8' });
  assert.equal(composite.status, 0, composite.stderr);
  assert.deepEqual(JSON.parse(composite.stdout).capability.uses, ['ui-interaction-review', 'debugging', 'visual-evidence-delivery']);

  const contract = spawnSync(process.execPath, [CLI, 'capabilities', 'contract'], { encoding: 'utf8' });
  assert.equal(contract.status, 0, contract.stderr);
  assert.equal(JSON.parse(contract.stdout).schema, CAPABILITY_HANDOFF_SCHEMA);

  const missing = spawnSync(process.execPath, [CLI, 'capabilities', 'get', 'missing'], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stderr).error.type, 'not-found');
});
