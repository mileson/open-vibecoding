// Presentation is separate from routing: these labels never match user prompts.
const entries = [
  ['product-diagnosis', '【产品】找出问题与改进方向', '结合用户反馈、页面与数据定位问题，判断下一步该改善什么。'],
  ['product-research', '【产品】调研用户需求与市场机会', '交叉核验用户反馈与市场资料，研究痛点、替代方案和验证机会。'],
  ['competitor-analysis', '【产品】对比竞品与可借鉴做法', '通过实际体验与资料核验，对比竞品差异，找出适合借鉴的做法。'],
  ['product-data-analysis', '【产品】分析功能使用与用户变化', '查询真实使用数据，区分访问与自动化流量，辅助判断功能去留。'],
  ['product-document', '【产品】编写产品说明与需求文档', '需要文档交付时，依据产品事实讲清目标、功能范围与关键规则。'],
  ['interaction-design', '【交互】优化用户流程与操作体验', '检查实际页面的入口、步骤与状态反馈，让用户更容易完成任务。'],
  ['visual-direction-review', '【交互】生成三种界面方向供评审', '用原生生图探索三种不同布局与体验，直观比较后选择设计方向。'],
  ['frontend-design', '【交互】实现设计稿并对比效果', '把设计落实到真实界面，用截图对比检查还原、对齐与视觉一致性。'],
  ['feature-implementation', '【研发】实现功能并验证结果', '根据明确目标自主拆解并完成开发，运行相关验证检查实际结果。'],
  ['debugging', '【研发】定位故障，按需修复', '结合复现、日志和代码确认原因，明确要求修复时修改并回归验证。'],
  ['refactoring', '【研发】精简代码并保持功能正常', '检查引用与调用关系，清理重复和遗留逻辑，验证已有行为不变。'],
  ['acceptance-verification', '【测试】按真实用户操作验收功能', '用可用的界面操作工具走完整用户路径，检查业务结果和异常情况。'],
  ['ui-interaction-review', '【测试】亲自操作界面发现问题', '让独立评审 Agent 实际点击和操作界面，提供问题与复现依据。'],
  ['ui-review-and-repair', '【测试】检查界面、修复并反复验证', '组合独立评审、代码修复与多轮复查，说明已解决和剩余的问题。'],
  ['production-anomaly-analysis', '【测试】分析线上异常与修复效果', '查询已有监控或日志，分析异常影响、版本变化及修复后的复发情况。'],
  ['icon-system', '【增强】获取统一风格的产品图标', '主动检索或设计成套图标，按需生图与透明化，在真实界面检查风格。'],
  ['diagram-review', '【增强】用图讲清架构与业务流程', '用结构图或流程图解释复杂关系，帮助理解边界、依赖与业务步骤。'],
  ['canvas-collaboration', '【增强】在画布上讨论方案与修改意见', '在可用的协作画布上组织方案与批注，把反馈对应到具体内容。'],
  ['learning-review', '【增强】整理图文学习材料', '将复杂主题整理成章节、案例与图文讲解，按需提供可阅读的学习材料。'],
  ['ios-localization', '【最佳实践】实现或升级 iOS 多语言', '检查工具链与兼容条件，选择多语言实现或迁移方案并验证实际表现。'],
];

export const USER_SKILL_PRESENTATION = Object.freeze(Object.fromEntries(entries.map(
  ([id, displayName, description]) => [`open-vibecoding-${id}`, { displayName, description }],
)));
const INTERNAL_SKILLS = new Set(['router', 'shared', 'harness', 'requirement-intake',
  'benchmark-router', 'test-strategy', 'audio-evidence', 'icon-source', 'icon-svg',
  'icon-image', 'icon-cutout', 'best-practices', 'tool-selection', 'experience-reuse',
  'quality', 'standards', 'discovery-loop', 'diagnostic-readiness', 'visual-localization', 'image-annotation', 'visual-evidence-delivery'].map((id) => `open-vibecoding-${id}`));

export function skillPresentation(id) {
  const entry = USER_SKILL_PRESENTATION[id];
  // Unknown project extensions remain discoverable; only our built-ins are classified here.
  return entry ? { userFacing: true, ...entry } : { userFacing: !INTERNAL_SKILLS.has(id) };
}

export function installedSkillPath(id, adapter = 'codex') {
  return adapter === 'codex' && !skillPresentation(id).userFacing
    ? `.open-vibecoding/harness/internal-skills/${id}/SKILL.md`
    : `.${adapter}/skills/${id}/SKILL.md`;
}

export function renderSkillInterface(id) {
  const entry = USER_SKILL_PRESENTATION[id];
  if (!entry) return null;
  return ['interface:', `  display_name: ${JSON.stringify(entry.displayName)}`,
    `  short_description: ${JSON.stringify(entry.description)}`, ''].join('\n');
}
