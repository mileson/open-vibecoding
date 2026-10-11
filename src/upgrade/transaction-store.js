/*
 * 核心功能
 * 提供 fleet 项目事务所需的 managed-scope 快照、备份、staging 重定位、原子应用和校验和恢复。
 *
 * 输入
 * 接收项目根目录、事务计划、staging 根目录和可选的 apply 故障注入回调。
 *
 * 输出
 * 返回稳定的 SHA-256 文件树快照，并保证备份、应用和恢复结果都经过同一校验算法核对。
 *
 * 定位
 * 位于 upgrade 基础设施层，不判断项目分类、版本策略或 fleet 动作。
 *
 * 依赖
 * 使用 kernel atomic-store 写事务 manifest 和重定位后的文本文件。
 *
 * 维护规则
 * 新增 updater 可写路径时同步维护 managed/preserved scope 策略；禁止跟随符号链接读取或写入。
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CANONICAL_COMMANDS, CANONICAL_SKILLS } from '../agent-canonical-content.js';
import { atomicWriteJson, atomicWriteText } from '../kernel/index.js';
import { hasLegacyOpenPrdArtifacts } from '../openspec/migration.js';

const FLEET_TRANSACTION_SCHEMA = 'openprd.fleet-upgrade-transaction';
const FLEET_TRANSACTION_VERSION = 1;
const CHECKSUM_ALGORITHM = 'sha256';

const OPEN_VIBECODING_AGENT_ARTIFACT_SCOPES = Object.freeze([
  ...CANONICAL_SKILLS.flatMap((skill) => [
    path.join('.codex', 'skills', skill.id),
    path.join('.claude', 'skills', skill.id),
  ]),
  ...CANONICAL_COMMANDS.flatMap((command) => [
    path.join('.codex', 'prompts', `open-vibecoding-${command.id}.md`),
    path.join('.claude', 'commands', 'open-vibecoding', `${command.id}.md`),
    path.join('.cursor', 'commands', `open-vibecoding-${command.id}.md`),
  ]),
]);
const FLEET_MANAGED_SCOPES = Object.freeze([
  '.open-vibecoding',
  'AGENTS.md',
  'CLAUDE.md',
  '.gitignore',
  path.join('.codex', 'config.toml'),
  path.join('.codex', 'hooks.json'),
  path.join('.codex', 'hooks', 'open-vibecoding-hook.mjs'),
  path.join('.cursor', 'rules', 'open-vibecoding.mdc'),
  ...OPEN_VIBECODING_AGENT_ARTIFACT_SCOPES,
]);
const FLEET_PRESERVED_SCOPES = Object.freeze([
  path.join('.open-vibecoding', '.derived-data'),
  path.join('.open-vibecoding', 'artifacts'),
  path.join('.open-vibecoding', 'quality', 'reports'),
  path.join('.open-vibecoding', 'tmp'),
]);
const FLEET_PRESERVED_SCOPE_PATTERNS = Object.freeze([
  '.open-vibecoding/harness/DerivedData-*',
]);

async function managedScopesForRoot(projectRoot) {
  const scopes = [...FLEET_MANAGED_SCOPES];
  // `open-vibecoding/` is only managed when it is the legacy changes/specs tree. A
  // normal nested repository named `openprd` must never enter the transaction.
  if (await hasLegacyOpenPrdArtifacts(projectRoot)) scopes.push('open-vibecoding');
  return scopes;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/');
}

function isPreservedScopePath(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath).replace(/^\.\//, '').replace(/\/$/, '');
  if (FLEET_PRESERVED_SCOPES.some((scope) => {
    const normalizedScope = normalizeRelativePath(scope);
    return normalizedPath === normalizedScope || normalizedPath.startsWith(`${normalizedScope}/`);
  })) return true;
  const parts = normalizedPath.split('/');
  return parts[0] === '.open-vibecoding'
    && parts[1] === 'harness'
    && /^derived[-_]?data(?:[-_].*)?$/i.test(parts[2] ?? '');
}

async function preservedScopesForRoot(projectRoot) {
  const scopes = [...FLEET_PRESERVED_SCOPES];
  const harnessRoot = path.join(projectRoot, '.open-vibecoding', 'harness');
  const entries = await fs.readdir(harnessRoot, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries) {
    const scope = path.join('.open-vibecoding', 'harness', entry.name);
    if (isPreservedScopePath(scope)) scopes.push(scope);
  }
  return [...new Set(scopes)];
}

async function scopePolicyForRoot(projectRoot) {
  return {
    managedRoots: (await managedScopesForRoot(projectRoot)).map(normalizeRelativePath),
    preservedRoots: (await preservedScopesForRoot(projectRoot)).map(normalizeRelativePath),
    preservedPatterns: [...FLEET_PRESERVED_SCOPE_PATTERNS],
  };
}

async function collectSymlinkHazards(projectRoot) {
  const hazards = [];
  const hazardPaths = new Set();
  function addHazard(relativePath) {
    const normalizedPath = normalizeRelativePath(relativePath);
    if (hazardPaths.has(normalizedPath)) return;
    hazardPaths.add(normalizedPath);
    hazards.push({
      code: 'symlink-managed-path',
      path: normalizedPath,
      message: `Managed upgrade path is a symbolic link: ${normalizedPath}`,
    });
  }
  async function findSymlinkAncestor(relativePath) {
    if (isPreservedScopePath(relativePath)) return false;
    const parts = relativePath.split(path.sep).filter(Boolean);
    let cursor = path.resolve(projectRoot);
    let cursorRelative = '';
    for (const part of parts) {
      cursor = path.join(cursor, part);
      cursorRelative = path.join(cursorRelative, part);
      const stat = await fs.lstat(cursor).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) return false;
      if (stat.isSymbolicLink()) {
        addHazard(cursorRelative);
        return true;
      }
    }
    return false;
  }
  async function walk(absolutePath, relativePath) {
    if (isPreservedScopePath(relativePath)) return;
    const stat = await fs.lstat(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) {
      addHazard(relativePath);
      return;
    }
    if (!stat.isDirectory()) return;
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      await walk(path.join(absolutePath, entry.name), path.join(relativePath, entry.name));
    }
  }
  for (const scope of await managedScopesForRoot(projectRoot)) {
    if (await findSymlinkAncestor(scope)) continue;
    await walk(path.join(projectRoot, scope), scope);
  }
  return hazards;
}

async function snapshotManagedState(projectRoot) {
  const entries = [];
  async function visit(absolutePath, relativePath) {
    if (isPreservedScopePath(relativePath)) return;
    const stat = await fs.lstat(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return;
    const normalizedPath = normalizeRelativePath(relativePath);
    if (stat.isSymbolicLink()) {
      const error = new Error(`Symbolic link cannot be included in a fleet transaction: ${normalizedPath}`);
      error.code = 'OPEN_VIBECODING_FLEET_SYMLINK_HAZARD';
      throw error;
    }
    if (stat.isDirectory()) {
      entries.push({ path: normalizedPath, type: 'directory', mode: stat.mode & 0o777 });
      const children = await fs.readdir(absolutePath, { withFileTypes: true });
      for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
        await visit(path.join(absolutePath, child.name), path.join(relativePath, child.name));
      }
      return;
    }
    if (stat.isFile()) {
      const contents = await fs.readFile(absolutePath);
      entries.push({
        path: normalizedPath,
        type: 'file',
        mode: stat.mode & 0o777,
        size: contents.byteLength,
        checksum: sha256(contents),
      });
      return;
    }
    const error = new Error(`Unsupported filesystem entry in fleet transaction: ${normalizedPath}`);
    error.code = 'OPEN_VIBECODING_FLEET_UNSUPPORTED_ENTRY';
    throw error;
  }
  for (const scope of await managedScopesForRoot(projectRoot)) await visit(path.join(projectRoot, scope), scope);
  entries.sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type));
  return {
    algorithm: CHECKSUM_ALGORITHM,
    checksum: sha256(JSON.stringify(entries)),
    fileCount: entries.filter((entry) => entry.type === 'file').length,
    directoryCount: entries.filter((entry) => entry.type === 'directory').length,
    entries,
  };
}

async function copyScope(sourceRoot, targetRoot, scope) {
  if (isPreservedScopePath(scope)) return;
  const sourcePath = path.join(sourceRoot, scope);
  const sourceStat = await fs.lstat(sourcePath).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!sourceStat) return;
  const targetPath = path.join(targetRoot, scope);
  if (sourceStat.isSymbolicLink()) {
    const error = new Error(`Symbolic link cannot be copied into a fleet transaction: ${normalizeRelativePath(scope)}`);
    error.code = 'OPEN_VIBECODING_FLEET_SYMLINK_HAZARD';
    throw error;
  }
  if (sourceStat.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true, mode: sourceStat.mode & 0o777 });
    const children = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childScope = path.join(scope, child.name);
      if (isPreservedScopePath(childScope)) continue;
      await copyScope(sourceRoot, targetRoot, childScope);
    }
    return;
  }
  if (!sourceStat.isFile()) {
    const error = new Error(`Unsupported filesystem entry in fleet transaction: ${normalizeRelativePath(scope)}`);
    error.code = 'OPEN_VIBECODING_FLEET_UNSUPPORTED_ENTRY';
    throw error;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.cp(sourcePath, targetPath, {
    force: true,
    errorOnExist: false,
    preserveTimestamps: true,
  });
}

async function copyManagedScopes(sourceRoot, targetRoot) {
  await fs.mkdir(targetRoot, { recursive: true });
  for (const scope of await managedScopesForRoot(sourceRoot)) await copyScope(sourceRoot, targetRoot, scope);
}

async function createPreimageBackup(plan) {
  const payloadRoot = path.join(plan.backup.path, 'preimage');
  await fs.mkdir(plan.backup.path, { recursive: true, mode: 0o700 });
  await fs.chmod(plan.backup.path, 0o700);
  await copyManagedScopes(plan.projectRoot, payloadRoot);
  const backupSnapshot = await snapshotManagedState(payloadRoot);
  if (backupSnapshot.checksum !== plan.preimage.checksum) {
    const error = new Error(`Preimage backup checksum mismatch: expected ${plan.preimage.checksum}, found ${backupSnapshot.checksum}`);
    error.code = 'OPEN_VIBECODING_FLEET_BACKUP_CHECKSUM_MISMATCH';
    throw error;
  }
  const manifest = {
    schema: FLEET_TRANSACTION_SCHEMA,
    version: FLEET_TRANSACTION_VERSION,
    transactionId: plan.transactionId,
    projectRoot: plan.projectRoot,
    action: plan.action,
    versions: plan.versions,
    checksum: plan.checksum,
    scopePolicy: plan.scopePolicy,
    preimage: plan.preimage,
    createdAt: new Date().toISOString(),
  };
  await atomicWriteJson(plan.backup.manifestPath, manifest);
  plan.backup.status = 'verified';
  plan.backup.checksum = backupSnapshot.checksum;
  return manifest;
}

async function restorePreimageBackup(plan, reason) {
  const payloadRoot = path.join(plan.backup.path, 'preimage');
  plan.rollback.attempted = true;
  plan.rollback.reason = reason;
  try {
    const current = await snapshotManagedState(plan.projectRoot);
    const restorePlan = { ...plan, preimage: current };
    const restored = await applyStagedState(restorePlan, payloadRoot, plan.preimage);
    plan.rollback.checksum = restored.checksum;
    plan.rollback.ok = restored.checksum === plan.preimage.checksum;
    if (!plan.rollback.ok) {
      throw new Error(`Rollback checksum mismatch: expected ${plan.preimage.checksum}, found ${restored.checksum}`);
    }
    return restored;
  } catch (error) {
    plan.rollback.ok = false;
    plan.rollback.error = error.message;
    throw error;
  }
}

async function assertPreservedScopesEmpty(projectRoot) {
  async function visit(absolutePath, relativePath, allowDirectory) {
    const stat = await fs.lstat(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!stat) return;
    if (!allowDirectory || !stat.isDirectory() || stat.isSymbolicLink()) {
      const normalizedPath = normalizeRelativePath(relativePath);
      const error = new Error(`Staged fleet mutation wrote into preserved scope: ${normalizedPath}`);
      error.code = 'OPEN_VIBECODING_FLEET_PRESERVED_SCOPE_MUTATION';
      throw error;
    }
    const children = await fs.readdir(absolutePath, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      await visit(path.join(absolutePath, child.name), path.join(relativePath, child.name), child.isDirectory() && !child.isSymbolicLink());
    }
  }
  for (const scope of await preservedScopesForRoot(projectRoot)) {
    await visit(path.join(projectRoot, scope), scope, true);
  }
}

async function assertNoSymlinkAncestor(projectRoot, relativePath) {
  const resolvedRoot = path.resolve(projectRoot);
  const target = path.resolve(projectRoot, relativePath);
  const relation = path.relative(resolvedRoot, target);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    const error = new Error(`Fleet transaction path escapes project root: ${relativePath}`);
    error.code = 'OPEN_VIBECODING_FLEET_PATH_ESCAPE';
    throw error;
  }
  const parts = relation.split(path.sep).filter(Boolean);
  let cursor = resolvedRoot;
  for (const part of parts.slice(0, -1)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stat?.isSymbolicLink()) {
      const error = new Error(`Symbolic link ancestor appeared during fleet transaction: ${path.relative(projectRoot, cursor)}`);
      error.code = 'OPEN_VIBECODING_FLEET_SYMLINK_ANCESTOR';
      throw error;
    }
  }
}

async function atomicReplaceFileFromSource(sourcePath, targetPath, mode) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.fleet.tmp`);
  try {
    await fs.copyFile(sourcePath, temporaryPath);
    await fs.chmod(temporaryPath, mode ?? 0o600);
    const handle = await fs.open(temporaryPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function entryMap(snapshot) {
  return new Map(snapshot.entries.map((entry) => [entry.path, entry]));
}

async function applyStagedState(plan, stagingRoot, stagedSnapshot, options = {}) {
  const currentSnapshot = await snapshotManagedState(plan.projectRoot);
  if (currentSnapshot.checksum !== plan.preimage.checksum) {
    const error = new Error(`Project changed after planning: expected ${plan.preimage.checksum}, found ${currentSnapshot.checksum}`);
    error.code = 'OPEN_VIBECODING_FLEET_PREIMAGE_CONFLICT';
    throw error;
  }
  if (options.beforeApply) await options.beforeApply({ plan, stagingRoot, stagedSnapshot });
  const compareSnapshot = await snapshotManagedState(plan.projectRoot);
  if (compareSnapshot.checksum !== plan.preimage.checksum) {
    const error = new Error(`Project changed before atomic apply: expected ${plan.preimage.checksum}, found ${compareSnapshot.checksum}`);
    error.code = 'OPEN_VIBECODING_FLEET_PREIMAGE_CONFLICT';
    throw error;
  }

  const beforeByPath = entryMap(plan.preimage);
  const afterByPath = entryMap(stagedSnapshot);
  const typeChanges = stagedSnapshot.entries
    .filter((entry) => beforeByPath.has(entry.path) && beforeByPath.get(entry.path).type !== entry.type)
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
  for (const entry of typeChanges) {
    await assertNoSymlinkAncestor(plan.projectRoot, entry.path);
    await fs.rm(path.join(plan.projectRoot, entry.path), { recursive: true, force: true });
  }
  const directoriesToCreate = stagedSnapshot.entries
    .filter((entry) => entry.type === 'directory' && beforeByPath.get(entry.path)?.type !== 'directory')
    .sort((left, right) => left.path.split('/').length - right.path.split('/').length);
  for (const entry of directoriesToCreate) {
    await assertNoSymlinkAncestor(plan.projectRoot, entry.path);
    await fs.mkdir(path.join(plan.projectRoot, entry.path), { recursive: true, mode: entry.mode });
  }
  const directoriesToChmod = stagedSnapshot.entries.filter((entry) => {
    const before = beforeByPath.get(entry.path);
    return entry.type === 'directory' && before?.type === 'directory' && before.mode !== entry.mode;
  });
  for (const entry of directoriesToChmod) {
    await fs.chmod(path.join(plan.projectRoot, entry.path), entry.mode);
  }
  const filesToWrite = stagedSnapshot.entries.filter((entry) => {
    if (entry.type !== 'file') return false;
    const before = beforeByPath.get(entry.path);
    return !before || before.type !== 'file' || before.checksum !== entry.checksum || before.mode !== entry.mode;
  });
  for (const entry of filesToWrite) {
    await assertNoSymlinkAncestor(plan.projectRoot, entry.path);
    await atomicReplaceFileFromSource(path.join(stagingRoot, entry.path), path.join(plan.projectRoot, entry.path), entry.mode);
  }
  const filesToRemove = plan.preimage.entries
    .filter((entry) => entry.type === 'file' && !afterByPath.has(entry.path))
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
  for (const entry of filesToRemove) {
    await assertNoSymlinkAncestor(plan.projectRoot, entry.path);
    await fs.rm(path.join(plan.projectRoot, entry.path), { force: true });
  }
  const directoriesToRemove = plan.preimage.entries
    .filter((entry) => entry.type === 'directory' && !afterByPath.has(entry.path))
    .sort((left, right) => right.path.split('/').length - left.path.split('/').length);
  for (const entry of directoriesToRemove) {
    await fs.rmdir(path.join(plan.projectRoot, entry.path)).catch((error) => {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
    });
  }
  const appliedSnapshot = await snapshotManagedState(plan.projectRoot);
  if (appliedSnapshot.checksum !== stagedSnapshot.checksum) {
    const error = new Error(`Atomic apply checksum mismatch: expected ${stagedSnapshot.checksum}, found ${appliedSnapshot.checksum}`);
    error.code = 'OPEN_VIBECODING_FLEET_APPLY_CHECKSUM_MISMATCH';
    throw error;
  }
  return appliedSnapshot;
}

async function relocateStagingPaths(stagingRoot, stagingHome, projectRoot, openprdHome) {
  const replacements = [[stagingRoot, projectRoot], [stagingHome, openprdHome]]
    .filter(([from, to]) => from && to && from !== to);
  if (replacements.length === 0) return;
  const snapshot = await snapshotManagedState(stagingRoot);
  for (const entry of snapshot.entries.filter((item) => item.type === 'file')) {
    const filePath = path.join(stagingRoot, entry.path);
    const buffer = await fs.readFile(filePath);
    if (buffer.includes(0)) continue;
    const current = buffer.toString('utf8');
    let next = current;
    for (const [from, to] of replacements) next = next.split(from).join(to);
    if (next !== current) await atomicWriteText(filePath, next, { mode: entry.mode });
  }
  const manifestPath = path.join(stagingRoot, '.open-vibecoding', 'harness', 'install-manifest.json');
  const manifest = await fs.readFile(manifestPath, 'utf8').then(JSON.parse).catch(() => null);
  if (!manifest?.managedFiles) return;
  let changed = false;
  for (const managedFile of manifest.managedFiles) {
    if (!managedFile?.fileChecksum || managedFile.scope === 'user') continue;
    const text = await fs.readFile(path.join(stagingRoot, managedFile.path), 'utf8').catch(() => null);
    if (text === null) continue;
    const nextChecksum = sha256(text).slice(0, 16);
    if (managedFile.fileChecksum !== nextChecksum) {
      managedFile.fileChecksum = nextChecksum;
      changed = true;
    }
  }
  if (changed) await atomicWriteJson(manifestPath, manifest);
}

export {
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
};
