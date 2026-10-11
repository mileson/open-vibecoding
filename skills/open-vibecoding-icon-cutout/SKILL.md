---
name: open-vibecoding-icon-cutout
description: 将已有图标位图保留透明度或按指定高对比纯色背景自动抠图，输出透明 PNG 与像素检查；适用于独立透明素材，复杂背景与满铺素材需另行判断。
---

# 图标透明化工具

先查看源图、确认主体与消费模式。只对需要透明独立素材的图标使用；满铺卡片不抠图。工具是可复用本地 CLI，不调用生图 API，也不需要用户手动运行。

已有正确透明通道时保留 alpha：

```sh
open-vibecoding icon-cutout --source /absolute/icon.png --out /absolute/icon-alpha.png
```

纯色背景与主体明显分离时，显式指定实际背景色：

```sh
open-vibecoding icon-cutout --source /absolute/icon-keyed.png --out /absolute/icon-alpha.png --key-color '#00ff00' --tolerance 30 --feather 35
```

`tolerance` 是 RGB 最大通道差的完全去除阈值，`feather` 是软边过渡宽度，均为 0..255，默认 30/35。工具在边缘按已知背景色去混色，保留原 alpha，不自动裁切、缩放或居中。输出必须为新 PNG；源文件和已有目标受到保护，输出父目录须已存在。限制输入至 16M 像素，按需串行处理。

没有透明像素或主体被全部去除时不写输出；JSON 返回透明/半透明/可见像素数、四角 alpha、主体边界、触边提醒。数字不证明主体没被误抠。与背景同色的主体、玻璃、复杂投影或纹理背景可能损失内容；查看输出与原图，在浅/深背景及实际尺寸比较，必要时改背景重新生成或使用当前可用精细抠图能力，不无依据地调大阈值。

这里只处理透明度；裁切、光学居中、风格与接入由图标统筹能力验收。按需用 `visual-compare` 的 centering-board 展示证据。
