## 新增需求

### 需求：文档反污染治理与界面需求3方向交互稿评审
OpenPrd 长期项目出现文档污染：docs/basic 巨行追加膨胀且顶层 PRD 失真（moticlaw backend-structure.md 57KB/119行、prd.md 落后约170个需求版本），.openprd 内部产物无保留策略（quality/reports 5118 份 5.2GB、active 280 个版本目录从未归档）；同时 L1/L2 界面类需求的 3 方向效果图只散落在聊天里，评审结果不可回溯、不进固定评审界面。

#### 场景：主流程成功
- **当** 文档治理流：Agent 改代码 -> dev-check/standards verify 报巨行与 stale -> docs-compact 给出压缩重写建议 -> change 收口自动归档 active 版本目录并按 retention 清理报告。设计评审流：L2 界面需求 -> design brief -> imagegen 3 方向交互稿 -> 登记 designDirections -> review-presentation 校验写入 -> review.html 展示 3 方向卡片 -> 用户选定 -> user-confirmed 写回 selected-direction.md -> 实现阶段 visual-compare 用选定方向做 reference。
- **则** 在 openprd 自身仓库通过单元测试与 standards/quality/run verify；用 Codex CLI 在本地跑一个桌面任务实测新流程效果并留下证据。

#### 场景：边界情况保持可见
- **当** 非界面类 L2 需求不触发 designDirections 且 review 校验不因缺失阻塞；imagegen 不可用或限流时评审可先出文字方向卡占位并明确标注待补图；旧版本快照没有 designDirections 字段时渲染保持向后兼容；docs/basic 文件本来就短小的年轻项目不误报膨胀。
- **则** 产品应保持该情况明确可见，以支持实现和验证

#### 场景：失败模式得到处理
- **当** retention 误删 latest 指针或在途报告导致 quality verify 失败；归档把进行中的 change 移走导致状态断裂；巨行检查阈值过严导致老项目 verify 永远红灯阻塞正常工作；review.html 选择回写通道失败导致方向确认丢失。
- **则** 产品应提供有边界且可评审的结果
