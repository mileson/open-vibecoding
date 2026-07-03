import fs from 'node:fs/promises';
import path from 'node:path';
import {
  LEGACY_OPENPRD_ACCEPTED_SPEC_ROOT,
  LEGACY_OPENPRD_ARCHIVE_CHANGE_ROOT,
  LEGACY_OPENPRD_CHANGE_ROOT,
  OPENPRD_ACCEPTED_SPEC_ROOT,
  OPENPRD_ARCHIVE_CHANGE_ROOT,
  OPENPRD_CHANGE_ROOT,
} from './constants.js';

function cjoin(...parts) {
  return path.join(...parts);
}

async function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

function relativeProjectPath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath) || '.';
}

async function removeDirectoryIfEmpty(dirPath) {
  const entries = await fs.readdir(dirPath).catch(() => null);
  if (entries && entries.length === 0) {
    await fs.rmdir(dirPath);
    return true;
  }
  return false;
}

async function sameFileContent(leftPath, rightPath) {
  const [left, right] = await Promise.all([
    fs.readFile(leftPath),
    fs.readFile(rightPath),
  ]);
  return left.equals(right);
}

async function movePath(sourcePath, targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error;
    }
    const stat = await fs.stat(sourcePath);
    await fs.cp(sourcePath, targetPath, { recursive: stat.isDirectory(), force: false, errorOnExist: true });
    await fs.rm(sourcePath, { recursive: stat.isDirectory(), force: true });
  }
}

async function mergeLegacyTree(projectRoot, sourcePath, targetPath, changes) {
  const sourceStat = await fs.stat(sourcePath).catch(() => null);
  if (!sourceStat) {
    return { migrated: 0, conflicts: 0 };
  }

  const targetStat = await fs.stat(targetPath).catch(() => null);
  if (!targetStat) {
    await movePath(sourcePath, targetPath);
    changes.push({
      path: relativeProjectPath(projectRoot, targetPath),
      from: relativeProjectPath(projectRoot, sourcePath),
      status: 'migrated',
    });
    return { migrated: 1, conflicts: 0 };
  }

  if (sourceStat.isDirectory() && targetStat.isDirectory()) {
    let migrated = 0;
    let conflicts = 0;
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
      const sourceChild = cjoin(sourcePath, entry.name);
      const targetChild = cjoin(targetPath, entry.name);
      const result = await mergeLegacyTree(projectRoot, sourceChild, targetChild, changes);
      migrated += result.migrated;
      conflicts += result.conflicts;
    }
    if (await removeDirectoryIfEmpty(sourcePath)) {
      changes.push({
        path: relativeProjectPath(projectRoot, sourcePath),
        status: 'removed-empty-legacy-dir',
      });
    }
    return { migrated, conflicts };
  }

  if (sourceStat.isFile() && targetStat.isFile() && await sameFileContent(sourcePath, targetPath)) {
    await fs.rm(sourcePath, { force: true });
    changes.push({
      path: relativeProjectPath(projectRoot, sourcePath),
      target: relativeProjectPath(projectRoot, targetPath),
      status: 'removed-duplicate-legacy-file',
    });
    return { migrated: 0, conflicts: 0 };
  }

  changes.push({
    path: relativeProjectPath(projectRoot, sourcePath),
    target: relativeProjectPath(projectRoot, targetPath),
    status: 'conflict-kept-legacy',
  });
  return { migrated: 0, conflicts: 1 };
}

export async function hasLegacyOpenPrdArtifacts(projectRoot) {
  const roots = [
    cjoin(projectRoot, ...LEGACY_OPENPRD_CHANGE_ROOT),
    cjoin(projectRoot, ...LEGACY_OPENPRD_ACCEPTED_SPEC_ROOT),
    cjoin(projectRoot, ...LEGACY_OPENPRD_ARCHIVE_CHANGE_ROOT),
  ];
  for (const root of roots) {
    if (await exists(root)) {
      return true;
    }
  }
  return false;
}

export async function migrateLegacyOpenPrdArtifacts(projectRoot) {
  const legacyRoot = cjoin(projectRoot, 'openprd');
  const changes = [];
  let migrated = 0;
  let conflicts = 0;

  const pairs = [
    [LEGACY_OPENPRD_CHANGE_ROOT, OPENPRD_CHANGE_ROOT],
    [LEGACY_OPENPRD_ACCEPTED_SPEC_ROOT, OPENPRD_ACCEPTED_SPEC_ROOT],
    [LEGACY_OPENPRD_ARCHIVE_CHANGE_ROOT, OPENPRD_ARCHIVE_CHANGE_ROOT],
  ];

  for (const [legacyParts, targetParts] of pairs) {
    const result = await mergeLegacyTree(
      projectRoot,
      cjoin(projectRoot, ...legacyParts),
      cjoin(projectRoot, ...targetParts),
      changes,
    );
    migrated += result.migrated;
    conflicts += result.conflicts;
  }

  if (await exists(legacyRoot)) {
    await removeDirectoryIfEmpty(cjoin(legacyRoot, 'archive')).catch(() => false);
    if (await removeDirectoryIfEmpty(legacyRoot).catch(() => false)) {
      changes.push({ path: 'openprd', status: 'removed-empty-legacy-root' });
    } else if (changes.length > 0) {
      changes.push({ path: 'openprd', status: 'legacy-root-kept-nonempty' });
    }
  }

  return {
    ok: conflicts === 0,
    action: 'migrate-legacy-openprd-artifacts',
    projectRoot,
    migrated,
    conflicts,
    changed: changes.length > 0,
    changes,
    errors: conflicts > 0
      ? ['旧 openprd 目录中存在与 .openprd 目标路径同名但内容不同的文件，已保留旧文件等待人工处理。']
      : [],
  };
}
