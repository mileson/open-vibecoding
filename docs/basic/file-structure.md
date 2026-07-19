# 项目文件结构

## 项目定位

OpenPrd 是一个 Node.js CLI 项目，入口命令通过 `bin/openprd.js` 调用 `src/openprd.js` 的 `main` 函数。`src/openprd.js` 保留 CLI 分发、初始化、freeze、handoff 和公开导出，工作区核心能力与横向流程拆入独立模块，避免入口文件继续承担所有实现细节。

## 核心目录

- `bin/`: CLI 可执行入口。
- `src/`: OpenPrd CLI 源码。
- `src/cli/`: 命令行参数解析和终端输出渲染；`print.js` 作为稳定 barrel，对外汇总 `basic/ workflow/ doctor/ run/ quality/ growth/ change/ benchmark/ canvas` 各分域输出模块。
- `src/cli/benchmark-print.js`: Benchmark 子命令的人类可读输出，避免继续扩大通用 `print.js`。
- `src/kernel/`: Project Manifest、事件信封、原子存储、Project Ledger、哈希链校验和投影重建。
- `src/runtime/`: TaskRuntime 的 claim、lease、heartbeat、write-set 冲突、lane binding 与 CLI workspace 适配。
- `src/context/`: ContextRequest / ContextCapsule v1 编译、预算、增量、脱敏、缓存和 telemetry。
- `src/gates/`: 多级作用域动作条件、evidence 精确绑定、有效期和撤销状态存储；不承担 OpenPrd artifact 的用户授权。
- `src/adapters/`: Codex、Claude Code、Cursor 的统一 SPI、能力信封、上下文渲染和安装安全策略。
- `src/knowledge-v3/`: 带 scope、TTL、证据和 token 预算的项目经验生命周期。
- `src/upgrade/`: 单项目与 fleet 的预演、preimage backup、CAS、原子应用、回滚和事务日志。
- `src/review-model.js`: 同一 ReviewModel 的业务视角、工程视角、共享 digest 和证据投影。
- `src/codex-hook-runner-template.mjs`: 生成到项目 `.codex/hooks/openprd-hook.mjs` 的自包含 Codex hook runner 模板，承接运行态 advisory 和真实安全边界逻辑源码。
  - 把“生成图片/封面图/配图/海报/插画/图标/贴纸/头像/banner/主视觉/KV/运营图/效果图/视觉稿/mockup”识别为 Image 2 优先的图片内容请求。
  - 对大界面改动额外注入 Computer Use 截产品内图、Image 2 生成 3 方向效果图、横向拼图评审的实现前流程提醒。
  - 把“用户刚刚确认了 L1 mini-plan / 范围边界”与“还要再次向用户要确认”分开，要求后续承接写成“已确认，我按这个继续”而不是模糊的二次确认。
- `src/dev-standards.js`: 研发期 touched code files 标准层，当前提供代码文件行数状态和下一步动作建议。
- `src/docs-compact.js`: `openprd docs-compact` 的 `docs/basic/` 压缩分析层，逐文档列出巨行、字符数和拆分建议，只读不写。
- `src/guide.js`: `openprd guide` 的 PM 流程指引层，按工作区状态推断 7 步流程（澄清 → 摘要 → 评审 → 方向 → 任务 → 实现 → 收口）中的当前位置和下一步动作，只读不写。
- `src/growth.js`: 自我成长标准层，记录、审查、应用或拒绝执行中发现的配置、规则和 user-local 偏好候选。
- `src/benchmark.js`: Benchmark 子系统薄入口，对外汇总 add / observe / list / approve / verify 和 registry 渲染能力。
- `src/benchmark/`: Benchmark 分域模块，拆分 constants、source、storage、operations、verify、render 和 registry 职责。
- `src/canvas-workspace.js`: `openprd canvas` 的本地服务、daemon 生命周期、thread/session ID 与展示标题绑定、scene/assets/exports/ops/server/relays 文件存储，以及 Agent 图片/卡片操作队列、图片回填、选区交接导出元数据、下载到系统下载目录、Codex handoff 记录、默认 app-server thread relay 和 Codex Agent 兜底接力 outbox。
- `src/codex-app-server-relay.js`: 画布后台 relay worker，读取会话内 handoff payload，通过本机 Codex app-server `thread/resume -> turn/start` 把文本和本地图片路径提交到绑定的 Codex 线程，并持续写入 status/log 便于排查；它是画布点击“发送给 Codex”的默认自动投递通道。
- `src/canvas-app.html.js`: 对话协同画布的最小 Excalidraw embed 页面，负责浏览器端 scene 保存、图片替换、空白卡片、AI 生图模板占位卡、选区导出、选中图片下载、中文/英文界面切换和“发送给 Codex”交接面板；该面板会写入 handoff 记录，并在 Codex thread binding 可用时优先触发 app-server 自动 relay。
- `src/canvas-i18n.js`: 画布浏览器壳的语言包、默认语言和 locale 归一化规则；默认面向中文用户，系统或浏览器首选语言为英文时自动切换英文，并把用户选择交给浏览器缓存持久化。
- `src/execution-strategy.js`: Worker lane 执行策略核心规则，负责 `serial / parallel-workers / parallel-workers-isolated` 推导、worker 合同元数据格式化与校验。
- `src/openspec/`: OpenPrd change、spec、task 的结构化文件操作；新工作产物写入 `.openprd/changes/`、`.openprd/specs/` 和 `.openprd/archive/changes/`，旧根目录 `openprd/` 工作产物只由 update / setup / fleet 的自动迁移逻辑读取。
- `src/diagram-workspace.js`: diagram 命令的 artifact 生成、评审状态和浏览器打开逻辑。
- `src/discovery.js`: discovery 运行、覆盖矩阵、claims 和验证逻辑。
- `src/fleet.js`: 历史项目扫描、批量 setup/update/doctor、仅元数据的 work-unit backfill，以及事务化升级编排。
- `src/fs-utils.js`: 共享文件、JSON、YAML、JSONL 读写工具。
- `src/html-artifacts.js`: HTML 协作 artifact 和复盘学习 reader 的渲染骨架；学习 reader 在这里承接章节级图文比喻卡、可选图片槽位和证据锚点，质量报告 HTML 通过独立渲染器接入，避免继续扩大通用 artifact 文件。
- `src/session-registry.js`: 全局 session registry 读写层，负责 `~/.openprd/registry/sessions.jsonl` 的规范化、去重读取和 session -> workspace 归属回写。
- `src/registry-hygiene.js`: workspace registry 卫生检查，负责识别过宽 root 和父子嵌套 workspace。
- `src/quality-html-artifact.js`: `openprd quality --verify` 的 HTML 回归测试报告框架层，负责回归结论概览、工具生成的回归流程图和测试覆盖图、四个固定信息模块、底部双按钮操作栏和折叠明细。
- `src/test-strategy.js`: 测试策略分流核心规则，负责测试层级、测试规模、验证范围、证据计划、默认推导、任务策略汇总和测试能力识别。
- `src/visual-prepare.js`: `openprd visual-prepare` 的参考图预处理工具，负责把选定或 Agent 默认采用的整板、网格图或多对象效果图整理成 reference-set，生成 crops、contact sheet、compare-plan 和 board 模板。
- `src/visual-compare.js`: `openprd visual-compare` 的图片合成工具，负责读取效果图和实现截图、修改前后截图，或基于 board JSON 生成局部焦点证据板、并行实验证据板、截图实测证据板、对齐辅助线证据板和内部居中证据板；会缩放面板、按当前用户主语言添加标签，并输出 JPG / PNG / WebP 视觉评审图。
- `src/visual-compare-focus.js`: `local-first` 局部证据板渲染层，负责左右独立裁剪、共享像素尺度、无拉伸展示、difference blend 和底部全屏回归缩略图。
- `src/learning-review.js`: 复盘学习包的证据收集、Agent 写作工具包、内容合同校验、图文解释字段校验和 reader 归档。
- `src/quality.js`: 质量契约、质量场景与证据检测、日志/追踪检测、业务成本与滥用护栏检测、评估执行环境检测、HTML 回归测试报告和项目经验 Skill 沉淀。
- `src/run-harness.js`: `openprd run` 的 ContextCapsule 编译、hook cache/telemetry、scoped condition 裁剪、`taskReady/workspaceAttention/claimReady/actionReady` 分层 verify 与执行策略。
- `src/github-release.js`: GitHub Release 渲染层，负责把 `package.json` 与 `release-ledger` 汇总成可直接发布的版本标题和 Markdown 正文。
- `src/loop.js`: 长任务拆分、单任务 prompt、session 记录、任务 verify / finish，以及可跨对话引用的 `taskHandle` 与 worker 合同生成。
- `src/source-inventory.js`: discovery 使用的源码盘点和忽略规则。
- `src/work-unit.js`: 工具无关的需求工作单元 ID、目标根目录、版本评审 artifact 和记录状态绑定。
- `src/work-unit-migration.js`: 历史 artifact 的 work unit 身份与 digest 元数据回填；不生成缺失的历史 PRD/review/tasks 正文。
- `src/workspace-core.js`: workspace 骨架、迁移、校验、版本索引、事件日志和共享文档渲染，并负责随包 `.openprd/README.md` 与模板层 `README.md` 的简体中文默认文档、`README_EN.md` 英文切换入口以及兼容 README 跳转页；同时维护 workspace-scope `state/current.json` 与 session-scope `.openprd/harness/session-states/` 的双层状态装载。
- `src/workspace-workflow.js`: classify、interview、clarify、capture、synthesize、review、diff、history、next、status guidance。
- `docs/basic/`: 项目级基础说明。
- `scripts/openprd-dev-check.mjs`: Agent 可直接执行的研发期行数检查脚本，等价调用 `openprd dev-check`。
- `scripts/openprd-codex-isolated-worker.mjs`: 独立 Codex worker 复验脚本。它会临时创建干净 `CODEX_HOME`、只复制认证文件、可选继承 source home 的 model，并统一输出 `codex exec --json` 原始事件和最后一条 agent 消息，避免用户全局 skill / plugin / config 噪音干扰 blind worker 验证。
- `scripts/openprd-github-release-notes.mjs`: GitHub Release 文案脚本入口，支持本地预览、写出 Markdown 文件，以及被 GitHub Actions 直接调用。
- `.github/workflows/github-release.yml`: GitHub Release 自动发布工作流，在版本 tag push 或手动触发时创建或更新匹配版本的 GitHub Release。
- `.openprd/engagements/active/intake-reflection.md`: 复杂或模糊需求在进入澄清问题前的需求入口自省记录。
- `.openprd/engagements/work-units/`: 工具无关的需求工作单元绑定，每个文件记录 work unit id、目标根目录、版本、摘要指纹和稳定评审 artifact，避免多 Agent 或多对话共用 `active` 时串到其他需求。
- `.openprd/changes/`: 当前正在推进的 change、proposal、spec 和 tasks 文件；这是唯一的 active change 根目录。
- `.openprd/specs/`: 已接受 spec 的归档目录。
- `.openprd/archive/changes/`: 已归档 change 的目录。
- `.openprd/artifacts/active/`: 版本化评审 artifact bundle；`review-presentation --write` 收口时只保留最新 12 个版本，更早的自动移入 `.openprd/artifacts/archive/`。
- `.openprd/quality/`: 质量基线配置和回归测试报告归档。
- `.openprd/benchmarks/`: 项目级 benchmark registry；`sources.yaml` 存 approved 来源，`inbox/` 存 candidate 来源，`evidence/` 存来源说明和采纳证据摘要。
- `.openprd/design/`: 前端设计框架层；`lenses/` 放设计视角，`themes/` 放主题 token，`layouts/` 放页面骨架，`components/` 放高频组件说明，`recipes/` 放任务配方，`checklists/` 放界面质量门，`assets/` 放内置表面素材/背景策略，`templates/` 放空白工作区可直接套用的页面起步模板，`active/` 放本轮界面任务的事实、素材、图片前置和方向合同。
- `.openprd/growth/`: 执行中发现的配置缺口、规则候选和本地偏好队列；代码扩展识别这类白名单工具补全会自动固化并记录，其余需要用户决定的偏好、项目规矩和默认行为留到收工复盘确认。
- `.openprd/knowledge/`: incident、abstract pattern 和项目级经验 Skill 归档。
- `.openprd/manifest.json`: 项目协议版本与 context/task/gate/review/knowledge/adapter 格式协商入口。
- `.openprd/ledger/`: 以哈希链保护的不可变项目事件账本和 projection checkpoint。
- `.openprd/runtime/`: TaskRuntime claim、lease、lane 和 write-set 状态。
- `.openprd/gates/`: scoped gate 定义、evidence、approval 与决策投影。
- `.openprd/harness/feature-list.json`: loop 任务清单；每个任务包含 `taskHandle`、标题、依赖、verify 命令、测试策略、执行策略、可选 `oracle` 对照基准和状态。
- `.openprd/harness/session-bindings/`: repo-local session 镜像；每个会话保存当前 lane 的 change/task/work-unit、review 和 gate 摘要，供本工作区恢复使用。
- `.openprd/harness/session-states/`: session-scoped `currentState` 草稿，保证不同对话/需求线不会共用同一份工作流状态。
- `.openprd/harness/canvas-sessions/`: 对话协同画布归档；每个 thread/session 一个目录。
  - 保存 `session.json`、`scene.json`、`ops.json`、`server.json`、`server.log`、`assets/`、`exports/` 和 `relays/`。
  - `session.json` 的 binding 记录 thread/session ID、可选标题和来源，用于回顾聊天、画布标注、后台服务状态、Agent 生成图、选区导出图片、handoff 记录、app-server 自动 relay 状态、Codex Agent 兜底接力状态和交接提示之间的关系。
- `.openprd/harness/failed-approaches.md`: loop 死路账本，记录 reference/oracle 偏差、失败尝试及其原因，避免跨会话重复踩坑。
- `.openprd/harness/agent-sessions.jsonl`: loop prompt / run / finish 的结构化事件日志，包含 `taskHandle` 与任务标题，便于跨会话续接。
- `.openprd/harness/loop-state.json`: 当前 loop 任务 id、任务句柄、任务标题和最近一次 Agent 会话状态。
- `.openprd/harness/visual-reviews/`: 界面视觉评审归档，存放大界面改动实现前的 3 方向横向效果图、选定或默认方向的 reference-set，以及实现阶段 `openprd visual-compare` 输出的各类证据板。
- `~/.openprd/registry/sessions.jsonl`: 全局 session 归属表，把 sessionId 映射到 workspaceRoot、lane 元数据和 repo-local 绑定路径，供跨项目恢复与隔离执行决策使用。
- `skills/`: OpenPrd 自带 agent skills。
- `skills/openprd-frontend-design/`: 界面、页面、视觉和前端体验任务的前端设计框架 skill，负责 facts/asset/image/direction 这四类前置门与 `.openprd/design/` 资产层读取。
- `test/`: Node test runner 测试用例，按 benchmark/quality/agent-integration/run-workflow/discovery/workspace-flow 等领域拆分。
  - dev-check 与 Stop hook 相关用例在 `openprd-dev-check.test.js`，visual-prepare/visual-compare 证据板用例在 `openprd-visual-evidence.test.js`。
  - 共享 helper 放在 `test/node_modules/openprd-test-helpers/`，避免被 `node --test` 误识别为测试文件。

## 文件组织规则

- 新增或修改文件时，应同步判断 `docs/basic/`、文件说明书、所在文件夹说明书是否缺失或过期；缺失的要补齐，受本次变更影响的已有说明要更新。
- 跨模块移动文件时，应更新本文件中的目录结构和职责说明。
- CLI 表层逻辑优先放入 `src/cli/`；`print.js` 只做稳定导出壳，具体输出逻辑优先落到对应 `*-print.js` 分域模块，不要回填到 `src/openprd.js`。
- 研发期标准规则优先放入 `src/dev-standards.js`，CLI 与脚本入口只负责调用和输出。
- Benchmark 来源候选、approve、verify 和 observe 规则优先放入 `src/benchmark/` 分域模块，由 `src/benchmark.js` 统一导出；收工复盘只读取推荐，不直接自动批准来源。
- 自我成长候选的记录、review/apply/reject 和安全配置写入放入 `src/growth.js`；`dev-check` 负责发现代码文件候选，并在代码扩展识别场景直接触发自动固化。
- 共享 IO 工具优先放入 `src/fs-utils.js`，业务模块只保留自己的领域判断。
- discovery、fleet、run harness 这类可独立验证的流程应保持在各自模块内，通过依赖注入接入工作区核心能力。
- quality 相关扫描、业务护栏、报告写入和经验沉淀逻辑归入 `src/quality.js`；质量报告的用户可见 HTML 框架归入 `src/quality-html-artifact.js`，`src/html-artifacts.js` 只保留转发出口。
- 工作区核心状态工具归入 `src/workspace-core.js`；面向用户的工作流命令归入 `src/workspace-workflow.js`。

## 维护规则

- 每次新增、删除、移动目录或核心文件后，必须检查并更新本文件。
- 本文档只记录项目结构事实，不承载具体功能需求细节。
