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

研发期还包含一个轻量标准层：`openprd dev-check <path> <file...>` 或 `node scripts/openprd-dev-check.mjs <path> <file...>`，用于 Agent 在代码修改完成后、最终回复前回顾本轮 touched code files 的行数状态和下一步动作建议。自动优化默认开启（`developmentStandards.autoRefactor.enabled`，`--auto-refactor on|off` 切换）：命中 attention/warning 时 Agent 在本轮直接完成高内聚低耦合拆分（不丢功能、行为不变、拆完重跑测试与 dev-check），最终回复以“OpenPRD 自动优化报告”呈现优化完成的结果（列：影响对象、问题级别、源文件规模、优化原因、本次处理结果、后续建议）并附开关确认一句话；关闭后回到“后续建议”推荐模式（列名回到关注程度、规模信号、预警原因）。dev-check 同时检测本轮是否触达界面文件：最近 24 小时没有拼图证据板时输出视觉证据提醒，附建议命令与对话流嵌入提示。

自我成长标准层位于 `.openprd/growth/`：当 dev-check 高置信识别出新的代码扩展名时，可自动补齐识别规则并记录，减少后续重复提醒；执行中发现豁免路径、项目规矩、OpenPrd 默认行为或用户偏好需要增量时，先记录候选，收工时再运行 `openprd grow <path> --review` 集中确认。

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

- 声称某个 change 就绪前，先运行 `openprd standards <path> --verify`
- 代码修改完成后、最终回复前，针对本轮实际 touched code files 运行 `openprd dev-check <path> <file...>`；700 行以内正常，701-1500 行需留意，超过 1500 行说明后续改动成本较高。自动优化开启（默认）时，命中需要关注的文件先在本轮直接完成拆分，再以 **OpenPRD 自动优化报告** 为标题复用 dev-check 表格（列：影响对象、问题级别、源文件规模、优化原因、本次处理结果、后续建议）并附开关确认；用户要求关闭后运行 `openprd dev-check <path> --auto-refactor off`，之后以 **后续建议** 为标题输出推荐表格（列名回到关注程度、规模信号、预警原因）。两种模式都按 🔴 → 🟠 → 🟡 排序
- dev-check 或执行过程产生自我成长项时，区分处理：高置信工具识别补全可以自动固化；用户偏好、项目协作规矩和 OpenPrd 默认行为只作为待确认候选，收工时集中 review
- 新增配置类能力时同步评审 grow-aware 入口：候选类型、scope、review/apply 行为、拒绝后不重复提示，以及 user-local 与项目共享配置的边界
- OpenPrd 自动生成的 change tasks 应包含 standards 维护任务
- 每次新增或修改源码文件，都要做文档影响检查
- 如果 `docs/basic/`、文件说明书或文件夹 README 缺失，或还停留在模板态，就绪前必须补齐
- 如果涉及后端、脚本、Agent、工具链、服务或数据处理变更，必须把 CLI 与 API 视为同级接入面，更新 `docs/basic/backend-structure.md` 中的命令入口、参数、输出契约、`help`/`doctor`/`dry-run`/`status`、接口协议和不适用说明
- 如果文档已经存在，也要检查这次变更是否让它过期；职责、流程、结构、依赖或产品行为变化时必须更新
- `README.md`、`README_EN.md`、`README_CN.md` 这类仓库入口文档也属于用户可见产物。更新功能定位、流程图、入口说明或示意图时，要优先用普通用户能理解的业务语言描述，并同步维护双语入口与成对图资产
- 功能变更影响文件、文件夹、流程、架构、依赖或产品逻辑时，更新对应的 `docs/basic/` 文档
- 功能变更影响代码文件职责时，更新对应文件说明书
- 功能变更影响文件夹职责或文件布局时，更新对应文件夹 README
- 如果最终不需要改文档，也要说明已经做过影响检查，以及为什么现有文档依然准确
- 更新 `docs/basic/` 时禁止 append-only 堆叠：同一事实只保留一处最新版本，过时段落直接删除或改写，不要写“更新：/补充：”式追加；单行不要超过 300 字符，长内容拆成分点或小节
- `openprd standards <path> --verify` 会做文档质量体检：出现巨行（>300 字符）、平均行长退化（>200 字符）或 `prd.md` 落后超过 20 个 requirement 版本的警告时，先运行 `openprd docs-compact <path>` 查看按行号给出的压缩建议，压缩回填后再收口

## 文档影响检查

实现阶段按这份清单执行：

- 新增源码文件：若缺少文件说明书就补上，并确认所在文件夹 README 已存在
- 修改源码文件：若已有文件说明书，先读再决定是否更新；当职责、输入、输出、依赖或维护规则变化时必须更新
- 文件夹内容新增、移动、删除或改作他用：新增或更新文件夹 README，使其反映当前文件夹职责和文件布局
- 功能、流程、架构、依赖或产品行为变化：即使文件已存在，也更新相关 `docs/basic/` 文档
- 后端、脚本、Agent、工具链、服务或数据处理变化：即使没有新增 API，也要显式评估 CLI 与 API 两个接入面，并在 `docs/basic/backend-structure.md` 写清楚事实或不适用原因
- standards 契约缺失：仅在工作区初始化或用户明确要求修复 standards 时运行 `openprd standards <path> --init`，随后用项目事实替换模板内容

## 不要这样做

- 不要把 `docs/basic/` 以外的路径当成项目基线文档目录
- 不要在 `docs/basic/` 缺失时悄悄放过 standards 校验
- 不要仅因为实现测试通过，就把文档工作标记为完成
