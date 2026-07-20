<!-- OPENPRD:AGENTS:START -->
## OpenPrd Harness

本项目由 OpenPrd 管理。Agent 应优先遵循 repo-local skills 和 hooks；`AGENTS.md` 只保留轻量入口合同。

### Scope

- skill 路由放在 `openprd-router`，命令清单放在 command catalog，强约束放在 hooks。
- `AGENTS.md` 只说明入口、默认行为和高风险门禁，不再承载静态长清单。

### Entry Points

- 先读 `skills/openprd-router/SKILL.md`；在生成的 Codex / Claude 环境里，优先读同名 `openprd-router` skill。
- 需要具体命令时，优先读 `.openprd/harness/command-catalog.md`，不要继续把命令清单膨胀回 `AGENTS.md`。
- `$openprd-shared`：共用语言、文档影响、敏感信息、浏览器安全、小程序验证、产品文案与 i18n 规则。
- `$openprd-requirement-intake`：需求入口分流、用户可见需求类型与内部 L0/L1/L2 路由码对照、PRD 场景视角选择，以及创业验证闭环。
- `$openprd-test-strategy`：测试策略分流、分层验证、任务级 evidence-plan、升级原因与豁免理由。
- `$openprd-harness`：主工作流、`run/loop`、review/change/tasks 与执行节奏。
- `$openprd-frontend-design`：前端设计框架、审美资产库、设计主题/骨架/组件/配方/模板，以及事实、素材、图片和方向前置门。
- `$openprd-benchmark-router`：外部技术、公开 GitHub 仓库、benchmark/对标/最佳实践路由。
- `$openprd-standards` / `$openprd-quality`：`docs/basic/`、就绪验证、EVO 门禁、知识沉淀。
- `$openprd-diagram-review` / `$openprd-discovery-loop`：可视评审与长时间只读挖掘。
- 当前对话环境与平台能力包：优先看 `.openprd/harness/runtime-environment.json`，协议和能力清单看 `.openprd/harness/install-manifest.json` 的 `runtimeDetection` / `platformCapabilityPacks`。

### 默认行为

1. 动手前先判断 executionMode。无人值守自动化（Codex automation、Claude Code headless、cron、scheduled、unattended task）默认不阻断写入，不要求 `openprd dev-check` / `quality` / `doctor`；除非 automation prompt 明确写明“这是 OpenPrd 维护任务”“显式启用 OpenPrd / enable OpenPrd / openprd-maintenance”。
1a. Agent 自己管理当前会话上下文；OpenPrd 只记录工作区事实、Hook 证据和验证结果。
1a. 代码搜索默认从当前任务相关源码、测试和 change/task 文件起步；不要把 `.openprd/quality/reports/`、`.openprd/harness/` 或 `.openprd/learning/` 当源码目录做 repo-wide `rg`。质量报告只在需要审阅就绪证据时按最新报告路径显式读取。
2. 规划、分析、架构评审、“怎么改”或“会动哪些文件”类请求保持只读；只有用户明确要求实现、继续任务、深度调研、对标复刻或提交时才进入执行。
3. 先分流再执行：`openprd-requirement-intake` 按影响面、未知数、决策成本和验证成本判断需求类型，并保留内部路由码对照：直接处理=L0，现有功能优化=L1，新功能/新流程方案=L2。用户审查默认把路由码并进“需求类型：直接处理（L0）”这类标签里；只有内部排障确实受益时，才额外附“内部路由码”。直接处理类需求可直接处理并事后说明，不打开正式 PRD/review/change/tasks；现有功能优化先在对话内给 mini-plan 再执行，默认不生成正式 PRD/change/tasks；新功能/新流程方案的 requirement、PRD、review、change 和 tasks 由 Agent 在后台维护，不阻断用户已经要求的实现。L2 的 requirement 摘要默认按“需求判断 / 需求理解 / 功能范围 / 技术方案”整理，其中“功能范围”和“技术方案”优先用 Markdown 表格；如果仍在 0 到 1 探索，再补验证与创业闭环。只有真实产品歧义会明显改变结果时才提一个必要问题。“请帮我实现/继续实现”表示有效执行意图；requirement、capture/classify/synthesize、review、change 和 tasks 由 Agent 在后台维护，不追加 OpenPrd 确认门禁。`review.html` 是稳定评审 artifact，不是授权门禁。
3a. 已归档或既有的 requirement、PRD、review、change、tasks 与实现记录是冻结历史，不根据当前代码推断、补写或改写。旧功能重新进入需求流程时，为本轮创建新的 current requirement/change，并通过引用关联历史记录；`docs/basic/` 与代码说明书属于随实现维护的活文档，可在当前任务后台同步。
3b. 0 到 1 探索的验证与创业闭环至少覆盖：第一批最容易触达的社区或种子用户、你为什么算这个社区里的自己人、当前替代方案与痛点证据、先怎么手工交付、手工作战卡怎么写、能否先用 spreadsheet / 表单 / no-code 跑起来、必须做产品时是否只自动化最重复的一步、第一版只做哪一件事、能否压成周末级 MVP、从第一个客户开始怎么收费、客户 1 如何打平成本、有没有 10 个样本和更强付费信号、达到什么条件才允许产品化、增长阶段守什么纪律、这条路是否可逆，以及是不是你愿意长期住进去的业务形态。
4. change/tasks 就绪后，用 `openprd-test-strategy` 按风险选择单元、集成、端到端、人工、视觉、小程序、性能或安全验证组合，并在任务或报告中保留 evidence-plan；同时根据任务边界记录 execution strategy：小范围修正保持 `serial`，中等规模 L1/L2 可推荐 `parallel-workers`，高风险或大规模实现再升级到 `parallel-workers-isolated`；70/20/10 只作健康形状参考，不作硬门禁。
5. 纯图片、封面图、配图、海报、插画、图标、贴纸、mockup 或“先看样子”请求按生图路由选工具：先判断当前对话工具面，Codex 环境用原生 `imagegen`（Image 2），Cursor 环境用内置 `GenerateImage`；都不可用或无法判断时，先读 `.openprd/harness/image-generation-preference.json`，没有偏好再询问用户，绝不擅自调用用户本地或自有付费生图 API。生图前写清用途、受众、气质、约束和记忆点并做 anti-slop 自检。生图结果先当候选效果图，Agent 展示候选方向并说明采用的可逆默认方向；OpenPrd 不强制等待确认，用户明确选择时再覆盖默认方向并更新 reference-set。实现阶段按参考图形态使用 `visual-prepare` 与 `visual-compare`；没有参考图时，新界面完成 3 方向评审并采用可逆默认方向，既有界面做 before/after。用户反馈“不一致”“好丑”“复刻”时至少给出一份视觉证据图。学习型交付物需要章节、证据锚点或长期阅读体验时，优先用 `openprd learn .` 生成学习包和阅读器。
5a. 对 logo、icon、avatar、badge、贴纸、空态插画、单物件 UI 位图等开发素材，如果最终要接入 UI 并需要透明背景，生成 3 个差异足够大的纯 `#00ff00` 绿幕独立素材候选。Agent 可保留候选源图并选择可逆默认方向，不创建用户确认停顿；用户明确选定时优先采用。随后保留绿幕源图，用 `remove_chroma_key.py` 生成透明 PNG/WebP，按真实 UI 需要裁切居中并导出多尺寸资产，接入后同步写回 `asset-spec.md` 和 `selected-direction.md`。
5b. 卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，仍可按 L0/L1 小范围修正推进，不自动升级成大界面 3 方向方案评审；但它是用户可见变化，动手前要有一句审美意图和记忆点，收口必须补 `visual-compare` 修改前后图、局部焦点证据板、截图实测证据板、对齐辅助线证据板或内部居中证据板，并检查气质、层级、颜色、字号、间距和表面角色是否成立。只要界面里有同构列表、卡片、网格或表格，就把容器轨道以及标题、副标题、描述、标签、状态、价格、按钮、图标、操作区等相同文案类型/相同组件槽位的对齐当作默认验收项，不等用户先投诉；只量外框、列宽或行顶不算完整对齐验收。只要任务在判断单个素材/图标/头像/徽标/按钮图形的内部居中、偏心或视觉重心，就把 centering-board 当作默认验收项；单张原始截图或主观“看起来居中”不算完整居中验收。build、package、`openprd dev-check` 和单张原始截图不能替代视觉证据。`visual-compare` 每次都会返回 `chatEmbed` markdown；生成证据板后必须把这行 `![视觉证据: ...](路径)` 直接嵌入最终回复，让证据在对话流里可见，不要只报告文件路径；`openprd dev-check` 在触达界面文件且最近 24 小时没有证据板时也会输出视觉证据提醒，收口前按提醒补齐。
5c. 大界面三方向是 Agent 的默认责任，不要求用户另行提出生图；轻量 UI 微调不触发。已有界面时，Codex 原生 App 用 Computer Use、Codex 网页环境用 Chrome 插件任务专用窗口、Cursor 用可用浏览器或项目预览能力截图；三个方向必须共享同一张当前截图作为 image-to-image 参考。除非用户明确要求换风格，否则锁定字体角色、色彩系统、明暗模式、表面语言、圆角/边框/阴影、图标语言、平台框架和信息密度，只探索布局、信息层级、导航、关键路径与空间构图。冷启动没有现有界面时才使用 design brief，不伪造修改前截图。候选图先明确用途、目标用户、业务约束、核心动作、气质和唯一记忆点，并检查字体、色彩、空间、层级、表面/图标语言和动效含义；拒绝无依据蓝紫渐变、默认字体、等权白卡堆叠、过量大圆角、无语境装饰和只换颜色的伪方向。
5d. 生图工具是工具路径，不是审美豁免；无品牌或参考依据时，用 anti-slop 排除默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰。logo、icon、avatar、badge 等默认按独立素材输出（standalone asset）。若期望产物是否需要章节结构、证据锚点、图文讲解或长期阅读体验，优先用 `openprd learn .`，不要用关键词表触发；“仙侠风格的学习材料”也按学习型交付物处理，风格作为 `--genre` 题材参数。
6. 界面、页面、视觉、样式、信息架构或前端体验任务先读取 `$openprd-frontend-design`，并由 Agent 在后台维护 `.openprd/design/active/` 的 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction`；这些材料不要求用户填写或批准。空白工作区优先从 `.openprd/design/templates/` 选择最近模板。用户已给效果图时以其为主参考；主题和模块明确时优先运行 `openprd design-starter . --starter <starter-id> --out index.html` 起第一版真实页面。starter 落地后进入 advisory Patch Mode：优先在入口文件或 sibling draft 上尽快形成真实实现，避免长时间只读漫游；hook 只记录 `allowed-with-patch-mode-attention`，不阻断当前工具调用。整页重写时先写 sibling draft 再覆盖入口，避免入口空窗；最终按真实状态区分 starter、部分实现和完成实现。
6c. 页面主题和模块明确时，starter 命令补全 `--brief "<页面主题>" --sections "<模块1|模块2|模块3>"`。只有页面确实不依赖外部事实、品牌素材或真实图片时，才在 active design artifacts 写清无依赖并使用 `--no-external-facts --no-brand-assets --no-real-images`；旅游、导览、展览、博物馆、城市、自然观察或案例内容页先不要带 `--no-real-images`，让 starter 先尝试补首批真实图片。Patch Mode 即使结构要大改，也不要删除 `index.html` 后另起新稿；在原入口补丁修改或先完成 sibling draft 再覆盖。没有参考图时先判断新建界面还是修改既有界面，并让 visual evidence 同时检查气质、层级、字体/色彩/表面角色和记忆点。
6a. 写产品界面上用户能看到的文案时，必须站在当前用户视角写：这句话要说明用户现在能做什么、会发生什么、为什么值得点、下一步怎么走。除非这是面向开发者或专业技术人员的技术型产品，否则默认用普通人能看懂的语言写结果、状态、限制和行动，不要暴露 API、SDK、模型、数据库、缓存、错误码或内部模块。正反例：不要写“适合想保留全部工具入口的用户”，改写成“首页会显示所有工具入口，你可以直接选择需要的功能”；不要写“API 请求失败，错误码 500”，改写成“暂时保存失败，请稍后再试”；技术型产品可以保留必要术语，但仍要写清用户动作、影响和修复路径。
6b. 开发新功能出现新的入口、按钮、tab、卡片、空态或工具格时，默认自动配图标，不等用户提出：先复用项目已有图标体系；项目没有时按图标最佳实践路由选型（UI 图标 Phosphor，落码 Lucide/Tabler/React Icons，AI 品牌 LobeHub Icons，技术栈 Tech Icons，功能图标/插画 iconfont），把图标名、来源、用途登记到 `.openprd/design/active/asset-spec.md` 的“功能图标”行再接入。只有语义确实不需要图标或用户明确说不要时才跳过，并在收口说明原因。
7. 用户给出会话 ID 并要求继续时，按工具无关的历史会话续接；不要要求工具专属 ID，也不要用当前 active change 或相似历史替代指定会话。
8. 单个 task 收尾时只运行本任务最小足够验证，并通过 `--evidence`、测试报告或任务 metadata 留下 task-scoped evidence；代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check . <file...>`。阶段收口、全部实现完成、handoff/commit/release/publish 前，再运行 `openprd standards . --verify`、`openprd quality . --verify` 和 `openprd run . --verify`；L2 或跨页面实现的最终回复必须列出最新 HTML 质量报告和 task-scoped Markdown/HTML 测试报告路径。如果还没有 `.openprd/harness/test-reports/` 下的 Markdown / HTML 测试报告，就不要把状态表述成项目级已经闭环。
9. 微信小程序相关任务默认按“最小足够验证”执行：只有用户明确要求小程序实测、截图、抓日志/网络、复现问题，或当前改动必须依赖运行态证据时，才升级到本地小程序运行态验证；默认沿用当前小程序运行态或开发者工具会话连续验证，不要为了验证自动重开应用；只有用户明确要求从 0 到 1、冷启动或重开时，才从头启动。如果当前客户端没有相应工具，不要假定已经安装，也不要把缺少工具当成阻断。
10. `openprd init/setup/update/doctor` 记录的 `optionalCapabilities` 是非阻断式增强建议。当前任务明显受益但能力还未配置时，可在后续建议里说明它能帮什么、附官方文档 / GitHub 链接，并询问用户是否需要按当前客户端补配置；不要因为它未配置就阻断当前任务。
11. 判断当前用户正在和 Codex、Claude Code 还是 Cursor 对话时，先看 `.openprd/harness/runtime-environment.json` 的 hook/session evidence，再按 install manifest 里的 `platformCapabilityPacks` 启用平台专属能力。Codex 原生 Image 2、Computer Use、Codex-owned browser window、OpenPrd 对话协同画布和 Codex 当前线程桥接属于 surface-dependent 能力，只有当前工具面或 hook/session 证据明确支持时才使用；画布必须绑定当前 thread/session，无法自动识别时用 `openprd canvas . --thread <id> --thread-title <name>` 或 `--session <id> --session-title <name>` 显式隔离，标题只用于当前对话展示；当前线程桥接只在 Codex App 当前 thread binding 明确时使用，浏览器写入 handoff 后由 OpenPrd 服务端默认通过 Codex app-server `thread/resume -> turn/start` 提交到绑定线程，失败或关闭时才进入 `agent-foreground-relay` 兜底队列；不要仅凭 Codex CLI、`.codex/config.toml` 或 `CODEX_HOME` 推断可用。

### Hook-Enforced Gates

- automation-safe：识别到 Codex automation、Claude Code headless、cron、scheduled 或 unattended task 时，hook 默认不阻断写入、不要求 dev-check / quality / doctor；只有 OpenPrd 维护任务或显式启用 OpenPrd 时才恢复这些检查。
- requirement：requirement、PRD、review、change 和 tasks 是 Agent 后台维护材料，不阻断实现、不索取用户确认。
- research：公开 GitHub 架构/对标优先 DeepWiki；第三方技术用法、配置、限制、版本差异或迁移先查本地证据，不足时按 `resolve_library_id -> query_docs` 使用 Context7。证据缺口只产生 `allowed-with-research-attention`，不阻断当前工作。
- design：界面、页面、视觉和前端体验任务由 Agent 在后台维护 `$openprd-frontend-design` 与 `.openprd/design/active/` 合同；缺口只产生 `allowed-with-design-attention`。Patch Mode 同样是 advisory，不限制工具调用。
- skill-visualization：修改 skill、`SKILL.md`、`AGENTS.md` 或相关 workflow 前，用彩色 Mermaid 说明方案；它是可视说明，不是用户授权门禁，用户已要求修改时可继续执行。
- autonomy-risk：风险识别只向 Agent 提供配置化、迁移、标准状态机、幂等脚本和可回滚发布路径建议，不承担授权审批；OpenPrd 不因生产、支付、删除、账号切换、兜底、写死或材料缺失阻断工具调用，也不索取用户确认，是否需要确认由当前 Agent 依据宿主安全规则和真实上下文自行判断。
- secrets / weapp / browser / copy：分别处理 `secrets-vault`、按需的小程序运行态验证、窗口归属与 i18n/普通用户文案提醒。
- 需要细节时，读 router 指向的 skill 和 command catalog，而不是继续扩写 `AGENTS.md`。

### High-Risk Gate

For interactive OpenPrd flows, run `openprd standards . --verify`, `openprd quality . --verify`, `openprd run . --verify`, and `openprd doctor .` around freeze, handoff, commit, push, release, or publish when applicable. Their findings are readiness evidence and do not add an OpenPrd authorization stop; host safety rules, real permissions, and user scope remain authoritative. Unattended automation uses its own runbook unless it explicitly opts into OpenPrd.
If the quality report says `productionReady=false`, do not claim overall readiness. Reuse `openprd run . --verify` to separate current-task status from workspace-level debt, list the missing evidence or gates, and when only `feature-coverage` is pending describe it as task-ledger or evidence debt rather than a failed implementation.
The only baseline documentation path is `docs/basic/`.
<!-- OPENPRD:AGENTS:END -->
