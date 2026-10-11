# 视觉评审资产

这是 Agent 内部工具，不要求用户记命令。先取得真实生图输出文件，再调用；工具不生成候选设计。

`open-vibecoding design-review <project> --action save --json-file <input.json>`

```json
{"scene":"chat","images":[{"path":"/absolute/direction-a.png","label":"阅读优先"},{"path":"/absolute/direction-b.png","label":"对话优先"},{"path":"/absolute/direction-c.png","label":"任务优先"}]}
```

scene 是按业务页面或目标命名的安全目录标识（小写字母、数字、短横线或下划线），不是意图匹配关键词。每次支持 1–9 张单帧 PNG/JPEG/WebP，单张不超过 32 MiB、4000 万像素。图片路径相对于项目或使用绝对路径。多个候选自动编号；原图按字节保留，拼图仅等比缩放预览，不裁剪、不拉伸。需要细看时同时链接原图。

输出 `design/chat/v001/originals/option-01.png` 等原图、`review.png` 编号拼图、轻量资产索引 `review.json`；后续调用递增版本。原图与拼图都必须保存，在回复里嵌入 `chatEmbed`。不要把生成成功当成视觉质量通过，检查拼图可读性及原图。

用户明确选定后调用：

`open-vibecoding design-review <project> --action select --json-file <selection.json>`

```json
{"scene":"chat","version":"v001","option":"option-02","confirmed":true}
```

`confirmed` 仅在用户确实选择该版本、该候选时使用；模糊指代先结合所展示的版本判断，无法确定再询问。工具生成同版本 `option-02-final.png`，内容与原图完全相同；`design/chat/index.json` 的 `currentFinal` 指向当前选定原图。换版本或改选保留旧 final 与原图，不通过扫描文件名或取最新目录推断当前选择。

后续开发与视觉验收读取当前任务对应 scene 的 `currentFinal` 原图，不读取拼图；未选定时沿用用户提供的明确参考或说明默认方向，不伪造 final。失败时说明实际缺口，不声称已留底或已选定。已有旧资产不自动搬移，不强制为普通 UI 微调生成版本或流程文档。
