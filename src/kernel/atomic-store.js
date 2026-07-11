import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

class AtomicStoreConflictError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AtomicStoreConflictError';
    this.code = 'OPENPRD_ATOMIC_STORE_CONFLICT';
    Object.assign(this, details);
  }
}

class AtomicStoreLockTimeoutError extends Error {
  constructor(lockPath, timeoutMs) {
    super(`Timed out after ${timeoutMs}ms waiting for lock ${lockPath}`);
    this.name = 'AtomicStoreLockTimeoutError';
    this.code = 'OPENPRD_LOCK_TIMEOUT';
    this.lockPath = lockPath;
    this.timeoutMs = timeoutMs;
  }
}

class JsonlCorruptionError extends Error {
  constructor(filePath, line, cause) {
    super(`JSONL corruption in ${filePath} at line ${line}: ${cause.message}`);
    this.name = 'JsonlCorruptionError';
    this.code = 'OPENPRD_JSONL_CORRUPTION';
    this.filePath = filePath;
    this.line = line;
    this.cause = cause;
  }
}

function timeValue(clock = () => new Date()) {
  const value = clock();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function fileExists(filePath) {
  return fs.access(filePath).then(() => true, () => false);
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicWriteText(filePath, text, options = {}) {
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await fs.open(temporaryPath, 'wx', options.mode ?? 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporaryPath, filePath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicWriteJson(filePath, value, options = {}) {
  const serialized = JSON.stringify(value, null, options.indent ?? 2);
  if (serialized === undefined) throw new TypeError('atomicWriteJson value must be JSON-serializable');
  await atomicWriteText(filePath, `${serialized}\n`, options);
  return value;
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function isStaleLock(lockPath, staleLockMs, now) {
  try {
    const [stat, raw] = await Promise.all([
      fs.stat(lockPath),
      fs.readFile(lockPath, 'utf8').catch(() => ''),
    ]);
    let recordedAt = Number.NaN;
    try {
      recordedAt = Date.parse(JSON.parse(raw).createdAt);
    } catch {
      // A truncated lock is judged by its filesystem timestamp.
    }
    const newestTimestamp = Math.max(stat.mtimeMs, Number.isNaN(recordedAt) ? 0 : recordedAt);
    return now.getTime() - newestTimestamp > staleLockMs;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function releaseOwnedLock(lockPath, token) {
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    return;
  }
  if (lock.token === token) await fs.rm(lockPath, { force: true });
}

async function withFileLock(lockPath, operation, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const staleLockMs = options.staleLockMs ?? 30_000;
  const retryDelayMs = options.retryDelayMs ?? 10;
  const clock = options.clock ?? (() => new Date());
  const token = options.token ?? `${process.pid}:${randomUUID()}`;
  const startedAt = Date.now();
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  while (true) {
    let handle;
    let created = false;
    try {
      handle = await fs.open(lockPath, 'wx', 0o600);
      created = true;
      await handle.writeFile(`${JSON.stringify({
        token,
        pid: process.pid,
        createdAt: timeValue(clock).toISOString(),
      })}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      break;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (created) await fs.rm(lockPath, { force: true }).catch(() => {});
      if (error.code !== 'EEXIST') throw error;
      const now = timeValue(clock);
      if (await isStaleLock(lockPath, staleLockMs, now)) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() - startedAt >= timeoutMs) throw new AtomicStoreLockTimeoutError(lockPath, timeoutMs);
      await delay(retryDelayMs);
    }
  }

  try {
    return await operation({ token, lockPath });
  } finally {
    await releaseOwnedLock(lockPath, token);
  }
}

async function compareAndSwapJson(filePath, options = {}) {
  const revisionField = options.revisionField ?? 'revision';
  const expectedRevision = options.expectedRevision ?? 0;
  const lockPath = options.lockPath ?? `${filePath}.lock`;
  return withFileLock(lockPath, async () => {
    const currentValue = await readJsonIfExists(filePath, null);
    const actualRevision = currentValue === null ? 0 : currentValue?.[revisionField];
    if (!Number.isSafeInteger(actualRevision) || actualRevision < 0) {
      throw new AtomicStoreConflictError(`Stored revision at ${filePath} is invalid`, {
        filePath,
        expectedRevision,
        actualRevision,
      });
    }
    if (actualRevision !== expectedRevision) {
      throw new AtomicStoreConflictError(
        `Revision conflict at ${filePath}: expected ${expectedRevision}, found ${actualRevision}`,
        { filePath, expectedRevision, actualRevision, currentValue },
      );
    }
    const nextValue = typeof options.nextValue === 'function'
      ? await options.nextValue(currentValue)
      : options.nextValue;
    if (nextValue === undefined) throw new TypeError('compareAndSwapJson requires nextValue');
    await atomicWriteJson(filePath, nextValue, options);
    return { previousValue: currentValue, value: nextValue };
  }, options);
}

function parseJsonl(filePath, text) {
  const records = [];
  const endsWithNewline = text.endsWith('\n');
  const lines = text.split('\n');
  let characterOffset = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const physicalLine = lines[index];
    const line = physicalLine.endsWith('\r') ? physicalLine.slice(0, -1) : physicalLine;
    const lineCharacterLength = physicalLine.length + (index < lines.length - 1 ? 1 : 0);
    if (line.trim()) {
      try {
        records.push(JSON.parse(line));
      } catch (error) {
        const isIncompleteTail = !endsWithNewline && index === lines.length - 1;
        if (!isIncompleteTail) throw new JsonlCorruptionError(filePath, index + 1, error);
        return {
          records,
          cleanText: text.slice(0, characterOffset),
          recovered: true,
          recoveredBytes: Buffer.byteLength(text.slice(characterOffset), 'utf8'),
          missingFinalNewline: false,
        };
      }
    }
    characterOffset += lineCharacterLength;
  }
  return {
    records,
    cleanText: text,
    recovered: Boolean(text) && !endsWithNewline,
    recoveredBytes: 0,
    missingFinalNewline: Boolean(text) && !endsWithNewline,
  };
}

async function readJsonlRecovered(filePath, options = {}) {
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { records: [], recovered: false, recoveredBytes: 0, repaired: false };
    }
    throw error;
  }
  const result = parseJsonl(filePath, text);
  let repaired = false;
  if (options.repair && result.recovered) {
    const repairedText = result.cleanText
      ? `${result.cleanText.replace(/\n?$/, '\n')}`
      : '';
    await atomicWriteText(filePath, repairedText, options);
    repaired = true;
  }
  return {
    records: result.records,
    recovered: result.recovered,
    recoveredBytes: result.recoveredBytes,
    repaired,
  };
}

async function recoverJsonlTail(filePath, options = {}) {
  return readJsonlRecovered(filePath, { ...options, repair: true });
}

async function appendJsonlAtomic(filePath, value, options = {}) {
  const lockPath = options.lockPath ?? `${filePath}.lock`;
  return withFileLock(lockPath, async () => {
    await recoverJsonlTail(filePath, options);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError('appendJsonlAtomic value must be JSON-serializable');
    const handle = await fs.open(filePath, 'a', options.mode ?? 0o600);
    try {
      await handle.writeFile(`${serialized}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return value;
  }, options);
}

export {
  AtomicStoreConflictError,
  AtomicStoreLockTimeoutError,
  JsonlCorruptionError,
  appendJsonlAtomic,
  atomicWriteJson,
  atomicWriteText,
  compareAndSwapJson,
  fileExists,
  readJsonIfExists,
  readJsonlRecovered,
  recoverJsonlTail,
  withFileLock,
};
