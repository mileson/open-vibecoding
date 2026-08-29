/*
 * 核心功能
 * 为 OpenPrd fleet 项目刷新提供预检、preimage 备份、隔离 staging、校验和 CAS、原子落盘与自动恢复。
 *
 * 输入
 * 接收单个项目路径、fleet 分类与动作、目标版本、备份根目录，以及在 staging 项目上执行的更新回调。
 *
 * 输出
 * 返回稳定的事务计划和执行报告，包含版本、校验和、备份、迁移、拒绝原因与 rollback 结果。
 *
 * 定位
 * 位于 fleet 编排和具体 workspace 更新器之间，隔离批量更新风险，不直接实现 Agent/PRD 迁移逻辑。
 *
 * 依赖
 * 使用 kernel atomic-store 的原子 JSON 写与文件锁、project-manifest 兼容性断言和 transaction-store。
 *
 * 维护规则
 * 新增 fleet 写入类型时必须补分类门禁、失败恢复与拒绝原因测试。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertProjectManifestCompatible,
  atomicWriteJson,
  withFileLock,
} from '../kernel/index.js';
import {
  CHECKSUM_ALGORITHM,
  FLEET_MANAGED_SCOPES,
  FLEET_PRESERVED_SCOPE_PATTERNS,
  FLEET_PRESERVED_SCOPES,
  FLEET_TRANSACTION_SCHEMA,
  FLEET_TRANSACTION_VERSION,
  applyStagedState,
  assertPreservedScopesEmpty,
  collectSymlinkHazards,
  copyManagedScopes,
  createPreimageBackup,
  relocateStagingPaths,
  restorePreimageBackup,
  scopePolicyForRoot,
  sha256,
  snapshotManagedState,
} from './transaction-store.js';

const INSTALL_MANIFEST_SCHEMA_VERSION = 1;
const ARCHIVE_PATH_SEGMENTS = new Set([
  '.trash',
  'archive',
  'archives',
  'archived',
  'backup',
  'backups',
  'deprecated',
]);
const ACTION_CATEGORY_RULES = Object.freeze({
  update: new Set(['openprd-workspace']),
  'backfill-work-units': new Set(['openprd-workspace']),
  setup: new Set(['agent-configured']),
});

class FleetUpgradeRefusalError extends Error {
  constructor(refusals) {
    super(`Fleet upgrade refused: ${refusals.map((item) => item.message).join('; ')}`);
    this.name = 'FleetUpgradeRefusalError';
    this.code = 'OPENPRD_FLEET_UPGRADE_REFUSED';
    this.refusals = refusals;
  }
}

class FleetUpgradeMutationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FleetUpgradeMutationError';
    this.code = 'OPENPRD_FLEET_UPGRADE_MUTATION_FAILED';
    this.details = details;
  }
}

function sanitizePathToken(value) {
  return String(value || 'project')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';
}

function timestampToken(clock = () => new Date()) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Fleet transaction clock must return a valid date');
  return date.toISOString().replace(/[:.]/g, '-');
}

function resolveOpenPrdHome(options = {}) {
  return path.resolve(options.openprdHome ?? process.env.OPENPRD_HOME ?? path.join(os.homedir(), '.openprd'));
}

async function packageVersion() {
  const raw = await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8');
  return JSON.parse(raw).version ?? '0.0.0';
}

function parseSemver(value) {
  const match = String(value ?? '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : null;
}

function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function pathSegments(filePath) {
  const parsed = path.parse(path.resolve(filePath));
  return path.resolve(filePath)
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
}

function isArchivePathSegment(segment) {
  return ARCHIVE_PATH_SEGMENTS.has(segment)
    || /(^|[-_.])(archive|archived|backup|backups)([-_.]|$)/.test(segment);
}

function isArchiveProject(projectRoot) {
  return pathSegments(projectRoot).some(isArchivePathSegment);
}

async function inspectManifestCompatibility(projectRoot, targetVersion) {
  const refusals = [];
  const projectManifest = await readJsonIfPresent(path.join(projectRoot, '.openprd', 'manifest.json')).catch((error) => {
    refusals.push({
      code: 'invalid-project-manifest',
      path: '.openprd/manifest.json',
      message: `Project manifest cannot be read: ${error.message}`,
    });
    return null;
  });
  if (projectManifest) {
    try {
      assertProjectManifestCompatible(projectManifest, { mode: 'write' });
    } catch (error) {
      refusals.push({
        code: error.code ?? 'incompatible-project-manifest',
        path: '.openprd/manifest.json',
        message: error.message,
      });
    }
  }

  const installManifestPath = path.join(projectRoot, '.openprd', 'harness', 'install-manifest.json');
  const installManifest = await readJsonIfPresent(installManifestPath).catch((error) => {
    refusals.push({
      code: 'invalid-install-manifest',
      path: '.openprd/harness/install-manifest.json',
      message: `Install manifest cannot be read: ${error.message}`,
    });
    return null;
  });
  if (installManifest && !Number.isSafeInteger(installManifest.version)) {
    refusals.push({
      code: 'invalid-install-manifest-version',
      path: '.openprd/harness/install-manifest.json',
      message: 'Install manifest version must be an integer before fleet can write the project',
    });
  } else if (Number.isSafeInteger(installManifest?.version) && installManifest.version > INSTALL_MANIFEST_SCHEMA_VERSION) {
    refusals.push({
      code: 'install-manifest-too-new',
      path: '.openprd/harness/install-manifest.json',
      message: `Install manifest schema ${installManifest.version} is newer than supported ${INSTALL_MANIFEST_SCHEMA_VERSION}`,
    });
  }
  if (compareSemver(installManifest?.openprdVersion, targetVersion) === 1) {
    refusals.push({
      code: 'project-version-too-new',
      path: '.openprd/harness/install-manifest.json',
      message: `Project OpenPrd ${installManifest.openprdVersion} is newer than fleet target ${targetVersion}`,
    });
  }
  return { refusals, installManifest, projectManifest };
}

async function inspectFleetUpgradeSafety(project, options = {}) {
  const targetVersion = options.targetVersion ?? await packageVersion();
  const refusals = [];
  const allowedCategories = ACTION_CATEGORY_RULES[project.plannedAction];
  if (!allowedCategories || !allowedCategories.has(project.category)) {
    refusals.push({
      code: 'classification-unknown',
      path: '.',
      message: `Project classification ${project.category ?? 'unknown'} is not writable for ${project.plannedAction ?? 'unknown action'}`,
    });
  }
  if (isArchiveProject(project.path)) {
    refusals.push({
      code: 'archive-project',
      path: '.',
      message: 'Archive and backup project paths are immutable during fleet refresh',
    });
  }
  const compatibility = await inspectManifestCompatibility(project.path, targetVersion);
  refusals.push(...compatibility.refusals, ...await collectSymlinkHazards(project.path));
  return {
    ok: refusals.length === 0,
    targetVersion,
    currentVersion: compatibility.installManifest?.openprdVersion ?? null,
    refusals,
  };
}

async function createFleetTransactionContext(options = {}) {
  const targetVersion = options.targetVersion ?? await packageVersion();
  const transactionId = options.transactionId ?? `fleet-${timestampToken(options.clock)}-${randomUUID().slice(0, 8)}`;
  const backupRoot = path.resolve(options.backupRoot ?? path.join(
    resolveOpenPrdHome(options),
    'registry',
    'backups',
    `fleet-refresh-${targetVersion}-${transactionId}`,
  ));
  return {
    schema: FLEET_TRANSACTION_SCHEMA,
    version: FLEET_TRANSACTION_VERSION,
    transactionId,
    targetVersion,
    backupRoot,
    checksumAlgorithm: CHECKSUM_ALGORITHM,
    applyStrategy: 'staging+checksum-cas+atomic-file-replace',
  };
}

async function planFleetProjectTransaction(project, context, options = {}) {
  const safety = await inspectFleetUpgradeSafety(project, { targetVersion: context.targetVersion });
  const preimage = safety.ok ? await snapshotManagedState(project.path) : null;
  const scopePolicy = await scopePolicyForRoot(project.path);
  const projectToken = sanitizePathToken(project.relativePath === '.' ? path.basename(project.path) : project.relativePath);
  const projectDigest = sha256(path.resolve(project.path)).slice(0, 12);
  const backupPath = path.join(context.backupRoot, `${projectToken}-${projectDigest}`);
  return {
    schema: FLEET_TRANSACTION_SCHEMA,
    version: FLEET_TRANSACTION_VERSION,
    transactionId: context.transactionId,
    projectRoot: path.resolve(project.path),
    relativePath: project.relativePath,
    category: project.category,
    action: project.plannedAction,
    eligible: safety.ok,
    refusal: safety.refusals,
    versions: { before: safety.currentVersion, target: context.targetVersion, after: null },
    checksum: {
      algorithm: CHECKSUM_ALGORITHM,
      before: preimage?.checksum ?? null,
      staged: null,
      after: null,
    },
    scopePolicy,
    preimage,
    backup: {
      status: !safety.ok ? 'refused' : (options.dryRun ? 'planned' : 'pending'),
      path: backupPath,
      manifestPath: path.join(backupPath, 'manifest.json'),
      checksum: preimage?.checksum ?? null,
    },
    migration: null,
    rollback: { attempted: false, ok: null, reason: null, checksum: null },
  };
}

async function readAppliedVersion(projectRoot) {
  const manifest = await readJsonIfPresent(path.join(projectRoot, '.openprd', 'harness', 'install-manifest.json'));
  return manifest?.openprdVersion ?? null;
}

async function executeFleetProjectTransaction(plan, options = {}) {
  if (!plan.eligible) {
    return {
      ok: false,
      plan,
      error: new FleetUpgradeRefusalError(plan.refusal),
      mutationResult: null,
      afterApplyResult: null,
    };
  }
  const lockPath = path.join(path.dirname(plan.backup.path), 'locks', `${sha256(plan.projectRoot).slice(0, 16)}.lock`);
  return withFileLock(lockPath, async () => {
    let backupCreated = false;
    let mutationResult = null;
    try {
      const freshSafety = await inspectFleetUpgradeSafety({
        path: plan.projectRoot,
        category: plan.category,
        plannedAction: plan.action,
      }, { targetVersion: plan.versions.target });
      if (!freshSafety.ok) throw new FleetUpgradeRefusalError(freshSafety.refusals);
      const freshPreimage = await snapshotManagedState(plan.projectRoot);
      if (freshPreimage.checksum !== plan.preimage.checksum) {
        const error = new Error(`Project changed after fleet planning: expected ${plan.preimage.checksum}, found ${freshPreimage.checksum}`);
        error.code = 'OPENPRD_FLEET_PREIMAGE_CONFLICT';
        throw error;
      }

      await createPreimageBackup(plan);
      backupCreated = true;
      const stagingRoot = path.join(plan.backup.path, 'staging');
      const stagingHome = path.join(plan.backup.path, 'staging-openprd-home');
      await copyManagedScopes(plan.projectRoot, stagingRoot);
      mutationResult = await options.mutate(stagingRoot, {
        openprdHome: stagingHome,
        projectRoot: plan.projectRoot,
      });
      await assertPreservedScopesEmpty(stagingRoot);
      plan.migration = mutationResult?.migration ?? null;
      if (!mutationResult?.ok) {
        throw new FleetUpgradeMutationError(
          mutationResult?.message ?? 'Staged fleet mutation reported failure',
          mutationResult ?? {},
        );
      }
      await relocateStagingPaths(stagingRoot, stagingHome, plan.projectRoot, resolveOpenPrdHome(options));
      const stagedSnapshot = await snapshotManagedState(stagingRoot);
      plan.checksum.staged = stagedSnapshot.checksum;
      const applied = await applyStagedState(plan, stagingRoot, stagedSnapshot, { beforeApply: options.beforeApply });
      plan.checksum.after = applied.checksum;
      plan.versions.after = await readAppliedVersion(plan.projectRoot);
      const afterApplyResult = options.afterApply
        ? await options.afterApply({ plan, mutationResult, applied })
        : null;
      plan.checksum.after = (await snapshotManagedState(plan.projectRoot)).checksum;
      try {
        await fs.rm(stagingRoot, { recursive: true, force: true });
        await fs.rm(stagingHome, { recursive: true, force: true });
        plan.backup.stagingStatus = 'removed-after-apply';
      } catch (error) {
        plan.backup.stagingStatus = 'retained-cleanup-failed';
        plan.backup.cleanupWarning = error.message;
      }
      await atomicWriteJson(path.join(plan.backup.path, 'result.json'), {
        schema: FLEET_TRANSACTION_SCHEMA,
        version: FLEET_TRANSACTION_VERSION,
        ok: true,
        plan,
      });
      return { ok: true, plan, mutationResult, afterApplyResult, error: null };
    } catch (error) {
      if (!backupCreated && plan.backup.status !== 'refused') plan.backup.status = 'failed';
      let rollbackError = null;
      if (backupCreated) {
        try {
          await restorePreimageBackup(plan, error.code ?? error.message);
        } catch (restoreError) {
          rollbackError = restoreError;
        }
      }
      const resultError = rollbackError
        ? new AggregateError([error, rollbackError], `Fleet upgrade failed and rollback failed for ${plan.projectRoot}`)
        : error;
      if (backupCreated) {
        await atomicWriteJson(path.join(plan.backup.path, 'result.json'), {
          schema: FLEET_TRANSACTION_SCHEMA,
          version: FLEET_TRANSACTION_VERSION,
          ok: false,
          error: {
            name: resultError.name,
            code: resultError.code ?? null,
            message: resultError.message,
          },
          plan,
        }).catch(() => {});
      }
      return { ok: false, plan, mutationResult, afterApplyResult: null, error: resultError };
    }
  }, options.lockOptions);
}

export {
  CHECKSUM_ALGORITHM,
  FLEET_MANAGED_SCOPES,
  FLEET_PRESERVED_SCOPE_PATTERNS,
  FLEET_PRESERVED_SCOPES,
  FLEET_TRANSACTION_SCHEMA,
  FLEET_TRANSACTION_VERSION,
  FleetUpgradeMutationError,
  FleetUpgradeRefusalError,
  createFleetTransactionContext,
  executeFleetProjectTransaction,
  inspectFleetUpgradeSafety,
  planFleetProjectTransaction,
  snapshotManagedState,
};
