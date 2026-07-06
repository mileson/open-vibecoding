# 画布协同闭环：标注改图、双向结构化工具、尺寸契约与唤起机制

## 背景与原因

OpenPrd 画布目前只有单向的“发送给 Codex”整体交接：Agent 不能结构化读取用户在画布上的选区与标注，不能把生成图片精准放回画布锚点旁，标注修改意图靠用户口述或手动截图传递，协同链路断在“人标注完之后”这一步。

## 变更内容

- canvas-workspace.js 新增选区状态持久化与查询 API
- canvas-workspace.js 新增锚定插图 API（anchorShapeId/placement/replaceHolder）
- canvas-app.html.js 标注修改请求导出（带元数据）与选区上报
- 生图占位卡尺寸契约写入 handoff 与生图指引
- codex-hook-runner-template.mjs 画布协同意图识别与引导注入
- agent-canonical-content.js 画布协同指引
- docs/basic 与 README 同步
- 选区状态随画布保存并可查询
- 插图 API 支持 left/right/below 摆放与 holder 替换
- 标注导出携带 annotationEdit 与源图形 ID 元数据
- 生图占位卡 handoff 记录携带宽高与比例契约
- hook 识别画布协同意图并注入闭环指引
- canvas 服务新增 GET /api/selection 与 POST /api/insert-image 且测试通过
- 标注导出带 annotationEdit 元数据并能被 hook 指引消费
- hook 对画布协同意图注入引导语

## 能力范围

- `agent-requirements`: 画布协同闭环：标注改图、双向结构化工具、尺寸契约与唤起机制 需求。

## 影响范围

- 主要用户: 使用 OpenPrd 画布做视觉协同的开发者与产品设计协作者
- 成本来源: 主要成本是生图调用次数与画布服务本地资源
- 额度限制: 首版按单画布会话协同，不开放批量自动改图
- 依赖: 依赖 openprd canvas 本地服务
- 依赖: 依赖 0.1.18 生图路由协议
- 风险: Excalidraw 与 tldraw 数据模型差异导致锚定语义需要适配
- 风险: 标注文字识别依赖 Agent 视觉能力
