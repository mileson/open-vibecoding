# 设计

## 背景

用户明确反馈不少人用了 OpenPrd 觉得疑惑它到底是干嘛的，希望有一套软件工程视角的标准流程引导；画布做了一半，需要继续对标白板工具补齐人机协同能力。

## 目标

- 产品经理任何时刻都能一眼看到自己处在 7 步标准流程的哪一步和下一步动作
- 画布接入评审方向导入与流程位置提示，让 PM 在白板上完成方向标注并把结论发回 Agent

## 范围

- dev-check 自动重构模式：默认开启，命中 attention/warning 时指示 Agent 本轮直接执行高内聚低耦合拆分（不丢功能），输出改为本次额外处理结果，并支持 --auto-refactor on/off 开关与收口确认话术
- 图标最佳实践自动触发：asset-spec 增加功能图标行，design-starter/skills/catalog/hook 把新功能自动配图标写为默认行为
- 拼图证据板强化：visual-compare 输出对话流嵌入 markdown，dev-check 对 UI 文件补视觉证据提醒，skills/catalog 把网格对齐证据板写为界面布局场景默认动作

## 约束

- 改动集中在 src/standards.js、src/quality.js、src/openspec/change-lifecycle.js、src/review-presentation.js、src/html-artifacts.js，新增 src/docs-compact.js；skills 生成源同步 openprd-shared / openprd-frontend-design / command-catalog。
- 提交与状态写回不能泄露用户本地无关改动或敏感信息。
- Codex 原生 imagegen（生成 3 方向交互稿图片）；现有 review artifact 渲染与 hash 校验管线。

## 业务护栏

- 成本来源: imagegen 每方向一次调用，共 3 次；报告清理为本地文件操作无外部成本。
- 额度限制: docs-compact 单次只处理 docs/basic 下的标准文档；retention 默认保留最近 30 份报告可配置。
- 滥用防护: docs-compact 重写稿默认写到 sibling draft 待确认，不直接覆盖原文档；retention 不触碰 evidence 目录中被 latest 报告引用的文件。
- 监控信号: standards verify 输出 docsQuality 结果；doctor 输出 .openprd 体积与报告数量提示。
- 报警阈值: 单行超 300 字符 warning；prd.md 落后最新版本超过 20 个版本 warning；quality/reports 超过 200 份提示清理。
- 止损动作: 任一清理动作失败即中止并保留原状；归档失败回退为仅提示不移动。

## 风险与开放问题

- 假设: imagegen 由 Codex 原生 Image 2 提供，OpenPrd 只消费图片路径；review.html 静态打开，选择结果通过现有 canvas/browser handoff 或 review --mark 通道回传；巨行阈值默认 300 字符可配置。
- 风险: 流程步骤定义与既有 lane/gate 概念不完全一一对应，guide 只做展示层推断，不改门禁行为
- 问题: 画布方向卡片是否需要内置投票/评分组件，留到下一轮看使用反馈
