#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const AUTH_FILES = ['auth.json', 'auth-caco.json', 'auth-relay.json'];
const MAX_AUTOMATIC_CONTINUATIONS = 1;
const PATCH_MODE_MONITOR_INTERVAL_MS = parsePositiveInt(process.env.OPEN_VIBECODING_PATCH_MODE_MONITOR_INTERVAL_MS, 500);
const PATCH_MODE_ENTRY_STALL_MS = parsePositiveInt(process.env.OPEN_VIBECODING_PATCH_MODE_ENTRY_STALL_MS, 30000);
const PATCH_MODE_WRITE_ATTEMPT_STALL_MS = parsePositiveInt(process.env.OPEN_VIBECODING_PATCH_MODE_WRITE_ATTEMPT_STALL_MS, 15000);
const DEBUG_PATCH_MODE_MONITOR = /^(1|true|yes)$/i.test(String(process.env.OPEN_VIBECODING_DEBUG_PATCH_MODE || ''));

function usage() {
  return [
    'Usage: node scripts/open-vibecoding-codex-isolated-worker.mjs [options]',
    '',
    'Options:',
    '  --cwd <dir>                   Working directory passed to `codex exec -C`.',
    '  --prompt <text>               Prompt text written to Codex stdin.',
    '  --prompt-file <file>          Read prompt text from a file.',
    '  --source-codex-home <dir>     Source Codex home used only to copy auth files.',
    '  --model <name>                Override the detected model name.',
    '  --output-jsonl <file>         Save raw `codex exec --json` output to a file.',
    '  --output-last-message <file>  Save the last Codex agent message to a file.',
    '  --skip-git-repo-check         Forward `--skip-git-repo-check` to Codex.',
    '  --full-auto                   Forward approval and hook-trust bypass flags to Codex.',
    '  --keep-codex-home             Keep the temporary isolated CODEX_HOME after exit.',
    '  --help                        Show this help message.',
    '',
    'Any arguments after `--` are forwarded to `codex exec` before the stdin prompt marker.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    cwd: process.cwd(),
    prompt: null,
    promptFile: null,
    sourceCodexHome: null,
    model: null,
    outputJsonl: null,
    outputLastMessage: null,
    skipGitRepoCheck: false,
    fullAuto: false,
    keepCodexHome: false,
    passthrough: [],
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.passthrough = argv.slice(index + 1);
      break;
    }
    if (arg === '--cwd' && argv[index + 1]) {
      options.cwd = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--prompt' && argv[index + 1]) {
      options.prompt = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--prompt-file' && argv[index + 1]) {
      options.promptFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--source-codex-home' && argv[index + 1]) {
      options.sourceCodexHome = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--model' && argv[index + 1]) {
      options.model = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--output-jsonl' && argv[index + 1]) {
      options.outputJsonl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--output-last-message' && argv[index + 1]) {
      options.outputLastMessage = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === '--skip-git-repo-check') {
      options.skipGitRepoCheck = true;
      continue;
    }
    if (arg === '--full-auto') {
      options.fullAuto = true;
      continue;
    }
    if (arg === '--keep-codex-home') {
      options.keepCodexHome = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function resolvePrompt(options) {
  if (options.prompt && options.promptFile) {
    throw new Error('Use either --prompt or --prompt-file, not both.');
  }
  if (options.prompt) {
    return options.prompt;
  }
  if (options.promptFile) {
    return fs.readFile(path.resolve(options.promptFile), 'utf8');
  }
  if (!process.stdin.isTTY) {
    return readStdin();
  }
  throw new Error('Provide --prompt, --prompt-file, or stdin input.');
}

function resolveSourceCodexHome(options) {
  return path.resolve(
    options.sourceCodexHome
      ?? process.env.OPEN_VIBECODING_CODEX_HOME
      ?? process.env.CODEX_HOME
      ?? path.join(os.homedir(), '.codex'),
  );
}

async function fileExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectModel(sourceCodexHome) {
  const configPath = path.join(sourceCodexHome, 'config.toml');
  if (!(await fileExists(configPath))) {
    return null;
  }
  const text = await fs.readFile(configPath, 'utf8');
  const match = text.match(/^\s*model\s*=\s*["']([^"'\n]+)["']\s*$/m);
  return match?.[1]?.trim() || null;
}

async function prepareOutputPath(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

async function prepareIsolatedCodexHome(sourceCodexHome) {
  const isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-codex-home-'));
  let copied = 0;
  for (const name of AUTH_FILES) {
    const sourcePath = path.join(sourceCodexHome, name);
    if (!(await fileExists(sourcePath))) {
      continue;
    }
    await fs.copyFile(sourcePath, path.join(isolatedHome, name));
    copied += 1;
  }
  if (copied === 0) {
    throw new Error(`No reusable Codex auth files found in ${sourceCodexHome}. Expected one of: ${AUTH_FILES.join(', ')}`);
  }
  return isolatedHome;
}

function buildCodexArgs(options) {
  const args = ['exec', '--json', '-C', path.resolve(options.cwd)];
  if (options.fullAuto) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
    if (options.supportsHookTrustBypass) {
      args.push('--dangerously-bypass-hook-trust');
    }
  }
  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.outputLastMessage) {
    args.push('-o', options.outputLastMessage);
  }
  if (options.passthrough.length > 0) {
    args.push(...options.passthrough);
  }
  args.push('-');
  return args;
}

function buildCodexResumeArgs(options, sessionId) {
  const args = ['exec', 'resume', sessionId, '--json'];
  if (options.fullAuto) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
    if (options.supportsHookTrustBypass) {
      args.push('--dangerously-bypass-hook-trust');
    }
  }
  if (options.skipGitRepoCheck) {
    args.push('--skip-git-repo-check');
  }
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.outputLastMessage) {
    args.push('-o', options.outputLastMessage);
  }
  if (options.passthrough.length > 0) {
    args.push(...options.passthrough);
  }
  args.push('-');
  return args;
}

function codexSupportsHookTrustBypass(commandPath, runtimeEnv) {
  const help = spawnSync(commandPath, ['exec', '--help'], {
    encoding: 'utf8',
    env: runtimeEnv,
  });
  const output = `${help.stdout || ''}\n${help.stderr || ''}`;
  if (output.includes('--dangerously-bypass-hook-trust')) {
    return true;
  }
  if (output.includes('Usage:')) {
    return false;
  }
  return true;
}

function resolveCodexCommand(runtimeEnv) {
  const candidates = [];
  const attempts = process.platform === 'win32'
    ? [['where', ['codex']]]
    : [['which', ['-a', 'codex']], ['which', ['codex']]];
  for (const [command, args] of attempts) {
    const resolved = spawnSync(command, args, {
      encoding: 'utf8',
      env: runtimeEnv,
    });
    const found = resolved.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const candidate of found) {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
    if (candidates.length > 0) {
      break;
    }
  }
  for (const candidate of candidates) {
    if (codexSupportsHookTrustBypass(candidate, runtimeEnv)) {
      return {
        commandPath: candidate,
        supportsHookTrustBypass: true,
      };
    }
  }
  const commandPath = candidates[0] || 'codex';
  return {
    commandPath,
    supportsHookTrustBypass: codexSupportsHookTrustBypass(commandPath, runtimeEnv),
  };
}

function extractSessionId(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.type === 'thread.started' && typeof parsed.thread_id === 'string' && parsed.thread_id.trim()) {
        return parsed.thread_id.trim();
      }
    } catch {
      // Ignore non-JSON lines mixed into stdout.
    }
  }
  return null;
}

async function hashFile(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch {
    return null;
  }
}

function normalizeHash(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]+$/.test(text) ? text : null;
}

function hashesMatch(currentHash, baselineHash) {
  const current = normalizeHash(currentHash);
  const baseline = normalizeHash(baselineHash);
  if (!current || !baseline) {
    return false;
  }
  return current === baseline || current.startsWith(baseline) || baseline.startsWith(current);
}

async function readLatestDesignStarterEvent(projectRoot) {
  const eventsPath = path.join(projectRoot, '.open-vibecoding', 'state', 'events.jsonl');
  if (!(await fileExists(eventsPath))) {
    return null;
  }
  const text = await fs.readFile(eventsPath, 'utf8').catch(() => '');
  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const event = JSON.parse(lines[index]);
      if (event?.type === 'design_starter_created' && typeof event.output === 'string' && event.output.trim()) {
        return event;
      }
    } catch {
      // Ignore malformed lines in append-only logs.
    }
  }
  return null;
}

function siblingDraftPaths(entryPath) {
  const ext = path.extname(entryPath);
  const name = path.basename(entryPath, ext);
  return [
    path.join(path.dirname(entryPath), `${name}.next${ext}`),
    path.join(path.dirname(entryPath), `${name}.rewrite${ext}`),
  ];
}

function createDesignStarterMonitor(projectRoot) {
  const state = {
    starterSeen: false,
    outputPath: null,
    draftPaths: [],
    draftPath: null,
    starterHash: null,
    currentHash: null,
    draftExists: false,
    observedEntryRewrite: false,
  };
  let inFlight = null;

  const poll = async () => {
    const event = await readLatestDesignStarterEvent(projectRoot);
    if (!event) {
      return;
    }
    const outputPath = path.resolve(projectRoot, event.output);
    const currentHash = await hashFile(outputPath);
    if (!state.starterSeen || state.outputPath !== outputPath) {
      state.starterSeen = true;
      state.outputPath = outputPath;
      state.draftPaths = siblingDraftPaths(outputPath);
      state.draftPath = state.draftPaths[0] || null;
      state.starterHash = currentHash;
      state.currentHash = currentHash;
    } else {
      if (!state.starterHash && currentHash) {
        state.starterHash = currentHash;
      }
      state.currentHash = currentHash;
    }
    if (state.starterHash && state.currentHash && state.starterHash !== state.currentHash) {
      state.observedEntryRewrite = true;
    }
    state.draftExists = false;
    for (const draftPath of state.draftPaths) {
      if (await fileExists(draftPath)) {
        state.draftExists = true;
        break;
      }
    }
  };

  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = poll().finally(() => {
      inFlight = null;
    });
  }, 250);

  return {
    async snapshot() {
      if (inFlight) {
        await inFlight;
      }
      await poll();
      return { ...state };
    },
    async stop() {
      clearInterval(timer);
      return this.snapshot();
    },
  };
}

function shouldAutoResumeEntryWrite(state) {
  return Boolean(
    state?.starterSeen
      && state.outputPath
      && state.starterHash
      && state.currentHash
      && state.starterHash === state.currentHash,
  );
}

async function readPatchModeGate(projectRoot) {
  const gatePath = path.join(projectRoot, '.open-vibecoding', 'harness', 'patch-mode-gate.json');
  if (!(await fileExists(gatePath))) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(gatePath, 'utf8'));
  } catch {
    return null;
  }
}

async function fileMtimeMs(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return Number(stat.mtimeMs || 0);
  } catch {
    return null;
  }
}

function patchModeTargetFiles(gate) {
  return [...new Set([
    typeof gate?.targetFile === 'string' ? gate.targetFile.trim() : null,
    ...((Array.isArray(gate?.draftFiles) ? gate.draftFiles : []).map((file) => String(file || '').trim())),
  ].filter(Boolean))];
}

function patchModeAnchor(gate) {
  if (!gate?.active) {
    return null;
  }
  if (gate.status === 'write-attempted' && Number.isFinite(gate.lastWriteAttemptAtMs) && gate.lastWriteAttemptAtMs > 0) {
    return {
      atMs: gate.lastWriteAttemptAtMs,
      timeoutMs: PATCH_MODE_WRITE_ATTEMPT_STALL_MS,
      reason: 'patch-mode-write-attempt-stalled',
    };
  }
  if (Number.isFinite(gate.armedAtMs) && gate.armedAtMs > 0) {
    return {
      atMs: gate.armedAtMs,
      timeoutMs: PATCH_MODE_ENTRY_STALL_MS,
      reason: 'patch-mode-entry-stalled',
    };
  }
  return null;
}

function createPatchModeMonitor(projectRoot) {
  return {
    async snapshot() {
      const gate = await readPatchModeGate(projectRoot);
      if (!gate?.active) {
        return {
          active: false,
          gate: null,
          targetFiles: [],
          writeObserved: false,
          stalled: false,
          reason: null,
        };
      }
      const targetFile = typeof gate?.targetFile === 'string' ? gate.targetFile.trim() : null;
      const targetFiles = patchModeTargetFiles(gate);
      const fileHashesAtArm = gate?.fileHashesAtArm && typeof gate.fileHashesAtArm === 'object'
        ? gate.fileHashesAtArm
        : null;
      const targetHashAtArm = typeof gate?.targetHashAtArm === 'string' ? gate.targetHashAtArm.trim() : null;
      const writeObserved = await Promise.all(targetFiles.map(async (file) => {
        const absolutePath = path.resolve(projectRoot, file);
        const currentHash = await hashFile(absolutePath);
        if (fileHashesAtArm && Object.prototype.hasOwnProperty.call(fileHashesAtArm, file)) {
          const baselineHash = fileHashesAtArm[file];
          if (typeof baselineHash === 'string' && baselineHash.trim()) {
            return Boolean(currentHash && !hashesMatch(currentHash, baselineHash));
          }
          if (baselineHash == null) {
            return currentHash != null;
          }
        }
        if (file === targetFile && targetHashAtArm) {
          return Boolean(currentHash && !hashesMatch(currentHash, targetHashAtArm));
        }
        const mtimeMs = await fileMtimeMs(absolutePath);
        return Boolean(mtimeMs && mtimeMs > Number(gate?.armedAtMs ?? 0));
      })).then((results) => results.some(Boolean));
      const anchor = patchModeAnchor(gate);
      const stalled = Boolean(
        anchor
          && !writeObserved
          && Date.now() - anchor.atMs >= anchor.timeoutMs,
      );
      return {
        ...gate,
        active: true,
        gate,
        targetFiles,
        writeObserved,
        stalled,
        reason: stalled ? anchor.reason : null,
      };
    },
    async stop() {
      return this.snapshot();
    },
  };
}

function buildResumePrompt(starterState, patchModeState = null, resumeReason = 'starter-output-unchanged') {
  const entryPath = patchModeState?.targetFile || starterState?.outputPath || 'index.html';
  const entryFile = path.basename(entryPath);
  const draftFiles = [...new Set([
    ...((starterState?.draftPaths || []).map((file) => path.basename(file))),
    ...((Array.isArray(patchModeState?.draftFiles) ? patchModeState.draftFiles : []).map((file) => path.basename(String(file || '')))),
  ].filter(Boolean))];
  return [
    resumeReason === 'patch-mode-write-attempt-stalled'
      ? `继续当前实现。你上一轮已经进入 Patch Mode，而且对 ${entryFile} 的写尝试没有真正落盘。`
      : resumeReason === 'patch-mode-entry-stalled'
        ? `继续当前实现。你上一轮已经进入 Patch Mode，但 ${entryFile} 在监督窗口内仍没有出现真实写入。`
        : `继续当前实现。你已经有 starter 生成的入口文件 ${entryFile}。`,
    resumeReason.startsWith('patch-mode')
      ? '现在不要继续搜集资料、不要再 web search、不要再读模板、也不要删除入口文件。'
      : '现在不要继续搜集资料、不要再停留在说明或规划，直接把页面成品落到入口文件本体后再结束。',
    draftFiles.length > 0
      ? `如果你已经写了 sibling draft（例如 ${draftFiles.join(' / ')}），现在把它合并或覆盖回正式入口文件 ${entryFile}。`
      : `现在直接修改 ${entryFile}，把剩余页面实现真正落盘。`,
    '如果你需要整页重写，先写 sibling draft，再覆盖回正式入口文件；不要 delete-first。',
    patchModeState?.phase === 'strict'
      ? `你已经宣布开始覆盖 ${entryFile}，下一步必须是真实写入动作。`
      : null,
    '入口文件写完后再收尾回复。',
  ].filter(Boolean).join('\n');
}

async function runCodex(codexCommand, prompt, args, runtimeEnv, workingDirectory, patchModeMonitor = null) {
  return new Promise((resolve) => {
    const runStartedAtMs = Date.now();
    const child = spawn(codexCommand, args, {
      cwd: workingDirectory,
      env: runtimeEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let monitorInFlight = null;
    let forcedResume = null;
    let hardKillTimer = null;

    const timer = patchModeMonitor ? setInterval(() => {
      if (forcedResume || monitorInFlight) {
        return;
      }
      monitorInFlight = patchModeMonitor.snapshot()
        .then((snapshot) => {
          if (DEBUG_PATCH_MODE_MONITOR) {
            console.error(`[openprd] patch mode snapshot: ${JSON.stringify(snapshot)}`);
          }
          const anchor = snapshot?.gate ? patchModeAnchor(snapshot.gate) : null;
          const effectiveAnchorAtMs = anchor ? Math.max(anchor.atMs, runStartedAtMs) : null;
          const stalled = Boolean(
            snapshot?.active
              && anchor
              && !snapshot.writeObserved
              && effectiveAnchorAtMs
              && Date.now() - effectiveAnchorAtMs >= anchor.timeoutMs,
          );
          if (!stalled || forcedResume) {
            return;
          }
          forcedResume = {
            reason: anchor.reason,
            snapshot: {
              ...snapshot,
              stalled: true,
              reason: anchor.reason,
            },
          };
          console.error(`[openprd] patch mode supervisor interrupt: ${anchor.reason}`);
          child.kill('SIGTERM');
          hardKillTimer = setTimeout(() => {
            child.kill('SIGKILL');
          }, 1000);
          hardKillTimer.unref?.();
        })
        .catch((error) => {
          console.error(`[openprd] patch mode monitor error: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          monitorInFlight = null;
        });
    }, PATCH_MODE_MONITOR_INTERVAL_MS) : null;

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      if (timer) {
        clearInterval(timer);
      }
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
      }
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr,
        error: error.message,
        supervisorInterrupted: Boolean(forcedResume),
        supervisorReason: forcedResume?.reason || null,
        supervisorState: forcedResume?.snapshot || null,
      });
    });
    child.on('close', async (exitCode, signal) => {
      if (timer) {
        clearInterval(timer);
      }
      if (hardKillTimer) {
        clearTimeout(hardKillTimer);
      }
      if (monitorInFlight) {
        await monitorInFlight;
      }
      resolve({
        ok: exitCode === 0 && !forcedResume,
        exitCode,
        signal,
        stdout,
        stderr,
        error: null,
        supervisorInterrupted: Boolean(forcedResume),
        supervisorReason: forcedResume?.reason || null,
        supervisorState: forcedResume?.snapshot || null,
      });
    });
    child.stdin.end(prompt);
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const prompt = await resolvePrompt(options);
  const sourceCodexHome = resolveSourceCodexHome(options);
  const outputJsonl = await prepareOutputPath(options.outputJsonl);
  const outputLastMessage = await prepareOutputPath(options.outputLastMessage);
  const isolatedHome = await prepareIsolatedCodexHome(sourceCodexHome);
  const model = options.model ?? await detectModel(sourceCodexHome);
  const runtimeEnv = {
    ...process.env,
    CODEX_HOME: isolatedHome,
    OPEN_VIBECODING_CODEX_HOME: isolatedHome,
  };
  const { commandPath: codexCommand, supportsHookTrustBypass } = resolveCodexCommand(runtimeEnv);
  const args = buildCodexArgs({
    ...options,
    cwd: path.resolve(options.cwd),
    model,
    outputLastMessage,
    supportsHookTrustBypass,
  });
  const workingDirectory = path.resolve(options.cwd);
  const starterMonitor = createDesignStarterMonitor(workingDirectory);
  const patchModeMonitor = createPatchModeMonitor(workingDirectory);

  console.error(`[openprd] source CODEX_HOME: ${sourceCodexHome}`);
  console.error(`[openprd] isolated CODEX_HOME: ${isolatedHome}`);
  console.error(`[openprd] resolved codex command: ${codexCommand}`);
  if (options.fullAuto && !supportsHookTrustBypass) {
    console.error('[openprd] resolved Codex does not support --dangerously-bypass-hook-trust; continuing without that flag');
  }
  if (model) {
    console.error(`[openprd] detected model: ${model}`);
  } else {
    console.error('[openprd] detected model: <none>');
  }

  try {
    const stdoutChunks = [];
    let sessionId = null;
    let passPrompt = prompt;
    let passArgs = args;

    for (let attempt = 0; attempt <= MAX_AUTOMATIC_CONTINUATIONS; attempt += 1) {
      const result = await runCodex(codexCommand, passPrompt, passArgs, runtimeEnv, workingDirectory, patchModeMonitor);
      stdoutChunks.push(result.stdout);
      sessionId = extractSessionId(result.stdout) || sessionId;
      const starterState = await starterMonitor.snapshot();
      const patchModeState = await patchModeMonitor.snapshot();
      if (result.supervisorInterrupted) {
        if (attempt === MAX_AUTOMATIC_CONTINUATIONS || !sessionId) {
          const targetSummary = patchModeState.targetFiles?.length > 0
            ? patchModeState.targetFiles.map((file) => path.basename(file)).join(', ')
            : path.basename(starterState.outputPath || 'index.html');
          throw new Error(`Patch Mode 已进入覆盖阶段，但 ${targetSummary} 在监督窗口内仍未出现真实写入。`);
        }
        console.error(`[openprd] patch mode stalled after pass ${attempt + 1}; auto-resuming session ${sessionId}`);
        passPrompt = buildResumePrompt(starterState, patchModeState, result.supervisorReason);
        passArgs = buildCodexResumeArgs({
          ...options,
          model,
          outputLastMessage,
          supportsHookTrustBypass,
        }, sessionId);
        continue;
      }
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || result.error || `codex exec exited with code ${result.exitCode ?? 'unknown'}`);
      }
      if (attempt === MAX_AUTOMATIC_CONTINUATIONS || !shouldAutoResumeEntryWrite(starterState) || !sessionId) {
        if (attempt === MAX_AUTOMATIC_CONTINUATIONS && shouldAutoResumeEntryWrite(starterState)) {
          const entryFile = path.basename(starterState.outputPath);
          throw new Error(`starter 已生成 ${entryFile}，但入口文件仍未被真正覆盖落盘。`);
        }
        break;
      }
      console.error(`[openprd] starter output unchanged after pass ${attempt + 1}; auto-resuming session ${sessionId}`);
      passPrompt = buildResumePrompt(starterState, patchModeState);
      passArgs = buildCodexResumeArgs({
        ...options,
        model,
        outputLastMessage,
        supportsHookTrustBypass,
      }, sessionId);
    }

    if (outputJsonl) {
      await fs.writeFile(outputJsonl, stdoutChunks.join(''), 'utf8');
    }
    return 0;
  } finally {
    await starterMonitor.stop();
    if (!options.keepCodexHome) {
      await fs.rm(isolatedHome, { recursive: true, force: true }).catch(() => null);
    }
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`[openprd] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
