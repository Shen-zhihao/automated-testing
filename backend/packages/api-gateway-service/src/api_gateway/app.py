"""对外 API 应用工厂。"""
from common_lib.web.application import create_application
from fastapi import FastAPI

from api_gateway.api.health import router


def create_app() -> FastAPI:
    app = create_application("序舟 API")
    app.include_router(router, prefix="/api")
    return app
