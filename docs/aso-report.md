# App Store ASO 报告

用 `aso-report` 把 App Store 关键词研究结果填入 HTML。可直接使用内置模板，也可先复制一份模板并调整样式。每轮研究的 JSON、HTML 和证据可以放在目标项目的同一调研目录。

```sh
open-vibecoding aso-report markets
open-vibecoding aso-report template --out aso-template.html
open-vibecoding aso-report render --data report.json --out report.html --template aso-template.html
```

省略 `--template` 即可直接使用内置模板。自定义模板须在 `<title>` 中保留 `{{ASO_TITLE}}`，在 `<main>` 中保留 `{{ASO_CONTENT}}`，各出现一次。模板复制要求目标文件不存在。重复渲染可刷新已有的 ASO 报告。CLI 返回 JSON，`out` 指向生成文件，`status` 为报告中的研究状态。

## App Store 公开评论

```sh
open-vibecoding app-store reviews --id 6738299859 --country cn --out reviews.json
open-vibecoding aso-report render --data report.json --app-store-reviews reviews.json --out report.html
```

采集命令按数字 App ID 和两位商店地区代码读取公开评论页。输出包含 App ID、地区、采集时间、来源链接、覆盖状态，以及样本的评论 ID、标题、正文、星级和日期。已有文件需另选路径。返回 `partial` 代表取得公开可见样本，`empty` 代表找到评论区但公开页未展示评论，`unavailable` 或 `rate_limited` 代表本轮未取到。请求后会核对实际到达的应用和地区。采集结果也可传给 [产品社媒分析报告](social-report.md)。

渲染时传入该文件，可重复传入 `--app-store-reviews`，每个地区传一份同一应用的评论文件。数据来源区的「评论地区」仅列出有评论的地区，支持多选。数据来源区随选择更新评论和对应的来源链接。采集时间及覆盖状态记录在 `reviews.json` 中。渲染返回的 `reviewRegions` 列出每个传入地区的 `country`、`status`、可选 `reason`、`comments`（条数）和 `visible`。仅在有多个可选地区时提供全选。若 `report.json` 提供了 `appId`，必须和采集文件一致。观点、文案和候选词建议仍由研究者结合正文撰写。公开评论提供表达和问题线索，关键词排名与搜索量需要独立证据。

## 输入字段

| 字段 | 内容 |
|---|---|
| `product`、`researchedAt`、`summary` | 产品名、调研日期、结论或阻塞原因。均必填。日期填 `YYYY-MM-DD` 时，报告显示中文年月日 |
| `status` | `validated` 已验证、`provisional` 待核验、`blocked` 调研受阻 |
| `dataDate`、`appId` | 数据日期和本产品 App ID，按实际取得的信息填写 |
| `productIcon` | 可选，页眉中与本品名称并排的图标。填 PNG、JPEG 或 WebP 的 base64 data URL，离线可显示 |
| `comparisonApps` | 可选，参与排名对比的竞品。每项填写 `name` 和 App Store 链接 `url`，可附同格式的 `icon`。旧数据中 `role: "reference"` 的条目会跳过 |
| `sections` | 可按 `evidence`、`china`、`usa`、`social`、`candidates`、`exclusions` 填写。各节接受 `text`、`tables` 和 `sources`。数据来源区显示表格和链接，旧输入中的 `evidence.text` 会跳过。旧输入的 `monitoring` 不在报告中显示 |
| `markets` | 对比地区数组，用 `aso-report markets` 查找内置地区代码，每项填写唯一的 `id`，可附 `tables` 和 `sources`。例如 `{"id":"jp"}`。目录之外的自定义地区另填 `label` |
| `plans` | 每条方案包含 `locale`、`scope` 和 `keywords`。`scope` 为 `full` 或 `keywords-only`。完整配置同时提供 `name`、`subtitle`、`description` |
| `collectedSources` | 本次已采集的来源 ID 数组。支持 App Store `app-store`、七麦 `qimai`、小红书 `xiaohongshu`、X `x`、Reddit `reddit` |

可用 `sections.candidates.recommendations` 填写关键词建议，每项给出 `title` 和 `text`。建议以小卡片显示在结论正文下方，已有候选词说明、表格和来源也显示在这里。

有两套方案时，报告按「更新商店文案和关键词」与「只改关键词」切换。每套方案并排显示其各语言建议，并独立计算字段用量、参与校验。只有一套时直接呈现。无脚本环境或打印时按方案依次显示。

每个表格填写 `columns` 和 `rows`，可选 `title`。各区表格的标题和列名使用中文。CLI 会把已有的常见英文列名和标题转为中文。关键词、商店文案及其他单元格保留原值。单元格可以是字符串、数字或 `null`。每个来源链接填写 `title` 和 `url`。推荐用 `evidence` 节保留国家或平台、App ID、日期和导出校验状态。中美区对比可各放一张覆盖指标表和一张关键词排名表。

观点和数据缺口写入顶部的 `summary`。含「关键词」「本品排名」「竞品排名」三列的表格会汇总到多地区对比表。每个地区可附 `keywordTopics`，把实际关键词映射到已确认的主题，例如 `{"photo poses":"拍照姿势"}`。未映射的关键词按原文匹配。矩阵保留当地关键词及两种排名，缺少结果显示「—」。地区默认全选，胶囊控制显示列，横向滚动时主题列固定，点击表头可看该区原始表格及来源链接。

缺少关键词排名、使用旧版模板、打印或禁用脚本时，报告显示原始地区表格。缺少数据行时显示「暂无可用数据」。

多个竞品均填写唯一的 `comparisonApps[].id` 时，可在页眉切换当前竞品。各地区用 `competitorRanks` 按竞品 ID 和当地关键词给出排名，例如 `{"pose-camera":{"photo poses":9}}`。默认显示列表中的第一个竞品，其未单独填写的排名沿用原表的「竞品排名」列。其他竞品缺失的排名显示「—」。切换同时更新对比表和地区原表。

已有的 `sections.china` 和 `sections.usa` 会自动加入对比，排在新增地区前。若 `markets` 也提供 `cn` 或 `us`，采用对应的新条目。地区 `id` 以小写英文字母开头，可包含小写英文字母、数字和连字符。地区 `text` 保留输入兼容，生成页面时跳过。

内置目录包含 [ISO 3166-1](https://www.iso.org/iso-3166-country-codes.html) 的全部 249 个国家和地区代码，代码取自 [Debian iso-codes](https://salsa.debian.org/iso-codes-team/iso-codes/-/blob/main/data/iso_3166-1.json)。中文名称取自 [Unicode CLDR](https://github.com/unicode-org/cldr-json/blob/main/cldr-json/cldr-localenames-full/main/zh/territories.json)，按报告样式加「区」，`tw`、`hk`、`mo` 固定显示为「中国台湾」「中国香港」「中国澳门」。具体市场的 App Store 数据以本轮采集为准。

内置地区按代码匹配旗帜。SVG 随报告内嵌，离线可见。素材来自 [Circle Flags](https://hatscripts.github.io/circle-flags/)（[MIT 许可](../src/aso-report-flags/LICENSE.md)），`bq`、`bv`、`hm`、`sh`、`sj`、`um` 采用 [Flagpedia](https://flagpedia.net/about) 的公有领域旗帜并在模板中裁为圆形。自定义地区显示其 `label`。

报告底部会列出当前支持的来源。来源链接已列入 `evidence.sources`，或平台已记录在 `collectedSources`，就显示绿色「已包含」。已包含表示本报告引用了该来源或其采集结果。关键词导出是否成功、采集覆盖和数据缺口由实际证据说明。报告输入方在采集并取得可用结果后才将来源 ID 填入 `collectedSources`。

原始页面的链接卡片排在采集清单下方，点击在新标签打开。CLI 根据 URL 域名自动匹配 App Store、七麦、小红书、X 和 Reddit，其他域名使用通用网页图标。图标以 PNG 内嵌到报告，离线可见。品牌标识归各平台所有。 [App Store](https://apps.apple.com/assets/favicon/favicon-180.png) · [七麦](https://static.qimai.cn/static/bitbug_favicon.ico) · [小红书](https://picasso-static.xiaohongshu.com/fe-platform/f43dc4a8baf03678996c62d8db6ebc01a82256ff.png) · [X](https://abs.twimg.com/responsive-web/client-web/icon-ios.77d25eb62d3da71ba.png) · [Reddit](https://redditinc.com/hubfs/Reddit_Favicon_FullColor_48x48.png)

报告显示四个字段的用量和上限。名称为 2–30 字符，副标题最多 30 字符，描述最多 4,000 字符，关键词最多 100 个 UTF-8 字节。CLI 按 Unicode 码点计算字符数，按原始关键词串计算字节数，逗号计入用量。 [Apple 应用信息](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information) · [Apple 版本信息](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)

按 ASO 字段校验的实际结果填写 `plans[].valid`。长度不合规时，对应字段会显示超限或最小长度提示。待核验和调研受阻的报告仍可生成，CLI 在 `limitIssues` 中列出本地发现的长度问题。`validated` 状态必须有至少一套方案、每套方案均通过外部字段校验，且本地复核无长度问题。研究状态和证据是否齐备由 ASO 调研流程确定。各来源的实际缺口可写入顶部 `summary` 或用 `evidence.tables` 记录。旧输入里的 `limitations` 会在渲染时略过。

```json
{
  "product": "相机 App",
  "researchedAt": "2026-11-18",
  "status": "blocked",
  "summary": "美国区关键词数据尚未取得，暂缓提交元数据方案。",
  "collectedSources": []
}
```
