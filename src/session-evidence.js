/*
 * 核心功能
 * 从 Codex 原始会话事件中抽取可审查证据，并隔离系统提示、AGENTS 和工具 schema 噪声。
 *
 * 输入
 * 接收 JSONL 事件对象、消息对象或文本片段。
 *
 * 输出
 * 输出带 sourceKind 的 evidence records，以及供 knowledge matching 使用的清理后文本。
 *
 * 定位
 * 位于会话证据层，服务 daily review、knowledge review 和项目经验召回，不直接读写工作区。
 *
 * 依赖
 * 仅依赖标准 JavaScript，不依赖 CLI、文件系统或 OpenPrd workspace 状态。
 *
 * 维护规则
 * 这里负责证据卫生，不负责判断需求类型；新增来源时先补 sourceKind 和污染样例测试。
 */

const CONTEXT_ONLY_PATTERNS = [
  /\bAGENTS\.md instructions\b/i,
  /<INSTRUCTIONS>/i,
  /<\/INSTRUCTIONS>/i,
  /<environment_context>/i,
  /# Tools\b/i,
  /## Skills\b/i,
  /### Available skills\b/i,
  /\bnamespace\s+\w+\s*\{/i,
  /\btool schema\b/i,
  /\bYou are Codex\b/i,
  /\bOpenPrd Harness\b/i,
  /\bproject-doc\b/i,
];

const CONTEXT_ROLE_SET = new Set(['system', 'developer']);

const GENERIC_FRAMEWORK_TERMS = new Set([
  'agent',
  'agents',
  'agentruntime',
  'codex',
  'context',
  'developer',
  'hook',
  'hooks',
  'harness',
  'instruction',
  'instructions',
  'openprd',
  'schema',
  'skill',
  'skills',
  'system',
  'tool',
  'tools',
  'workflow',
  'workflows',
  '项目级',
  '项目经验',
  '沉淀',
]);

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function trimEvidenceText(value, max = 1200) {
  const text = normalizeWhitespace(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeEventType(event = {}) {
  return String(
    event.type
      ?? event.event
      ?? event.kind
      ?? event.eventType
      ?? event.name
      ?? event.item?.type
      ?? event.event_msg?.type
      ?? '',
  ).trim();
}

function normalizeRole(event = {}) {
  return String(
    event.role
      ?? event.message?.role
      ?? event.item?.role
      ?? event.event_msg?.role
      ?? '',
  ).trim().toLowerCase();
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractTextFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => firstString(part?.text, part?.content, part?.input, part?.output))
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    return firstString(content.text, content.content, content.input, content.output) ?? '';
  }
  return '';
}

function extractEventText(event = {}) {
  if (typeof event === 'string') return event;
  const eventMsg = event.event_msg ?? {};
  const item = event.item ?? {};
  const message = event.message ?? {};
  return firstString(
    event.text,
    event.content,
    event.output,
    event.final_answer,
    event.summary,
    event.prompt,
    event.user_message,
    event.agent_message,
    eventMsg.user_message,
    eventMsg.agent_message,
    eventMsg.final_answer,
    eventMsg.summary,
    eventMsg.message,
    item.final_answer,
    item.summary,
    item.text,
    item.output,
    message.text,
    extractTextFromContent(message.content),
    extractTextFromContent(item.content),
  ) ?? '';
}

function looksLikeContextOnly(text, event = {}) {
  const role = normalizeRole(event);
  if (CONTEXT_ROLE_SET.has(role)) return true;
  return CONTEXT_ONLY_PATTERNS.some((pattern) => pattern.test(text));
}

function classifyEvent(event = {}, text = '') {
  const role = normalizeRole(event);
  const type = normalizeEventType(event).toLowerCase();
  const eventMsg = event.event_msg ?? {};
  const item = event.item ?? {};
  if (looksLikeContextOnly(text, event)) {
    return { sourceKind: 'context-only', reason: 'system-context' };
  }
  if (role === 'user' || eventMsg.user_message) {
    return { sourceKind: 'user-direct', reason: 'user-message' };
  }
  if (
    role === 'assistant'
    || eventMsg.agent_message
    || eventMsg.final_answer
    || item.final_answer
    || type.includes('final')
  ) {
    return { sourceKind: 'assistant-final', reason: 'assistant-message' };
  }
  if (
    type.includes('task_complete')
    || event.task_complete
    || eventMsg.task_complete
    || item.type === 'task_complete'
  ) {
    return { sourceKind: 'assistant-final', reason: 'task-complete' };
  }
  if (
    type.includes('function_call')
    || type.includes('tool')
    || event.tool
    || event.name
    || item.name
  ) {
    return { sourceKind: 'tool-action', reason: 'tool-event' };
  }
  if (/\b(git status|npm test|node --test|openprd .*--verify|doctor)\b/i.test(text)) {
    return { sourceKind: 'tool-action', reason: 'command-evidence' };
  }
  return { sourceKind: 'context-only', reason: 'unclassified' };
}

function normalizeEvidenceRecord(record = {}, index = 0) {
  const text = trimEvidenceText(record.text);
  if (!text) return null;
  const sourceKind = String(record.sourceKind ?? 'context-only').trim() || 'context-only';
  return {
    sourceKind,
    text,
    reason: String(record.reason ?? '').trim() || null,
    role: String(record.role ?? '').trim() || null,
    eventType: String(record.eventType ?? '').trim() || null,
    eventIndex: Number.isFinite(Number(record.eventIndex)) ? Number(record.eventIndex) : index,
    confidence: Number.isFinite(Number(record.confidence)) ? Number(record.confidence) : (sourceKind === 'context-only' ? 0.2 : 0.8),
  };
}

function extractSessionEvidenceRecords(events = [], options = {}) {
  const maxRecords = Math.max(1, Number(options.maxRecords ?? 80));
  return (Array.isArray(events) ? events : [events])
    .map((event, index) => {
      const text = extractEventText(event);
      if (!normalizeWhitespace(text)) return null;
      const classification = classifyEvent(event, text);
      return normalizeEvidenceRecord({
        ...classification,
        text,
        role: normalizeRole(event),
        eventType: normalizeEventType(event),
        eventIndex: index,
      }, index);
    })
    .filter(Boolean)
    .slice(0, maxRecords);
}

function normalizeSessionEvidenceRecords(records = []) {
  return (Array.isArray(records) ? records : [records])
    .map((record, index) => normalizeEvidenceRecord(record, index))
    .filter(Boolean);
}

function cleanEvidenceRecords(records = [], options = {}) {
  const includeContextOnly = options.includeContextOnly === true;
  return normalizeSessionEvidenceRecords(records)
    .filter((record) => includeContextOnly || record.sourceKind !== 'context-only');
}

function buildCleanEvidenceText(records = [], options = {}) {
  const maxRecords = Math.max(1, Number(options.maxRecords ?? 24));
  return cleanEvidenceRecords(records, options)
    .slice(0, maxRecords)
    .map((record) => `[${record.sourceKind}] ${record.text}`)
    .join('\n');
}

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[`"'()[\]{}:;,!?]/g, ' ')
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeEvidenceText(value) {
  const text = String(value ?? '');
  if (!text.trim()) return '';
  const lines = text.split(/\r?\n/);
  const kept = [];
  let skipBlock = false;
  for (const line of lines) {
    const startsContextBlock = /<INSTRUCTIONS>|<environment_context>|# Tools\b|### Available skills\b/i.test(line);
    if (startsContextBlock) {
      skipBlock = true;
      continue;
    }
    if (skipBlock && /<\/INSTRUCTIONS>|<\/environment_context>/i.test(line)) {
      skipBlock = false;
      continue;
    }
    if (skipBlock) continue;
    if (CONTEXT_ONLY_PATTERNS.some((pattern) => pattern.test(line))) continue;
    kept.push(line);
  }
  return normalizeWhitespace(kept.join('\n'));
}

function isGenericFrameworkTerm(token) {
  const normalized = normalizeSearchText(token);
  return !normalized || GENERIC_FRAMEWORK_TERMS.has(normalized);
}

function filterGenericFrameworkTokens(tokens = []) {
  return [...new Set(tokens.filter((token) => !isGenericFrameworkTerm(token)))];
}

function buildSessionEvidenceReviewSource(options = {}) {
  const records = cleanEvidenceRecords(options.records ?? []);
  const title = firstString(options.title, records.find((record) => record.sourceKind === 'user-direct')?.text, '只读复盘证据候选');
  const sourceId = firstString(options.sourceId, title, 'session-evidence-review');
  const sourcePath = firstString(options.sourcePath, 'session-evidence');
  const userRecords = records.filter((record) => record.sourceKind === 'user-direct');
  const assistantRecords = records.filter((record) => record.sourceKind === 'assistant-final');
  const toolRecords = records.filter((record) => record.sourceKind === 'tool-action');
  const symptoms = [...userRecords, ...assistantRecords]
    .map((record) => record.text)
    .slice(0, 8);
  const rootCauseCandidates = records
    .filter((record) => ['assistant-final', 'tool-action', 'repo-state'].includes(record.sourceKind))
    .slice(0, 6)
    .map((record) => ({
      title: record.text,
      nextSteps: ['把这条证据和用户目标重新核对，只在确认可复用时推荐项目级沉淀。'],
      sourceKind: record.sourceKind,
    }));
  return {
    kind: 'session-evidence-review',
    evidenceOnly: true,
    sourceId,
    sourcePath,
    primaryPath: sourcePath,
    sourcePaths: [sourcePath],
    title,
    status: 'needs-review',
    symptoms,
    attentionGates: [],
    correlationFields: [],
    extraContextFields: [],
    missingCorrelationFields: [],
    eventNames: [...new Set(records.map((record) => record.sourceKind))],
    rootCauseCandidates,
    evidenceSources: records.map((record) => ({
      kind: record.sourceKind,
      path: `${sourcePath}#${record.eventIndex}`,
      reason: record.reason,
    })),
    queryExamples: [
      '先只看 user-direct、assistant-final、tool-action 证据，不把 AGENTS 或系统提示当成用户诉求。',
      '如果复盘证据跨多轮重复出现，再推荐用户把它保留为当前项目经验。',
    ],
    abstractPattern: '从只读复盘证据中先隔离系统上下文噪声，再把重复摩擦或可复用判断沉淀为项目级候选。',
    triggers: records
      .filter((record) => record.sourceKind !== 'context-only')
      .map((record) => `${record.sourceKind}: ${record.text}`)
      .slice(0, 8),
    prevention: [
      'raw session 先抽取 clean evidence，再进入候选判断。',
      'AGENTS、system、developer、tool schema 和 skill list 只能作为 context-only 背景，不触发用户诉求或项目经验候选。',
      '项目级沉淀先作为候选推荐给用户确认，不自动 promote。',
    ],
    verificationSteps: [
      '确认每条证据都有 sourceKind。',
      '确认候选推荐没有依赖 context-only 命中。',
      '确认用户确认前只生成候选，不修改正式项目 skill。',
    ],
  };
}

export {
  buildCleanEvidenceText,
  buildSessionEvidenceReviewSource,
  cleanEvidenceRecords,
  extractSessionEvidenceRecords,
  filterGenericFrameworkTokens,
  isGenericFrameworkTerm,
  normalizeSessionEvidenceRecords,
  sanitizeEvidenceText,
};
