# 代码质量评审报告

```sh
open-vibecoding code-quality-report render --data docs/examples/photo-selection-quality.json --out photo-selection-quality.html
```

从源码运行时，可将 `open-vibecoding` 替换为 `node bin/open-vibecoding.js`。命令读取 JSON 并生成只读的离线 HTML，退出码表示渲染是否成功。同一份输入和模板生成相同的 HTML。页面可展开检查记录，以及已确认发现的源码、证据与复验。

## JSON 字段

顶层 `schemaVersion` 固定为 `open-vibecoding.code-quality-report.v1`。`id` 标识评审对象，`revision` 标识本次报告，均为字符串。`conclusion` 用一句话给出主要结论，`scope` 简述评审对象与范围。`priorities` 至少填一项，按优先级列出有证据的发现所对应的改进或最重要的待核验事项，每项填 `id`、`title`、`action`。

`dimensions` 包含 `complexity`、`duplication`、`testStrength`。每项包含 `summary`、至少一条 `checks` 和 `findings` 数组。可选的 `label` 同时用于目录和章节标题，省略时显示默认维度名称。每条检查包含 `id`、`title`、`method`、`scope`、`status`、`detail`。在 `detail` 写实际结果与证据来源，若未完成则写原因和待执行步骤。成功测得的工具指标可连同单位、范围和来源写在这里。

| 检查状态 | 填写条件 |
| --- | --- |
| `findings` | 有经评审确认的发现，至少关联一个发现 ID |
| `no_findings` | 实际检查过明确范围，在该范围未发现问题 |
| `candidate` | 工具命中或人工线索仍需核实，填写候选位置等线索 |
| `not_run` | 尚未执行该手段 |
| `unsupported` | 当前手段或工具版本不支持该语言 |
| `blocked` | 有具体阻碍，例：基线失败、覆盖报告缺失或执行异常 |

每条发现包含 `id`、`title`、`checkId`、`severity`（`high`、`medium`、`low`）、`evidence`、`impact`、`recommendation`、`locations` 和 `verification`。`checkId` 指向同维度的 `findings` 状态检查。每个位置包含仓库相对路径 `path`、起始行 `line` 和可选结束行 `endLine`，重复逻辑至少写两处。`verification` 包含 `status`（`pending`、`passed`、`failed`、`blocked`）和 `detail`，表示对建议或修复的复验。优先项、检查及发现的 ID 在报告内唯一，以小写字母开头，可包含小写字母、数字、下划线或连字符。

测试检查可加 `runs`，每项填 `title`、`status` 和 `detail`。按实际阶段记录基线、改动、恢复和关联用例。状态分别为测试通过（`passed`）、断言失败（`assertion_failed`）、变异存活（`survived`）、未覆盖（`uncovered`）、超时（`timeout`）、编译失败（`compile_error`）、运行异常（`runtime_error`）和未运行（`not_run`）。使用项目原生手段时记录该手段。缺失的代码位置、覆盖指标和测试结果留在相应检查的待验证说明中。

[选图案例输入](examples/photo-selection-quality.json)
