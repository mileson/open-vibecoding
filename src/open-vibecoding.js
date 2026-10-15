/*
 * 核心功能
 * 汇总 Open VibeCoding CLI 的命令入口、workspace 函数编排和测试可复用导出。
 *
 * 输入
 * 接收 CLI 参数、项目路径、Open VibeCoding 工作区文件和各子模块 workspace 结果。
 *
 * 输出
 * 执行 init/setup/update/doctor/run/loop 等命令，打印结果并导出内部 workspace API。
 *
 * 定位
 * 位于 CLI 应用层，负责路由与组合，不承载单个领域的深层业务规则。
 *
 * 依赖
 * 依赖 cli/args、cli/print、agent-integration、loop、standards、quality、openspec 等模块。
 *
 * 维护规则
 * 新增命令或参数时同步更新 usage、打印契约、docs/basic/backend-structure.md 和相关测试。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatTemplatePackDisplay } from './product-type-copy.js';
import { buildSnapshotChangeSummary } from './change-summary.js';
import { appendReleaseEntry, buildReleaseChangeSummary, buildReleaseLedgerSummary, loadReleaseLedger, saveReleaseLedger, setCurrentReleaseVersion, setReleaseLedgerEnabled, setReleaseVersionStatus } from './release-ledger.js';
import { validateOpenSpecChangeWorkspace } from './openspec/change-validate.js';
import { listOpenSpecTaskWorkspace } from './openspec/execute.js';
import { ensureCodexCliReady } from './codex-runtime.js';
import { listAcceptedSpecsWorkspace, listOpenPrdChangesWorkspace } from './openspec/change-lifecycle.js';
import { checkStandardsWorkspace, classifyExternalReferenceWorkspace, initStandardsWorkspace } from './standards.js';
import { doctorOpenPrdAgentIntegration, setupOpenPrdAgentIntegration, updateOpenPrdAgentIntegration } from './agent-integration.js';
import { timestamp } from './time.js';
import { parseCommandArgs, usage } from './cli/args.js';
import { runQualityCommand } from './cli/quality-commands.js';
import { printAcceptedSpecsResult, printAgentIntegrationResult, printBenchmarkResult, printBrainstormResult, printCanvasResult, printDiagramResult, printDiffResult, printDoctorResult, printFleetResult, printHistoryResult, printInitResult, printLearningResult, printOpenPrdChangesResult, printOpenSpecChangeValidationResult, printOpenSpecTaskResult, printReleaseResult, printRunResult, printSelfUpdateResult, printStatus, printUpgradeResult, printValidation } from './cli/print.js';
import { cjoin, exists, readJson, writeJson, writeText, writeYaml } from './fs-utils.js';
import { diagramWorkspace } from './diagram-workspace.js';
import { createFleetWorkspace } from './fleet.js';
import { selfUpdateWorkspace, upgradeWorkspace } from './self-update.js';
import { generateLearningReviewWorkspace, setLearningReviewModeWorkspace } from './learning-review.js';
import { addBenchmarkWorkspace, approveBenchmarkWorkspace, benchmarkWorkspace, listBenchmarkWorkspace, observeBenchmarkSourceWorkspace, verifyBenchmarkWorkspace } from './benchmark.js';
import { initQualityWorkspace, qualityWorkspace, verifyQualityWorkspace, learnQualityWorkspace } from './quality.js';
import {
  archiveKnowledgeCandidate,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  restoreKnowledgeCandidate,
} from './knowledge.js';
import { createRunWorkspace } from './run-harness.js';
import { checkDevelopmentStandardsWorkspace } from './dev-standards.js';
import {
  applyGrowthCandidateWorkspace,
  checkGrowthWorkspace,
  initGrowthWorkspace,
  rejectGrowthCandidateWorkspace,
  reviewGrowthWorkspace,
} from './growth.js';
import { brainstormWorkspace } from './brainstorm.js';
import { buildBrainstormPresentationTemplatePayload, brainstormPresentationWorkspace } from './brainstorm-presentation.js';
import { designStarterWorkspace } from './design-starter.js';
import { canvasWorkspace } from './canvas-workspace.js';
import { analyzeWorkspaceRegistryHygiene } from './registry-hygiene.js';
import { ensureProjectManifest, readProjectManifest } from './kernel/index.js';
import { visualCompareWorkspace } from './visual-compare.js';
import { visualPrepareWorkspace } from './visual-prepare.js';
import { diffWorkspace, historyWorkspace } from './legacy-history.js';
import { appendWorkflowEvent, computeWorkspaceDigest, CORE_TEMPLATE_FILES, ensureWorkspaceSkeleton, isSupportedProductType, loadLatestVersionSnapshot, loadWorkspace, migrateWorkspaceSkeleton, readVersionIndex, resolveActiveTemplatePack, resolveCurrentProductType, validateWorkspace } from './workspace-core.js';
import { readWorkspaceRegistry } from './workspace-registry.js';
import { taskRuntimeWorkspace } from './runtime/workspace.js';
import { printTaskRuntimeResult } from './cli/runtime-print.js';
import { gateWorkspace } from './gates/workspace.js';
import { printGateResult } from './cli/gate-print.js';
import { CAPABILITY_HANDOFF_CONTRACT, getCapability, loadProjectCapabilityCatalog } from './capability-catalog.js';
import { iconCutout } from './icon-cutout.js';
import { visualGrid, imageAnnotate } from './visual-assistance.js';

function buildInitTemplatePackGuidance(templatePack, options = {}) {
  const label = formatTemplatePackDisplay(templatePack, { fallback: '通用产品或工程场景' });
  if (options.explicit) {
    return {
      source: 'explicit',
      templatePack,
      message: `已按指定场景模板使用${label}起步；后续需求澄清或场景分类时，仍可按用户确认调整产品场景。`,
    };
  }
  return {
    source: 'default',
    templatePack,
    message: `未指定场景模板，已使用${label}起步；后续需求澄清或场景分类时，可再锁定为个人消费者、企业服务或 Agent 场景。`,
  };
}

async function initWorkspace(projectRoot, options) {
  const ws = await ensureWorkspaceSkeleton(projectRoot, options);
  const projectManifest = await ensureProjectManifest(projectRoot);
  const workspace = await loadWorkspace(projectRoot);
  const standards = await initStandardsWorkspace(projectRoot, { force: Boolean(options.force) });
  const quality = await initQualityWorkspace(projectRoot, { force: Boolean(options.force) });
  const growth = await initGrowthWorkspace(projectRoot);
  const agentIntegration = await setupOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    action: 'init',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    openprdHome: options.openprdHome,
    platform: options.platform,
    hookProfile: options.hookProfile,
    symlinkStrategy: options.symlinkStrategy,
    installSafetyBackupRoot: options.installSafetyBackupRoot,
  });
  const config = workspace.data.config ?? {};
  if (options.templatePack) {
    config.activeTemplatePack = options.templatePack;
  }
  if (!config.activeTemplatePack) {
    config.activeTemplatePack = 'base';
  }
  config.learningReview = {
    enabled: config.learningReview?.enabled !== false,
    autoOpen: config.learningReview?.autoOpen !== false,
    defaultGenre: config.learningReview?.defaultGenre ?? 'internet-product',
    sourceScope: config.learningReview?.sourceScope ?? 'workspace',
    ...config.learningReview,
  };
  config.quality = {
    mode: 'explicit-diagnostics',
    artifactGeneration: false,
    ...config.quality,
  };
  await writeYaml(workspace.paths.config, config);

  const currentState = {
    version: 1,
    status: 'initialized',
    productType: isSupportedProductType(config.activeTemplatePack) ? config.activeTemplatePack : null,
    templatePack: config.activeTemplatePack,
    projectRoot,
    workspaceRoot: workspace.workspaceRoot,
    createdAt: timestamp(),
  };
  await writeJson(workspace.paths.currentState, currentState);
  await appendWorkflowEvent(workspace, 'initialized', {
    templatePack: currentState.templatePack,
    projectRoot,
  });
  const templatePackGuidance = buildInitTemplatePackGuidance(currentState.templatePack, {
    explicit: Boolean(options.templatePack),
  });

  return { ws: workspace, created: ws.created, currentState, templatePackGuidance, standards, quality, growth, agentIntegration, projectManifest };
}

async function setupAgentIntegrationWorkspace(projectRoot, options = {}) {
  if (!(await exists(cjoin(projectRoot, '.open-vibecoding')))) {
    const initResult = await initWorkspace(projectRoot, options);
    return {
      ...initResult.agentIntegration,
      initialized: true,
      standards: initResult.standards,
      quality: initResult.quality,
      init: {
        workspaceRoot: initResult.ws.workspaceRoot,
        created: initResult.created,
        templatePack: initResult.currentState.templatePack,
      },
      growth: initResult.growth,
      projectManifest: initResult.projectManifest,
    };
  }

  const migration = await migrateWorkspaceSkeleton(projectRoot, { recordEvent: true });
  const projectManifest = await ensureProjectManifest(projectRoot);
  const standards = await initStandardsWorkspace(projectRoot, { force: Boolean(options.force) });
  const quality = await initQualityWorkspace(projectRoot, { force: false });
  const growth = await initGrowthWorkspace(projectRoot);
  const agentIntegration = await setupOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    action: 'setup',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    openprdHome: options.openprdHome,
    platform: options.platform,
    hookProfile: options.hookProfile,
    symlinkStrategy: options.symlinkStrategy,
    installSafetyBackupRoot: options.installSafetyBackupRoot,
  });
  return {
    ...agentIntegration,
    ok: agentIntegration.ok && migration.ok,
    initialized: false,
    migration,
    standards,
    quality,
    growth,
    projectManifest,
    errors: [...(agentIntegration.errors ?? []), ...(migration.errors ?? [])],
  };
}

async function updateAgentIntegrationWorkspace(projectRoot, options = {}) {
  const migration = await migrateWorkspaceSkeleton(projectRoot, { recordEvent: true });
  const projectManifest = await ensureProjectManifest(projectRoot);
  const standards = await initStandardsWorkspace(projectRoot, { force: false });
  const quality = await initQualityWorkspace(projectRoot, { force: false });
  const growth = await initGrowthWorkspace(projectRoot);
  const agentIntegration = await updateOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    force: Boolean(options.force),
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    openprdHome: options.openprdHome,
    platform: options.platform,
    hookProfile: options.hookProfile,
    symlinkStrategy: options.symlinkStrategy,
    installSafetyBackupRoot: options.installSafetyBackupRoot,
  });
  return {
    ...agentIntegration,
    ok: agentIntegration.ok && migration.ok,
    migration,
    standards,
    quality,
    growth,
    projectManifest,
    errors: [...(agentIntegration.errors ?? []), ...(migration.errors ?? [])],
  };
}

async function doctorWorkspace(projectRoot, options = {}) {
  const projectManifest = await readProjectManifest(projectRoot, { mode: 'read' })
    .then((manifest) => ({ ok: true, manifest }))
    .catch((error) => ({
      ok: false,
      manifest: null,
      code: error?.code ?? 'OPEN_VIBECODING_MANIFEST_READ_FAILED',
      error: error instanceof Error ? error.message : String(error),
    }));
  const agentIntegration = await doctorOpenPrdAgentIntegration(projectRoot, {
    tools: options.tools ?? 'all',
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    cursorHome: options.cursorHome,
    hookProfile: options.hookProfile,
  });
  const codexRuntime = (agentIntegration.tools ?? []).includes('codex') && options.checkCodexRuntime
    ? await ensureCodexCliReady({
      cwd: projectRoot,
      repair: Boolean(options.fix),
      runCommand: options.codexRunCommand,
      packageManager: options.packageManager,
    })
    : null;
  const standards = await checkStandardsWorkspace(projectRoot, {
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  }).catch((error) => ({
    ok: false,
    errors: [error instanceof Error ? error.message : String(error)],
    warnings: [],
    checks: [],
    docsRoot: path.join('docs', 'basic'),
  }));
  const validation = await validateWorkspace(projectRoot, {
    sourceManuals: options.sourceManuals,
    docsContent: options.docsContent,
  })
    .then(({ report }) => report)
    .catch((error) => ({
      valid: false,
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: [],
      checks: [],
    }));
  const workspaceRegistry = await readWorkspaceRegistry({ openprdHome: options.openprdHome }).catch(() => null);
  const registryHygiene = workspaceRegistry
    ? analyzeWorkspaceRegistryHygiene(workspaceRegistry.entries)
    : { ok: true, issues: [] };
  const registryWarnings = [
    ...(registryHygiene.issues ?? []).map((issue) => `registry: ${issue.message}`),
    ...((workspaceRegistry?.staleEntries ?? []).map((entry) => `registry: stale workspace ${entry.workspaceRoot} (${entry.reason})`)),
  ];
  const integrationsReady = projectManifest.ok && agentIntegration.ok && (codexRuntime?.ok ?? true);
  const structuralReady = validation.structuralValid ?? validation.valid;
  const standardsReady = standards.ok;
  const workspaceReady = integrationsReady && structuralReady && standardsReady;
  const doctorOk = integrationsReady && structuralReady;
  const standardsAttention = standardsReady
    ? null
    : {
        kind: 'standards',
        scope: 'workspace',
        blocking: false,
        summary: 'Standards and documentation need attention, but they do not make doctor integration or structure checks fail.',
        errors: [...(standards.errors ?? [])],
        warnings: [...(standards.warnings ?? [])],
      };
  return {
    ok: doctorOk,
    action: 'doctor',
    projectRoot,
    tools: agentIntegration.tools,
    agentIntegration,
    projectManifest,
    codexRuntime,
    standards,
    validation,
    standardsAttention,
    readiness: {
      integrationsReady,
      structuralReady,
      standardsReady,
      workspaceReady,
      actionReady: doctorOk,
      claimReady: workspaceReady,
      workspaceClaimReady: workspaceReady,
    },
    registry: {
      workspace: workspaceRegistry,
      hygiene: registryHygiene,
      warnings: registryWarnings,
    },
    errors: [
      ...agentIntegration.errors,
      ...(!projectManifest.ok ? [`project-manifest: ${projectManifest.error}`] : []),
      ...(codexRuntime?.errors ?? []).map((error) => `codex-runtime: ${error}`),
      ...(validation.structuralErrors ?? validation.errors ?? []).map((error) => `validate: ${error}`),
    ],
    warnings: registryWarnings,
  };
}

async function readCliPackageInfo() {
  const raw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf8');
  const packageJson = JSON.parse(raw);
  return {
    name: packageJson.name ?? 'open-vibecoding',
    version: packageJson.version ?? '0.0.0',
  };
}

const runWorkspace = createRunWorkspace({
  checkStandardsWorkspace,
  validateWorkspace,
});

const fleetWorkspace = createFleetWorkspace({ setupAgentIntegrationWorkspace, updateAgentIntegrationWorkspace, doctorWorkspace });

async function releaseWorkspace(projectRoot, options = {}) {
  const workspaceRoot = cjoin(projectRoot, '.open-vibecoding');
  if (!(await exists(workspaceRoot))) {
    return {
      ok: false,
      action: 'release',
      projectRoot,
      errors: [`Missing workspace: ${workspaceRoot}. Please run open-vibecoding init first.`],
    };
  }

  const loaded = await loadReleaseLedger(projectRoot);
  let ledger = loaded.ledger;
  const actions = [];
  const warnings = [];
  let changed = false;

  try {
    if (options.disable) {
      ({ ledger } = setReleaseLedgerEnabled(ledger, false));
      actions.push('disable');
      changed = true;
    }

    if (options.enable) {
      ({ ledger } = setReleaseLedgerEnabled(ledger, true));
      actions.push('enable');
      changed = true;
    }

    if (options.setVersion) {
      const updated = setCurrentReleaseVersion(ledger, options.setVersion, {
        status: options.status === 'released' ? 'current' : (options.status ?? 'current'),
      });
      ledger = updated.ledger;
      actions.push('set-version');
      changed = true;
      if (updated.previousVersion) {
        warnings.push(`当前项目版本已从 ${updated.previousVersion} 切换到 ${updated.entry.version}；旧版本默认改为 released。`);
      }
      if (updated.semver.warning) {
        warnings.push(updated.semver.warning);
      }
    }

    if (options.status && !options.setVersion) {
      const updated = setReleaseVersionStatus(ledger, options.status, { version: options.version });
      ledger = updated.ledger;
      actions.push('set-status');
      changed = true;
    }

    if (options.notes) {
      const updated = appendReleaseEntry(ledger, options.notes, {
        version: options.version,
        fallbackType: '调整',
        source: {
          kind: 'manual-note',
          manualId: `manual-note-${Date.now()}`,
        },
      });
      ledger = updated.ledger;
      actions.push('append-note');
      changed = true;
    }
  } catch (error) {
    return {
      ok: false,
      action: 'release',
      projectRoot,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  if (changed) {
    await saveReleaseLedger(projectRoot, ledger);
  }

  const summary = buildReleaseLedgerSummary(ledger, { version: options.version });
  const changeSummary = buildReleaseChangeSummary(ledger, {
    version: options.version ?? summary.currentVersion,
    limit: 5,
  });

  return {
    ok: true,
    action: 'release',
    projectRoot,
    releaseLedgerPath: loaded.filePath,
    changed,
    actions,
    warnings,
    summary,
    changeSummary,
  };
}

async function isDirectoryPath(candidate) {
  const stat = await fs.stat(path.resolve(candidate)).catch(() => null);
  return Boolean(stat?.isDirectory());
}

export async function main(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;

  if (command === 'version' || command === '--version' || command === '-v') {
    const packageInfo = await readCliPackageInfo();
    console.log(packageInfo.version);
    return 0;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(usage());
    return 0;
  }

  const { flags, positionals } = parseCommandArgs(rest);
  if (positionals.includes('--help') || positionals.includes('-h')) {
    console.log(usage());
    return 0;
  }
  const projectPath = path.resolve(flags.path ?? positionals[0] ?? process.cwd());

  try {
    if (command === 'visual-grid' || command === 'image-annotate') {
      const plan = flags.jsonFile ? JSON.parse(await fs.readFile(path.resolve(flags.jsonFile), 'utf8')) : undefined;
      const result = await (command === 'visual-grid' ? visualGrid : imageAnnotate)({
        source: flags.source, out: flags.out, step: flags.step === undefined ? 100 : Number(flags.step), plan,
      });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    if (command === 'icon-cutout') {
      const result = await iconCutout({ source: flags.source, out: flags.out,
        keyColor: flags.keyColor, tolerance: flags.tolerance === undefined ? undefined : Number(flags.tolerance),
        feather: flags.feather === undefined ? undefined : Number(flags.feather) });
      console.log(JSON.stringify(result, null, 2));
      return 0;
    }
    const removedLegacyWrite = command === 'synthesize'
      || command === 'openspec-generate'
      || command === 'freeze'
      || command === 'handoff'
      || (command === 'loop' && (flags.init || flags.plan || flags.loopRun || flags.finish || flags.advance))
      || (command === 'review' && Boolean(flags.mark))
      || (command === 'review-presentation' && Boolean(flags.write))
      || (command === 'change' && (flags.generate || flags.apply || flags.archive || flags.activate || flags.close))
      || ((command === 'tasks' || command === 'openspec-tasks') && Boolean(flags.advance || flags.verify || flags.evidence));
    if (removedLegacyWrite) {
      const message = '旧版 PRD/change/tasks 生成与推进实现已移除。请让 Agent 根据当前目标自主分析、拆解和实现；历史资料仍可只读查看。';
      if (flags.json) console.log(JSON.stringify({ ok: false, error: { type: 'removed-workflow', message } }));
      else console.error(message);
      return 1;
    }
    if (command === 'capabilities') {
      const [action = 'list', id] = positionals;
      if (action === 'contract' && positionals.length === 1) {
        console.log(JSON.stringify({ ok: true, ...CAPABILITY_HANDOFF_CONTRACT }, null, 2));
        return 0;
      }
      let catalog;
      try {
        catalog = await loadProjectCapabilityCatalog(flags.path ?? process.cwd());
      } catch (error) {
        console.error(JSON.stringify({ ok: false, error: { type: 'invalid-contribution', message: error.message } }));
        return 1;
      }
      if (action === 'list' && positionals.length <= 1) {
        console.log(JSON.stringify({ ok: true, ...catalog }, null, 2));
        return 0;
      }
      if (action === 'get' && id && positionals.length === 2) {
        const capability = getCapability(catalog, id);
        if (!capability) {
          console.error(JSON.stringify({ ok: false, error: { type: 'not-found', message: `未知能力: ${id}` } }));
          return 1;
        }
        console.log(JSON.stringify({ ok: true, schema: catalog.schema, capability }, null, 2));
        return 0;
      }
      console.error(JSON.stringify({ ok: false, error: { type: 'usage', message: '用法: open-vibecoding capabilities <list|get ID|contract>' } }));
      return 1;
    }

    if (command === 'init') {
      const result = await initWorkspace(projectPath, {
        force: flags.force,
        templatePack: flags.templatePack,
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        symlinkStrategy: flags.symlinkStrategy,
        installSafetyBackupRoot: flags.installSafetyBackupRoot,
        enableUserCodexConfig: true,
      });
      printInitResult(result, flags.json);
      return 0;
    }

    if (command === 'setup') {
      const result = await setupAgentIntegrationWorkspace(projectPath, {
        force: flags.force,
        templatePack: flags.templatePack,
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        symlinkStrategy: flags.symlinkStrategy,
        installSafetyBackupRoot: flags.installSafetyBackupRoot,
        enableUserCodexConfig: true,
      });
      printAgentIntegrationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'update') {
      const result = await updateAgentIntegrationWorkspace(projectPath, {
        force: flags.force,
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        symlinkStrategy: flags.symlinkStrategy,
        installSafetyBackupRoot: flags.installSafetyBackupRoot,
        enableUserCodexConfig: true,
      });
      printAgentIntegrationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'self-update') {
      const result = await selfUpdateWorkspace({
        check: flags.check,
        dryRun: flags.dryRun,
        json: flags.json,
        openprdHome: flags.openprdHome,
      });
      printSelfUpdateResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'upgrade') {
      const result = await upgradeWorkspace(projectPath, {
        dryRun: flags.dryRun,
        json: flags.json,
        fleet: flags.fleet,
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        force: flags.force,
        maxDepth: flags.maxDepth,
        include: flags.include,
        exclude: flags.exclude,
        report: flags.report,
      });
      printUpgradeResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'doctor') {
      const result = await doctorWorkspace(projectPath, { tools: flags.tools, hookProfile: flags.hookProfile, fix: flags.fix, checkCodexRuntime: true, enableUserCodexConfig: true });
      printDoctorResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'fleet') {
      const result = await fleetWorkspace(projectPath, {
        tools: flags.tools,
        hookProfile: flags.hookProfile,
        force: flags.force,
        dryRun: flags.dryRun,
        updateOpenprd: flags.updateOpenprd,
        syncRegistry: flags.syncRegistry,
        setupMissing: flags.setupMissing,
        doctor: flags.doctor,
        maxDepth: flags.maxDepth,
        include: flags.include,
        exclude: flags.exclude,
        report: flags.report,
        enableUserCodexConfig: true,
        openprdHome: flags.openprdHome,
      });
      printFleetResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'run') {
      const result = await runWorkspace(projectPath, {
        verify: flags.verify,
        recordHook: flags.recordHook,
        event: flags.event,
        risk: flags.risk,
        outcome: flags.outcome,
        preview: flags.preview,
        learn: flags.learn,
      });
      printRunResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'runtime') {
      const result = await taskRuntimeWorkspace(projectPath, {
        action: flags.runtimeAction ?? 'status',
        lane: flags.lane,
        task: flags.task,
        title: flags.title,
        claimId: flags.claimId,
        client: flags.client ?? flags.agent,
        session: flags.session,
        thread: flags.thread,
        worktree: flags.worktree,
        branch: flags.branch,
        baseCommit: flags.baseCommit,
        leaseDurationMs: flags.leaseMs,
        expectedRevision: flags.expectedRevision,
        expectedLaneRevision: flags.expectedLaneRevision,
        writeSet: flags.writeSet,
        evidence: flags.evidence,
        reason: flags.reason,
        status: flags.status,
      });
      printTaskRuntimeResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'gate') {
      const result = await gateWorkspace(projectPath, {
        action: flags.runtimeAction ?? 'status',
        jsonFile: flags.jsonFile,
        gateId: flags.gateId,
        approvalId: flags.approvalId,
      });
      printGateResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'canvas') {
      const result = await canvasWorkspace(projectPath, {
        thread: flags.thread,
        threadTitle: flags.threadTitle,
        conversationTitle: flags.conversationTitle,
        session: flags.session,
        sessionTitle: flags.sessionTitle,
        host: flags.host,
        port: flags.port,
        daemon: flags.daemon,
        stop: flags.stop,
        bridgeOutbox: flags.bridgeOutbox,
        bridgeSent: flags.bridgeSent,
        bridgeFailed: flags.bridgeFailed,
        claim: flags.claim,
        id: flags.id,
        reason: flags.reason,
        open: flags.open,
        openTarget: flags.openTarget,
        dryRun: flags.dryRun,
      });
      printCanvasResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    const qualityCommandExit = await runQualityCommand(command, { projectPath, flags, positionals });
    if (qualityCommandExit !== null) {
      return qualityCommandExit;
    }

    if (command === 'benchmark') {
      const subcommand = positionals[0] ?? 'list';
      const benchmarkProjectPath = path.resolve(
        flags.path
          ?? ((subcommand === 'list' || subcommand === 'verify') ? positionals[1] : null)
          ?? process.cwd(),
      );
      const target = positionals[1] ?? null;
      let result;
      if (subcommand === 'add') {
        result = await addBenchmarkWorkspace(benchmarkProjectPath, {
          source: target ?? flags.source,
          notes: flags.notes,
        });
      } else if (subcommand === 'observe') {
        result = await observeBenchmarkSourceWorkspace(benchmarkProjectPath, {
          source: target ?? flags.source,
          notes: flags.notes,
          task: flags.item ?? flags.event,
          adoptedSignal: flags.status ?? flags.outcome,
          threshold: flags.threshold,
        });
      } else if (subcommand === 'approve') {
        result = await approveBenchmarkWorkspace(benchmarkProjectPath, {
          id: flags.id ?? target,
        });
      } else if (subcommand === 'verify') {
        result = await verifyBenchmarkWorkspace(benchmarkProjectPath);
      } else if (subcommand === 'list') {
        result = await listBenchmarkWorkspace(benchmarkProjectPath);
      } else {
        console.log('Usage: open-vibecoding benchmark <add|observe|list|approve|verify> [target-or-id] [path-for-list-or-verify] [--path <project>] [--notes <text>] [--id <benchmark-id>]');
        return 1;
      }
      printBenchmarkResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'brainstorm') {
      const result = await brainstormWorkspace(projectPath, {
        topic: flags.topic,
        open: flags.open || !flags.json,
        json: flags.json,
      });
      printBrainstormResult(result, flags.json);
      return 0;
    }

    if (command === 'learn') {
      if (flags.enable || flags.disable) {
        const enabled = flags.enable ? true : false;
        if (flags.enable && flags.disable) {
          throw new Error('Cannot use --enable and --disable together.');
        }
        const result = await setLearningReviewModeWorkspace(projectPath, enabled);
        printLearningResult(result, flags.json);
        return result.ok ? 0 : 1;
      }

      const result = await generateLearningReviewWorkspace(projectPath, {
        topic: flags.topic,
        genre: flags.genre,
        style: flags.style,
        sourceScope: flags.source,
        contentJson: flags.contentJson,
        open: flags.open || !flags.json,
        trigger: 'manual',
        respectConfig: false,
      });
      printLearningResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'brainstorm-presentation') {
      if (flags.template) {
        console.log(JSON.stringify(buildBrainstormPresentationTemplatePayload(), null, 2));
        return 0;
      }
      const result = await brainstormPresentationWorkspace(projectPath, {
        presentationPath: flags.presentation,
        write: flags.write,
      });
      if (flags.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`展示文案校验: ${result.ok ? '通过' : '需要重写'}`);
        console.log(`主题: ${result.topic}`);
        console.log(`超限或格式问题: ${result.presentationFeedback.length}`);
        if (result.presentationFeedback.length > 0) {
          for (const item of result.presentationFeedback.slice(0, 6)) {
            const pathHint = item.jsonPath ? `${item.jsonPath}: ` : '';
            const sizeHint = item.maxChars ? ` 当前 ${item.currentChars} 字，限制 ${item.maxChars} 字。` : '';
            console.log(`- ${item.area} / ${item.target}: ${pathHint}${item.action}${sizeHint}`);
          }
        }
        if (result.written) {
          console.log(`已写入: ${result.written}`);
        }
        if (result.htmlPath) {
          console.log(`已更新脑暴页面: ${result.htmlPath}`);
        }
      }
      return flags.failOnViolation && !result.ok ? 1 : 0;
    }

    if (command === 'diagram') {
      const result = await diagramWorkspace(projectPath, { open: flags.open, type: flags.type, input: flags.input, mark: flags.mark });
      printDiagramResult(result, flags.json);
      return 0;
    }

    if (command === 'diff') {
      const result = await diffWorkspace(projectPath, { from: flags.from, to: flags.to });
      printDiffResult(result, flags.json);
      return 0;
    }

    if (command === 'history') {
      const result = await historyWorkspace(projectPath);
      printHistoryResult(result, flags.json);
      return 0;
    }

    if (command === 'release') {
      const result = await releaseWorkspace(projectPath, {
        enable: flags.enable,
        disable: flags.disable,
        setVersion: flags.set,
        status: flags.status,
        version: flags.version,
        notes: flags.notes,
      });
      printReleaseResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'validate') {
      const { report } = await validateWorkspace(projectPath);
      printValidation(report, flags.json);
      return report.valid ? 0 : 1;
    }

    if (command === 'status') {
      const { report, ws } = await validateWorkspace(projectPath);
      printStatus(ws, report, null, flags.json);
      return report.valid ? 0 : 1;
    }

    if (command === 'changes') {
      const result = await listOpenPrdChangesWorkspace(projectPath);
      printOpenPrdChangesResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'specs') {
      const result = await listAcceptedSpecsWorkspace(projectPath);
      printAcceptedSpecsResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'change') {
      if (flags.validate) {
        const result = await validateOpenSpecChangeWorkspace(projectPath, {
          change: flags.change ?? positionals[1] ?? null,
        });
        printOpenSpecChangeValidationResult(result, flags.json);
        return result.ok ? 0 : 1;
      }
      const result = await listOpenPrdChangesWorkspace(projectPath);
      printOpenPrdChangesResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'tasks' || command === 'openspec-tasks') {
      const result = await listOpenSpecTaskWorkspace(projectPath, {
        change: flags.change ?? null,
      });
      printOpenSpecTaskResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    if (command === 'openspec-validate') {
      const result = await validateOpenSpecChangeWorkspace(projectPath, {
        change: flags.change ?? positionals[1] ?? null,
      });
      printOpenSpecChangeValidationResult(result, flags.json);
      return result.ok ? 0 : 1;
    }

    console.log(usage());
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export {
  validateWorkspace,
  initWorkspace,
  setupAgentIntegrationWorkspace,
  updateAgentIntegrationWorkspace,
  selfUpdateWorkspace,
  upgradeWorkspace,
  doctorWorkspace,
  fleetWorkspace,
  runWorkspace,
  canvasWorkspace,
  brainstormWorkspace,
  generateLearningReviewWorkspace,
  setLearningReviewModeWorkspace,
  diffWorkspace,
  historyWorkspace,
  releaseWorkspace,
  brainstormPresentationWorkspace,
  validateOpenSpecChangeWorkspace,
  listOpenSpecTaskWorkspace,
  listOpenPrdChangesWorkspace,
  listAcceptedSpecsWorkspace,
  diagramWorkspace,
  designStarterWorkspace,
  loadWorkspace,
  initStandardsWorkspace,
  checkStandardsWorkspace,
  classifyExternalReferenceWorkspace,
  initQualityWorkspace,
  verifyQualityWorkspace,
  learnQualityWorkspace,
  qualityWorkspace,
  listKnowledgeCandidates,
  rejectKnowledgeCandidate,
  archiveKnowledgeCandidate,
  restoreKnowledgeCandidate,
  visualPrepareWorkspace,
  visualCompareWorkspace,
  checkDevelopmentStandardsWorkspace,
  initGrowthWorkspace,
  checkGrowthWorkspace,
  reviewGrowthWorkspace,
  applyGrowthCandidateWorkspace,
  rejectGrowthCandidateWorkspace,
  benchmarkWorkspace,
  addBenchmarkWorkspace,
  observeBenchmarkSourceWorkspace,
  listBenchmarkWorkspace,
  approveBenchmarkWorkspace,
  verifyBenchmarkWorkspace,
};
