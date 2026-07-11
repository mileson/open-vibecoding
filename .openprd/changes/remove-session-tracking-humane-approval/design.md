# 设计

## 背景

对标 Cowart 已验证“标注改图闭环 + 画布双向结构化工具 + 生图尺寸契约 + 具名 skill 唤起”四件能力能显著降低人机视觉协同成本；OpenPrd 0.1.18 刚落地生图路由，正好把尺寸契约与路由串起来。

## 目标

- 用户在画布上标注后，一句话就能让 Agent 读懂标注并生成修订图放回原图旁
- Agent 能结构化读取画布选区并把图片锚定回填
- 生图请求自动携带占位卡尺寸契约
- 用户能用自然语言稳定唤起画布协同

## 范围

- canvas-workspace.js 新增选区状态持久化与查询 API
- canvas-workspace.js 新增锚定插图 API（anchorShapeId/placement/replaceHolder）
- canvas-app.html.js 标注修改请求导出（带元数据）与选区上报
- 生图占位卡尺寸契约写入 handoff 与生图指引
- codex-hook-runner-template.mjs 画布协同意图识别与引导注入
- agent-canonical-content.js 画布协同指引
- docs/basic 与 README 同步

## 约束

- 沿用 Excalidraw embed 与现有 canvas-sessions 文件存储
- Node 内置测试框架
- 不新增外部依赖
- hook 热路径（每次工具调用）禁止读取全局 sessions.jsonl 等 O(N) 追加文件；会话级状态一律 per-session 本地文件 O(1) 直读。
- workspace 级单例状态文件（turn-state/run-state）里会话相关字段不得被并行窗口互相覆写；真相源收敛到 change 文件夹与任务台账。
- 不写入敏感信息
- 画布数据留在本地项目目录
- 依赖 openprd canvas 本地服务
- 依赖 0.1.18 生图路由协议

## 业务护栏

- 成本来源: 主要成本是生图调用次数与画布服务本地资源
- 额度限制: 首版按单画布会话协同，不开放批量自动改图
- 滥用防护: insert-image 校验锚点与文件存在性，避免脏写
- 滥用防护: API 仅本地回环访问
- 监控信号: ops.json handoff 记录数、回填成功率、API 错误率
- 报警阈值: 回填连续失败时提示用户检查画布服务状态
- 止损动作: 异常时停止自动回填，保留原画布快照并回退到手动流程

## 风险与开放问题

- 假设: 用户接受标注截图作为修改指令载体
- 假设: Excalidraw selection 数据足以表达锚定需求
- 风险: Excalidraw 与 tldraw 数据模型差异导致锚定语义需要适配
- 风险: 标注文字识别依赖 Agent 视觉能力
- 问题: 后续是否把画布协同扩展为独立 MCP server 另行评估
