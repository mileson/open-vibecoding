/*
 * 核心功能
 * 解析 Open VibeCoding CLI 参数并生成用户可见 usage 文案。
 *
 * 输入
 * 接收 process argv 风格的字符串数组。
 *
 * 输出
 * 返回 command、projectPath、flags 和 usage 文本。
 *
 * 定位
 * 位于 CLI 边界层，只负责参数归一化，不执行业务流程。
 *
 * 依赖
 * 被 open-vibecoding.js 主入口调用；flag 名称需与 print、workspace 函数和文档保持一致。
 *
 * 维护规则
 * 新增 flag 时必须同步默认值、解析分支、usage、测试和 docs/basic/backend-structure.md。
 */
function parseCommandArgs(argv) {
  const args = [...argv];
  const flags = { json: false, force: false, fix: false, open: false, append: false, init: false, check: false, review: false, reject: false, resume: false, advance: false, verify: false, evidenceRequired: false, next: false, generate: false, validate: false, apply: false, archive: false, activate: false, close: false, keep: false, write: false, dryRun: false, repairAgent: false, allowDirtyMain: false, fleet: false, updateOpenprd: false, backfillWorkUnits: false, syncRegistry: false, setupMissing: false, doctor: false, recordHook: false, plan: false, prompt: false, loopRun: false, finish: false, commit: false, html: false, template: false, failOnViolation: false, noExternalFacts: false, noBrandAssets: false, noRealImages: false, daemon: false, stop: false, bridgeOutbox: false, bridgeSent: false, bridgeFailed: false, mark: null, direction: null, autoRefactor: null, type: 'architecture', mode: 'auto', input: null, field: null, value: null, set: null, jsonFile: null, artifactMarkdown: null, contentJson: null, presentation: null, source: null, reference: null, actual: null, before: null, after: null, referenceBox: null, actualBox: null, beforeBox: null, afterBox: null, focusLabel: null, focusReason: null, board: null, grid: null, boxes: null, out: null, format: null, quality: null, maxPanelWidth: null, referenceLabel: null, actualLabel: null, locale: null, classifyExternal: null, maxIterations: null, maxDepth: null, include: null, exclude: null, report: null, item: null, id: null, status: null, claim: null, notes: null, reason: null, confidence: null, threshold: null, change: null, starter: null, sections: null, brief: null, tools: 'all', hookProfile: null, templatePack: null, target: 'open-vibecoding', targetRoot: null, path: null, productType: null, title: null, owner: null, problem: null, whyNow: null, evidence: null, from: null, to: null, version: null, digest: null, workUnit: null, event: null, risk: null, outcome: null, preview: null, learn: null, genre: null, style: null, topic: null, enable: false, disable: false, agent: 'codex', agentCommand: null, worktree: null, branch: null, message: null, thread: null, threadTitle: null, conversationTitle: null, session: null, sessionTitle: null, host: null, port: null, openTarget: 'auto', runtimeAction: null, lane: null, task: null, claimId: null, client: null, leaseMs: null, expectedRevision: null, expectedLaneRevision: null, writeSet: null, baseCommit: null, gateId: null, approvalId: null, symlinkStrategy: null, installSafetyBackupRoot: null };
  const positionals = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (['--key-color', '--tolerance', '--feather'].includes(arg)) {
      const value = args.shift();
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      const key = { '--key-color': 'keyColor', '--tolerance': 'tolerance', '--feather': 'feather' }[arg];
      flags[key] = value;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--runtime-action' || arg === '--action') {
      flags.runtimeAction = args.shift() ?? null;
      continue;
    }
    if (arg === '--lane') {
      flags.lane = args.shift() ?? null;
      continue;
    }
    if (arg === '--task') {
      flags.task = args.shift() ?? null;
      continue;
    }
    if (arg === '--claim-id') {
      flags.claimId = args.shift() ?? null;
      continue;
    }
    if (arg === '--client') {
      flags.client = args.shift() ?? null;
      continue;
    }
    if (arg === '--lease-ms') {
      flags.leaseMs = args.shift() ?? null;
      continue;
    }
    if (arg === '--expected-revision') {
      flags.expectedRevision = args.shift() ?? null;
      continue;
    }
    if (arg === '--expected-lane-revision') {
      flags.expectedLaneRevision = args.shift() ?? null;
      continue;
    }
    if (arg === '--write-set') {
      flags.writeSet = args.shift() ?? null;
      continue;
    }
    if (arg === '--base-commit') {
      flags.baseCommit = args.shift() ?? null;
      continue;
    }
    if (arg === '--gate' || arg === '--gate-id') {
      flags.gateId = args.shift() ?? null;
      continue;
    }
    if (arg === '--approval-id') {
      flags.approvalId = args.shift() ?? null;
      continue;
    }
    if (arg === '--symlink-strategy') {
      flags.symlinkStrategy = args.shift() ?? null;
      continue;
    }
    if (arg === '--install-safety-backup-root') {
      flags.installSafetyBackupRoot = args.shift() ?? null;
      continue;
    }
    if (arg === '--force') {
      flags.force = true;
      continue;
    }
    if (arg === '--fix') {
      flags.fix = true;
      continue;
    }
    if (arg === '--open') {
      flags.open = true;
      continue;
    }
    if (arg === '--enable') {
      flags.enable = true;
      continue;
    }
    if (arg === '--disable') {
      flags.disable = true;
      continue;
    }
    if (arg === '--append') {
      flags.append = true;
      continue;
    }
    if (arg === '--init') {
      flags.init = true;
      continue;
    }
    if (arg === '--check') {
      flags.check = true;
      continue;
    }
    if (arg === '--review') {
      flags.review = true;
      continue;
    }
    if (arg === '--reject') {
      flags.reject = true;
      continue;
    }
    if (arg === '--resume') {
      flags.resume = true;
      continue;
    }
    if (arg === '--advance') {
      flags.advance = true;
      continue;
    }
    if (arg === '--verify') {
      flags.verify = true;
      continue;
    }
    if (arg === '--evidence-required') {
      flags.evidenceRequired = true;
      continue;
    }
    if (arg === '--generate') {
      flags.generate = true;
      continue;
    }
    if (arg === '--validate') {
      flags.validate = true;
      continue;
    }
    if (arg === '--apply') {
      flags.apply = true;
      continue;
    }
    if (arg === '--archive') {
      flags.archive = true;
      continue;
    }
    if (arg === '--activate') {
      flags.activate = true;
      continue;
    }
    if (arg === '--close') {
      flags.close = true;
      continue;
    }
    if (arg === '--keep') {
      flags.keep = true;
      continue;
    }
    if (arg === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (arg === '--daemon' || arg === '--background' || arg === '--persist') {
      flags.daemon = true;
      continue;
    }
    if (arg === '--stop') {
      flags.stop = true;
      continue;
    }
    if (arg === '--bridge-outbox') {
      flags.bridgeOutbox = true;
      continue;
    }
    if (arg === '--bridge-sent') {
      flags.bridgeSent = true;
      continue;
    }
    if (arg === '--bridge-failed') {
      flags.bridgeFailed = true;
      continue;
    }
    if (arg === '--repair-agent') {
      flags.repairAgent = true;
      continue;
    }
    if (arg === '--allow-dirty-main') {
      flags.allowDirtyMain = true;
      continue;
    }
    if (arg === '--fleet') {
      flags.fleet = true;
      continue;
    }
    if (arg === '--write') {
      flags.write = true;
      continue;
    }
    if (arg === '--fail-on-violation') {
      flags.failOnViolation = true;
      continue;
    }
    if (arg === '--plan') {
      flags.plan = true;
      continue;
    }
    if (arg === '--prompt') {
      flags.prompt = true;
      continue;
    }
    if (arg === '--run') {
      flags.loopRun = true;
      continue;
    }
    if (arg === '--finish') {
      flags.finish = true;
      continue;
    }
    if (arg === '--commit') {
      flags.commit = true;
      continue;
    }
    if (arg === '--html') {
      flags.html = true;
      continue;
    }
    if (arg === '--template') {
      flags.template = true;
      continue;
    }
    if (arg === '--update-open-vibecoding') {
      flags.updateOpenprd = true;
      continue;
    }
    if (arg === '--sync-registry') {
      flags.syncRegistry = true;
      continue;
    }
    if (arg === '--setup-missing') {
      flags.setupMissing = true;
      continue;
    }
    if (arg === '--doctor') {
      flags.doctor = true;
      continue;
    }
    if (arg === '--record-hook') {
      flags.recordHook = true;
      continue;
    }
    if (arg === '--next') {
      flags.next = true;
      continue;
    }
    if (arg === '--mark') {
      flags.mark = args.shift() ?? null;
      continue;
    }
    if (arg === '--template-pack' || arg === '-t') {
      flags.templatePack = args.shift() ?? null;
      continue;
    }
    if (arg === '--tools') {
      flags.tools = args.shift() ?? 'all';
      continue;
    }
    if (arg === '--hook-profile') {
      flags.hookProfile = args.shift() ?? null;
      continue;
    }
    if (arg === '--agent') {
      flags.agent = args.shift() ?? 'codex';
      continue;
    }
    if (arg === '--agent-command') {
      flags.agentCommand = args.shift() ?? null;
      continue;
    }
    if (arg === '--thread' || arg === '--thread-id' || arg === '--conversation' || arg === '--conversation-id') {
      flags.thread = args.shift() ?? null;
      continue;
    }
    if (arg === '--thread-title' || arg === '--conversation-title' || arg === '--conversation-name') {
      const value = args.shift() ?? null;
      flags.threadTitle = value;
      flags.conversationTitle = value;
      continue;
    }
    if (arg === '--session' || arg === '--session-id') {
      flags.session = args.shift() ?? null;
      continue;
    }
    if (arg === '--session-title' || arg === '--session-name') {
      flags.sessionTitle = args.shift() ?? null;
      continue;
    }
    if (arg === '--host') {
      flags.host = args.shift() ?? null;
      continue;
    }
    if (arg === '--port') {
      flags.port = args.shift() ?? null;
      continue;
    }
    if (arg === '--open-target') {
      flags.openTarget = args.shift() ?? 'auto';
      continue;
    }
    if (arg === '--worktree') {
      flags.worktree = args.shift() ?? null;
      continue;
    }
    if (arg === '--branch') {
      flags.branch = args.shift() ?? null;
      continue;
    }
    if (arg === '--product-type' || arg === '-P') {
      flags.productType = args.shift() ?? null;
      continue;
    }
    if (arg === '--type') {
      flags.type = args.shift() ?? 'architecture';
      continue;
    }
    if (arg === '--mode') {
      flags.mode = args.shift() ?? 'auto';
      continue;
    }
    if (arg === '--input') {
      flags.input = args.shift() ?? null;
      continue;
    }
    if (arg === '--field') {
      flags.field = args.shift() ?? null;
      continue;
    }
    if (arg === '--value') {
      flags.value = args.shift() ?? null;
      continue;
    }
    if (arg === '--set') {
      flags.set = args.shift() ?? null;
      continue;
    }
    if (arg === '--json-file') {
      flags.jsonFile = args.shift() ?? null;
      continue;
    }
    if (arg === '--artifact-markdown') {
      flags.artifactMarkdown = args.shift() ?? null;
      continue;
    }
    if (arg === '--content-json') {
      flags.contentJson = args.shift() ?? null;
      continue;
    }
    if (arg === '--presentation') {
      flags.presentation = args.shift() ?? null;
      continue;
    }
    if (arg === '--source') {
      flags.source = args.shift() ?? null;
      continue;
    }
    if (arg === '--reference') {
      flags.reference = args.shift() ?? null;
      continue;
    }
    if (arg === '--actual') {
      flags.actual = args.shift() ?? null;
      continue;
    }
    if (arg === '--before') {
      flags.before = args.shift() ?? null;
      continue;
    }
    if (arg === '--after') {
      flags.after = args.shift() ?? null;
      continue;
    }
    if (arg === '--reference-box') {
      flags.referenceBox = args.shift() ?? null;
      continue;
    }
    if (arg === '--actual-box') {
      flags.actualBox = args.shift() ?? null;
      continue;
    }
    if (arg === '--before-box') {
      flags.beforeBox = args.shift() ?? null;
      continue;
    }
    if (arg === '--after-box') {
      flags.afterBox = args.shift() ?? null;
      continue;
    }
    if (arg === '--focus-label') {
      flags.focusLabel = args.shift() ?? null;
      continue;
    }
    if (arg === '--focus-reason') {
      flags.focusReason = args.shift() ?? null;
      continue;
    }
    if (arg === '--board') {
      flags.board = args.shift() ?? null;
      continue;
    }
    if (arg === '--grid') {
      flags.grid = args.shift() ?? null;
      continue;
    }
    if (arg === '--boxes') {
      flags.boxes = args.shift() ?? null;
      continue;
    }
    if (arg === '--out') {
      flags.out = args.shift() ?? null;
      continue;
    }
    if (arg === '--format') {
      flags.format = args.shift() ?? null;
      continue;
    }
    if (arg === '--quality') {
      flags.quality = args.shift() ?? null;
      continue;
    }
    if (arg === '--max-panel-width') {
      flags.maxPanelWidth = args.shift() ?? null;
      continue;
    }
    if (arg === '--reference-label') {
      flags.referenceLabel = args.shift() ?? null;
      continue;
    }
    if (arg === '--actual-label') {
      flags.actualLabel = args.shift() ?? null;
      continue;
    }
    if (arg === '--locale' || arg === '--lang') {
      flags.locale = args.shift() ?? null;
      continue;
    }
    if (arg === '--classify-external') {
      flags.classifyExternal = args.shift() ?? '';
      continue;
    }
    if (arg === '--max-iterations') {
      flags.maxIterations = args.shift() ?? null;
      continue;
    }
    if (arg === '--max-depth') {
      flags.maxDepth = args.shift() ?? null;
      continue;
    }
    if (arg === '--include') {
      flags.include = args.shift() ?? null;
      continue;
    }
    if (arg === '--exclude') {
      flags.exclude = args.shift() ?? null;
      continue;
    }
    if (arg === '--report') {
      flags.report = args[0] && !args[0].startsWith('-') ? args.shift() : true;
      continue;
    }
    if (arg === '--item') {
      flags.item = args.shift() ?? null;
      continue;
    }
    if (arg === '--id') {
      flags.id = args.shift() ?? null;
      continue;
    }
    if (arg === '--status') {
      flags.status = args.shift() ?? null;
      continue;
    }
    if (arg === '--claim') {
      flags.claim = args.shift() ?? null;
      continue;
    }
    if (arg === '--notes') {
      flags.notes = args.shift() ?? null;
      continue;
    }
    if (arg === '--reason') {
      flags.reason = args.shift() ?? null;
      continue;
    }
    if (arg === '--confidence') {
      flags.confidence = args.shift() ?? null;
      continue;
    }
    if (arg === '--threshold') {
      flags.threshold = args.shift() ?? null;
      continue;
    }
    if (arg === '--change') {
      flags.change = args.shift() ?? null;
      continue;
    }
    if (arg === '--starter') {
      flags.starter = args.shift() ?? null;
      continue;
    }
    if (arg === '--brief') {
      flags.brief = args.shift() ?? null;
      continue;
    }
    if (arg === '--sections') {
      flags.sections = args.shift() ?? null;
      continue;
    }
    if (arg === '--no-external-facts') {
      flags.noExternalFacts = true;
      continue;
    }
    if (arg === '--no-brand-assets') {
      flags.noBrandAssets = true;
      continue;
    }
    if (arg === '--no-real-images') {
      flags.noRealImages = true;
      continue;
    }
    if (arg === '--title') {
      flags.title = args.shift() ?? null;
      continue;
    }
    if (arg === '--genre') {
      flags.genre = args.shift() ?? null;
      continue;
    }
    if (arg === '--style' || arg === '--substyle') {
      flags.style = args.shift() ?? null;
      continue;
    }
    if (arg === '--topic') {
      flags.topic = args.shift() ?? null;
      continue;
    }
    if (arg === '--owner') {
      flags.owner = args.shift() ?? null;
      continue;
    }
    if (arg === '--problem') {
      flags.problem = args.shift() ?? null;
      continue;
    }
    if (arg === '--why-now') {
      flags.whyNow = args.shift() ?? null;
      continue;
    }
    if (arg === '--evidence') {
      flags.evidence = args.shift() ?? null;
      continue;
    }
    if (arg === '--event') {
      flags.event = args.shift() ?? null;
      continue;
    }
    if (arg === '--risk') {
      flags.risk = args.shift() ?? null;
      continue;
    }
    if (arg === '--outcome') {
      flags.outcome = args.shift() ?? null;
      continue;
    }
    if (arg === '--preview') {
      flags.preview = args.shift() ?? null;
      continue;
    }
    if (arg === '--message') {
      flags.message = args.shift() ?? null;
      continue;
    }
    if (arg === '--learn') {
      flags.learn = args[0] && !args[0].startsWith('-') ? args.shift() : true;
      continue;
    }
    if (arg === '--from') {
      flags.from = args.shift() ?? null;
      continue;
    }
    if (arg === '--to') {
      flags.to = args.shift() ?? null;
      continue;
    }
    if (arg === '--version') {
      flags.version = args.shift() ?? null;
      continue;
    }
    if (arg === '--digest') {
      flags.digest = args.shift() ?? null;
      continue;
    }
    if (arg === '--direction') {
      flags.direction = args.shift() ?? null;
      continue;
    }
    if (arg === '--auto-refactor') {
      flags.autoRefactor = args.shift() ?? null;
      continue;
    }
    if (arg === '--work-unit' || arg === '--work-unit-id') {
      flags.workUnit = args.shift() ?? null;
      continue;
    }
    if (arg === '--target') {
      flags.target = args.shift() ?? 'open-vibecoding';
      continue;
    }
    if (arg === '--target-root') {
      flags.targetRoot = args.shift() ?? null;
      continue;
    }
    if (arg === '--path' || arg === '-p') {
      flags.path = args.shift() ?? null;
      continue;
    }
    if (arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }
    positionals.push(arg);
  }

  return { flags, positionals };
}

function usage() {
  return [
    'Open VibeCoding CLI',
    'The open-vibecoding executable remains available for existing projects.',
    '',
    'Usage:',
    '  open-vibecoding capabilities <list|get <id>|contract> [--path <project>]  # 独立场景与项目扩展发现；JSON 输出',
    '  open-vibecoding init [path] [--template-pack <base|consumer|b2b|agent>] [--tools <all|codex,claude,cursor>] [--hook-profile <lite|guarded|full>] [--symlink-strategy <block|materialize>] [--install-safety-backup-root <path>] [--force]',
    '  open-vibecoding setup [path] [--tools <all|codex,claude,cursor>] [--hook-profile <lite|guarded|full>] [--symlink-strategy <block|materialize>] [--install-safety-backup-root <path>] [--force] [--json]',
    '  open-vibecoding update [path] [--tools <all|codex,claude,cursor>] [--hook-profile <lite|guarded|full>] [--symlink-strategy <block|materialize>] [--install-safety-backup-root <path>] [--force] [--json]',
    '  open-vibecoding self-update [--check] [--dry-run] [--json]',
    '  open-vibecoding upgrade [path] [--fleet] [--dry-run] [--tools <all|codex,claude,cursor>] [--hook-profile <lite|guarded|full>] [--max-depth <n>] [--include <csv>] [--exclude <csv>] [--report <file>] [--force] [--json]',
    '  open-vibecoding doctor [path] [--tools <all|codex,claude,cursor>] [--hook-profile <lite|guarded|full>] [--fix] [--json]',
    '  open-vibecoding fleet <root> [--dry-run|--doctor|--update-open-vibecoding|--sync-registry|--setup-missing] [--hook-profile <lite|guarded|full>] [--max-depth <n>] [--include <csv>] [--exclude <csv>] [--report <file>] [--json]',
    '  open-vibecoding run [path] [--verify|--record-hook --event <name> --risk <level> --outcome <text> --preview <text>] [--json]',
    '  open-vibecoding runtime [path] --action <status|create-lane|ensure-lane|add-task|claim|heartbeat|release|finish|recover> [--lane <id>] [--task <id>] [--claim-id <id>] [--write-set <csv>] [--lease-ms <n>] [--expected-revision <n>] [--expected-lane-revision <n>] [--client <codex|claude|cursor>] [--session <id>] [--thread <id>] [--worktree <path>] [--branch <name>] [--base-commit <sha>] [--evidence <ref>] [--json]',
    '  open-vibecoding gate [path] --action <status|define|evidence|approve|evaluate> [--json-file <record.json>] [--gate <id>] [--approval-id <id>] [--json]',
    '  open-vibecoding canvas [path] [--thread <id> [--thread-title <name>]|--session <id> [--session-title <name>]] [--host <host>] [--port <number>] [--daemon|--stop] [--open] [--open-target <auto|system|codex-browser>] [--dry-run] [--json]',
    '  open-vibecoding canvas [path] --bridge-outbox [--thread <id>|--session <id>] [--claim <next|id>] [--json]',
    '  open-vibecoding canvas [path] (--bridge-sent|--bridge-failed) --id <bridge-id> [--thread <id>|--session <id>] [--reason <text>] [--json]',
    '  open-vibecoding brainstorm [path] [--topic <text>] [--open] [--json]',
    '  open-vibecoding learn [path] [--topic <text>] [--genre <internet-product|scientific|fairy-tale|web-novel|xianxia>] [--style <substyle>] [--source <workspace|docs|loop|all>] [--content-json <file>] [--open] [--enable|--disable] [--json]',
    '  open-vibecoding quality [path] [--init|--verify|--learn [--review] --from <legacy-report-or-diagnostics-or-turn-state>] [--fail-on-violation] [--force] [--json]',
    '  open-vibecoding knowledge <candidates|reject|archive|restore> [path-or-id] [--status <pending-review|all|rejected|archived|promoted|merged>] [--id <candidate-id>] [--reason <text>] [--json]',
    '  open-vibecoding icon-cutout --source <image> --out <new.png> [--key-color <#RRGGBB>] [--tolerance <0..255>] [--feather <0..255>]  # 本地透明化；JSON 输出',
    '  open-vibecoding visual-prepare [path] --reference <effect-image> ((--grid <columns>x<rows>) | (--boxes <plan.json>)) [--include <csv>] [--id <reference-set-id>] [--title <text>] [--out <dir>] [--json]',
    '  open-vibecoding design-review [path] --action <save|select> --json-file <plan.json>  # 原图、编号拼图、版本与明确选定的 final；JSON 输出',
    '  open-vibecoding visual-compare [path] ((--reference <effect-image> --actual <screenshot-image>) | (--before <before-screenshot> --after <after-screenshot>) | --board <board.json>) [--reference-box <x,y,w,h>] [--actual-box <x,y,w,h>] [--before-box <x,y,w,h>] [--after-box <x,y,w,h>] [--focus-label <text>] [--focus-reason <text>] [--presentation <local-first>] [--out <file.jpg>] [--format <jpg|png|webp>] [--quality <1..100>] [--max-panel-width <px>] [--locale <zh-CN|en>] [--json]',
    '    --board modes: focus-board, parallel-board, verification-board, alignment-board, centering-board',
    '  open-vibecoding design-starter [path] [--starter <content-home|product-launch|ops-dashboard>] [--out <index.html>] [--title <name>] [--brief <text>] [--sections <a|b|c>] [--no-external-facts] [--no-brand-assets] [--no-real-images] [--force] [--json]',
    '  open-vibecoding dev-check [path] <file...> [--auto-refactor <on|off>] [--json]',
    '  open-vibecoding i18n-init [path] [--locale <zh-Hans|en|...>] [--json]',
    '  open-vibecoding grow [path] [--review|--apply --id <candidate-id>|--reject --id <candidate-id>|--init|--check] [--notes <text>] [--json]',
    '  open-vibecoding benchmark <add|observe|list|approve|verify> [target-or-id] [path-for-list-or-verify] [--path <project>] [--notes <text>] [--threshold <n>] [--id <benchmark-id>] [--json]',
    '  open-vibecoding brainstorm-presentation [path] [--template] [--presentation <json>] [--write] [--fail-on-violation] [--json]',
    '  open-vibecoding docs-compact [path] [--json]',
    '  open-vibecoding guide [path] [--json]',
    '  open-vibecoding diagram [path] [--type <architecture|product-flow>] [--input <contract.json>] [--mark <pending-confirmation|confirmed|needs-revision>] [--open] [--json]',
    '  open-vibecoding diff [path] [--from <version>] [--to <version>]',
    '  open-vibecoding history [path]',
    '  open-vibecoding release [path] [--enable|--disable] [--set <0.1.23>] [--status <draft|current|released>] [--version <id>] [--notes <text>] [--json]',
    '  open-vibecoding validate [path] [--json]',
    '  open-vibecoding status [path] [--json]',
    '  open-vibecoding standards [path] [--init|--classify-external <path>] [--check|--verify] [--fail-on-violation] [--force] [--json]',
    '  open-vibecoding change [path] [--validate] [--change <id>] [--json]  # 只读旧版 change',
    '  open-vibecoding changes [path] [--json]',
    '  open-vibecoding specs [path] [--json]',
    '  open-vibecoding tasks [path] [--change <id>] [--json]  # 只读历史任务',
    '',
  ].map((line) => line.startsWith('  open-vibecoding ') ? line.replace('  open-vibecoding ', '  open-vibecoding ') : line).join('\n');
}


export { parseCommandArgs, usage };
