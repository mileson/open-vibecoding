import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CANONICAL_COMMANDS, CANONICAL_SKILLS, renderCommandCatalog } from './agent-canonical-content.js';
import { renderApprovedBenchmarkRegistrySection } from './benchmark.js';
import { timestamp } from './time.js';
import { upsertWorkspaceRegistryEntry } from './workspace-registry.js';
import { readOperationalGitignoreStatus } from './workspace-core.js';
import {
  ADAPTER_CONTRACT_VERSION,
  CAPABILITY_STATUS,
  adapterContractDigest,
  describeCapabilities,
} from './adapters/index.js';
import {
  INSTALL_SAFETY_PROTOCOL_VERSION,
  normalizeSymlinkStrategy,
  safeAppendText,
  safeEnsureDirectory,
  safeWriteText,
} from './adapters/install-safety.js';

const PACKAGE_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OPENPRD_AGENT_TOOLS = ['codex', 'claude', 'cursor'];
const OPENPRD_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const OPENPRD_HOOK_PROFILES = {
  lite: ['UserPromptSubmit', 'PreToolUse', 'Stop'],
  guarded: ['UserPromptSubmit', 'PreToolUse', 'Stop'],
  full: OPENPRD_EVENTS,
};
const OPENPRD_DEFAULT_HOOK_PROFILE = 'lite';
const OPENPRD_HOOK_EVENTS_WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse']);
const OPENPRD_LITE_WRITE_TOOL_MATCHER = '^(Bash|Read|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
const OPENPRD_GUARDED_WRITE_TOOL_MATCHER = '^(Bash|Read|Glob|Grep|LS|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
const OPENPRD_HARNESS_DIR = cjoin('.openprd', 'harness');
const OPENPRD_HARNESS_EVENTS = cjoin(OPENPRD_HARNESS_DIR, 'events.jsonl');
const OPENPRD_HARNESS_HOOK_STATE = cjoin(OPENPRD_HARNESS_DIR, 'hook-state.json');
const OPENPRD_HARNESS_MANIFEST = cjoin(OPENPRD_HARNESS_DIR, 'install-manifest.json');
const OPENPRD_HARNESS_RUNTIME_ENVIRONMENT = cjoin(OPENPRD_HARNESS_DIR, 'runtime-environment.json');
const OPENPRD_HARNESS_DRIFT = cjoin(OPENPRD_HARNESS_DIR, 'drift-report.json');
const LEGACY_CODEX_HOOK_OUTPUT_FIELDS = ['should_stop', 'additional_contexts', 'should_block', 'block_reason'];
const OPENPRD_GENERATED_MARKER = 'OPENPRD:GENERATED';
const OPTIONAL_CAPABILITY_REGISTRY = [
  {
    id: 'context7',
    name: 'Context7',
    summary: '帮助 Agent 获取最新的第三方技术文档、配置、版本差异、迁移路径和高质量实现信息。',
    recommendedFor: '涉及第三方库、框架、API、SDK、MCP、CLI 的最新用法、配置或迁移时尤其有帮助。',
    docsUrl: 'https://context7.com/docs/resources/all-clients',
    repoUrl: 'https://github.com/upstash/context7',
    serverUrl: 'https://mcp.context7.com/mcp',
    patterns: ['mcp.context7.com/mcp', 'context7'],
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    summary: '帮助 Agent 用对话方式理解 GitHub 公开仓库的架构、关键模块、关键流程和实现线索。',
    recommendedFor: '需要理解公开 GitHub 仓库整体结构、跨模块设计或关键流程时尤其有帮助。',
    docsUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    repoUrl: 'https://github.com/CognitionAI/deepwiki',
    serverUrl: 'https://mcp.deepwiki.com/mcp',
    patterns: ['mcp.deepwiki.com/mcp', 'deepwiki'],
  },
];

const RUNTIME_DETECTION_PROTOCOL = {
  version: 1,
  activeEvidencePriority: [
    {
      id: 'hook-session-payload',
      confidence: 'high',
      summary: '当前客户端 hook 直接传入的 session、turn、agent_type、cwd、model、tool_name 等字段。',
      fields: ['session_id', 'sessionId', 'turn_id', 'turnId', 'agent_type', 'agentType', 'transcript_path', 'transcriptPath', 'cwd', 'hook_event_name', 'tool_name'],
    },
    {
      id: 'explicit-launcher',
      confidence: 'high',
      summary: 'OpenPrd 或上层 launcher 明确传入的 agent/client 参数。',
      fields: ['OPENPRD_AGENT', 'OPENPRD_CLIENT', 'OPENPRD_ACTIVE_CLIENT'],
    },
    {
      id: 'sdk-or-headless-session',
      confidence: 'medium-high',
      summary: 'SDK、headless runner 或子会话 registry 返回的结构化 agent/session 信息。',
      fields: ['sessionId', 'threadId', 'agentType', 'client'],
    },
    {
      id: 'child-process-env',
      confidence: 'medium',
      summary: '子进程环境变量只能证明当前命令运行环境，不能单独证明顶层对话客户端。',
      fields: ['CODEX_HOME', 'CLAUDE_PROJECT_DIR', 'CLAUDE_CODE_CHILD_SESSION', 'CURSOR_TRACE_ID'],
    },
    {
      id: 'config-or-cli-probe',
      confidence: 'low-medium',
      summary: '项目或用户配置、CLI 是否存在，只能说明能力可配置或可执行，不能说明当前对话是谁。',
      fields: ['.codex/config.toml', '.claude', '.cursor', 'codex --version'],
    },
    {
      id: 'agent-self-report',
      confidence: 'advisory',
      summary: 'Agent 自述只作兜底提示，不能覆盖 hook/session 证据。',
      fields: ['assistant-response'],
    },
  ],
  outputFields: ['activeClient', 'surface', 'executionMode', 'confidence', 'sessionId', 'turnId', 'agentType', 'model', 'evidence', 'observedCapabilities'],
  confidenceRules: [
    '优先相信当前会话 hook/session payload；env 和配置探针只能作为补充证据。',
    'executionMode=automation/cron/scheduled/headless/unattended 时默认进入 automation-safe mode：不阻断写入，不要求 dev-check / doctor；只有明确 OpenPrd 维护任务或显式启用 OpenPrd 时才恢复 OpenPrd 工作流。',
    'Codex 的 Image 2、Computer Use、browser window 等属于 surface-dependent 能力，不要仅凭 codex CLI 或项目配置推断已可用。',
    'Claude Code、Cursor 等平台同理：先识别当前对话客户端，再按该客户端的 capability pack 激活工具路径。',
  ],
};

const PLATFORM_CAPABILITY_PACK_REGISTRY = [
  {
    id: 'codex',
    name: 'Codex 能力包',
    client: 'codex',
    activation: 'activeClient=codex，且能力有 hook/session、manifest 或当前工具面证据时启用。',
    surfaces: ['codex-hook', 'codex-desktop', 'codex-cli', 'codex-exec', 'codex-unknown'],
    capabilities: [
      {
        id: 'codex-hooks',
        name: 'Codex hook 上下文与门禁',
        status: 'installed-when-tool-enabled',
        evidence: ['.codex/hooks.json', '.codex/config.toml', '.codex/hooks/openprd-hook.mjs'],
      },
      {
        id: 'native-image-generation',
        name: 'Codex 原生 Image 2 / imagegen',
        status: 'surface-dependent',
        evidence: ['tool-surface:imagegen', 'tool-surface:image_gen'],
        note: '只在当前 Codex surface 明确提供 imagegen/image_gen 时启用；不要从 Codex CLI 存在反推。',
      },
      {
        id: 'computer-use',
        name: 'Codex Computer Use / Codex-owned browser window',
        status: 'surface-dependent',
        evidence: ['tool-surface:computer-use', 'tool-surface:chrome', 'tool-surface:browser'],
      },
      {
        id: 'conversation-canvas',
        name: 'OpenPrd 对话协同画布',
        status: 'available-through-openprd-canvas',
        evidence: ['openprd canvas . --thread <id> --thread-title <name>', 'openprd canvas . --open --open-target codex-browser', '.openprd/harness/canvas-sessions/<session-key>/'],
        note: '画布状态按 thread/session ID 绑定，thread-title/session-title 只用于当前对话展示和 daemon 透传；Codex Image 2 生成物可通过本地 canvas service 同步到选中卡片；选区发送会保存 handoff 记录并复制提示。没有当前会话证据时显式传 --thread 或 --session，并在知道标题时附带 --thread-title 或 --session-title；需要打开到 Codex 右侧 Browser 时显式传 --open-target codex-browser 并由 Codex Agent 使用 Browser 工具导航，不让 shell open 误弹系统浏览器。Codex Agent 侧已验证的最小打开路径是 Browser plugin + node_repl：setupBrowserRuntime -> agent.browsers.get("iab") -> visibility.set(true) -> browser.tabs.new() -> tab.goto(url)。',
      },
      {
        id: 'codex-current-thread-relay',
        name: 'Codex 当前线程桥接',
        status: 'surface-dependent-agent-tool',
        evidence: ['codex app-server turn/start', '.openprd/harness/canvas-sessions/<session-key>/relays/*.status.json', 'tool-surface:codex_app.send_message_to_thread', 'openprd canvas . --bridge-outbox --claim next', '.openprd/harness/canvas-sessions/<session-key>/ops.json:type=agent-foreground-relay'],
        note: '只在 Codex App 当前 thread binding 明确时启用；画布 handoff 默认由本机 Codex app-server 走 thread/resume -> turn/start，把 text + localImage 提交到绑定线程，并在 relays/ 留 payload/status/log。自动投递关闭、明确失败或长时间未启动时，才写入 agent-foreground-relay 队列，当前 Codex Agent 领取后调用 codex_app.send_message_to_thread 兜底发送，并用 --bridge-sent/--bridge-failed 回写。OpenPrd 不提供自己的生图 API，AI 生图仍由 Codex 原生 Image 2/imagegen 完成。',
      },
      {
        id: 'codex-runtime-health',
        name: 'Codex CLI runtime 健康检查与显式修复',
        status: 'available-through-openprd-doctor',
        evidence: ['openprd doctor . --tools codex'],
      },
    ],
  },
  {
    id: 'claude-code',
    name: 'Claude Code 能力包',
    client: 'claude',
    activation: 'activeClient=claude，且 Claude Code hook/SDK/session evidence 匹配时启用。',
    surfaces: ['claude-code-hook', 'claude-code-interactive', 'claude-code-headless', 'claude-code-sdk', 'claude-code-unknown'],
    capabilities: [
      {
        id: 'claude-code-hooks',
        name: 'Claude Code hooks 与 agent_type / agent_id 识别',
        status: 'installed-when-tool-enabled',
        evidence: ['.claude/skills', '.mcp.json', 'hook.agent_type', 'hook.agent_id'],
      },
      {
        id: 'claude-code-child-session',
        name: 'Claude Code 子会话识别',
        status: 'env-or-sdk-evidence',
        evidence: ['CLAUDE_CODE_CHILD_SESSION', 'SDK session result'],
      },
      {
        id: 'image-generation-preference',
        name: '生图偏好路由（无内置免费生图）',
        status: 'user-preference-required',
        evidence: ['.openprd/harness/image-generation-preference.json'],
        note: 'Claude Code 当前没有对话内免费生图工具。生图请求先读 image-generation-preference.json 的用户已确认偏好；没有偏好时必须先问用户选哪种生图方式并把答复写回该文件，绝不擅自调用用户本地或自有付费生图 API。',
      },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor 能力包',
    client: 'cursor',
    activation: 'activeClient=cursor，且 Cursor rule/config 或上层 launcher 明确指向 Cursor 时启用。',
    surfaces: ['cursor-rules', 'cursor-agent', 'cursor-unknown'],
    capabilities: [
      {
        id: 'cursor-rules',
        name: 'Cursor rules / commands 引导',
        status: 'installed-when-tool-enabled',
        evidence: ['.cursor/rules/openprd.mdc', '.cursor/commands'],
      },
      {
        id: 'cursor-mcp',
        name: 'Cursor MCP 配置增强',
        status: 'optional',
        evidence: ['.cursor/mcp.json'],
      },
      {
        id: 'native-image-generation',
        name: 'Cursor 内置 GenerateImage 生图工具',
        status: 'surface-dependent',
        evidence: ['tool-surface:GenerateImage', 'tool-surface:generate_image'],
        note: '只在当前 Cursor 对话面提供 GenerateImage 工具时启用；它是 Cursor 对话内免费能力，生图请求默认优先使用，不要改走用户本地付费 API。',
      },
    ],
  },
];

const IMAGE_GENERATION_ROUTING = {
  version: 1,
  order: ['surface-builtin', 'user-preference', 'ask-user'],
  surfaceBuiltins: {
    codex: 'imagegen (Codex 原生 Image 2)',
    cursor: 'GenerateImage (Cursor 内置生图工具)',
    claude: null,
  },
  preferencePath: '.openprd/harness/image-generation-preference.json',
  preferenceSchema: {
    provider: '用户指定的生图方式，例如 imagegen / GenerateImage / 某个 MCP 工具名',
    source: 'user-confirmed',
    updatedAt: 'ISO timestamp',
  },
  rules: [
    '第一层先判断当前对话工具面：Codex 用原生 imagegen（Image 2），Cursor 用内置 GenerateImage；两者都是工具内免费能力，默认优先使用。',
    '当前工具面没有内置免费生图时，读 preferencePath 里用户已确认的偏好作为默认。',
    '没有已确认偏好时必须先询问用户选哪种生图方式，并把答复以 user-confirmed 来源写回 preferencePath，下次直接默认使用。',
    '绝不在用户未明确指定的情况下调用用户本地或自有付费生图 API，避免产生额外成本。',
  ],
};


function cjoin(...parts) {
  return path.join(...parts);
}

function exists(filePath) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await readText(filePath));
}

async function writeText(filePath, text, options = {}) {
  await safeWriteText(filePath, text, options);
}

async function writeJson(filePath, value, options = {}) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

async function appendJsonl(filePath, value, options = {}) {
  await safeAppendText(filePath, `${JSON.stringify(value)}\n`, options);
}

async function packageVersion() {
  const pkg = await readJson(cjoin(PACKAGE_ROOT, 'package.json')).catch(() => ({}));
  return String(pkg.version ?? '0.0.0');
}

function checksum(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

async function fileChecksum(filePath) {
  const text = await readText(filePath);
  return checksum(text);
}

function normalizedRelativePath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function harnessPath(projectRoot, relativePath) {
  return cjoin(projectRoot, relativePath);
}

function recordManagedFile(options, record) {
  if (!Array.isArray(options.managedFiles)) {
    return;
  }
  options.managedFiles.push(record);
}

function normalizeTools(value) {
  const raw = String(value ?? 'all').trim().toLowerCase();
  if (!raw || raw === 'all' || raw === 'auto') {
    return OPENPRD_AGENT_TOOLS;
  }
  const tools = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = tools.filter((tool) => !OPENPRD_AGENT_TOOLS.includes(tool));
  if (invalid.length > 0) {
    throw new Error(`Unsupported OpenPrd agent tool(s): ${invalid.join(', ')}`);
  }
  return [...new Set(tools)];
}

function normalizeHookProfile(value) {
  const profile = String(value ?? OPENPRD_DEFAULT_HOOK_PROFILE).trim().toLowerCase() || OPENPRD_DEFAULT_HOOK_PROFILE;
  if (!Object.prototype.hasOwnProperty.call(OPENPRD_HOOK_PROFILES, profile)) {
    throw new Error(`Unsupported OpenPrd hook profile: ${profile}. Use lite, guarded, or full.`);
  }
  return profile;
}

function hookEventsForProfile(profile) {
  return OPENPRD_HOOK_PROFILES[normalizeHookProfile(profile)];
}

function codexHookMatcher(eventName, hookProfile) {
  if (!OPENPRD_HOOK_EVENTS_WITH_MATCHER.has(eventName)) return null;
  const profile = normalizeHookProfile(hookProfile);
  if (profile === 'lite' && eventName === 'PreToolUse') {
    return OPENPRD_LITE_WRITE_TOOL_MATCHER;
  }
  if (profile === 'guarded' && eventName === 'PreToolUse') {
    return OPENPRD_GUARDED_WRITE_TOOL_MATCHER;
  }
  return '*';
}

function resolveCodexHome(options = {}) {
  return options.codexHome
    ?? process.env.OPENPRD_CODEX_HOME
    ?? process.env.CODEX_HOME
    ?? cjoin(os.homedir(), '.codex');
}

function resolveCursorHome(options = {}) {
  return options.cursorHome
    ?? process.env.OPENPRD_CURSOR_HOME
    ?? process.env.CURSOR_HOME
    ?? cjoin(os.homedir(), '.cursor');
}

function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, filePath)}` : filePath;
}

function managedBlock(id, body) {
  return [
    `<!-- OPENPRD:${id}:START -->`,
    body.trimEnd(),
    `<!-- OPENPRD:${id}:END -->`,
    '',
  ].join('\n');
}

function upsertManagedBlock(text, id, body) {
  const start = `<!-- OPENPRD:${id}:START -->`;
  const end = `<!-- OPENPRD:${id}:END -->`;
  const block = managedBlock(id, body);
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  if (!String(text || '').trim()) {
    return block;
  }
  return `${text.trimEnd()}\n\n${block}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function generatedMarker({ adapter, source, version, body, commentStyle = 'html' }) {
  const lines = [
    'OPENPRD:GENERATED',
    `adapter=${adapter}`,
    `source=${source}`,
    `version=${version}`,
    `checksum=${checksum(body)}`,
  ];
  if (commentStyle === 'js') {
    return `/* ${lines.join('\n')}\n*/`;
  }
  if (commentStyle === 'json') {
    return lines.join('\n');
  }
  return [
    '<!-- OPENPRD:GENERATED',
    `adapter=${adapter}`,
    `source=${source}`,
    `version=${version}`,
    `checksum=${checksum(body)}`,
    '-->',
  ].join('\n');
}

function renderGeneratedFile(params) {
  const marker = generatedMarker(params);
  const body = params.body.trimEnd();
  if (params.commentStyle === 'json') {
    const parsed = JSON.parse(body);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`OpenPrd JSON generated files require an object root: ${params.source}`);
    }
    return `${JSON.stringify({ ...parsed, $comment: marker }, null, 2)}\n`;
  }
  if (params.commentStyle === 'js') {
    return `${marker}\n\n${body}\n`;
  }
  if (body.startsWith('---\n')) {
    const frontmatterEnd = body.indexOf('\n---\n', 4);
    if (frontmatterEnd >= 0) {
      const closeEnd = frontmatterEnd + '\n---\n'.length;
      return `${body.slice(0, closeEnd)}\n${marker}\n${body.slice(closeEnd)}\n`;
    }
  }
  return `${marker}\n\n${body}\n`;
}

async function writeGeneratedFile(filePath, params, options, changes) {
  const body = renderGeneratedFile(params);
  const rel = normalizedRelativePath(options.projectRoot, filePath);
  const current = await readText(filePath).catch(() => null);
  if (current && !current.includes(OPENPRD_GENERATED_MARKER) && !options.force) {
    changes.push({
      path: rel,
      status: 'skipped-user-file',
      reason: 'missing-generated-marker',
      message: 'Existing file has no OPENPRD:GENERATED marker; preserved as a user file.',
      repairHint: `Review ${rel}; run openprd update . --force to replace it with the canonical OpenPrd generated file if appropriate.`,
    });
    return;
  }
  await writeText(filePath, body, options);
  changes.push({ path: rel, status: current ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'generated-file',
    adapter: params.adapter,
    source: params.source,
    bodyChecksum: checksum(params.body),
    fileChecksum: checksum(body),
  });
}

async function upsertTextBlockFile(filePath, id, blockBody, options, changes) {
  const rel = normalizedRelativePath(options.projectRoot, filePath);
  const current = await readText(filePath).catch(() => '');
  const next = upsertManagedBlock(current || '', id, blockBody);
  await writeText(filePath, next, options);
  changes.push({ path: rel, status: current ? 'updated-block' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'managed-block',
    marker: `OPENPRD:${id}`,
    bodyChecksum: checksum(blockBody),
  });
}

async function writeProjectCommandCatalog(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.openprd', 'harness', 'command-catalog.md'),
    { adapter: 'project', source: 'command-catalog', version, body: renderCommandCatalog() },
    options,
    changes,
  );
}

function agentContractBody() {
  const lines = [
    '## OpenPrd Harness',
    '',
    '本项目由 OpenPrd 管理。Agent 应优先遵循 repo-local skills 和 hooks；`AGENTS.md` 只保留轻量入口合同。',
    '',
    '### Scope',
    '',
    '- skill 路由放在 `openprd-router`，命令清单放在 command catalog，强约束放在 hooks。',
    '- `AGENTS.md` 只说明入口、默认行为和高风险门禁，不再承载静态长清单。',
    '',
    '### Entry Points',
    '',
    '- 先读 `skills/openprd-router/SKILL.md`；在生成的 Codex / Claude 环境里，优先读同名 `openprd-router` skill。',
    '- 需要具体命令时，优先读 `.openprd/harness/command-catalog.md`，不要继续把命令清单膨胀回 `AGENTS.md`。',
    '- `$openprd-shared`：共用语言、文档影响、敏感信息、浏览器安全、小程序验证、产品文案与 i18n 规则。',
    '- `$openprd-requirement-intake`：需求入口分流、用户可见需求类型与内部 L0/L1/L2 路由码对照、PRD 场景视角选择，以及创业验证闭环。',
    '- `$openprd-test-strategy`：测试策略分流、分层验证、任务级 evidence-plan、升级原因与豁免理由。',
    '- `$openprd-audio-evidence`：真实音频、音轨、声学质量、ASR/语音识别/转写与语音派生字幕时间轴的修改前基线和最终媒体复测；纯字幕文案、翻译和 UI 样式不自动触发。',
    '- `$openprd-harness`：主工作流、`run/loop`、review/change/tasks 与执行节奏。',
    '- `$openprd-frontend-design`：前端设计框架、审美资产库、设计主题/骨架/组件/配方/模板，以及事实、素材、图片和方向前置门。',
    '- `$openprd-benchmark-router`：外部技术、公开 GitHub 仓库、benchmark/对标/最佳实践路由。',
    '- `$openprd-standards` / `$openprd-quality`：`docs/basic/`、就绪验证、EVO 门禁、知识沉淀。',
    '- `$openprd-diagram-review` / `$openprd-discovery-loop`：可视评审与长时间只读挖掘。',
    '- 当前对话环境与平台能力包：优先看 `.openprd/harness/runtime-environment.json`，协议和能力清单看 `.openprd/harness/install-manifest.json` 的 `runtimeDetection` / `platformCapabilityPacks`。',
    '',
    '### 默认行为',
    '',
    '1. 动手前先判断 executionMode。无人值守自动化（Codex automation、Claude Code headless、cron、scheduled、unattended task）默认不阻断写入，不要求 `openprd dev-check` / `doctor`；除非 automation prompt 明确写明“这是 OpenPrd 维护任务”“显式启用 OpenPrd / enable OpenPrd / openprd-maintenance”。',
    '1a. Agent 自己管理当前会话上下文；OpenPrd 只记录工作区事实、Hook 证据和验证结果。',
    '1b. OpenPrd 只通过提示词注入审查界面判断原则和质量合同，不生成任务专属 HTML。Agent 在任务进入、关键证据形成、实现验证完成和高影响后续动作前主动判断审查边界；本轮交付含只有用户或负责人能完成的选择、批准或纠错时，最终交付本身就是人类审查节点，“直接分析”或 L0/L1/L2 不构成豁免。只要存在人类审查节点，并出现 8 个及以上需逐项展示依据/冲突/未知/决策的可比较对象、多个对象的可逆逐项审批、多媒体上下文审查、用于高影响动作的复杂测试或发布矩阵，或必须导航/筛选/长期阅读的结构化交付物，除非用户明确不要 HTML、用户或宿主明确禁止新增文件，或已有同等任务专属审查界面，否则 Agent 必须自行设计、制作并验证任务专属 HTML，Markdown/CSV 不能替代。命中后若没有可点击的 `.html` 绝对路径与验证说明，或仍有 starter/无来源占位内容，不得标记该审查节点完成。未命中强制条件时仍按审查成本判断；简单事实或只会把聊天换皮的结果不要强行 HTML 化。',
    '1c. 代码搜索默认从当前任务相关源码、测试和 change/task 文件起步；不要把历史 `.openprd/quality/reports/`、`.openprd/harness/` 或 `.openprd/learning/` 当源码目录做 repo-wide `rg`。旧 eval 报告只作为历史记录保留，不再参与默认验证。',
    '2. 规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求保持只读；只有用户明确要求实现、继续任务、深度调研、对标复刻或提交时才进入执行。',
    '3. 先分流再执行：`openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本判断需求类型，并保留内部路由码对照：直接处理=L0，现有功能优化=L1，新功能/新流程方案=L2。用户审查默认把路由码并进“需求类型：直接处理（L0）”这类标签里；只有内部排障确实受益时，才额外附“内部路由码”。直接处理类需求可直接处理并事后说明，不打开正式 PRD/review/change/tasks；现有功能优化先在对话内给 mini-plan 再执行，默认不生成正式 PRD/change/tasks；新功能/新流程方案的 requirement、PRD、review、change 和 tasks 由 Agent 在后台维护，不阻断用户已经要求的实现。L2 的 requirement 摘要默认按“需求判断 / 需求理解 / 功能范围 / 技术方案”整理，其中“功能范围”和“技术方案”优先用 Markdown 表格；如果仍在 0 到 1 探索，再补验证与创业闭环。只有真实产品歧义会明显改变结果时才提一个必要问题。“请帮我实现/继续实现”表示有效执行意图；requirement、capture/classify/synthesize、review、change 和 tasks 由 Agent 在后台维护，不追加 OpenPrd 确认门禁。`review.html` 是稳定评审 artifact，不是授权门禁。',
    '3a. 已归档或既有的 requirement、PRD、review、change、tasks 与实现记录是冻结历史，不根据当前代码推断、补写或改写。旧功能重新进入需求流程时，为本轮创建新的 current requirement/change，并通过引用关联历史记录；`docs/basic/` 与代码说明书属于随实现维护的活文档，可在当前任务后台同步。',
    '3b. 0 到 1 探索的验证与创业闭环至少覆盖：第一批最容易触达的社区或种子用户、你为什么算这个社区里的自己人、当前替代方案与痛点证据、先怎么手工交付、手工作战卡怎么写、能否先用 spreadsheet / 表单 / no-code 跑起来、必须做产品时是否只自动化最重复的一步、第一版只做哪一件事、能否压成周末级 MVP、从第一个客户开始怎么收费、客户 1 如何打平成本、有没有 10 个样本和更强付费信号、达到什么条件才允许产品化、增长阶段守什么纪律、这条路是否可逆，以及是不是你愿意长期住进去的业务形态。',
    '4. change/tasks 就绪后，用 `openprd-test-strategy` 按风险选择单元、集成、端到端、人工、视觉、媒体、小程序、性能或安全验证组合，并在任务或报告中保留 evidence-plan；真实音频、声学质量、ASR/语音识别/转写和语音派生字幕时间轴额外读取 `openprd-audio-evidence`，从最终媒体重新提取并按修改前口径复测，纯字幕文案、翻译和 UI 样式不自动触发。同时根据任务边界记录 execution strategy：小范围修正保持 `serial`，中等规模 L1/L2 可推荐 `parallel-workers`，高风险或大规模实现再升级到 `parallel-workers-isolated`；70/20/10 只作健康形状参考，不作硬门禁。',
    '5. 纯图片、封面图、配图、海报、插画、图标、贴纸、mockup 或“先看样子”请求按生图路由选工具：先判断当前对话工具面，Codex 环境用原生 `imagegen`（Image 2），Cursor 环境用内置 `GenerateImage`；都不可用或无法判断时，先读 `.openprd/harness/image-generation-preference.json`，没有偏好再询问用户，绝不擅自调用用户本地或自有付费生图 API。生图前写清用途、受众、气质、约束和记忆点并做 anti-slop 自检。生图结果先当候选效果图，Agent 展示候选方向并说明采用的可逆默认方向；OpenPrd 不强制等待确认，用户明确选择时再覆盖默认方向并更新 reference-set。实现阶段按参考图形态使用 `visual-prepare` 与 `visual-compare`；没有参考图时，新界面完成 3 方向评审并采用可逆默认方向，既有界面做 before/after。用户反馈“不一致”“好丑”“复刻”时至少给出一份视觉证据图。学习型交付物需要章节、证据锚点或长期阅读体验时，优先用 `openprd learn .` 生成学习包和阅读器。',
    '5a. 对 logo、icon、avatar、badge、贴纸、空态插画、单物件 UI 位图，先检查原始素材和消费组件/CSS，并在当前 task-scope 的 `asset-spec.md` 锁定 rendering-mode。`transparent-cutout` 才走纯 `#00ff00` 绿幕、透明背景、透明四角和安全裁切；`opaque-full-bleed-tile` 必须 edge-to-edge 覆盖四边四角、四角不透明，并禁止图片内圆角卡片、白边或透明角。两种模式验证不可混用。UI 容器圆角、边框、阴影默认不烘焙进源位图；参考截图不能单独裁决像素合同。',
    '5b. 卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，仍可按 L0/L1 小范围修正推进，不自动升级成大界面 3 方向方案评审；但它是用户可见变化，动手前要有一句审美意图和记忆点，收口必须补 `visual-compare` 修改前后图、局部焦点证据板、截图实测证据板、对齐辅助线证据板或内部居中证据板，并检查气质、层级、颜色、字号、间距和表面角色是否成立。只要界面里有同构列表、卡片、网格或表格，就把容器轨道以及标题、副标题、描述、标签、状态、价格、按钮、图标、操作区等相同文案类型/相同组件槽位的对齐当作默认验收项，不等用户先投诉；只量外框、列宽或行顶不算完整对齐验收。只要任务在判断单个素材/图标/头像/徽标/按钮图形的内部居中、偏心或视觉重心，就把 centering-board 当作默认验收项；单张原始截图或主观“看起来居中”不算完整居中验收。build、package、`openprd dev-check` 和单张原始截图不能替代视觉证据。`visual-compare` 每次都会返回 `chatEmbed` markdown；生成证据板后必须把这行 `![视觉证据: ...](路径)` 直接嵌入最终回复，让证据在对话流里可见，不要只报告文件路径；`openprd dev-check` 在触达界面文件且最近 24 小时没有证据板时也会输出视觉证据提醒，收口前按提醒补齐。',
    '5c. 大界面三方向是 Agent 的默认责任，不要求用户另行提出生图；轻量 UI 微调不触发。已有界面时，Codex 原生 App 用 Computer Use、Codex 网页环境用 Chrome 插件任务专用窗口、Cursor 用可用浏览器或项目预览能力截图；三个方向必须共享同一张当前截图作为 image-to-image 参考。除非用户明确要求换风格，否则锁定现有字体角色、色彩系统、明暗模式、表面语言、圆角/边框/阴影、图标语言、平台框架和信息密度，只探索布局、信息层级、导航、关键路径与空间构图。这里的圆角、边框和阴影默认只锁定 UI 消费容器；参考截图不能单独证明位图圆角来自 CSS 还是烘焙像素，头像和单物件必须回查原始素材或消费组件/CSS。冷启动没有现有界面时才使用 design brief，不伪造修改前截图。候选图先明确用途、目标用户、业务约束、核心动作、气质和唯一记忆点，并检查字体、色彩、空间、层级、表面/图标语言和动效含义；拒绝无依据蓝紫渐变、默认字体、等权白卡堆叠、过量大圆角、无语境装饰和只换颜色的伪方向。',
    '5d. 生图工具是工具路径，不是审美豁免；无品牌或参考依据时，用 anti-slop 排除默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰。logo、icon、avatar、badge 等默认按独立素材输出（standalone asset）。若期望产物是否需要章节结构、证据锚点、图文讲解或长期阅读体验，优先用 `openprd learn .`，不要用关键词表触发；“仙侠风格的学习材料”也按学习型交付物处理，风格作为 `--genre` 题材参数。',
    '6. 界面、页面、视觉、样式、信息架构或前端体验任务先读取 `$openprd-frontend-design`。先填写 `.openprd/design/active/task-scope.md`，顶层 active 合同只代表当前任务；历史子目录、旧截图和旧 selected-direction 仅在当前任务显式引用时采用，legacy 未命名内容不得静默成为风格默认。随后维护 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction`；空白工作区可从 `.openprd/design/templates/` 选择最近模板。主题和模块明确时用 `openprd design-starter . --starter <starter-id> --out index.html` 起真实首版并进入 advisory Patch Mode。',
    '6c. 页面主题和模块明确时，starter 命令补全 `--brief "<页面主题>" --sections "<模块1|模块2|模块3>"`。只有页面确实不依赖外部事实、品牌素材或真实图片时，才在 active design artifacts 写清无依赖并使用 `--no-external-facts --no-brand-assets --no-real-images`；旅游、导览、展览、博物馆、城市、自然观察或案例内容页先不要带 `--no-real-images`，让 starter 先尝试补首批真实图片。Patch Mode 即使结构要大改，也不要删除 `index.html` 后另起新稿；在原入口补丁修改或先完成 sibling draft 再覆盖。没有参考图时先判断新建界面还是修改既有界面，并让 visual evidence 同时检查气质、层级、字体/色彩/表面角色和记忆点。',
    '6a. 写产品界面上用户能看到的文案时，必须站在当前用户视角写：这句话要说明用户现在能做什么、会发生什么、为什么值得点、下一步怎么走。除非这是面向开发者或专业技术人员的技术型产品，否则默认用普通人能看懂的语言写结果、状态、限制和行动，不要暴露 API、SDK、模型、数据库、缓存、错误码或内部模块。正反例：不要写“适合想保留全部工具入口的用户”，改写成“首页会显示所有工具入口，你可以直接选择需要的功能”；不要写“API 请求失败，错误码 500”，改写成“暂时保存失败，请稍后再试”；技术型产品可以保留必要术语，但仍要写清用户动作、影响和修复路径。多语言文案不得逐字翻译：先识别控件类型、用户动作、上下文和可用空间，再按目标语言的软件产品习惯重写；英文按钮、Tab、菜单和短标签优先使用短而自然的惯用表达，例如“开始自动剪辑”写成 `Auto Edit`，不要写 `Start Automatic Editing`。只使用目标用户普遍理解且在当前语境中无歧义的常见缩写，不为了省空间发明行话或牺牲语义；必要的完整含义放到正文、Tooltip 或 Accessibility Label。完成后在真实控件中检查所有支持语言的语义、截断、异常换行、布局挤压和辅助功能名称。',
    '6b. 开发新功能出现新的入口、按钮、tab、卡片、空态或工具格时，默认自动配图标，不等用户提出：先复用项目已有图标体系；项目没有时按图标最佳实践路由选型（UI 图标 Phosphor，落码 Lucide/Tabler/React Icons，AI 品牌 LobeHub Icons，技术栈 Tech Icons，功能图标/插画 iconfont），把图标名、来源、用途登记到 `.openprd/design/active/asset-spec.md` 的“功能图标”行再接入。只有语义确实不需要图标或用户明确说不要时才跳过，并在收口说明原因。',
    '7. 用户给出会话 ID 并要求继续时，按工具无关的历史会话续接；不要要求工具专属 ID，也不要用当前 active change 或相似历史替代指定会话。',
      '8. 单个 task 收尾时只运行本任务最小足够验证，并通过 `--evidence`、测试报告或任务 metadata 留下 task-scoped evidence；代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>`。阶段收口、全部实现完成、handoff/commit/release/publish 前，运行 `openprd standards . --verify`、`openprd run . --verify` 和 `openprd doctor .`；`run --verify` 直接返回简短验证摘要，不再隐式生成 quality eval JSON/HTML。L2 或跨页面实现的最终回复列出 task-scoped Markdown/HTML 测试报告路径。',
    '9. 微信小程序相关任务默认按“最小足够验证”执行：只有用户明确要求小程序实测、截图、抓日志/网络、复现问题，或当前改动必须依赖运行态证据时，才升级到本地小程序运行态验证；默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动或重开时，才从头启动。如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具当成阻断。',
    '10. `openprd init/setup/update/doctor` 记录的 `optionalCapabilities` 是非阻断式增强建议。当前任务明显受益但能力还未配置时，可在后续建议里说明它能帮什么、附官方文档 / GitHub 链接，并询问用户是否需要按当前客户端补配置；不要因为它未配置就阻断当前任务。',
    '11. 判断当前用户正在和 Codex、Claude Code 还是 Cursor 对话时，先看 `.openprd/harness/runtime-environment.json` 的 hook/session evidence，再按 install manifest 里的 `platformCapabilityPacks` 启用平台专属能力。Codex 原生 Image 2、Computer Use、Codex-owned browser window、OpenPrd 对话协同画布和 Codex 当前线程桥接属于 surface-dependent 能力，只有当前工具面或 hook/session 证据明确支持时才使用；画布必须绑定当前 thread/session，无法自动识别时用 `openprd canvas . --thread <id> --thread-title <name>` 或 `--session <id> --session-title <name>` 显式隔离，标题只用于当前对话展示；当前线程桥接只在 Codex App 当前 thread binding 明确时使用，浏览器写入 handoff 后由 OpenPrd 服务端默认通过 Codex app-server `thread/resume -> turn/start` 提交到绑定线程，失败或关闭时才进入 `agent-foreground-relay` 兜底队列；不要仅凭 Codex CLI、`.codex/config.toml` 或 `CODEX_HOME` 推断可用。',
    '',
    '### Hook-Enforced Gates',
    '',
    '- automation-safe：识别到 Codex automation、Claude Code headless、cron、scheduled 或 unattended task 时，hook 默认不阻断写入、不要求 dev-check / doctor；只有 OpenPrd 维护任务或显式启用 OpenPrd 时才恢复这些检查。',
    '- requirement：requirement、PRD、review、change 和 tasks 是 Agent 后台维护材料，不阻断实现、不索取用户确认。',
    '- research：公开 GitHub 架构/对标优先 DeepWiki；第三方技术用法、配置、限制、版本差异或迁移先查本地证据，不足时按 `resolve_library_id -> query_docs` 使用 Context7。证据缺口只产生 `allowed-with-research-attention`，不阻断当前工作。',
    '- design：界面、页面、视觉和前端体验任务由 Agent 在后台维护 `$openprd-frontend-design` 与 `.openprd/design/active/` 合同；缺口只产生 `allowed-with-design-attention`。Patch Mode 同样是 advisory，不限制工具调用。',
    '- skill-visualization：修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，用彩色 Mermaid 说明方案；它是可视说明，不是用户授权门禁，用户已要求修改时可继续执行。',
    '- autonomy-risk：风险识别只向 Agent 提供配置化、迁移、标准状态机、幂等脚本和可回滚发布路径建议，不承担授权审批；OpenPrd 不因生产、支付、删除、账号切换、兜底、写死或材料缺失阻断工具调用，也不索取用户确认，是否需要确认由当前 Agent 依据宿主安全规则和真实上下文自行判断。',
    '- secrets / weapp / browser / copy：分别处理 `secrets-vault`、按需的小程序运行态验证、窗口归属与 i18n/普通用户文案提醒。',
    '- 需要细节时，读 router 指向的 skill 和 command catalog，而不是继续扩写 `AGENTS.md`。',
    '',
    '### High-Risk Gate',
    '',
    'For interactive OpenPrd flows, run task-scoped tests, `openprd standards . --verify`, `openprd run . --verify`, and `openprd doctor .` around freeze, handoff, commit, push, release, or publish when applicable. `run --verify` returns a compact verification summary and does not create quality eval JSON/HTML artifacts. These findings are readiness evidence and do not add an OpenPrd authorization stop; host safety rules, real permissions, and user scope remain authoritative.',
    'The only baseline documentation path is `docs/basic/`.',
    '',
  ];
  return lines.join('\n');
}

function parseSkillSourceMarkdown(text) {
  const raw = String(text ?? '').trimEnd();
  if (!raw.startsWith('---\n')) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatterEnd = raw.indexOf('\n---\n', 4);
  if (frontmatterEnd < 0) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatterText = raw.slice(4, frontmatterEnd).trim();
  const body = raw.slice(frontmatterEnd + '\n---\n'.length).trimStart();
  const frontmatter = {};
  for (const line of frontmatterText.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = match[2].trim();
    }
  }
  return { frontmatter, body };
}

async function loadSourceSkill(skill) {
  if (!skill.sourceSkill) {
    return { description: skill.description, body: skill.body };
  }
  const sourcePath = cjoin(PACKAGE_ROOT, 'skills', skill.sourceSkill, 'SKILL.md');
  const parsed = parseSkillSourceMarkdown(await readText(sourcePath));
  return {
    description: skill.description ?? parsed.frontmatter.description,
    body: parsed.body,
  };
}

async function renderSkill(skill, projectRoot) {
  const source = await loadSourceSkill(skill);
  const sections = [
    '---',
    `name: ${skill.id}`,
    `description: ${source.description}`,
    '---',
    '',
    source.body,
  ];
  if (skill.id === 'openprd-benchmark-router' && projectRoot) {
    sections.push('', await renderApprovedBenchmarkRegistrySection(projectRoot).catch(() => ''));
  }
  return sections.join('\n');
}

async function listFilesRecursive(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const itemPath = cjoin(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(itemPath));
    } else if (entry.isFile()) {
      files.push(itemPath);
    }
  }
  return files;
}

async function writeSourceSkillReferences(projectRoot, skill, destinationDir, version, options, changes) {
  if (!skill.sourceSkill) {
    return;
  }
  const sourceDir = cjoin(PACKAGE_ROOT, 'skills', skill.sourceSkill, 'references');
  const files = await listFilesRecursive(sourceDir);
  for (const filePath of files) {
    const relative = path.relative(sourceDir, filePath).split(path.sep).join('/');
    const body = await readText(filePath);
    await writeGeneratedFile(
      cjoin(destinationDir, 'references', relative),
      {
        adapter: 'shared',
        source: `${skill.id}:reference:${relative}`,
        version,
        body,
        commentStyle: path.extname(relative).toLowerCase() === '.json' ? 'json' : 'html',
      },
      options,
      changes,
    );
  }
}

function renderCommand(command, adapter) {
  if (adapter === 'cursor') {
    return [
      `# ${command.title}`,
      '',
      command.body,
      '',
      'Always follow the OpenPrd managed rules in `.cursor/rules/openprd.mdc` and project `AGENTS.md`.',
      '',
    ].join('\n');
  }
  return [
    `# ${command.title}`,
    '',
    command.body,
    '',
    'For interactive OpenPrd work, rebuild state from `.openprd/` before acting. In unattended automation, skip OpenPrd context/gates unless the task explicitly opts into OpenPrd.',
    '',
  ].join('\n');
}

function renderCursorRule() {
  return [
    '---',
    'description: OpenPrd harness 规则',
    'globs:',
    '  - "**/*"',
    'alwaysApply: true',
    '---',
    '',
    '# OpenPrd Harness',
    '',
    agentContractBody(),
  ].join('\n');
}

function quoteForToml(value) {
  return JSON.stringify(value);
}

function resolveShellPlatform(options = {}) {
  return options.platform ?? process.platform;
}

function hookCommand(projectRoot, eventName, options = {}) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  return `node ${quoteShell(hookPath, options)} ${eventName}`;
}

function quoteShell(value, options = {}) {
  if (resolveShellPlatform(options) === 'win32') {
    return `"${String(value).replace(/"/g, '""')}"`;
  }
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function renderCodexHookRunner() {
  return readFileSync(cjoin(PACKAGE_ROOT, 'src', 'codex-hook-runner-template.mjs'), 'utf8').trimEnd();
}

function normalizeFeatureHooks(text) {
  const featureHeader = /^\[features\]\s*$/m;
  if (!featureHeader.test(text)) {
    const prefix = text.trimEnd();
    return `${prefix ? `${prefix}\n\n` : ''}[features]\nhooks = true\n`;
  }

  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '[features]');
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\[.+\]\s*$/.test(lines[index].trim())) {
      end = index;
      break;
    }
  }
  const normalized = [];
  let hasHooks = false;
  for (let index = start + 1; index < end; index += 1) {
    if (/^\s*(hooks|codex_hooks)\s*=/.test(lines[index])) {
      if (!hasHooks) {
        normalized.push('hooks = true');
        hasHooks = true;
      }
      continue;
    }
    normalized.push(lines[index]);
  }
  if (!hasHooks) {
    normalized.push('hooks = true');
  }
  lines.splice(start + 1, end - start - 1, ...normalized);
  return lines.join('\n');
}

function codexHooksTomlBlock(projectRoot, options = {}) {
  const events = hookEventsForProfile(options.hookProfile);
  const groups = [];
  for (const eventName of events) {
    groups.push(`[[hooks.${eventName}]]`);
    const matcher = codexHookMatcher(eventName, options.hookProfile);
    if (matcher) {
      groups.push(`matcher = ${quoteForToml(matcher)}`);
    }
    groups.push(`[[hooks.${eventName}.hooks]]`);
    groups.push('type = "command"');
    groups.push(`command = ${quoteForToml(hookCommand(projectRoot, eventName, options))}`);
    groups.push('timeout = 15000');
    groups.push('');
  }
  return groups.join('\n').trimEnd();
}

function upsertTomlManagedBlock(text, id, body) {
  const start = `# OPENPRD:${id}:START`;
  const end = `# OPENPRD:${id}:END`;
  const block = `${start}\n${body.trimEnd()}\n${end}\n`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`, 'm');
  if (pattern.test(text)) {
    return text.replace(pattern, block);
  }
  return `${text.trimEnd()}\n\n${block}`;
}

async function writeCodexConfig(projectRoot, options, changes) {
  const configPath = cjoin(projectRoot, '.codex', 'config.toml');
  const rel = normalizedRelativePath(projectRoot, configPath);
  const current = await readText(configPath).catch(() => '');
  let next = normalizeFeatureHooks(current || '');
  next = upsertTomlManagedBlock(next, 'CODEX-HOOKS', codexHooksTomlBlock(projectRoot, options));
  await writeText(configPath, next, options);
  changes.push({ path: rel, status: current ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'codex-config',
    marker: 'OPENPRD:CODEX-HOOKS',
  });
}

async function writeCodexUserConfig(options, changes) {
  const configPath = cjoin(resolveCodexHome(options), 'config.toml');
  const current = await readText(configPath).catch(() => '');
  const next = normalizeFeatureHooks(current || '');
  if (next !== current) {
    await writeText(configPath, next, options);
  }
  changes.push({
    path: displayPath(configPath),
    status: current ? (next === current ? 'unchanged' : 'updated') : 'created',
  });
  recordManagedFile(options, {
    path: displayPath(configPath),
    scope: 'user',
    kind: 'codex-user-config',
    marker: 'hooks = true',
  });
}

function codexHookGroup(projectRoot, eventName, options = {}) {
  const group = {
    hooks: [
      {
        type: 'command',
        command: hookCommand(projectRoot, eventName, options),
        timeout: 30000,
      },
    ],
  };
  const matcher = codexHookMatcher(eventName, options.hookProfile);
  if (matcher) {
    group.matcher = matcher;
  }
  return group;
}

function isOpenPrdHookGroup(group) {
  return JSON.stringify(group ?? {}).includes('openprd-hook.mjs');
}

async function writeCodexHooksJson(projectRoot, options, changes) {
  const hooksPath = cjoin(projectRoot, '.codex', 'hooks.json');
  const rel = normalizedRelativePath(projectRoot, hooksPath);
  const existed = await exists(hooksPath);
  const current = existed ? await readJson(hooksPath).catch(() => ({})) : {};
  const next = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const activeEvents = new Set(hookEventsForProfile(options.hookProfile));
  for (const eventName of OPENPRD_EVENTS) {
    const existing = Array.isArray(next[eventName]) ? next[eventName] : [];
    const kept = existing.filter((group) => !isOpenPrdHookGroup(group));
    if (activeEvents.has(eventName)) {
      next[eventName] = [
        ...kept,
        codexHookGroup(projectRoot, eventName, options),
      ];
    } else if (kept.length > 0) {
      next[eventName] = kept;
    } else {
      delete next[eventName];
    }
  }
  await writeJson(hooksPath, next, options);
  changes.push({ path: rel, status: existed ? 'updated' : 'created' });
  recordManagedFile(options, {
    path: rel,
    scope: 'project',
    kind: 'codex-hooks-json',
    marker: 'openprd-hook.mjs',
  });
}

async function writeCodexAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  for (const skill of CANONICAL_SKILLS) {
    const body = await renderSkill(skill, projectRoot);
    const skillDir = cjoin(projectRoot, '.codex', 'skills', skill.id);
    await writeGeneratedFile(
      cjoin(skillDir, 'SKILL.md'),
      { adapter: 'shared', source: skill.id, version, body },
      options,
      changes,
    );
    await writeSourceSkillReferences(projectRoot, skill, skillDir, version, options, changes);
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.codex', 'prompts', `openprd-${command.id}.md`),
      { adapter: 'codex', source: `command:${command.id}`, version, body: renderCommand(command, 'codex') },
      options,
      changes,
    );
  }
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  await writeGeneratedFile(
    hookPath,
    { adapter: 'codex', source: 'codex-hooks', version, body: renderCodexHookRunner(), commentStyle: 'js' },
    { ...options, force: true },
    changes,
  );
  await fs.chmod(hookPath, 0o755).catch(() => {});
  await writeCodexConfig(projectRoot, options, changes);
  await writeCodexHooksJson(projectRoot, options, changes);
  if (options.enableUserCodexConfig) {
    await writeCodexUserConfig(options, changes);
  }
}

async function writeClaudeAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await upsertTextBlockFile(cjoin(projectRoot, 'CLAUDE.md'), 'CLAUDE', agentContractBody(), options, changes);
  for (const skill of CANONICAL_SKILLS) {
    const body = await renderSkill(skill, projectRoot);
    const skillDir = cjoin(projectRoot, '.claude', 'skills', skill.id);
    await writeGeneratedFile(
      cjoin(skillDir, 'SKILL.md'),
      { adapter: 'shared', source: skill.id, version, body },
      options,
      changes,
    );
    await writeSourceSkillReferences(projectRoot, skill, skillDir, version, options, changes);
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.claude', 'commands', 'openprd', `${command.id}.md`),
      { adapter: 'claude', source: `command:${command.id}`, version, body: renderCommand(command, 'claude') },
      options,
      changes,
    );
  }
}

async function writeCursorAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.cursor', 'rules', 'openprd.mdc'),
    { adapter: 'cursor', source: 'cursor-rules', version, body: renderCursorRule() },
    options,
    changes,
  );
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.cursor', 'commands', `openprd-${command.id}.md`),
      { adapter: 'cursor', source: `command:${command.id}`, version, body: renderCommand(command, 'cursor') },
      options,
      changes,
    );
  }
}

async function ensureHarnessState(projectRoot, options = {}) {
  await safeEnsureDirectory(harnessPath(projectRoot, OPENPRD_HARNESS_DIR), options);
  const hookStatePath = harnessPath(projectRoot, OPENPRD_HARNESS_HOOK_STATE);
  if (!(await exists(hookStatePath))) {
    await writeJson(hookStatePath, {
      version: 1,
      active: true,
      lastEventAt: null,
      lastFingerprint: null,
      counters: {},
      suppressions: {
        inputLock: false,
      },
    }, options);
  }
  const eventsPath = harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS);
  if (!(await exists(eventsPath))) {
    await writeText(eventsPath, '', options);
  }
  const runtimeEnvironmentPath = harnessPath(projectRoot, OPENPRD_HARNESS_RUNTIME_ENVIRONMENT);
  if (!(await exists(runtimeEnvironmentPath))) {
    await writeJson(runtimeEnvironmentPath, {
      version: 1,
      active: {
        activeClient: 'unknown',
        surface: 'unknown',
        executionMode: 'interactive',
        confidence: 0,
        sessionId: null,
        turnId: null,
        agentType: null,
        model: null,
        evidence: [],
        observedCapabilities: [],
      },
      runtimeDetection: RUNTIME_DETECTION_PROTOCOL,
      platformCapabilityPacks: [],
      updatedAt: null,
    }, options);
  }
}

function optionalCapabilityLocations(projectRoot, tools, options = {}) {
  const locations = [];
  if (tools.includes('codex')) {
    const projectPath = cjoin(projectRoot, '.codex', 'config.toml');
    const userPath = cjoin(resolveCodexHome(options), 'config.toml');
    locations.push(
      { client: 'codex', scope: 'project', absolutePath: projectPath, path: normalizedRelativePath(projectRoot, projectPath) },
      { client: 'codex', scope: 'user', absolutePath: userPath, path: displayPath(userPath) },
    );
  }
  if (tools.includes('cursor')) {
    const projectPath = cjoin(projectRoot, '.cursor', 'mcp.json');
    const userPath = cjoin(resolveCursorHome(options), 'mcp.json');
    locations.push(
      { client: 'cursor', scope: 'project', absolutePath: projectPath, path: normalizedRelativePath(projectRoot, projectPath) },
      { client: 'cursor', scope: 'user', absolutePath: userPath, path: displayPath(userPath) },
    );
  }
  if (tools.includes('claude')) {
    const projectPath = cjoin(projectRoot, '.mcp.json');
    locations.push({ client: 'claude', scope: 'project', absolutePath: projectPath, path: normalizedRelativePath(projectRoot, projectPath) });
  }
  return locations;
}

async function collectOptionalCapabilities(projectRoot, tools, options = {}) {
  const locations = optionalCapabilityLocations(projectRoot, tools, options);
  return Promise.all(OPTIONAL_CAPABILITY_REGISTRY.map(async (capability) => {
    const patterns = capability.patterns.map((pattern) => pattern.toLowerCase());
    const checkedLocations = [];
    const configuredLocations = [];
    for (const location of locations) {
      const locationExists = await exists(location.absolutePath);
      let matched = false;
      if (locationExists) {
        const raw = await readText(location.absolutePath).catch(() => '');
        const normalized = raw.toLowerCase();
        matched = patterns.some((pattern) => normalized.includes(pattern));
      }
      const entry = {
        client: location.client,
        scope: location.scope,
        path: location.path,
        exists: locationExists,
        matched,
      };
      checkedLocations.push(entry);
      if (matched) {
        configuredLocations.push({
          client: location.client,
          scope: location.scope,
          path: location.path,
        });
      }
    }
    return {
      id: capability.id,
      name: capability.name,
      status: configuredLocations.length > 0 ? 'configured' : 'recommended',
      configured: configuredLocations.length > 0,
      summary: capability.summary,
      recommendedFor: capability.recommendedFor,
      docsUrl: capability.docsUrl,
      repoUrl: capability.repoUrl,
      serverUrl: capability.serverUrl,
      configuredLocations,
      checkedLocations,
    };
  }));
}

function configuredOptionalCapabilityIds(optionalCapabilities) {
  return (Array.isArray(optionalCapabilities) ? optionalCapabilities : [])
    .filter((capability) => capability.configured)
    .map((capability) => capability.id);
}

function capabilityGapsForEnvelope(envelope) {
  return Object.entries(envelope?.capabilities ?? {})
    .filter(([, status]) => typeof status === 'string' && status !== CAPABILITY_STATUS.NATIVE)
    .map(([capability, status]) => ({
      capability,
      status,
      requirement: status === CAPABILITY_STATUS.SURFACE_DEPENDENT
        ? 'current-surface-evidence'
        : 'adapter-or-platform-support',
    }));
}

function buildAdapterProtocol(tools) {
  const clients = normalizeTools(tools).map((client) => {
    const capabilityEnvelope = describeCapabilities(client);
    return {
      client,
      contractVersion: ADAPTER_CONTRACT_VERSION,
      capabilitySchema: capabilityEnvelope.schema,
      lifecycleEventSchema: 'openprd.adapter-event.v1',
      capabilityEnvelope,
      capabilityGaps: capabilityGapsForEnvelope(capabilityEnvelope),
    };
  });
  return {
    schema: 'openprd.adapter-protocol.v1',
    protocolVersion: ADAPTER_CONTRACT_VERSION,
    capabilityVersion: ADAPTER_CONTRACT_VERSION,
    lifecycleEventVersion: ADAPTER_CONTRACT_VERSION,
    contractDigest: adapterContractDigest(),
    generatedContent: {
      version: 1,
      sharedSkillMarker: 'shared',
      sharedSkillConsumers: clients
        .map((entry) => entry.client)
        .filter((client) => client === 'codex' || client === 'claude'),
      platformSpecificKinds: ['command', 'hook', 'rule', 'config'],
    },
    clients,
  };
}

function buildPlatformCapabilityPacks(tools, optionalCapabilities = []) {
  const toolSet = new Set(normalizeTools(tools));
  const configuredOptional = configuredOptionalCapabilityIds(optionalCapabilities);
  return PLATFORM_CAPABILITY_PACK_REGISTRY
    .filter((pack) => toolSet.has(pack.client))
    .map((pack) => {
      const capabilityEnvelope = describeCapabilities(pack.client);
      return {
        ...pack,
        adapterContractVersion: ADAPTER_CONTRACT_VERSION,
        capabilityEnvelope,
        capabilityGaps: capabilityGapsForEnvelope(capabilityEnvelope),
        capabilities: pack.capabilities.map((capability) => ({ ...capability })),
        optionalEnhancements: configuredOptional,
      };
    });
}

function installSafetyManifest(projectRoot, options = {}) {
  const events = Array.isArray(options.installSafetyEvents) ? options.installSafetyEvents : [];
  const eventPath = (filePath) => {
    const relative = normalizedRelativePath(projectRoot, filePath);
    return relative === '..' || relative.startsWith('../') ? displayPath(filePath) : relative;
  };
  return {
    protocolVersion: INSTALL_SAFETY_PROTOCOL_VERSION,
    symlinkStrategy: normalizeSymlinkStrategy(options.symlinkStrategy),
    materializationCount: events.length,
    materializations: events.map((event) => ({
      strategy: event.strategy,
      path: eventPath(event.symlinkPath),
      linkTarget: event.linkTarget,
      backupPath: displayPath(event.backupPath),
      materializedType: event.materializedType,
      at: event.at,
    })),
  };
}

async function writeInstallManifest(projectRoot, options, changes, tools, optionalCapabilities) {
  const version = await packageVersion();
  const managedFiles = Array.isArray(options.managedFiles) ? options.managedFiles : [];
  const hookProfile = normalizeHookProfile(options.hookProfile);
  const manifest = {
    version: 1,
    openprdVersion: version,
    action: options.action ?? 'setup',
    generatedAt: timestamp(),
    tools,
    managedFiles,
    hooks: {
      profile: hookProfile,
      events: hookEventsForProfile(hookProfile),
      availableProfiles: Object.keys(OPENPRD_HOOK_PROFILES),
      state: OPENPRD_HARNESS_HOOK_STATE,
      eventsLog: OPENPRD_HARNESS_EVENTS,
      runtimeEnvironment: OPENPRD_HARNESS_RUNTIME_ENVIRONMENT,
      driftReport: OPENPRD_HARNESS_DRIFT,
    },
    adapterProtocol: buildAdapterProtocol(tools),
    runtimeDetection: RUNTIME_DETECTION_PROTOCOL,
    platformCapabilityPacks: buildPlatformCapabilityPacks(tools, optionalCapabilities),
    imageGenerationRouting: IMAGE_GENERATION_ROUTING,
    installSafety: installSafetyManifest(projectRoot, options),
    optionalCapabilities,
  };
  const manifestPath = harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST);
  const existed = await exists(manifestPath);
  await writeJson(manifestPath, manifest, options);
  const runtimeEnvironmentPath = harnessPath(projectRoot, OPENPRD_HARNESS_RUNTIME_ENVIRONMENT);
  const runtimeEnvironment = await readJson(runtimeEnvironmentPath).catch(() => null);
  await writeJson(runtimeEnvironmentPath, {
    version: 1,
    ...(runtimeEnvironment ?? {}),
    adapterProtocol: manifest.adapterProtocol,
    runtimeDetection: RUNTIME_DETECTION_PROTOCOL,
    platformCapabilityPacks: manifest.platformCapabilityPacks,
    imageGenerationRouting: IMAGE_GENERATION_ROUTING,
  }, options);
  const configuredCount = optionalCapabilities.filter((capability) => capability.configured).length;
  changes.push({ path: OPENPRD_HARNESS_MANIFEST, status: existed ? 'updated' : 'created' });
  await appendJsonl(harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS), {
    at: manifest.generatedAt,
    event: 'agent-integration-installed',
    action: manifest.action,
    tools,
    hookProfile,
    managedFileCount: managedFiles.length,
    platformCapabilityPackCount: manifest.platformCapabilityPacks.length,
    optionalCapabilityConfiguredCount: configuredCount,
    optionalCapabilityRecommendedCount: optionalCapabilities.length - configuredCount,
    adapterContractVersion: manifest.adapterProtocol.protocolVersion,
    adapterContractDigest: manifest.adapterProtocol.contractDigest,
    symlinkStrategy: manifest.installSafety.symlinkStrategy,
    materializationCount: manifest.installSafety.materializationCount,
  }, options);
  return manifest;
}

async function readInstallManifest(projectRoot) {
  return readJson(harnessPath(projectRoot, OPENPRD_HARNESS_MANIFEST)).catch(() => null);
}

async function readRuntimeEnvironment(projectRoot) {
  return readJson(harnessPath(projectRoot, OPENPRD_HARNESS_RUNTIME_ENVIRONMENT)).catch(() => null);
}

async function inspectManagedFile(projectRoot, entry) {
  if (!entry || entry.scope === 'user') {
    return { ...entry, ok: true, skipped: true, reason: 'external-user-scope' };
  }
  const absolutePath = cjoin(projectRoot, entry.path);
  const fileExists = await exists(absolutePath);
  if (!fileExists) {
    return { ...entry, ok: false, reason: 'missing' };
  }
  const text = await readText(absolutePath);
  if (entry.marker && !text.includes(entry.marker)) {
    return { ...entry, ok: false, reason: 'missing-marker' };
  }
  if (entry.fileChecksum && checksum(text) !== entry.fileChecksum) {
    return { ...entry, ok: false, reason: 'checksum-drift' };
  }
  return { ...entry, ok: true, reason: 'ok' };
}

async function computeDriftReport(projectRoot, tools, options = {}) {
  const manifest = await readInstallManifest(projectRoot);
  const checks = [];
  if (!manifest) {
    const report = {
      ok: false,
      checkedAt: timestamp(),
      tools,
      errors: [`${OPENPRD_HARNESS_MANIFEST} is missing. Run openprd update .`],
      checks,
    };
    await writeJson(harnessPath(projectRoot, OPENPRD_HARNESS_DRIFT), report, options);
    return report;
  }
  for (const entry of manifest.managedFiles ?? []) {
    checks.push(await inspectManagedFile(projectRoot, entry));
  }
  const errors = checks
    .filter((check) => !check.ok)
    .map((check) => `${check.path}: ${check.reason}`);
  const report = {
    ok: errors.length === 0,
    checkedAt: timestamp(),
    tools,
    manifestVersion: manifest.version,
    generatedAt: manifest.generatedAt,
    errors,
    checks,
  };
  await writeJson(harnessPath(projectRoot, OPENPRD_HARNESS_DRIFT), report, options);
  return report;
}

export async function setupOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const hookProfile = normalizeHookProfile(options.hookProfile);
  const changes = [];
  const managedFiles = [];
  const installSafetyEvents = [];
  const managedWriteRoots = [projectRoot];
  if (options.enableUserCodexConfig) {
    managedWriteRoots.push(resolveCodexHome(options));
  }
  const normalizedOptions = {
    ...options,
    projectRoot,
    hookProfile,
    managedFiles,
    installSafetyEvents,
    managedWriteRoots,
    symlinkStrategy: normalizeSymlinkStrategy(options.symlinkStrategy),
  };

  await ensureHarnessState(projectRoot, normalizedOptions);
  await writeProjectCommandCatalog(projectRoot, normalizedOptions, changes);
  await upsertTextBlockFile(cjoin(projectRoot, 'AGENTS.md'), 'AGENTS', agentContractBody(), normalizedOptions, changes);

  if (tools.includes('codex')) {
    await writeCodexAdapter(projectRoot, normalizedOptions, changes);
  }
  if (tools.includes('claude')) {
    await writeClaudeAdapter(projectRoot, normalizedOptions, changes);
  }
  if (tools.includes('cursor')) {
    await writeCursorAdapter(projectRoot, normalizedOptions, changes);
  }
  const optionalCapabilities = await collectOptionalCapabilities(projectRoot, tools, normalizedOptions);
  const manifest = await writeInstallManifest(projectRoot, normalizedOptions, changes, tools, optionalCapabilities);
  const registry = await upsertWorkspaceRegistryEntry(projectRoot, {
    openprdHome: options.openprdHome,
    manifest,
    action: options.action ?? 'setup',
    tools,
    hookProfile,
    recordedAt: manifest.generatedAt,
  });
  await appendJsonl(harnessPath(projectRoot, OPENPRD_HARNESS_EVENTS), {
    at: registry.entry.lastRegisteredAt,
    event: 'workspace-registry-updated',
    registryPath: registry.registryPath,
    status: registry.status,
    knownTotal: registry.knownTotal,
  }, normalizedOptions);

  const doctor = await doctorOpenPrdAgentIntegration(projectRoot, {
    tools,
    enableUserCodexConfig: Boolean(options.enableUserCodexConfig),
    codexHome: options.codexHome,
    hookProfile,
  });
  return {
    ok: doctor.ok,
    action: options.action ?? 'setup',
    projectRoot,
    tools,
    hookProfile,
    changes,
    manifest,
    registry,
    optionalCapabilities: doctor.optionalCapabilities ?? optionalCapabilities,
    doctor,
  };
}

export async function updateOpenPrdAgentIntegration(projectRoot, options = {}) {
  return setupOpenPrdAgentIntegration(projectRoot, { ...options, action: 'update' });
}

async function fileHas(filePath, pattern) {
  const text = await readText(filePath).catch(() => '');
  return text.includes(pattern);
}

async function collectDoctorCheck(projectRoot, checks, pathName, predicate, message) {
  const absolutePath = cjoin(projectRoot, pathName);
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, reason: ok ? 'ok' : 'check-failed', message: ok ? 'ok' : message });
}

async function collectDoctorCheckAbsolute(checks, pathName, absolutePath, predicate, message) {
  const ok = await predicate(absolutePath);
  checks.push({ path: pathName, ok, reason: ok ? 'ok' : 'check-failed', message: ok ? 'ok' : message });
}

async function collectGeneratedDoctorCheck(projectRoot, checks, pathName, description) {
  const absolutePath = cjoin(projectRoot, pathName);
  if (!(await exists(absolutePath))) {
    checks.push({
      path: pathName,
      ok: false,
      kind: 'generated-file',
      reason: 'missing-file',
      message: `${description} is missing.`,
      repairHint: 'Run openprd update . to regenerate missing OpenPrd guidance.',
    });
    return;
  }

  const text = await readText(absolutePath);
  if (!text.includes(OPENPRD_GENERATED_MARKER)) {
    checks.push({
      path: pathName,
      ok: false,
      kind: 'generated-file',
      reason: 'missing-generated-marker',
      message: `${description} exists but is not recognized as an OpenPrd generated file because it lacks OPENPRD:GENERATED.`,
      repairHint: 'Review the local file; if it should be managed by OpenPrd, run openprd update . --force to regenerate it.',
    });
    return;
  }

  checks.push({ path: pathName, ok: true, kind: 'generated-file', reason: 'ok', message: 'ok' });
}

function codexHookSmokePayload(projectRoot, eventName, smokeId) {
  if (eventName === 'SessionStart') {
    return { cwd: projectRoot, session_id: smokeId };
  }
  if (eventName === 'UserPromptSubmit') {
    return { cwd: projectRoot, prompt: `OpenPrd doctor hook smoke ${smokeId}` };
  }
  if (eventName === 'PreToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.openprd/state/current.json',
      },
    };
  }
  if (eventName === 'PostToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.openprd/state/current.json',
      },
      tool_response: {},
    };
  }
  return { cwd: projectRoot };
}

function validateCodexHookSmokeOutput(eventName, run) {
  if (run.error) {
    return `Codex hook smoke failed for ${eventName}: ${run.error.message}`;
  }
  if (run.status !== 0) {
    return `Codex hook smoke failed for ${eventName}: exit ${run.status}; ${String(run.stderr ?? '').trim() || 'no stderr'}`;
  }

  let output;
  try {
    output = JSON.parse(String(run.stdout ?? '').trim());
  } catch (error) {
    return `Codex hook smoke emitted invalid JSON for ${eventName}: ${error.message}`;
  }

  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return `Codex hook smoke emitted a non-object payload for ${eventName}.`;
  }

  const legacyFields = LEGACY_CODEX_HOOK_OUTPUT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(output, field));
  if (legacyFields.length > 0) {
    return `Codex hook smoke emitted legacy fields for ${eventName}: ${legacyFields.join(', ')}`;
  }

  if (output.continue !== true) {
    return `Codex hook smoke omitted continue=true for ${eventName}.`;
  }

  if (output.hookSpecificOutput !== undefined) {
    if (!output.hookSpecificOutput || typeof output.hookSpecificOutput !== 'object' || Array.isArray(output.hookSpecificOutput)) {
      return `Codex hook smoke emitted invalid hookSpecificOutput for ${eventName}.`;
    }
    if (output.hookSpecificOutput.hookEventName !== eventName) {
      return `Codex hook smoke emitted hookSpecificOutput.hookEventName=${output.hookSpecificOutput.hookEventName ?? 'null'} for ${eventName}.`;
    }
  }

  return null;
}

async function smokeTestCodexHook(projectRoot, options = {}) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'openprd-hook.mjs');
  if (!(await exists(hookPath))) {
    return { ok: false, message: 'Codex hook runner is missing.' };
  }

  const smokeId = `doctor-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openprd-hook-smoke-'));
  try {
    for (const eventName of hookEventsForProfile(options.hookProfile)) {
      const run = spawnSync(process.execPath, [hookPath, eventName], {
        cwd: smokeRoot,
        input: JSON.stringify(codexHookSmokePayload(smokeRoot, eventName, smokeId)),
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          OPENPRD_CLI: process.env.OPENPRD_CLI || cjoin(PACKAGE_ROOT, 'bin', 'openprd.js'),
        },
      });
      const error = validateCodexHookSmokeOutput(eventName, run);
      if (error) {
        return { ok: false, message: error };
      }
    }

    return { ok: true, message: 'ok' };
  } finally {
    await fs.rm(smokeRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export async function doctorOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const checks = [];
  const managedWriteRoots = [projectRoot];
  if (options.enableUserCodexConfig) {
    managedWriteRoots.push(resolveCodexHome(options));
  }
  const safetyOptions = {
    ...options,
    projectRoot,
    managedWriteRoots,
  };
  await ensureHarnessState(projectRoot, safetyOptions);
  const manifest = await readInstallManifest(projectRoot);
  const hookProfile = normalizeHookProfile(options.hookProfile ?? manifest?.hooks?.profile);
  const optionalCapabilities = await collectOptionalCapabilities(projectRoot, tools, options);
  const platformCapabilityPacks = manifest?.platformCapabilityPacks ?? buildPlatformCapabilityPacks(tools, optionalCapabilities);
  const runtimeEnvironment = await readRuntimeEnvironment(projectRoot);

  await collectDoctorCheck(projectRoot, checks, 'AGENTS.md', (file) => fileHas(file, 'OPENPRD:AGENTS:START'), 'Missing OpenPrd managed AGENTS block.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_MANIFEST, (file) => fileHas(file, '"managedFiles"'), 'Missing OpenPrd install manifest.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_HOOK_STATE, (file) => fileHas(file, '"version"'), 'Missing OpenPrd hook state.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_RUNTIME_ENVIRONMENT, (file) => fileHas(file, '"runtimeDetection"'), 'Missing OpenPrd runtime environment state.');
  await collectDoctorCheck(projectRoot, checks, OPENPRD_HARNESS_EVENTS, (file) => exists(file), 'Missing OpenPrd harness events log.');
  await collectGeneratedDoctorCheck(projectRoot, checks, '.openprd/harness/command-catalog.md', 'OpenPrd command catalog');
  const ignoreStatus = await readOperationalGitignoreStatus(projectRoot);
  checks.push({
    path: ignoreStatus.path,
    ok: ignoreStatus.ok,
    kind: 'search-isolation',
    reason: ignoreStatus.ok ? 'ok' : 'missing-openprd-generated-artifact-ignores',
    message: ignoreStatus.ok
      ? 'ok'
      : `Missing OpenPrd generated artifact ignores: ${ignoreStatus.missing.join(', ')}`,
    repairHint: ignoreStatus.ok ? undefined : 'Run openprd update . to add search and VCS isolation for generated reports.',
  });

  if (tools.includes('codex')) {
    await collectDoctorCheck(projectRoot, checks, '.codex/config.toml', (file) => fileHas(file, '[[hooks.UserPromptSubmit]]') && fileHas(file, '[[hooks.PreToolUse]]'), 'Codex config is missing OpenPrd hook definitions.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks.json', (file) => fileHas(file, 'openprd-hook.mjs'), 'Codex hooks.json is missing OpenPrd hooks.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks/openprd-hook.mjs', (file) => fileHas(file, 'recordRunHook'), 'Codex hook runner is missing.');
    const smoke = await smokeTestCodexHook(projectRoot, { hookProfile });
    checks.push({ path: '.codex/hooks/openprd-hook.mjs:smoke', ok: smoke.ok, message: smoke.message });
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-router/SKILL.md', 'Codex OpenPrd router skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-requirement-intake/SKILL.md', 'Codex OpenPrd requirement intake skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-frontend-design/SKILL.md', 'Codex OpenPrd frontend design skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-test-strategy/SKILL.md', 'Codex OpenPrd test strategy skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-audio-evidence/SKILL.md', 'Codex OpenPrd audio evidence skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-harness/SKILL.md', 'Codex OpenPrd harness skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.codex/skills/openprd-learning-review/SKILL.md', 'Codex OpenPrd learning review skill');
    if (options.enableUserCodexConfig) {
      const userConfigPath = cjoin(resolveCodexHome(options), 'config.toml');
      if (await exists(userConfigPath)) {
        await collectDoctorCheckAbsolute(checks, displayPath(userConfigPath), userConfigPath, async (file) => {
          const hasHooks = await fileHas(file, 'hooks = true');
          const hasLegacyHooks = await fileHas(file, 'codex_hooks = true');
          return hasHooks && !hasLegacyHooks;
        }, 'User Codex config hook feature flags are not normalized.');
      }
    }
  }
  if (tools.includes('claude')) {
    await collectDoctorCheck(projectRoot, checks, 'CLAUDE.md', (file) => fileHas(file, 'OPENPRD:CLAUDE:START'), 'Missing OpenPrd managed CLAUDE block.');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-router/SKILL.md', 'Claude OpenPrd router skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-requirement-intake/SKILL.md', 'Claude OpenPrd requirement intake skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-frontend-design/SKILL.md', 'Claude OpenPrd frontend design skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-test-strategy/SKILL.md', 'Claude OpenPrd test strategy skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-audio-evidence/SKILL.md', 'Claude OpenPrd audio evidence skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-harness/SKILL.md', 'Claude OpenPrd harness skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/skills/openprd-learning-review/SKILL.md', 'Claude OpenPrd learning review skill');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.claude/commands/openprd/next.md', 'Claude OpenPrd next command');
  }
  if (tools.includes('cursor')) {
    await collectGeneratedDoctorCheck(projectRoot, checks, '.cursor/rules/openprd.mdc', 'Cursor OpenPrd rule');
    await collectGeneratedDoctorCheck(projectRoot, checks, '.cursor/commands/openprd-next.md', 'Cursor OpenPrd next command');
  }
  const drift = await computeDriftReport(projectRoot, tools, safetyOptions);
  for (const error of drift.errors) {
    checks.push({ path: OPENPRD_HARNESS_DRIFT, ok: false, message: error });
  }

  return {
    ok: checks.every((check) => check.ok),
    action: 'doctor',
    projectRoot,
    tools,
    hookProfile,
    checks,
    drift,
    runtimeDetection: manifest?.runtimeDetection ?? RUNTIME_DETECTION_PROTOCOL,
    runtimeEnvironment,
    platformCapabilityPacks,
    optionalCapabilities,
    errors: checks.filter((check) => !check.ok).map((check) => (
      `${check.path}: ${check.message}${check.repairHint ? ` ${check.repairHint}` : ''}`
    )),
  };
}
