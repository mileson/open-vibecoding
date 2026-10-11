/*
 * 核心功能
 * 渲染 agent integration、doctor、fleet、self-update 和 upgrade 等诊断类命令输出。
 *
 * 输入
 * 接收诊断、迁移、工具健康、自更新和批量项目扫描等结构化结果对象。
 *
 * 输出
 * 向终端输出诊断结论、修复建议和批量处理摘要，或在 `--json` 模式下直出 JSON。
 *
 * 定位
 * 位于 CLI 表现层的诊断输出模块，负责工具链和项目健康相关的终端呈现。
 *
 * 依赖
 * 仅依赖终端输出和诊断 result 契约，不承担修复执行。
 *
 * 维护规则
 * 诊断类输出新增字段时要保持错误、建议和命令展示顺序稳定，避免隐藏关键信息。
 */
import { printOptionalCapabilitySuggestions } from './shared-print.js';

function printAgentIntegrationResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Open VibeCoding agent ${result.action}: ${result.ok ? '通过' : '需修复'}`);
  console.log(`项目: ${result.projectRoot}`);
  console.log(`工具: ${result.tools.join(', ')}`);
  if (result.hookProfile) {
    console.log(`Hook 模式: ${result.hookProfile}`);
  }
  if (result.initialized) {
    console.log(`已初始化工作区: ${result.init.workspaceRoot}`);
  }
  if (result.standards) {
    console.log(`标准化文档: ${result.standards.docsRoot}`);
  }
  if (result.migration) {
    const changed = result.migration.changes.filter((change) => change.status !== 'unchanged').length;
    console.log(`工作区迁移: ${changed} 项`);
  }
  if (result.registry) {
    console.log(`全局 registry: ${result.registry.status === 'created' ? '已登记' : '已刷新'} (${result.registry.registryPath})`);
  }
  console.log('变更:');
  for (const change of result.changes) {
    const detail = change.message ? ` (${change.message})` : '';
    console.log(`- ${change.status}: ${change.path}${detail}`);
    if (change.repairHint) {
      console.log(`  修复建议: ${change.repairHint}`);
    }
  }
  if (result.doctor?.errors?.length > 0) {
    console.log('待处理:');
    for (const error of result.doctor.errors) {
      console.log(`- ${error}`);
    }
  }
  printOptionalCapabilitySuggestions(result.optionalCapabilities ?? result.doctor?.optionalCapabilities);
}

function doctorCheckLabel(check) {
  if (check.ok) return '通过';
  if (check.reason === 'missing-file') return '缺失';
  if (check.reason === 'missing-generated-marker') return '未受管';
  if (check.reason === 'checksum-drift') return '漂移';
  return '失败';
}

function printCodexRuntimeResult(codexRuntime, prefix = '') {
  if (!codexRuntime) {
    return;
  }
  const health = codexRuntime.preflight;
  console.log(`${prefix}Codex CLI 健康检查: ${codexRuntime.ok ? '通过' : '失败'}`);
  if (health?.command?.display) {
    console.log(`${prefix}检查命令: ${health.command.display}`);
  }
  if (health?.version) {
    console.log(`${prefix}Codex 版本: ${health.version}`);
  }
  if (health?.diagnostic) {
    console.log(`${prefix}诊断: ${health.diagnostic.summary}`);
    if (health.diagnostic.missingPackage) {
      console.log(`${prefix}缺失组件: ${health.diagnostic.missingPackage}`);
    }
    console.log(`${prefix}修复命令: ${health.diagnostic.manualCommand}`);
  }
  if (codexRuntime.repairAttempted) {
    console.log(`${prefix}显式修复: ${codexRuntime.repair?.ok ? '通过' : '失败'}`);
    if (codexRuntime.repair?.command?.display) {
      console.log(`${prefix}修复执行: ${codexRuntime.repair.command.display}`);
    }
    if (codexRuntime.repair?.result) {
      console.log(`${prefix}修复退出码: ${codexRuntime.repair.result.exitCode ?? 'unknown'}`);
    }
    if (codexRuntime.repair?.recheck?.version) {
      console.log(`${prefix}复查版本: ${codexRuntime.repair.recheck.version}`);
    }
  } else if (health?.diagnostic && health?.repairCommand?.display) {
    console.log(`${prefix}提示: Open VibeCoding 默认不会静默安装全局依赖；需要显式运行 open-vibecoding doctor . --tools codex --fix 或 open-vibecoding loop . --run --agent codex --repair-agent。`);
  }
}

function printRuntimeEnvironmentSummary(agentIntegration) {
  const active = agentIntegration?.runtimeEnvironment?.active;
  if (active?.activeClient && active.activeClient !== 'unknown') {
    const confidence = typeof active.confidence === 'number' ? `，置信度 ${active.confidence}` : '';
    const capabilities = Array.isArray(active.observedCapabilities) && active.observedCapabilities.length > 0
      ? `，已观察能力 ${active.observedCapabilities.join(', ')}`
      : '';
    console.log(`当前 Agent 环境: ${active.activeClient}${active.surface ? ` / ${active.surface}` : ''}${confidence}${capabilities}`);
  } else {
    console.log('当前 Agent 环境: 未观察到当前会话 hook/session 证据');
  }
  const packs = Array.isArray(agentIntegration?.platformCapabilityPacks)
    ? agentIntegration.platformCapabilityPacks
    : [];
  if (packs.length > 0) {
    console.log(`平台能力包: ${packs.map((pack) => pack.name ?? pack.id).join('，')}`);
  }
}

function printDoctorResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Open VibeCoding doctor: ${result.ok ? '通过' : '失败'}`);
  console.log(`项目: ${result.projectRoot}`);
  console.log(`工具: ${result.tools.join(', ')}`);
  if (result.agentIntegration.hookProfile) {
    console.log(`Hook 模式: ${result.agentIntegration.hookProfile}`);
  }
  printRuntimeEnvironmentSummary(result.agentIntegration);
  const readiness = result.readiness ?? {};
  const integrationsReady = readiness.integrationsReady ?? result.agentIntegration.ok;
  const structuralReady = readiness.structuralReady ?? result.validation.structuralValid ?? result.validation.valid;
  const standardsReady = readiness.standardsReady ?? result.standards.ok;
  const workspaceReady = readiness.workspaceReady ?? (integrationsReady && structuralReady && standardsReady);
  console.log(`集成状态: ${integrationsReady ? '通过' : '失败'}`);
  console.log(`工作区结构: ${structuralReady ? '通过' : '失败'}`);
  console.log(`Standards: ${standardsReady ? '通过' : '待关注（不阻断当前动作）'}`);
  console.log(`工作区整体状态: ${workspaceReady ? '就绪' : '待关注'}`);
  if (result.standardsAttention) {
    console.log(`Standards 提醒: ${result.standardsAttention.summary}`);
    for (const error of (result.standardsAttention.errors ?? []).slice(0, 5)) {
      console.log(`- ${error}`);
    }
    const hidden = Math.max(0, (result.standardsAttention.errors?.length ?? 0) - 5);
    if (hidden > 0) {
      console.log(`- 另有 ${hidden} 项 standards 提醒；使用 --json 查看完整明细。`);
    }
  }
  if (result.agentIntegration.drift) {
    console.log(`生成物漂移: ${result.agentIntegration.drift.ok ? '无' : '存在'}`);
  }
  printCodexRuntimeResult(result.codexRuntime);
  console.log('Agent 集成检查:');
  for (const check of result.agentIntegration.checks) {
    const reason = !check.ok && check.reason ? ` (${check.reason})` : '';
    console.log(`- ${doctorCheckLabel(check)}: ${check.path}${reason}`);
    if (!check.ok && check.repairHint) {
      console.log(`  修复建议: ${check.repairHint}`);
    }
  }
  if (result.errors.length > 0) {
    console.log('阻断错误:');
    for (const error of result.errors) {
      console.log(`- ${error}`);
    }
  }
  printOptionalCapabilitySuggestions(result.agentIntegration.optionalCapabilities);
}

function printFleetResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const mode = result.dryRun
    ? 'dry-run'
    : Object.entries(result.requestedActions)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ');
  console.log(`Open VibeCoding fleet: ${result.ok ? '通过' : '需处理'}`);
  console.log(`根目录: ${result.root}`);
  console.log(`模式: ${mode || 'report'}`);
  console.log(`最大深度: ${result.maxDepth}`);
  console.log(`项目: ${result.summary.total}`);
  console.log(`- Open VibeCoding: ${result.summary.openprd}`);
  console.log(`- Agent-only: ${result.summary.agentConfigured}`);
  console.log(`- Plain: ${result.summary.plain}`);
  console.log(`结果: 计划 ${result.summary.planned}，已更新 ${result.summary.updated}，已接入 ${result.summary.setup}，已检查 ${result.summary.doctored}，已补身份 ${result.summary.backfilled}，已同步 registry ${result.summary.synced}，失败 ${result.summary.failed}，跳过 ${result.summary.skipped}`);
  if (result.registry) {
    console.log(`全局 registry: 已知 ${result.registry.knownTotal}，当前 root 命中 ${result.registry.scopedKnown}，root 外 ${result.registry.outsideRoot}，失效 ${result.registry.stale}`);
  }
  if ((result.summary.healthAttention ?? 0) > 0) {
    console.log(`项目健康: ${result.summary.healthAttention} 个需关注（已报告，不阻断本次更新）`);
  }

  const visibleProjects = result.projects
    .filter((project) => project.category !== 'plain-project' || project.status === 'failed' || (project.healthErrors?.length ?? 0) > 0)
    .slice(0, 50);
  if (visibleProjects.length > 0) {
    console.log('项目明细:');
    for (const project of visibleProjects) {
      console.log(`- ${project.status}: ${project.relativePath} (${project.category}) -> ${project.plannedAction}`);
      if (project.workUnits) {
        console.log(`  工作单元: ${project.workUnits.changedVersions}/${project.workUnits.totalVersions} 个历史版本已覆盖或计划覆盖`);
      }
      for (const error of project.errors.slice(0, 3)) {
        console.log(`  错误: ${error}`);
      }
      for (const error of (project.healthErrors ?? []).slice(0, 3)) {
        console.log(`  需关注: ${error}`);
      }
    }
  }
  const hiddenCount = result.projects.length - visibleProjects.length;
  if (hiddenCount > 0) {
    console.log(`还有 ${hiddenCount} 个 plain/skipped 项目未展开；使用 --json 查看完整明细。`);
  }
  if (result.reportPath) {
    console.log(`报告: ${result.reportPath}`);
  }
}

function printSelfUpdateResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const status = result.checkOnly
    ? result.ok ? '检查完成' : '检查失败'
    : result.dryRun
      ? '预演'
      : result.ok
        ? '完成'
        : result.skipped
          ? '已跳过'
          : '失败';
  console.log(`Open VibeCoding self-update: ${status}`);
  console.log(`当前版本: ${result.package?.version ?? 'unknown'}`);
  if (result.publishedVersion) {
    console.log(`已发布版本: ${result.publishedVersion}`);
  }
  if (result.comparison === 'behind') {
    console.log('版本关系: 当前安装版本落后于 npm 已发布版本');
  } else if (result.comparison === 'same') {
    console.log('版本关系: 当前安装版本已经是 npm 最新版本');
  } else if (result.comparison === 'ahead') {
    console.log('版本关系: 当前安装版本高于 npm 已发布版本');
  }
  console.log(`安装源: ${result.source}`);
  if (result.versionCheck?.command?.display) {
    console.log(`检查命令: ${result.versionCheck.command.display}`);
  }
  console.log(`计划命令: ${result.installCommand?.display ?? 'N/A'}`);
  if (result.localCheckout) {
    console.log('运行环境: 本地源码 checkout');
  }
  if (result.dryRun) {
    console.log('dry-run: 未修改 CLI、项目或 registry。');
  }
  if (result.result) {
    console.log(`安装退出码: ${result.result.exitCode}`);
  }
  if (result.resolvedExecutable?.executable) {
    console.log(`Open VibeCoding 可执行文件: ${result.resolvedExecutable.executable}`);
  }
  if (result.installedVersion?.version) {
    console.log(`安装后版本: ${result.installedVersion.version}`);
  }
  if ((result.refreshCandidates?.total ?? 0) > 0) {
    console.log(`旧项目刷新候选: ${result.refreshCandidates.total}`);
    for (const project of result.refreshCandidates.projects ?? []) {
      console.log(`- ${project.workspaceRoot} (${project.currentVersion} -> ${project.targetVersion}; ${project.note})`);
    }
  } else if (result.refreshCandidates?.ok && result.checkOnly) {
    console.log('旧项目刷新候选: 0');
  }
  for (const action of result.nextActions ?? []) {
    console.log(`下一步: ${action}`);
  }
  for (const error of result.errors ?? []) {
    console.log(`错误: ${error}`);
  }
}

function printUpgradeResult(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Open VibeCoding upgrade: ${result.dryRun ? '预演' : result.ok ? '完成' : '失败'}`);
  console.log(`模式: ${result.mode === 'fleet' ? '历史项目批量刷新' : '单项目刷新'}`);
  console.log(`目标: ${result.targetPath}`);
  console.log(`阶段 self-update: ${result.stages.selfUpdateOk ? '通过' : '失败'}`);
  console.log(`阶段 project-refresh: ${result.stages.projectRefreshOk ? '通过' : result.projectRefresh.skipped ? '跳过' : '失败'}`);
  console.log(`self-update 命令: ${result.selfUpdate.installCommand.display}`);
  console.log(`项目刷新命令: ${result.projectRefresh.command.display}`);
  if (result.dryRun) {
    console.log('dry-run: 未执行工具更新，也未刷新项目。');
  }
  if (result.selfUpdate.result) {
    console.log(`self-update 退出码: ${result.selfUpdate.result.exitCode}`);
  }
  if (result.projectRefresh.result) {
    console.log(`project-refresh 退出码: ${result.projectRefresh.result.exitCode}`);
  }
  for (const error of result.errors ?? []) {
    console.log(`错误: ${error}`);
  }
}

export {
  printAgentIntegrationResult,
  printCodexRuntimeResult,
  printDoctorResult,
  printFleetResult,
  printSelfUpdateResult,
  printUpgradeResult,
};
