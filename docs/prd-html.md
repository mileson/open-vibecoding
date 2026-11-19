# 生成 HTML PRD

需要用网页交付产品需求时，先导出 [首拍 JSON 示例](../test/fixtures/prd-camera-first-photo.json)，换成自己的需求，再生成可离线打开的 HTML。

```sh
open-vibecoding prd template --out requirements.json
open-vibecoding prd render --data requirements.json --out prd.html
```

在仓库内开发时，可用 `node ./bin/open-vibecoding.js` 运行同样的命令。命令成功后返回 JSON，其中 `out` 是文件的绝对路径。校验失败时，根据错误里的输入路径和字段位置修改数据。

自定义版式时，用 `prd template --out template.html` 复制[内置 HTML 模板](../src/prd-template.html)，在 `<title>` 中保留一处 `{{PRD_TITLE}}`，在 `<main>` 中保留一处 `{{PRD_CONTENT}}`，生成时加上 `--template template.html`。模板的样式应内嵌，以便离线阅读。

| JSON 字段 | 怎么填 |
| --- | --- |
| `product`、`title`、`goal` | 产品名、需求名，以及用户要达成的结果。`goal` 显示在引号卡片中。 |
| `revision` | 可选。填写文档 `version`、`date`（建议 `YYYY-MM-DD`）和本次修订的 `summary`。`author` 可填写修订人姓名或负责角色。 |
| `background` | 可选。说明用户遇到的问题及为什么值得做。 |
| `business` | 可选。用 `goal` 写业务结果。每条 `metrics` 填写 `name`、`definition`（人群、分子分母及去重口径）和 `window`（纳入和观察时间），可用 `confirmationRole` 标明由哪个角色确认。已确认的 `baseline`、`target` 用带单位的文本填写，待确认时可省略或填 `null`。 |
| `personas` | 可选。用稳定 `id`、`type` 和 `name` 定义与产品类型有关的用户或业务角色。`ToC` 填 `characteristics`、`goal`、`barriers`。`ToB` 填 `responsibilities`、`permissions`、`handoff`。`Agent` 填发起人、操作者或审批者等人类角色的 `responsibilities`，代理的执行范围写在场景里。 |
| `scenarios` | 可用旧的文本数组，或为结构化场景填写稳定 `id`、`personaId`、`context`（触发情境）、`task`（想完成的任务）、`outcome`（预期结果）和可选的 `title`。`Agent` 场景增加 `agentBoundary` 和 `humanHandoff`。权限状态等触发条件写入场景，只在确有角色差异时新增画像。 |
| `scope.in`、`scope.out` | 本次包含与排除的事项，各填文本数组。`out` 可省略。 |
| `flow.steps`、`flow.paths`、`flow.branches` | `steps` 填分流前的有序步骤。可选的 `paths` 为每条路径填写 `label`（进入条件）和 `steps`（操作与去向）。路径可再用一层 `choices` 表达不同去向，每个选项同样填写 `label` 和 `steps`。可选的 `branches` 是文字补充。可用 `flow.decisionLabel` 为分流节点指定业务名称。在主流程、路径或选项中用 `scenarioIds` 关联对应场景。 |
| `acceptance` | 每条包含 `scenario`（用例名）、`given`（前置条件）、`when`（操作）、`then`（可观察的结果）。`requirementIds` 和 `scenarioIds` 分别链接到对应功能和场景。 |
| `focus` | 可选对象。按场景填写 `ToC`、`ToB` 或 `Agent` 的关注点文本数组。有画像时，关注点、角色与场景按类型放在同一节，只呈现实际填写的类型。旧 JSON 中的关注点仍显示在「需求重点」。 |
| `requirements` | 可选。每条填写 `name`、`priority` 和 `behavior`。可补稳定 `id`、`precondition`、`feedback` 和关联 `scenarioIds`。需求、画像与场景编号以英文字母开头，可含字母、数字、连字符和下划线，并在各自列表中唯一。 |
| `exceptions` | 可选。每条填写 `requirementIds`（至少一个关联功能编号）、`trigger`（触发条件）、`message`（界面提示）和 `recovery`（恢复或重试的去向）。在验收附录核对相应结果。 |
| `tracking` | 可选。每条填写 `event`、`trigger` 和 `purpose`。需要分析或对比数据时，补上 `attributes`（必要属性）和 `deduplication`（事件重试及统计去重规则）。 |
| `nonFunctional` | 可选。每条填写 `area`、`requirement` 和 `verification`。 |
| `performance` | 可选，显示在非功能需求中。每条填写 `name`、`window`（测量起止及批次）、`devices`（设备范围）、`verification`（核对方式）和 `confirmationRole`。已确认的 `baseline`、`target` 用带单位的文本填写，省略或填 `null` 时显示「待定」。 |
| `openItems` | 可选。每条填写 `question`、`proposal`、`impact`、`confirmationRole`。记录仍需评审决定的问题，已决项可移除或标记为 `status: "resolved"`。旧文本数组仍可使用。 |
| `observation` | 可选文本数组。填写上线后要看的指标及口径。 |

两个命令都要求输出为新文件。已有 JSON 或 HTML 会保留，使用新路径后再运行即可。验收条件描述的是通过标准，实际验证结果由验收时记录。

已有 JSON 可继续沿用。旧的场景文本、线性流程、功能表、埋点表、待确认文本和无关联编号的验收条目仍可生成。使用关联编号时，生成器会检查对应编号是否存在且唯一。

先判断实际涉及的产品类型，再描述与需求有关的用户角色及具体场景。有业务依据时可在同一 PRD 覆盖多类型。画像不需要猜测年龄、职业比例等人口统计特征。

首拍示例中的 `capture_completed` 在照片拍摄成功且预览首次显示时上报，主流程与指标统一使用「首拍预览成功」。

## 交互设计清单

先根据功能范围和使用场景，圈定需要确认的界面、操作和状态。每个设计项使用稳定编号，可关联多条需求和多个场景，同一需求也可关联多个设计项。需求名称、场景标题和设计标题用简短的业务表达。

PRD 先行时，可在 PRD JSON 中填写 `designs` 并呈现待设计或待确认状态。设计先行时，先保存独立清单，等需求和场景编号确定后再补关联。用户确认选稿后，以原编号导入 `selected` 和本地图，也可以分批补稿。

### 最小示例

将以下内容存为 `designs.json`。关联编号取自内置首拍样例。

```json
{
  "designs": [
    {
      "id": "CAM-UI-01",
      "title": "首页拍照入口",
      "status": "pending-design",
      "description": "首次打开时，从首页进入拍照。",
      "requirementIds": ["CAM-01"],
      "scenarioIds": ["CAM-S01"]
    }
  ]
}
```

```sh
open-vibecoding prd template --out requirements.json
open-vibecoding prd design validate --design designs.json
open-vibecoding prd design merge --design designs.json --data requirements.json --out requirements-pending.json
open-vibecoding prd render --data requirements-pending.json --out prd-pending.html
```

用户确认后，在 `designs.json` 所在目录保存下方补丁为 `selected-designs.json`，并把本地 PNG 放在该目录的 `images/home.png`。也可把 `image.path` 换成实际本地图路径。

```json
{
  "designs": [
    {
      "id": "CAM-UI-01",
      "status": "selected",
      "image": { "path": "./images/home.png", "alt": "轻拍相机首页的拍照入口" }
    }
  ]
}
```

```sh
open-vibecoding prd design validate --design selected-designs.json --data requirements-pending.json
open-vibecoding prd design merge --design selected-designs.json --data requirements-pending.json --out requirements-with-design.json
open-vibecoding prd render --data requirements-with-design.json --out prd-with-design.html
```

`status` 取 `pending-design`（待设计）、`pending-review`（待确认）或 `selected`（已确认导入）。前两种可省略图片。提供图片时填写本地 PNG、JPEG 或 WebP 路径及 `alt`，`selected` 必须有图。相对图片路径以包含该路径的 JSON 文件所在目录为准，渲染时把图片内嵌进 HTML。

独立校验适合设计先行，检查清单结构和本地图。提供 `--data` 时，先在内存里合并，再校验需求和场景编号。命令返回每项的 `id`、`title`、`status`、关联编号和 `hasImage`，`referencesChecked` 表示是否已根据 PRD 校验关联。

合并按设计编号更新，保留未提供的字段和其他设计项。已有设计项可只提供 `id` 及要更新的字段。显式传空数组可清除关联，传 `image: null` 可清除图片，此时状态应为待设计或待确认。合并输出为新文件，图片的相对路径会随输出目录调整。读取不到文件、图片类型与扩展名不一致，或已选稿缺图时，命令会指出对应字段。

HTML 的「交互设计」出现在主流程与功能需求之间。画面放在卡片顶部，以等高缩略图排列，每行最多三张。点击右上角图标可放大或收起。画面下的「关联需求」和「对应场景」各占一行，链接显示需求名称与场景短标题。功能需求也可用设计标题跳回画面。

确认导入的设计项呈现画面、标题、说明和关联，省略「已选稿」字样。待设计与待确认项显示相应状态，未配图时以文字呈现。没有设计项时，目录和正文均省略这一节。

多角色项目按需补充权限矩阵，字段较多时附数据字典，跨系统时补充接入说明，分期交付时补充里程碑。可随 PRD 附上对应文档。首拍示例只填写与当前需求有关的章节。

内容结构参考 [pm-prd-writer 的 PRD 模板](https://github.com/SpaceZephyr/pm-skills/blob/main/pm-prd-writer/references/prd-template.md)，按实际需求填入适用章节。
