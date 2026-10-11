import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createKnowledgeDraft,
  deprecateKnowledgeEntry,
  promoteKnowledgeEntry,
  queryKnowledge,
  supersedeKnowledgeEntry,
  validateKnowledgeEntry,
} from '../src/knowledge-v3/index.js';

const CLOCK = () => new Date('2026-07-10T12:00:00.000Z');

function draft(id = 'knowledge-a', overrides = {}) {
  return createKnowledgeDraft({
    knowledgeId: id,
    scope: { type: 'project', id: 'project-a' },
    title: '升级前检查符号链接',
    statement: '写入生成文件前检查所有祖先路径，命中符号链接时先备份并物化。',
    authority: 90,
    tags: ['upgrade', 'symlink'],
    evidence: [{ ref: 'report.json', digest: 'sha256:evidence-a', kind: 'test-report' }],
    ...overrides,
  }, { clock: CLOCK });
}

test('knowledge promotion requires evidence, reviewer, and an explicit approval ID', () => {
  const noEvidence = draft('knowledge-no-evidence', { evidence: [] });
  assert.throws(() => promoteKnowledgeEntry(noEvidence, {
    reviewer: { type: 'user', id: 'owner' },
    approvalId: 'approval-1',
  }, { clock: CLOCK }), /证据/);
  assert.throws(() => promoteKnowledgeEntry(draft(), {
    approvalId: 'approval-1',
  }, { clock: CLOCK }), /reviewer/);
  const active = promoteKnowledgeEntry(draft(), {
    reviewer: { type: 'user', id: 'owner' },
    approvalId: 'approval-1',
  }, { clock: CLOCK });
  assert.equal(active.status, 'active');
  assert.equal(validateKnowledgeEntry(active, { requireReviewer: true }).ok, true);
});

test('deprecate and supersede keep approval-backed lifecycle history', () => {
  const active = promoteKnowledgeEntry(draft(), {
    reviewer: { type: 'user', id: 'owner' },
    approvalId: 'approval-promote-a',
  }, { clock: CLOCK });
  const deprecated = deprecateKnowledgeEntry(active, {
    reason: '新协议已替代旧做法',
    approvalId: 'approval-deprecate-a',
  }, { clock: CLOCK });
  assert.equal(deprecated.status, 'deprecated');

  const replacement = promoteKnowledgeEntry(draft('knowledge-b', {
    statement: '升级写入使用 preimage 备份、原子替换和可验证回滚。',
    supersedes: active.knowledgeId,
  }), {
    reviewer: { type: 'user', id: 'owner' },
    approvalId: 'approval-promote-b',
  }, { clock: CLOCK });
  const chain = supersedeKnowledgeEntry(active, replacement, {
    approvalId: 'approval-supersede-a',
  }, { clock: CLOCK });
  assert.equal(chain.previous.status, 'superseded');
  assert.equal(chain.previous.supersededBy, replacement.knowledgeId);
  assert.equal(chain.replacement.supersedes, active.knowledgeId);
});

test('knowledge query is scope-safe, lifecycle-aware, and token-budgeted', () => {
  const active = promoteKnowledgeEntry(draft(), {
    reviewer: { type: 'user', id: 'owner' },
    approvalId: 'approval-promote-a',
  }, { clock: CLOCK });
  const wrongScope = { ...active, knowledgeId: 'knowledge-wrong', scope: { type: 'project', id: 'project-b' } };
  const expired = { ...active, knowledgeId: 'knowledge-expired', validUntil: '2026-07-10T11:59:59.000Z' };
  const deprecated = { ...active, knowledgeId: 'knowledge-old', status: 'deprecated' };
  const result = queryKnowledge([wrongScope, expired, deprecated, active], {
    scope: { type: 'project', id: 'project-a' },
    query: '升级 symlink',
    tokenBudget: 200,
    limit: 2,
  }, { clock: CLOCK });
  assert.deepEqual(result.included.map((item) => item.knowledgeId), ['knowledge-a']);
  assert.deepEqual(result.excluded.map((item) => item.reason).sort(), ['expired', 'scope-mismatch', 'status-deprecated']);
  assert.ok(result.usedTokens <= result.tokenBudget);
});

test('knowledge query explains budget exclusion instead of silently truncating', () => {
  const active = promoteKnowledgeEntry(draft(), {
    reviewer: { type: 'user', id: 'owner' },
    approvalId: 'approval-promote-a',
  }, { clock: CLOCK });
  const result = queryKnowledge([active], {
    scope: active.scope,
    query: '升级',
    tokenBudget: 1,
  }, { clock: CLOCK });
  assert.equal(result.included.length, 0);
  assert.equal(result.excluded[0].reason, 'token-budget');
});
