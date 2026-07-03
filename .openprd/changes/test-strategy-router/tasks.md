# 任务

- [x] T001.01 评审生成的 spec 覆盖
  - type: governance
  - done: 生成的 agent-requirements spec 符合 PRD 意图
  - verify: openprd change . --validate --change test-strategy-router

- [ ] T001.02 接通界面入口、导航与页面挂载
  - type: implementation
  - deps: T001.01
  - done: 用户可以从正确入口进入对应界面，页面挂载与状态收尾已经接通。 涉及: 依赖现有 openprd-quality、openprd-requirement-intake、openprd-harness 和 Agent 。
  - verify: openprd run . --verify

- [ ] T001.03 实现新增测试策略分流指引，定义风险驱动的证据矩阵和需求分流后的默认验证建议
  - type: implementation
  - deps: T001.02
  - done: 已完成：新增测试策略分流指引，定义风险驱动的证据矩阵和需求分流后的默认验证建议
  - verify: openprd run . --verify

- [ ] T001.04 实现OpenSpec 任务支持测试层级、测试规模、验证范围等测试策略元数据，并在校验中校验取值
  - type: implementation
  - deps: T001.03
  - done: 已完成：OpenSpec 任务支持测试层级、测试规模、验证范围等测试策略元数据，并在校验中校验取值
  - verify: openprd run . --verify

- [ ] T001.05 实现任务生成时根据实现、主流程闭环、验收、非功能、边界和失败模式推导默认测试策略
  - type: implementation
  - deps: T001.04
  - done: 已完成：任务生成时根据实现、主流程闭环、验收、非功能、边界和失败模式推导默认测试策略
  - verify: openprd run . --verify

- [ ] T001.06 实现质量评估检测测试命令、测试目录、证据来源和激活任务，输出测试策略矩阵
  - type: implementation
  - deps: T001.05
  - done: 已完成：质量评估检测测试命令、测试目录、证据来源和激活任务，输出测试策略矩阵
  - verify: openprd run . --verify

- [ ] T001.07 实现循环提示和完成报告展示本任务测试策略、执行命令、结果和证据路径
  - type: implementation
  - deps: T001.06
  - done: 已完成：循环提示和完成报告展示本任务测试策略、执行命令、结果和证据路径
  - verify: openprd run . --verify

- [ ] T001.08 实现Agent 指引、README 和基础文档同步说明测试分流流程
  - type: implementation
  - deps: T001.07
  - done: 已完成：Agent 指引、README 和基础文档同步说明测试分流流程
  - verify: openprd run . --verify

- [ ] T001.09 打通主流程闭环：用户提出需求后，OpenPrd 先做需求分流，再由测试策略分流器给出最低验证组合和升级条件 等 3 项
  - type: implementation
  - deps: T001.08
  - done: 主流程关键节点已经打通，用户可以按预期从入口走到结果收尾。涉及: 用户提出需求后，OpenPrd 先做需求分流，再由测试策略分流器给出最低验证组合和升级条件 等 3 项。
  - verify: openprd run . --verify

- [ ] T001.10 验证OpenPrd 生成的任务支持测试策略元数据，并保留现有完成条件和验证命令行为兼容
  - type: verification
  - deps: T001.09
  - done: 已验证：OpenPrd 生成的任务支持测试策略元数据，并保留现有完成条件和验证命令行为兼容
  - verify: openprd run . --verify

- [ ] T001.11 验证新增 openprd-test-strategy skill 或等价的标准指引，并被 Codex、Claude、Cursor 生成物引用
  - type: verification
  - deps: T001.10
  - done: 已验证：新增 openprd-test-strategy skill 或等价的标准指引，并被 Codex、Claude、Cursor 生成物引用
  - verify: openprd run . --verify

- [ ] T001.12 验证质量评估报告包含测试策略矩阵，不把固定比例作为硬阻断
  - type: verification
  - deps: T001.11
  - done: 已验证：质量评估报告包含测试策略矩阵，不把固定比例作为硬阻断
  - verify: openprd run . --verify

- [ ] T001.13 验证本地测试覆盖任务元数据解析、任务生成、质量检测、循环报告和生成 skill 更新
  - type: verification
  - deps: T001.12
  - done: 已验证：本地测试覆盖任务元数据解析、任务生成、质量检测、循环报告和生成 skill 更新
  - verify: openprd run . --verify

- [ ] T001.14 回归非功能约束：新增能力必须保持现有任务文件和旧 change 兼容，缺少测试策略字段时给出默认推导或提示 等 2 项
  - type: verification
  - deps: T001.13
  - done: 非功能约束已经回归确认。涉及: 新增能力必须保持现有任务文件和旧 change 兼容，缺少测试策略字段时给出默认推导或提示 等 2 项。
  - verify: openprd run . --verify

- [ ] T001.15 回归非功能约束：报告文案面向普通用户，避免把内部实现细节直接写成用户说明 等 2 项
  - type: verification
  - deps: T001.14
  - done: 非功能约束已经回归确认。涉及: 报告文案面向普通用户，避免把内部实现细节直接写成用户说明 / 质量结论以本次执行证据为准，脚本存在只能说明具备能力。
  - verify: openprd run . --verify

- [ ] T001.16 回归边界条件与失败处理：边界情况：小改动触碰权限、数据写入、命令行或接口契约、生成物或用户主路径时，需要从单元测试升级到集成测试或端到端 等 7 项
  - type: verification
  - deps: T001.15
  - done: 边界条件与失败处理已经回归确认。涉及: 边界情况：小改动触碰权限、数据写入、命令行或接口契约、生成物或用户主路径时，需要从单元测试升级到集成测试或端到端测试 等 7 项。
  - verify: openprd run . --verify

- [ ] T001.17 验证成本与额度护栏
  - type: verification
  - deps: T001.16
  - done: 已验证免费、试用或低权限用户不能绕过额度、并发、频率或总量限制
  - verify: openprd run . --verify

- [ ] T001.18 验证滥用与越权路径
  - type: verification
  - deps: T001.17
  - done: 已覆盖重复请求、并发请求、越权身份和异常恢复等负向场景
  - verify: openprd run . --verify

- [ ] T001.19 验证成本监控、报警和止损
  - type: verification
  - deps: T001.18
  - done: 已确认用量或成本信号、报警阈值和人工/自动止损动作可执行
  - verify: openprd run . --verify

- [ ] T001.20 维护 docs/basic 项目基础文档
  - type: documentation
  - deps: T001.19
  - done: 已检查 docs/basic 是否缺失或因本次需求、流程、结构、依赖、产品行为变化而过期；若涉及后端、脚本、Agent 或工具链变更，已同步评估 CLI 与 API 接入面，并在 backend-structure.md 中记录事实或不适用原因；需要更新的基础文档已同步
  - verify: openprd standards . --verify

- [ ] T001.21 更新文件说明书和文件夹 README
  - type: documentation
  - deps: T001.20
  - done: 本次变更涉及的文件说明书和文件夹 README 已检查；缺失的已补齐，过期的已更新
  - verify: openprd standards . --verify

- [ ] T001.22 运行 OpenPrd spec 校验
  - type: governance
  - deps: T001.21
  - done: 生成的 change 通过 OpenPrd 校验
  - verify: openprd change . --validate --change test-strategy-router
