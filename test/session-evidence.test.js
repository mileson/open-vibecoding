import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildCleanEvidenceText,
  extractSessionEvidenceRecords,
  filterGenericFrameworkTokens,
  sanitizeEvidenceText,
} from '../src/session-evidence.js';
import { reviewKnowledgeWorkspace } from '../src/knowledge.js';

test('session evidence extractor keeps user evidence separate from AGENTS and system context', () => {
  const records = extractSessionEvidenceRecords([
    {
      role: 'system',
      content: 'You are Codex. AGENTS.md instructions for /repo. OpenPrd Harness skill hook context.',
    },
    {
      event_msg: {
        user_message: '请把 raw session 先抽成 clean evidence，再稳定推荐项目级沉淀。',
      },
    },
    {
      role: 'assistant',
      final_answer: '建议新增 sourceKind 过滤，并把 context-only 排除出用户诉求统计。',
    },
    {
      type: 'function_call',
      name: 'exec_command',
      text: 'node --test test/session-evidence.test.js',
    },
  ]);

  assert.equal(records[0].sourceKind, 'context-only');
  assert.equal(records[1].sourceKind, 'user-direct');
  assert.equal(records[2].sourceKind, 'assistant-final');
  assert.equal(records[3].sourceKind, 'tool-action');

  const cleanText = buildCleanEvidenceText(records);
  assert.match(cleanText, /raw session 先抽成 clean evidence/);
  assert.match(cleanText, /sourceKind 过滤/);
  assert.doesNotMatch(cleanText, /AGENTS\.md instructions/);
  assert.doesNotMatch(cleanText, /OpenPrd Harness skill hook context/);
});

test('sanitizeEvidenceText strips embedded instruction blocks before matching', () => {
  const sanitized = sanitizeEvidenceText([
    '用户实际目标：稳定推荐项目级沉淀。',
    '<INSTRUCTIONS>',
    'AGENTS.md instructions for /repo',
    '### Available skills',
    'openprd-router, openprd-quality',
    '</INSTRUCTIONS>',
    '最终结论：只读复盘先分层抽取证据。',
  ].join('\n'));

  assert.match(sanitized, /用户实际目标/);
  assert.match(sanitized, /最终结论/);
  assert.doesNotMatch(sanitized, /AGENTS\.md/);
  assert.doesNotMatch(sanitized, /Available skills/);
});

test('generic framework tokens cannot be the only knowledge match signal', () => {
  assert.deepEqual(
    filterGenericFrameworkTokens(['openprd', 'skill', 'agent', 'clean-evidence', 'session']),
    ['clean-evidence', 'session'],
  );
});

test('knowledge review can create an evidence-only candidate from clean session records', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-evidence-'));
  const records = extractSessionEvidenceRecords([
    {
      role: 'system',
      content: 'AGENTS.md instructions. OpenPrd Harness. skill list.',
    },
    {
      event_msg: {
        user_message: '复盘时 raw session 关键词被 AGENTS 和 system prompt 污染，需要先分层抽证据。',
      },
    },
    {
      role: 'assistant',
      final_answer: '项目级经验应只基于 user-direct、assistant-final、tool-action 证据推荐给用户。',
    },
  ]);

  const result = await reviewKnowledgeWorkspace(projectRoot, {
    title: 'raw session 证据污染隔离',
    evidenceRecords: records,
    allowEvidenceOnly: true,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.sourceKind, 'session-evidence-review');
  assert.match(result.summary, /只读证据/);
  assert.match(result.summary, /没有把 AGENTS、system 或 tool schema 命中当成用户证据/);
  assert.doesNotMatch(result.userFacingExperience.message, /要我把它一起保留下来吗/);
  assert.equal(result.userFacingExperience.shouldAskUser, false);

  const candidate = JSON.parse(await fs.readFile(result.files.candidate, 'utf8'));
  assert.equal(candidate.sourceKind, 'session-evidence-review');
  assert.deepEqual(candidate.touchedFiles, []);
  assert.ok(candidate.evidenceOnly ?? candidate.sourceKind === 'session-evidence-review');
});
