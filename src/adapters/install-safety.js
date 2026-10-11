import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const INSTALL_SAFETY_PROTOCOL_VERSION = 1;
const SUPPORTED_SYMLINK_STRATEGIES = new Set(['block', 'materialize']);

class UnsafeManagedWriteError extends Error {
  constructor(targetPath, symlink, strategy = 'block') {
    const resolved = symlink.resolvedTarget ? ` -> ${symlink.resolvedTarget}` : '';
    super(
      `Refusing to write ${targetPath}: managed write path crosses symlink ${symlink.path}${resolved}. `
      + `Use symlinkStrategy=materialize with a trusted installSafetyBackupRoot to snapshot and replace the link before writing.`,
    );
    this.name = 'UnsafeManagedWriteError';
    this.code = 'OPEN_VIBECODING_UNSAFE_MANAGED_WRITE_SYMLINK';
    this.targetPath = targetPath;
    this.symlinkPath = symlink.path;
    this.linkTarget = symlink.linkTarget;
    this.resolvedTarget = symlink.resolvedTarget;
    this.strategy = strategy;
    this.repairHint = 'Choose a physical destination, or rerun with symlinkStrategy=materialize and a trusted backup root.';
  }
}

function normalizeSymlinkStrategy(value) {
  const strategy = String(value ?? 'block').trim().toLowerCase() || 'block';
  if (!SUPPORTED_SYMLINK_STRATEGIES.has(strategy)) {
    throw new Error(`Unsupported managed-write symlink strategy: ${value}. Use block or materialize.`);
  }
  return strategy;
}

async function lstatOrNull(filePath) {
  return fs.lstat(filePath).catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
}

function isWithinRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function managedRootForTarget(targetPath, options = {}) {
  const configured = Array.isArray(options.managedWriteRoots)
    ? options.managedWriteRoots
    : [options.projectRoot].filter(Boolean);
  return configured
    .map((root) => path.resolve(root))
    .filter((root) => isWithinRoot(root, targetPath))
    .sort((left, right) => right.length - left.length)[0] ?? null;
}

async function findFirstSymlink(targetPath, options = {}) {
  const absoluteTarget = path.resolve(targetPath);
  const managedRoot = managedRootForTarget(absoluteTarget, options);
  const parsed = path.parse(absoluteTarget);
  const scanRoot = managedRoot ?? parsed.root;
  const rootStat = managedRoot ? await lstatOrNull(scanRoot) : null;
  if (rootStat?.isSymbolicLink()) {
    const linkTarget = await fs.readlink(scanRoot);
    const resolvedTarget = await fs.realpath(scanRoot).catch(() => path.resolve(path.dirname(scanRoot), linkTarget));
    return {
      path: scanRoot,
      linkTarget,
      resolvedTarget,
      dangling: !(await lstatOrNull(resolvedTarget)),
    };
  }
  if (managedRoot && !rootStat) return null;
  const parts = path.relative(scanRoot, absoluteTarget).split(path.sep).filter(Boolean);
  let cursor = scanRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = await lstatOrNull(cursor);
    if (!stat) return null;
    if (!stat.isSymbolicLink()) continue;
    const linkTarget = await fs.readlink(cursor);
    const resolvedTarget = await fs.realpath(cursor).catch(() => path.resolve(path.dirname(cursor), linkTarget));
    return {
      path: cursor,
      linkTarget,
      resolvedTarget,
      dangling: !(await lstatOrNull(resolvedTarget)),
    };
  }
  return null;
}

async function resolveBackupRoot(options = {}) {
  if (options.installSafetyBackupRoot) {
    return path.resolve(options.installSafetyBackupRoot);
  }
  const physicalTemp = await fs.realpath(os.tmpdir()).catch(() => path.resolve(os.tmpdir()));
  return path.join(physicalTemp, 'open-vibecoding-install-safety', String(process.pid));
}

function backupEntryName(symlinkPath) {
  const digest = crypto.createHash('sha256').update(symlinkPath).digest('hex').slice(0, 12);
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  return `${path.basename(symlinkPath) || 'root'}-${digest}-${suffix}`;
}

async function copyPath(sourcePath, destinationPath, stat) {
  if (stat.isDirectory()) {
    await fs.cp(sourcePath, destinationPath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    return 'directory';
  }
  if (stat.isFile()) {
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
    return 'file';
  }
  throw new Error(`Cannot materialize unsupported symlink target type at ${sourcePath}.`);
}

async function materializeSymlink(targetPath, symlink, options = {}) {
  const backupRoot = await resolveBackupRoot(options);
  const backupSymlink = await findFirstSymlink(backupRoot);
  if (backupSymlink) {
    throw new UnsafeManagedWriteError(backupRoot, backupSymlink, 'block');
  }
  await fs.mkdir(backupRoot, { recursive: true });

  const backupDir = path.join(backupRoot, backupEntryName(symlink.path));
  await fs.mkdir(backupDir, { recursive: false });
  const snapshotPath = path.join(backupDir, 'snapshot');
  const targetStat = symlink.dangling ? null : await lstatOrNull(symlink.resolvedTarget);
  const isDirectTarget = path.resolve(targetPath) === path.resolve(symlink.path);
  if (targetStat?.isFile() && !isDirectTarget) {
    throw new Error(`Cannot materialize ${symlink.path}: it resolves to a file but is an ancestor of ${targetPath}.`);
  }

  let materializedType = isDirectTarget
    ? (options.managedWriteTargetType ?? 'file')
    : 'directory';
  if (targetStat) {
    materializedType = await copyPath(symlink.resolvedTarget, snapshotPath, targetStat);
  }

  const metadata = {
    protocolVersion: INSTALL_SAFETY_PROTOCOL_VERSION,
    createdAt: new Date().toISOString(),
    targetPath: path.resolve(targetPath),
    symlinkPath: symlink.path,
    linkTarget: symlink.linkTarget,
    resolvedTarget: symlink.resolvedTarget,
    dangling: symlink.dangling,
    directTarget: isDirectTarget,
    materializedType,
    snapshotPath: targetStat ? snapshotPath : null,
  };
  await fs.writeFile(path.join(backupDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');

  const stagingPath = path.join(
    path.dirname(symlink.path),
    `.${path.basename(symlink.path)}.open-vibecoding-materialize-${crypto.randomBytes(6).toString('hex')}`,
  );
  if (targetStat) {
    await copyPath(snapshotPath, stagingPath, targetStat);
  } else if (!isDirectTarget) {
    await fs.mkdir(stagingPath, { recursive: false });
  }

  const currentStat = await lstatOrNull(symlink.path);
  if (!currentStat?.isSymbolicLink() || await fs.readlink(symlink.path) !== symlink.linkTarget) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Symlink changed while preparing managed write: ${symlink.path}.`);
  }
  await fs.unlink(symlink.path);
  if (targetStat || !isDirectTarget) {
    await fs.rename(stagingPath, symlink.path);
  }

  const event = {
    protocolVersion: INSTALL_SAFETY_PROTOCOL_VERSION,
    strategy: 'materialize',
    targetPath: path.resolve(targetPath),
    symlinkPath: symlink.path,
    linkTarget: symlink.linkTarget,
    resolvedTarget: symlink.resolvedTarget,
    backupPath: backupDir,
    materializedType,
    at: metadata.createdAt,
  };
  if (Array.isArray(options.installSafetyEvents)) {
    options.installSafetyEvents.push(event);
  }
  return event;
}

async function prepareManagedWriteTarget(targetPath, options = {}) {
  const absoluteTarget = path.resolve(targetPath);
  const strategy = normalizeSymlinkStrategy(options.symlinkStrategy);
  const materializations = [];
  for (let index = 0; index < 32; index += 1) {
    const symlink = await findFirstSymlink(absoluteTarget, options);
    if (!symlink) {
      return {
        ok: true,
        protocolVersion: INSTALL_SAFETY_PROTOCOL_VERSION,
        strategy,
        targetPath: absoluteTarget,
        materializations,
      };
    }
    if (strategy === 'block') {
      throw new UnsafeManagedWriteError(absoluteTarget, symlink, strategy);
    }
    materializations.push(await materializeSymlink(absoluteTarget, symlink, options));
  }
  throw new Error(`Managed write path contains too many nested symlinks: ${absoluteTarget}.`);
}

async function safeEnsureDirectory(directoryPath, options = {}) {
  await prepareManagedWriteTarget(directoryPath, { ...options, managedWriteTargetType: 'directory' });
  await fs.mkdir(directoryPath, { recursive: true });
}

async function safeWriteText(filePath, text, options = {}) {
  await prepareManagedWriteTarget(filePath, { ...options, managedWriteTargetType: 'file' });
  await safeEnsureDirectory(path.dirname(filePath), options);
  await fs.writeFile(filePath, text, 'utf8');
}

async function safeAppendText(filePath, text, options = {}) {
  await prepareManagedWriteTarget(filePath, { ...options, managedWriteTargetType: 'file' });
  await safeEnsureDirectory(path.dirname(filePath), options);
  await fs.appendFile(filePath, text, 'utf8');
}

export {
  INSTALL_SAFETY_PROTOCOL_VERSION,
  UnsafeManagedWriteError,
  findFirstSymlink,
  normalizeSymlinkStrategy,
  prepareManagedWriteTarget,
  safeAppendText,
  safeEnsureDirectory,
  safeWriteText,
};
