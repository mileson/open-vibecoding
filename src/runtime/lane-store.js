/*
 * ## 核心功能
 * 以原子文件替换和跨进程目录锁持久化 Lane，并提供 lane revision 的 CAS 事务。
 *
 * ## 输入
 * 接收 runtime 根目录、lane schema、expectedRevision 与事务更新函数。
 *
 * ## 输出
 * 导出 LaneStore，提供 create/ensure/read/list/save/transact 等零依赖存储 API。
 *
 * ## 定位
 * 位于 runtime 持久化层；负责原子性与 lane 级串行化，不解释任务租约或 write-set 语义。
 *
 * ## 依赖
 * 使用 Node.js fs/path/crypto 与同目录 lane-schema、errors 模块。
 *
 * ## 维护规则
 * 禁止改回直接覆盖目标 JSON；任何 read-modify-write 必须持有同一 lane lock 并执行 revision 校验。
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { OpenPrdRuntimeError, revisionConflictError } from './errors.js';
import { assertLaneState, createLaneState, isoTime, normalizeRuntimeId } from './lane-schema.js';

function clone(value) {
  return structuredClone(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function laneFileToken(laneId) {
  return Buffer.from(laneId, 'utf8').toString('base64url');
}

async function fileExists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function atomicWriteJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  const handle = await fs.open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export class LaneStore {
  constructor(rootDir, options = {}) {
    if (!rootDir) throw new TypeError('OpenPrd LaneStore requires a root directory.');
    this.rootDir = path.resolve(rootDir);
    this.lanesDir = path.join(this.rootDir, 'lanes');
    this.clock = options.clock ?? { now: () => Date.now() };
    this.lockTimeoutMs = Number(options.lockTimeoutMs ?? 15_000);
    this.lockRetryMs = Math.max(1, Number(options.lockRetryMs ?? 2));
    this.lockStaleMs = Math.max(this.lockTimeoutMs * 2, Number(options.lockStaleMs ?? 60_000));
  }

  lanePath(laneIdValue) {
    const laneId = normalizeRuntimeId(laneIdValue, 'laneId');
    return path.join(this.lanesDir, `${laneFileToken(laneId)}.json`);
  }

  lockPath(laneId) {
    return `${this.lanePath(laneId)}.lock`;
  }

  now() {
    return isoTime(this.clock.now());
  }

  async read(laneId) {
    const normalizedId = normalizeRuntimeId(laneId, 'laneId');
    const value = await readJson(this.lanePath(normalizedId));
    return clone(assertLaneState(value, normalizedId));
  }

  async readOrNull(laneId) {
    return this.read(laneId).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
  }

  async list() {
    const entries = await fs.readdir(this.lanesDir, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
    const lanes = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const value = await readJson(path.join(this.lanesDir, entry.name));
      lanes.push(clone(assertLaneState(value)));
    }
    return lanes.sort((left, right) => left.laneId.localeCompare(right.laneId));
  }

  async create(input) {
    const initial = createLaneState(input, this.clock.now());
    return this.#withLock(initial.laneId, async () => {
      const current = await this.#readUnlocked(initial.laneId);
      if (current) {
        throw revisionConflictError({
          laneId: initial.laneId,
          expectedRevision: -1,
          actualRevision: current.revision,
          operation: 'create-lane',
        });
      }
      await atomicWriteJson(this.lanePath(initial.laneId), initial);
      return clone(initial);
    });
  }

  async ensure(input) {
    const initial = createLaneState(input, this.clock.now());
    return this.#withLock(initial.laneId, async () => {
      const current = await this.#readUnlocked(initial.laneId);
      if (current) return { created: false, lane: clone(current) };
      await atomicWriteJson(this.lanePath(initial.laneId), initial);
      return { created: true, lane: clone(initial) };
    });
  }

  async save(laneValue, options = {}) {
    const lane = clone(assertLaneState(laneValue));
    return this.#withLock(lane.laneId, async () => {
      const current = await this.#readUnlocked(lane.laneId);
      const actualRevision = current?.revision ?? -1;
      const expectedRevision = options.expectedRevision ?? lane.revision;
      if (expectedRevision !== actualRevision) {
        throw revisionConflictError({
          laneId: lane.laneId,
          expectedRevision,
          actualRevision,
          operation: 'save-lane',
        });
      }
      lane.revision = actualRevision + 1;
      lane.createdAt = current?.createdAt ?? lane.createdAt ?? this.now();
      lane.updatedAt = this.now();
      assertLaneState(lane, lane.laneId);
      await atomicWriteJson(this.lanePath(lane.laneId), lane);
      return clone(lane);
    });
  }

  async transact(laneIdValue, options, mutate) {
    const laneId = normalizeRuntimeId(laneIdValue, 'laneId');
    const transactionOptions = typeof options === 'function' ? {} : (options ?? {});
    const mutator = typeof options === 'function' ? options : mutate;
    if (typeof mutator !== 'function') throw new TypeError('OpenPrd LaneStore transaction requires a mutator function.');

    return this.#withLock(laneId, async () => {
      const current = await this.#readUnlocked(laneId);
      if (!current) {
        const error = new Error(`OpenPrd lane not found: ${laneId}`);
        error.code = 'ENOENT';
        throw error;
      }
      if (transactionOptions.expectedRevision !== undefined
        && transactionOptions.expectedRevision !== current.revision) {
        throw revisionConflictError({
          laneId,
          expectedRevision: transactionOptions.expectedRevision,
          actualRevision: current.revision,
          operation: transactionOptions.operation ?? 'lane-transaction',
        });
      }

      const draft = clone(current);
      const outcome = await mutator(draft, clone(current));
      if (outcome?.changed === false) {
        return { changed: false, lane: clone(current), result: clone(outcome.result) };
      }
      draft.revision = current.revision + 1;
      draft.updatedAt = this.now();
      assertLaneState(draft, laneId);
      await atomicWriteJson(this.lanePath(laneId), draft);
      return {
        changed: true,
        lane: clone(draft),
        result: clone(outcome?.result),
      };
    });
  }

  async #readUnlocked(laneId) {
    const filePath = this.lanePath(laneId);
    if (!await fileExists(filePath)) return null;
    return assertLaneState(await readJson(filePath), laneId);
  }

  async #withLock(laneId, operation) {
    await fs.mkdir(this.lanesDir, { recursive: true });
    const lockPath = this.lockPath(laneId);
    const owner = {
      token: crypto.randomUUID(),
      pid: process.pid,
      createdAt: new Date().toISOString(),
    };
    const startedAt = Date.now();

    while (true) {
      try {
        await fs.mkdir(lockPath);
        await fs.writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify(owner)}\n`, 'utf8');
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await this.#recoverAbandonedLock(lockPath);
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new OpenPrdRuntimeError(
            'OPENPRD_RUNTIME_LOCK_TIMEOUT',
            `Timed out waiting for OpenPrd lane lock ${laneId}.`,
            { laneId, lockPath, timeoutMs: this.lockTimeoutMs },
          );
        }
        await sleep(this.lockRetryMs + Math.floor(Math.random() * this.lockRetryMs));
      }
    }

    try {
      return await operation();
    } finally {
      const recordedOwner = await readJson(path.join(lockPath, 'owner.json')).catch(() => null);
      if (recordedOwner?.token === owner.token) {
        await fs.rm(lockPath, { recursive: true, force: true });
      }
    }
  }

  async #recoverAbandonedLock(lockPath) {
    const stat = await fs.stat(lockPath).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < this.lockStaleMs) return false;
    const owner = await readJson(path.join(lockPath, 'owner.json')).catch(() => null);
    if (owner && pidIsAlive(owner.pid)) return false;
    const quarantinePath = `${lockPath}.abandoned.${crypto.randomUUID()}`;
    try {
      await fs.rename(lockPath, quarantinePath);
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    await fs.rm(quarantinePath, { recursive: true, force: true });
    return true;
  }
}

export { atomicWriteJson };
