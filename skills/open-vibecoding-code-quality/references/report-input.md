# 代码质量评审输入

用 `open-vibecoding code-quality-report render --data <report.json> --out <report.html>` 生成独立 HTML。完整字段说明和选图输入分别随 CLI 包的 `docs/code-quality-report.md` 和 `docs/examples/photo-selection-quality.json` 提供。

- 顶层 `schemaVersion` 用 `open-vibecoding.code-quality-report.v1`。填写 `id`、`revision`、`title`、`conclusion`、`scope`，以及按优先级排列的 `priorities`，每项含 `id`、`title`、`action`。
- `dimensions` 包含 `complexity`、`duplication`、`testStrength`。分别填写 `summary`、`checks`、`findings`。可选 `label` 为目录与章节的显示名。每条检查含 `id`、`title`、`method`、`scope`、`detail` 和 `status`（`findings`、`no_findings`、`candidate`、`not_run`、`unsupported`、`blocked`）。`detail` 记录实际证据或缺口，未确认线索填 `candidate`。
- 每条已确认发现含 `id`、`title`、`checkId`、`severity`（`high`、`medium`、`low`）、`evidence`、`impact`、`recommendation`、`locations` 和 `verification`。位置用 `path`、`line`、可选 `endLine`，重复发现至少列两处。复验填 `status`（`pending`、`passed`、`failed`、`blocked`）及 `detail`。每条确认发现指向同维度的 `findings` 状态检查。
- 优先项、检查及发现的 ID 在报告内唯一，以小写字母开头，后续允许小写字母、数字、连字符和下划线。没有已确认发现时传入空数组，同时据实填写检查状态。
- 测试检查可用 `runs` 分开记录基线、变异和恢复复测。每项填 `title`、`detail` 及 `status`（`passed`、`assertion_failed`、`survived`、`uncovered`、`timeout`、`compile_error`、`runtime_error`、`not_run`）。
