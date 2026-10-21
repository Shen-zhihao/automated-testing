"""运行时应用工厂，预留后续测试执行能力的接入位置。"""
from common_lib.web.application import create_application
from fastapi import FastAPI

from agent_runtime.routes.health import router


def create_app() -> FastAPI:
    app = create_application("序舟 Runtime")
    app.include_router(router, prefix="/internal")
    return app
