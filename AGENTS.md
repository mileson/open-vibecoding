<!-- OPEN_VIBECODING:AGENTS:START -->
## Open VibeCoding

用户直接描述任务。Agent 自主理解、拆解、执行和验证；Open VibeCoding 只按场景提供能力和非阻断提醒，不规定固定流程。

### 场景入口

- 按当前客户端读取项目内入口：Codex：`.open-vibecoding/harness/internal-skills/open-vibecoding-router/SKILL.md`；Claude：`.claude/skills/open-vibecoding-router/SKILL.md`；Cursor：读取当前工具的路由源文件 `/Users/chaojifeng/Projects/harness-engineer/open-vibecoding/skills/open-vibecoding-router/SKILL.md`。路径相对于本文件所在项目，不相对于终端当前目录。具体 CLI 查本项目的 `.open-vibecoding/harness/command-catalog.md`。
- 开始任务或目标改变时，按用户目标判断相关场景，读取所选子能力后落实其中适用的方法。已有上下文足够时复用；不要求重复读文件。需要时用一句业务语言说明采用的方法，交付说明实际验证与缺口。
- 当前安装的 CLI：`node "/Users/chaojifeng/Projects/harness-engineer/open-vibecoding/bin/open-vibecoding.js"`；未安装全局命令时使用此入口，不调用旧版命令。
- 产品、交互、研发、测试和工具增强各有独立场景 Skill；按用户意图和现有证据选择，不用固定关键词匹配。场景目录见 `open-vibecoding capabilities list`。
- 研发复杂度提醒用 `$open-vibecoding-requirement-intake`，验证策略用 `$open-vibecoding-test-strategy`；需要外部事实时用 `$open-vibecoding-benchmark-router`。
- 故障修复或性能优化主动检查复发时的诊断盲区；方法见内部能力 `.open-vibecoding/harness/internal-skills/open-vibecoding-diagnostic-readiness/SKILL.md`。现有证据够用则复用，不机械加日志；测试读回验证，不自动开启长期监控。
- 音频与语音证据用 `$open-vibecoding-audio-evidence`；图标主动获取与统一风格用 `$open-vibecoding-icon-system`。两者归属增强能力，按需由研发、交互与测试复用。
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
