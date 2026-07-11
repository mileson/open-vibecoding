# Image Preflight

| 问题 | 回答 |
| --- | --- |
| 真实图片是不是页面成立前提 | 否。Review Studio 是信息与决策产品，依赖真实项目数据而不是摄影素材。 |
| 必需图片类型 | 只需要三方向交互候选图作为评审证据。 |
| 计划来源 | 使用 Codex 原生 Image 2 生成，并用 `openprd visual-prepare` 拆分成 reference set。 |
| 缺失风险 | 候选图只表达信息架构，不作为像素级实现稿；生成文字可能失真。 |
| 降级方案 | 实现以现有 Review DOM、tokens 和真实 v0018 数据为准，候选图只约束布局、层级和阅读路径。 |

