# Test Agent 可选 Python 本机模块

保留 `common-lib`、`api-gateway-service` 和 `agent-runtime-service` 三个包，统一使用 `src` 目录与包名导入。目前仅提供本机健康检查，Electron 桌面原型不依赖、也不自动启动这些模块。

```bash
cd backend
poetry install
poetry run uvicorn api_gateway.app:create_app --factory --host 127.0.0.1 --port 8000
# 另一个终端中可选启动运行时：
poetry run uvicorn agent_runtime.app:create_app --factory --host 127.0.0.1 --port 8001
```

配置从进程环境读取，参考 `.env.example`；该文件不自动加载。不存在远程数据库配置。后续引入 Python 测试执行器时，由桌面主进程管理其生命周期和通信；当前不打包 Python 服务。

详见 [本地桌面架构](../docs/设计方案/2026-10-20-本地桌面应用架构/2026-10-20-本地桌面应用架构.md)。
