import test from 'node:test';
import assert from 'node:assert/strict';

import { printQualityResult, printRunResult } from '../src/cli/print.js';
import { printKnowledgeReview, printKnowledgeSkillMatches } from '../src/cli/shared-print.js';

function captureLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = originalLog;
  }
  return logs.join('\n');
}

function buildKnowledgeReview(overrides = {}) {
  return {
    ok: true,
    candidateId: 'candidate-turn-123',
    summary: '本轮围绕 2 个可沉淀文件生成回顾。',
    categories: ['hidden-debug-knowledge', 'agent-misjudgment'],
    files: {
      draftSkill: '/tmp/drafts/knowledge/SKILL.md',
      candidateDir: '/tmp/candidates/candidate-turn-123',
    },
    suggestedLearnCommand: 'openprd quality . --learn --from .openprd/knowledge/candidates/candidate-turn-123',
    userFacingExperience: {
      message: [
        '这次我观察到一个以后可能重复出现的情况：',
        '本次调整里，项目经验回顾已经形成了稳定结构，不需要再让用户反向定义是哪条经验。',
        '',
        '我计划保留一条项目经验：',
        '以后收工时优先先讲清楚本次情况、计划保留的经验和复用方式，再询问是否保留。',
        '',
        '以后如果再遇到类似任务，我会优先按这套结构来收口，减少技术黑话。',
        '这条经验只会保留在当前项目里。',
        '要我把它一起保留下来吗？',
      ].join('\n'),
    },
    ...overrides,
  };
}

function buildKnowledgeSkills(overrides = {}) {
  return {
    matched: [
      {
        skillName: 'billing-trace-rollback',
        useWhen: 'Use when the current task touches billing-api.js, traceId propagation, or webhook rollback and should reuse this verified project diagnosis path.',
        reviewFirst: ['`src/billing-api.js`', '`docs/basic/backend-structure.md`'],
        antiPatterns: ['如果只是文件名相似，但当前目标不同，不要直接套用。'],
        touchedFiles: ['src/billing-api.js'],
        adoption: {
          hitCount: 3,
          referencedCount: 3,
          injectedCount: 2,
        },
        matchSummary: '命中 traceId 透传 / webhook 回滚 / src/billing-api.js',
      },
    ],
    mandatoryCheck: {
      required: true,
      mode: 'prompt-rerank',
      title: '先做项目经验检查，再决定是否复用',
      summary: '这些项目经验只是候选，不代表都要复用；先按当前目标、阶段和验证方式判断。',
      instructions: [
        '先判断当前任务真正要解决什么，再看候选经验。',
        '如果只是文件名相似，但当前目标不同，就不要套用。',
      ],
      focusSignals: ['当前目标: 修 traceId 透传'],
      candidates: [
        {
          skillName: 'billing-trace-rollback',
        },
      ],
    },
    summary: {
      matched: 1,
      reviewRequired: true,
      reviewMode: 'prompt-rerank',
    },
    ...overrides,
  };
}

test('printKnowledgeReview prefers user-facing experience copy', () => {
  const output = captureLogs(() => {
    printKnowledgeReview(buildKnowledgeReview());
  });

  assert.match(output, /项目经验回顾:/);
  assert.match(output, /这次我观察到一个以后可能重复出现的情况：/);
  assert.match(output, /要我把它一起保留下来吗？/);
  assert.doesNotMatch(output, /项目经验草案:/);
  assert.doesNotMatch(output, /Draft Skill:/);
  assert.doesNotMatch(output, /Promote:/);
});

test('printKnowledgeReview falls back to technical summary when user-facing copy is missing', () => {
  const output = captureLogs(() => {
    printKnowledgeReview(buildKnowledgeReview({
      userFacingExperience: null,
    }));
  });

  assert.match(output, /项目经验草案: candidate-turn-123/);
  assert.match(output, /摘要: 本轮围绕 2 个可沉淀文件生成回顾。/);
  assert.match(output, /Draft Skill: \/tmp\/drafts\/knowledge\/SKILL\.md/);
  assert.match(output, /Promote: openprd quality \. --learn --from/);
});

test('printKnowledgeSkillMatches prints candidate framing and mandatory knowledge check guidance', () => {
  const output = captureLogs(() => {
    printKnowledgeSkillMatches(buildKnowledgeSkills());
  });

  assert.match(output, /项目级经验候选: 找到 1 条/);
  assert.match(output, /先做项目经验检查，再决定是否复用/);
  assert.match(output, /billing-trace-rollback/);
  assert.match(output, /适用时机: the current task touches billing-api\.js/i);
  assert.match(output, /不要直接套用:/);
  assert.doesNotMatch(output, /项目级 Skill: 命中 1 个/);
});

test('printQualityResult shows user-facing knowledge review copy during verify output', () => {
  const output = captureLogs(() => {
    printQualityResult({
      ok: true,
      action: 'quality-verify',
      report: {
        summary: { status: '通过' },
        readiness: {
          ok: true,
          productionReady: true,
          enforcement: 'blocking',
          attentionGates: [],
        },
        qualityPolicy: {
          scenarioTags: ['agent'],
          requiredGates: ['knowledge'],
        },
        gates: [],
      },
      reportPath: '/tmp/eval.json',
      htmlPath: '/tmp/eval.html',
      knowledgeReview: buildKnowledgeReview(),
      errors: [],
    }, false);
  });

  assert.match(output, /OpenPrd quality diagnostics: 完成/);
  assert.match(output, /项目经验回顾:/);
  assert.match(output, /以后收工时优先先讲清楚本次情况、计划保留的经验和复用方式/);
  assert.doesNotMatch(output, /项目经验草案:/);
});

test('printRunResult shows user-facing knowledge review copy during verify output', () => {
  const output = captureLogs(() => {
    printRunResult({
      action: 'run-verify',
      readiness: {
        taskReady: true,
        workspaceReady: true,
        qualityProductionReady: true,
      },
      checks: [],
      warnings: [],
      errors: [],
      knowledgeReview: buildKnowledgeReview(),
    }, false);
  });

  assert.match(output, /OpenPrd run verify: 通过/);
  assert.match(output, /项目经验回顾:/);
  assert.match(output, /这条经验只会保留在当前项目里。/);
  assert.doesNotMatch(output, /项目经验草案:/);
});
