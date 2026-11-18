import { IMPORT_FORMATS } from './test-report-import.js';

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be a nonempty string');
}

function id(value, label) {
  text(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) throw new Error(label + ' must be a stable ID');
}

function textList(list, label) {
  if (!Array.isArray(list)) throw new Error(label + ' must be an array');
  for (const value of list) text(value, label);
}

export function checkUnitPlan(data) {
  const plan = data.testPlan;
  if (plan === undefined) return;
  if (!Array.isArray(plan?.groups) || !plan.groups.length) throw new Error('testPlan.groups must contain at least one group');
  const groups = new Map();
  const rules = new Map();
  for (const group of plan.groups) {
    id(group?.id, 'group.id');
    if (groups.has(group.id)) throw new Error('Duplicate group: ' + group.id);
    groups.set(group.id, group);
    text(group.title, group.id + '.title');
    textList(group.dependsOn ?? [], group.id + '.dependsOn');
    textList(group.resources ?? [], group.id + '.resources');
    if (!Array.isArray(group.rules) || !group.rules.length) throw new Error(group.id + '.rules must contain at least one rule');
    for (const rule of group.rules) {
      id(rule?.id, 'rule.id');
      if (rules.has(rule.id)) throw new Error('Duplicate rule: ' + rule.id);
      text(rule.title, rule.id + '.title');
      rules.set(rule.id, group.id);
    }
    if (group.runner === undefined) continue;
    const runner = group.runner;
    if (!IMPORT_FORMATS.includes(runner?.format)) throw new Error(group.id + ': unsupported runner format');
    textList(runner.argv, group.id + '.runner.argv');
    if (runner.argv.length < 2 || runner.argv[0].includes('{result}') ||
        !runner.argv.slice(1).some(argument => argument.includes('{result}'))) {
      throw new Error(group.id + ': runner argv must specify an executable and a {result} argument');
    }
    for (const field of ['version', 'runnerVersion']) {
      if (runner[field] !== undefined) text(runner[field], group.id + '.runner.' + field);
    }
    if (runner.timeoutMs !== undefined && (!Number.isInteger(runner.timeoutMs) ||
        runner.timeoutMs < 1 || runner.timeoutMs > 2_147_483_647)) {
      throw new Error(group.id + '.runner.timeoutMs must be a positive timer interval');
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(groupId) {
    if (visiting.has(groupId)) throw new Error('Circular test group dependency: ' + groupId);
    if (visited.has(groupId)) return;
    if (!groups.has(groupId)) throw new Error('Unknown test group dependency: ' + groupId);
    visiting.add(groupId);
    for (const dependency of groups.get(groupId).dependsOn ?? []) visit(dependency);
    visiting.delete(groupId);
    visited.add(groupId);
  }
  for (const groupId of groups.keys()) visit(groupId);

  for (const entry of data.cases) {
    if (!rules.has(entry.ruleId)) throw new Error(entry.id + ': unknown ruleId');
    for (const field of ['input', 'action', 'expected', 'assertion']) text(entry[field], entry.id + '.' + field);
  }
  if (plan.findings !== undefined && !Array.isArray(plan.findings)) throw new Error('testPlan.findings must be an array');
  for (const finding of plan.findings ?? []) {
    if (!rules.has(finding?.ruleId)) throw new Error('Finding refers to an unknown rule');
    if (!['code', 'assertion'].includes(finding.kind)) throw new Error('Finding kind must be code or assertion');
    if (finding.status !== undefined && !['open', 'resolved'].includes(finding.status)) {
      throw new Error('Finding status must be open or resolved');
    }
    text(finding.detail, 'finding.detail');
    text(finding.evidence, 'finding.evidence');
  }
  return { groups, rules };
}
