# 三个配套工具的接入与调用

三个工具作为可调用的外部质量能力，分别由独立子 Skill 维护判断方法。Open VibeCoding 分发中文方法、参数与接入指引，不将第三方源码、Python 环境或每个项目的测试数据打包进去。Agent 从项目安装清单定位子 Skill，不要求用户记住工具名或命令。

## 已核实来源

2026-10-29 核对作者 README、启动脚本、包元信息及提交；DeepWiki 尚未索引三个工具，Context7 本轮额度不可用，因此用作者源码核验。运行前检查实际安装版本与当前本地帮助。

| 工具 | 核验提交 | 上游 |
| --- | --- | --- |
| Crapper | `6fd92c4c9bcc56efb64a2f8743d5a2993bcfd42d` | https://github.com/unclebob/crapper |
| Dryer | `66ff6d21a42c04afcad89c78a80066176d1294b0` | https://github.com/unclebob/dryer |
| Mutator | `a5a0cb803b66e0cdb8bf471b3b08af701d424a41` | https://github.com/unclebob/mutator |

三个包元信息要求 Python 3.11 及以上，依赖 tree-sitter 与 tree-sitter-language-pack，许可为 0BSD；这不表示 ub-mode 的 Skill 文本自动使用相同许可。中文指南独立表达方法，保留参考链接。

文档列出 Clojure、Java、Go、TypeScript、Rust、Python；Crapper 也说明 JS/JSX/MJS/CJS 和 TSX 的处理。分别核对其他工具当前版本的实际支持，不能因同系列就推断支持 Swift、Kotlin 或所有前端文件。语言不支持时复用项目已有工具，并准确区分替代验证与原工具执行。

## 安装策略

先检查已有工具、解释器和来源，不运行上游启动脚本来做无副作用探测：三个启动脚本首次调用会创建 `.venv` 并安装包，连帮助调用也可能触发安装。准备好环境后使用 Python 模块入口可避免这个引导副作用。

首次需要且用户已授权安装时，按当前官方说明，将三个仓库放在同一工具缓存目录的同级子目录，核对 origin 和版本；Mutator 文档要求相邻 `crapper` 源码。优先复用一个兼容的隔离 Python 环境，安装这些已核实本地 checkout，不改系统 Python，不在每个业务项目重复克隆或建环境。没有安装授权则说明缺口并给出上游入口；安装未完成不能称为已接入。

每个需要调用的项目只使用已有工具路径或现有配置；公共 Skill 不保存个人绝对路径。工具升级后先对有限样本复核参数与报告，再用于业务项目。安装、版本更新和全仓检查不随普通项目能力同步自动执行。

## 调用方式

以下的 `OVC_QUALITY_PYTHON` 是 Agent 核实后的隔离环境解释器路径，`OVC_QUALITY_TARGET` 是项目根目录内真实存在的相关文件或目录，`OVC_QUALITY_TEST_COMMAND` 是已经通过的相关测试命令；不是默认已配置的环境变量。调用前填入实际值，并先在项目根目录核对 `-m <工具> --help`。不要通过含有未核实用户文本的 shell 拼接构造命令。

```sh
"$OVC_QUALITY_PYTHON" -m crapper --use-existing-coverage --threshold 10 "$OVC_QUALITY_TARGET"
"$OVC_QUALITY_PYTHON" -m dryer --threshold 0.8 "$OVC_QUALITY_TARGET"
"$OVC_QUALITY_PYTHON" -m mutator --scan "$OVC_QUALITY_TARGET"
"$OVC_QUALITY_PYTHON" -m mutator --max-workers 1 --use-existing-coverage --test-command "$OVC_QUALITY_TEST_COMMAND" "$OVC_QUALITY_TARGET"
```

命令逐条执行并读结果，不整段盲跑。优先具体文件或有关目录；使用 `--changed` 前核对它在该版本包含哪些 Git 状态，不假定一定涵盖已提交代码或所有未跟踪文件。未扫描到目标时检查路径与语言支持。

## 运行成本与结果解释

- Crapper 默认会重新生成覆盖率，部分语言还会自动安装测试依赖；默认使用已验证且对应当前源码的覆盖率报告。没有报告时，先使用项目已有覆盖率命令生成并核对成功，不让一次分析悄悄安装整套依赖。缺失工具或测试失败可能被计作 0% 并写报告，必须与真实低覆盖区分。
- Crapper 的 `--threshold 10` 退出语义是高于阈值报错，而本指南目标为严格小于 10；等于 10、N/A、空结果都需读回处理。无覆盖率模式只证明已测得复杂度。
- Dryer 默认阈值 0.82，本指南显式用 0.8；输出是待判断的相似候选。默认最小行数 4、最小结构节点 20 会排除一些代码。报告成功和没有重复不是一回事。
- Mutator 默认可能按 CPU 核数并行，显式限制为一个 worker。先用 `--scan`，再对有限范围执行；已核实版本使用隔离 worker，但基线仍在真实项目目录执行，部分文件可能以链接共享，不能当作全项目沙箱。旧版本留下的备份可能触发恢复逻辑，存在残留时先核实归属，不直接启动非 scan 运行。
- Mutator 退出 0 表示已执行的变异都被发现，2 表示基线失败，3 表示存在存活变异；未覆盖代码可能未执行，超时和无法编译也可能算 killed。零执行、过期缓存、无效变异和环境故障不能证明测试充分。
- 工具会写 `.metrics/crap.edn`、`.metrics/dry.edn`、`.metrics/mutate/` 等结果。先核实是否有已有报告及消费方；只清理本任务无用临时资源，不擅自删历史基线或用户文件。报告按需保留，不作为强制留痕产物。

三个子能力各自说明发现、有效范围、未验证项和下一步；业务验收继续按测试模块执行。遇到不兼容或失败，先分析现有输出，不重装、堆开进程或换工具伪造相同度量。
