# 角色

## 用户

- 主要用户:
- 用 Vibe Coding 方式做产品的产品经理

- 次要用户:
- 待补充

- 相关方:
- OpenPrd 维护者
- 在脏仓库或长程任务中依赖 loop 的项目协作者

## 类型专项

- humanAgentContract: 用户决定是否进入 loop、是否要求 commit、是否接受 override；Agent 负责在安全前提下创建隔离执行环境，并维护状态与证据闭环。
- autonomyBoundary: Agent 可以在 loop 运行前准备 worktree、检查脏状态并收集 touched files，但不能在用户未授权 commit 的情况下自动提交，也不能在高风险脏仓库里静默绕过门禁。
- toolBoundary: 优先使用本地 Git 与 OpenPrd loop 状态完成这次能力，不引入新的远端托管或发布前置依赖。
- stateModel: change 进入 loop 后，先绑定隔离执行环境，再逐任务 run / verify / finish / commit，并把 worktree、branch、commit 与测试报告写回同一条状态链。
- evalPlan: 通过 loop 单测、worktree / dirty repo 场景测试、状态持久化测试，以及一次真实隔离 worktree 的串行回归验证这次改动。
