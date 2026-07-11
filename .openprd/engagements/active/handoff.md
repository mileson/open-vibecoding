# 交接

- 本次内容: OpenPrd 可解释项目控制平面与跨工具上下文升级
- 产品场景: 以 Agent 为主要使用场景
- 场景模板: 以 Agent 为主要使用场景
- 负责人: OpenPrd
- 下一步: 按阶段完成 P0 回归与协议冻结、P1-P8 纵向实现、全量验证、0.1.20 版本升级和真实本地项目分批刷新
- 交接去向: OpenPrd CLI、当前源码仓库、本机全局集成和所有真实活跃 OpenPrd 项目

## 变化摘要

- 新增：提供 project manifest、ledger append/read/head/verify/rebuild、projection replay API
- 新增：提供 task claim/heartbeat/release、lease recovery、write-set conflict、lane binding API 与 CLI
- 新增：提供 context compile/diff/cache/render/reference API，保持 run --context 兼容入口
- 新增：提供 scoped gate/evidence evaluation 与明确 approval ID 绑定
