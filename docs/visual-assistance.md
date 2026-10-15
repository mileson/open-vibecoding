# 视觉定位与图片标注

[English](./visual-assistance.en.md) · [返回首页](../README.md)

当用户要求“把这个按钮与上面的输入框对齐”或“圈出截图中需要修改的位置”时，Agent 需要确认目标和坐标。网格帮助观察，显式换算连接预览与原图，标注工具负责确定性绘制，最后仍要看图检查。

## 在什么场景使用

| 用户目标 | 处理方式与边界 |
| --- | --- |
| 按参考图调整组件位置 | 先看真实截图，精细定位时生成红色网格与局部图；实际界面操作继续遵守浏览器或 Computer Use 的坐标合同 |
| 将缩放预览中的框换回原图 | 声明预览的图片内容尺寸及其对应裁切区域，换算回原图像素；不知道比例时不能猜 |
| 解释哪里有问题或应该点击哪里 | 目标框包含完整按钮或菜单项，标签表达动作或结果，保护背景文字与相邻控件 |
| 只需要理解图片内容 | 直接理解，不为使用辅助工具而额外生成网格、标注或报告 |

方法提炼自 screenshot-annotator 的网格定位、完整目标边界、标签避让和视觉复核经验。这里保留轻量工具与独立子能力，不分发个人偏好、私密素材或整套教程流水线。

## 两个独立内部能力

- [视觉精确定位](../skills/open-vibecoding-visual-localization/SKILL.md)归属增强领域，负责红色网格、局部观察和坐标基准。
- [图片标注](../skills/open-vibecoding-image-annotation/SKILL.md)负责框选、动作标签与几何检查，按需复用视觉定位。

路由、视觉实现、验收和工具选择已接入场景提醒。Codex 中安装到内部能力目录，避免增加菜单噪声；Claude 与 Cursor 按各自适配方式读取。选择仍由 Agent 根据场景与证据完成，不靠固定关键词，也不规定新的开工流程。

## 可复现的工具样例

以下命令从已安装依赖的当前仓库根目录运行，直接使用源码 CLI，不依赖某个 npm 发布版本。输出使用尚不存在的新文件名，父目录须存在；再次运行请换文件名。

```sh
node bin/open-vibecoding.js visual-grid \
  --source docs/assets/open-vibecoding-visual-source.png \
  --out ./visual-grid-example.png --step 100

node bin/open-vibecoding.js image-annotate \
  --source docs/assets/open-vibecoding-visual-source.png \
  --out ./visual-annotation-example.png \
  --json-file docs/examples/visual-assistance/annotation-plan.json
```

输入为[合成测试图](./assets/open-vibecoding-visual-source.png)。[计划文件](./examples/visual-assistance/annotation-plan.json)绑定该原图的真实尺寸和 SHA-256，并声明按钮文字、说明与相邻控件保护区。网格图与标注图都来自同一原图，最终标注不叠加网格。

![工具实际生成的红色网格](./assets/open-vibecoding-visual-grid.png)

![工具实际生成的无网格标注](./assets/open-vibecoding-visual-annotated.png)

`visual-grid` 返回源尺寸、哈希及可选的 `mappedTargets`；缩放和裁切映射见[坐标合同](../skills/open-vibecoding-visual-localization/references/coordinates.md)。`image-annotate` 返回实际框位与标签位置，计划格式见[标注合同](../skills/open-vibecoding-image-annotation/references/annotation-plan.md)。这些输出供 Agent 使用，不要求用户自己填写坐标。

## 结果如何验收

原图不覆盖，已有输出拒绝覆盖。独立单点不编号，顺序动作使用数字，并列入口使用字母；标签避让保护区及其他目标，没有安全位置时缩短、换位置或拆图。原图变化会使计划失效，需要重新测量。

工具只检查已声明的几何关系，不执行 OCR 或自动识别目标。返回的 `awaiting_visual_review` 表示还需打开完整图、局部细节及实际显示尺寸检查，不能作为视觉通过或人工签核。网格坐标不直接用于屏幕点击或 CSS；页面滚动、缩放和窗口变化后需重新核对。

当前支持单帧 PNG、JPEG、WebP，输入最多 16M 像素及 64MiB；输出新 PNG。简单坐标映射支持明确的等比例缩放与裁切，旋转、透视、拼图或显示留白要先确定实际变换。轻量标注采用相邻标签，复杂箭头、批量教程和长图可按需组合专用能力。

源图、网格和局部图具有同样的隐私边界，不自动上传。对外分享时先确认授权并处理敏感信息，后续版本从同一安全副本派生。

## 概念图来源

首页概念图使用 Codex 原生生图生成，仅解释定位、标注与复核。它与上面的真实 CLI 样例分开，不用于证明精度。生成提示词保存在[配图提示词](./assets/open-vibecoding-visual-assistance-concept.prompt.txt)，仓库图片未包含个人账号或项目私密截图。
