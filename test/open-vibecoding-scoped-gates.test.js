import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createApprovalRecord,
  createEvidenceRecord,
  createGateDefinition,
  evaluateScopedGate,
} from '../src/gates/index.js';

const NOW = new Date('2026-07-10T12:00:00.000Z');

function fixture() {
  const gate = createGateDefinition({
    gateId: 'gate-release-project-a',
    scope: { type: 'operation', id: 'project-a:release:0.1.20' },
    operation: 'release',
    requiredEvidence: [{ kind: 'test-report', minCount: 1, maxAgeMs: 60_000 }],
    approval: { required: true, subjectDigest: 'sha256:release-plan-a', consumeOnPass: true },
  });
  const evidence = createEvidenceRecord({
    evidenceId: 'evidence-tests-a',
    scope: gate.scope,
    operation: 'release',
    kind: 'test-report',
    source: '.open-vibecoding/harness/test-reports/release.json',
    contentDigest: 'sha256:tests-a',
    collectedAt: '2026-07-10T11:59:30.000Z',
  });
  const approval = createApprovalRecord({
    approvalId: 'approval-release-a',
    scope: gate.scope,
    operation: 'release',
    subjectDigest: 'sha256:release-plan-a',
    actor: { type: 'user', id: 'owner' },
    issuedAt: '2026-07-10T11:59:00.000Z',
    expiresAt: '2026-07-10T12:05:00.000Z',
  });
  return { gate, evidence, approval };
}

test('scoped gate passes only with current evidence and explicit matching approval ID', () => {
  const { gate, evidence, approval } = fixture();
  const result = evaluateScopedGate({
    gate,
    evidence: [evidence],
    approvals: [approval],
    approvalId: approval.approvalId,
  }, { clock: () => NOW });
  assert.equal(result.status, 'pass');
  assert.equal(result.approvalId, approval.approvalId);
  assert.deepEqual(result.approvalConsumption, {
    approvalId: approval.approvalId,
    nextStatus: 'consumed',
  });
  assert.match(result.decisionId, /^decision_/);
});

test('a matching sentence or approval record cannot replace an explicit approval ID', () => {
  const { gate, evidence, approval } = fixture();
  const result = evaluateScopedGate({ gate, evidence: [evidence], approvals: [approval] }, { clock: () => NOW });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.reasons.map((item) => item.code), ['approval-id-required']);
});

test('approval for another lane or operation cannot spill into this gate', () => {
  const { gate, evidence, approval } = fixture();
  const otherLane = createApprovalRecord({
    ...approval,
    approvalId: 'approval-other-lane',
    scope: { type: 'lane', id: 'lane-b' },
  });
  const wrongOperation = createApprovalRecord({
    ...approval,
    approvalId: 'approval-other-operation',
    operation: 'publish',
  });
  const scopeResult = evaluateScopedGate({
    gate,
    evidence: [evidence],
    approvals: [otherLane],
    approvalId: otherLane.approvalId,
  }, { clock: () => NOW });
  const operationResult = evaluateScopedGate({
    gate,
    evidence: [evidence],
    approvals: [wrongOperation],
    approvalId: wrongOperation.approvalId,
  }, { clock: () => NOW });
  assert.equal(scopeResult.reasons[0].code, 'approval-scope-mismatch');
  assert.equal(operationResult.reasons[0].code, 'approval-operation-mismatch');
});

test('expired, revoked, stale, and cross-scope evidence remains visible but cannot pass', () => {
  const { gate, evidence, approval } = fixture();
  const records = [
    { ...evidence, evidenceId: 'revoked', status: 'revoked' },
    { ...evidence, evidenceId: 'expired', validUntil: '2026-07-10T11:59:59.000Z' },
    { ...evidence, evidenceId: 'wrong-scope', scope: { type: 'operation', id: 'project-b:release:0.1.20' } },
    { ...evidence, evidenceId: 'stale', collectedAt: '2026-07-10T11:00:00.000Z' },
  ];
  const result = evaluateScopedGate({
    gate,
    evidence: records,
    approvals: [approval],
    approvalId: approval.approvalId,
  }, { clock: () => NOW });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasons[0].code, 'evidence-required');
  assert.deepEqual(result.rejectedEvidence.map((item) => item.code).sort(), [
    'evidence-expired',
    'evidence-revoked',
    'evidence-scope-mismatch',
  ]);
});

test('approval is bound to the reviewed subject digest', () => {
  const { gate, evidence, approval } = fixture();
  const result = evaluateScopedGate({
    gate,
    evidence: [evidence],
    approvals: [{ ...approval, subjectDigest: 'sha256:different-plan' }],
    approvalId: approval.approvalId,
  }, { clock: () => NOW });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reasons[0].code, 'approval-subject-mismatch');
});
