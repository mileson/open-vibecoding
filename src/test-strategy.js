const TEST_LAYER_LABELS = {
  unit: '单元测试',
  integration: '集成测试',
  e2e: '端到端测试',
  manual: '人工审查',
  smoke: '冒烟测试',
  visual: '视觉对比',
  performance: '性能测试',
  security: '安全验证',
  weapp: '小程序实测',
  none: '无需专项测试',
};

const TEST_SIZE_LABELS = {
  small: '小规模',
  medium: '中规模',
  large: '大规模',
  manual: '人工',
  advisory: '提示型',
  none: '无',
};

const TEST_SCOPE_LABELS = {
  isolated: '局部逻辑',
  module: '模块边界',
  contract: '契约边界',
  'cli-contract': '命令行契约',
  'api-contract': '接口契约',
  'user-flow': '用户主路径',
  'visual-flow': '视觉路径',
  'media-flow': '音频与转写链路',
  'weapp-runtime': '小程序运行态',
  performance: '性能基线',
  security: '安全边界',
  governance: '治理流程',
  docs: '文档审查',
  none: '无',
};

export const TEST_STRATEGY_METADATA_KEYS = [
  'test-layer',
  'test-size',
  'test-scope',
  'evidence-profile',
  'evidence',
  'evidence-plan',
  'upgrade-reason',
  'waiver',
  'waiver-reason',
];

export const TEST_LAYER_VALUES = Object.keys(TEST_LAYER_LABELS);
export const TEST_SIZE_VALUES = Object.keys(TEST_SIZE_LABELS);
export const TEST_SCOPE_VALUES = Object.keys(TEST_SCOPE_LABELS);
export const EVIDENCE_PROFILE_VALUES = ['audio-asr'];

function normalizeToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function splitValues(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => normalizeToken(item))
    .filter(Boolean);
}

function includesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

const WEAPP_MENTION_PATTERNS = [/weapp|微信小程序|小程序|微信开发者工具/];
const WEAPP_VALIDATION_ACTION_PATTERNS = [
  /测试|验证|实测|复现|截图|日志|抓日志|抓包|网络请求|network|运行态|开发者工具自动化|从\s*0\s*到\s*1|冷启动|全流程/,
];

const AUDIO_MEDIA_MENTION_PATTERNS = [
  /audio|音频|音轨|录音|声音|音量|响度|声道|波形|削波|clipping|混音|降噪|噪声|底噪|静音|无声|消音|哔声|bleep|视频音轨|媒体导出/,
];
const AUDIO_ASR_MENTION_PATTERNS = [
  /\basr\b|speech[- ]?to[- ]?text|语音识别|语音转写|音频转字幕|音频转文字|语音转字幕|transcription|transcript/,
];
const AUDIO_RESULT_ACTION_PATTERNS = [
  /分析|优化|改善|调整|修复|实现|开发|接入|替换|升级|迁移|切换|验证|测试|测量|对比|复测|导出|渲染|烧录|剪辑|切分|同步|识别|转写|转字幕|转文字|生成|异常|失真|错误|质量|准确|漂移|漏字|幻觉|断点|覆盖|时间轴|时间戳|分段|说话人|语言检测|wer|cer/,
];
const AUDIO_RESULT_BOUNDARY_PATTERNS = [
  /最终(?:音频|视频|媒体)|真实(?:音频|音轨|媒体)|视频音轨|音画同步|字幕时间轴|字幕时间戳|烧录|外挂字幕|\bsrt\b|\bvtt\b|响度|声道|波形|削波|clipping|混音|降噪|噪声|底噪|静音|无声|消音|哔声|bleep|转码|媒体导出|导出音频/,
];
const SUBTITLE_TEXT_OR_UI_PATTERNS = [
  /字幕.*(?:文案|翻译|错别字|标点|字体|字号|颜色|排版|布局|样式|卡片|按钮|界面|ui)/,
  /(?:文案|翻译|错别字|标点|字体|字号|颜色|排版|布局|样式|卡片|按钮|界面|ui).*字幕/,
  /transcript.*(?:copy|translation|typo|font|color|layout|style|ui)/,
];
const AUDIO_CONTROL_UI_PATTERNS = [
  /(?:音量|播放|暂停)(?:按钮|滑块|图标|控件).*(?:ui|界面|样式|颜色|布局|交互)/,
  /(?:ui|界面|样式|颜色|布局|交互).*(?:音量|播放|暂停)(?:按钮|滑块|图标|控件)/,
];
const AUDIO_METHODOLOGY_ONLY_PATTERNS = [
  /方法论|skill|schema|证据合同|证据规范|工作流规范|路由规则|评估指南|分析指南|documentation|docs/,
];

function needsMediaEvidence(text) {
  const hasResultBoundary = includesAny(text, AUDIO_RESULT_BOUNDARY_PATTERNS);
  if (includesAny(text, AUDIO_METHODOLOGY_ONLY_PATTERNS) && !hasResultBoundary) {
    return false;
  }
  const textOrUiOnly = (
    includesAny(text, SUBTITLE_TEXT_OR_UI_PATTERNS)
    || includesAny(text, AUDIO_CONTROL_UI_PATTERNS)
  ) && !hasResultBoundary;
  if (textOrUiOnly) {
    return false;
  }
  const hasResultAction = includesAny(text, AUDIO_RESULT_ACTION_PATTERNS);
  if (includesAny(text, AUDIO_ASR_MENTION_PATTERNS)) {
    return hasResultAction || hasResultBoundary;
  }
  return includesAny(text, AUDIO_MEDIA_MENTION_PATTERNS) && hasResultAction;
}

function firstKnown(values, allowed, fallback) {
  return values.find((value) => allowed.includes(value)) ?? fallback;
}

export function normalizeTestLayers(value) {
  const layers = splitValues(value).filter((layer) => TEST_LAYER_VALUES.includes(layer));
  return [...new Set(layers)];
}

export function labelTestLayer(layer) {
  return TEST_LAYER_LABELS[normalizeToken(layer)] ?? layer ?? '未指定';
}

export function labelTestSize(size) {
  return TEST_SIZE_LABELS[normalizeToken(size)] ?? size ?? '未指定';
}

export function labelTestScope(scope) {
  return TEST_SCOPE_LABELS[normalizeToken(scope)] ?? scope ?? '未指定';
}

export function describeTestStrategy(strategy) {
  const layers = (strategy.layers ?? []).map(labelTestLayer).join(' + ') || '未指定';
  const size = labelTestSize(strategy.size);
  const scope = labelTestScope(strategy.scope);
  const evidence = strategy.evidencePlan || strategy.evidence || '未指定证据';
  return `${layers} / ${size} / ${scope}；证据：${evidence}`;
}

export function inferTestStrategyForTask(task = {}) {
  const type = normalizeToken(task.type ?? task.metadata?.type ?? task.metadata?.category ?? task.metadata?.kind);
  const phase = normalizeToken(task.phase);
  const text = [
    task.id,
    task.title,
    task.done,
    task.verify,
    task.metadata?.done,
    task.metadata?.verify,
    task.metadata?.['test-scope'],
    task.metadata?.['evidence-profile'],
    task.metadata?.['evidence-plan'],
  ].map((value) => String(value ?? '')).join('\n').toLowerCase();

  if (type === 'governance' || phase.includes('governance')) {
    return {
      layers: ['manual'],
      size: 'manual',
      scope: 'governance',
      evidencePlan: task.verify ?? task.metadata?.verify ?? 'open-vibecoding change . --validate --change <change-id>',
      upgradeReason: '治理任务以结构校验、评审确认和变更状态证据为主',
      inferred: true,
    };
  }

  if (type === 'documentation' || /docs\/basic|readme|文档|说明书|documentation|docs/i.test(text)) {
    return {
      layers: ['manual'],
      size: 'manual',
      scope: 'docs',
      evidencePlan: task.verify ?? task.metadata?.verify ?? 'open-vibecoding standards . --verify',
      upgradeReason: '文档任务以标准校验和人工审查证据为主',
      inferred: true,
    };
  }

  if (
    normalizeToken(task.metadata?.['evidence-profile']) === 'audio-asr'
    || normalizeToken(task.metadata?.['test-scope']) === 'media-flow'
    || needsMediaEvidence(text)
  ) {
    const layers = ['integration', 'manual'];
    if (includesAny(text, WEAPP_MENTION_PATTERNS) && includesAny(text, WEAPP_VALIDATION_ACTION_PATTERNS)) {
      layers.push('weapp');
    }
    if (includesAny(text, [/perf|performance|性能|耗时|延迟|压力|stress|load|baseline|基线/])) {
      layers.push('performance');
    }
    if (includesAny(text, [/security|权限|敏感|隐私|个人信息|pii|secret|脱敏|安全/])) {
      layers.push('security');
    }
    return {
      layers,
      size: layers.length > 2 ? 'large' : 'medium',
      scope: 'media-flow',
      evidencePlan: '锁定真实来源、目标音轨与摘要，独立采集修改前基线；用同一口径从最终交付媒体重新提取并复测，记录 openprd.media-evidence.v1 与任务专属 baseline/comparison HTML；没有人工 gold transcript 时，ASR 准确率保持 unknown',
      upgradeReason: '触达真实音频、声学结果、ASR/转写或语音派生字幕，源码和中间文件不能替代最终媒体证据',
      inferred: true,
    };
  }

  if (includesAny(text, WEAPP_MENTION_PATTERNS) && includesAny(text, WEAPP_VALIDATION_ACTION_PATTERNS)) {
    return {
      layers: ['integration', 'weapp'],
      size: 'large',
      scope: 'weapp-runtime',
      evidencePlan: '小程序运行态截图、日志、网络请求或其他本地验证证据 + 本任务 verify 命令',
      upgradeReason: '明确要求小程序运行态证据，需要本地运行态验证',
      inferred: true,
    };
  }

  const singleElementCentering = includesAny(text, [/centering-board|center-board|visual centroid|bbox center|canvas center|inside centered|internal centering|内部居中|视觉重心|主体外接框|外接框中心|画布中心|单元素|单个元素|偏心|不居中|没居中|图标内部|图片内部|素材内部|按钮图形|logo center|icon center/]);
  if (includesAny(text, [/visual|视觉|截图|界面|页面|组件|样式|间距|留白|边距|宽度|高度|卡片|对齐|内容槽位|内部槽位|标题|副标题|标签|状态|价格|按钮|密度|圆角|颜色|字号|图标|按钮|padding|margin|spacing|gap|browser|playwright|cypress|e2e|端到端|用户主路径|主流程|内部居中|视觉重心|主体外接框|画布中心|偏心|不居中|没居中/])) {
    return {
      layers: ['integration', 'e2e'],
      size: 'large',
      scope: includesAny(text, [/visual|视觉|截图|样式|间距|留白|边距|宽度|高度|卡片|对齐|内容槽位|内部槽位|标题|副标题|标签|状态|价格|按钮|密度|圆角|颜色|字号|图标|按钮|padding|margin|spacing|gap|内部居中|视觉重心|主体外接框|画布中心|偏心|不居中|没居中/]) ? 'visual-flow' : 'user-flow',
      evidencePlan: singleElementCentering
        ? '主流程自动化、截图或 visual-compare 证据 + 本任务 verify 命令；单元素内部居中要补 centering-board，量测画布中心、主体外接框中心和视觉重心偏移'
        : '主流程自动化、截图或 visual-compare 证据 + 本任务 verify 命令；轻量 UI 可视优化也需要 before/after、verification-board 或 alignment-board 证据，同构卡片/列表要覆盖内部内容槽位',
      upgradeReason: '触达用户可见路径，需要端到端或视觉级证据；轻量 UI 可视优化不能只用构建或 dev-check 收口',
      inferred: true,
    };
  }

  if (includesAny(text, [/perf|performance|性能|压力|stress|load|baseline|基线/])) {
    return {
      layers: ['integration', 'performance'],
      size: 'large',
      scope: 'performance',
      evidencePlan: '性能基线、压力数据或 benchmark 报告 + 本任务 verify 命令',
      upgradeReason: '触达性能或容量边界，需要专项验证证据',
      inferred: true,
    };
  }

  if (includesAny(text, [/security|权限|越权|身份|token|secret|敏感|安全|额度|滥用|成本|限流|并发/])) {
    return {
      layers: ['integration', 'security'],
      size: 'medium',
      scope: 'security',
      evidencePlan: '正向路径 + 越权、额度、并发或敏感信息负向验证',
      upgradeReason: '触达权限、安全、成本或滥用边界，需要至少集成级证据',
      inferred: true,
    };
  }

  if (includesAny(text, [/api|cli|command|契约|contract|schema|json|输出|参数|quality|loop|tasks|agent|hook|skill|生成物|报告/])) {
    return {
      layers: ['unit', 'integration'],
      size: 'medium',
      scope: includesAny(text, [/api|接口/]) ? 'api-contract' : 'cli-contract',
      evidencePlan: '单元测试锁定规则 + 集成或命令行契约验证',
      upgradeReason: '触达 CLI/API/Agent 契约或生成物，需要中间层验证',
      inferred: true,
    };
  }

  if (type === 'verification' || phase.includes('verification') || includesAny(text, [/验证|测试|回归|边界|失败|异常|验收/])) {
    return {
      layers: ['integration'],
      size: 'medium',
      scope: 'module',
      evidencePlan: task.verify ?? task.metadata?.verify ?? '本任务 verify 命令与测试报告',
      upgradeReason: '验证任务默认需要能覆盖模块边界的证据',
      inferred: true,
    };
  }

  return {
    layers: ['unit'],
    size: 'small',
    scope: 'isolated',
    evidencePlan: task.verify ?? task.metadata?.verify ?? '最小相关单元测试或局部命令验证',
    upgradeReason: '默认从最小足够证据开始，触达用户主路径或契约时再升级',
    inferred: true,
  };
}

export function taskTestStrategy(task = {}) {
  const metadata = task.metadata ?? {};
  const inferred = inferTestStrategyForTask(task);
  const explicitLayers = normalizeTestLayers(metadata['test-layer']);
  const rawSize = normalizeToken(metadata['test-size']);
  const rawScope = normalizeToken(metadata['test-scope']);
  return {
    layers: explicitLayers.length > 0 ? explicitLayers : inferred.layers,
    size: TEST_SIZE_VALUES.includes(rawSize) ? rawSize : inferred.size,
    scope: TEST_SCOPE_VALUES.includes(rawScope) ? rawScope : inferred.scope,
    evidenceProfile: EVIDENCE_PROFILE_VALUES.includes(normalizeToken(metadata['evidence-profile']))
      ? normalizeToken(metadata['evidence-profile'])
      : (inferred.scope === 'media-flow' ? 'audio-asr' : null),
    evidence: metadata.evidence ?? null,
    evidencePlan: metadata['evidence-plan'] ?? inferred.evidencePlan,
    upgradeReason: metadata['upgrade-reason'] ?? inferred.upgradeReason,
    waiver: metadata.waiver ?? metadata['waiver-reason'] ?? null,
    inferred: explicitLayers.length === 0 || !TEST_SIZE_VALUES.includes(rawSize) || !TEST_SCOPE_VALUES.includes(rawScope),
  };
}

export function formatTaskTestStrategyMetadata(task = {}) {
  const strategy = inferTestStrategyForTask(task);
  return [
    `test-layer: ${strategy.layers.join(', ')}`,
    `test-size: ${strategy.size}`,
    `test-scope: ${strategy.scope}`,
    ...(strategy.scope === 'media-flow' ? ['evidence-profile: audio-asr'] : []),
    `evidence-plan: ${strategy.evidencePlan}`,
    `upgrade-reason: ${strategy.upgradeReason}`,
  ];
}

export function validateTaskTestStrategy(task = {}) {
  const metadata = task.metadata ?? {};
  const errors = [];
  if (metadata['test-layer']) {
    const rawLayers = splitValues(metadata['test-layer']);
    const invalid = rawLayers.filter((layer) => !TEST_LAYER_VALUES.includes(layer));
    if (invalid.length > 0) {
      errors.push(`test-layer 包含无效取值 ${invalid.join(', ')}；允许值: ${TEST_LAYER_VALUES.join(', ')}`);
    }
  }
  if (metadata['test-size']) {
    const size = normalizeToken(metadata['test-size']);
    if (!TEST_SIZE_VALUES.includes(size)) {
      errors.push(`test-size 无效: ${metadata['test-size']}；允许值: ${TEST_SIZE_VALUES.join(', ')}`);
    }
  }
  if (metadata['test-scope']) {
    const scope = normalizeToken(metadata['test-scope']);
    if (!TEST_SCOPE_VALUES.includes(scope)) {
      errors.push(`test-scope 无效: ${metadata['test-scope']}；允许值: ${TEST_SCOPE_VALUES.join(', ')}`);
    }
  }
  if (metadata['evidence-profile']) {
    const evidenceProfile = normalizeToken(metadata['evidence-profile']);
    if (!EVIDENCE_PROFILE_VALUES.includes(evidenceProfile)) {
      errors.push(`evidence-profile 无效: ${metadata['evidence-profile']}；允许值: ${EVIDENCE_PROFILE_VALUES.join(', ')}`);
    } else if (evidenceProfile === 'audio-asr') {
      if (metadata['test-scope'] && normalizeToken(metadata['test-scope']) !== 'media-flow') {
        errors.push('evidence-profile: audio-asr 必须使用 test-scope: media-flow。');
      }
      const explicitLayers = normalizeTestLayers(metadata['test-layer']);
      if (explicitLayers.length > 0 && (!explicitLayers.includes('integration') || !explicitLayers.includes('manual'))) {
        errors.push('evidence-profile: audio-asr 的显式 test-layer 必须同时包含 integration 与 manual。');
      }
    }
  }
  const layers = normalizeTestLayers(metadata['test-layer']);
  const hasWaiver = Boolean(metadata.waiver || metadata['waiver-reason']);
  const hasEvidencePlan = Boolean(metadata['evidence-plan'] || metadata.evidence);
  const mediaProfile = normalizeToken(metadata['evidence-profile']) === 'audio-asr'
    || normalizeToken(metadata['test-scope']) === 'media-flow';
  if (mediaProfile && hasWaiver) {
    errors.push('media-flow 不接受通用 waiver/waiver-reason；全部媒体声明不适用时用 openprd.media-evidence.v1 的 waived 状态，缺少样本或运行条件时用 blocked。');
  }
  if ((layers.length > 0 || metadata['test-size'] || metadata['test-scope'] || metadata['evidence-profile']) && !hasEvidencePlan && !hasWaiver) {
    errors.push('已声明测试策略，但缺少 evidence-plan/evidence 或 waiver/waiver-reason。');
  }
  return errors;
}

export function summarizeTaskTestStrategies(tasks = []) {
  const layerCounts = Object.fromEntries(TEST_LAYER_VALUES.map((layer) => [layer, 0]));
  const sizeCounts = Object.fromEntries(TEST_SIZE_VALUES.map((size) => [size, 0]));
  const scopeCounts = Object.fromEntries(TEST_SCOPE_VALUES.map((scope) => [scope, 0]));
  const profileCounts = Object.fromEntries(EVIDENCE_PROFILE_VALUES.map((profile) => [profile, 0]));
  const taskStrategies = [];
  let explicit = 0;
  let inferred = 0;
  let evidencePlanned = 0;
  let evidencePresent = 0;
  let waiverCount = 0;

  for (const task of tasks) {
    const strategy = taskTestStrategy(task);
    if (strategy.inferred) {
      inferred += 1;
    } else {
      explicit += 1;
    }
    if (strategy.evidencePlan) {
      evidencePlanned += 1;
    }
    if (strategy.evidence) {
      evidencePresent += 1;
    }
    if (strategy.waiver) {
      waiverCount += 1;
    }
    for (const layer of strategy.layers) {
      layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
    }
    sizeCounts[strategy.size] = (sizeCounts[strategy.size] ?? 0) + 1;
    scopeCounts[strategy.scope] = (scopeCounts[strategy.scope] ?? 0) + 1;
    if (strategy.evidenceProfile) {
      profileCounts[strategy.evidenceProfile] = (profileCounts[strategy.evidenceProfile] ?? 0) + 1;
    }
    taskStrategies.push({
      id: task.id ?? null,
      title: task.title ?? null,
      done: Boolean(task.checked ?? task.done),
      source: task.relativePath ?? task.source ?? null,
      line: task.lineNumber ?? task.line ?? null,
      layers: strategy.layers,
      size: strategy.size,
      scope: strategy.scope,
      evidenceProfile: strategy.evidenceProfile,
      evidence: strategy.evidence,
      evidencePlan: strategy.evidencePlan,
      waiver: strategy.waiver,
      upgradeReason: strategy.upgradeReason,
      inferred: strategy.inferred,
      description: describeTestStrategy(strategy),
    });
  }

  const total = taskStrategies.length;
  const warnings = [];
  if (total > 0 && explicit === 0) {
    warnings.push('当前任务尚未显式声明测试策略，quality 将使用风险推导结果。');
  }
  if (total > 0 && evidencePlanned < total && waiverCount === 0) {
    warnings.push('部分任务缺少 evidence-plan/evidence 或明确豁免理由。');
  }

  return {
    total,
    explicit,
    inferred,
    evidencePlanned,
    evidencePresent,
    waiverCount,
    layerCounts,
    sizeCounts,
    scopeCounts,
    profileCounts,
    tasks: taskStrategies,
    warnings,
    recommendations: [
      '涉及用户操作时，以测试用户从真实入口完成受影响路径并检查最终结果；可安全使用 Computer Use 时优先亲自操作，网页重复回归可使用 Playwright。',
      '环节衔接、典型历史样本和关键局部规则按风险补测；真实业务场景不等于默认操作生产环境，模拟响应不能证明真实链路已通过。',
      '触达真实音频、ASR/转写或语音派生字幕时，保留修改前基线、最终媒体复测和 openprd.media-evidence.v1；纯字幕文案或 UI 可记录豁免。',
      '不按固定测试比例或数量评价质量；区分实际通过、失败、模拟覆盖和未验证项，不删除已有有效测试。',
    ],
  };
}

export function detectTestStrategyCapabilities({ scripts = {}, files = [], dependencyNames = [] } = {}) {
  const scriptEntries = Object.entries(scripts);
  const commandText = scriptEntries.map(([name, command]) => `${name}: ${command}`).join('\n');
  const fileText = files.map((file) => file.path ?? file).join('\n');
  const depsText = dependencyNames.join('\n');
  const haystack = `${commandText}\n${fileText}\n${depsText}`.toLowerCase();
  const commandNames = {
    unit: [/unit|node --test|vitest|jest|mocha|pytest/],
    integration: [/integration|contract|api:test|test:api|test:int/],
    e2e: [/e2e|playwright|cypress|test:ui/],
    smoke: [/smoke/],
    visual: [/visual|screenshot|storybook|chromatic/],
    performance: [/perf|performance|load|stress|k6|lighthouse|autocannon|wrk/],
    security: [/security|audit|sast|semgrep|trivy/],
    weapp: [/weapp|微信小程序|小程序/],
  };
  return Object.fromEntries(Object.entries(commandNames).map(([layer, patterns]) => {
    const commands = scriptEntries
      .filter(([name, command]) => patterns.some((pattern) => pattern.test(`${name}: ${command}`.toLowerCase())))
      .map(([name, command]) => `${name}: ${command}`);
    const present = commands.length > 0 || patterns.some((pattern) => pattern.test(haystack));
    return [layer, { present, commands }];
  }));
}

export function choosePrimaryTestLayer(task = {}) {
  const strategy = taskTestStrategy(task);
  return firstKnown(strategy.layers, TEST_LAYER_VALUES, 'unit');
}
