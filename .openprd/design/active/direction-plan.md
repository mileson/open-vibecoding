# Direction Plan

| 方向 | 生成逻辑 | lens | theme | layout | 审美主张 | 记忆点 | 为什么不同 | 适用场景 | 主要风险 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A 业务评审导览 | contrast | progressive disclosure | guided review | 左侧议程 + 中央业务故事图 + 底部确认 | 最低认知负担 | 一步一块完成评审 | 从业务阅读顺序出发，隐藏工程细节 | 非技术用户首次评审 | 工程追溯需要另开入口 |
| B 双轨证据工作台 | reference-transfer | evidence-first | dual projection | 共享时间线 + 业务/工程 Tab + 证据工作区 | 同一事实，多种读法 | 一条时间线，两种视角 | 把现有 Review 与证据链整合为同一模型双投影 | 产品与工程共同评审 | 信息密度较高，需要默认收起细节 |
| C 项目驾驶舱 | design-lens | operational overview | control room | 健康总览 + 并行任务 + 迁移/上下文侧栏 | 全局态势一屏掌握 | 项目健康与资源雷达 | 把评审放进项目级控制平面 | 多线程项目负责人 | 容易把 0.1.20 范围扩大成完整项目管理器 |

## 内部评估

| 维度 | A | B | C |
| --- | ---: | ---: | ---: |
| 小白可理解性 | 5 | 4 | 3 |
| 工程可追溯性 | 2 | 5 | 4 |
| 与现有 Review 兼容 | 4 | 5 | 3 |
| 控制平面定位 | 3 | 5 | 5 |
| 0.1.20 可落地性 | 5 | 4 | 2 |
| 合计 | 19 | 23 | 17 |

- 选 B 为主方向。
- 吸收 A 的左侧议程与逐步确认，避免双轨变成工程后台。
- C 保留为后续 Project Cockpit 投影，不塞进本轮 Review 主页面。

## 0.1.24 局部视觉证据方向

- lens: evidence-first + local precision
- aesthetic: 直接、克制、尺度可信，不用巨大全屏画布稀释有效区域。
- layout: 标题后直接展示局部参考/实现，紧接 difference，全屏回归缩略图收在 footer。
- memory-point: 一眼看到真正改了哪里，尺寸差异不会被拉伸掩盖。
