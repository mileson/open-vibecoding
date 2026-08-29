# `openprd.media-evidence.v1` 证据包合同

[media-evidence.schema.json](media-evidence.schema.json) 是字段、状态条件和完成条件的唯一规范源。本文只解释填法，不另行放宽 Schema。证据包建议放在当前任务 evidence 目录，并由 task metadata 的 `evidence` 指向它。

## 核心原则

- 字段缺失与数值为零含义不同。无法取得的数据写 `null`，并在 `unknownClaims` 解释。
- `source.sha256` 和 `finalOutput.sha256` 标识实际被测文件；若摘要不可得，不能声称来源与最终审查对象已锁定。
- `measurementPolicy` 记录工具、版本、参数摘要、选轨、时间基准和窗口策略。比较完成态要求 `finalRemeasured=true` 与 `sameSettings=true`；口径变化时用新口径重跑基线，无法重跑则不能标为完成。
- `baseline.measurements`、`finalOutput.measurements` 和 `comparison.metricDeltas` 只放当前声明需要的指标。
- `evidenceArtifacts` 是可核验的证据索引：每个条目必须有稳定 `id`、项目相对路径、实际文件 SHA-256 与角色。`claimResults.evidenceRefs`、`hypotheses.evidenceRefs`、`rawEvidence`、人工审听引用和 HTML 审查引用都只填写这里声明的 `id`；Quality 会拒绝不存在的文件、悬空引用和摘要不匹配。
- `claimResults` 必须覆盖 `claimScopes` 中的每项声明。包级完成态取最弱声明；`comparison-complete` 不允许以 `unknown` 或空占位结果掩盖未完成的声明。
- 假设必须记录 `rollbackPlan`；最终输出要重新记录容器、音轨、编解码器、采样率、声道、timebase 与提取方法，不能只放一个结果摘要。
- `manualReview` 记录统一试听增益、播放环境、审查量表、接受规则和片段结论；项目阈值仍由项目层定义。
- `transcription.timingEvaluation` 记录人工或参考时间标注来源以及 start/end 的 p50/p95/max；`renderedSubtitles` 区分烧录、字幕流和外挂字幕的最终取证方法。
- `rawEvidence` 保存测量文件、字幕、日志或人工标注对应的 `evidenceArtifacts[].id`；音频/视频二进制本身由路径和摘要引用，不内嵌进 JSON。
- `comparison-complete` 不允许 `metricDeltas[].assessment=regression`，且 `comparison.regressions` 必须为空；发现回归时应保留真实结果并把包降为未完成状态，而不是继续宣称通过。
- 通用任务 `waiver-reason` 不能跳过媒体证据。只有全部声明均确实不适用时，才在结构化包中使用 `waived`；缺样本、缺运行环境或暂时无法测量都写 `blocked`。
- `baselineHtml` / `comparisonHtml` 是审查入口，不是替代测量的通过标志。

## 最小示例

```json
{
  "schema": "openprd.media-evidence.v1",
  "status": "comparison-complete",
  "task": { "id": "audio-001", "title": "修复导出音轨静音断点" },
  "claimScopes": ["audio-edit", "mix-export"],
  "claimResults": [
    { "scope": "audio-edit", "status": "pass", "evidenceRefs": ["final-measurement"], "remainingRisk": null },
    { "scope": "mix-export", "status": "pass", "evidenceRefs": ["final-measurement"], "remainingRisk": null }
  ],
  "evidenceArtifacts": [
    { "id": "baseline-measurement", "path": ".openprd/quality/evidence/audio-001-baseline.json", "sha256": "<sha256>", "role": "baseline-measurement" },
    { "id": "final-measurement", "path": ".openprd/quality/evidence/audio-001-final.json", "sha256": "<sha256>", "role": "final-measurement" },
    { "id": "baseline-review", "path": ".openprd/quality/evidence/audio-001-baseline.html", "sha256": "<sha256>", "role": "review-html" },
    { "id": "comparison-review", "path": ".openprd/quality/evidence/audio-001-comparison.html", "sha256": "<sha256>", "role": "review-html" }
  ],
  "source": {
    "path": "fixtures/source.mov",
    "sha256": "<sha256>",
    "provenance": "用户提供的复现素材",
    "durationSeconds": 42.8,
    "trackIndex": 1,
    "codec": "aac",
    "sampleRateHz": 48000,
    "channels": 2,
    "privacy": { "containsPersonalData": true, "reportRedacted": true }
  },
  "measurementPolicy": {
    "tools": [{ "name": "media inspector", "version": "1.2", "configDigest": "<sha256>" }],
    "timebase": "seconds from final container start",
    "windowPolicy": "问题片段前后各保留 1 秒",
    "finalRemeasured": true,
    "sameSettings": true
  },
  "baseline": {
    "measurements": [{ "id": "silence-duration", "value": 0.82, "unit": "s", "method": "final-container silence interval detector", "startSeconds": 12.1, "endSeconds": 12.92 }],
    "rawEvidence": ["baseline-measurement"]
  },
  "hypotheses": [{ "id": "H1", "claim": "切点时间映射丢失导致空洞", "evidenceRefs": ["baseline-measurement"], "alternatives": ["源素材本身静音"], "predictedEffect": "目标断点消失且相邻语音不被截断", "rollbackPlan": "恢复修改前时间映射实现并重新导出" }],
  "finalOutput": {
    "path": "artifacts/final.mov",
    "sha256": "<sha256>",
    "mediaStructure": { "container": "mov", "durationSeconds": 42.8, "trackIndex": 1, "codec": "aac", "sampleRateHz": 48000, "channels": 2, "timebase": "seconds from final container start" },
    "extraction": { "method": "从最终容器重新提取目标音轨", "cacheReused": false },
    "measurements": [{ "id": "silence-duration", "value": 0.0, "unit": "s", "method": "final-container silence interval detector", "startSeconds": 12.1, "endSeconds": 12.92 }],
    "rawEvidence": ["final-measurement"]
  },
  "comparison": {
    "metricDeltas": [{ "id": "silence-duration", "baseline": 0.82, "final": 0.0, "unit": "s", "assessment": "expected-improvement" }],
    "regressions": []
  },
  "artifacts": { "baselineHtml": "baseline-review", "comparisonHtml": "comparison-review" },
  "unknownClaims": []
}
```

实际项目不应照抄示例阈值、工具名或路径；它们只是结构示意。
