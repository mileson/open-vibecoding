import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CONTEXT_CAPSULE_SCHEMA_VERSION,
  verifyContextCapsule,
} from '../src/context/index.js';
import { initWorkspace, runWorkspace } from '../src/openprd.js';

const originalOpenPrdHome = process.env.OPENPRD_HOME;
const isolatedOpenPrdHome = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-context-integration-home-'));
process.env.OPENPRD_HOME = isolatedOpenPrdHome;

test.after(async () => {
  if (originalOpenPrdHome === undefined) {
    delete process.env.OPENPRD_HOME;
  } else {
    process.env.OPENPRD_HOME = originalOpenPrdHome;
  }
  await fs.rm(isolatedOpenPrdHome, { recursive: true, force: true });
});

async function makeInitializedProject(t) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-context-integration-'));
  const projectRoot = path.join(tempRoot, 'project');
  await fs.mkdir(projectRoot, { recursive: true });
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  await initWorkspace(projectRoot, {
    tools: 'codex',
    templatePack: 'agent',
    openprdHome: isolatedOpenPrdHome,
  });
  return projectRoot;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function snapshotFile(filePath, projectRoot) {
  const relativePath = path.relative(projectRoot, filePath).split(path.sep).join('/');
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat) return [relativePath, { type: 'missing' }];
  if (stat.isSymbolicLink()) {
    return [relativePath, {
      type: 'symlink',
      target: await fs.readlink(filePath),
      mtimeMs: Number(stat.mtimeMs.toFixed(3)),
    }];
  }
  const content = await fs.readFile(filePath);
  return [relativePath, {
    type: 'file',
    size: stat.size,
    mtimeMs: Number(stat.mtimeMs.toFixed(3)),
    digest: sha256(content),
  }];
}

async function snapshotTree(rootPath, projectRoot) {
  const stat = await fs.lstat(rootPath).catch(() => null);
  if (!stat) return [await snapshotFile(rootPath, projectRoot)];
  if (!stat.isDirectory()) return [await snapshotFile(rootPath, projectRoot)];
  const entries = [];
  for (const child of (await fs.readdir(rootPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = path.join(rootPath, child.name);
    if (child.isDirectory()) {
      entries.push(...await snapshotTree(childPath, projectRoot));
    } else {
      entries.push(await snapshotFile(childPath, projectRoot));
    }
  }
  return entries;
}

async function snapshotBusinessState(projectRoot) {
  const tracked = [
    '.openprd/state',
    '.openprd/engagements',
    '.openprd/changes',
    '.openprd/knowledge',
    '.openprd/harness/run-state.json',
    '.openprd/harness/iterations.jsonl',
    '.openprd/harness/learnings.md',
  ];
  const entries = [];
  for (const relativePath of tracked) {
    entries.push(...await snapshotTree(path.join(projectRoot, relativePath), projectRoot));
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

async function seedReadOnlyKnowledgeSkill(projectRoot) {
  const skillName = 'context-capsule-read-only';
  const relativeSkillPath = `.openprd/knowledge/skills/${skillName}/SKILL.md`;
  const skillPath = path.join(projectRoot, relativeSkillPath);
  await fs.mkdir(path.dirname(skillPath), { recursive: true });
  await fs.writeFile(skillPath, [
    '---',
    `name: ${skillName}`,
    'description: Use when Context Capsule read-only behavior or hook context injection is under review.',
    'use_when: Use when Context Capsule read-only behavior or hook context injection is under review.',
    '---',
    '',
    '# Context Capsule read-only',
    '',
    '## 触发条件',
    '- Context Capsule',
    '- hook context injection',
    '',
    '## 下次触发时先看什么',
    '- `.openprd/harness/run-state.json`',
    '',
  ].join('\n'));

  const indexPath = path.join(projectRoot, '.openprd', 'knowledge', 'index.json');
  const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  index.updatedAt = '2026-07-10T00:00:00.000Z';
  index.skills = [
    ...(index.skills ?? []).filter((entry) => entry.skillName !== skillName),
    {
      skillName,
      path: relativeSkillPath,
      description: 'Context Capsule read-only contract.',
      useWhen: 'Use when Context Capsule read-only behavior or hook context injection is under review.',
      categories: ['agent-misjudgment'],
      triggerHints: ['Context Capsule', 'hook context injection'],
      applicability: [],
      antiPatterns: [],
      reviewFirst: [],
      touchedFiles: ['src/run-harness.js'],
      evidencePaths: [],
      rootCauseLabels: [],
      adoption: {
        hitCount: 7,
        referencedCount: 5,
        injectedCount: 3,
        lastHitAt: '2026-07-10T00:00:00.000Z',
        lastReferencedAt: '2026-07-10T00:00:00.000Z',
        lastInjectedAt: '2026-07-10T00:00:00.000Z',
      },
    },
  ];
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

test('run --context is a pure read of business, knowledge, and run-state files', async (t) => {
  const projectRoot = await makeInitializedProject(t);
  await seedReadOnlyKnowledgeSkill(projectRoot);
  const before = await snapshotBusinessState(projectRoot);

  const context = await runWorkspace(projectRoot, {
    context: true,
    hookInject: true,
    message: '检查 Context Capsule 的 hook context injection 是否保持纯读取。',
  });

  const after = await snapshotBusinessState(projectRoot);
  assert.equal(context.readOnly, true);
  assert.equal(context.knowledgeSkills.summary.recorded, false);
  assert.equal(context.knowledgeSkills.summary.adoption, null);
  assert.ok(context.knowledgeSkills.matched.some((skill) => skill.skillName === 'context-capsule-read-only'));
  assert.deepEqual(after, before);
});

test('hookInject exposes compact ContextCapsule v1 text with full 800 then delta 250 delivery', async (t) => {
  const projectRoot = await makeInitializedProject(t);
  const options = {
    context: true,
    hookInject: true,
    message: '继续当前 Context Capsule 集成验证。',
  };

  const full = await runWorkspace(projectRoot, options);
  assert.equal(full.contextCapsule.schemaVersion, CONTEXT_CAPSULE_SCHEMA_VERSION);
  assert.equal(full.contextCapsule.delivery, 'full');
  assert.equal(full.contextCapsule.budget.limitTokens, 800);
  assert.ok(full.contextCapsule.budget.estimatedTokens <= 800);
  assert.equal(verifyContextCapsule(full.contextCapsule), true);
  assert.equal(typeof full.contextText, 'string');
  assert.match(full.contextText, /建议下一步:/);
  assert.ok(full.contextText.split('\n').length <= 12);
  assert.ok(Buffer.byteLength(full.contextText) < Buffer.byteLength(JSON.stringify(full.contextCapsule)));
  assert.doesNotMatch(full.contextText, /executionConfirmationChecklist|\.openprd\/harness\/run-state\.json|undefined/);

  const delta = await runWorkspace(projectRoot, {
    ...options,
    previousCapsule: full.contextCapsule,
  });
  assert.equal(delta.contextCapsule.schemaVersion, CONTEXT_CAPSULE_SCHEMA_VERSION);
  assert.equal(delta.contextCapsule.delivery, 'delta');
  assert.equal(delta.contextCapsule.budget.limitTokens, 250);
  assert.ok(delta.contextCapsule.budget.estimatedTokens <= 250);
  assert.equal(delta.contextCapsule.delta.previousCapsuleDigest, full.contextCapsule.digest);
  assert.equal(verifyContextCapsule(delta.contextCapsule), true);
  assert.equal(typeof delta.contextText, 'string');
  assert.ok(delta.contextText.split('\n').length <= 12);
  assert.doesNotMatch(delta.contextText, /executionConfirmationChecklist|\.openprd\/harness\/run-state\.json|undefined/);
});

test('runtime detection prefers hook payload evidence, then falls back to session evidence', async (t) => {
  const projectRoot = await makeInitializedProject(t);
  const harnessDir = path.join(projectRoot, '.openprd', 'harness');
  const runtimePath = path.join(harnessDir, 'runtime-environment.json');
  const hookStatePath = path.join(harnessDir, 'hook-state.json');
  const runtimeEnvironment = JSON.parse(await fs.readFile(runtimePath, 'utf8'));
  const hookState = JSON.parse(await fs.readFile(hookStatePath, 'utf8'));

  runtimeEnvironment.active = {
    activeClient: 'cursor',
    surface: 'cursor-editor',
    executionMode: 'interactive',
    sessionId: 'cursor-session-evidence',
    confidence: 1,
    observedCapabilities: ['cursor-session'],
  };
  hookState.runtimeEnvironment = {
    activeClient: 'codex',
    surface: 'codex-hook',
    executionMode: 'interactive',
    sessionId: 'codex-hook-evidence',
    confidence: 0.2,
    observedCapabilities: ['codex-hooks'],
  };
  await fs.writeFile(runtimePath, `${JSON.stringify(runtimeEnvironment, null, 2)}\n`);
  await fs.writeFile(hookStatePath, `${JSON.stringify(hookState, null, 2)}\n`);

  const hookPreferred = await runWorkspace(projectRoot, {
    context: true,
    hookInject: true,
    message: '核对当前 Agent 环境。',
  });
  assert.equal(hookPreferred.runtimeEnvironment.active.activeClient, 'codex');
  assert.equal(hookPreferred.runtimeEnvironment.active.surface, 'codex-hook');
  assert.equal(hookPreferred.runtimeEnvironment.active.sessionId, 'codex-hook-evidence');
  assert.deepEqual(
    hookPreferred.runtimeEnvironment.detectedRuntime.evidence.map((entry) => entry.source),
    ['hook-payload', 'session-binding'],
  );
  assert.equal(
    hookPreferred.contextCapsule.entries.find((entry) => entry.id === 'runtime-environment')?.value?.activeClient,
    'codex',
  );

  hookState.runtimeEnvironment = null;
  await fs.writeFile(hookStatePath, `${JSON.stringify(hookState, null, 2)}\n`);
  const sessionFallback = await runWorkspace(projectRoot, {
    context: true,
    hookInject: true,
    message: '核对当前 Agent 环境。',
  });
  assert.equal(sessionFallback.runtimeEnvironment.active.activeClient, 'cursor');
  assert.equal(sessionFallback.runtimeEnvironment.active.surface, 'cursor-editor');
  assert.deepEqual(
    sessionFallback.runtimeEnvironment.detectedRuntime.evidence.map((entry) => entry.source),
    ['session-binding'],
  );
});
