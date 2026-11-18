# 生成测试 HTML 报告

每个项目和测试种类使用一份用例 JSON 与一份 HTML。先生成待测试清单，再将测试运行器的实际结果交给 CLI。页面按每个用例最后一次执行汇总，展开卡片可看历史记录。

```sh
open-vibecoding test-report render --kind unit --data cases.json --out report.html
open-vibecoding test-report record --kind unit --data cases.json --result result.json --out report.html
```

`cases.json` 示例

```json
{
  "project": "图像处理",
  "environment": {
    "deviceType": "模拟器",
    "deviceModel": "iPhone 17 Pro",
    "os": "iOS",
    "osVersion": "26.5"
  },
  "cases": [
    {
      "id": "empty-image",
      "title": "宽或高为零时返回空裁切",
      "input": "宽度 0，高度 3000",
      "expected": "返回空矩形",
      "assertion": "裁切结果等于空矩形"
    }
  ]
}
```

`result.json` 示例

```json
{
  "caseId": "empty-image",
  "runId": "regression-01",
  "phase": "原用例复测",
  "status": "passed",
  "actual": "返回空矩形"
}
```

| `--kind` | 模板 | 专用字段 |
| --- | --- | --- |
| `unit` | 单元 | `input`、`expected`、`assertion` |
| `component` | 组件 | `component`、`preconditions`、`action`、`expected`、`assertion` |
| `api` | 接口／集成 | `preconditions`、`request`、`response`、`effects`、`assertion` |
| `ui` | UI／端到端 | `environment`、`preconditions`、`steps`（`action`、`expected`）、`expected` |

报告可补充 `meta`（日期等概要）、`scope`、`sourceLabel`。用例可用 `name` 和 `target` 指明对应测试与被测代码。没有 `runs` 时显示待测试。结果状态支持 `passed`、`failed`、`skipped`、`cancelled` 和 `blocked`，失败和阻塞需要 `reason`。结果可补充 `phase`、`actual` 或 `evidence`。

## 记录复测所需信息

- `environment` 可填整段文字，也可填对象。所有环境值都是自由文本，按实际记录填写。
  - 设备用 `deviceType`、`deviceModel`，例如真机、模拟器、电脑或服务器。
  - 系统用 `os`、`osVersion`，浏览器用 `browser`、`browserVersion`。
  - 执行位置用 `location`，例如本地、CI 或远程设备云。目标环境用 `target`，例如开发或预发。
  - `label` 可写简短名称，`notes` 可写影响复现的网络、语言或权限等条件。
- `version` 记录应用版本、构建号或源码提交，`executedAt` 记录带时区的执行时间，`durationMs` 记录毫秒耗时，`command` 和 `evidence` 记录执行入口及日志或截图。用例继续保留输入、步骤、预期、实际和失败原因。
- 这些信息可随报告或单次执行写入。复测换设备或版本时，在 `result.json` 指定本次值。CLI 追加结果时保存本次环境、被测版本和命令的快照。页头按已记录的执行环境汇总，多个环境可在用例的执行记录中查看。缺省环境显示「未记录」。

两条命令成功时向标准输出写 JSON。参数或数据错误返回退出码 1 和 JSON 错误。输出路径只能是新文件或由本命令生成的报告。模板和结果 JSON 用作只读输入，`record` 会更新用例 JSON。HTML 写入失败时如果结果已保存，重试同一个 `runId` 和结果可重建报告，原记录只追加一次。
