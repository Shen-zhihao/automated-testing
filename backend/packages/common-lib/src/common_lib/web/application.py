"""共享 FastAPI 配置，不在启动阶段连接任何外部服务。"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from common_lib.config.settings import get_settings


def create_application(title: str) -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level)
    app = FastAPI(
        title=title,
        version="0.1.0",
        description="自动化测试 Agent 服务骨架；目前仅提供健康检查。",
        debug=settings.app_env == "development",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET"],
        allow_headers=["Content-Type"],
    )
    return app
