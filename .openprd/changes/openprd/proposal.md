# OpenPrd 项目级版本轨道与变化摘要

## 背景与原因

OpenPrd 现在已经有内部 PRD 版本和用户视角变化摘要，但还没有一个可选的项目级 release/version 轨道来维护当前版本号、版本内更新项，以及与 commit tag 的协同规则。结果是版本号已经在项目里被真实使用，却缺少一个本地真源来累计本版本的需求、Bug、handoff 摘要和最终发布说明。

## 变更内容

- 新增可选的项目级 release/version ledger，用于维护当前版本号、版本状态和版本内更新项。
- 把现有变化摘要条目挂载到具体项目版本下，支持需求、Bug、handoff 摘要和 release notes 候选的累计。
- 扩展 commit 流，在版本轨道已启用且用户显式执行 commit 时读取当前版本，并辅助创建或更新本地版本 tag。
- 扩展 handoff、release notes 与后续外部同步出口，让它们可以从项目版本轨道导出版本内变化内容。
- 补充 README、skills、文档和测试，并验证项目版本轨道与短文案摘要的协同效果。
- OpenPrd 提供可选的项目级 release/version ledger，支持记录 current version、版本状态和版本内变化项。
- 现有共享变化摘要规则支持把新增、修复、优化、调整、移除等条目关联到具体项目版本。
- handoff 与 release notes 导出优先从项目版本轨道读取对应版本的变化条目。
- 当版本轨道已启用且用户通过 OpenPrd 显式执行 commit 时，commit 流可以读取当前版本号并辅助创建或更新本地版本 tag。
- 当用户未更新版本号时，后续变化默认继续累计到当前版本；当用户显式更新版本号后，新的变化进入下一个版本。
- 新增项目级 release/version ledger，支持 current version、版本状态和版本内变化项存储。
- 现有变化摘要层继续复用新增、修复、优化、调整、移除等短文案动作词，并能挂到具体项目版本下。
- commit 流在启用版本轨道且用户明确执行时，可以读取当前版本并辅助创建或更新本地版本 tag；同版本多次提交时 tag 可移动到最新 commit。
- README、skills、handoff/release 导出和测试同步说明版本轨道与 tag 协同规则。

## 能力范围

- `agent-requirements`: OpenPrd 项目级版本轨道与变化摘要 需求。

## 影响范围

- 主要用户: 维护 OpenPrd CLI、skills 和 review 产物的 OpenPrd maintainer
- 主要用户: 使用 OpenPrd 执行任务并需要生成 commit、handoff 或版本说明的 Agent 使用者
- 成本来源: 无新增第三方付费调用成本；变化摘要完全基于本地上下文生成。
- 额度限制: 不引入新的用户额度或发布配额限制；沿用现有 commit / handoff 执行门禁。
- 依赖: 依赖现有 OpenPrd CLI、review-presentation、html-artifacts、loop 和 handoff 导出流程。
- 风险: 如果 formatter 规则过死，可能把一些纯技术任务描述得失真。
- 风险: 如果只改一处而没有共用 contract，后续很快会再次分叉。
