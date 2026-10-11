/*
 * 核心功能
 * 在 fleet 事务 staging 工作区中编排 update/setup，并把成功结果映射回 fleet 项目报告。
 *
 * 输入
 * 接收 plannedAction、staging 项目路径、fleet options、workspace dependencies 与隔离 OPEN_VIBECODING_HOME。
 *
 * 输出
 * 返回统一 mutation 结果，或把成功结果写入原有 fleet item 字段。
 *
 * 定位
 * 位于 fleet 外层循环和底层项目事务之间，保持 CLI 返回字段兼容。
 *
 * 依赖
 * 依赖调用方注入的 setup/update/doctor workspace 函数，不直接导入应用层 open-vibecoding.js。
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
        message: 'Staged Open VibeCoding update failed',
        actionResult,
        errors: actionResult.errors ?? [],
        migration: { workspace: actionResult.migration ?? null },
      };
    }
    const health = await collectFleetProjectHealth(projectPath, {
      ...options,
      openprdHome: staging.openprdHome,
    }, dependencies.doctorWorkspace);
    return {
      ok: true,
      actionResult,
      health,
      migration: { workspace: actionResult.migration ?? null },
    };
  }
  if (plannedAction === 'setup') {
    const actionResult = await dependencies.setupAgentIntegrationWorkspace(projectPath, stagedOptions);
    return {
      ok: actionResult.ok,
      message: actionResult.ok ? null : 'Staged Open VibeCoding setup failed',
      actionResult,
      errors: actionResult.errors ?? actionResult.doctor?.errors ?? [],
      migration: { workspace: actionResult.migration ?? null },
    };
  }
  return { ok: false, message: `Unsupported staged fleet action: ${plannedAction}`, errors: [] };
}

function applySuccessfulFleetMutation(item, plannedAction, transaction) {
  const mutation = transaction.mutationResult;
  if (plannedAction === 'update') {
    const update = mutation.actionResult;
    item.status = 'updated';
    item.registry = transaction.afterApplyResult?.registry ?? null;
    item.changes = [
      ...(update.migration?.changes ?? []).map((change) => ({ ...change, source: 'workspace' })),
      ...(update.changes ?? []).map((change) => ({ ...change, source: 'agent' })),
    ];
    item.doctorOk = mutation.health.ok;
    item.healthOk = mutation.health.ok;
    item.healthErrors = mutation.health.errors;
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
}

export { applySuccessfulFleetMutation, runStagedFleetMutation };
