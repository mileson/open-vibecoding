# 交接

- 本次内容: 画布协同闭环：标注改图、双向结构化工具、尺寸契约与唤起机制
- 产品场景: 以 Agent 为主要使用场景
- 场景模板: 以 Agent 为主要使用场景
- 负责人: OpenPrd
- 下一步: 生成 change 与任务拆解后按序实现
- 交接去向: OpenPrd CLI 画布子系统

## 变化摘要

- 新增：选区状态随画布保存并可查询
- 新增：插图 API 支持 left/right/below 摆放与 holder 替换
- 新增：标注导出携带 annotationEdit 与源图形 ID 元数据
- 新增：生图占位卡 handoff 记录携带宽高与比例契约
