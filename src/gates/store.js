/*
 * 核心功能
 * 原子持久化 scoped Gate、Evidence、Approval 与 Decision，并在同一锁内消费一次性审批。
 *
 * 输入
 * 接收已规范化的门禁记录和 evaluate 请求。
 *
 * 输出
 * 提供 record/list/evaluate API；所有状态保存在项目 `.open-vibecoding/gates/state.json`。
 *
 * 定位
 * 位于纯策略与 CLI/高风险操作之间，负责本地单项目并发一致性。
 *
 * 维护规则
 * 相同 ID 不同内容必须冲突；消费审批和写入 decision 必须在同一文件锁事务中完成。
 */

import path from 'node:path';
import { atomicWriteJson, readJsonIfExists, withFileLock } from '../kernel/atomic-store.js';
import { canonicalJson } from '../kernel/event-envelope.js';
import {
  createApprovalRecord,
  createEvidenceRecord,
  createGateDefinition,
  evaluateScopedGate,
} from './scoped-gates.js';

const GATE_STORE_SCHEMA_VERSION = 1;

function gateStorePath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.open-vibecoding', 'gates', 'state.json');
}

function emptyState() {
  return {
    schemaVersion: GATE_STORE_SCHEMA_VERSION,
    revision: 0,
    gates: {},
    evidence: {},
    approvals: {},
    decisions: [],
  };
}

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function openGateStore(projectRoot, options = {}) {
  const filePath = gateStorePath(projectRoot);
  const lockPath = `${filePath}.lock`;

  async function read() {
    return { ...emptyState(), ...(await readJsonIfExists(filePath, null) ?? {}) };
  }

  async function transact(operation) {
    return withFileLock(lockPath, async () => {
      const state = await read();
      const result = await operation(state);
      if (result?.changed !== false) {
        state.revision += 1;
        await atomicWriteJson(filePath, state);
      }
      return { state, result: result?.value ?? null };
    }, options);
  }

  async function upsert(collection, idField, record) {
    return transact((state) => {
      const id = record[idField];
      const existing = state[collection][id];
      if (existing && !same(existing, record)) {
        const error = new Error(`${collection} ID ${id} 已存在且内容不同。`);
        error.code = 'OPEN_VIBECODING_GATE_ID_CONFLICT';
        throw error;
      }
      if (existing) return { changed: false, value: existing };
      state[collection][id] = record;
      return { value: record };
    }).then(({ result }) => result);
  }

  return {
    filePath,
    read,
    recordGate(input) {
      const gate = createGateDefinition(input);
      return upsert('gates', 'gateId', gate);
    },
    recordEvidence(input) {
      const evidence = createEvidenceRecord(input, options);
      return upsert('evidence', 'evidenceId', evidence);
    },
    recordApproval(input) {
      const approval = createApprovalRecord(input, options);
      return upsert('approvals', 'approvalId', approval);
    },
    async evaluate(input) {
      return transact((state) => {
        const gate = state.gates[input.gateId];
        if (!gate) {
          const error = new Error(`Gate 不存在：${input.gateId}。`);
          error.code = 'OPEN_VIBECODING_GATE_NOT_FOUND';
          throw error;
        }
        const decision = evaluateScopedGate({
          gate,
          evidence: Object.values(state.evidence),
          approvals: Object.values(state.approvals),
          approvalId: input.approvalId ?? null,
        }, options);
        const existing = state.decisions.find((item) => item.decisionId === decision.decisionId);
        if (existing) return { changed: false, value: existing };
        state.decisions.push(decision);
        if (decision.approvalConsumption) {
          const approval = state.approvals[decision.approvalConsumption.approvalId];
          if (approval) state.approvals[approval.approvalId] = { ...approval, status: 'consumed' };
        }
        return { value: decision };
      }).then(({ result }) => result);
    },
  };
}

export { GATE_STORE_SCHEMA_VERSION, gateStorePath, openGateStore };
