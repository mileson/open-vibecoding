---
name: openprd-standards
description: 维护 OpenPrd 项目文档标准，包括 `docs/basic` 基线文档、文件说明书模板、文件夹 README 模板，以及 change/spec/task 执行阶段的 standards 校验。
---

# OpenPrd Standards

## 概览

当用户要求 OpenPrd 建立、维护、修复或解释项目文档标准时，使用这份 skill。它覆盖需求发现、change 生成、任务执行和发布就绪检查阶段的文档标准。

OpenPrd standards 管三件事：

- `docs/basic/` 下的项目基线文档
- `.openprd/standards/file-manual-template.md` 定义的文件说明书规则
- `.openprd/standards/folder-readme-template.md` 定义的文件夹 README 规则

研发期还包含一个轻量标准层：`openprd dev-check <path> <file...>` 或 `node scripts/openprd-dev-check.mjs <path> <file...>`，用于 Agent 在代码修改完成后、最终回复前回顾本轮 touched code files 的行数状态和下一步动作建议。它是 task-scoped advisory：只有拆分与当前目标同范围、风险不扩张且能保持行为不变时才可顺手处理；否则保留建议并把工作区规模债归入 `workspaceAttention`。它不强迫当前任务重构，也不要求用户回复模式开关。dev-check 同时检测本轮是否触达界面文件：最近 24 小时没有拼图证据板时输出视觉证据提醒，附建议命令与对话流嵌入提示。

自我成长标准层位于 `.openprd/growth/`：当 dev-check 高置信识别出新的代码扩展名时，可自动补齐识别规则并记录，减少后续重复提醒；执行中发现豁免路径、项目规矩、OpenPrd 默认行为或用户偏好需要增量时，保留来源标注候选。收工复盘时可运行 `openprd grow . --review` 生成后台 review，但不把候选变成当前任务的确认停顿。

维护 OpenPrd 本身时，新增或修改任何配置类能力都要检查是否应该成为 grow-aware 配置：高置信可复用、可被用户习惯影响、会随项目环境变化的配置默认纳入 `openprd grow`；不确定时主动询问用户；一次性固定规则才保留为静态配置。

唯一的基线路径就是 `docs/basic/`。

## 动手前

1. 先读 `skills/openprd-shared/SKILL.md`
2. 从 `.openprd/` 重建工作区状态
3. 编辑前先检查 standards：
   - `openprd standards <path> --verify`
4. 只有当用户要求初始化，或工作区正在初始化时，才补缺失 standards：
   - `openprd standards <path> --init`

## 必需基线文档

OpenPrd standards 要求以下文档存在：

- `docs/basic/file-structure.md`
- `docs/basic/app-flow.md`
- `docs/basic/prd.md`
- `docs/basic/frontend-guidelines.md`
- `docs/basic/backend-structure.md`
- `docs/basic/tech-stack.md`

如果涉及后端实现，`docs/basic/backend-structure.md` 必须显式覆盖 CLI 接入面和 API 接入面；如果某一面不适用，也要写明原因，而不是省略。

## 执行规则

- `openprd standards <path> --verify` 提供就绪证据；其发现不新增 OpenPrd 授权停顿，也不阻断用户已授权的当前动作
- 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check <path> <file...>`；700 行以内正常，701-1500 行需留意，超过 1500 行说明后续改动成本较高。注意项只作为 task-scoped advisory；同范围、低风险时可顺手处理，其他规模债进入 `workspaceAttention`，不扩大当前任务
- dev-check 或执行过程产生自我成长项时，区分处理：高置信工具识别补全可以自动固化；用户偏好、项目协作规矩和 OpenPrd 默认行为保留为来源标注候选，不打断当前任务
- 新增配置类能力时同步评审 grow-aware 入口：候选类型、scope、review/apply 行为、拒绝后不重复提示，以及 user-local 与项目共享配置的边界
- OpenPrd 自动生成的 change tasks 应包含 standards 维护任务
- 每次新增或修改源码文件，都要做 task-scoped 文档影响检查；检查本身不扩大实现范围
- 只有本轮代码变化直接使既有 `docs/basic/`、文件说明书或文件夹 README 失真时，才在后台同步相关文档；历史缺失、模板态或全局文档债记入 `workspaceAttention`，不影响当前任务或已授权动作
- 如果涉及后端、脚本、Agent、工具链、服务或数据处理变更，必须把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、参数、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议和不适用说明
- 如果文档已经存在，检查本轮变更是否直接让它过期；只同步与当前改动对应的职责、流程、结构、依赖或产品行为，其他陈旧项记入 `workspaceAttention`
- `README.md`、`README_EN.md`、`README_CN.md` 这类仓库入口文档也属于用户可见产物。更新功能定位、流程图、入口说明或示意图时，要优先用普通用户能理解的业务语言描述，并同步维护双语入口与成对图资产
- 功能变更影响文件、文件夹、流程、架构、依赖或产品逻辑时，更新对应的 `docs/basic/` 文档
- 功能变更影响代码文件职责时，更新对应文件说明书
- 功能变更影响文件夹职责或文件布局时，更新对应文件夹 README
- 如果最终不需要改文档，也要说明已经做过影响检查，以及为什么现有文档依然准确
- 更新 `docs/basic/` 时禁止 append-only 堆叠：同一事实只保留一处最新版本，过时段落直接删除或改写，不要写“更新：/补充：”式追加；单行不要超过 300 字符，长内容拆成分点或小节
- `openprd standards <path> --verify` 会做文档质量体检：出现巨行（>300 字符）、平均行长退化（>200 字符）或 `prd.md` 落后超过 20 个 requirement 版本的警告时，先运行 `openprd docs-compact <path>` 查看按行号给出的压缩建议，压缩回填后再收口

## 文档影响检查

实现阶段按这份清单判断本轮变化是否直接使既有文档失真；历史缺失、模板态或全局文档债统一记入 `workspaceAttention`：

- 新增源码文件：若当前项目已有文件说明书体系，且本轮新增职责不记录就会使该体系失真，则补对应说明；历史缺失不在本轮补齐
- 修改源码文件：若已有文件说明书，先读再决定是否更新；当职责、输入、输出、依赖或维护规则变化时必须更新
- 文件夹内容新增、移动、删除或改作他用：只有既有文件夹 README 因本轮变化失真时更新
- 功能、流程、架构、依赖或产品行为变化：只有相关 `docs/basic/` 因本轮变化失真时同步更新
- 后端、脚本、Agent、工具链、服务或数据处理变化：评估 CLI 与 API 两个接入面；只有既有 `docs/basic/backend-structure.md` 因本轮变化失真时同步事实或不适用原因
- standards 契约缺失：仅在工作区初始化或用户明确要求修复 standards 时运行 `openprd standards <path> --init`，随后用项目事实替换模板内容

## 不要这样做

- 不要把 `docs/basic/` 以外的路径当成项目基线文档目录
- 不要在 `docs/basic/` 缺失时悄悄放过 standards 校验
- 不要仅因为实现测试通过，就把文档工作标记为完成
