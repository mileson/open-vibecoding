import crypto from 'node:crypto';
import { ADAPTER_CONTRACT_VERSION, normalizeClient } from './capability-envelope.js';

const EVENT_ALIASES = Object.freeze({
  SessionStart: 'session.started',
  session_start: 'session.started',
  UserPromptSubmit: 'prompt.submitted',
  user_prompt_submit: 'prompt.submitted',
  PreToolUse: 'tool.before',
  before_tool: 'tool.before',
  PostToolUse: 'tool.after',
  after_tool: 'tool.after',
  Stop: 'turn.stopped',
  stop: 'turn.stopped',
  SubagentStart: 'agent.started',
  SubagentStop: 'agent.stopped',
});

function stableEventId(client, raw) {
  const seed = JSON.stringify({
    client,
    event: raw.event ?? raw.eventName ?? raw.type ?? null,
    sessionId: raw.sessionId ?? raw.session_id ?? null,
    threadId: raw.threadId ?? raw.thread_id ?? null,
    turnId: raw.turnId ?? raw.turn_id ?? null,
    toolUseId: raw.toolUseId ?? raw.tool_use_id ?? null,
    occurredAt: raw.occurredAt ?? raw.timestamp ?? raw.at ?? null,
  });
  return `evt_${crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}

function normalizeLifecycleEvent(client, rawEvent = {}) {
  const normalizedClient = normalizeClient(client);
  const raw = rawEvent && typeof rawEvent === 'object' && !Array.isArray(rawEvent) ? rawEvent : {};
  const rawType = String(raw.event ?? raw.eventName ?? raw.type ?? 'unknown');
  const occurredAt = raw.occurredAt ?? raw.timestamp ?? raw.at ?? new Date().toISOString();
  return {
    schema: 'openprd.adapter-event.v1',
    adapterVersion: ADAPTER_CONTRACT_VERSION,
    eventId: raw.eventId ?? raw.event_id ?? stableEventId(normalizedClient, raw),
    client: normalizedClient,
    eventType: EVENT_ALIASES[rawType] ?? rawType,
    occurredAt,
    sessionId: raw.sessionId ?? raw.session_id ?? null,
    threadId: raw.threadId ?? raw.thread_id ?? raw.conversationId ?? null,
    turnId: raw.turnId ?? raw.turn_id ?? null,
    toolUseId: raw.toolUseId ?? raw.tool_use_id ?? null,
    cwd: raw.cwd ?? raw.workspaceRoot ?? null,
    payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
    rawEventType: rawType,
  };
}

export { EVENT_ALIASES, normalizeLifecycleEvent };

