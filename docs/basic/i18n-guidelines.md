# 多语言 (i18n) 最佳实践

## 适用范围

涉及用户可见文案的产品开发，不论平台（iOS、Web、小程序、Android 等），都应在首次写入文案时就按多语言架构编写。本文档提供各平台的最佳实践、示例和检查清单。

## 核心原则

1. **文案可本地化**：用户可见文案使用项目支持的本地化机制；SwiftUI 可提取字面量也是有效方式
2. **源语言遵循项目**：保持已声明的 `sourceLanguage` / 基准语言，不统一改为中文
3. **语言范围遵循产品**：同步已有支持语言，新增语种按产品目标决定，不虚构已完成译文
4. **翻译文件与代码分离**：翻译资源集中管理，不分散在各个组件/页面里
5. **意译优先**：英文翻译使用 native speaker 地道表达，不直译
6. **按载体压缩**：按钮、Tab、菜单和短标签按目标语言的软件产品习惯写成紧凑 UI 文案，不照搬源语言句式
7. **缩写必须无歧义**：只使用目标用户普遍理解的常见缩写；不要为了省空间发明行话或牺牲含义

## 目标语言原生化与紧凑 UI 文案

多语言不是“逐字翻译 + 填入语言文件”。先判断用户动作、控件类型、上下文和可用空间，再用目标语言母语者在软件产品中自然使用的表达重写。

| 文案载体 | 默认写法 | 英文示例 |
|---|---|---|
| 按钮、Tab、菜单、短标签 | 使用简短、自然、无歧义的惯用术语或动词短语 | `Auto Edit`，不要写 `Start Automatic Editing` |
| 弹窗标题、Toast、状态 | 直接说明结果或下一步，删掉界面已表达的冗余前缀 | `Saved` / `Try Again` |
| 弹窗正文、帮助、引导 | 信息需要解释影响、限制或恢复路径时使用完整自然句 | `Your draft is saved. You can continue later.` |
| Tooltip、Accessibility Label | 可见标签为节省空间而缩短时，补回完整语义 | `Start automatic video editing` |

缩写判断顺序：

1. 先找目标语言中已经存在的软件产品惯用词，而不是机械删字。
2. 只有目标用户普遍理解、当前上下文不会误解时才使用缩写。
3. 如果缩短后语义仍不清楚，保留更自然的短语，并调整控件宽度、换行或辅助说明。
4. 不使用临时造出的 `Gen`、`Cfg`、`Sub` 等含义不稳定的缩写，除非它们已经是该专业产品和目标用户公认的术语。
5. 完成翻译文件更新后，在真实界面逐语言检查语义、截断、异常换行、布局挤压和辅助功能名称。

## 用户可配置

项目级 i18n 配置文件：`.open-vibecoding/i18n-config.json`。以下为中文/英文项目示例，沿用实际项目语言与配置，不要求新建配置文件。

```json
{
  "version": 1,
  "defaultLanguage": "zh-Hans",
  "supportedLanguages": ["zh-Hans", "en"],
  "enforceOnDevCheck": true,
  "platforms": ["ios"],
  "translationStrategy": "key-value-file",
  "notes": "用户可随时修改此文件来调整默认语言、支持语种和检查策略"
}
```

| 字段 | 说明 |
|------|------|
| `defaultLanguage` | 基准语言，默认 `zh-Hans` |
| `supportedLanguages` | 当前需要支持的语种列表 |
| `enforceOnDevCheck` | dev-check 时是否主动检查硬编码文案 |
| `platforms` | 当前项目涉及的平台，用于加载对应最佳实践 |
| `translationStrategy` | `key-value-file`（默认）/ `inline` / `per-module` |

---

## iOS (Swift / SwiftUI)

### 推荐方案：String Catalog (.xcstrings)

条件允许时优先采用 Xcode 15+ 的 String Catalog 管理源资源。采用 catalog 与采用新 Swift API 是两项判断：前者会编译成运行时 `.strings` / `.stringsdict`，不因此要求提高最低系统版本；后者按本地 SDK availability 和项目部署版本核实。工具链/CI、第三方资源或兼容条件不足时保留有依据的旧路径。

完整的实施与迁移方法由独立能力 [iOS 多语言最佳实践](../../skills/open-vibecoding-ios-localization/SKILL.md) 维护；[Apple 官方介绍](https://developer.apple.com/videos/play/wwdc2023/10155/) 支持多个 catalog 和逐步迁移。资源目录与表的组织遵循当前项目，不强制扁平合并主表。

### 文件结构

```
YourApp/
├── Resources/
│   └── Localization/
│       ├── Localizable.xcstrings    # 默认表
│       └── Module.xcstrings         # 按实际模块需要拆表
└── ...                             # 按 target/bundle 保留资源归属
```

### .xcstrings 文件格式

```json
{
  "sourceLanguage": "zh-Hans",
  "version": "1.0",
  "strings": {
    "settings.title": {
      "localizations": {
        "zh-Hans": {
          "stringUnit": {
            "state": "translated",
            "value": "设置"
          }
        },
        "en": {
          "stringUnit": {
            "state": "translated",
            "value": "Settings"
          }
        }
      }
    },
    "camera.button.capture": {
      "localizations": {
        "zh-Hans": {
          "stringUnit": {
            "state": "translated",
            "value": "拍照"
          }
        },
        "en": {
          "stringUnit": {
            "state": "translated",
            "value": "Take Photo"
          }
        }
      }
    }
  }
}
```

### Key 命名规范

| 场景 | 格式 | 示例 |
|------|------|------|
| 页面标题 | `<module>.title` | `settings.title` |
| 按钮文案 | `<module>.button.<action>` | `camera.button.capture` |
| 标签文本 | `<module>.label.<name>` | `profile.label.username` |
| 提示文案 | `<module>.hint.<name>` | `search.hint.placeholder` |
| 错误消息 | `<module>.error.<type>` | `network.error.timeout` |
| 弹窗标题 | `<module>.alert.<name>.title` | `delete.alert.confirm.title` |
| 弹窗内容 | `<module>.alert.<name>.message` | `delete.alert.confirm.message` |

### 代码使用方式

```swift
// SwiftUI：保留可提取的本地化字面量
Text("Settings")
Button("Save") { /* action */ }

// 需要普通 String 时，先核实 API 与部署版本适用
let message = String(localized: "Saved")

// 需要传递本地化资源时，同样先核实 availability
let title = LocalizedStringResource("Settings")
```

以上是以英文源文本为例的 API 用法，不要求变更项目源语言或现有 key。使用稳定 key 时保留对应源值、注释及 table/bundle；动态构造的 key 不能假定自动提取。

### 语言切换与兼容

语言切换沿用项目已经验证的 locale、bundle 与 UI 更新机制；仅保存一个 AppStorage 值并不会证明资源查找已经切换。既有 `.localized` 或 `NSLocalizedString` 可因动态语言、旧系统、Objective-C 或第三方 bundle 需要而保留，不作为新 SwiftUI 实现的统一默认模板。资源迁移不自动授权全项目调用侧重写。

### 检查清单

- [ ] 本地化字面量、资源类型或兼容查找与当前工具链和部署版本匹配
- [ ] 源语言和已有支持语言保持正确，译文缺口单独说明
- [ ] 迁移保留各表 key 语义、注释、参数、复数与变体，不能覆盖同名冲突
- [ ] target/bundle 引用与构建产物正确；编译后的 `.strings` 不是残留源码
- [ ] 语言切换、fallback 及真实控件的文案布局已按所需范围验证
- [ ] 不要把协议匹配字符串、正则、调试日志做 i18n

---

## Web (React / Next.js)

### 推荐方案：JSON 翻译文件 + t() 函数

### 文件结构

```
src/
├── i18n/
│   ├── index.ts           # i18n 初始化与 hook
│   ├── zh-CN.json         # 中文翻译
│   └── en.json            # 英文翻译
└── components/
    └── Example.tsx         # 使用 t() 调用
```

### 翻译文件格式

```json
// zh-CN.json
{
  "common": {
    "save": "保存",
    "cancel": "取消",
    "confirm": "确认"
  },
  "settings": {
    "title": "设置",
    "language": "语言",
    "theme": "主题"
  },
  "error": {
    "networkTimeout": "网络超时，请稍后再试",
    "saveFailed": "保存失败，请重试"
  }
}
```

### 代码使用方式

```tsx
// Client Component
"use client";
import { useI18n } from "@/i18n";

function SettingsPage() {
  const { t } = useI18n();
  return (
    <div>
      <h1>{t("settings.title")}</h1>
      <button>{t("common.save")}</button>
    </div>
  );
}

// Server Component
import { tRuntime } from "@/i18n";

async function Page() {
  return <h1>{tRuntime("settings.title")}</h1>;
}

// 静态配置对象：用 labelKey
const menuItems = [
  { labelKey: "nav.home", href: "/" },
  { labelKey: "nav.settings", href: "/settings" },
];

function Nav({ t }) {
  return menuItems.map(item => (
    <a href={item.href}>{t(item.labelKey)}</a>
  ));
}
```

### 检查清单

- [ ] 翻译文件放在统一的 `i18n/` 目录
- [ ] Client Component 使用 `useI18n()` hook
- [ ] Server Component 使用 `tRuntime()` 函数
- [ ] 静态配置对象使用 `labelKey` 模式
- [ ] 不要在翻译文件里放重复的顶层 key
- [ ] JSON 文件无尾逗号、无重复 key

---

## 微信小程序

### 推荐方案：自建 i18n 模块 + JSON 语言包

### 文件结构

```
miniprogram/
├── i18n/
│   ├── index.js           # i18n 运行时
│   ├── zh-CN.json         # 中文
│   └── en.json            # 英文
├── pages/
│   └── index/
│       ├── index.wxml     # {{t.key}} 数据绑定
│       └── index.js       # onLoad 里加载翻译
└── app.js                 # 全局语言初始化
```

### 代码使用方式

```javascript
// i18n/index.js
const zhCN = require('./zh-CN.json');
const en = require('./en.json');

const langs = { 'zh-CN': zhCN, en };
let current = 'zh-CN';

module.exports = {
  t(key) {
    const keys = key.split('.');
    let val = langs[current];
    for (const k of keys) val = val?.[k];
    return val ?? key;
  },
  setLang(lang) { current = lang; },
  getLang() { return current; },
  all() { return langs[current]; },
};

// pages/index/index.js
const i18n = require('../../i18n/index');

Page({
  data: { t: {} },
  onLoad() {
    this.setData({ t: i18n.all() });
  },
});
```

```xml
<!-- pages/index/index.wxml -->
<view>{{t.settings.title}}</view>
<button>{{t.common.save}}</button>
```

### WXS 辅助模块（性能优化）

WXS 运行在渲染层，避免 `setData` 开销：

```javascript
// i18n/i18n.wxs
var langs = {
  'zh-CN': {
    'settings.title': '设置',
    'common.save': '保存',
    'common.cancel': '取消',
  },
  'en': {
    'settings.title': 'Settings',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
  }
};

function t(key, lang) {
  var dict = langs[lang || 'zh-CN'] || langs['zh-CN'];
  return dict[key] || key;
}

module.exports = { t: t };
```

```xml
<!-- 在 WXML 中引入 WXS -->
<wxs src="../../i18n/i18n.wxs" module="i18n" />
<view>{{i18n.t('settings.title', lang)}}</view>
<button>{{i18n.t('common.save', lang)}}</button>
```

### Behavior 封装（复用模式）

```javascript
// behaviors/i18n-behavior.js
const i18n = require('../i18n/index');

module.exports = Behavior({
  data: { t: {}, lang: 'zh-CN' },
  attached() {
    this.setData({ t: i18n.all(), lang: i18n.getLang() });
  },
  methods: {
    switchLang(lang) {
      i18n.setLang(lang);
      this.setData({ t: i18n.all(), lang });
    },
  },
});

// pages/settings/settings.js
const i18nBehavior = require('../../behaviors/i18n-behavior');
Page({
  behaviors: [i18nBehavior],
});
```

### 特殊处理

```javascript
// navigationBarTitleText 不支持数据绑定，需要 JS 覆盖
Page({
  onLoad() {
    wx.setNavigationBarTitle({ title: i18n.t('page.title') });
  },
});

// tabBar 在 app.js 中覆盖
App({
  onLaunch() {
    wx.setTabBarItem({ index: 0, text: i18n.t('tab.home') });
    wx.setTabBarItem({ index: 1, text: i18n.t('tab.mine') });
  },
});

// 语言检测：跟随系统 or 用户选择
function detectLanguage() {
  const stored = wx.getStorageSync('app_language');
  if (stored) return stored;
  const sys = wx.getSystemInfoSync();
  return sys.language.startsWith('en') ? 'en' : 'zh-CN';
}
```

### 检查清单

- [ ] i18n 模块统一放在 `i18n/` 目录
- [ ] WXML 使用 `{{t.key}}` 数据绑定或 WXS `{{i18n.t()}}`
- [ ] 页面级别 `onLoad`/`onShow` 或 Behavior 统一初始化翻译数据
- [ ] `navigationBarTitleText` 用 `wx.setNavigationBarTitle` 覆盖
- [ ] `tabBar` 用 `wx.setTabBarItem` 覆盖
- [ ] JSON 配置中的静态文案有 JS 层覆盖方案
- [ ] 语言偏好持久化到 `wx.setStorageSync`

---

## Android (Kotlin / Java)

### 推荐方案：strings.xml 资源文件

Android 原生资源系统，通过 `res/values-<locale>/strings.xml` 目录结构实现多语言自动切换。

### 文件结构

```
app/src/main/
├── res/
│   ├── values/                  # 默认语言（基准）
│   │   └── strings.xml
│   ├── values-en/               # 英文
│   │   └── strings.xml
│   ├── values-zh-rCN/           # 简体中文
│   │   └── strings.xml
│   └── values-zh-rTW/           # 繁体中文
│       └── strings.xml
└── java/
    └── com/example/app/
        └── LocaleHelper.kt      # 语言切换工具
```

### strings.xml 格式

```xml
<!-- res/values/strings.xml（默认/基准语言） -->
<resources>
    <string name="app_name">我的应用</string>
    <string name="settings_title">设置</string>
    <string name="btn_save">保存</string>
    <string name="btn_cancel">取消</string>
    <string name="welcome_message">欢迎，%1$s</string>

    <!-- 不需要翻译的字符串 -->
    <string name="app_brand" translatable="false">MyApp</string>

    <!-- 复数形式 -->
    <plurals name="item_count">
        <item quantity="one">%d 个项目</item>
        <item quantity="other">%d 个项目</item>
    </plurals>
</resources>
```

```xml
<!-- res/values-en/strings.xml -->
<resources>
    <string name="app_name">My App</string>
    <string name="settings_title">Settings</string>
    <string name="btn_save">Save</string>
    <string name="btn_cancel">Cancel</string>
    <string name="welcome_message">Welcome, %1$s</string>

    <plurals name="item_count">
        <item quantity="one">%d item</item>
        <item quantity="other">%d items</item>
    </plurals>
</resources>
```

### 代码使用方式

```kotlin
// Kotlin：直接使用资源引用
binding.titleText.text = getString(R.string.settings_title)

// 带参数
binding.welcomeText.text = getString(R.string.welcome_message, userName)

// 复数
binding.countText.text = resources.getQuantityString(R.plurals.item_count, count, count)

// Jetpack Compose
Text(text = stringResource(R.string.settings_title))
Text(text = stringResource(R.string.welcome_message, userName))
Text(text = pluralStringResource(R.plurals.item_count, count, count))
```

### Key 命名规范

| 场景 | 格式 | 示例 |
|------|------|------|
| 页面标题 | `<module>_title` | `settings_title` |
| 按钮文案 | `btn_<action>` | `btn_save` |
| 提示文案 | `hint_<name>` | `hint_search` |
| 错误消息 | `error_<type>` | `error_network` |
| 弹窗标题 | `dialog_<name>_title` | `dialog_delete_title` |
| 弹窗内容 | `dialog_<name>_message` | `dialog_delete_message` |

### build.gradle 限制语种

```groovy
android {
    defaultConfig {
        resConfigs "zh", "en"
    }
}
```

### 检查清单

- [ ] `res/values/strings.xml` 包含所有用户可见字符串（完整基准）
- [ ] 不可翻译字符串标记 `translatable="false"`
- [ ] 使用 `%1$s`、`%d` 等格式化参数，不要拼接字符串
- [ ] 复数形式使用 `<plurals>` 而非硬编码条件判断
- [ ] `build.gradle` 中 `resConfigs` 限制打包语种
- [ ] 目录命名严格遵循 `values-<language>-r<REGION>` 格式

---

## Flutter (Dart)

### 推荐方案：ARB 文件 + gen-l10n

Flutter 原生支持通过 ARB (Application Resource Bundle) 文件生成类型安全的本地化代码。

### 文件结构

```
lib/
├── l10n/
│   ├── app_zh.arb          # 中文（基准）
│   └── app_en.arb          # 英文
├── main.dart
└── ...
l10n.yaml                   # 本地化配置
pubspec.yaml                # 依赖声明
```

### 配置步骤

```yaml
# pubspec.yaml
dependencies:
  flutter_localizations:
    sdk: flutter
  intl: any

flutter:
  generate: true
```

```yaml
# l10n.yaml
arb-dir: lib/l10n
template-arb-file: app_zh.arb
output-localization-file: app_localizations.dart
synthetic-package: true
```

### ARB 文件格式

```json
// lib/l10n/app_zh.arb
{
  "@@locale": "zh",
  "settingsTitle": "设置",
  "@settingsTitle": {
    "description": "设置页面标题"
  },
  "welcomeMessage": "欢迎，{name}",
  "@welcomeMessage": {
    "description": "首页欢迎语",
    "placeholders": {
      "name": {
        "type": "String",
        "example": "张三"
      }
    }
  },
  "itemCount": "{count, plural, =0{没有项目} =1{1 个项目} other{{count} 个项目}}",
  "@itemCount": {
    "description": "项目计数",
    "placeholders": {
      "count": {
        "type": "int"
      }
    }
  }
}
```

```json
// lib/l10n/app_en.arb
{
  "@@locale": "en",
  "settingsTitle": "Settings",
  "welcomeMessage": "Welcome, {name}",
  "itemCount": "{count, plural, =0{No items} =1{1 item} other{{count} items}}"
}
```

### 代码使用方式

```dart
// main.dart
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

MaterialApp(
  localizationsDelegates: AppLocalizations.localizationsDelegates,
  supportedLocales: AppLocalizations.supportedLocales,
  home: const HomePage(),
);

// 使用
Text(AppLocalizations.of(context)!.settingsTitle)
Text(AppLocalizations.of(context)!.welcomeMessage('张三'))
Text(AppLocalizations.of(context)!.itemCount(5))
```

### 检查清单

- [ ] `pubspec.yaml` 已添加 `flutter_localizations` 和 `intl` 依赖
- [ ] `l10n.yaml` 配置文件已创建，`template-arb-file` 指向基准语言
- [ ] 每个 key 都有 `@key` 元数据（至少 `description`）
- [ ] `MaterialApp` 已配置 `localizationsDelegates` 和 `supportedLocales`
- [ ] `flutter gen-l10n` 无错误/警告
- [ ] 复数形式使用 ICU MessageFormat，不要硬编码条件判断

---

## Vue / Nuxt

### 推荐方案：vue-i18n + JSON 翻译文件

### 文件结构

```
src/
├── i18n/
│   ├── index.ts           # i18n 实例
│   ├── zh-CN.json         # 中文
│   └── en.json            # 英文
└── components/
    └── Example.vue
```

### 代码使用方式

```typescript
// i18n/index.ts
import { createI18n } from 'vue-i18n';
import zhCN from './zh-CN.json';
import en from './en.json';

export const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
});
```

```vue
<!-- Template 中使用 -->
<template>
  <h1>{{ $t('settings.title') }}</h1>
  <button>{{ $t('common.save') }}</button>
  <p>{{ $t('welcome', { name: userName }) }}</p>
</template>

<script setup>
import { useI18n } from 'vue-i18n';
const { t, locale } = useI18n();

// 切换语言
function switchLanguage(lang) {
  locale.value = lang;
}
</script>
```

### Nuxt 3 集成

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@nuxtjs/i18n'],
  i18n: {
    locales: [
      { code: 'zh-CN', file: 'zh-CN.json', name: '中文' },
      { code: 'en', file: 'en.json', name: 'English' },
    ],
    defaultLocale: 'zh-CN',
    langDir: 'i18n/',
  },
});
```

### 检查清单

- [ ] `vue-i18n` 已安装并配置 `fallbackLocale`
- [ ] Template 使用 `$t()` 或 `{{ $t() }}`，不直接写死文案
- [ ] Composition API 使用 `useI18n()` 获取 `t` 函数
- [ ] 翻译 JSON 文件无重复 key、无尾逗号

---

## 扩展：新增平台

当项目涉及新平台时，在本文档末尾追加对应板块，遵循统一格式：

1. **推荐方案**：一句话说明技术选型
2. **文件结构**：翻译文件放在哪里
3. **代码使用方式**：带示例的最小可用代码
4. **检查清单**：3-6 条验收项

预留板块：Electron、桌面应用、React Native。

---

## Agent 行为规范

当 Agent 在 OpenPRD 工作流中遇到以下情况时，需要主动检查多语言：

1. **新增用户可见文案**：写入 UI 文本、按钮、提示、错误消息时
2. **修改已有文案**：改动文案内容后要同步更新翻译文件
3. **新增页面/功能**：包含用户可见文案的新功能模块

检查流程：
1. 读取 `.open-vibecoding/i18n-config.json` 获取项目配置
2. 如果 `enforceOnDevCheck` 为 true，检查本次改动是否包含硬编码文案
3. 发现硬编码文案时提醒用户，并主动帮助提取为 i18n key
4. 默认按 `defaultLanguage` 写入基准翻译，按 `supportedLanguages` 补齐其余翻译
5. 按控件类型把目标语言改写成母语软件产品的自然表达，不把基准语言句式逐字搬过去
6. 在真实控件中逐语言检查语义、截断、异常换行、布局挤压与 Accessibility Label；字符串存在或字数更短不等于适配完成
