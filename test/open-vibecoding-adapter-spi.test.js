import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPABILITY_STATUS,
  adapterContractDigest,
  createAdapter,
  describeCapabilities,
  detectRuntime,
} from '../src/adapters/index.js';

test('adapter SPI exposes one stable contract for all supported clients', () => {
  const adapters = ['codex', 'claude', 'cursor'].map((client) => createAdapter(client));
  for (const adapter of adapters) {
    assert.equal(adapter.contractVersion, 1);
    assert.equal(typeof adapter.describeCapabilities, 'function');
    assert.equal(typeof adapter.normalizeLifecycleEvent, 'function');
    assert.equal(typeof adapter.renderDecision, 'function');
  }
  assert.match(adapterContractDigest(), /^[a-f0-9]{64}$/);
});

test('runtime detection prefers hook evidence over config probes and self reports', () => {
  const detected = detectRuntime([
    { source: 'agent-self-report', client: 'claude', confidence: 1 },
    { source: 'config-probe', client: 'cursor', confidence: 1 },
    {
      source: 'hook-payload',
      client: 'codex',
      surface: 'desktop',
      sessionId: 'session-1',
      observedCapabilities: ['computerUse', 'imageGeneration'],
    },
  ]);
  assert.equal(detected.activeClient, 'codex');
  assert.equal(detected.sessionId, 'session-1');
  assert.equal(detected.capabilityEnvelope.capabilities.computerUse, CAPABILITY_STATUS.NATIVE);
  assert.equal(detected.capabilityEnvelope.capabilities.currentThreadMessaging, CAPABILITY_STATUS.SURFACE_DEPENDENT);
});

test('capability envelopes report gaps instead of pretending lifecycle parity', () => {
  const codex = describeCapabilities('codex');
  const claude = describeCapabilities('claude');
  const cursor = describeCapabilities('cursor');
  assert.equal(codex.capabilities.hooks, CAPABILITY_STATUS.NATIVE);
  assert.equal(claude.capabilities.hooks, CAPABILITY_STATUS.UNSUPPORTED);
  assert.equal(cursor.capabilities.hooks, CAPABILITY_STATUS.UNSUPPORTED);
  assert.equal(Object.hasOwn(claude.capabilities, 'maxRecommendedContext'), false);
});

test('normalized lifecycle events and rendered decisions keep semantic parity', () => {
  for (const client of ['codex', 'claude', 'cursor']) {
    const adapter = createAdapter(client);
    const event = adapter.normalizeLifecycleEvent({
      event: 'UserPromptSubmit',
      sessionId: 's1',
      timestamp: '2026-07-10T00:00:00.000Z',
    });
    assert.equal(event.eventType, 'prompt.submitted');
    assert.equal(event.client, client);
    const decision = adapter.renderDecision({ decision: 'allow', approvalId: 'approval-1' });
    assert.equal(decision.allowed, true);
    assert.equal(decision.approvalId, 'approval-1');
  }
});
