# Test Agent

面向 **Windows / macOS** 的本地自动化测试 Agent 原型，采用 Electron + React。保留对话工作台、技能模板、任务草稿，以及可选的 Python 本机执行模块骨架。

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev:desktop
```

加载构建后的本地 UI（无需启动开发服务器）：

```bash
pnpm desktop
```

不使用容器、远程数据库或云部署。后续持久化采用本地 SQLite；当前对话与任务仍是内存演示，刷新或退出后清空。

- [使用说明](docs/使用说明/2026-10-20-自动化测试Agent原型/2026-10-20-自动化测试Agent原型.md)
- [本地桌面架构](docs/设计方案/2026-10-20-本地桌面应用架构/2026-10-20-本地桌面应用架构.md)
