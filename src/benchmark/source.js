/*
 * 核心功能
 * 处理 benchmark 信源识别、场景推断、采纳证据归一化和推荐晋级规则。
 *
 * 输入
 * 接收 url/path/source record、observe 参数和候选来源文本描述。
 *
 * 输出
 * 导出 source record 归一化、identity 去重、采纳统计和 promotion 校验能力。
 *
 * 定位
 * 位于 benchmark 领域逻辑层，只管理信源和采纳语义，不直接读写 registry 文件。
 *
 * 依赖
 * 依赖 fs-utils 的 exists、time 的 timestamp，以及 constants 提供的共享阈值与路径规则。
 *
 * 维护规则
 * 新增场景、触发词或晋级规则时，必须保持现有 source id/sourceKey 稳定，避免破坏已落盘数据。
 */
import path from 'node:path';
import { exists } from '../fs-utils.js';
import { timestamp } from '../time.js';
import {
  DAY_MS,
  DEFAULT_ADOPTION_THRESHOLD,
  DEFAULT_ADOPTION_WINDOW_DAYS,
  MAX_ADOPTION_EVIDENCE,
  OVERBROAD_TRIGGER_TOKENS,
  slugify,
} from './constants.js';

const COMMON_SECOND_LEVEL_DOMAINS = new Set(['ac', 'co', 'com', 'edu', 'gov', 'net', 'org']);

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function isGitHubShorthand(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value ?? '').trim());
}

function normalizeRemoteUrl(value) {
  if (isGitHubShorthand(value)) {
    return `https://github.com/${String(value).trim()}`;
  }
  return String(value ?? '').trim();
}

function toRepoSlug(urlString) {
  try {
    const url = new URL(urlString);
    if (!/github\.com$/i.test(url.hostname)) {
      return null;
    }
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return null;
    }
    return `${segments[0]}/${segments[1]}`.replace(/\.git$/i, '');
  } catch {
    return null;
  }
}

function normalizeHost(hostname) {
  return String(hostname ?? '').trim().toLowerCase().replace(/^www\./, '');
}

function registrableDomain(hostname) {
  const host = normalizeHost(hostname);
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return host;
  }
  const last = parts.at(-1);
  const previous = parts.at(-2);
  if (last?.length === 2 && COMMON_SECOND_LEVEL_DOMAINS.has(previous)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

function canonicalUrlSourceKey(urlString) {
  try {
    const url = new URL(urlString);
    const repo = toRepoSlug(urlString);
    if (repo) {
      return `github.com/${repo.toLowerCase()}`;
    }
    const domain = registrableDomain(url.hostname);
    const firstPathSegment = url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => segment.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5.-]+/g, '-'))
      .find(Boolean);
    return firstPathSegment ? `${domain}/${firstPathSegment}` : domain;
  } catch {
    return String(urlString ?? '').trim().toLowerCase();
  }
}

function dedupe(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function normalizeAdoptionEvidence(value) {
  return dedupe((Array.isArray(value) ? value : [])
    .filter((item) => item !== null && item !== undefined)
    .map((item) => {
      if (typeof item === 'string') {
        return { note: item };
      }
      if (typeof item !== 'object') {
        return { note: String(item) };
      }
      return {
        observedAt: item.observedAt ?? null,
        task: item.task ?? null,
        reason: item.reason ?? item.note ?? null,
        adoptedSignal: item.adoptedSignal ?? null,
        source: item.source ?? null,
      };
    })
    .map((item) => JSON.stringify(item)))
    .map((item) => JSON.parse(item))
    .slice(-MAX_ADOPTION_EVIDENCE);
}

function normalizeAdoptionWindowDays(value) {
  const windowDays = Number(value ?? DEFAULT_ADOPTION_WINDOW_DAYS);
  return Number.isInteger(windowDays) && windowDays > 0 ? windowDays : DEFAULT_ADOPTION_WINDOW_DAYS;
}

function parseObservedAt(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const text = String(value).trim();
  if (!text) return null;
  const parsedIso = new Date(text);
  if (!Number.isNaN(parsedIso.getTime())) {
    return parsedIso;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/u);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function countRecentAdoptions(evidence, windowDays, now = new Date()) {
  const cutoff = now.getTime() - (normalizeAdoptionWindowDays(windowDays) * DAY_MS);
  return evidence.filter((item) => {
    const observedAt = parseObservedAt(item.observedAt);
    return observedAt && observedAt.getTime() >= cutoff;
  }).length;
}

function inferSourceType(urlString, sourceValue) {
  if (sourceValue?.kind === 'local-file') {
    return 'local-file';
  }
  const normalized = String(urlString ?? '').toLowerCase();
  if (normalized.includes('github.com/')) {
    return 'github';
  }
  if (
    normalized.includes('/docs')
    || normalized.includes('developers.openai.com')
    || normalized.includes('platform.claude.com')
    || normalized.includes('code.claude.com')
    || normalized.includes('ai.google.dev')
  ) {
    return 'official-docs';
  }
  if (
    normalized.includes('/blog/')
    || normalized.includes('/engineering/')
    || normalized.includes('openai.com/index/')
    || normalized.includes('anthropic.com/engineering/')
    || normalized.includes('langchain.com/blog/')
    || normalized.includes('manus.im/blog/')
  ) {
    return 'engineering-article';
  }
  return 'web';
}

function inferResearchMethod(sourceType) {
  if (sourceType === 'github') {
    return 'deepwiki_then_github';
  }
  if (sourceType === 'official-docs') {
    return 'context7_then_official';
  }
  if (sourceType === 'local-file') {
    return 'local_read_first';
  }
  return 'official_page_first';
}

function inferScenarios(text) {
  const normalized = String(text ?? '').toLowerCase();
  const scenarios = [];
  const add = (value) => {
    if (!scenarios.includes(value)) {
      scenarios.push(value);
    }
  };

  if (/(openprd|openspec|superpowers|prd|product requirements?)/i.test(normalized)) {
    add('open-vibecoding-product');
  }
  if (/(cli|doctor|dry-run|command discoverability|developer experience|dx)/i.test(normalized)) {
    add('cli-tooling');
    add('developer-experience');
  }
  if (/(skill|skills|skill discovery|skill install|skill router)/i.test(normalized)) {
    add('skill-design');
  }
  if (/(harness|agent|long-running|workflow loop|managed agents)/i.test(normalized)) {
    add('agent-harness');
  }
  if (/(code review|pr review|pull request review|review lane|reviewer agreement|false positive|hallucination filter|merge recommendation|critical\/high\/medium\/low|deep review|independent reviewers|交叉验证|误报过滤|合并建议|深度代码审查|并行审查|审查分级|独立审查|reviewer agreement)/i.test(normalized)) {
    add('pr-review-harness');
    add('agent-harness');
  }
  if (/(context engineering|context window|context registry|retrieval)/i.test(normalized)) {
    add('context-engineering');
  }
  if (/(prompt engineering|prompting|system prompt|prompt guidance)/i.test(normalized)) {
    add('prompt-engineering');
  }
  if (/(icon|icons|iconfont|lucide|tabler|react icons|phosphor|lobehub|techicons|thiings|图标|图标站|图标库|视觉资产)/i.test(normalized)) {
    add('icon-resources');
  }

  return scenarios;
}

function inferTriggerWhen(scenarios) {
  const lines = [];
  for (const scenario of scenarios) {
    if (scenario === 'open-vibecoding-product') {
      lines.push('设计 Open VibeCoding / PRD 工作流、需求入口、状态承接或生成规则');
    }
    if (scenario === 'cli-tooling') {
      lines.push('设计 CLI 命令、doctor、dry-run、错误提示、确认流程或可发现性');
    }
    if (scenario === 'skill-design') {
      lines.push('设计 skill 触发、metadata、安装方式、自动识别或项目级覆盖规则');
    }
    if (scenario === 'agent-harness') {
      lines.push('设计 Agent harness、长程任务、状态持久化、验证门禁或人工接管');
    }
    if (scenario === 'pr-review-harness') {
      lines.push('设计 merge 前高风险复核、独立 reviewer 交叉验证、误报过滤、reviewer agreement 或 merge recommendation');
    }
    if (scenario === 'context-engineering') {
      lines.push('设计上下文常驻、按需检索、registry/索引或证据优先级');
    }
    if (scenario === 'prompt-engineering') {
      lines.push('设计系统提示、skill 提示、任务提示或 structured prompting');
    }
    if (scenario === 'developer-experience') {
      lines.push('设计开发者体验、命令组合方式、输出结构或错误恢复路径');
    }
    if (scenario === 'icon-resources') {
      lines.push('选择 UI、AI、技术栈、3D 或功能图标资源站，或选择 Lucide、Tabler、React Icons 等实现库');
    }
  }
  return dedupe(lines).slice(0, 3);
}

function inferNotFor(scenarios) {
  const exclusions = [];
  if (!scenarios.includes('open-vibecoding-product')) {
    exclusions.push('普通 PRD / 产品流程设计');
  }
  if (!scenarios.includes('cli-tooling')) {
    exclusions.push('与 CLI 无关的一次性 UI 视觉问题');
  }
  if (!scenarios.includes('agent-harness')) {
    exclusions.push('单次脚本报错或纯环境权限问题');
  }
  if (!scenarios.includes('pr-review-harness')) {
    exclusions.push('与 PR 审查 lane 无关的普通实现任务');
  } else {
    exclusions.push('默认给每个低风险 PR 拉起多 reviewer 并行审查');
  }
  if (!scenarios.includes('prompt-engineering')) {
    exclusions.push('不涉及提示词或上下文工程的纯实现细节');
  }
  if (scenarios.includes('icon-resources')) {
    exclusions.push('不涉及图标、视觉资产或图标实现库选型的任务');
  }
  return dedupe(exclusions).slice(0, 3);
}

function titleFromSource(sourceValue, normalizedUrl, sourceType) {
  if (sourceValue.kind === 'local-file') {
    return path.basename(sourceValue.absolutePath);
  }
  if (sourceType === 'github') {
    return toRepoSlug(normalizedUrl) ?? normalizedUrl;
  }
  try {
    const url = new URL(normalizedUrl);
    const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
    return lastSegment ? `${url.hostname}/${lastSegment}` : url.hostname;
  } catch {
    return normalizedUrl;
  }
}

function normalizeAdoptionThreshold(value) {
  const threshold = Number(value ?? DEFAULT_ADOPTION_THRESHOLD);
  return Number.isInteger(threshold) && threshold > 0 ? threshold : DEFAULT_ADOPTION_THRESHOLD;
}

function normalizeSourceRecord(record) {
  const promotion = record.promotion && typeof record.promotion === 'object' ? record.promotion : {};
  const evidence = normalizeAdoptionEvidence(record.evidence);
  const windowDays = normalizeAdoptionWindowDays(promotion.windowDays);
  const rawAdoptedCount = Number(record.adoptedCount ?? 0);
  const adoptedCount = Math.max(0, Number.isFinite(rawAdoptedCount) ? rawAdoptedCount : 0, evidence.length);
  return {
    id: record.id,
    title: record.title,
    scope: record.scope ?? 'project',
    status: record.status,
    sourceType: record.sourceType,
    sourceKey: record.sourceKey ?? null,
    url: record.url ?? null,
    path: record.path ?? null,
    repo: record.repo ?? null,
    researchMethod: record.researchMethod,
    scenarios: dedupe(record.scenarios ?? []),
    triggerWhen: dedupe(record.triggerWhen ?? []),
    notFor: dedupe(record.notFor ?? []),
    note: record.note ?? null,
    value: record.value ?? null,
    adoptedCount: Number.isFinite(adoptedCount) && adoptedCount > 0 ? Math.trunc(adoptedCount) : 0,
    lastUsedAt: record.lastUsedAt ?? null,
    evidence,
    recentAdoptedCount: countRecentAdoptions(evidence, windowDays),
    promotion: {
      threshold: Number.isInteger(Number(promotion.threshold)) && Number(promotion.threshold) > 0
        ? Number(promotion.threshold)
        : DEFAULT_ADOPTION_THRESHOLD,
      windowDays,
      recommended: Boolean(promotion.recommended),
      recommendedAt: promotion.recommendedAt ?? null,
      approveCommand: promotion.approveCommand ?? null,
    },
    addedAt: record.addedAt ?? timestamp(),
    approvedAt: record.approvedAt ?? null,
    lastVerified: record.lastVerified ?? null,
  };
}

function computePromotionState(source, threshold = source?.promotion?.threshold, windowDays = source?.promotion?.windowDays) {
  const normalizedSource = normalizeSourceRecord(source ?? {});
  const normalizedThreshold = normalizeAdoptionThreshold(threshold);
  const normalizedWindowDays = normalizeAdoptionWindowDays(windowDays);
  const recentAdoptedCount = countRecentAdoptions(normalizedSource.evidence, normalizedWindowDays);
  const recommended = normalizedSource.status === 'candidate' && recentAdoptedCount >= normalizedThreshold;
  return {
    threshold: normalizedThreshold,
    windowDays: normalizedWindowDays,
    recentAdoptedCount,
    recommended,
    approveCommand: recommended ? `open-vibecoding benchmark approve ${normalizedSource.id}` : null,
  };
}

async function resolveSourceInput(projectRoot, source) {
  const raw = String(source ?? '').trim();
  if (!raw) {
    throw new Error('Benchmark source is required.');
  }

  if (isGitHubShorthand(raw) || isHttpUrl(raw)) {
    const url = normalizeRemoteUrl(raw);
    return { kind: 'remote-url', raw, url };
  }

  const absolutePath = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
  if (await exists(absolutePath)) {
    return {
      kind: 'local-file',
      raw,
      absolutePath,
      relativePath: path.relative(projectRoot, absolutePath) || path.basename(absolutePath),
    };
  }

  throw new Error(`Cannot resolve benchmark source: ${raw}`);
}

function buildSourceValue(sourceValue, note) {
  const normalizedUrl = sourceValue.kind === 'remote-url' ? sourceValue.url : null;
  const sourceType = inferSourceType(normalizedUrl, sourceValue);
  const combinedText = [sourceValue.raw, normalizedUrl, sourceValue.relativePath, note].filter(Boolean).join(' ');
  const scenarios = inferScenarios(combinedText);
  const title = titleFromSource(sourceValue, normalizedUrl, sourceType);
  const repo = normalizedUrl ? toRepoSlug(normalizedUrl) : null;
  const sourceKey = normalizedUrl
    ? canonicalUrlSourceKey(normalizedUrl)
    : `file:${sourceValue.relativePath}`;
  const idSeed = sourceKey ?? repo ?? sourceValue.relativePath ?? title;
  const id = slugify(idSeed, 'benchmark-source');

  return normalizeSourceRecord({
    id,
    title,
    scope: 'project',
    status: 'candidate',
    sourceType,
    sourceKey,
    url: normalizedUrl,
    path: sourceValue.kind === 'local-file' ? sourceValue.relativePath : null,
    repo,
    researchMethod: inferResearchMethod(sourceType),
    scenarios,
    triggerWhen: inferTriggerWhen(scenarios),
    notFor: inferNotFor(scenarios),
    note: note ?? null,
    value: note ?? null,
    addedAt: timestamp(),
  });
}

function sourceIdentity(source) {
  if (source.sourceKey) {
    return `source-key:${source.sourceKey}`;
  }
  if (source.url) {
    return `url:${source.url.toLowerCase()}`;
  }
  if (source.path) {
    return `path:${source.path}`;
  }
  return `id:${source.id}`;
}

function duplicateSource(existingSources, candidate) {
  const wanted = sourceIdentity(candidate);
  return existingSources.find((source) => (
    source.id === candidate.id
    || sourceIdentity(source) === wanted
    || (source.sourceKey && candidate.sourceKey && source.sourceKey === candidate.sourceKey)
  )) ?? null;
}

function buildObservationEvidence(source, options = {}) {
  const note = String(options.notes ?? options.reason ?? '').trim();
  return {
    observedAt: options.observedAt ?? timestamp(),
    task: String(options.task ?? options.event ?? '').trim() || null,
    reason: note || null,
    adoptedSignal: String(options.adoptedSignal ?? 'user-adopted').trim() || 'user-adopted',
    source: source.url ?? source.path ?? null,
  };
}

function withPromotion(source, threshold, windowDays = source?.promotion?.windowDays) {
  const promotionState = computePromotionState(source, threshold, windowDays);
  return normalizeSourceRecord({
    ...source,
    promotion: {
      threshold: promotionState.threshold,
      windowDays: promotionState.windowDays,
      recommended: promotionState.recommended,
      recommendedAt: promotionState.recommended
        ? (source.promotion?.recommendedAt ?? timestamp())
        : null,
      approveCommand: promotionState.approveCommand,
    },
  });
}

function benchmarkRecommendations(sources) {
  return sources
    .filter((source) => source.status === 'candidate' && source.promotion?.recommended)
    .map((source) => ({
      id: source.id,
      title: source.title,
      sourceKey: source.sourceKey ?? source.id,
      adoptedCount: source.recentAdoptedCount,
      totalAdoptedCount: source.adoptedCount,
      threshold: source.promotion.threshold,
      windowDays: source.promotion.windowDays,
      lastUsedAt: source.lastUsedAt,
      approveCommand: source.promotion.approveCommand,
    }));
}

function hasOverbroadTrigger(source) {
  if (!Array.isArray(source.triggerWhen) || source.triggerWhen.length === 0) {
    return true;
  }
  const combined = source.triggerWhen.join(' ').toLowerCase();
  return OVERBROAD_TRIGGER_TOKENS.some((token) => combined.includes(token.toLowerCase()));
}

function normalizeCheckedSource(source) {
  return normalizeSourceRecord({
    ...source,
    lastVerified: timestamp(),
  });
}

function validatePromotionControl(source) {
  const issues = [];
  const promotionState = computePromotionState(source, source.promotion?.threshold, source.promotion?.windowDays);
  const actualRecommended = Boolean(source.promotion?.recommended);
  const actualApproveCommand = source.promotion?.approveCommand ?? null;
  const detail = `最近 ${promotionState.windowDays} 天采纳 ${promotionState.recentAdoptedCount}/${promotionState.threshold} 次`;

  if (source.adoptedCount < promotionState.recentAdoptedCount) {
    issues.push({
      level: 'error',
      code: 'adoption-count-drift',
      message: `Cumulative adoption count is lower than rolling-window evidence (${source.adoptedCount} < ${promotionState.recentAdoptedCount}).`,
    });
  }

  if (source.status === 'approved') {
    if (!source.approvedAt) {
      issues.push({
        level: 'error',
        code: 'missing-approved-at',
        message: 'Approved source is missing approvedAt; explicit approval cannot be proven.',
      });
    }
    if (actualRecommended) {
      issues.push({
        level: 'error',
        code: 'approved-source-still-recommended',
        message: 'Approved source must not remain in recommended state.',
      });
    }
    if (actualApproveCommand) {
      issues.push({
        level: 'error',
        code: 'approved-source-has-approve-command',
        message: 'Approved source must not keep an approve command.',
      });
    }
    return issues;
  }

  if (source.status === 'candidate' && source.approvedAt) {
    issues.push({
      level: 'error',
      code: 'candidate-has-approved-at',
      message: 'Candidate source must not carry approvedAt before explicit approval.',
    });
  }

  if (actualRecommended !== promotionState.recommended) {
    issues.push({
      level: 'error',
      code: 'promotion-control-drift',
      message: `${detail}，当前${actualRecommended ? '已标记推荐' : '未标记推荐'}，与应有推荐状态不一致。`,
    });
  }

  if (promotionState.recommended && actualApproveCommand !== promotionState.approveCommand) {
    issues.push({
      level: 'error',
      code: 'approve-command-drift',
      message: `Recommended candidate approve command drifted. Expected ${promotionState.approveCommand}.`,
    });
  }

  if (!promotionState.recommended && actualApproveCommand) {
    issues.push({
      level: 'error',
      code: 'stale-approve-command',
      message: `${detail}，当前不应继续暴露 approve command。`,
    });
  }

  return issues;
}

export {
  benchmarkRecommendations,
  buildObservationEvidence,
  buildSourceValue,
  computePromotionState,
  duplicateSource,
  hasOverbroadTrigger,
  isGitHubShorthand,
  isHttpUrl,
  normalizeAdoptionEvidence,
  normalizeAdoptionThreshold,
  normalizeCheckedSource,
  normalizeRemoteUrl,
  normalizeSourceRecord,
  resolveSourceInput,
  sourceIdentity,
  toRepoSlug,
  validatePromotionControl,
  withPromotion,
};
