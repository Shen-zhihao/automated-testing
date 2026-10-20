"""本地服务启动入口。先从 backend 目录安装工作区依赖。"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run("agent_runtime.app:create_app", factory=True, host="127.0.0.1", port=8001)
