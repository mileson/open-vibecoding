# 角色

## 用户

- 主要用户:
- 用自然语言驱动 Codex、Cursor、Claude Code 完成产品开发的非专业或半专业用户
- 在同一代码项目中并发运行多个 Agent、线程、worktree 的开发者
- 需要持续维护需求、代码健康、知识与版本迁移的项目负责人

- 次要用户:
- OpenPrd 集成与插件维护者
- 审阅业务范围、风险与验收结论的产品和业务协作者

- 相关方:
- OpenPrd 产品与工程维护者
- 被 OpenPrd 管理的本地项目所有者
- Codex、Cursor、Claude Code 适配层维护者

## 类型专项

- humanAgentContract: 用户负责目标、范围和高风险外部动作授权；Agent 可在已授权范围内完成架构实现、测试、迁移、回滚和本地刷新。所有事实变更写入 Ledger，所有运行 ownership 写入 Lane/Task Runtime。
- autonomyBoundary: 本轮用户明确授权无需中途确认，Agent 可自动处理本地源码和本地 OpenPrd 项目；不得扩展到远程 push、npm publish、生产云写入、归档篡改或敏感信息外发。
- toolBoundary: 使用当前工作区代码、OpenPrd CLI、测试工具、Product Design 审计与视觉证据、本机只读 inventory；所有文件编辑通过可审计补丁，真实迁移先 dry-run 和备份。
- stateModel: Project Ledger 记录业务事实；Manifest 记录模型与兼容版本；Lane/Task Runtime 记录临时 ownership；Context Capsule 是只读编译结果；Review、Current、Task Graph、Knowledge Index、Learning 是可重建投影。
- evalPlan: 使用 characterization、unit、integration、concurrency、crash recovery、migration、rollback、performance、adapter parity、visual comparison、full regression、standards/quality/run/doctor 和真实 fleet readback 逐层验收。
