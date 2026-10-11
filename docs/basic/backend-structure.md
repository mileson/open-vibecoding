# 后端架构设计

## 适用范围

本文描述当前 CLI、场景能力和只读历史兼容模块，不把旧 PRD 状态机列为现行架构。

## 入口与目录

`bin/open-vibecoding.js` 是正式 CLI，`bin/open-vibecoding.js` 是兼容入口；两者进入 `src/open-vibecoding.js`。`src/cli/args.js` 解析命令与参数，`src/cli/print.js` 汇总终端输出。`src/capability-catalog.js` 声明五个执行域、横向最佳实践、独立场景合同和只读项目扩展清单加载；`skills/open-vibecoding-router/SKILL.md` 引导 Agent 按意图与证据选用能力，不使用固定关键词匹配。

## 服务边界

CLI 只提供确定性工具和非阻断检查；Agent 负责理解目标、拆解和执行。适配层负责将同一 Skill 合同投送到 Codex、Claude 与 Cursor。

## CLI 接入面

正式入口为 `open-vibecoding`；`openprd` 是兼容别名。现行命令以 `--help` 与生成的 command catalog 为准，历史 `history/diff/changes/specs/tasks` 只读。

## API 接入面

本包的主要接入面是本地 CLI 与 JavaScript 模块，不对外声明独立 HTTP API。画布的本地服务只用于当前会话内的可视协作。

## 主要模块

| 模块 | 职责 |
| --- | --- |
| `src/workspace-core.js` | 工作区初始化、读取、结构验证与现行配置 |
| `src/agent-integration.js`、`src/agent-canonical-content.js` | Codex、Claude、Cursor 的 Skill、命令与 hook 引导生成 |
| `src/benchmark.js`、`src/brainstorm.js` | 参考源治理与按需产品探索 |
| `src/design-starter.js`、`src/visual-prepare.js`、`src/visual-compare.js` | 设计起步、参考图预处理及实现对比 |
| `src/design-review.js` | 原图按字节保存、编号拼图、递增评审版本与用户明确选定的 final；资产存放项目根目录 `design/`，不增加用户入口或流程文档 |
| `src/icon-cutout.js` | 复用 sharp 的本地图标 alpha 保留、指定色键去除和像素检查；`icon-cutout --source --out [--key-color --tolerance --feather]` 返回 JSON，保护源文件和已有输出 |
| `src/run-harness.js`、`src/dev-standards.js`、`src/quality.js` | 验证摘要、源码标准与专项质量诊断 |
| `src/runtime/`、`src/kernel/` | 可选任务运行态、幂等记录与并发控制 |
| `src/canvas-workspace.js`、`src/learning-review.js`、`src/knowledge.js` | 画布、学习包与知识复用 |
| `src/legacy-history.js`、`src/openspec/` | 既有 PRD/change/spec/tasks 的只读兼容与验证 |

## 数据与迁移边界

`.open-vibecoding/` 保持兼容数据路径，但新初始化不生成旧版 PRD 草稿、change、task-graph 或版本快照。`src/prd-core.js` 仅保留历史版本号和快照差异计算；不存在 PRD 拼装、渲染或合成路径。旧资料保持原位，`fleet` 更新不回填、搬移或重写历史正文。

CLI 的旧版生成、应用、归档与任务推进参数返回 `removed-workflow`；历史查询命令只读取已有文件。当前任务的规划、分解和完成状态属于 Agent，不由 `.open-vibecoding/` 的旧状态机替代。

## 数据流

用户目标 → Agent 场景判断 → Skill/CLI 能力选择 → 实现或分析 → 按风险验证 → 向用户交付。只有确需保留的设计参考、验证结果或外部动作证据才写入工作区；历史资料不参与当前状态推进。

## 维护规则

修改命令时同步更新参数解析、能力目录、生成引导与测试。历史读取模块不得加入写入或回填路径；新功能不得依赖 PRD/change/tasks 的生成作为前置条件。
