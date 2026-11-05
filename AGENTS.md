<!-- OPEN_VIBECODING:AGENTS:START -->
## Open VibeCoding

用户直接描述任务。Agent 自主理解、拆解、执行和验证；Open VibeCoding 只按场景提供能力和非阻断提醒，不规定固定流程。

### 场景入口

- 按当前客户端读取项目内入口：Codex：`.open-vibecoding/harness/internal-skills/open-vibecoding-router/SKILL.md`；Claude：`.claude/skills/open-vibecoding-router/SKILL.md`；Cursor：读取当前工具的路由源文件 `/Users/chaojifeng/Projects/harness-engineer/open-vibecoding/skills/open-vibecoding-router/SKILL.md`。路径相对于本文件所在项目，不相对于终端当前目录。具体 CLI 查本项目的 `.open-vibecoding/harness/command-catalog.md`。
- 开始任务或目标改变时，按用户目标判断相关场景，读取所选子能力后落实其中适用的方法。已有上下文足够时复用；不要求重复读文件。需要时用一句业务语言说明采用的方法，交付说明实际验证与缺口。
- 当前安装的 CLI：`node "/Users/chaojifeng/Projects/harness-engineer/open-vibecoding/bin/open-vibecoding.js"`；未安装全局命令时使用此入口，不调用旧版命令。
- 产品、交互、研发、测试和工具增强各有独立场景 Skill；按用户意图和现有证据选择，不用固定关键词匹配。场景目录见 `open-vibecoding capabilities list`。
- 为已有产品设计界面或生成效果图前，即使只画一个弹窗且不写代码，也先读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-design-context/SKILL.md`，主动查看目标界面、相关截图与样式组件；将参考带入生成并在交付前自查，不等用户提醒。
- 设计、实现或审查界面时，按实际视觉问题读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-visual-refinement/SKILL.md`，整理层级、对齐、空间、字体、色彩与图标，核对业务含义和实际尺寸；继承项目风格，不固定主题或像素门槛。
- 创建或修改用户可见的界面、效果图、文案或导出内容时，读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-public-content-boundary/SKILL.md`，将制作过程、实现说明与内部规则隔离在成品之外；用户明确要求时才写入指定文档。交付前检查实际结果并修正源头，保留必要业务反馈，不按禁词表判断。
- 研发复杂度提醒用 `$open-vibecoding-requirement-intake`，验证策略用 `$open-vibecoding-test-strategy`；需要外部事实时用 `$open-vibecoding-benchmark-router`。
- 已授权代码变更按实现行为、整理质量、工程收尾三个研发阶段推进；主动读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-code-quality/SKILL.md`，组合 Crapper、Dryer、Mutator 独立检查能力；保留真实用户验收，不生成阶段文档或逐步操作日志。
- 用户无特殊要求时采用最小足够资源方案；实现、构建、测试或部署涉及环境、缓存、镜像与产物时，主动读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-resource-efficiency/SKILL.md`，检查复用、保留边界和安全收尾；不默认过度冗余，不把精简原则当删除授权。
- 功能会消耗有限资源或改变使用权益时，主动读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-resource-entitlement-design/SKILL.md`，检查资源来源、消费恢复、运营配套与用户反馈；复用已有机制，不默认收费或新建后台。
- 故障修复或性能优化主动检查复发时的诊断盲区；方法见内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-diagnostic-readiness/SKILL.md`。现有证据够用则复用，不机械加日志；测试读回验证，不自动开启长期监控。
- 音频与语音证据用 `$open-vibecoding-audio-evidence`；图标主动获取与统一风格用 `$open-vibecoding-icon-system`。两者归属增强能力，按需由研发、交互与测试复用。
- 图片或界面需要精确定位、对齐、添加或局部调整时，主动读取内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-visual-localization/SKILL.md`，用红色坐标网格与局部放大核对，并区分图片、预览与屏幕坐标；需要圈选说明时组合图片标注能力。普通看图不强制网格，最终检查无网格结果。
- 界面视觉审查、修改与复查结束时，落实内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-visual-evidence-delivery/SKILL.md`：最终回复直接展示本轮实际截图；有确认参考时展示参考与实现，无参考时也展示最终实际界面。只给路径或文字不算展示，无法取图则明确视觉未验证。
- 横向最佳实践用 `$open-vibecoding-best-practices` 按项目条件选择；iOS 多语言用 `$open-vibecoding-ios-localization`，资源格式与调用 API 分别判断兼容性。
- `$open-vibecoding-shared` 提供安全、语言、浏览器、小程序与文案规则；`$open-vibecoding-harness` 提供按需工具说明。用户需要 HTML 评审时，读取 harness 的 `references/review-handoff.md`，统一复制当前评审结果、左侧图标与反馈状态，并采用结论先行和业务案例；普通任务不因此生成评审页面。

### 默认行为

- 规划、诊断、评审请求保持只读；明确实现或继续时在用户范围内推进。真实歧义会改变结果时才询问。
- 不要求生成 requirement、PRD、review.html、change 或 tasks；不在后台补写这些材料。Agent 按自身方式拆解复杂任务，不交出规划权。
- 代码是默认实现说明。仅当用户要文档、现有说明因改动失真，或跨系统合同确需说明时写文档。
- 视觉参照和实现截图、风险验证结果、外部动作读回等不可从代码可靠重建的证据按需保留；普通任务不为留痕生成文件。
- 既有 `.open-vibecoding/` 历史资料保留，只读参考；旧版生成和推进命令已退役。
- UI 方向评审和视觉比较按用户目标及变化规模使用；不把轻量 UI 微调机械升级成三方向流程。
- 测试强度按风险选择；构建成功不代替必要的真实运行态或视觉证据。
- 高影响外部动作遵守宿主安全规则、真实权限和用户范围；工具提示不代替授权。
- 自动化任务遵循自己的 runbook，不因旧版 Open VibeCoding 状态文件缺失而阻断。
<!-- OPEN_VIBECODING:AGENTS:END -->
