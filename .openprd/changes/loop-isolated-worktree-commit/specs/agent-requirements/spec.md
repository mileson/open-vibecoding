## 新增需求

### 需求：OpenPrd loop 隔离 worktree 提交闭环
OpenPrd 的 loop 虽然支持逐任务 finish 和可选 commit，但最近没有稳定形成“隔离 worktree + 单任务 commit + 可审查回归”的闭环。当前 loop --run 不会自动切到隔离环境，loop --finish --commit 仍按全仓 git add -A 提交，主工作区一旦有脏改动就容易把无关内容卷进来，导致任务虽然 done 却没有可靠的 commit 留痕。

#### 场景：主流程成功
- **当** 用户为一个 change 进入 loop 开发时，OpenPrd 可显式创建或接入隔离 worktree 与命名分支，再在其中逐任务运行和提交。
- **则** 在隔离 worktree 中连续完成多个 loop 任务时，每个任务都能生成独立 commit，并把 commitSha 写回状态。

#### 场景：边界情况保持可见
- **当** 用户在脏主工作区里直接尝试 finish --commit。
- **则** 产品应保持该情况明确可见，以支持实现和验证

#### 场景：失败模式得到处理
- **当** 误把主工作区无关改动一起提交。
- **则** 产品应提供有边界且可评审的结果
