# Asset Spec

| 类型 | 资产 | 来源 | 状态 | 备注 |
| --- | --- | --- | --- | --- |
| logo | 复用 OpenPrd 现有文字标识 | 当前 Review topbar | reuse | 不重新设计品牌 |
| 产品图 | Review Studio 三方向接触表 | Image 2 + `visual-prepare` | ready | `.openprd/design/active/review-studio-v020-directions/contact-sheet.jpg` |
| UI 图 | 业务导览、双轨证据、项目驾驶舱三个候选 | Image 2 裁切 | ready | `crops/01.png`、`02.png`、`03.png` |
| 功能图标 | 评审、证据、风险、任务、版本、迁移、上下文 | 复用现有内联图标语义；实现期统一为已有 outline 体系 | planned | 不新增装饰性图标 |
| 摄影 / 插图 | 无 | 不需要 | not-needed | 产品成立不依赖真实图片 |
| 色板 / 字体 | 复用现有 Review tokens 与系统字体 | 当前 Review CSS | reuse | 保持可访问对比度 |
| 动效节奏 | 仅视图切换、证据展开、确认反馈 | 产品交互需求 | planned | 120–180ms，尊重 reduced-motion |
| 背景 / 表面 | 中性灰画布 + 白色内容面 + 轻边框 | 当前 Review CSS | reuse | 避免玻璃拟态与渐变 |
| 构图记忆点 | 顶部共享决策时间线 + 业务/工程双视图 | 方向 B | selected | 两种视图共享同一 model digest |

## 冻结变量

- lens: evidence-first progressive disclosure
- theme: quiet professional control plane
- layout: shared timeline + dual projection workbench
- aesthetic: restrained, dense, calm, explainable
- memory-point: 一条时间线，两种视角

## 0.1.21 结果画布资产

- 色彩：暖灰画布 `#f4efe6`、纸白表面 `#fffdf8`、陶土强调 `#c65f3f`、通过状态 `#39795c`。
- 图片：直接复用用户提供的真实截图，不增加装饰图片或默认网格覆盖层。

## 0.1.24 局部证据资产

- 主证据：参考局部、实现局部和 difference blend，三者使用同一像素尺度。
- 上下文：左右全屏缩略图仅放在 footer，不与局部裁决争夺视觉重心。
- 辅助线：仍只在 `alignment-board` 中使用，`local-first` 不自动叠加网格。
