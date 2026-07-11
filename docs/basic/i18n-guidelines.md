# 多语言 (i18n) 最佳实践

## 适用范围

涉及用户可见文案的产品开发，不论平台（iOS、Web、小程序、Android 等），都应在首次写入文案时就按多语言架构编写。本文档提供各平台的最佳实践、示例和检查清单。

## 核心原则

1. **文案不硬编码**：用户可见字符串必须走 i18n 框架，不得直接写死在源码里
2. **默认语言为中文**：`sourceLanguage` / 基准语言默认简体中文（zh-Hans / zh-CN）
3. **至少支持英文扩展**：首版至少预留英文（en）翻译路径，即使暂不翻译也要把 key 结构建好
4. **翻译文件与代码分离**：翻译资源集中管理，不分散在各个组件/页面里
5. **意译优先**：英文翻译使用 native speaker 地道表达，不直译

## 用户可配置

项目级 i18n 配置文件：`.openprd/i18n-config.json`

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

Xcode 15+ 原生支持的 String Catalog 是 iOS 多语言的现代最佳实践，替代了旧的 `.strings` / `.stringsdict` 文件。

### 文件结构

```
YourApp/
├── Resources/
│   └── Localization/
│       └── Localizable.xcstrings    # 唯一的翻译文件
├── Utilities/
│   └── LocalizationManager.swift    # 语言切换管理器
└── Extensions/
    └── String+Localized.swift       # 便捷扩展
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
// String 扩展（推荐）
extension String {
    var localized: String {
        NSLocalizedString(self, comment: "")
    }

    func localized(with args: CVarArg...) -> String {
        String(format: NSLocalizedString(self, comment: ""), arguments: args)
    }
}

// 使用
Text("settings.title".localized)
Button("camera.button.capture".localized) { ... }

// 带参数
Text("profile.welcome".localized(with: userName))
// key: "profile.welcome" → value: "欢迎，%@"

// 模块化：不同 table
"key".localized(tableName: "ModuleLocalizable")

// App Intents
LocalizedStringResource("intent.title")
```

### 语言切换管理器

```swift
class LocalizationManager: ObservableObject {
    static let shared = LocalizationManager()

    @AppStorage("app_language") var currentLanguage: String = "zh-Hans" {
        didSet { objectWillChange.send() }
    }

    var availableLanguages: [(code: String, name: String)] {
        [
            ("zh-Hans", "简体中文"),
            ("en", "English"),
        ]
    }
}
```

### 检查清单

- [ ] 所有用户可见文案使用 `.localized` 或 `LocalizedStringResource`
- [ ] `.xcstrings` 文件中 `sourceLanguage` 设为 `zh-Hans`
- [ ] 每个 key 至少有 `zh-Hans` 和 `en` 两个翻译
- [ ] 按钮、标签、提示分别使用对应的 key 前缀
- [ ] 带参数的文案使用 `%@` / `%d` 占位符
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
1. 读取 `.openprd/i18n-config.json` 获取项目配置
2. 如果 `enforceOnDevCheck` 为 true，检查本次改动是否包含硬编码文案
3. 发现硬编码文案时提醒用户，并主动帮助提取为 i18n key
4. 默认按 `defaultLanguage` 写入基准翻译，按 `supportedLanguages` 补齐其余翻译
