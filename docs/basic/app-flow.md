# 产品流程说明

## 核心流程

OpenPrd 的核心流程：用户在项目中初始化或接入 `.openprd/` 工作区，Agent 先读只读状态，再分流需求类型，确认后进入 review/change/tasks 与执行验证。

### 状态接入与工作区

- Agent 先读取 `openprd run --context`、`status`、`next` 等只读状态，再决定下一步。
- `.openprd/` 是唯一工作区；新 change/spec/task/archive 都写入 `.openprd/changes/`、`.openprd/specs/` 和 `.openprd/archive/changes/`。
- 更新旧项目时会把历史根目录 `openprd/` 工作产物迁入 `.openprd/`。

### 需求分流

- 用 `openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本判断当前输入属于直接处理、现有功能优化还是新功能/新流程方案，内部保留 L0/L1/L2 路由码。
- 当用户明确说“帮我梳理下”“先想清楚”“进入脑暴模式”，或一句话需求明显还需要先收敛业务方向、用户、商业目标、竞品和内部复用时，先进入 `openprd brainstorm`，汇总 benchmark、knowledge、当前工作区和开放问题，生成稳定 `brainstorm.html` 工作台。
- 脑暴模式默认追问和呈现：现在怎么解决、为什么现在要换、谁拍板/谁受影响、第一批最容易触达的社区/种子用户、先不做完整产品时怎么手工交付、手工作战卡、一件事 MVP、周末级验证、如果必须开始做产品也只自动化最重复的一步并先压成 forms / lists / CRUD 骨架、第一批客户路径、从第一个客户开始怎么收费、客户 1 如何打平成本、什么承诺才算真需求、有没有 10 个样本和更强付费信号、最低成本验证、先活下来约束、达到什么条件才允许产品化、增长纪律、可逆性、客户真问题、价值观一致性、止损线和可复用基础。确认方向后再进入需求入口分流。

### L2 需求确认路径

- L2 通过 `intake-reflection.md` 做需求入口自省，并把 `clarify` 压缩成对话内轻量确认或简短清单。
- 只有 requirement 摘要里的 target、scope、out-of-scope 和 acceptance 已被用户确认，或用户明确表示“不需要进行任何确认”时，才允许继续 `capture/classify/synthesize` 写入路径，再通过 `review.html` 帮用户看清楚、比较清楚、确认清楚。
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
- 空白前端冷启动如果用户原话已经明确页面主题、模块范围或“直接实现”的意图，优先用 `openprd run --context --message <用户原话>` 对齐路径。
- `design-starter` 生成入口文件后，默认立即进入 `Patch Mode`，围绕同一路径继续细化页面，而不是 delete-first 后再重建。
- `Patch Mode` 的完成定义：不只是在对话里说明计划、下载素材或补合同，而是把最终结构、样式、真实图片或参考约束真正落进入口文件，清掉主要占位，再同步 active design artifacts。
- 界面类 L1/L2 需求在 review 阶段可通过 `reviewPresentation.designDirections` 把 3 个 `imagegen` 交互方向卡片放进 `review.html`；用户用 `openprd review . --mark confirmed --direction <id>` 一次完成 review 确认和方向选定。

### 执行与质量

- 执行段通过 tasks、loop、回归报告和必要的视觉评审证据把实现与验证沉淀成结构化证据。
- 用 `openprd-test-strategy` 为任务选择单元、集成、端到端、人工、视觉、小程序、性能或安全验证组合。
- 用 execution strategy 为任务标注 `serial / parallel-workers / parallel-workers-isolated`、`write-scope`、`owner-role`、`local-verify` 和 `integration-owner`。
- 质量段通过 `openprd quality --verify` 生成 HTML 回归测试报告，优先展示整体回归结果、逐需求模块结果、测试块通过情况、分层测试策略矩阵、未通过项和需确认遗漏。
- 执行阶段的单个任务只保留最小足够 task evidence；阶段收口或整体交付前再经过 standards 和 quality 门禁，确认基础文档、文件说明书、文件夹说明书、日志、业务护栏、测试策略、执行模式、视觉方案确认、视觉复刻或修改前后自检证据和评估证据是否需要补齐或更新。
- EVO 只作为内部质量评估/验证层代号，不作为用户读报告的前置概念。

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
  - Codex hook 默认使用 `lite`：在明确 OpenPrd/深度流程提示词和新产品、模块、流程类需求下注入上下文，用只匹配直接编辑工具的轻量写入门禁阻断未确认需求的实现改动，并在本轮结束前通过 `Stop` 回顾是否值得沉淀项目经验。
- 当前环境识别：`setup/update` 会把 `runtimeDetection` 和 `platformCapabilityPacks` 写入 install manifest，并初始化 `runtime-environment.json`。
  - Codex hook 每次收到 SessionStart、UserPromptSubmit、PreToolUse、PostToolUse 或 Stop 时，把 hook/session payload 观察到的 active client、surface、confidence、session、turn、agent type、model、evidence 和 observed capabilities 写入 runtime environment。
  - `run --context` 与 `doctor` 再读取这份状态，先识别当前对话平台，再选择 Codex、Claude Code 或 Cursor 对应能力包。
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
  - 用户选定前不写项目文件；最终回复要区分绿幕源图、透明产物和是否已经接入。
- 图片与画布协同：在 Codex surface 明确提供 Image 2 且画布已绑定当前对话时，Agent 可把 `imagegen` 结果先保存为本地图片，再通过 canvas service 推入画布，替换用户选中的图片卡片或最近的空白卡片。
  - 用户也可以在画布中选择图片、形状和圈选文字，点击“发送给 Codex”把选区导出到该 session 的 `exports/`，并在 `ops.json` 里保存 `handoff` 记录。
  - 若当前 binding 是 Codex thread，画布服务端默认通过本机 Codex app-server `thread/resume -> turn/start` 把文本和本地图片路径投递到绑定 thread，并在 `relays/` 留 payload/status/log 便于排查。
  - 只有自动投递被关闭、明确失败或长时间未启动时，才追加 `agent-foreground-relay` 待发送项，由当前 Codex Agent 用 `openprd canvas --bridge-outbox --claim next` 领取并调用 Codex App 侧线程工具发送，随后用 `--bridge-sent` 或 `--bridge-failed` 回写结果。网页本身不能直接调用 Agent 工具。
  - 画布右侧提供 AI 生图模板，内置 1:1、3:4、4:3、16:9、9:16 和公众号 2.35:1 比例；用户填写指令后，画布生成带 AI 标识的生成中占位卡，把完整生图提示写入该卡片的 scene `customData`，同时追加 `handoff` 并优先走自动 thread relay。
  - 真实生图必须由当前 Codex Agent 调用原生 `imagegen` / Image 2 完成，OpenPrd 不提供自己的生图 API；生成后再通过画布回填通道携带 `placeholderId` 放回对应卡片。
  - 选区包含图片时，底部条提供低强调“下载图片”，先导出选区 PNG，再由本地服务复制到系统下载文件夹。
- 大界面改动方向确认：当界面、页面、视觉、样式或前端体验需求会明显改变信息架构、核心布局、主视觉、关键路径、组件层级/密度，或用户需要先选择设计方向时，先做方向评审再实现。
  - Agent 在 PRD 定稿或实现开工前先用 Codex Computer Use 进入产品内对应功能并截图，再用 `imagegen`（Codex 原生 Image 2）基于截图产出至少 3 种不同设计思想方向，横向拼接为一张左上角标注 1/2/3 的大图并展示给用户确认。
  - 走 L1/L2 正式 review 流程时，可把 3 个方向作为 `reviewPresentation.designDirections` 写入评审展示层，让 `review.html` 渲染方向卡片；用户在 review 确认时用 `--direction <id>` 记录选定方向。
  - 用户确认方向前不进入大 UI 实现；确认后如果参考图是一张整板、网格图或多对象组合，再用 `openprd visual-prepare` 生成 reference-set、contact sheet 和 compare-plan，决定哪些对象真正进入后续实现与验收。
- 前端设计框架预检：当任务已经明确会落到真实界面实现，而不是只出候选效果图时，Agent 还要先读取 `.openprd/design/`。
  - 页面涉及产品名、版本、发布日期、规格、价格、地点或引用数据时，先补 `facts-sheet.md`。
  - 页面依赖 logo、产品图、UI 图、摄影图、插图、图表或品牌 token 时，先补 `asset-spec.md`。
  - 旅游、展览、案例、品牌故事、内容站、发布页等内容型页面，先判断真实图片是不是页面成立前提，必要时补 `image-preflight.md`。
  - 无明确参考方向时先补 `direction-plan.md`，用户拍板后再把选中的 lens、theme、layout、组件和主要风险写回 `selected-direction.md`。
- 澄清与确认：当需求仍模糊、只有一句话、或需要多方案比较时，Agent 优先运行 `openprd clarify`。
  - 复杂或模糊需求先生成三轮 `intake-reflection.md`，从用户意图、项目上下文和产品质量缺口压缩出必须确认的问题；简单明确调整只做轻量项目映射，不进入完整问题墙。
  - 即使当前没有 active requirement gate，只要工作区仍处于冷启动或缺少关键字段，`clarify` 也会稳定写出 `intake-reflection.md`，并把首轮项目画像显式带回 CLI / 对话输出；仅包含 OpenPrd 自生成脚手架的 fresh init 目录继续按 `cold-start-greenfield` 处理，不误判成已有项目。
  - `clarify` 只返回 `inline` 或 `inline-with-checklist`：Agent 先在聊天里用业务和产品语言复述这次主要给谁、在哪个场景下解决什么问题、第一版先做什么、先不做什么、不能影响什么、会牵动哪些环节、有哪些业务风险；默认先追问 1 个最高价值问题，必要时再给 2 到 3 个方向和取舍供用户选，不生成或打开澄清 HTML。
  - PRD 场景视角前移到这一步：面向个人消费者场景优先看首次场景、用户感受和回访动力；面向企业服务场景优先看拍板方、使用方、推进方和上线阻力；以 Agent 为主要使用场景时优先看自主边界、人工兜底和失败恢复。
  - active requirement gate 存在时，当前 lane 的澄清、capture、synthesize、review 都优先读写 `.openprd/harness/session-states/<session>.json`，不再直接复用别的会话留下的 `state/current.json`。
  - 在写回 requirement 事实前，当前 lane 需要先在对话里确认 target、scope、out-of-scope 和 acceptance；只有这些摘要已被确认，或用户明确表示“不需要进行任何确认”时，才允许继续 `capture/classify/synthesize` 写入路径。
  - 合成 PRD 后会生成工具无关的 work unit id，把本轮需求、目标根目录、版本、摘要指纹和稳定评审页写入 `.openprd/engagements/work-units/`。
  - Agent 生成 spec、tasks 和对外说明时跟随用户当前主语言；无法判断时使用简体中文兜底。必要专有名词、品牌名、命令名、路径、字段名和 API 术语可以保留原文；如果只是内部措辞整理，应使用 `openprd capture . --source agent-normalized` 写回，避免把无语义变化的润色当成新的用户确认。
  - Agent 应优先把 `.openprd/artifacts/active/<version>-review/artifact.html` 这类稳定 artifact 路径给用户，而不是依赖可能被其他对话覆盖的 `engagements/active/review.html`；页面复制出的确认命令会携带 `--version`、`--digest` 和 `--work-unit`，`review` 校验一致后才记录确认状态。
  - 默认 approval policy 是 `decision-points`：当前 lane 仍需要人类决策时，先让用户评审当前稳定 artifact，再记录确认；只有当用户明确表示“不需要进行任何确认”时，lane 才能进入 `silent-record`，跳过 requirement 摘要确认并只对当前精确匹配的 artifact 直接记录 review。单纯的“请帮我实现/继续实现”或“不要评审”都不触发这个豁免。
  - 如果用户刚刚确认的是现有功能优化（L1）的 mini-plan、范围边界或正式产品边界，后续承接文案要写成“已确认，我按这个继续”，不要写成像再次索取确认的句子。
  - 已合成版本后再次 `capture` 用户确认或推导得到的 PRD 内容，会把旧评审状态标记为过期，并清掉 active 版本指针，防止多对话混用旧评审 artifact；仅用于 `agent-normalized` 的内部措辞规范化或 `reviewPresentation` 展示层写回，不会重开用户 review。
  - 未记录 review 或标记为 `needs-revision` 的 PRD 不能生成 OpenPrd change 或进入实现；当前 artifact 记录完成后应先运行 `openprd change --generate` 产出 specs 和 tasks。若用户原始意图已经明确要求实现，tasks 就绪后可直接继续执行；否则先展示执行确认清单，列出本轮目标、将执行内容、不做事项、验证方式和已知风险，再请求明确执行授权。
- 业务护栏澄清：当 PRD 命中免费用户、额度、AI 生成、模型调用或第三方成本风险时，`next` 会把成本来源、额度限制、滥用防护、监控信号、报警阈值和止损动作列为待确认问题。
- 大量只读扫描：当用户明确要求深度调研、全面梳理、交叉验证、并行排查或对标复刻时，OpenPrd discovery skill 负责判断是否启动只读 subagent，并要求主 Agent 汇总证据后再写入 claim、requirements、specs 或 tasks。
- 实现或继续任务：用户明确要求开发、实现、继续、深度调研、深度对标或复刻落地时，Agent 才能运行执行命令。
  - `openprd run --context` 优先推荐已确认 PRD 的 change 生成；已有 active change 时按任务 `type` 统计实质实现任务并给出执行模式建议。
  - 执行模式规则：L0 或小范围修正默认 `serial`；`implementation` 任务达到 3 个时建议 `parallel-workers`，由主 Agent 分配写入范围清晰的 worker shard，再统一 review、integrate 和总验证；达到 10 个时升级 `parallel-workers-isolated`，建议独立 worktree 或等价隔离环境并通过单任务 Loop 会话推进。
  - 显式继续历史会话时，`run --context` 先查 `~/.openprd/registry/sessions.jsonl`，先找回真实 workspace，再从目标工作区的 session binding、requirement gate、事件和 work unit 线索恢复该需求线；只要恢复到别的 workspace、或命中显式 session / task-handle / work-unit，默认升级为隔离执行建议，不与当前 active change 共用一条执行线。
  - 任务进入 loop 前会带上测试策略和执行策略：小范围逻辑优先单元测试，触达 CLI/API/Agent 契约或跨模块状态时升级集成/契约验证，触达用户主路径、视觉、小程序、性能、安全或成本风险时升级端到端或专项验证；worker 任务显式声明 `write-scope`、`local-verify` 和 `integration-owner`。固定 70/20/10 只作健康形状参考，不作硬门禁。
  - 真实 `openprd loop --run --agent codex` 会在启动子会话前运行 `codex --version`；Codex 平台原生可选依赖缺失时，OpenPrd 停止 `codex exec` 并输出缺失包、诊断和 `npm install -g @openai/codex@latest`，只有用户显式使用 `doctor --tools codex --fix` 或 `loop --run --agent codex --repair-agent` 时才执行全局修复。
  - 新增或修改代码文件前后，Agent 先对 touched files 运行 `openprd dev-check` 或 `scripts/openprd-dev-check.mjs`；出现需要关注的文件时，最终回复必须以 **后续建议** 为标题，按 🔴 → 🟠 → 🟡 排序说明影响位置、关注程度、本次处理和后续建议。
  - 大界面改动必须先有 3 方向效果图评审和用户选定方向。已有参考效果图、设计稿或用户给图的界面任务，阶段性完成后必须截实现图并运行 `openprd visual-compare --reference/--actual --locale <zh-CN|en>` 输出左右对比 JPG，查看后继续复刻到无明显差异；参考图是整板、网格图或多对象组合时，先运行 `openprd visual-prepare` 生成 reference-set、contact sheet 和 compare-plan，再逐项比对。
  - 没有参考图但改动界面时，动手前必须截修改前图，完成后用同一入口、视口、账号和数据状态截修改后图，并运行 `openprd visual-compare --before/--after --locale <zh-CN|en>` 输出修改前后自检 JPG，确认预期变化和未改区域漂移。
  - 完成前还要检查 `docs/basic/`、文件说明书、文件夹说明书、结构化日志、业务护栏、测试策略、执行模式、视觉方案确认、视觉复刻或自检证据和评估证据是否缺失或过期。
- 高风险自行动作门禁：实现授权不自动包含云端热修复、生产远端写入、业务兜底、写死逻辑、客户端/服务端补业务数据或缓存补行。Codex hook 会在写入或远端命令前检查这类动作；当前用户消息没有明确允许时，Agent 必须回到本地源码、配置、迁移或数据修复脚本路径，或先说明影响范围、回滚方式、本地同步计划和验证方式后再等待用户批准。
- 自我成长：执行中发现可沉淀项时，不在任务过程中打断 Agent。代码扩展识别这类白名单工具补全会自动补齐并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先作为候选留存，收工时通过 `openprd grow --review` 集中让用户确认。执行或复盘中被用户采纳的优质外部信源通过 `openprd benchmark observe` 累计到 benchmark candidate，达到阈值后只推荐 approve，不自动晋级为长期来源。
- OpenPrd 自身维护：需求涉及新增或修改配置类能力时，Agent 先判断是否 grow-aware。代码扩展识别这类白名单工具补全默认直接纳入自动应用；其他高置信可成长能力默认补 candidate type、scope、review/apply 行为；不确定时主动询问用户是否纳入 `openprd grow`。
- 文档保洁：怀疑 `docs/basic/` 有冗余噪音或巨行时，先运行 `openprd docs-compact .` 查看逐文档压缩建议；`standards --verify` 也会对巨行、平均行长退化和 `prd.md` 落后版本发 warning。压缩原则是同一事实只留一处、过时段落直接删除、巨行拆成分点，改完再跑 `standards --verify` 确认警告消除。
- 流程指引：用户问“现在到哪一步了”“接下来做什么”“这个工具怎么用”时，运行 `openprd guide .` 输出 7 步流程（需求澄清 → 需求摘要 → 评审确认 → 交互方向选择 → 任务拆解 → 实现执行 → 验证收口）当前位置、每步状态和下一步动作；`review.html` 顶部渲染同款阶段条，画布右栏“评审协同”区通过 `/api/guide` 显示同一进度。
- 画布评审协同：界面类需求评审时，用户可在画布点“导入评审方向”，把当前 review 的 designDirections 连图带说明摆上画布（已选定方向高亮），圈选批注后用“发送给 Codex”把视觉反馈回传当前对话。
- 回归与就绪检查：实现完成后运行项目测试、`openprd standards --verify`、`openprd quality --verify`、`openprd run --verify` 和必要的 `doctor`。
  - 沉淀阶段性回归报告：前端任务优先记录界面验证策略；已有参考图的界面任务还要沉淀 `.openprd/harness/visual-reviews/` 下的 `--reference/--actual` 视觉对比图；无参考图但改动界面的任务沉淀 `--before/--after` 修改前后自检图；后端任务记录脚本或命令验证。
  - `loop --finish` 在最后一个任务完成时自动执行最终质量门禁，未 production-ready 时不标记最终任务完成。最终输出结构化测试报告、HTML 回归报告和 HTML 质量评估报告。
  - 涉及消耗型成本时，还要确认额度绕过、并发请求、越权身份、成本监控、报警阈值和止损动作已覆盖。
  - 如果质量报告 `productionReady=false`，最终输出必须先区分 `taskReady` 与 `workspaceReady`，列出缺证据或需关注的本期必测块；若只剩 `feature-coverage`，说明是任务账本或覆盖证据未收口，不能把本次功能表述成失败，也不能宣称整体就绪。
- 复盘学习与经验沉淀：`openprd learn` 先生成证据清单、Agent 上下文和写作提示；标题、大纲、正文、检索练习和工作示例由 Agent 基于证据写入 `learning-content.json` 后再渲染到 `reader.html`。
  - Codex hook 会把“生成学习材料 / 教学材料 / 讲义 / 可长期阅读材料”等学习型交付物按产物形态路由到该流程，并在 Stop 阶段检查本轮是否已有 reader 骨架和 Agent-authored 内容。
  - 已验证修复、重复问题、高影响排障或 Agent 误判问题会先通过 `openprd quality --learn --review --from <turn-state|report|diagnostics>` 生成 `.openprd/knowledge/candidates/` 和 `.openprd/knowledge/drafts/` 下的待确认草案，再通过 `openprd quality --learn --from <candidate-dir|report>` promote 为 `.openprd/knowledge/skills/` 下的项目级经验 skill。

## 状态变化

- `run --context` 只产生建议上下文，不自动授权执行；如果显式继续历史会话，恢复顺序是“全局 session registry -> 目标 workspace 的 repo-local 线索 -> change/task/work unit”，而不是“先用当前 workspace 的 active change 猜一个相近目标”。
- `run --context` 会附带 runtime environment 摘要；如果 active client 是 Codex，就优先使用 Codex 能力包，但 Image 2、Computer Use、Codex-owned browser window、对话协同画布和当前线程文本桥接等 surface-dependent 能力仍必须以当前工具面或 hook/session evidence 为准。
- `canvas` 状态按 thread/session 分桶，不写入全局 active 画布。
  - 显式 `--thread/--session` 的优先级高于环境变量和 runtime environment；`--thread-title/--session-title` 只更新展示名，不改变分桶。只有完全缺少对话证据时才使用 workspace fallback，且输出会提醒 Agent 补显式绑定。
  - 后台服务状态写入当前画布 session 的 `server.json/server.log`，同一 binding 可用 `openprd canvas . --thread <id> --stop` 停止。
  - 选区导出操作会在 `ops.json` 中记录 `manual-export`、`download-selected-image` 或 `codex-handoff` 意图、选中元素数量、选中元素 ID 和页面语言；点击“发送给 Codex”会追加 `handoff` 和默认的 `handoff-relay` 操作，保存目标平台、交接 transport、导出图路径、提示文本、当前 binding 标题以及 `relays/` 里的 payload/status/log。
  - `agent-foreground-relay` 只作为自动 relay 不可用时的兜底队列，状态由当前 Agent 用 `--bridge-outbox --claim`、`--bridge-sent` 和 `--bridge-failed` 推进。
- `run --context` 和 `run --verify` 默认只面向当前项目主验证状态；`mode=reference` 的 discovery run 不会自动混入主上下文或主校验，参考调研需通过 `openprd discovery` 命令单独查看。
- 默认 hook 保留轻量 PreToolUse 写入门禁，并把 matcher 收窄到直接编辑工具；`Stop` 不做完整工具级遥测，只在本轮结束前回顾 touched files 和 verify/finish 信号。
  - 若本轮 touched code files 需要用户关注，Stop 会把带标题的 **后续建议** 表格注入最终回复；否则再判断是否生成项目经验草案。
  - `guarded` 会额外覆盖 shell 工具，只有 `full` profile 才启用更重的全量工具级诊断。
  - hook 只负责注入或打开 requirement-intake 安全通道，不把 matcher 当作最终 L2 判断；Agent 需要先用 `openprd-requirement-intake` 做语义分流，L0 直接处理，L1 给对话内 mini-plan，L2 才进入 PRD/review/change/tasks。
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
  - 界面类需求可在展示层附加 `designDirections`（2 到 4 个方向，含 id、标题、交互稿图片、方案摘要和取舍说明）；`review.html` 渲染方向卡片和“选这个方向”按钮，复制出的确认命令自动带 `--direction <id>`。
  - review 上下文会输出 `presentationContract`、`presentationFeedback`、`versionId`、`digest` 和 `workUnitId`，让 Agent 重新提炼超限内容并在确认时校验是否仍是本轮需求。
  - “主流程与边界情况”卡片内用轻量 SVG 小图展示用户旅程、关键步骤、边界情况和恢复路径，再展示明细列表。四个评审卡片的明细分点应写成 `- **摘要内容**：明细一句话`，缺少该结构时通过 `presentationFeedback` 提醒 Agent 重写。
  - 重点摘要胶囊控制在 15 个字以内，HTML 侧按内容自适应宽度并完整显示，不使用省略号截断；评审卡片副标题句末不加句号。
  - 底部工具栏固定在窗口底部，只保留“需要调整”和“认可方案”两个动作，点击复制内容必须带上版本、摘要指纹、work unit、标题和 review 上下文。
  - 面向用户的 review.html 和 diagram HTML 文案不得使用 `freeze` 这类内部词，应改写为“需求定稿前”或“进入实现前确认”。Agent 必须告知稳定 HTML 路径。
  - 当前 lane 仍要求人类决策时，确认请求要围绕这份稳定 artifact 发起；`review --mark confirmed` 只用于记录当前精确匹配的 PRD 版本，如果传入的 `--version`、`--digest` 或 `--work-unit` 与快照不一致，确认会被阻断。
  - 实现授权和 review 记录是两个独立门禁；就算用户已经说“可以开做”、单纯说“请帮我实现”或“继续实现”，也不能替另一份 artifact 补确认；只有用户明确表示“不需要进行任何确认”的 `silent-record` lane 中，才可以对当前精确匹配的稳定 artifact 直接记录 review，然后继续 change / tasks。
- `review-presentation --write` 成功后会触发 active artifacts 归档清扫：`.openprd/artifacts/active/` 只保留最新 12 个版本 bundle，更早的移入 `.openprd/artifacts/archive/`。
- `change --generate` 只能在最新 PRD review 已确认后执行，并会在生成的任务里写入 `type`、`test-layer`、`test-size`、`test-scope`、`evidence-plan` 以及 `execution-mode`、`parallel-group`、`write-scope`、`owner-role`、`local-verify`、`integration-owner` 元数据。
  - `implementation` 和 `verification` 任务默认使用 `tasks --evidence-required` 作为局部证据门，要求 Agent 传入本任务 evidence 或 waiver，而不是每个任务都运行全局 `run --verify`。
  - 旧版任务若仍写着 `verify: openprd run . --verify`，在 `tasks --verify` 上下文中也会转为局部 evidence 门，不触发 workspace quality churn。
  - `documentation` 和 `governance` 任务用于保证文档和流程收口不会被误计为实现复杂度；测试策略元数据用于 evidence routing，不用于机械比例考核；执行策略元数据用于主 Agent 做 worker 分片和最终审查，不直接触发自动并行。
- `loop --finish` 会同时产出 Markdown 测试报告和 HTML 回归报告，并在报告里记录本任务测试策略、执行命令、结果和证据路径，用于复盘、交接和重复验证。
- 大界面改动进入实现前，`.openprd/harness/visual-reviews/` 应先保存 3 方向横向效果图评审大图和用户选定方向记录；该评审位于需求分流之后、PRD 定稿或实现开工之前。
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
