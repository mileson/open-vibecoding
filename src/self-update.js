import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readWorkspaceRegistry } from './workspace-registry.js';

export const DEFAULT_SELF_UPDATE_SOURCE = 'open-vibecoding@latest';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACKAGE_ROOT = path.resolve(MODULE_DIR, '..');

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

function normalizeVersionText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  return raw.startsWith('v') ? raw.slice(1) : raw;
}

function parseSemverParts(value) {
  const normalized = normalizeVersionText(value);
  const match = normalized?.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/u);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftParts = String(left ?? '').split('.');
  const rightParts = String(right ?? '').split('.');
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const diff = Number.parseInt(leftPart, 10) - Number.parseInt(rightPart, 10);
      if (diff !== 0) {
        return diff > 0 ? 1 : -1;
      }
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    const diff = leftPart.localeCompare(rightPart);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

export function compareVersions(left, right) {
  const leftParts = parseSemverParts(left);
  const rightParts = parseSemverParts(right);
  if (!leftParts || !rightParts) {
    return null;
  }
  for (const field of ['major', 'minor', 'patch']) {
    if (leftParts[field] !== rightParts[field]) {
      return leftParts[field] > rightParts[field] ? 1 : -1;
    }
  }
  if (!leftParts.prerelease && !rightParts.prerelease) {
    return 0;
  }
  if (!leftParts.prerelease) {
    return 1;
  }
  if (!rightParts.prerelease) {
    return -1;
  }
  return comparePrereleaseIdentifiers(leftParts.prerelease, rightParts.prerelease);
}

function packageNameFromSource(source, fallback = 'open-vibecoding') {
  const text = String(source ?? '').trim();
  if (!text) {
    return fallback;
  }
  const scopedMatch = text.match(/^(@[^/]+\/[^@]+)(?:@.+)?$/u);
  if (scopedMatch) {
    return scopedMatch[1];
  }
  const unscopedMatch = text.match(/^([^@]+)(?:@.+)?$/u);
  return unscopedMatch?.[1] ?? fallback;
}

function parseVersionOutput(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') {
      return normalizeVersionText(parsed);
    }
    if (Array.isArray(parsed)) {
      const first = parsed.find((item) => typeof item === 'string' && item.trim());
      return first ? normalizeVersionText(first) : null;
    }
  } catch {
    // Fall back to plain text parsing.
  }
  const firstLine = raw.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
  return firstLine ? normalizeVersionText(firstLine) : null;
}

function versionComparisonLabel(currentVersion, targetVersion) {
  const comparison = compareVersions(currentVersion, targetVersion);
  if (comparison === null) {
    return 'unknown';
  }
  if (comparison < 0) {
    return 'behind';
  }
  if (comparison > 0) {
    return 'ahead';
  }
  return 'same';
}

function refreshCandidateNote(workspaceRoot) {
  return /(^|\/)(archive|archives|归档)(\/|$)/iu.test(String(workspaceRoot ?? ''))
    ? '归档项目，建议先确认'
    : '可直接处理';
}

async function readPackageInfo(packageRoot = DEFAULT_PACKAGE_ROOT) {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(raw);
  return {
    name: packageJson.name ?? null,
    version: packageJson.version ?? null,
    packageRoot,
    packageJsonPath,
  };
}

async function isLocalSourceCheckout(packageRoot = DEFAULT_PACKAGE_ROOT) {
  const gitDir = path.join(packageRoot, '.git');
  return fs.stat(gitDir).then((stat) => stat.isDirectory() || stat.isFile(), () => false);
}

function runProcess(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      shell: Boolean(options.shell),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${chunk}`.slice(-64000);
    });
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-64000);
    });
    child.on('error', (error) => {
      resolve({
        ok: false,
        command,
        args,
        display: formatCommand(command, args),
        exitCode: null,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on('close', (exitCode) => {
      resolve({
        ok: exitCode === 0,
        command,
        args,
        display: formatCommand(command, args),
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}

async function resolveOpenPrdExecutable(deps = {}) {
  if (typeof deps.resolveOpenPrdExecutable === 'function') {
    return deps.resolveOpenPrdExecutable();
  }
  const command = process.platform === 'win32' ? 'where open-vibecoding' : 'command -v open-vibecoding';
  const result = await runProcess(command, [], { shell: true });
  const executable = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
  if (!result.ok || !executable) {
    return {
      ok: false,
      executable: null,
      command,
      error: result.stderr.trim() || 'Unable to resolve open-vibecoding executable from PATH.',
    };
  }
  return {
    ok: true,
    executable,
    command,
    error: null,
  };
}

async function inspectPublishedVersion(packageInfo, options = {}, deps = {}) {
  const runCommand = deps.runCommand ?? runProcess;
  const packageName = packageInfo.name ?? packageNameFromSource(options.source ?? DEFAULT_SELF_UPDATE_SOURCE);
  const command = 'npm';
  const args = ['view', packageName, 'version', '--json'];
  const result = await runCommand(command, args, {
    cwd: options.cwd ?? packageInfo.packageRoot ?? process.cwd(),
    env: options.env ?? process.env,
  });
  const publishedVersion = result.ok ? parseVersionOutput(result.stdout) : null;
  const errors = [];
  if (!result.ok) {
    errors.push(result.stderr.trim() || `npm view failed with exit code ${result.exitCode}.`);
  } else if (!publishedVersion) {
    errors.push(`Unable to parse the published npm version for ${packageName}.`);
  }
  const comparison = versionComparisonLabel(packageInfo.version, publishedVersion);
  return {
    ok: errors.length === 0,
    packageName,
    currentVersion: normalizeVersionText(packageInfo.version),
    publishedVersion,
    updateAvailable: comparison === 'behind',
    comparison,
    command: {
      command,
      args,
      display: formatCommand(command, args),
    },
    result,
    errors,
  };
}

async function resolveExecutableVersion(executable, options = {}, deps = {}) {
  const runCommand = deps.runCommand ?? runProcess;
  const result = await runCommand(executable, ['--version'], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
  });
  const version = result.ok ? parseVersionOutput(result.stdout || result.stderr) : null;
  const errors = [];
  if (!result.ok) {
    errors.push(result.stderr.trim() || `Version check failed with exit code ${result.exitCode}.`);
  } else if (!version) {
    errors.push('Unable to parse the installed Open VibeCoding version after update.');
  }
  return {
    ok: errors.length === 0,
    executable,
    version,
    command: {
      command: executable,
      args: ['--version'],
      display: formatCommand(executable, ['--version']),
    },
    result,
    errors,
  };
}

async function collectRefreshCandidates(targetVersion, options = {}, deps = {}) {
  const normalizedTargetVersion = normalizeVersionText(targetVersion);
  if (!normalizedTargetVersion) {
    return {
      ok: true,
      targetVersion: null,
      registryPath: null,
      staleCount: 0,
      total: 0,
      projects: [],
    };
  }
  const registry = await (deps.readWorkspaceRegistry ?? readWorkspaceRegistry)({
    openprdHome: options.openprdHome,
  });
  const projects = registry.entries
    .filter((entry) => {
      if (!entry.openprdVersion) {
        return false;
      }
      return compareVersions(entry.openprdVersion, normalizedTargetVersion) === -1;
    })
    .map((entry) => ({
      workspaceRoot: entry.workspaceRoot,
      workspaceName: entry.workspaceName ?? path.basename(entry.workspaceRoot),
      currentVersion: normalizeVersionText(entry.openprdVersion),
      targetVersion: normalizedTargetVersion,
      suggestedAction: '刷新 OpenPrD',
      note: refreshCandidateNote(entry.workspaceRoot),
    }))
    .sort((left, right) => left.workspaceRoot.localeCompare(right.workspaceRoot));

  return {
    ok: true,
    targetVersion: normalizedTargetVersion,
    registryPath: registry.registryPath,
    staleCount: registry.staleEntries.length,
    total: projects.length,
    projects,
  };
}

function buildSelfUpdatePlan(options = {}) {
  const source = options.source ?? DEFAULT_SELF_UPDATE_SOURCE;
  const command = options.packageManager ?? 'npm';
  const args = ['install', '-g', source];
  return {
    source,
    install: {
      command,
      args,
      display: formatCommand(command, args),
    },
  };
}

function buildProjectRefreshPlan(targetPath, options = {}) {
  const executable = options.executable ?? 'open-vibecoding';
  const args = options.fleet
    ? ['fleet', targetPath, '--update-open-vibecoding']
    : ['update', targetPath];

  if (options.fleet && options.maxDepth) {
    args.push('--max-depth', String(options.maxDepth));
  }
  if (options.fleet && options.include) {
    args.push('--include', String(options.include));
  }
  if (options.fleet && options.exclude) {
    args.push('--exclude', String(options.exclude));
  }
  if (options.fleet && options.report) {
    args.push('--report');
    if (typeof options.report === 'string') {
      args.push(options.report);
    }
  }
  if (options.tools) {
    args.push('--tools', options.tools);
  }
  if (options.hookProfile) {
    args.push('--hook-profile', options.hookProfile);
  }
  if (options.force && !options.fleet) {
    args.push('--force');
  }
  if (options.childJson) {
    args.push('--json');
  }

  return {
    mode: options.fleet ? 'fleet' : 'project',
    targetPath,
    refresh: {
      command: executable,
      args,
      display: formatCommand(executable, args),
    },
  };
}

export function createSelfUpdateWorkspace(deps = {}) {
  const runCommand = deps.runCommand ?? runProcess;
  const packageRoot = deps.packageRoot ?? DEFAULT_PACKAGE_ROOT;

  async function checkSelfUpdateWorkspace(options = {}) {
    const packageInfo = await (deps.readPackageInfo ?? readPackageInfo)(packageRoot);
    const versionCheck = await inspectPublishedVersion(packageInfo, options, {
      ...deps,
      runCommand,
    });
    const refreshTargetVersion = versionCheck.updateAvailable
      ? versionCheck.publishedVersion
      : packageInfo.version;
    const refreshCandidates = await collectRefreshCandidates(refreshTargetVersion, options, deps);
    return {
      ok: versionCheck.ok,
      action: 'self-update-check',
      checkOnly: true,
      source: 'npm-published-version',
      package: packageInfo,
      currentVersion: normalizeVersionText(packageInfo.version),
      publishedVersion: versionCheck.publishedVersion,
      updateAvailable: versionCheck.updateAvailable,
      comparison: versionCheck.comparison,
      versionCheck,
      refreshCandidates,
      errors: [...versionCheck.errors],
      nextActions: versionCheck.updateAvailable
        ? ['Run `open-vibecoding self-update` to install the published CLI version.']
        : [],
    };
  }

  async function selfUpdateWorkspace(options = {}) {
    const packageInfo = await (deps.readPackageInfo ?? readPackageInfo)(packageRoot);
    const localCheckout = await (deps.isLocalSourceCheckout ?? isLocalSourceCheckout)(packageRoot);
    if (options.check) {
      return checkSelfUpdateWorkspace(options);
    }
    const plan = buildSelfUpdatePlan(options);
    const base = {
      ok: true,
      action: 'self-update',
      dryRun: Boolean(options.dryRun),
      source: plan.source,
      package: packageInfo,
      localCheckout,
      installCommand: plan.install,
      result: null,
      resolvedExecutable: null,
      installedVersion: null,
      refreshCandidates: {
        ok: true,
        targetVersion: null,
        registryPath: null,
        staleCount: 0,
        total: 0,
        projects: [],
      },
      errors: [],
      nextActions: [],
    };

    if (options.dryRun) {
      return {
        ...base,
        skipped: true,
        skipReason: 'dry-run',
        nextActions: ['Run without --dry-run after the open-vibecoding package is published.'],
      };
    }

    if (localCheckout && !options.allowLocalCheckout) {
      return {
        ...base,
        ok: false,
        skipped: true,
        skipReason: 'local-source-checkout',
        errors: [
          'This open-vibecoding command is running from a local source checkout. Reinstall the global CLI with npm after the new package is published, or use your local development workflow.',
        ],
        nextActions: [
          `Run ${plan.install.display} from outside the source checkout, or update this checkout manually.`,
        ],
      };
    }

    const installResult = await runCommand(plan.install.command, plan.install.args, {
      cwd: options.cwd ?? packageInfo.packageRoot,
      env: options.env ?? process.env,
    });
    const resolvedExecutable = installResult.ok
      ? await resolveOpenPrdExecutable(deps)
      : null;
    const installedVersion = installResult.ok && resolvedExecutable?.ok
      ? await resolveExecutableVersion(resolvedExecutable.executable, options, {
        ...deps,
        runCommand,
      })
      : null;
    const refreshCandidates = installedVersion?.ok
      ? await collectRefreshCandidates(installedVersion.version, options, deps)
      : base.refreshCandidates;

    return {
      ...base,
      ok: installResult.ok && (resolvedExecutable?.ok ?? false) && (installedVersion?.ok ?? false),
      result: installResult,
      resolvedExecutable,
      installedVersion,
      refreshCandidates,
      errors: [
        ...(installResult.ok ? [] : [installResult.stderr.trim() || `Self-update command failed with exit code ${installResult.exitCode}.`]),
        ...(installResult.ok && !resolvedExecutable?.ok ? [resolvedExecutable?.error ?? 'Unable to resolve updated open-vibecoding executable.'] : []),
        ...(installedVersion?.errors ?? []),
      ],
      nextActions: [
        ...(installResult.ok && !resolvedExecutable?.ok
          ? ['Check that the global npm bin directory is on PATH, then run open-vibecoding update <project>.']
          : []),
        ...((refreshCandidates?.total ?? 0) > 0
          ? ['If you want to refresh older workspaces too, review the refreshCandidates list before running fleet or per-project updates.']
          : []),
      ],
    };
  }

  async function upgradeWorkspace(targetPath, options = {}) {
    const resolvedTarget = path.resolve(targetPath ?? process.cwd());
    const selfUpdate = await selfUpdateWorkspace(options);
    const dryRun = Boolean(options.dryRun);
    const executable = selfUpdate.resolvedExecutable?.executable ?? 'open-vibecoding';
    const refreshPlan = buildProjectRefreshPlan(resolvedTarget, {
      ...options,
      executable,
      childJson: Boolean(options.json),
    });
    const base = {
      ok: true,
      action: 'upgrade',
      dryRun,
      mode: refreshPlan.mode,
      targetPath: resolvedTarget,
      selfUpdate,
      projectRefresh: {
        ok: true,
        skipped: false,
        command: refreshPlan.refresh,
        result: null,
        errors: [],
      },
      stages: {
        selfUpdateOk: selfUpdate.ok,
        projectRefreshOk: true,
      },
      errors: [],
    };

    if (dryRun) {
      return {
        ...base,
        projectRefresh: {
          ...base.projectRefresh,
          skipped: true,
          skipReason: 'dry-run',
        },
      };
    }

    if (!selfUpdate.ok) {
      return {
        ...base,
        ok: false,
        projectRefresh: {
          ...base.projectRefresh,
          ok: false,
          skipped: true,
          skipReason: 'self-update-failed',
          errors: ['Project refresh was not run because self-update did not complete.'],
        },
        stages: {
          selfUpdateOk: false,
          projectRefreshOk: false,
        },
        errors: selfUpdate.errors,
      };
    }

    const refreshResult = await runCommand(refreshPlan.refresh.command, refreshPlan.refresh.args, {
      cwd: options.cwd ?? resolvedTarget,
      env: options.env ?? process.env,
    });
    const projectRefresh = {
      ok: refreshResult.ok,
      skipped: false,
      command: refreshPlan.refresh,
      result: refreshResult,
      errors: refreshResult.ok ? [] : [refreshResult.stderr.trim() || `Project refresh failed with exit code ${refreshResult.exitCode}.`],
    };

    return {
      ...base,
      ok: selfUpdate.ok && projectRefresh.ok,
      projectRefresh,
      stages: {
        selfUpdateOk: selfUpdate.ok,
        projectRefreshOk: projectRefresh.ok,
      },
      errors: [
        ...selfUpdate.errors,
        ...projectRefresh.errors,
      ],
    };
  }

  return {
    checkSelfUpdateWorkspace,
    selfUpdateWorkspace,
    upgradeWorkspace,
  };
}

const defaultWorkspace = createSelfUpdateWorkspace();

export const checkSelfUpdateWorkspace = defaultWorkspace.checkSelfUpdateWorkspace;
export const selfUpdateWorkspace = defaultWorkspace.selfUpdateWorkspace;
export const upgradeWorkspace = defaultWorkspace.upgradeWorkspace;
