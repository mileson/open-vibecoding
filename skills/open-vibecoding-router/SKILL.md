---
name: open-vibecoding-router
description: Open VibeCoding 入口路由。按用户目标组合五个执行能力域与横向最佳实践，依据项目条件选择独立子能力。
---

# Open VibeCoding Router

用户直接描述目标；Agent 从当前会话、项目代码和必要证据判断用户想解决的问题及当前决策，再选择一个或多个子能力。不要写固定关键词表、正则命中器或强制阶段序列。`open-vibecoding capabilities list|get|contract` 仅供 Agent 发现能力，不要求用户先选 `/from-idea` 等入口。

| 当前需要作出的判断或完成的工作 | 独立子能力 |
|---|---|
| 定位产品问题属于哪一层；了解用户与市场；对比替代方案；明确要求文档交付 | `$open-vibecoding-product-diagnosis`、`$open-vibecoding-product-research`、`$open-vibecoding-competitor-analysis`、`$open-vibecoding-product-document` |
| 根据真实使用数据解释转化、留存或功能使用变化，判断下一步优化 | `$open-vibecoding-product-data-analysis`，属于产品分析，不替代用户与市场调研 |
| 判断上线后的崩溃和错误影响、版本变化，复查修复后是否再发生 | `$open-vibecoding-production-anomaly-analysis`，属于线上质量分析，不自动修复或启动监控 |
| 设计任务流程与状态；比较大界面方向；按参考实施并视觉验收 | `$open-vibecoding-interaction-design`、`$open-vibecoding-visual-direction-review`、`$open-vibecoding-frontend-design` |
| 实现明确目标；定位并修复故障；在保持行为下改善结构 | `$open-vibecoding-feature-implementation`、`$open-vibecoding-debugging`、`$open-vibecoding-refactoring` |
| 修复故障或优化性能时，让再次发生的问题仍可继续深入定位 | `$open-vibecoding-diagnostic-readiness`，内部研发能力；主动评估盲区，按需补强并验证诊断证据，不自动开启监控 |
| 从测试用户的真实入口验证业务结果，选择可用操作工具；实际验收与回归 | `$open-vibecoding-test-strategy`、`$open-vibecoding-acceptance-verification` |
| 希望独立 reviewer 亲自操作界面发现问题；希望同时修复并让 reviewer 多轮复查 | `$open-vibecoding-ui-interaction-review`、`$open-vibecoding-ui-review-and-repair` |
| 选择工具；空间化协作；复用已验证经验 | `$open-vibecoding-tool-selection`、`$open-vibecoding-canvas-collaboration`、`$open-vibecoding-experience-reuse` |
| 主动取得匹配产品调性的成套图标；寻找现成素材、设计 SVG 或生成独立位图 | `$open-vibecoding-icon-system`，按需组合 `$open-vibecoding-icon-source`、`$open-vibecoding-icon-svg`、`$open-vibecoding-icon-image`、`$open-vibecoding-icon-cutout` |
| 用真实媒体验证声学质量、ASR 或语音字幕结果 | `$open-vibecoding-audio-evidence`，归属增强域并供研发与测试复用 |
| 根据项目条件选择成熟的现代实现或迁移方式 | `$open-vibecoding-best-practices`；Apple 多语言实现按需用 `$open-vibecoding-ios-localization` |

先判断当前任务需要哪些能力，不要求五域全部经过。表格描述意图边界，不是触发词表；单个场景的详细做法只在其 Skill 内。项目增量场景可通过 `open-vibecoding.capabilities.json` 注册，仍由 Agent 语义选择。具体 CLI 在 `.open-vibecoding/harness/command-catalog.md`；共用安全、文案与浏览器规则在 `$open-vibecoding-shared`，工作原则在 `$open-vibecoding-harness`。

独立界面 Review 只审查；用户希望修复时选择组合能力。目录的 `uses` 表示可复用的子能力关系，不替 Agent 决定任务顺序或把所有 review 自动升级为修复。

数据与异常分析只内置轻量方法；需要外部能力时复用工具选择，优先现有连接或用户提供的数据，缺失时推荐并引导可选接入。不分发厂商 Skill、SDK、凭证或个人项目配置，不将外部工具登记为强制子能力依赖。没有数据不等于没有问题，查询已连通也不等于生产应用已开始上报。

最佳实践是新增横向板块，不是第六个必经阶段。根据平台、工具链、部署版本和本次目标选择实践；条件允许时优先已核实的现代方案，既有兼容行为按具体理由保留。每个主题独立扩展，不硬编码平台关键词派发。

音频证据统一使用 `$open-vibecoding-audio-evidence`；纯字幕 UI、文案或翻译只走相关设计能力。图标路径由素材角色、产品风格和真实消费尺寸判断，不按网站名或关键词强制派发。

不以 PRD、change、tasks 或 review.html 为默认产物，也不为留档而补写。复杂任务允许 Agent 用自身方式分解并逐项完成；只有视觉参照和实现对比、风险验证结果、外部动作读回等无法从代码可靠重建的证据才按需保留。用户明确要文档、设计稿或审查界面时再作为交付物制作。历史 `.open-vibecoding/` 材料只读保留。

公开仓库架构、第三方技术事实遵守 `$open-vibecoding-benchmark-router` 的证据规则。规划或分析请求保持只读；实现请求在用户授权范围内推进。自动化场景遵循自身 runbook，不把旧版工作流状态当开工门禁。
