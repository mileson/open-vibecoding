import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyzePrdSnapshot, buildPrdSnapshot, diffSnapshots, formatVersionId, renderPrdMarkdown, summarizeSnapshot } from './prd-core.js';
import { formatProductTypeDisplay, formatProductTypeOptions, formatProductTypeQuestion, formatProductTypeSentence, formatTemplatePackDisplay } from './product-type-copy.js';
import { getDiagramReviewState } from './diagram-workspace.js';
import { exists, parseYamlText, readJson, readText, writeJson, writeText } from './fs-utils.js';
import { artifactBundlePaths, canonicalReviewPath, defaultReviewArtifactPath, openArtifactInBrowser, renderPlaygroundArtifact, renderPlaygroundMarkdown, renderPlaygroundPatch, renderReviewArtifact, renderReviewEntryHtml, reviewDesignDirections, writeHtmlArtifact } from './html-artifacts.js';
import { buildReleaseLedgerSummary } from './release-ledger.js';
import { assertReviewPresentationReady, getReviewPresentationGate } from './review-presentation.js';
import { syncSessionBindingFromReview, syncSessionBindingFromSnapshot } from './session-binding.js';
import { timestamp } from './time.js';
import { generateWorkUnitId, normalizeWorkUnitId, readWorkUnitBinding, resolveTargetRoot, writeWorkUnitBinding } from './work-unit.js';
import { appendDecision, appendOpenQuestions, appendProgress, appendWorkflowEvent, buildClarificationPlan, buildClarificationState, buildCurrentStateSnapshot, buildWorkflowTaskGraph, CAPTURE_SOURCES, coerceCapturedValue, deriveGateLabels, detectWorkspaceScenario, extractMarkdownSection, FIELD_PATH_TO_STATE_KEY, isSupportedProductType, loadCurrentLaneSnapshot, loadLatestVersionSnapshot, loadWorkspace, normalizeVersionId, persistWorkspaceCurrentState, readActiveRequirementLane, readVersionIndex, readVersionSnapshot, renderFlowDoc, renderHandoffDoc, renderRolesDoc, resolveActiveTemplatePack, resolveCurrentProductType, USER_CLARIFICATION_PATHS, validateWorkspace, writeVersionIndex, writeVersionSnapshot } from './workspace-core.js';

function requirementGatePath(projectRoot) {
  return path.join(projectRoot, '.openprd', 'harness', 'requirement-gate.json');
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const PRD_REVIEW_STATUSES = ['pending-confirmation', 'confirmed', 'needs-revision'];
const CURRENT_SNAPSHOT_CACHE_KEYS = [
  'versionId',
  'versionNumber',
  'workUnitId',
  'sections',
  'content',
  'digest',
  'reviewPresentationMeta',
];
const REVIEW_PRESENTATION_RELEVANT_FIELD_PREFIXES = [
  'problem.',
  'users.',
  'validation.',
  'goals.',
  'scope.',
  'scenarios.',
  'requirements.',
  'businessGuardrails.',
  'constraints.',
  'risks.',
  'typeSpecific.',
];
const REVIEW_PRESENTATION_RELEVANT_FIELDS = new Set([
  'meta.title',
  'meta.productType',
]);
const NON_SEMANTIC_CAPTURE_SOURCES = new Set(['agent-normalized']);
const REVIEW_SAFE_CAPTURE_FIELDS = new Set([
  'meta.status',
  'reviewPresentation',
]);
const REVIEW_PRESENTATION_RELEVANT_OVERRIDE_KEYS = new Set([
  'title',
  'problemStatement',
  'whyNow',
  'evidence',
  'primaryUsers',
  'secondaryUsers',
  'stakeholders',
  'community',
  'seedUsers',
  'communityFit',
  'currentAlternative',
  'painEvidence',
  'manualPath',
  'manualPlaybook',
  'commitmentSignals',
  'firstValidationStep',
  'defaultAlivePlan',
  'paymentProof',
  'mvpSlice',
  'weekendTest',
  'smallestExecution',
  'productizeGate',
  'firstCustomerPath',
  'pricingHypothesis',
  'customerOneProfitability',
  'growthDiscipline',
  'reversibility',
  'customerTruth',
  'valuesFit',
  'goals',
  'successMetrics',
  'acceptanceGoals',
  'inScope',
  'outOfScope',
  'primaryFlows',
  'edgeCases',
  'failureModes',
  'functional',
  'nonFunctional',
  'businessRules',
  'costDrivers',
  'usageLimits',
  'abusePrevention',
  'monitoringSignals',
  'alertThresholds',
  'stopLossActions',
  'technical',
  'compliance',
  'dependencies',
  'assumptions',
  'risks',
  'openQuestions',
  'persona',
  'segment',
  'journey',
  'activationMetric',
  'retentionMetric',
  'buyer',
  'user',
  'admin',
  'operator',
  'roles',
  'asIs',
  'toBe',
  'permissionMatrix',
  'approvalFlow',
  'humanAgentContract',
  'autonomyBoundary',
  'toolBoundary',
  'stateModel',
  'evalPlan',
]);
const SYNTHESIZE_CONTENT_OVERRIDE_KEYS = new Set([
  'title',
  'owner',
  'productType',
  'problemStatement',
  'whyNow',
  'evidence',
  'primaryUsers',
  'secondaryUsers',
  'stakeholders',
  'community',
  'seedUsers',
  'communityFit',
  'currentAlternative',
  'painEvidence',
  'manualPath',
  'manualPlaybook',
  'commitmentSignals',
  'firstValidationStep',
  'defaultAlivePlan',
  'paymentProof',
  'mvpSlice',
  'weekendTest',
  'smallestExecution',
  'productizeGate',
  'firstCustomerPath',
  'pricingHypothesis',
  'customerOneProfitability',
  'growthDiscipline',
  'reversibility',
  'customerTruth',
  'valuesFit',
  'goals',
  'successMetrics',
  'acceptanceGoals',
  'inScope',
  'outOfScope',
  'primaryFlows',
  'edgeCases',
  'failureModes',
  'functional',
  'nonFunctional',
  'businessRules',
  'costDrivers',
  'usageLimits',
  'abusePrevention',
  'monitoringSignals',
  'alertThresholds',
  'stopLossActions',
  'technical',
  'compliance',
  'dependencies',
  'assumptions',
  'risks',
  'openQuestions',
  'handoffOwner',
  'nextStep',
  'targetSystem',
  'reviewPresentation',
  'persona',
  'segment',
  'journey',
  'activationMetric',
  'retentionMetric',
  'buyer',
  'user',
  'admin',
  'operator',
  'roles',
  'asIs',
  'toBe',
  'permissionMatrix',
  'approvalFlow',
  'humanAgentContract',
  'autonomyBoundary',
  'toolBoundary',
  'stateModel',
  'evalPlan',
]);

function buildBrainstormSuggestion({ currentState, analysis, clarification, requirementGate }) {
  const promptPreview = String(requirementGate?.promptPreview ?? '');
  const explicit = /(脑暴|brainstorm|帮忙梳理|梳理一下|梳理下|先想清楚)/iu.test(promptPreview);
  const missingRequiredFields = Number(analysis?.missingRequiredFields ?? 0);
  const noProblemStatement = !normalizedText(currentState?.problemStatement);
  const noPrimaryUsers = !Array.isArray(currentState?.primaryUsers) || currentState.primaryUsers.length === 0;
  const shouldSuggest = explicit || (clarification?.shouldAskUser && missingRequiredFields >= 4) || (noProblemStatement && noPrimaryUsers && missingRequiredFields >= 3);
  if (!shouldSuggest) {
    return { recommended: false };
  }
  const reasons = [];
  if (explicit) reasons.push('用户当前更像是在请求先梳理业务方向');
  if (missingRequiredFields >= 4) reasons.push(`还有 ${missingRequiredFields} 个关键信息未确认`);
  if (noProblemStatement) reasons.push('问题定义还不够稳定');
  if (noPrimaryUsers) reasons.push('核心用户和场景还没锁定');
  return {
    recommended: true,
    explicitTrigger: explicit,
    reason: reasons.join('；'),
    suggestedCommand: 'openprd brainstorm . --open',
  };
}

function normalizePrdReviewStatus(status) {
  return PRD_REVIEW_STATUSES.includes(status) ? status : 'pending-confirmation';
}

async function readActiveRequirementGate(projectRoot) {
  const lane = await readActiveRequirementLane(projectRoot).catch(() => null);
  return lane?.gate?.active ? lane.gate : null;
}

function meaningfulOverrideValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return value !== false;
}

function hasSynthesizeContentOverrides(overrides) {
  return Object.entries(overrides).some(([key, value]) => (
    SYNTHESIZE_CONTENT_OVERRIDE_KEYS.has(key) && meaningfulOverrideValue(value)
  ));
}

function latestCaptureTimestamp(currentState) {
  const timestamps = [
    currentState?.lastCapturedAt,
    ...Object.values(currentState?.captureMeta ?? {}).map((entry) => entry?.capturedAt),
  ].filter(Boolean).map(String);
  return timestamps.length > 0 ? timestamps.sort().at(-1) : null;
}

function requirementGateReferenceTimestamp(gate) {
  return gate?.confirmedAt ?? gate?.updatedAt ?? gate?.openedAt ?? null;
}

function requirementNextActionBlocksSynthesize(nextAction) {
  return nextAction === 'clarify-user' || nextAction === 'classify' || nextAction === 'interview';
}

function gateHasClarificationConfirmation(gate) {
  return Boolean(gate?.clarificationConfirmedAt || gate?.status === 'clarification-confirmed');
}

function latestUserConfirmedCaptureTimestamp(currentState, paths = null) {
  const timestamps = Object.entries(currentState?.captureMeta ?? {})
    .filter(([field, entry]) => (!paths || paths.has(field)) && entry?.source === 'user-confirmed')
    .map(([, entry]) => entry?.capturedAt)
    .filter(Boolean)
    .map(String);
  return timestamps.length > 0 ? timestamps.sort().at(-1) : null;
}

function latestConfirmedClarificationCaptureTimestamp(currentState) {
  return latestUserConfirmedCaptureTimestamp(currentState, USER_CLARIFICATION_PATHS)
    || latestUserConfirmedCaptureTimestamp(currentState);
}

function hasDerivedClarificationCaptureSince(currentState, gateAt) {
  const reference = String(gateAt || '');
  return Object.entries(currentState?.captureMeta ?? {}).some(([field, entry]) => {
    if (!USER_CLARIFICATION_PATHS.has(field)) {
      return false;
    }
    if (!entry?.capturedAt || String(entry.capturedAt) < reference) {
      return false;
    }
    return Boolean(entry.source) && entry.source !== 'user-confirmed' && !NON_SEMANTIC_CAPTURE_SOURCES.has(entry.source);
  });
}

function gateQuestionLimit(gate, fallback) {
  const raw = Number(gate?.approvalPolicy?.maxClarificationQuestions);
  if (!Number.isFinite(raw) || raw <= 0) {
    return fallback;
  }
  return Math.min(fallback, Math.max(1, Math.floor(raw)));
}

function ensureFreshRequirementStateForSynthesize({ gate, currentState, overrides }) {
  if (!gate) {
    return;
  }
  const gateAt = requirementGateReferenceTimestamp(gate);
  if (!gateAt) {
    return;
  }
  const capturedAt = latestCaptureTimestamp(currentState);
  if (capturedAt && String(capturedAt) >= String(gateAt)) {
    if (!gateHasClarificationConfirmation(gate)) {
      return;
    }
    const confirmedCaptureAt = latestConfirmedClarificationCaptureTimestamp(currentState);
    const hasDerivedCapture = hasDerivedClarificationCaptureSince(currentState, gateAt);
    if (confirmedCaptureAt && String(confirmedCaptureAt) >= String(gateAt) && !hasDerivedCapture) {
      return;
    }
    throw new Error([
      'OpenPrd 已阻止 synthesize：当前需求摘要虽已确认，但 current.json 还没有把本轮确认内容稳定写回。',
      hasDerivedCapture
        ? '检测到本轮仍有 user clarification 字段被写成 agent-inferred / project-derived；请先改用 openprd capture 按 canonical 字段路径并以 user-confirmed 写回，再继续 synthesize。'
        : '请先用 openprd capture 按 canonical 字段路径并以 user-confirmed 写回本轮确认事实，再继续 synthesize。',
      hasSynthesizeContentOverrides(overrides)
        ? 'partial override 不能替代这一步 requirement write-back。'
        : null,
    ].filter(Boolean).join(' '));
  }
  throw new Error([
    'OpenPrd 已阻止 synthesize：当前有新的需求入口，但 current.json 还没有记录本轮确认答案。',
    hasSynthesizeContentOverrides(overrides)
      ? '当前 requirement gate 处于进行中，partial override 不能替代 fresh capture；请先用 openprd capture 写入本轮目标、问题、范围和验收信息。'
      : '请先用 openprd capture 写入本轮目标、问题、范围和验收信息。',
  ].join(' '));
}

async function ensureRequirementLaneReadyForSynthesize(ws) {
  const guidance = await computeWorkspaceGuidance(ws, { questionLimit: 5 });
  const missingRequiredFields = Number(guidance.analysis?.missingRequiredFields ?? 0);
  const lacksProductType = !guidance.analysis?.productType;
  const blockedByStructuredGap = guidance.nextAction === 'classify'
    || guidance.nextAction === 'interview'
    || (guidance.nextAction === 'clarify-user' && (lacksProductType || missingRequiredFields > 0));
  if (!blockedByStructuredGap) {
    return;
  }
  throw new Error([
    'OpenPrd 已阻止 synthesize：当前 requirement lane 还没有离开需求补齐阶段。',
    `当前下一步仍是 ${guidance.nextAction}。`,
    guidance.reason ? `原因: ${guidance.reason}` : null,
    guidance.suggestedCommand ? `建议先执行: ${guidance.suggestedCommand}。` : null,
    Array.isArray(guidance.suggestedQuestions) && guidance.suggestedQuestions.length > 0
      ? `优先补齐: ${guidance.suggestedQuestions.slice(0, 2).join('；')}。`
      : null,
  ].filter(Boolean).join(' '));
}

function resolveReviewPaths(ws, snapshot) {
  const canonicalReview = canonicalReviewPath(ws, snapshot.versionId);
  const activeReviewEntry = defaultReviewArtifactPath(ws);
  return {
    canonicalReview,
    activeReviewEntry,
  };
}

async function writeReviewFiles(ws, snapshot, { writeEntry = true } = {}) {
  assertReviewPresentationReady(snapshot);
  const reviewHtml = renderReviewArtifact({
    snapshot,
    projectRelease: buildReleaseLedgerSummary(ws.data.releaseLedger),
  });
  const { canonicalReview, activeReviewEntry } = resolveReviewPaths(ws, snapshot);
  await writeHtmlArtifact(canonicalReview, reviewHtml);
  if (writeEntry) {
    await writeHtmlArtifact(activeReviewEntry, renderReviewEntryHtml({
      entryPath: activeReviewEntry,
      reviewPath: canonicalReview,
      title: `${snapshot.title} / 评审入口`,
    }));
  }
  return {
    canonicalReview,
    activeReviewEntry: writeEntry ? activeReviewEntry : null,
  };
}

async function removeReviewFiles(reviewFiles) {
  await Promise.all([
    reviewFiles.canonicalReview ? fs.rm(reviewFiles.canonicalReview, { force: true }) : null,
    reviewFiles.activeReviewEntry ? fs.rm(reviewFiles.activeReviewEntry, { force: true }) : null,
  ].filter(Boolean));
}

function shouldUseCurrentDraftForGuidance(currentState) {
  return Boolean(
    currentState?.reviewStatus?.stale
    || (currentState?.lastCapturedAt && !['synthesized', 'frozen', 'handed_off'].includes(currentState?.status))
  );
}

function clearCurrentSnapshotCache(currentState) {
  for (const key of CURRENT_SNAPSHOT_CACHE_KEYS) {
    delete currentState[key];
  }
  return currentState;
}

function isReviewPresentationRelevantField(field) {
  if (!field) return false;
  return REVIEW_PRESENTATION_RELEVANT_FIELDS.has(field)
    || REVIEW_PRESENTATION_RELEVANT_FIELD_PREFIXES.some((prefix) => field.startsWith(prefix));
}

function shouldDropInheritedReviewPresentationFromCapture(applied) {
  const fields = applied.map((item) => item.field).filter(Boolean);
  if (fields.includes('reviewPresentation')) {
    return false;
  }
  return fields.some((field) => isReviewPresentationRelevantField(field));
}

function shouldDropInheritedReviewPresentationFromOverrides(overrides) {
  if (Object.prototype.hasOwnProperty.call(overrides, 'reviewPresentation')) {
    return false;
  }
  return Object.keys(overrides).some((key) => REVIEW_PRESENTATION_RELEVANT_OVERRIDE_KEYS.has(key));
}

function dropInheritedReviewPresentation(currentState) {
  delete currentState.reviewPresentation;
  delete currentState.reviewPresentationMeta;
  if (currentState.captureMeta && typeof currentState.captureMeta === 'object' && !Array.isArray(currentState.captureMeta)) {
    delete currentState.captureMeta.reviewPresentation;
    delete currentState.captureMeta.reviewPresentationMeta;
  }
  return currentState;
}

function syncCurrentSnapshotCache(currentState, snapshot) {
  clearCurrentSnapshotCache(currentState);
  currentState.versionId = snapshot.versionId;
  currentState.versionNumber = snapshot.versionNumber;
  currentState.workUnitId = snapshot.workUnitId ?? null;
  currentState.sections = snapshot.sections;
  currentState.content = snapshot.content;
  currentState.digest = snapshot.digest;
  currentState.reviewPresentationMeta = snapshot.reviewPresentationMeta ?? null;
  return currentState;
}

function markReviewStateStaleAfterCapture(currentState, applied, capturedAt) {
  const dropInheritedPresentation = shouldDropInheritedReviewPresentationFromCapture(applied);
  if (dropInheritedPresentation) {
    dropInheritedReviewPresentation(currentState);
  }
  const staleFields = applied
    .filter((item) => item.field && !REVIEW_SAFE_CAPTURE_FIELDS.has(item.field) && !NON_SEMANTIC_CAPTURE_SOURCES.has(item.source))
    .map((item) => item.field);
  const previousReview = currentState.reviewStatus ?? null;
  const staleVersionId = currentState.latestVersionId ?? currentState.versionId ?? previousReview?.versionId ?? null;
  if (staleFields.length === 0) {
    return false;
  }
  const staleWorkUnitId = currentState.activeWorkUnitId ?? currentState.workUnitId ?? previousReview?.workUnitId ?? null;
  currentState.previousLatestVersionId = staleVersionId;
  currentState.previousLatestVersionDigest = currentState.latestVersionDigest ?? currentState.digest ?? null;
  currentState.previousActiveWorkUnitId = staleWorkUnitId;
  delete currentState.latestVersionId;
  delete currentState.latestVersionDigest;
  delete currentState.activeWorkUnitId;
  clearCurrentSnapshotCache(currentState);
  currentState.status = 'clarifying';
  if (!staleVersionId) {
    return false;
  }
  currentState.reviewStatus = {
    versionId: null,
    workUnitId: null,
    status: 'needs-revision',
    stale: true,
    staleReason: 'captured-fields-updated',
    staleFields,
    staleVersionId,
    staleVersionDigest: currentState.previousLatestVersionDigest,
    staleWorkUnitId,
    staleArtifact: previousReview?.reviewPath ?? previousReview?.stableArtifact ?? previousReview?.artifact ?? null,
    updatedAt: capturedAt,
  };
  return true;
}

function requirementLooksLikeInterfaceWork(gate) {
  const text = `${gate?.promptPreview ?? ''} ${JSON.stringify(gate?.intent ?? {})}`;
  return /界面|页面|菜单|入口|按钮|表单|弹窗|导航|布局|看板|列表|配置页|模块|组件|UI|tab/i.test(text);
}

function requirementPrompt(gate) {
  return String(gate?.promptPreview ?? '').trim();
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function detectRequirementIntakeComplexity(gate) {
  const text = requirementPrompt(gate);
  const complexPatterns = [
    /新增|新建|增加/,
    /模块|流程|编排|一站式|信息架构|工作流|workflow|wizard/i,
    /多角色|权限|审批|协作|团队|客户|后台|管理/,
    /AI|agent|模型|生成|自动化|集成|第三方/i,
    /免费|额度|计费|成本|滥用|安全|合规/,
  ];
  const vaguePatterns = [
    /体验|优化|提升|更好|智能|自动|高效|完整|体系|平台/,
    /我希望|用户反馈|考虑不全|模糊|大概|可能/,
  ];
  const simpleConcretePatterns = [
    /按钮|文案|颜色|圆角|位置|间距|字号|图标|标题|空格|标点|错别字|拼写|label|copy/i,
    /从.+(改到|移到|移动到|换到|变成|改成|改为).+/,
  ];
  const reasons = [];
  if (text.length >= 80) {
    reasons.push('输入较长，包含多个意图或约束');
  }
  if (includesAny(text, complexPatterns)) {
    reasons.push('涉及新能力、模块、流程、权限、成本或集成');
  }
  if (includesAny(text, vaguePatterns)) {
    reasons.push('表达仍偏目标或体验，需要先收敛用户场景');
  }

  const simpleConcrete = text.length <= 80
    && includesAny(text, simpleConcretePatterns)
    && !includesAny(text, [/新增|新建|模块|流程|编排|一站式|权限|审批|agent|AI/i]);

  if (simpleConcrete) {
    return {
      mode: 'focused',
      label: '轻量项目映射',
      minimumDepth: 1,
      questionLimit: 3,
      reasons: ['输入看起来是明确的局部调整，只需要确认影响位置和验收方式'],
    };
  }

  if (reasons.length > 0) {
    return {
      mode: 'deep',
      label: '三轮需求自省',
      minimumDepth: 3,
      questionLimit: 6,
      reasons,
    };
  }

  return {
    mode: 'focused',
    label: '轻量需求自省',
    minimumDepth: 1,
    questionLimit: 4,
    reasons: ['需求目标相对聚焦，但仍需要结合当前项目确认范围和验收方式'],
  };
}

function shortList(items, fallback = '待补充') {
  const list = (Array.isArray(items) ? items : [items]).map((item) => String(item || '').trim()).filter(Boolean);
  return list.length > 0 ? list.slice(0, 3).join('；') : fallback;
}

function normalizeTextList(items) {
  if (Array.isArray(items)) {
    return items.map((item) => String(item || '').trim()).filter(Boolean);
  }
  const text = String(items || '').trim();
  return text ? [text] : [];
}

function summarizeProductShape(productType, gate) {
  if (productType === 'consumer' || productType === 'b2b' || productType === 'agent' || productType === 'base') {
    return formatProductTypeSentence(productType);
  }
  const text = requirementPrompt(gate);
  if (/agent|自动化|workflow|MCP|tool|skill/i.test(text)) {
    return formatProductTypeSentence('agent', { inferred: true });
  }
  if (/企业|团队|后台|审批|权限|客户|运营/i.test(text)) {
    return formatProductTypeSentence('b2b', { inferred: true });
  }
  if (/个人|用户|社区|内容|创作者|消费|c端|to c/i.test(text)) {
    return formatProductTypeSentence('consumer', { inferred: true });
  }
  return `产品场景仍待确认，可在 ${formatProductTypeOptions()} 之间进一步锁定。`;
}

function summarizeArchitectureSignals(gate, snapshot) {
  const sections = snapshot.sections ?? {};
  const text = `${requirementPrompt(gate)} ${JSON.stringify({
    technical: sections.constraints?.technical ?? [],
    dependencies: sections.constraints?.dependencies ?? [],
  })}`;
  const hits = [];
  if (/前端|页面|客户端|web|h5|移动端|ios|android|桌面|ui|交互|网站|站点|博客|内容|文章|落地页/i.test(text)) {
    hits.push('用户入口与页面体验');
  }
  if (/后端|服务端|server|api|数据库|存储|队列|定时任务|cron|webhook/i.test(text)) {
    hits.push('服务流程与数据处理');
  }
  if (/agent|workflow|tool|skill|MCP|自动化|编排/i.test(text)) {
    hits.push('Agent 协作与自动执行');
  }
  return hits.length > 0
    ? hits.join('；')
    : '影响环节仍待确认，可先按用户入口、服务流程或 Agent 协作补齐。';
}

function collectProjectRiskProbes(gate, snapshot) {
  const sections = snapshot.sections ?? {};
  const text = `${requirementPrompt(gate)} ${JSON.stringify({
    users: sections.users ?? {},
    constraints: sections.constraints ?? {},
    requirements: sections.requirements ?? {},
  })}`;
  const probes = [];
  const probeMap = [
    { label: '账号身份与可见范围', pattern: /登录|账号|auth|oauth|权限|角色|rbac/i },
    { label: '用户数据与信息处理', pattern: /数据|数据库|存储|隐私|文件|上传|下载|同步/i },
    { label: '团队协作与审批流转', pattern: /团队|协作|审批|组织|成员|管理员|buyer|admin/i },
    { label: '外部系统与合作方对接', pattern: /第三方|外部|api|sdk|集成|webhook|支付|短信/i },
    { label: 'AI 结果可靠性与人工兜底', pattern: /ai|agent|模型|llm|生成|推理|prompt/i },
    { label: '收费模式、额度与成本', pattern: /收费|订阅|付费|价格|额度|点数|积分|成本|quota|billing/i },
  ];
  for (const probe of probeMap) {
    if (probe.pattern.test(text)) {
      probes.push(probe.label);
    }
  }
  return probes;
}

function buildValidationFraming(sections = {}) {
  const validation = sections.validation ?? {};
  return {
    community: shortList(validation.community, '需要先确认第一批最容易触达的 1 到 3 个社区、渠道或人群。'),
    seedUsers: shortList(validation.seedUsers, '需要先确认至少 3 到 10 个具体先找谁聊、先服务谁。'),
    communityFit: shortList(validation.communityFit, '需要先确认你为什么算这个社区里的自己人、他们在哪里聚集、为什么现在就能触达。'),
    currentAlternative: shortList(validation.currentAlternative, '需要先确认他们现在主要靠什么替代方案在解决。'),
    painEvidence: shortList(validation.painEvidence, '需要先确认这个问题到底有多痛、用户是否已经在为更差的办法花时间或花钱。'),
    manualPath: shortList(validation.manualPath, '需要先确认不做完整产品时先怎么手工交付价值。'),
    manualPlaybook: shortList(validation.manualPlaybook, '需要先确认手工交付的触发条件、步骤、工具、耗时和交接点。'),
    commitmentSignals: shortList(validation.commitmentSignals, '需要先确认什么真实承诺能证明不是口头兴趣。'),
    firstValidationStep: shortList(validation.firstValidationStep, '需要先确认最低成本先做哪一步验证。'),
    defaultAlivePlan: shortList(validation.defaultAlivePlan, '需要先确认验证阶段怎样先活下来。'),
    paymentProof: shortList(validation.paymentProof, '需要先确认有没有 10 个潜在用户样本、3/10 付费意愿或更强交易信号。'),
    mvpSlice: shortList(validation.mvpSlice, '需要先确认第一版到底只做哪一件事。'),
    weekendTest: shortList(validation.weekendTest, '需要先确认能不能压成周末级 MVP 或更轻的试跑。'),
    smallestExecution: shortList(validation.smallestExecution, '需要先确认能否先用 spreadsheet、表单或 no-code 工具把价值跑出来。'),
    productizeGate: shortList(validation.productizeGate, '需要先确认达到什么条件才允许继续产品化或加功能。'),
    firstCustomerPath: shortList(validation.firstCustomerPath, '需要先确认第一批客户最现实的触达顺序。'),
    pricingHypothesis: shortList(validation.pricingHypothesis, '需要先确认从第一个客户开始准备怎么收费。'),
    customerOneProfitability: shortList(validation.customerOneProfitability, '需要先确认第一个客户如何覆盖时间和交付成本。'),
    growthDiscipline: shortList(validation.growthDiscipline, '需要先确认销售、launch 和增长阶段准备守哪些纪律。'),
    reversibility: shortList(validation.reversibility, '需要先确认验证结果一般时这条路是否容易回退，是否会逼出重招聘、长期绑定或重平台化。'),
    customerTruth: shortList(validation.customerTruth, '需要先确认这更像在解决客户真问题还是满足内部冲动。'),
    valuesFit: shortList(validation.valuesFit, '需要先确认这条路是否符合团队想坚持的价值观，以及它是不是你愿意长期住进去的业务形态。'),
  };
}

function hasSatisfiedConfirmedClarificationWriteback({ gate, currentState, analysis, hasProductType }) {
  if (!gateHasClarificationConfirmation(gate)) {
    return false;
  }
  if (!hasProductType || Number(analysis?.missingRequiredFields ?? 0) > 0) {
    return false;
  }
  const gateAt = requirementGateReferenceTimestamp(gate);
  if (!gateAt) {
    return false;
  }
  const confirmedCaptureAt = latestConfirmedClarificationCaptureTimestamp(currentState);
  if (!confirmedCaptureAt || String(confirmedCaptureAt) < String(gateAt)) {
    return false;
  }
  return !hasDerivedClarificationCaptureSince(currentState, gateAt);
}

function hasSatisfiedFreshRequirementWriteback({ gate, currentState, analysis, hasProductType }) {
  if (!gate || gateHasClarificationConfirmation(gate)) {
    return false;
  }
  if (!hasProductType || Number(analysis?.missingRequiredFields ?? 0) > 0) {
    return false;
  }
  const gateAt = requirementGateReferenceTimestamp(gate);
  if (!gateAt) {
    return false;
  }
  const capturedAt = latestCaptureTimestamp(currentState);
  return Boolean(capturedAt && String(capturedAt) >= String(gateAt));
}

function buildProjectFraming({ gate, snapshot, scenario, productType }) {
  const sections = snapshot.sections ?? {};
  const guardrailHints = [
    ...normalizeTextList(sections.requirements?.businessRules),
    ...normalizeTextList(sections.constraints?.dependencies),
  ];
  const riskProbes = collectProjectRiskProbes(gate, snapshot);
  const validationFraming = buildValidationFraming(sections);
  return {
    audience: shortList(
      sections.users?.primaryUsers,
      scenario.id === 'cold-start-existing-project'
        ? '需要先确认这次改动主要服务谁。'
        : '需要先确认目标用户或关键角色。'
    ),
    productShape: summarizeProductShape(productType, gate),
    firstSlice: shortList(sections.scope?.inScope, '需要先确认第一版最小可用切片。'),
    nonGoals: shortList(sections.scope?.outOfScope, '需要先确认本轮先不做什么。'),
    guardrails: shortList(guardrailHints, '需要先确认哪些现有能力、数据、流程或体验不能被破坏。'),
    architectureSignals: summarizeArchitectureSignals(gate, snapshot),
    validationFraming,
    riskProbes,
    riskProbeSummary: shortList(riskProbes, '当前没有明显命中额外风险探针。'),
  };
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '').replace(/\|/g, '/');
}

function containsPendingClarifyMarker(value) {
  return /(待确认|需要先确认|仍待确认|未分类)/.test(String(value ?? ''));
}

function describeProductLensFocus(productType) {
  if (productType === 'consumer') {
    return '这轮我会重点看首次使用场景、关键感受，以及用户愿不愿意继续回来。';
  }
  if (productType === 'b2b') {
    return '这轮我会重点看谁拍板、谁使用、谁运营，以及上线协作会卡在哪里。';
  }
  if (productType === 'agent') {
    return '这轮我会重点看哪些步骤让 Agent 自主完成、哪些节点必须人工拍板，以及失败时谁兜底。';
  }
  return '这轮我会优先把用户、场景、第一版切片、边界和风险讲清楚。';
}

function requirementTypeDisplay(gate) {
  const tier = String(gate?.intent?.requirementTier ?? '').toLowerCase();
  if (tier === 'l0') {
    return '直接处理（L0）';
  }
  if (tier === 'l1') {
    return '现有功能优化（L1）';
  }
  return '新功能/新流程方案（L2）';
}

function inferredProductTypeDisplay(productType, gate) {
  if (productType === 'consumer' || productType === 'b2b' || productType === 'agent' || productType === 'base') {
    return formatProductTypeDisplay(productType);
  }
  const text = requirementPrompt(gate);
  if (/agent|自动化|workflow|MCP|tool|skill/i.test(text)) {
    return formatProductTypeDisplay('agent');
  }
  if (/企业|团队|后台|审批|权限|客户|运营/i.test(text)) {
    return formatProductTypeDisplay('b2b');
  }
  if (/个人|用户|社区|内容|创作者|消费|c端|to c/i.test(text)) {
    return formatProductTypeDisplay('consumer');
  }
  return '待确认';
}

function fallbackScopeText(text, fallback) {
  return containsPendingClarifyMarker(text) ? fallback : text;
}

function buildMarkdownTable(headers, rows) {
  const normalizedRows = rows
    .filter((row) => Array.isArray(row) && row.length > 0)
    .map((row) => headers.map((_, index) => escapeMarkdownTableCell(row[index] ?? '待确认')));
  return [
    `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...normalizedRows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

function inferCoreScopeModule(prompt, productType) {
  const text = String(prompt ?? '');
  if (/页面|界面|布局|导航|按钮|表单|网站|站点|博客|内容|文章|落地页|UI/i.test(text)) {
    return '用户入口与界面';
  }
  if (/后端|服务端|接口|api|数据库|存储|同步|队列|webhook|数据/i.test(text)) {
    return '服务流程与数据处理';
  }
  if (/agent|自动化|workflow|tool|skill|MCP|编排/i.test(text) || productType === 'agent') {
    return 'Agent 主流程';
  }
  return '核心主流程';
}

function pushScopeRow(rows, seen, module, inScope, outOfScope) {
  const key = String(module ?? '').trim();
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  rows.push([module, inScope, outOfScope]);
}

function buildScopeTableRows({ projectFraming, prompt, productType }) {
  const rows = [];
  const seen = new Set();
  const text = `${prompt ?? ''} ${projectFraming.architectureSignals ?? ''}`;
  const firstSlice = fallbackScopeText(
    projectFraming.firstSlice,
    '先把第一版核心主流程收敛到一个最小可交付闭环。'
  );
  const nonGoals = fallbackScopeText(
    projectFraming.nonGoals,
    '暂不把与核心目标无关的大范围扩展一起塞进第一版。'
  );
  if (/用户入口与页面体验|页面|界面|布局|导航|按钮|表单|网站|站点|博客|内容|文章|落地页|UI/i.test(text)) {
    pushScopeRow(
      rows,
      seen,
      '用户入口与界面',
      containsPendingClarifyMarker(projectFraming.firstSlice)
        ? '先把用户看到的入口、页面结构和关键交互讲清楚。'
        : firstSlice,
      nonGoals,
    );
  }
  if (/服务流程与数据处理|后端|服务端|接口|api|数据库|存储|同步|队列|webhook|数据/i.test(text)) {
    pushScopeRow(
      rows,
      seen,
      '服务流程与数据处理',
      '先只覆盖支撑主流程所需的接口、状态处理或数据留痕。',
      '暂不扩到与这次主流程无关的重构、清库或系统级迁移。',
    );
  }
  if (/Agent 协作与自动执行|agent|自动化|workflow|tool|skill|MCP|编排/i.test(text) || productType === 'agent') {
    pushScopeRow(
      rows,
      seen,
      'Agent 主流程',
      '先讲清 Agent 负责的步骤、人工确认点和失败恢复。',
      '暂不把所有自动化场景一次性铺开，避免边界失控。',
    );
  }
  if (rows.length === 0) {
    pushScopeRow(rows, seen, inferCoreScopeModule(prompt, productType), firstSlice, nonGoals);
  }
  return rows;
}

function pushTechRow(rows, seen, area, approach, responsibility) {
  const key = String(area ?? '').trim();
  if (!key || seen.has(key)) {
    return;
  }
  seen.add(key);
  rows.push([area, approach, responsibility]);
}

function buildTechnicalSolutionRows({ projectFraming, prompt, productType }) {
  const rows = [];
  const seen = new Set();
  const text = `${prompt ?? ''} ${projectFraming.architectureSignals ?? ''}`;
  if (/用户入口与页面体验|页面|界面|布局|导航|按钮|表单|网站|站点|博客|内容|文章|落地页|UI/i.test(text)) {
    pushTechRow(
      rows,
      seen,
      '前端 / 用户入口',
      '先围绕当前入口、页面结构和关键交互做第一版，不提前铺开大范围视觉重做。',
      '负责把用户真正看到的流程、反馈和操作路径讲清楚。',
    );
  }
  if (/服务流程与数据处理|后端|服务端|接口|api|数据库|存储|同步|队列|webhook|数据/i.test(text)) {
    pushTechRow(
      rows,
      seen,
      '后端 / 服务逻辑',
      '只补当前需求真正需要的接口、状态流转或数据写入，先保证主链路跑通。',
      '负责把规则、状态和数据处理接住，并留下可验证证据。',
    );
  }
  if (/Agent 协作与自动执行|agent|自动化|workflow|tool|skill|MCP|编排/i.test(text) || productType === 'agent') {
    pushTechRow(
      rows,
      seen,
      'Agent / 自动化编排',
      '先定义 Agent 自主边界、人工拍板点和失败恢复，再决定要不要继续扩编排深度。',
      '负责把多步流程串起来，并在失败时把用户安全带回人工兜底。',
    );
  }
  if (rows.length === 0) {
    pushTechRow(
      rows,
      seen,
      '实现主链路',
      '先按当前确认范围做最小可用闭环，再决定是否扩展到更多技术面。',
      '负责把第一版能力真正落到可验证的主流程里。',
    );
  }
  return rows;
}

function buildClarifyDirectionChoices(productType) {
  if (productType === 'consumer') {
    return [
      '先把第一次上手跑通：更快定第一版，但后续可能还要补留存动作。',
      '先把关键转化做好：更贴近商业结果，但对场景边界要求更高。',
      '先把愿意回来这件事做顺：更利于长期价值，但首版会慢一点。',
    ];
  }
  if (productType === 'b2b') {
    return [
      '先解决单角色提效：更容易落地，但跨团队价值暂时有限。',
      '先打通跨角色流转：业务收益更明显，但协调成本更高。',
      '先补管理与配置能力：便于后续扩张，但首版体感未必最强。',
    ];
  }
  if (productType === 'agent') {
    return [
      '先跑通单步自动化：最快看到结果，但协作链路还比较浅。',
      '先做多步编排：更像完整方案，但边界和失败恢复要更早想清楚。',
      '先把人工兜底做稳：风险更低，但自动化收益会慢一点体现。',
    ];
  }
  return [
    '先把用户最痛的一步打通：更容易收敛首版，但覆盖面会窄一些。',
    '先把主流程串起来：更完整，但第一版实现成本更高。',
    '先把边界和风险控住：更稳，但用户感知收益会慢一点出现。',
  ];
}

function normalizeClarifyMode(mode) {
  if (mode === 'artifact') {
    return 'inline-with-checklist';
  }
  return ['auto', 'inline', 'inline-with-checklist'].includes(mode) ? mode : 'auto';
}

function estimateInlineClarificationLines(clarification, reflection) {
  const projectFraming = reflection?.projectContext?.projectFraming ?? null;
  const activeChangeLines = reflection?.projectContext?.activeChange ? 1 : 0;
  const framingLines = projectFraming
    ? 5
      + (projectFraming.architectureSignals ? 1 : 0)
      + (projectFraming.riskProbes?.length > 0 ? 1 : 0)
    : 0;
  return 2
    + framingLines
    + clarification.mustAskUser.length
    + Math.min(clarification.canInferLater.length, 2)
    + activeChangeLines;
}

function isLightweightClarifyQuestion(item) {
  const id = String(item?.id ?? '');
  return /^(meta|users|goals|scope|scenarios|requirements)\./.test(id);
}

function chooseClarifyPresentation({ requirementGate, clarification, reflection, requestedMode = 'auto' }) {
  const normalizedMode = normalizeClarifyMode(requestedMode);
  const estimatedLineCount = estimateInlineClarificationLines(clarification, reflection);
  const questionCount = clarification.mustAskUser.length;
  const substantialQuestionCount = clarification.mustAskUser.filter((item) => !isLightweightClarifyQuestion(item)).length;
  const defaultMode = !requirementGate?.active || substantialQuestionCount > 2 || questionCount > 2 || reflection?.mode === 'deep' || estimatedLineCount > 8
    ? 'inline-with-checklist'
    : 'inline';
  const mode = normalizedMode === 'auto' ? defaultMode : normalizedMode;
  const reason = mode === 'inline-with-checklist'
    ? '澄清阶段只在对话内呈现，当前需求用摘要和简短清单确认；正式 HTML 评审留给后续 review。'
    : '当前需求可以用十句话以内讲清楚，直接在对话内确认，降低用户跳转成本。';
  return {
    mode,
    label: mode === 'inline-with-checklist' ? '对话内澄清 + 简短清单' : '对话内澄清',
    estimatedLineCount,
    questionCount,
    substantialQuestionCount,
    reason,
  };
}

function buildInlineClarification({ clarification, reflection, presentation }) {
  if (!presentation?.mode?.startsWith('inline')) {
    return null;
  }
  const prompt = reflection?.promptPreview || '本轮需求';
  const projectContext = reflection?.projectContext ?? {};
  const projectFraming = projectContext.projectFraming ?? {};
  const validationFraming = projectFraming.validationFraming ?? {};
  const productType = projectContext.productType;
  const primaryQuestion = clarification.mustAskUser[0] ?? null;
  const followUpQuestions = clarification.mustAskUser.slice(1, presentation.mode === 'inline' ? 2 : 3);
  const scopeTable = buildMarkdownTable(
    ['功能模块', '这次先做什么', '这次先不做什么'],
    buildScopeTableRows({ projectFraming, prompt, productType }),
  );
  const technicalTable = buildMarkdownTable(
    ['技术部分', '初步方案', '主要负责什么'],
    buildTechnicalSolutionRows({ projectFraming, prompt, productType }),
  );
  const directionChoices = (
    containsPendingClarifyMarker(projectFraming.firstSlice)
    || containsPendingClarifyMarker(projectFraming.audience)
  )
    ? buildClarifyDirectionChoices(productType)
    : [];
  const lines = [
    `我先用产品和业务语言复述一下这次需求，并先按总分结构收一下：${prompt}`,
    '',
    '需求判断：',
    `- 需求类型：${requirementTypeDisplay(reflection?.gate)}。`,
    `- 产品类型：${inferredProductTypeDisplay(productType, reflection?.gate)}。`,
    '',
    '需求理解：',
    `- 主要服务对象：${projectFraming.audience ?? '待确认'}。`,
    `- 使用场景更像：${projectFraming.productShape ?? '待确认'}。`,
    `- 第一版先让用户做到：${projectFraming.firstSlice ?? '待确认'}。`,
    `- 这轮先不碰：${projectFraming.nonGoals ?? '待确认'}。`,
    `- 必须守住：${projectFraming.guardrails ?? '待确认'}。`,
    `- 第一批最容易触达：${validationFraming.community ?? '待确认'}。`,
    `- 社区契合与触达依据：${validationFraming.communityFit ?? '待确认'}。`,
    `- 当前主要替代：${validationFraming.currentAlternative ?? '待确认'}。`,
    `- 痛点与替代证据：${validationFraming.painEvidence ?? '待确认'}。`,
    `- 先怎么手工交付：${validationFraming.manualPath ?? '待确认'}。`,
    `- 手工作战卡：${validationFraming.manualPlaybook ?? '待确认'}。`,
    `- 什么承诺才算真需求：${validationFraming.commitmentSignals ?? '待确认'}。`,
    `- 最低成本先验证：${validationFraming.firstValidationStep ?? '待确认'}。`,
    `- 怎么先活下来：${validationFraming.defaultAlivePlan ?? '待确认'}。`,
    `- 付费验证信号：${validationFraming.paymentProof ?? '待确认'}。`,
    `- 第一版只做一件事：${validationFraming.mvpSlice ?? '待确认'}。`,
    `- 周末级验证长什么样：${validationFraming.weekendTest ?? '待确认'}。`,
    `- 最小工具桥接：${validationFraming.smallestExecution ?? '待确认'}。`,
    `- 产品化门槛：${validationFraming.productizeGate ?? '待确认'}。`,
    `- 第一批客户路径：${validationFraming.firstCustomerPath ?? '待确认'}。`,
    `- 初始收费假设：${validationFraming.pricingHypothesis ?? '待确认'}。`,
    `- 客户 1 盈利路径：${validationFraming.customerOneProfitability ?? '待确认'}。`,
    `- 销售与增长纪律：${validationFraming.growthDiscipline ?? '待确认'}。`,
    `- 结果一般是否容易回退：${validationFraming.reversibility ?? '待确认'}。`,
    `- 更像客户真问题还是自嗨：${validationFraming.customerTruth ?? '待确认'}。`,
    `- 是否符合团队价值观：${validationFraming.valuesFit ?? '待确认'}。`,
  ];
  if (projectFraming.architectureSignals) {
    lines.push(`- 这次更可能会影响：${projectFraming.architectureSignals}。`);
  }
  if (projectFraming.riskProbes?.length > 0) {
    lines.push(`- 我先提醒的业务风险：${projectFraming.riskProbeSummary}。`);
  }
  lines.push(`- ${describeProductLensFocus(productType)}`);
  lines.push('- 判断这轮是否值得做成：看用户是否真的更顺、更快、更稳地完成关键动作。');
  lines.push('');
  lines.push('功能范围：');
  lines.push(...scopeTable);
  lines.push('');
  lines.push('技术方案：');
  lines.push(...technicalTable);
  if (projectContext.activeChange) {
    lines.push('');
    lines.push(`历史提醒：当前还有 ${projectContext.activeChange.activeChange}，本轮先分开处理。`);
  }
  lines.push('');
  if (primaryQuestion) {
    lines.push('我建议这轮先确认这一点：');
    lines.push(`- ${primaryQuestion.prompt}`);
    if (followUpQuestions.length > 0) {
      lines.push('这点定下来后，我再继续补下面这些：');
      for (const item of followUpQuestions) {
        lines.push(`- ${item.prompt}`);
      }
    }
  } else {
    lines.push('我这边暂时没有新的关键追问了。');
  }
  if (directionChoices.length > 0) {
    lines.push('如果你现在还不想展开细节，也可以先在这 3 个方向里选一个：');
    for (const choice of directionChoices) {
      lines.push(`- ${choice}`);
    }
    lines.push('你可以先回一个方向编号，或直接补一句你的倾向。');
    lines.push('我收到后会先整理需求摘要给你确认；确认后再进入 PRD 和评审流程，不会直接跳到实现。');
  } else {
    lines.push('如果以上理解基本对，请先回复“可以”，或直接指出要调整的地方。');
    lines.push('我收到后会先整理需求摘要给你确认；确认后再进入 PRD 和评审流程，不会直接跳到实现。');
  }
  return {
    mode: presentation.mode,
    title: presentation.label,
    estimatedLineCount: presentation.estimatedLineCount,
    lines,
  };
}

async function readActiveChangeHint(projectRoot) {
  const state = await readJson(path.join(projectRoot, '.openprd', 'state', 'changes.json')).catch(() => null);
  const activeChange = state?.activeChange ?? null;
  if (!activeChange) {
    return null;
  }
  return {
    activeChange,
    status: state?.changes?.[activeChange]?.status ?? 'active',
  };
}

function reflectionQuestion(id, label, prompt) {
  return {
    id: `requirement-intake.${id}`,
    title: label,
    label,
    question: prompt,
    prompt,
    reason: 'requirement-intake-reflection',
  };
}

function buildLensReflectionQuestion(productType) {
  if (productType === 'consumer') {
    return reflectionQuestion('product-lens', '用户场景与回访价值', '请确认这次主要服务哪类个人用户、他们第一次会在什么场景下想用它，以及什么结果会让他们愿意继续回来。');
  }
  if (productType === 'b2b') {
    return reflectionQuestion('product-lens', '角色关系与上线阻力', '请确认谁拍板、谁使用、谁负责推进或运营，以及最可能拖慢上线的是哪段协作、审批或对接。');
  }
  if (productType === 'agent') {
    return reflectionQuestion('product-lens', '自主边界与人工兜底', '请确认哪些步骤希望 Agent 自主完成、哪些节点必须人工拍板，以及失败时由谁接住。');
  }
  return reflectionQuestion('product-lens', '用户价值与取舍', '请确认这次最重要的用户价值是什么；如果只能先保一个方向，你更想先保效率、体验，还是风险可控。');
}

function shouldBuildRequirementIntakeReflection({ gate, scenario, analysis }) {
  if (gate?.active) {
    return true;
  }
  if (['cold-start-greenfield', 'cold-start-existing-project'].includes(scenario?.id)) {
    return true;
  }
  return Number(analysis?.missingRequiredFields ?? 0) > 0;
}

async function buildRequirementIntakeReflection({ projectRoot, ws, snapshot, analysis, scenario, gate }) {
  if (!shouldBuildRequirementIntakeReflection({ gate, scenario, analysis })) {
    return null;
  }

  const sections = snapshot.sections ?? {};
  const text = requirementPrompt(gate);
  const promptPreview = text || sections.problem?.problemStatement || snapshot.title || '当前需求待确认';
  const complexity = detectRequirementIntakeComplexity(gate);
  const activeChange = await readActiveChangeHint(projectRoot);
  const productName = snapshot.title || sections.meta?.title || '当前项目';
  const productType = snapshot.productType ?? resolveCurrentProductType(ws) ?? '未分类';
  const currentProblem = sections.problem?.problemStatement || '待补充';
  const currentScope = shortList(sections.scope?.inScope, '当前范围还没有稳定记录');
  const missing = analysis.missingFields.slice(0, 4).map((field) => field.label);
  const needsInterfaceSketch = requirementLooksLikeInterfaceWork(gate);
  const projectFraming = buildProjectFraming({
    gate,
    snapshot,
    scenario,
    productType: snapshot.productType ?? resolveCurrentProductType(ws),
  });
  const lensQuestion = buildLensReflectionQuestion(snapshot.productType ?? resolveCurrentProductType(ws));
  const validationLoopQuestion = reflectionQuestion(
    'validation-loop',
    '验证与创业闭环',
    '请确认第一批最容易触达的社区或用户是谁、你为什么算这个社区里的自己人、他们现在靠什么替代、问题到底有多痛、如果先不做完整产品怎么手工交付、手工作战卡怎么写、什么真实承诺最能证明值得继续，以及最低成本验证和先活下来底线是什么。'
  );
  const mvpAndSalesQuestion = reflectionQuestion(
    'mvp-sales',
    '最小 MVP 与首批成交',
    '请确认第一版到底只做哪一件事、能不能压成周末级 MVP 或更轻试跑、能不能先用 spreadsheet 或 no-code 工具跑起来、第一批客户最现实的触达顺序是什么，以及从第一个客户开始准备怎么收费、有没有 10 个潜在用户样本和更强付费信号、达到什么条件才允许产品化。'
  );
  const minimalistReviewQuestion = reflectionQuestion(
    'minimalist-review',
    '可逆性 / 客户真问题 / 价值观',
    '请确认如果验证结果一般，这条路有多可逆，是否会逼出重招聘、长期绑定或重平台化；这更像在解决客户真问题还是满足内部技术冲动；以及它是否符合团队现在想坚持的价值观、是不是你愿意长期住进去的业务形态。'
  );
  const needsDeliveryShapeQuestion = !needsInterfaceSketch
    && (
      projectFraming.riskProbes.length > 0
      || !containsPendingClarifyMarker(projectFraming.architectureSignals)
    );
  const mustConfirm = complexity.mode === 'deep'
    ? [
        reflectionQuestion('intent', '意图与目标', '请确认我理解得对不对：这次主要是谁在什么场景下遇到什么问题，第一版最想先改善什么结果？'),
        lensQuestion,
        validationLoopQuestion,
        mvpAndSalesQuestion,
        minimalistReviewQuestion,
        reflectionQuestion('project-context', '项目影响范围', '结合当前项目，请确认第一版最小可用切片是什么；哪些已有模块、入口、流程或历史需求必须复用，哪些可以调整？'),
        reflectionQuestion('scope-quality', '范围与验收', '请确认这次先做到哪一步就算有价值；哪些这轮先不动；哪些老用户习惯、现有业务结果或交付节奏不能被影响？'),
        needsInterfaceSketch
          ? reflectionQuestion('interface-sketch', '界面或流程草图', '需求涉及界面或流程，请先确认主要区域、操作入口、预览/确认点和风险提示。')
          : needsDeliveryShapeQuestion
            ? reflectionQuestion('delivery-shape', '影响环节与业务风险', '请确认这次大概会牵动哪些环节，例如用户入口、内部流程、账号与权限、外部对接、AI 自动化或成本控制；其中最大的业务风险是什么。')
            : reflectionQuestion('details-boundary', '关键状态与验收细节', '请确认用户会看到的关键状态、重要字段、例外场景和最小验收标准。'),
      ]
    : [
        reflectionQuestion('project-context', '项目映射', '请确认这个调整具体落在哪个页面、模块、入口或流程，以及第一版先做哪一小块最有价值。'),
        reflectionQuestion('acceptance', '验收方式', '请确认完成后用户能明显感受到什么变化、哪些既有行为不能改变，以及最小验收标准是什么。'),
      ];

  return {
    version: 1,
    active: true,
    mode: complexity.mode,
    label: complexity.label,
    minimumDepth: complexity.minimumDepth,
    questionLimit: gateQuestionLimit(gate, complexity.questionLimit),
    promptPreview,
    reasons: complexity.reasons,
    needsInterfaceSketch,
    projectContext: {
      scenario: scenario.label,
      scenarioReason: scenario.reason,
      productName,
      productType,
      currentProblem,
      currentScope,
      activeChange,
      missingFields: missing,
      projectFraming,
    },
    rounds: [
      {
        id: 'intent-normalization',
        title: '第 1 轮：意图归一化',
        findings: [
          `用户原始输入：${promptPreview}`,
          `初步判断：${complexity.label}`,
          `需要先把表达收敛成用户、产品形态、场景、目标、动作和期望结果。`,
        ],
      },
      {
        id: 'project-context',
        title: '第 2 轮：项目上下文映射',
        findings: [
          `工作区场景：${scenario.label}，${scenario.reason}`,
          `当前产品：${productName}；当前产品场景：${formatProductTypeDisplay(productType, { fallback: '待确认' })}；已记录问题：${currentProblem}`,
          `当前范围线索：${currentScope}`,
          `首轮画像：用户群体=${projectFraming.audience}；产品形态=${projectFraming.productShape}；第一版先做=${projectFraming.firstSlice}`,
          `验证闭环：可触达人群=${projectFraming.validationFraming?.community}；社区契合=${projectFraming.validationFraming?.communityFit}；当前替代=${projectFraming.validationFraming?.currentAlternative}；痛点证据=${projectFraming.validationFraming?.painEvidence}；手工作战卡=${projectFraming.validationFraming?.manualPlaybook}`,
          `最小成交链：一件事 MVP=${projectFraming.validationFraming?.mvpSlice}；周末级验证=${projectFraming.validationFraming?.weekendTest}；最小工具桥接=${projectFraming.validationFraming?.smallestExecution}；产品化门槛=${projectFraming.validationFraming?.productizeGate}`,
          activeChange ? `仍有 active change：${activeChange.activeChange}（${activeChange.status}），需要和本轮需求分开评估。` : '当前没有检测到 active change 冲突。',
        ],
      },
      {
        id: 'product-quality',
        title: '第 3 轮：产品质量自检',
        findings: [
          `仍需确认的信息：${shortList(missing, '暂无明显缺口')}`,
          `边界与约束：先不做=${projectFraming.nonGoals}；不能破坏=${projectFraming.guardrails}`,
          `商业验证：承诺信号=${projectFraming.validationFraming?.commitmentSignals}；低成本验证=${projectFraming.validationFraming?.firstValidationStep}；先活下来=${projectFraming.validationFraming?.defaultAlivePlan}；付费验证=${projectFraming.validationFraming?.paymentProof}；初始收费=${projectFraming.validationFraming?.pricingHypothesis}；客户 1 盈利=${projectFraming.validationFraming?.customerOneProfitability}；增长纪律=${projectFraming.validationFraming?.growthDiscipline}`,
          `极简判断：最小工具桥接=${projectFraming.validationFraming?.smallestExecution}；产品化门槛=${projectFraming.validationFraming?.productizeGate}；可逆性=${projectFraming.validationFraming?.reversibility}；客户真问题=${projectFraming.validationFraming?.customerTruth}；价值观一致性=${projectFraming.validationFraming?.valuesFit}`,
          needsInterfaceSketch ? '需求看起来涉及界面或流程，需要先给用户确认草图或关键操作路径。' : `影响环节：${projectFraming.architectureSignals}`,
          `业务提醒：${projectFraming.riskProbeSummary}`,
          '进入实现前必须保留范围、非目标、异常路径和验收证据。',
        ],
      },
    ],
    mustConfirm,
  };
}

function renderRequirementIntakeReflection(reflection) {
  if (!reflection?.active) {
    return '# 需求入口自省\n\n- 当前没有 active requirement intake。\n';
  }
  const lines = [
    '# 需求入口自省',
    '',
    `- 模式: ${reflection.label}`,
    `- 用户输入: ${reflection.promptPreview || '待补充'}`,
    `- 复杂度依据: ${shortList(reflection.reasons, '未命中复杂度提示')}`,
    '',
    '## 项目上下文',
    '',
    `- 工作区场景: ${reflection.projectContext.scenario}`,
    `- 当前产品: ${reflection.projectContext.productName}；产品场景: ${formatProductTypeDisplay(reflection.projectContext.productType, { fallback: '待确认' })}`,
    `- 当前问题: ${reflection.projectContext.currentProblem}`,
    `- 当前范围: ${reflection.projectContext.currentScope}`,
    reflection.projectContext.activeChange ? `- 历史 active change: ${reflection.projectContext.activeChange.activeChange}` : '- 历史 active change: 无',
    '',
    '## 首轮项目画像',
    '',
    '| 模块 | 当前理解 |',
    '|---|---|',
    `| 用户群体 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.audience ?? '待补充')} |`,
    `| 产品形态 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.productShape ?? '待补充')} |`,
    `| 第一版先做 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.firstSlice ?? '待补充')} |`,
    `| 暂不处理 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.nonGoals ?? '待补充')} |`,
    `| 不能破坏 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.guardrails ?? '待补充')} |`,
    `| 可触达人群 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.community ?? '待补充')} |`,
    `| 社区契合与触达依据 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.communityFit ?? '待补充')} |`,
    `| 当前替代 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.currentAlternative ?? '待补充')} |`,
    `| 痛点与替代证据 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.painEvidence ?? '待补充')} |`,
    `| 手工路径 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.manualPath ?? '待补充')} |`,
    `| 手工作战卡 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.manualPlaybook ?? '待补充')} |`,
    `| 承诺信号 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.commitmentSignals ?? '待补充')} |`,
    `| 最低成本验证 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.firstValidationStep ?? '待补充')} |`,
    `| 先活下来 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.defaultAlivePlan ?? '待补充')} |`,
    `| 付费验证信号 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.paymentProof ?? '待补充')} |`,
    `| 第一版只做一件事 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.mvpSlice ?? '待补充')} |`,
    `| 周末级验证 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.weekendTest ?? '待补充')} |`,
    `| 最小工具桥接 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.smallestExecution ?? '待补充')} |`,
    `| 产品化门槛 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.productizeGate ?? '待补充')} |`,
    `| 第一批客户路径 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.firstCustomerPath ?? '待补充')} |`,
    `| 初始收费假设 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.pricingHypothesis ?? '待补充')} |`,
    `| 客户 1 盈利路径 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.customerOneProfitability ?? '待补充')} |`,
    `| 销售与增长纪律 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.growthDiscipline ?? '待补充')} |`,
    `| 可逆性判断 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.reversibility ?? '待补充')} |`,
    `| 客户真问题校验 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.customerTruth ?? '待补充')} |`,
    `| 价值观一致性 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.validationFraming?.valuesFit ?? '待补充')} |`,
    `| 影响环节 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.architectureSignals ?? '待补充')} |`,
    `| 业务提醒 | ${escapeMarkdownTableCell(reflection.projectContext.projectFraming?.riskProbeSummary ?? '待补充')} |`,
    '',
  ];
  for (const round of reflection.rounds) {
    lines.push(`## ${round.title}`, '');
    for (const finding of round.findings) {
      lines.push(`- ${finding}`);
    }
    lines.push('');
  }
  lines.push('## 必须确认的问题', '');
  for (const question of reflection.mustConfirm) {
    lines.push(`- ${question.label}: ${question.prompt}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function writeRequirementIntakeReflection(ws, reflection) {
  if (!reflection?.active) {
    return null;
  }
  const reflectionPath = path.join(ws.workspaceRoot, 'engagements', 'active', 'intake-reflection.md');
  await writeText(reflectionPath, renderRequirementIntakeReflection(reflection));
  return reflectionPath;
}

function buildRequirementIntakeDepth(gate, reflection = null) {
  const needsInterfaceSketch = requirementLooksLikeInterfaceWork(gate);
  const fallbackLayers = [
    reflectionQuestion('product-context', '用户 / 产品形态 / 问题', '先确认：这是给谁用的、它更像个人产品 / 团队流程 / Agent 协作中的哪一种、为什么现在值得解决？'),
    reflectionQuestion('product-outcome', '第一版切片 / 目标 / 成功标准', '请确认第一版最小可用切片是什么；解决后用户先能完成什么，用什么业务结果或验收标准判断有效？'),
    reflectionQuestion('product-validation', '验证闭环 / 承诺信号', '请确认第一批最容易触达的社区或用户是谁、你为什么算这个社区里的自己人、他们现在靠什么替代、问题到底有多痛、如果先不做完整产品怎么手工交付、手工作战卡怎么写、什么真实承诺最能证明值得继续，以及最低成本验证和先活下来底线是什么。'),
    reflectionQuestion('product-mvp-sales', '最小 MVP / 首批成交', '请确认第一版到底只做哪一件事、能不能压成周末级 MVP 或更轻试跑、第一批客户最现实的触达顺序是什么，以及从第一个客户开始准备怎么收费、怎么验证客户 1 也能打平时间和交付成本。'),
    reflectionQuestion('product-minimalist-review', '可逆性 / 客户真问题 / 价值观', '请确认如果验证结果一般，这条路有多可逆；这更像在解决客户真问题还是满足内部技术冲动；以及它是否符合团队现在想坚持的价值观、是不是你愿意长期住进去的业务形态。'),
    reflectionQuestion('product-flow', '范围 / 非目标 / 异常路径', '请拆出本轮先做什么、不做什么、哪些既有行为不能被破坏，以及关键失败路径和恢复方式。'),
    reflectionQuestion(
      'product-detail',
      needsInterfaceSketch ? '界面草图 / 字段 / 状态' : '细节 / 状态 / 边界',
      needsInterfaceSketch
        ? '这个需求涉及界面，请先给用户一版 ASCII 线框草图，标出主要区域、操作入口、预览/确认点和风险提示，让用户确认后再 synthesize。'
        : '请补齐用户会看到的关键状态、重要字段、业务边界和可验收细节；如果后续发现涉及界面，也要先补 ASCII 线框草图。'
    ),
  ];
  const layers = reflection?.mustConfirm?.length > 0 ? reflection.mustConfirm : fallbackLayers;
  return {
    active: true,
    mode: reflection?.mode ?? 'deep',
    label: reflection?.label ?? '需求入口深挖',
    minimumDepth: reflection?.minimumDepth ?? 3,
    questionLimit: gateQuestionLimit(gate, reflection?.questionLimit ?? 6),
    needsInterfaceSketch,
    promptPreview: gate?.promptPreview ?? '',
    reflection,
    layers,
  };
}

function applyRequirementIntakeDepth(clarification, gate, reflection = null, options = {}) {
  if (!gate?.active) {
    return clarification;
  }

  const requirementIntake = buildRequirementIntakeDepth(gate, reflection);
  if (options.satisfied) {
    return {
      ...clarification,
      requirementIntake: {
        ...requirementIntake,
        satisfied: true,
      },
      shouldAskUser: false,
    };
  }
  const existingIds = new Set(clarification.mustAskUser.map((item) => item.id));
  const depthQuestions = requirementIntake.layers
    .filter((item) => !existingIds.has(item.id));

  if (!clarification.shouldAskUser && clarification.mustAskUser.length === 0 && depthQuestions.length === 0) {
    return {
      ...clarification,
      requirementIntake: {
        ...requirementIntake,
        satisfied: true,
      },
    };
  }

  const combined = [...depthQuestions, ...clarification.mustAskUser];
  const mustAskUser = combined.slice(0, requirementIntake.questionLimit);
  const deferred = combined.slice(requirementIntake.questionLimit).map((item) => ({
    id: item.id,
    label: item.label,
    prompt: item.prompt,
  }));

  return {
    ...clarification,
    requirementIntake,
    mustAskUser,
    canInferLater: [...deferred, ...clarification.canInferLater],
    shouldAskUser: true,
  };
}

function parseArtifactFrontmatter(text) {
  if (!text.startsWith('---\n')) {
    throw new Error('Artifact markdown is missing frontmatter.');
  }
  const end = text.indexOf('\n---', 4);
  if (end < 0) {
    throw new Error('Artifact markdown frontmatter is not closed.');
  }
  return parseYamlText(text.slice(4, end));
}

function buildPlaygroundState(snapshot) {
  const sections = snapshot.sections ?? {};
  return {
    problemStatement: sections.problem?.problemStatement ?? '',
    goals: [...(sections.goals?.goals ?? [])],
    successMetrics: [...(sections.goals?.successMetrics ?? [])],
    inScope: [...(sections.scope?.inScope ?? [])],
    outOfScope: [...(sections.scope?.outOfScope ?? [])],
    primaryFlows: [...(sections.scenarios?.primaryFlows ?? [])],
    openQuestions: [...(sections.risks?.openQuestions ?? [])],
  };
}

async function getPrdReviewState(ws, latestSnapshot = null) {
  const currentState = ws.data.currentState ?? {};
  const latestVersionId = latestSnapshot?.versionId ?? currentState.latestVersionId ?? null;
  const stored = currentState.reviewStatus ?? null;
  const reviewPath = stored?.reviewPath
    ?? stored?.stableArtifact
    ?? (latestVersionId ? canonicalReviewPath(ws, latestVersionId) : null);
  const entryPath = stored?.entryPath ?? stored?.artifact ?? defaultReviewArtifactPath(ws);
  const artifactExists = reviewPath ? await exists(reviewPath) : false;
  const status = stored?.versionId === latestVersionId
    ? normalizePrdReviewStatus(stored.status)
    : (artifactExists ? 'pending-confirmation' : 'missing');
  let reason = '最新 PRD 评审产物已确认。';
  if (!artifactExists) {
    const presentationGate = latestSnapshot ? getReviewPresentationGate(latestSnapshot) : null;
    reason = presentationGate && !presentationGate.ok
      ? '缺少已通过脚本校验的评审展示文案，先运行 openprd review-presentation 写入后再生成可确认评审页。'
      : '缺少最新 PRD 评审文件，freeze 前需要重新生成可评审产物。';
  } else if (status === 'pending-confirmation') {
    reason = '最新 PRD 评审文件尚未标记为用户已确认。';
  } else if (status === 'needs-revision') {
    reason = '最新 PRD 评审文件已标记为需要修改，不能直接 freeze。';
  }
  return {
    versionId: latestVersionId,
    status,
    artifactExists,
    artifact: reviewPath,
    entryArtifact: entryPath,
    shouldGateFreeze: Boolean(latestVersionId) && (!artifactExists || status !== 'confirmed'),
    reason,
    updatedAt: stored?.updatedAt ?? null,
    notes: stored?.notes ?? null,
  };
}

async function synthesizeWorkspace(projectRoot, overrides = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }
  const requirementGate = await readActiveRequirementGate(projectRoot);
  ensureFreshRequirementStateForSynthesize({
    gate: requirementGate,
    currentState: ws.data.currentState ?? {},
    overrides,
  });
  if (requirementGate?.active && gateHasClarificationConfirmation(requirementGate)) {
    await ensureRequirementLaneReadyForSynthesize(ws);
  }

  const versionIndex = await readVersionIndex(ws);
  const nextVersionNumber = overrides.versionNumber ?? (versionIndex.length > 0
    ? Math.max(...versionIndex.map((entry) => Number(entry.versionNumber) || 0)) + 1
    : 1);
  const versionId = overrides.versionId ?? formatVersionId(nextVersionNumber);
  const createdAt = overrides.createdAt ?? timestamp();
  const workUnitId = normalizeWorkUnitId(overrides.workUnit ?? overrides.workUnitId) ?? generateWorkUnitId();
  const targetRoot = resolveTargetRoot(ws, overrides.targetRoot);
  const baseCurrentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
    },
  };
  if (shouldDropInheritedReviewPresentationFromOverrides(overrides)) {
    dropInheritedReviewPresentation(baseCurrentState);
  }
  const snapshot = buildPrdSnapshot({ ...ws, data: { ...ws.data, currentState: baseCurrentState } }, {
    ...overrides,
    versionNumber: nextVersionNumber,
    versionId,
    createdAt,
    workUnitId,
    targetRoot,
    productType: overrides.productType ?? resolveCurrentProductType(ws),
    templatePack: overrides.templatePack ?? resolveActiveTemplatePack(ws),
  });

  snapshot.content = renderPrdMarkdown(snapshot);
  snapshot.digest = crypto.createHash('sha256').update(snapshot.content).digest('hex');

  await writeVersionSnapshot(ws, snapshot);

  const indexEntry = summarizeSnapshot(snapshot);
  await writeVersionIndex(ws, [...versionIndex, indexEntry]);

  await writeText(ws.paths.activePrd, snapshot.content);
  await writeText(ws.paths.activeFlows, renderFlowDoc(snapshot));
  await writeText(ws.paths.activeRoles, renderRolesDoc(snapshot));
  await writeText(ws.paths.activeHandoff, renderHandoffDoc(snapshot));
  const presentationGate = getReviewPresentationGate(snapshot);
  const reviewFiles = presentationGate.ok
    ? await writeReviewFiles(ws, snapshot)
    : {
        canonicalReview: canonicalReviewPath(ws, snapshot.versionId),
        activeReviewEntry: defaultReviewArtifactPath(ws),
      };
  if (!presentationGate.ok) {
    await removeReviewFiles(reviewFiles);
    reviewFiles.activeReviewEntry = null;
  }
  const workUnit = await writeWorkUnitBinding(ws, {
    snapshot,
    reviewPath: reviewFiles.canonicalReview,
    activeReviewPath: reviewFiles.activeReviewEntry,
    targetRoot,
  });
  if (overrides.open && presentationGate.ok) {
    await openArtifactInBrowser(reviewFiles.canonicalReview);
  }
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(snapshot));
  await appendWorkflowEvent(ws, 'synthesized', {
    versionId: snapshot.versionId,
    versionNumber: snapshot.versionNumber,
    productType: snapshot.productType,
    reviewArtifact: presentationGate.ok ? reviewFiles.canonicalReview : null,
    reviewPresentationRequired: !presentationGate.ok,
  });
  await appendDecision(ws, [
    `已整理出一版可确认的需求稿。`,
    `产品场景: ${formatProductTypeDisplay(snapshot.productType, { fallback: '待确认' })}。`,
    `场景模板: ${formatTemplatePackDisplay(snapshot.templatePack, { fallback: '待确认' })}。`,
  ]);
  await appendProgress(ws, [
    '已生成新的需求确认稿。',
    '已同步更新当前需求、流程、角色和交接说明。',
    presentationGate.ok
      ? `已生成可确认评审面板: ${reviewFiles.canonicalReview}。`
      : '评审面板暂未生成：需要先通过 openprd review-presentation 写入展示文案。',
  ]);

  const currentState = syncCurrentSnapshotCache({
    ...baseCurrentState,
    captureMeta: {
      ...baseCurrentState.captureMeta,
      ...(overrides.title ? { 'meta.title': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.owner ? { 'meta.owner': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.problemStatement ? { 'problem.problemStatement': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.whyNow ? { 'problem.whyNow': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.evidence ? { 'problem.evidence': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
      ...(overrides.productType ? { 'meta.productType': { source: 'user-confirmed', capturedAt: timestamp() } } : {}),
    },
    status: 'synthesized',
    prdVersion: snapshot.versionNumber,
    latestVersionId: snapshot.versionId,
    latestVersionDigest: snapshot.digest,
    activeWorkUnitId: snapshot.workUnitId,
    targetRoot,
    reviewStatus: {
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId,
      status: 'pending-confirmation',
      reviewPath: reviewFiles.canonicalReview,
      entryPath: reviewFiles.activeReviewEntry,
      artifact: reviewFiles.activeReviewEntry,
      stableArtifact: reviewFiles.canonicalReview,
      updatedAt: snapshot.createdAt,
    },
    title: snapshot.title,
    owner: snapshot.owner,
    productType: snapshot.productType,
    templatePack: snapshot.templatePack,
    synthesizedAt: snapshot.createdAt,
  }, snapshot);
  const storedCurrentState = await persistWorkspaceCurrentState(ws, currentState);
  const nextWs = { ...ws, data: { ...ws.data, currentState: storedCurrentState } };
  await syncSessionBindingFromSnapshot(projectRoot, snapshot, {
    sessionId: ws.data.currentSessionId ?? null,
    reviewStatus: 'pending-confirmation',
    reviewPath: reviewFiles.canonicalReview,
    activeReviewPath: reviewFiles.activeReviewEntry,
    targetRoot,
  });

  return {
    ws: nextWs,
    snapshot,
    currentState: storedCurrentState,
    indexEntry,
    versionIndex: [...versionIndex, indexEntry],
    reviewArtifact: reviewFiles.activeReviewEntry,
    stableReviewArtifact: reviewFiles.canonicalReview,
    reviewPath: reviewFiles.canonicalReview,
    reviewEntryPath: reviewFiles.activeReviewEntry,
    reviewPresentationRequired: !presentationGate.ok,
    reviewPresentationGate: presentationGate,
    workUnitId: snapshot.workUnitId,
    workUnit,
    opened: Boolean(overrides.open && presentationGate.ok),
  };
}

async function diffWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const index = await readVersionIndex(ws);
  if (index.length === 0) {
    throw new Error('No synthesized PRD versions exist yet. Run openprd synthesize first.');
  }

  const requestedFrom = normalizeVersionId(options.from);
  const requestedTo = normalizeVersionId(options.to);

  const fromEntry = requestedFrom
    ? index.find((entry) => normalizeVersionId(entry.versionId) === requestedFrom)
    : index[index.length - 2] ?? null;
  const toEntry = requestedTo
    ? index.find((entry) => normalizeVersionId(entry.versionId) === requestedTo)
    : index[index.length - 1] ?? null;

  if (!fromEntry || !toEntry) {
    throw new Error('Need at least two PRD versions to diff.');
  }

  const before = await readVersionSnapshot(ws, fromEntry.versionId);
  const after = await readVersionSnapshot(ws, toEntry.versionId);
  if (!before || !after) {
    throw new Error('Unable to read one or both PRD version snapshots.');
  }

  const diff = diffSnapshots(before, after);
  return { ws, before, after, diff };
}

async function reviewWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }
  const requestedVersion = normalizeVersionId(options.version);
  const latest = await loadCurrentLaneSnapshot(ws, {
    fallbackToLatest: !ws.data.currentSessionId || Boolean(requestedVersion),
  });
  const fallbackLatest = latest?.snapshot ? latest : (requestedVersion ? await loadLatestVersionSnapshot(ws) : null);
  const latestSnapshot = fallbackLatest?.snapshot ?? null;
  const snapshot = requestedVersion
    ? await readVersionSnapshot(ws, requestedVersion)
    : latestSnapshot;
  if (!snapshot) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      errors: ['No synthesized PRD version exists yet. Run openprd synthesize first.'],
    };
  }
  if (requestedVersion && normalizeVersionId(snapshot.versionId) !== requestedVersion) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      errors: [`No synthesized PRD version found for ${options.version}.`],
    };
  }

  let requestedWorkUnitId = null;
  try {
    requestedWorkUnitId = normalizeWorkUnitId(options.workUnit ?? options.workUnitId);
  } catch (error) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      versionId: snapshot.versionId,
      errors: [error.message],
    };
  }

  const validationErrors = [];
  if (options.digest && options.digest !== snapshot.digest) {
    validationErrors.push(`确认指纹不匹配：当前稿件与传入参数不是同一版，请重新从确认页面复制这次确认命令。`);
  }
  if (requestedWorkUnitId && snapshot.workUnitId !== requestedWorkUnitId) {
    validationErrors.push('这次确认命令对应的稿件不一致，请重新从当前确认页面复制命令后再执行。');
  }
  if (validationErrors.length > 0) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId ?? null,
      status: 'blocked',
      errors: validationErrors,
    };
  }

  const isLatest = normalizeVersionId(snapshot.versionId) === normalizeVersionId((latestSnapshot ?? snapshot).versionId);
  const presentationGate = getReviewPresentationGate(snapshot);
  if (!presentationGate.ok) {
    return {
      ok: false,
      action: 'review',
      projectRoot,
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId ?? null,
      status: 'blocked',
      errors: presentationGate.errors,
      presentationFeedback: presentationGate.violations,
      requiredCommand: presentationGate.requiredCommand,
    };
  }
  let selectedDesignDirection = null;
  if (options.direction) {
    if (!options.mark) {
      return {
        ok: false,
        action: 'review',
        projectRoot,
        versionId: snapshot.versionId,
        workUnitId: snapshot.workUnitId ?? null,
        status: 'blocked',
        errors: ['--direction 需要配合 --mark 一起使用，例如 --mark confirmed --direction direction-1。'],
      };
    }
    const directions = reviewDesignDirections(snapshot)?.directions ?? [];
    const found = directions.find((item) => `${item?.id ?? ''}`.trim() === `${options.direction}`.trim());
    if (!found) {
      return {
        ok: false,
        action: 'review',
        projectRoot,
        versionId: snapshot.versionId,
        workUnitId: snapshot.workUnitId ?? null,
        status: 'blocked',
        errors: [
          directions.length === 0
            ? '当前版本没有 designDirections 交互方向，无法记录 --direction 选择。'
            : `未找到交互方向 ${options.direction}；可选: ${directions.map((item) => item?.id).filter(Boolean).join(', ')}。`,
        ],
      };
    }
    selectedDesignDirection = {
      id: `${found.id}`.trim(),
      title: `${found.title ?? found.id}`.trim(),
      image: found.image ?? null,
      selectedAt: timestamp(),
    };
  }

  const reviewFiles = await writeReviewFiles(ws, snapshot, { writeEntry: isLatest });
  const bindingBefore = await readWorkUnitBinding(ws, snapshot.workUnitId);
  const before = isLatest
    ? await getPrdReviewState(ws, snapshot)
    : {
        status: normalizePrdReviewStatus(bindingBefore?.status ?? 'pending-confirmation'),
        artifact: reviewFiles.canonicalReview,
      };
  let marked = false;
  let status = before.status;
  let workUnit = bindingBefore;
  if (options.mark) {
    status = normalizePrdReviewStatus(options.mark);
    if (status !== options.mark) {
      throw new Error(`Unsupported review status: ${options.mark}`);
    }
    if (isLatest) {
      const currentState = {
        ...(ws.data.currentState ?? {}),
        activeWorkUnitId: snapshot.workUnitId ?? (ws.data.currentState ?? {}).activeWorkUnitId,
        targetRoot: snapshot.targetRoot ?? (ws.data.currentState ?? {}).targetRoot,
        reviewStatus: {
          versionId: snapshot.versionId,
          workUnitId: snapshot.workUnitId ?? null,
          status,
          reviewPath: reviewFiles.canonicalReview,
          entryPath: reviewFiles.activeReviewEntry,
          artifact: reviewFiles.activeReviewEntry,
          stableArtifact: reviewFiles.canonicalReview,
          updatedAt: timestamp(),
          notes: options.notes ?? null,
          designDirection: selectedDesignDirection
            ?? (ws.data.currentState?.reviewStatus?.versionId === snapshot.versionId
              ? ws.data.currentState?.reviewStatus?.designDirection ?? null
              : null),
        },
      };
      await persistWorkspaceCurrentState(ws, currentState);
    }
    workUnit = await writeWorkUnitBinding(ws, {
      snapshot,
      reviewPath: reviewFiles.canonicalReview,
      activeReviewPath: reviewFiles.activeReviewEntry,
      targetRoot: snapshot.targetRoot,
      status,
    });
    await appendWorkflowEvent(ws, 'review_marked', {
      versionId: snapshot.versionId,
      workUnitId: snapshot.workUnitId ?? null,
      status,
      designDirection: selectedDesignDirection?.id ?? null,
    });
    await appendProgress(ws, [
      `PRD 评审状态: ${status}。`,
      `版本: ${snapshot.versionId}。`,
      snapshot.workUnitId ? `工作单元: ${snapshot.workUnitId}。` : null,
      selectedDesignDirection ? `选定交互方向: ${selectedDesignDirection.id}（${selectedDesignDirection.title}）。` : null,
    ]);
    await syncSessionBindingFromReview(projectRoot, snapshot, {
      sessionId: ws.data.currentSessionId ?? null,
      reviewStatus: status,
      reviewPath: reviewFiles.canonicalReview,
      activeReviewPath: reviewFiles.activeReviewEntry,
      targetRoot: snapshot.targetRoot,
    });
    marked = true;
  }

  const reloaded = await loadWorkspace(projectRoot);
  const after = isLatest
    ? await getPrdReviewState(reloaded, snapshot)
    : {
        status,
        artifactExists: await exists(reviewFiles.canonicalReview),
        artifact: reviewFiles.canonicalReview,
        entryArtifact: null,
      };
  if (options.open && (await exists(reviewFiles.canonicalReview))) {
    await openArtifactInBrowser(reviewFiles.canonicalReview);
  }

  return {
    ok: after.artifactExists,
    action: 'review',
    projectRoot,
    versionId: snapshot.versionId,
    workUnitId: snapshot.workUnitId ?? null,
    status: after.status,
    previousStatus: before.status,
    marked,
    designDirection: selectedDesignDirection ?? null,
    reviewArtifact: after.entryArtifact ?? reviewFiles.activeReviewEntry,
    stableReviewArtifact: after.artifact,
    reviewPath: after.artifact,
    reviewEntryPath: after.entryArtifact ?? reviewFiles.activeReviewEntry,
    workUnit,
    opened: Boolean(options.open && after.artifactExists),
    errors: after.artifactExists ? [] : ['Missing review file. Run openprd synthesize . --open'],
  };
}

async function clarifyWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const snapshot = (await loadCurrentLaneSnapshot(ws, { fallbackToLatest: !ws.data.currentSessionId }))?.snapshot
    ?? buildCurrentStateSnapshot(ws, currentState, versionIndex);

  const analysis = analyzePrdSnapshot(snapshot);
  const basePlan = buildClarificationPlan(snapshot, analysis);
  const scenario = await detectWorkspaceScenario(projectRoot, ws, versionIndex);
  const requirementGate = await readActiveRequirementGate(projectRoot);
  const intakeReflection = await buildRequirementIntakeReflection({
    projectRoot,
    ws,
    snapshot,
    analysis,
    scenario,
    gate: requirementGate,
  });
  const intakeReflectionPath = await writeRequirementIntakeReflection(ws, intakeReflection);
  const prdReviewState = await getPrdReviewState(ws, snapshot);
  const clarification = applyRequirementIntakeDepth(buildClarificationState({
    snapshot,
    analysis,
    basePlan,
    scenario,
    captureMeta: ws.data.currentState?.captureMeta ?? {},
    prdReviewState,
    limit: Number(options.limit ?? 8),
  }), requirementGate, intakeReflection);
  const clarifyPresentation = chooseClarifyPresentation({
    requirementGate,
    clarification,
    reflection: intakeReflection,
    requestedMode: options.mode ?? 'auto',
  });
  const inlineClarification = buildInlineClarification({
    clarification,
    reflection: intakeReflection,
    presentation: clarifyPresentation,
  });

  await appendWorkflowEvent(ws, 'clarify', {
    missingRequiredFields: clarification.missingRequiredFields,
    mustAskUser: clarification.mustAskUser.map((item) => item.id),
    scenario: clarification.scenario.id,
    intakeReflection: intakeReflectionPath ? path.relative(ws.workspaceRoot, intakeReflectionPath) : null,
    presentationMode: clarifyPresentation.mode,
  });
  await appendOpenQuestions(ws, clarification.mustAskUser.map((item) => item.prompt));
  let clarifyHtmlPath = null;
  let clarifyBundle = null;
  if (options.open && clarifyHtmlPath) {
    await openArtifactInBrowser(clarifyHtmlPath);
  }

  return {
    ws,
    snapshot,
    analysis,
    clarification,
    clarifyPresentation,
    inlineClarification,
    clarifyArtifact: clarifyHtmlPath,
    clarifyArtifactBundle: clarifyBundle,
    intakeReflection,
    intakeReflectionPath,
    opened: Boolean(options.open && clarifyHtmlPath),
  };
}

async function playgroundWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const snapshot = (await loadCurrentLaneSnapshot(ws, { fallbackToLatest: !ws.data.currentSessionId }))?.snapshot
    ?? buildCurrentStateSnapshot(ws, currentState, versionIndex);

  const state = buildPlaygroundState(snapshot);
  const bundle = artifactBundlePaths(ws, `${snapshot.versionId}-playground`);
  const markdown = renderPlaygroundMarkdown({ snapshot, state });
  const patch = renderPlaygroundPatch({ state });
  await writeText(bundle.markdown, markdown);
  await writeJson(bundle.patch, patch);
  await writeHtmlArtifact(bundle.html, renderPlaygroundArtifact({
    snapshot,
    state,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
  }));
  await appendWorkflowEvent(ws, 'playground_generated', {
    versionId: snapshot.versionId,
    htmlPath: bundle.html,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
  });
  await appendProgress(ws, [
    `已生成 playground artifact bundle: ${path.relative(ws.workspaceRoot, bundle.dir)}。`,
  ]);
  if (options.open) {
    await openArtifactInBrowser(bundle.html);
  }

  return {
    ws,
    snapshot,
    state,
    htmlPath: bundle.html,
    markdownPath: bundle.markdown,
    patchPath: bundle.patch,
    opened: Boolean(options.open),
  };
}

async function captureWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
  };
  currentState.captureMeta = {
    ...(currentState.captureMeta ?? {}),
  };

  const updates = [];

  if (options.artifactMarkdown) {
    const artifactText = await readText(path.resolve(options.artifactMarkdown));
    const artifact = parseArtifactFrontmatter(artifactText);
    const payload = artifact.capturePatch;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Artifact markdown frontmatter is missing capturePatch.');
    }

    for (const [field, rawEntry] of Object.entries(payload)) {
      const stateKey = FIELD_PATH_TO_STATE_KEY[field];
      if (!stateKey) {
        throw new Error(`Unsupported capture field in artifact markdown: ${field}`);
      }
      const value = rawEntry?.value ?? rawEntry;
      const source = rawEntry?.source ?? options.source;
      const append = rawEntry?.append ?? options.append;
      if (value === null || value === undefined) {
        throw new Error(`Missing capture value in artifact markdown for field: ${field}`);
      }
      updates.push({
        field,
        stateKey,
        value,
        source: CAPTURE_SOURCES.includes(source) ? source : 'user-confirmed',
        append: Boolean(append),
      });
    }
  } else if (options.jsonFile) {
    const payload = await readJson(path.resolve(options.jsonFile));
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Capture JSON file must contain an object at the root');
    }

    for (const [field, rawEntry] of Object.entries(payload)) {
      const stateKey = FIELD_PATH_TO_STATE_KEY[field];
      if (!stateKey) {
        throw new Error(`Unsupported capture field in json file: ${field}`);
      }

      let value = rawEntry;
      let source = options.source;
      let append = Boolean(options.append);

      if (rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) && ('value' in rawEntry || 'source' in rawEntry || 'append' in rawEntry)) {
        value = rawEntry.value;
        source = rawEntry.source ?? source;
        append = rawEntry.append ?? append;
      }

      if (value === null || value === undefined) {
        throw new Error(`Missing capture value in json file for field: ${field}`);
      }

      updates.push({
        field,
        stateKey,
        value,
        source: CAPTURE_SOURCES.includes(source) ? source : 'user-confirmed',
        append: Boolean(append),
      });
    }
  } else {
    const field = options.field?.trim();
    if (!field) {
      throw new Error('Missing required option: --field');
    }
    const stateKey = FIELD_PATH_TO_STATE_KEY[field];
    if (!stateKey) {
      throw new Error(`Unsupported capture field: ${field}`);
    }
    if (options.value === null || options.value === undefined) {
      throw new Error('Missing required option: --value');
    }
    updates.push({
      field,
      stateKey,
      value: options.value,
      source: CAPTURE_SOURCES.includes(options.source) ? options.source : 'user-confirmed',
      append: Boolean(options.append),
    });
  }

  const applied = [];
  for (const update of updates) {
    const nextValue = coerceCapturedValue(update.field, update.value, update.append);

    if (update.append) {
      const prev = currentState[update.stateKey];
      const prevArray = Array.isArray(prev)
        ? prev
        : (prev ? coerceCapturedValue(update.field, prev, true) : []);
      const nextArray = Array.isArray(nextValue) ? nextValue : [nextValue];
      currentState[update.stateKey] = [...prevArray, ...nextArray];
    } else {
      currentState[update.stateKey] = nextValue;
    }

    applied.push({
      field: update.field,
      stateKey: update.stateKey,
      source: update.source,
      value: currentState[update.stateKey],
    });
  }

  currentState.lastCapturedAt = timestamp();
  currentState.status = currentState.status === 'initialized' ? 'clarifying' : (currentState.status ?? 'clarifying');
  for (const update of applied) {
    currentState.captureMeta[update.field] = {
      source: update.source,
      capturedAt: currentState.lastCapturedAt,
    };
  }
  const staleReview = markReviewStateStaleAfterCapture(currentState, applied, currentState.lastCapturedAt);
  const storedCurrentState = await persistWorkspaceCurrentState(ws, currentState);

  const snapshot = buildPrdSnapshot({ ...ws, data: { ...ws.data, currentState: storedCurrentState } }, {
    ...storedCurrentState,
    versionNumber: storedCurrentState.prdVersion ?? 0,
    versionId: storedCurrentState.prdVersion > 0 ? formatVersionId(storedCurrentState.prdVersion) : 'v0000',
    productType: storedCurrentState.productType ?? resolveCurrentProductType(ws),
    templatePack: storedCurrentState.templatePack ?? resolveActiveTemplatePack(ws),
  });
  const analysis = analyzePrdSnapshot(snapshot);
  const diagramState = await getDiagramReviewState({ ...ws, data: { ...ws.data, currentState: storedCurrentState } }, snapshot);
  const updatedWs = { ...ws, data: { ...ws.data, currentState: storedCurrentState } };
  const scenario = await detectWorkspaceScenario(projectRoot, updatedWs, await readVersionIndex(ws));
  const requirementGate = await readActiveRequirementGate(projectRoot);
  const intakeReflection = await buildRequirementIntakeReflection({
    projectRoot,
    ws: updatedWs,
    snapshot,
    analysis,
    scenario,
    gate: requirementGate,
  });
  await writeRequirementIntakeReflection(updatedWs, intakeReflection);
  const prdReviewState = await getPrdReviewState(updatedWs, snapshot);
  const clarification = applyRequirementIntakeDepth(buildClarificationState({
    snapshot,
    analysis,
    basePlan: buildClarificationPlan(snapshot, analysis),
    scenario,
    captureMeta: storedCurrentState.captureMeta,
    prdReviewState,
    limit: 8,
  }), requirementGate, intakeReflection);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(snapshot, analysis, { diagramState, clarificationState: clarification }));
  await appendWorkflowEvent(ws, 'capture', {
    fields: applied.map((item) => item.field),
    sources: applied.map((item) => item.source),
    staleReview,
  });
  await appendDecision(ws, [
    `Captured clarification for ${applied.map((item) => item.field).join(', ')}.`,
  ]);
  await appendProgress(ws, [
    `已更新 ${applied.length} 个字段到当前工作区状态。`,
  ]);

  return {
    ws: { ...ws, data: { ...ws.data, currentState: storedCurrentState } },
    applied,
    artifactMarkdown: options.artifactMarkdown ?? null,
    field: applied[0]?.field ?? null,
    stateKey: applied[0]?.stateKey ?? null,
    value: applied[0]?.value ?? null,
    source: applied[0]?.source ?? null,
    analysis,
  };
}

async function computeWorkspaceGuidance(ws, options = {}) {
  const versionIndex = await readVersionIndex(ws);
  const currentState = ws.data.currentState ?? {};
  const currentProductType = resolveCurrentProductType(ws);
  const currentStatus = currentState.status ?? 'unknown';
  const latestVersion = await loadCurrentLaneSnapshot(ws, { fallbackToLatest: !ws.data.currentSessionId });
  const currentDraftSnapshot = buildCurrentStateSnapshot(ws, {
    ...currentState,
    productType: currentProductType,
    templatePack: resolveActiveTemplatePack(ws),
  }, versionIndex);
  const analysisSnapshot = shouldUseCurrentDraftForGuidance(currentState)
    ? currentDraftSnapshot
    : (latestVersion?.snapshot ?? currentDraftSnapshot);
  const analysis = analyzePrdSnapshot(analysisSnapshot);
  const hasProductType = isSupportedProductType(currentProductType ?? analysis.productType);
  const diagramState = await getDiagramReviewState(ws, analysisSnapshot);
  const prdReviewState = await getPrdReviewState(ws, analysisSnapshot);
  const scenario = await detectWorkspaceScenario(ws.projectRoot, ws, versionIndex);
  const requirementGate = await readActiveRequirementGate(ws.projectRoot);
  const intakeSatisfiedByReview = prdReviewState.status === 'confirmed' && analysis.missingRequiredFields === 0;
  const intakeSatisfiedByConfirmedWriteback = hasSatisfiedConfirmedClarificationWriteback({
    gate: requirementGate,
    currentState,
    analysis,
    hasProductType,
  });
  const intakeSatisfiedByFreshWriteback = hasSatisfiedFreshRequirementWriteback({
    gate: requirementGate,
    currentState,
    analysis,
    hasProductType,
  });
  const intakeReflection = await buildRequirementIntakeReflection({
    projectRoot: ws.projectRoot,
    ws,
    snapshot: analysisSnapshot,
    analysis,
    scenario,
    gate: requirementGate,
  });
  const clarification = applyRequirementIntakeDepth(buildClarificationState({
    snapshot: analysisSnapshot,
    analysis,
    basePlan: buildClarificationPlan(analysisSnapshot, analysis),
    scenario,
    captureMeta: currentState.captureMeta ?? {},
    prdReviewState,
    limit: Number(options.questionLimit ?? 5),
  }), requirementGate, intakeReflection, {
    satisfied: intakeSatisfiedByReview || intakeSatisfiedByConfirmedWriteback || intakeSatisfiedByFreshWriteback,
  });

  let nextAction = 'synthesize';
  let reason = 'PRD 可以合成为第一个版本。';
  let suggestedCommand = 'openprd synthesize .';
  let suggestedQuestions = analysis.suggestedQuestions;

  if (clarification.shouldAskUser) {
    nextAction = 'clarify-user';
    reason = '工作区缺少用户确认的关键信息，需要先澄清再继续合成。';
    suggestedCommand = 'openprd clarify .';
    suggestedQuestions = clarification.mustAskUser.map((item) => item.prompt);
  } else if (!hasProductType) {
    nextAction = 'classify';
    reason = '产品场景尚未锁定。';
    suggestedCommand = 'openprd classify . <consumer|b2b|agent>';
    suggestedQuestions = [formatProductTypeQuestion()];
  } else if (analysis.missingRequiredFields > 0) {
    nextAction = 'interview';
    reason = `仍缺少 ${analysis.missingRequiredFields} 个必填字段。`;
    suggestedCommand = `openprd interview . --product-type ${currentProductType}`;
  } else if (currentStatus === 'frozen') {
    nextAction = 'handoff';
    reason = '最新 PRD 已 freeze，可以交接。';
    suggestedCommand = 'openprd handoff . --target openprd';
    suggestedQuestions = [];
  } else if (currentStatus === 'handed_off') {
    nextAction = versionIndex.length > 1 ? 'diff' : 'history';
    reason = '该工作区已经完成交接。';
    suggestedCommand = nextAction === 'diff' ? 'openprd diff .' : 'openprd history .';
    suggestedQuestions = [];
  } else if (diagramState.shouldGateFreeze && (currentStatus === 'synthesized' || currentState.prdVersion > 0)) {
    nextAction = 'diagram';
    reason = diagramState.reason;
    suggestedCommand = `openprd diagram . --type ${diagramState.preferredType} --open`;
    suggestedQuestions = [
      `这张 ${diagramState.preferredType} 图是否符合预期设计？`,
      '当前可视化表达中还缺少什么，或哪里不准确？',
    ];
  } else if (prdReviewState.shouldGateFreeze && (currentStatus === 'synthesized' || currentState.prdVersion > 0)) {
    nextAction = 'review';
    reason = prdReviewState.reason;
    suggestedCommand = prdReviewState.artifactExists
      ? 'openprd review . --open'
      : (prdReviewState.reason.includes('review-presentation')
          ? 'openprd review-presentation . --template'
          : 'openprd synthesize . --open');
    suggestedQuestions = [
      '这份 PRD 的问题、目标、范围、主流程、失败路径和风险是否符合你的理解？',
      '如果已经确认，请运行 openprd review . --mark confirmed；如果需要修改，请运行 openprd review . --mark needs-revision。',
    ];
  } else if (currentStatus === 'synthesized' || currentState.prdVersion > 0) {
    nextAction = 'freeze';
    reason = '已有版本化 PRD，交接前应先 freeze。';
    suggestedCommand = 'openprd freeze .';
    suggestedQuestions = [];
  }

  const taskGraph = buildWorkflowTaskGraph(analysisSnapshot, analysis, { diagramState, prdReviewState, clarificationState: clarification });
  const gates = deriveGateLabels({ nextAction, diagramState, clarification });
  const brainstormSuggestion = buildBrainstormSuggestion({
    currentState,
    analysis,
    clarification,
    requirementGate,
  });

  return {
    versionIndex,
    currentState,
    analysisSnapshot,
    analysis,
    diagramState,
    prdReviewState,
    clarification,
    taskGraph,
    nextAction,
    reason,
    suggestedCommand,
    suggestedQuestions,
    gates,
    brainstormSuggestion,
  };
}


async function nextWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const guidance = await computeWorkspaceGuidance(ws, { questionLimit: 5 });
  const {
    versionIndex,
    currentState,
    analysisSnapshot,
    analysis,
    diagramState,
    prdReviewState,
    clarification,
    taskGraph,
    nextAction,
    reason,
    suggestedCommand,
    suggestedQuestions,
    gates,
  } = guidance;

  await writeJson(ws.paths.taskGraph, taskGraph);
  await appendWorkflowEvent(ws, 'next', {
    nextAction,
    reason,
    missingRequiredFields: analysis.missingRequiredFields,
  });
  if (analysis.missingRequiredFields > 0) {
    await appendOpenQuestions(ws, [
      `还有 ${analysis.missingRequiredFields} 个关键信息需要确认。`,
      ...analysis.suggestedQuestions,
    ]);
  }
  await appendProgress(ws, [
    `建议下一步: ${nextAction}。`,
    `原因: ${reason}`,
  ]);

  return {
    ws,
    currentState,
    versionIndex,
    analysisSnapshot,
    analysis,
    diagramState,
    prdReviewState,
    clarification,
    taskGraph,
    gates,
    recommendation: {
      nextAction,
      reason,
      suggestedCommand,
      suggestedQuestions,
      currentGate: gates.currentGate,
      upcomingGate: gates.upcomingGate,
    },
    brainstormSuggestion: guidance.brainstormSuggestion,
    workflow: ['brainstorm', 'clarify', 'classify', 'interview', 'synthesize', 'diagram', 'review', 'freeze', 'handoff'],
  };
}

async function historyWorkspace(projectRoot) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const index = await readVersionIndex(ws);
  return { ws, versions: index };
}

async function classifyWorkspace(projectRoot, productType) {
  if (!isSupportedProductType(productType)) {
    throw new Error(`Unsupported product type: ${productType}`);
  }

  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    captureMeta: {
      ...((ws.data.currentState ?? {}).captureMeta ?? {}),
      'meta.productType': {
        source: 'user-confirmed',
        capturedAt: timestamp(),
      },
    },
    status: 'classified',
    productType,
    templatePack: productType,
    classifiedAt: timestamp(),
  };
  const storedCurrentState = await persistWorkspaceCurrentState(ws, currentState);
  await appendWorkflowEvent(ws, 'classified', { productType });
  await appendDecision(ws, [
    `已锁定产品场景为 ${formatProductTypeDisplay(productType, { fallback: productType })}。`,
    `场景模板已设置为 ${formatTemplatePackDisplay(productType, { fallback: productType })}。`,
  ]);
  await appendProgress(ws, [
    `已将工作区产品场景锁定为 ${formatProductTypeDisplay(productType, { fallback: productType })}。`,
  ]);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(storedCurrentState));

  return { ws: { ...ws, data: { ...ws.data, currentState: storedCurrentState } }, currentState: storedCurrentState };
}

async function interviewWorkspace(projectRoot, requestedType = null) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  if (requestedType && !isSupportedProductType(requestedType)) {
    throw new Error(`Unsupported product type: ${requestedType}`);
  }

  const productType = requestedType ?? resolveCurrentProductType(ws);
  const sourceFiles = [ws.paths.baseIntake];
  if (productType === 'consumer') sourceFiles.push(ws.paths.consumerIntake);
  if (productType === 'b2b') sourceFiles.push(ws.paths.b2bIntake);
  if (productType === 'agent') sourceFiles.push(ws.paths.agentIntake);

  const sourceContent = [];
  for (const sourceFile of sourceFiles) {
    const rel = path.relative(ws.workspaceRoot, sourceFile);
    const content = await readText(sourceFile);
    sourceContent.push(`## ${rel}

${content}`);
  }

  const currentState = {
    ...(ws.data.currentState ?? {}),
    status: 'interviewing',
    productType: productType ?? ws.data.currentState?.productType ?? null,
    templatePack: productType ?? resolveActiveTemplatePack(ws),
    interviewStartedAt: timestamp(),
  };
  const storedCurrentState = await persistWorkspaceCurrentState(ws, currentState);
  await appendWorkflowEvent(ws, 'interview_started', {
    productType: currentState.productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
  });
  await appendProgress(ws, [
    `已加载 ${formatProductTypeDisplay(productType, { fallback: '待确认' })} 的访谈问题。`,
    `来源文件: ${sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)).join(', ')}`,
  ]);
  const openQuestions = [
    '这次主要是给谁用的，他们在什么场景下最卡？',
    '第一版最值得先让用户完成什么关键动作？',
    '这轮先不做什么，哪些既有体验、流程或业务结果不能被影响？',
  ];
  if (productType === 'consumer') {
    openQuestions.push('什么结果会让用户愿意继续回来，甚至愿意推荐或付费？');
  } else if (productType === 'b2b') {
    openQuestions.push('谁拍板、谁使用、谁推进或运营，这几方最容易卡在哪里？');
  } else if (productType === 'agent') {
    openQuestions.push('哪些步骤让 Agent 自主做，哪些节点必须保留人工确认或兜底？');
  } else {
    openQuestions.push('如果现在还不想讲太细，先确认最重要的用户价值、边界和风险也可以。');
  }
  openQuestions.push('如果涉及账号、数据、外部对接、AI 或成本，最大的业务风险是什么？');
  await appendOpenQuestions(ws, openQuestions);
  await writeJson(ws.paths.taskGraph, buildWorkflowTaskGraph(storedCurrentState));

  return {
    ws: { ...ws, data: { ...ws.data, currentState: storedCurrentState } },
    productType,
    sourceFiles: sourceFiles.map((filePath) => path.relative(ws.workspaceRoot, filePath)),
    transcript: sourceContent.join('\n\n---\n\n'),
    currentState: storedCurrentState,
  };
}


export {
  captureWorkspace,
  clarifyWorkspace,
  classifyWorkspace,
  computeWorkspaceGuidance,
  diffWorkspace,
  historyWorkspace,
  interviewWorkspace,
  nextWorkspace,
  playgroundWorkspace,
  reviewWorkspace,
  synthesizeWorkspace
};
