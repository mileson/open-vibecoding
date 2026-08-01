# OpenPrd

简体中文 | [English](./README_EN.md)

> 帮团队和 Agent 把需求说清楚、持续做下去并用证据交付的 AI 原生 PRD 工作区与 CLI。

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.19.0-339933.svg)](https://nodejs.org/)
[![GitHub stars](https://img.shields.io/github/stars/mileson/openprd?style=social)](https://github.com/mileson/openprd)

OpenPrd 是一个轻量但结构化的 **PRD harness**。你只需要先把问题说出来，它会帮团队和 Agent 把需求整理成：

- 需求澄清
- Agent 后台维护的需求事实与决策记录
- 图形化评审
- 非阻断式风险提醒与交付检查
- 面向执行系统的结构化交接

它把需求、决策和验证结果沉淀成稳定的 HTML 产物，而不是把状态散落在聊天记录或终端输出里。OpenPrd 的职责是帮助 Agent 做事：PRD、review、change、tasks、设计合同与测试证据由 Agent 在后台维护，不再要求用户回复指定内容才能继续。

## 0.2.3：Agent 主动制作任务专属 HTML 审查页

- 当复杂任务进入人工审查节点时，Agent 会主动判断是否需要制作 HTML，不再等用户专门索要。
- OpenPrd 只注入触发条件、证据结构和验证标准；页面的信息架构、视觉表达和实现方式由 Agent 根据任务自行决定。
- 不强制固定模板或渲染器；Markdown、CSV、占位页或仅创建文件都不能冒充已完成的 HTML 审查。
- HTML 必须使用真实任务证据，给出可打开路径，并完成结构与语法验证。

```bash
npm install -g @openprd/cli@0.2.3
```

## 0.2.2：头像像素合同与任务级设计隔离

- 头像和单物件 UI 位图显式区分 `transparent-cutout` 与 `opaque-full-bleed-tile`，不再把 UI 容器圆角误画进源图。
- 参考截图继续优先，但必须结合原始素材或消费组件/CSS 判断像素合同。
- `.openprd/design/active/` 新增 task scope，旧任务风格不能静默污染当前方向。
- Skill、AGENTS、hooks、adapter 生成物与回归测试同步覆盖同一合同。

- 删除 `run --context`、`--hook-inject`、ContextCapsule 和全局 session registry；Agent 直接使用自己的会话上下文。
- `UserPromptSubmit` 只记录提示，不再选择任务或向 Agent 注入下一步建议。
- 用户已经要求实现、继续或发布时，OpenPrd 不再因为需求、评审、变更、任务、说明书或质量证据尚未补齐而叫停工作。
- Codex automation、定时任务和其他无人值守任务只有明确启用 OpenPrd 时才进入维护流程。
- 历史 requirement、PRD、review、change、tasks 和实现记录保持原样，不用今天的代码倒推补写当时的需求；旧功能重新开发时，会创建今天的新需求并关联历史。
- 工作区维护欠账继续可见，但只作为后台提示；当前任务失败、发布目标、权限、制品、测试和回滚等真实条件仍会严格验证。

## 0.1.24：工作区欠账不再冒充当前任务失败

- `taskReady`、`workspaceAttention`、`claimReady`、`actionReady` 分层输出：当前任务、全局维护、整体就绪声明和具体动作条件互不污染。
- 缺少当前 `docs/basic/`、代码说明书、文件夹 README 或 EVO 证据时，OpenPrd 会提醒 Agent 后台维护，但不阻断当前实现、change apply、freeze/handoff、commit 或 release；历史 requirement/PRD/review/change/tasks 正文不进入待完善清单。
- 历史 requirement、PRD、review、change 和 tasks 进入 `legacy-frozen`：保留原文和索引，不反推、不补写；旧功能重开时创建今天的新需求。
- research、Patch Mode、设计合同和内部评审统一为 advisory；只有原始凭证读取、目标冲突等真实安全或动作边界可以拒绝执行。

| 状态 | 回答的问题 | 能否阻断当前工作 |
|---|---|---|
| `taskReady` | 当前任务是否实现并完成最小足够验证 | 只受当前任务失败影响 |
| `workspaceAttention` | 当前基础文档、代码说明书和全仓证据还应维护什么 | 否 |
| `claimReady` | 能否声称整个项目 production-ready | 只能限制整体声明 |
| `actionReady` | 当前 commit/release/handoff 等动作的精确目标、权限、制品、测试、冲突和回滚是否成立 | 只受当前动作真实条件影响 |

## 0.1.23：彻底移除流程确认残留

0.1.23 在 0.1.22 的非阻断 hook 基础上，继续清除了 requirement、harness 与大界面方向规范中的旧确认文案，并增加生成后三端 skill 回归测试。Agent 会后台维护需求、评审、设计和验证材料；用户要求实现或继续时，不再被 OpenPrd 要求批准摘要、选择默认方向或回复执行口令。

## 0.1.22：不再把流程材料变成用户门禁

- OpenPrd 不再因需求摘要、评审稿、设计合同、测试证据或风险分类缺失而阻断实现。
- 生产、支付、删除、账号切换、兜底与写死等信号只给 Agent 安全建议，不由 OpenPrd 索取用户确认。
- Skill / AGENTS 方案图和大界面候选方向用于帮助理解，不再成为写入或实现授权门槛。
- Codex、Claude Code、Cursor 共用同一套“Agent 后台维护、用户任务优先”的规则。

![OpenPrd 能力总览](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-capability-overview-zh.png)

## 适合什么场景

如果你希望：

- 在写 PRD 前先澄清需求
- 区分用户原始表达、项目已有事实和 Agent 推断
- 在 freeze 前插入架构图 / 流程图评审
- 让 Agent 遵循 repo 内置的协同规则

那么 OpenPrd 就很适合你。

如果你的同事经常会说“我大概想做这个，但还没完全想清楚”，这通常就是 OpenPrd 最能发挥作用的时候。

## 一句话需求进来，OpenPrd 怎么接住

你不需要先判断自己提的是 `L0 / L1 / L2`，也不需要先想清楚技术方案。直接用业务语言说明：谁在什么场景下遇到了什么问题、你想先解决哪一块。OpenPrd 会先帮你整理，再选择合适的推进节奏。

![OpenPrd 需求分流节奏](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-requirement-routing-zh.png)

- **直接处理**：问题已经很明确，影响小，验收也清楚。通常直接处理，改完告诉你改了什么、怎么验证。
- **现有功能优化**：目标明确，但会牵动几个页面、状态或用户动作。OpenPrd 会先用人话给你一版 mini-plan，方向对了再继续。
- **新功能 / 新流程方案**：范围更大，角色更多，或者业务风险还不清楚。先把用户场景、第一版、先不做什么和主要风险讲清楚，再进入完整方案和任务拆解。

如果更偏个人用户场景，OpenPrd 会更关注用户在什么时候会用、第一下有没有感受到价值、会不会愿意继续回来；如果更偏团队 / 企业流程，会更关注谁拍板、谁使用、谁要推进上线；如果更偏 Agent 协作，会更关注哪些环节可以自动做、哪里必须人工兜底。整个过程默认先讲结果、场景和风险，不先把内部术语丢给你。

## OpenPrd 和 OpenSpec / Superpowers 有什么不一样

OpenPrd 解决的问题，不只是“把 spec 写出来”，也不只是“把代码跑起来”，而是让
人和 Agent 在需求、评审、执行、交付这些关键节点上始终对齐。

| 工具 | 重心 | 用户主要看到的产物 | 更适合什么 |
|------|------|--------------------|------------|
| **OpenPrd** | 需求澄清、HTML 优先协作、Agent 后台上下文维护 | `review.html`、学习阅读器、质量报告、图示、结构化 change/task 状态 | 希望用户只说目标、Agent 自动维护上下文并持续推进的团队 |
| **OpenSpec** | spec / change 生命周期 | Markdown proposal、spec、design、tasks | 更关注 spec 增量治理和变更编排的团队 |
| **Superpowers** | skill 驱动的编码执行流 | skills、plans、worktree / subagent 流程、代码评审检查点 | 更关注 AI Agent 如何规划、编码、review、收尾的工程团队 |

OpenPrd 最有特色的地方，在于它把“这次到底在做什么、Agent 依据什么继续、最后如何验证”
做成稳定可见的协作面，而不是让用户记住 spec 文件、内部口令或 prompt 流程。

## 典型真实场景

最近 30 天的 Codex 项目记录里，OpenPrd 反复出现在几类连续工作里：模糊需求澄清、
已有产品流程改造、发布与交付、线上问题闭环，以及把一次完成的工作整理成可复用学习资料。

| 场景 | 为什么这里更像 OpenPrd 的强项 | 主要产物 |
|------|--------------------------------|----------|
| 模糊产品需求，需要边做边收敛 | 区分用户原始表达、项目事实与 Agent 推断，在推进中持续沉淀稳定评审页。 | `clarify`、`capture`、`synthesize`、`review.html` |
| 已有流程或登录入口改造 | 先从仓库与运行态重建当前事实，再决定下一步 change，而不是直接拍脑袋改。 | `discovery`、`diagram`、`review.html`、`change` |
| 流程图、界面或架构确认 | 把理解差异放到图示和可评审产物里，而不是埋在聊天记录里。 | `diagram`、`visual-compare`、左右对比 JPG |
| 长程 Agent 执行链路 | 把当前工作拆成按依赖可执行的小任务，每次新会话只推进一个任务并带任务级验证。 | `tasks`、`loop`、任务提示词、进度日志、验证报告 |
| 发布、开源、交接前收口 | 让“现在能不能交付”变成有证据的显式判断，而不是靠感觉。 | `quality`、`run --verify`、`doctor`、`handoff` |
| 一次需求或修复做完后沉淀学习资料 | 把最终需求、过程判断和结果整理成新成员可以直接学习的资料。 | 学习阅读器、`.openprd/knowledge/skills/`、docs 同步 |

## HTML 优先协作产物

OpenPrd 会生成可以直接分享的 HTML 面板，让产品、研发和 Agent
围绕同一份稳定 artifact 协作，而不是各自回放聊天记录或命令输出。

除了下面这些固定流程产物，OpenPrd 还会通过 AGENTS 与 skills 注入一条 Agent 行为规范：当存在人类审查节点，且出现 8 个及以上逐项证据对象、可逆逐项审批、多媒体上下文、用于高影响动作的复杂测试/发布矩阵，或必须导航筛选的长期材料时，除非用户明确不要或已有同等任务专属界面，否则 Agent 必须自行设计、制作并验证当前任务的 HTML 审查页；Markdown/CSV 只作为证据或导出，不能替代。OpenPrd 只提供判断原则和质量合同，不用通用 renderer 代替 Agent 思考；未命中强制边界时仍由 Agent 按审查成本判断，简单结果不会为了形式被强行 HTML 化。

### `review.html`

把当前需求版本整理成可评审页面，适合先给产品、研发或负责人确认“这次到底在做什么”。
如果项目已经启用 `release` 版本轨道，评审页顶部也会直接显示当前 `项目版本`。

![OpenPrd review HTML](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-review-html.png)

### 学习阅读器

把一次需求、修复或协作方法整理成图文学习资料，方便新成员理解“这套流程为什么这样设计”。

![OpenPrd learning HTML](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-learning-html.png)

### 质量回归报告

把任务验证、工作区提醒、整体就绪声明和仍需人工判断的点放到一个可读页面里。报告帮助判断和补证据，不替用户决定是否继续当前工作。

![OpenPrd quality HTML](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-quality-html.png)

### 效果图与截图拼图对比，自动优化

把效果图和实现截图放进同一张左右对比图里，适合登录入口改造、条款页本地化、弹窗复刻这类阶段性评审。
视觉证据会跟随当前任务语境选择语言：中文需求默认输出中文标签，英文需求默认输出英文标签；需要固定语言时可显式传入 `--locale zh-CN` 或 `--locale en`，证据板里的标题、摘要和检查项也会一起跟随。

![效果图与截图拼图对比，自动优化](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-visual-compare-case-study-zh.png)

```bash
openprd visual-compare . --reference ref.png --actual actual.png --locale zh-CN
openprd visual-compare . --board verification-board.json --locale en
```

## 自我成长机制

OpenPrd 会沿着两条看得见的循环，越用越贴合你们的协作方式。一条循环把真实项目里反复验证过的做法沉淀成可复用的 `项目级 Skill`；另一条循环把不同场景下更合适的协作设置沉淀成 `动态参数配置`，让下次启动时直接带上更合适的默认做法。

![OpenPrd 自我成长机制](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-self-evolving-mechanisms-zh.png)

### 场景一：项目级 Skill

当团队在真实工作里反复确认同一种判断，OpenPrd 不会让它继续散落在聊天记录里，而是把它留在项目身边。

- 例子：一次登录入口改造里，团队确认“登录、注册、找回密码都走官网”。
- 下次能直接复用什么：相关页面要一起检查、发布前要核对哪些入口和文案、类似需求应该沿着什么路径推进。
- 为什么有用：下一次类似需求不会再从零开始，新成员接手也能直接照着做。

### 场景二：动态参数配置

不是每个项目都该用同一套起手方式。OpenPrd 会把不同场景下更合适的协作设置留住，并在下次自动带回来。

- 例子：一个新项目会先澄清目标和范围，一个接手中的旧项目会先还原现状和改动边界。
- 下次会自动带上什么：先问什么、先看什么、交付前先收什么材料。
- 为什么有用：团队不用每次重新解释“这类项目该怎么开场”，而是直接从更合适的默认方式开始。

## 默认带上的增强能力

OpenPrd 不只是帮你把协作流程说清楚，也会把“该去哪里找资料、先看什么再继续”这件事提前铺好。对公开仓库、第三方技术文档和图标素材，它会默认走更合适的增强路径，而不是等你每次手动提醒。

![OpenPrd 默认增强能力](https://raw.githubusercontent.com/mileson/openprd/main/docs/assets/openprd-best-practices-zh.png)

- **公开仓库 / 对标参考**：优先用 `DeepWiki` 更快看懂架构、关键流程和实现线索。
- **第三方库 / CLI / SDK / MCP**：优先用 `Context7` 看最新文档、配置方式、版本差异和迁移说明。
- **图标与视觉素材**：按用途分流到更合适的资源站或实现库，不把 UI 图标、AI 品牌、技术栈图标和 3D 素材混着找。
- **项目自己的做法优先**：先看仓库里已经确认过的经验和约定，再补外部最佳实践，不让通用建议盖过项目语境。

这些增强能力默认是“配上更好”，不是硬依赖。没配置也不会影响初始化或当前任务，只会在后续建议里提醒你补上。

## 功能

- **Clarification-first**：`clarify -> capture -> classify -> interview -> synthesize -> diagram -> freeze -> handoff`
- **场景感知协同**：区分空项目冷启动、已有项目首次接入、持续推进中的 workspace
- **自我成长机制**：把真实项目里确认过的做法沉淀成可复用的 `项目级 Skill`，并按场景沉淀 `动态参数配置`
- **来源感知采集**：支持 `user-confirmed` / `project-derived` / `agent-inferred` / `agent-normalized`
- **最佳实践路由**：在公开仓库理解、第三方技术文档、图标资源和协作方式优化这类任务里，先把请求路由到更合适的证据源
- **项目级 benchmark registry**：支持 `benchmark add / observe / approve / verify`，把被反复采纳的外部来源沉淀成项目自己的长期参考
- **图形评审工件**：支持 `architecture` 和 `product-flow`
- **界面视觉对比工件**：把效果图与实现截图合成左右对比 JPG，用于阶段性复刻评审
- **Contract 驱动图渲染**：支持从 JSON contract 显式渲染
- **Review status**：支持 `pending-confirmation` / `confirmed` / `needs-revision`
- **用户视角变化摘要**：`loop commit`、`handoff` / 版本说明、`review` 摘要默认优先使用 `新增 / 修复 / 优化 / 调整 / 移除` 这类短标签
- **项目级版本轨道**：可选维护 `0.1.23` 这类项目版本号、版本内变化条目，以及与本地 git tag 的协同，不和内部 PRD `v000x` 混用
- **评审记录与执行分离**：PRD review 状态只记录 artifact；“可以开做 / 请实现 / 继续”足以表达执行意图，但不会伪造某份评审稿的用户确认
- **OpenPrd 发现模式**：为已有项目、参考项目或不清晰需求初始化可持续推进的覆盖状态
- **项目标准化**：初始化并验证 `docs/basic/`、文件说明书模板和文件夹 README 模板
- **OpenPrd change 与任务执行**：从 PRD 快照生成 change 文件，校验结构，沉淀 accepted specs，归档变更，并按依赖顺序推进结构化任务
- **长程 Agent Loop**：把 change 任务转成“一次新会话只做一个任务”的 Codex / Claude 执行提示词，并沉淀验证、进度日志和可选任务 commit
- **默认 Agent 接入**：从一套 OpenPrd 源生成 Codex、Claude、Cursor 三端规则，并默认开启 Codex hooks
- **Repo 内置 skills**：工具和 Agent 协同约束一起发布

## 一句话安装

```bash
npm install -g @openprd/cli
```

如果你只是想先跑起来，或者 Windows 里刚装完 CLI 但 `openprd` 还没出现在 `PATH`，也可以直接用 `npx`：

```bash
npx @openprd/cli@latest --help
npx @openprd/cli@latest init . --template-pack agent
```

安装后验证：

```bash
openprd --help
```

### Windows 排查

如果全局安装成功后依然提示找不到 `openprd`，先检查：

```powershell
where openprd
npm config get prefix
```

如果 `where openprd` 没有结果，把 npm global prefix 加到 `PATH` 后再重新打开终端。Windows 下这个目录通常是 `%AppData%\npm`，不是 Unix 常见的 `{prefix}/bin`。

之后更新 CLI 时先预演，再执行：

```bash
openprd self-update --dry-run
openprd self-update
```

## 快速开始

### 1. 初始化

```bash
openprd init /path/to/project --template-pack agent
```

如果 `openprd` 还没进 `PATH`，直接把同一条命令前面换成 `npx @openprd/cli@latest` 即可：

```bash
npx @openprd/cli@latest init /path/to/project --template-pack agent
```

`init` 会创建 `.openprd/`、`docs/basic/`、`AGENTS.md`，并生成 Codex / Claude / Cursor 三端引导。`.openprd/` 是项目内唯一的 OpenPrd 工作区；change、spec、task 和 archive 产物都会收敛到 `.openprd/changes/`、`.openprd/specs/` 和 `.openprd/archive/changes/`，不再在仓库根目录生成单独的 `openprd/` 目录。Codex 项目会同时写入 `.codex/config.toml`、`.codex/hooks.json`、`.codex/hooks/openprd-hook.mjs`，并开启用户级 Codex `hooks = true`。

Codex hooks 默认使用 `lite` 模式：`UserPromptSubmit` 只记录当前提示，非阻断式
`PreToolUse` 提供安全与材料维护建议，轻量 `Stop` 做收工回顾。Hook 不选择任务、
不恢复跨项目会话，也不向 Agent 注入任务上下文。
需要让 shell 命令也获得更完整的风险提示时使用 `guarded`，只有临时深度诊断才使用
`full`。
如果用户给出报错、日志、复现、根因排查等明确故障证据，并要求直接修复，
hook 会按小型 bugfix 处理，不开启需求入口；“确认修复”这类确认词也会关闭
已打开的需求入口。

`init` 还会顺手做一层非阻断式可选能力检测，并把结果写进
`.openprd/harness/install-manifest.json` 的 `optionalCapabilities`。例如：

- `Context7`：帮助 Agent 获取最新的第三方技术文档、配置、版本差异、迁移路径和高质量实现信息
- `DeepWiki`：帮助 Agent 用对话方式理解 GitHub 公开仓库的架构、关键流程和实现线索

如果这些能力尚未配置，初始化不会失败；OpenPrd 只会把它记录成后续建议，并附上官方文档、GitHub 地址和 MCP 地址，方便后面按当前客户端补配置。

### 2. 查看当前协同节奏

```bash
openprd status /path/to/project
openprd next /path/to/project
```

如果项目已经启用版本轨道，`status` 也会直接显示当前项目版本和该版本累计了多少条变化项。

### 2b. 可选：设置项目版本轨道

```bash
openprd release /path/to/project --set 0.1.23
openprd release /path/to/project --notes "新增版本说明入口"
openprd release /path/to/project
```

`release` 维护的是项目级版本账本，不是 OpenPrd 内部 PRD 的 `v0004` 这类版本号。启用后，后续 handoff、版本说明和 `loop --finish --commit` 的本地 tag 协同都会优先复用这里的版本信息。

如果 OpenPrd 自身要把新版本发布到 GitHub，默认还要推送匹配的版本 tag，并配套 GitHub Release。可以先用 `node scripts/openprd-github-release-notes.mjs /path/to/project --version 0.1.23 --tag v0.1.23 --out /tmp/openprd-release.md` 预览发布文案；仓库内的 `github-release` workflow 会在 tag push 或手动触发时，基于同一份 `release-ledger` 自动创建或更新 GitHub Release。

### 3. Agent 后台整理需求

```bash
openprd clarify /path/to/project
```

澄清阶段只在对话里输出提纲或简短清单；正式 HTML 评审统一留给合成后的 `review.html`。

OpenPrd 会先按用户可见的需求类型接住这句话，而不是先让你填一堆表单：

- **直接处理**：通常直接做，做完告诉你改了什么、怎么验。
- **现有功能优化**：Agent 用 mini-plan 收敛范围并继续执行，显式说明采用的假设。
- **新功能 / 新流程方案**：Agent 在后台整理场景、范围、第一版和风险，并持续维护 `review`、`change` 和 `tasks`，不要求用户批准这些内部材料。

### 4. 写回答案

单条写回：

```bash
openprd capture /path/to/project \
  --field problem.problemStatement \
  --value "移动端缺少高效的 Agent 会话与节点管理入口" \
  --source user-confirmed
```

批量写回：

```bash
openprd capture /path/to/project --json-file answers.json
```

`--source agent-normalized` 只用于 `capture` 之后的纯内部措辞整理，
这类没有语义变化的润色不应重开当前 `review.html` 的确认。

### 5. 生成草稿与图

```bash
openprd synthesize /path/to/project \
  --title "Moticlaw Mobile" \
  --owner "Moticlaw" \
  --problem "移动端用户缺少直连优先的节点选择与 Agent 会话入口。" \
  --why-now "控制面已经具备，当前缺少的是移动端入口。"

openprd review-presentation /path/to/project --template
openprd review-presentation /path/to/project \
  --presentation review-presentation.json \
  --write \
  --fail-on-violation

openprd diagram /path/to/project --type architecture --open
openprd diagram /path/to/project --type product-flow --open
openprd review /path/to/project --open
openprd review /path/to/project --mark confirmed --version <id> --digest <sha256> --work-unit <id>
```

`review.html` 是当前 PRD 的稳定评审稿，也是用户随时可以查看的协作结果，但不是
OpenPrd 授权门禁。Agent 自动绑定当前精确的 `--version`、`--digest`、`--work-unit`，
自行记录 review、生成 change、拆解 tasks 并继续用户已经要求的工作；不得反过来要求
用户粘贴 digest、work-unit、完整命令或批准内部材料。信息不完整时，Agent 优先选择
可逆默认方案并说明假设；是否真的需要提问由当前 Agent 根据宿主安全规则与真实上下文判断：

```bash
openprd change /path/to/project --generate --change <change-id>
openprd tasks /path/to/project --change <change-id>
```

### 6. Freeze 与 handoff

```bash
openprd freeze /path/to/project
openprd handoff /path/to/project --target openprd
```

`handoff` 导出的 `handoff.json` 和 `handoff.md` 会同时带上用户视角的变化摘要 / 版本说明片段，默认按 `新增 / 修复 / 优化 / 调整 / 移除` 组织，方便直接扫读或复用。若项目已启用 `release` 版本轨道，handoff 会优先导出当前项目版本下累计的变化条目，并额外写出 `项目版本: 0.1.23` 这类信息。

### 7. 启动 OpenPrd 发现模式

用户可以直接用自然语言说：

```text
用 OpenPrd 深度补全这个项目。
用 OpenPrd 全面复刻这个参考项目的产品逻辑。
继续深挖这个需求，直到 OpenPrd 覆盖完整。
```

Discovery 和 loop 执行需要明确的深度或执行意图。用户只是说“看看、规划、
梳理、分析、预计动哪些文件、怎么改”时，Agent 应只读检查状态和代码后回答，
不得推进 coverage，也不得启动 loop 任务。

Agent 会在内部完成路由。底层命令是：

```bash
openprd discovery /path/to/project --mode brownfield
openprd discovery /path/to/project --resume
openprd discovery /path/to/project --advance --claim "用户可以从工作台发起会话" --evidence src/app.ts
openprd discovery /path/to/project --verify
openprd change /path/to/project --generate --change <change-id>
openprd change /path/to/project --validate --change <change-id>
openprd standards /path/to/project --verify
openprd tasks /path/to/project --change <change-id>
openprd tasks /path/to/project --change <change-id> --advance --verify --item T001.01
openprd change /path/to/project --apply --change <change-id>
openprd change /path/to/project --archive --change <change-id>
openprd specs /path/to/project
openprd changes /path/to/project
```

持续发现的校验也会检查当前 OpenPrd change 结构、spec delta、`docs/basic/`
标准化文档和长程任务文件。保留 `tasks.md` 作为第一个入口，每个任务文件最多放
25 个实质 checkbox 任务；超过后继续使用 `tasks-002.md`、`tasks-003.md`。
每个非最终任务文件的最后一个 checkbox 应指向下一个任务文件，方便 Agent 按顺序
继续。项目也可以通过 `.openprd/discovery/config.json` 的
`taskSharding.maxItemsPerFile` 使用更细的本地限制。

这里的 25 只是分片上限，不是拆解目标。任务标题应优先描述可直接落地的实现单元、
接线边界、页面入口、集成闭环和回归项，而不是把“主流程 / 功能需求 / 验收目标 /
非功能需求”这些 PRD 小节逐条平移成 checkbox。

如果任务需要稳定编号来支撑长程执行，只保留最小元数据：

```md
- [ ] T009.07 Port legacy database import preview
  - type: implementation
  - deps: T001.14, T007.06
  - done: preview shows counts, conflicts, skipped items, warnings
  - verify: npm run test -- migration
  - test-layer: unit, integration
  - test-size: medium
  - test-scope: cli-contract
  - evidence-plan: 单元测试覆盖导入解析，命令行契约输出留下证据
```

`type` 用来区分 `implementation`、`verification`、`documentation` 和
`governance`。`deps` 只在依赖前置任务时填写；`done` 写完成条件；`verify`
写验证命令或审查步骤。生成的 `implementation` 和 `verification` 任务默认使用
`openprd tasks . --change <id> --item <task-id> --evidence-required`：Agent 先运行本任务最小足够测试或审查，再通过
`--evidence <路径或摘要>` 传入证据，或在任务 metadata 写入 `evidence:` /
`waiver-reason:`；文档任务仍使用 standards 校验。`openprd run . --verify`
保留给阶段或最终门禁，不作为每个任务的默认验证；也不能只用
`openprd change . --validate` 代替真实落地证据。旧版生成任务如果仍写着
`verify: openprd run . --verify`，通过 `openprd tasks --verify` 执行时也会
按本任务 evidence 门处理，不会继续反复生成 workspace quality 报告。

任务也可以包含测试策略元数据。`test-layer`、`test-size`、`test-scope`
和 `evidence-plan` 用来帮助 OpenPrd 按风险选择最小足够证据：局部逻辑优先单元测试，
触达 CLI/API/Agent 契约或跨模块状态时使用集成/契约验证，触达用户主路径、视觉、小程序、
性能、安全或成本风险时升级到端到端或专项验证。这些字段是证据分流，不是固定 70/20/10
比例门禁。

`tasks` 默认列出下一个依赖已满足的任务。`--advance` 会勾选完成任务；
同时传 `--verify` 时，会先运行该任务的 `verify` 命令，通过后再勾选。执行记录
写在任务文件外，避免把 `tasks.md` 元数据变复杂。

## 项目标准化

`openprd init` 会创建项目标准化契约：

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`
- `.openprd/standards/file-manual-template.md`
- `.openprd/standards/folder-readme-template.md`

当项目已经存在源码文件时，运行 `openprd standards --verify` 会以非阻断报告展示以下标准化缺口：

- `docs/basic/` 仍停留在“待补充”等模板占位内容。
- 源码文件头部缺少文件说明书。
- 承载源码的文件夹缺少 `[项目名]_[文件夹名]_README.md` 文件夹说明书。

检查命令：

```bash
openprd standards /path/to/project --verify
```

默认命令返回成功，避免文档债截停当前任务；需要在独立治理作业里严格检查时，显式追加 `--fail-on-violation`。

OpenPrd 生成的 change 会包含标准化维护任务。项目基础文档的唯一标准路径是 `docs/basic/`。
这些全仓缺口在普通 doctor、change apply、freeze/handoff 和当前任务验证中只作为 `workspaceAttention`，不会让 `taskReady` 或 `actionReady` 变成失败。

实现阶段的标准化维护是明确的影响判定。每次新增或修改源码文件时，Agent 检查
`docs/basic/`、文件说明书、所在文件夹 README 是否因本次变更过期，并在后台同步
能由当前源码验证的内容。与本任务无关的历史缺口留在工作区提醒中，不为了过门禁而
反推旧需求、旧验收或旧实现理由。

`openprd dev-check` 同样只检查本轮 touched files 并给出结构建议。默认不会要求超行
文件在当前任务里先重构；显式开启 `--auto-refactor on` 也只在结构优化与当前目标同范围
时建议顺手处理，不会让规模债变成任务失败或要求用户回复开关口令。

## 生图路由：自动选对免费生图工具

图片、封面图、效果图、图标等生图请求按三层路由自动选工具，不需要用户指定：

1. **工具面判定**：Codex 环境用原生 `imagegen`（Image 2），Cursor 环境用内置
   `GenerateImage`——两者都是对话工具内的免费能力，优先直接使用。
2. **已存偏好**：都不可用或无法判断时，先读
   `.openprd/harness/image-generation-preference.json` 里用户已确认的偏好，
   有就直接用，不再重复询问。
3. **询问并持久化**：没有偏好时才问用户一次，答复以 `user-confirmed` 来源
   写回该文件，作为下次默认。

成本护栏：任何情况下都不允许在用户未明确指定时，擅自调用用户本地或自有的
付费生图 API（例如 OpenAI / Stability key）。路由协议由 install manifest 和
`.openprd/harness/runtime-environment.json` 的 `imageGenerationRouting` 字段承载。

## 画布协同：标注改图闭环

`openprd canvas .` 打开与当前对话绑定的本地 Excalidraw 画布后，AI 生成的图会
直接落到画布上，你可以在图上直接画圈、写字做标注，然后点击“发送给 Codex”，
剩下的交给 Agent：

1. **标注即指令**：画布检测到选区里同时有原图和你的手绘标注时，会把这次交接
   标记为标注改图请求，把标注截图和结构化元数据（原图 ID、标注 ID）一起交给
   Agent，Agent 把标注当作修改指令生成新图。
2. **旁位回填，不覆盖原图**：Agent 通过 `POST /api/insert-image` 用原图作 anchor
   把新图放到旁边（右/左/上/下可选），你可以左右对比原图和新版，再继续在新图
   上标注，形成多轮迭代闭环。
3. **结构化读画布**：Agent 通过 `GET /api/selection` 读到你正在圈选哪些元素的
   ID、坐标、尺寸和文本，不再只靠截图猜。
4. **尺寸契约**：AI 生图占位卡的宽高和比例会作为 `sizeContract` 写进生图提示，
   生成的图片按占位卡比例出图，回填不变形。

唤起方式：在对话里自然地说“打开画布一起看”“我在画布上标注了，按标注改图”
这类话，Agent 会按当前会话判断画布协同意图；也可以直接运行 `openprd canvas . --daemon --open`。

## 效果图与截图拼图对比，自动优化

当界面任务已经有效果图、设计稿、用户给图或 Agent 自己生成的 mock 时，Agent
在阶段性完成后应先截实现图，再生成左右对比图，不能只靠主观印象判断是否一致：

```bash
openprd visual-compare /path/to/project \
  --reference effect-image.png \
  --actual implementation-screenshot.jpg
```

默认会在 `.openprd/harness/visual-reviews/` 下输出体积较小的 JPG。左侧标注
`效果图`，右侧标注 `实现截图`。输入可以是 `sharp` 支持的常见图片格式。

如果只调整按钮、hover、提示框、间距、圆角、字号或颜色等局部 UI，不要用全屏图作为主裁决。直接指定左右有效区域：

```bash
openprd visual-compare /path/to/project \
  --reference effect-image.png \
  --actual implementation-screenshot.jpg \
  --reference-box 0,0,516,130 \
  --actual-box 1840,238,516,130 \
  --presentation local-first
```

`local-first` 使用同一像素尺度裁剪两侧，较小区域不会被单独拉伸成同宽。输出先展示局部参考、局部实现和差异图，全屏缩略图只放在底部检查未改区域漂移。修改前后模式使用 `--before-box` 和 `--after-box`。坐标默认是像素，也支持 `ratio:` 或 `percent:` 前缀。

如果界面任务没有明确效果图，Agent 应先截修改前截图，完成改动后用同一入口、
视口、账号和数据状态再截修改后截图：

```bash
openprd visual-compare /path/to/project \
  --before before-screenshot.png \
  --after after-screenshot.jpg
```

修改前后模式会把左侧标注为 `修改前`、右侧标注为 `修改后`，帮助 Agent 检查
预期变化是否出现，以及未改区域是否有布局、颜色、密度或状态漂移。输出也可以按需要调整：

```bash
openprd visual-compare /path/to/project \
  --reference effect-image.png \
  --actual implementation-screenshot.jpg \
  --out review.webp \
  --format webp \
  --quality 82 \
  --max-panel-width 1180
```

Agent 必须查看生成图并继续对标，直到没有明显视觉差异。最终回复里应给出本次
生成的对比图路径，并说明对比后是否仍有差异。

如果新功能或改动包含同构列表、卡片、网格或表格，或者用户反馈“没对齐”“排版
漂移”，Agent 还要把真实截图、辅助线、容器轨道量测和内部内容槽位量测放到一张对齐证据板里：

```bash
openprd visual-compare /path/to/project \
  --board alignment-board.json
```

`alignment-board.json` 使用 `mode: "alignment-board"`，记录截图、辅助线、
容器分组和内容槽位分组。容器轨道包括卡片外框、列宽、行顶、间距等；
内容槽位包括标题、副标题、标签、描述、状态、价格、按钮、图标和操作区等
相同文案类型/相同组件槽位的 x/y/宽高/baseline spread。列表卡片、卡片网格和
表格这类重复结构属于默认触发场景，不需要等用户先指出“没有对齐”；只量外框、
列宽或行顶不算完整对齐验收。

网格、基线和对齐辅助线只用于这条布局校验路径。普通 `before/after`、`reference/actual` 与 `verification-board` 不会自动叠加网格；它们默认使用紧凑的暖色结果画布，让截图和结论占据主要空间。

如果要判断单个 logo、icon、avatar、badge、按钮图形或图片裁切内部是否居中，
或者用户反馈“偏心”“视觉重心不对”，Agent 应先裁出目标元素，再生成内部居中证据板：

```bash
openprd visual-compare /path/to/project \
  --board centering-board.json
```

最小语法如下：

```json
{
  "mode": "centering-board",
  "title": "Logo 内部居中检查",
  "image": ".openprd/harness/screenshots/logo.png",
  "thresholdPx": 8,
  "subject": {
    "mode": "auto",
    "weight": "contrast"
  }
}
```

如果自动 mask 把背景、阴影或透明边缘算进主体，可以显式指定颜色范围：

```json
{
  "mode": "centering-board",
  "image": ".openprd/harness/screenshots/logo.png",
  "subject": {
    "mode": "range",
    "ranges": [
      { "r": [180, 255], "g": [140, 255], "b": [0, 120] },
      { "r": [210, 255], "g": [210, 255], "b": [200, 255] }
    ],
    "weight": "luma"
  }
}
```

`centering-board` 会输出红色画布中心线、绿色主体外接框、黄色视觉重心点，
并在 metadata 里记录主体外接框中心偏移和视觉重心偏移。单张原始截图或
“看起来居中”的主观判断不能替代这张证据板。

## 回归测试与质量评估报告

`openprd init` 同时会创建质量契约：

- `.openprd/quality/config.json`
- `.openprd/quality/reports/`
- `.openprd/knowledge/`

检查命令：

```bash
openprd quality /path/to/project --verify
```

该命令会在 `.openprd/quality/reports/` 下同时写入 JSON 和 HTML。HTML 回归测试报告
是阶段性质量查看的主要产物，优先展示整体回归结果、逐需求模块结果、测试块通过情况、
分层测试策略矩阵、未通过项和需要确认是否属于本期的遗漏。EVO 是 OpenPrd 内部对
“质量评估/验证层”的简称；用户可见报告不要求理解这个缩写。脚本、依赖或 fixture
存在只代表项目具备能力，不能替代本次运行证据。

当需求涉及免费用户、额度、AI 调用、第三方 API、生成、存储、下载或其他消耗型成本时，
`quality --verify` 会额外检查是否存在成本来源、用户级限制、负向验证、用量/成本监控、
报警阈值和止损动作，避免免费额度或高成本路径在上线后才暴露。

`openprd quality --verify` 默认把未 production-ready 的本期必测块留在报告中并返回成功，避免
证据债截停当前任务；独立治理作业可显式追加 `--fail-on-violation` 获得严格退出码。`openprd run --verify` 把它放入 `claimReady` 和
`workspaceAttention`，不会把已经通过本任务验证的实现改成失败，也不会回滚已产生的 commit。
如果界面任务已有参考图，视觉就绪还需要 `.openprd/harness/visual-reviews/`
下存在本次 `openprd visual-compare --reference/--actual` 产物；如果没有参考图但改动界面，
还需要存在 `openprd visual-compare --before/--after` 修改前后产物。普通截图实测需要截图实测证据板；
同构列表、卡片、网格或表格还需要对齐辅助线证据板，并同时覆盖容器轨道和内部内容槽位；
单个素材、图标、头像、徽标、按钮图形或图片内部居中/视觉重心判断需要内部居中证据板。
对比图仍有明显差异、坐标偏差或漂移时，应回到实现继续调整。

当一个问题已经修复并完成验证后，可以把抽象模式沉淀为项目级经验：

```bash
openprd quality /path/to/project --learn --review --from .openprd/harness/turn-state.json
openprd quality /path/to/project --learn --from <report-id-or-json>
openprd quality /path/to/project --learn --from ./diagnostics/incident-2026-05-24
```

`--learn --review` 会先在 `.openprd/knowledge/candidates/` 生成待确认
knowledge candidate，并在 `.openprd/knowledge/drafts/` 生成 draft skill。
确认值得长期保留后，再用 `--learn --from` promote 为 `.openprd/knowledge/`
下的 incident、pattern 和经验 Skill，让后续任务能提前触发同类经验，而不是重新排查一遍。`--from`
现在既可以接质量报告 JSON，也可以直接接已经导出的诊断目录 / 证据文件；
只要里面已经有 `diagnostic-report`、`runtime-events`、`timeline`、
`root-cause-candidates` 这些结构化诊断产物，就能直接沉淀成可复用的排查 Skill。

## Agent 自动接入

OpenPrd 会把协同规则装进项目，让用户不需要记住具体 skill、命令或 hook：

```bash
openprd setup /path/to/project
openprd doctor /path/to/project
openprd self-update --dry-run
openprd self-update
openprd update /path/to/project
openprd update /path/to/project --hook-profile lite
openprd upgrade /path/to/project --dry-run
openprd upgrade /path/to/project
openprd upgrade /path/to/projects --fleet --dry-run
openprd fleet /path/to/projects --dry-run
openprd fleet /path/to/projects --sync-registry
openprd run /path/to/project --verify
openprd loop /path/to/project --plan --change <change-id>
openprd loop /path/to/project --run --agent codex --dry-run
```

仅安装 CLI 不会直接改写项目或用户配置。用户在项目里运行 `openprd init` 或
`openprd setup` 时，才会安装完整的 Codex / Claude / Cursor 适配配置。

`setup` 与 `init` 会生成：

- `AGENTS.md` 中的 OpenPrd 管理规则
- `.codex/skills/`、`.codex/prompts/`、`.codex/config.toml`、`.codex/hooks.json` 和 `.codex/hooks/openprd-hook.mjs`
- 用户级 Codex config 的 `features.hooks = true`
- `.claude/skills/`、`.claude/commands/openprd/` 和 `CLAUDE.md`
- `.cursor/rules/openprd.mdc` 和 `.cursor/commands/`
- `.openprd/harness/install-manifest.json`、`hook-state.json`、`events.jsonl`、`drift-report.json` 和 `visual-reviews/`

`setup`、`init`、`update` 和 `doctor` 还会维护 `.openprd/harness/install-manifest.json`
里的 `optionalCapabilities` 建议。它们只用于提示“配上会更好”的能力，不会把
初始化、诊断或当前任务变成失败。

`doctor` 会检查三端引导、Codex hooks 开关和 OpenPrd 工作区结构，同时把项目标准化欠账单独显示为“工作区待关注”；说明书缺口不会让集成诊断本身失败。它也会展示像 Context7 / DeepWiki 这类可选增强建议。`update` 会从 OpenPrd 的统一源刷新生成文件，并保留用户自己已有的 hook 分组。

新版本更新会自动识别旧项目遗留的根目录 `openprd/changes/`、`openprd/specs/` 和 `openprd/archive/changes/`，并把内容迁移到 `.openprd/` 对应位置；无冲突时会删除空的旧 `openprd/` 目录。若同名文件内容不同，旧文件会保留在原处并让本次更新失败，避免静默覆盖用户数据。

`self-update` 只更新 OpenPrd CLI 自身，默认使用公开 npm 包。
`upgrade` 会编排两层更新：先执行 `self-update`，再重新解析安装后的
`openprd` 可执行文件，然后执行 `update <project>`；加 `--fleet` 时会执行
`fleet <root> --update-openprd`，刷新已有 `.openprd/` 的历史项目，并识别只有旧根目录 `openprd/` 工作产物的项目完成迁移。两个入口都支持
`--dry-run`，预演时只打印安装和刷新命令，不修改 CLI、项目、registry 或 harness 状态。

这套 harness 是有状态的，但 hook 重量由 profile 控制。默认 `lite` 保留轻量
PreToolUse 非阻断式建议，并把匹配范围限制在直接编辑工具上，同时在 `Stop` 做一轮轻量项目经验回顾，避免只读 shell 噪声和完整工具级遥测；`guarded` 会额外覆盖 shell 工具，`full` 只建议用于临时深度诊断。`freeze`、`handoff`、accepted spec apply/archive、commit、push、release、publish 等动作可以读取 `openprd run . --verify` 的分层状态，但只由精确目标、权限、冲突、本次制品/测试和回滚条件决定 `actionReady`；全局文档和 EVO 债只作提醒。

`openprd run . --verify` 只负责验证当前工作区和激活 change；它不读取用户消息，不选择 Agent 的下一项任务，也不返回上下文胶囊。Hook turn 仍可通过内部 `run --record-hook` 记录到 `.openprd/harness/iterations.jsonl`。

### 长程 Agent Loop

如果进入真正的开发落地阶段，建议使用 `openprd loop`。它会先生成稳定的 feature list，
再为每个任务写出单独提示词，启动一个新的
Codex 或 Claude 会话只处理这一个任务。每个任务完成后必须先自测，失败就修复并
重新自测；前端界面任务在 Codex 客户端优先用 Computer Use，在 Codex CLI 和
Claude Code 中优先用 Playwright、MCP 浏览器自动化或项目已有 e2e 工具。验证
通过后，`loop --finish` 会写入阶段性测试报告，并可在隔离 worktree 中为该任务生成独立 commit。
界面任务完成前必须运行 `openprd visual-compare`：已有参考图时截实现图并走
`--reference/--actual`，没有参考图但改动界面时先留修改前截图、完成后留修改后截图并走
`--before/--after`，普通截图实测走 `--board <verification-board.json>`，同构列表、卡片、网格或表格走
`--board <alignment-board.json>`，单元素内部居中/视觉重心问题走
`--board <centering-board.json>`，查看证据图后才能完成任务。

只有当用户当前明确要求开发、实现、继续任务、深度调研、深度对标、复刻落地或
提交时，Agent 才能运行 `openprd loop --run`、`openprd tasks --advance`、
`openprd discovery --advance` 或 commit 命令。规划和审查类对话应止步于模块 /
文件清单和证据说明。

Loop 是否使用独立 worktree 由 Agent 根据实质实现任务数、写入范围和并行冲突判断；OpenPrd 不再通过上下文命令替 Agent 做这个选择。

```bash
openprd loop . --init
openprd loop . --plan --change <change-id>
openprd loop . --next
openprd loop . --prompt --agent codex
openprd loop . --run --agent codex --dry-run
openprd loop . --run --agent codex --worktree ../openprd-loop-wt --branch loop/feature-x --dry-run
openprd loop . --run --agent claude --dry-run
openprd loop . --verify --item T001.01
openprd loop . --finish --item T001.01 --worktree ../openprd-loop-wt --branch loop/feature-x --commit --message "新增版本说明入口"
```

如果项目启用了 `release` 版本轨道，`loop --finish --commit` 会在成功提交时把当前任务的短文案累计到当前项目版本下，并尝试把同名本地 tag（例如 `0.1.23`）移动到最新 commit。若远端已存在同名 tag，OpenPrd 会提示风险并跳过本地 tag 改写，不会静默覆盖远端历史。

主工作区已经有未纳入本任务提交的改动时，`loop --finish --commit` 默认会阻断，提示你改用 `--worktree <path> --branch <name>`；只有你明确知道要在主工作区做 scoped commit 时，才显式加 `--allow-dirty-main`。提交范围也不再是 `git add -A`，而是按任务 `write-scope`、任务来源文件和本轮新增 touched files 收窄，避免把无关改动卷进单任务 commit。

Loop 状态会沉淀在 `.openprd/harness/`：

- `feature-list.json`：按依赖排序的执行任务列表
- `feature-list.json`：每个任务都会带一个人类可读的 `taskHandle`，例如
  `change-id:T001.01:task-title`，方便跨对话继续同一任务，而不是只靠聊天 UUID
- `progress.md`：给人看的进度记录
- `agent-sessions.jsonl`：每次 prompt / run / finish 的结构化事件，也会记录任务句柄、任务标题、worktree 路径、分支和 commit sha
- `bootstrap.sh`：每个新会话启动时执行的检查脚本
- `loop-state.json`：当前任务 id、任务句柄、任务标题、baseline 脏文件，以及最近一次 worktree / 分支 / commit 状态
- `loop-prompts/`：生成过的单任务提示词，便于审计和复用
- `test-reports/`：每个任务的阶段性测试报告，供审查、回归和后续会话复用

建议先用 `--dry-run`，让 OpenPrd 生成提示词和准确执行命令，但不直接启动 Agent。
`--agent codex` / `--agent claude` 会使用默认 CLI 集成；只有需要接入团队自定义
包装器时，才使用 `--agent-command "<custom command>"`。

OpenPrd 面向用户的时间统一使用上海时区的 `YYYY-MM-DD HH:mm:ss` 格式，不输出
`T`、`Z` 或毫秒后缀。除命令、字段名、文件路径、API 名称、品牌名和产品名等必要
专有术语外，生成文档、进度日志、proposal、prompt、测试报告，以及 Agent 产出的
`spec.md` 与 tasks 默认跟随当前输入和 PRD 快照的主语言：中文语境使用简体中文，
英文语境保持英文，无法判断时回退到简体中文。结构字段继续兼容历史英文
结构字段；明确要求 `zh-CN` 的图示和合同场景仍会强制使用中文。

历史项目不要手写 shell 循环批量改。使用 `fleet` 先扫描报告；它现在会顺带提示全局 registry 里已经登记了多少 OpenPrd 工作区、当前 root 外还有多少已知项目。`--sync-registry` 用来把当前 root 下已初始化的 `.openprd/` 工作区回填到 `~/.openprd/registry/workspaces.jsonl`。`--update-openprd` 会刷新已有 `.openprd/` 的项目，也会把只包含旧根目录 `openprd/changes/`、`openprd/specs/` 或 `openprd/archive/changes/` 的历史项目识别为 OpenPrd 工作区并迁移到 `.openprd/`；项目自身 standards 或 validate 缺口会作为“项目健康需关注”报告，但不阻断生成引导更新。

历史 requirement、PRD、review、change、tasks 和验收结论统一按 `legacy-frozen` 处理：迁移与 `--backfill-work-units` 只补文件身份、digest、版本索引和 work-unit 绑定等可验证元数据，不生成缺失正文，也不猜测当时的实现理由。旧功能重新进入开发时，Agent 以今天的目标和验收条件建立新 requirement/change，旧材料只作为 context。当前源码能够验证的代码说明书、文件夹 README 和 `docs/basic/` 当前态仍可后台维护。

## 怎么看 `status` / `next`

### `openprd status`

重点看：

- `Scenario`
- `User participation mode`
- `Current stage`
- `Upcoming stage`
- `Action ready` / `Workspace attention`
- `项目版本`（如果已启用 release 版本轨道）

### `openprd next`

重点看：

- `Next action`
- `Current stage`
- `Upcoming stage`
- `Suggested command`
- `Suggested questions`

`Current stage` / `Upcoming stage` 只表示当前建议和后续参考。`Workspace attention` 只表示 Agent 可以在后台继续完善的材料；只要 `Action ready=true`，就不得因这些材料缺口阻断用户当下要求的动作。

## 图 Contract

OpenPrd 支持：

- `architecture`
- `product-flow`

也支持从显式 contract 渲染：

```bash
openprd diagram /path/to/project \
  --type product-flow \
  --input ./product-flow-contract.json
```

## Agent Skills

仓库内自带：

- `skills/openprd-shared/`
- `skills/openprd-harness/`
- `skills/openprd-standards/`
- `skills/openprd-diagram-review/`
- `skills/openprd-discovery-loop/`

配合顶层 `AGENTS.md` 使用，可以让 Agent 更稳定地按照 OpenPrd 的协同方式工作。

## 贡献与安全

- 贡献说明：见 [CONTRIBUTING.md](./CONTRIBUTING.md)
- 安全披露：见 [SECURITY.md](./SECURITY.md)

## 许可证

MIT — 见 [LICENSE](./LICENSE)

## 作者

- X: [Mileson07](https://x.com/Mileson07)
- 小红书: [超级峰](https://xhslink.com/m/4LnJ9aB1f97)
- 抖音: [超级峰](https://v.douyin.com/rH645q7trd8/)
