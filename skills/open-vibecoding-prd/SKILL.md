---
name: open-vibecoding-prd
description: 用户明确请求编写或更新 PRD 时，按实际产品类型梳理目标角色、场景、功能、异常恢复和验收。需要 HTML 时，用内置 prd CLI 从 JSON 生成离线文档。
---

# 按需编写 PRD

用户明确要求交付或更新 PRD 时使用。普通研发任务由 `$open-vibecoding-requirement-intake` 判断改动范围与验证成本。沿用用户指定的交付格式，HTML 可用下方命令生成。

## 从目标和场景推导需求

1. 先核对业务输入、已有流程、用户反馈与决策。分别写清用户希望完成的事、业务目标、本次范围和排除项。把事实、提议和待确认内容分别表述。
2. 按实际涉及的产品类型组织「用户或角色 → 场景 → 流程与需求 → 验收」。有依据时可同时写多种类型。每个画像记录和功能有关的特征与职责。每个场景关联一个画像，写触发情境、任务和预期结果。权限状态等条件放进场景，人口统计信息仅在有证据且与需求有关时使用。
   - **ToC** 用用户特征、目标和阻碍说明为什么需要该流程。
   - **ToB** 写业务角色、职责、权限和协作交接。
   - **Agent** 写发起人、操作者或审批者等人类角色。把代理作为流程的执行主体，写清其可处理的范围、授权边界和人工接手条件。
3. 从场景写出主流程、分支和去向。为功能分配稳定编号，记录前置条件、行为和用户可见反馈。异常条目关联功能编号，写触发条件、提示、恢复或重试去向。逐条给出可观察的验收结果，关联相应功能与场景。验收条目描述通过条件，执行结果以实际验证为准。
4. 有衡量需求时写指标的人群、计算和去重口径、观察窗口与确认角色。埋点写触发时机、必要属性和去重规则，与流程和指标采用同一口径。性能写测量起止、设备、核对方式和确认角色。未经实测的基线与目标标为「待定」。按实际需要记录非功能需求和版本、日期、修订人或角色。仅把尚需评审决定的问题写入待确认项，并说明建议、影响和确认角色。

## 从需求推导交互设计

从功能范围和使用场景逐条找出需要确认的界面、关键操作和状态。优先覆盖会影响用户下一步的入口、权限、处理中、完成、失败和恢复。相同画面可关联多条需求和场景，只有同一画面确实无法表达的差异才拆成新的设计项。

- **PRD 先行**：在 `designs` 中为每个设计项分配稳定 `id`，填写 `title`、`requirementIds`、`scenarioIds`，将未出稿的项标为 `pending-design`，待选择的项标为 `pending-review`。
- **设计先行**：先整理同结构的独立清单。需求或场景编号尚无依据时可以省略关联，PRD 编号确定后补齐，再带 PRD 校验链接。
- **分批补稿**：用户确认选稿后，用同一 `id` 更新 `status: "selected"` 和 `image: { "path": "本地图片路径", "alt": "画面描述" }`。以最新 PRD JSON 为合并输入，CLI 按编号写入新副本，保留其他设计项和未提供的字段。未确认的项仍标为待设计或待确认。

```sh
open-vibecoding prd design validate --design designs.json
open-vibecoding prd design validate --design designs.json --data requirements.json
open-vibecoding prd design merge --design designs.json --data requirements.json --out requirements-with-design.json
open-vibecoding prd render --data requirements-with-design.json --out prd-with-design.html
```

画面使用本地 PNG、JPEG 或 WebP，渲染时离线内嵌。需求、场景和设计项使用简短的业务名称，JSON 用稳定编号关联。读回 HTML 时，核对「交互设计」在主流程和功能需求之间，卡片顶部为等高缩略图，每行最多三张，右上角图标可放大或收起。「关联需求」和「对应场景」分别成行，用名称跳到目标条目。也要从功能需求按设计标题跳回画面。确认稿卡片展示画面和说明，状态标记用于仍待设计或待确认的条目。

## 交付 HTML 时

```sh
open-vibecoding prd template --out requirements.json
open-vibecoding prd render --data requirements.json --out prd.html
```

导出的首拍 JSON 用于查看字段结构，填写时替换为当前需求。用 `focus` 记录实际类型的关注点，用 `personas` 中的 `id`、`type`、`name` 定义角色。ToC 角色填 `characteristics`、`goal`、`barriers`，ToB 角色填 `responsibilities`、`permissions`、`handoff`，Agent 的人类角色填 `responsibilities`。

`scenarios` 中的结构化条目填 `id`、`personaId`、`context`、`task`、`outcome`，可加 `title`。Agent 场景补 `agentBoundary` 和 `humanHandoff`。用 `scenarioIds` 关联流程、功能和验收，用 `requirementIds` 关联验收与异常。已有文本场景仍可渲染。

CLI 校验字段和引用并使用内置模板渲染。根据报错回到对应字段修正，总结交付时提供 JSON 和 HTML，并说明真实待决项或验证缺口。交付前按 `$open-vibecoding-public-content-boundary` 读回产物，检查场景和编号链接、异常去向、指标口径及可见文案。
