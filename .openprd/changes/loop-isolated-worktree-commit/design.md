# 设计

## 背景

最近一个月里 loop 仍有 finish 通过，但没有稳定产出你期望的逐任务 commit 闭环；当前 openprd 仓库也出现了 done 任务没有 commitSha 的情况。要把 L2 和长程实现真正挂到 loop 上，就需要先把隔离执行、提交流程和状态留痕补齐。

## 目标

- 让 loop 在需要时显式进入隔离 worktree / branch 中执行，而不是默认污染主工作区。
- 让逐任务 commit 只包含当前任务的改动，便于单独审查和回归。
- 让 worktree、branch、commitSha 和 session 形成完整可追踪链路。

## 范围

- 给 openprd loop --run 增加显式 --worktree / --branch，或提供先创建隔离 worktree 再执行的包装入口。
- 在 commit 前增加主工作区脏状态门禁和显式 override 机制。
- 把提交范围从 git add -A 收窄到 task write-scope 或本轮 touched files。
- 把 worktreePath、branch、commitSha 写入 loop-state.json、agent-sessions.jsonl 以及相关状态输出。

## 约束

- 基于现有 openprd loop / git 流程扩展，不重写整套任务调度。
- 兼容当前 feature-list、loop-state、agent-sessions 与 test-reports 结构。
- 需要同时考虑 worktree、命名分支与 detached HEAD 的兼容行为。
- 提交与状态写回不能泄露用户本地无关改动或敏感信息。
- Git worktree 能力。
- 现有 loop task executionStrategy.writeScope 与 finish / verify 流程。
- OpenPrd 的状态文件、review / change / tasks 主流程。

## 业务护栏

- 成本来源: 这次主要要避免无关改动混入 commit、回滚成本升高，以及逐任务审查和回归失去抓手。
- 额度限制: 默认不允许在脏主工作区直接完成高风险 commit；需要显式进入隔离路径或明确豁免。
- 滥用防护: 不能把未在当前任务范围内的文件静默加入 commit。
- 滥用防护: 不能把 detached HEAD 上的匿名提交伪装成可回归的标准 loop 结果。
- 监控信号: 需要持续看 loop 任务完成后是否稳定写回 commitSha。
- 监控信号: 需要看 worktreePath、branch、commitSha 是否在状态和 session 日志里一致。
- 监控信号: 需要看脏主工作区门禁是否挡住了无关改动被带进提交。
- 报警阈值: 只要出现用户要求 commit 但任务完成后没有 commitSha，就算这条闭环没有打通。
- 报警阈值: 只要出现主工作区无关改动被带进 loop commit，就应立即视为高风险回退。
- 止损动作: 无法安全判定提交范围时，停止自动 commit，保留任务验证结果并提示人工处理。
- 止损动作: worktree / branch 状态异常时，不把任务标记为已完成提交。

## 风险与开放问题

- 假设: 第一版默认以一个 change / 一段 loop 对应一个隔离 worktree 为优先模型，而不是每个 task 一个 worktree。
- 假设: 已有 task write-scope 在多数实现任务里足够收窄 commit 范围；不足时需要 touched files 补位。
- 风险: 如果 worktree / branch 生命周期设计不清，会显著抬高 loop 使用复杂度。
- 风险: 如果 touched files 收集不稳定，可能出现漏提或误提。
- 风险: 如果状态写回与 git 操作顺序不当，会出现 done / commitSha 不一致。
- 问题: 第一版是否明确采用一个 change 一个 worktree、一个 task 一个 commit。
- 问题: worktree / branch 命名规范是否要产品化成 CLI 默认值。
- 问题: override 脏仓库门禁时，CLI 需要多强的显式确认语义。
