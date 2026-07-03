---
name: openprd-experience-diagnostic-candidate-eval-20260612183730
description: Use when the current task overlaps this draft project experience and you should verify fit before reusing it.
use_when: Use when the current task overlaps this draft project experience and you should verify fit before reusing it.
---

# openprd-experience-diagnostic-candidate-eval-20260612183730

> 状态：draft
> 候选目录：`.openprd/knowledge/candidates/candidate-eval-20260612183730`
> Promote：`openprd quality . --learn --from .openprd/knowledge/candidates/candidate-eval-20260612183730`

## 触发条件

- 本轮结果里已经出现可复用的症状、排查线索或根因模式，不应该只留在当前对话里。
- 这次改动直接影响 Agent / harness / hook / skill 行为，后续很容易再次踩到同类判断问题。
- 这次修复已经带有验证或收尾证据，适合尽快抽象成项目级研发经验。
- dev-check
- doctor-green
- run-verify
- quality-verify
- 只回复 ok

## 适用范围

- 抽象模式: 同类故障通常会先在 runtime-events、timeline、root-cause-candidates 和 diagnostic-report 中留下证据。只要实现阶段就把这些结构化诊断面铺好，后续多数问题都能先靠现有证据定位，而不是临时补日志。
- 适用于项目源码或核心流程已经落地、需要把实现经验固化为项目知识的任务。
- 适用于本轮补过验证或测试夹具，后续同类需求需要同步复用验证方式的任务。
- 特别适用于 Agent、hook、harness、quality 或 growth 工作流改动，避免下次再次靠聊天上下文兜底。

## 典型输入

- 任务场景: dev-check
- 相关文件: src/visual-compare.js、src/quality-visual-review.js、src/quality.js、src/codex-hook-runner-template.mjs、src/agent-integration.js、test/openprd-agent-integration.test.js
- 已有证据类型: diagnostic-report
- 验证信号: dev-check、quality-verify

## 典型输出

- 项目经验候选与诊断包
- 待确认的项目经验草案
- 验证结论: dev-check attention=2, warning=5
- 可复用的验证链路与收尾动作

## 下次触发时先看什么

- `src/visual-compare.js`
- `src/quality-visual-review.js`
- `src/quality.js`
- `src/codex-hook-runner-template.mjs`
- `src/agent-integration.js`
- `test/openprd-agent-integration.test.js`
- `test/openprd-quality-standards.test.js`
- `test/requirement-gate.test.js`
- `.openprd/harness/turn-state.json`

## 不要直接套用

- 如果只是文件名、路径或个别词相似，但当前目标和验证方式不同，不要直接套用。
- 如果当前问题没有出现相似症状、事件或证据入口，不要因为改到相似模块就直接照搬旧结论。
- 如果本轮已经有更新的现场证据，先核对新证据，再决定是否复用旧经验。

## 可复用模式

- 先按本轮诊断线索复走一次，再补最小必要证据。

## 验证方式

- dev-check attention=2, warning=5
- quality production-ready
- 复现一次同类路径，确认新的诊断包仍能导出 runtime-events、timeline、root-cause-candidates 和 diagnostic-report。
- 重点核对 dev-check -> doctor-green -> run-verify 的顺序是否符合预期。
- 修复后再次执行同一路径，确认时间线不再在历史失败断点中断。
- 把最终诊断包与质量报告一起归档，确保后续 Agent 能直接复用已有排查路径。
