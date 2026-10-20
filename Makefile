.PHONY: help frontend-install frontend-dev frontend-build frontend-check backend-install backend-api backend-runtime backend-check check desktop-dev desktop-start

help:
	@echo "make desktop-dev       启动桌面原型（热更新）"
	@echo "make desktop-start     构建并加载本地桌面界面"
	@echo "make frontend-install  安装前端依赖"
	@echo "make frontend-dev      启动 UI 原型 (5173，无需后端)"
	@echo "make frontend-build    构建前端"
	@echo "make frontend-check    前端类型、格式与原型交互检查"
	@echo "make backend-install   安装可选后端服务骨架"
	@echo "make backend-api       启动 API 骨架 (8000)"
	@echo "make backend-runtime   启动 Runtime 骨架 (8001)"
	@echo "make backend-check     后端检查"
	@echo "make check             前后端检查"

frontend-install:
	cd frontend && pnpm install --frozen-lockfile

frontend-dev:
	cd frontend && pnpm dev

frontend-build:
	cd frontend && pnpm build

frontend-check:
	cd frontend && pnpm typecheck && pnpm format:check && pnpm test

backend-install:
	cd backend && poetry install --no-interaction

backend-api:
	cd backend && poetry run uvicorn api_gateway.app:create_app --factory --reload --host 127.0.0.1 --port 8000

backend-runtime:
	cd backend && poetry run uvicorn agent_runtime.app:create_app --factory --reload --host 127.0.0.1 --port 8001

backend-check:
	cd backend && poetry run ruff check . && poetry run pytest -q

check: frontend-check backend-check

desktop-dev:
	cd frontend && pnpm dev:desktop

desktop-start:
	cd frontend && pnpm desktop
