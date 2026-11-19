import { readFileSync } from 'node:fs';
import { escapeHtml as html, listMarkup } from './html-artifact-utils.js';
import { field, items, referenceLink, rowIdentifiers, texts } from './prd-fields.js';
import { designLinksByRequirement, designMarkup, validateDesigns } from './prd-design.js';

export const prdTemplateFile = new URL('./prd-template.html', import.meta.url);
const bundledTemplate = readFileSync(prdTemplateFile, 'utf8');
const focusLabels = new Map([
  ['ToC', 'ToC · 用户任务与使用体验'],
  ['ToB', 'ToB · 角色、权限与协作'],
  ['Agent', 'Agent · 输入、执行边界与交接'],
]);
const personaFields = new Map([
  ['ToC', [['characteristics', '用户特征'], ['goal', '目标'], ['barriers', '阻碍']]],
  ['ToB', [['responsibilities', '职责'], ['permissions', '权限'], ['handoff', '协作交接']]],
  ['Agent', [['responsibilities', '人的职责']]],
]);
const scenarioFields = [['context', '触发情境'], ['task', '想完成的任务'], ['outcome', '预期结果']];

function scenarioTitle(entry, prefix) {
  return entry.title === undefined ? field(entry.task, `${prefix}.task`) : field(entry.title, `${prefix}.title`);
}

function section(id, title, content) {
  return `<section id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${title}</h2>${content}</section>`;
}

function scopeMarkup(scope) {
  const included = texts(scope?.in, 'scope.in');
  const excluded = texts(scope?.out, 'scope.out', true);
  const exclusions = excluded.length
    ? `<div><h3>本次不包含</h3><ul>${listMarkup(excluded)}</ul></div>`
    : '';
  return `<div class="scope"><div><h3>本次包含</h3><ul>${listMarkup(included)}</ul></div>${exclusions}</div>`;
}

function referenceLinks(value, name, labels, kind, optional = true) {
  return texts(value, name, optional).map((id) => {
    if (!labels.has(id)) throw new TypeError(`${name} 引用了未知编号 ${id}`);
    return referenceLink(kind, id, labels.get(id));
  }).join('、');
}

function acceptanceMarkup(acceptance, requirementIds, scenarioIds) {
  const fields = new Map([
    ['given', '前置条件'],
    ['when', '操作'],
    ['then', '预期结果'],
  ]);
  const cases = items(acceptance, 'acceptance').map((entry, index) => {
    const prefix = `acceptance[${index}]`;
    const scenario = html(field(entry?.scenario, `${prefix}.scenario`));
    const links = referenceLinks(entry.requirementIds, `${prefix}.requirementIds`, requirementIds, 'requirement');
    const scenarios = referenceLinks(entry.scenarioIds, `${prefix}.scenarioIds`, scenarioIds, 'scenario');
    const details = Array.from(fields, ([key, label]) =>
      `<div><dt>${label}</dt><dd>${html(field(entry[key], `${prefix}.${key}`))}</dd></div>`).join('');
    const references = [
      links ? `<span>关联需求 ${links}</span>` : '',
      scenarios ? `<span>对应场景 ${scenarios}</span>` : '',
    ].join('');
    return `<li><h3>${scenario}</h3>${references ? `<p class="requirement-links">${references}</p>` : ''}<dl>${details}</dl></li>`;
  });
  return `<ul class="criteria">${cases.join('')}</ul>`;
}

function focusEntries(focus = {}) {
  if (!focus || typeof focus !== 'object' || Array.isArray(focus)) {
    throw new TypeError('focus 需要填写对象');
  }
  return new Map(Object.entries(focus).map(([type, entries]) => {
    if (!focusLabels.has(type)) throw new TypeError(`focus.${type} 应为 ToC、ToB 或 Agent`);
    return [type, texts(entries, `focus.${type}`)];
  }));
}

function focusMarkup(focus) {
  const groups = Array.from(focus, ([type, entries]) =>
    `<div><dt>${focusLabels.get(type)}</dt><dd><ul>${listMarkup(entries)}</ul></dd></div>`);
  return groups.length ? section('focus', '需求重点', `<dl class="focus">${groups.join('')}</dl>`) : '';
}

function optionalTable(value, name, columns, { optionalColumns = [], rowIds = [], cellRenderers = {}, inputIndexes = [] } = {}) {
  const rows = items(value, name, true);
  if (!rows.length) return '';
  const visible = columns.filter(([key]) => !optionalColumns.includes(key) || rows.some((row) => row?.[key] !== undefined));
  const headings = visible.map(([, label]) => `<th scope="col">${label}</th>`).join('');
  const body = rows.map((row, index) => {
    const anchor = rowIds[index] ? ` id="requirement-${rowIds[index]}"` : '';
    const cells = visible.map(([key, , fallback]) => {
      const value = row?.[key];
      const path = `${name}[${inputIndexes[index] ?? index}].${key}`;
      if (value === undefined && optionalColumns.includes(key)) return '<td>—</td>';
      if (cellRenderers[key]) return `<td class="table-links">${cellRenderers[key](value, path)}</td>`;
      const text = field(value ?? fallback, path);
      return `<td>${html(text)}</td>`;
    }).join('');
    return `<tr${anchor}>${cells}</tr>`;
  }).join('');
  return `<div class="table-scroll"><table><thead><tr>${headings}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function labeledDetails(entry, prefix, fields) {
  return fields.map(([key, label]) =>
    `<div><dt>${label}</dt><dd>${html(field(entry[key], `${prefix}.${key}`))}</dd></div>`).join('');
}

function audienceMarkup(personas, scenarios, personaIds, scenarioIds, focus) {
  const roles = new Map(personas.map((entry, index) => {
    const prefix = `personas[${index}]`;
    const type = field(entry.type, `${prefix}.type`);
    const fields = personaFields.get(type);
    if (!fields) throw new TypeError(`${prefix}.type 应为 ToC、ToB 或 Agent`);
    const name = html(field(entry.name, `${prefix}.name`));
    return [personaIds[index], { type, name, details: labeledDetails(entry, prefix, fields), scenarios: [] }];
  }));
  const legacy = [];
  scenarios.forEach((entry, index) => {
    const prefix = `scenarios[${index}]`;
    if (typeof entry === 'string') {
      legacy.push(field(entry, prefix));
      return;
    }
    const personaId = field(entry.personaId, `${prefix}.personaId`);
    const role = roles.get(personaId);
    if (!role) throw new TypeError(`${prefix}.personaId 引用了未知画像或角色 ${personaId}`);
    const id = scenarioIds[index];
    const title = html(scenarioTitle(entry, prefix));
    const fields = role.type === 'Agent'
      ? [...scenarioFields, ['agentBoundary', '代理执行边界'], ['humanHandoff', '人工接手条件']]
      : scenarioFields;
    role.scenarios.push(`<div class="audience-scenario" id="scenario-${id}"><h5>${title}</h5><dl>${labeledDetails(entry, prefix, fields)}</dl></div>`);
  });
  const types = new Set([...focus.keys(), ...Array.from(roles.values(), ({ type }) => type)]);
  const groups = Array.from(types, (type) => {
    const cards = Array.from(roles).filter(([, role]) => role.type === type).map(([id, role]) => {
      const scenarios = role.scenarios.length
        ? `<div class="audience-scenarios">${role.scenarios.join('')}</div>`
        : '';
      return `<article class="audience-role" id="persona-${id}"><h4>${role.name}</h4><dl>${role.details}</dl>${scenarios}</article>`;
    }).join('');
    const priorities = focus.has(type) ? `<ul>${listMarkup(focus.get(type))}</ul>` : '';
    return `<div class="audience-type"><h3>${focusLabels.get(type)}</h3>${priorities}${cards}</div>`;
  }).join('');
  return groups + (legacy.length ? `<ul>${listMarkup(legacy)}</ul>` : '');
}

function flowPathsMarkup(paths, name, scenarioIds, withChoices = false) {
  const entries = items(paths, name, true).map((entry, index) => {
    const prefix = `${name}[${index}]`;
    const label = html(field(entry?.label, `${prefix}.label`));
    const steps = texts(entry.steps, `${prefix}.steps`);
    const choices = withChoices ? flowPathsMarkup(entry.choices, `${prefix}.choices`, scenarioIds) : '';
    const scenarios = referenceLinks(entry.scenarioIds, `${prefix}.scenarioIds`, scenarioIds, 'scenario');
    const heading = withChoices ? 'h3' : 'h4';
    const references = scenarios ? `<p class="requirement-links">对应场景 ${scenarios}</p>` : '';
    return `<li><${heading}>${label}</${heading}>${references}<ol class="path-steps">${listMarkup(steps)}</ol>${choices}</li>`;
  }).join('');
  const className = withChoices ? 'flow-paths' : 'flow-choices';
  return entries ? `<ul class="${className}">${entries}</ul>` : '';
}

function flowMarkup(flow, scenarioIds) {
  const steps = texts(flow?.steps, 'flow.steps');
  const scenarios = referenceLinks(flow.scenarioIds, 'flow.scenarioIds', scenarioIds, 'scenario');
  const branches = texts(flow?.branches, 'flow.branches', true);
  const paths = flowPathsMarkup(flow?.paths, 'flow.paths', scenarioIds, true);
  const decisionLabel = flow.decisionLabel === undefined ? '按条件分流' : html(field(flow.decisionLabel, 'flow.decisionLabel'));
  const diagram = paths
    ? `<div class="flow-split"><p>${decisionLabel}</p>${paths}</div>`
    : '';
  const recovery = branches.length
    ? `<div class="branch"><h3>其他处理路径</h3><ul>${listMarkup(branches)}</ul></div>`
    : '';
  const references = scenarios ? `<p class="requirement-links">对应场景 ${scenarios}</p>` : '';
  return `${references}<ol class="flow">${listMarkup(steps)}</ol>${diagram}${recovery}`;
}

function revisionMarkup(revision) {
  if (revision === undefined) return '';
  const version = html(field(revision?.version, 'revision.version'));
  const date = html(field(revision.date, 'revision.date'));
  const summary = html(field(revision.summary, 'revision.summary'));
  const author = revision.author === undefined ? '' : `<div><dt>修订人</dt><dd>${html(field(revision.author, 'revision.author'))}</dd></div>`;
  return `<dl class="revision"><div><dt>版本</dt><dd>${version}</dd></div><div><dt>日期</dt><dd>${date}</dd></div>${author}<div><dt>修订说明</dt><dd>${summary}</dd></div></dl>`;
}

function businessMarkup(business) {
  if (business === undefined) return '';
  const goal = html(field(business?.goal, 'business.goal'));
  const metrics = optionalTable(business.metrics, 'business.metrics', [
    ['name', '指标'], ['definition', '计算口径'], ['window', '观察窗口'],
    ['baseline', '基线', '待定'], ['target', '目标', '待定'], ['confirmationRole', '确认角色'],
  ], { optionalColumns: ['confirmationRole'] });
  return section('business', '业务目标与指标', `<p class="business-goal">${goal}</p>${metrics}`);
}

function openItemsMarkup(value) {
  const entries = items(value, 'openItems', true);
  const legacy = [];
  const active = [];
  const inputIndexes = [];
  for (const [index, entry] of entries.entries()) {
    if (typeof entry === 'string') {
      legacy.push(field(entry, `openItems[${index}]`));
    } else if (entry?.status !== 'resolved') {
      active.push(entry);
      inputIndexes.push(index);
    }
  }
  const table = optionalTable(active, 'openItems', [
    ['question', '问题'], ['proposal', '建议'], ['impact', '影响'], ['confirmationRole', '确认角色'],
  ], { inputIndexes });
  return (legacy.length ? `<ul>${listMarkup(legacy)}</ul>` : '') + table;
}

export function renderPrd(data, template = bundledTemplate, { assetBaseDir } = {}) {
  for (const marker of ['{{PRD_TITLE}}', '{{PRD_CONTENT}}']) {
    if (template.split(marker).length !== 2) throw new TypeError(`HTML 模板需要且只允许一个 ${marker}`);
  }
  const title = html(field(data?.title, 'title'));
  const product = html(field(data.product, 'product'));
  const goal = html(field(data.goal, 'goal'));
  const personas = items(data.personas, 'personas', true);
  const scenarios = items(data.scenarios, 'scenarios');
  const personaIds = rowIdentifiers(personas, 'personas');
  const scenarioIds = rowIdentifiers(scenarios, 'scenarios', (entry) => typeof entry === 'string');
  const priorities = focusEntries(data.focus);
  const audience = audienceMarkup(personas, scenarios, personaIds, scenarioIds, personas.length ? priorities : new Map());
  const knownScenarios = new Map();
  for (const [index, id] of scenarioIds.entries()) {
    if (id) knownScenarios.set(id, scenarioTitle(scenarios[index], `scenarios[${index}]`));
  }
  const audienceTitle = personas.length ? '目标用户与使用场景' : '使用场景';
  const notes = texts(data.observation, 'observation', true);
  const background = data.background === undefined ? '' : html(field(data.background, 'background'));
  const business = businessMarkup(data.business);
  const revision = revisionMarkup(data.revision);
  const requirementRows = items(data.requirements, 'requirements', true);
  const rowIds = rowIdentifiers(requirementRows, 'requirements', (entry) => entry?.id === undefined);
  const requirementNames = new Map();
  for (const [index, id] of rowIds.entries()) {
    if (id) requirementNames.set(id, field(requirementRows[index].name, `requirements[${index}].name`));
  }
  const designs = validateDesigns(data.designs, { baseDir: assetBaseDir, requirementIds: requirementNames, scenarioIds: knownScenarios, embed: true });
  const linkedDesigns = designLinksByRequirement(designs);
  const rowsWithDesigns = requirementRows.map((row, index) => ({ ...row, designLinks: linkedDesigns.get(rowIds[index]) }));
  const requirements = optionalTable(rowsWithDesigns, 'requirements', [
    ['id', '编号'], ['name', '功能'], ['priority', '优先级'], ['precondition', '前置条件'],
    ['behavior', '交互与规则'], ['feedback', '可见反馈'], ['scenarioIds', '对应场景'], ['designLinks', '交互设计'],
  ], {
    optionalColumns: ['id', 'precondition', 'feedback', 'scenarioIds', 'designLinks'], rowIds,
    cellRenderers: {
      scenarioIds: (value, name) => referenceLinks(value, name, knownScenarios, 'scenario'),
      designLinks: (value) => value,
    },
  });
  const exceptions = optionalTable(data.exceptions, 'exceptions', [
    ['requirementIds', '关联需求'], ['trigger', '触发条件'], ['message', '界面提示'], ['recovery', '恢复或重试去向'],
  ], { cellRenderers: { requirementIds: (value, name) => referenceLinks(value, name, requirementNames, 'requirement', false) } });
  const tracking = optionalTable(data.tracking, 'tracking', [
    ['event', '事件'], ['trigger', '触发时机'], ['attributes', '必要属性'],
    ['deduplication', '去重规则'], ['purpose', '分析用途'],
  ], { optionalColumns: ['attributes', 'deduplication'] });
  const nonFunctional = optionalTable(data.nonFunctional, 'nonFunctional', [
    ['area', '类别'], ['requirement', '要求'], ['verification', '验收方式'],
  ]);
  const performance = optionalTable(data.performance, 'performance', [
    ['name', '性能指标'], ['window', '测量窗口'], ['devices', '测量设备'], ['verification', '核对方式'],
    ['baseline', '基线', '待定'], ['target', '性能目标', '待定'], ['confirmationRole', '确认角色'],
  ]);
  const openItems = openItemsMarkup(data.openItems);
  const focus = personas.length ? '' : focusMarkup(priorities);
  const navigation = [
    ['goal', '目标与背景'], ['business', '业务目标与指标', business],
    ['scenarios', personas.length ? '用户与场景' : audienceTitle], ['scope', '改动范围'], ['flow', '主流程'],
    ['interaction-design', '交互设计', designs.length],
    ['requirements', '功能需求', requirements], ['exceptions', '异常处理', exceptions], ['focus', '需求重点', focus],
    ['non-functional', '非功能需求', nonFunctional || performance], ['tracking', '埋点与指标', tracking || notes.length],
    ['acceptance', '验收附录'],
    ['open-items', '待确认', openItems.length],
  ].filter((entry) => entry.length === 2 || entry[2]);
  const content = [
    `<nav class="report-nav" aria-label="PRD 目录">${navigation.map(([id, label]) =>
      `<a href="#${id}">${label}</a>`).join('')}</nav>`,
    '<div class="report-content">',
    `<header><p>${product} · 产品需求文档</p><h1>${title}</h1>${revision}</header>`,
    section('goal', '目标', `<blockquote class="goal-quote"><span aria-hidden="true">“</span><p>${goal}</p></blockquote>${
      background ? `<div class="background"><h3>背景</h3><p>${background}</p></div>` : ''
    }`),
    business,
    personas.length ? '' : '<div class="grid">',
    section('scenarios', audienceTitle, audience),
    section('scope', '改动范围', scopeMarkup(data.scope)),
    personas.length ? '' : '</div>',
    section('flow', '主流程', flowMarkup(data.flow, knownScenarios)),
    designs.length ? section('interaction-design', '交互设计', `<div class="design-gallery">${designMarkup(designs, requirementNames, knownScenarios)}</div>`) : '',
    requirements ? section('requirements', '功能需求', requirements) : '',
    exceptions ? section('exceptions', '异常处理', exceptions) : '',
    focus,
    nonFunctional || performance ? section('non-functional', '非功能需求', `${nonFunctional}${
      performance ? `<div class="performance"><h3>性能目标</h3>${performance}</div>` : ''
    }`) : '',
    tracking || notes.length ? section('tracking', '埋点与指标', `${tracking}${
      notes.length ? section('observation', '上线后观察', `<ul class="notes">${listMarkup(notes)}</ul>`) : ''
    }`) : '',
    section('acceptance', '验收附录', `<h3>验收条件与测试要点</h3>${acceptanceMarkup(data.acceptance, requirementNames, knownScenarios)}`),
    openItems ? section('open-items', '待确认', openItems) : '',
    '</div>',
  ].join('\n');

  const replacements = { PRD_TITLE: `${product} · ${title}`, PRD_CONTENT: content };
  return template.replace(/\{\{(PRD_TITLE|PRD_CONTENT)\}\}/g, (_, key) => replacements[key]);
}
