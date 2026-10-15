/*
 * 核心功能
 * 声明统筹层、五个执行域、横向最佳实践与可组合场景，并校验增量注册。
 *
 * 输入
 * 接收内置能力声明及可选的增量声明。
 *
 * 输出
 * 返回可发现的能力目录和跨场景交接合同；不执行用户任务。
 *
 * 定位
 * 位于 CLI 与 Agent Skill 之间，为场景路由提供机器可读的能力边界。
 *
 * 依赖
 * 无外部依赖；场景判断由 Agent 根据用户目标与证据完成。
 *
 * 维护规则
 * 新增能力时声明输入、输出和所属领域；不得用关键词或固定入口代替语义判断。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { skillPresentation } from './skill-presentation.js';

export const CAPABILITY_CATALOG_SCHEMA = 'open-vibecoding.capabilities.v1';
export const CAPABILITY_HANDOFF_SCHEMA = 'open-vibecoding.handoff.v1';

const BUILTIN_DOMAINS = [
  {
    id: 'product',
    title: '产品',
    responsibility: '调研、竞品、产品诊断、使用数据分析、需求判断与产品文档',
    existingCommands: ['benchmark', 'brainstorm'],
  },
  {
    id: 'interaction',
    title: '交互设计',
    responsibility: '信息架构、用户流程、系统状态、界面与感知设计、原型评审',
    existingCommands: ['diagram', 'design-starter', 'design-review', 'visual-prepare', 'visual-compare', 'canvas'],
  },
  {
    id: 'development',
    title: '研发',
    responsibility: '由 Agent 自主拆解、实现和管理执行状态；工具只提供按需增强',
    existingCommands: ['runtime', 'dev-check'],
  },
  {
    id: 'testing',
    title: '测试',
    responsibility: '分层验证、运行态与视觉证据、验收结果、线上异常分析与跟踪',
    existingCommands: ['run', 'validate', 'standards', 'quality', 'dev-check'],
  },
  {
    id: 'vibe-enhancement',
    title: 'Vibe Coding 增强',
    responsibility: 'Agent、工具、上下文、画布与经验的按需增强',
    existingCommands: ['canvas', 'grow', 'doctor', 'icon-cutout', 'visual-grid', 'image-annotate'],
  },
  {
    id: 'best-practices',
    title: '最佳实践',
    responsibility: '横向实践板块：按项目平台、工具链和兼容条件优先采用已验证现代方案',
    existingCommands: ['capabilities', 'benchmark'],
  },
];

const BUILTIN_SCENARIOS = [
  {
    id: 'practice-selection', title: '最佳实践选择', skill: 'open-vibecoding-best-practices',
    domains: ['best-practices', 'vibe-enhancement'],
    accepts: ['当前项目平台与工具链', '本次实现或迁移目标', '兼容约束与现有实现'],
    produces: ['有依据的适用实践', '条件不足时的兼容路径及验证重点'],
  },
  {
    id: 'ios-localization', title: 'iOS 多语言最佳实践', skill: 'open-vibecoding-ios-localization',
    domains: ['best-practices', 'development', 'testing'],
    accepts: ['Apple 项目工具链与部署版本', '本地化资源及调用', '多语言实现或迁移目标'],
    produces: ['适用的 String Catalog 与调用方式', '保留语义的迁移及语言验证'],
  },
  {
    id: 'product-diagnosis',
    title: '产品诊断',
    skill: 'open-vibecoding-product-diagnosis',
    domains: ['product', 'interaction'],
    accepts: ['用户反馈', '任务失败记录', '产品数据', '现有产品或想法'],
    produces: ['带证据的产品问题定位', '待验证假设', '下一步研究或改动目标'],
  },
  {
    id: 'product-data-analysis',
    title: '产品使用数据分析',
    skill: 'open-vibecoding-product-data-analysis',
    domains: ['product'],
    accepts: ['产品业务问题', '实际使用数据或可用数据源', '目标产品与比较范围'],
    produces: ['带口径的业务变化与影响分析', '原因假设、数据缺口与下一步验证建议'],
    uses: ['tool-selection'],
  },
  {
    id: 'product-research',
    title: '用户与市场调研',
    skill: 'open-vibecoding-product-research',
    domains: ['product'],
    accepts: ['产品想法', '目标用户', '市场线索', '现有使用反馈'],
    produces: ['用户任务与替代方案证据', '待验证机会', '下一步最小研究动作'],
  },
  {
    id: 'competitor-analysis',
    title: '竞品分析',
    skill: 'open-vibecoding-competitor-analysis',
    domains: ['product'],
    accepts: ['竞品或替代方案', '用户任务', '比较目标'],
    produces: ['可核验的差异与取舍', '可迁移原则', '未证实判断'],
    tools: ['benchmark'],
  },
  {
    id: 'product-document',
    title: '按需产品文档',
    skill: 'open-vibecoding-product-document',
    domains: ['product'],
    accepts: ['明确的文档交付要求', '产品事实与决策'],
    produces: ['面向指定读者的产品文档', '事实来源与待确认项'],
  },
  {
    id: 'interaction-review',
    title: '交互评审',
    skill: 'open-vibecoding-interaction-design',
    domains: ['interaction', 'product', 'testing'],
    accepts: ['用户任务', '页面或原型', '交互流程', '参考图'],
    produces: ['交互问题与层次定位', '状态与流程改进', '验证计划'],
  },
  {
    id: 'visual-direction-review',
    title: '视觉方向评审',
    skill: 'open-vibecoding-visual-direction-review',
    domains: ['interaction'],
    accepts: ['用户任务', '现有界面或设计简报', '视觉约束'],
    produces: ['有实质差异的候选方向', '选定方向或可逆默认方向', '参考图证据'],
    tools: ['design-review', 'visual-prepare', 'visual-compare'],
  },
  {
    id: 'visual-implementation',
    title: '视觉实现与对比',
    skill: 'open-vibecoding-frontend-design',
    domains: ['interaction', 'development', 'testing'],
    accepts: ['选定方向或参考图', '现有界面和代码'],
    produces: ['实际界面实现', '必要的视觉对比证据'],
    tools: ['design-starter', 'visual-prepare', 'visual-compare'],
    uses: ['visual-localization', 'image-annotation'],
  },
  {
    id: 'feature-implementation',
    title: '功能实现',
    skill: 'open-vibecoding-feature-implementation',
    domains: ['development'],
    accepts: ['明确的用户目标', '现有代码与约束'],
    produces: ['可运行的变更', '与风险相称的验证结果'],
    uses: ['diagnostic-readiness', 'visual-localization', 'image-annotation'],
    tools: ['dev-check'],
  },
  {
    id: 'debugging',
    title: '故障定位与修复',
    skill: 'open-vibecoding-debugging',
    domains: ['development', 'testing'],
    accepts: ['异常现象', '复现线索', '运行或日志证据'],
    produces: ['可证实的根因', '最小修复与回归证据'],
    uses: ['diagnostic-readiness'],
  },
  {
    id: 'refactoring',
    title: '重构与质量改善',
    skill: 'open-vibecoding-refactoring',
    domains: ['development', 'testing'],
    accepts: ['维护成本或结构问题', '现有行为合同'],
    produces: ['边界清楚的代码改进', '行为不变的验证结果'],
    uses: ['diagnostic-readiness'],
    tools: ['dev-check'],
  },
  {
    id: 'diagnostic-readiness',
    title: '修复与优化后的诊断补强',
    skill: 'open-vibecoding-diagnostic-readiness',
    domains: ['development', 'testing'],
    accepts: ['本次故障或性能问题', '现有诊断证据与盲区', '实现授权与验证环境'],
    produces: ['按需补强或复用的诊断证据', '实际读回验证与取得方式', '复查边界与剩余盲区'],
  },
  {
    id: 'test-strategy',
    title: '真实用户操作优先验证策略',
    skill: 'open-vibecoding-test-strategy',
    domains: ['testing'],
    accepts: ['用户业务目标与改动范围', '失败后果', '可用工具、测试角色与环境'],
    produces: ['以真实用户路径为先的验证组合', '最终结果与模拟、未验证边界'],
  },
  {
    id: 'production-anomaly-analysis',
    title: '线上异常分析与跟踪',
    skill: 'open-vibecoding-production-anomaly-analysis',
    domains: ['testing'],
    accepts: ['上线后的异常或修复复查目标', '目标产品、环境与版本范围', '监控或日志证据'],
    produces: ['异常影响与版本变化分析', '采集覆盖、复发情况与待验证边界'],
    uses: ['tool-selection'],
  },
  {
    id: 'acceptance-verification',
    title: '验收与回归',
    skill: 'open-vibecoding-acceptance-verification',
    domains: ['testing'],
    accepts: ['用户目标', '实现结果', '测试策略'],
    produces: ['实际通过或失败证据', '未验证风险与复测建议'],
    uses: ['diagnostic-readiness', 'visual-localization', 'image-annotation'],
    tools: ['run', 'validate', 'visual-compare'],
  },
  {
    id: 'ui-interaction-review',
    title: '界面交互 Review',
    skill: 'open-vibecoding-ui-interaction-review',
    domains: ['testing', 'interaction'],
    accepts: ['可运行的目标界面', '用户任务与审查范围', '可用的 Computer Use 与独立 subagent'],
    produces: ['真实操作后的问题与复现证据', '交互覆盖和未验证范围'],
  },
  {
    id: 'ui-review-and-repair',
    title: 'Review 并修复',
    skill: 'open-vibecoding-ui-review-and-repair',
    domains: ['testing', 'development'],
    accepts: ['检查并修复界面的目标', '可运行界面与代码', '迭代范围及预算'],
    produces: ['独立 reviewer 复测过的修复', '剩余问题与覆盖缺口'],
    uses: ['ui-interaction-review', 'debugging'],
  },
  {
    id: 'tool-selection',
    title: '工具能力选择',
    skill: 'open-vibecoding-tool-selection',
    domains: ['vibe-enhancement'],
    accepts: ['任务目标', '当前宿主能力', '可用工具'],
    produces: ['最小足够工具组合', '能力缺口和替代路径'],
    tools: ['capabilities', 'doctor'],
  },
  {
    id: 'audio-evidence', title: '音频与语音证据', skill: 'open-vibecoding-audio-evidence',
    domains: ['vibe-enhancement', 'testing'],
    accepts: ['真实媒体与质量声明', 'ASR 或语音字幕任务'],
    produces: ['修改前基线与最终媒体对比', '证据支持的结论与未知项'],
  },
  {
    id: 'visual-localization', title: '视觉精确定位', skill: 'open-vibecoding-visual-localization',
    domains: ['vibe-enhancement'],
    accepts: ['需要准确定位的图片目标', '原始图片与已确认的显示/裁切关系'],
    produces: ['辅助坐标网格', '原图像素目标与定位不确定项'],
    tools: ['visual-grid'],
  },
  {
    id: 'image-annotation', title: '图片框选与说明标注', skill: 'open-vibecoding-image-annotation',
    domains: ['vibe-enhancement'],
    accepts: ['需要指明的目标与用户动作', '原图、保护区域与交付尺寸'],
    produces: ['不覆盖原图的标注副本', '实际框位与待视觉复核结果'],
    uses: ['visual-localization'], tools: ['image-annotate'],
  },
  {
    id: 'icon-system', title: '图标获取与风格统筹', skill: 'open-vibecoding-icon-system',
    domains: ['vibe-enhancement', 'interaction'],
    accepts: ['产品调性与用户任务', '现有图标及消费组件'],
    produces: ['主动获取并接入的成套图标', '实际尺寸的风格一致性验收'],
    uses: ['icon-source', 'icon-svg', 'icon-image', 'icon-cutout'],
  },
  {
    id: 'icon-source', title: '图标多渠道检索', skill: 'open-vibecoding-icon-source',
    domains: ['vibe-enhancement'],
    accepts: ['图标语义与风格', '素材用途及许可范围'],
    produces: ['可核实来源的实际图标资产', '许可与变体说明'],
  },
  {
    id: 'icon-svg', title: '自定义 SVG 图标', skill: 'open-vibecoding-icon-svg',
    domains: ['vibe-enhancement', 'interaction'],
    accepts: ['图标家族与消费尺寸', '需要表达的语义'],
    produces: ['可编辑矢量图标', '实际尺寸与成套一致性检查'],
  },
  {
    id: 'icon-image', title: '原生图标生成', skill: 'open-vibecoding-icon-image',
    domains: ['vibe-enhancement', 'interaction'],
    accepts: ['产品视觉语言与代表性图标', '位图消费模式', '原生生图工具'],
    produces: ['符合家族的独立位图资产', '透明度及真实界面检查'],
    uses: ['icon-cutout'],
  },
  {
    id: 'icon-cutout', title: '图标透明化', skill: 'open-vibecoding-icon-cutout',
    domains: ['vibe-enhancement'],
    accepts: ['已有透明或纯色背景图标', '明确的背景色与输出路径'],
    produces: ['透明 PNG', '像素检查及需要人工复核的边界'],
    tools: ['icon-cutout'],
  },
  {
    id: 'canvas-collaboration',
    title: '画布协作',
    skill: 'open-vibecoding-canvas-collaboration',
    domains: ['vibe-enhancement', 'interaction'],
    accepts: ['需要空间化讨论的关系或视觉反馈', '当前线程或会话'],
    produces: ['可追溯的画布批注与交接', '仍未解决的问题'],
    tools: ['canvas'],
  },
  {
    id: 'experience-reuse',
    title: '经验复用',
    skill: 'open-vibecoding-experience-reuse',
    domains: ['vibe-enhancement'],
    accepts: ['已验证的项目经验', '当前任务的相似问题'],
    produces: ['适用边界清楚的经验建议', '可选的知识沉淀'],
    tools: ['quality', 'grow'],
  },
];

export const CAPABILITY_CONTRIBUTIONS_FILE = 'open-vibecoding.capabilities.json';
export const CAPABILITY_CONTRIBUTIONS_SCHEMA = 'open-vibecoding.contributions.v1';

const HANDOFF_FIELDS = [
  'scenarioId',
  'status',
  'sourceRefs',
  'facts',
  'assumptions',
  'unknowns',
  'decisions',
  'artifactRefs',
  'evidenceRefs',
  'nextActions',
];

export const CAPABILITY_HANDOFF_CONTRACT = Object.freeze({
  schema: CAPABILITY_HANDOFF_SCHEMA,
  fields: HANDOFF_FIELDS,
  statuses: ['success', 'partial', 'blocked', 'unknown'],
  rule: '仅在场景交接确有必要时使用；事实、假设、未知与证据分开表达，不要求生成或保存任务文档。',
});

function assertIdentifier(value, kind) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(`${kind} id 必须是小写 kebab-case`);
  }
}

function assertNonemptyStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
}

function cloneEntry(entry) {
  return structuredClone(entry);
}

// uses 只描述能力复用关系，不指定任务执行顺序或轮次。
function validateScenarioComposition(scenarios) {
  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  for (const scenario of scenarios) {
    if (scenario.uses === undefined) continue;
    assertNonemptyStrings(scenario.uses, `${scenario.id}.uses`);
    if (new Set(scenario.uses).size !== scenario.uses.length) {
      throw new Error(`${scenario.id}.uses 包含重复场景`);
    }
    for (const id of scenario.uses) {
      if (!byId.has(id)) throw new Error(`scenario ${scenario.id} 引用了未知子能力: ${id}`);
    }
  }
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`场景组合存在循环引用: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const child of byId.get(id).uses ?? []) visit(child);
    visiting.delete(id);
    visited.add(id);
  }
  for (const scenario of scenarios) visit(scenario.id);
}

// 增量贡献只扩展能力目录，不允许覆盖已有领域或场景。
export function buildCapabilityCatalog(contributions = []) {
  if (!Array.isArray(contributions)) {
    throw new Error('contributions 必须是数组');
  }
  const domains = BUILTIN_DOMAINS.map(cloneEntry);
  const scenarios = BUILTIN_SCENARIOS.map(cloneEntry);
  for (const contribution of contributions) {
    if (!contribution || typeof contribution !== 'object' || Array.isArray(contribution)) {
      throw new Error('每个 contribution 必须是对象');
    }
    if ((contribution.domains && !Array.isArray(contribution.domains))
      || (contribution.scenarios && !Array.isArray(contribution.scenarios))) {
      throw new Error('contribution.domains 与 contribution.scenarios 必须是数组');
    }
    domains.push(...(contribution.domains ?? []).map(cloneEntry));
    scenarios.push(...(contribution.scenarios ?? []).map(cloneEntry));
  }
  const domainIds = new Set();
  for (const domain of domains) {
    assertIdentifier(domain.id, 'domain');
    if (domainIds.has(domain.id)) throw new Error(`重复 domain: ${domain.id}`);
    if (!domain.title || !domain.responsibility) throw new Error(`domain 缺少说明: ${domain.id}`);
    assertNonemptyStrings(domain.existingCommands ?? domain.commands, `${domain.id}.commands`);
    domainIds.add(domain.id);
  }
  const scenarioIds = new Set();
  const scenarioSkills = new Set();
  for (const scenario of scenarios) {
    assertIdentifier(scenario.id, 'scenario');
    if (scenarioIds.has(scenario.id) || domainIds.has(scenario.id)) throw new Error(`重复 capability: ${scenario.id}`);
    if (!scenario.title || !scenario.skill) throw new Error(`scenario 缺少标题或 Skill: ${scenario.id}`);
    Object.assign(scenario, skillPresentation(scenario.skill));
    assertIdentifier(scenario.skill, 'skill');
    if (scenarioSkills.has(scenario.skill)) throw new Error(`重复 scenario Skill: ${scenario.skill}`);
    for (const field of ['domains', 'accepts', 'produces']) {
      assertNonemptyStrings(scenario[field], `${scenario.id}.${field}`);
    }
    if (scenario.tools !== undefined && (!Array.isArray(scenario.tools)
      || scenario.tools.some((tool) => typeof tool !== 'string' || !tool.trim()))) {
      throw new Error(`${scenario.id}.tools 必须是字符串数组`);
    }
    for (const domainId of scenario.domains) {
      if (!domainIds.has(domainId)) throw new Error(`scenario ${scenario.id} 引用了未知 domain: ${domainId}`);
    }
    scenarioIds.add(scenario.id);
    scenarioSkills.add(scenario.skill);
  }
  validateScenarioComposition(scenarios);
  return { schema: CAPABILITY_CATALOG_SCHEMA, product: 'open-vibecoding', orchestrator: 'open-vibecoding-router', domains, scenarios };
}

// 项目扩展只声明场景，不执行代码；Skill 必须在项目内可发现。
export async function loadProjectCapabilityCatalog(projectRoot) {
  const root = path.resolve(projectRoot);
  const manifestPath = path.join(root, CAPABILITY_CONTRIBUTIONS_FILE);
  let raw;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return buildCapabilityCatalog();
    throw error;
  }
  const contribution = JSON.parse(raw);
  if (!contribution || Array.isArray(contribution) || contribution.schema !== CAPABILITY_CONTRIBUTIONS_SCHEMA) {
    throw new Error(`扩展清单 schema 必须是 ${CAPABILITY_CONTRIBUTIONS_SCHEMA}`);
  }
  const catalog = buildCapabilityCatalog([contribution]);
  for (const scenario of contribution.scenarios ?? []) {
    const skillPath = path.join(root, 'skills', scenario.skill, 'SKILL.md');
    if (!(await fs.stat(skillPath).catch(() => null))?.isFile()) {
      throw new Error(`扩展场景 ${scenario.id} 缺少项目 Skill: skills/${scenario.skill}/SKILL.md`);
    }
  }
  return catalog;
}

export function getCapability(catalog, id) {
  return catalog.domains.find((item) => item.id === id)
    ?? catalog.scenarios.find((item) => item.id === id)
    ?? null;
}

export function validateCapabilityHandoff(handoff, catalog = buildCapabilityCatalog()) {
  const errors = [];
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    return ['handoff 必须是对象'];
  }
  if (handoff.schema !== CAPABILITY_HANDOFF_SCHEMA) errors.push('schema 不匹配');
  if (!catalog.scenarios.some((item) => item.id === handoff.scenarioId)) errors.push('scenarioId 未注册');
  if (!CAPABILITY_HANDOFF_CONTRACT.statuses.includes(handoff.status)) errors.push('status 无效');
  for (const field of HANDOFF_FIELDS.filter((item) => !['scenarioId', 'status'].includes(item))) {
    if (!Array.isArray(handoff[field])) errors.push(`${field} 必须是数组`);
  }
  return errors;
}
