# 项目 AI 协作规则

本项目要求 AI 生成的人类可读交付物按以下规范存放：

- 统一放在 `docs/<分类文件夹>/<YYYY-MM-DD>-<语义名称>/<YYYY-MM-DD>-<语义名称>.<扩展名>`；
- 日期使用北京时间当天；
- 文件夹名和文件名保持一致；
- 代码、配置、测试产物、构建产物不放入 `docs/`。

完整规则见 [docs/规范/2026-09-02-AI生成文件管理规范/2026-09-02-AI生成文件管理规范.md](docs/规范/2026-09-02-AI生成文件管理规范/2026-09-02-AI生成文件管理规范.md)。

## 前端开发规则

- `pages/` 中的每个页面使用同名文件夹包裹，入口统一为 `index.tsx`；
- `layouts/` 中的每个布局使用同名文件夹包裹，入口统一为 `index.tsx`；
- 全局公用组件放在应用 `src/components` 下；
- 页面或子模块公用组件放在对应页面/子模块的 `components` 文件夹下。

完整规则见 [docs/规范/2026-09-03-前端项目开发规则/2026-09-03-前端项目开发规则.md](docs/规范/2026-09-03-前端项目开发规则/2026-09-03-前端项目开发规则.md)。

## 后端 Python 开发规则

- 后端统一采用 `backend/packages/<package-name>/src/<python_package>` 的 `src` 目录结构；可导入的 Python 代码只放在 `src/` 下，不直接散落在包根目录；
- 每个后端包的根目录只保留 `pyproject.toml`、`README.md`、`main.py`、`tests/`、`data/` 等工程文件；业务实现放入对应 Python package；
- `main.py` 只作为服务启动入口，负责创建应用或启动进程；不要把业务逻辑、数据库访问、路由实现堆在 `main.py` 中；
- 每个可导入目录都应包含 `__init__.py`，禁止依赖临时 `sys.path` 修改、脚本相对路径技巧或随意设置 `PYTHONPATH` 解决导入问题；
- 跨包、跨模块调用优先使用基于包名的绝对导入；同一包内部的近距离引用可使用相对导入，但保持一致，不要混用到难以维护；
- API 层保持薄：路由只负责参数校验、依赖注入、响应封装；配置、Schema、Repository、Client、Adapter、Graph、Node、Skill 等内容按职责拆分到独立目录；
- 公共能力统一沉淀到 `backend/packages/common-lib`，包括共享 Schema、数据库模型、配置、工具函数、适配器与常量；禁止在各服务内重复复制同类实现；
- 数据库模型、迁移、配置与接口契约分层放置：模型放 `db/models`，迁移放 `db/migrations`，Pydantic Schema 放 `schemas`，配置放 `config`；
- 运行时数据、检查点、缓存文件放在 `data/` 等非源码目录，不放进 `src/`；日志、构建产物、缓存文件不得混入可导入包；
- 新增后端测试时，优先在各包根目录下创建 `tests/`，并按 `src/` 的模块结构镜像组织；不要把测试文件混放进业务源码目录；
- 当前未加载后端 Skill。以后新增内置 Skill 时放入 `backend/skill-packages/<name>/SKILL.md`；修改内容必须同步提升 frontmatter 中的 `metadata.version`。

## 本地桌面运行规则

- 产品仅面向 Windows 和 macOS，桌面外壳放在 `frontend/apps/desktop`，React UI 继续放在 `frontend/apps/agent-web`。
- 不使用 Docker、容器编排、Nginx 或云端部署脚本；用户运行桌面应用不应依赖远程数据库或额外安装数据库服务。
- 持久化采用本地 SQLite；文档、分析结果和配置已落入 `app.getPath('userData')/storage/test-agent.sqlite`，禁止写入安装目录或源码目录。
- 渲染进程不直接访问文件系统、数据库或系统命令；通过受限的 preload / IPC 接口交给主进程或本地执行模块。新增 IPC 必须校验主框架来源。
- Python 当前只保留可选本机骨架，启动绑定 `127.0.0.1`；桌面原型不依赖它，也不自动拉起后台 HTTP 服务。
- 不把“无需联网数据库”等同于“永远不允许联网”：以后测试目标访问、模型调用是否联网，应由用户配置和具体功能决定。

## 环境配置规则

- Python 环境变量在 `backend/packages/common-lib/src/common_lib/config/settings.py` 的 `AppSettings` 中声明，当前只有 `APP_ENV`、`LOG_LEVEL`、`CORS_ORIGINS`。
- 新增、修改或删除 Python 变量时同步 `backend/.env.example`、本机启动入口和使用说明。模板与代码默认值保持一致。
- 桌面模式由启动脚本的 `--dev` 参数控制，开发服务器只监听 `127.0.0.1:5180`。模型地址由用户在设置中配置，不引入远程数据库连接字符串。
- API Key 通过 Electron safeStorage 加密后保存，配置读取接口只返回是否存在密钥，不回显密钥；更换模型服务地址时清除旧密钥，避免发送给新的服务。
- 飞书采用自建应用身份（tenant_access_token）与官方只读 API，不依赖 Codex、MCP 连接器或额外 Node/Python 程序。设置仅包含 App ID、App Secret 和测试连接，不使用用户登录或回调。禁止从其他应用读取或复制凭据。
- 飞书 App Secret 通过系统安全存储加密后保存，不回显给渲染进程、不写入日志或安装包；应用访问令牌仅在主进程内存缓存，到期自动重新获取，并合并并发请求。
- 飞书测试连接成功后才保存配置，失败保留原配置；变更配置或关闭应用不得被旧请求恢复。升级保留已配置的加密应用凭据，移除旧用户令牌、续期信息和回调配置。接口权限与文档访问权限分别检查，测试连接成功不等于应用拥有目标文档的阅读权限。

## 原型边界

- 文档导入、文档分析和设置是真实功能；对话和测试任务仍使用内存演示，刷新后清空。不要把两者的状态混为一谈。
- 只有用户点击分析才向其配置的模型发送文档文字。导入不自动分析；长文不静默截断，图片/附件/扫描页未解析时必须展示提示。
- 按用户明确的范围逐步接入模型、执行器和本地持久化，避免提前扩充业务。
- 桌面运行使用 `cd frontend && pnpm dev:desktop` 或 `pnpm desktop`。打包命令分别为 `pnpm package:mac` 和 `pnpm package:win`，仅在明确要求交付安装包时执行。
- 前端检查使用 `make frontend-check` 与 `make frontend-build`；后端使用 `make backend-check`。Windows 可直接执行使用说明中的 pnpm / Poetry 命令，不依赖 Make。
