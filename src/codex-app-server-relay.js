#!/usr/bin/env node
/*
 * Core purpose
 * Relay an Open VibeCoding Canvas handoff into a Codex Desktop thread through the
 * local Codex app-server protocol.
 *
 * Inputs
 * Receives a payload JSON path. The payload contains the target thread ID,
 * JSON-RPC input items, status path, log path, cwd, and optional timeout.
 *
 * Outputs
 * Writes a small status JSON file as the turn is queued, started, completed,
 * failed, or timed out. This lets the canvas UI return quickly while the Codex
 * turn continues in the background.
 *
 * Positioning
 * This is intentionally a thin transport worker. Image generation still belongs
 * to Codex native tools after the message reaches the thread.
 *
 * Maintenance rules
 * Keep the payload schema explicit and do not expose arbitrary app-server
 * methods through the canvas HTTP API.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const payloadPath = process.argv[2];

if (!payloadPath) {
  console.error('Usage: codex-app-server-relay <payload.json>');
  process.exit(2);
}

const payload = JSON.parse(await fs.readFile(payloadPath, 'utf8'));
const statusPath = payload.statusPath;
const logPath = payload.logPath;
const timeoutMs = Number.isFinite(Number(payload.timeoutMs)) ? Number(payload.timeoutMs) : 20 * 60 * 1000;
const codexBin = payload.codexBin || 'codex';

let finalized = false;
let started = false;
let stderrTail = '';
let turnSummary = null;
let resolvedThread = null;

async function appendLog(line) {
  if (!logPath) {
    return;
  }
  await fs.appendFile(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => {});
}

async function writeStatus(status, extra = {}) {
  if (!statusPath) {
    return;
  }
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify({
    schema: 'openprd.codex.app-server-relay.status.v1',
    status,
    updatedAt: new Date().toISOString(),
    payloadPath,
    handoffOperationId: payload.handoffOperationId ?? null,
    threadId: payload.threadId ?? null,
    threadTitle: payload.threadTitle ?? null,
    resolvedThread,
    turn: turnSummary,
    stderrTail: stderrTail || undefined,
    ...extra,
  }, null, 2), 'utf8');
}

function sendRpc(child, id, method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
}

async function finalize(status, extra = {}, child = null) {
  if (finalized) {
    return;
  }
  finalized = true;
  await appendLog(`finalize ${status}`);
  await writeStatus(status, extra);
  if (child && !child.killed) {
    child.kill('SIGTERM');
  }
}

await writeStatus('starting');
await appendLog(`starting ${codexBin} app-server relay`);

const child = spawn(codexBin, ['app-server', '--listen', 'stdio://'], {
  cwd: payload.cwd || process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
});

const timer = setTimeout(() => {
  finalize(started ? 'timeout-after-start' : 'timeout-before-start', {
    timeoutMs,
  }, child).catch(() => {});
}, timeoutMs);

child.once('error', (error) => {
  clearTimeout(timer);
  finalize('failed', {
    error: error.message || String(error),
  }).catch(() => {});
});

child.once('close', (code, signal) => {
  clearTimeout(timer);
  if (!finalized) {
    finalize(started ? 'closed-after-start' : 'failed', {
      exitCode: code,
      signal,
    }).catch(() => {});
  }
});

child.stderr.on('data', (chunk) => {
  stderrTail = `${stderrTail}${chunk.toString('utf8')}`.slice(-6000);
  appendLog(`stderr ${chunk.toString('utf8').trim()}`).catch(() => {});
});

let stdoutBuffer = '';
child.stdout.on('data', (chunk) => {
  stdoutBuffer += chunk.toString('utf8');
  const lines = stdoutBuffer.split(/\r?\n/);
  stdoutBuffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let message = null;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      appendLog(`unparsed ${trimmed}`).catch(() => {});
      continue;
    }
    handleRpcMessage(message).catch((error) => {
      finalize('failed', {
        error: error.message || String(error),
      }, child).catch(() => {});
    });
  }
});

async function handleRpcMessage(message) {
  if (message.id === 1) {
    if (message.error) {
      await finalize('failed', {
        phase: 'initialize',
        error: message.error,
      }, child);
      return;
    }
    sendRpc(child, 2, 'thread/resume', {
      threadId: payload.threadId,
      excludeTurns: true,
    });
    await writeStatus('resuming');
    return;
  }

  if (message.id === 2) {
    if (message.error) {
      await finalize('failed', {
        phase: 'thread/resume',
        error: message.error,
      }, child);
      return;
    }
    const thread = message.result?.thread ?? null;
    resolvedThread = thread ? {
      id: thread.id ?? null,
      name: thread.name ?? null,
      cwd: thread.cwd ?? null,
      status: thread.status ?? null,
      path: thread.path ?? null,
      source: thread.source ?? null,
      cliVersion: thread.cliVersion ?? null,
    } : null;
    sendRpc(child, 3, 'turn/start', {
      threadId: resolvedThread?.id || payload.threadId,
      input: Array.isArray(payload.input) ? payload.input : [],
    });
    await writeStatus('connecting', {
      resume: {
        model: message.result?.model ?? null,
        modelProvider: message.result?.modelProvider ?? null,
      },
    });
    return;
  }

  if (message.id === 3) {
    if (message.error) {
      await finalize('failed', {
        phase: 'turn/start',
        error: message.error,
      }, child);
      return;
    }
    started = true;
    turnSummary = message.result?.turn ?? message.result ?? null;
    await writeStatus('started', {
      result: message.result ?? null,
    });
    return;
  }

  if (message.method === 'turn/started') {
    started = true;
    turnSummary = message.params?.turn ?? message.params ?? turnSummary;
    await writeStatus('started', {
      notification: message.params ?? null,
    });
    return;
  }

  if (message.method === 'turn/completed' || message.method === 'turn/failed' || message.method === 'turn/cancelled') {
    turnSummary = message.params?.turn ?? message.params ?? turnSummary;
    await finalize(message.method === 'turn/completed' ? 'completed' : 'failed', {
      notification: message.params ?? null,
    }, child);
    return;
  }

  if (message.method) {
    await appendLog(`notification ${message.method}`);
  }
}

sendRpc(child, 1, 'initialize', {
  clientInfo: {
    name: 'open-vibecoding-canvas',
    version: '0.0.0',
  },
  capabilities: {
    experimentalApi: true,
    optOutNotificationMethods: [
      'mcpServer/startupStatus/updated',
      'skills/changed',
      'account/rateLimits/updated',
      'app/list/updated',
    ],
  },
});
