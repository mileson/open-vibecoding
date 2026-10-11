---
name: open-vibecoding-feature-implementation
description: 当用户目标已明确并要求实现新功能或调整现有行为时，帮助 Agent 确定代码边界、失败路径和验证；不接管 Agent 的任务规划或生成流程文档。
---

# 功能实现

先识别用户可观察的成功行为、现有入口和约束，再读取相关代码与测试。Agent 自主决定拆解方式和顺序；跨模块工作可逐项落地，但不把任务列表写入旧 change/tasks 状态机。

- 优先沿用项目现有结构、依赖和命名；外部技术事实在本地证据不足时按项目调研规则核验。
- 技术方案存在新旧选择时，按需用 `$open-vibecoding-best-practices` 检查当前项目条件；新增代码优先适用的现代做法，旧接口保留需有具体兼容理由。Apple 多语言实现调用独立实践条目，不照搬历史 wrapper。
- 同时考虑正常路径、权限或输入边界、失败恢复和已有兼容行为。真正会改变产品结果的未知项才向用户提问。
- UI 交互先用 `$open-vibecoding-interaction-design` 明确行为；界面视觉按需用 `$open-vibecoding-frontend-design`。
- 实现后用 `$open-vibecoding-test-strategy` 选择足够验证，运行相关检查并报告真实结果。`dev-check` 只给维护提醒，不是开工门禁。
- 涉及故障修复、性能优化或本次实现暴露出的诊断盲区时，主动读取 `$open-vibecoding-diagnostic-readiness`；按需补强日志与测量并验证能取得，不将每次功能改动升级成观测平台建设。

默认以代码表达实现；仅在用户要求或活文档因改动失真时同步文档。诊断故障而未获修复授权时应停在根因说明，交给 `$open-vibecoding-debugging`。
