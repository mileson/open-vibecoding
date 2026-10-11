/*
 * Core purpose
 * Deliver canvas handoffs back to a bound Codex thread: the direct
 * app-server relay (thread/resume -> turn/start via a detached worker) and
 * the agent-foreground-relay fallback outbox that in-conversation agents
 * drain with codex_app.send_message_to_thread.
 *
 * Positioning
 * Used by canvas-workspace.js when a handoff targets Codex and the session
 * is thread-bound. Keep transports additive: skipping or failing a relay
 * must never lose the handoff operation itself.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cjoin, exists, readJson, writeJson } from './fs-utils.js';
import { timestamp } from './time.js';
import {
  appendOperation,
  parsePositiveInteger,
  readOps,
  sanitizeSessionSegment,
  trimString,
  updateOperation,
} from './canvas-session-store.js';

const CODEX_APP_SERVER_RELAY_WORKER_PATH = cjoin(path.dirname(fileURLToPath(import.meta.url)), 'codex-app-server-relay.js');
const CODEX_APP_SERVER_RELAY_TIMEOUT_MS = 20 * 60 * 1000;
const CODEX_APP_SERVER_RELAY_START_WAIT_MS = 0;
const CODEX_APP_BUNDLE_BIN_PATH = '/Applications/Codex.app/Contents/Resources/codex';
const CODEX_DELEGATION_RELAY_TRANSPORT = 'codex-app-server-codex-delegation-turn-start';
const CODEX_AGENT_BRIDGE_TRANSPORT = 'codex-agent-send-message-to-thread';
const CODEX_RELAY_DELIVERED_STATUSES = new Set(['completed']);
const CODEX_RELAY_ACCEPTED_STATUSES = new Set([...CODEX_RELAY_DELIVERED_STATUSES, 'started']);
const CODEX_RELAY_PENDING_STATUSES = new Set(['queued', 'starting', 'resuming', 'connecting', 'started']);
const CODEX_RELAY_WAIT_READY_STATUSES = new Set([
  ...CODEX_RELAY_ACCEPTED_STATUSES,
  'failed',
  'timeout-before-start',
  'timeout-after-start',
  'closed-before-start',
  'closed-after-start',
]);
const CODEX_RELAY_AGENT_FALLBACK_STATUSES = new Set([
  'failed',
  'timeout-before-start',
  'closed-before-start',
]);


function escapeCodexDelegationXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildCodexDelegationText(sourceThreadId, inputText) {
  const sourceId = trimString(sourceThreadId || 'open-vibecoding-canvas', 200);
  const text = trimString(inputText || 'Please continue from this Open VibeCoding Canvas handoff.');
  return [
    '<codex_delegation>',
    `  <source_thread_id>${escapeCodexDelegationXml(sourceId)}</source_thread_id>`,
    `  <input>${escapeCodexDelegationXml(text)}</input>`,
    '</codex_delegation>',
  ].join('\n');
}

function relayTimeoutMs(env = process.env) {
  return parsePositiveInteger(env.OPEN_VIBECODING_CANVAS_CODEX_RELAY_TIMEOUT_MS, CODEX_APP_SERVER_RELAY_TIMEOUT_MS);
}

function relayStartWaitMs(options = {}, env = process.env) {
  if (options.relayWaitMs != null) {
    return parsePositiveInteger(options.relayWaitMs, 0);
  }
  return parsePositiveInteger(env.OPEN_VIBECODING_CANVAS_CODEX_RELAY_START_WAIT_MS, CODEX_APP_SERVER_RELAY_START_WAIT_MS);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCodexRelayStart(statusPath, waitMs) {
  const timeoutMs = parsePositiveInteger(waitMs, 0);
  if (!timeoutMs) {
    return null;
  }
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() <= deadline) {
    latest = await readJson(statusPath).catch(() => latest);
    if (latest?.status && CODEX_RELAY_WAIT_READY_STATUSES.has(latest.status)) {
      return latest;
    }
    await sleep(350);
  }
  latest = await readJson(statusPath).catch(() => latest);
  return latest ? { ...latest, waitTimedOut: true } : {
    status: 'queued',
    waitTimedOut: true,
  };
}

function relayStatusSummary(statusDoc) {
  if (!statusDoc) {
    return {};
  }
  const status = statusDoc.status ?? 'queued';
  return {
    status,
    phase: statusDoc.phase ?? null,
    turn: statusDoc.turn ?? null,
    resolvedThread: statusDoc.resolvedThread ?? null,
    error: statusDoc.error ?? null,
    waitTimedOut: Boolean(statusDoc.waitTimedOut),
    delivered: CODEX_RELAY_DELIVERED_STATUSES.has(status),
    pending: Boolean(statusDoc.waitTimedOut) || CODEX_RELAY_PENDING_STATUSES.has(status),
    accepted: CODEX_RELAY_ACCEPTED_STATUSES.has(status),
  };
}

async function resolveCodexAppServerBin(env = process.env) {
  if (env.OPEN_VIBECODING_CODEX_APP_SERVER_BIN) {
    return env.OPEN_VIBECODING_CODEX_APP_SERVER_BIN;
  }
  if (process.platform === 'darwin' && await exists(CODEX_APP_BUNDLE_BIN_PATH)) {
    return CODEX_APP_BUNDLE_BIN_PATH;
  }
  return 'codex';
}

function codexRelaySkipReason(session, op, options = {}, env = process.env) {
  if (options.relay === false || options.disableRelay === true) {
    return 'disabled-by-request';
  }
  if (env.OPEN_VIBECODING_CANVAS_CODEX_RELAY === '0') {
    return 'disabled-by-env';
  }
  if (String(op.target ?? '').toLowerCase() !== 'codex') {
    return 'unsupported-target';
  }
  if (session.binding?.kind !== 'thread' || !session.binding?.id) {
    return 'not-thread-bound';
  }
  return null;
}

function buildCodexRelayInput(session, op) {
  const input = [];
  const text = trimString(op.promptText || op.instruction || 'Please continue from this Open VibeCoding Canvas handoff.');
  if (text.trim()) {
    const sourceThreadId = session.binding?.id || op.binding?.id || op.threadId || 'open-vibecoding-canvas';
    input.push({ type: 'text', text: buildCodexDelegationText(sourceThreadId, text) });
  }
  const exportPath = String(op.exportPath ?? '').trim();
  if (exportPath) {
    input.push({ type: 'localImage', path: exportPath });
  }
  return input;
}

function buildCodexAgentBridgePrompt(session, op) {
  const text = trimString(op.promptText || op.instruction || 'Please continue from this Open VibeCoding Canvas handoff.');
  const sourceThreadId = session.binding?.id || op.binding?.id || op.threadId || 'open-vibecoding-canvas';
  return buildCodexDelegationText(sourceThreadId, text);
}

function summarizeAgentBridgeOperation(op) {
  if (!op) {
    return null;
  }
  return {
    id: op.id,
    seq: op.seq ?? null,
    status: op.status ?? 'pending',
    target: op.target ?? 'codex',
    transport: op.transport ?? CODEX_AGENT_BRIDGE_TRANSPORT,
    handoffOperationId: op.handoffOperationId ?? null,
    threadId: op.threadId ?? null,
    threadTitle: op.threadTitle ?? null,
    prompt: op.prompt ?? null,
    promptText: op.promptText ?? null,
    exportPath: op.exportPath ?? null,
    exportUrl: op.exportUrl ?? null,
    selection: op.selection ?? null,
    placeholderId: op.placeholderId ?? null,
    elementCount: op.elementCount ?? null,
    selectedElementIds: Array.isArray(op.selectedElementIds) ? op.selectedElementIds : [],
    createdAt: op.createdAt ?? null,
    updatedAt: op.updatedAt ?? null,
    claimedAt: op.claimedAt ?? null,
    sentAt: op.sentAt ?? null,
    failedAt: op.failedAt ?? null,
    reason: op.reason ?? null,
    requiresAgentTool: op.requiresAgentTool ?? 'codex_app.send_message_to_thread',
  };
}

function codexRelayNeedsAgentBridgeFallback(relay) {
  if (!relay || relay.status === 'skipped') {
    return true;
  }
  const status = String(relay.status ?? '');
  if (CODEX_RELAY_AGENT_FALLBACK_STATUSES.has(status)) {
    return true;
  }
  return Boolean(relay.waitTimedOut && ['queued', 'starting', 'resuming'].includes(status));
}

async function queueCodexAgentBridge(session, op, options = {}) {
  const requested = Boolean(options.agentBridge || options.foregroundBridge);
  const base = {
    target: op.target ?? 'codex',
    transport: CODEX_AGENT_BRIDGE_TRANSPORT,
    supportsForegroundMessage: false,
    requiresAgentTool: 'codex_app.send_message_to_thread',
  };
  if (options.agentBridgeSkipReason) {
    return {
      ...base,
      status: 'skipped',
      reason: options.agentBridgeSkipReason,
      directRelayStatus: options.directRelay?.status ?? null,
      directRelayTransport: options.directRelay?.transport ?? CODEX_DELEGATION_RELAY_TRANSPORT,
    };
  }
  if (!requested) {
    return {
      ...base,
      status: 'skipped',
      reason: 'not-requested',
    };
  }
  if (String(op.target ?? '').toLowerCase() !== 'codex') {
    return {
      ...base,
      status: 'skipped',
      reason: 'unsupported-target',
    };
  }
  if (session.binding?.kind !== 'thread' || !session.binding?.id) {
    return {
      ...base,
      status: 'skipped',
      reason: 'not-thread-bound',
    };
  }
  const bridgeOp = await appendOperation(session.paths, {
    type: 'agent-foreground-relay',
    target: 'codex',
    transport: CODEX_AGENT_BRIDGE_TRANSPORT,
    status: 'pending',
    handoffOperationId: op.id,
    threadId: session.binding.id,
    threadTitle: session.binding.title || session.binding.threadTitle || null,
    prompt: buildCodexAgentBridgePrompt(session, op),
    promptText: op.promptText ?? null,
    exportPath: op.exportPath ?? null,
    exportUrl: op.exportUrl ?? null,
    selection: op.selection ?? null,
    placeholderId: op.placeholderId ?? null,
    elementCount: op.elementCount ?? null,
    selectedElementIds: Array.isArray(op.selectedElementIds) ? op.selectedElementIds : [],
    locale: op.locale ?? null,
    note: op.note ?? null,
    requiresAgentTool: 'codex_app.send_message_to_thread',
    supportsForegroundMessage: true,
  });
  return {
    ...base,
    ...summarizeAgentBridgeOperation(bridgeOp),
    status: 'pending',
    supportsForegroundMessage: true,
  };
}

async function listCodexAgentBridgeOutbox(session, options = {}) {
  const includeAll = Boolean(options.all);
  const ops = await readOps(session.paths);
  const items = ops.ops
    .filter((op) => op.type === 'agent-foreground-relay')
    .filter((op) => includeAll || ['pending', 'claimed'].includes(op.status ?? 'pending'))
    .map(summarizeAgentBridgeOperation)
    .filter(Boolean);
  return items;
}

async function claimCodexAgentBridgeItem(session, claim = 'next') {
  const items = await listCodexAgentBridgeOutbox(session);
  const value = String(claim || 'next');
  const item = value === 'next'
    ? items.find((candidate) => candidate.status === 'pending')
    : items.find((candidate) => candidate.id === value);
  if (!item) {
    return null;
  }
  const updated = await updateOperation(session.paths, item.id, {
    status: 'claimed',
    claimedAt: timestamp(),
  });
  await appendOperation(session.paths, {
    type: 'agent-foreground-relay-status',
    bridgeOperationId: item.id,
    status: 'claimed',
  });
  return summarizeAgentBridgeOperation(updated);
}

async function markCodexAgentBridgeItem(session, id, status, options = {}) {
  if (!id) {
    const error = new Error('Expected --id for canvas bridge status update.');
    error.statusCode = 400;
    throw error;
  }
  const normalizedStatus = status === 'failed' ? 'failed' : 'sent';
  const timestampField = normalizedStatus === 'failed' ? 'failedAt' : 'sentAt';
  const updated = await updateOperation(session.paths, id, {
    status: normalizedStatus,
    [timestampField]: timestamp(),
    reason: options.reason ?? null,
    sentThreadId: options.threadId ?? session.binding?.id ?? null,
  });
  await appendOperation(session.paths, {
    type: 'agent-foreground-relay-status',
    bridgeOperationId: id,
    status: normalizedStatus,
    reason: options.reason ?? null,
    threadId: options.threadId ?? session.binding?.id ?? null,
  });
  return summarizeAgentBridgeOperation(updated);
}

async function queueCodexThreadRelay(session, op, options = {}, env = process.env) {
  const skipReason = codexRelaySkipReason(session, op, options, env);
  const input = buildCodexRelayInput(session, op);
  const supportsDirectAttachment = input.some((item) => item.type === 'localImage');
  const base = {
    target: op.target ?? 'codex',
    transport: CODEX_DELEGATION_RELAY_TRANSPORT,
    supportsDirectMessage: !skipReason,
    supportsDirectAttachment: !skipReason && supportsDirectAttachment,
    inputTypes: input.map((item) => item.type),
    promptText: op.promptText,
    delivered: false,
    pending: false,
    accepted: false,
  };
  if (skipReason) {
    return {
      ...base,
      status: 'skipped',
      reason: skipReason,
      supportsDirectMessage: false,
      supportsDirectAttachment: false,
    };
  }

  await fs.mkdir(session.paths.relaysDir, { recursive: true });
  const relayName = sanitizeSessionSegment(op.id || `handoff-${Date.now()}`, 'handoff');
  const payloadPath = cjoin(session.paths.relaysDir, `${relayName}.payload.json`);
  const statusPath = cjoin(session.paths.relaysDir, `${relayName}.status.json`);
  const logPath = cjoin(session.paths.relaysDir, `${relayName}.log`);
  const payload = {
    schema: 'openprd.codex.app-server-relay.v1',
    createdAt: timestamp(),
    handoffOperationId: op.id,
    threadId: session.binding.id,
    threadTitle: session.binding.title || session.binding.threadTitle || null,
    cwd: session.projectRoot,
    input,
    payloadPath,
    statusPath,
    logPath,
    codexBin: await resolveCodexAppServerBin(env),
    timeoutMs: relayTimeoutMs(env),
  };
  await writeJson(payloadPath, payload);
  await writeJson(statusPath, {
    schema: 'openprd.codex.app-server-relay.status.v1',
    status: 'queued',
    createdAt: payload.createdAt,
    updatedAt: timestamp(),
    handoffOperationId: op.id,
    threadId: session.binding.id,
  });

  if (options.relayDryRun || env.OPEN_VIBECODING_CANVAS_CODEX_RELAY_DRY_RUN === '1') {
    return {
      ...base,
      ...relayStatusSummary({ status: 'queued' }),
      status: 'queued',
      dryRun: true,
      payloadPath,
      statusPath,
      logPath,
    };
  }

  const child = spawn(process.execPath, [CODEX_APP_SERVER_RELAY_WORKER_PATH, payloadPath], {
    cwd: session.projectRoot,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const waitedStatus = await waitForCodexRelayStart(statusPath, relayStartWaitMs(options, env));
  const statusSummary = relayStatusSummary(waitedStatus || { status: 'queued' });
  return {
    ...base,
    status: statusSummary.status ?? 'queued',
    payloadPath,
    statusPath,
    logPath,
    pid: child.pid ?? null,
    ...statusSummary,
  };
}

export {
  CODEX_AGENT_BRIDGE_TRANSPORT,
  CODEX_DELEGATION_RELAY_TRANSPORT,
  buildCodexDelegationText,
  claimCodexAgentBridgeItem,
  codexRelayNeedsAgentBridgeFallback,
  listCodexAgentBridgeOutbox,
  markCodexAgentBridgeItem,
  queueCodexAgentBridge,
  queueCodexThreadRelay,
};
