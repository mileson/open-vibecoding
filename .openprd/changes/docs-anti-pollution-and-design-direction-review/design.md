# 设计

## 背景

6-7 月 475 个 Codex 会话实测显示门禁执行率高但拦不住污染，写入型会话仅 37% 更新过 docs/basic；用户已明确要求按 OpenSpec delta+archive 与 Superpowers 可视评审最佳实践立项优化。

## 目标

- 1) docs/basic 与 .openprd 不再随会话数复利膨胀：verify 能发现巨行与 stale，报告有 retention，change 收口默认归档；2) L1/L2 界面类需求评审时，imagegen 生成的 3 方向交互稿进入固定 review.html 评审区块，用户在评审界面选定方向并结构化写回 selected-direction。

## 范围

- A1 standards verify 增加 docs/basic 巨行与 stale 质量检查；A2 quality/reports 与 harness 证据 retention 清理；A3 docs-compact 压缩建议工具与 change 收口默认归档；B1 review-presentation 合同新增 designDirections 区块（3 方向图 + 审美主张 + 避开项 + 选择状态）；B2 review.html 渲染 3 方向评审卡片并支持选定/驳回回写；同步更新 skills 生成源与 docs/basic 文档。

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
- 风险: 存量污染项目首次 verify 会出现大量报警，需要以 warning 分级而非 error 硬阻塞；retention 清理属于删除类动作，默认 dry-run 并只在 verify/doctor 提示，实际清理需要显式命令。
- 问题: designDirections 选择回写默认走 review artifact 手动确认还是 canvas handoff 自动回传（本期先支持 review --mark 附带 direction 参数，canvas 自动回传后续增强）。
