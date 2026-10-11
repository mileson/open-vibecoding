---
name: openprd-experience-diagnostic-candidate-turn-1780116203372-5f266a79e968c758
description: 由 OpenPrd 从 diagnostic-bundle 自动沉淀的项目级排查经验。目标是在相似问题再次出现时优先复用现有诊断证据，而不是临时补日志。
---

# openprd-experience-diagnostic-candidate-turn-1780116203372-5f266a79e968c758

## 触发条件

- 用户反馈同类故障再次出现，且需要快速沿着已有诊断证据定位。
- 运行态再次出现事件：run-verify, dev-check。
- 本次症状包括：本轮项目回顾；本轮围绕 5 个可沉淀文件生成回顾。 本轮结果里已经出现可复用的症状、排查线索或根因模式，不应该只留在当前对话里。 已记录 2 条回顾信号。；Inspect src/dev-standards.js；Inspect src/codex-hook-runner-template.mjs；Inspect src/agent-integration.js；Inspect src/loop.js。

## 先看哪些证据

- diagnostic-report: `.openprd/knowledge/candidates/candidate-turn-1780116203372-5f266a79e968c758/diagnostic-report.json`
- root-cause-candidates: `.openprd/knowledge/candidates/candidate-turn-1780116203372-5f266a79e968c758/root-cause-candidates.json`
- timeline: `.openprd/knowledge/candidates/candidate-turn-1780116203372-5f266a79e968c758/timeline.json`

## 关联字段

- 当前样本缺少: trace_id, span_id, request_id, task_id, user_session_id, error_id；后续关键路径应默认补齐。

## 排查顺序

- 先按时间窗口、用户会话或任务编号缩小范围，再核对 runtime-events 和 timeline。
- 围绕关键事件 run-verify -> dev-check 回看成功到失败的断点位置。
- 优先验证 root-cause-candidates 中的 Inspect src/dev-standards.js 是否与当前证据一致。
- 当前证据还缺少 trace_id, span_id, request_id, task_id, user_session_id, error_id，后续同类路径应默认补齐，避免再次为定位问题加日志。

## 常见根因

- Inspect src/dev-standards.js
- Inspect src/codex-hook-runner-template.mjs
- Inspect src/agent-integration.js
- Inspect src/loop.js
- Inspect test/openprd-quality-standards.test.js
- 本轮项目回顾

## 防复发要求

- 关键路径默认保留 runtime-events、timeline、root-cause-candidates、diagnostic-report 四类证据，而不是等故障出现后再补日志。
- 失败事件和补偿事件使用稳定事件名，避免把根因埋在自由文本里。
- 修复完成后保留一份成功与失败对照诊断包，并运行 openprd quality . --learn --from <diagnostics-dir> 更新项目经验。
- 当前样本里还缺少 trace_id, span_id, request_id, task_id, user_session_id, error_id，后续关键路径应在实现阶段补齐。

## 验证方式

- 复现一次同类路径，确认新的诊断包仍能导出 runtime-events、timeline、root-cause-candidates 和 diagnostic-report。
- 重点核对 run-verify -> dev-check 的顺序是否符合预期。
- 修复后再次执行同一路径，确认时间线不再在历史失败断点中断。
- 把最终诊断包与质量报告一起归档，确保后续 Agent 能直接复用已有排查路径。
