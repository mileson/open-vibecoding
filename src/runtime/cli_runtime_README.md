# Lane/Task Runtime 文件夹说明书

## 核心功能

为同一 OpenPrd 项目中的多 Agent、多线程和多工作树提供可持久化、可并发控制的 Lane/Task 运行时。

## 输入

接收项目级 lane、task、claim 身份、租约、write-set、revision 与验证证据。

## 输出

输出原子 task claim、心跳续租、释放、完成、过期恢复、CAS 冲突和 write-set 冲突结果。

## 定位

本目录是 OpenPrd 项目控制面的独立运行时内核；当前不直接接管 CLI、loop、session 或平台 Adapter。

## 依赖

仅依赖 Node.js 20 内建模块和目录内纯 JavaScript 模块，不依赖第三方包。

## 维护规则

- 所有状态 read-modify-write 必须通过 `LaneStore` 原子事务。
- claim token、lease 与 revision 校验不得被调用端绕过。
- write-set 不能证明互斥时必须保守判冲突。
- CLI、Hook、loop 和平台 Adapter 接线应从 `index.js` 入口导入，不复制 runtime 状态逻辑。
