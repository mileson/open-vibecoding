# 角色

## 用户

- 主要用户:
- 使用 OpenPrd 画布做视觉协同的开发者与产品设计协作者

- 次要用户:
- 待补充

- 相关方:
- OpenPrd 维护者
- Codex/Cursor 上的 Vibe Coding 用户

## 类型专项

- humanAgentContract: 标注意图由人给出，修订图生成与回填由 Agent 自动完成；替换原图等破坏性动作仍需人确认。
- autonomyBoundary: Agent 可自动读选区、生成并旁位回填；不得覆盖或删除用户原图与标注。
- toolBoundary: 使用画布本地 HTTP API、生图路由选定的内置生图工具与 OpenPrd CLI。
- stateModel: 画布 scene/selection/ops 文件保存在 .openprd/harness/canvas-sessions/<session-key>/。
- evalPlan: 集成测试覆盖 selection/insert-image/标注导出元数据/hook 引导注入，最终跑 dev-check 与发布前四项验证。
