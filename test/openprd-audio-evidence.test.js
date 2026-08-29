import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { CANONICAL_SKILLS } from '../src/agent-canonical-content.js';
import { detectMediaEvidence } from '../src/quality.js';
import {
  initWorkspace,
  makeTempProject,
  setupAgentIntegrationWorkspace,
  verifyQualityWorkspace,
  writeMinimalChange,
} from './helpers/openprd-test-helpers.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const ARTIFACT_FIXTURES = [
  {
    id: 'baseline-measurement',
    path: '.openprd/quality/evidence/baseline.json',
    role: 'baseline-measurement',
    text: '{"timestamp-start-p95":480}\n',
  },
  {
    id: 'final-measurement',
    path: '.openprd/quality/evidence/final.json',
    role: 'final-measurement',
    text: '{"timestamp-start-p95":80}\n',
  },
  {
    id: 'timing-annotation',
    path: '.openprd/quality/evidence/timing-reference.json',
    role: 'annotation',
    text: '{"reference":"human","toleranceMs":150}\n',
  },
  {
    id: 'baseline-review',
    path: '.openprd/quality/evidence/baseline.html',
    role: 'review-html',
    text: '<!doctype html><title>Baseline review</title>\n',
  },
  {
    id: 'comparison-review',
    path: '.openprd/quality/evidence/comparison.html',
    role: 'review-html',
    text: '<!doctype html><title>Comparison review</title>\n',
  },
].map((fixture) => ({
  ...fixture,
  sha256: createHash('sha256').update(fixture.text).digest('hex'),
}));

function evidenceArtifact(id) {
  return ARTIFACT_FIXTURES.find((fixture) => fixture.id === id);
}

function mediaBundle(taskId = 'T001.01', overrides = {}) {
  return {
    schema: 'openprd.media-evidence.v1',
    status: 'comparison-complete',
    task: { id: taskId, title: '验证最终音频与字幕' },
    claimScopes: ['transcription-timing'],
    claimResults: [{
      scope: 'transcription-timing',
      status: 'pass',
      evidenceRefs: ['final-measurement'],
      remainingRisk: null,
    }],
    evidenceArtifacts: ARTIFACT_FIXTURES.map(({ id, path: artifactPath, sha256, role }) => ({
      id,
      path: artifactPath,
      sha256,
      role,
    })),
    source: {
      path: 'fixtures/source.mov',
      sha256: SHA_A,
      provenance: 'user reproduction fixture',
      durationSeconds: 42.8,
      trackIndex: 1,
      codec: 'aac',
      sampleRateHz: 48000,
      channels: 2,
      privacy: { containsPersonalData: false, reportRedacted: false },
    },
    measurementPolicy: {
      tools: [{ name: 'media-inspector', version: '1.0.0', configDigest: SHA_A }],
      timebase: 'seconds',
      windowPolicy: 'same windows',
      finalRemeasured: true,
      sameSettings: true,
    },
    baseline: {
      measurements: [{ id: 'timestamp-start-p95', value: 480, unit: 'ms', method: 'human cue reference comparison' }],
      rawEvidence: ['baseline-measurement'],
    },
    hypotheses: [{
      id: 'H1',
      claim: 'export timebase mapping introduces drift',
      evidenceRefs: ['baseline-measurement'],
      alternatives: ['ASR timestamp drift'],
      predictedEffect: 'final cue start error decreases',
      rollbackPlan: 'restore the previous timebase mapping',
    }],
    finalOutput: {
      path: 'artifacts/final.mov',
      sha256: SHA_B,
      mediaStructure: {
        container: 'mov',
        durationSeconds: 42.8,
        trackIndex: 1,
        codec: 'aac',
        sampleRateHz: 48000,
        channels: 2,
        timebase: 'seconds',
      },
      extraction: { method: 'extract from final container', cacheReused: false },
      measurements: [{ id: 'timestamp-start-p95', value: 80, unit: 'ms', method: 'human cue reference comparison' }],
      rawEvidence: ['final-measurement'],
    },
    comparison: {
      metricDeltas: [{ id: 'timestamp-start-p95', baseline: 480, final: 80, unit: 'ms', assessment: 'expected-improvement' }],
      regressions: [],
    },
    transcription: {
      goldTranscriptPath: null,
      goldTranscriptSha256: null,
      timingEvaluation: {
        referenceType: 'human-reference',
        annotationSourcePath: evidenceArtifact('timing-annotation').path,
        annotationSourceSha256: evidenceArtifact('timing-annotation').sha256,
        toleranceMs: 150,
        absoluteStartErrorMs: { p50: 40, p95: 80, max: 120 },
        absoluteEndErrorMs: { p50: 55, p95: 90, max: 135 },
      },
    },
    artifacts: {
      baselineHtml: 'baseline-review',
      comparisonHtml: 'comparison-review',
    },
    unknownClaims: ['transcription-accuracy is outside this bundle without a gold transcript'],
    ...overrides,
  };
}

function mediaEvidenceFiles(bundle) {
  return [
    {
      path: '.openprd/quality/evidence/media.json',
      text: JSON.stringify(bundle),
    },
    ...ARTIFACT_FIXTURES.map(({ path: artifactPath, text, sha256 }) => ({
      path: artifactPath,
      text,
      sha256,
    })),
  ];
}

test('canonical audio evidence contract distinguishes real media from subtitle-only UI', async () => {
  const entries = CANONICAL_SKILLS.filter((skill) => skill.id === 'openprd-audio-evidence');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceSkill, 'openprd-audio-evidence');

  const skill = await fs.readFile(path.join(REPO_ROOT, 'skills', 'openprd-audio-evidence', 'SKILL.md'), 'utf8');
  const router = await fs.readFile(path.join(REPO_ROOT, 'skills', 'openprd-router', 'SKILL.md'), 'utf8');
  const schema = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'skills', 'openprd-audio-evidence', 'references', 'media-evidence.schema.json'), 'utf8'));
  assert.match(skill, /name: openprd-audio-evidence/);
  assert.doesNotMatch(skill, /TODO/);
  assert.match(skill, /真实音频/);
  assert.match(skill, /ASR\/语音识别\/转写/);
  assert.match(skill, /最终交付媒体重新提取/);
  assert.match(skill, /纯字幕文案、翻译、错别字/);
  assert.match(router, /真实音频.*ASR\/语音识别\/转写.*\$openprd-audio-evidence/);
  assert.match(router, /纯字幕 UI.*\$openprd-frontend-design.*不触发.*\$openprd-audio-evidence/);
  assert.equal(schema.title, 'OpenPrd media evidence bundle v1');
  assert.equal(schema.properties.schema.const, 'openprd.media-evidence.v1');
  assert.ok(schema.$defs.finalMediaOutput.required.includes('mediaStructure'));
  assert.ok(schema.$defs.finalMediaOutput.required.includes('extraction'));
  assert.ok(schema.required.includes('evidenceArtifacts'));
  assert.equal(schema.allOf[0].then.properties.comparison.properties.regressions.maxItems, 0);
  assert.ok(schema.properties.hypotheses.items.required.includes('rollbackPlan'));
  assert.ok(schema.$defs.manualReview.required.includes('acceptanceRule'));
  assert.ok(schema.$defs.renderedSubtitles.required.includes('extractionMethod'));
});

test('setup propagates audio evidence guidance and valid JSON schema across supported adapters', async () => {
  const project = await makeTempProject();
  const result = await setupAgentIntegrationWorkspace(project, { tools: 'all' });
  const skillPaths = [
    '.codex/skills/openprd-audio-evidence/SKILL.md',
    '.claude/skills/openprd-audio-evidence/SKILL.md',
  ];
  const schemaPaths = [
    '.codex/skills/openprd-audio-evidence/references/media-evidence.schema.json',
    '.claude/skills/openprd-audio-evidence/references/media-evidence.schema.json',
  ];
  const [codexSkill, claudeSkill] = await Promise.all(skillPaths.map((file) => fs.readFile(path.join(project, file), 'utf8')));
  const [codexSchemaText, claudeSchemaText] = await Promise.all(schemaPaths.map((file) => fs.readFile(path.join(project, file), 'utf8')));
  assert.equal(codexSkill, claudeSkill);
  assert.match(codexSkill, /adapter=shared/);
  assert.match(codexSkill, /source=openprd-audio-evidence/);
  assert.match(codexSkill, /最终交付媒体重新提取/);
  assert.equal(codexSchemaText, claudeSchemaText);
  const generatedSchema = JSON.parse(codexSchemaText);
  assert.match(generatedSchema.$comment, /OPENPRD:GENERATED/);
  assert.match(generatedSchema.$comment, /source=openprd-audio-evidence:reference:media-evidence\.schema\.json/);
  assert.equal(generatedSchema.properties.schema.const, 'openprd.media-evidence.v1');

  const [codexRouter, claudeRouter, cursorRule] = await Promise.all([
    fs.readFile(path.join(project, '.codex', 'skills', 'openprd-router', 'SKILL.md'), 'utf8'),
    fs.readFile(path.join(project, '.claude', 'skills', 'openprd-router', 'SKILL.md'), 'utf8'),
    fs.readFile(path.join(project, '.cursor', 'rules', 'openprd.mdc'), 'utf8'),
  ]);
  for (const artifact of [codexRouter, claudeRouter, cursorRule]) {
    assert.match(artifact, /openprd-audio-evidence/);
    assert.match(artifact, /纯字幕.*不.*触发|纯字幕.*不自动触发/);
  }
  const managedPaths = new Set(result.manifest.managedFiles.map((entry) => entry.path));
  for (const file of [...skillPaths, ...schemaPaths]) {
    assert.equal(managedPaths.has(file), true, file);
  }
});

test('media evidence aggregation reuses test-strategy and rejects stale or unsupported claims', () => {
  const strategy = {
    tasks: [{ id: 'T001.01', scope: 'media-flow', layers: ['integration', 'manual'], waiver: null }],
  };
  const passedBundle = mediaBundle();
  const passed = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(passedBundle),
  });
  assert.equal(passed.status, 'pass');
  assert.equal(passed.bundles.length, 1);

  const staleBundle = mediaBundle('T999.99');
  const stale = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(staleBundle).map((file, index) => (
      index === 0 ? { ...file, path: '.openprd/quality/evidence/old-media.json' } : file
    )),
  });
  assert.equal(stale.status, 'needs-evidence');
  assert.match(stale.warnings.join('\n'), /task\.id/);

  const unsupportedAccuracyBundle = mediaBundle('T001.01', {
    claimScopes: ['transcription-accuracy'],
    claimResults: [{
      scope: 'transcription-accuracy',
      status: 'pass',
      evidenceRefs: ['final-measurement'],
      remainingRisk: null,
    }],
    unknownClaims: [],
  });
  const unsupportedAccuracy = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(unsupportedAccuracyBundle),
  });
  assert.equal(unsupportedAccuracy.status, 'needs-attention');
  assert.match(unsupportedAccuracy.warnings.join('\n'), /gold transcript.*unknown/);

  const reusedCacheBundle = mediaBundle('T001.01', {
    finalOutput: {
      ...mediaBundle().finalOutput,
      extraction: { method: 'reused intermediate cache', cacheReused: true },
    },
  });
  const reusedCache = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(reusedCacheBundle),
  });
  assert.equal(reusedCache.status, 'needs-attention');
  assert.match(reusedCache.warnings.join('\n'), /最终媒体重新提取/);

  const changedSettingsBundle = mediaBundle('T001.01', {
    measurementPolicy: {
      ...mediaBundle().measurementPolicy,
      sameSettings: false,
      settingsChangeReason: 'measurement settings changed without rerunning the baseline',
    },
  });
  const changedSettings = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(changedSettingsBundle),
  });
  assert.equal(changedSettings.status, 'needs-attention');
  assert.match(changedSettings.warnings.join('\n'), /同口径复测/);

  const unknownTimingBundle = mediaBundle('T001.01', {
    transcription: {
      ...mediaBundle().transcription,
      timingEvaluation: {
        referenceType: 'unknown',
        annotationSourcePath: null,
        annotationSourceSha256: null,
        toleranceMs: null,
        absoluteStartErrorMs: { p50: null, p95: null, max: null },
        absoluteEndErrorMs: { p50: null, p95: null, max: null },
      },
    },
  });
  const unknownTiming = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(unknownTimingBundle),
  });
  assert.equal(unknownTiming.status, 'needs-attention');

  const incompleteClaimsBundle = mediaBundle('T001.01', {
    claimScopes: ['transcription-timing', 'rendered-subtitles'],
  });
  const incompleteClaims = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(incompleteClaimsBundle),
  });
  assert.equal(incompleteClaims.status, 'needs-attention');
  assert.match(incompleteClaims.warnings.join('\n'), /核心合同/);
});

test('media evidence completion rejects unknown scopes, generic waivers, regressions, and fictional artifacts', () => {
  const strategy = {
    tasks: [{ id: 'T001.01', scope: 'media-flow', layers: ['integration', 'manual'], waiver: null }],
  };

  const unknownScopeBundle = mediaBundle('T001.01', {
    claimScopes: ['not-a-real-scope'],
    claimResults: [{
      scope: 'not-a-real-scope',
      status: 'pass',
      evidenceRefs: ['final-measurement'],
      remainingRisk: null,
    }],
  });
  const unknownScope = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(unknownScopeBundle),
  });
  assert.equal(unknownScope.status, 'needs-attention');
  assert.equal(unknownScope.bundles[0].comparisonComplete, false);

  const genericWaiver = detectMediaEvidence({
    testStrategy: {
      tasks: [{
        id: 'T001.01',
        scope: 'media-flow',
        layers: ['integration', 'manual'],
        waiver: '没有样本',
      }],
    },
    evidenceFiles: [],
  });
  assert.equal(genericWaiver.required, true);
  assert.equal(genericWaiver.status, 'needs-evidence');
  assert.match(genericWaiver.warnings.join('\n'), /没有样本.*blocked/);

  const regressionBundle = mediaBundle('T001.01', {
    comparison: {
      metricDeltas: [{
        id: 'timestamp-start-p95',
        baseline: 480,
        final: 620,
        unit: 'ms',
        assessment: 'regression',
      }],
      regressions: ['timestamp-start-p95 worsened'],
    },
  });
  const regression = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(regressionBundle),
  });
  assert.equal(regression.status, 'needs-attention');
  assert.equal(regression.bundles[0].comparisonComplete, false);

  const fictionalArtifactBundle = mediaBundle('T001.01', {
    claimResults: [{
      scope: 'transcription-timing',
      status: 'pass',
      evidenceRefs: ['does-not-exist'],
      remainingRisk: null,
    }],
    evidenceArtifacts: mediaBundle().evidenceArtifacts.map((artifact, index) => (
      index === 0 ? { ...artifact, sha256: SHA_B } : artifact
    )),
  });
  const fictionalArtifact = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(fictionalArtifactBundle),
  });
  assert.equal(fictionalArtifact.status, 'needs-attention');
  assert.equal(fictionalArtifact.bundles[0].evidenceArtifactsValid, false);
  assert.match(fictionalArtifact.warnings.join('\n'), /证据引用.*摘要不匹配/);

  const invalidRolesBundle = mediaBundle('T001.01', {
    evidenceArtifacts: mediaBundle().evidenceArtifacts.map((artifact) => ({
      ...artifact,
      role: 'not-a-schema-role',
    })),
  });
  const invalidRoles = detectMediaEvidence({
    testStrategy: strategy,
    evidenceFiles: mediaEvidenceFiles(invalidRolesBundle),
  });
  assert.equal(invalidRoles.status, 'needs-attention');
  assert.equal(invalidRoles.bundles[0].contractValid, false);
  assert.equal(invalidRoles.bundles[0].comparisonComplete, false);
});

test('quality report requires media evidence through the existing test-strategy gate', async () => {
  const project = await makeTempProject();
  await initWorkspace(project, { templatePack: 'consumer' });
  await writeMinimalChange(project, 'media-evidence', {
    title: 'Media Evidence',
    requirementTitle: 'Validate final media evidence',
    taskTitle: 'Validate ASR timestamps against final audio',
  });
  await fs.writeFile(path.join(project, '.openprd', 'state', 'changes.json'), `${JSON.stringify({
    version: 1,
    activeChange: 'media-evidence',
    changes: {
      'media-evidence': { id: 'media-evidence', status: 'active' },
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(project, '.openprd', 'changes', 'media-evidence', 'tasks.md'), [
    '# Tasks',
    '',
    '- [x] T001.01 Validate ASR timestamps against final audio',
    '  - type: verification',
    '  - done: final media was re-extracted and measured',
    '  - verify: inspect media evidence bundle',
    '  - test-layer: integration, manual',
    '  - test-size: medium',
    '  - test-scope: media-flow',
    '  - evidence-profile: audio-asr',
    '  - evidence-plan: openprd.media-evidence.v1 baseline and final-media comparison',
    '  - evidence: .openprd/quality/evidence/media.json',
    '',
  ].join('\n'));
  await fs.mkdir(path.join(project, '.openprd', 'quality', 'evidence'), { recursive: true });
  await fs.writeFile(
    path.join(project, '.openprd', 'quality', 'evidence', 'media.json'),
    `${JSON.stringify(mediaBundle(), null, 2)}\n`,
  );
  for (const fixture of ARTIFACT_FIXTURES) {
    await fs.writeFile(path.join(project, fixture.path), fixture.text);
  }

  const quality = await verifyQualityWorkspace(project);
  assert.ok(quality.report.qualityPolicy.scenarioTags.includes('media'));
  assert.ok(quality.report.qualityPolicy.requiredGates.includes('test-strategy'));
  assert.equal(quality.report.gates.some((gate) => gate.id === 'media-evidence'), false);
  assert.equal(quality.report.evalHarness.testStrategy.mediaEvidence.status, 'pass');
  assert.ok(quality.report.evidenceLedger['test-strategy'].sources.some((source) => source.source === 'openprd-media-evidence'));
  const html = await fs.readFile(quality.htmlPath, 'utf8');
  assert.match(html, /音频与转写证据|媒体证据已闭环/);
  assert.match(html, /openprd\.media-evidence\.v1/);
});
