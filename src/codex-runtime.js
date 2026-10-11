/*
 * 核心功能
 * 封装 Codex CLI runtime 健康检查、可识别诊断和显式修复流程。
 *
 * 输入
 * 接收 Codex 命令、package manager、cwd/env、是否 repair 以及可注入的 runCommand。
 *
 * 输出
 * 导出 checkCodexCliHealth、repairCodexCli 和 ensureCodexCliReady 等结构化结果。
 *
 * 定位
 * 位于 Open VibeCoding CLI 的 Agent runtime 边界，只处理本机 Codex 命令健康，不管理 PRD/task 状态。
 *
 * 依赖
 * 使用 node:child_process 启动本地命令；被 doctor 与 loop run 复用。
 *
 * 维护规则
 * 默认路径不得修改全局 Codex 安装；新增修复行为必须保持显式 opt-in 且可测试注入。
 */
import { spawn } from 'node:child_process';

export const CODEX_REPAIR_PACKAGE = '@openai/codex@latest';

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

export function formatCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(' ');
}

function windowsShellQuote(value) {
  const text = String(value);
  if (!text) {
    return '""';
  }
  if (!/[\s"&<>|^]/.test(text)) {
    return text;
  }
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function formatWindowsCommand(command, args = []) {
  return [command, ...args].map(windowsShellQuote).join(' ');
}

function hasExplicitPath(command) {
  return /[\\/]/.test(command) || /^[A-Za-z]:/.test(command);
}

export function buildProcessInvocation(command, args = [], options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const useWindowsShellWrapper = (
    platform === 'win32'
    && options.shell === undefined
    && !hasExplicitPath(command)
  );

  if (useWindowsShellWrapper) {
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', formatWindowsCommand(command, args)],
      display: formatCommand(command, args),
      shell: false,
    };
  }

  return {
    command,
    args,
    display: formatCommand(command, args),
    shell: Boolean(options.shell),
  };
}

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const invocation = buildProcessInvocation(command, args, options);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: invocation.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? Math.max(1, Number(options.timeoutMs))
      : 15000;
    const killGraceMs = Number.isFinite(options.killGraceMs)
      ? Math.max(1, Number(options.killGraceMs))
      : 1000;
    let killTimer = null;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
      killTimer.unref?.();
    }, timeoutMs);
    timeoutTimer.unref?.();
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(payload);
    };
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-64000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64000);
    });
    child.on('error', (error) => {
      finish({
        ok: false,
        command,
        args,
        display: invocation.display,
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        error: error.message,
      });
    });
    child.on('close', (exitCode, signal) => {
      finish({
        ok: !timedOut && exitCode === 0,
        command,
        args,
        display: invocation.display,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        error: timedOut ? `Command timed out after ${timeoutMs}ms.` : null,
      });
    });
  });
}

function normalizeRunResult(command, args, result = {}) {
  return {
    ok: Boolean(result.ok),
    command: result.command ?? command,
    args: result.args ?? args,
    display: result.display ?? formatCommand(command, args),
    exitCode: result.exitCode ?? result.status ?? null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    timedOut: Boolean(result.timedOut),
    signal: result.signal ? String(result.signal) : null,
    error: result.error ? String(result.error) : null,
  };
}

function runOutput(result) {
  return [
    result.stderr,
    result.stdout,
    result.error,
  ].filter(Boolean).join('\n').trim();
}

export function buildCodexRepairCommand(options = {}) {
  const command = options.packageManager ?? 'npm';
  const args = ['install', '-g', options.package ?? CODEX_REPAIR_PACKAGE];
  return {
    command,
    args,
    display: formatCommand(command, args),
  };
}

function missingOptionalDependency(output) {
  const direct = output.match(/Missing optional dependency\s+([@A-Za-z0-9/._-]+)/i);
  if (direct) return direct[1].replace(/[.。:：,，;；]+$/, '');
  const moduleMissing = output.match(/Cannot find module ['"](@openai\/codex-[^'"]+)['"]/i);
  if (moduleMissing) return moduleMissing[1];
  const packageLike = output.match(/(@openai\/codex-[A-Za-z0-9._-]+)/i);
  if (/optional dependenc/i.test(output) && packageLike) return packageLike[1];
  return null;
}

export function diagnoseCodexVersionFailure(result, options = {}) {
  const output = runOutput(result);
  const repairCommand = buildCodexRepairCommand(options);
  const missingPackage = missingOptionalDependency(output);
  if (missingPackage) {
    return {
      type: 'missing-optional-dependency',
      summary: `Codex CLI 启动失败：缺少平台原生可选依赖 ${missingPackage}。`,
      missingPackage,
      repairCommand,
      manualCommand: repairCommand.display,
      output,
    };
  }

  if (result.timedOut) {
    return {
      type: 'version-check-timeout',
      summary: `Codex CLI 健康检查超时：codex --version 在 ${options.timeoutMs ?? 15000}ms 内没有返回。`,
      missingPackage: null,
      repairCommand,
      manualCommand: repairCommand.display,
      output,
    };
  }

  if (
    result.exitCode === null
    && /(ENOENT|not found|command not found|no such file|spawn .*enoent)/i.test(output)
  ) {
    return {
      type: 'command-not-found',
      summary: 'Codex CLI 不在 PATH 中，Open VibeCoding 无法启动 Codex 代理子会话。',
      missingPackage: null,
      repairCommand,
      manualCommand: repairCommand.display,
      output,
    };
  }

  return {
    type: 'version-check-failed',
    summary: `Codex CLI 健康检查失败：codex --version 退出码 ${result.exitCode ?? 'unknown'}。`,
    missingPackage: null,
    repairCommand,
    manualCommand: repairCommand.display,
    output,
  };
}

export async function checkCodexCliHealth(options = {}) {
  const command = options.codexCommand ?? 'codex';
  const args = options.versionArgs ?? ['--version'];
  const runner = options.runCommand ?? runProcess;
  const result = normalizeRunResult(
    command,
    args,
    await runner(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      timeoutMs: options.timeoutMs ?? 15000,
      killGraceMs: options.killGraceMs,
    }),
  );
  const repairCommand = buildCodexRepairCommand(options);
  const commandInfo = {
    command,
    args,
    display: formatCommand(command, args),
  };

  if (result.ok) {
    return {
      ok: true,
      command: commandInfo,
      result,
      version: (result.stdout || result.stderr).trim() || null,
      diagnostic: null,
      repairCommand,
      errors: [],
    };
  }

  const diagnostic = diagnoseCodexVersionFailure(result, options);
  return {
    ok: false,
    command: commandInfo,
    result,
    version: null,
    diagnostic,
    repairCommand,
    errors: [
      diagnostic.summary,
      `修复命令: ${repairCommand.display}`,
    ],
  };
}

export async function repairCodexCli(options = {}) {
  const runner = options.runCommand ?? runProcess;
  const commandInfo = buildCodexRepairCommand(options);
  const result = normalizeRunResult(
    commandInfo.command,
    commandInfo.args,
    await runner(commandInfo.command, commandInfo.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      timeoutMs: options.repairTimeoutMs ?? 300000,
      killGraceMs: options.killGraceMs,
    }),
  );
  const recheck = result.ok ? await checkCodexCliHealth(options) : null;
  const errors = [];
  if (!result.ok) {
    errors.push(result.stderr.trim() || result.error || `Codex 修复命令失败，退出码 ${result.exitCode ?? 'unknown'}。`);
  }
  if (result.ok && !recheck?.ok) {
    errors.push(...(recheck?.errors ?? ['Codex 修复后仍未通过健康检查。']));
  }

  return {
    attempted: true,
    ok: result.ok && recheck?.ok === true,
    command: commandInfo,
    result,
    recheck,
    errors,
  };
}

export async function ensureCodexCliReady(options = {}) {
  const preflight = await checkCodexCliHealth(options);
  if (preflight.ok) {
    return {
      ok: true,
      preflight,
      repair: null,
      repairAttempted: false,
      repairCommand: preflight.repairCommand,
      errors: [],
    };
  }

  if (!options.repair) {
    return {
      ok: false,
      preflight,
      repair: null,
      repairAttempted: false,
      repairCommand: preflight.repairCommand,
      errors: [
        'Codex CLI 健康检查未通过，Open VibeCoding 已停止启动 Codex 子会话。',
        ...preflight.errors,
        '如需让 Open VibeCoding 执行修复，请显式运行 open-vibecoding doctor . --tools codex --fix 或 open-vibecoding loop . --run --agent codex --repair-agent。',
      ],
    };
  }

  const repair = await repairCodexCli(options);
  return {
    ok: repair.ok,
    preflight,
    repair,
    repairAttempted: true,
    repairCommand: preflight.repairCommand,
    errors: repair.ok
      ? []
      : [
        'Codex CLI 显式修复后仍未通过健康检查。',
        ...repair.errors,
        `可手动执行: ${preflight.repairCommand.display}`,
      ],
  };
}
