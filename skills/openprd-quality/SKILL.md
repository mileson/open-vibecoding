---
name: openprd-quality
description: 按显式请求诊断 OpenPrd 的可观测性、业务成本、测试证据、媒体证据、性能与历史 eval 数据；默认收口不生成质量评估文件。
---

# OpenPrd Quality

## 定位

这份 skill 是按需诊断工具，不再是每个任务的默认收口层。

- 默认收口使用本任务测试、task-scoped evidence、`openprd standards . --verify`、`openprd run . --verify` 与必要的 `openprd doctor .`
- `run --verify` 不调用 quality 全量扫描，不生成 `.openprd/quality/reports/eval-*.json` 或 `.html`
- `loop --finish` 不生成 quality report，也不根据 quality 自动创建 knowledge candidate
- 旧 `.openprd/quality/reports/` 保留为历史文件，不删除、不续写、不作为当前任务完成条件

## 何时显式使用

只有用户明确要求下列诊断时，才运行 `openprd quality <path> --verify`：

- 盘点日志、链路追踪、业务成本或滥用护栏
- 审查冒烟、功能覆盖、性能、极端数据或媒体证据
- 解释旧 `eval-*.json/html` 中的历史结论
- 为一次专项审计临时查看完整结构化质量状态

命令返回内存中的结构化诊断结果；不会写入 eval JSON/HTML、latest、index 或 retention 状态。

## 核心命令

- 初始化显式诊断配置：`openprd quality <path> --init`
- 运行一次显式诊断：`openprd quality <path> --verify`
- 严格诊断：`openprd quality <path> --verify --fail-on-violation`
- 从当前 turn-state 或诊断材料生成经验候选：`openprd quality <path> --learn --review --from <diagnostics-or-turn-state>`
- 从已确认候选或历史 eval JSON 沉淀项目经验：`openprd quality <path> --learn --from <candidate-dir|legacy-report.json>`

## 诊断边界

- `pass` 只说明检测到对应能力与证据，不替代真实测试、浏览器、设备、生产或第三方系统回读
- `needs-evidence` 表示缺当前证据，不自动生成报告补位
- `needs-attention` 表示专项诊断发现缺口，不回写为当前 task 的失败
- 历史 `productionReady` 只属于生成该旧报告时的工作区快照，不能继承成当前状态
- 没有人工 gold transcript 时，ASR 准确率保持 unknown
- 视觉任务仍按 `visual-compare` 和 task-scoped evidence 验收，不需要 quality HTML 再包装一次

## 默认收口合同

1. 运行当前任务真正需要的单元、集成、端到端、人工、视觉、媒体、性能或安全验证。
2. 把命令、结果与证据路径写入 `.openprd/harness/test-reports/` 或任务 metadata。
3. 运行 `openprd dev-check . <touched-code-files...>`。
4. 阶段或发布收口运行 `openprd standards . --verify`、`openprd run . --verify` 与必要的 `openprd doctor .`。
5. 最终回复直接说明任务测试结果、工作区结构提醒与未验证边界，不链接或要求新 quality eval 报告。

## 经验沉淀

经验沉淀必须显式触发。只有问题具备重复性、高影响、难以重新发现，或明显由 Agent 误判导致时，才从 turn-state、诊断材料、已确认候选或历史 eval JSON 生成项目级 Skill。

每个经验 Skill 至少包含：

- 触发条件
- 先看什么
- 根因模式
- 修复策略
- 验证证据
- 预防要求

不要把一次性噪声、每次 doctor/run 的成功状态或大批扫描摘要自动沉淀成 candidate。
