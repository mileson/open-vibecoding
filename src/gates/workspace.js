import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureProjectManifest, readProjectManifest } from '../kernel/index.js';
import { openGateStore } from './store.js';

async function readPayload(projectRoot, jsonFile) {
  if (!jsonFile) return {};
  const filePath = path.isAbsolute(jsonFile) ? jsonFile : path.resolve(projectRoot, jsonFile);
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function gateWorkspace(projectRoot, options = {}) {
  const action = options.action ?? 'status';
  try {
    if (action === 'status') await readProjectManifest(projectRoot, { mode: 'read' });
    else await ensureProjectManifest(projectRoot);
    const payload = await readPayload(projectRoot, options.jsonFile);
    const store = openGateStore(projectRoot);
    let result;
    if (action === 'status') result = await store.read();
    else if (action === 'define') result = await store.recordGate(payload.gate ?? payload);
    else if (action === 'evidence') result = await store.recordEvidence(payload.evidence ?? payload);
    else if (action === 'approve') result = await store.recordApproval(payload.approval ?? payload);
    else if (action === 'evaluate') {
      result = await store.evaluate({
        gateId: options.gateId ?? payload.gateId,
        approvalId: options.approvalId ?? payload.approvalId ?? null,
      });
    } else throw new TypeError(`Unsupported gate action: ${action}`);
    return { ok: true, action: `gate-${action}`, projectRoot: path.resolve(projectRoot), result, file: store.filePath };
  } catch (error) {
    return {
      ok: false,
      action: `gate-${action}`,
      projectRoot: path.resolve(projectRoot),
      error: { code: error?.code ?? 'OPENPRD_GATE_ERROR', message: error instanceof Error ? error.message : String(error) },
    };
  }
}

export { gateWorkspace };
