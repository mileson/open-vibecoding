# 已有实践索引

此索引链接现有方法，不将每一行变成新 Skill 或用户入口。根据用户场景选择，具体约束和验证方式由对应能力维护。实际安装路径见项目路由或 install-manifest.json 的 skillEntries。

| 用户面临的情况 | 可以复用的方法 | 方法维护位置 |
| --- | --- | --- |
| 新界面方向未确定 | 基于同一现有截图比较三种有实质差异的方向 | open-vibecoding-visual-direction-review |
| 实现与参考图不一致 | 对照真实截图，检查视觉差异而非只看构建结果 | open-vibecoding-frontend-design |
| 卡片不整齐、图标显得偏心 | 检查同类内容槽位对齐和素材视觉重心 | open-vibecoding-frontend-design、open-vibecoding-icon-system |
| 代码通过但用户无法完成任务 | 从真实用户入口验证最终业务结果 | open-vibecoding-test-strategy、open-vibecoding-acceptance-verification |
| 开发者自查容易遗漏体验问题 | 独立操作评审；需要修复时组合修改与多轮复查 | open-vibecoding-ui-interaction-review、open-vibecoding-ui-review-and-repair |
| 产品图标来源杂乱 | 继承现有家族，检索或设计素材并在实际尺寸成组验收 | open-vibecoding-icon-system |
| 翻译生硬或短标签太长 | 按目标语言和真实控件重写，检查全部支持语言 | open-vibecoding-shared 的 references/language-and-review.md |
| iOS 多语言实现或迁移 | 按工具链、部署版本和资源语义选择方案 | open-vibecoding-ios-localization |
| 想判断功能是否值得保留 | 分清真实使用、请求、预加载与自动化流量，明确统计口径 | open-vibecoding-product-data-analysis |
| 修过的问题又发生，仍需重新索要日志；优化后难以确认哪里更快 | 主动评估复发诊断盲区，按需补日志与耗时证据并实际读回 | open-vibecoding-diagnostic-readiness |

这些主题表示已有方法，不表示当前项目已执行或验证。外部 API、版本与工具用法仍需本轮证据；缺少工具时选择可行方法并说明未验证边界。
