---
name: openprd-harness
description: 驱动 OpenPrd 工作区完成从澄清到 handoff 的主流程。适用于初始化 OpenPrd、查看 `.openprd/` 状态、选择下一条命令、推进 classify/interview/synthesize/freeze/handoff，或解释如何安全推进 OpenPrd 工作区。
---

# OpenPrd Harness

## 概览

这份 skill 负责主工作流编排。把它当成串起命令和产物的领域 skill；共用守则由 `$openprd-shared` 提供。

`AGENTS.md` 只保留轻量合同；入口路由优先看 `skills/openprd-router/SKILL.md`，具体命令速查看 `.openprd/harness/command-catalog.md`，更细的工作流步骤、路由边界和 hook 门禁以这份 skill、`$openprd-shared` 和 `$openprd-benchmark-router` 为准。

执行时优先继承 `$openprd-shared` 的用户心智与表达规则：用户懂业务和产品，但不想读技术黑话；默认耐心低、成本敏感，需要 Agent 主动补全遗漏，并用最短路径说明结论和下一步。

## 动手前

1. 读取第一个可用的共用规则文件：`skills/openprd-shared/SKILL.md`、`$HOME/.claude/skills/openprd-shared/SKILL.md` 或 `$HOME/.codex/skills/openprd-shared/SKILL.md`
2. 从 `.openprd/` 重建当前工作区状态
3. 如果用户期待自动化 agent 引导，运行 `openprd doctor <path>`，必要时用 `openprd setup <path>` 或 `openprd update <path>` 修复
   - `init/setup/update/doctor` 可能会在 `.openprd/harness/install-manifest.json` 的 `optionalCapabilities` 里记录 Context7、DeepWiki 等非阻断式增强建议。把它当成软提醒：初始化、诊断和当前任务都不因它失败；只有当前任务会明显受益时，才在后续建议里解释能力价值、附官方文档 / GitHub 链接，并视情况提出可代为补配置。
4. 选择执行单元前，优先运行 `openprd run <path> --context`
5. 把 `openprd run <path> --context` 当作建议，不要自动执行其中的写入命令
   - 如果当前轮是空白工作区的前端/页面冷启动，而且用户已经明确给出页面主题、模块范围或“直接实现”的意图，优先改用 `openprd run <path> --context --message <用户原话>`，不要先跑不带 message 的 context
   - 如果这类前端冷启动在带 message 后仍短暂返回 `clarify-user`，但用户原话已经足够明确，就把它当成 requirement 摘要级提醒；先用 3 到 5 行 mini-plan 收口，再按 `$openprd-frontend-design` 的 `design-starter -> Patch Mode` 路径继续，不要回到 `docs/basic/` 占位文档里打转
   - 同时查看推荐里的 `executionMode` 和 `parallelPlan`：L0/小范围修正默认 `serial`，中等规模 L1/L2 可推荐 `parallel-workers`，高风险或大规模实现再升级到 `parallel-workers-isolated`
   - 如果用户给出会话 ID 并要求继续，按工具无关的历史会话精确续接；不要要求或使用工具专属 ID，也不要用当前 active change、相似历史或当前 requirement gate 替代该会话 ID
   - 如果用户没有给 ID，但明确描述了某个已有需求、change、task 或 work unit，先把这段描述交给 `openprd run <path> --context --message <用户原话>` 做显式对象解析，不要先默认拿当前 active change
6. 需求复杂度先交给 `$openprd-requirement-intake` 分流；不要按固定关键词判断。它会根据影响面、未知数、决策成本和验证成本判断需求类型，并保留内部路由码对照：直接处理=L0、现有功能优化=L1、新功能/新流程方案=L2；默认把路由码并进“需求类型：直接处理（L0）”这类标签里，只有内部排障确实受益时才额外补“内部路由码”
   - 如果需求涉及界面、页面、视觉、样式或前端体验，先判断是否属于“大界面改动”：会改变信息架构、页面布局、主视觉、关键路径、核心组件密度/层级，或用户需要先选设计方向。大界面改动在需求分流后、进入实现或 PRD 定稿前，先走视觉方案评审。
   - 如果只是卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，仍按 L0/L1 小范围修正推进，不自动升级成大界面方案评审；但它是用户可见变化，动手前要有一句审美意图和记忆点，收口必须补 `visual-compare`、`focus-board`、`verification-board` 或 `alignment-board` 证据，并检查气质、层级、颜色、字号、间距和表面角色是否成立。只要界面里有同构列表、卡片、网格或表格，就把相同文案类型/相同组件槽位的对齐当作默认验收项，不等用户先投诉。build、package 和 `dev-check` 不能替代视觉证据。
   - 任何界面、页面、视觉、样式或前端体验任务在进入实现前，都要额外读取 `$openprd-frontend-design`，并优先检查 `.openprd/design/active/` 下是否已经补齐 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction`。
   - 如果用户已经给了效果图、设计稿、参考截图或其他明确参考图，先把它视为主参考源；只有现有 starter、theme、layout 足够接近时才复用，不接近就允许偏离默认组合，不要为了套库把页面做成另一种样式。
   - 如果 `design-starter` 之后需要整页重写，默认先写 sibling draft，再覆盖回 `index.html`；不要让入口文件在 rewrite 过程中出现空窗。
   - `design-starter` 一旦落地，只允许做一轮就地对焦：快速读一次生成的入口文件和必要的 active design artifacts；这轮对焦结束后，下一步就必须是真实写入口，不要再回头搜网页、翻 `docs/basic/` 或继续模板漫游。
   - 把最后一批必要的查事实、查图、读模板动作放在口头宣布之前做完；一旦已经说“开始覆盖入口文件”或“开始整页重写”，下一步必须出现真实写文件动作；不能继续只读浏览、长时间压图或停在口头承诺。
   - 如果用户目标是把工作转成可学习、可复用、可回看、可教学或可沉淀的材料，先按期望产物形态判断是否需要 `$openprd-learning-review`：需要章节结构、证据锚点、图文讲解、检索练习、工作示例或长期阅读体验时，优先用 `openprd learn <path> --topic <主题>` 生成学习包骨架、阅读器和证据清单；不要用关键词表触发，普通 Markdown 只能作为辅助讲义。
7. 如果用户是在规划、分析、架构评审，或问“怎么改”“会动哪些文件”，保持只读并基于证据回答
8. 实现任务完成代码修改后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check <path> <file...>` 或 `node scripts/openprd-dev-check.mjs <path> <file...>`：700 行以内正常；701-1500 行需留意；超过 1500 行说明后续改动成本较高。自动优化开启（默认）时，命中需要关注的文件先在本轮直接完成高内聚低耦合拆分（不丢功能、行为不变、拆完重跑测试），最终回复以 **OpenPRD 自动优化报告** 为标题复用 dev-check 表格（列：影响对象、问题级别、源文件规模、优化原因、本次处理结果、后续建议）并附开关确认一句话；关闭后（`openprd dev-check <path> --auto-refactor off`）以 **后续建议** 为标题输出推荐表格（列：影响对象、关注程度、规模信号、预警原因、本次处理结果、后续建议）。两种模式都按 🔴 → 🟠 → 🟡 排序
9. 执行过程中发现新代码后缀、豁免路径、命令别名、项目约定或用户偏好时，不要中途打断当前任务。工具识别补全和减少重复打扰这类高置信低风险项可自动补齐并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先沉淀为候选，收工时运行 `openprd grow <path> --review` 集中确认
10. 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），默认先做 grow-aware 自检：高置信应可成长时直接纳入 `openprd grow` 体系；不确定时主动询问用户是否做成可成长配置
11. 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup、先看样子或先确认设计方向时，默认直接调用 `imagegen`，也就是 Codex 原生 Image 2，产出图片；Image 2 是工具路径，不是审美豁免，生成前先写清用途、受众、气质、约束和记忆点，并用 anti-slop 避免默认紫白/蓝紫渐变、通用字体、白底卡片堆叠和无语境装饰；除非用户明确指定 HTML、SVG、CSS、Canvas、代码稿或可编辑矢量/source artifact，不要改用临时 HTML/SVG/CSS 再截图。OpenPrd 的 `review.html` 只用于需求评审，不能替代图片或效果图生成；只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。生图结果先当候选效果图，不要默认登记到 `.openprd/harness/visual-reviews/`；如果用户还要继续做实现，主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现
12. 大界面改动进入实现前，先按用户目标、信息架构变化、视觉决策成本和验证风险判断是否需要视觉方案评审：已有界面时用 Codex Computer Use 进入产品内对应功能并截当前真实界面；冷启动没有现有界面时基于已确认 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成设计 brief；再调用 `imagegen`（Codex 原生 Image 2）至少生成 3 个不同设计思想方向；把效果图横向拼接成一张大图，左上角标注 1/2/3，先作为候选效果图展示；主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/`，未确认前不要进入大 UI 实现
   - 3 个方向不能只是同一种安全解的轻微变化。至少要在 `.openprd/design/active/direction-plan.md` 里区分不同生成逻辑、适用场景、审美主张、记忆点和主要风险。
   - 一旦用户确认方向，先在 `.openprd/design/active/selected-direction.md` 锁定选中的 lens、theme、layout、组件、审美主张和记忆点，再进入编码。
13. 界面、页面、视觉、样式或前端体验任务中，如果已经有确认参考图、设计稿、图片资产、截图或用户给图且进入实现阶段，阶段性完成后先截实现图，再运行 `openprd visual-compare <path> --reference <效果图> --actual <实现截图> --locale <zh-CN|en>`。如果一张参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare <path> --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，生成 reference-set、contact sheet 和 compare-plan，再逐项对比。如果没有明确参考图，先判断新建界面还是修改既有界面：新建界面回到实现前 3 方向方案评审，修改既有界面动手前先截修改前截图，完成后用同一入口、视口、账号和数据状态截修改后截图，再运行 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`。需要审局部细节时，再补 `openprd visual-compare <path> --board <focus-board.json> --locale <zh-CN|en>`；如果局部变化需要放到同一张证据板里审阅，默认优先把局部变化组合成一张 `focus-board` 再统一验收；并行跑了多个优化方向时，再补 `openprd visual-compare <path> --board <parallel-board.json> --locale <zh-CN|en>`。如果只是轻量 UI 可视优化，至少留下修改前后自检图、截图实测证据板或对齐辅助线证据板，并检查本轮审美意图和记忆点是否成立；新功能或改动包含同构列表、卡片、网格、表格时，默认补 `openprd visual-compare <path> --board <alignment-board.json> --locale <zh-CN|en>`，把真实截图、辅助线和相同槽位 spread 放到同一张证据板里；只跑 build、package、`dev-check` 或只看单张截图，都不能宣称视觉已完成。默认输出 JPG 到 `.openprd/harness/visual-reviews/`；查看合成图后继续复刻或自检，直到结构、气质、层级、字体/色彩/表面角色和记忆点都没有明显差异或意外漂移；如果用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图。对 `design-starter -> Patch Mode` 的静态首页而言，真正完成还包括：入口文件本体已经改完、主要占位已清掉、已准备好的真实图片或参考约束已经落进页面，不是只补合同或只下载素材。
14. 实现任务新增或修改文件时，做文档影响检查：缺失的 `docs/basic/`、文件说明书、文件夹 README 要补齐；受影响的已有文档要更新；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议与不适用说明
   - 如果这轮实现补充了新的前端设计主题、布局骨架、组件 recipe 或 anti-slop 规则，同步更新 `.openprd/design/` 与 `docs/basic/frontend-guidelines.md`，不要只留在代码里。
15. 长时间实现任务使用 `openprd loop <path> --plan --change <id>`，并且只有当前用户消息明确要求开发、继续任务、深度调研、对标复刻或提交时，才为每个 loop 任务启动一个全新 agent 会话
16. 需要完整工作流细节时，使用 `openprd status` 和 `openprd next`
17. 用户要求最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先路由到 `$openprd-benchmark-router`
18. 用户要求界面更好看、更稳定、有一致审美、能复用视觉资产或内置模板时，先路由到 `$openprd-frontend-design`
19. 用户要求基线文档、文件说明书、文件夹 README 标准或实现就绪检查时，路由到 `$openprd-standards`
20. 用户要求日志、链路追踪、业务成本护栏、免费额度、滥用防护、评估执行环境、冒烟覆盖、性能基线、极端场景、HTML 质量评估报告或项目级经验 Skill 时，路由到 `$openprd-quality`
21. 用户需要可视化说明，或系统/产品形态仍不清晰时，在进入需求定稿前路由到 `$openprd-diagram-review`
22. 默认保持 Codex hooks 轻量。除非项目明确需要完整工具级遥测，否则 `openprd setup/update` 使用 `--hook-profile lite`；默认 `lite` 会保留 `Stop` 收工回顾，用于在本轮结束前提醒是否值得沉淀项目经验，并要求 Agent 用“本次情况 / 准备整理成的经验 / 以后如何复用 / 只保留在当前项目里”的结构化人话向用户确认
23. hook 默认不因 PRD、review、change、tasks、设计合同、测试报告或视觉证据尚未补齐而阻断用户要求的正常实现。缺失材料由 Agent 在后台自动补齐；来不及补齐时继续完成安全范围内的工作，并在收口如实说明证据状态，不把流程作业转嫁给用户。
24. 风险识别只向 Agent 提供提醒和更安全的实现建议，不承担授权审批。命中“兜底、写死、补数据、权益、额度、生产、支付、删除、账号”等词时先看真实动作对象，优先改成配置、迁移、标准状态机、幂等脚本或可回滚发布路径并继续。OpenPrd 不因风险词或动作类型阻断工具调用，也不向用户索取确认、指定句子、摘要、digest、work-unit id 或命令；是否需要确认由当前 Agent 依据宿主安全规则和真实上下文自行判断。
25. 当 `doctor` 报告生成引导漂移时，读取 `.openprd/harness/drift-report.json`
26. `openprd run . --context` 会返回 `runtimeEnvironment`。先按 `.openprd/harness/runtime-environment.json` 和 install manifest 的 `platformCapabilityPacks` 判断当前对话是在 Codex、Claude Code 还是 Cursor，再启用对应能力；Codex Image 2、Computer Use、Codex-owned browser window、对话协同画布和当前线程文本桥接都必须有当前 surface 或 hook/session 证据，不能只凭 Codex CLI 或配置文件存在来启用。当前线程桥接只在 Codex App 明确提供线程发送工具时使用；画布图片仍以导出路径或 Markdown 图片引用作为证据，不宣称网页能自动直发附件。

## 主工作流

### 1. 初始化或定位工作区

- 如果 `.openprd/` 不存在，使用：
  - `openprd init <path> --template-pack <base|consumer|b2b|agent>`
- `init` 会同时创建 standards 和 agent integration，包括 Codex、Claude、Cursor 的生成引导、项目级 Codex hooks 和用户级 Codex hooks feature flag
- `init` 也会创建质量状态，包括 `.openprd/quality/config.json`、`.openprd/quality/reports/` 和 `.openprd/knowledge/`
- `init` 也会创建自我成长候选队列，包括 `.openprd/growth/candidates.jsonl`、`accepted.json`、`rejected.json` 和本地偏好文件
- 如果 standards 缺失，或用户要求修复：
  - `openprd standards <path> --init`
- 如果生成的 agent 引导或 hooks 缺失：
  - `openprd setup <path>`
  - `openprd doctor <path>`
- 如果生成引导存在但漂移了：
  - `openprd update <path>`
  - `openprd doctor <path>`
- hook 驱动执行循环使用：
  - `openprd run <path> --context`
  - `openprd run <path> --verify`
  - 让 `.openprd/harness/run-state.json`、`iterations.jsonl` 和 `learnings.md` 成为持久循环状态
  - 不要把 `run --context` 建议当作直接用户命令
  - 用户给出会话 ID 续接历史任务时，使用 `openprd run <path> --context --message <用户原话或会话ID>` 保留通用会话 ID 语义；先恢复指定会话，不要让当前 active change 抢主线
  - 用户没有给 ID、但明确描述了已有需求/任务对象时，也使用 `openprd run <path> --context --message <用户原话>`；先解析对应的 change/task/work unit，再决定是否沿用当前工作区状态
  - 默认 lite Codex hooks 会为明确的 OpenPrd、PRD、深度调研、对标复刻、standards、fleet、文档标准化提示词，以及结构上较复杂的需求注入 `$openprd-requirement-intake` 分流提示；直接处理(L0)不打开 requirement 维护，现有功能优化(L1)用对话内 mini-plan 承接，新功能/新流程方案(L2)在后台维护 PRD/review/change/tasks；`PreToolUse` 不因这些材料缺失阻断实现；`Stop` 只提醒 Agent 评估是否值得生成项目经验草案，不强制用户确认
  - 只有当项目确实需要完整 hook 遥测或临时深度诊断时，才用 `openprd update <path> --hook-profile full`
- 长程实现循环使用：
  - `openprd loop <path> --init`
  - `openprd loop <path> --plan --change <id>`
  - `openprd loop <path> --next`
  - `openprd loop <path> --prompt --agent codex`
  - `openprd loop <path> --run --agent codex --dry-run`
  - `openprd loop <path> --run --agent claude --dry-run`
  - `openprd loop <path> --run --agent codex` 真实执行前会先运行 `codex --version`；若缺 Codex 平台原生可选依赖，默认只诊断并提示修复命令，不静默安装
  - `openprd doctor <path> --tools codex --fix` 和 `openprd loop <path> --run --agent codex --repair-agent` 是显式修复入口，只有用户同意全局执行 `npm install -g @openai/codex@latest` 后才使用
  - `openprd loop <path> --finish --item <task-id> --commit`
  - 让 `.openprd/harness/feature-list.json`、`progress.md`、`agent-sessions.jsonl`、`loop-state.json` 和 `loop-prompts/` 成为持久实现状态；feature list 里的 execution strategy 会为 worker shard 标注 `write-scope`、`owner-role`、`local-verify` 和 `integration-owner`
  - 只有在当前用户消息明确要求开发、继续任务、深度调研、对标复刻或提交时，才运行 `openprd loop <path> --run`
  - 代码修改完成后、最终回复前，运行 `openprd dev-check <path> <file...>`；自动优化开启（默认）时需要关注的文件先本轮完成拆分，再以 **OpenPRD 自动优化报告** 表格呈现（列：影响对象、问题级别、源文件规模、优化原因、本次处理结果、后续建议）并附开关确认；关闭后以 **后续建议** 表格呈现（列：影响对象、关注程度、规模信号、预警原因、本次处理结果、后续建议）。两种模式都按 🔴 → 🟠 → 🟡 排序
  - 用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，默认调用 `imagegen`（Codex 原生 Image 2）生成图片；Image 2 是工具路径，不是审美豁免，生成前先写清用途、受众、气质、约束和记忆点；除非用户明确指定 HTML/SVG/CSS/Canvas/代码稿，不要生成临时 HTML 再截图；未调用 `imagegen` 前，不要声称生图已完成、失败或限流。生图结果先当候选效果图，不要默认纳入验收
  - 大界面改动先按用户目标、信息架构变化、视觉决策成本和验证风险判断方案评审形态；已有界面时用 Codex Computer Use 打开产品内对应功能并截图，冷启动没有现有界面时用当前 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成 design brief；再用 `imagegen`（Codex 原生 Image 2）生成至少 3 个设计方向，横向拼接成一张带 1/2/3 序号的大图作为候选效果图；每个方向都要有具体审美主张和 anti-slop 自检。候选图用于帮助用户判断，但 OpenPrd 不强制停下等待确认；Agent 可按最符合目标且可逆的方向继续，并清楚说明采用的假设
  - 如果已有确认参考效果图、图片资产、设计稿、截图或用户给图并进入实现阶段，阶段性完成后必须生成实现截图，并用 `openprd visual-compare <path> --reference <效果图> --actual <实现截图> --locale <zh-CN|en>` 输出 JPG 视觉对比图；如果参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare <path> --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，检查 contact sheet 后按 compare-plan 逐项对比；如果验收重点是局部组件或不超过 3 个相邻区域，局部证据不是整体对比的“可选补充”，而是默认主路径：Agent 自主从同入口、同视口、同状态截图中选择同一语义对象，使用 `--reference-box/--actual-box` 或 `--before-box/--after-box` 生成 `local-first` 局部证据板，共享像素尺度、禁止左右独立拉伸，差异未消除时直接返工并复用裁剪区域；全屏图只作底部上下文和未改区域回归。如果没有明确参考图，先判断新建界面还是修改既有界面：新建界面先完成 3 方向方案评审，修改既有界面动手前先生成修改前截图，完成后生成修改后截图，并用 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>` 输出 JPG 自检图；如果并行试了多个优化方向，再补 `--board <parallel-board.json>` 输出并行实验证据板；如果新功能或改动包含同构列表、卡片、网格、表格，或用户反馈没对齐/排版漂移，再补 `--board <alignment-board.json>` 输出对齐辅助线证据板。未查看对比图，或对比图仍有明显结构、气质、层级、字体/色彩/表面角色、记忆点差异/漂移时，不要声称界面视觉完成；如果用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图
  - `openprd loop <path> --finish` 前，先完成文档影响检查并更新缺失或过期的 `docs/basic/`、文件说明书和文件夹 README；涉及后端、脚本、Agent、工具链、服务或数据处理变更时，同步评估 CLI 与 API 两个接入面
  - 声称单个任务完成前，只运行本任务最小足够验证，并通过 `--evidence`、测试报告或任务 metadata 留下 task-scoped evidence；不要在每个任务里反复运行 `openprd quality <path> --verify` 或全局 `openprd run <path> --verify`
  - 阶段收口、全部任务完成、handoff/commit/release/publish 前，再运行 `openprd quality <path> --verify` 并审阅生成的 HTML 质量评估报告，检查场景标签、必需 EVO 门禁、日志、业务护栏、冒烟覆盖、任务完整性、性能基线、极端场景和知识缺口
  - 如果当前任务是在发布 OpenPrd 自身到 GitHub，新版本必须同时具备匹配的项目版本号、版本条目、版本 tag 和 GitHub Release；只有 push/tag 没有 Release 不算发布闭环。优先先用 `openprd release <path> --notes ...` 累计版本条目，再用 `node scripts/openprd-github-release-notes.mjs <path> --version <x.y.z> --tag <vX.Y.Z>` 生成发布文案，并确认仓库 workflow 已成功 create/edit 对应 release
  - 如果本轮修复已经出现可复用模式，可先运行 `openprd quality <path> --learn --review --from .openprd/harness/turn-state.json` 生成项目经验候选；对用户呈现时先用“这次我观察到的情况 / 我计划保留的一条项目经验 / 以后如果再遇到类似任务我会怎么复用 / 这条经验只会保留在当前项目里，要不要一起保留”这套结构化人话询问。确认值得长期保留后，再运行 `openprd quality <path> --learn --from <candidate-dir>` 正式沉淀为项目经验
  - `openprd loop <path> --finish` 应同时留下 Markdown 和 HTML 回归证据到 `.openprd/harness/test-reports/`，把它们视作任务交付物的一部分
  - 如果本轮准备宣称“整体完成”或“项目级完成”，但还没有最终 `openprd quality <path> --verify`、最终 `openprd run <path> --verify`，或 `.openprd/harness/test-reports/` 下的 Markdown / HTML 测试报告，就只能如实说“局部实现或代码修改已完成，项目级收口仍待补齐”，不要把缺少最终验证的状态表述成已经闭环
  - 每个 loop 任务都对应一个全新 Codex 或 Claude 会话边界，不要在同一会话里继续下一项任务
- 处理历史项目集群前先审计：
  - `openprd fleet <root> --dry-run`
  - `openprd fleet <root> --update-openprd`
  - 除非用户明确要求 OpenPrd 接管 agent-only/plain 项目，否则不要使用 `--setup-missing`
- 如果工作区已经存在，先检查再写入
- 初始化后不要立刻跳到 synthesize，优先做明确澄清

### 2. 与用户澄清

- 使用：
  - `openprd clarify <path>`
- 当关键产品事实缺失时，先查看 `intake-reflection.md` 的需求入口自省，再把压缩后的必须确认问题问给用户
- 当需求模糊、起点只有一句想法，或需要先做方案探索时，先查看生成的 `intake-reflection.md`，把用户群体、产品形态、第一版切片、暂不处理、不能破坏和风险探针整理成首轮项目画像；Agent 选择最可逆的默认方案继续，把假设和验收方式说清楚，不把 OpenPrd 摘要变成用户确认门禁；不要生成或打开澄清 HTML
- Agent 在对话里先用业务和产品语言复述：这次主要给谁、什么场景、先解决什么、先不碰什么、不能影响什么、会带来哪些业务风险。默认先追问 1 个最高价值问题，而不是一次性抛一整墙技术问题。
- `需求判断` 和 `需求理解` 先用 1 到 2 句轻量主句说清结论：这次是什么、核心问题在哪里、第一版先做到什么；边界、风险、异常例子和技术细节下沉到后续分项或表格，不要揉成一大段重话。
- L2 的 requirement 摘要和 PRD/review 流程由 Agent 后台完成；用户已要求实现时继续推进，不创建确认停顿。
- 如果 `openprd run . --context` 仍然建议 `clarify-user`，这轮回复的目标就只能是 `需求摘要` 或 `1 个最高价值澄清点`；不要写“我先按默认方案实现”或类似承诺。
- `面向个人消费者场景 / 面向企业服务场景 / 以 Agent 为主要使用场景` 不是只给后面 PRD 用的模板方向；澄清阶段就要前移场景视角。面向个人消费者场景更看首次场景、用户感受和回访动力；面向企业服务场景更看拍板方、使用方、推进方和上线阻力；Agent 场景更看自主边界、人工兜底和失败恢复。
- 当用户一开始不想讲太细时，可以先给 2 到 3 个方向和取舍供用户选，不要逼用户先回答完整 schema。
- 优先分阶段确认：问题、用户、范围、成功标准和开放问题；复杂需求先让 OpenPrD 内部完成意图归一化、项目上下文映射和产品质量自检，不要把固定问题墙一次性砸给用户
- 收到答案后，用下面命令写回：
  - `openprd capture <path> --field <section.path> --value <text|json>`
- 当你是在追加列表型字段，而不是整体替换时，使用 `--append`

### 3. 锁定产品类型

- 如果 `productType` 缺失，运行：
  - `openprd classify <path> <consumer|b2b|agent>`

### 4. 加载澄清提示

- 如果必填字段仍缺失，使用：
  - `openprd interview <path> --product-type <type>`
- 未解决的问题要保持可见，不要假装 intake 已经完整

### 5. 生成可评审草稿

- 使用：
  - `openprd synthesize <path> --title ... --owner ... --problem ... --why-now ...`
- 如果草稿仍然稀疏，明确说明还缺什么
- 生成 `spec.md` 和 tasks 时跟随用户当前主语言；无法判断时用简体中文兜底。必要专有名词、品牌名、命令名、路径、字段名和 API 术语可以保留原文
- `synthesize` 生成 `review.html` 后，必须把 HTML 路径告诉用户，并自动打开它（或紧接着运行 `openprd review <path> --open`）
- 评审页里的需求关系图、需求流程图和重点摘要不要靠 HTML 截断；`openprd synthesize` 生成版本快照后，不要直接把 review 给用户确认。必须先用 `openprd review-presentation <path> --template` 查看展示文案契约，让 Agent 按 `reviewPresentation` 写短文案，再用 `openprd review-presentation <path> --presentation <json> --write --fail-on-violation` 校验并写回。脚本通过后会写入校验元信息并重渲染可确认 review.html；超限时按脚本返回的 jsonPath 和字数限制重新提炼，不手工改快照、不裁剪原文
- L1/L2 中只有语义判断为大界面改动、视觉决策成本高或需要用户选方向时，才在 review-presentation 写入前自动补交互方向评审；轻量 UI 微调不触发。按当前工具面用 Codex `imagegen`（Image 2）或 Cursor `GenerateImage` 生成 3 个差异足够大的交互稿方向，图片保存到 `.openprd/design/active/`，再把每个方向的 `id/title/image/summary/tradeoff` 写入 `reviewPresentation.designDirections.directions[]`（title 15 字内、summary/tradeoff 30 字内）。已有界面时三个方向必须共享同一张当前截图作为 image-to-image 参考并默认保持视觉 DNA；冷启动才使用 design brief。review.html 会渲染 3 方向评审卡片，用户点“选这个方向”后回传 `openprd review <path> --mark confirmed --direction <id>` 命令；选定方向会记录进评审状态，后续实现必须按选定方向推进。不涉及界面或只是轻量微调时不要携带 designDirections 字段
- 用户想在交互稿上圈选、批注或做视觉级反馈时，引导走画布评审协同：画布右栏顶部“评审协同”区显示当前 7 步流程位置，“导入评审方向”会把当前 review 的 designDirections 连图带说明摆上画布（已选定方向会标出），用户圈选批注后用“发送给 Codex”回传反馈
- 用户问“现在到哪一步了”“接下来做什么”“OpenPrd 到底是干嘛的”时，先运行 `openprd guide <path>`：它按工作区状态输出 7 步流程（需求澄清 → 需求摘要 → 评审确认 → 交互方向选择 → 任务拆解 → 实现执行 → 验证收口）、当前位置和下一步动作，用它的输出向用户解释，不要口头即兴复述流程
- 把生成的 `review.html` 当作稳定评审 artifact，但它是 Agent 后台维护和用户随时可看的结果，不是授权门禁。Agent 用精确 `--version`、`--digest`、`--work-unit` 记录当前稳定 artifact，自行完成 requirement 写回、classify/synthesize、review、change 和 tasks；不得要求用户批准摘要、评审稿或执行清单，也不得因这些材料尚未完成阻断用户已经要求的实现
- L2 由 Agent 自动完成摘要、事实写回、classify/synthesize/review 和 tasks，再继续用户要求的执行；这些材料不是授权门禁。

### 6. 需要时生成可视化评审产物

- 当用户需要以下内容时，路由到 `$openprd-diagram-review`：
  - 架构确认
  - 流程 / 旅程确认
  - 需求定稿前的可视化评审
- 当需求属于大界面改动时，在 PRD 定稿或实现开工前先走“视觉方案评审”：
  - 已有界面时用 Codex Computer Use 进入产品内对应功能，截取当前真实界面；冷启动没有现有界面时，基于已确认 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成设计 brief
  - 用 `imagegen`（Codex 原生 Image 2）基于截图或设计 brief 至少产出 3 个不同设计思想方向，每个方向都要有具体审美主张和 anti-slop 自检
  - 将 3 张效果图横向拼接为一张大图，每张左上角标注 1/2/3，先作为候选效果图展示给用户
  - 主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现；只有确认后才把选定方向、整张图或其中子图整理到 `.openprd/harness/visual-reviews/`
  - 未确认方向前，不进入大 UI 实现或声称方案已定

### 7. 只在草稿准备好时 freeze

- 使用：
  - `openprd freeze <path>`
- Freeze 是门禁，不只是另一次渲染
- 声称实现就绪前，先校验 standards：
  - `openprd standards <path> --verify`
  - 这不只是缺文件检查；对已变更文件，还要判断现有文档是否过期，并在必要时更新
- 声称实现就绪前，再校验质量：
  - `openprd quality <path> --verify`
  - 把 `.openprd/quality/reports/<id>.html` 当作面向人的评审产物，用于查看当前场景必需 EVO 门禁、可观测性、业务成本与滥用护栏、评估执行环境、性能、压力数据和项目知识
  - 如果 HTML 或 `openprd run <path> --verify` 显示 `productionReady=false`，最终回复不得宣称整体就绪；必须先区分 `taskReady` 与 `workspaceReady`，再列出缺证据或需关注的必需门禁
  - 如果 `openprd run <path> --verify` 只剩 `feature-coverage` 待关注，要说明是任务账本或覆盖证据未收口，不要把本次功能表述成失败
- 进入高风险动作前，校验完整 harness：
  - `openprd run <path> --verify`
  - `openprd doctor <path>`

### 8. 导出 handoff 包

- 使用：
  - `openprd handoff <path> --target openprd`

## 安全默认值

- 当下一步存在歧义时，优先用 `openprd next`
- 当任务属于一般执行循环时，优先用 `openprd run --context`
- 当任务是需要拆成“每个任务一个全新 agent 会话”的实现工作时，优先用 `openprd loop --plan` 和 `openprd loop --run --dry-run`
- 当用户要求“看看、规划、梳理、分析、评估、explain、review”或列出影响文件时，优先保持只读检查
- 除非当前用户消息明确要求执行，否则不要运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、`openprd loop --finish --commit`、git commit 或 git push
- 当 agent 环境可能没有正确跟随 OpenPrd 时，优先用 `openprd doctor`
- 生成 adapter 文件漂移时，优先运行 `openprd update` 修复，而不是手改生成文件
- 当方案形态仍不清晰时，优先先 review 再进入需求定稿
- 当界面改动比较大、用户需要先选方向、或页面信息架构/主视觉会明显变化时，优先先做 3 方向候选效果图评审，再进入实现
- 当用户目标是把本次工作转成可学习、可复用、可回看、可教学或可沉淀的材料时，先按期望产物是否需要章节结构、证据锚点、图文讲解、检索练习、工作示例或长期阅读体验来判断；需要时优先调用 `openprd learn .` 生成学习包和阅读器，不要用关键词表触发，普通 Markdown 只能作为辅助讲义
- 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，优先调用 `imagegen`（Codex 原生 Image 2）；Image 2 是工具路径，不是审美豁免，生成前先写清用途、受众、气质、约束和记忆点；只有实际发生 `imagegen` 调用后，才能汇报生图结果、失败或限流。生图结果先当候选效果图，并主动确认是否符合预期、是否纳入后续效果图/实现截图对比、以及是否按此继续实现。界面任务进入实现阶段时，已有确认参考图用 `openprd visual-compare --reference/--actual` 生成左右对比 JPG；如果参考图是一张整板、网格图或多对象组合，先运行 `openprd visual-prepare --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>` 整理 reference-set，再逐项对比；没有参考图时先判断新建界面还是修改既有界面，新建界面先完成 3 方向方案评审，修改既有界面用 `openprd visual-compare --before/--after` 生成修改前后自检 JPG；局部细节优先补 `--board <focus-board.json>`，并行优化方向优先补 `--board <parallel-board.json>`，同构列表/卡片/网格/表格优先补 `--board <alignment-board.json>`，共同作为视觉就绪判断依据。visual evidence 同时检查气质、层级、字体/色彩/表面角色和记忆点，不只检查截图是否存在。用户后续如果说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图
- 遇到 blocker 时，优先把阻塞条件显式暴露出来，而不是悄悄补脑

## 禁止行为

- 不要发明不存在的命令
- 不要因为 CLI 技术上允许，就在用户还没确认方案结构时直接进入需求定稿
- 当图示评审或草稿评审明显仍有必要时，不要 handoff 一个用户尚未审阅的工作区
- 项目基线文档路径只能是 `docs/basic/`
- 当 `openprd setup`、生成规则和 hooks 已经可以引导 agent 时，不要反过来要求用户记住具体 skill 名

## 需要时阅读这些参考资料

- `references/command-map.md`：命令到意图的映射
- `references/workflow-gates.md`：门禁判断和就绪规则
- `references/examples.md`：具体使用模式
- `references/usage-guide.md`：面向团队和 agent 的使用指南，覆盖 clarify、diagram、freeze、status/next 和批量 capture
