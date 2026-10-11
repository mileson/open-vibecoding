---
name: open-vibecoding-learning-review
description: 生成并维护 Open VibeCoding 复盘学习包、题材参考库、证据清单、图文讲解模块、检索/工作示例模块，以及 HTML 电子书阅读器。
---

# Open VibeCoding Learning Review

## 何时使用

当用户希望把 Open VibeCoding 工作区、已完成的 loop 任务，或某个项目领域整理成复盘学习包时，使用这份 skill。不要用关键词表触发；先看用户目标和期望产物形态。

- 长任务结束，或某个已验证 loop 任务刚完成
- 当前交付需要章节结构、证据锚点、图文讲解、检索练习、工作示例或长期阅读体验；这类形态默认优先走学习包和阅读器，不要只交一篇普通 Markdown
- 用户明确要求复盘某个项目领域或能力面
- 需要构建或刷新题材模板、证据清单、检索模块或工作示例
- 需要生成归档在 `.open-vibecoding/` 内的 HTML 电子书阅读器
- 需要把已验证修复连接到可复用的项目经验；只有明确值得沉淀时，才让 Skill 产物经过 `$open-vibecoding-quality` 写入 `.open-vibecoding/knowledge/skills/`
- 需要区分“项目经验沉淀”和“操作配置自我成长”；配置缺口、文件识别、命令习惯或用户偏好应进入 `.open-vibecoding/growth` 候选，而不是直接写入学习包或共享 Skill

## 核心契约

- 严格分离五层：证据清单、无风格学习内容契约、风格提示词包、带风格学习内容、HTML 阅读器。图文比喻卡和图片提示属于内容契约的一部分，不单独分叉渲染器。
- 默认模式由配置开启；即使自动模式关闭，手动生成也必须可用。
- 学习包统一归档到 `.open-vibecoding/learning/archive/<packageId>/`。
- 项目级预防 Skill 单独放在 `.open-vibecoding/knowledge/skills/`，不要把复发预防规则只埋在学习电子书里。
- `.open-vibecoding/growth/` 只保存待确认配置、规则和偏好候选；经用户确认后才固化为项目共享配置或 user-local 偏好。
- 每一条结论都必须能追溯到 source id、路径、摘录和 digest。
- 除专门的 Markdown 阅读稿外，不要把叙事正文和 provenance 元数据混在同一个文件里。

## 工作流程

1. 从 `.open-vibecoding/state/current.json`、`.open-vibecoding/state/task-graph.json`、当前 PRD 产物、`docs/basic` 和最近的 loop 报告重建上下文。
2. 选择主题、题材和可选子风格。默认使用 `internet-product`；对 `xianxia` 默认使用 `cultivation` 提示词包。
3. 先构建 `evidence-manifest.json`。凡是无法追溯的句子，都标成推断。
4. 先生成中性的 `learning-content.json`，再加载风格提示词包并运行 Agent-in-the-loop 风格迁移；对产品或非技术读者优先补 `visualExplainer` 图文比喻卡。
5. 在内容契约里记录提示词包 id、提示词文本、风格迁移报告、图文讲解字段和质量检查结果。
6. 把 `reader.html` 渲染为固定电子书界面：有书式目录、章节分页、正文独立滚动、进度、上一章/下一章、字体控制、章节级 source 锚点，以及章节内可选的图文比喻卡与图片槽位。不要把单个检索题放进目录。
7. 把 `learning-package.json`、`learning-content.json`、`learning-content.md`、`evidence-manifest.json` 和 `reader.html` 一起写入归档目录。
8. 更新 `.open-vibecoding/learning/index.json` 和 `.open-vibecoding/learning/current.json`，让后续任务能快速找到最新学习包。
9. 当配置允许自动打开时，在学习包创建后自动打开阅读器。
10. 如果学习包记录的是已验证修复、重复问题、隐藏调试路径或 Agent 误判，显式运行 `open-vibecoding quality <path> --learn --from <turn-state|diagnostics|legacy-report.json>`；不要由默认收口自动生成候选。

## 章节结构

每个学习包都尽量覆盖这些模块：

- 解释学习包为何存在的叙事开场
- 点名相关 `.open-vibecoding/` 文件和工作流状态的系统地图章节
- 帮助产品或非技术读者先建立直觉的图文比喻卡
- 区分事实、claim 和推断的 provenance 章节
- 让读者回忆关键机制的检索模块
- 展示如何迁移到新场景的工作示例模块
- 告诉读者下一步做什么的收束章节

## 扩展规则

- 新增题材时，扩展题材参考库，不要分叉渲染器。
- 内容契约必须版本化；当结构变化时，引入新的 schema 版本。
- 即使文风变化，证据清单中的 source id 和路径也必须保留。
- 保持 HTML 阅读器稳定，确保历史归档学习包在未来仍可重新打开。

## 参考资料

- `references/prompt-engineering.md`
- `references/style-packs/xianxia-cultivation.prompt.md`
- `references/genre-library.md`
- `references/content-contract.md`
- `references/evidence-manifest.md`
- `references/ebook-reader.md`
- `references/retrieval-worked-example.md`
- `references/quality-rubric.md`

## 输出期望

最终产物应该像真正可阅读的学习材料，而不是套了浏览器壳的 JSON 导出。内容是主角，阅读器只是稳定的承载框架。
如果目标读者不是工程师，优先把它做成“先看懂，再深读”的图文短课，而不是技术复盘手册。
