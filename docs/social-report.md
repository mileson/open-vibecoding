# 产品社媒分析报告

```sh
open-vibecoding social-listening check --config social-config.json
open-vibecoding social-listening run --product "产品名" --out ./social-research --config social-config.json
open-vibecoding social-listening import --from ./social-research --analysis ./social-research/analysis.json --out ./social-research/report.json
open-vibecoding social-listening render --data ./social-research/report.json --csv ./social-research/product_reviews_detail.csv --out ./social-research/report.html
open-vibecoding social-listening template --out ./social-template.html
```

`check` 返回各平台的准备状态。`run` 将相同的状态和采样参数写入 `collection-plan.json`。这两条命令只做本地配置检查和准备。宿主按 `open-vibecoding-product-social-listening` 的采集规范调用工具。原有 `product-review-social-listening` 继续负责采集、原文聚类、canonical 证据与固定 18 列 CSV。视频号费用预览和确认在实际采集器中完成。

## 导入 App Store 评论

```sh
open-vibecoding app-store reviews --id 6738299859 --country cn --out ./social-research/reviews.json
open-vibecoding social-listening import --from ./social-research --analysis ./social-research/analysis.json --app-store-reviews ./social-research/reviews.json --out ./social-research/report.json
open-vibecoding social-listening render --data ./social-research/report.json --out ./social-research/report.html
```

`reviews.json` 与 [ASO 报告](aso-report.md) 共用。可单独导入 App Store 评论或追加到已有社媒评论。原文、星级和日期会直接导入，平台 ID 为 `app-store`。用 `analysis.json` 的 `appStoreReviewAnalysis` 按评论 ID 补主题与情绪，例如 `{"123":{"topic":"入门体验","sentiment":"negative"}}`。情绪以正文为准，缺少判断时保持未分类。混合来源需要 CSV 时，将覆盖全部评论的明细传给 `render --csv`。

## 平台配置

省略 `--config` 使用空凭证配置。可将下列内容保存为本地 JSON，再按需填入视频号字段。

```json
{
  "platforms": {
    "xiaohongshu": {"enabled": true, "contentTopN": 10},
    "douyin": {"enabled": true, "contentTopN": 10, "maxCommentsPerContent": 1000, "noGrowthRounds": 3, "maxRuntimeMinutes": 90},
    "wechat_channels": {
      "enabled": true,
      "provider": null,
      "tokenEnv": null,
      "budgetUsd": null,
      "searchTopN": 10,
      "detailTopN": 3,
      "commentPages": 1,
      "timeoutSeconds": 45,
      "sort": "hot",
      "publishTime": "all",
      "duration": "all"
    }
  }
}
```

选择视频号服务时，`provider` 填 `tikhub`，`tokenEnv` 填本机环境变量名，例如 `TIKHUB_API_TOKEN`，`budgetUsd` 填本轮费用上限。具体密钥由宿主凭证工具或环境提供。配置缺失会返回 `configuration_required` 与缺失字段，环境变量未就绪会返回 `credential_required`，配置齐全后是 `approval_required`。浏览器来源返回 `browser_check_required`，由宿主核对身份和登录。将平台的 `enabled` 设为 `false` 可跳过该平台。

复用现有采集器时，将浏览器采样字段映射到其下划线命名配置，视频号的 `detailTopN`、`commentPages` 分别对应 `detail_comment_top_n`、`comment_pages_per_content`。采集器既有环境入口是 `TIKHUB_API_TOKEN`。使用自定义凭证变量名时，在宿主进程内转交给采集器，避免写入 JSON。实际确认金额应覆盖费用预览并落在本轮 `budgetUsd` 内。

## 报告输入

复用原采集器时，将其输出的 `processed_rows.json`、`raw/*.canonical.json` 和 `product_reviews_detail.csv` 保留在同一个任务目录。Agent 另写 `analysis.json`，使用下表的字段填写查询日期、核心观点、亮点、关注点、平台对照和词云，产品名也可来自同目录的 `collection-plan.json`。导入命令从原文生成 `comments`，优先采用 canonical 中的采集状态，并在已有 CSV 时返回其路径供 `render --csv` 使用。已采到原文但还未生成 `processed_rows.json` 时，先完成采集器的整理步骤。

在 `analysis.json` 的词云条目中可以用 `aliases` 补充原文用词，例如 `{"word":"噪点","aliases":["噪音"]}`。省略 `commentRows` 时，导入命令据此关联评论。也可以直接按下表编写完整的报告 JSON，交给 `render`。

| 字段 | 内容 |
| --- | --- |
| `product`、`queriedAt`、`summary` | 必填。产品名、`YYYY-MM-DD` 查询日期、基于评论的核心观点或当前采集缺口 |
| `productIcon` | 可选，PNG、JPEG 或 WebP 的 base64 data URL。与产品名并排显示 |
| `platforms` | 每项填写 `id`，可附 `label`、`summary`、`status` 和同格式 `icon`。内置名称包括 `xiaohongshu`、`douyin`、`wechat_channels`、`kuaishou`。其他平台填写自定义 ID 和名称 |
| `highlights`、`concerns` | 每项填 `title` 和 `text`。关注点另填 `category` |
| `comparison` | 每项填写 `topic` 和 `views`。`views` 以平台 ID 为键，每个平台填写 `text` 和可选 `tone`（`positive`、`neutral`、`negative`） |
| `comments` | 每项填写 `platform`（平台 ID）和 `text`，可附 `topic`、`sentiment`、`sourceTitle`、原始 `url`。有情绪分类时填 `positive`、`neutral` 或 `negative`，未知留空 |
| `wordCloud.terms` | 每项填写 `word`、`commentRows`（在 `comments` 中从 1 开始的位置），可附 `ratio`（大于 0 且最多 1）。省略比例时按关联评论数除以本次评论总数计算。最多 24 个词 |

报告的情绪占比按已分类评论计算。没有可分类样本时显示「—」。已选但不可访问的来源可填 `login_required`、`credential_required`、`configuration_required`、`rate_limited` 或 `unavailable`。部分采集使用 `partial`，明确跳过使用 `not_selected`。如果采集结构提供了 `content_id` 而无原始 URL，在 CSV 与 raw 中保留该标识，HTML 的 `url` 留空。

`--csv` 原样内嵌已生成的 18 列明细，HTML 移到其他目录后也可离线下载该明细。省略时隐藏下载入口。可以通过 `template` 复制样式并用 `--template` 自定义，模板须保留一次 `{{SOCIAL_TITLE}}`、`{{SOCIAL_CONTENT}}` 和 `{{SOCIAL_WORDS}}`。只有 CLI 生成的同类 HTML 允许通过重复渲染刷新。平台图标按有许可的本地素材传入，产品图标可留空。

```json
{
  "product": "相机 App",
  "queriedAt": "2026-11-18",
  "summary": "部分用户认可模板能帮助摆姿势，现有反馈还不足以判断切换模板的稳定性。",
  "platforms": [{"id": "xiaohongshu"}, {"id": "wechat_channels", "status": "configuration_required"}],
  "comments": [{"platform": "xiaohongshu", "topic": "姿势模板", "sentiment": "positive", "text": "有参考就知道手要放哪里了。"}],
  "wordCloud": {"terms": [{"word": "姿势模板", "commentRows": [1]}]}
}
```
