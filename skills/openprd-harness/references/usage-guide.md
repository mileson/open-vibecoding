# OpenPrd 使用指南

这份指南是给 **团队成员** 和 **Agent** 的 OpenPrd 实战使用说明。重点不是命令表，而是：

- 什么时候需要补充 `clarify`
- 什么时候用 `diagram` 辅助理解
- 什么时候把 `standards` 当作后台维护建议
- 什么时候按需留下 `freeze` 快照
- `status` / `next` 该怎么看
- `batch capture` 怎么用

## 一、先判断你处于哪种场景

OpenPrd 现在会区分 3 种场景：

### 1. Cold start (greenfield)

特点：

- 项目目录基本是空的
- `.openprd/` 刚初始化
- 没有现成产品上下文可复用

协同方式：

- 从用户已经表达的目标起步
- 优先选可逆的默认方案
- 只有缺失信息会实质改变用户当下要求的结果时，才需要追问

优先动作：

- 需要时用 `openprd clarify` 整理未知项，不把它当成实现门禁
- 用 `openprd capture` 写回已有事实、用户新表达的选择或 Agent 的可逆假设

### 2. Cold start (existing project)

特点：

- 项目已有 README / docs / 代码 / 现成能力
- `.openprd/` 是第一次接入

协同方式：

- 先复用现有上下文
- 可核验的当前事实可由 Agent 直接记录；不为补材料要求用户重复确认

优先动作：

- `openprd status`
- `openprd clarify`
- 用 `openprd capture --source project-derived` 导入已有事实
- 用 `openprd capture --source user-confirmed` 写回用户已经明确表达的事实
- 用 `openprd standards <path> --verify` 检查 `docs/basic/` 和说明书模板

### 3. Continuing workspace

特点：

- 已有 `.openprd/` 历史
- 已经 synthesize / freeze / handoff 过

协同方式：

- 只做增量澄清
- 不重跑全量初始化

优先动作：

- `openprd status`
- `openprd next`
- 只补变化部分
- 实现后可用 `openprd standards <path> --verify` 收集当前基础说明书的维护建议，不因历史缺失阻断当前任务

---

## 二、什么场景先 `clarify`

优先 `clarify` 的情况：

- 项目刚初始化
- 关键产品字段缺失
- 用户的目标、范围、成功标准还不清楚
- 虽然 repo 有内容，但你还不能判断“这次 OpenPrd 到底定义什么”
- 你手上只有技术上下文，产品事实来源仍不完整

### 典型信号

如果 `openprd next` 或 `openprd status` 显示：

- `Current attention: clarify-user`

那么由 Agent 标注来源、采用可逆默认方案并在后台继续 `synthesize` / `diagram`；只有真实歧义会明显改变结果时才向用户提一个最高价值问题。`freeze` 仅反映 readiness 状态，不是实现许可。

### 推荐操作

```bash
openprd clarify <path>
```

然后把用户回答写回：

```bash
openprd capture <path> --field problem.problemStatement --value "..."
openprd capture <path> --field goals.successMetrics --value "..."
```

---

## 三、什么场景先 `diagram`

优先 `diagram` 的情况：

- 需求的**系统边界**需要确认
- 依赖、模块、数据/控制流复杂
- 用户流程、决策点、失败路径复杂
- freeze 前需要一个 visual artifact 来做协同确认

### 什么时候画 architecture

适用于：

- 模块边界
- 服务依赖
- control plane / data plane 分工
- 权限、审核、可靠性边界

```bash
openprd diagram <path> --type architecture
```

### 什么时候画 product-flow

适用于：

- onboarding
- 用户操作步骤
- decision / error path
- human + agent 协作流程

```bash
openprd diagram <path> --type product-flow
```

### 什么时候用 `--input`

如果 Agent 已经基于 Skill 生成了结构化 diagram contract：

```bash
openprd diagram <path> --type product-flow --input flow-contract.json
```

这比依赖工具自己推断更稳，也更适合多 Agent 协作。

---

## 四、什么场景可以按需 `freeze`

`freeze` 是一个可选的版本快照动作，不是实现、提交或交付的前置门禁。用户当下明确要求留快照或交接，或 Agent 需要保留一个当前版本时，都可以按需执行。

- 缺少 requirement、review、diagram、tasks 或历史说明材料，只记为后台待完善信息。
- 历史需求和实现类文档保持冻结，不为了 `freeze` 反推或补写。
- 如果某个精确快照动作自身无效（例如输出目标不存在），只拒绝该动作，不扩展成工作流阻断。

### 典型信号

`openprd next` 可能显示：

- `Current stage: freeze snapshot`

并且 `Suggested command: openprd freeze .`

这表示快照是一个可选后续建议，不表示当前工作必须停在这里。

---

## 五、`status` / `next` 应该怎么看

### `openprd status`

适合回答：

- 我现在处于什么场景？
- 用户应该参与到什么程度？
- 当前有什么建议阶段？
- 接下来有什么可选参考？

重点看这 4 个字段：

- `Scenario`
- `User participation mode`
- `Current stage`
- `Upcoming stage`

例如：

- `Scenario: Cold start (existing project)`
- `User participation mode: 上下文复用、用户可选补充`
- `Current stage: clarification suggestion`
- `Upcoming stage: freeze snapshot`

这说明：

- 项目里已有上下文可以用
- Agent 可先用可逆假设继续，仅在未知项会实质改变当下结果时追问
- `freeze` 是后续参考，不影响当前实现

### `openprd next`

适合回答：

- 下一步最应该做什么？
- 为什么是这一步？
- 建议直接执行什么命令？
- 当前应该问用户哪些问题？

重点看：

- `Next action`
- `Current stage`
- `Upcoming stage`
- `Suggested command`
- `Suggested questions`

---

## 六、batch capture 怎么用

### 适用场景

Agent 一轮把用户问完之后，最好不要一条条写：

```bash
openprd capture ... --field ...
openprd capture ... --field ...
openprd capture ... --field ...
```

而是用批量模式。

### 命令

```bash
openprd capture <path> --json-file answers.json
```

### 推荐 JSON 格式

```json
{
  "problem.problemStatement": {
    "value": "移动端缺少高效的 Agent 会话与节点管理入口",
    "source": "user-confirmed"
  },
  "users.primaryUsers": {
    "value": ["运维人员", "Agent 重度用户"],
    "source": "user-confirmed"
  },
  "constraints.dependencies": {
    "value": ["Auth API", "Node service"],
    "source": "project-derived"
  }
}
```

### source 的意义

- `user-confirmed`：用户亲口确认
- `project-derived`：从项目已有材料提取
- `agent-inferred`：Agent 的推断

最佳实践：

- 产品关键字段优先写成 `user-confirmed`
- 技术现状、已有系统能力可以写成 `project-derived`
- 谨慎使用 `agent-inferred`

---

## 七、推荐的最小工作节奏

### 对新项目

```bash
openprd init <path> --template-pack agent
openprd status <path>
openprd clarify <path>
openprd capture <path> --json-file answers.json
openprd next <path>
```

### 对已有项目首次接入 OpenPrd

```bash
openprd init <path> --template-pack agent
openprd status <path>
openprd clarify <path>
openprd capture <path> --json-file derived-and-confirmed.json
openprd classify <path> agent
openprd next <path>
```

### 对继续推进中的 workspace

```bash
openprd status <path>
openprd next <path>
openprd clarify <path>
openprd capture <path> --json-file delta-answers.json
```

---

## 八、团队协作建议

### 给人类看什么

- `openprd status`
- `openprd next`
- 当前 diagram artifact
- open questions

### 给 Agent 什么输入

- repo / docs / README
- `.openprd/` 当前状态
- diagram contract
- 批量 capture 的 answers.json

### 不要做什么

- 不要把 `project-derived` 当成 `user-confirmed`
- `clarification suggestion` 只是待完善信息，不得用来阻断用户已经要求的实现或 `synthesize`
- diagram 和 review 是辅助理解与反馈的 artifact，不得用来阻断 `freeze` 或当前工作
- 不得为历史需求反推或补写实现类文档；旧功能重新开发时创建新的 current requirement/change
