# Test Agent

面向 **Windows / macOS** 的本地自动化测试 Agent，采用 Electron + React + SQLite。支持常用文档导入、配置 App ID / App Secret 后以飞书应用身份读取已授权文档，以及调用用户配置的模型分析需求和测试点；保留对话、技能和任务原型。

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev:desktop
```

加载构建后的本地 UI（无需启动开发服务器）：

```bash
pnpm desktop
```

不使用容器、远程数据库或云部署。文档、分析结果和配置保存在本机，API Key 使用系统安全存储加密。对话与任务页仍是内存演示。开发环境需要 Node.js 22.13+。

- [使用说明](docs/使用说明/2026-10-20-自动化测试Agent原型/2026-10-20-自动化测试Agent原型.md)
- [本地桌面架构](docs/设计方案/2026-10-20-本地桌面应用架构/2026-10-20-本地桌面应用架构.md)
- [文档分析与模型设置](docs/使用说明/2026-10-20-文档分析与模型设置/2026-10-20-文档分析与模型设置.md)
