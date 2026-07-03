# 文档反污染治理与界面需求3方向交互稿评审

## 背景与原因

OpenPrd 长期项目出现文档污染：docs/basic 巨行追加膨胀且顶层 PRD 失真（moticlaw backend-structure.md 57KB/119行、prd.md 落后约170个需求版本），.openprd 内部产物无保留策略（quality/reports 5118 份 5.2GB、active 280 个版本目录从未归档）；同时 L1/L2 界面类需求的 3 方向效果图只散落在聊天里，评审结果不可回溯、不进固定评审界面。

## 变更内容

- A1 standards verify 增加 docs/basic 巨行与 stale 质量检查；A2 quality/reports 与 harness 证据 retention 清理；A3 docs-compact 压缩建议工具与 change 收口默认归档；B1 review-presentation 合同新增 designDirections 区块（3 方向图 + 审美主张 + 避开项 + 选择状态）；B2 review.html 渲染 3 方向评审卡片并支持选定/驳回回写；同步更新 skills 生成源与 docs/basic 文档。
- standards verify 新增 docsQuality 检查（巨行、平均行长、prd.md 版本落后）；新增 openprd docs-compact 命令输出压缩重写建议稿；quality verify 后按 retention 策略清理旧报告（保留 latest + 最近 N）；change --archive 在收口路径默认执行；review-presentation --template 输出含 designDirections 的模板；review.html 渲染 3 方向卡片区块。
- 在 openprd 自身仓库通过单元测试与 standards/quality/run verify；用 Codex CLI 在本地跑一个桌面任务实测新流程效果并留下证据。

## 能力范围

- `agent-requirements`: 文档反污染治理与界面需求3方向交互稿评审 需求。

## 影响范围

- 主要用户: 使用 OpenPrd 管理项目的产品经理和 Agent（Codex / Claude Code / Cursor），尤其是长生命周期重度项目的维护者。
- 成本来源: imagegen 每方向一次调用，共 3 次；报告清理为本地文件操作无外部成本。
- 额度限制: docs-compact 单次只处理 docs/basic 下的标准文档；retention 默认保留最近 30 份报告可配置。
- 依赖: Codex 原生 imagegen（生成 3 方向交互稿图片）；现有 review artifact 渲染与 hash 校验管线。
- 风险: 存量污染项目首次 verify 会出现大量报警，需要以 warning 分级而非 error 硬阻塞；retention 清理属于删除类动作，默认 dry-run 并只在 verify/doctor 提示，实际清理需要显式命令。
