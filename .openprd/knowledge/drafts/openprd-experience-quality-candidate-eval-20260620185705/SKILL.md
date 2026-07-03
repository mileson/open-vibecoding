---
name: openprd-experience-quality-candidate-eval-20260620185705
description: Use when the current task overlaps this draft project experience and you should verify fit before reusing it.
use_when: Use when the current task overlaps this draft project experience and you should verify fit before reusing it.
---

# openprd-experience-quality-candidate-eval-20260620185705

> 状态：draft
> 候选目录：`.openprd/knowledge/candidates/candidate-eval-20260620185705`
> Promote：`openprd quality . --learn --from .openprd/knowledge/candidates/candidate-eval-20260620185705`

## 触发条件

- doctor-green: doctor passed
- dev-check: dev-check attention=0, warning=1 | touched: src/canvas-app.html.js, src/canvas-i18n.js, test/openprd-canvas.test.js
- dev-check: dev-check attention=1, warning=0 | touched: src/canvas-app.html.js, test/openprd-canvas.test.js
- dev-check: dev-check attention=2, warning=2 | touched: src/canvas-app.html.js, src/canvas-workspace.js, src/cli/args.js, src/cli/canvas-print.js, src/openprd.js, src/agent-integration.js
- dev-check: dev-check attention=2, warning=0 | touched: src/canvas-app.html.js, src/canvas-i18n.js, src/canvas-workspace.js, test/openprd-canvas.test.js
- dev-check: dev-check attention=3, warning=1 | touched: src/canvas-workspace.js, src/canvas-app.html.js, src/canvas-i18n.js, src/agent-integration.js, test/openprd-canvas.test.js, test/openprd-agent-integration.test.js
- dev-check: dev-check attention=2, warning=0 | touched: src/canvas-app.html.js, src/canvas-workspace.js, src/canvas-i18n.js, test/openprd-canvas.test.js
- dev-check: dev-check attention=2, warning=2 | touched: src/canvas-workspace.js, src/canvas-app.html.js, src/cli/canvas-print.js, src/cli/args.js, src/cli/print.js, src/openprd.js

## 适用范围

- 抽象模式: 质量缺口反复出现，通常是因为可观测性、护栏、测试与复盘知识被分散维护，没有进入同一套项目级诊断闭环。
- 适用于项目源码或核心流程已经落地、需要把实现经验固化为项目知识的任务。
- 适用于本轮补过验证或测试夹具，后续同类需求需要同步复用验证方式的任务。

## 典型输入

- 任务场景: 质量门禁收口
- 相关文件: src/canvas-app.html.js、src/canvas-i18n.js、test/openprd-canvas.test.js
- 已有证据类型: quality-report
- 验证信号: doctor-green、dev-check

## 典型输出

- 项目经验候选与诊断包
- 待确认的项目经验草案
- 验证结论: doctor passed
- 可复用的验证链路与收尾动作

## 下次触发时先看什么

- `src/canvas-app.html.js`
- `src/canvas-i18n.js`
- `test/openprd-canvas.test.js`
- `.openprd/quality/reports/eval-20260620185705.json`

## 不要直接套用

- 如果只是文件名、路径或个别词相似，但当前目标和验证方式不同，不要直接套用。
- 如果当前任务还没进入验证或收尾阶段，不要把这条经验当成通用实现模板。
- 如果本轮已经有更新的现场证据，先核对新证据，再决定是否复用旧经验。

## 可复用模式

- 先按本轮诊断线索复走一次，再补最小必要证据。

## 验证方式

- doctor passed
- dev-check attention=0, warning=1
- dev-check attention=1, warning=0
- dev-check attention=2, warning=2
- dev-check attention=2, warning=0
- dev-check attention=3, warning=1
- 运行 openprd quality . --verify 并确认需要关注的门禁已经闭环。
- 打开 HTML 报告，核对证据链、评估结论和后续动作是否一致。
