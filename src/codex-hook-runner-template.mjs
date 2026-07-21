import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const eventName = process.argv[2] || 'Unknown';
const hookScriptFilePath = fileURLToPath(import.meta.url);
const hookScriptWorkspaceRoot = (() => {
  const candidate = path.resolve(path.dirname(hookScriptFilePath), '..', '..');
  return fs.existsSync(path.join(candidate, '.openprd')) ? candidate : null;
})();
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = input.trim() ? JSON.parse(input) : {}; } catch {}
  const cwd = payload.cwd
    || payload.workspace_root
    || payload.workspaceRoot
    || hookScriptWorkspaceRoot
    || process.cwd();
  const result = handle(eventName, cwd, payload);
  if (result) {
    process.stdout.write(JSON.stringify(result));
  }
});

function now() {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function findProjectRoot(start) {
  let current = path.resolve(start || process.cwd());
  for (;;) {
    if (fs.existsSync(path.join(current, '.openprd'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(start || process.cwd());
    }
    current = parent;
  }
}

function harnessDir(root) {
  return path.join(root, '.openprd', 'harness');
}

function ensureHarness(root) {
  const dir = harnessDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dir, 'hook-state.json');
  if (!fs.existsSync(statePath)) {
    writeJsonSync(statePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      recentFingerprints: {},
      suppressions: { inputLock: false },
    });
  }
  const eventsPath = path.join(dir, 'events.jsonl');
  if (!fs.existsSync(eventsPath)) {
    fs.writeFileSync(eventsPath, '');
  }
  const runtimePath = path.join(dir, 'runtime-environment.json');
  if (!fs.existsSync(runtimePath)) {
    writeJsonSync(runtimePath, {
      version: 1,
      active: {
        activeClient: 'unknown',
        surface: 'unknown',
        executionMode: 'interactive',
        confidence: 0,
        sessionId: null,
        turnId: null,
        agentType: null,
        model: null,
        evidence: [],
        observedCapabilities: [],
      },
      runtimeDetection: {
        version: 1,
        activeEvidencePriority: [
          'hook-session-payload',
          'explicit-launcher',
          'sdk-or-headless-session',
          'child-process-env',
          'config-or-cli-probe',
          'agent-self-report',
        ],
      },
      platformCapabilityPacks: [],
      updatedAt: null,
    });
  }
}

function readJsonSync(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function appendEvent(root, event) {
  ensureHarness(root);
  fs.appendFileSync(path.join(harnessDir(root), 'events.jsonl'), JSON.stringify({ at: now(), ...event }) + '\n');
}

function runtimeEnvironmentPath(root) {
  return path.join(harnessDir(root), 'runtime-environment.json');
}

function compactString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function runtimeEvidenceForPayload(eventName, payload) {
  const evidence = ['hook.event_name'];
  const addIfPresent = (key, label = key) => {
    if (payload && payload[key] !== undefined && payload[key] !== null && String(payload[key]).trim() !== '') {
      evidence.push(`hook.${label}`);
    }
  };
  addIfPresent('session_id', 'session_id');
  addIfPresent('sessionId', 'sessionId');
  addIfPresent('transcript_path', 'transcript_path');
  addIfPresent('transcriptPath', 'transcriptPath');
  addIfPresent('cwd', 'cwd');
  addIfPresent('model', 'model');
  addIfPresent('turn_id', 'turn_id');
  addIfPresent('turnId', 'turnId');
  addIfPresent('agent_type', 'agent_type');
  addIfPresent('agentType', 'agentType');
  addIfPresent('tool_name', 'tool_name');
  addIfPresent('toolName', 'toolName');
  if (eventName) {
    evidence.push(`event.${eventName}`);
  }
  return [...new Set(evidence)];
}

function observedCodexCapabilities(payload) {
  const observed = ['codex-hooks'];
  const tool = toolName(payload).toLowerCase();
  const haystack = `${tool}\n${payloadText(payload)}`;
  if (/\b(imagegen|image_gen|image-generation|image_generation)\b/i.test(haystack)) {
    observed.push('native-image-generation');
  }
  if (/\b(computer-use|computer_use|browser|chrome)\b/i.test(haystack)) {
    observed.push('computer-use');
  }
  return [...new Set(observed)];
}

function recordRuntimeEnvironment(root, eventName, payload, sessionId) {
  ensureHarness(root);
  const current = readJsonSync(runtimeEnvironmentPath(root), {});
  const executionSignals = detectExecutionSignals(eventName, payload);
  const evidence = [...new Set([
    ...runtimeEvidenceForPayload(eventName, payload),
    ...executionSignals.evidence,
    ...executionSignals.optInEvidence,
  ])];
  const active = {
    activeClient: 'codex',
    surface: 'codex-hook',
    executionMode: executionSignals.executionMode,
    confidence: evidence.some((item) => item === 'hook.session_id' || item === 'hook.sessionId' || item === 'hook.transcript_path' || item === 'hook.transcriptPath') ? 0.95 : 0.9,
    sessionId: sessionId ?? null,
    turnId: compactString(payload?.turn_id ?? payload?.turnId),
    agentType: compactString(payload?.agent_type ?? payload?.agentType),
    model: compactString(payload?.model),
    evidence,
    observedCapabilities: observedCodexCapabilities(payload),
  };
  const entry = {
    version: 1,
    ...current,
    active,
    lastEventName: eventName,
    updatedAt: now(),
    recentObservations: [
      ...(Array.isArray(current.recentObservations) ? current.recentObservations : []),
      {
        at: now(),
        eventName,
        activeClient: active.activeClient,
        surface: active.surface,
        executionMode: active.executionMode,
        sessionId: active.sessionId,
        evidence: active.evidence,
        observedCapabilities: active.observedCapabilities,
      },
    ].slice(-20),
  };
  writeJsonSync(runtimeEnvironmentPath(root), entry);
  return entry;
}

function turnStatePath(root) {
  return path.join(harnessDir(root), 'turn-state.json');
}

function defaultTurnState() {
  return {
    version: 1,
    id: null,
    knowledgeCandidateId: null,
    sessionId: null,
    prompt: null,
    promptPreview: null,
    title: null,
    status: 'needs-attention',
    startedAt: null,
    updatedAt: null,
    touchedFiles: [],
    gateBlockCounts: {},
    reviewSignals: [],
    runtimeEvents: [],
    timeline: [],
    lastKnowledgePromptCandidateId: null,
    lastKnowledgePromptAt: null,
  };
}

function readTurnState(root) {
  return {
    ...defaultTurnState(),
    ...readJsonSync(turnStatePath(root), defaultTurnState()),
  };
}

function writeTurnState(root, next) {
  writeJsonSync(turnStatePath(root), {
    ...defaultTurnState(),
    ...next,
    updatedAt: now(),
  });
}

function normalizeProjectFile(root, filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) return null;
  const absolutePath = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  if (!relativePath || relativePath.startsWith('..')) {
    return null;
  }
  return relativePath;
}

function extractTouchedFiles(root, payload) {
  const files = [];
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? null;
  const addFile = (value) => {
    const normalized = normalizeProjectFile(root, value);
    if (normalized) {
      files.push(normalized);
    }
  };
  if (toolInput && typeof toolInput === 'object') {
    for (const field of ['file_path', 'filePath', 'path', 'target_path', 'targetPath']) {
      if (typeof toolInput[field] === 'string') {
        addFile(toolInput[field]);
      }
    }
  }
  const patchText = typeof toolInput === 'string'
    ? toolInput
    : (typeof toolInput?.patch === 'string' ? toolInput.patch : '');
  if (patchText) {
    for (const line of patchText.split(/\r?\n/)) {
      const match = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)
        || line.match(/^\*\*\* Move to: (.+)$/);
      if (match?.[1]) {
        addFile(match[1].trim());
      }
    }
  }
  return [...new Set(files)];
}

function beginTurnReview(root, baseEvent, prompt) {
  const promptPreview = preview(prompt, 240);
  writeTurnState(root, {
    version: 1,
    id: `turn-${String(Date.now())}-${baseEvent.fingerprint ?? 'openprd'}`,
    knowledgeCandidateId: null,
    sessionId: baseEvent.sessionId,
    prompt,
    promptPreview,
    title: promptPreview || '本轮项目回顾',
    summary: {
      title: promptPreview || '本轮项目回顾',
      status: 'needs-attention',
      message: '等待本轮实现和验证信号，用于 Stop 回顾生成项目经验草案。',
    },
    status: 'needs-attention',
    startedAt: now(),
    touchedFiles: [],
    gateBlockCounts: {},
    reviewSignals: [],
    runtimeEvents: promptPreview ? [{
      eventName: 'user-prompt',
      status: 'pass',
      message: promptPreview,
      at: now(),
    }] : [],
    timeline: promptPreview ? [{
      event: 'user-prompt',
      status: 'pass',
      message: promptPreview,
      at: now(),
    }] : [],
    lastKnowledgePromptCandidateId: null,
    lastKnowledgePromptAt: null,
  });
}

function recordTouchedFiles(root, payload) {
  const touchedFiles = extractTouchedFiles(root, payload);
  if (touchedFiles.length === 0) {
    return [];
  }
  const state = readTurnState(root);
  writeTurnState(root, {
    ...state,
    touchedFiles: [...new Set([...(Array.isArray(state.touchedFiles) ? state.touchedFiles : []), ...touchedFiles])],
  });
  return touchedFiles;
}

function appendTurnReviewSignals(root, signals) {
  const normalizedSignals = (Array.isArray(signals) ? signals : [signals])
    .filter(Boolean)
    .map((signal) => ({
      at: now(),
      ...signal,
    }));
  if (normalizedSignals.length === 0) {
    return [];
  }
  const state = readTurnState(root);
  const existing = Array.isArray(state.reviewSignals) ? state.reviewSignals : [];
  writeTurnState(root, {
    ...state,
    reviewSignals: [...existing, ...normalizedSignals].slice(-80),
    timeline: [
      ...(Array.isArray(state.timeline) ? state.timeline : []),
      ...normalizedSignals.map((signal) => ({
        event: signal.kind,
        status: 'pass',
        message: signal.message ?? signal.preview ?? signal.kind,
        at: signal.at,
      })),
    ].slice(-120),
  });
  return normalizedSignals;
}

function detectVisualEvidenceSignals(payload) {
  const tool = toolName(payload).toLowerCase();
  const command = commandText(payload);
  const text = payloadText(payload);
  const haystack = `${tool}\n${command}\n${text}`;
  const signals = [];
  if (/openprd\s+visual-prepare\b/i.test(haystack)) {
    signals.push({
      kind: 'visual-reference-prepared',
      message: 'visual-prepare reference-set/contact sheet observed',
      preview: preview(command || text, 180),
    });
  }
  if (/openprd\s+visual-compare\b/i.test(haystack)
    || /\.openprd\/harness\/visual-reviews\/(?:visual-|reference-sets\/)/i.test(haystack)
    || /visual-(?:compare|before-after|focus-board|parallel-board|verification-board|alignment-board|centering-board)/i.test(haystack)
    || /\b(?:reference-actual|before-after|focus-board|parallel-board|verification-board|alignment-board|centering-board|center-board)\b/i.test(haystack)) {
    signals.push({
      kind: 'visual-review-artifact',
      message: 'visual-compare artifact observed',
      preview: preview(command || text, 180),
    });
  }
  if (/\bverification-board\b|截图实测证据板|visual-verification-board/i.test(haystack)) {
    signals.push({
      kind: 'visual-verification-board',
      message: 'verification-board artifact observed',
      preview: preview(command || text, 180),
    });
  }
  if (/\balignment-board\b|对齐辅助线证据板|visual-alignment-board/i.test(haystack)) {
    signals.push({
      kind: 'visual-alignment-board',
      message: 'alignment-board artifact observed',
      preview: preview(command || text, 180),
    });
  }
  if (/\b(?:centering-board|center-board)\b|内部居中证据板|visual-centering-board/i.test(haystack)) {
    signals.push({
      kind: 'visual-centering-board',
      message: 'centering-board artifact observed',
      preview: preview(command || text, 180),
    });
  }
  const screenshotTool = /(?:^|[_-])(?:screenshot|view_image)(?:$|[_-])/i.test(tool)
    || /(?:computer|browser|playwright|page|mp|miniprogram|weapp).*screenshot/i.test(tool);
  const screenshotCommand = /\bscreencapture\b|page\.screenshot|\.screenshot\(|mp_screenshot|browser.*screenshot|computer.*screenshot|playwright.*screenshot/i.test(command);
  const screenshotText = /(?:普通截图|实测截图|运行态截图|Computer\s*实测|Browser\s*实测|截图证据|screenshot captured|captured screenshot)/i.test(text);
  if ((screenshotTool || screenshotCommand || screenshotText) && !/openprd\s+visual-compare\b/i.test(haystack)) {
    signals.push({
      kind: 'visual-raw-screenshot',
      message: 'raw screenshot or Computer/Browser visual evidence observed',
      preview: preview(command || text || tool, 180),
    });
  }
  return signals;
}

function recordVisualEvidenceSignals(root, payload) {
  return appendTurnReviewSignals(root, detectVisualEvidenceSignals(payload));
}

function updateHookState(root, event) {
  ensureHarness(root);
  const statePath = path.join(harnessDir(root), 'hook-state.json');
  const state = readJsonSync(statePath, {
    version: 1,
    counters: {},
    recentFingerprints: {},
    suppressions: { inputLock: false },
  });
  state.lastEventAt = now();
  state.lastEvent = event.eventName;
  state.lastFingerprint = event.fingerprint;
  state.counters[event.eventName] = (state.counters[event.eventName] || 0) + 1;
  state.recentFingerprints = state.recentFingerprints || {};
  if (event.fingerprint) {
    state.recentFingerprints[event.fingerprint] = Date.now();
  }
  if (event.runtimeEnvironment) {
    state.runtimeEnvironment = event.runtimeEnvironment;
  }
  for (const [fingerprint, seenAt] of Object.entries(state.recentFingerprints)) {
    if (Date.now() - Number(seenAt) > 300000) {
      delete state.recentFingerprints[fingerprint];
    }
  }
  writeJsonSync(statePath, state);
  return state;
}

function isDuplicate(root, fingerprint, windowMs = 15000) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const seenAt = state?.recentFingerprints?.[fingerprint];
  return Boolean(seenAt && Date.now() - Number(seenAt) < windowMs);
}

function fingerprintFor(eventName, payload, risk) {
  const tool = payload.tool_name || payload.toolName || payload.name || '';
  const inputText = JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {}).slice(0, 2000);
  return crypto.createHash('sha256').update(JSON.stringify({ eventName, tool, inputText, risk: risk.level })).digest('hex').slice(0, 16);
}

function sanitizeSessionId(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z0-9._-]{6,160}$/.test(text) ? text : null;
}

function sessionIdFor(payload) {
  const direct = sanitizeSessionId(payload.session_id || payload.sessionId || payload.thread_id || payload.threadId || payload.conversation_id || payload.conversationId);
  if (direct) return direct;
  const transcript = String(payload.transcript_path || payload.transcriptPath || '');
  const match = transcript.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match ? sanitizeSessionId(match[1]) : null;
}

function payloadText(payload) {
  return JSON.stringify(payload.tool_input || payload.toolInput || payload.input || payload || {});
}

function promptText(payload) {
  return String(payload.prompt || payload.user_prompt || payload.message || '');
}

function preview(text, max = 600) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function commandText(payload) {
  const direct = typeof payload?.cmd === 'string'
    ? payload.cmd
    : typeof payload?.command === 'string'
      ? payload.command
      : '';
  if (direct) {
    return direct;
  }
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? null;
  if (typeof toolInput === 'string') {
    return toolInput;
  }
  if (toolInput && typeof toolInput.command === 'string') {
    return toolInput.command;
  }
  if (toolInput && typeof toolInput.cmd === 'string') {
    return toolInput.cmd;
  }
  return '';
}

function toolName(payload) {
  return String(payload?.tool_name || payload?.toolName || payload?.name || '').trim();
}

function namedGateDir(root, gateName) {
  return path.join(harnessDir(root), `${gateName}-gates`);
}

function namedGatePath(root, gateName, sessionId = null) {
  if (sessionId) {
    return path.join(namedGateDir(root, gateName), `${sessionId}.json`);
  }
  return path.join(harnessDir(root), `${gateName}-gate.json`);
}

function readNamedGate(root, gateName, sessionId = null) {
  return readJsonSync(namedGatePath(root, gateName, sessionId), null);
}

function writeNamedGate(root, gateName, value, sessionId = null) {
  const next = sessionId ? { ...value, sessionId } : value;
  writeJsonSync(namedGatePath(root, gateName, sessionId), next);
  if (sessionId) {
    writeJsonSync(namedGatePath(root, gateName), next);
  }
  return next;
}

function updateNamedGate(root, gateName, patch, sessionId = null) {
  const current = readNamedGate(root, gateName, sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, gateName, {
    ...current,
    updatedAt: now(),
    ...patch,
  }, sessionId);
}

function legacyRequirementGatePath(root) {
  return path.join(harnessDir(root), 'requirement-gate.json');
}

function requirementGateDir(root) {
  return path.join(harnessDir(root), 'requirement-gates');
}

function requirementGatePath(root, sessionId = null) {
  if (sessionId) {
    return path.join(requirementGateDir(root), `${sessionId}.json`);
  }
  return legacyRequirementGatePath(root);
}

function sessionBindingDir(root) {
  return path.join(harnessDir(root), 'session-bindings');
}

function sessionBindingPath(root, sessionId = null) {
  if (!sessionId) {
    return null;
  }
  return path.join(sessionBindingDir(root), `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}


function truthyFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value ?? '').trim());
}

function normalizedMode(value) {
  return String(value ?? '').trim().toLowerCase();
}

function compactPayloadField(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (value === undefined || value === null || value === false) {
      continue;
    }
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (text.trim()) {
      return { key, value: text.trim() };
    }
  }
  return null;
}

function automationPromptHeader(prompt) {
  const header = String(prompt || '').split(/\r?\n/).slice(0, 12).join('\n');
  if (/^\s*Automation\s*:/im.test(header) && /^\s*Automation\s+(ID|memory)\s*:/im.test(header)) {
    return 'prompt.automation-header';
  }
  if (/^\s*(Scheduled|Cron|Unattended)\s+(task|automation)\s*:/im.test(header)) {
    return 'prompt.scheduled-header';
  }
  return null;
}

function explicitOpenPrdOptInEvidence(payload) {
  const evidence = [];
  const mode = normalizedMode(process.env.OPENPRD_EXECUTION_MODE);
  if (['openprd', 'openprd-maintenance', 'maintenance'].includes(mode)) {
    evidence.push(`env.OPENPRD_EXECUTION_MODE=${mode}`);
  }
  if (truthyFlag(process.env.OPENPRD_AUTOMATION_OPT_IN) || truthyFlag(process.env.OPENPRD_ENABLE_IN_AUTOMATION)) {
    evidence.push('env.OPENPRD_AUTOMATION_OPT_IN');
  }
  const explicitField = compactPayloadField(payload, [
    'openprd_automation_opt_in',
    'openprdAutomationOptIn',
    'openprd_opt_in',
    'openprdOptIn',
    'enable_openprd',
    'enableOpenPrd',
  ]);
  if (explicitField) {
    evidence.push(`payload.${explicitField.key}`);
  }
  const text = `${promptText(payload)}\n${payloadText(payload)}`;
  const negative = /(不要|不需要|无需|禁止|别|不是|非|不要执行|不要调用|do\s+not|don't|never|without|no|not)\s+.{0,24}\bopen\s*prd\b/i
    .test(text)
    || /(不要|不需要|无需|禁止|别|不是|非).{0,24}OpenPrd/i.test(text);
  if (!negative && /(OpenPrd\s*(维护任务|maintenance|maintain|opt[- ]?in)|显式启用\s*OpenPrd|启用\s*OpenPrd|使用\s*OpenPrd|运行\s*OpenPrd|enable\s+OpenPrd|use\s+OpenPrd|openprd-maintenance)/i.test(text)) {
    evidence.push('prompt.openprd-opt-in');
  }
  return [...new Set(evidence)];
}

function detectExecutionSignals(eventName, payload) {
  const evidence = [];
  const mode = normalizedMode(process.env.OPENPRD_EXECUTION_MODE);
  if (['automation', 'cron', 'scheduled', 'headless', 'unattended'].includes(mode)) {
    evidence.push(`env.OPENPRD_EXECUTION_MODE=${mode}`);
  }
  if (truthyFlag(process.env.OPENPRD_AUTOMATION)) {
    evidence.push('env.OPENPRD_AUTOMATION');
  }
  if (compactString(process.env.CODEX_AUTOMATION_ID)) {
    evidence.push('env.CODEX_AUTOMATION_ID');
  }
  if (truthyFlag(process.env.CLAUDE_CODE_HEADLESS)) {
    evidence.push('env.CLAUDE_CODE_HEADLESS');
  }
  const field = compactPayloadField(payload, [
    'automation_id',
    'automationId',
    'automation_name',
    'automationName',
    'automation',
    'scheduled_task',
    'scheduledTask',
    'cron',
    'rrule',
    'headless',
    'unattended',
    'is_automation',
    'isAutomation',
  ]);
  if (field) {
    evidence.push(`payload.${field.key}`);
  }
  const runMode = compactPayloadField(payload, [
    'run_kind',
    'runKind',
    'execution_mode',
    'executionMode',
    'surface',
    'agent_surface',
    'agentSurface',
  ]);
  if (runMode && /(automation|cron|scheduled|headless|unattended)/i.test(runMode.value)) {
    evidence.push(`payload.${runMode.key}=${runMode.value}`);
  }
  const agentType = compactString(payload?.agent_type ?? payload?.agentType);
  if (agentType && /(automation|cron|scheduled|headless|unattended)/i.test(agentType)) {
    evidence.push(`payload.agentType=${agentType}`);
  }
  const promptHeader = automationPromptHeader(promptText(payload));
  if (promptHeader) {
    evidence.push(promptHeader);
  }
  const transcript = compactString(payload?.transcript_path ?? payload?.transcriptPath);
  if (transcript && /(?:^|[/-])(automation|automations|cron|scheduled|headless)(?:[/-]|$)/i.test(transcript)) {
    evidence.push('payload.transcript_path.automation');
  }
  const optInEvidence = explicitOpenPrdOptInEvidence(payload);
  return {
    eventName,
    isAutomation: evidence.length > 0,
    explicitOpenPrdOptIn: optInEvidence.length > 0,
    evidence: [...new Set(evidence)],
    optInEvidence,
    executionMode: optInEvidence.length > 0
      ? 'automation-openprd-opt-in'
      : evidence.length > 0
        ? 'automation'
        : 'interactive',
  };
}

function rememberAutomationMode(root, sessionId, payload, signals, laneKind) {
  if (!sessionId) {
    return null;
  }
  const gateStatus = laneKind === 'automation' ? 'automation-safe-mode' : 'openprd-opt-in';
  const existing = readSessionBinding(root, sessionId);
  // 每个 hook 事件都会经过这里；同一会话的 lane 记忆只需要落一次盘。
  if (existing?.laneKind === laneKind && existing?.gateStatus === gateStatus) {
    return existing;
  }
  return writeSessionBinding(root, sessionId, {
    laneKind,
    tool: 'openprd-hook',
    promptPreview: preview(promptText(payload) || payloadText(payload), 500),
    gateActive: false,
    gateStatus,
    title: laneKind === 'automation'
      ? 'Unattended automation bypassed OpenPrd'
      : 'Unattended automation explicitly enabled OpenPrd',
    executionEvidence: signals.evidence,
    optInEvidence: signals.optInEvidence,
  });
}

function automationBypassDecision(root, eventName, payload, sessionId) {
  const signals = detectExecutionSignals(eventName, payload);
  if (signals.explicitOpenPrdOptIn) {
    return { bypass: false, optIn: true, remembered: false, signals };
  }
  if (signals.isAutomation) {
    return { bypass: true, optIn: false, remembered: false, signals };
  }
  const remembered = eventName === 'UserPromptSubmit' ? null : readSessionBinding(root, sessionId);
  if (remembered?.laneKind === 'automation' && remembered?.gateStatus === 'automation-safe-mode') {
    return { bypass: true, optIn: false, remembered: true, signals };
  }
  return { bypass: false, optIn: false, remembered: false, signals };
}

function sessionStatePath(root, sessionId = null) {
  if (!sessionId) {
    return null;
  }
  return path.join(harnessDir(root), 'session-states', `${String(sessionId).replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
}

function currentStatePath(root) {
  return path.join(root, '.openprd', 'state', 'current.json');
}

function normalizeReviewStatus(value) {
  return ['pending-confirmation', 'confirmed', 'needs-revision'].includes(value) ? value : 'missing';
}

function normalizeRequirementApprovalPolicy(policy = {}) {
  const maxClarificationQuestionsRaw = Number(policy?.maxClarificationQuestions);
  const maxClarificationQuestions = Number.isFinite(maxClarificationQuestionsRaw) && maxClarificationQuestionsRaw > 0
    ? Math.max(1, Math.floor(maxClarificationQuestionsRaw))
    : null;
  return {
    mode: 'agent-maintained',
    reviewPolicy: 'background-record',
    executionMode: 'direct-when-user-requested',
    suppressExtraConfirmation: true,
    maxClarificationQuestions,
  };
}

function requirementApprovalPolicy(gate) {
  return normalizeRequirementApprovalPolicy(gate?.approvalPolicy);
}

function reviewPolicyRequiresHumanConfirmation(policy) {
  return false;
}

function reviewPolicyAllowsSilentRecord(policy) {
  return true;
}

function resolveRequirementApprovalPolicy(prompt, intent = {}) {
  const explicitExecution = Boolean(intent?.explicitExecution);
  return normalizeRequirementApprovalPolicy({
    maxClarificationQuestions: explicitExecution
      ? 1
      : null,
  });
}

function readCliFlagValue(command, flag) {
  const quotedPattern = new RegExp(`${flag}\\s+(?:'([^']+)'|"([^"]+)"|([^\\s]+))`, 'i');
  const match = String(command || '').match(quotedPattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function parseReviewMarkCommand(text) {
  const command = String(text || '');
  if (!/openprd\s+review\b/i.test(command) || !/--mark\b/i.test(command)) {
    return null;
  }
  const mark = readCliFlagValue(command, '--mark')?.toLowerCase() ?? null;
  const versionId = readCliFlagValue(command, '--version');
  const digest = readCliFlagValue(command, '--digest');
  const workUnitId = readCliFlagValue(command, '--work-unit');
  if (!mark) {
    return null;
  }
  return { mark, versionId, digest, workUnitId };
}

function readSessionBinding(root, sessionId = null) {
  return readJsonSync(sessionBindingPath(root, sessionId), null);
}


function writeSessionBinding(root, sessionId, patch = {}) {
  if (!sessionId) {
    return null;
  }
  const filePath = sessionBindingPath(root, sessionId);
  const previous = readJsonSync(filePath, null);
  const next = {
    ...(previous ?? {}),
    version: 1,
    sessionId,
    ...patch,
    createdAt: previous?.createdAt ?? patch.createdAt ?? now(),
    updatedAt: patch.updatedAt ?? now(),
  };
  writeJsonSync(filePath, next);
  return next;
}

function readCurrentPrdReview(root) {
  const currentState = readJsonSync(currentStatePath(root), {}) || {};
  const reviewStatus = currentState.reviewStatus ?? {};
  const versionId = String(reviewStatus.versionId || currentState.latestVersionId || '').trim() || null;
  const digest = String(currentState.latestVersionDigest || '').trim() || null;
  const workUnitId = String(reviewStatus.workUnitId || currentState.activeWorkUnitId || '').trim() || null;
  return {
    versionId,
    digest,
    workUnitId,
    status: versionId ? normalizeReviewStatus(reviewStatus.status) : 'missing',
    artifact: reviewStatus.reviewPath || reviewStatus.stableArtifact || reviewStatus.entryPath || reviewStatus.artifact || null,
  };
}

function readRequirementLaneReview(root, sessionId = null) {
  const binding = readSessionBinding(root, sessionId);
  if (binding?.versionId || binding?.digest || binding?.workUnitId) {
    return {
      versionId: binding.versionId ?? null,
      digest: binding.digest ?? null,
      workUnitId: binding.workUnitId ?? null,
      status: binding.versionId ? normalizeReviewStatus(binding.reviewStatus) : 'missing',
      artifact: binding.reviewPath || binding.stableReviewArtifact || binding.activeReviewPath || binding.reviewArtifact || null,
    };
  }
  const globalReview = readCurrentPrdReview(root);
  if (sessionId && globalReview.versionId) {
    // 全局 current.json 里的确认稿可能属于另一个会话的历史需求。
    // 如果 lane 归属明确不是当前会话，就按“本轮还没有确认稿”自愈，
    // 避免把其他需求的旧稿卡成本轮的待确认死锁。
    const laneSessionId = String(readJsonSync(currentStatePath(root), {})?.laneSessionId || '').trim() || null;
    if (laneSessionId && laneSessionId !== sessionId) {
      return {
        versionId: null,
        digest: null,
        workUnitId: null,
        status: 'missing',
        artifact: null,
        staleReview: {
          versionId: globalReview.versionId,
          workUnitId: globalReview.workUnitId,
          laneSessionId,
        },
      };
    }
  }
  return globalReview;
}

function reviewCommandMatchesReview(command, review) {
  if (!command || !review) {
    return false;
  }
  return Boolean(
    command.versionId
    && command.digest
    && command.workUnitId
    && review.versionId
    && review.digest
    && review.workUnitId
    && command.versionId === review.versionId
    && command.digest === review.digest
    && command.workUnitId === review.workUnitId
  );
}

function readTextSync(filePath, maxLength = 20000) {
  try {
    return fs.readFileSync(filePath, 'utf8').slice(0, maxLength);
  } catch {
    return '';
  }
}

function readJsonlTailSync(filePath, maxLines = 160, maxBytes = 262144) {
  try {
    const stat = fs.statSync(filePath);
    const size = Number(stat.size || 0);
    const start = Math.max(0, size - maxBytes);
    const length = Math.max(0, size - start);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    fs.closeSync(fd);
    let lines = buffer.toString('utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (start > 0 && lines.length > 0) {
      lines = lines.slice(1);
    }
    return lines.slice(-maxLines).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function stateEventsPath(root) {
  return path.join(root, '.openprd', 'state', 'events.jsonl');
}

function latestDesignStarterRecord(root) {
  const entries = readJsonlTailSync(stateEventsPath(root), 80, 131072);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== 'design_starter_created' || typeof entry.output !== 'string') {
      continue;
    }
    const output = normalizeProjectFile(root, entry.output) || entry.output.trim();
    if (!output) {
      continue;
    }
    return {
      ...entry,
      output,
    };
  }
  return null;
}

const PATCH_MODE_ACTIVE_CONTRACT_FILES = [
  '.openprd/design/active/task-scope.md',
  '.openprd/design/active/facts-sheet.md',
  '.openprd/design/active/asset-spec.md',
  '.openprd/design/active/image-preflight.md',
  '.openprd/design/active/direction-plan.md',
  '.openprd/design/active/selected-direction.md',
];

const PATCH_MODE_HANDOFF_FOCUS_ALLOWANCE = 2;

function patchModeDraftCandidates(relativeTarget) {
  const normalized = String(relativeTarget || '').replace(/\\/g, '/').trim();
  if (!normalized) {
    return [];
  }
  const parsed = path.posix.parse(normalized);
  const dirPrefix = parsed.dir ? `${parsed.dir}/` : '';
  const ext = parsed.ext || '';
  const name = parsed.name || normalized;
  return [
    `${dirPrefix}${name}.next${ext}`,
    `${dirPrefix}${name}.rewrite${ext}`,
  ];
}

function safeProjectMtimeMs(root, relativePath) {
  const normalized = normalizeProjectFile(root, relativePath);
  if (!normalized) {
    return null;
  }
  try {
    return fs.statSync(path.join(root, normalized)).mtimeMs;
  } catch {
    return null;
  }
}

function patchModeTargetFiles(gate) {
  return [...new Set([
    gate?.targetFile,
    ...(Array.isArray(gate?.draftFiles) ? gate.draftFiles : []),
  ].filter(Boolean).map((file) => String(file).replace(/\\/g, '/')))];
}

function patchModeFocusFiles(root, gate) {
  return [...new Set([
    gate?.targetFile,
    ...PATCH_MODE_ACTIVE_CONTRACT_FILES.map((file) => normalizeProjectFile(root, file) || file),
  ].filter(Boolean).map((file) => String(file).replace(/\\/g, '/')))];
}

function isPatchModeWriteObserved(root, gate) {
  const threshold = Number(gate?.armedAtMs ?? 0);
  if (!threshold) {
    return false;
  }
  for (const file of patchModeTargetFiles(gate)) {
    const mtimeMs = safeProjectMtimeMs(root, file);
    if (mtimeMs && mtimeMs > threshold) {
      return true;
    }
  }
  return false;
}

function transcriptPathFor(root, payload) {
  const raw = String(payload?.transcript_path || payload?.transcriptPath || '').trim();
  if (!raw) {
    return null;
  }
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
  return fs.existsSync(resolved) ? resolved : null;
}

function assistantMessageTextFromTranscriptEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return '';
  }
  if (entry.type === 'event_msg' && entry.payload?.type === 'agent_message') {
    return String(entry.payload.message || '');
  }
  if (entry.type !== 'response_item') {
    return '';
  }
  const payload = entry.payload || {};
  if (payload.type !== 'message' || payload.role !== 'assistant') {
    return '';
  }
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function hashProjectFile(root, relativePath) {
  const normalized = normalizeProjectFile(root, relativePath);
  if (!normalized) {
    return null;
  }
  try {
    const buffer = fs.readFileSync(path.join(root, normalized));
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function patchModeFileHashSnapshot(root, files) {
  const snapshot = {};
  for (const file of files) {
    const normalized = normalizeProjectFile(root, file);
    if (!normalized) {
      continue;
    }
    snapshot[normalized] = hashProjectFile(root, normalized);
  }
  return snapshot;
}

function latestAssistantTranscriptMessage(root, payload) {
  const transcriptPath = transcriptPathFor(root, payload);
  if (!transcriptPath) {
    return null;
  }
  const entries = readJsonlTailSync(transcriptPath, 240, 393216);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const text = assistantMessageTextFromTranscriptEntry(entries[index]);
    if (!text) {
      continue;
    }
    const normalized = stripMarkdown(text).replace(/\s+/g, ' ').trim();
    if (!normalized) {
      continue;
    }
    return {
      text,
      normalized,
      preview: preview(normalized, 500),
      hash: hashText(normalized),
      transcriptPath,
    };
  }
  return null;
}

function looksLikePatchModeDeclaration(text) {
  const normalized = stripMarkdown(text).replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }
  if (/(不要|先别|暂时别).{0,10}(覆盖|重写|改写)/.test(normalized)) {
    return false;
  }
  return [
    /(?:开始|现在开始|准备开始|进入).{0,12}(?:整页)?(?:覆盖|重写|改写).{0,20}(?:入口文件|index\.html|首页|页面)/i,
    /(?:开始|现在开始|准备开始).{0,12}(?:对|把)?\s*index\.html.{0,12}(?:覆盖|重写|改写)/i,
    /(?:start|starting|begin|beginning|now).{0,24}(?:overwrite|rewrite|replace).{0,24}(?:index\.html|entry file|home page|landing page|page)/i,
    /(?:overwrite|rewrite|replace).{0,24}(?:index\.html|entry file|home page|landing page).{0,24}(?:now|next)/i,
  ].some((pattern) => pattern.test(normalized));
}

function commandLooksLikeFileWrite(command) {
  const text = String(command || '');
  if (!text) {
    return false;
  }
  return /(?:^|[\s(;])(cat\s*<<|tee\b|cp\b|mv\b|install\b|perl\b|python\b|node\b|ruby\b|sed\s+-i\b|awk\b)|>>?/.test(text);
}

function isPatchModeWriteAttempt(root, payload, gate) {
  const targetFiles = new Set(patchModeTargetFiles(gate));
  if (targetFiles.size === 0) {
    return false;
  }
  const name = toolName(payload) || (commandText(payload) ? 'Bash' : '');
  const touchedFiles = extractTouchedFiles(root, payload);
  if (['Write', 'Edit', 'MultiEdit', 'apply_patch'].includes(name) && touchedFiles.some((file) => targetFiles.has(file))) {
    return true;
  }
  const command = commandText(payload).replace(/\\/g, '/');
  if (!['Bash', 'LS', 'Glob', 'Grep'].includes(name) || !command || !commandLooksLikeFileWrite(command)) {
    return false;
  }
  return [...targetFiles].some((file) => command.includes(file));
}

function isPatchModeFocusAttempt(root, payload, gate) {
  const remaining = Number(gate?.focusAllowanceRemaining ?? 0);
  if (remaining <= 0) {
    return false;
  }
  const focusFiles = new Set(patchModeFocusFiles(root, gate));
  if (focusFiles.size === 0) {
    return false;
  }
  const name = toolName(payload) || (commandText(payload) ? 'Bash' : '');
  const touchedFiles = extractTouchedFiles(root, payload);
  if (name === 'Read') {
    return touchedFiles.length > 0 && touchedFiles.every((file) => focusFiles.has(file));
  }
  if (!['Bash', 'Glob', 'Grep', 'LS'].includes(name)) {
    return false;
  }
  const command = commandText(payload).replace(/\\/g, '/');
  if (!command || commandLooksLikeFileWrite(command)) {
    return false;
  }
  return [...focusFiles].some((file) => command.includes(file));
}

function findChangeDir(root, changeId) {
  const candidates = [
    path.join(root, '.openprd', 'changes', changeId),
    path.join(root, '.openprd', 'archive', 'changes', changeId),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeChangeId(changeId) {
  return String(changeId || '未命名需求').replace(/[-_]+/g, ' ');
}

function firstHeading(text, fallback = '') {
  const match = String(text || '').match(/^#\s+(.+)$/m);
  return stripMarkdown(match?.[1] || fallback);
}

function specRequirementTitle(text) {
  const match = String(text || '').match(/^###\s+需求[:：]\s*(.+)$/m);
  return stripMarkdown(match?.[1] || '');
}

function collectSectionSummary(text, headingPatterns, maxItems = 3) {
  const lines = String(text || '').split(/\r?\n/);
  const collected = [];
  let inSection = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      const headingText = stripMarkdown(heading[1]);
      if (inSection && !headingPatterns.some((pattern) => pattern.test(headingText))) {
        break;
      }
      inSection = headingPatterns.some((pattern) => pattern.test(headingText));
      continue;
    }
    if (!inSection) {
      continue;
    }
    const item = stripMarkdown(line);
    if (item) {
      collected.push(item);
    }
    if (collected.length >= maxItems) {
      break;
    }
  }
  return collected.join('；');
}

function cleanTaskTitle(title) {
  return stripMarkdown(title)
    .replace(/^T\d+\.\d+\s+/, '')
    .replace(/^(实现主流程|实现需求|验证验收目标)[:：]\s*/, '')
    .trim();
}

function pendingTaskTitles(root, changeId, maxItems = 3) {
  const dir = findChangeDir(root, changeId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^tasks(?:-\d+)?\.md$/.test(name)).sort();
  } catch {
    return [];
  }
  const tasks = [];
  for (const file of files) {
    const text = readTextSync(path.join(dir, file));
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^- \[ \]\s+(.+)$/);
      if (!match) {
        continue;
      }
      const title = cleanTaskTitle(match[1]);
      if (title) {
        tasks.push(title);
      }
    }
  }
  const productTasks = tasks.filter((title) => !/(spec|validate|校验|评审|测试|文档|打包)/i.test(title));
  return (productTasks.length > 0 ? productTasks : tasks).slice(0, maxItems);
}

function readLocalTaskSummary(root, changeId) {
  if (!changeId) {
    return null;
  }
  const dir = findChangeDir(root, changeId);
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((name) => /^tasks(?:-\d+)?\.md$/.test(name)).sort();
  } catch {
    return null;
  }
  let total = 0;
  let completed = 0;
  let pending = 0;
  for (const file of files) {
    const text = readTextSync(path.join(dir, file));
    for (const line of text.split(/\r?\n/)) {
      if (/^- \[x\]\s+/i.test(line)) {
        total += 1;
        completed += 1;
      } else if (/^- \[ \]\s+/.test(line)) {
        total += 1;
        pending += 1;
      }
    }
  }
  if (total === 0) {
    return null;
  }
  return {
    total,
    completed,
    pending,
    blocked: 0,
  };
}

function changeRequirementSummary(root, changeId) {
  const dir = findChangeDir(root, changeId);
  const proposal = readTextSync(path.join(dir, 'proposal.md'));
  const design = readTextSync(path.join(dir, 'design.md'));
  let spec = '';
  try {
    const specsRoot = path.join(dir, 'specs');
    const capability = fs.readdirSync(specsRoot).find((name) => !name.startsWith('.'));
    if (capability) {
      spec = readTextSync(path.join(specsRoot, capability, 'spec.md'));
    }
  } catch {}

  const title = firstHeading(proposal)
    || specRequirementTitle(spec)
    || firstHeading(design)
    || humanizeChangeId(changeId);
  const summary = collectSectionSummary(proposal, [/背景/, /原因/, /为什么/], 2)
    || collectSectionSummary(spec, [/新增需求/, /需求/], 2)
    || collectSectionSummary(design, [/目标/, /背景/], 3);

  return {
    title,
    summary,
    pendingTasks: pendingTaskTitles(root, changeId),
  };
}

function inferLearningGenre(text) {
  const value = String(text || '');
  if (/仙侠|修仙|玄幻/.test(value)) {
    return 'xianxia';
  }
  if (/武侠/.test(value)) {
    return 'wuxia';
  }
  if (/童话|寓言/.test(value)) {
    return 'fairy-tale';
  }
  if (/科幻|赛博|cyberpunk|sci[-\s]?fi/i.test(value)) {
    return 'sci-fi';
  }
  if (/互联网产品|产品经理|PM/i.test(value)) {
    return 'internet-product';
  }
  return null;
}

function detectLearningMaterialIntent(prompt) {
  const text = stripMarkdown(prompt).trim();
  if (!text) {
    return { requested: false, genre: null, reason: null };
  }
  const explicitChatOnly = /(只要|仅要|仅需|就|直接).{0,16}(在对话里|回复|回答|写一段|一段文字|短文|纯文本|普通文本)|不要.{0,18}(文件|阅读器|学习包|HTML|html|openprd)/i.test(text);
  const durableReaderSignal = /(可长期阅读|长期阅读|可回看|阅读器|reader|电子书|学习包|归档)/i.test(text);
  if (explicitChatOnly && !durableReaderSignal) {
    return { requested: false, genre: null, reason: 'chat-only-requested' };
  }

  // This is an intent-shape detector, not a closed keyword table. The hook
  // looks for a requested learning deliverable, its durability/teaching goal,
  // and whether the expected output wants reader-like structure.
  const deliveryAction = /(生成|整理|产出|做一份|做一套|做个|做一个|创建|写一份|准备|沉淀|归档|转成|转换成|变成|输出|构建|给我)/i.test(text);
  const learningGoal = /(学习|教学|培训|复盘|教程|讲义|教材|课程|知识沉淀|经验沉淀|可回看|可复用|长期阅读|新人入门|onboarding)/i.test(text);
  const readerShape = /(学习(材料|资料|包|读本|文档)|复盘材料|教学材料|培训材料|教程|讲义|教材|课程|读本|电子书|阅读器|reader|ebook|章节|目录|证据锚点|图文讲解|检索练习|工作示例|可长期阅读|长期阅读)/i.test(text);
  const workToLearningArtifact = /(把|将|基于|围绕).{0,48}(工作|任务|过程|对话|会话|修复|需求|项目|实现|经验|记录|材料).{0,32}(转成|转换成|整理成|沉淀成|归档成|做成|写成).{0,40}(学习|复盘|教学|教程|讲义|材料|读本|可回看|可复用|长期阅读)/i.test(text);
  const requested = workToLearningArtifact
    || (readerShape && (deliveryAction || learningGoal || durableReaderSignal))
    || (learningGoal && durableReaderSignal);
  return {
    requested,
    genre: requested ? inferLearningGenre(text) : null,
    reason: workToLearningArtifact ? 'work-to-learning-artifact' : (readerShape ? 'reader-shaped-learning-artifact' : (requested ? 'durable-learning-goal' : null)),
  };
}

function analyzePromptIntent(prompt) {
  const text = String(prompt || '').trim();
  const normalized = text.toLowerCase();
  const continuationSessionId = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0] ?? null;
  const continuationTaskHandle = text.match(/\b[a-z0-9._-]+:T\d{3}\.\d{2}:[a-z0-9._-]+\b/i)?.[0] ?? null;
  const continuationWorkUnitId = text.match(/\bwu-[a-z0-9._-]+\b/i)?.[0] ?? null;
  const promptReviewCommand = parseReviewMarkCommand(text);
  const continuationVerbMatched = /(?:(?:继续|续做|接着做|继续执行|继续推进)(?:这个|这条|当前)?\s*(?:对话|任务|会话|记录|历史|Codex\s*任务)|(?:对话|任务|会话|记录|历史|Codex\s*任务).{0,6}(?:继续|续做|接着做|继续执行|继续推进)|^(?:继续|续做|接着做|继续执行|继续推进)\s*(?::|：))/i.test(text);
  const continuationRequest = continuationVerbMatched
    || Boolean(
      continuationTaskHandle
        || (continuationWorkUnitId && !promptReviewCommand)
    );
  const githubRepoPattern = /(?:https?:\/\/)?github\.com\/[^\s/]+\/[^\s/#?]+|(?:^|[\s(])[\w.-]+\/[\w.-]+(?=$|[\s)#?])/i;
  const internalOpenPrdExecution = /^#\s*OpenPrd\s+长程单任务执行会话/m.test(text)
    || /模式:\s*loop-run\b/i.test(text)
    || /模式:\s*loop-finish\b/i.test(text);
  // These signals only decide when to inject/open the requirement-intake lane.
  // The matcher should stay conservative: only likely L2 requests open the
  // heavy gate; L0/L1 stay lightweight unless the user expands the scope.
  const requirementRoutingSignalsStrong = [
    /新增/,
    /增加/,
    /新建/,
    /我希望/,
    /需求/,
    /模块/,
    /入口/,
    /流程/,
    /编排/,
    /一站式/,
    /信息架构/,
    /团队搭建/,
    /agent\s*市场/i,
    /skill\s*library/i,
    /UI/i,
    /cli\s*库/i,
    /workflow/i,
    /wizard/i,
  ];
  const requirementRoutingSignalsWeak = [
    /用户反馈/,
    /功能/,
    /页面/,
    /界面/,
    /视觉/,
    /体验/,
  ];
  const requirementChangeIntentSignals = [
    /新增/,
    /增加/,
    /新建/,
    /改(动|版|造|进|一下)?/,
    /优化/,
    /调整/,
    /重做/,
    /重构/,
    /放到/,
    /移到/,
    /移动到/,
    /切到/,
    /切换到/,
    /替换(成|为)?/,
    /串联/,
    /接入/,
    /实现/,
    /落地/,
  ];
  const tinyEditPatterns = [
    /加(一个|个)?空格/,
    /增加(一个|个)?空格/,
    /删(一个|个)?空格/,
    /去掉(一个|个)?空格/,
    /空格|标点|错别字|拼写|大小写/,
    /文案.{0,8}(改短|调整|替换)/,
    /按钮文案/,
    /typo/i,
    /spacing/i,
    /copy/i,
  ];
  const simpleConcretePatterns = [
    /按钮|文案|颜色|圆角|位置|间距|留白|边距|宽度|高度|卡片|字号|图标|标题|空格|标点|对齐|密度|label|copy|padding|margin|spacing|gap/i,
    /从.+(改到|移到|移动到|换到|变成|改成|改为).+/,
  ];
  const l2StructuralScopePatterns = [
    /模块/,
    /入口/,
    /流程/,
    /导入流/,
    /编排/,
    /workflow/i,
    /wizard/i,
  ];
  const l2StrategicScopePatterns = [
    /一站式/,
    /团队搭建/,
    /agent\s*市场/i,
    /skill\s*library/i,
    /cli\s*库/i,
    /权限/,
    /审批/,
    /计费/,
    /账号/,
    /第三方/,
    /云服务/,
    /迁移/,
    /跨系统/,
    /(AI|模型).{0,8}(接入|集成|编排)/i,
  ];
  const structuralExpansionIntensityPatterns = [
    /串联/,
    /一站式/,
    /整体/,
    /全链路/,
    /端到端/,
    /体系/,
    /平台/,
    /多个/,
  ];
  const featurePlanningPatterns = [
    /需求/,
    /方案/,
    /规划/,
    /产品/,
  ];
  const capabilityCreationPatterns = [
    /新增/,
    /增加/,
    /新建/,
    /做(一个|个)?/,
    /支持/,
    /提供/,
    /搭建/,
    /引入/,
    /接入/,
    /集成/,
  ];
  const crossSystemRiskPatterns = [
    /支付|登录|注册|账号|权限|订单|回调|风控|退款|计费|同步|迁移|数据库|schema|协议|网关|跨系统|第三方|云服务|OSS|CDN|MCP|SDK|CLI/i,
  ];
  const l1OptimizationPatterns = [
    /(优化|调整|改版|重做|重构|增强|补齐|梳理|统一|整理)/,
  ];
  const l0AdjustmentPatterns = [
    /(修复|修一下|改一下|调一下|换成|改成|去掉|补一个|补一下)/,
  ];
  const explicitExecutionPatterns = [
    /直接(帮我|给我)?(改|做|实现|落地|修|修复|处理|解决)/,
    /如果.{0,24}(定位|确认|找到).{0,12}(原因|根因).{0,24}直接.{0,12}(帮我|给我)?(修|修复|改|处理|解决)/,
    /开始(改|做|实现|开发|落地)/,
    /继续(改|做|实现|开发|落地|修|修复|处理|解决)/,
    /请(直接)?(实现|落地|修改|修复|处理|解决)/,
    /可以(执行|落地|实现|开发)/,
    /去(改|做|实现|开发|落地|修|修复|处理|解决)吧/,
    /那你去(改|做|实现|开发|落地|修|修复|处理|解决)吧/,
  ];
  const implementationConfirmationPatterns = [
    /确认.*(执行|落地|实现|继续|开发|修复|修改|处理|解决|改)/,
    /按(这个|刚才|上面|已确认)?.{0,12}(方案|计划|拆解).{0,12}(执行|落地|实现|开发|修复|修改|处理|解决|改)/,
    /按.{0,12}(思路|方案|计划|拆解).{0,12}(来吧|来|走|做|执行|落地|实现|开发|修复|修改|处理|解决|改)/,
  ];
  const noReviewRequestedPatterns = [
    /不需要评审/,
    /不用评审/,
    /无需评审/,
    /不要评审/,
    /别再评审/,
  ];
  const noConfirmationRequestedPatterns = [
    /不需要(再)?确认/,
    /不用(再)?确认/,
    /无需(再)?确认/,
    /不要(再)?确认/,
    /别再确认/,
    /不需要再跟我确认/,
  ];
  const reviewContinuationPatterns = [
    /认可方案并继续/,
    /认可并继续/,
    /继续当前\s*openprd\s*下一步/i,
    /按当前\s*openprd\s*下一步继续/i,
  ];
  const reviewConfirmPatterns = [
    /认可方案/,
    // 容忍“确认 v0276 评审稿”这类中间插版本号/空格的自然语言确认。
    /确认(?:当前|这个|这版|该)?\s*(?:[vV]\d+\s*(?:的)?)?(?:PRD|评审稿|评审页|review|需求稿|版本)/i,
    /确认\s*[vV]\d+/,
    /(?:PRD|评审稿|评审页|review|需求稿|版本)\s*(?:[vV]\d+)?.{0,12}(确认|通过|没问题|认可|可以)/i,
    /按这版(?:PRD|评审|需求稿)/i,
  ];
  const reviewNeedsRevisionPatterns = [
    /(?:PRD|评审稿|评审页|review|需求稿|版本).{0,12}(需要调整|需要修改|要调整|要修改)/i,
  ];
  const readOnlyPatterns = [
    /看看/,
    /看下(一下)?/,
    /你看/,
    /规划/,
    /分析/,
    /先分析(一下)?/,
    /梳理/,
    /评估/,
    /怎么改/,
    /预计动哪些文件/,
    /看(看)?(一下)?(原因|问题|风险|情况)/,
    /什么原因/,
    /怎么看/,
    /你觉得/,
    /可行吗/,
    /有没有可能/,
    /会有什么问题/,
    /值不值得/,
    /review/i,
    /explain/i,
  ];
  const bugfixOrDiagnostic = /诊断包|报错|错误|异常|崩溃|bug|问题|排查|定位|根因|复现|日志|故障/i.test(text)
    || /失败.{0,20}(原因|根因|排查|定位|修|修复|处理|解决)|(?:原因|根因|排查|定位).{0,20}失败/.test(text);
  const tinyEdit = tinyEditPatterns.some((pattern) => pattern.test(text));
  const crossSystemRiskMatched = crossSystemRiskPatterns.some((pattern) => pattern.test(text));
  const localUiScopeMatched = hasLightweightUiVisualSignal(text)
    || /(样式|页面|界面|布局|信息架构|导航|列表|详情页|设置页)/i.test(text);
  const reviewContinuationRequested = reviewContinuationPatterns.some((pattern) => pattern.test(text));
  const explicitExecution = internalOpenPrdExecution
    || continuationVerbMatched
    || reviewContinuationRequested
    || explicitExecutionPatterns.some((pattern) => pattern.test(text));
  const implementationConfirmation = reviewContinuationRequested
    || implementationConfirmationPatterns.some((pattern) => pattern.test(text));
  const noReviewRequested = noReviewRequestedPatterns.some((pattern) => pattern.test(text));
  const noConfirmationRequested = noConfirmationRequestedPatterns.some((pattern) => pattern.test(text));
  const reviewDecision = promptReviewCommand?.mark
    ?? (reviewContinuationRequested ? 'confirmed' : null)
    ?? (reviewConfirmPatterns.some((pattern) => pattern.test(text)) ? 'confirmed' : null)
    ?? (reviewNeedsRevisionPatterns.some((pattern) => pattern.test(text)) ? 'needs-revision' : null);
  const confirmation = implementationConfirmation || Boolean(reviewDecision);
  const readOnly = readOnlyPatterns.some((pattern) => pattern.test(text));
  const codeVisualArtifactRequested = /HTML|SVG|CSS|Canvas|代码稿|源码|source artifact|可编辑矢量|可编辑稿/i.test(text);
  const imageGenerationTerms = /图片|封面图|封面|配图|海报|插画|图标|贴纸|头像|banner|横幅|KV|主视觉|运营图|宣传图|商品图|背景图|壁纸|位图资产|效果图|视觉稿|mockup|样子|设计方向|设计预览/i;
  const imageGenerationAction = /生成|出一张|做一张|做个|做一个|画|绘制|设计|产出|给我|来一张|先看|确认|预览|看看|截图/i;
  const visualMockupRequest = imageGenerationTerms.test(text)
    && imageGenerationAction.test(text)
    && !codeVisualArtifactRequested;
  const learningMaterialIntent = detectLearningMaterialIntent(text);
  const learningMaterialRequest = learningMaterialIntent.requested;
  const canvasCollaborationRequest = /(画布|canvas|excalidraw)/i.test(text)
    && /(标注|批注|协同|改图|回填|贴到画布|放到画布|插入画布|插到画布|画布评审|画布反馈|一起看|openprd\s*canvas|annotation)/i.test(text);
  const visualReview = /效果图|实现截图|视觉对比|视觉评审|对标效果图|复刻|不一致|好丑|没对齐|对不上|不像/i.test(text);
  const largeUiVisualDirectionRequest = visualMockupRequest
    && /(界面改动比较大|大界面|大改|改版|重做|重新设计|三种设计方向|3\s*种设计方向|多个设计方向|信息架构|核心布局|首屏|关键路径)/i.test(text);
  const directBugfixExecution = explicitExecution && bugfixOrDiagnostic;
  const newFeatureVerbMatched = /(新增|增加|新建)/.test(text);
  const capabilityCreationMatched = capabilityCreationPatterns.some((pattern) => pattern.test(text));
  const featurePlanningMatched = featurePlanningPatterns.some((pattern) => pattern.test(text));
  const structuralL2ScopeMatchCount = l2StructuralScopePatterns.filter((pattern) => pattern.test(text)).length;
  const strategicL2ScopeMatched = l2StrategicScopePatterns.some((pattern) => pattern.test(text));
  const structuralExpansionMatched = structuralL2ScopeMatchCount >= 2
    || (structuralL2ScopeMatchCount >= 1
      && (structuralExpansionIntensityPatterns.some((pattern) => pattern.test(text)) || (capabilityCreationMatched && !localUiScopeMatched)));
  const l2ScopeMatched = strategicL2ScopeMatched || structuralExpansionMatched;
  const simpleConcrete = text.length <= 80
    && simpleConcretePatterns.some((pattern) => pattern.test(text))
    && !l2ScopeMatched;
  const requirementSignalMatched = requirementRoutingSignalsStrong.some((pattern) => pattern.test(text))
    || (requirementRoutingSignalsWeak.some((pattern) => pattern.test(text))
      && requirementChangeIntentSignals.some((pattern) => pattern.test(text)));
  const l2FeatureExpansionMatched = (capabilityCreationMatched && (strategicL2ScopeMatched || structuralExpansionMatched))
    || (!localUiScopeMatched && newFeatureVerbMatched && text.length > 18);
  const l2PlanningRequestMatched = !readOnly
    && featurePlanningMatched
    && requirementChangeIntentSignals.some((pattern) => pattern.test(text))
    && (strategicL2ScopeMatched || structuralExpansionMatched);
  const l1OptimizationMatched = l1OptimizationPatterns.some((pattern) => pattern.test(text))
    && (hasLightweightUiVisualSignal(text) || /(页面|界面|视觉|样式|布局|信息架构|交互|体验|流程|入口|导航|表单|设置页|列表|详情页)/i.test(text));
  // 改现有脚本、CLI、发布/构建流程、参数或文档这类既有资产优化，
  // 不应仅因出现“新增/增加/补一个”动词就升级成 L2 重流程；
  // 只有同时命中真正的结构/战略扩张信号时才保留 L2。
  const existingAssetOptimizationMatched = /(脚本|script|发布|上传|部署|构建|打包|导出|同步|清理|CLI|命令行|命令|参数|选项|flag|配置文件|文档|README)/i.test(text)
    && /(补|加|增加|支持|筛选|过滤|优化|调整|收敛|清理|改成|改为|升级|更新|修改|梳理)/.test(text)
    && !/(新产品|新模块|新平台|新系统|新页面|新界面|新客户端|全新|从零|从\s*0|重写整个|重构整个)/i.test(text);
  const l0AdjustmentMatched = l0AdjustmentPatterns.some((pattern) => pattern.test(text))
    && (hasLightweightUiVisualSignal(text) || /(样式|一处)/i.test(text));
  const publicRepoResearchRequest = githubRepoPattern.test(text)
    && /(github|仓库|repo|项目|参考|对标|复刻|review|学习|架构|模块|流程|构建|测试|扩展点)/i.test(text);
  const externalTechResearchRequest = /(第三方|library|framework|sdk|api|mcp|cli|依赖|包|版本|迁移|弃用|官方文档|参数|返回值|生命周期)/i.test(text)
    && /(怎么用|用法|配置|限制|版本|迁移|报错|集成|接入|最佳实践|示例|安装|参数|返回值|生命周期)/i.test(text);
  const skillWorkflowEditRequest = /SKILL\.md|AGENTS\.md/i.test(text)
    || (/(^|[^a-z])(skill|skills)([^a-z]|$)/i.test(text) && /(创建|修改|优化|重构|合并|拆分|更新|工作流|workflow|流程|路由|router|提示词|规则)/i.test(text))
    || (/AGENTS\.md/i.test(text) && /(创建|修改|优化|精简|收薄|重构|更新)/i.test(text));
  const secretsRequest = /(api\s*key|token|secret|credential|password|凭证|密钥|密码|账号信息|第三方服务凭证|个人信息|登录信息)/i.test(text);
  const weappMention = /(微信小程序|miniprogram|weapp|微信开发者工具|weapp-dev-mcp)/i.test(text);
  const weappValidationAction = /(测试|验证|实测|复现|截图|日志|抓日志|抓包|网络请求|network|运行态|开发者工具自动化|从\s*0\s*到\s*1|冷启动|重开|重新打开|全流程)/i.test(text);
  const weappValidationRequest = /weapp-dev-mcp/i.test(text)
    || (weappMention && weappValidationAction);
  const browserSafetyRequest = /(computer use|browser use|浏览器|browser|网页|页面|窗口|标签页|tab|profile)/i.test(text)
    && /(点击|输入|提交|登录|注销|退出|支付|关闭|send|submit|type|click|switch account|切换账号)/i.test(text);
  const productCopyRequest = /(文案|copy|错误文案|空状态|成功提示|按钮文案|提示语|toast|placeholder|设置项文案|国际化|i18n|locales|translations|localizable)/i.test(text);
  const l2RequirementCandidate = (bugfixOrDiagnostic && crossSystemRiskMatched)
    || l2FeatureExpansionMatched
    || l2PlanningRequestMatched;
  const existingAssetDemotionApplies = existingAssetOptimizationMatched
    && !strategicL2ScopeMatched
    && structuralL2ScopeMatchCount === 0;
  const requirementTier = !internalOpenPrdExecution
    ? (l2RequirementCandidate
        && !existingAssetDemotionApplies
        && !tinyEdit
        && !simpleConcrete
        && !visualMockupRequest
        && !(readOnly && !explicitExecution)
      ? 'l2'
      : (!visualMockupRequest
          && (!readOnly || explicitExecution)
          && (tinyEdit
            || simpleConcrete
            || l0AdjustmentMatched
            || (directBugfixExecution && !crossSystemRiskMatched)
            || (bugfixOrDiagnostic && !crossSystemRiskMatched))
        ? 'l0'
        : (!visualMockupRequest
            && !readOnly
            && (l1OptimizationMatched
              || requirementSignalMatched
              || (l2RequirementCandidate && existingAssetDemotionApplies))
          ? 'l1'
          : null)))
    : null;
  const requiresIntake = requirementTier === 'l2';
  return {
    promptText: text,
    requirementTier,
    requiresIntake,
    explicitExecution,
    confirmation,
    implementationConfirmation,
    noReviewRequested,
    noConfirmationRequested,
    reviewDecision,
    reviewCommand: promptReviewCommand,
    reviewContinuationRequested,
    readOnly,
    simpleConcrete,
    visualMockupRequest,
    largeUiVisualDirectionRequest,
    continuationRequest,
    continuationSessionId,
    continuationTaskHandle,
    continuationWorkUnitId,
    publicRepoResearchRequest,
    externalTechResearchRequest,
    skillWorkflowEditRequest,
    secretsRequest,
    weappValidationRequest,
    browserSafetyRequest,
    productCopyRequest,
    learningMaterialRequest,
    learningGenre: learningMaterialIntent.genre,
    learningMaterialReason: learningMaterialIntent.reason,
    canvasCollaborationRequest,
    shouldInject: requiresIntake
      || requirementTier === 'l1'
      || explicitExecution
      || confirmation
      || readOnly
      || visualMockupRequest
      || continuationRequest
      || visualReview
      || publicRepoResearchRequest
      || externalTechResearchRequest
      || skillWorkflowEditRequest
      || secretsRequest
      || weappValidationRequest
      || browserSafetyRequest
      || productCopyRequest
      || learningMaterialRequest
      || canvasCollaborationRequest
      || /openprd/i.test(normalized)
      || /\bprd\b/i.test(normalized),
  };
}

function isShortAffirmativeConfirmation(prompt) {
  const text = stripMarkdown(prompt).trim();
  return /^(可以|好|行|确认|确定|没问题|同意|就这样|OK|ok|yes|Yes|yep|Yep)[。！!,.，s]*$/.test(text);
}

function looksLikeClarificationFollowupReply(prompt, intent = null) {
  const text = stripMarkdown(prompt).trim();
  if (!text || text.length > 48 || /[\n\r]/.test(text) || /[?？]/.test(text)) {
    return false;
  }
  if (intent?.requiresIntake || intent?.readOnly || intent?.reviewDecision || intent?.publicRepoResearchRequest || intent?.externalTechResearchRequest || intent?.skillWorkflowEditRequest || intent?.continuationRequest) {
    return false;
  }
  if (/[：:]/.test(text) && text.length > 24) {
    return false;
  }
  return true;
}

function detectRequirementIntakeMode(prompt) {
  const text = String(prompt || '');
  const deep = text.length >= 80
    || /新增|新建|模块|流程|编排|一站式|信息架构|工作流|workflow|wizard/i.test(text)
    || /多角色|权限|审批|协作|团队|客户|后台|管理/.test(text)
    || /AI|agent|模型|生成|自动化|集成|第三方/i.test(text)
    || /体验|优化|提升|更好|智能|自动|高效|完整|体系|平台/.test(text);
  return deep ? 'deep-reflection' : 'focused-reflection';
}

function readRequirementGate(root, sessionId = null) {
  return readJsonSync(requirementGatePath(root, sessionId), null);
}

function writeRequirementGate(root, value, sessionId = null) {
  const next = sessionId ? { ...value, sessionId } : value;
  writeJsonSync(requirementGatePath(root, sessionId), next);
  if (sessionId) {
    writeJsonSync(legacyRequirementGatePath(root), next);
    writeSessionBinding(root, sessionId, {
      promptPreview: next.promptPreview ?? null,
      gateStatus: next.status ?? null,
      gateActive: Boolean(next.active),
    });
  }
}

function mirrorRequirementGate(root, sessionId) {
  if (!sessionId) return null;
  const gate = readRequirementGate(root, sessionId);
  if (gate) {
    writeJsonSync(legacyRequirementGatePath(root), gate);
  }
  return gate;
}

function openRequirementGate(root, prompt, intent, sessionId = null) {
  const current = readRequirementGate(root, sessionId);
  const approvalPolicy = resolveRequirementApprovalPolicy(prompt, intent);
  const gate = {
    version: 1,
    active: true,
    status: 'requirement-background-attention',
    openedAt: current?.openedAt || now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    reason: 'likely-l2 background requirement flow',
    backgroundFlow: ['requirement-intake', 'clarify', 'capture', 'synthesize', 'review', 'change-generate', 'tasks'],
    intakeMode: detectRequirementIntakeMode(prompt),
    intent,
    executionIntent: {
      explicitRequested: Boolean(intent?.explicitExecution),
      suppressExtraConfirmation: true,
      source: 'original-user-scope',
      latchedAt: now(),
    },
    approvalPolicy,
    reviewArtifactRecord: null,
  };
  writeRequirementGate(root, gate, sessionId);
  return gate;
}

function updateRequirementGate(root, patch, sessionId = null) {
  const current = readRequirementGate(root, sessionId);
  if (!current?.active) {
    return current;
  }
  const next = {
    ...current,
    active: true,
    updatedAt: now(),
    ...patch,
  };
  writeRequirementGate(root, next, sessionId);
  return next;
}

function openResearchGate(root, prompt, intent, sessionId = null) {
  const kind = intent?.publicRepoResearchRequest ? 'deepwiki' : 'context7';
  return writeNamedGate(root, 'research', {
    version: 1,
    active: true,
    kind,
    status: kind === 'deepwiki' ? 'needs-deepwiki-evidence' : 'needs-context7-evidence',
    openedAt: now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    localEvidenceSeen: false,
    externalEvidence: {
      readWikiStructure: false,
      askQuestion: false,
      resolveLibraryId: false,
      queryDocs: false,
    },
  }, sessionId);
}

function closeResearchGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'research', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'research', {
    ...current,
    active: false,
    status: patch.status || 'closed',
    closedAt: patch.closedAt || now(),
    ...patch,
  }, sessionId);
}

function openSkillVisualizationGate(root, prompt, sessionId = null) {
  return writeNamedGate(root, 'skill-visualization', {
    version: 1,
    active: true,
    status: 'needs-visual-confirmation',
    openedAt: now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
  }, sessionId);
}

function confirmSkillVisualizationGate(root, prompt, sessionId = null) {
  const current = readNamedGate(root, 'skill-visualization', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'skill-visualization', {
    ...current,
    active: false,
    status: 'user-confirmed-after-visualization',
    confirmedAt: now(),
    confirmationPreview: preview(prompt, 500),
  }, sessionId);
}

function closeSkillVisualizationGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'skill-visualization', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'skill-visualization', {
    ...current,
    active: false,
    status: patch.status || 'closed',
    closedAt: patch.closedAt || now(),
    ...patch,
  }, sessionId);
}

function openWeappGate(root, prompt, sessionId = null) {
  return writeNamedGate(root, 'weapp', {
    version: 1,
    active: true,
    status: 'needs-weapp-runtime-validation',
    openedAt: now(),
    updatedAt: now(),
    promptPreview: preview(prompt, 500),
    validationSignals: {
      ensureConnection: false,
      runtimeAction: false,
    },
  }, sessionId);
}

function closeWeappGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'weapp', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'weapp', {
    ...current,
    active: false,
    status: patch.status || 'validated',
    closedAt: patch.closedAt || now(),
    ...patch,
  }, sessionId);
}

function openPatchModeGate(root, patch, sessionId = null) {
  const current = readNamedGate(root, 'patch-mode', sessionId);
  return writeNamedGate(root, 'patch-mode', {
    version: 1,
    active: true,
    status: 'awaiting-entry-write',
    openedAt: current?.openedAt || now(),
    updatedAt: now(),
    ...current,
    ...patch,
  }, sessionId);
}

function closePatchModeGate(root, sessionId = null, patch = {}) {
  const current = readNamedGate(root, 'patch-mode', sessionId);
  if (!current) {
    return null;
  }
  return writeNamedGate(root, 'patch-mode', {
    ...current,
    active: false,
    status: patch.status || 'closed',
    closedAt: patch.closedAt || now(),
    updatedAt: now(),
    ...patch,
  }, sessionId);
}

function syncPatchModeGate(root, payload, sessionId = null, intent = null) {
  let gate = readNamedGate(root, 'patch-mode', sessionId);
  if (gate?.active && isPatchModeWriteObserved(root, gate)) {
    gate = closePatchModeGate(root, sessionId, {
      status: 'write-observed',
      writeObservedAt: now(),
    });
  }
  const designStarter = latestDesignStarterRecord(root);
  if (!designStarter && !isFrontendTaskIntent(intent)) {
    return gate;
  }
  const targetFile = normalizeProjectFile(root, designStarter?.output || 'index.html') || 'index.html';
  const draftFiles = patchModeDraftCandidates(targetFile);
  const fileHashesAtArm = patchModeFileHashSnapshot(root, [targetFile, ...draftFiles]);
  const assistantMessage = latestAssistantTranscriptMessage(root, payload);
  if (assistantMessage && looksLikePatchModeDeclaration(assistantMessage.normalized)) {
    if (gate?.messageHash === assistantMessage.hash && gate?.targetFile === targetFile && gate?.phase === 'strict') {
      return gate;
    }
    return openPatchModeGate(root, {
      phase: 'strict',
      status: 'awaiting-entry-write',
      targetFile,
      targetHashAtArm: hashProjectFile(root, targetFile),
      fileHashesAtArm,
      draftFiles,
      focusAllowanceRemaining: 0,
      messageHash: assistantMessage.hash,
      messagePreview: assistantMessage.preview,
      transcriptPath: assistantMessage.transcriptPath,
      designStarterOutput: targetFile,
      armedAtMs: Date.now(),
      armedAt: now(),
    }, sessionId);
  }
  if (!designStarter) {
    return gate;
  }
  if (gate?.active && gate?.targetFile === targetFile) {
    return gate;
  }
  return openPatchModeGate(root, {
    phase: 'handoff',
    status: 'awaiting-patch-handoff',
    targetFile,
    targetHashAtArm: hashProjectFile(root, targetFile),
    fileHashesAtArm,
    draftFiles,
    focusAllowanceRemaining: PATCH_MODE_HANDOFF_FOCUS_ALLOWANCE,
    messageHash: assistantMessage?.hash || null,
    messagePreview: assistantMessage?.preview || null,
    transcriptPath: assistantMessage?.transcriptPath || null,
    designStarterOutput: targetFile,
    armedAtMs: Date.now(),
    armedAt: now(),
  }, sessionId);
}

function evaluateRequirementGateProgress(root, sessionId = null) {
  const gate = readRequirementGate(root, sessionId);
  const binding = readSessionBinding(root, sessionId);
  const review = readRequirementLaneReview(root, sessionId);
  const activeChange = binding?.changeId ?? null;
  const taskSummary = activeChange ? readLocalTaskSummary(root, activeChange) : null;
  const hasTaskBreakdown = Boolean(activeChange && Number(taskSummary?.total ?? 0) > 0);
  let nextStep = 'implementation-ready';
  if (!review.versionId) nextStep = 'requirement-summary-background';
  else if (review.status === 'needs-revision') nextStep = 'review-revision-background';
  else if (review.status !== 'confirmed') nextStep = 'review-recording-background';
  else if (!activeChange) nextStep = 'change-generation-background';
  else if (!hasTaskBreakdown) nextStep = 'task-breakdown-background';
  return {
    binding,
    review,
    activeChange,
    taskSummary,
    hasTaskBreakdown,
    approvalPolicy: requirementApprovalPolicy(gate),
    nextStep,
    reason: 'OpenPrd 只记录当前工作区事实；任务上下文与下一步由 Agent 自己管理。',
  };
}
function reviewArtifactRecordFor(intent, progress, prompt) {
  const review = progress?.review ?? null;
  const requested = intent?.reviewCommand ?? null;
  const mark = requested?.mark ?? intent?.reviewDecision ?? null;
  if (!mark || !review?.versionId || !review?.digest || !review?.workUnitId) {
    return null;
  }
  if (requested && !reviewCommandMatchesReview(requested, review)) {
    return null;
  }
  return {
    mark,
    versionId: review.versionId,
    digest: review.digest,
    workUnitId: review.workUnitId,
    promptPreview: preview(prompt, 500),
    recordedAt: now(),
    source: 'explicit-user-review-decision',
  };
}

function holdRequirementGate(root, prompt, progress, sessionId = null, extra = {}) {
  const reviewArtifactRecord = extra.reviewArtifactRecord ?? null;
  const patch = {
    status: extra.status ?? progress.nextStep,
    confirmationPreview: preview(prompt, 500),
    reviewArtifactRecord,
  };
  if (extra.clarificationConfirmedAt) {
    patch.clarificationConfirmedAt = extra.clarificationConfirmedAt;
    patch.clarificationConfirmationPreview = extra.clarificationConfirmationPreview ?? preview(prompt, 500);
  }
  return updateRequirementGate(root, patch, sessionId);
}

function isImplementationAdvanceIntent(intent) {
  return Boolean(intent?.explicitExecution || intent?.implementationConfirmation);
}

function isReadOnlyRequirementGate(gate) {
  return Boolean(gate?.active && gate?.intent?.readOnly && !gate?.intent?.explicitExecution);
}

function isRequirementAttentionActive(gate) {
  return Boolean(gate?.active);
}

function isRequirementGateActive(root, sessionId = null) {
  return isRequirementAttentionActive(readRequirementGate(root, sessionId));
}

function isMutationPayload(payload, risk) {
  const text = payloadText(payload);
  const tool = String(payload.tool_name || payload.toolName || payload.name || '');
  return risk.level === 'medium'
    || risk.level === 'high'
    || /apply_patch/i.test(tool)
    || /apply_patch/i.test(text)
    || /\*\*\* Begin Patch/.test(text);
}

function isRuntimeAutonomyRiskFile(file) {
  const normalized = String(file || '').split(path.sep).join('/');
  if (!normalized) {
    return true;
  }
  if (/^(docs|test|tests|__tests__|fixtures|examples|templates?)\//i.test(normalized)) {
    return false;
  }
  if (/(^|\/)(AGENTS|CLAUDE|README|CHANGELOG|SKILL)\.md$/i.test(normalized)) {
    return false;
  }
  if (/\.(?:md|mdx|txt|rst)$/i.test(normalized)) {
    return false;
  }
  return true;
}

function hasExplicitAutonomyRiskApproval(intent = null) {
  const text = String(intent?.promptText || '');
  if (!text.trim()) {
    return false;
  }
  const riskTerms = /(云端|线上|生产环境|远端|热修复|hotfix|兜底|临时兜底|fallback|fall\s*back|写死|硬编码|hardcode|hard-coded|hard coded)/i;
  if (!riskTerms.test(text)) {
    return false;
  }
  const negatedRisk = /(不要|禁止|不允许|不得|不能|避免|默认不|未明确|未经|除非).{0,48}(云端|线上|生产环境|远端|热修复|hotfix|兜底|临时兜底|fallback|fall\s*back|写死|硬编码|hardcode|hard-coded|hard coded)|(云端|线上|生产环境|远端|热修复|hotfix|兜底|临时兜底|fallback|fall\s*back|写死|硬编码|hardcode|hard-coded|hard coded).{0,48}(不要|禁止|不允许|不得|不能|避免|默认不|未明确|未经|除非)/i;
  if (negatedRisk.test(text)) {
    return false;
  }
  return /(明确)?(允许|批准|同意|确认|可以|请|直接|必须|这次|现在).{0,40}(云端|线上|生产环境|远端|热修复|hotfix|兜底|临时兜底|fallback|fall\s*back|写死|硬编码|hardcode|hard-coded|hard coded)|(云端|线上|生产环境|远端|热修复|hotfix|兜底|临时兜底|fallback|fall\s*back|写死|硬编码|hardcode|hard-coded|hard coded).{0,40}(允许|批准|同意|确认|可以|直接|必须|这次|现在)/i.test(text);
}

function detectHighRiskAutonomyMutation(root, payload, intent, risk) {
  if (!isMutationPayload(payload, risk)) {
    return null;
  }
  const command = commandText(payload);
  const text = [
    toolName(payload),
    command,
    payloadText(payload),
  ].filter(Boolean).join('\n');
  const touched = extractTouchedFiles(root, payload);
  const runtimeTarget = touched.length === 0 || touched.some((file) => isRuntimeAutonomyRiskFile(file));
  const cloudMutation = /(?:\b(?:ssh|scp|rsync)\b[^\n]*(?:prod|production|线上|生产|云端|server|remote)|\b(?:kubectl|helm)\b[^\n]*(?:apply|patch|set|delete|rollout|scale|exec)[^\n]*(?:prod|production|线上|生产|云端|cluster)|\b(?:vercel|wrangler|fly|flyctl|railway|firebase)\b[^\n]*(?:deploy|up)[^\n]*(?:--prod|prod|production|线上|生产)|\bsupabase\s+db\s+push\b[^\n]*(?:--linked|--db-url|prod|production|线上|生产)|\bcurl\b[^\n]*(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b[^\n]*(?:prod|production|线上|生产|云端|api\.))/i.test(text);
  if (cloudMutation) {
    return {
      kind: 'cloud-hotfix',
      title: '云端/生产远端写入',
      details: preview(command || text, 260),
    };
  }
  if (!runtimeTarget) {
    return null;
  }
  // 只保留真实业务权益/计费类词汇；配置、服务端、客户端、缓存、feature 这类
  // 基础设施通用词在正常代码里大量出现，叠加“fallback/兜底”会造成海量误拦。
  const businessTerms = /(业务|权益|会员|额度|价格|计费|订阅|套餐|entitlement|membership|billing|quota|price|paywall|subscription|localstorage)/i;
  const fallbackTerms = /(兜底|fallback|fall\s*back|临时补|临时插入|补行|补进|本地补|客户端补|服务端补|缓存补|默认插入|补一条|补数据)/i;
  const hardcodeTerms = /(写死|硬编码|hardcode|hard-coded|hard coded)/i;
  const fixedBusinessValue = /(unlimited|premium|pro|vip|admin|owner|free|trial|quota|limit|count_limit|free_limit|权益|会员).{0,80}(?:=|:).{0,80}(?:unlimited|premium|pro|vip|admin|owner|free|true|false|999999|Infinity)/i;
  if ((businessTerms.test(text) && (fallbackTerms.test(text) || hardcodeTerms.test(text))) || fixedBusinessValue.test(text)) {
    return {
      kind: 'hardcoded-fallback',
      title: '业务兜底/写死逻辑',
      details: preview(touched.length > 0 ? `${touched.join(', ')}\n${command || text}` : command || text, 260),
    };
  }
  return null;
}

function formatHighRiskAutonomyBlock(detection) {
  return [
    `OpenPrd detected an autonomy risk: ${detection.title}.`,
    detection.details ? `Matched action: ${detection.details}` : null,
    'Agent 责任：优先改成配置、迁移、标准状态机、幂等脚本或可回滚发布路径并继续。OpenPrd 只提供风险提醒，不承担授权审批。',
    'OpenPrd 不阻断工具调用，也不要求用户确认或复述固定授权口令；是否需要确认由当前 Agent 依据宿主安全规则和真实上下文自行判断。',
  ].filter(Boolean).join('\n');
}

const LIGHTWEIGHT_UI_VISUAL_SIGNAL_PATTERN = /(按钮|文案|颜色|圆角|位置|间距|留白|边距|内边距|外边距|宽度|高度|卡片|字号|字体|行高|图标|标题|空格|标点|对齐|密度|阴影|边框|层级|组件|输入框|菜单|侧栏|表格|列表|头像|badge|label|copy|toast|placeholder|padding|margin|spacing|gap|太宽|太窄|太挤|拥挤|松散|留得多|留着有点多|没对齐|好看|美观|审美|气质|记忆点|高级|太丑|丑|视觉风格|上架图|截图优化)/i;

function hasLightweightUiVisualSignal(text = '') {
  return LIGHTWEIGHT_UI_VISUAL_SIGNAL_PATTERN.test(String(text || ''));
}

function isFrontendTaskIntent(intent = null) {
  const text = String(intent?.promptText || '').trim();
  if (!text || intent?.visualMockupRequest) {
    return false;
  }
  return /(界面|页面|前端|首页|落地页|原型|导览|展览|馆藏|网站|web\s*page|landing|dashboard|hero|layout|静态单页|静态页|样式|视觉|app\s*首页|官网)/i.test(text);
}

function promptHasExplicitVisualReference(intent = null) {
  const text = String(intent?.promptText || '');
  return /(参考图|效果图|设计稿|按这个做|照着这个做|复刻|跟这个|reference|mockup|figma)/i.test(text);
}

function shouldRequireFactsSheet(intent = null) {
  const text = String(intent?.promptText || '');
  return /(开放时间|营业时间|票价|价格|英镑|美元|会员|版本|发布|规格|排名|数据|hours?|price|ticket|version|release|spec)/i.test(text);
}

function shouldRequireImagePreflight(intent = null) {
  const text = String(intent?.promptText || '');
  return /(馆藏|展览|导览|展品|museum|gallery|travel|旅行|内容|专题|story|editorial|摄影|图片|photo|地图|route|路线规划)/i.test(text);
}

function shouldRequireAssetSpec(intent = null) {
  return isFrontendTaskIntent(intent);
}

function designActiveFilePath(root, filename) {
  return path.join(root, '.openprd', 'design', 'active', filename);
}

function designArtifactHasPlaceholder(root, filename) {
  const text = readTextSync(designActiveFilePath(root, filename), 12000);
  return !text || /待填写/.test(text);
}

function looksLikeFrontendImplementationFile(relativePath) {
  const file = String(relativePath || '');
  if (!file || file.startsWith('.openprd/')) {
    return false;
  }
  if (/^(miniprogram|wechat|weapp)\//i.test(file)) {
    return false;
  }
  if (/(^|\/)(index|home|landing)\.(html|jsx|tsx|vue|svelte|astro)$/i.test(file)) {
    return true;
  }
  if (/\.(html|css|scss|sass|less|jsx|tsx|vue|svelte|astro)$/i.test(file)) {
    return true;
  }
  if (!/\.(js|ts)$/i.test(file)) {
    return false;
  }
  return /(^|\/)(app|pages?|components?|ui|layouts?|views?|screens?|routes?|frontend|web)\//i.test(file);
}

function frontendImplementationTargets(root, payload) {
  return extractTouchedFiles(root, payload).filter((file) => looksLikeFrontendImplementationFile(file));
}

function frontendDesignPreflightIssues(root, intent, implementationFiles) {
  if (!isFrontendTaskIntent(intent) || implementationFiles.length === 0) {
    return [];
  }
  const issues = [];
  if (shouldRequireFactsSheet(intent) && designArtifactHasPlaceholder(root, 'facts-sheet.md')) {
    issues.push({
      file: 'facts-sheet.md',
      reason: '这次页面要写明确事实，先把已知事实和来源或用户给定值写进去。',
    });
  }
  if (shouldRequireAssetSpec(intent) && designArtifactHasPlaceholder(root, 'asset-spec.md')) {
    issues.push({
      file: 'asset-spec.md',
      reason: '进入实现前先冻结资产口径；没有官方资产也要写“缺失 / 暂无 / 不适用”，不要留模板占位。新功能出现新入口、按钮、tab、卡片或空态时，同步补“功能图标”行：先复用项目已有图标体系，缺失时按最佳实践路由（Phosphor / Lucide / Tabler / React Icons / LobeHub / Tech Icons / iconfont）选型并登记图标名、来源、用途，不等用户要求。',
    });
  }
  if (shouldRequireImagePreflight(intent) && designArtifactHasPlaceholder(root, 'image-preflight.md')) {
    issues.push({
      file: 'image-preflight.md',
      reason: '这是内容型页面，先判断真实图片是不是成立前提，以及缺失时怎么降级。',
    });
  }
  if (!promptHasExplicitVisualReference(intent) && designArtifactHasPlaceholder(root, 'direction-plan.md')) {
    issues.push({
      file: 'direction-plan.md',
      reason: '当前没有明确参考方向，先把 3 个异源方向写实，而不是直接落回同一种安全解。',
    });
  }
  if (!promptHasExplicitVisualReference(intent) && designArtifactHasPlaceholder(root, 'selected-direction.md')) {
    issues.push({
      file: 'selected-direction.md',
      reason: '进入实现前先锁定选中的 lens、theme、layout 和组件。',
    });
  }
  return issues;
}

function captureSourceFromCommand(command) {
  return readCliFlagValue(command, '--source');
}

function captureFieldFromCommand(command) {
  return readCliFlagValue(command, '--field');
}

function isNonSemanticCaptureCommand(command) {
  return /openprd\s+capture\b/i.test(command)
    && captureSourceFromCommand(command) === 'agent-normalized';
}

function isDerivedClarificationCaptureCommand(command) {
  if (!/openprd\s+capture\b/i.test(command)) {
    return false;
  }
  const source = captureSourceFromCommand(command);
  return source === 'agent-inferred' || source === 'project-derived';
}

function isMetaStatusCaptureCommand(command) {
  return /openprd\s+capture\b/i.test(command) && captureFieldFromCommand(command) === 'meta.status';
}

function gateHasClarificationConfirmation(gate) {
  return Boolean(gate?.clarificationConfirmedAt || gate?.status === 'clarification-confirmed');
}

function requirementWritePathExplicitlyAuthorized(gate) {
  return gateHasClarificationConfirmation(gate)
    || reviewPolicyAllowsSilentRecord(requirementApprovalPolicy(gate));
}

function isRequirementWritePathMutation(command) {
  return /openprd\s+(capture|classify|synthesize|diagram)\b/i.test(command);
}

function isAllowedDuringRequirementGate(root, payload, gate, sessionId = null) {
  const text = payloadText(payload);
  const command = commandText(payload);
  const alwaysAllowed = [
    /openprd\s+status\b/i,
    /openprd\s+next\b/i,
    /openprd\s+run\s+\.\s+--verify\b/i,
    /openprd\s+clarify\b/i,
    /openprd\s+interview\b/i,
    /openprd\s+standards\s+.*--verify/i,
    /openprd\s+quality\s+.*--verify/i,
    /openprd\s+doctor\b/i,
    /openprd\s+(capture|classify|synthesize|diagram|review|review-presentation|change|tasks|loop)\b/i,
  ];
  return alwaysAllowed.some((pattern) => pattern.test(text) || pattern.test(command));
}

function toolProbe(payload) {
  return `${toolName(payload)}\n${payloadText(payload)}\n${commandText(payload)}`.toLowerCase();
}

function looksLikeLocalEvidenceRead(payload) {
  const probe = toolProbe(payload);
  return /\b(rg|grep|cat|sed|head|tail|less|more|wc|ls|find|git show|read_file|open_file|view_file)\b/.test(probe)
    || /openprd\s+(status|next|doctor|run\s+\.\s+--verify)/.test(probe);
}

function applyResearchToolSignal(root, payload, sessionId = null) {
  const current = readNamedGate(root, 'research', sessionId);
  if (!current?.active) {
    return current;
  }
  const probe = toolProbe(payload);
  const externalEvidence = { ...(current.externalEvidence || {}) };
  if (looksLikeLocalEvidenceRead(payload)) {
    current.localEvidenceSeen = true;
  }
  if (/read[_-]?wiki[_-]?structure|readwikistructure/.test(probe)) {
    externalEvidence.readWikiStructure = true;
  }
  if (/ask[_-]?question|askquestion/.test(probe)) {
    externalEvidence.askQuestion = true;
  }
  if (/resolve[_-]?library[_-]?id|resolvelibraryid/.test(probe)) {
    externalEvidence.resolveLibraryId = true;
  }
  if (/query[_-]?docs|querydocs/.test(probe)) {
    externalEvidence.queryDocs = true;
  }
  const satisfied = current.kind === 'deepwiki'
    ? externalEvidence.readWikiStructure && externalEvidence.askQuestion
    : externalEvidence.resolveLibraryId && externalEvidence.queryDocs;
  if (satisfied) {
    return closeResearchGate(root, sessionId, {
      status: 'evidence-collected',
      externalEvidence,
      localEvidenceSeen: current.localEvidenceSeen,
      satisfiedAt: now(),
    });
  }
  return updateNamedGate(root, 'research', {
    externalEvidence,
    localEvidenceSeen: current.localEvidenceSeen,
  }, sessionId);
}

function looksLikeSkillContractMutation(root, payload) {
  const files = extractTouchedFiles(root, payload);
  if (files.some((file) => /(^|\/)(AGENTS\.md|SKILL\.md)$/i.test(file) || /(^|\/)skills\/.+/i.test(file))) {
    return true;
  }
  const probe = toolProbe(payload);
  return /AGENTS\.md|SKILL\.md|\/skills\//i.test(probe);
}

function isRawVaultReadAttempt(payload) {
  const probe = toolProbe(payload);
  const readLike = /\b(cat|sed|head|tail|less|more|rg|grep|read_file|open_file)\b/.test(probe);
  return readLike && /\bvault\b/.test(probe);
}

function applyWeappToolSignal(root, payload, sessionId = null) {
  const current = readNamedGate(root, 'weapp', sessionId);
  if (!current?.active) {
    return current;
  }
  const probe = toolProbe(payload);
  const validationSignals = { ...(current.validationSignals || {}) };
  if (/mp[_-]?ensureconnection|ensureconnection/.test(probe)) {
    validationSignals.ensureConnection = true;
  }
  if (/mp[_-]|weapp|miniprogram|page_|element_|mp_screenshot|network\b|evaluate\b/.test(probe)) {
    validationSignals.runtimeAction = true;
  }
  const satisfied = validationSignals.ensureConnection && validationSignals.runtimeAction;
  if (satisfied) {
    return closeWeappGate(root, sessionId, {
      status: 'validated-through-weapp-runtime-evidence',
      validationSignals,
      validatedAt: now(),
    });
  }
  return updateNamedGate(root, 'weapp', { validationSignals }, sessionId);
}

function isHighRiskBrowserAction(payload) {
  const probe = toolProbe(payload);
  const browserTool = /(computer|browser|chrome|playwright)/.test(probe);
  const dangerousAction = /(submit|send|delete|remove|logout|sign out|switch account|pay|purchase|close tab|close window|关闭标签页|关闭窗口|退出登录|切换账号|支付|删除|发送|提交)/.test(probe);
  return browserTool && dangerousAction;
}

function researchGateMessage(gate) {
  if (!gate?.active) {
    return null;
  }
  if (gate.kind === 'deepwiki') {
    return [
      'OpenPrd 外部仓库证据注意项: active。',
      '当前请求涉及公开 GitHub 仓库的架构、模块、流程或对标判断；如果本地证据不足，可在不中断用户已要求工作的前提下补充 DeepWiki 证据。',
      '最小动作: `read_wiki_structure` 一次，再用 `ask_question` 聚焦 1-2 个关键问题；证据够用后立即停止扩展。',
      gate.externalEvidence?.readWikiStructure ? '已记录: read_wiki_structure。' : '缺少: read_wiki_structure。',
      gate.externalEvidence?.askQuestion ? '已记录: ask_question。' : '缺少: ask_question。',
    ].join('\n');
  }
  return [
    'OpenPrd 外部技术证据注意项: active。',
    '当前请求涉及项目外技术事实、第三方库、框架、API、SDK、MCP 或 CLI 用法；先利用已有本地证据，不足时在后台补充 Context7 证据，不延迟用户已明确要求的实现。',
    '最小动作: `resolve_library_id` 一次，再 `query_docs` 1-2 次；若覆盖不足，明确缺口后再补官方文档或源码。',
    gate.externalEvidence?.resolveLibraryId ? '已记录: resolve_library_id。' : '缺少: resolve_library_id。',
    gate.externalEvidence?.queryDocs ? '已记录: query_docs。' : '缺少: query_docs。',
  ].join('\n');
}

function skillVisualizationGateMessage(gate) {
  if (!gate?.active) {
    return null;
  }
  return [
    'OpenPrd skill/AGENTS 可视化注意项: active。',
    '当前请求涉及 skill、SKILL.md、AGENTS.md 或相关 workflow 规则变更。读取现状并用彩色 Mermaid 说明新增、修改、保持不变和删除/高风险项。',
    'Mermaid 应包含 `unchanged`、`added`、`changed`、`removed` 四种 classDef；这是沟通材料，不是授权门禁，用户已提出修改时可继续执行。',
  ].join('\n');
}

function credentialMessage(intent) {
  if (!intent?.secretsRequest) {
    return null;
  }
  return [
    'OpenPrd 敏感信息规则:',
    '如果任务需要 API key、token、账号信息、第三方服务凭证或个人信息，先使用 `secrets-vault` skill 获取已有凭证，不要立即向用户索要。',
    '不要直接读取原始 vault 文件，也不要在日志、代码或回复里暴露完整密钥。',
  ].join('\n');
}

function weappGateMessage(gate) {
  if (!gate?.active) {
    return null;
  }
  return [
    'OpenPrd 微信小程序验证门禁: active。',
    '只有当用户明确要求小程序实测、复现、截图、抓日志/网络、从 0 到 1 走流程，或当前改动高风险到必须依赖运行态证据时，才升级到本地小程序运行态验证。',
    '一旦进入小程序运行态验证，默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动、重开或重新打开时，才从头启动。',
    '优先使用当前环境已配置的小程序本地验证能力；如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具本身当成任务失败。',
    '未拿到本地运行态证据前，不要宣称“小程序已验证”。',
  ].join('\n');
}

function browserSafetyMessage(intent) {
  if (!intent?.browserSafetyRequest) {
    return null;
  }
  return [
    'OpenPrd 浏览器安全提醒:',
    '用户明确要求 Computer Use 时，优先使用 Computer Use，并尽量在 Codex-owned browser window 中操作。',
    '执行点击、输入、提交、关闭、切换账号、退出登录、支付等高风险动作前，先确认窗口归属，检查当前窗口标题、目标页面和可见内容仍属于本任务。',
  ].join('\n');
}

function productCopyMessage(intent) {
  if (!intent?.productCopyRequest) {
    return null;
  }
  return [
    'OpenPrd 产品内文案提醒:',
    '先检查项目是否已有 i18n、locales、translations、Localizable 或其他语言资源；若已有，多语言要同步维护。',
    '产品界面上用户能看到的文案必须站在当前用户视角写：说明用户现在能做什么、会发生什么、为什么值得点、下一步怎么走。',
    '除非这是面向开发者或专业技术人员的技术型产品，否则默认用普通人能看懂的语言写结果、状态、限制和行动，不要把 API、SDK、模型、数据库、缓存、错误码或其他实现细节直接暴露给用户。',
    '快速正反例：不要写“适合想保留全部工具入口的用户”，改成“首页会显示所有工具入口，你可以直接选择需要的功能”；不要写“API 请求失败，错误码 500”，改成“暂时保存失败，请稍后再试”。技术型产品可以保留必要术语，但仍要写清用户动作、影响和修复路径。',
  ].join('\n');
}

function runOpenPrd(args, cwd) {
  const configuredCommand = String(process.env.OPENPRD_CLI || 'openprd').trim() || 'openprd';
  const jsEntry = /\.(?:c|m)?js$/i.test(configuredCommand);
  let command = configuredCommand;
  let commandArgs = args;
  if (jsEntry) {
    const candidates = [];
    const addCollapsedPackageCandidate = (candidatePath) => {
      if (!candidatePath) {
        return;
      }
      const normalized = path.resolve(candidatePath);
      const binDir = path.dirname(normalized);
      const packageDir = path.dirname(binDir);
      const packageName = path.basename(packageDir);
      if (path.basename(binDir) === 'bin' && packageName === 'openprd') {
        candidates.push(path.join(path.dirname(packageDir), 'bin', 'openprd.js'));
      }
    };
    if (path.isAbsolute(configuredCommand)) {
      candidates.push(configuredCommand);
      addCollapsedPackageCandidate(configuredCommand);
    } else {
      candidates.push(path.resolve(cwd, configuredCommand));
      candidates.push(path.resolve(configuredCommand));
      addCollapsedPackageCandidate(path.resolve(cwd, configuredCommand));
      addCollapsedPackageCandidate(path.resolve(configuredCommand));
    }
    candidates.push(path.join(cwd, 'bin', 'openprd.js'));
    const resolvedEntry = candidates.find((candidate) => candidate && fs.existsSync(candidate));
    command = process.execPath;
    commandArgs = [resolvedEntry || configuredCommand, ...args];
  }
  const result = spawnSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function parseJsonOutput(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function compactSingleLine(text, limit = 240) {
  const singleLine = String(text || '').replace(/\s+/g, ' ').trim();
  if (!singleLine) {
    return '';
  }
  if (singleLine.length <= limit) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, limit - 1))}…`;
}

function devCheckWrapUpMessage(root, turnState) {
  const files = Array.isArray(turnState?.touchedFiles)
    ? [...new Set(turnState.touchedFiles)].filter(Boolean)
    : [];
  if (files.length === 0) {
    return null;
  }
  const result = runOpenPrd(['dev-check', '.', ...files, '--json'], root);
  if (!result.ok && !result.stdout) {
    return [
      'OpenPrd 收工回顾：本轮有 touched code files，但 dev-check 未能完成。',
      '最终回复里请说明无法生成大文件审查表，并列出失败原因。',
      result.stderr ? `错误: ${result.stderr}` : null,
    ].filter(Boolean).join('\n');
  }
  const parsed = parseJsonOutput(result.stdout);
  if (!parsed?.wrapUp?.recommended || !parsed.wrapUp.markdownTable) {
    return null;
  }
  return [
    'OpenPrd task-scoped dev-check 建议：本轮改动对象存在结构维护注意项。',
    '这份结果是建议，不是收尾门禁。只有拆分与当前目标同范围、不会扩大风险时才可顺手处理；否则保留建议，并把工作区规模债归入 workspaceAttention。不要强迫当前任务重构，也不要要求用户回复开关确认。',
    parsed.wrapUp.reason ? `建议原因：${parsed.wrapUp.reason}` : null,
    parsed.wrapUp.switchHint ? `模式说明：${parsed.wrapUp.switchHint}` : null,
    parsed.wrapUp.markdownBlock ?? parsed.wrapUp.markdownTable,
    parsed.visualEvidence?.required
      ? `视觉证据提醒：${parsed.visualEvidence.reason} 建议命令：${(parsed.visualEvidence.suggestedCommands ?? []).join('；')}。${parsed.visualEvidence.chatEmbedHint ?? ''}`
      : null,
  ].filter(Boolean).join('\n');
}

function devCheckTaskScopedAdvisory() {
  return '代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 openprd dev-check . <file...>。它只提供 task-scoped advisory：只有拆分与当前目标同范围且不会扩大风险时才可顺手处理；否则保留建议，并把工作区规模债归入 workspaceAttention。不要强迫当前任务重构，也不要要求用户回复开关确认。';
}

function shouldRunDoctorForHighRisk(payload) {
  const text = commandText(payload) || payloadText(payload);
  return /(git\s+(commit|push)\b|npm\s+publish|pnpm\s+publish|yarn\s+npm\s+publish|gh\s+release|openprd\s+(freeze|handoff|setup|update|fleet|doctor)\b|openprd\s+change\s+.*--(apply|archive)\b|release|publish)/i.test(text);
}

function summarizeRunVerifyCheck(parsed, fallbackText = '') {
  if (!parsed) {
    return fallbackText || 'run verify result unavailable';
  }
  const readiness = parsed.readiness ?? {};
  const failedTaskChecks = Array.isArray(parsed.checks)
    ? parsed.checks.filter((check) => check.scope !== 'workspace' && !check.ok).map((check) => check.name)
    : [];
  const workspaceWarnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  if (readiness.taskReady === false) {
    return `run-verify: taskReady=no${failedTaskChecks.length ? ` (${failedTaskChecks.join(', ')})` : ''}`;
  }
  if (readiness.workspaceReady === false) {
    const workspaceDetail = parsed.workspaceAttention?.summary ?? workspaceWarnings[0] ?? null;
    return `run-verify: taskReady=yes, workspaceReady=no${workspaceDetail ? ` (${workspaceDetail})` : ''}`;
  }
  return 'run-verify: taskReady=yes, workspaceReady=yes';
}

function summarizeDoctorCheck(parsed, fallbackText = '') {
  if (!parsed?.agentIntegration && !parsed?.standards && !parsed?.validation) {
    const compact = compactSingleLine(fallbackText);
    return compact || 'doctor result unavailable';
  }
  const parts = [];
  if (parsed.agentIntegration) {
    parts.push(`agentIntegration=${parsed.agentIntegration.ok ? 'ok' : 'failed'}`);
  }
  if (parsed.standards) {
    parts.push(`standards=${parsed.standards.ok ? 'ok' : 'failed'}`);
  }
  if (parsed.validation) {
    parts.push(`validation=${parsed.validation.valid ? 'ok' : 'failed'}`);
  }
  return `doctor: ${parts.join(', ')}`;
}

function buildGateFailureEnvelope(result) {
  const runCheck = result.checks.find((check) => check.name === 'run-verify') ?? null;
  const doctorCheck = result.checks.find((check) => check.name === 'doctor' && check.ok === false && check.agentIntegrationOk === false) ?? null;
  const changeCheck = result.checks.find((check) => check.name === 'change-validate' && check.ok === false) ?? null;
  if (doctorCheck) {
    return {
      kind: 'integration-drift',
      details: [doctorCheck.summary, ...(doctorCheck.details ?? [])].filter(Boolean),
      repair: 'Suggested follow-up: use openprd doctor . to inspect drift, then repair it with openprd update . or the targeted command in the background.',
    };
  }
  if (runCheck?.taskReady === false || changeCheck) {
    return {
      kind: 'task-failure',
      details: [
        runCheck?.summary,
        ...(runCheck?.errors ?? []),
        ...(changeCheck?.details ?? []),
      ].filter(Boolean),
      repair: 'Suggested follow-up: fix the task-scoped failure and rerun the relevant verification command; report the current evidence status accurately.',
    };
  }
  if (runCheck?.workspaceReady === false) {
    return {
      kind: 'workspace-debt',
      details: [
        runCheck.summary,
        runCheck.workspaceAttention?.detail ?? null,
        ...(runCheck.warnings ?? []),
      ].filter(Boolean),
      repair: 'Suggested follow-up: resolve the workspace-level debt from openprd run . --verify or openprd quality . --verify in the background.',
    };
  }
  return {
    kind: 'task-failure',
    details: result.checks.filter((check) => !check.ok).flatMap((check) => [check.summary, ...(check.details ?? [])]).filter(Boolean),
    repair: 'Suggested follow-up: rerun the relevant verification command and fix the failing check without presenting evidence debt as an authorization gate.',
  };
}

function formatHighRiskGateAttention(result) {
  const envelope = result.envelope ?? buildGateFailureEnvelope(result);
  const headline = envelope.kind === 'workspace-debt'
    ? 'OpenPrd readiness attention: the current task may be done while the workspace still has evidence debt.'
    : envelope.kind === 'integration-drift'
      ? 'OpenPrd readiness attention: the integration health check found drift.'
      : 'OpenPrd readiness attention: the current task still has incomplete verification evidence.';
  return [
    headline,
    result.summary,
    ...envelope.details,
    envelope.repair,
  ].filter(Boolean).join('\n');
}

function classifyToolFailure(text) {
  const normalized = String(text || '').toLowerCase();
  if (/doctor|hook|hook-profile|hooks\.json|config\.toml|command-catalog|openprd-router|skill|integration|drift/.test(normalized)) {
    return 'integration-drift';
  }
  if (/production-ready|needs-attention|smoke evidence|feature coverage|workspace ready|workspace debt|quality/.test(normalized)) {
    return 'workspace-debt';
  }
  return 'task-failure';
}

function toolFailureMessage(kind) {
  if (kind === 'integration-drift') {
    return 'A tool command failed in a way that looks like integration drift. Use openprd doctor . to inspect it, then repair confirmed drift with openprd update . or the targeted fix while keeping the user-requested work moving where safe.';
  }
  if (kind === 'workspace-debt') {
    return 'A tool command reported workspace-level readiness debt. Record it as workspaceAttention, continue safe task-scoped work, and use openprd run . --verify or openprd quality . --verify before making an overall readiness claim.';
  }
  return 'A tool command failed against the current task. Use openprd next . and the relevant verification command to identify the smallest task-scoped repair path.';
}

function recordRunHook(cwd, baseEvent, outcome) {
  const args = [
    'run',
    '.',
    '--record-hook',
    '--event',
    baseEvent.eventName,
    '--risk',
    baseEvent.risk.level,
    '--outcome',
    outcome,
  ];
  if (baseEvent.preview) {
    args.push('--preview', baseEvent.preview.slice(0, 300));
  }
  runOpenPrd(args, cwd);
}

function requirementGateMessage(intent, gate) {
  const requirementAttentionActive = isRequirementAttentionActive(gate);
  if (!intent?.requiresIntake && !requirementAttentionActive) {
    return null;
  }
  if (intent?.visualMockupRequest) {
    return [
      'OpenPrd requirement intake is background attention and never restricts implementation writes.',
      'The user is asking for an image asset such as a cover image, poster, illustration, icon, sticker, visual mockup, or effect image, not code implementation.',
      'For logo, icon, avatar, badge, and similar development assets, default to a standalone asset: full-frame single subject with no extra UI frame, card shell, device mockup, or presentation container unless the user explicitly asked for one.',
      'For an avatar or standalone UI bitmap, inspect the original asset and consuming component/CSS first, then lock rendering-mode in the current task-scoped asset-spec. Use transparent-cutout only when the UI needs alpha: generate standalone #00ff00 candidates, remove the chroma key, keep transparent corners, and verify safe cropping. Use opaque-full-bleed-tile when the background must fill the tile: prompt for full-bleed edge-to-edge coverage with NO rounded rectangle, NO white outer margin, and NO transparent corners; verify all four corners are opaque. Never mix the two validations. UI container radius, border, and shadow do not belong in source pixels unless original-asset evidence proves they are baked in. A screenshot alone cannot decide this contract.',
      'Do not create temporary HTML/SVG/CSS files for this image unless the user explicitly requested that format.',
      'Image tool routing: on a Codex surface use native `imagegen` (Image 2); on a Cursor surface use the built-in `GenerateImage` tool; both are free inside the conversation tool. If neither surface applies, read the confirmed preference in `.openprd/harness/image-generation-preference.json`; when no preference exists, ask the user which image-generation path to use and persist the answer to that file as the future default. NEVER silently call the user\'s own paid image API. The image tool is the tool path, not an aesthetic exemption, so first state the purpose, audience, intended tone, constraints, and memory point, then put them into the image prompt.',
      'Before generation, do a quick anti-slop check: without brand or reference support, avoid default purple/blue-purple gradients, generic font taste, white card piles, and context-free decoration.',
    ].join('\n');
  }
  return [
    'OpenPrd requirement intake runs in background and does not create a user approval stop.',
    'This prompt looks like a likely 新功能/新流程方案 (L2). Use $openprd-requirement-intake to classify it by impact, unknowns, decision cost, and validation cost while continuing the work the user requested.',
    'Keep this mapping visible for internal review: 直接处理=L0, 现有功能优化=L1, 新功能/新流程方案=L2.',
    'L0 and L1 stay on lightweight paths and should not be forced through formal PRD/review/change/tasks unless the scope expands.',
    'For L2, maintain PRD/review/change/tasks and the appropriate scene lens in the background. Do not block implementation files, do not ask the user to approve OpenPrd artifacts, and do not expose internal enum values unless necessary.',
    'Write back the best-supported facts with explicit source labels, synthesize the PRD, record the stable review artifact, generate the change, and prepare tasks as Agent-owned maintenance. If information is uncertain, choose a reversible default and state the assumption instead of turning OpenPrd into a confirmation gate.',
  ].join('\n');
}

function lightweightRequirementMessage(intent) {
  if (intent?.requirementTier === 'l0') {
    return [
      'OpenPrd 轻量需求路径: 当前更接近直接处理 (L0)。',
      '先在 chat 用短格式写出“需求类型 / 理由 / 推荐下一步”，并默认写成“需求类型：直接处理（L0）”；只有内部排障确实需要时，才额外单列“内部路由码”。',
      '对用户先用一句轻量主句说清这次是什么和为什么先这样处理；边界和技术细项放到后一句，不要揉成一大段解释。',
      '直接处理并事后说明即可，不打开正式 PRD/review/change/tasks。',
      '优先做最小足够验证，并用 1-2 句说明本轮特别需要强化的测试点；默认不要求正式测试报告。',
      '如果过程中暴露出跨系统依赖、支付/账号/权限/回调等高风险因素，再升级到 L2 重流程。',
    ].join('\n');
  }
  if (intent?.requirementTier === 'l1') {
    return [
      'OpenPrd 轻量需求路径: 当前更接近现有功能优化 (L1)。',
      '先在 chat 用短格式写出“需求类型 / 理由 / 推荐下一步”，并默认写成“需求类型：现有功能优化（L1）”，再给 3-5 行 mini-plan；只有内部排障确实需要时，才额外单列“内部路由码”。',
      '主句先轻一点：先说这次调整是什么、要解决什么，再把范围边界和技术细项留给 mini-plan，不要一上来写成长段。',
      '先在对话里给 3-5 行 mini-plan，至少写清目标、范围内、范围外和验证方式。',
      '默认不要打开正式 PRD/review/change/tasks；只有在 mini-plan 暴露新决策缺口、跨系统风险或范围升级时，才提升到 L2 重流程。',
      '验证采用最小足够组合即可，重点说明需要强化测试的地方；默认不要求正式测试报告。',
    ].filter(Boolean).join('\n');
  }
  return null;
}

function imageGenerationPreferencePath(root) {
  return path.join(harnessDir(root), 'image-generation-preference.json');
}

function imageGenerationRoutingLines(root) {
  const preference = readJsonSync(imageGenerationPreferencePath(root), null);
  const lines = [
    '生图路由: 第一层先判断当前对话工具面——Codex 环境用原生 `imagegen`（Image 2），Cursor 环境用内置 `GenerateImage` 工具；两者都是对话工具内免费能力，优先默认使用。',
    '如果当前既不是 Codex 也不是 Cursor，或内置生图工具面证据不存在，先读 `.openprd/harness/image-generation-preference.json` 里用户已确认的生图偏好；没有已确认偏好时必须先询问用户要用哪种生图方式，并把用户答复以 `{"provider","source":"user-confirmed","updatedAt"}` 写回该文件，下次直接作为默认。',
    '成本护栏: 绝对不要在用户未明确指定的情况下擅自调用用户本地或自有付费生图 API（如用户自己的 OpenAI / Stability key），避免产生额外成本；只有偏好文件或当前消息明确授权时才可以使用。',
  ];
  if (preference?.provider) {
    lines.push(`当前已保存的用户生图偏好: ${preference.provider}（来源: ${preference.source || 'user-confirmed'}）。内置免费生图工具不可用时优先使用它，不要再重复询问。`);
  }
  return lines;
}

function visualMockupMessage(intent, root = null) {
  if (!intent?.visualMockupRequest) {
    return null;
  }
  return [
    '当前用户要的是图片内容生成，例如图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿或 mockup。',
    ...(root ? imageGenerationRoutingLines(root) : []),
    '按生图路由选定的内置生图工具生成图片（Codex=`imagegen`/Image 2，Cursor=`GenerateImage`）；生图工具是工具路径，不是审美豁免；生图前先写清用途、受众、气质、约束和记忆点，并把这些写进 prompt。',
    '生图前用 `.openprd/design/anti-slop.md` 做快速自检：没有品牌或参考图依据时，不要默认紫白/蓝紫渐变、通用字体、白底卡片堆叠或无语境装饰。',
    '除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。',
    '对 avatar、logo、icon、badge 等独立素材，先检查原始素材与消费组件/CSS，在当前 task-scope 的 asset-spec 锁定 rendering-mode。transparent-cutout 才生成纯 `#00ff00` 绿幕候选、抠透明、保留透明四角并做安全裁切；opaque-full-bleed-tile 的提示词必须写 full-bleed edge-to-edge、NO rounded rectangle、NO white outer margin、NO transparent corners，并验证四角不透明。UI 容器圆角、边框、阴影默认不画进源位图；截图不能单独判断像素合同，两种模式验证不可混用。',
    '只有当用户明确要求 mockup、场景化效果图、容器化呈现，或参考图本身就包含这些承载结构时，才生成对应的容器或场景。',
    '只有在实际发生生图工具调用后，才能汇报生图结果、失败或限流；未调用前，不要声称“生图限流”或“生图失败”。',
    '把生图结果先当成候选效果图，不要默认登记到 `.openprd/harness/visual-reviews/`，也不要自动当成后续验收参考；看图时不仅判断是否生成成功，还要判断气质、层级、字体/色彩/表面角色和记忆点是否成立。',
    '如果用户看完图后还要继续做实现，说明 Agent 采用的可逆默认方向及理由，并按已授权范围继续；用户明确指定方向时再覆盖默认值并更新后续 reference-set。候选图仍要和已经明确接受的验收参考分开记录，不把 Agent 默认方向伪装成 user-confirmed。',
    '如果一张图里有多个子图、网格、多对象或多个方向，不要把整板直接当成单一参考图；先运行 `openprd visual-prepare . --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>` 生成 reference-set、contact sheet 和 compare-plan，确认 contact sheet 后再逐项对比或统一验收。',
    'OpenPrd review.html 只用于需求评审，visual-compare 只用于实现阶段视觉证据：已有参考图时做效果图/实现截图对比；没有参考图时先判断新建界面还是修改既有界面，新建界面回到实现前 3 方向方案评审，修改既有界面做修改前/修改后自检；局部细节优先补局部焦点证据板，并行优化方向优先补并行实验证据板；同构列表、卡片、网格或表格需要补对齐辅助线证据板，并同时检查容器轨道和内部内容槽位轨道；单个 logo、icon、avatar、badge、按钮图形或图片内部需要居中判定、视觉重心评估或偏心排查时，需要补内部居中证据板，并同时检查画布中心、主体外接框中心和视觉重心偏移。',
  ].join('\n');
}

function canvasCollaborationMessage(intent) {
  if (!intent?.canvasCollaborationRequest) {
    return null;
  }
  return [
    '当前请求涉及 OpenPrd 画布协同（生图上画布、人在画布上标注、标注结果回到对话继续改）。',
    '打开或复用画布：运行 `openprd canvas .`；无法自动识别当前对话时用 `--thread <id> --thread-title <name>` 或 `--session <id> --session-title <name>` 显式绑定，画布必须绑定当前对话。',
    '结构化读画布：需要知道用户正在圈哪些元素时，优先 `GET /api/selection` 读取选中元素的 ID、类型、坐标、尺寸和文本，不要只靠截图猜；需要全量场景再读 `GET /api/scene`。',
    '结构化写画布：把生成的新图放上画布时，优先 `POST /api/insert-image`，用 `anchorElementId` + `placement`（right/left/below/above）把新图放到指定元素旁边，不要覆盖原图；回填 AI 生图占位卡时继续用 `POST /api/images` 带 `placeholderId`。',
    '标注改图闭环：如果交接记录（handoff）的 `selection` 是 `annotation-edit`，或带有 `sourceImageElementIds` / `annotationElementIds`，说明用户在原图上画了标注要求改图。把截图里的标注当修改指令，生成修改后的新图，再用 `POST /api/insert-image` 以原图为 anchor 放到旁边，方便用户对比原图和新版。',
    '生图尺寸契约：handoff 或占位卡带 `sizeContract`（width/height/aspectRatio）时，生成图片必须按这个宽高比出图，避免回填时变形拉伸。',
    '每轮改图后主动确认：新图是否符合标注意图、是否继续下一轮标注迭代；用户可以继续在新图上标注，形成多轮改图闭环。',
  ].join('\n');
}

function learningGenreFlag(intent = null) {
  return intent?.learningGenre ? ` --genre ${intent.learningGenre}` : '';
}

function learningReviewCommand(intent = null) {
  return `openprd learn . --topic "<学习主题>"${learningGenreFlag(intent)} --open`;
}

function learningReviewMessage(intent = null) {
  const command = learningReviewCommand(intent);
  const lines = [
    '如果当前交付目标是把一次工作转成可学习、可复用、可回看、可教学或可沉淀的材料，不要先按关键词判断，也不要只停留在普通说明文档。',
    '先判断期望产物形态：是否需要章节结构、证据锚点、图文讲解、检索练习、工作示例或阅读体验。需要这些形态时，优先使用 `openprd learn .` 生成学习包骨架、阅读器和证据清单，再补充正文内容；普通 Markdown 只能作为辅助讲义。',
  ];
  if (intent?.learningMaterialRequest) {
    lines.unshift('当前输入已被识别为学习型交付物请求：这是按产物形态和长期阅读/教学目的判断，不是固定关键词表。');
    lines.push(`建议先运行 \`${command}\`。如果用户指定了仙侠、科幻、童话等风格，把它当作学习包题材/文体参数，而不是绕过阅读器流程的理由。`);
    lines.push('生成骨架后，读取 `.openprd/learning/archive/<packageId>/agent-prompt.md`，由 Agent 基于证据写入 `learning-content.json`，再运行 `openprd learn . --content-json <file> --open` 渲染最终 reader；不要把聊天里的普通 Markdown 成稿当完成。');
  }
  return lines.join('\n');
}

function largeUiVisualDirectionMessage(intent = null) {
  if (!intent?.largeUiVisualDirectionRequest) {
    return null;
  }
  return [
    'OpenPrd 大界面改动视觉方案评审:',
    '位置: 需求分流之后、PRD 定稿或实现开工之前；它不同于 review.html，也不同于实现后的 visual-compare。',
    '判断: 先从用户目标、信息架构变化、视觉决策成本和验收风险判断是否需要方向评审，不用关键词触发。会决定首屏、核心布局、主视觉、关键路径、组件层级/密度，或用户需要先选设计方向时触发。',
    '自动性: 用户不需要额外提出“请生图”。只要语义判断命中大界面改动或视觉决策成本高，就主动完成 3 方向生成；卡片宽度、间距、对齐、颜色、圆角、字号等轻量微调不触发。',
    '步骤: 已有界面时，Codex 原生 App 用 Computer Use，Codex 网页环境用 Chrome 插件的任务专用窗口，Cursor 用当前可用的浏览器或项目预览能力，进入对应功能并截当前真实界面。三个方向必须把同一张截图作为 image-to-image 参考；除非用户明确要求换风格，否则锁定现有字体角色、色彩系统、明暗模式、表面语言、圆角/边框/阴影、图标语言、平台框架和信息密度，只探索布局、信息层级、导航、关键路径和空间构图。冷启动没有现有界面时，基于已确认 PRD、用户画像、第一版切片和视觉目标写 design brief，不伪造修改前截图。brief 必须写清用途、受众、气质端点、约束和记忆点，3 个方向要分别说明审美主张和主动避开的模板味。然后按生图路由调用内置生图工具（Codex=`imagegen`/Image 2，Cursor=`GenerateImage`；都不可用时按 `.openprd/harness/image-generation-preference.json` 的用户已确认偏好，没有偏好先问用户）生成至少 3 个不同设计思想方向；把效果图横向拼成一张带 1/2/3 序号的大图，先作为候选效果图给用户评审，不要默认写入 `.openprd/harness/visual-reviews/` 当验收参考。',
    '质量: 每个方向都要从用途、用户、业务约束、核心动作和唯一记忆点出发，同时检查字体角色、色彩、空间构图、信息层级、表面/图标语言和动效含义；拒绝无依据蓝紫渐变、默认字体、等权白卡堆叠、过量大圆角、无语境装饰和只换颜色的伪方向。',
    '交互: 把三个方向直接给用户看，并说明 Agent 采用的可逆默认方向及原因；OpenPrd 不强制等待确认，也不阻断大 UI 实现。用户明确选择时再覆盖默认方向并更新 reference-set。',
    '多对象参考处理: 如果候选效果图是一张图里包含多个子图、网格、多对象或多方向，不要拿整板直接硬比；先运行 `openprd visual-prepare . --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，检查 contact sheet，确认 reference-set 后再逐项进入实现和验收。',
  ].join('\n');
}

function visualLocalAdjustmentMessage() {
  return [
    '如果这轮验收重点在局部变化，不要只改代码后凭主观判断收尾。',
    '修改前先用一句话锁定本次审美意图和记忆点；收口的 visual-compare/focus-board 不只看位置，也要看气质、层级、色彩、字号、间距和表面角色是否被保住。',
    '先判断这是新建界面还是修改既有界面：新建界面由 Agent 在后台完成 3 方向方案评审并采用可逆默认方向；修改既有界面先保留修改前截图。完成后从同一入口、视口、账号和数据状态截修改后截图，再运行 `openprd visual-compare . --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`。',
    '如果局部细节需要放到同一张证据板里审阅，再补一份 `openprd visual-compare . --board <focus-board.json> --locale <zh-CN|en>` 的局部焦点证据板，把局部变化组合到同一张证据板里统一验收；如果只是普通截图、Computer/Browser/Playwright 实测截图，也要用 `openprd visual-compare . --board <verification-board.json> --locale <zh-CN|en>` 拼成截图实测证据板；如果界面存在同构列表、卡片、网格或表格，或用户反馈元素没有对齐，要用 `openprd visual-compare . --board <alignment-board.json> --locale <zh-CN|en>` 拼成对齐辅助线证据板，且同一张板里同时覆盖容器轨道和标题/副标题/描述/标签/状态/价格/按钮/图标等内部内容槽位；如果单个素材/图标/头像/徽标/按钮图形/图片内部需要居中或视觉重心判定，要用 `openprd visual-compare . --board <centering-board.json> --locale <zh-CN|en>` 拼成内部居中证据板，且同一张板里同时覆盖红色画布中心、绿色主体外接框和黄色视觉重心点，不能把单张截图当最终视觉证据。',
    '如果参考图是一张整板、网格图或多对象组合图，先运行 `openprd visual-prepare . --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，确认 contact sheet 后，再决定是逐项 `--reference/--actual` 还是统一做 `focus-board` / `parallel-board`。',
    '当用户后续说“跟效果图”“不一致”“好丑”“复刻”“没对齐”“偏心”“不居中”这类反馈时，不能只口头说已经对比过了；至少先产出一份 `openprd visual-compare`、`focus-board`、`parallel-board`、`verification-board`、`alignment-board` 或 `centering-board` 证据图再下结论。'
  ].join('\n');
}

function codexConfirmationReplyRule() {
  return 'Codex 回复规则: OpenPrd 不创建用户确认停顿，不要求用户批准需求摘要、评审稿、change、tasks、设计合同、测试证据或风险分类，也不要求粘贴 digest、work unit、版本号或命令。Agent 在后台维护这些材料并继续用户要求的工作；是否因真实上下文需要向用户提问，只由当前 Agent 依据宿主安全规则和任务信息自行判断，不由 OpenPrd 强制。';
}

function confirmationGateMessage(gate) {
  if (!gate || gate.active) {
    return null;
  }
  return [
    'OpenPrd requirement materials are Agent-maintained background records and do not create a user approval stop.',
    'Continue the user-requested work while keeping docs, review records, tasks, and verification evidence accurate.',
    'For UI or visual work, keep an explicit source label for the reference: user-provided/user-selected references may be acceptance anchors, while an Agent-selected candidate stays an agent-default until the user explicitly overrides it. This record is background evidence, not a confirmation stop. If one image contains multiple sub-images, grid cells, or objects, run openprd visual-prepare . --reference <effect-image> --grid <columns>x<rows> or --boxes <plan.json>, inspect the contact sheet, and use the generated reference-set / compare-plan before comparing. Then capture the implemented UI and run openprd visual-compare . --reference <effect-image> --actual <implementation-screenshot>; if local detail matters more than the whole screen, add openprd visual-compare . --board <focus-board.json> --locale <zh-CN|en>. When there is no reference image, capture before/after screenshots from the same entry, viewport, account, and data state. Use verification, alignment, or centering boards when those evidence shapes apply before claiming visual completion.',
    'If the user later says the implementation does not match the effect image, looks wrong, or asks for replication, do not rely on subjective narration alone; produce at least one visual evidence artifact before claiming completion.',
  ].join('\n');
}

function currentRequirementStatusLine(gate, progress) {
  const rawNext = progress?.nextStep || gate?.status || 'continue';
  return `后台维护状态: ${rawNext}。这是 Agent 的记录任务，不是用户卡点；继续用户要求的工作并自行补齐。`;
}

function currentRequirementMessage(intent, gate, progress) {
  const prompt = stripMarkdown(gate?.promptPreview || '');
  const approvalPolicy = requirementApprovalPolicy(gate);
  const gateStatus = 'OpenPrd requirement intake runs in background while the user-requested implementation continues.';
  const lines = [
    'OpenPrd 当前需求入口',
    gateStatus,
    '对外表达要求: 面向用户不要直接复述 PRD、review artifact、change、tasks、lane、approval policy、work unit、digest、worker shard、write-scope、worktree、内部版本号、命令或文件路径；改说“需求确认稿”“本次调整”“后续任务”“继续落地”“完成后检查”。',
    '当前输入已被判定为可能的新功能/新流程方案（L2），因此进入重流程需求入口。不要按固定关键词判断；先用 $openprd-requirement-intake 按影响面、未知数、决策成本和验证成本判断用户可见需求类型。',
    '内部审查保留固定对照：直接处理=L0，现有功能优化=L1，新功能/新流程方案=L2。',
    '如果用户刚刚已经确认了现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，下一句要明确写成“已确认，我按这个继续/收口/落地”；不要只写一个“确认”，更不要写成“确认，我们就按这个……”这种容易让用户误以为还要再表态的句子。',
    '如果需求类型是新功能/新流程方案（L2），本轮只围绕这个新需求推进 PRD/review/change/tasks，并选择通用场景 / 面向个人消费者场景 / 面向企业服务场景 / 以 Agent 为主要使用场景的 PRD 视角，不自动继续历史 active change。对用户复述时不要直接把 consumer / b2b / agent 当展示词；这些枚举值只用于内部记录和命令。',
    prompt ? '本轮需求: ' + prompt : '',
    gate?.intakeMode === 'deep-reflection'
      ? '需求入口: 先运行需求自省，再输出对话内澄清摘要或简短清单。'
      : '需求入口: 先做轻量项目映射，再确认影响点和验收方式。',
    '当前 approval policy: agent-maintained。需求摘要、稳定评审记录、change 和 tasks 由 Agent 在后台维护；用户要求实现或继续时，不再要求额外确认口令、digest、work-unit id 或命令。',
    intent?.reviewContinuationRequested
      ? '这条消息表达了继续当前 OpenPrd 下一步的意图：在后台记录精确 review artifact 并继续当前 lane，不追加执行确认清单或固定口令。'
      : '',
    currentRequirementStatusLine(gate, progress),
    'Decision-point order: Agent 先吸收用户原始意图并继续当前安全范围内的工作，同时在后台补写需求事实、PRD、评审记录、change 和 tasks；材料不完整时记录缺口，不中断用户任务。',
    'Recommended next action: 用户要求实现、继续、修复、部署或发布时直接推进；需要的需求类型判断和结构化摘要由 Agent 自行整理，只有真实产品方向存在多个会明显改变结果的选择时才向用户提一个必要问题。',
  ];
  if (isImplementationAdvanceIntent(intent)) {
    lines.splice(2, 1, gate?.active
      ? '用户表达了继续实现的意图；直接进入安全范围内的实现，review、change 和任务拆解由 Agent 在后台补齐。'
      : '用户表达了明确实现意图；直接进入当前安全范围，并让实现范围与本轮需求入口保持一致。');
  }
  lines.push(codexConfirmationReplyRule());
  return lines.filter(Boolean).join('\n');
}

function requirementRoutingSummary() {
  return '需求类型由 $openprd-requirement-intake 按影响面、未知数、决策成本和验证成本判断：直接处理(L0)直接完成；现有功能优化(L1)用轻量 mini-plan；新功能/新流程方案(L2)由 Agent 在后台维护 requirement、PRD、review、change 和 tasks。用户说“实现、继续、修复、部署、发布”就是当前目标范围内的有效执行意图，不再要求补确认口令或流程材料。';
}

function classifyRisk(payload) {
  const text = payloadText(payload);
  const normalized = text.toLowerCase();
  const highPatterns = [
    /git\s+push/,
    /git\s+commit/,
    /npm\s+publish/,
    /pnpm\s+publish/,
    /yarn\s+npm\s+publish/,
    /gh\s+release/,
    /rm\s+-rf/,
    /\b(?:ssh|scp|rsync)\b[^\n]*(?:prod|production|线上|生产|云端|server|remote)/,
    /\b(?:kubectl|helm)\b[^\n]*(?:apply|patch|set|delete|rollout|scale|exec)[^\n]*(?:prod|production|线上|生产|云端|cluster)/,
    /\b(?:vercel|wrangler|fly|flyctl|railway|firebase)\b[^\n]*(?:deploy|up)[^\n]*(?:--prod|prod|production|线上|生产)/,
    /\bsupabase\s+db\s+push\b[^\n]*(?:--linked|--db-url|prod|production|线上|生产)/,
    /\bcurl\b[^\n]*(?:-x|--request)\s*(?:post|put|patch|delete)\b[^\n]*(?:prod|production|线上|生产|云端|api\.)/,
    /openprd\s+freeze\b/,
    /openprd\s+handoff\b/,
    /openprd\s+change\s+.*--apply/,
    /openprd\s+change\s+.*--archive/,
  ];
  const mediumPatterns = [
    /apply_patch/,
    /npm\s+install/,
    /npm\s+i\s/,
    /pnpm\s+add/,
    /yarn\s+add/,
    /bun\s+add/,
    /openprd\s+setup\b/,
    /openprd\s+update\b/,
    /openprd\s+standards\s+.*--init/,
    /openprd\s+change\s+.*--generate/,
    /openprd\s+review\s+.*--mark\s+(pending-confirmation|confirmed|needs-revision)/,
    /openprd\s+tasks\s+.*--advance/,
    /openprd\s+discovery\s+.*--advance/,
    /openprd\s+(capture|classify|synthesize|diagram)\b/,
  ];
  if (highPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'high', reason: 'release, history, freeze, handoff, destructive, or accepted-change action' };
  }
  if (mediumPatterns.some((pattern) => pattern.test(normalized))) {
    return { level: 'medium', reason: 'workspace mutation or dependency/configuration change' };
  }
  return { level: 'low', reason: 'read-only or local exploratory action' };
}

function extractChangeId(text) {
  const match = String(text || '').match(/--change\s+([a-zA-Z0-9._-]+)/);
  return match ? match[1] : null;
}

function runGateChecks(cwd, payload, risk) {
  const checks = [];
  const run = runOpenPrd(['run', '.', '--verify', '--json'], cwd);
  const runParsed = parseJsonOutput(run.stdout);
  const runTaskReady = runParsed?.readiness?.taskReady ?? run.ok;
  const runWorkspaceReady = runParsed?.readiness?.workspaceReady ?? run.ok;
  checks.push({
    name: 'run-verify',
    ok: runWorkspaceReady,
    taskReady: runTaskReady,
    workspaceReady: runWorkspaceReady,
    summary: summarizeRunVerifyCheck(runParsed, run.stdout || run.stderr),
    workspaceAttention: runParsed?.workspaceAttention ?? null,
    warnings: Array.isArray(runParsed?.warnings) ? runParsed.warnings : [],
    errors: Array.isArray(runParsed?.errors) ? runParsed.errors : [],
    details: [
      ...(Array.isArray(runParsed?.errors) ? runParsed.errors : []),
      ...(Array.isArray(runParsed?.warnings) ? runParsed.warnings : []),
    ],
    output: run.stdout || run.stderr,
  });
  const text = payloadText(payload);
  const changeId = extractChangeId(text);
  if (changeId && /openprd\s+change\s+.*--(apply|archive|validate)/i.test(text)) {
    const change = runOpenPrd(['change', '.', '--validate', '--change', changeId], cwd);
    checks.push({
      name: 'change-validate',
      ok: change.ok,
      summary: `change-validate: ${change.ok ? 'ok' : 'failed'}`,
      details: [change.stdout || change.stderr].filter(Boolean),
      output: change.stdout || change.stderr,
    });
  }
  if (risk.level === 'high' && shouldRunDoctorForHighRisk(payload) && runWorkspaceReady) {
    const doctor = runOpenPrd(['doctor', '.', '--tools', 'codex', '--json'], cwd);
    const doctorParsed = parseJsonOutput(doctor.stdout);
    checks.push({
      name: 'doctor',
      ok: doctor.ok,
      agentIntegrationOk: doctorParsed?.agentIntegration?.ok ?? null,
      standardsOk: doctorParsed?.standards?.ok ?? null,
      validationOk: doctorParsed?.validation?.valid ?? null,
      summary: summarizeDoctorCheck(doctorParsed, doctor.stdout || doctor.stderr),
      details: [doctor.stderr || doctor.stdout].filter(Boolean),
      output: doctor.stdout || doctor.stderr,
    });
  }
  const envelope = buildGateFailureEnvelope({ checks });
  return {
    ok: checks.every((check) => check.ok),
    checks,
    envelope,
    summary: checks.map((check) => check.summary || `${check.name}: ${check.ok ? 'ok' : 'failed'}`).join(', '),
  };
}

function hasTurnReviewSignal(turnState, kind) {
  return Array.isArray(turnState?.reviewSignals)
    && turnState.reviewSignals.some((signal) => signal?.kind === kind);
}

function parseShanghaiTimestamp(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}+08:00`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectRecentArtifactPaths(dir, startedAtMs, matcher, output = []) {
  if (!fs.existsSync(dir)) {
    return output;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRecentArtifactPaths(absolutePath, startedAtMs, matcher, output);
      continue;
    }
    if (typeof matcher === 'function' && !matcher(absolutePath)) {
      continue;
    }
    const stat = fs.statSync(absolutePath);
    if (startedAtMs && Number.isFinite(startedAtMs) && stat.mtimeMs < startedAtMs) {
      continue;
    }
    output.push(absolutePath);
  }
  return output;
}

function hasRecentArtifacts(root, relativeDir, turnState, matcher) {
  const dir = path.join(root, relativeDir);
  const startedAtMs = parseShanghaiTimestamp(turnState?.startedAt);
  return collectRecentArtifactPaths(dir, startedAtMs, matcher, []).length > 0;
}

function hasRecentVisualReviewArtifact(root, turnState) {
  return hasRecentArtifacts(root, '.openprd/harness/visual-reviews', turnState, (artifactPath) => {
    const normalized = artifactPath.split(path.sep).join('/');
    return /\.(?:jpe?g|png|webp|json)$/i.test(normalized)
      && /visual-(?:compare|before-after|focus-board|parallel-board|verification-board|alignment-board|centering-board)|reference-actual|before-after|focus-board|parallel-board|verification-board|alignment-board|centering-board|center-board/i.test(normalized);
  });
}

function isVisualEvidenceIntent(intent = null) {
  const text = String(intent?.promptText || '');
  return isFrontendTaskIntent(intent)
    || hasLightweightUiVisualSignal(text)
    || /(界面|页面|前端|视觉|样式|布局|信息架构|效果图|设计稿|参考图|实现截图|视觉对比|视觉评审|截图|实测|Computer\s*Use|Browser|Playwright|复刻|不一致|好丑|没对齐|没有对齐|不对齐|对不齐|对不上|不像|对齐有问题|对齐问题|排版漂移|布局漂移|左右偏差|上下偏差|横向偏差|竖向偏差|同构|重复单元|列表卡片|卡片列表|卡片网格|网格卡片|网格列表|列表网格|对齐辅助线|内容槽位|内部槽位|内部居中|视觉重心|主体外接框|画布中心|偏心|不居中|没居中|图标内部|图片内部|素材内部)/i.test(text);
}

function visualEvidenceStopReminder(root, turnState, stopIntent) {
  if (stopIntent?.visualMockupRequest) {
    return null;
  }
  const touchedFiles = Array.isArray(turnState?.touchedFiles) ? turnState.touchedFiles : [];
  const frontendTouched = touchedFiles.some((file) => looksLikeFrontendImplementationFile(file));
  const rawScreenshotObserved = hasTurnReviewSignal(turnState, 'visual-raw-screenshot');
  const visualArtifactObserved = hasTurnReviewSignal(turnState, 'visual-review-artifact')
    || hasTurnReviewSignal(turnState, 'visual-verification-board')
    || hasTurnReviewSignal(turnState, 'visual-alignment-board')
    || hasTurnReviewSignal(turnState, 'visual-centering-board')
    || hasRecentVisualReviewArtifact(root, turnState);
  const needsVisualEvidence = isVisualEvidenceIntent(stopIntent)
    && (rawScreenshotObserved || frontendTouched || /截图|实测|Computer\s*Use|Browser|Playwright/i.test(String(stopIntent?.promptText || '')));
  if (!needsVisualEvidence || visualArtifactObserved) {
    return null;
  }
  const preferred = rawScreenshotObserved
    ? '`openprd visual-compare . --board <verification-board.json> --locale <zh-CN|en>`，把普通截图、Computer/Browser/Playwright 实测路径和检查点拼成截图实测证据板'
    : '有参考图时用 `--reference/--actual`，无参考且改既有界面用 `--before/--after`，普通截图实测用 `--board <verification-board.json>`，同构列表/卡片/网格/表格用 `--board <alignment-board.json>`，单元素内部居中/视觉重心用 `--board <centering-board.json>`';
  return [
    'OpenPrd 在本轮收工回顾里发现 UI/视觉任务已有截图、实测或前端改动，但还没有本轮拼图证据。',
    '即便只是卡片宽度、间距、留白、对齐、颜色、圆角、字号这类轻量可视优化，也需要留下视觉证据；build、package 和 dev-check 不能替代视觉收口。',
    '如果这轮新开发或修改了同构列表、卡片、网格、表格，或用户反馈元素没对齐，要截真实页面、叠辅助线，同时量容器轨道和标题/副标题/描述/标签/状态/价格/按钮/图标等内部内容槽位的 spread，并生成 alignment-board；只量外框、列宽或行顶不算完整对齐验收。',
    '如果这轮判断的是单个素材、图标、头像、徽标、按钮图形或图片内部是否居中，要截取或裁出目标元素，用 centering-board 量画布中心、主体外接框中心和视觉重心偏移；单张截图或主观“看起来居中”不算完整居中验收。',
    '视觉证据还要检查本轮审美意图是否成立：气质、层级、颜色、字号、间距、表面角色和记忆点不能只靠口头描述。',
    `普通截图和 Computer 实测截图只能作为原始素材，不能单独替代视觉收口。请先运行 ${preferred}。`,
    '补齐前不要宣称界面视觉已经完成；可以如实说功能或代码已改，但视觉拼图证据还没补齐。',
  ].join('\n');
}

function recentLearningArtifactPaths(root, turnState, matcher) {
  const dir = path.join(root, '.openprd/learning/archive');
  const startedAtMs = parseShanghaiTimestamp(turnState?.startedAt);
  return collectRecentArtifactPaths(dir, startedAtMs, matcher, []);
}

function hasRecentLearningSkeletonArtifact(root, turnState) {
  return recentLearningArtifactPaths(root, turnState, (artifactPath) => {
    const normalized = artifactPath.split(path.sep).join('/');
    return /\/(?:agent-prompt\.md|reader\.html|learning-package\.json|learning-content\.json)$/i.test(normalized);
  }).length > 0;
}

function hasRecentAuthoredLearningReaderArtifact(root, turnState) {
  const contentPaths = recentLearningArtifactPaths(root, turnState, (artifactPath) => artifactPath.endsWith('learning-content.json'));
  return contentPaths.some((contentPath) => {
    const content = readJsonSync(contentPath, null);
    if (!content || content.authoringStatus !== 'agent-authored') {
      return false;
    }
    if (!Array.isArray(content.chapters) || content.chapters.length === 0) {
      return false;
    }
    const readerPath = path.join(path.dirname(contentPath), 'reader.html');
    return fs.existsSync(readerPath);
  });
}

function learningMaterialStopReminder(root, turnState, stopIntent) {
  if (!stopIntent?.learningMaterialRequest) {
    return null;
  }
  if (hasRecentAuthoredLearningReaderArtifact(root, turnState)) {
    return null;
  }
  const command = learningReviewCommand(stopIntent);
  if (!hasRecentLearningSkeletonArtifact(root, turnState)) {
    return [
      'OpenPrd 在本轮收工回顾里识别到用户要的是学习型交付物，但还没有看到本轮新生成的学习包阅读器。',
      '请先运行 `' + command + '`，生成 `.openprd/learning/archive/<packageId>/` 下的证据清单、Agent 写作提示、learning-content.json 骨架和 reader.html。',
      '这类请求按产物形态和长期阅读/教学目的判断，不是固定关键词表；普通 Markdown 只能作为辅助讲义，不能替代 OpenPrd reader。',
    ].join('\n');
  }
  return [
    'OpenPrd 在本轮收工回顾里发现学习包骨架已经出现，但还没有本轮 Agent-authored 的最终 reader 内容。',
    '请读取 `.openprd/learning/archive/<packageId>/agent-prompt.md`，基于证据写入 `learning-content.json`，再运行 `openprd learn . --content-json <file> --open` 重新渲染。',
    '完成前不要把聊天里的普通 Markdown 成稿当作学习材料交付完成。',
  ].join('\n');
}

function closeoutVerificationReminder(root, turnState, stopIntent) {
  const touchedFiles = Array.isArray(turnState?.touchedFiles) ? turnState.touchedFiles : [];
  if (touchedFiles.length === 0) {
    return null;
  }
  if (stopIntent?.requirementTier !== 'l2' && !hasTurnReviewSignal(turnState, 'loop-finish')) {
    return null;
  }
  const codeTouched = touchedFiles.some((file) => /^(app|src|lib|components|pages|server|backend|frontend|scripts|openprd\/src)\//.test(String(file))
    || /\.(js|jsx|ts|tsx|mjs|cjs|py|rb|go|java|kt|swift|css|scss|less|vue|svelte|html)$/i.test(String(file)));
  if (!codeTouched) {
    return null;
  }
  const missing = [];
  if (!hasTurnReviewSignal(turnState, 'quality-verify')) {
    missing.push('最终 `openprd quality . --verify` 与 HTML 质量报告');
  }
  if (!hasTurnReviewSignal(turnState, 'run-verify')) {
    missing.push('最终 `openprd run . --verify`');
  }
  const hasMarkdownReport = hasRecentArtifacts(root, '.openprd/harness/test-reports', turnState, (artifactPath) => artifactPath.endsWith('.md'));
  const hasHtmlReport = hasRecentArtifacts(root, '.openprd/harness/test-reports', turnState, (artifactPath) => artifactPath.endsWith('.html'));
  if (!hasMarkdownReport || !hasHtmlReport) {
    missing.push('本轮 task-scoped Markdown / HTML 测试报告');
  }
  if (missing.length === 0) {
    return null;
  }
  return [
    'OpenPrd 在本轮收工回顾里发现项目级收口证据还没补齐。',
    `如果你准备宣称“本次调整已经整体完成”或“项目级完成”，请先补齐：${missing.join('；')}。`,
    '未补齐前，只能如实说“代码或局部实现已完成，但项目级收口还没做完”，不要把缺少最终验证的状态表述成已完全闭环。',
  ].join('\n');
}

function hookSuppressed(root) {
  const state = readJsonSync(path.join(harnessDir(root), 'hook-state.json'), {});
  const lockPath = path.join(harnessDir(root), 'input-lock.json');
  const lock = readJsonSync(lockPath, null);
  return Boolean(state?.suppressions?.inputLock || (lock && lock.active));
}

function allowHook(additionalContext = null, outputEventName = eventName) {
  const result = { continue: true };
  if (additionalContext) {
    result.hookSpecificOutput = {
      hookEventName: outputEventName,
      additionalContext,
    };
  }
  return result;
}

function blockHook(reason) {
  return {
    decision: 'block',
    reason,
    systemMessage: reason,
  };
}

function handle(eventName, cwd, payload) {
  const root = findProjectRoot(cwd);
  const sessionId = sessionIdFor(payload);
  const automationDecision = automationBypassDecision(root, eventName, payload, sessionId);
  if (automationDecision.optIn) {
    rememberAutomationMode(root, sessionId, payload, automationDecision.signals, 'openprd-maintenance');
  } else if (automationDecision.bypass) {
    rememberAutomationMode(root, sessionId, payload, automationDecision.signals, 'automation');
    return allowHook();
  }
  ensureHarness(root);
  const risk = classifyRisk(payload);
  const fingerprint = fingerprintFor(eventName, payload, risk);
  const duplicate = isDuplicate(root, fingerprint);
  const runtimeEnvironment = recordRuntimeEnvironment(root, eventName, payload, sessionId);
  const baseEvent = {
    eventName,
    risk,
    fingerprint,
    duplicate,
    sessionId,
    runtimeEnvironment: runtimeEnvironment.active,
    preview: preview(payloadText(payload)),
  };

  if (eventName === 'SessionStart') {
    appendEvent(root, { ...baseEvent, outcome: 'session-start' });
    updateHookState(root, baseEvent);
    return allowHook();
  }

  if (eventName === 'UserPromptSubmit') {
    if (duplicate) return allowHook();
    const prompt = promptText(payload);
    beginTurnReview(root, baseEvent, prompt);
    const intent = analyzePromptIntent(prompt);
    const gate = readRequirementGate(root, sessionId);
    const skillGate = readNamedGate(root, 'skill-visualization', sessionId);
    const researchGate = readNamedGate(root, 'research', sessionId);
    const weappGate = readNamedGate(root, 'weapp', sessionId);

    if (skillGate?.active && (isShortAffirmativeConfirmation(prompt) || intent.confirmation)) {
      confirmSkillVisualizationGate(root, prompt, sessionId);
    } else if (intent.skillWorkflowEditRequest) {
      openSkillVisualizationGate(root, prompt, sessionId);
    } else if (skillGate?.active) {
      closeSkillVisualizationGate(root, sessionId, { status: 'superseded-by-new-prompt' });
    }
    if (intent.publicRepoResearchRequest || intent.externalTechResearchRequest) {
      openResearchGate(root, prompt, intent, sessionId);
    } else if (researchGate?.active) {
      closeResearchGate(root, sessionId, { status: 'superseded-by-new-prompt' });
    }
    if (intent.weappValidationRequest) {
      openWeappGate(root, prompt, sessionId);
    } else if (weappGate?.active) {
      closeWeappGate(root, sessionId, { status: 'superseded-by-new-prompt' });
    }
    if (intent.requiresIntake && !isRequirementAttentionActive(gate)) {
      openRequirementGate(root, prompt, intent, sessionId);
    }
    const outcome = 'prompt-observed';
    appendEvent(root, { ...baseEvent, outcome });
    recordRunHook(root, baseEvent, outcome);
    updateHookState(root, baseEvent);
    return allowHook();
  }

  if (eventName === 'PreToolUse') {
    const turnIntent = analyzePromptIntent(readTurnState(root).prompt || '');
    let gate = readRequirementGate(root, sessionId);
    const skillGate = readNamedGate(root, 'skill-visualization', sessionId);
    const researchGate = applyResearchToolSignal(root, payload, sessionId);
    const weappGate = applyWeappToolSignal(root, payload, sessionId);
    const progress = isRequirementAttentionActive(gate) ? evaluateRequirementGateProgress(root, sessionId) : null;
    if (sessionId && isAllowedDuringRequirementGate(root, payload, gate, sessionId)) {
      mirrorRequirementGate(root, sessionId);
    }
    const backgroundReviewMutation = /openprd\s+review\b/i.test(commandText(payload))
      && /--mark\b/i.test(commandText(payload));
    if (skillGate?.active && looksLikeSkillContractMutation(root, payload)) {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-with-skill-visualization-attention' });
      recordRunHook(root, baseEvent, 'allowed-with-skill-visualization-attention');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook('OpenPrd skill visualization attention: keep the color-coded Mermaid explanation with the change record. The requested edit remains authorized and can continue without another OpenPrd-specific confirmation.');
    }
    if (researchGate?.active && isMutationPayload(payload, risk) && !backgroundReviewMutation) {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-with-research-attention' });
      recordRunHook(root, baseEvent, 'allowed-with-research-attention');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook([
        'OpenPrd research attention: external evidence is still incomplete, but the requested in-scope mutation remains allowed.',
        researchGateMessage(researchGate),
      ].filter(Boolean).join('\n'));
    }
    if (turnIntent.secretsRequest && isRawVaultReadAttempt(payload)) {
      appendEvent(root, { ...baseEvent, outcome: 'blocked-raw-vault-read' });
      recordRunHook(root, baseEvent, 'blocked-raw-vault-read');
      updateHookState(root, baseEvent);
      return blockHook([
        'OpenPrd blocked a raw vault read attempt.',
        'Use the `secrets-vault` skill first and only read the minimum required fields; do not read the original vault file directly.',
      ].join('\n'));
    }
    const autonomyRisk = detectHighRiskAutonomyMutation(root, payload, turnIntent, risk);
    if (autonomyRisk && !hasExplicitAutonomyRiskApproval(turnIntent)) {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-with-autonomy-attention', autonomyRisk });
      recordRunHook(root, baseEvent, 'allowed-with-autonomy-attention');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook(formatHighRiskAutonomyBlock(autonomyRisk));
    }
    if (isRequirementAttentionActive(gate) && isMutationPayload(payload, risk) && !isAllowedDuringRequirementGate(root, payload, gate, sessionId)) {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-with-requirement-attention' });
      recordRunHook(root, baseEvent, 'allowed-with-requirement-attention');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook([
        'OpenPrd requirement attention: the current requirement/PRD/review/change/tasks records may need background maintenance.',
        'Continue the authorized in-scope work now. Do not request an OpenPrd confirmation stop; record current-scope artifacts in the background and report any remaining evidence debt accurately.',
      ].join('\n'));
    }
    let patchModeGate = syncPatchModeGate(root, payload, sessionId, turnIntent);
    if (patchModeGate?.active) {
      if (isPatchModeWriteAttempt(root, payload, patchModeGate)) {
        patchModeGate = updateNamedGate(root, 'patch-mode', {
          status: 'write-attempted',
          lastWriteAttemptAt: now(),
          lastWriteAttemptAtMs: Date.now(),
          lastWriteAttemptTool: toolName(payload) || null,
          lastWriteAttemptFiles: extractTouchedFiles(root, payload),
        }, sessionId) || patchModeGate;
      } else if (patchModeGate.phase === 'handoff' && isPatchModeFocusAttempt(root, payload, patchModeGate)) {
        const nextRemaining = Math.max(0, Number(patchModeGate.focusAllowanceRemaining ?? PATCH_MODE_HANDOFF_FOCUS_ALLOWANCE) - 1);
        patchModeGate = updateNamedGate(root, 'patch-mode', {
          status: nextRemaining > 0 ? 'handoff-focus-read' : 'handoff-awaiting-entry-write',
          focusAllowanceRemaining: nextRemaining,
          lastFocusAt: now(),
          lastFocusAtMs: Date.now(),
          lastFocusTool: toolName(payload) || null,
          lastFocusFiles: extractTouchedFiles(root, payload),
        }, sessionId) || patchModeGate;
      } else {
        appendEvent(root, {
          ...baseEvent,
          outcome: 'allowed-with-patch-mode-attention',
          targetFile: patchModeGate.targetFile,
        });
        recordRunHook(root, baseEvent, 'allowed-with-patch-mode-attention');
        updateHookState(root, baseEvent);
        recordTouchedFiles(root, payload);
        if (patchModeGate.phase === 'handoff') {
          return allowHook([
            'OpenPrd Patch Mode attention: design-starter has landed, while the generated page entry has not yet received the planned implementation write.',
            `Keep ${patchModeGate.targetFile} or one of its sibling drafts (${patchModeTargetFiles(patchModeGate).join(', ')}) as the primary implementation target when practical.`,
            'This is sequencing guidance only; the current authorized tool call can continue.',
          ].join('\n'));
        }
        return allowHook([
          'OpenPrd Patch Mode attention: an entry rewrite was announced, but the corresponding page write has not yet been observed.',
          `Prefer applying the next useful implementation change to ${patchModeGate.targetFile} or one of its sibling drafts (${patchModeTargetFiles(patchModeGate).join(', ')}).`,
          'This attention does not restrict the current authorized tool call.',
        ].join('\n'));
      }
    }
    const frontendTargets = frontendImplementationTargets(root, payload);
    const designIssues = frontendDesignPreflightIssues(root, turnIntent, frontendTargets);
    if (designIssues.length > 0) {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-with-design-attention' });
      recordRunHook(root, baseEvent, 'allowed-with-design-attention');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook([
        'OpenPrd design attention: one or more `.openprd/design/active/` records need background maintenance.',
        'Continue the authorized in-scope frontend work and let the Agent maintain these records without asking the user to fill templates or approve OpenPrd artifacts.',
      ].join('\n'));
    }
    if (turnIntent.browserSafetyRequest && isHighRiskBrowserAction(payload)) {
      appendEvent(root, { ...baseEvent, outcome: 'browser-safety-reminder' });
      recordRunHook(root, baseEvent, 'browser-safety-reminder');
      updateHookState(root, baseEvent);
      return allowHook(browserSafetyMessage(turnIntent));
    }
    if (risk.level === 'high') {
      const gates = runGateChecks(root, payload, risk);
      appendEvent(root, { ...baseEvent, gates, outcome: gates.ok ? 'allowed-high-risk' : 'allowed-with-readiness-attention' });
      recordRunHook(root, baseEvent, gates.ok ? 'allowed-high-risk' : 'allowed-with-readiness-attention');
      updateHookState(root, baseEvent);
      if (!gates.ok) {
        recordTouchedFiles(root, payload);
        return allowHook([
          'OpenPrd release/readiness attention: the checks found incomplete evidence, which is evidence debt rather than an OpenPrd authorization decision.',
          formatHighRiskGateAttention(gates),
          'Proceed within the user-authorized scope and report the incomplete checks accurately; do not ask the user to provide gate artifacts or fixed approval wording.',
        ].join('\n'));
      }
      recordTouchedFiles(root, payload);
      return allowHook(`OpenPrd high-risk gate passed: ${gates.summary}.`);
    }
    if (risk.level === 'medium') {
      appendEvent(root, { ...baseEvent, outcome: 'allowed-medium-risk' });
      recordRunHook(root, baseEvent, 'allowed-medium-risk');
      updateHookState(root, baseEvent);
      recordTouchedFiles(root, payload);
      return allowHook([
        'OpenPrd allowed this write action. Keep the implementation inside the user-authorized scope.',
        devCheckTaskScopedAdvisory(),
        'If the change is user-visible UI, capture proportionate visual evidence and inspect tone, hierarchy, color, type, spacing, surface role, and alignment. Candidate directions may use an Agent-chosen reversible default; OpenPrd does not require a user confirmation pause.',
        'Maintain docs/basic, code manuals, folder README files, and current change/task records in the background when the touched behavior makes them stale.',
      ].join('\n'));
    }
    return allowHook();
  }

  if (eventName === 'PostToolUse') {
    const text = payloadText(payload);
    const failed = /command not found|no such file|permission denied|failed|error|exception/i.test(text);
    if (!failed) {
      recordVisualEvidenceSignals(root, payload);
    }
    if (!failed) {
      return allowHook();
    }
    appendEvent(root, { ...baseEvent, outcome: failed ? 'tool-failure-detected' : 'tool-complete' });
    recordRunHook(root, baseEvent, failed ? 'tool-failure-detected' : 'tool-complete');
    updateHookState(root, baseEvent);
    if (failed && !duplicate) {
      return allowHook(toolFailureMessage(classifyToolFailure(text)));
    }
    return allowHook();
  }

  if (eventName === 'Stop') {
    appendEvent(root, { ...baseEvent, outcome: 'stop-check' });
    recordRunHook(root, baseEvent, 'stop-check');
    updateHookState(root, baseEvent);
    if (hookSuppressed(root)) {
      return allowHook();
    }
    const turnState = readTurnState(root);
    const stopIntent = analyzePromptIntent(turnState.prompt || '');
    const weappGate = readNamedGate(root, 'weapp', sessionId);
    if (weappGate?.active && stopIntent.weappValidationRequest) {
      return allowHook([
        'OpenPrd 在本轮收工回顾里发现小程序运行态验证仍未完成。',
        '如果这次任务是用户明确要求的小程序实测、复现、截图、抓日志/网络，或你已经承诺提供运行态证据，请补齐本地运行态验证；补齐时默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；否则不要把普通代码改动默认升级成小程序实测。',
        '如果当前环境没有可用的小程序本地验证工具，请明确说明未完成运行态验证，不要假定工具已安装。',
      ].join('\n'));
    }
    if (stopIntent.visualMockupRequest && (!Array.isArray(turnState.touchedFiles) || turnState.touchedFiles.length === 0)) {
      return allowHook([
        'OpenPrd 生图事实对齐提醒：如果这轮要汇报图片结果、失败或限流，请确保它来自一次实际的生图工具调用（Codex=`imagegen`，Cursor=`GenerateImage`，或用户已确认的偏好工具）。',
        '未实际调用生图工具前，不要声称“生图限流”“生图失败”或“已经生成图片结果”；若本轮还没调用，请如实说明仍未开始或尚未完成生图。',
        '如果这轮确实已经生图，不要默认把结果登记到 `.openprd/harness/visual-reviews/` 或直接当成验收参考；先把它当候选效果图。',
        '若用户还要继续做实现，说明 Agent 采用的可逆默认方向与是否纳入后续视觉对比；用户明确选择时再覆盖默认方向。没有明确选择时也不要把候选图表述成用户已确认参考图。',
      ].join('\n'));
    }
    const patchModeGate = readNamedGate(root, 'patch-mode', sessionId);
    if (patchModeGate?.active) {
      if (isPatchModeWriteObserved(root, patchModeGate)) {
        closePatchModeGate(root, sessionId, {
          status: 'write-observed',
          writeObservedAt: now(),
        });
      } else if (patchModeGate.phase === 'handoff') {
        return allowHook([
          'OpenPrd Patch Mode attention: design-starter 已经落地，但页面入口还没有观察到后续实现写入。',
          `如本轮目标包含页面实现，优先把下一次有用修改写到 ${patchModeGate.targetFile} 或它的 sibling draft（${(patchModeGate.draftFiles || []).join(', ')}）之一。`,
          '这是收工时的完成度提醒，不限制继续调用工具；最终回复按真实状态区分 starter、部分实现和完成实现。',
        ].join('\n'));
      } else {
        return allowHook([
          'OpenPrd Patch Mode attention: 已宣布入口覆盖，但还没有观察到对应页面写入。',
          `如本轮目标包含页面实现，优先把下一次有用修改写到 ${patchModeGate.targetFile} 或它的 sibling draft（${(patchModeGate.draftFiles || []).join(', ')}）之一。`,
          '如果当前仅完成说明、设计合同或素材准备，请在最终回复中如实标记为部分进展；这条注意项本身不限制继续调用工具。',
        ].join('\n'));
      }
    }
    const visualReminder = visualEvidenceStopReminder(root, turnState, stopIntent);
    if (visualReminder) {
      return allowHook(visualReminder);
    }
    const learningReminder = learningMaterialStopReminder(root, turnState, stopIntent);
    if (learningReminder) {
      return allowHook(learningReminder);
    }
    const devCheckMessage = devCheckWrapUpMessage(root, turnState);
    if (devCheckMessage) {
      return allowHook(devCheckMessage);
    }
    const closeoutReminder = closeoutVerificationReminder(root, turnState, stopIntent);
    if (closeoutReminder) {
      return allowHook(closeoutReminder);
    }
    if (Array.isArray(turnState.touchedFiles) && turnState.touchedFiles.length > 0) {
      const review = runOpenPrd(['quality', '.', '--learn', '--review', '--from', '.openprd/harness/turn-state.json', '--json'], root);
      if (review.ok) {
        try {
          const parsedReview = JSON.parse(review.stdout);
          if (
            parsedReview
            && !parsedReview.skipped
            && parsedReview.ok !== false
            && parsedReview.candidateId
            && parsedReview.status === 'pending-review'
            && parsedReview.candidateId !== turnState.lastKnowledgePromptCandidateId
          ) {
            writeTurnState(root, {
              ...turnState,
              lastKnowledgePromptCandidateId: parsedReview.candidateId,
              lastKnowledgePromptAt: now(),
            });
            const userFacingMessage = String(parsedReview.userFacingExperience?.message || '').trim();
            return allowHook([
              'OpenPrd 在本轮收工回顾里发现了一条适合沉淀为当前项目经验的内容。',
              '把它作为当前项目的后台候选经验记录，不要在最终回复中要求用户确认，也不要提 Draft Skill、candidate、promote、路径或命令：',
              userFacingMessage || [
                '这次我观察到一个以后可能重复出现的情况：',
                '这次任务里已经形成了一种以后可能重复出现的处理方式。',
                '',
                '我计划保留一条项目经验：',
                '以后再遇到类似任务时，我会优先复用这次已经验证过的处理顺序和注意事项。',
                '',
                '以后如果再遇到类似任务，我会优先按这套经验来处理，减少重复解释和重复判断。',
                '这条经验只会保留在当前项目里。',
                '已作为当前项目候选经验记录，不影响当前任务。',
              ].join('\n'),
              null,
              `如果用户明确表示暂不保留，执行：openprd knowledge reject --path . --id ${parsedReview.candidateId} --reason "<用户原话>"`,
              `如果用户表示先不处理、以后再说，执行：openprd knowledge archive --path . --id ${parsedReview.candidateId} --reason "<用户原话>"`,
            ].filter(Boolean).join('\n'));
          }
        } catch {}
      }
    }
  }

  appendEvent(root, { ...baseEvent, outcome: 'noop' });
  recordRunHook(root, baseEvent, 'noop');
  updateHookState(root, baseEvent);
return allowHook();
}
