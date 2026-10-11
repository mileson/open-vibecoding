---
name: open-vibecoding-harness
description: Open VibeCoding 的 Agent 增强总则。按任务场景提供工具和质量提醒，不接管 Agent 的规划、执行顺序或任务状态。
---

# Open VibeCoding Harness

用户直接描述任务。Agent 自主理解目标、拆解复杂工作、选择顺序并完成实现；Open VibeCoding 只提供按需的场景 Skill、CLI 工具和非阻断提醒，不要求固定起手指令或线性流程。`$open-vibecoding-router` 负责场景导航，`$open-vibecoding-shared` 负责共用安全与表达规则。

## 执行原则

- 规划、诊断和评审请求保持只读；用户要求实现或继续时推进授权范围。真实歧义会改变结果时提必要问题，其他情况说明可逆假设。
- 产品问题按意图选择诊断、用户与市场调研、竞品分析或按需产品文档子能力；不把“先诊断”设为固定步骤。改动目标明确后，`$open-vibecoding-requirement-intake` 只提示研发复杂度与风险。不要生成 PRD、change、tasks 或固定 review 记录作为开工条件，也不要在后台自动补写。
- Agent 可用自身任务能力逐项执行复杂工作；工具不替 Agent 决定任务列表、并发方式或思考步骤。
- 使用 `$open-vibecoding-test-strategy` 选择与风险相称的验证。优先保留运行结果、失败原因、必要的外部动作读回，以及无法从代码重建的视觉证据；不为了留痕而生成文档。
- 旧 `.open-vibecoding/` requirement、PRD、review、change、tasks 属历史资料，不推断、补写或改写。旧版只读命令可用于查阅；旧版生成和推进实现已移除。
- 代码本身是默认实现说明。只有用户要求、跨系统合同必须说明，或现有文档会因本次改动失真时，才写或同步文档。

## 按需能力

- 交互：流程与状态、视觉方向评审、视觉实现与对比各有独立场景。大界面方向评审用有实质差异的候选；轻量调整不用机械升级。候选图与用户确认参考分清来源。
- 研发：功能实现、故障定位、重构各由独立场景提醒，Agent 自主思考与执行。`dev-check` 是代码变更后的维护提醒，不是执行许可。
- 测试：测试策略与实际验收分开；真实媒体、小程序、浏览器、性能或安全任务按对应风险补真实证据，不用构建成功替代运行态证据。
- Vibe Coding 增强：工具选择、画布协作、经验复用各有独立场景；`capabilities` 是 Agent 的能力发现接口，不能按固定关键词自动派发。
- 人类审查：用户需要 HTML 或比较、媒体、复杂矩阵确需审查界面时，按 `references/agent-authored-html-review.md` 制作；采用结论先行、总分总与业务案例，并复用 `references/review-handoff.md` 的固定“复制评审结果给 AI”组件。普通任务不生成 `review.html`，组件不接管正文或自动发送。

## 收口

说明已实现内容、实际验证、仍未知或未完成的事项。外部发布、发送、批量写入等高影响动作仍遵守用户范围、真实权限与宿主安全规则。自动化任务优先遵循自身 runbook；不要仅因 Open VibeCoding 的旧状态文件缺失而阻断。
