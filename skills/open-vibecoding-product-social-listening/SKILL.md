---
name: open-vibecoding-product-social-listening
description: 按产品名分析社交平台的用户评价和反馈差异，从实际评论提炼观点、亮点与待核实的问题，生成产品社媒分析报告。
---

# 产品社媒分析

优先用用户提供的产品名、别名或已确认的项目产品定位。产品容易同名时先排除不相关内容。收集的热门作品和可见评论只代表这次样本。

用 `open-vibecoding social-listening check [--config <config.json>]` 检查平台配置，或用 `run --product <产品名> --out <本轮目录>` 写出采集计划。计划需要宿主执行。小红书和抖音由宿主按浏览器与身份规则核对并采集。微信视频号在选用 TikHub、配置凭证并确认取数费用后，由采集器执行。计划中的缺口需要如实报告。

宿主已安装 `$product-review-social-listening` 时，读取其采集规范并复用 canonical 证据、聚类和固定 18 列 CSV。也可先读取用户提供的评论和采集记录。每项结论回到明确的评论与来源，区分跨平台一致的反馈、单个平台的问题与数据缺口。以原文中确实出现的词和评论位置填入词云。

纳入 App Store 时，用已核实的数字 App ID 和地区运行 `open-vibecoding app-store reviews --id <App ID> --country <地区代码> --out <reviews.json>`。ASO 已采集同一 App、同一地区、本轮的评论时直接复用文件。导入时加 `social-listening import --app-store-reviews <reviews.json>`，可独立使用或追加到原有社媒评论。用 `analysis.json` 的 `appStoreReviewAnalysis` 按评论 ID 填主题与情绪。星级来自商店，情绪根据正文判断，无法判断时留空。单来源报告按实际地区和公开可见样本出结论。

沿用现有采集器时，在 finalize 后填写观点、亮点、平台解读和词云词条到 `analysis.json`，用 `open-vibecoding social-listening import --from <本轮目录> --analysis <analysis.json> --out <report.json>` 导入已分类评论和 canonical 平台状态。数据由其他来源提供时可直接写入符合包内 `docs/social-report.md` 的 `report.json`，运行 `open-vibecoding social-listening render --data <report.json> --out <report.html> [--csv <detail.csv>]`。交付实际 HTML，CSV 与 raw 证据按授权保留。缺少在线工具或平台凭证时，可用已取得的资料生成报告，并按实际状态标注平台。
