import { createHash } from 'node:crypto';

export const REVIEW_MODEL_SCHEMA = 'openprd.review-model.v1';
export const REVIEW_PROJECTION_SCHEMA = 'openprd.review-projection.v1';
export const REVIEW_APPROVAL_SCHEMA = 'openprd.review-approval.v1';

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function optionalText(value) {
  return text(value) || null;
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableValue(value[key])]),
  );
}

export function reviewModelDigest(value) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function normalizePanelItem(item) {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const summary = optionalText(item.summary ?? item.title ?? item.label);
    const detail = optionalText(item.detail ?? item.text ?? item.value);
    if (!summary && !detail) return null;
    return { summary, detail: detail ?? summary };
  }
  const detail = optionalText(item);
  return detail ? { summary: null, detail } : null;
}

function panelItems(presentation, kind, fallback) {
  const source = Array.isArray(presentation.panels?.[kind])
    ? presentation.panels[kind]
    : fallback;
  return source.map(normalizePanelItem).filter(Boolean);
}

function normalizeDirection(direction, index) {
  const item = record(direction);
  const id = optionalText(item.id) ?? `direction-${index + 1}`;
  return {
    id,
    title: optionalText(item.title) ?? `方向 ${index + 1}`,
    summary: optionalText(item.summary),
    tradeoff: optionalText(item.tradeoff),
    imageRef: optionalText(item.image),
    imageDigest: optionalText(item.imageDigest ?? item.checksum),
  };
}

function normalizePresentationDiagram(presentation) {
  const diagram = record(presentation.diagram);
  const mapNodes = record(presentation.mapNodes);
  const normalizeMapNode = (key) => {
    const node = record(mapNodes[key]);
    const title = optionalText(node.title ?? node.label);
    const body = optionalText(node.text ?? node.value);
    return title || body ? { title, text: body } : null;
  };
  const normalizedMapNodes = Object.fromEntries(
    ['problem', 'goal', 'scope', 'flow', 'risk']
      .map((key) => [key, normalizeMapNode(key)])
      .filter(([, value]) => value),
  );
  const flowNodes = Array.isArray(presentation.flowNodes)
    ? presentation.flowNodes.map((node, index) => {
        const item = record(node);
        return {
          id: optionalText(item.id ?? item.key) ?? `step${index + 1}`,
          text: optionalText(item.text ?? item.value),
        };
      }).filter((node) => node.text)
    : [];
  const flowEdges = Array.isArray(presentation.flowEdges)
    ? presentation.flowEdges.map((edge) => {
        const item = record(edge);
        return {
          from: optionalText(item.from ?? item.fromId ?? item.source ?? item.sourceId),
          to: optionalText(item.to ?? item.toId ?? item.target ?? item.targetId),
        };
      }).filter((edge) => edge.from && edge.to)
    : [];
  return {
    type: diagram.type === 'flow' ? 'flow' : 'map',
    mapNodes: normalizedMapNodes,
    flowNodes,
    flowEdges,
  };
}

function reviewStatus(snapshot) {
  const status = snapshot.reviewStatus;
  if (typeof status === 'string') return status || 'pending-confirmation';
  return optionalText(record(status).status) ?? 'pending-confirmation';
}

function selectedDirectionId(snapshot) {
  const status = record(snapshot.reviewStatus);
  const direction = record(status.designDirection);
  return optionalText(direction.id ?? status.direction ?? snapshot.selectedDirectionId);
}

function buildDecisionTimeline({ status, directions, selectedDirection }) {
  const confirmed = status === 'confirmed' || status === 'approved';
  const directionDone = Boolean(selectedDirection);
  return [
    { id: 'clarify', title: '需求澄清', status: 'done' },
    { id: 'summary', title: '需求摘要', status: 'done' },
    {
      id: 'review',
      title: '评审确认',
      status: confirmed ? 'done' : 'current',
    },
    ...(directions.length > 0
      ? [{
          id: 'direction',
          title: '方向选择',
          status: directionDone ? 'done' : confirmed ? 'current' : 'pending',
        }]
      : []),
    {
      id: 'tasks',
      title: '任务拆解',
      status: confirmed && (directions.length === 0 || directionDone) ? 'current' : 'pending',
    },
    { id: 'implementation', title: '实现执行', status: 'pending' },
    { id: 'verification', title: '验证收口', status: 'pending' },
  ];
}

function normalizeEvidenceItem(item, kind, index) {
  const candidate = record(item);
  const summary = optionalText(
    typeof item === 'string'
      ? item
      : candidate.summary ?? candidate.detail ?? candidate.text ?? candidate.value ?? candidate.description,
  );
  if (!summary) return null;
  const label = optionalText(candidate.label ?? candidate.title) ?? `依据 ${index + 1}`;
  const href = optionalText(candidate.href ?? candidate.path ?? candidate.file ?? candidate.url);
  const source = optionalText(candidate.source ?? candidate.authority);
  const stableId = optionalText(candidate.id)
    ?? `${kind}-${reviewModelDigest({ kind, label, summary, href }).slice(0, 10)}`;
  return {
    id: stableId.replace(/[^a-zA-Z0-9._-]+/g, '-'),
    kind,
    label,
    summary,
    href,
    source,
  };
}

function buildEvidenceReferences(snapshot, sections) {
  const sources = [
    ['problem', sections.problem?.evidence],
    ['validation', sections.validation?.painEvidence],
    ['artifact', snapshot.evidenceRefs],
    ['artifact', snapshot.evidence],
  ];
  const references = [];
  for (const [kind, items] of sources) {
    const entries = Array.isArray(items) ? items : items == null ? [] : [items];
    entries.forEach((item) => {
      const normalized = normalizeEvidenceItem(item, kind, references.length);
      if (normalized && !references.some((entry) => entry.id === normalized.id)) {
        references.push(normalized);
      }
    });
  }
  return references;
}

function normalizeTaskReference(item, index) {
  const candidate = record(item);
  if (typeof item === 'string') {
    return { id: `task-${index + 1}`, title: text(item), status: null, files: [] };
  }
  const id = optionalText(candidate.id ?? candidate.taskId) ?? `task-${index + 1}`;
  const title = optionalText(candidate.title ?? candidate.summary ?? candidate.name) ?? id;
  return {
    id,
    title,
    status: optionalText(candidate.status),
    files: unique([
      ...list(candidate.files),
      ...list(candidate.writeSet),
      ...list(candidate.paths),
    ]),
  };
}

function buildTaskReferences(snapshot) {
  const taskGraph = record(snapshot.taskGraph);
  const candidates = Array.isArray(snapshot.tasks)
    ? snapshot.tasks
    : Array.isArray(taskGraph.tasks)
      ? taskGraph.tasks
      : [];
  return candidates.map(normalizeTaskReference).filter((item) => item.title);
}

function buildFileReferences(snapshot, taskReferences, evidenceReferences) {
  return unique([
    ...taskReferences.flatMap((task) => task.files),
    ...evidenceReferences.map((item) => item.href).filter((href) => href && !/^[a-z][a-z0-9+.-]*:/iu.test(href)),
    ...list(snapshot.files),
  ]);
}

function buildReviewCore(snapshot) {
  const safeSnapshot = record(snapshot);
  const sections = record(safeSnapshot.sections);
  const presentation = record(safeSnapshot.reviewPresentation);
  const requirements = record(sections.requirements);
  const constraints = record(sections.constraints);
  const scenarios = record(sections.scenarios);
  const risks = record(sections.risks);
  const guardrails = record(sections.businessGuardrails);
  const goals = record(sections.goals);
  const directionsBlock = record(presentation.designDirections);
  const directions = Array.isArray(directionsBlock.directions)
    ? directionsBlock.directions.map(normalizeDirection)
    : [];
  const status = reviewStatus(safeSnapshot);
  const selectedDirection = selectedDirectionId(safeSnapshot);
  const evidenceReferences = buildEvidenceReferences(safeSnapshot, sections);
  const taskReferences = buildTaskReferences(safeSnapshot);
  const fileReferences = buildFileReferences(safeSnapshot, taskReferences, evidenceReferences);
  const primaryFlows = list(scenarios.primaryFlows);
  const edgeCases = list(scenarios.edgeCases);
  const failureModes = list(scenarios.failureModes);
  const functional = list(requirements.functional);
  const nonFunctional = list(requirements.nonFunctional);
  const dependencies = list(constraints.dependencies);

  return {
    schema: REVIEW_MODEL_SCHEMA,
    source: {
      versionId: optionalText(safeSnapshot.versionId),
      snapshotDigest: optionalText(safeSnapshot.digest),
      workUnitId: optionalText(safeSnapshot.workUnitId),
      targetRoot: optionalText(safeSnapshot.targetRoot),
    },
    title: optionalText(safeSnapshot.title) ?? 'PRD 评审',
    status,
    selectedDirectionId: selectedDirection,
    timeline: buildDecisionTimeline({ status, directions, selectedDirection }),
    overview: {
      problem: optionalText(sections.problem?.problemStatement) ?? '尚未形成明确问题定义',
      whyNow: optionalText(sections.problem?.whyNow),
      goals: list(goals.goals),
      successMetrics: list(goals.successMetrics),
    },
    scope: {
      included: list(sections.scope?.inScope),
      excluded: list(sections.scope?.outOfScope),
    },
    journey: {
      primary: primaryFlows,
      boundaries: edgeCases,
      recovery: failureModes,
    },
    diagram: normalizePresentationDiagram(presentation),
    panels: {
      flow: panelItems(presentation, 'flow', [...primaryFlows, ...edgeCases, ...failureModes]),
      function: panelItems(presentation, 'function', [...functional, ...nonFunctional, ...dependencies]),
      guardrail: panelItems(presentation, 'guardrail', [
        ...list(guardrails.costDrivers),
        ...list(guardrails.usageLimits),
        ...list(guardrails.abusePrevention),
        ...list(guardrails.monitoringSignals),
        ...list(guardrails.alertThresholds),
        ...list(guardrails.stopLossActions),
      ]),
      risk: panelItems(presentation, 'risk', [
        ...list(risks.assumptions),
        ...list(risks.risks),
        ...list(risks.openQuestions),
      ]),
    },
    directions,
    acceptance: unique([
      ...list(goals.acceptanceGoals),
      ...list(sections.validation?.acceptanceGoals),
      ...list(safeSnapshot.tests),
    ]),
    engineering: {
      requirements: {
        functional,
        nonFunctional,
      },
      constraints: {
        technical: list(constraints.technical),
        compliance: list(constraints.compliance),
        dependencies,
      },
      tasks: taskReferences,
      files: fileReferences,
      handoff: {
        owner: optionalText(sections.handoff?.owner),
        nextStep: optionalText(sections.handoff?.nextStep),
        targetSystem: optionalText(sections.handoff?.targetSystem),
      },
    },
    evidenceReferences,
  };
}

export function buildReviewModel(snapshot = {}) {
  const core = buildReviewCore(snapshot);
  const digest = reviewModelDigest(core);
  const approvalContract = {
    schema: REVIEW_APPROVAL_SCHEMA,
    approvalId: `review:${core.source.versionId ?? 'legacy'}:${digest.slice(0, 16)}`,
    decisionScope: 'review-version',
    modelDigest: digest,
    snapshotDigest: core.source.snapshotDigest,
    versionId: core.source.versionId,
    workUnitId: core.source.workUnitId,
    allowedDecisions: ['confirmed', 'needs-revision'],
  };
  return {
    ...core,
    digest,
    approvalContract,
  };
}

function businessEvidenceReferences(references) {
  return references.map((item, index) => ({
    id: item.id,
    label: `依据 ${index + 1}`,
  }));
}

function businessOverview(model) {
  const problem = model.diagram.mapNodes.problem?.text ?? model.overview.problem;
  const goal = model.diagram.mapNodes.goal?.text ?? model.overview.goals[0] ?? null;
  return {
    problem,
    goal,
    successMetrics: model.overview.successMetrics,
  };
}

export function projectReviewModel(model, view = 'business') {
  if (!model || model.schema !== REVIEW_MODEL_SCHEMA || !model.digest) {
    throw new TypeError('projectReviewModel requires a canonical ReviewModel');
  }
  if (!['business', 'engineering'].includes(view)) {
    throw new TypeError(`unsupported review projection: ${view}`);
  }
  const shared = {
    schema: REVIEW_PROJECTION_SCHEMA,
    view,
    modelDigest: model.digest,
    timeline: model.timeline,
    approvalContract: model.approvalContract,
  };
  if (view === 'business') {
    return {
      ...shared,
      title: model.title,
      sections: {
        overview: businessOverview(model),
        scope: model.scope,
        journey: model.journey,
        diagram: model.diagram,
        panels: model.panels,
        directions: model.directions,
        acceptance: model.acceptance,
      },
      evidenceReferences: businessEvidenceReferences(model.evidenceReferences),
    };
  }
  return {
    ...shared,
    title: model.title,
    trace: model.source,
    sections: {
      delivery: model.engineering.requirements,
      constraints: model.engineering.constraints,
      tasks: model.engineering.tasks,
      files: model.engineering.files,
      acceptance: model.acceptance,
      handoff: model.engineering.handoff,
    },
    evidenceReferences: model.evidenceReferences,
  };
}
