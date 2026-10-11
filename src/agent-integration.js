import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CANONICAL_COMMANDS, CANONICAL_SKILLS, renderCommandCatalog } from './agent-canonical-content.js';
import { buildCapabilityCatalog, loadProjectCapabilityCatalog } from './capability-catalog.js';
import { skillPresentation, installedSkillPath, renderSkillInterface } from './skill-presentation.js';
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
const OPEN_VIBECODING_AGENT_TOOLS = ['codex', 'claude', 'cursor'];
const OPEN_VIBECODING_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const OPEN_VIBECODING_HOOK_PROFILES = {
  lite: ['UserPromptSubmit', 'PreToolUse', 'Stop'],
  guarded: ['UserPromptSubmit', 'PreToolUse', 'Stop'],
  full: OPEN_VIBECODING_EVENTS,
};
const OPEN_VIBECODING_DEFAULT_HOOK_PROFILE = 'lite';
const OPEN_VIBECODING_HOOK_EVENTS_WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse']);
const OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER = '^(Bash|Read|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
const OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER = '^(Bash|Read|Glob|Grep|LS|Write|Edit|MultiEdit|apply_patch|WebSearch|web_search)$';
const OPEN_VIBECODING_HARNESS_DIR = cjoin('.open-vibecoding', 'harness');
const OPEN_VIBECODING_HARNESS_EVENTS = cjoin(OPEN_VIBECODING_HARNESS_DIR, 'events.jsonl');
const OPEN_VIBECODING_HARNESS_HOOK_STATE = cjoin(OPEN_VIBECODING_HARNESS_DIR, 'hook-state.json');
const OPEN_VIBECODING_HARNESS_MANIFEST = cjoin(OPEN_VIBECODING_HARNESS_DIR, 'install-manifest.json');
const OPEN_VIBECODING_HARNESS_RUNTIME_ENVIRONMENT = cjoin(OPEN_VIBECODING_HARNESS_DIR, 'runtime-environment.json');
const OPEN_VIBECODING_HARNESS_DRIFT = cjoin(OPEN_VIBECODING_HARNESS_DIR, 'drift-report.json');
const LEGACY_CODEX_HOOK_OUTPUT_FIELDS = ['should_stop', 'additional_contexts', 'should_block', 'block_reason'];
const OPEN_VIBECODING_GENERATED_MARKER = 'OPEN_VIBECODING:GENERATED';
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
      summary: 'Open VibeCoding 或上层 launcher 明确传入的 agent/client 参数。',
      fields: ['OPEN_VIBECODING_AGENT', 'OPEN_VIBECODING_CLIENT', 'OPEN_VIBECODING_ACTIVE_CLIENT'],
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
    'executionMode=automation/cron/scheduled/headless/unattended 时默认进入 automation-safe mode：不阻断写入，不要求 dev-check / doctor；只有明确 Open VibeCoding 维护任务或显式启用 Open VibeCoding 时才恢复 Open VibeCoding 工作流。',
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
        evidence: ['.codex/hooks.json', '.codex/config.toml', '.codex/hooks/open-vibecoding-hook.mjs'],
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
        name: 'Open VibeCoding 对话协同画布',
        status: 'available-through-open-vibecoding-canvas',
        evidence: ['open-vibecoding canvas . --thread <id> --thread-title <name>', 'open-vibecoding canvas . --open --open-target codex-browser', '.open-vibecoding/harness/canvas-sessions/<session-key>/'],
        note: '画布状态按 thread/session ID 绑定，thread-title/session-title 只用于当前对话展示和 daemon 透传；Codex Image 2 生成物可通过本地 canvas service 同步到选中卡片；选区发送会保存 handoff 记录并复制提示。没有当前会话证据时显式传 --thread 或 --session，并在知道标题时附带 --thread-title 或 --session-title；需要打开到 Codex 右侧 Browser 时显式传 --open-target codex-browser 并由 Codex Agent 使用 Browser 工具导航，不让 shell open 误弹系统浏览器。Codex Agent 侧已验证的最小打开路径是 Browser plugin + node_repl：setupBrowserRuntime -> agent.browsers.get("iab") -> visibility.set(true) -> browser.tabs.new() -> tab.goto(url)。',
      },
      {
        id: 'codex-current-thread-relay',
        name: 'Codex 当前线程桥接',
        status: 'surface-dependent-agent-tool',
        evidence: ['codex app-server turn/start', '.open-vibecoding/harness/canvas-sessions/<session-key>/relays/*.status.json', 'tool-surface:codex_app.send_message_to_thread', 'open-vibecoding canvas . --bridge-outbox --claim next', '.open-vibecoding/harness/canvas-sessions/<session-key>/ops.json:type=agent-foreground-relay'],
        note: '只在 Codex App 当前 thread binding 明确时启用；画布 handoff 默认由本机 Codex app-server 走 thread/resume -> turn/start，把 text + localImage 提交到绑定线程，并在 relays/ 留 payload/status/log。自动投递关闭、明确失败或长时间未启动时，才写入 agent-foreground-relay 队列，当前 Codex Agent 领取后调用 codex_app.send_message_to_thread 兜底发送，并用 --bridge-sent/--bridge-failed 回写。Open VibeCoding 不提供自己的生图 API，AI 生图仍由 Codex 原生 Image 2/imagegen 完成。',
      },
      {
        id: 'codex-runtime-health',
        name: 'Codex CLI runtime 健康检查与显式修复',
        status: 'available-through-open-vibecoding-doctor',
        evidence: ['open-vibecoding doctor . --tools codex'],
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
        evidence: ['.open-vibecoding/harness/image-generation-preference.json'],
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
        evidence: ['.cursor/rules/open-vibecoding.mdc', '.cursor/commands'],
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
  preferencePath: '.open-vibecoding/harness/image-generation-preference.json',
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
    return OPEN_VIBECODING_AGENT_TOOLS;
  }
  const tools = raw.split(',').map((item) => item.trim()).filter(Boolean);
  const invalid = tools.filter((tool) => !OPEN_VIBECODING_AGENT_TOOLS.includes(tool));
  if (invalid.length > 0) {
    throw new Error(`Unsupported Open VibeCoding agent tool(s): ${invalid.join(', ')}`);
  }
  return [...new Set(tools)];
}

function normalizeHookProfile(value) {
  const profile = String(value ?? OPEN_VIBECODING_DEFAULT_HOOK_PROFILE).trim().toLowerCase() || OPEN_VIBECODING_DEFAULT_HOOK_PROFILE;
  if (!Object.prototype.hasOwnProperty.call(OPEN_VIBECODING_HOOK_PROFILES, profile)) {
    throw new Error(`Unsupported Open VibeCoding hook profile: ${profile}. Use lite, guarded, or full.`);
  }
  return profile;
}

function hookEventsForProfile(profile) {
  return OPEN_VIBECODING_HOOK_PROFILES[normalizeHookProfile(profile)];
}

function codexHookMatcher(eventName, hookProfile) {
  if (!OPEN_VIBECODING_HOOK_EVENTS_WITH_MATCHER.has(eventName)) return null;
  const profile = normalizeHookProfile(hookProfile);
  if (profile === 'lite' && eventName === 'PreToolUse') {
    return OPEN_VIBECODING_LITE_WRITE_TOOL_MATCHER;
  }
  if (profile === 'guarded' && eventName === 'PreToolUse') {
    return OPEN_VIBECODING_GUARDED_WRITE_TOOL_MATCHER;
  }
  return '*';
}

function resolveCodexHome(options = {}) {
  return options.codexHome
    ?? process.env.OPEN_VIBECODING_CODEX_HOME
    ?? process.env.CODEX_HOME
    ?? cjoin(os.homedir(), '.codex');
}

function resolveCursorHome(options = {}) {
  return options.cursorHome
    ?? process.env.OPEN_VIBECODING_CURSOR_HOME
    ?? process.env.CURSOR_HOME
    ?? cjoin(os.homedir(), '.cursor');
}

function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(`${home}${path.sep}`) ? `~/${path.relative(home, filePath)}` : filePath;
}

function managedBlock(id, body) {
  return [
    `<!-- OPEN_VIBECODING:${id}:START -->`,
    body.trimEnd(),
    `<!-- OPEN_VIBECODING:${id}:END -->`,
    '',
  ].join('\n');
}

function upsertManagedBlock(text, id, body) {
  const start = `<!-- OPEN_VIBECODING:${id}:START -->`;
  const end = `<!-- OPEN_VIBECODING:${id}:END -->`;
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
    'OPEN_VIBECODING:GENERATED',
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
    '<!-- OPEN_VIBECODING:GENERATED',
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
  if (params.commentStyle === 'yaml') {
    return `# ${OPEN_VIBECODING_GENERATED_MARKER}\n# source=${params.source}\n# checksum=${checksum(params.body)}\n${body}\n`;
  }
  if (params.commentStyle === 'json') {
    const parsed = JSON.parse(body);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error(`Open VibeCoding JSON generated files require an object root: ${params.source}`);
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
  if (current && !current.includes(OPEN_VIBECODING_GENERATED_MARKER) && !options.force) {
    changes.push({
      path: rel,
      status: 'skipped-user-file',
      reason: 'missing-generated-marker',
      message: 'Existing file has no OPEN_VIBECODING:GENERATED marker; preserved as a user file.',
      repairHint: `Review ${rel}; run open-vibecoding update . --force to replace it with the canonical Open VibeCoding generated file if appropriate.`,
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
    marker: `OPEN_VIBECODING:${id}`,
    bodyChecksum: checksum(blockBody),
  });
}

async function writeProjectCommandCatalog(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.open-vibecoding', 'harness', 'command-catalog.md'),
    { adapter: 'project', source: 'command-catalog', version, body: renderCommandCatalog() },
    options,
    changes,
  );
}

function agentContractBody(tools = OPEN_VIBECODING_AGENT_TOOLS) {
  const entries = [];
  if (tools.includes('codex')) entries.push(`Codex：\`${installedSkillPath('open-vibecoding-router')}\``);
  if (tools.includes('claude')) entries.push('Claude：`.claude/skills/open-vibecoding-router/SKILL.md`');
  if (tools.includes('cursor')) entries.push(`Cursor：读取当前工具的路由源文件 \`${cjoin(PACKAGE_ROOT, 'skills', 'open-vibecoding-router', 'SKILL.md')}\``);
  return [
    '## Open VibeCoding',
    '',
    '用户直接描述任务。Agent 自主理解、拆解、执行和验证；Open VibeCoding 只按场景提供能力和非阻断提醒，不规定固定流程。',
    '',
    '### 场景入口',
    '',
    `- 按当前客户端读取项目内入口：${entries.join('；')}。路径相对于本文件所在项目，不相对于终端当前目录。具体 CLI 查本项目的 \`.open-vibecoding/harness/command-catalog.md\`。`,
    '- 开始任务或目标改变时，按用户目标判断相关场景，读取所选子能力后落实其中适用的方法。已有上下文足够时复用；不要求重复读文件。需要时用一句业务语言说明采用的方法，交付说明实际验证与缺口。',
    `- 当前安装的 CLI：\`node "${cjoin(PACKAGE_ROOT, 'bin', 'open-vibecoding.js')}"\`；未安装全局命令时使用此入口，不调用旧版命令。`,
    '- 产品、交互、研发、测试和工具增强各有独立场景 Skill；按用户意图和现有证据选择，不用固定关键词匹配。场景目录见 `open-vibecoding capabilities list`。',
    '- 研发复杂度提醒用 `$open-vibecoding-requirement-intake`，验证策略用 `$open-vibecoding-test-strategy`；需要外部事实时用 `$open-vibecoding-benchmark-router`。',
    `- 故障修复或性能优化主动检查复发时的诊断盲区；方法见内部能力 \`${tools.includes('codex') ? installedSkillPath('open-vibecoding-diagnostic-readiness') : tools.includes('claude') ? installedSkillPath('open-vibecoding-diagnostic-readiness', 'claude') : cjoin(PACKAGE_ROOT, 'skills', 'open-vibecoding-diagnostic-readiness', 'SKILL.md')}\`。现有证据够用则复用，不机械加日志；测试读回验证，不自动开启长期监控。`,
    '- 音频与语音证据用 `$open-vibecoding-audio-evidence`；图标主动获取与统一风格用 `$open-vibecoding-icon-system`。两者归属增强能力，按需由研发、交互与测试复用。',
    '- 横向最佳实践用 `$open-vibecoding-best-practices` 按项目条件选择；iOS 多语言用 `$open-vibecoding-ios-localization`，资源格式与调用 API 分别判断兼容性。',
    '- `$open-vibecoding-shared` 提供安全、语言、浏览器、小程序与文案规则；`$open-vibecoding-harness` 提供按需工具说明。',
    '',
    '### 默认行为',
    '',
    '- 规划、诊断、评审请求保持只读；明确实现或继续时在用户范围内推进。真实歧义会改变结果时才询问。',
    '- 不要求生成 requirement、PRD、review.html、change 或 tasks；不在后台补写这些材料。Agent 按自身方式拆解复杂任务，不交出规划权。',
    '- 代码是默认实现说明。仅当用户要文档、现有说明因改动失真，或跨系统合同确需说明时写文档。',
    '- 视觉参照和实现截图、风险验证结果、外部动作读回等不可从代码可靠重建的证据按需保留；普通任务不为留痕生成文件。',
    '- 既有 `.open-vibecoding/` 历史资料保留，只读参考；旧版生成和推进命令已退役。',
    '- UI 方向评审和视觉比较按用户目标及变化规模使用；不把轻量 UI 微调机械升级成三方向流程。',
    '- 测试强度按风险选择；构建成功不代替必要的真实运行态或视觉证据。',
    '- 高影响外部动作遵守宿主安全规则、真实权限和用户范围；工具提示不代替授权。',
    '- 自动化任务遵循自己的 runbook，不因旧版 Open VibeCoding 状态文件缺失而阻断。',
    '',
  ].join('\n');
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
  const sourcePath = cjoin(skill.sourceRoot ?? PACKAGE_ROOT, 'skills', skill.sourceSkill, 'SKILL.md');
  const parsed = parseSkillSourceMarkdown(await readText(sourcePath));
  return {
    description: skill.description ?? parsed.frontmatter.description,
    body: parsed.body,
  };
}

async function renderSkill(skill, projectRoot, adapter = 'codex') {
  const source = await loadSourceSkill(skill);
  const presentation = skillPresentation(skill.id);
  const description = presentation.description ?? source.description;
  const body = source.body.replaceAll('Open VibeCoding', 'Open VibeCoding').replaceAll('open-vibecoding ', 'open-vibecoding ');
  const sections = [
    '---',
    `name: ${skill.id}`,
    `description: ${description}`,
    ...(adapter === 'claude' && !presentation.userFacing ? ['user-invocable: false'] : []),
    '---',
    '',
    body,
  ];
  if (skill.id === 'open-vibecoding-router') {
    sections.push('', '## 内部能力读取入口', '',
      '以下能力由 Agent 按场景读取，不要求用户调用；路径相对于项目根目录。用户入口仍在当前客户端的 skills 目录。', '',
      ...CANONICAL_SKILLS.filter((item) => !skillPresentation(item.id).userFacing)
        .map((item) => `- \`${item.id}\`：\`${installedSkillPath(item.id, adapter)}\``));
  }
  if (skill.id === 'open-vibecoding-benchmark-router' && projectRoot) {
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
  const sourceDir = cjoin(skill.sourceRoot ?? PACKAGE_ROOT, 'skills', skill.sourceSkill, 'references');
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
  const title = command.title.replaceAll('Open VibeCoding', 'Open VibeCoding');
  const body = command.body.replaceAll('open-vibecoding ', 'open-vibecoding ').replaceAll('Open VibeCoding', 'Open VibeCoding');
  if (adapter === 'cursor') {
    return [
      `# ${title}`,
      '',
      body,
      '',
      'Always follow the Open VibeCoding managed rules in `.cursor/rules/open-vibecoding.mdc` and project `AGENTS.md`.',
      '',
    ].join('\n');
  }
  return [
    `# ${title}`,
    '',
    body,
    '',
    'For interactive Open VibeCoding work, rebuild state from the compatible `.open-vibecoding/` workspace before acting. In unattended automation, skip workflow gates unless the task explicitly opts in.',
    '',
  ].join('\n');
}

function renderCursorRule() {
  return [
    '---',
    'description: Open VibeCoding harness 规则',
    'globs:',
    '  - "**/*"',
    'alwaysApply: true',
    '---',
    '',
    '# Open VibeCoding Harness',
    '',
    agentContractBody(['cursor']),
  ].join('\n');
}

function quoteForToml(value) {
  return JSON.stringify(value);
}

function resolveShellPlatform(options = {}) {
  return options.platform ?? process.platform;
}

function hookCommand(projectRoot, eventName, options = {}) {
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'open-vibecoding-hook.mjs');
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
  const start = `# OPEN_VIBECODING:${id}:START`;
  const end = `# OPEN_VIBECODING:${id}:END`;
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
    marker: 'OPEN_VIBECODING:CODEX-HOOKS',
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
  return JSON.stringify(group ?? {}).includes('open-vibecoding-hook.mjs');
}

async function writeCodexHooksJson(projectRoot, options, changes) {
  const hooksPath = cjoin(projectRoot, '.codex', 'hooks.json');
  const rel = normalizedRelativePath(projectRoot, hooksPath);
  const existed = await exists(hooksPath);
  const current = existed ? await readJson(hooksPath).catch(() => ({})) : {};
  const next = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const activeEvents = new Set(hookEventsForProfile(options.hookProfile));
  for (const eventName of OPEN_VIBECODING_EVENTS) {
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
    marker: 'open-vibecoding-hook.mjs',
  });
}

async function listInstallableSkills(projectRoot) {
  const builtinScenarios = new Set(buildCapabilityCatalog().scenarios.map((scenario) => scenario.id));
  const builtinSkills = new Set(CANONICAL_SKILLS.map((skill) => skill.id));
  const catalog = await loadProjectCapabilityCatalog(projectRoot);
  const extensions = catalog.scenarios
    .filter((scenario) => !builtinScenarios.has(scenario.id))
    .map((scenario) => {
      if (builtinSkills.has(scenario.skill)) {
        throw new Error(`扩展场景 ${scenario.id} 不可复用内置 Skill: ${scenario.skill}`);
      }
      return { id: scenario.skill, sourceSkill: scenario.skill, sourceRoot: projectRoot };
    });
  return [...CANONICAL_SKILLS, ...extensions];
}

async function writeCodexAdapter(projectRoot, options, changes, skills) {
  const version = await packageVersion();
  for (const skill of skills) {
    const body = await renderSkill(skill, projectRoot, 'codex');
    const skillDir = path.dirname(cjoin(projectRoot, installedSkillPath(skill.id)));
    if (!skillPresentation(skill.id).userFacing) {
      const previousDir = cjoin(projectRoot, '.codex', 'skills', skill.id);
      if (await exists(previousDir)) {
        const previous = await readText(cjoin(previousDir, 'SKILL.md'));
        if (!previous.includes(OPEN_VIBECODING_GENERATED_MARKER)) throw new Error(`Unmanaged internal skill preserved: ${previousDir}`);
        await safeEnsureDirectory(previousDir, options);
        await safeEnsureDirectory(path.dirname(skillDir), options);
        if (!(await exists(skillDir))) await fs.rename(previousDir, skillDir);
        else throw new Error(`Both native and internal skill locations exist: ${skill.id}`);
        changes.push({ path: normalizedRelativePath(projectRoot, previousDir), status: 'moved-to-internal-library' });
      }
    }
    await writeGeneratedFile(
      cjoin(skillDir, 'SKILL.md'),
      { adapter: 'shared', source: skill.id, version, body },
      options,
      changes,
    );
    await writeSourceSkillReferences(projectRoot, skill, skillDir, version, options, changes);
    const ui = renderSkillInterface(skill.id);
    if (ui) await writeGeneratedFile(cjoin(skillDir, 'agents', 'openai.yaml'),
      { adapter: 'codex', source: `${skill.id}:interface`, version, body: ui, commentStyle: 'yaml' }, options, changes);
  }
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.codex', 'prompts', `open-vibecoding-${command.id}.md`),
      { adapter: 'codex', source: `command:${command.id}`, version, body: renderCommand(command, 'codex') },
      options,
      changes,
    );
  }
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'open-vibecoding-hook.mjs');
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

async function writeClaudeAdapter(projectRoot, options, changes, skills) {
  const version = await packageVersion();
  await upsertTextBlockFile(cjoin(projectRoot, 'CLAUDE.md'), 'CLAUDE', agentContractBody(['claude']), options, changes);
  for (const skill of skills) {
    const body = await renderSkill(skill, projectRoot, 'claude');
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
      cjoin(projectRoot, '.claude', 'commands', 'open-vibecoding', `${command.id}.md`),
      { adapter: 'claude', source: `command:${command.id}`, version, body: renderCommand(command, 'claude') },
      options,
      changes,
    );
  }
}

async function writeCursorAdapter(projectRoot, options, changes) {
  const version = await packageVersion();
  await writeGeneratedFile(
    cjoin(projectRoot, '.cursor', 'rules', 'open-vibecoding.mdc'),
    { adapter: 'cursor', source: 'cursor-rules', version, body: renderCursorRule() },
    options,
    changes,
  );
  for (const command of CANONICAL_COMMANDS) {
    await writeGeneratedFile(
      cjoin(projectRoot, '.cursor', 'commands', `open-vibecoding-${command.id}.md`),
      { adapter: 'cursor', source: `command:${command.id}`, version, body: renderCommand(command, 'cursor') },
      options,
      changes,
    );
  }
}

async function ensureHarnessState(projectRoot, options = {}) {
  await safeEnsureDirectory(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_DIR), options);
  const hookStatePath = harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_HOOK_STATE);
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
  const eventsPath = harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_EVENTS);
  if (!(await exists(eventsPath))) {
    await writeText(eventsPath, '', options);
  }
  const runtimeEnvironmentPath = harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_RUNTIME_ENVIRONMENT);
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
    cliEntry: cjoin(PACKAGE_ROOT, 'bin', 'open-vibecoding.js'),
    tools,
    managedFiles,
    skillEntries: CANONICAL_SKILLS.map(({ id }) => ({
      id, ...skillPresentation(id),
      paths: Object.fromEntries(tools.filter((tool) => tool !== 'cursor')
        .map((tool) => [tool, installedSkillPath(id, tool)])),
    })),
    hooks: {
      profile: hookProfile,
      events: hookEventsForProfile(hookProfile),
      availableProfiles: Object.keys(OPEN_VIBECODING_HOOK_PROFILES),
      state: OPEN_VIBECODING_HARNESS_HOOK_STATE,
      eventsLog: OPEN_VIBECODING_HARNESS_EVENTS,
      runtimeEnvironment: OPEN_VIBECODING_HARNESS_RUNTIME_ENVIRONMENT,
      driftReport: OPEN_VIBECODING_HARNESS_DRIFT,
    },
    adapterProtocol: buildAdapterProtocol(tools),
    runtimeDetection: RUNTIME_DETECTION_PROTOCOL,
    platformCapabilityPacks: buildPlatformCapabilityPacks(tools, optionalCapabilities),
    imageGenerationRouting: IMAGE_GENERATION_ROUTING,
    installSafety: installSafetyManifest(projectRoot, options),
    optionalCapabilities,
  };
  const manifestPath = harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_MANIFEST);
  const existed = await exists(manifestPath);
  await writeJson(manifestPath, manifest, options);
  const runtimeEnvironmentPath = harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_RUNTIME_ENVIRONMENT);
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
  changes.push({ path: OPEN_VIBECODING_HARNESS_MANIFEST, status: existed ? 'updated' : 'created' });
  await appendJsonl(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_EVENTS), {
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
  return readJson(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_MANIFEST)).catch(() => null);
}

async function readRuntimeEnvironment(projectRoot) {
  return readJson(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_RUNTIME_ENVIRONMENT)).catch(() => null);
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
      errors: [`${OPEN_VIBECODING_HARNESS_MANIFEST} is missing. Run open-vibecoding update .`],
      checks,
    };
    await writeJson(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_DRIFT), report, options);
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
  await writeJson(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_DRIFT), report, options);
  return report;
}

export async function setupOpenPrdAgentIntegration(projectRoot, options = {}) {
  const tools = normalizeTools(options.tools);
  const installableSkills = await listInstallableSkills(projectRoot);
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
  await upsertTextBlockFile(cjoin(projectRoot, 'AGENTS.md'), 'AGENTS', agentContractBody(tools), normalizedOptions, changes);

  if (tools.includes('codex')) {
    await writeCodexAdapter(projectRoot, normalizedOptions, changes, installableSkills);
  }
  if (tools.includes('claude')) {
    await writeClaudeAdapter(projectRoot, normalizedOptions, changes, installableSkills);
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
  await appendJsonl(harnessPath(projectRoot, OPEN_VIBECODING_HARNESS_EVENTS), {
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

// A workspace entry only points to installed children; it installs no hooks or workflow state.
export async function setupWorkspaceCapabilityEntry(workspaceRoot, projectRoots) {
  const root = path.resolve(workspaceRoot);
  const entries = [];
  for (const projectRoot of [...new Set(projectRoots.map((item) => path.resolve(item)))].sort()) {
    const relative = path.relative(root, projectRoot);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Workspace capability entries must point to descendant projects.');
    }
    const router = cjoin(projectRoot, installedSkillPath('open-vibecoding-router'));
    if (!(await exists(router))) throw new Error(`Missing installed capability entry: ${router}`);
    entries.push(`- 项目 \`${relative}\`：先读 \`${path.relative(root, router)}\`，再按目标选择该项目的子能力。`);
  }
  if (!entries.length) throw new Error('A workspace capability entry needs at least one installed project.');
  const changes = [];
  await upsertTextBlockFile(cjoin(root, 'AGENTS.md'), 'WORKSPACE', [
    '## Open VibeCoding 工作区入口',
    '',
    '本目录包含多个项目。先根据用户目标和代码位置选择实际项目，读取其入口与 AGENTS.md；以下路径相对于本文件所在目录。只读取与本轮任务有关的项目，不扫描或修改所有子项目。',
    '',
    ...entries,
    '',
    '能力按场景由 Agent 自主选择；不规定阶段顺序，不要求 PRD、change、tasks。只有实际验证后才能报告对应业务结果已通过。',
  ].join('\n'), { projectRoot: root, managedWriteRoots: [root] }, changes);
  return { workspaceRoot: root, projects: entries.length, changes };
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
      repairHint: 'Run open-vibecoding update . to regenerate missing Open VibeCoding guidance.',
    });
    return;
  }

  const text = await readText(absolutePath);
  if (!text.includes(OPEN_VIBECODING_GENERATED_MARKER)) {
    checks.push({
      path: pathName,
      ok: false,
      kind: 'generated-file',
      reason: 'missing-generated-marker',
      message: `${description} exists but is not recognized as an Open VibeCoding generated file because it lacks OPEN_VIBECODING:GENERATED.`,
      repairHint: 'Review the local file; if it should be managed by Open VibeCoding, run open-vibecoding update . --force to regenerate it.',
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
    return { cwd: projectRoot, prompt: `Open VibeCoding doctor hook smoke ${smokeId}` };
  }
  if (eventName === 'PreToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.open-vibecoding/state/current.json',
      },
    };
  }
  if (eventName === 'PostToolUse') {
    return {
      cwd: projectRoot,
      tool_name: 'Read',
      tool_input: {
        file_path: '.open-vibecoding/state/current.json',
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
  const hookPath = cjoin(projectRoot, '.codex', 'hooks', 'open-vibecoding-hook.mjs');
  if (!(await exists(hookPath))) {
    return { ok: false, message: 'Codex hook runner is missing.' };
  }

  const smokeId = `doctor-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const smokeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'open-vibecoding-hook-smoke-'));
  try {
    for (const eventName of hookEventsForProfile(options.hookProfile)) {
      const run = spawnSync(process.execPath, [hookPath, eventName], {
        cwd: smokeRoot,
        input: JSON.stringify(codexHookSmokePayload(smokeRoot, eventName, smokeId)),
        encoding: 'utf8',
        timeout: 30000,
        env: {
          ...process.env,
          OPEN_VIBECODING_CLI: process.env.OPEN_VIBECODING_CLI || cjoin(PACKAGE_ROOT, 'bin', 'open-vibecoding.js'),
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
  let installableSkills = CANONICAL_SKILLS;
  try {
    installableSkills = await listInstallableSkills(projectRoot);
  } catch (error) {
    checks.push({ path: 'open-vibecoding.capabilities.json', ok: false, message: error.message });
  }
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

  await collectDoctorCheck(projectRoot, checks, 'AGENTS.md', (file) => fileHas(file, 'OPEN_VIBECODING:AGENTS:START'), 'Missing Open VibeCoding managed AGENTS block.');
  await collectDoctorCheck(projectRoot, checks, OPEN_VIBECODING_HARNESS_MANIFEST, (file) => fileHas(file, '"managedFiles"'), 'Missing Open VibeCoding install manifest.');
  await collectDoctorCheck(projectRoot, checks, OPEN_VIBECODING_HARNESS_HOOK_STATE, (file) => fileHas(file, '"version"'), 'Missing Open VibeCoding hook state.');
  await collectDoctorCheck(projectRoot, checks, OPEN_VIBECODING_HARNESS_RUNTIME_ENVIRONMENT, (file) => fileHas(file, '"runtimeDetection"'), 'Missing Open VibeCoding runtime environment state.');
  await collectDoctorCheck(projectRoot, checks, OPEN_VIBECODING_HARNESS_EVENTS, (file) => exists(file), 'Missing Open VibeCoding harness events log.');
  await collectGeneratedDoctorCheck(projectRoot, checks, '.open-vibecoding/harness/command-catalog.md', 'Open VibeCoding command catalog');
  const ignoreStatus = await readOperationalGitignoreStatus(projectRoot);
  checks.push({
    path: ignoreStatus.path,
    ok: ignoreStatus.ok,
    kind: 'search-isolation',
    reason: ignoreStatus.ok ? 'ok' : 'missing-open-vibecoding-generated-artifact-ignores',
    message: ignoreStatus.ok
      ? 'ok'
      : `Missing Open VibeCoding generated artifact ignores: ${ignoreStatus.missing.join(', ')}`,
    repairHint: ignoreStatus.ok ? undefined : 'Run open-vibecoding update . to add search and VCS isolation for generated reports.',
  });

  if (tools.includes('codex')) {
    await collectDoctorCheck(projectRoot, checks, '.codex/config.toml', (file) => fileHas(file, '[[hooks.UserPromptSubmit]]') && fileHas(file, '[[hooks.PreToolUse]]'), 'Codex config is missing Open VibeCoding hook definitions.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks.json', (file) => fileHas(file, 'open-vibecoding-hook.mjs'), 'Codex hooks.json is missing Open VibeCoding hooks.');
    await collectDoctorCheck(projectRoot, checks, '.codex/hooks/open-vibecoding-hook.mjs', (file) => fileHas(file, 'recordRunHook'), 'Codex hook runner is missing.');
    const smoke = await smokeTestCodexHook(projectRoot, { hookProfile });
    checks.push({ path: '.codex/hooks/open-vibecoding-hook.mjs:smoke', ok: smoke.ok, message: smoke.message });
    for (const skill of installableSkills) {
      await collectGeneratedDoctorCheck(projectRoot, checks, installedSkillPath(skill.id), `Codex ${skill.id} skill`);
    }
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
    await collectDoctorCheck(projectRoot, checks, 'CLAUDE.md', (file) => fileHas(file, 'OPEN_VIBECODING:CLAUDE:START'), 'Missing Open VibeCoding managed CLAUDE block.');
    for (const skill of installableSkills) {
      await collectGeneratedDoctorCheck(projectRoot, checks, `.claude/skills/${skill.id}/SKILL.md`, `Claude ${skill.id} skill`);
    }
  }
  if (tools.includes('cursor')) {
    await collectGeneratedDoctorCheck(projectRoot, checks, '.cursor/rules/open-vibecoding.mdc', 'Cursor Open VibeCoding rule');
  }
  const drift = await computeDriftReport(projectRoot, tools, safetyOptions);
  for (const error of drift.errors) {
    checks.push({ path: OPEN_VIBECODING_HARNESS_DRIFT, ok: false, message: error });
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
