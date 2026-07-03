# PM 流程引导与画布评审协同（Human-in-the-loop 升级）

## 背景与原因

产品经理使用 OpenPrd 时缺少一条看得懂的标准流程指引，经常不知道自己处在需求到收口的哪一步、下一步该做什么；对话协同画布目前是通用白板，没有接入评审方向选择等 OpenPrd 流程环节，Human-in-the-loop 在工具之间断开。

## 变更内容

- 新增 openprd guide 命令：7 步标准流程 + 当前位置 + 下一步动作（PM 语言，支持 --json）
- review.html 顶部新增流程位置条（stepper）
- 画布服务端新增 /api/review-directions 与 /api/guide
- 画布前端新增导入评审方向按钮与流程位置条
- guide 命令基于工作区状态推断 7 步流程位置
- review.html 渲染 stepper
- canvas /api/review-directions 返回方向元数据与图片
- canvas 前端导入方向卡片组
- 在 openprd 自身仓库通过单元测试与 standards/quality/run verify；用 Codex CLI 在本地跑一个桌面任务实测新流程效果并留下证据。

## 能力范围

- `agent-requirements`: PM 流程引导与画布评审协同（Human-in-the-loop 升级） 需求。

## 影响范围

- 主要用户: 用 Vibe Coding 方式做产品的产品经理
- 成本来源: imagegen 每方向一次调用，共 3 次；报告清理为本地文件操作无外部成本。
- 额度限制: docs-compact 单次只处理 docs/basic 下的标准文档；retention 默认保留最近 30 份报告可配置。
- 依赖: Codex 原生 imagegen（生成 3 方向交互稿图片）；现有 review artifact 渲染与 hash 校验管线。
- 风险: 流程步骤定义与既有 lane/gate 概念不完全一一对应，guide 只做展示层推断，不改门禁行为
