/*
 * 核心功能
 * 统一生成面向用户的变化摘要、loop commit 默认文案和 handoff 版本说明条目。
 *
 * 输入
 * 接收任务文本、PRD 快照字段或评审摘要原文。
 *
 * 输出
 * 返回动作词、短摘要、详细说明，以及 commit / handoff / review 可复用的格式化结果。
 *
 * 定位
 * 位于 Open VibeCoding 用户可见变化表达层，连接 loop、handoff 和 review 文案约定。
 *
 * 依赖
 * 仅依赖基础字符串处理，不依赖 workspace 或渲染上下文。
 *
 * 维护规则
 * 动作词和摘要规则要保持用户视角，避免把内部流程词和实现细节直接当成最终文案。
 */
export const CHANGE_SUMMARY_VERBS = ['新增', '修复', '优化', '调整', '移除'];

export const USER_CHANGE_SUMMARY_GUIDE = {
  perspective: '从用户可感知变化出发，优先写用户现在能做什么、会看到什么、哪个问题被修好。',
  preferredVerbs: CHANGE_SUMMARY_VERBS,
  panelExamples: {
    flow: { summary: '新增入口', detail: '用户现在可以直接进入对应流程，不用再自己找路径。' },
    function: { summary: '优化说明', detail: '用户先看到新增、修复、优化这类短摘要，再决定是否继续细读。' },
    guardrail: { summary: '调整边界', detail: '只保留用户需要知道的限制、影响和下一步。' },
    risk: { summary: '修复误判', detail: '避免把实现授权写成再次索取确认。' },
  },
};

const CHANGE_TYPE_RULES = [
  { type: '修复', pattern: /修复|修正|解决|避免|恢复|补齐|兼容|纠正|排查|报错|失败|异常|错误|误判|崩溃|缺失|遗漏|bug|fix/i },
  { type: '移除', pattern: /移除|删除|下线|废弃|停用|去掉|清理|剔除/u },
  { type: '新增', pattern: /新增|添加|加入|支持|提供|创建|引入|接入|生成|开放|允许|启用/u },
  { type: '优化', pattern: /优化|改进|提升|增强|简化|提炼|统一|压缩|对齐/u },
  { type: '调整', pattern: /调整|更新|改为|切换|重命名|改动|变更|重构|迁移/u },
];

const SUMMARY_PREFIX_PATTERNS = [
  /^[A-Za-z][A-Za-z0-9._/-]*\s+/u,
  /^(支持|提供|允许|实现|用于|帮助|让用户|让团队|让执行方|默认|现在|可以|需要|先|再)/u,
  /^(用户|团队|协作者)(现在)?可以/u,
  /^(导出的|默认|当前|新的|本次|这次|这个)/u,
  /^(新增|修复|优化|调整|移除|删除|改进|更新|统一|改为|切换)/u,
];

const TECHNICAL_SUMMARY_PREFIX = /^(commit|review|handoff|loop|task|spec|release notes)\b/i;

function normalizedText(value) {
  return String(value ?? '')
    .replace(/^\s*-\s*\[[ xX]\]\s*/u, '')
    .replace(/^\s*[-*]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textLength(value) {
  return Array.from(normalizedText(value)).length;
}

function stripTrailingPunctuation(value) {
  return normalizedText(value).replace(/[。.!?！？；;，,、：:\-]+$/u, '').trim();
}

function stripLeadingChangePrefix(value, verbs = CHANGE_SUMMARY_VERBS) {
  const text = normalizedText(value);
  for (const verb of [...verbs, '删除']) {
    const stripped = text.replace(new RegExp(`^${verb}[：:、，,\\s-]*`, 'u'), '').trim();
    if (stripped && stripped !== text) {
      return stripped;
    }
  }
  return text;
}

function firstClause(value) {
  const text = stripTrailingPunctuation(value);
  return text
    .split(/[\n。！？!?；;，,、]/u)
    .map((item) => item.trim())
    .find(Boolean) ?? text;
}

function splitClauses(value) {
  const text = stripTrailingPunctuation(value);
  return text
    .split(/[\n。！？!?；;，,、]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortenText(value, maxLength) {
  const chars = Array.from(stripTrailingPunctuation(value));
  if (chars.length <= maxLength) return chars.join('');
  return chars.slice(0, maxLength).join('').replace(/[的了和并且及等、，,：:\-]+$/u, '').trim();
}

function stripSummaryNoise(value) {
  let text = firstClause(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of SUMMARY_PREFIX_PATTERNS) {
      const next = text.replace(pattern, '').trim();
      if (next && next !== text && textLength(next) >= 2) {
        text = next;
        changed = true;
      }
    }
  }
  return text;
}

function pickSummaryClause(value) {
  const clauses = splitClauses(value).map((item) => stripSummaryNoise(item)).filter(Boolean);
  if (clauses.length === 0) {
    return stripSummaryNoise(value) || firstClause(value);
  }
  if (clauses.length > 1 && TECHNICAL_SUMMARY_PREFIX.test(clauses[0])) {
    return clauses[1];
  }
  if (clauses.length > 1 && /^[A-Za-z][A-Za-z0-9 ._/-]+$/u.test(clauses[0])) {
    return clauses[1];
  }
  return clauses[0];
}

function parseStructuredChange(value) {
  const text = normalizedText(value);
  const markdown = text.match(/^\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/u);
  if (markdown) {
    return {
      summary: normalizedText(markdown[1]),
      detail: normalizedText(markdown[2]),
    };
  }
  const plain = text.match(/^([^：:]{2,20})[：:]\s*(.+)$/u);
  if (plain) {
    return {
      summary: normalizedText(plain[1]),
      detail: normalizedText(plain[2]),
    };
  }
  return null;
}

function defaultSummaryFromDetail(detail, type, maxLength) {
  const available = Math.max(2, maxLength - Array.from(type).length);
  const clause = pickSummaryClause(detail);
  const label = shortenText(clause, available);
  if (!label) return type;
  return shortenText(`${type}${label}`, maxLength);
}

export function detectChangeVerb(value, fallbackType = '调整') {
  const text = normalizedText(value);
  const matchText = text.replace(/^[A-Za-z][A-Za-z0-9._/-]*\s+/u, '');
  for (const verb of CHANGE_SUMMARY_VERBS) {
    if (matchText.startsWith(verb)) {
      return verb;
    }
  }
  for (const rule of CHANGE_TYPE_RULES) {
    const match = matchText.match(rule.pattern);
    if (match && typeof match.index === 'number' && match.index <= 4) {
      return rule.type;
    }
  }
  return fallbackType;
}

export function buildChangeEntry(value, options = {}) {
  const text = normalizedText(value);
  if (!text) return null;

  const {
    fallbackType = '调整',
    summaryMaxLength = 15,
    detailMaxLength = null,
  } = options;

  const structured = parseStructuredChange(text);
  const type = detectChangeVerb(structured?.summary ?? structured?.detail ?? text, fallbackType);
  const rawDetail = structured?.detail ?? stripLeadingChangePrefix(text);
  const detailBase = rawDetail || text;
  const detail = detailMaxLength ? shortenText(detailBase, detailMaxLength) : stripTrailingPunctuation(detailBase);

  let summary = structured?.summary ?? defaultSummaryFromDetail(detail, type, summaryMaxLength);
  if (textLength(summary) > summaryMaxLength) {
    summary = defaultSummaryFromDetail(detail, type, summaryMaxLength);
  }
  if (!summary.startsWith(type)) {
    summary = defaultSummaryFromDetail(detail, type, summaryMaxLength);
  }

  return {
    type,
    summary,
    detail,
    sentence: `${type}：${detail}`,
    panel: `**${summary}**：${detail}`,
    bullet: `- ${type}：${detail}`,
  };
}

export function buildChangeEntries(values, options = {}) {
  const items = Array.isArray(values) ? values : [values];
  const entries = [];
  const seen = new Set();
  for (const item of items) {
    const entry = buildChangeEntry(item, options);
    if (!entry) continue;
    const key = `${entry.type}::${entry.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (options.limit && entries.length >= options.limit) break;
  }
  return entries;
}

export function buildTaskCommitMessage(task) {
  const basis = task?.done ?? task?.title ?? task?.id ?? '本次变更';
  const entry = buildChangeEntry(basis, {
    fallbackType: detectChangeVerb(`${task?.title ?? ''} ${task?.done ?? ''}`, '优化'),
    summaryMaxLength: 20,
  }) ?? {
    type: '调整',
    summary: '调整本次变更',
    detail: basis,
    sentence: `调整：${basis}`,
  };
  const taskLine = [task?.id, task?.title].filter(Boolean).join(' ');
  const body = [`- ${entry.sentence}`];
  if (taskLine && taskLine !== entry.detail) {
    body.push(`- 任务：${taskLine}`);
  }
  return [entry.summary, '', ...body].join('\n');
}

function collectSnapshotCandidates(snapshot) {
  const sections = snapshot?.sections ?? {};
  return [
    ...(Array.isArray(sections.requirements?.functional)
      ? sections.requirements.functional.map((text) => ({ text, fallbackType: '新增' }))
      : []),
    ...(Array.isArray(sections.scenarios?.primaryFlows)
      ? sections.scenarios.primaryFlows.map((text) => ({ text, fallbackType: '优化' }))
      : []),
    ...(Array.isArray(sections.scope?.inScope)
      ? sections.scope.inScope.map((text) => ({ text, fallbackType: '调整' }))
      : []),
    ...(Array.isArray(sections.goals?.goals)
      ? sections.goals.goals.map((text) => ({ text, fallbackType: '优化' }))
      : []),
    ...(Array.isArray(sections.businessGuardrails?.usageLimits)
      ? sections.businessGuardrails.usageLimits.map((text) => ({ text, fallbackType: '调整' }))
      : []),
    ...(Array.isArray(sections.businessGuardrails?.costControls)
      ? sections.businessGuardrails.costControls.map((text) => ({ text, fallbackType: '调整' }))
      : []),
  ];
}

export function buildSnapshotChangeSummary(snapshot, options = {}) {
  const limit = options.limit ?? 5;
  const entries = [];
  const seen = new Set();
  for (const candidate of collectSnapshotCandidates(snapshot)) {
    const entry = buildChangeEntry(candidate.text, {
      fallbackType: candidate.fallbackType,
      summaryMaxLength: 15,
    });
    if (!entry) continue;
    const key = `${entry.type}::${entry.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (entries.length >= limit) break;
  }

  if (entries.length === 0 && snapshot?.title) {
    const fallback = buildChangeEntry(snapshot.title, { fallbackType: '调整' });
    if (fallback) {
      entries.push(fallback);
    }
  }

  return buildChangeSummaryFromEntries(entries, {
    title: `${snapshot?.title ?? '当前版本'}变化摘要`,
    limit,
  });
}

export function buildChangeSummaryFromEntries(values, options = {}) {
  const limit = options.limit ?? null;
  const items = Array.isArray(values) ? values : [values];
  const seen = new Set();
  const entries = [];
  for (const value of items) {
    const entry = value?.type && value?.detail && value?.summary && value?.sentence
      ? {
        type: value.type,
        summary: value.summary,
        detail: value.detail,
        sentence: value.sentence,
        bullet: value.bullet ?? `- ${value.sentence}`,
      }
      : buildChangeEntry(value, {
        fallbackType: options.fallbackType ?? '调整',
        summaryMaxLength: 15,
      });
    if (!entry) continue;
    const key = `${entry.type}::${entry.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
    if (limit && entries.length >= limit) break;
  }

  return {
    title: options.title ?? '当前版本变化摘要',
    perspective: USER_CHANGE_SUMMARY_GUIDE.perspective,
    preferredVerbs: USER_CHANGE_SUMMARY_GUIDE.preferredVerbs,
    items: entries.map(({ type, summary, detail, sentence }) => ({
      type,
      summary,
      detail,
      sentence,
    })),
    markdown: entries.map((entry) => entry.bullet).join('\n'),
  };
}

export function buildReviewFallbackPanelItems(items, options = {}) {
  return buildChangeEntries(items, options).map((entry) => entry.panel);
}
