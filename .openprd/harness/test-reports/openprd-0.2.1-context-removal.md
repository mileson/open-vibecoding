# OpenPrd 0.2.1 上下文逻辑移除测试报告

- 日期：2026-07-20
- 范围：CLI、Hook、manifest 迁移、三端生成文件、fleet 升级、发布包
- 结果：通过

## 自动化验证

| 验证项 | 结果 | 证据 |
| --- | --- | --- |
| 完整测试套件 | 通过 | `npm test`：281 tests，280 passed，1 skipped，0 failed |
| 普通性能 | 通过 | `npm run test:perf`：p95 1.16 ms，峰值堆内存 13.76 MB |
| 极端性能 | 通过 | `npm run test:perf:extreme`：p95 28.47 ms，峰值堆内存 56.43 MB |
| 发布包预检 | 通过 | `npm pack --dry-run --json`：`@openprd/cli@0.2.1`，332 entries |
| 负向回归 | 通过 | CLI 不暴露 `--context` / `--hook-inject`；UserPromptSubmit 不返回 additionalContext；生成 Hook 不含 ContextCapsule 渲染器 |
| 兼容迁移 | 通过 | 旧 manifest 的 `contextCapsule` 格式声明在 update 时被清理 |
| 发布门禁 | 通过 | standards、quality、run verify、doctor 全部通过；质量报告 `productionReady=true`，11 项门禁均为 pass |

## 保留能力

- `openprd run . --verify` 和 `--record-hook`
- standards、quality、doctor、dev-check
- PreToolUse 安全边界与 Stop 证据提醒
- PRD、change、tasks、loop 和 repo-local canvas binding

## 发布判断

本轮实现、回归测试与发布门禁全部通过；代码提交后执行 npm/GitHub 发布与线上回读。
