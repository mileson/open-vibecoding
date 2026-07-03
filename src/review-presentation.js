import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { USER_CHANGE_SUMMARY_GUIDE } from './change-summary.js';
import { buildReleaseLedgerSummary, loadReleaseLedger } from './release-ledger.js';

import {
  buildReviewPresentationFeedback,
  canonicalReviewPath,
  defaultReviewArtifactPath,
  renderReviewArtifact,
  renderReviewEntryHtml,
  writeHtmlArtifact,
} from './html-artifacts.js';

export const REVIEW_PRESENTATION_TEMPLATE = {
  diagram: {
    type: 'map',
    note: '默认用关系图；只有确认为线性流程时改为 flow，并用 flowEdges 明确哪些节点有箭头。',
  },
  mapNodes: {
    problem: { title: '问题定义', text: '30字内说明问题' },
    goal: { title: '目标', text: '30字内说明目标' },
    scope: { title: '范围', text: '30字内说明范围' },
    flow: { title: '流程', text: '30字内说明主流程' },
    risk: { title: '风险', text: '30字内说明风险' },
  },
  flowNodes: [
    { id: 'step1', text: '30字内说明第1步' },
    { id: 'step2', text: '30字内说明第2步' },
    { id: 'step3', text: '30字内说明第3步' },
  ],
  flowEdges: [
    { from: 'step1', to: 'step2' },
    { from: 'step2', to: 'step3' },
  ],
  panels: {
    flow: [
      USER_CHANGE_SUMMARY_GUIDE.panelExamples.flow,
    ],
    function: [
      USER_CHANGE_SUMMARY_GUIDE.panelExamples.function,
    ],
    guardrail: [
      USER_CHANGE_SUMMARY_GUIDE.panelExamples.guardrail,
    ],
    risk: [
      USER_CHANGE_SUMMARY_GUIDE.panelExamples.risk,
    ],
  },
  designDirections: {
    note: '可选；只有需求涉及界面/页面/交互时提供。先用 imagegen 生成 3 个差异足够大的交互稿，把图片放到 .openprd/design/active/ 后写入路径；不涉及界面时删除本字段。',
    directions: [
      {
        id: 'direction-1',
        title: '15 字以内方向名',
        image: '.openprd/design/active/direction-1.png',
        summary: '30 字以内一句话说明这个方向的核心体验',
        tradeoff: '30 字以内说明取舍或适用场景',
      },
      {
        id: 'direction-2',
        title: '15 字以内方向名',
        image: '.openprd/design/active/direction-2.png',
        summary: '30 字以内一句话说明这个方向的核心体验',
        tradeoff: '30 字以内说明取舍或适用场景',
      },
      {
        id: 'direction-3',
        title: '15 字以内方向名',
        image: '.openprd/design/active/direction-3.png',
        summary: '30 字以内一句话说明这个方向的核心体验',
        tradeoff: '30 字以内说明取舍或适用场景',
      },
    ],
  },
};

export function buildReviewPresentationTemplatePayload() {
  return {
    intent: 'Agent 先按这个模板写 reviewPresentation，再用本脚本校验；短标签优先使用新增、修复、优化、调整、移除这类用户可感知变化。',
    presentationTemplate: REVIEW_PRESENTATION_TEMPLATE,
    presentationContract: buildReviewPresentationFeedback({ sections: {} }).contract,
  };
}

export async function reviewPresentationWorkspace(projectRoot, options = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const snapshotPath = await resolveReviewPresentationSnapshotPath(resolvedProjectRoot, options.version);
  const snapshot = await readJson(snapshotPath);
  let presentationSource = snapshot.reviewPresentation ? 'snapshot' : null;

  if (options.presentationPath) {
    const presentationPath = path.resolve(options.presentationPath);
    snapshot.reviewPresentation = normalizeReviewPresentationInput(await readJson(presentationPath));
    delete snapshot.reviewPresentationMeta;
    presentationSource = presentationPath;
  }

  if (options.write && !options.presentationPath) {
    throw new Error('--write 需要配合 --presentation，避免误写没有更新的展示文案。');
  }

  const feedback = buildReviewPresentationFeedback(snapshot);
  if (options.write && options.presentationPath && feedback.violations.length === 0) {
    snapshot.reviewPresentationMeta = buildReviewPresentationMeta({
      presentation: snapshot.reviewPresentation,
      feedback,
      source: presentationSource,
    });
  }
  const gate = getReviewPresentationGate(snapshot, feedback);
  const result = {
    ok: gate.ok,
    versionId: snapshot.versionId,
    title: snapshot.title,
    snapshotPath,
    presentationSource,
    presentationContract: feedback.contract,
    presentationFeedback: feedback.violations,
    reviewPresentationGate: gate,
  };

  if (options.write) {
    if (!gate.ok) {
      result.writeBlocked = true;
      return result;
    }
    await fs.writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    result.written = snapshotPath;
    const reviewFiles = await renderValidatedReviewPresentation(resolvedProjectRoot, snapshot);
    result.reviewPath = reviewFiles.canonicalReview;
    result.reviewEntryPath = reviewFiles.activeReviewEntry;
  }

  return result;
}

export function getReviewPresentationGate(snapshot, feedback = buildReviewPresentationFeedback(snapshot)) {
  const errors = [];
  const presentation = snapshot?.reviewPresentation;
  const meta = snapshot?.reviewPresentationMeta;
  if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
    errors.push('缺少已由脚本写入的 reviewPresentation。先运行 openprd review-presentation . --template，再填写 presentation JSON。');
  }
  if (feedback.violations.length > 0) {
    errors.push(`reviewPresentation 仍有 ${feedback.violations.length} 个超限或格式问题。请按 presentationFeedback 中的 jsonPath 重写后再写入。`);
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    errors.push('缺少 reviewPresentationMeta。必须通过 openprd review-presentation --presentation <json> --write --fail-on-violation 写入，不能手工改快照。');
  } else {
    const expectedPresentationHash = hashStableJson(presentation ?? null);
    const expectedViolationsHash = hashStableJson(feedback.violations);
    if (meta.presentationHash !== expectedPresentationHash) {
      errors.push('reviewPresentationMeta.presentationHash 与当前 reviewPresentation 不一致，请重新运行 review-presentation 写入。');
    }
    if (meta.violationsHash !== expectedViolationsHash) {
      errors.push('reviewPresentationMeta.violationsHash 与当前校验结果不一致，请重新运行 review-presentation 写入。');
    }
    if (!meta.validatedAt) {
      errors.push('reviewPresentationMeta.validatedAt 缺失，请重新运行 review-presentation 写入。');
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    violations: feedback.violations,
    requiredCommand: 'openprd review-presentation . --presentation <review-presentation.json> --write --fail-on-violation',
  };
}

export function assertReviewPresentationReady(snapshot) {
  const gate = getReviewPresentationGate(snapshot);
  if (gate.ok) return gate;
  const details = gate.violations.slice(0, 6).map((item) => {
    const pathHint = item.jsonPath ? `${item.jsonPath}: ` : '';
    const sizeHint = item.maxChars ? ` 当前 ${item.currentChars} 字，限制 ${item.maxChars} 字。` : '';
    return `- ${pathHint}${item.action}${sizeHint}`;
  });
  throw new Error([
    'OpenPrd 已阻止生成可确认 review.html：评审展示文案必须先通过 review-presentation 脚本写入。',
    ...gate.errors.map((error) => `- ${error}`),
    ...details,
  ].join('\n'));
}

function buildReviewPresentationMeta({ presentation, feedback, source }) {
  return {
    validatedAt: new Date().toISOString(),
    source: source ?? 'snapshot',
    presentationHash: hashStableJson(presentation ?? null),
    violationsHash: hashStableJson(feedback.violations),
    validator: 'openprd review-presentation',
  };
}

function hashStableJson(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const ACTIVE_ARTIFACT_RETAIN_VERSIONS = 12;

export async function archiveStaleActiveArtifacts(projectRoot, options = {}) {
  const retain = Number.isInteger(options.retain) && options.retain > 0
    ? options.retain
    : ACTIVE_ARTIFACT_RETAIN_VERSIONS;
  const activeDir = path.join(projectRoot, '.openprd', 'artifacts', 'active');
  const archiveDir = path.join(projectRoot, '.openprd', 'artifacts', 'archive');
  const entries = await fs.readdir(activeDir, { withFileTypes: true }).catch(() => []);
  const versioned = entries
    .filter((entry) => entry.isDirectory() && /^v\d{4}-/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const stale = versioned.slice(0, Math.max(0, versioned.length - retain));
  if (stale.length === 0) {
    return { archived: [] };
  }
  await fs.mkdir(archiveDir, { recursive: true });
  const archived = [];
  for (const name of stale) {
    const from = path.join(activeDir, name);
    const to = path.join(archiveDir, name);
    try {
      await fs.rm(to, { recursive: true, force: true });
      await fs.rename(from, to);
      archived.push(name);
    } catch {
      // 归档失败不阻断评审生成
    }
  }
  return { archived };
}

async function renderValidatedReviewPresentation(projectRoot, snapshot) {
  const workspaceRoot = path.join(projectRoot, '.openprd');
  const canonicalReview = canonicalReviewPath({ workspaceRoot }, snapshot.versionId);
  const activeReviewEntry = defaultReviewArtifactPath({ workspaceRoot });
  const releaseLedger = await loadReleaseLedger(projectRoot);
  await writeHtmlArtifact(canonicalReview, renderReviewArtifact({
    snapshot,
    projectRelease: buildReleaseLedgerSummary(releaseLedger.ledger),
  }));
  await archiveStaleActiveArtifacts(projectRoot).catch(() => null);

  const versionIndexPath = path.join(workspaceRoot, 'state', 'version-index.json');
  const versionIndex = await readJson(versionIndexPath);
  const latestVersionId = versionIndex.at(-1)?.versionId;
  if (latestVersionId === snapshot.versionId) {
    await writeHtmlArtifact(activeReviewEntry, renderReviewEntryHtml({
      entryPath: activeReviewEntry,
      reviewPath: canonicalReview,
      title: `${snapshot.title} / 评审入口`,
    }));
  }
  return {
    canonicalReview,
    activeReviewEntry: latestVersionId === snapshot.versionId ? activeReviewEntry : null,
  };
}

export function normalizeReviewPresentationVersionId(version) {
  if (!version) return null;
  const text = `${version}`.trim().toLowerCase();
  const digits = text.replace(/^v/u, '');
  return /^\d+$/u.test(digits) ? `v${digits.padStart(4, '0')}` : text;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function resolveReviewPresentationSnapshotPath(projectRoot, version) {
  const workspaceRoot = path.join(projectRoot, '.openprd');
  const versionId = normalizeReviewPresentationVersionId(version);
  if (versionId) {
    return path.join(workspaceRoot, 'state', 'versions', `${versionId}.json`);
  }

  const versionIndexPath = path.join(workspaceRoot, 'state', 'version-index.json');
  const versionIndex = await readJson(versionIndexPath);
  const latestVersionId = versionIndex.at(-1)?.versionId;
  if (!latestVersionId) {
    throw new Error(`未找到 PRD 版本索引: ${versionIndexPath}`);
  }
  return path.join(workspaceRoot, 'state', 'versions', `${latestVersionId}.json`);
}

function normalizeReviewPresentationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('presentation JSON 必须是对象。');
  }
  if (value.reviewPresentation && typeof value.reviewPresentation === 'object' && !Array.isArray(value.reviewPresentation)) {
    return value.reviewPresentation;
  }
  return value;
}
