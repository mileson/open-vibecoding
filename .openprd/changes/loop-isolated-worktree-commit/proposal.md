# OpenPrd loop 隔离 worktree 提交闭环

## 背景与原因

OpenPrd 的 loop 虽然支持逐任务 finish 和可选 commit，但最近没有稳定形成“隔离 worktree + 单任务 commit + 可审查回归”的闭环。当前 loop --run 不会自动切到隔离环境，loop --finish --commit 仍按全仓 git add -A 提交，主工作区一旦有脏改动就容易把无关内容卷进来，导致任务虽然 done 却没有可靠的 commit 留痕。

## 变更内容

- 给 openprd loop --run 增加显式 --worktree / --branch，或提供先创建隔离 worktree 再执行的包装入口。
- 在 commit 前增加主工作区脏状态门禁和显式 override 机制。
- 把提交范围从 git add -A 收窄到 task write-scope 或本轮 touched files。
- 把 worktreePath、branch、commitSha 写入 loop-state.json、agent-sessions.jsonl 以及相关状态输出。
- 支持显式 worktree / branch 配置，或提供隔离运行包装命令。
- 支持检测主工作区脏状态，并在 finish --commit 前阻断高风险路径。
- 支持基于 write-scope 或 touched files 生成本任务提交集。
- 支持在 loop 状态、session 日志和测试报告中记录 commit 关联信息。
- 支持为未满足 commit 前置条件的任务给出清晰诊断与恢复指引。
- 在隔离 worktree 中连续完成多个 loop 任务时，每个任务都能生成独立 commit，并把 commitSha 写回状态。
- 在脏主工作区直接尝试 finish --commit 时，会收到明确阻断和豁免提示。
- 从状态文件和 session 日志可以追溯每个任务对应的 worktree、branch、commit 和测试报告。
- 新能力不破坏现有 loop 的 plan、next、run、finish、verify 基本路径。

## 能力范围

- `agent-requirements`: OpenPrd loop 隔离 worktree 提交闭环 需求。

## 影响范围

- 主要用户: 需要用 OpenPrd loop 执行中等到长程实现的维护者
- 主要用户: 希望逐任务 commit、可审查、可回归且不污染主工作区的 Agent 协作者
- 成本来源: 这次主要要避免无关改动混入 commit、回滚成本升高，以及逐任务审查和回归失去抓手。
- 额度限制: 默认不允许在脏主工作区直接完成高风险 commit；需要显式进入隔离路径或明确豁免。
- 依赖: Git worktree 能力。
- 依赖: 现有 loop task executionStrategy.writeScope 与 finish / verify 流程。
- 依赖: OpenPrd 的状态文件、review / change / tasks 主流程。
- 风险: 如果 worktree / branch 生命周期设计不清，会显著抬高 loop 使用复杂度。
- 风险: 如果 touched files 收集不稳定，可能出现漏提或误提。
- 风险: 如果状态写回与 git 操作顺序不当，会出现 done / commitSha 不一致。
