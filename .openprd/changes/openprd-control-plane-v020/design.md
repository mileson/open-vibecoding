# 设计

## 背景

0.1.19 已暴露多真相源、并发和跨版本迁移风险，需要在 0.1.20 建立兼容控制平面

## 目标

- 用唯一 Project Ledger 管理项目业务事实，并把 current、task graph、review、knowledge index 等降为可重建投影
- 用 Lane/Task Runtime 支持同项目多线程、多 Agent、多 worktree 安全 claim、lease、heartbeat、write-set 与 CAS
- 用 Context Compiler 向 Agent 提供最精准、最小 token、可缓存、可增量、可解释且默认只读的上下文
- 用 scoped Evidence 和 Gate 让局部任务不被无关项目债务阻断，同时保持发布级门禁
- 从同一 ReviewModel 生成小白可懂的业务视图和工程可执行视图，并保持同一 digest 与决策链
- 统一 Codex、Cursor、Claude Code 的 Adapter SPI、能力协商、事件归一和跨版本协议
- 把 Knowledge Evolution 变为有作用域、证据、有效期、替代链和可回滚的持续维护系统
- 安全将产品版本升级到 0.1.20，并刷新所有真实本地 OpenPrd 安装与旧项目

## 范围

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

## 约束

- 保持现有 CLI、JSONL/JSON workspace 与 Codex/Claude/Cursor 生成路径的向后兼容
- 当前 git worktree 含既有 i18n 和 unfinished session 修改，必须保留用户改动并分层整合，禁止 reset/stash
- Repo-local canonical source 与生成文件必须区分，写入前检查任一路径祖先是否为 symlink
- 测试必须使用隔离 OPENPRD_HOME，禁止污染真实全局 registry
- Review Studio 改动必须复用现有视觉系统并提供前后、焦点、验证与对齐证据
- 上下文与日志不得包含 API key、token、账号、个人隐私或未脱敏 prompt 原文
- 迁移备份只包含当前任务需要的最小文件并保留本机权限，不向外发送
- 不修改用户归档、远程仓库或生产环境
- 现有 OpenPrd CLI、skills、hooks、workspace schema、review renderer、quality/standards/test infrastructure
- 本机 Node.js、npm 全局软链接与真实 OpenPrd 项目 inventory
- Codex、Cursor、Claude Code 当前可观测的 runtime capability 与生成协议

## 业务护栏

- 成本来源: 全量线程与项目扫描、并发压力测试、Review 视觉验证、旧项目备份和批量迁移
- 成本来源: 重复上下文注入和过宽文档读取造成的 token 与执行时间
- 额度限制: 默认 context Capsule 800 tokens，Delta 250 tokens；超预算需可解释裁剪
- 额度限制: 真实 fleet 按 Home、Projects、Context、活跃 worktree 分批执行，归档不纳入
- 额度限制: 单项目迁移失败不继续覆盖该项目，也不阻断已经验证成功的其他项目
- 滥用防护: 高风险操作绑定明确 lane/operation approval ID，短句确认不能放行其他 lane
- 滥用防护: Symlink 路径、too-new schema、dirty archive 分类不明时拒绝破坏性写入
- 滥用防护: Context 编译进行 secret redaction，Knowledge promotion 需要证据和 reviewer
- 监控信号: context token、cold/warm p50/p95、cache hit、included/excluded reason
- 监控信号: claim 冲突、lease recovery、CAS conflict、lost update、write-set overlap
- 监控信号: projection digest、migration digest、rollback result、adapter drift、registry stale count
- 监控信号: 业务 Review 完成率、需求修订次数、用户可理解性检查与技术词泄漏
- 报警阈值: 任何 lost update、错误项目写入、归档 checksum 变化、secret 泄漏或无法回滚均为阻断
- 报警阈值: Context 超预算、p95 超 SLO、adapter fixture 不一致或 migration 对账不一致阻断真实 fleet
- 报警阈值: 质量报告 productionReady=false 时不得声称整体完成
- 止损动作: 切回 legacy read/storageMode，停止后续批次并按项目 restore preimage
- 止损动作: 保留失败报告、revision、digest 和 capability gap，不用写死逻辑绕过门禁
- 止损动作: 对分类不明的归档、副本或 symlink 目标保持只读

## 风险与开放问题

- 假设: 0.1.20 可在不移除 legacy 文件的前提下交付兼容控制平面纵向能力
- 假设: 现有 43 个活跃真实项目与历史 0.1.15/0.1.19 fixture 足以覆盖主要迁移形态
- 假设: Codex、Cursor、Claude Code 平台差异可通过 capability negotiation 明确表达
- 风险: 改造横跨状态、hook、CLI、review、knowledge 与迁移，若没有兼容分层会形成大爆炸式回归
- 风险: 当前 dirty worktree 与语义污染状态可能把既有用户改动误当成稳定基线
- 风险: Home 级 Skill symlink 与通用 skills-sync 可能再次制造跨适配器漂移
- 风险: 全局 registry 已被测试临时目录污染，直接 compact 或 fleet 可能误删仍需的定位索引
- 风险: Review 双投影若没有 canonical digest 会再次产生两套真相
- 问题: Ledger 默认读路径在 0.1.20 是否切换到 dual-read，或先保持 legacy-read + shadow ledger；本轮以安全对账结果决定
- 问题: Home 全局 Skill 最终采用 adapter-neutral shared 内容还是让外部 skills-sync 排除 OpenPrd；本轮优先实现兼容 shared 内容与 symlink fence
- 问题: 历史 Documents 归档保持不可变，只验证 scanner 排除，不纳入版本刷新
