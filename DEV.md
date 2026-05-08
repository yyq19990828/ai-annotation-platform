# 开发指南

> 完整的开发文档（架构、How-to、测试、规范）在 VitePress 文档站：
> 本地预览 `pnpm docs:dev`，部署版 [GitHub Pages](https://yyq19990828.github.io/ai-annotation-platform/dev/)。
> 本文件仅保留快速参考。

## 项目结构

```
ai-annotation-platform/
├── apps/
│   ├── web/                     # React 前端
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── shell/       # TopBar, Sidebar
│   │   │   │   └── ui/         # 设计系统组件
│   │   │   ├── pages/           # Dashboard, Workbench, Users
│   │   │   ├── stores/          # Zustand 状态管理
│   │   │   ├── data/            # Mock 数据
│   │   │   ├── types/           # TypeScript 类型定义
│   │   │   └── styles/          # CSS 变量 (设计 tokens)
│   │   ├── e2e/                # Playwright E2E + screenshots 自动化
│   │   ├── vite.config.ts
│   │   └── tsconfig.json
│   │
│   ├── api/                     # FastAPI 后端
│   │   ├── app/
│   │   │   ├── api/v1/          # 路由处理器
│   │   │   ├── db/models/       # SQLAlchemy 模型
│   │   │   ├── schemas/         # Pydantic schemas
│   │   │   ├── services/        # 业务逻辑
│   │   │   ├── workers/         # Celery 任务
│   │   │   └── utils/           # 工具函数
│   │   └── pyproject.toml
│   │
│   ├── grounded-sam2-backend/   # v0.9.x · Grounded-SAM-2 ML Backend (GPU)
│   │   ├── vendor/              # IDEA-Research/Grounded-SAM-2 镜像副本（sync_vendor.sh）
│   │   ├── predictor.py         # 三种 prompt (point/bbox/text) 路由
│   │   ├── main.py              # FastAPI 4 端点 + /metrics + /cache/stats
│   │   └── Dockerfile           # build context 升到 apps/（v0.9.4 phase 3）
│   │
│   └── _shared/                 # 跨子应用共享 Python 包
│       └── mask_utils/          # mask→polygon (sam2-backend / sam3-backend 共用)
│
├── infra/docker/                # Dockerfile + Nginx (web/api)
├── scripts/                     # 工具脚本（seed.py / eval_simplify.py / sync_vendor.sh）
├── docs-site/                   # VitePress 用户手册 + 开发文档 + API
├── docs/                        # ADR / changelogs / plans / research
├── docker-compose.yml           # 本地基础服务（postgres/redis/minio + GPU profile gsam2）
└── .env.example                 # 环境变量模板
```

## 前置要求

- Node.js >= 20
- pnpm >= 10
- Python >= 3.11
- uv (Python 包管理)
- Docker & Docker Compose
- pre-commit（推荐，启用 git hooks）

## 一次性 setup

```bash
pnpm install               # 自动跑 scripts/install-git-hooks.sh，已装 pre-commit 即启用 hooks
cd apps/api && uv sync --extra test && cd ../..
# 若上面提示 "pre-commit 未安装"：pip install pre-commit && pre-commit install
```

## 快速开始

### 1. 启动基础服务

```bash
docker compose up -d
```

这会启动：
- PostgreSQL 16 — `localhost:5432` (user/pass/annotation)
- Redis 7 — `localhost:6379`
- MinIO — `localhost:9000` (控制台 `localhost:9001`, minioadmin/minioadmin)

> **GPU profile（可选，需要标注工作台 SAM 工具或 `/ai-pre` 文本批量预标）**：
> ```bash
> docker compose --profile gpu up -d grounded-sam2-backend
> ```
> 首次启动自动下载 ~900MB checkpoints（cache 在 `gsam2_checkpoints` volume）；启动 health 探活周期 120s，`curl http://localhost:8001/health` 应返回 `{"ok":true,"loaded":true}`。需 NVIDIA driver ≥ 525 + nvidia-container-toolkit。

### 2. 启动前端

```bash
pnpm install
pnpm dev:web
```

打开 http://localhost:3000

### 3. 启动后端

```bash
cd apps/api
uv venv
source .venv/bin/activate
uv pip install fastapi "uvicorn[standard]" pydantic-settings sqlalchemy asyncpg python-jose passlib python-multipart httpx
uv run uvicorn app.main:app --reload --port 8000
```

API 文档：http://localhost:8000/docs

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 6 |
| 状态管理 | Zustand |
| 后端框架 | FastAPI (Python 3.12) |
| ORM | SQLAlchemy 2.0 (async) |
| 数据库 | PostgreSQL 16 |
| 缓存/队列 | Redis 7 |
| 对象存储 | MinIO (开发) / 阿里云 OSS (生产) |
| 任务队列 | Celery (待实现) |
| 容器化 | Docker Compose |

## 前端开发

### 设计系统

所有设计 Token 定义在 `apps/web/src/styles/tokens.css` 的 `:root` 中，精确移植自原型：

```css
--color-accent: oklch(0.58 0.18 252);   /* 蓝色强调 */
--color-ai: oklch(0.60 0.20 295);        /* 紫色 AI */
--color-success: oklch(0.62 0.16 152);   /* 绿色成功 */
--color-warning: oklch(0.72 0.15 75);    /* 黄色警告 */
--color-danger: oklch(0.62 0.20 25);     /* 红色危险 */
```

### UI 组件

所有基础组件在 `apps/web/src/components/ui/`，通过 `index.ts` barrel 导出：

```tsx
import { Button, Badge, Card, Avatar, StatCard, Icon } from "@/components/ui";
```

### 页面路由

当前使用 Zustand store 管理页面切换 (`useAppStore.page`)，已实现的页面：

- `dashboard` — 项目总览
- `annotate` — 标注工作台
- `users` — 用户与权限

其他页面 (datasets/storage/ai-pre/model-market/training/audit/settings) 显示占位。

### Mock 数据

前端当前使用 `apps/web/src/data/mock.ts` 中的静态数据，后续联调时替换为 API 调用。

## 后端开发

### API 端点

所有端点挂载在 `/api/v1/` 前缀下，当前为 stub 实现：

```
GET  /health                      # 健康检查
POST /api/v1/auth/login           # 登录
GET  /api/v1/auth/me              # 当前用户
GET  /api/v1/projects             # 项目列表
GET  /api/v1/projects/stats       # 统计数据
POST /api/v1/projects             # 创建项目
GET  /api/v1/tasks/{id}           # 任务详情
POST /api/v1/tasks/{id}/submit    # 提交质检
GET  /api/v1/users                # 用户列表
```

### 数据模型

4 个核心模型 (`apps/api/app/db/models/`)：

- **User** — 用户 (email, name, role, group_name, status)
- **Project** — 项目 (type_key, classes JSONB, ai_model, 任务统计计数)
- **Task** — 任务 (file_path, tags, status, assignee_id)
- **Annotation** — 标注 (source, geometry JSONB, confidence, class_name)

### 配置

通过环境变量或 `.env` 文件配置，参考 `.env.example`。

## Grounded-SAM-2 ML Backend（v0.9.x）

`apps/grounded-sam2-backend/` 独立 GPU 服务，提供工作台 `S` 工具与 `/ai-pre` 文本批量预标的 SAM mask 推理。三种 prompt（point / bbox / text）路由到 SAM 2.1 + GroundingDINO；mask→polygon 简化用 `apps/_shared/mask_utils`（v0.9.4 phase 3 抽出共用，与 v0.10.x sam3-backend 共享）。

### 起 / 停

```bash
docker compose --profile gpu up -d grounded-sam2-backend          # 起
docker compose --profile gpu down                                  # 停（保留 checkpoints / hf_cache volumes）
docker logs -f ai-annotation-platform-grounded-sam2-backend-1     # 看 "models loaded; device=cuda"
curl -fsS http://localhost:8001/health                             # 探活
curl -fsS http://localhost:8001/cache/stats                        # SAM 2 image embedding LRU 命中率（v0.9.1）
```

### Rebuild（改了 backend 代码 / Dockerfile / mask_utils 后必跑）

build context **从 v0.9.4 phase 3 起升级到 `apps/`**（让 Dockerfile 能 COPY 兄弟目录 `_shared/mask_utils`）。**历史命令 `docker build apps/grounded-sam2-backend/` 已不可用**。

```bash
# 推荐：走 docker compose
docker compose --profile gpu build grounded-sam2-backend
docker compose --profile gpu up -d grounded-sam2-backend          # 重建后重起容器

# 或直接 docker build（需手指定 Dockerfile 路径 + 父目录 context）
docker build -f apps/grounded-sam2-backend/Dockerfile apps/
```

> **首次构建 ~10 min**（vendor Deformable Attention CUDA 算子要 nvcc 现场编译）；只改业务代码时只重做后两层 COPY ~3 min。改 vendor 才会触发完整重编。

### 协议契约

- **请求**：`POST /predict { task: { id, file_path }, context: { type, ... } }`
- **`context.type`**：`point` / `bbox` / `text`
- **v0.9.4 phase 2 字段**：`output: "box" | "mask" | "both"`（仅 type=text 生效，默认 mask 老前端兼容）
- **v0.9.4 phase 3 字段**：`simplify_tolerance: float | null`（仅 mask/both 路径，默认 1.0；像素级；调高减顶点 / 调低保细节；顶点 > 200 后端 logger.warning）
- 完整协议见 [docs-site/dev/ml-backend-protocol.md](docs-site/dev/ml-backend-protocol.md)

### `mask_utils` 共享包

```bash
# 评测 mask→polygon simplify tolerance（fixtures 含 84 张真实 SAM mask + 6 张合成）
uv run --project apps/_shared/mask_utils python scripts/eval_simplify.py \
    --masks-dir apps/_shared/mask_utils/tests/fixtures/real_sam_masks \
    --tolerances 0.5,1.0,2.0,3.0,5.0 \
    --out docs/research/13-simplify-tolerance-eval.md
```

最新评测见 [docs/research/13-simplify-tolerance-eval.md](docs/research/13-simplify-tolerance-eval.md)。

## 部署

### 开发环境

```bash
docker compose up -d     # 基础服务
pnpm dev:web             # 前端 :3000
pnpm dev:api             # 后端 :8000
```

### 生产构建

```bash
# 前端
pnpm --filter @anno/web build    # 输出到 apps/web/dist/

# Docker 镜像
docker build -f infra/docker/Dockerfile.web -t anno-web .
docker build -f infra/docker/Dockerfile.api -t anno-api apps/api/
```

## 测试与文档

```bash
# 前端测试
pnpm test                        # vitest 单测
pnpm test:coverage               # 带覆盖率（v0.8.8 起 CI 阈值 25%）
pnpm test:e2e                    # Playwright e2e/tests/**（需后端运行；v0.9.4 phase 3 加 SAM 工具用例 page.route mock）

# 后端 / 共享包测试
cd apps/api && uv run pytest                                            # FastAPI 平台后端
cd apps/_shared/mask_utils && uv run --extra test pytest tests/         # mask→polygon 共享包（grounded-sam2-backend / sam3-backend 共用）
cd apps/grounded-sam2-backend && uv run --extra dev pytest tests/       # SAM backend 单测（无 GPU 走 mock）

# OpenAPI 契约
pnpm openapi:export              # 改了 API 后必须刷新 snapshot
pnpm openapi:check               # CI 校验

# 文档站
pnpm docs:dev                    # http://localhost:5173
pnpm docs:build
```

完整测试指南见 [docs-site/dev/testing.md](docs-site/dev/testing.md)。

## 截图自动化（v0.8.7+）

用户手册截图（`docs-site/user-guide/images/`）由 Playwright 脚本驱动重生成，
不进 CI（避免 baseline drift / flaky），由 maintainer 手动触发。

> **不破坏 dev 数据**：v0.8.7 起截图脚本走 `seed/peek` 只读窥探现有用户 / 项目 /
> 任务，不再 TRUNCATE 整库。已积累的数据集 / 项目 / 标注会保留。E2E spec
> （`pnpm test:e2e`）仍走 `seed/reset` 保证可重入，与截图独立。

### 前置条件

```bash
docker compose up -d                                       # postgres / redis / minio
cd apps/api && uv run alembic upgrade head                 # 必含 0046（skip_reason）
cd apps/api && uv run uvicorn app.main:app --port 8000     # 另开窗口
pnpm dev:web                                               # 另开窗口，:3000
pnpm exec playwright install chromium                      # 首次需下载浏览器

# 首次还需要至少一个 super_admin 账号 + 一个项目，否则截图脚本会报缺数据
cd apps/api && PYTHONPATH=. uv run python scripts/seed.py  # 创建 admin/pm/qa/anno + 2 示例项目
```

### 触发

```bash
pnpm --filter web screenshots
```

跑完会向 `docs-site/user-guide/images/` 写入 13 张 PNG（getting-started / bbox /
polygon / projects / review / export 六类）。`git diff docs-site/user-guide/images/`
人眼审阅，满意即 commit。

**E2E 跑过后想恢复 dev 账号**：`pnpm test:e2e` 内部仍会 TRUNCATE 重建 fixture（含
`@e2e.test` 三个账号）。如果 dev 账号被清掉，重跑 seed.py 即可（与首次相同命令；
peek 端点优先返回非 `@e2e.test` 邮箱的 super_admin）。

### 改场景

- 14 个场景配置：`apps/web/e2e/screenshots/scenes.ts` —— 修 `route` / `prepare`
  钩子（高亮元素 / 切 tab / 打开 modal）后再跑。
- 主入口：`apps/web/e2e/screenshots/screenshots.spec.ts` —— 改视口 / 注入 CSS；
  `beforeAll` 调用 `/api/v1/__test/seed/peek` 拿首个 admin / project / task。
- 独立 config：`apps/web/playwright.screenshots.config.ts` —— 与默认 `playwright.config.ts`
  分离（默认 `testMatch: ["**/tests/**/*.spec.ts"]` 不收录 screenshots）。
- keypoint 两张（human-pose / hand）暂跳过 —— 等非 image-det 工作台落地。
- 部分场景（`bbox/iou.png` 双框 / `bbox/bulk-edit.png` 多选 / `export/progress.png`
  真实 50% 进度）需 maintainer 在 dev 数据库里造数据（手工标 + 半提交）后再跑覆盖。

### 已知坑

- **中文路径**：仓库根含中文（`AI标注平台设计/`）时，`import.meta.url` 会 percent-encode；
  `screenshots.spec.ts` 已 `decodeURIComponent` 兜底，写到正确位置而非 `AI%E6%A0%87...` 镜像目录。
- **flaky 时间敏感 UI**：当前未注入 `page.clock`，dashboard 日期 / 头像随机色可能每次微变；
  如需稳定 baseline 后续接 `playwright clock.install` + 固定 fixture。

## 测试账号

> 仅 `development` / `staging` 环境可用（seed.py 拒绝在 production 执行）。

| 账号 | 角色 | 密码 | 初始视图 |
|------|------|------|---------|
| `admin` | super_admin | 123456 | AdminDashboard |
| `pm` | project_admin | 123456 | 项目总览 |
| `qa` | reviewer | 123456 | ReviewerDashboard |
| `anno` | annotator | 123456 | AnnotatorDashboard |
| `viewer` | viewer | 123456 | ViewerDashboard |
| `anno2` | annotator | 123456 | (标注组A) |
| `anno3` | annotator | 123456 | (标注组B) |

初始化：`cd apps/api && uv run python scripts/seed.py`

## 下一步计划

详见 [CHANGELOG.md](CHANGELOG.md) 顶部的 roadmap 与 [docs/plans/](docs/plans/) 下的具体计划。
