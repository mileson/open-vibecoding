# 产品数据分析报告

`funnel-report` 生成可离线打开的产品数据报告。报告先展示总结，再显示关键指标和所选明细。流程分析沿用纵向漏斗，也可按业务问题加入趋势、分组对照和同期群留存。

```sh
open-vibecoding funnel-report template --out funnel-template.html
open-vibecoding funnel-report render --data funnel.json --out funnel.html
```

`render` 默认使用内置模板，以下样式直接生效。仅在需要自定义版式时，通过 `--template funnel-template.html` 指定副本，并保留一次 `{{FUNNEL_TITLE}}` 和一次 `{{FUNNEL_CONTENT}}`。命令只会刷新自己生成的 HTML。成功时在 stdout 输出文件路径及顶层漏斗的分组数和步骤数，传入 `cards` 时还会返回卡片数。校验失败时在 stderr 输出错误，退出码为 1。

## 默认呈现

- 先展示业务总结，再显示关键指标和必要明细。需要提醒时，在 `summary` 里写一句，页面不单列「下一步验证」。
- 填写 `dateRange.start` 与 `dateRange.end` 时，页首右侧仅显示日期。跨年会显示年份，同日只显示一次。统计口径可放在 `context` 或卡片 `note`。
- 纵向漏斗步骤表的已知到达人数用模板蓝，流失人数和流失率注释保持中性色。
- 趋势坐标取自 `dates`、`series[].values` 与 `unit`。保留横向网格和底轴，左侧不画竖线。实线下带同色半透明渐变。已知点之间的缺失区间用虚线，虚线下不填色，明细表显示「—」。
- 前五条趋势线按序列顺序使用粉红、蓝、炭黑、紫、金黄。平台色可作设计参考，图例名称不参与配色。

## 组合分析卡片

在现有 JSON 增加可选的 `cards` 数组。使用卡片时填写业务 `summary`，可选 `metrics` 仍紧跟总结，明细卡按 `cards` 顺序排列。已有顶层 `steps` 与 `groups` 仍可用，可与新卡片同页；也可以把漏斗放进 `cards`。命令保持不变。

```json
{
  "product": "轻拍相机",
  "title": "新用户首拍与留存",
  "scope": "新安装用户 · 北京时间 · 按用户去重",
  "dateRange": {"start": "2026-09-27", "end": "2026-10-01"},
  "summary": "新版首拍完成率高于旧版。9 月 28 日批次第 7 日留存仍未成熟，待窗口结束后再核对。",
  "metrics": [{"label": "新版进入人数", "value": "400 人"}],
  "cards": [
    {
      "type": "funnel",
      "title": "首拍流程",
      "steps": ["打开 App", "首拍预览成功"],
      "groups": [{"label": "新版", "counts": [400, 210]}]
    },
    {
      "type": "trend",
      "title": "每日首拍成功率",
      "unit": "%",
      "dates": ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"],
      "series": [
        {"label": "旧版", "values": [40.1, 40.6, 39.8, 40]},
        {"label": "新版", "values": [51.1, null, 52.1, 52.5]}
      ]
    },
    {
      "type": "comparison",
      "title": "分版本对照",
      "dimension": "版本",
      "columns": [{"label": "首拍成功率", "unit": "%"}, {"label": "进入人数", "unit": "人"}],
      "groups": [{"label": "旧版", "values": [40, 360]}, {"label": "新版", "values": [52.5, 400]}]
    },
    {
      "type": "cohort",
      "title": "按首次打开日期的留存",
      "asOf": "2026-10-01",
      "days": [1, 7],
      "cohorts": [{"date": "2026-09-28", "size": 100, "retained": [45, null]}]
    }
  ]
}
```

- 卡片填写 `type` 和 `title`，可加 `note` 说明分析口径。只添加本次问题需要的卡片。
- **流程漏斗** `funnel` 沿用 `steps`、`groups[].label` 和 `groups[].counts`。若这一组已单独放入卡片，可省略顶层的同组漏斗。
- **趋势** `trend` 的 `dates` 用递增且不重复的 `YYYY-MM-DD`。每条序列用 `label` 和对应日期的 `values`。数值用有限数字，缺失填 `null`。跨年显示完整日期，百分比填百分数，例如 52.5 表示 52.5%。
- **分组对照** `comparison` 的 `dimension` 写版本、渠道或平台等分组维度。每列需有 `label`，可填 `unit`。每组用 `label` 与按列排列的 `values`，缺失填 `null`。
- **同期群留存** `cohort` 的 `asOf` 是同一统计时区的最后完整数据日，`days` 是递增的观察天数。每批用 `date`、去重人数 `size`、按天数排列的留存人数 `retained`。观察日超出 `asOf` 时仅接受 `null` 并显示「未成熟」。成熟但缺失或分母为 0 显示「—」。

## 纵向漏斗和纯指标卡

```json
{
  "product": "轻拍相机",
  "title": "首次拍照漏斗",
  "scope": "新用户首日 · 按用户去重",
  "context": "按版本比较同一首日观察窗口",
  "steps": ["打开 App", "打开相机", "首拍预览成功"],
  "groups": [
    {"label": "旧版", "counts": [360, 216, 144]},
    {"label": "新版", "counts": [400, 280, 210]}
  ],
  "summary": "打开 App 到打开相机的流失人数最多，可先核对入口曝光、点击和权限拒绝。"
}
```

- `product`、`title`、`scope` 必填。流程报告还需要 `steps` 和 `groups`。可用 `summary` 填写结合业务口径核实的总结，省略时按人数自动定位流失。可用与口碑报告相同的内嵌 `productIcon`、`timezone` 和 `asOf`（`YYYY-MM-DD`）完善页首。统计范围写在 `scope`，用 `context` 说明来源或口径。已有确切报告日期时，提供 `dateRange: { "start": "2026-11-11", "end": "2026-11-17" }`，页首右侧只展示日期，跨年时包含年份。要提醒下一步核对什么，在 `summary` 中用一句话说明。旧漏斗输入只有 `nextSteps` 时，其文字放进总结。
- 每组人数依次对应各步骤。可用非负整数或 `null`，已知人数不得随步骤增加。未知人数显示为「—」。
- 流失人数为相邻两步之差。流失率以到达上一步的人数为分母。相邻人数缺失时显示未知，分母为 0 时流失率显示「—」。
- 主要流失环节按流失人数判断。存在缺失时，只在可计算的环节中比较。各组每一步的漏斗宽度以本组第一步到达人数为基准。完成率为最后一步人数除以第一步人数。

只有关键指标时，省略 `steps` 和 `groups`，提供 `summary` 和至少一项 `metrics`。每项填 `label`、带单位或百分号的文本 `value`，以及可选的 `detail`。未知数值填 `null`。流程报告也可以填写 `metrics`，与自动生成的完成率卡片一起显示。

```json
{
  "product": "轻拍相机",
  "title": "首拍关键指标",
  "scope": "首次打开后 24 小时",
  "summary": "新版首拍完成率为 52.5%。",
  "metrics": [
    {"label": "新版首拍完成率", "value": "52.5%", "detail": "210 人完成 / 400 人进入"}
  ]
}
```
