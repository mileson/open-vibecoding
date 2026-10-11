---
name: open-vibecoding-product-document
description: 当用户明确需要产品说明、研究结论、需求说明、发布说明或其他产品文档交付时使用；不因研发任务自动生成 PRD、change 或 tasks。
---

# 按需产品文档

先确定读者要凭文档做什么：理解机会、比较方案、实施功能、验收结果或对外发布。选择能完成该任务的最小形式；用户指定格式时沿用指定格式，不默认套 PRD 模板。

- 事实、决定、建议和待确认项分别表达。引用研究、数据或竞品时保留来源与日期，避免把推断写成事实。
- 面向研发的说明聚焦用户行为、边界、异常和成功条件；已有代码足以表达的实现细节不重复抄写。
- 面向用户的文案说清能做什么、会发生什么、下一步是什么；已有 i18n 时同步所有支持语言。
- 文档是本次明确交付物或确需维护的活文档，不是 Agent 开工许可证。旧 `.open-vibecoding/` requirement、PRD、change、tasks 只读保留，不覆盖历史。

目标或证据仍不清楚时调用 `$open-vibecoding-product-diagnosis` 或 `$open-vibecoding-product-research`，只对真实歧义提出必要问题。
