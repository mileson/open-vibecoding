const EXECUTION_MODE_LABELS = {
  serial: '主 Agent 串行',
  'parallel-workers': '主 Agent 协调并行 Worker',
  'parallel-workers-isolated': '独立隔离环境并行 Worker',
};

const PARALLEL_GROUP_LABELS = {
  governance: '治理收口',
  contracts: '契约与入口',
  domain: '领域逻辑',
  surface: '展示与界面',
  implementation: '功能实现',
  integration: '集成收口',
  verification: '验证证据',
  docs: '文档维护',
  none: '无',
};

const OWNER_ROLE_LABELS = {
  'main-agent': '主 Agent',
  worker: 'Worker',
};

const INTEGRATION_OWNER_LABELS = {
  'main-agent': '主 Agent',
};

export const EXECUTION_STRATEGY_METADATA_KEYS = [
  'execution-mode',
  'parallel-group',
  'write-scope',
  'owner-role',
  'local-verify',
  'integration-owner',
];

export const EXECUTION_MODE_VALUES = Object.keys(EXECUTION_MODE_LABELS);
export const PARALLEL_GROUP_VALUES = Object.keys(PARALLEL_GROUP_LABELS);
export const OWNER_ROLE_VALUES = Object.keys(OWNER_ROLE_LABELS);
export const INTEGRATION_OWNER_VALUES = Object.keys(INTEGRATION_OWNER_LABELS);

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function splitValues(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function firstKnown(values, allowed, fallback) {
  return values.find((value) => allowed.includes(value)) ?? fallback;
}

function inferParallelGroup(text, type, phase) {
  if (type === 'governance' || phase.includes('governance')) {
    return 'governance';
  }
  if (type === 'documentation' || /docs\/basic|readme|文档|说明书|documentation|docs/i.test(text)) {
    return 'docs';
  }
  if (type === 'verification' || phase.includes('verification') || /验证|回归|测试|验收|qa|verify|test/.test(text)) {
    return 'verification';
  }
  if (phase.includes('integration') || /主流程|集成|闭环|联调|发布|integration|flow/.test(text)) {
    return 'integration';
  }
  if (includesAny(text, [/contract|schema|api|hook|cli|ipc|preload|adapter|类型|契约|协议|接口|命令行|接线/])) {
    return 'contracts';
  }
  if (includesAny(text, [/renderer|view|page|dialog|modal|surface|sidebar|route|navigation|界面|页面|弹窗|样式|组件|布局|入口|导航/])) {
    return 'surface';
  }
  if (includesAny(text, [/domain|service|gateway|repository|storage|cache|backend|billing|order|entitlement|sync|状态|领域|服务|仓储|后端|数据/])) {
    return 'domain';
  }
  return 'implementation';
}

function inferWriteScope(parallelGroup) {
  const scopeByGroup = {
    governance: ['.open-vibecoding/changes/**', '.open-vibecoding/**'],
    contracts: ['src/**', 'test/**', 'docs/basic/backend-structure.md'],
    domain: ['src/**', 'test/**'],
    surface: ['src/cli/**', 'src/**', 'test/**'],
    implementation: ['src/**', 'test/**'],
    integration: ['src/**', 'test/**', 'docs/basic/**'],
    verification: ['test/**', '.open-vibecoding/harness/test-reports/**'],
    docs: ['docs/basic/**', 'README*.md'],
    none: ['src/**'],
  };
  return scopeByGroup[parallelGroup] ?? scopeByGroup.implementation;
}

function defaultLocalVerify(task = {}) {
  return task.verify ?? task.metadata?.verify ?? 'open-vibecoding tasks . --change <change-id> --verify --item <task-id>';
}

export function normalizeWriteScopes(value) {
  return [...new Set(splitValues(value))];
}

export function labelExecutionMode(mode) {
  return EXECUTION_MODE_LABELS[normalizeToken(mode)] ?? mode ?? '未指定';
}

export function labelParallelGroup(group) {
  return PARALLEL_GROUP_LABELS[normalizeToken(group)] ?? group ?? '未指定';
}

export function labelOwnerRole(role) {
  return OWNER_ROLE_LABELS[normalizeToken(role)] ?? role ?? '未指定';
}

export function labelIntegrationOwner(owner) {
  return INTEGRATION_OWNER_LABELS[normalizeToken(owner)] ?? owner ?? '未指定';
}

export function describeExecutionStrategy(strategy) {
  const mode = labelExecutionMode(strategy.mode);
  const group = labelParallelGroup(strategy.parallelGroup);
  const ownerRole = labelOwnerRole(strategy.ownerRole);
  const writeScope = (strategy.writeScope ?? []).join(', ') || '未指定';
  const localVerify = strategy.localVerify || '未指定';
  const integrationOwner = labelIntegrationOwner(strategy.integrationOwner);
  return `${mode} / ${group} / ${ownerRole}；写入范围：${writeScope}；局部验证：${localVerify}；最终集成：${integrationOwner}`;
}

export function inferExecutionStrategyForTask(task = {}) {
  const type = normalizeToken(task.type ?? task.metadata?.type ?? task.metadata?.category ?? task.metadata?.kind);
  const phase = normalizeToken(task.phase);
  const text = [
    task.id,
    task.title,
    task.done,
    task.verify,
    task.metadata?.done,
    task.metadata?.verify,
  ].map((value) => String(value ?? '')).join('\n').toLowerCase();

  if (type === 'governance' || phase.includes('governance')) {
    return {
      mode: 'serial',
      parallelGroup: 'governance',
      writeScope: inferWriteScope('governance'),
      ownerRole: 'main-agent',
      localVerify: defaultLocalVerify(task),
      integrationOwner: 'main-agent',
      inferred: true,
    };
  }

  if (type === 'documentation' || /docs\/basic|readme|文档|说明书|documentation|docs/i.test(text)) {
    return {
      mode: 'parallel-workers',
      parallelGroup: 'docs',
      writeScope: inferWriteScope('docs'),
      ownerRole: 'worker',
      localVerify: defaultLocalVerify(task),
      integrationOwner: 'main-agent',
      inferred: true,
    };
  }

  if (type === 'verification' || phase.includes('verification') || /验证|回归|测试|qa|verify|test/.test(text)) {
    return {
      mode: 'parallel-workers',
      parallelGroup: 'verification',
      writeScope: inferWriteScope('verification'),
      ownerRole: 'worker',
      localVerify: defaultLocalVerify(task),
      integrationOwner: 'main-agent',
      inferred: true,
    };
  }

  if (phase.includes('integration') || /主流程|集成|闭环|联调|integration|flow/.test(text)) {
    return {
      mode: 'serial',
      parallelGroup: 'integration',
      writeScope: inferWriteScope('integration'),
      ownerRole: 'main-agent',
      localVerify: defaultLocalVerify(task),
      integrationOwner: 'main-agent',
      inferred: true,
    };
  }

  const parallelGroup = inferParallelGroup(text, type, phase);
  return {
    mode: 'parallel-workers',
    parallelGroup,
    writeScope: inferWriteScope(parallelGroup),
    ownerRole: 'worker',
    localVerify: defaultLocalVerify(task),
    integrationOwner: 'main-agent',
    inferred: true,
  };
}

export function taskExecutionStrategy(task = {}) {
  const metadata = task.metadata ?? {};
  const inferred = inferExecutionStrategyForTask(task);
  const rawMode = normalizeToken(metadata['execution-mode']);
  const rawGroup = normalizeToken(metadata['parallel-group']);
  const rawOwnerRole = normalizeToken(metadata['owner-role']);
  const rawIntegrationOwner = normalizeToken(metadata['integration-owner']);
  const explicitWriteScope = normalizeWriteScopes(metadata['write-scope']);
  const localVerify = String(metadata['local-verify'] ?? '').trim();

  return {
    mode: EXECUTION_MODE_VALUES.includes(rawMode) ? rawMode : inferred.mode,
    parallelGroup: PARALLEL_GROUP_VALUES.includes(rawGroup) ? rawGroup : inferred.parallelGroup,
    writeScope: explicitWriteScope.length > 0 ? explicitWriteScope : inferred.writeScope,
    ownerRole: OWNER_ROLE_VALUES.includes(rawOwnerRole) ? rawOwnerRole : inferred.ownerRole,
    localVerify: localVerify || inferred.localVerify,
    integrationOwner: INTEGRATION_OWNER_VALUES.includes(rawIntegrationOwner) ? rawIntegrationOwner : inferred.integrationOwner,
    inferred: !EXECUTION_MODE_VALUES.includes(rawMode)
      || !PARALLEL_GROUP_VALUES.includes(rawGroup)
      || explicitWriteScope.length === 0
      || !OWNER_ROLE_VALUES.includes(rawOwnerRole)
      || !localVerify
      || !INTEGRATION_OWNER_VALUES.includes(rawIntegrationOwner),
  };
}

export function formatTaskExecutionStrategyMetadata(task = {}) {
  const strategy = inferExecutionStrategyForTask(task);
  return [
    `execution-mode: ${strategy.mode}`,
    `parallel-group: ${strategy.parallelGroup}`,
    `write-scope: ${strategy.writeScope.join(', ')}`,
    `owner-role: ${strategy.ownerRole}`,
    `local-verify: ${strategy.localVerify}`,
    `integration-owner: ${strategy.integrationOwner}`,
  ];
}

export function validateTaskExecutionStrategy(task = {}) {
  const metadata = task.metadata ?? {};
  const errors = [];
  if (metadata['execution-mode']) {
    const mode = normalizeToken(metadata['execution-mode']);
    if (!EXECUTION_MODE_VALUES.includes(mode)) {
      errors.push(`execution-mode 无效: ${metadata['execution-mode']}；允许值: ${EXECUTION_MODE_VALUES.join(', ')}`);
    }
  }
  if (metadata['parallel-group']) {
    const group = normalizeToken(metadata['parallel-group']);
    if (!PARALLEL_GROUP_VALUES.includes(group)) {
      errors.push(`parallel-group 无效: ${metadata['parallel-group']}；允许值: ${PARALLEL_GROUP_VALUES.join(', ')}`);
    }
  }
  if (metadata['owner-role']) {
    const role = normalizeToken(metadata['owner-role']);
    if (!OWNER_ROLE_VALUES.includes(role)) {
      errors.push(`owner-role 无效: ${metadata['owner-role']}；允许值: ${OWNER_ROLE_VALUES.join(', ')}`);
    }
  }
  if (metadata['integration-owner']) {
    const owner = normalizeToken(metadata['integration-owner']);
    if (!INTEGRATION_OWNER_VALUES.includes(owner)) {
      errors.push(`integration-owner 无效: ${metadata['integration-owner']}；允许值: ${INTEGRATION_OWNER_VALUES.join(', ')}`);
    }
  }

  const hasExecutionMetadata = EXECUTION_STRATEGY_METADATA_KEYS.some((key) => Boolean(metadata[key]));
  if (hasExecutionMetadata) {
    if (normalizeWriteScopes(metadata['write-scope']).length === 0) {
      errors.push('已声明执行策略，但缺少 write-scope。');
    }
    if (!String(metadata['local-verify'] ?? task.verify ?? '').trim()) {
      errors.push('已声明执行策略，但缺少 local-verify 或 verify。');
    }
  }

  const role = normalizeToken(metadata['owner-role']);
  if (role === 'worker' && !String(metadata['integration-owner'] ?? '').trim()) {
    errors.push('worker 任务必须声明 integration-owner。');
  }
  return errors;
}

export function summarizeTaskExecutionStrategies(tasks = []) {
  const modeCounts = Object.fromEntries(EXECUTION_MODE_VALUES.map((mode) => [mode, 0]));
  const groupCounts = Object.fromEntries(PARALLEL_GROUP_VALUES.map((group) => [group, 0]));
  const ownerRoleCounts = Object.fromEntries(OWNER_ROLE_VALUES.map((role) => [role, 0]));
  const taskStrategies = [];
  let explicit = 0;
  let inferred = 0;
  let workerCount = 0;
  let isolatedCount = 0;
  let writeScopeDeclared = 0;

  for (const task of tasks) {
    const strategy = taskExecutionStrategy(task);
    if (strategy.inferred) {
      inferred += 1;
    } else {
      explicit += 1;
    }
    modeCounts[strategy.mode] = (modeCounts[strategy.mode] ?? 0) + 1;
    groupCounts[strategy.parallelGroup] = (groupCounts[strategy.parallelGroup] ?? 0) + 1;
    ownerRoleCounts[strategy.ownerRole] = (ownerRoleCounts[strategy.ownerRole] ?? 0) + 1;
    if (strategy.ownerRole === 'worker') {
      workerCount += 1;
    }
    if (strategy.mode === 'parallel-workers-isolated') {
      isolatedCount += 1;
    }
    if ((strategy.writeScope ?? []).length > 0) {
      writeScopeDeclared += 1;
    }
    taskStrategies.push({
      id: task.id ?? null,
      title: task.title ?? null,
      mode: strategy.mode,
      parallelGroup: strategy.parallelGroup,
      ownerRole: strategy.ownerRole,
      integrationOwner: strategy.integrationOwner,
      writeScope: strategy.writeScope,
      localVerify: strategy.localVerify,
      inferred: strategy.inferred,
      description: describeExecutionStrategy(strategy),
    });
  }

  const total = taskStrategies.length;
  const warnings = [];
  if (total > 0 && explicit === 0) {
    warnings.push('当前任务尚未显式声明执行策略，run/loop 将使用结构推导结果。');
  }
  if (workerCount > 0 && writeScopeDeclared < workerCount) {
    warnings.push('部分 worker 任务缺少明确 write-scope，主 Agent 分片时需要先补边界。');
  }
  if (isolatedCount > 0 && ownerRoleCounts.worker === 0) {
    warnings.push('声明了 isolated 执行模式，但没有 worker 角色任务。');
  }

  return {
    total,
    explicit,
    inferred,
    workerCount,
    isolatedCount,
    writeScopeDeclared,
    modeCounts,
    groupCounts,
    ownerRoleCounts,
    tasks: taskStrategies,
    warnings,
    recommendations: [
      'L0 或小范围修正默认保持 serial，由主 Agent 直接收口。',
      'L1/L2 中写入范围可切开的任务优先用 parallel-workers，让 worker 先做局部实现和局部验证。',
      '高风险重构或大量实现任务再升级到 parallel-workers-isolated，由主 Agent 统一集成和总验证。',
    ],
  };
}

export function chooseExecutionMode(task = {}) {
  const strategy = taskExecutionStrategy(task);
  return firstKnown([strategy.mode], EXECUTION_MODE_VALUES, 'serial');
}
