# OpenPrd 首轮项目画像与自适应需求初始化

## 背景与原因

OpenPrd 在用户第一次提需求时虽然已经有 consumer / b2b / agent 分流、clarify 和后续 review/change/tasks 流程，但缺少一个项目级的首轮画像层。结果是 Agent 容易直接围绕局部需求推进，而没有先确认用户群体、产品形态、第一版切片、先不做什么、不能破坏什么，以及是否命中技术和业务风险。

## 变更内容

- 在 clarify、intake-reflection 和 interview 中加入首轮项目画像层
- 让系统先推断 consumer / b2b / agent 与项目形态，再结合第一版切片、非目标、保护项组织追问
- 命中技术和业务风险信号时再展开前后端、数据、账号、AI、外部服务、收费等边界问题
- 同步更新模板、技能说明、基础文档、CLI 输出和相关测试
- clarify 生成的 intake-reflection 应包含首轮项目画像和风险探针
- inline clarification 应显式展示适用对象、产品形态、第一版先做、先不做、不能破坏和技术落点
- 冷启动 kickoff 问题改成画像导向问题，而不是抽象的通用提问
- 类型专项 intake 模板改成更贴近产品与业务语言的提问方式
- workspace-workflow 能生成首轮项目画像、风险探针和更贴近用户语言的确认问题
- workspace-core 的冷启动 kickoff 问题升级为画像导向问题
- intake 模板、skills、docs、CLI 文本输出和测试与新流程保持一致

## 能力范围

- `agent-requirements`: OpenPrd 首轮项目画像与自适应需求初始化 需求。

## 影响范围

- 主要用户: 第一次用 OpenPrd 梳理产品想法的产品经理、独立开发者与 Vibe Coding 用户
- 主要用户: 需要在模糊需求下帮助用户收敛方向并继续落地的 Agent 协作者
- 成本来源: 本次没有新增第三方付费调用；成本主要来自不准确需求初始化带来的返工和错题
- 额度限制: 不应让每个首次提需都退化成长问卷；默认只问最少必要问题
- 依赖: 依赖现有 requirement-intake gate、clarify/capture/synthesize/review/change/tasks 工作流
- 依赖: 依赖现有 base / consumer / b2b / agent 模板与评审产物体系
- 风险: 如果问题过多，会损伤首次提需体验
- 风险: 如果画像层和现有 capture/analysis 脱节，会造成重复提问
- 风险: 如果没有处理旧上下文切换，hook 可能继续把代码修改指向错误 change
