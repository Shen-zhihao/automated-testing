"""两个服务共享的健康检查响应。"""
from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    mode: Literal["prototype"] = "prototype"
