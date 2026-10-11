# 产品流程说明

## 核心流程

用户目标进入后，Agent 按场景组合能力，自主实现并验证；不进入固定 PRD 状态机。

## 用户路径

1. 用户直接描述目标，可能是调研、诊断、设计、实现、验证或工具增强。
2. Agent 从当前对话、代码、现有设计与必要外部证据理解用户要完成的工作。`open-vibecoding-router` 按意图选择一个或多个独立场景 Skill，不用固定关键词匹配，也不要求五域全部经过。
3. 需要定位问题时做产品诊断；需要新证据时做用户调研或竞品分析；需要选择界面方案时做交互与视觉方向评审。目标已明确时可直接实现。
4. Agent 自主拆解复杂任务并执行。CLI 提供能力目录、设计/视觉、运行态、质量及验证等精确动作，不接管 Agent 的规划。
5. 根据触达面和风险执行最小足够验证。交付时准确说明结果、证据与未验证项；只有真正需要时保留参考图、对比板或其他难以重建的证据。

这是一条可往返的判断路径，不是固定阶段状态机。简单代码修改可以直接进入第 4 步；用户只要求评审时停留在只读分析。

## CLI 与历史兼容

`open-vibecoding capabilities list|get|contract` 供 Agent 发现领域、场景和交接字段。可选的项目根目录 `open-vibecoding.capabilities.json` 增量注册场景，读取时校验对应 repo-local Skill，不执行扩展代码。`init/setup/update` 安装必要的客户端引导；`doctor` 检查集成；`run --verify` 汇总工作区就绪信息；`visual-prepare` 和 `visual-compare` 处理设计证据。完整命令见 `open-vibecoding --help`。

新工作区不创建 PRD 草稿、change、任务图或旧版版本状态。历史工作区已有的 PRD、change、spec、tasks 可通过 `history`、`diff`、`changes`、`specs`、`tasks` 只读查看；生成、应用、归档和任务推进入口已移除。`openprd` 命令和 `.open-vibecoding/` 路径暂作兼容标识。

## 验证边界

`run --verify` 不把历史 active change 或 task 当本次任务的完成条件。项目级标准缺口作为 `workspaceAttention` 呈现；是否完成当前任务取决于 Agent 的实际任务级验证。源码、Skill 或客户端适配改动应运行对应测试，并在需要时做 `standards --verify` 和 `doctor` 检查。外部动作的真实权限、安全和用户选择仍由宿主与当前上下文判断。

## 状态变化

工具仅记录运行和验证证据；Agent 的任务状态不由旧 `current.json`、PRD 版本或 active change 推进。历史文件保持原状态，新的产品和实现判断在当前任务中完成。

## 维护规则

新增场景时先更新能力目录与对应 Skill，再补 CLI 精确动作和测试。若修改真实用户路径，同步更新本文；不得重新引入自动 PRD/change/tasks 产物。
