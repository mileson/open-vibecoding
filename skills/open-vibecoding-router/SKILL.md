---
name: open-vibecoding-router
description: Open VibeCoding 入口路由。按用户目标组合五个执行能力域与横向最佳实践，依据项目条件选择独立子能力。
---

# Open VibeCoding Router

用户直接描述目标；Agent 从当前会话、项目代码和必要证据判断用户想解决的问题及当前决策，再选择一个或多个子能力。不要写固定关键词表、正则命中器或跨能力域的强制阶段序列。已授权代码变更在研发域内采用实现行为、整理质量、工程收尾三个阶段，方法由内部代码质量能力维护。`open-vibecoding capabilities list|get|contract` 仅供 Agent 发现能力，不要求用户先选 `/from-idea` 等入口。

| 当前需要作出的判断或完成的工作 | 独立子能力 |
|---|---|
| 解释竞品在特定市场为何增长、如何获客与促成付费；按关注清单比较跨次变化 | `$open-vibecoding-competitor-growth-analysis`、`$open-vibecoding-competitor-tracking`，按需复用内部 `$open-vibecoding-competitive-evidence`；持续跟踪须授权并使用宿主调度，不自动创建任务 |
| 定位产品问题属于哪一层；了解用户与市场；对比替代方案；明确要求文档交付 | `$open-vibecoding-product-diagnosis`、`$open-vibecoding-product-research`、`$open-vibecoding-competitor-analysis`、`$open-vibecoding-product-document` |
| 根据真实使用数据解释转化、留存或功能使用变化，判断下一步优化 | `$open-vibecoding-product-data-analysis`，属于产品分析，不替代用户与市场调研 |
| 判断上线后的崩溃和错误影响、版本变化，复查修复后是否再发生 | `$open-vibecoding-production-anomaly-analysis`，属于线上质量分析，不自动修复或启动监控 |
| 设计任务流程与状态；生成单张界面效果图或比较多个方向（包括仅生图、不写代码）；按参考实施并视觉验收 | `$open-vibecoding-interaction-design`、`$open-vibecoding-visual-direction-review`、`$open-vibecoding-frontend-design` |
| 为已有产品设计新界面、弹窗、组件或效果图，需要融入项目原有风格 | 内部 `$open-vibecoding-design-context`；主动查看目标界面和样式组件，把实际参考带入生成，交付前自查，不等用户提醒 |
| 界面或效果图显得杂乱、层级不清，或需要判断视觉调整是否帮助用户理解与操作 | 内部 `$open-vibecoding-visual-refinement`；继承项目风格，按问题整理层级、对齐、空间、字体、色彩与图标，核对业务含义和实际结果 |
| 生成或修改用户会看到的界面、效果图、文案与导出内容 | 内部 `$open-vibecoding-public-content-boundary`；隔离制作过程与内部规则，生成前约束、交付前查看实际结果，保留必要业务反馈 |
| 实现明确目标；定位并修复故障；在保持行为下改善结构 | `$open-vibecoding-feature-implementation`、`$open-vibecoding-debugging`、`$open-vibecoding-refactoring` |
| 已授权代码变更需要把功能做对、整理代码质量并完成工程收尾 | 内部 `$open-vibecoding-code-quality`；独立组合 `$open-vibecoding-code-complexity-review`、`$open-vibecoding-code-duplication-review`、`$open-vibecoding-test-strength-review`，不要求用户主动调用或逐步留痕 |
| 功能会消耗有限资源或改变使用权益，需要兼顾消费、恢复、运营与用户反馈 | 内部 `$open-vibecoding-resource-entitlement-design`，研发主责，产品、交互与测试按需复用；不默认收费或新建后台 |
| 修复故障或优化性能时，让再次发生的问题仍可继续深入定位 | `$open-vibecoding-diagnostic-readiness`，内部研发能力；主动评估盲区，按需补强并验证诊断证据，不自动开启监控 |
| 从测试用户的真实入口验证业务结果，选择可用操作工具；实际验收与回归 | `$open-vibecoding-test-strategy`、`$open-vibecoding-acceptance-verification` |
| 希望独立 reviewer 亲自操作界面发现问题；希望同时修复并让 reviewer 多轮复查 | `$open-vibecoding-ui-interaction-review`、`$open-vibecoding-ui-review-and-repair` |
| 选择工具；空间化协作；复用已验证经验 | `$open-vibecoding-tool-selection`、`$open-vibecoding-canvas-collaboration`、`$open-vibecoding-experience-reuse` |
| 实现、构建、测试或部署会占用环境与存储，需要减少重复实例、控制缓存或处理闲置产物 | 内部 `$open-vibecoding-resource-efficiency`；按实际约束选择最小足够方案，核对依赖与权限后收尾，不默认堆积冗余或清空缓存 |
| 看图时需要准确定位、对齐或局部调整；需要圈出问题或说明操作位置 | 内部能力 `$open-vibecoding-visual-localization`、`$open-vibecoding-image-annotation`；精确定位主动用红色坐标网格，普通图意理解不机械生成 |
| 界面视觉审查、修改或复查结束，要向用户展示最终效果 | 内部 `$open-vibecoding-visual-evidence-delivery`；最终回复展示实际截图，有确认参考时展示双图，无参考时也展示实际界面 |
| 主动取得匹配产品调性的成套图标；寻找现成素材、设计 SVG 或生成独立位图 | `$open-vibecoding-icon-system`，按需组合 `$open-vibecoding-icon-source`、`$open-vibecoding-icon-svg`、`$open-vibecoding-icon-image`、`$open-vibecoding-icon-cutout` |
| 用真实媒体验证声学质量、ASR 或语音字幕结果 | `$open-vibecoding-audio-evidence`，归属增强域并供研发与测试复用 |
| 希望收款后获得业务通知，或选择可复制的飞书收款卡片 | 内部 `$open-vibecoding-payment-notification`；先复用项目现有通道，提供可选模板与可靠发送规范，选定后复制到目标项目；不自动启用或发送 |
| 根据项目条件选择成熟的现代实现或迁移方式 | `$open-vibecoding-best-practices`；Apple 多语言实现按需用 `$open-vibecoding-ios-localization` |

先判断当前任务需要哪些能力，不要求五域全部经过。表格描述意图边界，不是触发词表；单个场景的详细做法只在其 Skill 内。项目增量场景可通过 `open-vibecoding.capabilities.json` 注册，仍由 Agent 语义选择。具体 CLI 在 `.open-vibecoding/harness/command-catalog.md`；共用安全、文案与浏览器规则在 `$open-vibecoding-shared`，工作原则在 `$open-vibecoding-harness`。

独立界面 Review 只审查；用户希望修复时选择组合能力。目录的 `uses` 表示可复用的子能力关系，不替 Agent 决定任务顺序或把所有 review 自动升级为修复。

数据与异常分析只内置轻量方法；需要外部能力时复用工具选择，优先现有连接或用户提供的数据，缺失时推荐并引导可选接入。不分发厂商 Skill、SDK、凭证或个人项目配置，不将外部工具登记为强制子能力依赖。没有数据不等于没有问题，查询已连通也不等于生产应用已开始上报。

最佳实践是新增横向板块，不是第六个必经阶段。根据平台、工具链、部署版本和本次目标选择实践；条件允许时优先已核实的现代方案，既有兼容行为按具体理由保留。每个主题独立扩展，不硬编码平台关键词派发。

音频证据统一使用 `$open-vibecoding-audio-evidence`；纯字幕 UI、文案或翻译只走相关设计能力。图标路径由素材角色、产品风格和真实消费尺寸判断，不按网站名或关键词强制派发。

不以 PRD、change、tasks 或 review.html 为默认产物，也不为留档而补写。复杂任务允许 Agent 用自身方式分解并逐项完成；只有视觉参照和实现对比、风险验证结果、外部动作读回等无法从代码可靠重建的证据才按需保留。用户明确要文档、设计稿或审查界面时再作为交付物制作。历史 `.open-vibecoding/` 材料只读保留。

公开仓库架构、第三方技术事实遵守 `$open-vibecoding-benchmark-router` 的证据规则。规划或分析请求保持只读；实现请求在用户授权范围内推进。自动化场景遵循自身 runbook，不把旧版工作流状态当开工门禁。
