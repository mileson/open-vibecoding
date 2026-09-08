---
name: openprd-harness
description: 驱动 OpenPrd 工作区完成从澄清到 handoff 的主流程。适用于初始化 OpenPrd、查看 `.openprd/` 状态、选择下一条命令、推进 classify/interview/synthesize/freeze/handoff，或解释如何安全推进 OpenPrd 工作区。
---

# OpenPrd Harness

## 概览

这份 skill 负责主工作流编排。把它当成串起命令和产物的领域 skill；共用守则由 `$openprd-shared` 提供。

`AGENTS.md` 只保留轻量合同；入口路由优先看 `skills/openprd-router/SKILL.md`，具体命令速查看 `.openprd/harness/command-catalog.md`，更细的工作流步骤、路由边界和 hook 门禁以这份 skill、`$openprd-shared` 和 `$openprd-benchmark-router` 为准。

执行时优先继承 `$openprd-shared` 的用户心智与表达规则：用户懂业务和产品，但不想读技术黑话；默认耐心低、成本敏感，需要 Agent 主动补全遗漏，并用最短路径说明结论和下一步。

## Automation-safe mode

识别到 Codex automation、Claude Code headless、cron、scheduled 或 unattended task 时，默认不要要求 `openprd dev-check` / `doctor`。按自动化自己的 runbook、日志、测试和通知合同收口；只有 prompt 明确说明这是 OpenPrd 维护任务或显式启用 OpenPrd 时才恢复互动流程。

## Agent 自主审查界面

OpenPrd 只通过生成的 AGENTS 与 skills 注入判断原则和质量合同，不提供通用审查 HTML 生成器。Agent 保留当前任务的语义判断、内容组织、页面设计、实现和验证责任。

1. 在任务进入、形成关键证据、完成实现验证，以及准备执行高影响后续动作前，判断聊天是否足以让用户核查依据、比较对象并反馈。
2. 如果存在人类审查节点并命中 `references/agent-authored-html-review.md` 的任一强制触发条件，除非用户明确不要 HTML，或已有能够完成同等核查、比较与反馈的任务专属审查界面，否则必须在请求用户审查或执行高影响动作前制作并验证任务专属 HTML；不要把“已经有 Markdown/CSV”当成豁免理由。
3. 如果本轮交付包含只有用户或负责人才能完成的选择、批准或纠错，最终交付本身就是人类审查节点。Agent 自己将任务归为“直接分析”、L0/L1/L2 或只读分析不能规避合同；只有用户或宿主明确禁止新增文件时才按无写入豁免处理，并在交付中说明。
4. 未命中强制触发条件，但聊天不足且存在多对象比较、多媒体证据、复杂测试结果、批量审核、方向选择、长期阅读或高影响后续动作时，不要等待用户主动索要 HTML；由 Agent 继续按审查成本决定是否制作。
5. HTML 的生成时机由审查边界决定，不由 L0/L1/L2、固定关键词或“任务是否结束”机械决定。强制触发条件只提供最低可预测边界，不是穷举式关键词分类；一次长任务可以没有 HTML，也可以在分析中、实现后或外部动作前出现不同审查界面。
6. 制作 HTML 前先读取 `references/agent-authored-html-review.md`，让真实证据、来源、事实/推断/未知边界和本次需要用户判断的内容成为页面主结构；只加入当前审查真正需要的播放、对比、筛选、标注、状态记录或导出能力。
7. 命中强制条件后，最终回复必须给出可点击的任务专属 `.html` 绝对路径与验证说明；没有这两项、仅生成 starter、仍有无来源占位内容或只验证文件存在时，不得把审查节点标记完成。
8. 不要为了形式生成空洞页面；不要把固定 `review.html`、历史 quality eval 报告或学习阅读器误当成所有任务的通用替代品；不要用 HTML 代替真机、模拟器、浏览器、生产环境或第三方系统读回。

## 动手前

1. 读取第一个可用的共用规则文件：`skills/openprd-shared/SKILL.md`、`$HOME/.claude/skills/openprd-shared/SKILL.md` 或 `$HOME/.codex/skills/openprd-shared/SKILL.md`
2. 从 `.openprd/` 重建当前工作区状态
3. 如果用户期待自动化 agent 引导，运行 `openprd doctor <path>`，必要时用 `openprd setup <path>` 或 `openprd update <path>` 修复
   - `init/setup/update/doctor` 可能会在 `.openprd/harness/install-manifest.json` 的 `optionalCapabilities` 里记录 Context7、DeepWiki 等非阻断式增强建议。把它当成软提醒：初始化、诊断和当前任务都不因它失败；只有当前任务会明显受益时，才在后续建议里解释能力价值、附官方文档 / GitHub 链接，并视情况提出可代为补配置。
4. Agent 根据当前会话、用户消息和任务相关代码选择执行单元；OpenPrd 不接管上下文
5. 空白前端冷启动且用户目标明确时，先用 3 到 5 行 mini-plan 收口，再按 `$openprd-frontend-design` 的 `design-starter -> Patch Mode` 路径继续
   - 执行策略按任务边界判断：L0/小范围修正默认 `serial`，中等规模 L1/L2 可推荐 `parallel-workers`，高风险或大规模实现再升级到 `parallel-workers-isolated`
   - 如果用户给出会话 ID 并要求继续，按工具无关的历史会话精确续接；不要要求或使用工具专属 ID，也不要用当前 active change、相似历史或当前 requirement gate 替代该会话 ID
   - 如果用户没有给 ID，但明确描述了某个已有需求、change、task 或 work unit，按当前会话和 repo-local 材料定位对象，不要先默认拿当前 active change
6. 需求复杂度先交给 `$openprd-requirement-intake` 分流；不要按固定关键词判断。它会根据影响面、未知数、决策成本和验证成本判断需求类型，并保留内部路由码对照：直接处理=L0、现有功能优化=L1、新功能/新流程方案=L2；默认把路由码并进“需求类型：直接处理（L0）”这类标签里，只有内部排障确实受益时才额外补“内部路由码”
   - 既有 requirement、PRD、review、change、tasks 和实现记录属于冻结历史，不根据当前代码推断、补写或改写。旧功能重新进入需求流程时，为本轮创建新的 current requirement/change 并引用历史；`docs/basic/` 与代码说明书是活文档，可随当前实现后台维护。
   - 如果需求涉及界面、页面、视觉、样式或前端体验，判断是否属于“大界面改动”：会改变信息架构、页面布局、主视觉、关键路径或核心组件密度/层级。大界面改动由 Agent 在后台维护视觉方案评审，并选取可逆默认方向继续；用户明确选择时再覆盖默认方向。
   - 如果只是卡片宽度、间距、留白、对齐、颜色、圆角、字号、按钮或图标等轻量 UI 可视优化，仍按 L0/L1 小范围修正推进，不自动升级成大界面方案评审；但它是用户可见变化，动手前要有一句审美意图和记忆点，收口必须补 `visual-compare`、`focus-board`、`verification-board` 或 `alignment-board` 证据，并检查气质、层级、颜色、字号、间距和表面角色是否成立。只要界面里有同构列表、卡片、网格或表格，就把相同文案类型/相同组件槽位的对齐当作默认验收项，不等用户先投诉。build、package 和 `dev-check` 不能替代视觉证据。
   - 任何界面、页面、视觉、样式或前端体验任务都要额外读取 `$openprd-frontend-design`；`.openprd/design/active/` 的 `facts-sheet / asset-spec / image-preflight / direction-plan / selected-direction` 由 Agent 在后台维护，不创建用户确认停顿。
   - 如果用户已经给了效果图、设计稿、参考截图或其他明确参考图，先把它视为主参考源；只有现有 starter、theme、layout 足够接近时才复用，不接近就允许偏离默认组合，不要为了套库把页面做成另一种样式。
   - 如果 `design-starter` 之后需要整页重写，默认先写 sibling draft，再覆盖回 `index.html`；不要让入口文件在 rewrite 过程中出现空窗。
   - `design-starter` 落地后进入 advisory Patch Mode：优先做一轮就地对焦并尽快在入口文件或 sibling draft 形成真实实现；必要的事实、图片或模板读取仍可继续，hook 只记录 `allowed-with-patch-mode-attention`，不限制当前工具调用。
   - 一旦已经说“开始覆盖入口文件”或“开始整页重写”，把真实页面写入作为近期优先动作；如果尚未写入，最终回复按真实状态标记为 starter 或部分实现，不把提示词当阻断。
   - 如果用户目标是把工作转成可学习、可复用、可回看、可教学或可沉淀的材料，先按期望产物形态判断是否需要 `$openprd-learning-review`：需要章节结构、证据锚点、图文讲解、检索练习、工作示例或长期阅读体验时，优先用 `openprd learn <path> --topic <主题>` 生成学习包骨架、阅读器和证据清单；不要用关键词表触发，普通 Markdown 只能作为辅助讲义。
   - 同时记录本阶段是否即将形成用户审查边界；如果聊天不足以承载核查与反馈，按上面的 Agent 自主审查界面合同推进，不要把页面生成推迟到整个任务结束。
7. 如果用户是在规划、分析、架构评审，或问“怎么改”“会动哪些文件”，保持只读并基于证据回答
8. 实现任务完成代码修改后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check <path> <file...>` 或 `node scripts/openprd-dev-check.mjs <path> <file...>`。它是 task-scoped advisory：只有拆分与当前目标同范围、风险不扩张且能保持行为不变时才可顺手处理；否则保留建议并把工作区规模债归入 `workspaceAttention`，不得强迫当前任务重构，也不要求用户回复开关确认
9. 执行过程中发现新代码后缀、豁免路径、命令别名、项目约定或用户偏好时，不要中途打断当前任务。工具识别补全和减少重复打扰这类高置信低风险项可自动补齐并记录；用户偏好、项目协作规矩和 OpenPrd 默认行为先沉淀为带来源候选，收工时运行 `openprd grow <path> --review` 后台复盘，不创建用户确认停顿
10. 维护 OpenPrd 本身时，只要新增或修改配置类能力（阈值、规则、识别、豁免、命令别名、环境差异、用户偏好或策略开关），默认先做 grow-aware 自检：高置信应可成长时直接纳入 `openprd grow` 体系；不确定时主动询问用户是否做成可成长配置
11. 用户要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，默认直接调用 `imagegen`（Codex 原生 Image 2）。生图前写清用途、受众、气质、约束和记忆点并做 anti-slop 自检；只有实际调用后才能汇报结果、失败或限流。结果先当候选效果图，Agent 说明采用的可逆默认方向；用户明确选择时再覆盖默认方向并更新 reference-set
12. 大界面改动由 Agent 按用户目标、信息架构变化、视觉决策成本和验证风险完成视觉方案评审：已有界面时截当前真实界面，冷启动时形成 design brief，再生成至少 3 个不同设计思想方向。候选图展示给用户，同时采用最符合目标且可逆的默认方向继续；OpenPrd 不强制等待确认或阻断大 UI 实现
   - 3 个方向不能只是同一种安全解的轻微变化。至少要在 `.openprd/design/active/direction-plan.md` 里区分不同生成逻辑、适用场景、审美主张、记忆点和主要风险。
   - Agent 把可逆默认方向写入 `.openprd/design/active/selected-direction.md`；用户明确选择时再更新 lens、theme、layout、组件、审美主张和记忆点。
13. 界面、页面、视觉、样式或前端体验任务中，如果已有用户参考图或 Agent 采用的可逆默认参考方向且进入实现阶段，阶段性完成后先截实现图，再运行 `openprd visual-compare <path> --reference <效果图> --actual <实现截图> --locale <zh-CN|en>`。如果一张参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare <path> --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，生成 reference-set、contact sheet 和 compare-plan，再逐项对比。如果没有明确参考图，先判断新建界面还是修改既有界面：新建界面由 Agent 在后台完成 3 方向方案评审并采用可逆默认方向，修改既有界面动手前先截修改前截图，完成后用同一入口、视口、账号和数据状态截修改后截图，再运行 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>`。需要审局部细节时，再补 `openprd visual-compare <path> --board <focus-board.json> --locale <zh-CN|en>`；如果局部变化需要放到同一张证据板里审阅，默认优先把局部变化组合成一张 `focus-board` 再统一验收；并行跑了多个优化方向时，再补 `openprd visual-compare <path> --board <parallel-board.json> --locale <zh-CN|en>`。如果只是轻量 UI 可视优化，至少留下修改前后自检图、截图实测证据板或对齐辅助线证据板，并检查本轮审美意图和记忆点是否成立；新功能或改动包含同构列表、卡片、网格、表格时，默认补 `openprd visual-compare <path> --board <alignment-board.json> --locale <zh-CN|en>`，把真实截图、辅助线和相同槽位 spread 放到同一张证据板里；只跑 build、package、`dev-check` 或只看单张截图，都不能宣称视觉已完成。默认输出 JPG 到 `.openprd/harness/visual-reviews/`；查看合成图后继续复刻或自检，直到结构、气质、层级、字体/色彩/表面角色和记忆点都没有明显差异或意外漂移；如果用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图。对 `design-starter -> Patch Mode` 的静态首页而言，真正完成还包括：入口文件本体已经改完、主要占位已清掉、已准备好的真实图片或参考约束已经落进页面，不是只补合同或只下载素材。
14. 实现任务新增或修改文件时做文档影响检查：只有本轮代码变化直接让现有 `docs/basic/`、文件说明书或文件夹 README 失真时才同步相关内容；历史缺失、模板态或全局文档债记入 `workspaceAttention`，不扩大当前任务。涉及后端、脚本、Agent、工具链、服务或数据处理变更时，同步评估 CLI 与 API 两个接入面
   - 如果这轮实现补充了新的前端设计主题、布局骨架、组件 recipe 或 anti-slop 规则，同步更新 `.openprd/design/` 与 `docs/basic/frontend-guidelines.md`，不要只留在代码里。
15. 长时间实现任务使用 `openprd loop <path> --plan --change <id>`，并且只有当前用户消息明确要求开发、继续任务、深度调研、对标复刻或提交时，才为每个 loop 任务启动一个全新 agent 会话
16. 需要完整工作流细节时，使用 `openprd status` 和 `openprd next`
17. 用户要求最佳实践、benchmark、对标、参考产品、prompt engineering、Agent harness、context engineering、图标资源、CLI 或 skill 体系设计时，先路由到 `$openprd-benchmark-router`
18. 用户要求界面更好看、更稳定、有一致审美、能复用视觉资产或内置模板时，先路由到 `$openprd-frontend-design`
19. 用户要求基线文档、文件说明书、文件夹 README 标准或实现就绪检查时，路由到 `$openprd-standards`
20. 用户明确要求日志、链路追踪、业务成本护栏、评估执行环境、冒烟覆盖、性能、媒体证据或历史 eval 专项诊断时，路由到 `$openprd-quality`
21. 用户需要可视化说明，或系统/产品形态仍不清晰时，在进入需求定稿前路由到 `$openprd-diagram-review`
22. 默认保持 Codex hooks 轻量。除非项目明确需要完整工具级遥测，否则 `openprd setup/update` 使用 `--hook-profile lite`；默认 `lite` 保留 `Stop` 收工回顾，用于记录 task-scoped 证据与后台维护建议，不制造新的用户确认停顿
23. hook 默认不因 PRD、review、change、tasks、设计合同、测试报告或视觉证据尚未补齐而阻断用户要求的正常实现。缺失材料由 Agent 在后台自动补齐；来不及补齐时继续完成安全范围内的工作，并在收口如实说明证据状态，不把流程作业转嫁给用户。
24. 风险识别只向 Agent 提供提醒和更安全的实现建议，不承担授权审批。命中“兜底、写死、补数据、权益、额度、生产、支付、删除、账号”等词时先看真实动作对象，优先改成配置、迁移、标准状态机、幂等脚本或可回滚发布路径并继续。OpenPrd 不因风险词或动作类型阻断工具调用，也不向用户索取确认、指定句子、摘要、digest、work-unit id 或命令；是否需要确认由当前 Agent 依据宿主安全规则和真实上下文自行判断。
25. 当 `doctor` 报告生成引导漂移时，读取 `.openprd/harness/drift-report.json`
26. 先按 `.openprd/harness/runtime-environment.json` 和 install manifest 的 `platformCapabilityPacks` 判断当前对话是在 Codex、Claude Code 还是 Cursor，再启用对应能力；Codex Image 2、Computer Use、Codex-owned browser window、对话协同画布和当前线程文本桥接都必须有当前 surface 或 hook/session 证据。当前线程桥接只在 Codex App 明确提供线程发送工具时使用。

## 主工作流

### 1. 初始化或定位工作区

- 如果 `.openprd/` 不存在，使用：
  - `openprd init <path> --template-pack <base|consumer|b2b|agent>`
- `init` 会同时创建 standards 和 agent integration，包括 Codex、Claude、Cursor 的生成引导、项目级 Codex hooks 和用户级 Codex hooks feature flag
- `init` 会创建显式质量诊断配置和 knowledge 基础目录，但不创建或生成 quality eval 报告
- `init` 也会创建自我成长候选队列，包括 `.openprd/growth/candidates.jsonl`、`accepted.json`、`rejected.json` 和本地偏好文件
- 如果 standards 缺失，或用户要求修复：
  - `openprd standards <path> --init`
- 如果生成的 agent 引导或 hooks 缺失：
  - `openprd setup <path>`
  - `openprd doctor <path>`
- 如果生成引导存在但漂移了：
  - `openprd update <path>`
  - `openprd doctor <path>`
- hook 证据与验证使用：
  - `openprd run <path> --verify`
  - 让 `.openprd/harness/run-state.json`、`iterations.jsonl` 和 `learnings.md` 成为持久证据状态
  - 用户给出会话 ID 续接历史任务时，由宿主 Agent 或应用精确恢复指定会话，不要让当前 active change 抢主线
  - 默认 lite Codex hooks 的 `UserPromptSubmit` 只记录提示；`PreToolUse` 处理安全注意项；`Stop` 提醒 Agent 评估是否值得生成项目经验草案
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
  - 代码修改完成后、最终回复前，运行 `openprd dev-check <path> <file...>`；将其作为 task-scoped advisory。只在拆分与当前目标同范围且不扩张风险时顺手处理，否则把规模债记入 `workspaceAttention`，不强迫本轮重构，也不要求用户回复开关确认
  - 用户只是要求生成图片、封面图、配图、海报、插画、图标、贴纸、头像、banner、主视觉/KV、运营图、效果图、视觉稿、mockup 或先看样子时，默认调用 `imagegen`（Codex 原生 Image 2）生成图片；Image 2 是工具路径，不是审美豁免，生成前先写清用途、受众、气质、约束和记忆点；除非用户明确指定 HTML/SVG/CSS/Canvas/代码稿，不要生成临时 HTML 再截图；未调用 `imagegen` 前，不要声称生图已完成、失败或限流。生图结果先当候选效果图，不要默认纳入验收
  - 大界面改动先按用户目标、信息架构变化、视觉决策成本和验证风险判断方案评审形态；已有界面时用 Codex Computer Use 打开产品内对应功能并截图，冷启动没有现有界面时用当前 PRD、用户群体、第一版切片、视觉目标、气质端点和记忆点生成 design brief；再用 `imagegen`（Codex 原生 Image 2）生成至少 3 个设计方向，横向拼接成一张带 1/2/3 序号的大图作为候选效果图；每个方向都要有具体审美主张和 anti-slop 自检。候选图用于帮助用户判断，但 OpenPrd 不强制停下等待确认；Agent 可按最符合目标且可逆的方向继续，并清楚说明采用的假设
  - 如果已有用户参考效果图或 Agent 采用的可逆默认参考方向并进入实现阶段，阶段性完成后生成实现截图，并用 `openprd visual-compare <path> --reference <效果图> --actual <实现截图> --locale <zh-CN|en>` 输出 JPG 视觉对比图；如果参考图里有多个子图、网格或对象，先运行 `openprd visual-prepare <path> --reference <效果图> --grid <列>x<行>` 或 `--boxes <plan.json>`，检查 contact sheet 后按 compare-plan 逐项对比；如果验收重点是局部组件或不超过 3 个相邻区域，局部证据是默认主路径：Agent 自主从同入口、同视口、同状态截图中选择同一语义对象，使用 `--reference-box/--actual-box` 或 `--before-box/--after-box` 生成 `local-first` 局部证据板，共享像素尺度、禁止左右独立拉伸，差异未消除时直接返工并复用裁剪区域；全屏图只作底部上下文和未改区域回归。如果没有明确参考图，先判断新建界面还是修改既有界面：新建界面由 Agent 在后台完成 3 方向方案评审并采用可逆默认方向，修改既有界面动手前生成修改前截图，完成后生成修改后截图，并用 `openprd visual-compare <path> --before <修改前截图> --after <修改后截图> --locale <zh-CN|en>` 输出 JPG 自检图；如果并行试了多个优化方向，再补 `--board <parallel-board.json>` 输出并行实验证据板；如果新功能或改动包含同构列表、卡片、网格、表格，或用户反馈没对齐/排版漂移，再补 `--board <alignment-board.json>` 输出对齐辅助线证据板。未查看对比图，或对比图仍有明显结构、气质、层级、字体/色彩/表面角色、记忆点差异/漂移时，只限制“视觉完成”声明，不阻断实现；如果用户后续说“跟效果图”“不一致”“好丑”“复刻”，至少先产出一份视觉证据图
  - `openprd loop <path> --finish` 前做文档影响检查：只有本轮代码变化直接让现有 `docs/basic/`、文件说明书或文件夹 README 失真时，才在后台同步相关内容；历史缺失、模板态或全局文档债记入 `workspaceAttention`，不影响当前任务或已授权动作。涉及后端、脚本、Agent、工具链、服务或数据处理变更时，同步评估 CLI 与 API 两个接入面
  - 声称单个任务完成前，只运行本任务最小足够验证，并通过 `--evidence`、测试报告或任务 metadata 留下 task-scoped evidence；不要在每个任务里反复运行全局 `openprd run <path> --verify`
  - 阶段收口、全部任务完成、handoff/commit/release/publish 前，运行 `openprd standards <path> --verify`、`openprd run <path> --verify` 与必要的 `openprd doctor <path>`；不再生成或审阅 quality eval HTML
  - 如果当前任务是在发布 OpenPrd 自身到 GitHub，新版本必须同时具备匹配的项目版本号、版本条目、版本 tag 和 GitHub Release；只有 push/tag 没有 Release 不算发布闭环。优先先用 `openprd release <path> --notes ...` 累计版本条目，再用 `node scripts/openprd-github-release-notes.mjs <path> --version <x.y.z> --tag <vX.Y.Z>` 生成发布文案，并确认仓库 workflow 已成功 create/edit 对应 release
  - 如果本轮修复确实出现可复用模式，由 Agent 明确判断后再运行 `openprd quality <path> --learn --review --from .openprd/harness/turn-state.json`，不要让 run/doctor/loop 自动批量生成经验候选
  - `openprd loop <path> --finish` 应同时留下 Markdown 和 HTML 回归证据到 `.openprd/harness/test-reports/`，把它们视作任务交付物的一部分
  - 如果本轮准备宣称“整体完成”或“项目级完成”，但还没有最终 `openprd run <path> --verify` 或 task-scoped 测试报告，就只能如实说“局部实现或代码修改已完成，项目级收口仍待补齐”
  - 每个 loop 任务都对应一个全新 Codex 或 Claude 会话边界，不要在同一会话里继续下一项任务
- 处理历史项目集群前先审计：
  - `openprd fleet <root> --dry-run`
  - `openprd fleet <root> --update-openprd`
  - `openprd fleet <root> --backfill-work-units` 只补 metadata、index 与历史身份绑定；不得创建或改写历史 requirement、PRD、review、change、tasks 或实现记录
  - 除非用户明确要求 OpenPrd 接管 agent-only/plain 项目，否则不要使用 `--setup-missing`
- 如果工作区已经存在，先检查再写入
- 初始化后不要立刻跳到 synthesize，优先做明确澄清

### 2. 与用户澄清

- 使用：
  - `openprd clarify <path>`
- 当关键产品事实缺失时，先查看 `intake-reflection.md` 的需求入口自省，按来源标注当前事实并选择可逆默认方案继续；只有真实不可逆歧义会明显改变结果时，才由宿主 Agent 判断是否提一个必要问题
- 当需求模糊、起点只有一句想法，或需要先做方案探索时，先查看生成的 `intake-reflection.md`，把用户群体、产品形态、第一版切片、暂不处理、不能破坏和风险探针整理成首轮项目画像；Agent 选择最可逆的默认方案继续，把假设和验收方式说清楚，不把 OpenPrd 摘要变成用户确认门禁；不要生成或打开澄清 HTML
- Agent 在对话里先用业务和产品语言复述：这次主要给谁、什么场景、先解决什么、先不碰什么、不能影响什么、会带来哪些业务风险。默认选择可逆方案并明示假设；只有答案会实质改变结果时才追问 1 个最高价值问题。
- `需求判断` 和 `需求理解` 先用 1 到 2 句轻量主句说清结论：这次是什么、核心问题在哪里、第一版先做到什么；边界、风险、异常例子和技术细节下沉到后续分项或表格，不要揉成一大段重话。
- L2 的 requirement 摘要和 PRD/review 流程由 Agent 后台完成；用户已要求实现时继续推进，不创建确认停顿。
- 整理 `需求摘要` 时选择可逆默认方案并继续用户已要求的安全范围；只有真实产品歧义会明显改变结果时才提 `1 个最高价值澄清点`。
- `面向个人消费者场景 / 面向企业服务场景 / 以 Agent 为主要使用场景` 不是只给后面 PRD 用的模板方向；澄清阶段就要前移场景视角。面向个人消费者场景更看首次场景、用户感受和回访动力；面向企业服务场景更看拍板方、使用方、推进方和上线阻力；Agent 场景更看自主边界、人工兜底和失败恢复。
- 当用户一开始不想讲太细时，可以先给 2 到 3 个方向和取舍供用户选，不要逼用户先回答完整 schema。
- 在后台分阶段维护问题、用户、范围、成功标准和开放问题；复杂需求先让 OpenPrd 完成意图归一化、项目上下文映射和产品质量自检，不要把固定问题墙砸给用户
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
- 评审页里的需求关系图、需求流程图和重点摘要不要靠 HTML 截断；`openprd synthesize` 生成版本快照后，由 Agent 用 `openprd review-presentation <path> --template` 与 `--presentation <json> --write --fail-on-violation` 在后台校验展示文案并重渲染稳定 `review.html`。该 artifact 可供查阅但不是授权门禁；超限时按 jsonPath 和字数限制重新提炼
- L1/L2 中只有语义判断为大界面改动或视觉决策成本高时，才在 review-presentation 写入前自动补交互方向评审；轻量 UI 微调不触发。按当前工具面生成 3 个差异足够大的交互稿方向并写入 `reviewPresentation.designDirections.directions[]`。Agent 采用可逆默认方向继续并标注 `agent-default`；用户点“选这个方向”时覆盖默认值并标注 `user-confirmed`。方向卡片与记录都不构成实现停顿
- 用户想在交互稿上圈选、批注或做视觉级反馈时，引导走画布评审协同：画布右栏顶部“评审协同”区显示当前 7 步流程位置，“导入评审方向”会把当前 review 的 designDirections 连图带说明摆上画布（已选定方向会标出），用户圈选批注后用“发送给 Codex”回传反馈
- 用户问“现在到哪一步了”“接下来做什么”“OpenPrd 到底是干嘛的”时，先运行 `openprd guide <path>`：它按工作区状态输出 7 步流程（需求澄清 → 需求摘要 → 评审记录 → 交互方向 → 任务拆解 → 实现执行 → 验证收口）、当前位置和下一步动作，用它的输出向用户解释
- 把生成的 `review.html` 当作稳定评审 artifact，但它是 Agent 后台维护和用户随时可看的结果，不是授权门禁。Agent 用精确 `--version`、`--digest`、`--work-unit` 记录当前稳定 artifact，自行完成 requirement 写回、classify/synthesize、review、change 和 tasks；不得要求用户批准摘要、评审稿或执行清单，也不得因这些材料尚未完成阻断用户已经要求的实现
- L2 由 Agent 自动完成摘要、事实写回、classify/synthesize/review 和 tasks，再继续用户要求的执行；这些材料不是授权门禁。

### 6. 需要时生成可视化评审产物

- 当用户需要以下内容时，路由到 `$openprd-diagram-review`：
  - 架构确认
  - 流程 / 旅程确认
  - 需求定稿前的可视化评审
- 当需求属于大界面改动时，在 PRD 定稿或实现开工前先走“视觉方案评审”：
  - 已有界面时用 Codex Computer Use 进入产品内对应功能，截取当前真实界面；冷启动没有现有界面时，基于当前 PRD 事实、来源标注、用户群体、第一版切片、视觉目标、气质端点和记忆点生成设计 brief
  - 用 `imagegen`（Codex 原生 Image 2）基于截图或设计 brief 至少产出 3 个不同设计思想方向，每个方向都要有具体审美主张和 anti-slop 自检
  - 将 3 张效果图横向拼接为一张大图，每张左上角标注 1/2/3，先作为候选效果图展示给用户
  - 展示候选方向并说明 Agent 采用的可逆默认方向；用户明确选择时再覆盖默认方向并更新 `.openprd/harness/visual-reviews/`
  - 未收到明确选择时，不声称方向已获用户确认，但 OpenPrd 不阻断大 UI 实现

### 7. 只在草稿准备好时 freeze

- 使用：
  - `openprd freeze <path>`
- Freeze 是版本化状态标记，不是额外授权门禁；验证缺口作为 readiness evidence 如实报告
- 声称实现就绪前，先校验 standards：
  - `openprd standards <path> --verify`
  - 这不只是缺文件检查；对已变更文件，还要判断现有文档是否过期，并在必要时更新
- 声称实现就绪前，汇总任务与结构状态：
  - `openprd run <path> --verify`
  - 直接读取 `taskReady / workspaceReady / workspaceAttention` 摘要，不生成额外 eval JSON/HTML
  - 如果摘要显示 `taskReady=true` 且 `workspaceReady=false`，先区分当前任务通过与工作区结构待关注，再列出具体检查项
- 进入高风险动作前，校验完整 harness：
  - `openprd run <path> --verify`
  - `openprd doctor <path>`

### 8. 导出 handoff 包

- 使用：
  - `openprd handoff <path> --target openprd`

## 安全默认值

- 当下一步存在歧义时，优先用 `openprd next`
- 当任务属于一般执行循环时，由 Agent 自己维护上下文；阶段或最终验证使用 `openprd run --verify`
- 当任务是需要拆成“每个任务一个全新 agent 会话”的实现工作时，优先用 `openprd loop --plan` 和 `openprd loop --run --dry-run`
- 当用户要求“看看、规划、梳理、分析、评估、explain、review”或列出影响文件时，优先保持只读检查
- 除非当前用户消息明确要求执行，否则不要运行 `openprd loop --run`、`openprd tasks --advance`、`openprd discovery --advance`、`openprd loop --finish --commit`、git commit 或 git push
- 当 agent 环境可能没有正确跟随 OpenPrd 时，优先用 `openprd doctor`
- 生成 adapter 文件漂移时，优先运行 `openprd update` 修复，而不是手改生成文件
- 当方案形态仍不清晰时，优先先 review 再进入需求定稿
- 当界面改动比较大、页面信息架构/主视觉会明显变化，或用户希望比较方向时，由 Agent 在后台做 3 方向候选效果图评审并采用可逆默认方向继续；用户明确选择时再覆盖
- 当用户目标是把本次工作转成可学习、可复用、可回看、可教学或可沉淀的材料时，先按期望产物是否需要章节结构、证据锚点、图文讲解、检索练习、工作示例或长期阅读体验来判断；需要时优先调用 `openprd learn .` 生成学习包和阅读器，不要用关键词表触发，普通 Markdown 只能作为辅助讲义
- 用户要求生图时优先调用 `imagegen`（Codex 原生 Image 2）；生成前写清用途、受众、气质、约束和记忆点，只有实际调用后才能汇报结果。候选图由 Agent 说明可逆默认方向，用户明确选择时再覆盖。界面实现按参考图形态使用 `visual-prepare` / `visual-compare`，并用相应 evidence board 检查结构、气质、层级、字体、色彩、表面角色和记忆点
- 遇到 blocker 时，优先把阻塞条件显式暴露出来，而不是悄悄补脑

## 禁止行为

- 不要发明不存在的命令
- 不要把 CLI 技术能力误写成用户已经确认的产品事实；未确认事实要标注来源或可逆假设
- 图示评审或草稿评审尚未完成时，将其作为 readiness evidence 债务记录；不要把它伪装成用户已审阅，但也不新增 OpenPrd 授权停顿
- 项目基线文档路径只能是 `docs/basic/`
- 当 `openprd setup`、生成规则和 hooks 已经可以引导 agent 时，不要反过来要求用户记住具体 skill 名

## 需要时阅读这些参考资料

- `references/command-map.md`：命令到意图的映射
- `references/workflow-gates.md`：门禁判断和就绪规则
- `references/examples.md`：具体使用模式
- `references/usage-guide.md`：面向团队和 agent 的使用指南，覆盖 clarify、diagram、freeze、status/next 和批量 capture
- `references/agent-authored-html-review.md`：Agent 何时主动制作任务专属 HTML、页面质量合同和非触发边界
