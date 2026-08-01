# 产品流程说明

## 核心流程

OpenPrd 的核心流程：用户在项目中初始化或接入 `.openprd/` 工作区，Agent 先读只读状态，再分流需求类型，并在执行用户已经要求的工作时后台维护 review/change/tasks 与验证材料。OpenPrd 提供上下文和证据，不重复向用户索取执行授权。

OpenPrd 还会通过生成的 AGENTS 与 skills 注入“Agent 自主审查界面”合同：在任务进入、关键证据形成、实现验证完成和高影响后续动作前，由 Agent 判断审查边界；存在人类审查节点且命中多对象逐项证据、可逆审批、多媒体上下文、高影响测试/发布矩阵或长期结构化材料等强制条件时，由 Agent 自行设计、制作并验证任务专属 HTML，Markdown/CSV 不构成替代。OpenPrd 不提供通用审查 HTML 生成器。

### 非阻断状态模型

- `taskReady` 只描述当前任务的实现与最小足够验证；全仓文档、旧 change 或历史证据债不得把它改成失败。
- `workspaceAttention` 汇总当前 `docs/basic/`、代码说明书、文件夹 README 和其他全局维护项，供 Agent 顺手维护，但不阻断当前任务、commit 或交付动作；历史 requirement/PRD/review/change/tasks 正文永久冻结，不列为待补债务。
- `claimReady` 限定“整个项目已经 production-ready”这类整体声明；EVO/quality 默认属于这一层。
- `actionReady` 只检查当前动作真正需要的目标、权限、制品、冲突、测试和回滚条件。OpenPrd 内部材料不充当用户授权。
- `standards --verify` 与 `quality --verify` 默认输出 advisory 报告并返回成功，避免文档或证据债通过 `&&` / `set -e` 截停当前任务。只有调用者明确加 `--fail-on-violation` 时，未就绪状态才以非零退出码表达；真实命令或结构错误始终可以失败。

### 状态接入与工作区

- Agent 直接根据当前会话、用户消息和必要的 `status`、`next` 等 repo-local 状态决定下一步。
- `.openprd/` 是唯一工作区；新 change/spec/task/archive 都写入 `.openprd/changes/`、`.openprd/specs/` 和 `.openprd/archive/changes/`。
- 更新旧项目时会把历史根目录 `openprd/` 工作产物迁入 `.openprd/`。

### 需求分流

- 用 `openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本判断当前输入属于直接处理、现有功能优化还是新功能/新流程方案，内部保留 L0/L1/L2 路由码。
- 当用户明确说“帮我梳理下”“先想清楚”“进入脑暴模式”，或一句话需求明显还需要先收敛业务方向、用户、商业目标、竞品和内部复用时，先进入 `openprd brainstorm`，汇总 benchmark、knowledge、当前工作区和开放问题，生成稳定 `brainstorm.html` 工作台。
- 脑暴模式默认追问和呈现：现在怎么解决、为什么现在要换、谁拍板/谁受影响、第一批最容易触达的社区/种子用户、先不做完整产品时怎么手工交付、手工作战卡、一件事 MVP、周末级验证、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、什么承诺才算真需求、有没有 10 个样本和更强付费信号、最低成本验证、先活下来约束、达到什么条件才允许产品化、增长纪律、可逆性、客户真问题、价值观一致性、止损线和可复用基础。方向收敛后进入需求入口分流；用户已经要求执行时可采用可逆默认方案继续。

### L2 需求后台维护路径

- L2 通过 `intake-reflection.md` 做需求入口自省；Agent 从用户原话、项目事实和可逆默认方案整理 target、scope、out-of-scope 与 acceptance，并在后台继续 `capture/classify/synthesize`。
- `review.html` 是稳定可查看 artifact，不是授权门禁。用户明确要求实现或继续时，Agent 记录必要假设并推进；只有真实产品决策会显著改变结果且无法安全默认时，才由 Agent 依据当前上下文提问。
- 仍处在 0 到 1 探索、值不值得做或创业验证阶段的 L2，requirement 摘要除了“需求判断 / 需求理解 / 功能范围 / 技术方案”，还要主动补一层“验证与创业闭环”，覆盖：
  - 当前替代方案、第一批先找谁、先怎么手工交付、手工作战卡。
  - 第一版只做哪一件事、周末级验证、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本。
  - 什么承诺才算真需求、有没有 10 个样本和更强付费信号、最低成本先验证什么。
  - 能不能先用 spreadsheet / 表单 / no-code 跑起来；如果必须开始做产品，也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架。
  - 达到什么条件才允许产品化、增长阶段守什么纪律、验证阶段怎样先活下来。
  - 这条路是否可逆、是否真在解决客户问题、是否符合团队价值观、这是不是团队愿意长期住进去的业务形态。

### 界面任务的设计前置门

- 界面、页面、视觉、样式和前端体验任务在真正进入实现前，先读取 `$openprd-frontend-design` 和 `.openprd/design/`。
- 先补 `facts-sheet`、`asset-spec`、`image-preflight`、`direction-plan`、`selected-direction` 这组活动合同，避免事实瞎编、素材空心和 3 个方向都收敛成同一种安全极简解。
- 若用户已经提供效果图、设计稿、参考截图或其他明确参考图，默认把它当成主参考源；现有 starter、样式库和 design tokens 只在足够接近时作为加速器，不得反过来主导最终风格。
- 空白前端冷启动如果用户原话已经明确页面主题、模块范围或“直接实现”的意图，直接用 mini-plan 对齐路径并进入 `design-starter -> Patch Mode`。
- `design-starter` 生成入口文件后，默认立即进入 `Patch Mode`，围绕同一路径继续细化页面，而不是 delete-first 后再重建。
- `Patch Mode` 的完成定义：不只是在对话里说明计划、下载素材或补合同，而是把最终结构、样式、真实图片或参考约束真正落进入口文件，清掉主要占位，再同步 active design artifacts。
- 界面类 L1/L2 需求在 review 阶段可通过 `reviewPresentation.designDirections` 把 3 个 `imagegen` 交互方向卡片放进 `review.html`；用户用 `openprd review . --mark confirmed --direction <id>` 一次完成 review 确认和方向选定。

### 执行与质量

- 执行段通过 tasks、loop、回归报告和必要的视觉评审证据把实现与验证沉淀成结构化证据。
- 审查界面由审查边界触发，不由“任务是否结束”触发：分析中需要共同判断、实现后需要验收、外部动作前需要确认时，都由 Agent 重新判断。命中强制条件时必须制作任务专属 HTML；未命中时继续按审查成本判断，简单结果保持对话交付。
- 用 `openprd-test-strategy` 为任务选择单元、集成、端到端、人工、视觉、小程序、性能或安全验证组合。
- 用 execution strategy 为任务标注 `serial / parallel-workers / parallel-workers-isolated`、`write-scope`、`owner-role`、`local-verify` 和 `integration-owner`。
- 质量段通过 `openprd quality --verify` 生成 HTML 回归测试报告，优先展示整体回归结果、逐需求模块结果、测试块通过情况、分层测试策略矩阵和待补证据；它限制整体就绪声明，不否定已验证的当前任务。
- 执行阶段的单个任务只保留最小足够 task evidence；基础文档、代码说明书、文件夹 README、日志和其他全局维护项进入 `workspaceAttention`，由 Agent 在不打断当前工作的前提下更新。
- EVO 只作为内部质量评估/验证层代号，不作为用户读报告的前置概念。

### 历史资料

- 已归档或只能从旧版本推断的 requirement、PRD、review、change、tasks 和实现理由统一视为 `legacy-frozen`：保留原文和索引，不补写、不猜测、不用今天的场景反推当时决策。
- 历史项目迁移与 fleet backfill 只补路径、digest、work-unit 绑定等可验证元数据，不生成缺失的历史需求正文或验收结论。
- 旧功能再次进入开发时，创建一条基于当前目标和当前验收条件的新 requirement/change；旧 artifact 只作为 context，不恢复成 active gate。
- 当前源码能够直接验证的文件说明书、文件夹 README 与 `docs/basic/` 当前态可以后台补齐，但只形成工作区维护提醒。

### 图片与视觉请求

- 用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、确认用效果图、视觉稿、mockup 或“先看样子”时，Agent 直接调用 `imagegen`（Codex 原生 Image 2）；只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。
- 大界面改动在需求分流后、PRD 定稿或实现开工前，先用 Codex Computer Use 截取产品内当前功能截图，再用 `imagegen` 生成至少 3 个设计方向，拼接成带 1/2/3 序号的横向评审大图给用户选择。
- 这 3 个方向要在 `.openprd/design/active/direction-plan.md` 中明确写出不同的 lens、theme、layout 或素材策略，不能只是小幅换色或轻微留白差异。
- 确认参考图是一张整板、网格图或多对象组合时，先走 `visual-prepare` 生成 reference-set、contact sheet 和 compare-plan，再进入逐项实现与验收。
- `review.html` 不替代图片或效果图生成；`visual-compare` 只在进入实现阶段后用于视觉证据：已有参考图时对比效果图和实现截图，无参考图但改动界面时对比修改前和修改后截图。

## 用户路径

- 初始化项目：用户运行 `openprd init` 或 `openprd setup`，生成 `.openprd/`、`docs/basic/`、AGENTS 和各端 agent guidance。
  - 旧版项目如果存在根目录 `openprd/changes/`、`openprd/specs/` 或 `openprd/archive/changes/`，`setup/update/fleet --update-openprd` 会自动迁移到 `.openprd/`，冲突文件保留在旧目录并报告人工处理。
  - `.openprd/README.md` 与模板层 `README.md` 默认使用简体中文，英文切换入口写到 `README_EN.md`，如需兼容旧外链可保留 `README_CN.md` 作为跳转页。
  - 仓库首页 README、对外概览和带文字的示意图，默认先按用户可见需求类型解释“直接处理 / 现有功能优化 / 新功能/新流程方案”，优先说明用户场景、确认方式、收益和风险；如果提供英文版，文字图片也要成对维护。
  - Codex hook 默认使用 `lite`：`UserPromptSubmit` 只记录提示，用只匹配直接编辑工具的轻量 advisory 提醒 Agent 后台维护材料，并在本轮结束前通过 `Stop` 回顾是否值得沉淀项目经验；除原始凭证读取等真实安全边界外，不阻断工具调用。
- 当前环境识别：`setup/update` 会把 `runtimeDetection` 和 `platformCapabilityPacks` 写入 install manifest，并初始化 `runtime-environment.json`。
  - Codex hook 每次收到 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse 或 Stop 时，把 hook/session payload 观察到的 active client、surface、confidence、session、turn、agent type、model、evidence 和 observed capabilities 写入 runtime environment。
  - `doctor` 会读取这份状态；Agent 也可直接读取 runtime environment，再选择 Codex、Claude Code 或 Cursor 对应能力包。
- 开启对话画布：用户要求“开启画布协同模式”或需要用界面标注协作时，Agent 运行 `openprd canvas . --daemon --open`。
  - 当前 runtime 没有 thread/session 证据时，改用 `openprd canvas . --thread <id> --thread-title <name> --daemon --open` 或 `--session <id> --session-title <name>` 显式隔离。
  - thread/session ID 决定存储分桶；title/name 只用于浏览器右侧“当前对话”展示和后台 daemon 透传，不参与 session-key 生成；runtime evidence 若提供 `threadTitle` / `conversationTitle` / `sessionTitle` 会自动显示。
  - 在 Codex Desktop 需要打开到右侧 Browser 时使用 `--open-target codex-browser`：命令只返回地址并提示 Agent 使用 Codex Browser 工具导航，不再调用系统 `open` 弹出外部 Chrome；没有明确 Codex Browser 证据时 `auto` 会回退系统浏览器。
  - Codex Agent 侧的可复用打开协议：通过 Browser plugin 的 `node_repl` runtime 执行 `setupBrowserRuntime -> agent.browsers.get("iab") -> visibility.set(true) -> browser.tabs.new() -> tab.goto(url)`；这属于当前 Agent 工具面能力，CLI 不直接控制右侧 Browser。
  - 画布按当前对话保存 scene、素材、导出图、后台进程信息和操作记录，避免多个 Codex / Claude / Cursor 窗口共用同一个画布状态。
  - 不带 `--daemon` 的前台模式只用于开发调试；日常协同应使用 daemon，避免当前 Agent 工具会话结束后页面失联。
  - 画布界面默认面向中文用户；系统或浏览器首选语言为英文时默认英文，用户也可在顶栏手动切换，选择保存在浏览器缓存中供下次打开沿用。
  - 右侧“当前对话”区域显示线程标题和 ID，ID 旁的复制按钮会复制一段已拼好标题与 ID 的 Codex 操作提示，方便用户粘贴到其他对话里继续指向同一个画布线程。
- 规划或分析：用户要求“看看、梳理、怎么改、预计动哪些文件”时，Agent 只读检查代码、文档和 OpenPrd 状态后输出证据化结论，不启动 loop 或推进任务。
- 独立脑暴：用户明确要求先梳理、进入脑暴模式，或 Agent 判断这句话需求还需要先收敛方向时，先运行 `openprd brainstorm . --topic <当前主题> --open`。
  - 脑暴页默认把“核心诉求 / 目标结果 / 当前替代方案 / 推荐方向”抬到顶部，并补出“现状与机会 / 方向对比 / 假设与验证 / 现有基础与复用”四块主体内容。
  - 底部固定提供“继续一起梳理 / 先整理验证计划 / 按这个方向整理成 PRD”三类复制指令；如需更稳定的展示文案，再用 `openprd brainstorm-presentation . --template` 生成模板并校验写回。
- 生成图片内容：用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或确认设计方向时，Codex hook 只注入提醒，不打开需求入口写入门禁。
  - Agent 默认调用 `imagegen`（Codex 原生 Image 2）产出图片，除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量产物。
  - 未发生 `imagegen` 调用前，不得声称“生图限流”或“生图失败”。
- 图标资产落地：logo、icon、avatar、badge、贴纸、空态插画、单物件 UI 位图等开发素材，如果后续要接入 UI 并需要透明背景，默认走候选评审到资产工程化链路。
  - 先用 `imagegen` 生成 3 个异源候选方向；候选图使用纯 `#00ff00` 绿幕、无文字、无 UI 容器、主体居中且留足裁切边距。
  - 用户选定方向后，Agent 再定位源图或 contact sheet，保留绿幕源图，抠成透明 PNG/WebP，裁切居中并导出 384px 或多尺寸资产。
  - 接入 UI 时按真实入口位置分别调显示比例，并同步写回 `asset-spec.md` / `selected-direction.md`。
  - Agent 可先选择可逆默认方向继续工程化；用户明确选定时覆盖默认方向。最终回复要区分绿幕源图、透明产物和是否已经接入。
- 图片与画布协同：在 Codex surface 明确提供 Image 2 且画布已绑定当前对话时，Agent 可把 `imagegen` 结果先保存为本地图片，再通过 canvas service 推入画布，替换用户选中的图片卡片或最近的空白卡片。
  - 用户也可以在画布中选择图片、形状和圈选文字，点击“发送给 Codex”把选区导出到该 session 的 `exports/`，并在 `ops.json` 里保存 `handoff` 记录。
  - 若当前 binding 是 Codex thread，画布服务端默认通过本机 Codex app-server `thread/resume -> turn/start` 把文本和本地图片路径投递到绑定 thread，并在 `relays/` 留 payload/status/log 便于排查。
  - 只有自动投递被关闭、明确失败或长时间未启动时，才追加 `agent-foreground-relay` 待发送项，由当前 Codex Agent 用 `openprd canvas --bridge-outbox --claim next` 领取并调用 Codex App 侧线程工具发送，随后用 `--bridge-sent` 或 `--bridge-failed` 回写结果。网页本身不能直接调用 Agent 工具。
  - 画布右侧提供 AI 生图模板，内置 1:1、3:4、4:3、16:9、9:16 和公众号 2.35:1 比例；用户填写指令后，画布生成带 AI 标识的生成中占位卡，把完整生图提示写入该卡片的 scene `customData`，同时追加 `handoff` 并优先走自动 thread relay。
  - 真实生图必须由当前 Codex Agent 调用原生 `imagegen` / Image 2 完成，OpenPrd 不提供自己的生图 API；生成后再通过画布回填通道携带 `placeholderId` 放回对应卡片。
  - 选区包含图片时，底部条提供低强调“下载图片”，先导出选区 PNG，再由本地服务复制到系统下载文件夹。
- 大界面改动方向评审：当界面、页面、视觉、样式或前端体验需求会明显改变信息架构、核心布局、主视觉、关键路径、组件层级/密度，或用户需要比较设计方向时，先产出方向评审材料。
  - Agent 在 PRD 定稿或实现开工前先用 Codex Computer Use 进入产品内对应功能并截图，再用 `imagegen`（Codex 原生 Image 2）基于截图产出至少 3 种不同设计思想方向，横向拼接为一张左上角标注 1/2/3 的大图；用户尚未选择时，Agent 采用可逆默认方向继续，用户选择后再覆盖。
  - 走 L1/L2 正式 review 流程时，可把 3 个方向作为 `reviewPresentation.designDirections` 写入评审展示层，让 `review.html` 渲染方向卡片；用户在 review 确认时用 `--direction <id>` 记录选定方向。
  - 如果参考图是一张整板、网格图或多对象组合，再用 `openprd visual-prepare` 生成 reference-set、contact sheet 和 compare-plan，决定哪些对象真正进入后续实现与验收；这些是 Agent 的准备责任，不创建用户停顿。
- 前端设计框架预检：当任务已经明确会落到真实界面实现，而不是只出候选效果图时，Agent 还要先读取 `.openprd/design/`。
  - 页面涉及产品名、版本、发布日期、规格、价格、地点或引用数据时，先补 `facts-sheet.md`。
  - 页面依赖 logo、产品图、UI 图、摄影图、插图、图表或品牌 token 时，先补 `asset-spec.md`。
  - 旅游、展览、案例、品牌故事、内容站、发布页等内容型页面，先判断真实图片是不是页面成立前提，必要时补 `image-preflight.md`。
  - 无明确参考方向时先补 `direction-plan.md`，Agent 把可逆默认 lens、theme、layout、组件和主要风险写回 `selected-direction.md`；用户后续拍板时更新该记录。
- 澄清与确认：当需求仍模糊、只有一句话、或需要多方案比较时，Agent 优先运行 `openprd clarify`。
  - 复杂或模糊需求先生成三轮 `intake-reflection.md`，从用户意图、项目上下文和产品质量缺口压缩出必须确认的问题；简单明确调整只做轻量项目映射，不进入完整问题墙。
  - 即使当前没有 active requirement gate，只要工作区仍处于冷启动或缺少关键字段，`clarify` 也会稳定写出 `intake-reflection.md`，并把首轮项目画像显式带回 CLI / 对话输出；仅包含 OpenPrd 自生成脚手架的 fresh init 目录继续按 `cold-start-greenfield` 处理，不误判成已有项目。
  - `clarify` 只返回 `inline` 或 `inline-with-checklist`：Agent 先在聊天里用业务和产品语言复述这次主要给谁、在哪个场景下解决什么问题、第一版先做什么、先不做什么、不能影响什么、会牵动哪些环节、有哪些业务风险；默认先追问 1 个最高价值问题，必要时再给 2 到 3 个方向和取舍供用户选，不生成或打开澄清 HTML。
  - PRD 场景视角前移到这一步：面向个人消费者场景优先看首次场景、用户感受和回访动力；面向企业服务场景优先看拍板方、使用方、推进方和上线阻力；以 Agent 为主要使用场景时优先看自主边界、人工兜底和失败恢复。
  - active requirement gate 存在时，当前 lane 的澄清、capture、synthesize、review 都优先读写 `.openprd/harness/session-states/<session>.json`，不再直接复用别的会话留下的 `state/current.json`。
  - 写回 requirement 事实时区分 `user-confirmed`、`project-derived`、`agent-inferred` 和 `agent-normalized`；明确实现意图允许 Agent 用可逆默认方案继续 `capture/classify/synthesize`，不能把字段来源变成执行门禁。
  - 合成 PRD 后会生成工具无关的 work unit id，把本轮需求、目标根目录、版本、摘要指纹和稳定评审页写入 `.openprd/engagements/work-units/`。
  - Agent 生成 spec、tasks 和对外说明时跟随用户当前主语言；无法判断时使用简体中文兜底。必要专有名词、品牌名、命令名、路径、字段名和 API 术语可以保留原文；如果只是内部措辞整理，应使用 `openprd capture . --source agent-normalized` 写回，避免把无语义变化的润色当成新的用户确认。
  - Agent 应优先把 `.openprd/artifacts/active/<version>-review/artifact.html` 这类稳定 artifact 路径给用户，而不是依赖可能被其他对话覆盖的 `engagements/active/review.html`；页面复制出的确认命令会携带 `--version`、`--digest` 和 `--work-unit`，`review` 校验一致后才记录确认状态。
  - approval policy 只记录 artifact 的评审状态，不决定 Agent 能否执行。用户说“请帮我实现/继续实现”已经表达执行意图；Agent 可自行记录当前精确匹配的 artifact 并继续，不能要求用户粘贴 review 命令或批准内部材料。
  - 如果用户刚刚确认的是现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接文案要写成“已确认，我按这个继续”，不要写成像再次索取确认的句子。
  - 已合成版本后再次 `capture` 用户确认或推导得到的 PRD 内容，会把旧评审状态标记为过期，并清掉 active 版本指针，防止多对话混用旧评审 artifact；仅用于 `agent-normalized` 的内部措辞规范化或 `reviewPresentation` 展示层写回，不会重开用户 review。
  - review、change 和 tasks 由 Agent 后台维护。用户已经要求实现时直接推进；没有执行意图时保持只读。OpenPrd 不生成 required execution checklist，也不重复请求授权。
- 业务护栏澄清：当 PRD 命中免费用户、额度、AI 生成、模型调用或第三方成本风险时，`next` 会把成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作列为待确认问题。
- 大量只读扫描：当用户明确要求深度调研、全面梳理、交叉验证、并行排查或对标复刻时，OpenPrd discovery skill 负责判断是否启动只读 subagent，并要求主 Agent 汇总证据后再写入 claim、requirements、specs 或 tasks。
- 实现或继续任务：用户明确要求开发、实现、继续、深度调研、深度对标或复刻落地时，Agent 才能运行执行命令。
  - Agent 根据当前需求与 active change 选择执行对象，并按任务 `type`、写入范围和风险决定执行模式。
  - 执行模式规则：L0 或小范围修正默认 `serial`；`implementation` 任务达到 3 个时建议 `parallel-workers`，由主 Agent 分配写入范围清晰的 worker shard，再统一 review、integrate 和总验证；达到 10 个时升级 `parallel-workers-isolated`，建议独立 worktree 或等价隔离环境并通过单任务 Loop 会话推进。
  - 显式继续历史会话时，由宿主 Agent 或应用恢复对应会话；OpenPrd 只保留当前 workspace 的 repo-local binding，不维护全局 session 归属表。
  - 任务进入 loop 前会带上测试策略和执行策略：小范围逻辑优先单元测试，触达 CLI/API/Agent 契约或跨模块状态时升级集成/契约验证，触达用户主路径、视觉、小程序、性能、安全或成本风险时升级端到端或专项验证；worker 任务显式声明 `write-scope`、`local-verify` 和 `integration-owner`。固定 70/20/10 只作健康形状参考，不作硬门禁。
  - 真实 `openprd loop --run --agent codex` 会在启动子会话前运行 `codex --version`；Codex 平台原生可选依赖缺失时，OpenPrd 停止 `codex exec` 并输出缺失包、诊断和 `npm install -g @openai/codex@latest`，只有用户显式使用 `doctor --tools codex --fix` 或 `loop --run --agent codex --repair-agent` 时才执行全局修复。
  - 新增或修改代码文件前后，Agent 先对 touched files 运行 `openprd dev-check` 或 `scripts/openprd-dev-check.mjs`；出现需要关注的文件时，最终回复必须以 **后续建议** 为标题，按 🔴 → 🟠 → 🟡 排序说明影响位置、关注程度、本次处理和后续建议。
  - 大界面改动由 Agent 先准备 3 方向效果图并选择可逆默认方向；用户明确选择时覆盖默认方向。已有参考效果图、设计稿或用户给图的界面任务，阶段性完成后截实现图并运行 `openprd visual-compare --reference/--actual --locale <zh-CN|en>` 输出左右对比 JPG，查看后继续复刻到无明显差异；参考图是整板、网格图或多对象组合时，先运行 `openprd visual-prepare` 生成 reference-set、contact sheet 和 compare-plan，再逐项比对。
  - 没有参考图但改动界面时，动手前必须截修改前图，完成后用同一入口、视口、账号和数据状态截修改后图，并运行 `openprd visual-compare --before/--after --locale <zh-CN|en>` 输出修改前后自检 JPG，确认预期变化和未改区域漂移。
  - 完成前检查当前任务证据；`docs/basic/`、文件说明书、文件夹说明书、结构化日志和其他全局材料缺口进入 `workspaceAttention`，不改写当前任务结果。
- 高风险动作提示：OpenPrd 只提供生产写入、支付、删除、账号切换、兜底和写死等风险上下文，不承担授权审批。是否需要停下确认由当前 Agent 按宿主安全规则、用户当下意图和真实目标判断；原始凭证读取等真实安全边界仍可被 hook 拒绝。
- 自我成长：执行中发现可沉淀项时，不在任务过程中打断 Agent。代码扩展识别这类白名单工具补全会自动补齐并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先作为候选留存，收工时通过 `openprd grow --review` 集中让用户确认。执行或复盘中被用户采纳的优质外部信源通过 `openprd benchmark observe` 累计到 benchmark candidate，达到阈值后只推荐 approve，不自动晋级为长期来源。
- OpenPrd 自身维护：需求涉及新增或修改配置类能力时，Agent 先判断是否 grow-aware。代码扩展识别这类白名单工具补全默认直接纳入自动应用；其他高置信可成长能力默认补 candidate type、scope、review/apply 行为；不确定时主动询问用户是否纳入 `openprd grow`。
- 文档保洁：怀疑 `docs/basic/` 有冗余噪音或巨行时，先运行 `openprd docs-compact .` 查看逐文档压缩建议；`standards --verify` 也会对巨行、平均行长退化和 `prd.md` 落后版本发 warning。压缩原则是同一事实只留一处、过时段落直接删除、巨行拆成分点，改完再跑 `standards --verify` 确认警告消除。
- 流程指引：用户问“现在到哪一步了”“接下来做什么”“这个工具怎么用”时，运行 `openprd guide .` 输出 7 步流程（需求澄清 → 需求摘要 → 后台评审记录 → 交互方向参考 → 任务拆解 → 实现执行 → 验证收口）当前位置、每步状态和下一步动作；评审与方向只作后台记录/可选覆盖，不会停住任务拆解或实现。`review.html` 顶部和画布 `/api/guide` 显示同一进度。
- 画布评审协同：界面类需求评审时，用户可在画布点“导入评审方向”，把当前 review 的 designDirections 连图带说明摆上画布（已选定方向高亮），圈选批注后用“发送给 Codex”把视觉反馈回传当前对话。
- 回归与就绪检查：实现完成后运行当前任务最小足够测试；阶段收口可再运行 `openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 和必要的 `doctor`，分别查看任务结果、工作区提醒与整体就绪声明。
  - 沉淀阶段性回归报告：前端任务优先记录界面验证策略；已有参考图的界面任务还要沉淀 `.openprd/harness/visual-reviews/` 下的 `--reference/--actual` 视觉对比图；无参考图但改动界面的任务沉淀 `--before/--after` 修改前后自检图；后端任务记录脚本或命令验证。
  - `loop --finish` 在最后一个任务完成时生成最终质量评估。未 production-ready 时保留已完成任务和已产生 commit，只返回 `workspaceAttention/claimReady=false`；最终输出结构化测试报告、HTML 回归报告和 HTML 质量评估报告。
  - 涉及消耗型成本时，还要确认额度绕过、并发请求、越权身份、成本监控、报警阈值和止损动作已覆盖。
  - 如果质量报告 `productionReady=false`，最终输出必须先区分 `taskReady` 与 `workspaceReady`，列出缺证据或需关注的本期必测块；若只剩 `feature-coverage`，说明是任务账本或覆盖证据未收口，不能把本次功能表述成失败，也不能宣称整体就绪。
- 复盘学习与经验沉淀：`openprd learn` 先生成证据清单、Agent 上下文和写作提示；标题、大纲、正文、检索练习和工作示例由 Agent 基于证据写入 `learning-content.json` 后再渲染到 `reader.html`。
  - Codex hook 会把“生成学习材料 / 教学材料 / 讲义 / 可长期阅读材料”等学习型交付物按产物形态路由到该流程，并在 Stop 阶段检查本轮是否已有 reader 骨架和 Agent-authored 内容。
  - 已验证修复、重复问题、高影响排障或 Agent 误判问题会先通过 `openprd quality --learn --review --from <turn-state|report|diagnostics>` 生成 `.openprd/knowledge/candidates/` 和 `.openprd/knowledge/drafts/` 下的待确认草案，再通过 `openprd quality --learn --from <candidate-dir|report>` promote 为 `.openprd/knowledge/skills/` 下的项目级经验 skill。

## 状态变化

- OpenPrd 不选择或注入 Agent 上下文；显式继续历史会话由宿主 Agent 或应用精确恢复，不能用当前 active change 猜一个相近目标。
- runtime environment 仍作为 repo-local 平台证据；Image 2、Computer Use、Codex-owned browser window、对话协同画布和当前线程文本桥接等 surface-dependent 能力必须以当前工具面或 hook/session evidence 为准。
- `canvas` 状态按 thread/session 分桶，不写入全局 active 画布。
  - 显式 `--thread/--session` 的优先级高于环境变量和 runtime environment；`--thread-title/--session-title` 只更新展示名，不改变分桶。只有完全缺少对话证据时才使用 workspace fallback，且输出会提醒 Agent 补显式绑定。
  - 后台服务状态写入当前画布 session 的 `server.json/server.log`，同一 binding 可用 `openprd canvas . --thread <id> --stop` 停止。
  - 选区导出操作会在 `ops.json` 中记录 `manual-export`、`download-selected-image` 或 `codex-handoff` 意图、选中元素数量、选中元素 ID 和页面语言；点击“发送给 Codex”会追加 `handoff` 和默认的 `handoff-relay` 操作，保存目标平台、交接 transport、导出图路径、提示文本、当前 binding 标题以及 `relays/` 里的 payload/status/log。
  - `agent-foreground-relay` 只作为自动 relay 不可用时的兜底队列，状态由当前 Agent 用 `--bridge-outbox --claim`、`--bridge-sent` 和 `--bridge-failed` 推进。
- `run --verify` 默认只面向当前项目主验证状态；`mode=reference` 的 discovery run 不会自动混入主校验，参考调研需通过 `openprd discovery` 命令单独查看。
- 默认 hook 保留轻量 PreToolUse advisory，并把 matcher 收窄到直接编辑工具；`Stop` 不做完整工具级遥测，只在本轮结束前回顾 touched files 和 verify/finish 信号。
  - 若本轮 touched code files 需要用户关注，Stop 会把带标题的 **后续建议** 表格注入最终回复；否则再判断是否生成项目经验草案。
  - `guarded` 会额外覆盖 shell 工具，只有 `full` profile 才启用更重的全量工具级诊断。
  - hook 只记录或打开 requirement-intake 安全通道，不把 matcher 当作最终 L2 判断；Agent 需要先用 `openprd-requirement-intake` 做语义分流。
  - 带报错、日志、复现、根因排查等故障证据且用户明确要求直接修复的小型 bugfix 不进入需求入口，已打开入口也接受“确认修复”等自然确认词。
- `loop --run`、`tasks --advance`、`discovery --advance`、`finish --commit` 只有在用户明确执行意图下才进入执行状态。
- 深度 discovery 的只读 subagent 输出只作为候选证据，最终状态更新仍由主 Agent 通过 OpenPrd claim、任务和验证流程落地。
- standards 遇到嵌套 Git 参考仓库或 `toolkit-sources` 这类明显外部参考候选时，会先提示候选和归类命令，而不是直接把逐文件说明书缺口作为主阻塞；只有显式归类后才会稳定写入 `externalReferences.paths`。
- `standards --verify` 除结构检查外还输出 `docsQuality`：巨行（>300 字符）、平均行长退化和 `prd.md` 落后 requirement 版本会产生 warning；`openprd docs-compact` 提供逐行压缩建议，只读不写。
- `clarify` 会先产出 `intake-reflection.md` 作为可审计的内部自省记录，再用 `inline` 或 `inline-with-checklist` 在 CLI 和对话内输出轻量澄清提纲。澄清阶段不生成 HTML，也不会自动打开浏览器；需要用户正式评审时，统一进入后续 `review.html`。无 active requirement gate 的冷启动工作区，只要还缺关键字段，也会保留这份首轮项目画像记录。
- `synthesize` 会产出稳定版本评审页和 active 快捷入口，交互式 CLI 自动打开稳定版本评审页。
  - 评审页用需求概览、需求关系图或需求流程图、四个带重点摘要胶囊的固定评审卡片和底部固定双按钮工具栏，把问题、范围、主流程、业务护栏、风险和开放问题压缩成需求定稿前的人机确认界面；顶部不展示低价值计数和状态噪音。
  - 需求关系图使用紧凑高度和小尺寸节点：节点标题由 Agent 控制在 15 字以内，节点正文左对齐且每个卡片正文控制在 30 字以内；HTML 优先读取 `reviewPresentation.mapNodes` 和 `reviewPresentation.flowNodes` 作为图中展示文案，不直接裁剪原文。
  - Agent 可以先运行 `openprd review-presentation . --template` 获取展示文案模板，再用 `openprd review-presentation . --presentation review-presentation.json --fail-on-violation` 校验。
  - 校验通过后用 `openprd capture . --field reviewPresentation --value "$(cat review-presentation.json)" --source agent-inferred` 写入展示层；也可以用随包发布的 `scripts/openprd-review-presentation.mjs` 做同样校验。
  - 界面类需求可在展示层附加 `designDirections`（2 到 4 个方向，含 id、标题、交互稿图片、方案摘要和取舍说明）；`review.html` 渲染方向卡片和“采用这个方向”按钮，复制出的反馈记录自动带 `--direction <id>`。Agent 可以先采用可逆默认方向，用户后续选择再覆盖。
  - review 上下文会输出 `presentationContract`、`presentationFeedback`、`versionId`、`digest` 和 `workUnitId`，让 Agent 重新提炼超限内容，并在记录反馈时校验是否仍是本轮需求。
  - “主流程与边界情况”卡片内用轻量 SVG 小图展示用户旅程、关键步骤、边界情况和恢复路径，再展示明细列表。四个评审卡片的明细分点应写成 `- **摘要内容**：明细一句话`，缺少该结构时通过 `presentationFeedback` 提醒 Agent 重写。
  - 重点摘要胶囊控制在 15 个字以内，HTML 侧按内容自适应宽度并完整显示，不使用省略号截断；评审卡片副标题句末不加句号。
  - 底部工具栏固定在窗口底部，只保留“需要调整”和“按当前方向推进”两个反馈动作，点击复制内容必须带上版本、摘要指纹、work unit、标题和 review 上下文，并明确记录反馈不影响用户已要求的实现。
  - 面向用户的 review.html 和 diagram HTML 文案不得使用 `freeze` 等内部词，也不得用“需求定稿前”“进入实现前确认”制造隐性停顿；应表达为后台参考、待完善信息和可被用户反馈覆盖的可逆默认方向。Agent 必须告知稳定 HTML 路径。
  - `review --mark confirmed` 只记录当前精确匹配的 PRD 版本；传入的 `--version`、`--digest` 或 `--work-unit` 与快照不一致时拒绝错误写回，但不阻断用户已经要求的实现。
  - 实现意图和 review 记录彼此独立：用户说“可以开做”“请帮我实现”或“继续实现”时，Agent 继续执行并后台维护当前 artifact，不能要求用户替内部材料补确认。
- `review-presentation --write` 成功后会触发 active artifacts 归档清扫：`.openprd/artifacts/active/` 只保留最新 12 个版本 bundle，更早的移入 `.openprd/artifacts/archive/`。
- `change --generate` 以当前 requirement 快照生成实现材料，不依赖用户批准 review；生成任务写入 `type`、`test-layer`、`test-size`、`test-scope`、`evidence-plan` 以及 `execution-mode`、`parallel-group`、`write-scope`、`owner-role`、`local-verify`、`integration-owner` 元数据。
  - `implementation` 和 `verification` 任务默认使用 `tasks --evidence-required` 作为局部证据门，要求 Agent 传入本任务 evidence 或 waiver，而不是每个任务都运行全局 `run --verify`。
  - 旧版任务若仍写着 `verify: openprd run . --verify`，在 `tasks --verify` 上下文中也会转为局部 evidence 门，不触发 workspace quality churn。
  - `documentation` 和 `governance` 任务以 `blocking: false` 作为后台维护项，不会排到实现/验证任务之前，也不阻断 change apply；测试策略元数据用于 evidence routing，不用于机械比例考核；执行策略元数据用于主 Agent 做 worker 分片和最终审查，不直接触发自动并行。
- `loop --finish` 会同时产出 Markdown 测试报告和 HTML 回归报告，并在报告里记录本任务测试策略、执行命令、结果和证据路径，用于复盘、交接和重复验证。
- 大界面改动进入实现前，`.openprd/harness/visual-reviews/` 保存 3 方向横向效果图评审大图和 Agent 的可逆默认方向；用户明确选择后更新方向记录。
- `visual-prepare` 会把确认后的整板、网格图或多对象参考图整理成 reference-set，生成 crops、contact sheet、compare-plan 和 board 模板，作为逐项视觉验收的准备层。
- `visual-compare` 会把效果图和实现截图合成左右对比图片，也会把修改前和修改后截图合成自检图片，默认输出 JPG 到 `.openprd/harness/visual-reviews/`。
  - 它只用于实现阶段视觉证据，不能替代 Codex Image 2 的图片或效果图生成，也不能替代大界面改动的实现前方向评审。
  - 同构列表、卡片、网格或表格的 `alignment-board` 必须同时覆盖容器轨道和内部内容槽位；只量外框、列宽或行顶不算完整对齐验收。
  - 单个素材、图标、头像、徽标、按钮图形或图片内部居中/视觉重心判断使用 `centering-board`，必须同时记录画布中心、主体外接框中心和视觉重心偏移；单张截图或主观判断不算完整居中验收。
- `dev-check` 只检查 Agent 本次传入的代码文件，不扫描全仓库；它会把需要关注的文件转成产品和业务可读的关注程度：🟡 低风险｜建议留意、🟠 中风险｜建议优先关注、🔴 高风险｜需要先处理。无需额外说明的改动不进入用户可见提醒。
- `dev-check` 的 JSON 结果包含 `wrapUp.title`、`wrapUp.rows`、`wrapUp.markdownTable` 和 `wrapUp.markdownBlock`；当 touched files 需要用户关注时，CLI 会打印“后续建议”，Stop hook 会把同一张面向产品和业务的影响提示表交给最终回复使用，并按 🔴 → 🟠 → 🟡 的关注程度排序。
- `dev-check` 若遇到未配置扩展名但内容明显像代码，会先按代码候选参与本次分级。置信度达到自动补全阈值时直接把扩展名追加到 `.openprd/standards/config.json` 并在 `.openprd/growth/accepted.json` 留证据；置信度不足或不属于工具识别补全时，只写入 `.openprd/growth/candidates.jsonl` 等收工复盘。
- 新增配置能力时，状态变化不止是“写入代码”：Agent 还要给出该能力是否纳入 growth 的判断。代码扩展识别这类白名单工具补全可直接自动固化；用户偏好、项目协作规矩和 OpenPrd 默认行为等需要用户决定的内容停在收工确认状态。
- `benchmark observe` 更新 `.openprd/benchmarks/inbox/` candidate 的累计采纳次数、最近 7 天滚动采纳统计、最近使用时间和证据；`benchmark approve` 是唯一把来源移入 approved registry 的动作。`benchmark verify` 会独立校验推荐阈值、approve command 和“只推荐、不自动晋级”的控制状态是否漂移。
- `quality --verify` 会产出 `.openprd/quality/reports/<id>.json` 和 `.openprd/quality/reports/<id>.html`，HTML 回归测试报告是阶段性质量查看的主要产物，包含整体结果、需求模块结果、测试块状态、分层测试策略矩阵、本次执行证据和业务成本与滥用护栏。
- `quality --verify` 写入报告后按 `reports.retentionMaxReports`（默认 60）自动修剪 `.openprd/quality/reports/` 中的旧报告，避免报告目录无限增长；`retentionEnabled: false` 可关闭。
- `quality --learn --review` 会先生成 knowledge candidate 和 draft skill；`quality --learn` 再把已确认的模式抽象为 incident、pattern 和项目经验 Skill，形成“问题修复 -> 验证 -> 草案 -> 沉淀 -> 下次触发”的项目级认知循环。
- `learn` 默认进入 `awaiting-agent-content` 状态，只提供 HTML 阅读器骨架和 Agent 写作工具包；传入 `--content-json` 后才进入 `agent-authored` 状态并展示正文。
- 新增或修改代码文件会先触发研发期行数回顾；新增或修改任何文件还会触发文档影响判定：缺失文档进入补齐状态，已有但受影响的文档进入更新状态，无需更新时要说明理由。
- standards、validate 或 doctor 失败时，状态回到修复阶段，不应声明实现完成。

## 维护规则

- 每次用户流程、页面跳转、任务状态或异常处理发生变化后，必须检查并更新本文件。
- 更新时同一事实只保留一处最新版本；不要在既有长行末尾继续追加句子，新增事实写成新的分点；过时内容直接删除，不保留“更新：”式追加痕迹。
