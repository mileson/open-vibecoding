# Selected Direction

- selected: B 双轨证据工作台
- reason: 在小白可理解、工程可追溯、现有实现兼容和控制平面定位之间得分最高；同一 ReviewModel 可直接支撑两种投影，避免形成两套真相。
- lens: evidence-first progressive disclosure
- theme: quiet professional control plane
- layout: 共享决策时间线 + 业务/工程双视图 + 可展开证据区
- aesthetic: 克制、清晰、可信、信息密度可控
- memory-point: 一条时间线，两种视角
- components:
  - 共享决策时间线
  - 业务视角 / 工程视角切换
  - 左侧评审议程
  - 业务故事与风险卡
  - 工程证据、任务与版本追溯
  - 固定确认与修订动作栏
- follow-up risks:
  - 默认必须打开业务视角，工程信息按需展开。
  - 两种视图必须共享同一 model digest，样式重渲染不能使业务确认失效。
  - 实现后需要业务词泄漏检查、同构卡片对齐板和真实浏览器截图证据。

## 0.1.21 补充方向：紧凑结果画布

- scope: `visual-compare` 最终结果展示。
- aesthetic: 温暖、直接、低装饰，截图占主要面积。
- memory-point: 用户一眼看到“比了什么、是否通过”。
- routing: 普通结果无网格；只有布局、间距、对齐或同构结构进入 `alignment-board`。
