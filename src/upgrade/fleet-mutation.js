/*
 * 核心功能
 * 在 fleet 事务 staging 工作区中编排 update/setup/backfill，并把成功结果映射回兼容的 fleet 项目报告。
 *
 * 输入
 * 接收 plannedAction、staging 项目路径、fleet options、workspace dependencies 与隔离 OPENPRD_HOME。
 *
 * 输出
 * 返回统一 mutation 结果，或把成功结果写入原有 fleet item 字段。
 *
 * 定位
 * 位于 fleet 外层循环和底层项目事务之间，保持 CLI 返回字段兼容。
 *
 * 依赖
 * 依赖调用方注入的 setup/update/doctor/backfill workspace 函数，不直接导入应用层 openprd.js。
 *
 * 维护规则
 * staging 永远关闭 user-scope 写入；新增动作时必须保证失败后不继续执行该项目的后续步骤。
 */

async function collectFleetProjectHealth(projectPath, options, doctorWorkspace) {
  if (!doctorWorkspace) return { ok: true, errors: [] };
  try {
    const doctor = await doctorWorkspace(projectPath, {
      tools: options.tools ?? 'all',
      hookProfile: options.hookProfile,
      enableUserCodexConfig: false,
      codexHome: options.codexHome,
      openprdHome: options.openprdHome,
      docsContent: false,
      sourceManuals: false,
    });
    return { ok: doctor.ok, errors: doctor.errors ?? [] };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

async function runStagedFleetMutation(plannedAction, projectPath, options, dependencies, staging) {
  const stagedOptions = {
    tools: options.tools ?? 'all',
    hookProfile: options.hookProfile,
    force: Boolean(options.force),
    enableUserCodexConfig: false,
    codexHome: options.codexHome,
    openprdHome: staging.openprdHome,
  };
  if (plannedAction === 'update') {
    const actionResult = await dependencies.updateAgentIntegrationWorkspace(projectPath, stagedOptions);
    if (!actionResult.ok) {
      return {
        ok: false,
        message: 'Staged OpenPrd update failed',
        actionResult,
        errors: actionResult.errors ?? [],
        migration: { workspace: actionResult.migration ?? null, workUnits: null },
      };
    }
    const backfill = dependencies.backfillWorkUnitsWorkspace
      ? await dependencies.backfillWorkUnitsWorkspace(projectPath, {})
      : { ok: true, changes: [], errors: [], totalVersions: 0, changedVersions: 0 };
    if (!backfill.ok) {
      return {
        ok: false,
        message: 'Staged work-unit backfill failed',
        actionResult,
        backfill,
        errors: backfill.errors ?? [],
        migration: {
          workspace: actionResult.migration ?? null,
          workUnits: { totalVersions: backfill.totalVersions, changedVersions: backfill.changedVersions, ok: false },
        },
      };
    }
    const health = await collectFleetProjectHealth(projectPath, {
      ...options,
      openprdHome: staging.openprdHome,
    }, dependencies.doctorWorkspace);
    return {
      ok: true,
      actionResult,
      backfill,
      health,
      migration: {
        workspace: actionResult.migration ?? null,
        workUnits: {
          totalVersions: backfill.totalVersions,
          changedVersions: backfill.changedVersions,
          ok: true,
        },
      },
    };
  }
  if (plannedAction === 'setup') {
    const actionResult = await dependencies.setupAgentIntegrationWorkspace(projectPath, stagedOptions);
    return {
      ok: actionResult.ok,
      message: actionResult.ok ? null : 'Staged OpenPrd setup failed',
      actionResult,
      errors: actionResult.errors ?? actionResult.doctor?.errors ?? [],
      migration: { workspace: actionResult.migration ?? null, workUnits: null },
    };
  }
  if (plannedAction === 'backfill-work-units') {
    if (!dependencies.backfillWorkUnitsWorkspace) {
      return {
        ok: false,
        message: 'Missing fleet dependency: backfillWorkUnitsWorkspace',
        errors: [],
        migration: { workspace: null, workUnits: null },
      };
    }
    const backfill = await dependencies.backfillWorkUnitsWorkspace(projectPath, {});
    return {
      ok: backfill.ok,
      message: backfill.ok ? null : 'Staged work-unit backfill failed',
      backfill,
      errors: backfill.errors ?? [],
      migration: {
        workspace: null,
        workUnits: {
          totalVersions: backfill.totalVersions,
          changedVersions: backfill.changedVersions,
          ok: backfill.ok,
        },
      },
    };
  }
  return { ok: false, message: `Unsupported staged fleet action: ${plannedAction}`, errors: [] };
}

function applySuccessfulFleetMutation(item, plannedAction, transaction) {
  const mutation = transaction.mutationResult;
  if (plannedAction === 'update') {
    const update = mutation.actionResult;
    const backfill = mutation.backfill;
    item.status = 'updated';
    item.registry = transaction.afterApplyResult?.registry ?? null;
    item.changes = [
      ...(update.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
      ...(update.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
      ...(backfill.changes ?? []).map((change) => ({ ...change, source: 'work-unit' })),
    ];
    item.doctorOk = mutation.health.ok;
    item.healthOk = mutation.health.ok;
    item.healthErrors = mutation.health.errors;
    item.workUnits = { totalVersions: backfill.totalVersions, changedVersions: backfill.changedVersions };
    return;
  }
  if (plannedAction === 'setup') {
    const setup = mutation.actionResult;
    item.status = 'setup';
    item.registry = transaction.afterApplyResult?.registry ?? null;
    item.changes = [
      ...(setup.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
      ...(setup.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
    ];
    return;
  }
  const backfill = mutation.backfill;
  item.status = backfill.totalVersions > 0 ? 'backfilled' : 'skipped';
  item.workUnits = { totalVersions: backfill.totalVersions, changedVersions: backfill.changedVersions };
  item.changes = (backfill.changes ?? []).map((change) => ({ ...change, source: 'work-unit' }));
}

export { applySuccessfulFleetMutation, runStagedFleetMutation };
