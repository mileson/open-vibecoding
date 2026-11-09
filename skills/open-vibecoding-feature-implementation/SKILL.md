---
name: open-vibecoding-feature-implementation
description: 当用户目标已明确并要求实现新功能或调整现有行为时，帮助 Agent 确定代码边界、失败路径和验证；不接管 Agent 的任务规划或生成流程文档。
---

# 功能实现

涉及用户可见内容时，落实内部 `$open-vibecoding-public-content-boundary`：把制作过程、开发规则和实现解释隔离在成品之外；生成前区分可见文案与工作指令，交付前检查实际结果。保留必要业务反馈，用户明确要求时才在指定文档解释内部过程。

先识别用户可观察的成功行为、现有入口和约束，再读取相关代码与测试。研发内部按 `$open-vibecoding-code-quality` 的实现行为、整理质量、工程收尾三个阶段推进；Agent 自主决定阶段内的拆解与验证方法，小改动可在一个短循环完成，不把任务列表写入旧 change/tasks 状态机。

- 优先沿用项目现有结构、依赖和命名；外部技术事实在本地证据不足时按项目调研规则核验。
- 实现或构建会创建环境、缓存、镜像和中间产物时，用内部 `$open-vibecoding-resource-efficiency` 检查最小足够方案与收尾边界；不默认留多份副本，不将普通功能升级为资源治理平台。
- 技术方案存在新旧选择时，按需用 `$open-vibecoding-best-practices` 检查当前项目条件；新增代码优先适用的现代做法，旧接口保留需有具体兼容理由。Apple 多语言实现调用独立实践条目，不照搬历史 wrapper。
- 同时考虑正常路径、权限或输入边界、失败恢复和已有兼容行为。真正会改变产品结果的未知项才向用户提问。
- 功能会消耗有限资源或改变使用权益时，主动读取 `$open-vibecoding-resource-entitlement-design`，检查生命周期、失败恢复与最小运营配套；复用已有机制，不默认搭建计费或管理平台。
- UI 交互先用 `$open-vibecoding-interaction-design` 明确行为；界面视觉按需用 `$open-vibecoding-frontend-design`。
- 涉及界面视觉的实现或审查，收口落实 `$open-vibecoding-visual-evidence-delivery`，主动展示实际截图；有确认参考时展示双图，不能只报告测试通过。
- 实现后用 `$open-vibecoding-test-strategy` 选择足够验证，运行相关检查并报告真实结果。`dev-check` 只给维护提醒，不是开工门禁。
- 涉及故障修复、性能优化或本次实现暴露出的诊断盲区时，主动读取 `$open-vibecoding-diagnostic-readiness`；按需补强日志与测量并验证能取得，不将每次功能改动升级成观测平台建设。

涉及收款后的业务通知时，按实际目标复用内部 `$open-vibecoding-payment-notification`，先查看现有支付与通知机制，再提供可选卡片模板；模板采用不自动授权配置凭证、发送消息或启用生产通知。

默认以代码表达实现；仅在用户要求或活文档因改动失真时同步文档。诊断故障而未获修复授权时应停在根因说明，交给 `$open-vibecoding-debugging`。
