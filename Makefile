.PHONY: help frontend-install frontend-dev frontend-build frontend-check check desktop-dev desktop-start

help:
	@echo "make desktop-dev       启动桌面原型（热更新）"
	@echo "make desktop-start     构建并加载本地桌面界面"
	@echo "make frontend-install  安装前端依赖"
	@echo "make frontend-dev      启动 UI 原型 (5173)"
	@echo "make frontend-build    构建前端"
	@echo "make frontend-check    前端类型、格式与原型交互检查"
	@echo "make check             桌面与 UI 检查"

frontend-install:
	cd frontend && pnpm install --frozen-lockfile

frontend-dev:
	cd frontend && pnpm dev

frontend-build:
	cd frontend && pnpm build

frontend-check:
	cd frontend && pnpm typecheck && pnpm format:check && pnpm test

check: frontend-check

desktop-dev:
	cd frontend && pnpm dev:desktop

desktop-start:
	cd frontend && pnpm desktop
