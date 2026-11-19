import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { initWorkspace } from '../src/open-vibecoding.js';
import { updateOpenPrdAgentIntegration, doctorOpenPrdAgentIntegration } from '../src/agent-integration.js';
import { learnQualityWorkspace, qualityWorkspace } from '../src/quality.js';
import { loadProjectCapabilityCatalog } from '../src/capability-catalog.js';

const skill = (name, body) => `---\nname: ${name}\ndescription: Test project rule\n---\n\n${body}\n`;

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ovc-project-skill-layout-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = name => path.join(root,name);
  const write = async (name, content) => {
    await fs.mkdir(path.dirname(file(name)), {recursive:true});
    await fs.writeFile(file(name), typeof content === 'string' ? content : JSON.stringify(content));
  };
  const read = name => fs.readFile(file(name),'utf8');
  return { root, file, write, read, options: { tools: 'all', openprdHome: file('.workspace-registry') } };
}

test('init, repeated init, update and doctor use one tracked Skill layout', async t => {
  const {root, file, read, write, options} = await fixture(t);
  const first = await initWorkspace(root,options);
  assert.ok(first.agentIntegration.ok);
  const pathName = '.agents/skills/project-quality/SKILL.md';
  const shared = await read(pathName);
  const again = await initWorkspace(root,options);
  assert.ok(again.agentIntegration.ok);
  assert.equal(await read(pathName), shared);
  const reference = '.agents/internal-skills/open-vibecoding-audio-evidence/references/media-evidence.schema.json';
  const skillInterface = '.agents/skills/open-vibecoding-unit-test-generation/agents/openai.yaml';
  const schema = JSON.parse(await read(reference));
  const customReference = `${JSON.stringify({ ...schema, description: 'Local evidence policy' }, null, 2)}\n`;
  const customInterface = `${await read(skillInterface)}# Local display instructions\n`;
  await write(reference, customReference);
  await write(skillInterface, customInterface);
  const updated = await updateOpenPrdAgentIntegration(root,{...options,force:true});
  assert.ok(updated.ok);
  assert.equal(await read(reference), customReference);
  assert.equal(await read(skillInterface), customInterface);
  const guide = await read('AGENTS.md');
  assert.match(guide,/\.agents\/internal-skills\/open-vibecoding-router\/SKILL\.md/);
  assert.match(guide,/\.agents\/skills\/project-quality\/SKILL\.md/);
  assert.doesNotMatch(guide,/\/Users\/|\.codex\/skills\//);
  assert.match(await read('CLAUDE.md'),/@AGENTS\.md/);
  assert.match(await read('GEMINI.md'),/@\.\/AGENTS\.md/);
  for (const former of ['.codex/skills','.claude/skills','.gemini/skills','.cursor/skills','.open-vibecoding/harness/internal-skills']) {
    await assert.rejects(fs.stat(file(former)), { code:'ENOENT' });
  }
  const doctor = await doctorOpenPrdAgentIntegration(root,options);
  assert.ok(doctor.ok);
});

test('migration keeps customized files, archives collisions and repairs promoted index paths', async t => {
  const {root, file, read, write, options} = await fixture(t);
  const custom = skill('photo-selection-check','项目原有的相册业务规则');
  const conflict = skill('photo-selection-check','另一个客户端的项目规则');
  const experience = skill('picker-history','已正式沉淀的项目经验');
  const quality = skill('project-quality','旧项目自己的质量检查说明');
  await write('skills/photo-selection-check/SKILL.md',custom);
  await write('skills/photo-selection-check/references/limits.md','P01–P09');
  await write('.cursor/skills/photo-selection-check/SKILL.md',conflict);
  await write('.codex/skills/test-local/SKILL.md',skill('test-local','旧 Codex 文档'));
  await write('.claude/skills/test-claude/SKILL.md',skill('test-claude','旧 Claude 文档'));
  await write('.gemini/skills/test-gemini/SKILL.md',skill('test-gemini','旧 Gemini 文档'));
  await write('GEMINI.md','手写的 Gemini 项目说明\n');
  await write('.open-vibecoding/knowledge/skills/picker-history/SKILL.md',experience);
  await write('.open-vibecoding/quality/SKILL.md',quality);
  await write('.open-vibecoding/knowledge/index.json',{version:1,skills:[{
    skillName:'picker-history',path:file('.open-vibecoding/knowledge/skills/picker-history/SKILL.md'),
  }]});
  await write('.open-vibecoding/knowledge/candidates/keep/candidate.json',{
    candidateId:'keep', status:'promoted', promotedSkillPath:'.open-vibecoding/knowledge/skills/picker-history/SKILL.md',
  });
  await write('open-vibecoding.capabilities.json',{
    schema:'open-vibecoding.contributions.v1',scenarios:[{
      id:'photo-selection-check',title:'相册检查',skill:'photo-selection-check',domains:['testing'],
      accepts:['需求'],produces:['证据'],
    }],
  });

  const result = await initWorkspace(root,options);
  assert.ok(result.agentIntegration.ok);
  const changes = result.agentIntegration.changes;
  const collision = changes.find(item=>item.status==='project-skill-conflict');
  assert.ok(collision?.preservedAt.startsWith('.agents/skill-conflicts/'));
  assert.equal(await read(collision.preservedAt+'/SKILL.md'),conflict);
  assert.equal(await read('.agents/skills/photo-selection-check/SKILL.md'),custom);
  assert.equal(await read('.agents/skills/photo-selection-check/references/limits.md'),'P01–P09');
  assert.equal(await read('.agents/skills/picker-history/SKILL.md'),experience);
  assert.equal(await read('.agents/skills/project-quality/SKILL.md'),quality);
  assert.ok((await read('.agents/skills/test-local/SKILL.md')).includes('旧 Codex 文档'));
  assert.ok((await read('.agents/skills/test-claude/SKILL.md')).includes('旧 Claude 文档'));
  assert.ok((await read('.agents/skills/test-gemini/SKILL.md')).includes('旧 Gemini 文档'));
  assert.match(await read('GEMINI.md'),/^手写的 Gemini 项目说明\n[\s\S]*@\.\/AGENTS.md/);
  await assert.rejects(fs.stat(file('.gemini/skills/test-gemini')), {code:'ENOENT'});
  const index = JSON.parse(await read('.open-vibecoding/knowledge/index.json'));
  assert.equal(index.skills[0].path,'.agents/skills/picker-history/SKILL.md');
  const candidate = JSON.parse(await read('.open-vibecoding/knowledge/candidates/keep/candidate.json'));
  assert.equal(candidate.promotedSkillPath,'.agents/skills/picker-history/SKILL.md');
  assert.ok((await loadProjectCapabilityCatalog(root)).scenarios.some(item=>item.id==='photo-selection-check'));
  await assert.rejects(fs.stat(file('.cursor/skills/photo-selection-check')), {code:'ENOENT'});
  const next = await updateOpenPrdAgentIntegration(root,{...options,force:true});
  assert.ok(next.ok);
  assert.ok(!next.changes.some(item=>item.status==='project-skill-conflict'));
  assert.equal(await read('.agents/skills/project-quality/SKILL.md'),quality);
});

test('explicit knowledge promotion publishes one portable skill and respects a later edit', async t => {
  const {root, read, write} = await fixture(t);
  const source = '.open-vibecoding/diagnostics/diagnostic-report.json';
  await write('src/picker.js','export const limit = 9;\n');
  await write(source,{ title:'Picker report', status:'failed', touchedFiles:['src/picker.js'],
    summary:'The search panel replaced a selected photo.',
    symptoms:['The first selection changed'], rootCauseCandidates:[{title:'Selection limit check missing'}],
  });
  const review = await qualityWorkspace(root,{learn:true,review:true,from:source});
  assert.ok(review.ok,JSON.stringify(review.errors));
  assert.ok(review.files?.candidateDir);
  const result = await learnQualityWorkspace(root,{from:review.files.candidateDir});
  assert.ok(result.ok,JSON.stringify(result.errors));
  const name = result.skillName;
  const relative = `.agents/skills/${name}/SKILL.md`;
  const content = await read(relative);
  assert.match(content,new RegExp(`name: ${name}`));
  const index = JSON.parse(await read('.open-vibecoding/knowledge/index.json'));
  assert.equal(index.skills[0].path,relative);
  await write(relative,content+'\nLocal edit\n');
  const candidate = JSON.parse(await fs.readFile(review.files.candidate,'utf8'));
  assert.equal(candidate.status,'promoted');
  assert.equal(candidate.promotedSkillPath,relative);
  const blocked = await learnQualityWorkspace(root,{from:review.files.candidateDir});
  assert.equal(blocked.ok,false);
  assert.ok((await read(relative)).includes('Local edit'));
});
