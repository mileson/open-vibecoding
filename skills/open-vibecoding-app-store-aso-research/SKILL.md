---
name: open-vibecoding-app-store-aso-research
description: 为 iOS App 调研和优化 App Store 名称、副标题、描述或关键词。按目标市场调用当前宿主已安装的 App Store ASO 研究 Skill。
---

# App Store ASO 研究

从当前项目确认目标 iOS App、商店市场和待优化的字段。用户只说「这个 App」时优先使用当前项目可核实的产品身份。有多个候选且无法确定目标时再确认。

在当前宿主查找已安装的 `$app-store-aso-research`，加载并运行其完整流程，继承证据要求、字段校验和报告状态。把当前项目、用户指定的市场和字段传入，未指定市场时采用该 Skill 的默认范围。无法找到该 Skill 时，说明需要接入 `app-store-aso-research` 才能运行完整调研，并保留已确认的产品范围。不要把普通搜索或未经校验的配置当成 ASO 研究结果。

## App Store 公开评论

用户要求分析商店口碑，或需要用评论支撑文案和候选词时，用已确认的数字 App ID 和商店地区运行 `open-vibecoding app-store reviews --id <App ID> --country <地区代码> --out <reviews.json>`。已取得同一 App、同一地区、同一轮的结构化评论时，直接复用。按评论原文提炼功能表达、使用场景和问题，将发现写入报告结论和候选词建议。评论证据不计入搜索量、排名或覆盖。公开页样本按实际覆盖描述，跳转或解析失败需要记录缺口。渲染时通过 `aso-report render --app-store-reviews <reviews.json>` 附上评论，每个地区传同一 App 的一份文件，多个地区重复传此参数。核对 CLI 返回的 `reviewRegions`。数据来源区只为实际取得评论的地区显示选项，选中地区时联动对应的评论表和来源链接。有多个地区才显示全选。未取到评论的地区按采集文件与 CLI 状态记录，必要时在结论交代缺口。

## HTML 报告交付

在本轮 `.aso-research/YYYY-MM-DD/` 保留研究产物，并写入 `report-input.json`。报告输入遵循包内 `docs/aso-report.md`。从当前项目的 `.open-vibecoding/harness/install-manifest.json` 的 `cliEntry` 可定位安装包和配套文档。

- `sections` 只填本轮实际取得的证据和已核对的口径。`collectedSources` 只记录本轮取得可用数据的来源。七麦以核验后的导出为准，社交平台以实际采集到的证据为准。公开商店的名称、副标题和功能说明链接放入 `sections.evidence.sources`。
- 完整配置和只改关键词分别写入 `plans` 的 `full`、`keywords-only`。`valid` 来自对应语言和方案的字段校验结果。数据不齐时按原 Skill 使用 `provisional` 或 `blocked`，保留实际发现、具体缺口与可用证据，不补未经验证的排名或方案。
- 使用 `open-vibecoding aso-report render --data <本轮目录>/report-input.json --out <本轮目录>/report.html`，交付 CLI 返回的实际 HTML 路径。优先使用当前项目已安装的 CLI。需要保存或调整模板副本时，通过 `aso-report template --out <模板路径>` 复制，渲染时传 `--template`。默认使用内置模板。

只有用户授权写入 App Store Connect 或发布时，才按原 ASO Skill 的发布交接规则处理已确认的配置。
