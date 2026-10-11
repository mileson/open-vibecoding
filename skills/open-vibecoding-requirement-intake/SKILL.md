---
name: open-vibecoding-requirement-intake
description: Open VibeCoding 研发入口提醒。产品目标明确后，按影响、未知数和验证成本提示 Agent 调整节奏；不创建 PRD、change 或 tasks。
---

# 研发需求分流

产品目标、真实问题或用户体验根因尚不明确时，先用 `$open-vibecoding-product-diagnosis`。本 Skill 只帮助 Agent 判断研发任务的复杂度，不替 Agent 规划，也不改变其任务状态。

## 判断维度

- 影响面：局部代码、跨模块行为，还是新流程或外部系统。
- 未知数：用户目标、约束、失败路径和验收方式是否清楚。
- 决策成本：错误选择是否难以回退，是否需要用户作出真正的产品选择。
- 验证成本：单元、集成、运行态、视觉、安全等证据需要多少。

可用“直接处理（L0）/ 现有功能优化（L1）/ 新功能或新流程（L2）”作为内部轻量提示，不把路由码当流程门禁。小任务直接处理；中等任务可在对话中简述思路；复杂任务由 Agent 按自身方式拆解、逐项完成和验证。只有答案会实质改变结果时才问用户必要的问题。

不运行 `capture -> classify -> synthesize -> review -> change -> tasks`，不要求生成 requirement、PRD、review.html、change 或 tasks 文件。用户明确要求产品文档时，按需求产出相应文档；这是用户交付物，不是每次研发任务的前置凭证。既有历史资料仅作为参考，不回填、覆盖或推断其状态。

任务涉及界面时再读 `$open-vibecoding-interaction-design` 和 `$open-vibecoding-frontend-design`；涉及验证时读 `$open-vibecoding-test-strategy`。可保留真正不可从代码还原的证据，如视觉参照/对比、风险验证结果和外部动作读回。
