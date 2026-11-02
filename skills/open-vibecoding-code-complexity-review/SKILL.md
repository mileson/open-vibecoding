---
name: open-vibecoding-code-complexity-review
description: 代码变更或重构需要判断函数是否过于复杂且缺少有效测试时，使用 Crapper 检查复杂度、覆盖率与 CRAP，定位值得改善的函数。
---

# 检查复杂度与测试覆盖

内部研发能力，独立调用 [Crapper](https://github.com/unclebob/crapper)。先读取已安装的 `$open-vibecoding-code-quality` 下 `references/quality-tools.md`，核对工具版本、语言支持、目标源码与覆盖率来源。

- 在目标项目根目录调用已核实环境的 `python -m crapper --use-existing-coverage --threshold 10 <本次目标路径>`；实际命令与路径按工具本地帮助确认。目标必须存在，不能将扫描空集当作通过。
- 默认改善目标为每个受检函数 CRAP 小于 10。CLI 的阈值退出与该严格条件可能不同，等于 10 也要读报告判断，不能仅凭退出码判断。
- CRAP 结合分支复杂度与测试覆盖率。缺失报告、报告过期、测试失败或工具把采集失败记成 0% 时，先解决证据问题；`--no-coverage` 只可报告复杂度，不能报告 CRAP 已通过。
- 先考虑补有意义的行为测试或按职责拆分；保持代码可读，不为数字拆空函数，也不机械拆每个 switch/case。
- 报告测量范围、有效覆盖率来源、需要改善的函数及理由。通过也只表示该范围的测量结果，不代表业务验收或整个项目质量通过。
