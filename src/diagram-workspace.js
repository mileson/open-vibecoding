import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildDiagramArtifact, renderDiagramArtifactFromModel, renderDiagramMermaidFromModel, validateDiagramContract, validateDiagramLanguage } from './diagram-core.js';
import { exists, readJson, writeJson, writeText } from './fs-utils.js';
import { appendWorkflowEvent, loadLatestVersionSnapshot, loadWorkspace } from './workspace-core.js';

function diagramContextFromInput(projectRoot, contract) {
  const empty = [];
  return {
    title: contract.title ?? path.basename(projectRoot),
    owner: contract.metadata?.owner ?? '未指定',
    versionId: null,
    productType: contract.metadata?.productType ?? null,
    sections: {
      meta: { title: contract.title ?? path.basename(projectRoot) },
      problem: { problemStatement: null },
      users: { primaryUsers: empty, stakeholders: empty },
      goals: { goals: empty, successMetrics: empty, acceptanceGoals: empty },
      scope: { inScope: empty, outOfScope: empty },
      scenarios: { primaryFlows: empty, edgeCases: empty, failureModes: empty },
      requirements: { functional: empty, nonFunctional: empty },
      constraints: { dependencies: empty, technical: empty, compliance: empty },
      risks: { assumptions: empty, openQuestions: empty },
      handoff: { targetSystem: null },
    },
  };
}

async function openInBrowser(filePath) {
  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32'
    ? ['/c', 'start', '', filePath]
    : [filePath];

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveDiagramPaths(ws, type = 'architecture') {
  if (type === 'product-flow') {
    return {
      htmlPath: ws.paths.activeProductFlowDiagramHtml,
      jsonPath: ws.paths.activeProductFlowDiagramJson,
      mermaidPath: ws.paths.activeProductFlowDiagramMermaid,
      label: 'product flow',
    };
  }

  return {
    htmlPath: ws.paths.activeArchitectureDiagramHtml,
    jsonPath: ws.paths.activeArchitectureDiagramJson,
    mermaidPath: ws.paths.activeArchitectureDiagramMermaid,
    label: 'architecture',
  };
}

async function readDiagramModel(filePath) {
  if (!(await exists(filePath))) {
    return null;
  }
  return readJson(filePath).catch(() => null);
}

function normalizeDiagramReviewStatus(status) {
  return ['pending-confirmation', 'confirmed', 'needs-revision'].includes(status)
    ? status
    : 'pending-confirmation';
}

function assessDiagramComplexity(snapshot) {
  const sections = snapshot?.sections ?? {};
  const flowScore = [
    (sections.scenarios?.primaryFlows ?? []).length > 0,
    (sections.scenarios?.edgeCases ?? []).length > 0,
    (sections.scenarios?.failureModes ?? []).length > 0,
    (sections.goals?.acceptanceGoals ?? []).length > 0,
  ].filter(Boolean).length;

  const architectureScore = [
    (sections.constraints?.dependencies ?? []).length > 0,
    (sections.constraints?.technical ?? []).length > 0,
    (sections.constraints?.compliance ?? []).length > 0,
    (sections.requirements?.nonFunctional ?? []).length > 0,
    snapshot?.productType === 'agent',
    snapshot?.productType === 'b2b',
  ].filter(Boolean).length;

  if (flowScore === 0 && architectureScore === 0) {
    return { needed: false, preferredType: 'architecture', reason: null };
  }

  const preferredType = flowScore >= architectureScore ? 'product-flow' : 'architecture';
  return {
    needed: Math.max(flowScore, architectureScore) >= 2,
    preferredType,
    reason: preferredType === 'product-flow'
      ? 'The user journey and failure/decision paths would benefit from a visual confirmation.'
      : 'The system shape, boundaries, or dependencies would benefit from a visual confirmation.',
  };
}

async function getDiagramReviewState(ws, snapshot) {
  const architecture = await readDiagramModel(ws.paths.activeArchitectureDiagramJson);
  const productFlow = await readDiagramModel(ws.paths.activeProductFlowDiagramJson);
  const complexity = assessDiagramComplexity(snapshot);
  const preferred = complexity.preferredType;
  const target = preferred === 'product-flow' ? productFlow : architecture;
  const targetStatus = normalizeDiagramReviewStatus(target?.metadata?.reviewStatus);
  const targetExists = Boolean(target);

  const attentionNeeded = complexity.needed && (!targetExists || targetStatus !== 'confirmed');
  let reason = complexity.reason;
  if (attentionNeeded && targetExists && targetStatus === 'needs-revision') {
    reason = `The ${preferred} diagram is marked needs-revision and remains background review attention; it does not block freeze or implementation.`;
  } else if (attentionNeeded && targetExists && targetStatus === 'pending-confirmation') {
    reason = `The ${preferred} diagram is pending review as background attention; it does not block freeze or implementation.`;
  } else if (attentionNeeded && !targetExists) {
    reason = `A ${preferred} diagram would improve reviewability, but its absence does not block freeze or implementation.`;
  }

  return {
    preferredType: preferred,
    needed: complexity.needed,
    shouldGateFreeze: false,
    attentionNeeded,
    blocking: false,
    reason,
    architecture: {
      exists: Boolean(architecture),
      reviewStatus: normalizeDiagramReviewStatus(architecture?.metadata?.reviewStatus),
    },
    productFlow: {
      exists: Boolean(productFlow),
      reviewStatus: normalizeDiagramReviewStatus(productFlow?.metadata?.reviewStatus),
    },
  };
}

async function diagramWorkspace(projectRoot, options = {}) {
  const ws = await loadWorkspace(projectRoot);
  if (!(await exists(ws.workspaceRoot))) {
    throw new Error(`Missing workspace: ${ws.workspaceRoot}`);
  }

  const type = options.type ?? 'architecture';
  if (!['architecture', 'product-flow'].includes(type)) {
    throw new Error(`Unsupported diagram type: ${type}`);
  }
  if (options.mark && !['pending-confirmation', 'confirmed', 'needs-revision'].includes(options.mark)) {
    throw new Error(`Unsupported diagram review status: ${options.mark}`);
  }

  const { htmlPath, jsonPath, mermaidPath, label } = resolveDiagramPaths(ws, type);
  if (options.mark && !options.input && await exists(jsonPath)) {
    const model = await readJson(jsonPath);
    model.metadata = {
      ...(model.metadata ?? {}),
      reviewStatus: options.mark,
    };
    const languageValidation = validateDiagramLanguage(model);
    if (!languageValidation.valid) {
      throw new Error(`Invalid ${type} diagram language:\n- ${languageValidation.errors.join('\n- ')}`);
    }
    const html = renderDiagramArtifactFromModel(type, model);
    const mermaid = renderDiagramMermaidFromModel(type, model);
    await writeJson(jsonPath, model);
    await writeText(htmlPath, html);
    await writeText(mermaidPath, `${mermaid}\n`);
    await appendWorkflowEvent(ws, 'diagram_marked', {
      diagramType: type,
      reviewStatus: options.mark,
      htmlPath,
      mermaidPath,
    });
    if (options.open) {
      await openInBrowser(htmlPath);
    }
    return {
      ws,
      snapshot: null,
      type,
      model,
      inputPath: null,
      htmlPath,
      jsonPath,
      mermaidPath,
      opened: Boolean(options.open),
      marked: options.mark,
    };
  }

  const contract = options.input
    ? await readJson(path.resolve(options.input))
    : null;
  if (contract) {
    const schema = type === 'product-flow'
      ? ws.data.diagramProductFlowSchema
      : ws.data.diagramArchitectureSchema;
    const validation = validateDiagramContract(contract, schema);
    if (!validation.valid) {
      throw new Error(`Invalid ${type} diagram contract:\n- ${validation.errors.join('\n- ')}`);
    }
  }
  const latestVersion = await loadLatestVersionSnapshot(ws);
  if (!contract && !latestVersion) {
    throw new Error('A diagram needs an explicit --input contract or an existing historical snapshot.');
  }
  const snapshot = latestVersion?.snapshot ?? diagramContextFromInput(ws.projectRoot, contract);
  const artifact = buildDiagramArtifact(snapshot, { type, contract });
  if (options.mark) {
    artifact.model.metadata = {
      ...(artifact.model.metadata ?? {}),
      reviewStatus: options.mark,
    };
    artifact.html = renderDiagramArtifactFromModel(type, artifact.model);
  }
  const languageValidation = validateDiagramLanguage(artifact.model);
  if (!languageValidation.valid) {
    throw new Error(`Invalid ${type} diagram language:\n- ${languageValidation.errors.join('\n- ')}`);
  }

  const mermaid = renderDiagramMermaidFromModel(type, artifact.model);
  await writeJson(jsonPath, artifact.model);
  await writeText(htmlPath, artifact.html);
  await writeText(mermaidPath, `${mermaid}\n`);
  await appendWorkflowEvent(ws, 'diagram_generated', {
    versionId: snapshot.versionId,
    productType: snapshot.productType,
    diagramType: type,
    inputPath: options.input ? path.resolve(options.input) : null,
    htmlPath,
    mermaidPath,
  });

  if (options.open) {
    await openInBrowser(htmlPath);
  }

  return {
    ws,
    snapshot,
    type,
    model: artifact.model,
    inputPath: options.input ? path.resolve(options.input) : null,
    htmlPath,
    jsonPath,
    mermaidPath,
    opened: Boolean(options.open),
    marked: options.mark ?? null,
  };
}


export { diagramWorkspace, getDiagramReviewState };
