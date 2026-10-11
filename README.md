# Open VibeCoding

简体中文 | [English](./README_EN.md)

Open VibeCoding 为 Agent 提供产品、交互设计、研发、测试与 Vibe Coding 增强能力。用户直接描述目标；Agent 根据代码、会话与必要证据判断该用哪些能力。它不要求固定的起手命令，也不把五个领域排成必须依次完成的流程。

## 能力结构

| 领域 | 主要用途 |
| --- | --- |
| 产品 | 用户问题、竞品与需求诊断；按需调研和输出产品材料 |
| 交互设计 | 信息架构、路径、状态、视觉方向与实现对比 |
| 研发 | Agent 自主拆解和实现；CLI 提供确定性工具与运行态支持 |
| 测试 | 按风险选取最小足够验证，保留真正需要的证据 |
| Vibe Coding 增强 | Skill 路由、客户端适配、画布、参考源与经验复用 |
| 最佳实践（横向板块） | 根据项目条件选择成熟现代方案；首个独立主题为 iOS String Catalog 多语言 |

每个场景是独立子能力，统筹层按用户意图组合它们，不靠固定关键词匹配。小任务可以只用一项；复杂任务可在领域之间往返。`skills/open-vibecoding-router/SKILL.md` 是 Agent 的入口，`open-vibecoding capabilities list|get|contract` 提供机器可读的能力目录。项目可用 `open-vibecoding.capabilities.json` 和对应的 repo-local Skill 增量扩展。

## 工作原则

- Agent 保留自己的思考、计划与执行方式；工具只提醒关键判断、提供可组合的确定性动作。
- 不自动生成 requirement、PRD、review、change 或 tasks，也不在后台为留痕补写它们。复杂任务可以由 Agent 自主拆解并逐项完成。
- 代码是默认的实现说明；用户要求的产品文档、审查页面和设计稿仍可作为真正的交付物制作。
- 视觉参照及实现对比、风险验证结果、外部动作读回等无法从代码可靠重建的证据按需保留。
- 已有 `.open-vibecoding/` 历史 PRD、change、spec 和 tasks 保持只读，不迁移、回填或改写。

## 本地使用

```bash
open-vibecoding init .
open-vibecoding capabilities list
open-vibecoding doctor .
open-vibecoding run . --verify
```

可执行命令统一为 `open-vibecoding`，工作区路径为 `.open-vibecoding/`，场景 Skill 使用 `open-vibecoding-*`。不再安装旧名称入口。未安装全局命令时，可使用项目 `AGENTS.md` 中的本地 Node CLI 入口。旧版生成与推进命令已移除；已有历史记录可单独归档，不作为新版初始化输入。具体子命令以 `open-vibecoding --help` 为准。

架构与兼容边界见 [Open VibeCoding 架构](./docs/basic/open-vibecoding-architecture.md)，开发验证见 [应用流程](./docs/basic/app-flow.md) 和 [后端结构](./docs/basic/backend-structure.md)。
