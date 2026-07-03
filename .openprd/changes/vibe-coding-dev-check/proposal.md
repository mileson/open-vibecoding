# Vibe Coding 自动化三连：dev-check 自动重构、图标自动匹配、拼图证据入流

## 背景与原因

OpenPrd 三项 Vibe Coding 自动化能力不足：1) dev-check 超行提醒停留在后续建议表格，用户不知如何处理，价值鸡肋；2) 开发新功能时图标最佳实践路由几乎从不自动触发（415 个图标相关会话仅 1 次真实接入图标库）；3) 拼图/网格对齐证据板真实触发率低，证据图不在对话流中可视化，AI 自我审查作用未发挥。

## 变更内容

- dev-check 自动重构模式：默认开启，命中 attention/warning 时指示 Agent 本轮直接执行高内聚低耦合拆分（不丢功能），输出改为本次额外处理结果，并支持 --auto-refactor on/off 开关与收口确认话术
- 图标最佳实践自动触发：asset-spec 增加功能图标行，design-starter/skills/catalog/hook 把新功能自动配图标写为默认行为
- 拼图证据板强化：visual-compare 输出对话流嵌入 markdown，dev-check 对 UI 文件补视觉证据提醒，skills/catalog 把网格对齐证据板写为界面布局场景默认动作
- guide 命令基于工作区状态推断 7 步流程位置
- review.html 渲染 stepper
- canvas /api/review-directions 返回方向元数据与图片
- canvas 前端导入方向卡片组
- 在 openprd 自身仓库通过单元测试与 standards/quality/run verify；用 Codex CLI 在本地跑一个桌面任务实测新流程效果并留下证据。

## 能力范围

- `agent-requirements`: Vibe Coding 自动化三连：dev-check 自动重构、图标自动匹配、拼图证据入流 需求。

## 影响范围

- 主要用户: 用 Vibe Coding 方式做产品的产品经理
- 成本来源: imagegen 每方向一次调用，共 3 次；报告清理为本地文件操作无外部成本。
- 额度限制: docs-compact 单次只处理 docs/basic 下的标准文档；retention 默认保留最近 30 份报告可配置。
- 依赖: Codex 原生 imagegen（生成 3 方向交互稿图片）；现有 review artifact 渲染与 hash 校验管线。
- 风险: 流程步骤定义与既有 lane/gate 概念不完全一一对应，guide 只做展示层推断，不改门禁行为
