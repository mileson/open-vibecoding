# Apple 本地化依据与使用边界

核验日期：2026-10-02。相关性：资源格式、调用方式、迁移与构建的官方说明；时效性：String Catalog 起始于 Xcode 15，具体 SDK/API 在采用时复核；权威性：Apple 官方。页面最近修改时间及访问/互动指标未知，不用未知值替代事实。

官方来源：[Discover String Catalogs，WWDC23](https://developer.apple.com/videos/play/wwdc2023/10155/)、[Localizing and varying text with a string catalog](https://developer.apple.com/documentation/xcode/localizing-and-varying-text-with-a-string-catalog)、[LocalizedStringResource](https://developer.apple.com/documentation/foundation/localizedstringresource)。后两页为动态文档；若正文读取失败，以可读取的官方讲解和本地 SDK 类型为证据，不把页面标题当 API 用法证明。

- WWDC23 的 Extract/Build/Migrate 部分说明：Xcode 15 采用 catalog；一表一 catalog，可有多个表；构建为传统本地化资源，无需因此提高最低部署版本；可逐步迁移。
- String Catalog 是资源管理方式，`String(localized:)`、`LocalizedStringResource` 等是调用类型/API。检查 SDK availability 和使用语境，不混为一种“新语法”。
- 静态本地化字面量可以被抽取，动态构造的 key 需要明确维护；代码的提取设置和 target 影响覆盖。不要通过包装任意普通 String 假定自动提取成立。

项目条件决定怎样组织资源与查找。历史迁移中采用“多个表合并主表 + 表名命名空间”只能作为一个案例；更稳妥的初始选择通常是保留现有表边界，按实际收益再考虑合并。运行时语言切换、跨 bundle 和复数应保留真实验证样本，不能照搬某个项目的全局 fallback helper。

采用时只进一步核验当前需要的内容：工具链是否支持、所用 API 的目标版本和签名、抽取/打包设置、当前 framework 的资源归属。已有足够证据就停止扩展调研。
