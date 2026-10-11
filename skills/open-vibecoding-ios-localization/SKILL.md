---
name: open-vibecoding-ios-localization
description: 为 iOS/Apple 项目的多语言实现和迁移选择 String Catalog 与适用的现代本地化接口，保留翻译、表与 bundle 语义，并检查构建产物及真实语言表现。
---

# iOS 多语言最佳实践

属于最佳实践板块，供研发、交互和测试调用。先检查 Xcode/CI 工具链、Swift 与 SDK、最低部署版本、资源与 target、table/bundle 查找、自定义语言切换及现有支持语言。当前推荐以 Xcode 15+ 的 String Catalog（`.xcstrings`）管理本地化资源；执行前按本项目的实际版本核实。[依据与版本边界](references/apple-localization.md)

资源格式和调用 API 分别判断：catalog 会编译为运行时本地化资源，采用它不等于必须提高最低系统版本。现代 API 是否可用要查 SDK availability 与目标版本。SwiftUI 优先保留可提取的本地化字面量/类型；需要普通字符串时评估 `String(localized:)`，需要传递本地化资源时评估 `LocalizedStringResource`。不要为了方便统一先转成普通 `String`，丢掉提取或延迟解析能力。动态键和特殊语言切换沿用明确查找合同，不凭变量类型推断 Xcode 一定会自动提取。

新代码在条件允许时采用现代做法。`NSLocalizedString`、已有 `.localized` 包装或传统资源可能仍因旧系统、Objective-C、第三方 bundle、动态语言切换而需要；这是具体兼容理由，不把它们说成已被官方弃用，也不把历史包装作为所有新 SwiftUI 代码的默认模板。

已有 `.strings` / `.stringsdict` 迁移按表和 target 保留语义，可以逐步推进；多个 catalog 是合理组织方式。默认表通常为 `Localizable.xcstrings`；涉及可本地化 Info.plist 文案时按实际 target 维护 `InfoPlist.xcstrings`。保持项目源语言及已有支持语种，不统一改为中文或虚构已完成的翻译。

保留各语言值、注释、复数/参数及设备变体；同名 key 在不同表中可以有不同含义。合并主表仅在项目明确受益时采用，先处理冲突及调用映射，不能直接覆盖。特殊 bundle、语言选择和 fallback 逐路径检查；字符串等于 key 不一定表示翻译缺失，不据此盲目向别的表/语言回退。

验证覆盖迁移前后实际 `(target, bundle, table, key, language, variation)`，核对缺失、冲突、占位参数及复数行为；缺失译文与资源迁移结果分别报告。确认 Xcode target/资源引用与实际构建产物，catalog 编译得到 `.strings` / `.stringsdict` 是正常现象，不能把 bundle 内这些文件当残留源码删除。第三方资源包按其归属检查，不为目录整洁改动依赖。

需要运行证据时检查现有语言、fallback、参数、复数、语言切换及真实控件的截断和布局；复用当前运行环境，不能只因构建成功就声称多语言体验已通过。移除旧源资源前确认覆盖和打包结果，保留可回滚的版本差异。按任务风险选择足够检查，报告未验证项，不要求额外留痕文件。
