# OpenPrd 可解释项目控制平面与跨工具上下文升级

## 背景与原因

统一项目事实、并发运行态和上下文编译，降低 token、延迟、错误目标与长期维护成本

## 变更内容

- Project Manifest、Event Envelope、Atomic Store、Project Ledger 与可重建投影
- Session/Lane/Task Runtime：claim、lease、heartbeat、write-set、CAS、worktree/branch trace
- Context Capsule、Delta、Cache、token budget、authority/freshness、引用解析与 secret redaction
- project/change/work-unit/task/lane/operation 分级 Gate 与 Evidence
- Review canonical model、业务/工程双投影、决策与 Canvas 标注绑定
- Knowledge v3 生命周期、检索预算、telemetry 分离、Learning/Growth 边界
- Codex/Cursor/Claude Code Adapter SPI、能力协商、runtime detection 与生成文件漂移修复
- 协议/reader/writer/adapter/projection 版本、N/N-1 兼容、幂等迁移、备份与回滚
- fleet nested legacy 扫描、symlink 安全、registry 隔离/压缩和真实本地项目批量刷新
- 面向普通用户的中文产品文案、i18n 提醒和 Review Studio 视觉交互验证
- 提供 project manifest、ledger append/read/head/verify/rebuild、projection replay API
- 提供 task claim/heartbeat/release、lease recovery、write-set conflict、lane binding API 与 CLI
- 提供 context compile/diff/cache/render/reference API，保持 run --context 兼容入口
- 提供 scoped gate/evidence evaluation 与明确 approval ID 绑定
- 提供 ReviewModel 业务/工程投影与稳定确认合同
- 提供 adapter detect/capabilities/install/normalize/render/handoff SPI
- 提供 Knowledge v3 validate/promote/deprecate/supersede/query 生命周期
- 提供 upgrade plan/dry-run/backup/atomic apply/restore 与 fleet 安全批处理
- 提供 registry prune/compact 与测试环境 OPENPRD_HOME 隔离
- 全量单元、集成、并发、迁移、回滚、性能和三平台契约测试通过
- 最新 Markdown/HTML 测试报告、质量报告、架构与视觉证据可追溯
- standards、quality、run verify 与 doctor 在发布/刷新前全部健康
- 所有真实项目刷新报告包含版本、checksum、备份、迁移结果和失败回滚状态

## 能力范围

- `agent-requirements`: OpenPrd 可解释项目控制平面与跨工具上下文升级 需求。

## 影响范围

- 主要用户: 用自然语言驱动 Codex、Cursor、Claude Code 完成产品开发的非专业或半专业用户
- 主要用户: 在同一代码项目中并发运行多个 Agent、线程、worktree 的开发者
- 主要用户: 需要持续维护需求、代码健康、知识与版本迁移的项目负责人
- 成本来源: 全量线程与项目扫描、并发压力测试、Review 视觉验证、旧项目备份和批量迁移
- 成本来源: 重复上下文注入和过宽文档读取造成的 token 与执行时间
- 额度限制: 默认 context Capsule 800 tokens，Delta 250 tokens；超预算需可解释裁剪
- 额度限制: 真实 fleet 按 Home、Projects、Context、活跃 worktree 分批执行，归档不纳入
- 额度限制: 单项目迁移失败不继续覆盖该项目，也不阻断已经验证成功的其他项目
- 依赖: 现有 OpenPrd CLI、skills、hooks、workspace schema、review renderer、quality/standards/test infrastructure
- 依赖: 本机 Node.js、npm 全局软链接与真实 OpenPrd 项目 inventory
- 依赖: Codex、Cursor、Claude Code 当前可观测的 runtime capability 与生成协议
- 风险: 改造横跨状态、hook、CLI、review、knowledge 与迁移，若没有兼容分层会形成大爆炸式回归
- 风险: 当前 dirty worktree 与语义污染状态可能把既有用户改动误当成稳定基线
- 风险: Home 级 Skill symlink 与通用 skills-sync 可能再次制造跨适配器漂移
- 风险: 全局 registry 已被测试临时目录污染，直接 compact 或 fleet 可能误删仍需的定位索引
- 风险: Review 双投影若没有 canonical digest 会再次产生两套真相
