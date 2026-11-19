# 生成测试 HTML 报告

每个项目和测试种类可使用一份用例 JSON 与一份 HTML。规划用例时使用离线用例清单。执行后的报告按每个用例最后一次执行汇总，展开卡片可看历史记录。

## 生成离线测试用例清单

```sh
open-vibecoding test-report render --kind cases --data cases.json --out cases.html
```

清单 JSON 须包含非空的 `project`、`scope`、`summary` 和 `cases`。每条用例包含以下字段。

| 字段 | 写法 |
| --- | --- |
| `id` | 稳定且唯一，以英文字母或数字开头，可包含点、下划线或连字符 |
| `feature`、`title` | 功能或场景名称、具体用例名称 |
| `layer` | `unit` 单元、`component` 组件、`api` 接口／集成、`e2e` 端到端 |
| `priority` | `high`、`medium`、`low` |
| `input` | 准备数据与初始状态 |
| `steps`、`assertions` | 两个非空字符串数组，分别写操作步骤和关键断言 |
| `expected` | 可观察的预期结果 |
| `target` | 可选，计划使用的工具或执行目标 |

校验失败会返回字段错误，已有输出保持原样。成功后可离线打开单个 HTML。页面按层呈现，只有一个测试层时直接显示用例，有多个层时提供导航。后续生成脚本和登记执行结果时沿用用例 ID，框架标识不同可通过既有报告的 `testIds` 建立映射。 [最多选 9 张的用例 JSON](examples/photo-selection-test-cases.json)

## 生成执行报告

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

## 导入单元测试结果

保留项目现有测试命令，打开框架的结构化结果输出。CLI 读取已生成的结果。

| `--format` | 原始结果 | `cases[].testIds[format]` |
| --- | --- | --- |
| `xcresult` | Xcode 的 `.xcresult`，通过当前 Xcode 的 `xcrun xcresulttool get test-results` 读取 | 测试节点的 `nodeIdentifierURL`。旧节点缺少 URL 时使用 `nodeIdentifier` |
| `vitest` | Vitest 的 `--reporter=json --outputFile=vitest.json` | `项目相对路径::fullName` |
| `jest` | Jest 的 `--json --outputFile=jest.json`，可加 `--testLocationInResults` | `项目相对路径::fullName` |
| `pytest` | pytest 的 `--junitxml=pytest.xml`，导入时需要 `python3` | XML 的 `classname::name`，包含参数化后缀 |

例如 `"testIds": {"vitest": "src/selection.test.ts::selection refuses the tenth photo"}`。没有配置对应格式的别名时，直接用用例的 `id` 比对。Web 路径基于测试项目根目录，默认取导入命令的当前目录。不同机器上运行时可用 `--root` 提供原项目根目录。目录分隔符统一为 `/`。匹配区分大小写，重复或无对应关系的结果列在 `imported.unmatched` ，当前批次的问题也会显示在 HTML 的「运行异常」。Swift Testing 参数与重试结果在其具名测试的执行详情中保留。当结果只提供分组状态时，统计按具名测试计数。

```sh
open-vibecoding test-report import --kind unit --format vitest \
  --root /path/to/project --data cases.json --result vitest.json \
  --meta execution.json --run-id selection-ci-42 --out report.html
```

`execution.json` 可记录本轮的 `command`、`exitCode`、被测 `version`、`runnerVersion`、`environment`、`executedAt`、`durationMs`、`evidence` 和 `phase`。没有证据的字段留空。运行器只产生部分结果时，可补充执行级 `status` 与 `reason`。单元测试的 `record` 还支持 `pending`、`unknown` 与 `unsupported`，对应待测试、未知和不支持。已匹配用例沿用运行器观察结果，未出现在本轮结果里的用例保留原状态。pytest 的设置与清理错误记为阻塞，断言失败记为失败。

同一次执行重试导入时，沿用 `--run-id` 和原始结果。CLI 拒绝使用相同 ID 覆盖不同的结果。独立复测使用新 ID。导入会锁定并更新同一份用例 JSON，原始结果留在原路径，HTML 显示路径及可读摘要。归档或分享前保留原始附件并确认日志已脱敏。

覆盖率有实际结果时单列。Xcode 结果包带覆盖率时读取行覆盖率。Web JSON 若带 Istanbul `coverageMap`，提取语句、函数和分支覆盖率。也可用 `--coverage <coverage-summary.json>` 补充实测数据。文件应带 `total`，其中 `lines`、`statements`、`functions` 或 `branches` 各自包含 `covered` 与 `total`。覆盖率按运行显示，独立于用例状态计数。

- iOS 结构化读取命令可查 [Xcode 16.3 发行说明](https://developer.apple.com/documentation/xcode-release-notes/xcode-16_3-release-notes)。
- Web 结果选项可查 [Vitest JSON reporter](https://vitest.dev/guide/reporters#json-reporter) 与 [Jest CLI](https://jestjs.io/docs/cli#--json)。
- Python XML 选项可查 [pytest JUnit XML](https://docs.pytest.org/en/stable/how-to/output.html#creating-junitxml-format-files)。

## 规划并运行分组单测

在单测 JSON 中添加可选的 `testPlan`。每个组用稳定的 `id`、`title` 和 `rules` 描述业务规则。每条规则有全局唯一的 `id` 与 `title`。用例通过 `ruleId` 关联规则，并填写 `input`（初始状态和输入）、`action`、`expected`、`assertion`。规则可以暂时没有用例，报告会显示「缺用例」。

```json
{
  "project": "相册选图",
  "testPlan": {
    "groups": [{
      "id": "limit",
      "title": "选图上限",
      "rules": [{"id": "keep-original", "title": "选满后保留原名单"}],
      "runner": {"format": "pytest", "argv": ["pytest", "tests/test_picker.py", "--junitxml", "{result}"]}
    }]
  },
  "cases": [{
    "id": "reject-tenth",
    "title": "拦住第 10 张",
    "ruleId": "keep-original",
    "input": "已选照片 1 至 9，候选照片 10",
    "action": "加入照片 10",
    "expected": "拒绝加入并保留原名单",
    "assertion": "加入操作返回拒绝，已选 ID 仍为 1 至 9",
    "testIds": {"pytest": "tests.test_picker::test_reject_tenth"}
  }]
}
```

```sh
open-vibecoding test-report plan --data cases.json
open-vibecoding test-report run --data cases.json --root . --jobs 2 --out report.html
open-vibecoding test-report run --data cases.json --root . --group limit --out report.html
```

`plan` 只校验计划并列出执行组。`run` 只执行受信任计划中的项目命令，参数逐个传递给运行器。每组使用独立的 `{result}` 位置，原始结果与日志保存在 HTML 同目录的运行子目录。未提供 `runner` 的组只做计划展示。默认串行。可以给组声明 `dependsOn`（前置组 ID 列表）和 `resources`（互斥资源名）。前置组须有完整的通过证据。并发和资源限制适用于同一次调度，运行器自身的并发也要在项目配置中限制。可在组的 `runner` 记录实际的 `version`、`runnerVersion` 和 `environment`，以及可选的进程超时 `timeoutMs`。命令无法启动、结果不完整或测试失败时，仍生成报告并返回非零退出码。重新执行会追加新的运行记录。

可选的 `testPlan.findings` 收录已经核验的覆盖发现。每项有 `ruleId`、`kind`（`code` 或 `assertion`）、`detail` 和 `evidence`。补测核验后将 `status` 设为 `resolved` 并保留证据。报告分别展示业务规则覆盖和原生代码覆盖。

分组和覆盖设计参考 [Gherkin](https://cucumber.io/docs/gherkin/reference/)、[pytest-xdist](https://pytest-xdist.readthedocs.io/en/stable/distribution.html)、[Vitest 分片报告](https://vitest.dev/guide/reporters.html#blob-reporter) 和 [StrykerJS](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)。

## 运行 Web 和原生移动端端到端测试

```sh
open-vibecoding test-report e2e --data manifest.json --out e2e-report \
  --root /path/to/project --run web-smoke --run ios-smoke
```

`--out` 指定报告目录。每次执行都会生成 `index.html`、`results.json` 和一个独立的 `run-*/` 证据目录。分享报告时保留整个目录。HTML 可以直接打开，也可使用页面锚点或 [JSON Schema](e2e-results.schema.json) 给现有界面提供数据。每次执行会替换顶层两个报告文件，原始证据目录继续保留。

清单使用 `schemaVersion: 1`、`project` 和 `runs`。每个执行项包含 `id`、`label`、`engine`、`environment`、`argv` 和 `cases`。同一清单中执行项的 ID 唯一，每个执行项的用例 ID 唯一。环境至少提供被测目标 `target` 和设备类型 `deviceType`，可再记录系统、浏览器及版本。每个验收项使用 `id`、`title`、`expected`。用例名称使用相同 ID，中文说明写在 `title`。

- Playwright 启用 JSON reporter。Runner 将 `PLAYWRIGHT_JSON_OUTPUT_FILE` 指向本轮原始结果。需要在报告读到精确观测值时，测试可通过 `testInfo.attach('ovc-observation', { body: JSON.stringify({ actual }), contentType: 'application/json' })` 记录；测试代码本身仍要执行断言。推荐在输出目录内保存失败 trace。
- Maestro 为 Flow 设置相同的 `name`，使用 JUnit reporter。原始 XML 读取需要 `python3`。报告可读入单独采集的观测值 JSON，格式为 `{"environment":{"osVersion":"26.5"},"cases":{"case-id":{"actual":"观测值"}}}`。无观测值时显示「未记录」，结论仍来自 Flow 的实际执行。保存失败截图与 Maestro 调试输出。
- `argv` 按字符串数组直接执行，使用 `{result}`、`{artifacts}`、`{observations}` 传入绝对路径；默认工作目录是当前目录，可用 `--root` 指定项目。仅执行来自可信项目的清单。可选 `timeoutMs`，默认 5 分钟。
- 不传 `--run` 时运行所有登记项，传入时仅选中指定 ID，其余显示「未运行」。选中项出现断言失败、环境/执行错误或未运行会返回退出码 1，报告照常生成。Playwright 从失败重试后通过单列为「重跑通过」，原尝试仍可查看。对重跑通过是否能合并，由项目的门禁策略决定。

### 最多选 9 张照片

[选图清单](examples/photo-selection-e2e/manifest.json)使用固定图片和相同初始状态。先在相册选满 9 张，再从搜索入口点击 P10，完成后检查发起页收到的名单。可控缺陷将 P01 替换成 P10，数量依然是 9。对照包含缺陷版本的数量检查和身份检查，以及修复版本的完整检查。

在仓库根目录运行下面的命令。移动端需要 Java 17 或更高版本和一台已启动的任务专用 iOS 模拟器。用 `tools check maestro` 只检查，用 `tools ensure maestro` 复用兼容的 CLI 或在 macOS／Linux 安装固定版本。加 `--device <iOS-UDID>` 可检查指定模拟器的就绪状态。显式设置 `PHOTO_SIM_UDID` 后构建与安装样例。

```sh
npm ci --prefix docs/examples/photo-selection-e2e/web
npm exec --prefix docs/examples/photo-selection-e2e/web -- playwright install chromium
node bin/open-vibecoding.js tools ensure maestro --device "$PHOTO_SIM_UDID"
bash docs/examples/photo-selection-e2e/ios/prepare.sh "$PWD/.open-vibecoding/artifacts/e2e/build"
node bin/open-vibecoding.js test-report e2e \
  --data docs/examples/photo-selection-e2e/manifest.json \
  --out .open-vibecoding/artifacts/e2e/photo-selection
```

包含缺陷版本的对照会产生真实断言失败和退出码 1。持续回归选择 `playwright-fixed` 和 `maestro-fixed`。两端都通过也只覆盖清单中标明的选图样例，实际产品版本、系统相册权限和真机需要在各自环境验收。

测试策略 Skill 原来已要求检查最终业务结果。新版用本例把结果写成明确的条件，包括第 10 张被拦截、原名单保持，以及发起页收到同一名单。教学对照在同一个缺陷版本上切换断言条件，再用修复版本复测。数量断言是控制组，不能当作旧版 Skill 每次运行都会生成的结果。

若被测功能包含 AI，首先从真实返回、实际界面、业务状态或数据核对验收项。能通过明确条件判断的项目写成断言，只有语义、观感等无法可靠确定性判断的项目才使用评分，单列准则与证据。选图案例中的照片数量、ID 与传参结果都用确定性断言。

### 持续回归与合并检查

| 触发时机 | 选择范围 | 检查结果 |
| --- | --- | --- |
| PR | 关键用户路径。按改动影响选择 Web 或原生用例，公共业务逻辑和 Runner 变更覆盖两端。 | 始终产生 `E2E Required`；无相关改动时在检查摘要中记录未运行原因。 |
| 合并队列 | 以 `merge_group: checks_requested` 触发，在合并组的实际提交上运行 Web 和 iOS 两条完整基线。 | 保持相同的 required check 名称。 |
| 夜间、发布前 | 运行受支持环境的全量登记用例；发布前使用准备发布的提交。 | 单独保留完整回归状态与证据。 |

按用例保留通过、重跑通过、断言失败、环境/执行错误和未运行。被选中的验收项如有失败、错误或缺失，检查应失败；重跑通过仍保留首轮失败和附件，由项目明确是否接受。报告目录与 Playwright trace、Maestro JUnit、调试日志和失败截图一起上传，即使测试退出码非零。发布前按实际 GitHub 执行验证 job 名、触发事件和状态，再配置 ruleset 或分支保护。参考 [GitHub 合并队列触发事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#merge_group) 和 [必过状态检查](https://docs.github.com/en/pull-requests/reference/status-checks)。

#### 并行修复与工作区收尾

- 需要独立验证的修复各用一个已授权的任务分支与 worktree。将 `--root` 和 `--data` 指向同一待测工作区，并为任务选独立的 `--out`。加 `--require-worktree` 会在准备数据、运行测试前拒绝主工作区和普通目录。共享模拟器、账号或数据等资源无法隔离时串行。 [Git worktree](https://git-scm.com/docs/git-worktree)
- PR 验证通过后按仓库评审规则入队。启用 GitHub 合并队列，并将 `E2E Required` 配置为目标分支的必过检查。队列在合并候选上复验后自动合并。支持时可启用 GitHub 的合并后远端分支自动删除。 [合并队列](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue) · [自动删除分支](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches)
- 本地收尾在确认对应 PR 已合并、合并结果已进入目标分支之后执行。普通合并可核对分支提交是否被目标分支包含。Squash 或 rebase 合并时，通过 PR 的已合并状态、最终 head 和合并提交确认，发现新提交则保留分支。工作区归属本任务、无未提交改动且无其他任务占用时，用宿主的 worktree 归档能力或 Git 的常规移除操作，再清理已合并的本地分支。测试失败、合并冲突或移除条件不满足时，保留工作区与报告。

本仓库的 [回归工作流](../.github/workflows/e2e.yml) 提供上述 PR、合并队列、定时和手动触发。PR 快速回归按受影响的平台选基线。发布流水线可调用同一个工作流的 `workflow_call`，默认用调用方提交跑 Web 和 iOS 全量回归。单平台项目可调用 [执行工作流](../.github/workflows/e2e-run.yml)，提供执行环境、清单和运行 ID，可选准备及收尾脚本。默认要求首次运行通过，允许重跑恢复的项目可显式设置 `allow-retry-recovery: true`。如果环境准备失败，工作流用 `--setup-error` 记录环境错误并保留 `setup.log`。

AI 可以读 trace、日志和失败步骤给出诊断建议。检查状态来自已登记的功能断言与运行结果，排障建议独立保留。参考 [GitHub Agentic Workflows 的 CI Doctor](https://github.github.com/gh-aw/gallery/ci-failure-investigation/)。

### 自动准备并核对测试数据

在 E2E 清单的 `dataPreparations` 注册可复用准备配置，再用运行项的 `dataPreparation` 引用名称。现有无该配置的运行项保持原执行方式。CI 中启动环境、安装执行器或安装被测构建仍使用已有准备入口。

```json
{
  "dataPreparations": {
    "photo-selection": {
      "label": "固定照片 P01–P10，打开选图时尚未选中照片",
      "prepare": "tests/prepare-photo-data.mjs",
      "verify": "tests/verify-photo-data.mjs",
      "checks": [
        { "id": "selected-ids", "title": "初始已选 ID", "expected": [] }
      ]
    }
  }
}
```

两阶段只运行受信清单登记的项目内 `.sh`、`.js` 或 `.mjs` 脚本。脚本的实际路径必须位于项目根目录内。可用 `timeoutMs` 设置单阶段超时，默认 60 秒。Runner 为每次运行提供隔离的 `OVC_E2E_DATA_DIR` 作为准备目录，并传给准备、校验和实际测试命令。准备脚本可在其中建立所需 fixture，临时原料可放在 `.fixture` 子目录。校验脚本将以检查 ID 为键的真实观测对象写到 `OVC_E2E_DATA_OBSERVATIONS`，例如 `{"selected-ids":[]}`。Runner 比较预期与观测值，包括类型、值及数组顺序。缺少键、观测不符、脚本非零退出或超时都会阻断受影响的用例。

HTML 展示准备内容、实际校验结果和证据链接。CLI 摘要的 `runs[].dataPreparationStatus` 和 `results.json` 的 `runs[].dataPreparation.status` 区分 `passed`、`prepare_failed`、`verify_failed`。失败时运行项仍使用既有的 `environment_error`，受影响的用例是 `not_run`，尝试记录为空。报告目录的 `run-*/<run-id>/data/` 保留准备与校验日志、观测 JSON 和已有的截图或回执。 [结果字段](e2e-results.schema.json)

选图样例中，Web 复制固定图片，Playwright 从相册与搜索页面读取成功加载的图片及已选状态。iOS 复用安装好的样例构建，启动应用后读回实际可加载的图片及当前选择，再由 Maestro 执行同一批验收项。两端在每条用例开始时还核对已选数量为零。固定基线包含 `blocked`、`selection`、`returned` 和辅助数量检查 `count`。将 `PHOTO_FIXTURE_OMIT_ID=P10` 仅用于 Web 样例，可观察实际缺图时的阻断。 [选图准备配置](examples/photo-selection-e2e/manifest.json)
