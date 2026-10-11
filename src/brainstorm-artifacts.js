/*
 * 核心功能
 * 渲染脑暴模式的稳定 HTML 工作台、Markdown 数据源和展示文案校验契约。
 *
 * 输入
 * 接收脑暴状态 record、数据源路径和展示文案结构。
 *
 * 输出
 * 导出 brainstorm.html、data.md、capture-patch.json 对应的渲染器与展示约束。
 *
 * 定位
 * 位于脑暴模式表现层，复用 Open VibeCoding artifact 习惯，不直接负责 workspace 状态写入。
 *
 * 依赖
 * 依赖变更摘要风格约定；由 brainstorm.js 与 brainstorm-presentation.js 组合调用。
 *
 * 维护规则
 * 修改页面结构或 presentation 契约时，必须同步维护 HTML、Markdown 与校验规则的一致性。
 */
import { USER_CHANGE_SUMMARY_GUIDE } from './change-summary.js';

const BRAINSTORM_PANEL_ORDER = [
  'userSignals',
  'marketSignals',
  'validationLoop',
  'businessViability',
  'minimalistReview',
  'risks',
  'reuseOpportunities',
];

const BRAINSTORM_PANEL_META = {
  businessGoals: {
    title: '想达到什么结果',
    description: '把这次最想换来的结果说清楚，避免一开始就铺太大。',
    emptyText: '待补充这次想达到的结果。',
  },
  userSignals: {
    title: '现状与机会',
    description: '先看谁真的会遇到这个问题、现在怎么解决，以及为什么这次值得现在做。',
    emptyText: '待补充真实场景、现有做法和这次为什么现在做。',
  },
  marketSignals: {
    title: '方向对比',
    description: '不要只有一条路，先比较推荐方向、备选方向和第一版取舍。',
    emptyText: '待补充推荐方向、备选方向和第一版边界。',
  },
  validationLoop: {
    title: '验证闭环',
    description: '先说清去哪里找人、为什么你能先触达、用户现在怎么解决，以及不做完整产品时先怎么跑起来。',
    emptyText: '待补充社区入口、社区契合、当前替代方案和手工交付路径。',
  },
  businessViability: {
    title: '商业闭环',
    description: '先定义真实承诺、付费验证、最低成本验证动作，以及验证阶段怎样先活下来。',
    emptyText: '待补充承诺信号、付费证明、最低成本验证和先活下来方案。',
  },
  minimalistReview: {
    title: '极简判断',
    description: '把保持小的执行方式、产品化门槛、可逆性和价值观判断摆出来，避免自嗨式扩张。',
    emptyText: '待补充保持小的做法、产品化门槛和极简判断。',
  },
  reuseOpportunities: {
    title: '现有基础与复用',
    description: '先看现在已经有什么能直接借，还需要谁一起参与或拍板。',
    emptyText: '待补充可复用能力、已有材料和关键参与方。',
  },
  risks: {
    title: '假设与验证',
    description: '把这件事成立的关键前提、先怎么低成本验证，以及什么情况下先停说清楚。',
    emptyText: '待补充关键前提、验证动作和止损线。',
  },
  nextSteps: {
    title: '第一版怎么推进',
    description: '先明确第一版打算怎么落，不把所有可能性都摊平。',
    emptyText: '待补充第一版推进建议。',
  },
};

const BRAINSTORM_TONE_META = {
  businessGoals: { tone: 'function', icon: 'goal' },
  userSignals: { tone: 'flow', icon: 'user' },
  marketSignals: { tone: 'map', icon: 'market' },
  validationLoop: { tone: 'success', icon: 'goal' },
  businessViability: { tone: 'guardrail', icon: 'next' },
  minimalistReview: { tone: 'map', icon: 'risk' },
  reuseOpportunities: { tone: 'guardrail', icon: 'reuse' },
  risks: { tone: 'risk', icon: 'risk' },
  nextSteps: { tone: 'success', icon: 'next' },
  benchmark: { tone: 'map', icon: 'benchmark' },
  knowledge: { tone: 'function', icon: 'knowledge' },
  workspace: { tone: 'flow', icon: 'workspace' },
  files: { tone: 'guardrail', icon: 'files' },
};

const BRAINSTORM_SCENE_TYPES = new Set(['focus-strip', 'option-compare', 'reuse-bridge', 'assumption-map', 'validation-ladder']);
const BRAINSTORM_SCENE_TONES = new Set(['function', 'flow', 'success', 'guardrail', 'map', 'risk']);

const BRAINSTORM_PRESENTATION_CONTRACT = {
  intent: '这些限制用于让 Agent 先提炼出可评审的脑暴摘要，再渲染稳定 brainstorm.html。',
  summaryStyle: USER_CHANGE_SUMMARY_GUIDE,
  expectedDataShape: {
    brainstormPresentation: {
      hero: {
        summary: '120 字以内说清这次到底在讨论什么',
        direction: '40 字以内说清目前更建议怎么做',
        confidence: '28 字以内说清还差什么确认',
      },
      visualScenes: [
        {
          type: 'focus-strip | option-compare | reuse-bridge | assumption-map | validation-ladder',
          title: '24 字以内图示标题',
          subtitle: '64 字以内补充说明',
          items: [
            {
              label: '12 字以内角标',
              title: '18 字以内主标题',
              detail: '36 字以内说明',
              tone: 'function | flow | success | guardrail | map | risk',
            },
          ],
        },
      ],
      panels: {
        userSignals: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
        marketSignals: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
        validationLoop: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
        businessViability: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
        minimalistReview: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
        reuseOpportunities: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
        risks: [{ summary: '15 字以内标签', detail: '60 字以内说明' }],
      },
    },
  },
  rules: [
    {
      id: 'brainstorm-hero-summary',
      area: '顶部摘要',
      target: 'hero.summary',
      maxChars: 120,
      action: '请把执行摘要压缩成 120 字以内，让用户一眼知道这次到底在讨论什么。',
    },
    {
      id: 'brainstorm-hero-direction',
      area: '顶部摘要',
      target: 'hero.direction',
      maxChars: 40,
      action: '请把当前更建议怎么做压缩成 40 字以内，不要写成长段落。',
    },
    {
      id: 'brainstorm-hero-confidence',
      area: '顶部摘要',
      target: 'hero.confidence',
      maxChars: 28,
      action: '请把还差什么确认压缩成短句，例如“还差 1 轮用户验证”。',
    },
    {
      id: 'brainstorm-panel-summary',
      area: '评审卡片',
      target: 'panel.summary',
      maxChars: 18,
      action: '请把摘要标签控制在 18 字以内，优先用业务语言，不用内部术语。',
    },
    {
      id: 'brainstorm-panel-detail',
      area: '评审卡片',
      target: 'panel.detail',
      maxChars: 60,
      action: '请把每条说明压缩成 60 字以内，保留结论和判断依据。',
    },
    {
      id: 'brainstorm-panel-format',
      area: '评审卡片',
      target: 'panel item',
      format: '{ summary, detail }',
      action: '请写成 { "summary": "...", "detail": "..." } 结构，不要直接塞整段文本。',
    },
    {
      id: 'brainstorm-scene-type',
      area: '可视化区域',
      target: 'visualScenes[].type',
      enum: ['focus-strip', 'option-compare', 'reuse-bridge', 'assumption-map', 'validation-ladder'],
      action: '请从 focus-strip、option-compare、reuse-bridge、assumption-map、validation-ladder 里选一种图型，不要自造类型名。',
    },
    {
      id: 'brainstorm-scene-title',
      area: '可视化区域',
      target: 'visualScenes[].title',
      maxChars: 24,
      action: '请把可视化标题压缩成 24 字以内，让用户一眼知道这张图在讲什么。',
    },
    {
      id: 'brainstorm-scene-subtitle',
      area: '可视化区域',
      target: 'visualScenes[].subtitle',
      maxChars: 64,
      action: '请把可视化补充说明控制在 64 字以内，不要写成长段落。',
    },
    {
      id: 'brainstorm-scene-item-label',
      area: '可视化区域',
      target: 'visualScenes[].items[].label',
      maxChars: 12,
      action: '请把图示角标控制在 12 字以内。',
    },
    {
      id: 'brainstorm-scene-item-title',
      area: '可视化区域',
      target: 'visualScenes[].items[].title',
      maxChars: 18,
      action: '请把图示主标题控制在 18 字以内，优先用业务语言。',
    },
    {
      id: 'brainstorm-scene-item-detail',
      area: '可视化区域',
      target: 'visualScenes[].items[].detail',
      maxChars: 36,
      action: '请把图示说明控制在 36 字以内，保留判断重点。',
    },
  ],
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizedText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function visibleChars(value) {
  return Array.from(normalizedText(value)).length;
}

function listOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizedText(item))
    .filter(Boolean);
}

function toYamlLines(value, depth = 0) {
  const indent = '  '.repeat(depth);
  const scalar = (input) => JSON.stringify(String(input ?? ''));
  if (Array.isArray(value)) {
    if (value.length === 0) return [`${indent}[]`];
    return value.flatMap((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (keys.length === 0) return [`${indent}- {}`];
        const firstKey = keys[0];
        const head = item[firstKey];
        const lines = [`${indent}- ${firstKey}:`];
        lines.push(...toYamlLines(head, depth + 2));
        for (const key of keys.slice(1)) {
          lines.push(`${indent}  ${key}:`);
          lines.push(...toYamlLines(item[key], depth + 2));
        }
        return lines;
      }
      return [`${indent}- ${scalar(item)}`];
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => {
      if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
        return [`${indent}${key}:`, ...toYamlLines(entry, depth + 1)];
      }
      return [`${indent}${key}: ${scalar(entry)}`];
    });
  }
  return [`${indent}${scalar(value)}`];
}

function renderArtifactFrontmatter(value) {
  const lines = ['---'];
  for (const [key, entry] of Object.entries(value)) {
    if (Array.isArray(entry) || (entry && typeof entry === 'object')) {
      lines.push(`${key}:`);
      lines.push(...toYamlLines(entry, 1));
    } else {
      lines.push(`${key}: ${String(entry ?? '')}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function summarizeText(value, fallback = '待补充') {
  return normalizedText(value) || fallback;
}

function firstLineSummary(value) {
  const text = normalizedText(value);
  if (!text) return '重点';
  const segment = text.split(/[。；;，,、.!?？]/u).map((item) => item.trim()).find((item) => item.length >= 2 && item.length <= 18);
  return segment || text.slice(0, 18);
}

function normalizeStructuredPanelItem(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const summary = normalizedText(value.summary ?? value.title ?? '');
    const detail = normalizedText(value.detail ?? value.text ?? value.value ?? '');
    return {
      summary: summary || firstLineSummary(detail),
      detail: detail || summary,
      structured: Boolean(summary && detail),
    };
  }
  const detail = normalizedText(value);
  return {
    summary: firstLineSummary(detail),
    detail,
    structured: false,
  };
}

function brainstormPresentation(record) {
  const value = record?.brainstormPresentation;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function presentationPanelItems(record, kind, fallbackItems) {
  const panels = brainstormPresentation(record).panels;
  const value = panels && typeof panels === 'object' && !Array.isArray(panels) ? panels[kind] : null;
  const items = Array.isArray(value) && value.length > 0 ? value : fallbackItems;
  return items.map((item) => normalizeStructuredPanelItem(item)).filter((item) => item.summary || item.detail);
}

function presentationHero(record) {
  const hero = brainstormPresentation(record).hero;
  const current = hero && typeof hero === 'object' && !Array.isArray(hero) ? hero : {};
  return {
    summary: summarizeText(current.summary ?? record?.report?.executiveSummary, '待补充本次讨论摘要'),
    direction: summarizeText(current.direction ?? record?.summary?.recommendedDirection, '待补充目前更建议的做法'),
    confidence: summarizeText(current.confidence ?? record?.summary?.confidenceLabel, '待补充还差什么确认'),
  };
}

function normalizeSceneTone(value, fallback = 'function') {
  const tone = normalizedText(value);
  return BRAINSTORM_SCENE_TONES.has(tone) ? tone : fallback;
}

function normalizeVisualSceneItem(value, fallbackTone = 'function') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const rawTone = normalizedText(value.tone);
  const label = summarizeText(value.label, '');
  const title = summarizeText(value.title ?? value.summary, '');
  const detail = summarizeText(value.detail ?? value.text ?? value.description, '');
  if (!label && !title && !detail) return null;
  return {
    label: label || '重点',
    title: title || firstLineSummary(detail),
    detail: detail || title || label,
    tone: normalizeSceneTone(rawTone, fallbackTone),
    rawTone,
  };
}

function normalizeVisualScene(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const type = normalizedText(value.type);
  const items = Array.isArray(value.items)
    ? value.items.map((item) => normalizeVisualSceneItem(item)).filter(Boolean)
    : [];
  if (items.length === 0) return null;
  return {
    type,
    title: summarizeText(value.title, ''),
    subtitle: summarizeText(value.subtitle, ''),
    items,
  };
}

function panelExample(kind) {
  return `{ "summary": "${BRAINSTORM_PANEL_META[kind]?.title ?? '标签'}", "detail": "一句话说明" }`;
}

function joinedText(items, { limit = 2, separator = '、', fallback = '待补充' } = {}) {
  const normalized = listOfStrings(items).slice(0, limit);
  return normalized.length > 0 ? normalized.join(separator) : fallback;
}

function firstText(items, fallback = '') {
  return listOfStrings(items)[0] || fallback;
}

function defaultVisualScene(summary) {
  return {
    type: 'focus-strip',
    title: '一眼看懂这次讨论',
    subtitle: '先把为什么要聊、想达到什么、现在怎么做、推荐先走哪条路串起来，再决定是否进入 PRD。',
    items: [
      { label: '核心诉求', title: '核心诉求', detail: summary.coreRequest, tone: 'function' },
      { label: '目标结果', title: '目标结果', detail: summary.targetOutcome, tone: 'flow' },
      { label: '当前做法', title: '当前做法', detail: summary.currentAlternative, tone: 'guardrail' },
      { label: '推荐方向', title: '推荐方向', detail: summary.recommendedDirection, tone: 'success' },
    ],
  };
}

function defaultValidationScene(summary) {
  return {
    type: 'validation-ladder',
    title: '先验证什么，再决定做多大',
    subtitle: '先把关键前提、最低成本验证、过关标准和先停条件摆出来，避免带着模糊假设直接进入实现。',
    items: [
      { label: '关键前提', title: '先确认什么必须为真', detail: summary.validationFocus, tone: 'risk' },
      { label: '先怎么验', title: '优先做最低成本验证', detail: summary.validationStep, tone: 'map' },
      { label: '什么算过', title: '先定义过关标准', detail: summary.successSignal, tone: 'success' },
      { label: '什么先停', title: '提前约定止损线', detail: summary.stopLossSignal, tone: 'guardrail' },
    ],
  };
}

function defaultVisualScenes(record, summary) {
  const scenes = [defaultVisualScene(summary)];
  const hasValidationSignals = listOfStrings(record?.captureState?.assumptions).length > 0
    || listOfStrings(record?.captureState?.successMetrics).length > 0
    || listOfStrings(record?.captureState?.stopLossActions).length > 0
    || normalizedText(record?.captureState?.nextStep);
  if (hasValidationSignals) {
    scenes.push(defaultValidationScene(summary));
  }
  return scenes;
}

function presentationVisualScenes(record, summary) {
  const scenes = brainstormPresentation(record).visualScenes;
  const normalized = Array.isArray(scenes)
    ? scenes.map((scene) => normalizeVisualScene(scene)).filter(Boolean)
    : [];
  if (normalized.length > 0) return normalized;
  return defaultVisualScenes(record, summary);
}

export function buildBrainstormPresentationFeedback(record) {
  const violations = [];
  const hero = presentationHero(record);
  const sceneSummary = buildPrimarySummary(record, hero);
  const visualScenes = presentationVisualScenes(record, sceneSummary);
  const addViolation = ({ ruleId, area, target, value, maxChars, jsonPath = null, action = null }) => {
    const currentChars = visibleChars(value);
    if (currentChars <= maxChars) return;
    violations.push({
      ruleId,
      area,
      target,
      jsonPath,
      currentChars,
      maxChars,
      currentText: normalizedText(value),
      action: action ?? '请让 Agent 重新提炼这段内容，不要靠 HTML 截断。',
    });
  };

  addViolation({
    ruleId: 'brainstorm-hero-summary',
    area: '顶部摘要',
    target: 'hero.summary',
    value: hero.summary,
    maxChars: 120,
    jsonPath: 'brainstormPresentation.hero.summary',
  });
  addViolation({
    ruleId: 'brainstorm-hero-direction',
    area: '顶部摘要',
    target: 'hero.direction',
    value: hero.direction,
    maxChars: 40,
    jsonPath: 'brainstormPresentation.hero.direction',
  });
  addViolation({
    ruleId: 'brainstorm-hero-confidence',
    area: '顶部摘要',
    target: 'hero.confidence',
    value: hero.confidence,
    maxChars: 28,
    jsonPath: 'brainstormPresentation.hero.confidence',
  });

  for (const kind of BRAINSTORM_PANEL_ORDER) {
    const panels = brainstormPresentation(record).panels;
    const explicitPanelItems = panels && typeof panels === 'object' && !Array.isArray(panels)
      ? panels[kind]
      : null;
    const hasExplicitPanelItems = Array.isArray(explicitPanelItems) && explicitPanelItems.length > 0;
    const fallbackItems = listOfStrings(record?.report?.[kind]);
    const items = presentationPanelItems(record, kind, fallbackItems);
    if (!hasExplicitPanelItems) {
      continue;
    }
    items.forEach((item, index) => {
      addViolation({
        ruleId: 'brainstorm-panel-summary',
        area: BRAINSTORM_PANEL_META[kind]?.title ?? kind,
        target: 'panel.summary',
        value: item.summary,
        maxChars: 18,
        jsonPath: `brainstormPresentation.panels.${kind}[${index}].summary`,
      });
      addViolation({
        ruleId: 'brainstorm-panel-detail',
        area: BRAINSTORM_PANEL_META[kind]?.title ?? kind,
        target: 'panel.detail',
        value: item.detail,
        maxChars: 60,
        jsonPath: `brainstormPresentation.panels.${kind}[${index}].detail`,
      });
      if (item.structured) return;
      violations.push({
        ruleId: 'brainstorm-panel-format',
        area: BRAINSTORM_PANEL_META[kind]?.title ?? kind,
        target: 'panel item',
        jsonPath: `brainstormPresentation.panels.${kind}[${index}]`,
        expectedFormat: '{ summary, detail }',
        currentText: item.detail,
        action: `请写入 brainstormPresentation.panels.${kind}[${index}]，格式例如 ${panelExample(kind)}。`,
      });
    });
  }

  visualScenes.forEach((scene, sceneIndex) => {
    if (!BRAINSTORM_SCENE_TYPES.has(scene.type)) {
      violations.push({
        ruleId: 'brainstorm-scene-type',
        area: '可视化区域',
        target: 'visualScenes[].type',
        jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].type`,
        currentText: scene.type,
        expectedEnum: Array.from(BRAINSTORM_SCENE_TYPES),
        action: '请把图型改成 focus-strip、option-compare、reuse-bridge、assumption-map 或 validation-ladder 之一。',
      });
    }
    addViolation({
      ruleId: 'brainstorm-scene-title',
      area: '可视化区域',
      target: 'visualScenes[].title',
      value: scene.title,
      maxChars: 24,
      jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].title`,
    });
    addViolation({
      ruleId: 'brainstorm-scene-subtitle',
      area: '可视化区域',
      target: 'visualScenes[].subtitle',
      value: scene.subtitle,
      maxChars: 64,
      jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].subtitle`,
    });
    scene.items.forEach((item, itemIndex) => {
      addViolation({
        ruleId: 'brainstorm-scene-item-label',
        area: '可视化区域',
        target: 'visualScenes[].items[].label',
        value: item.label,
        maxChars: 12,
        jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].items[${itemIndex}].label`,
      });
      addViolation({
        ruleId: 'brainstorm-scene-item-title',
        area: '可视化区域',
        target: 'visualScenes[].items[].title',
        value: item.title,
        maxChars: 18,
        jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].items[${itemIndex}].title`,
      });
      addViolation({
        ruleId: 'brainstorm-scene-item-detail',
        area: '可视化区域',
        target: 'visualScenes[].items[].detail',
        value: item.detail,
        maxChars: 36,
        jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].items[${itemIndex}].detail`,
      });
      if (item.rawTone && !BRAINSTORM_SCENE_TONES.has(item.rawTone)) {
        violations.push({
          ruleId: 'brainstorm-scene-type',
          area: '可视化区域',
          target: 'visualScenes[].items[].tone',
          jsonPath: `brainstormPresentation.visualScenes[${sceneIndex}].items[${itemIndex}].tone`,
          currentText: item.rawTone,
          expectedEnum: Array.from(BRAINSTORM_SCENE_TONES),
          action: '请把 tone 改成 function、flow、success、guardrail、map 或 risk。',
        });
      }
    });
  });

  return {
    contract: BRAINSTORM_PRESENTATION_CONTRACT,
    violations,
  };
}

function buildBrainstormCapturePatch(record) {
  const captureState = record?.captureState ?? {};
  return {
    'problem.problemStatement': { value: captureState.problemStatement ?? '', source: 'user-confirmed' },
    'problem.whyNow': { value: captureState.whyNow ?? '', source: 'user-confirmed' },
    'users.primaryUsers': { value: listOfStrings(captureState.primaryUsers), source: 'user-confirmed' },
    'users.stakeholders': { value: listOfStrings(captureState.stakeholders), source: 'user-confirmed' },
    'validation.community': { value: listOfStrings(captureState.community), source: 'user-confirmed' },
    'validation.seedUsers': { value: listOfStrings(captureState.seedUsers), source: 'user-confirmed' },
    'validation.communityFit': { value: listOfStrings(captureState.communityFit), source: 'user-confirmed' },
    'validation.currentAlternative': { value: normalizedText(captureState.currentAlternative || captureState.asIs), source: 'user-confirmed' },
    'validation.painEvidence': { value: listOfStrings(captureState.painEvidence), source: 'user-confirmed' },
    'validation.manualPath': { value: listOfStrings(captureState.manualPath), source: 'user-confirmed' },
    'validation.manualPlaybook': { value: listOfStrings(captureState.manualPlaybook), source: 'user-confirmed' },
    'validation.commitmentSignals': { value: listOfStrings(captureState.commitmentSignals), source: 'user-confirmed' },
    'validation.firstValidationStep': { value: normalizedText(captureState.firstValidationStep || captureState.nextStep), source: 'user-confirmed' },
    'validation.defaultAlivePlan': { value: listOfStrings(captureState.defaultAlivePlan), source: 'user-confirmed' },
    'validation.paymentProof': { value: listOfStrings(captureState.paymentProof), source: 'user-confirmed' },
    'validation.mvpSlice': { value: normalizedText(captureState.mvpSlice), source: 'user-confirmed' },
    'validation.weekendTest': { value: normalizedText(captureState.weekendTest), source: 'user-confirmed' },
    'validation.smallestExecution': { value: listOfStrings(captureState.smallestExecution), source: 'user-confirmed' },
    'validation.productizeGate': { value: listOfStrings(captureState.productizeGate), source: 'user-confirmed' },
    'validation.firstCustomerPath': { value: listOfStrings(captureState.firstCustomerPath), source: 'user-confirmed' },
    'validation.pricingHypothesis': { value: normalizedText(captureState.pricingHypothesis), source: 'user-confirmed' },
    'validation.customerOneProfitability': { value: normalizedText(captureState.customerOneProfitability), source: 'user-confirmed' },
    'validation.growthDiscipline': { value: listOfStrings(captureState.growthDiscipline), source: 'user-confirmed' },
    'validation.reversibility': { value: normalizedText(captureState.reversibility), source: 'user-confirmed' },
    'validation.customerTruth': { value: normalizedText(captureState.customerTruth), source: 'user-confirmed' },
    'validation.valuesFit': { value: normalizedText(captureState.valuesFit), source: 'user-confirmed' },
    'goals.goals': { value: listOfStrings(captureState.goals), source: 'user-confirmed' },
    'goals.successMetrics': { value: listOfStrings(captureState.successMetrics), source: 'user-confirmed' },
    'scope.inScope': { value: listOfStrings(captureState.inScope), source: 'user-confirmed' },
    'scope.outOfScope': { value: listOfStrings(captureState.outOfScope), source: 'user-confirmed' },
    'scenarios.primaryFlows': { value: listOfStrings(captureState.primaryFlows), source: 'user-confirmed' },
    'typeSpecific.fields.asIs': { value: normalizedText(captureState.asIs), source: 'user-confirmed' },
    'typeSpecific.fields.toBe': { value: normalizedText(captureState.toBe), source: 'user-confirmed' },
    'risks.assumptions': { value: listOfStrings(captureState.assumptions), source: 'user-confirmed' },
    'risks.openQuestions': { value: listOfStrings(captureState.openQuestions), source: 'user-confirmed' },
    'businessGuardrails.stopLossActions': { value: listOfStrings(captureState.stopLossActions), source: 'user-confirmed' },
    'handoff.nextStep': { value: normalizedText(captureState.nextStep), source: 'user-confirmed' },
  };
}

export function renderBrainstormPatch({ record }) {
  return buildBrainstormCapturePatch(record);
}

export function renderBrainstormMarkdown({ record }) {
  const frontmatter = renderArtifactFrontmatter({
    schema: 'openprd.artifact.v1',
    kind: 'brainstorm',
    artifactId: record.artifactId,
    title: record.title,
    topic: record.topic,
    digest: record.digest,
    capturePatch: buildBrainstormCapturePatch(record),
    brainstormState: {
      topic: record.topic,
      generatedAt: record.generatedAt,
      recommendedDirection: record.summary?.recommendedDirection ?? null,
      confidenceLabel: record.summary?.confidenceLabel ?? null,
    },
  });

  const sections = [
    ['本次讨论摘要', [record.report?.executiveSummary ?? '待补充']],
    ['核心诉求', [summarizeText(record?.captureState?.problemStatement, '待补充核心诉求')]],
    ['目标结果', [
      summarizeText(firstText(record?.captureState?.goals), '待补充目标结果'),
      ...listOfStrings(record?.captureState?.successMetrics).map((item) => `验证标准：${item}`),
    ]],
    ['当前替代方案', [
      summarizeText(normalizedText(record?.captureState?.currentAlternative || record?.captureState?.asIs), '待补充现在主要怎么解决'),
      ...listOfStrings(record?.captureState?.communityFit).map((item) => `社区契合：${item}`),
      ...listOfStrings(record?.captureState?.painEvidence).map((item) => `痛点证据：${item}`),
      summarizeText(record?.captureState?.whyNow, '待补充为什么现在值得做'),
    ]],
    ['验证闭环', [
      ...listOfStrings(record?.report?.validationLoop),
      ...listOfStrings(record?.captureState?.manualPath).map((item) => `手工路径：${item}`),
      ...listOfStrings(record?.captureState?.manualPlaybook).map((item) => `手工作战卡：${item}`),
    ]],
    ['商业闭环', [
      ...listOfStrings(record?.report?.businessViability),
      ...listOfStrings(record?.captureState?.commitmentSignals).map((item) => `承诺信号：${item}`),
      ...listOfStrings(record?.captureState?.paymentProof).map((item) => `付费证明：${item}`),
      ...listOfStrings(record?.captureState?.growthDiscipline).map((item) => `增长纪律：${item}`),
    ]],
    ['一件事 MVP 与成交路径', [
      summarizeText(record?.captureState?.mvpSlice, '待补充第一版只做一件事'),
      summarizeText(record?.captureState?.weekendTest, '待补充周末级验证'),
      ...listOfStrings(record?.captureState?.smallestExecution).map((item) => `最小工具桥接：${item}`),
      ...listOfStrings(record?.captureState?.productizeGate).map((item) => `产品化门槛：${item}`),
      ...listOfStrings(record?.captureState?.firstCustomerPath).map((item) => `第一批客户路径：${item}`),
      summarizeText(record?.captureState?.pricingHypothesis, '待补充初始收费假设'),
      summarizeText(record?.captureState?.customerOneProfitability, '待补充客户 1 盈利路径'),
    ]],
    ['极简判断', listOfStrings(record?.report?.minimalistReview)],
    ['推荐方向', [
      summarizeText(record?.summary?.recommendedDirection, '待补充推荐方向'),
      ...listOfStrings(record.report?.directionOptions).slice(0, 3),
    ]],
    ['现状与机会', listOfStrings(record.report?.currentSituation)],
    ['方向对比', listOfStrings(record.report?.directionOptions)],
    ['假设与验证', [
      ...listOfStrings(record.report?.validationPlan),
      ...listOfStrings(record.report?.openQuestions),
    ]],
    ['现有基础与复用', listOfStrings(record.report?.reuseFoundation)],
    ['外部参考', listOfStrings(record.report?.externalReferences)],
    ['第一版怎么推进', listOfStrings(record.report?.nextSteps)],
  ];

  const lines = [frontmatter, '# 方向梳理纪要', '', `主题: ${record.topic}`, ''];
  for (const [title, items] of sections) {
    lines.push(`## ${title}`, '');
    if (items.length === 0) {
      lines.push('- 待补充', '');
      continue;
    }
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function resourceList(items, emptyText) {
  const normalized = listOfStrings(items);
  if (normalized.length === 0) {
    return `<li class="empty">${escapeHtml(emptyText)}</li>`;
  }
  return normalized.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

function brainstormTone(kind) {
  return BRAINSTORM_TONE_META[kind] ?? { tone: 'function', icon: 'goal' };
}

function brainstormIcon(kind) {
  const { tone, icon } = brainstormTone(kind);
  const glyph = ({
    goal: '<circle cx="12" cy="12" r="7"></circle><circle cx="12" cy="12" r="3.5"></circle><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"></path>',
    user: '<circle cx="12" cy="8" r="3.5"></circle><path d="M5 19c1.5-3.5 4.1-5 7-5s5.5 1.5 7 5"></path>',
    market: '<circle cx="12" cy="12" r="8"></circle><path d="M12 6v6l4 2"></path>',
    reuse: '<rect x="4" y="5" width="8" height="8" rx="2"></rect><rect x="12" y="11" width="8" height="8" rx="2"></rect><path d="M10 14h4M14 10v4"></path>',
    risk: '<path d="M12 3.5l9 16H3l9-16Z"></path><path d="M12 9v4.5"></path><circle cx="12" cy="17" r="1"></circle>',
    next: '<path d="M4 12h12"></path><path d="m12 6 6 6-6 6"></path>',
    benchmark: '<path d="M7 20V4.5h10l-2.5 3 2.5 3H7"></path>',
    knowledge: '<path d="M8 14c-1.6-1-2.5-2.7-2.5-4.6A6.5 6.5 0 0 1 12 3a6.5 6.5 0 0 1 6.5 6.4c0 1.9-.9 3.6-2.5 4.6"></path><path d="M9.5 18h5"></path><path d="M10 21h4"></path>',
    workspace: '<path d="M3.5 7.5h6l2 2h9v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"></path><path d="M3.5 7.5V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1.5"></path>',
    files: '<path d="M8 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 7 20V5A1.5 1.5 0 0 1 8.5 3.5Z"></path><path d="M14 3.5V8h4"></path><path d="M9.5 12h5"></path><path d="M9.5 16h5"></path>',
  })[icon] ?? '<circle cx="12" cy="12" r="8"></circle>';
  return `<span class="brainstorm-icon brainstorm-icon-${escapeHtml(tone)}" aria-hidden="true"><svg viewBox="0 0 24 24">${glyph}</svg></span>`;
}

function renderPanel(kind, items) {
  const meta = BRAINSTORM_PANEL_META[kind];
  const normalized = items.filter((item) => item.summary || item.detail);
  return `
    <section class="brainstorm-panel brainstorm-panel-${escapeHtml(brainstormTone(kind).tone)}" id="brainstorm-panel-${escapeHtml(kind)}">
      <div class="panel-head">
        ${brainstormIcon(kind)}
        <div>
          <h3>${escapeHtml(meta.title)}</h3>
          <p>${escapeHtml(meta.description)}</p>
        </div>
        <span class="panel-count${normalized.length === 0 ? ' empty' : ''}">${normalized.length === 0 ? '还没聊到' : `${normalized.length} 条`}</span>
      </div>
      <div class="chip-row">
        ${(normalized.length > 0
          ? normalized.map((item) => `<span class="chip highlight">${escapeHtml(item.summary)}</span>`).join('')
          : `<span class="chip muted">${escapeHtml(meta.emptyText)}</span>`)}
      </div>
      <ul class="detail-list">
        ${(normalized.length > 0
          ? normalized.map((item) => `<li><strong>${escapeHtml(item.summary)}</strong><span>：${escapeHtml(item.detail)}</span></li>`).join('')
          : `<li class="empty">${escapeHtml(meta.emptyText)}</li>`)}
      </ul>
    </section>
  `;
}

function renderResourceSection({ kind, title, description, items, emptyText }) {
  return `
    <section class="resource-card resource-card-${escapeHtml(brainstormTone(kind).tone)}">
      <div class="panel-head">
        ${brainstormIcon(kind)}
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(description)}</p>
        </div>
      </div>
      <ul class="resource-list">${resourceList(items, emptyText)}</ul>
    </section>
  `;
}

function buildPrimarySummary(record, hero) {
  return {
    coreRequest: summarizeText(
      record?.captureState?.problemStatement || hero.summary,
      '先把这次真正要解决的问题说清楚。',
    ),
    targetOutcome: summarizeText(
      firstText(record?.captureState?.goals)
        || firstText(record?.report?.directionOptions)
        || '先明确第一版最想换来的结果。',
      '先明确第一版最想换来的结果。',
    ),
    currentAlternative: summarizeText(
      normalizedText(record?.captureState?.currentAlternative || record?.captureState?.asIs)
        || record?.summary?.currentAlternative
        || firstText(record?.report?.currentSituation),
      '先说清现在主要是靠什么办法在解决这件事。',
    ),
    recommendedDirection: summarizeText(
      hero.direction || record?.summary?.recommendedDirection || firstText(record?.report?.nextSteps),
      '先缩小第一版范围，再决定怎么进入 PRD。',
    ),
    validationFocus: summarizeText(
      firstText(record?.captureState?.assumptions) || firstText(record?.report?.validationPlan) || hero.confidence,
      '先补一条关键前提，避免带着模糊假设继续往下做。',
    ),
    validationStep: summarizeText(
      normalizedText(record?.captureState?.firstValidationStep || record?.captureState?.nextStep)
        || firstText(record?.report?.validationPlan)
        || firstText(record?.report?.openQuestions),
      '先定一个最低成本验证动作，再决定是否进入完整 PRD。',
    ),
    successSignal: summarizeText(
      firstText(record?.captureState?.commitmentSignals)
        || firstText(record?.captureState?.successMetrics)
        || firstText(record?.report?.businessViability)
        || firstText(record?.report?.validationPlan),
      '先补 1 条可验证标准，方便判断第一版是否值得继续。',
    ),
    stopLossSignal: summarizeText(
      firstText(record?.captureState?.defaultAlivePlan)
        || firstText(record?.captureState?.stopLossActions)
        || firstText(record?.report?.businessViability)
        || hero.confidence,
      '先约定什么情况下先停，避免范围和投入失控。',
    ),
  };
}

function splitSvgLines(value, maxChars = 14) {
  const text = normalizedText(value);
  if (!text) return ['待补充'];
  const tokens = Array.from(text);
  const lines = [];
  let line = '';
  let length = 0;
  for (const token of tokens) {
    const nextLength = Array.from(token).length;
    if (line && length + nextLength > maxChars) {
      lines.push(line);
      line = token;
      length = nextLength;
    } else {
      line += token;
      length += nextLength;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function svgText(value, x, y, className, maxChars = 14, lineHeight = 16, anchor = 'start') {
  const lines = splitSvgLines(value, maxChars);
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="${anchor}">${lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : lineHeight}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function sceneTonePalette(tone) {
  const palettes = {
    function: { soft: '#eff6ff', line: '#bfdbfe', badge: '#dbeafe', text: '#1d4ed8' },
    flow: { soft: '#ecfdf3', line: '#bbf7d0', badge: '#d1fae5', text: '#047857' },
    success: { soft: '#fffbeb', line: '#fde68a', badge: '#fef3c7', text: '#b45309' },
    guardrail: { soft: '#eef2ff', line: '#c7d2fe', badge: '#e0e7ff', text: '#4338ca' },
    map: { soft: '#f5f3ff', line: '#ddd6fe', badge: '#ede9fe', text: '#6d28d9' },
    risk: { soft: '#fff1f2', line: '#fecdd3', badge: '#ffe4e6', text: '#be123c' },
  };
  return palettes[tone] ?? palettes.function;
}

function sceneCardSvg({ item, x, y, width, height }) {
  const palette = sceneTonePalette(item.tone);
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="18" fill="${palette.soft}" stroke="${palette.line}" />
      <rect x="${x + 20}" y="${y + 18}" width="${Math.max(60, Array.from(item.label).length * 18 + 20)}" height="34" rx="17" fill="${palette.badge}" />
      <text x="${x + 30}" y="${y + 40}" class="brainstorm-scene-badge" fill="${palette.text}">${escapeHtml(item.label)}</text>
      ${svgText(item.title, x + 20, y + 84, 'brainstorm-scene-title', 10, 18)}
      ${svgText(item.detail, x + 20, y + 124, 'brainstorm-scene-copy', 14, 18)}
    </g>
  `;
}

function sceneHeaderKind(type) {
  if (type === 'option-compare') return 'marketSignals';
  if (type === 'reuse-bridge') return 'reuseOpportunities';
  if (type === 'assumption-map' || type === 'validation-ladder') return 'risks';
  return 'nextSteps';
}

function renderFocusStripScene(scene) {
  const items = scene.items.slice(0, 4);
  const cardWidth = 204;
  const cardHeight = 168;
  const positions = [28, 266, 504, 742].slice(0, items.length);
  return `
    <div class="brainstorm-visual-svg-wrap">
      <svg viewBox="0 0 974 214" role="img" aria-label="${escapeHtml(scene.title)}" preserveAspectRatio="xMidYMid meet">
        ${items.map((item, index) => sceneCardSvg({ item, x: positions[index], y: 22, width: cardWidth, height: cardHeight })).join('')}
        ${items.slice(0, -1).map((_item, index) => `<text x="${positions[index] + cardWidth + 17}" y="112" class="brainstorm-scene-arrow">→</text>`).join('')}
      </svg>
    </div>
  `;
}

function renderOptionCompareScene(scene) {
  const items = scene.items.slice(0, 4);
  const count = Math.max(items.length, 2);
  const gap = 22;
  const cardWidth = Math.floor((918 - ((count - 1) * gap)) / count);
  const startX = 28;
  return `
    <div class="brainstorm-visual-svg-wrap">
      <svg viewBox="0 0 974 232" role="img" aria-label="${escapeHtml(scene.title)}" preserveAspectRatio="xMidYMid meet">
        <line x1="40" y1="42" x2="934" y2="42" class="brainstorm-scene-line" />
        ${items.map((item, index) => sceneCardSvg({ item, x: startX + ((cardWidth + gap) * index), y: 52, width: cardWidth, height: 154 })).join('')}
      </svg>
    </div>
  `;
}

function renderReuseBridgeScene(scene) {
  const items = scene.items.slice(0, 3);
  const positions = [38, 332, 626].slice(0, items.length);
  return `
    <div class="brainstorm-visual-svg-wrap">
      <svg viewBox="0 0 974 238" role="img" aria-label="${escapeHtml(scene.title)}" preserveAspectRatio="xMidYMid meet">
        <path d="M 244 109 H 332 M 538 109 H 626" class="brainstorm-scene-line" />
        ${items.map((item, index) => sceneCardSvg({ item, x: positions[index], y: 30, width: 266, height: 158 })).join('')}
        ${items.slice(0, -1).map((_item, index) => `<text x="${positions[index] + 278}" y="116" class="brainstorm-scene-arrow">→</text>`).join('')}
      </svg>
    </div>
  `;
}

function renderAssumptionMapScene(scene) {
  const items = scene.items.slice(0, 4);
  const positions = [
    { x: 40, y: 28 },
    { x: 500, y: 28 },
    { x: 40, y: 148 },
    { x: 500, y: 148 },
  ];
  return `
    <div class="brainstorm-visual-svg-wrap">
      <svg viewBox="0 0 974 326" role="img" aria-label="${escapeHtml(scene.title)}" preserveAspectRatio="xMidYMid meet">
        ${items.map((item, index) => sceneCardSvg({ item, x: positions[index].x, y: positions[index].y, width: 434, height: 110 })).join('')}
      </svg>
    </div>
  `;
}

function renderValidationLadderScene(scene) {
  const items = scene.items.slice(0, 4);
  const cardWidth = 204;
  const cardHeight = 140;
  const positions = [
    { x: 28, y: 84 },
    { x: 266, y: 56 },
    { x: 504, y: 28 },
    { x: 742, y: 56 },
  ].slice(0, items.length);
  return `
    <div class="brainstorm-visual-svg-wrap">
      <svg viewBox="0 0 974 258" role="img" aria-label="${escapeHtml(scene.title)}" preserveAspectRatio="xMidYMid meet">
        <path d="M 230 152 C 256 152, 248 126, 266 126 M 468 124 C 494 124, 486 98, 504 98 M 706 96 C 732 96, 724 126, 742 126" class="brainstorm-scene-line" />
        ${items.map((item, index) => sceneCardSvg({ item, x: positions[index].x, y: positions[index].y, width: cardWidth, height: cardHeight })).join('')}
      </svg>
    </div>
  `;
}

function renderVisualScene(scene, index = 0) {
  const type = BRAINSTORM_SCENE_TYPES.has(scene.type) ? scene.type : 'focus-strip';
  const titleId = `brainstormVisualTitle${index + 1}`;
  const visual =
    type === 'option-compare' ? renderOptionCompareScene(scene)
      : type === 'reuse-bridge' ? renderReuseBridgeScene(scene)
        : type === 'assumption-map' ? renderAssumptionMapScene(scene)
          : type === 'validation-ladder' ? renderValidationLadderScene(scene)
        : renderFocusStripScene(scene);
  return `
    <section class="brainstorm-visual-map" aria-labelledby="${titleId}">
      <div class="brainstorm-section-head">
        ${brainstormIcon(sceneHeaderKind(type))}
        <div>
          <h2 id="${titleId}">${escapeHtml(scene.title)}</h2>
          <p>${escapeHtml(scene.subtitle)}</p>
        </div>
      </div>
      ${visual}
    </section>
  `;
}

function buildBrainstormExportPayload(record, artifactPaths) {
  return {
    artifactId: record.artifactId,
    topic: record.topic,
    digest: record.digest,
    recommendedDirection: record.summary?.recommendedDirection ?? null,
    currentAlternative: record.summary?.currentAlternative ?? null,
    confidenceLabel: record.summary?.confidenceLabel ?? null,
    assumptions: listOfStrings(record.captureState?.assumptions).slice(0, 3),
    communityFit: listOfStrings(record.captureState?.communityFit).slice(0, 3),
    painEvidence: listOfStrings(record.captureState?.painEvidence).slice(0, 3),
    commitmentSignals: listOfStrings(record.captureState?.commitmentSignals).slice(0, 3),
    paymentProof: listOfStrings(record.captureState?.paymentProof).slice(0, 3),
    defaultAlivePlan: listOfStrings(record.captureState?.defaultAlivePlan).slice(0, 3),
    manualPlaybook: listOfStrings(record.captureState?.manualPlaybook).slice(0, 3),
    smallestExecution: listOfStrings(record.captureState?.smallestExecution).slice(0, 3),
    productizeGate: listOfStrings(record.captureState?.productizeGate).slice(0, 3),
    growthDiscipline: listOfStrings(record.captureState?.growthDiscipline).slice(0, 3),
    firstCustomerPath: listOfStrings(record.captureState?.firstCustomerPath).slice(0, 3),
    mvpSlice: normalizedText(record.captureState?.mvpSlice) || null,
    pricingHypothesis: normalizedText(record.captureState?.pricingHypothesis) || null,
    stopLossActions: listOfStrings(record.captureState?.stopLossActions).slice(0, 3),
    openQuestions: listOfStrings(record.report?.openQuestions).slice(0, 5),
    markdownPath: artifactPaths.markdownPath,
    patchPath: artifactPaths.patchPath,
    statePath: artifactPaths.statePath,
    generatedAt: record.generatedAt,
  };
}

function brainstormCopyBundle({ label, commands, payload, message }) {
  const lines = [`OpenPrD Brainstorm: ${label}`];
  if (message) lines.push('', message);
  commands.forEach((command, index) => {
    lines.push('', commands.length > 1 ? `命令 ${index + 1}:` : '命令:', '', command);
  });
  lines.push('', '上下文:', '', payload);
  return lines.join('\n');
}

function renderBottomBar(record, artifactPaths) {
  const payload = JSON.stringify(buildBrainstormExportPayload(record, artifactPaths), null, 2);
  const reopenCommand = 'open-vibecoding brainstorm . --open';
  const captureCommand = `open-vibecoding capture . --artifact-markdown ${shellQuote(artifactPaths.markdownPath)}`;
  const synthesizeCommand = 'open-vibecoding synthesize . --open';
  const continueCopy = brainstormCopyBundle({
    label: '继续一起梳理',
    commands: [reopenCommand],
    message: '先继续把问题、目标、解决思路和还没想透的点聊清楚，不急着进入实现。',
    payload,
  });
  const confirmCopy = brainstormCopyBundle({
    label: '按这个方向整理成 PRD',
    commands: [captureCommand, synthesizeCommand],
    message: '先把这次已经想清楚的内容整理进 PRD，再进入下一步评审，不要顺手把范围扩大成大而全方案。',
    payload,
  });
  const validateCopy = brainstormCopyBundle({
    label: '先整理验证计划',
    commands: [reopenCommand],
    message: '先不要急着进入 PRD，优先补关键前提、低成本验证、过关标准和止损线，先把是否值得继续做判断清楚。',
    payload,
  });

  return `
    <nav class="brainstorm-bottom-bar" aria-label="脑暴决定">
      <div class="brainstorm-bottom-bar-inner">
        <button type="button" class="brainstorm-bottom-action continue" data-copy-value="${escapeHtml(continueCopy)}" title="${escapeHtml(reopenCommand)}">继续一起梳理</button>
        <button type="button" class="brainstorm-bottom-action validate" data-copy-value="${escapeHtml(validateCopy)}" title="${escapeHtml(reopenCommand)}">先整理验证计划</button>
        <button type="button" class="brainstorm-bottom-action confirm" data-copy-value="${escapeHtml(confirmCopy)}" title="${escapeHtml(`${captureCommand}\n${synthesizeCommand}`)}">按这个方向整理成 PRD</button>
      </div>
    </nav>
  `;
}

export function renderBrainstormArtifact({ record, markdownPath, patchPath, statePath }) {
  const hero = presentationHero(record);
  const primarySummary = buildPrimarySummary(record, hero);
  const visualScenes = presentationVisualScenes(record, primarySummary);
  const topMeta = [
    `讨论主题：${record.topic}`,
    `当前阶段：先把方向想清楚`,
    `谁先要用：${joinedText(record?.captureState?.primaryUsers, { fallback: '待补充' })}`,
    `整理时间：${record.generatedAt}`,
  ];
  const panelEntries = BRAINSTORM_PANEL_ORDER.map((kind) => {
    const fallbackItems = listOfStrings(record.report?.[kind]);
    const items = presentationPanelItems(record, kind, fallbackItems);
    const count = items.filter((item) => item.summary || item.detail).length;
    return { kind, items, count, title: BRAINSTORM_PANEL_META[kind].title };
  });
  const panels = panelEntries.map((entry) => renderPanel(entry.kind, entry.items)).join('');
  const emptyPanels = panelEntries.filter((entry) => entry.count === 0);
  const agendaMarkup = `
      <nav class="brainstorm-agenda" aria-label="讨论清单">
        <p class="brainstorm-agenda-title">这次讨论共 ${panelEntries.length} 块${emptyPanels.length > 0 ? `，还有 ${emptyPanels.length} 块没聊到` : '，每一块都有内容了'}</p>
        <div class="brainstorm-agenda-links">
          ${panelEntries.map((entry, index) => `
          <a href="#brainstorm-panel-${escapeHtml(entry.kind)}" class="brainstorm-agenda-link${entry.count === 0 ? ' empty' : ''}">
            <span class="brainstorm-agenda-index">${index + 1}</span>
            <span>${escapeHtml(entry.title)}</span>
            <span class="brainstorm-agenda-count">${entry.count === 0 ? '待聊' : `${entry.count} 条`}</span>
          </a>`).join('')}
        </div>
      </nav>
  `;
  const artifactPaths = { markdownPath, patchPath, statePath };

  return `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(record.title)}</title>
    <style>
      :root {
        color-scheme: light;
        --review-bg: #f6f8fb;
        --review-panel: #ffffff;
        --review-panel-soft: #f9fafb;
        --review-text: #172033;
        --review-muted: #667085;
        --review-line: #d8dee8;
        --review-blue: #2563eb;
        --review-teal: #0f766e;
        --review-indigo: #4f46e5;
        --review-amber: #b45309;
        --review-red: #dc2626;
        --review-green: #15803d;
        --review-mono: "JetBrains Mono", "SFMono-Regular", Menlo, monospace;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--review-bg);
        color: var(--review-text);
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        overflow-x: hidden;
      }
      .page {
        max-width: 1220px;
        margin: 0 auto;
        padding: 28px 22px 128px;
      }
      .brainstorm-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 16px;
      }
      .brainstorm-brand {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        border: 1px solid var(--review-line);
        border-radius: 999px;
        background: var(--review-panel);
        color: var(--review-muted);
        padding: 0 12px;
        font-size: 13px;
        font-weight: 700;
      }
      .brainstorm-status-card {
        display: grid;
        gap: 4px;
        min-width: 240px;
        margin-left: auto;
        padding: 12px 16px;
        border: 1px solid #bfdbfe;
        border-radius: 16px;
        background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%);
        box-shadow: 0 12px 24px rgba(37, 99, 235, 0.08);
      }
      .brainstorm-status-label {
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 800;
      }
      .brainstorm-status-value {
        color: var(--review-text);
        font-size: 20px;
        font-weight: 800;
        line-height: 1.2;
      }
      .brainstorm-status-meta {
        color: var(--review-muted);
        font-size: 12px;
        font-weight: 700;
      }
      .hero {
        padding: 24px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 16px 34px rgba(15, 23, 42, 0.06);
      }
      .eyebrow {
        margin: 0 0 6px;
        color: var(--review-muted);
        font-size: 13px;
        font-weight: 800;
      }
      h1 {
        margin: 14px 0 10px;
        font-size: 32px;
        line-height: 1.16;
        word-break: break-word;
      }
      .subtitle {
        margin: 0;
        max-width: 760px;
        color: var(--review-muted);
        line-height: 1.75;
        font-size: 16px;
        overflow-wrap: anywhere;
      }
      .top-meta,
      .chip-row {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .top-meta {
        margin: 14px 0 0;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid var(--review-line);
        background: #ffffff;
        color: var(--review-text);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.25;
      }
      .chip.highlight {
        background: #eff6ff;
        border-color: #bfdbfe;
        color: #1d4ed8;
      }
      .brainstorm-panel-flow .chip.highlight,
      .resource-card-flow .chip.highlight {
        background: #f0fdfa;
        border-color: #99f6e4;
        color: #115e59;
      }
      .brainstorm-panel-map .chip.highlight,
      .resource-card-map .chip.highlight {
        background: #eef2ff;
        border-color: #c7d2fe;
        color: #4338ca;
      }
      .brainstorm-panel-guardrail .chip.highlight,
      .resource-card-guardrail .chip.highlight {
        background: #fffbeb;
        border-color: #fde68a;
        color: #92400e;
      }
      .brainstorm-panel-risk .chip.highlight,
      .resource-card-risk .chip.highlight {
        background: #fff1f2;
        border-color: #fecaca;
        color: #991b1b;
      }
      .brainstorm-panel-success .chip.highlight,
      .resource-card-success .chip.highlight {
        background: #ecfdf3;
        border-color: #bbf7d0;
        color: #067647;
      }
      .chip.muted {
        color: var(--review-muted);
      }
      .summary-grid,
      .panel-grid,
      .resource-grid,
      .source-grid {
        display: grid;
        gap: 16px;
      }
      .summary-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
        margin-top: 18px;
      }
      .panel-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin-top: 20px;
      }
      .summary-card {
        padding: 18px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
      }
      .summary-card.core {
        border-color: #bfdbfe;
        background: linear-gradient(135deg, #eff6ff 0%, #ffffff 100%);
      }
      .summary-card.target {
        border-color: #bbf7d0;
        background: linear-gradient(135deg, #ecfdf3 0%, #ffffff 100%);
      }
      .summary-card.solution {
        border-color: #fde68a;
        background: linear-gradient(135deg, #fffbeb 0%, #ffffff 100%);
      }
      .summary-card.alternative {
        border-color: #c7d2fe;
        background: linear-gradient(135deg, #eef2ff 0%, #ffffff 100%);
      }
      .summary-label {
        color: var(--review-muted);
        font-size: 12px;
        font-weight: 800;
      }
      .summary-value {
        margin-top: 10px;
        font-size: 24px;
        font-weight: 800;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .summary-note {
        margin-top: 8px;
        color: var(--review-muted);
        font-size: 13px;
        line-height: 1.7;
      }
      .brainstorm-panel,
      .resource-card,
      .source-card {
        padding: 18px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
      }
      .brainstorm-panel {
        min-height: 260px;
      }
      .brainstorm-section {
        margin-top: 20px;
      }
      .brainstorm-section-head {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        margin-bottom: 14px;
      }
      .brainstorm-section-head h2 {
        margin: 0;
        font-size: 22px;
      }
      .brainstorm-section-head p {
        margin: 4px 0 0;
        color: var(--review-muted);
        font-size: 14px;
        line-height: 1.55;
      }
      .brainstorm-visual-map {
        margin-top: 20px;
        border: 1px solid var(--review-line);
        border-radius: 8px;
        background: var(--review-panel);
        box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
        padding: 18px;
      }
      .brainstorm-visual-map + .brainstorm-visual-map {
        margin-top: 16px;
      }
      .brainstorm-visual-svg-wrap {
        margin-top: 16px;
        overflow-x: auto;
        border: 1px solid #e8edf4;
        border-radius: 8px;
        background: linear-gradient(180deg, #fbfcfe 0%, #f7f9fc 100%);
      }
      .brainstorm-visual-svg-wrap svg {
        display: block;
        width: 100%;
        height: auto;
        min-width: 760px;
      }
      .brainstorm-scene-title {
        font-size: 16px;
        font-weight: 800;
        fill: var(--review-text);
      }
      .brainstorm-scene-copy {
        font-size: 13px;
        font-weight: 600;
        fill: var(--review-muted);
      }
      .brainstorm-scene-badge {
        font-size: 12px;
        font-weight: 850;
      }
      .brainstorm-scene-arrow {
        fill: var(--review-indigo);
        font-size: 32px;
        font-weight: 800;
      }
      .brainstorm-scene-line {
        stroke: #c7d2fe;
        stroke-width: 4;
        stroke-linecap: round;
      }
      .panel-head h3 {
        margin: 0;
        font-size: 18px;
      }
      .panel-head p {
        margin: 8px 0 0;
        color: var(--review-muted);
        line-height: 1.7;
        font-size: 13px;
      }
      .panel-head {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .panel-count {
        flex-shrink: 0;
        margin-left: auto;
        padding: 3px 10px;
        border-radius: 999px;
        border: 1px solid rgba(37,99,235,0.25);
        background: rgba(37,99,235,0.06);
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 600;
        white-space: nowrap;
      }
      .panel-count.empty {
        border-color: var(--review-line);
        background: var(--review-panel-soft);
        color: var(--review-muted);
        font-weight: 400;
      }
      .brainstorm-agenda {
        margin-top: 18px;
        padding: 16px 20px;
        border-radius: 16px;
        border: 1px solid var(--review-line);
        background: var(--review-panel);
        box-shadow: 0 10px 24px rgba(23,32,51,0.05);
      }
      .brainstorm-agenda-title {
        margin: 0;
        color: var(--review-text);
        font-size: 14px;
        font-weight: 700;
      }
      .brainstorm-agenda-links {
        margin-top: 12px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .brainstorm-agenda-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid var(--review-line);
        background: var(--review-panel-soft);
        color: var(--review-text);
        text-decoration: none;
        font-size: 13px;
        line-height: 1.5;
      }
      .brainstorm-agenda-link:hover {
        border-color: rgba(37,99,235,0.4);
        background: #ffffff;
      }
      .brainstorm-agenda-link.empty { color: var(--review-muted); }
      .brainstorm-agenda-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: rgba(37,99,235,0.1);
        color: var(--review-blue);
        font-size: 11px;
        font-weight: 700;
      }
      .brainstorm-agenda-link.empty .brainstorm-agenda-index {
        background: var(--review-line);
        color: var(--review-muted);
      }
      .brainstorm-agenda-count {
        color: var(--review-blue);
        font-size: 12px;
        font-weight: 600;
      }
      .brainstorm-agenda-link.empty .brainstorm-agenda-count {
        color: var(--review-muted);
        font-weight: 400;
      }
      .brainstorm-icon {
        flex: 0 0 auto;
        display: inline-flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
      }
      .brainstorm-icon svg {
        width: 22px;
        height: 22px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .brainstorm-icon-map { color: var(--review-indigo); background: #eef2ff; }
      .brainstorm-icon-flow { color: var(--review-teal); background: #ccfbf1; }
      .brainstorm-icon-function { color: var(--review-blue); background: #dbeafe; }
      .brainstorm-icon-guardrail { color: var(--review-amber); background: #fef3c7; }
      .brainstorm-icon-risk { color: var(--review-red); background: #fee2e2; }
      .brainstorm-icon-success { color: var(--review-green); background: #dcfce7; }
      .detail-list,
      .resource-list {
        margin: 16px 0 0;
        padding-left: 18px;
        color: var(--review-text);
        font-size: 15px;
        line-height: 1.72;
        overflow-wrap: anywhere;
      }
      .detail-list li,
      .resource-list li {
        margin: 0 0 9px;
      }
      .detail-list li span {
        color: var(--review-text);
      }
      .detail-list strong {
        font-weight: 850;
      }
      .empty {
        color: var(--review-muted);
      }
      .brainstorm-bottom-bar {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 30;
        opacity: 0;
        padding: 12px 22px calc(12px + env(safe-area-inset-bottom));
        border-top: 1px solid var(--review-line);
        background: rgba(246, 248, 251, 0.94);
        box-shadow: 0 -14px 32px rgba(15, 23, 42, 0.08);
        backdrop-filter: blur(14px);
        pointer-events: none;
        transform: translateY(calc(100% + 16px));
        transition: transform 180ms ease, opacity 180ms ease;
      }
      .brainstorm-bottom-bar.is-visible {
        opacity: 1;
        pointer-events: auto;
        transform: translateY(0);
      }
      .brainstorm-bottom-bar-inner {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        max-width: 1220px;
        margin: 0 auto;
      }
      .brainstorm-bottom-action {
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 152px;
        min-height: 48px;
        border: 1px solid transparent;
        border-radius: 12px;
        padding: 0 20px;
        font: inherit;
        font-size: 16px;
        font-weight: 850;
        line-height: 1;
        white-space: nowrap;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
        transition: background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .brainstorm-bottom-action.continue {
        border-color: #bfdbfe;
        background: #eff6ff;
        color: #1d4ed8;
      }
      .brainstorm-bottom-action.validate {
        border-color: #c7d2fe;
        background: #eef2ff;
        color: #4338ca;
      }
      .brainstorm-bottom-action.confirm {
        border-color: #bbf7d0;
        background: #ecfdf3;
        color: #067647;
      }
      .brainstorm-bottom-action:hover,
      .brainstorm-bottom-action:focus-visible {
        box-shadow: 0 10px 22px rgba(15, 23, 42, 0.1);
        transform: translateY(-1px);
        outline: none;
      }
      .brainstorm-bottom-action.continue:hover,
      .brainstorm-bottom-action.continue:focus-visible {
        border-color: #93c5fd;
        background: #dbeafe;
      }
      .brainstorm-bottom-action.validate:hover,
      .brainstorm-bottom-action.validate:focus-visible {
        border-color: #a5b4fc;
        background: #e0e7ff;
      }
      .brainstorm-bottom-action.confirm:hover,
      .brainstorm-bottom-action.confirm:focus-visible {
        border-color: #86efac;
        background: #dcfce7;
      }
      .brainstorm-bottom-action:active {
        box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08);
        transform: translateY(0);
      }
      @media (max-width: 1040px) {
        .summary-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .panel-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 760px) {
        .page {
          padding: 18px 12px 144px;
        }
        .brainstorm-topbar {
          align-items: flex-start;
          flex-direction: column;
        }
        .brainstorm-status-card {
          min-width: 0;
          width: 100%;
          margin-left: 0;
        }
        .hero {
          padding: 18px;
        }
        h1 {
          font-size: 26px;
          word-break: break-all;
        }
        .subtitle {
          word-break: break-all;
        }
        .brainstorm-section-head h2 {
          font-size: 20px;
        }
        .summary-grid {
          grid-template-columns: 1fr;
        }
        .brainstorm-bottom-bar {
          padding-inline: 12px;
        }
        .brainstorm-bottom-bar-inner {
          display: grid;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        .brainstorm-bottom-action {
          justify-content: center;
          padding-inline: 10px;
          font-size: 15px;
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="brainstorm-topbar">
        <div class="brainstorm-brand">Open VibeCoding / 方向梳理</div>
        <section class="brainstorm-status-card" aria-label="当前建议">
          <div class="brainstorm-status-label">当前判断</div>
          <div class="brainstorm-status-value">${escapeHtml(hero.direction)}</div>
          <div class="brainstorm-status-meta">${escapeHtml(hero.confidence)}</div>
        </section>
      </header>
      <section class="hero">
        <div class="eyebrow">脑暴概览</div>
        <h1>${escapeHtml(record.title)}</h1>
        <p class="subtitle">${escapeHtml(hero.summary)}</p>
        <div class="top-meta">${topMeta.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('')}</div>
        <section class="summary-grid">
          <div class="summary-card core">
            <div class="summary-label">本次讨论的核心诉求</div>
            <div class="summary-value">${escapeHtml(primarySummary.coreRequest)}</div>
            <div class="summary-note">先把这次到底想解决什么问题说清楚。</div>
          </div>
          <div class="summary-card target">
            <div class="summary-label">预计想达到什么目标</div>
            <div class="summary-value">${escapeHtml(primarySummary.targetOutcome)}</div>
            <div class="summary-note">先定义第一版最想换来的结果，再决定范围。</div>
          </div>
          <div class="summary-card alternative">
            <div class="summary-label">现在主要怎么解决</div>
            <div class="summary-value">${escapeHtml(primarySummary.currentAlternative)}</div>
            <div class="summary-note">先回到现状，判断这件事有没有必要现在就换做法。</div>
          </div>
          <div class="summary-card solution">
            <div class="summary-label">目前更建议的方向</div>
            <div class="summary-value">${escapeHtml(primarySummary.recommendedDirection)}</div>
            <div class="summary-note">先收敛第一版做法，再决定是否把范围继续放大。</div>
          </div>
        </section>
      </section>

      ${agendaMarkup}
      ${visualScenes.map((scene, index) => renderVisualScene(scene, index)).join('\n')}
      <section class="panel-grid">${panels}</section>
    </main>
    ${renderBottomBar(record, artifactPaths)}
    <script>
      const bottomBar = document.querySelector('.brainstorm-bottom-bar');
      function syncBottomBarVisibility() {
        if (!bottomBar) return;
        const nearBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 220;
        const shouldShow = window.scrollY > 180 || nearBottom;
        bottomBar.classList.toggle('is-visible', shouldShow);
      }
      async function copyBrainstormText(text) {
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          textarea.remove();
        }
      }
      function flashCopied(button) {
        const old = button.textContent;
        button.textContent = '已复制';
        setTimeout(() => { button.textContent = old; }, 1200);
      }
      document.querySelectorAll('[data-copy-value]').forEach((button) => {
        button.addEventListener('click', async () => {
          await copyBrainstormText(button.dataset.copyValue || '');
          flashCopied(button);
        });
      });
      syncBottomBarVisibility();
      window.addEventListener('scroll', syncBottomBarVisibility, { passive: true });
      window.addEventListener('resize', syncBottomBarVisibility);
    </script>
  </body>
</html>`;
}

export {
  BRAINSTORM_PANEL_ORDER,
  BRAINSTORM_PRESENTATION_CONTRACT,
};
