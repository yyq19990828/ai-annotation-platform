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
│   │   │   ├── components/      # shell、业务组件与 shadcn 原语
│   │   │   ├── pages/           # Dashboard、Workbench、项目与管理页面
│   │   │   ├── api/             # API client、业务封装与 codegen 输出
│   │   │   ├── stores/          # Zustand UI 状态
│   │   │   ├── types/           # 手写的 UI / 领域类型
│   │   │   └── styles/          # Tailwind / shadcn runtime tokens
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
│   ├── grounded-sam2-backend/   # Grounded-SAM-2 GPU backend
│   │   ├── vendor/              # IDEA-Research/Grounded-SAM-2 镜像副本（sync_vendor.sh）
│   │   ├── predictor.py         # 三种 prompt (point/bbox/text) 路由
│   │   ├── main.py              # FastAPI 4 端点 + /metrics + /cache/stats
│   │   └── Dockerfile           # build context 为 apps/，可复用共享包
│   ├── sam3-backend/            # SAM 3 图像 / 视频 backend
│   ├── yolo-backend/            # YOLO 批量推理 backend
│   ├── onnxtools-backend/       # 检测与属性推理 backend
│   ├── rapidocr-backend/        # OCR backend
│   │
│   └── _shared/                 # 跨子应用共享 Python 包
│       └── mask_utils/          # mask→polygon (sam2-backend / sam3-backend 共用)
│
├── infra/docker/                # Dockerfile + Nginx (web/api)
├── scripts/                     # 工具脚本（seed.py / eval_simplify.py / sync_vendor.sh）
├── docs-site/                   # VitePress 用户手册 + 开发文档 + API
├── docs/                        # ADR / changelogs / plans / research
├── docker-compose.yml           # 本地基础服务（postgres/redis/minio/celery + 监控 profile）
├── docker-compose.ml.yml        # ML Backend 叠加（GPU 推理服务 + 截图协议 stub）
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
# 若上面提示 "pre-commit 未安装"：uv tool install pre-commit && pre-commit install
# （用 uv tool 独立安装 pre-commit，勿 pip 装进项目 venv；否则 uv sync 会把它卸载）
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
- Mailpit — SMTP `localhost:1025`、收件箱 `localhost:8025`
- Celery default / GPU / CPU / export worker 与 beat；按任务队列隔离并发

如需测试 MinIO 放在指定磁盘上的性能，可在 `.env` 设置：

```bash
MINIO_DATA_DIR=/mnt/fast-disk/ai-annotation-platform/minio
```

该变量只影响 MinIO 的 `/data` 挂载；留空时仍使用 Docker 托管的 `miniodata` 命名卷。切换前后数据不会自动迁移，已有对象需要先复制到新目录。

> **GPU profile（可选，需要标注工作台 SAM 工具或 `/ai-pre` 文本批量预标）**：GPU backend 在叠加文件 `docker-compose.ml.yml`，须同时 `-f` 两个文件：
> ```bash
> docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu up -d grounded-sam2-backend
> ```
> 嫌麻烦可在 `.env` 设 `COMPOSE_FILE=docker-compose.yml:docker-compose.ml.yml`，之后省去 `-f`。首次启动自动下载 ~900MB checkpoints（cache 在 `gsam2_checkpoints` volume）；启动 health 探活周期 120s，`curl http://localhost:8001/health` 应返回 `{"ok":true,"loaded":true}`。需 NVIDIA driver ≥ 525 + nvidia-container-toolkit。
>
> **多卡机器指定 GPU backend 用哪张卡**：`docker-compose.ml.yml` 里各 GPU profile backend 固定绑定一张物理卡（`deploy.reservations.devices.device_ids`），不再是 `count: 1` 由 Docker 自动挑卡。默认 GSAM2/YOLO/ONNXTOOLS/RAPIDOCR 用卡 0、SAM3 用卡 1（双卡机器错开显存）；可在 `.env` 用 `GSAM2_GPU_DEVICE_ID` / `SAM3_GPU_DEVICE_ID` / `YOLO_GPU_DEVICE_ID` / `ONNXTOOLS_GPU_DEVICE_ID` / `RAPIDOCR_GPU_DEVICE_ID` 覆盖。**单卡机器必须把 `SAM3_GPU_DEVICE_ID=0`**，否则容器找不到卡 1 起不来。

### 2. 启动前端

```bash
pnpm install
pnpm codegen
pnpm dev:web
```

> 首次 clone / 清空 `apps/web/src/api/generated/` 后，先跑 `pnpm codegen` 再跑
> `pnpm dev:web`。`pnpm dev:web` 直接启动 Vite，不触发 `prebuild` 的生成检查；若缺
> `src/api/generated/capabilityVocab.gen.ts`，页面会报
> `Failed to resolve import "./generated/capabilityVocab.gen"`。如果
> `apps/api/capability-registry.snapshot.json` 也缺失，先运行：
> `cd apps/api && uv run python ../../scripts/export_capability_registry.py`。

打开 http://localhost:3000

### 3. 启动后端

```bash
pnpm dev:api
```

等价命令为 `cd apps/api && uv run uvicorn app.main:app --reload --port 8000 --timeout-graceful-shutdown 3`；依赖由一次性 setup 中的 `uv sync --extra test` 安装，不要在本地手工拼装依赖列表。

> `--timeout-graceful-shutdown 3`：代码改动触发 `--reload` 时，若有浏览器标签页还连着
> WebSocket（工作台 / AI 预标页），uvicorn 默认会无限等待这些连接结束，卡在
> `Waiting for background tasks to complete`，新代码迟迟不生效。设 3s 上限后到点强制
> 掐断 WS 放行 reload，客户端收到 1006 自走指数退避重连。

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
| 任务队列 | Celery（default / GPU / CPU / export worker + beat） |
| 容器化 | Docker Compose |

## 前端开发

### 设计系统

前端设计系统基于 Tailwind CSS + shadcn/ui。运行时主题 Token 定义在 `apps/web/src/styles/shadcn.css`：

```css
--sc-background: #ffffff;
--sc-foreground: #171717;
--sc-card: #ffffff;
--sc-border: #ebebeb;
--sc-brand: #0070f3;
```

组件样式优先使用 Tailwind 语义类（如 `bg-card`、`text-muted-foreground`、`border-border`）或直接读取 `--sc-*`。不要在 CSS 中继续使用旧 `--color-*` 变量。

### UI 组件

底层原语在 `apps/web/src/components/shadcn/ui/`。`apps/web/src/components/ui/` 保留应用兼容适配层，继续通过既有 import 使用：

```tsx
import { Button, Badge, Card, Avatar, StatCard, Icon } from "@/components/ui";
```

### 页面路由与数据访问

页面路由由 React Router 定义在 `apps/web/src/App.tsx`，不是 Zustand page switch。`/projects/:id/annotate` 与 `/projects/:id/review` 使用全屏工作台；Dashboard、数据集、存储、`/ai-pre`、模型市场、项目设置、审核、用户与系统管理等页面通过 `AppShell` 路由承载。`/training` 仍是唯一明确的占位入口。

业务数据通过 `apps/web/src/api/` 的 API client 和 React Query 获取；Zustand 仅保存认证、界面偏好和短生命周期交互状态。测试 fixture 不能作为运行时数据来源。

### 前端 codegen

OpenAPI → TypeScript 类型由 `@hey-api/openapi-ts` 生成，落到 `apps/web/src/api/generated/{types.gen.ts, sdk.gen.ts}`。**该目录在 `apps/web/.gitignore` 中，不入仓**（避免 PR diff 噪声与 git lfs 麻烦）。

```bash
pnpm codegen                       # 手动重新生成（OpenAPI 或 capability snapshot 变动后）
```

日常无需手动跑：

- `pnpm dev:web` 只启动 Vite，不触发 codegen。`pnpm build:web` 的 `prebuild` hook 会在 snapshot 比生成输出新时增量生成。
- **首次 clone 或清空生成目录后**：在跑 `pnpm typecheck` 前先运行 `pnpm codegen`，否则 `src/api/generated/` 不存在会令强类型 import 失败。
- 改动路由或 Pydantic schema 后，先 `pnpm openapi:export` 刷新 snapshot，再 `pnpm codegen`；只改 capability registry 时，运行 `cd apps/api && uv run python ../../scripts/export_capability_registry.py` 后再执行同一 codegen 命令。

如果 PR 改动了 ProjectUpdate / ProjectOut 等共享 schema，提交前手动 codegen + typecheck 确认无回归。

## 后端开发

### API 端点与数据模型

HTTP API 统一挂载在 `/api/v1`，而 WebSocket 单独挂载在 `/ws/...`。路由与 Pydantic schema 是完整实现，不维护手写的端点清单：以 [API 文档](docs-site/api/index.md)、FastAPI `/docs` 与 `apps/api/openapi.snapshot.json` 为准。路由聚合入口为 `apps/api/app/api/v1/router.py`，视频任务与 tracker job 等 task 子路由由 `apps/api/app/api/v1/tasks/` 管理。

数据模型位于 `apps/api/app/db/models/`。除用户、项目、任务和标注外，运行时还依赖数据集 / scene、batch、prediction、ML backend registry、视频 frame / segment / tracker job、审计与通知等模型；变更前先查对应 schema、service 与迁移，而不要假设只有四张核心表。

### 配置

通过环境变量或 `.env` 文件配置，参考 `.env.example`。

## Grounded-SAM-2 ML Backend（v0.9.x）

`apps/grounded-sam2-backend/` 独立 GPU 服务，提供工作台 `S` 工具与 `/ai-pre` 文本批量预标的 SAM mask 推理。三种 prompt（point / bbox / text）路由到 SAM 2.1 + GroundingDINO；mask→polygon 简化用 `apps/_shared/mask_utils`（v0.9.4 phase 3 抽出共用，与 v0.10.x sam3-backend 共享）。

### 起 / 停

> GPU backend 在叠加文件 `docker-compose.ml.yml`，下方命令均须带 `-f docker-compose.yml -f docker-compose.ml.yml`（或在 `.env` 设 `COMPOSE_FILE=docker-compose.yml:docker-compose.ml.yml` 后省略）。

```bash
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu up -d grounded-sam2-backend   # 起
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu down                          # 停（保留 checkpoints / hf_cache volumes）
docker logs -f ai-annotation-platform-grounded-sam2-backend-1     # 看 "models loaded; device=cuda"
curl -fsS http://localhost:8001/health                             # 探活
curl -fsS http://localhost:8001/cache/stats                        # SAM 2 image embedding LRU 命中率（v0.9.1）
```

### Rebuild（改了 backend 代码 / Dockerfile / mask_utils 后必跑）

build context **从 v0.9.4 phase 3 起升级到 `apps/`**（让 Dockerfile 能 COPY 兄弟目录 `_shared/mask_utils`）。**历史命令 `docker build apps/grounded-sam2-backend/` 已不可用**。

```bash
# 推荐：走 docker compose
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu build grounded-sam2-backend
docker compose -f docker-compose.yml -f docker-compose.ml.yml --profile gpu up -d grounded-sam2-backend   # 重建后重起容器

# 或直接 docker build（需手指定 Dockerfile 路径 + 父目录 context）
docker build -f apps/grounded-sam2-backend/Dockerfile apps/
```

> **首次构建 ~10 min**（vendor Deformable Attention CUDA 算子要 nvcc 现场编译）；只改业务代码时只重做后两层 COPY ~3 min。改 vendor 才会触发完整重编。

### 协议契约

- **请求**：`POST /predict { task: { id, file_path }, context: { type, ... } }`
- **`context.type`**：`point` / `bbox` / `text`
- **v0.9.4 phase 2 字段**：`output: "box" | "mask" | "both"`（仅 type=text 生效，默认 mask 老前端兼容）
- **v0.9.4 phase 3 字段**：`simplify_tolerance: float | null`（仅 mask/both 路径，默认 1.0；像素级；调高减顶点 / 调低保细节；顶点 > 200 后端 logger.warning）
- 完整协议见 [docs-site/dev/reference/ml-backend-protocol.md](docs-site/dev/reference/ml-backend-protocol.md)

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

> 开发态 / staging / 生产态的整体差异（谁进容器、profile、`ENVIRONMENT` 断言行为）见概念页 [运行环境形态](docs-site/dev/concepts/runtime-environments.md)；逐项环境变量与运维细则见 [部署指南](docs-site/ops/deploy/docker-compose.md)。

### 开发环境

```bash
docker compose up -d     # 基础服务
pnpm dev:web             # 前端 :3000
pnpm dev:api             # 后端 :8000
```

### 生产（api/web 进容器）

```bash
# 1. 准备生产配置：复制 .env.example → .env.production，逐项审过
#    （ENVIRONMENT=production 下 SECRET_KEY / CORS_ALLOW_ORIGINS / MINIO_SECRET_KEY 等必填）
cp .env.example .env.production

# 2. 叠加 prod 文件，基础设施 + api/web 容器一起拉起、worker 改用生产配置
#    --env-file 不可省：用于覆盖 worker 硬编码的 dev 凭据（详见 docker-compose.prod.yml 注释）
docker compose --env-file .env.production \
  -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

> 开发态不带 `-f docker-compose.prod.yml`，api/web 仍跑宿主机。
> 单独构建镜像：`docker build -f infra/docker/Dockerfile.web -t anno-web .` / `docker build -f infra/docker/Dockerfile.api -t anno-api apps/api/`。

## 测试与文档

```bash
# 前端测试
pnpm test                        # vitest 单测
pnpm --filter @anno/web test:coverage  # 前端带覆盖率
pnpm test:e2e                    # Playwright E2E（需后端运行）

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
pnpm --filter @anno/docs-site check:all  # 文档元数据、导航与生成物检查
```

完整测试指南见 [docs-site/dev/testing.md](docs-site/dev/testing.md)。

## 截图自动化

用户手册截图（`docs-site/user-guide/images/`）由 Playwright 脚本驱动重生成，
不进默认 CI，由 maintainer 手动触发。截图脚本只使用 `screenshots`
seed profile 和只读 catalog，不会随机选取开发库里的项目。`--repair` 只收敛带截图
seed 标记的对象，用户自建项目不受影响。

### 前置条件

```bash
docker compose up -d                                       # postgres / redis / minio
cd apps/api && uv run alembic upgrade head                 # 必含 0046（skip_reason）
cd apps/api && uv run uvicorn app.main:app --port 8000     # 另开窗口
pnpm dev:web                                               # 另开窗口，:3000
pnpm exec playwright install chromium                      # 首次需下载浏览器

# 有 GPU/真实 backend：按能力发现并绑定图片、视频、OCR backend
cd apps/api && PYTHONPATH=. uv run python scripts/seed.py \
  --profile screenshots --repair --ml-backend-mode live
```

没有 GPU 时使用协议 stub。它仍经过 `/health`、`/setup`、全局 registry、项目启用关联和
主 backend 绑定，不会在数据库里伪造“已连接”状态：

```bash
docker compose -f docker-compose.yml -f docker-compose.ml.yml \
  --profile screenshots up -d --build screenshot-ml-stub

cd apps/api && PYTHONPATH=. uv run python scripts/seed.py \
  --profile screenshots --repair --ml-backend-mode stub
```

stub 地址默认复用 `ML_BACKEND_STORAGE_HOST` 的主机部分并使用 `9100` 端口，确保宿主 API
和 Celery 容器都能访问；Docker 网关不同时可显式传
`--ml-backend-url http://<gateway>:9100`。seed 会按能力而非 backend 名称选择：图片要求
point、interactive box 与 exemplar，视频要求交互 tracker，OCR 要求整图输入及文本属性输出。
任一能力、连接、启用关联或主绑定缺失都会退出非零。

### 触发

```bash
SCREENSHOT_VALIDATE_ONLY=1 pnpm --filter web screenshots  # 只验证场景，不写 PNG/manifest
pnpm --filter web screenshots                              # 生成 desktop-light 正式图
pnpm --filter web screenshots:dark                         # 显式声明的深色场景
pnpm --filter web screenshots:matrix                       # desktop-light/dark/mobile
pnpm --filter web screenshots:flows                        # 流程 GIF，需 ffmpeg
pnpm --filter web screenshots:regression                   # 比较 9 张高价值视觉基线
pnpm --filter web screenshots:regression:update            # 有意 UI 变化后更新基线
```

当前完整矩阵有 61 个自动截图目标：58 个 desktop-light、2 个显式 dark 和 1 个显式 mobile；
另有 3 张手工 PNG 和 13 个文档目标 GIF。生成后使用 `git diff docs-site/user-guide/images/`
人工审阅 PNG 和 GIF 正文帧；完整 matrix 成功后才原子重建 v2 manifest，定向运行和 validate-only 不会替换它。
流程脚本结束时会通过 `--repair` 恢复截图 seed 的期望状态。资产检查命令：

```bash
pnpm --filter web screenshots:lint
node docs-site/scripts/check-image-manifest.mjs --release
node docs-site/scripts/check-orphan-images.mjs --strict
```

**E2E 跑过后想恢复 dev 账号**：`pnpm test:e2e` 内部仍会 TRUNCATE 重建 fixture（含
`@e2e.test` 三个账号）。如果 dev 账号被清掉，重跑上面的 screenshots seed
命令即可恢复 catalog 中的固定账号、项目、任务、批次与 backend 绑定。

### 改场景

- 58 个 desktop-light 场景按功能放在 `apps/web/e2e/screenshots/scenes/`；新增项目场景
  必须声明 `fixture` 并通过 catalog 逻辑键生成 `route`。
- 主入口 `apps/web/e2e/screenshots/screenshots.spec.ts` 在浏览器导航前校验项目、任务、
  批次、backend 和场景能力，并分别使用 `admin`、`anno` 和 `qa` 的真实身份。
- 独立 config：`apps/web/playwright.screenshots.config.ts` —— 与默认 `playwright.config.ts`
  分离（默认 `testMatch: ["**/tests/**/*.spec.ts"]` 不收录 screenshots）。
- 用 `SCREENSHOT_VALIDATE_ONLY=1` 开发场景：它仍执行登录、导航、能力与 locator
  检查，但不覆盖正式资产或 manifest。

### 已知坑

- **远程浏览器只显示模糊占位图**：根 `.env` 保持 `MINIO_PUBLIC_URL=/minio`，
  DEV 会让签名媒体走页面同源的 `:3000/minio` 并由 Vite 转发到 MinIO，远程机器
  只需打通 3000 端口。若返回 `localhost:9000` 或宿主机 `:9000`，会分别命中
  访问者自己或受跨网段端口策略影响。`ML_BACKEND_STORAGE_HOST` 是容器的另一层
  地址，可以继续使用 Docker 网关。修改 `.env` 或 Vite 代理配置后重启 API/Web。
- **截图 seed 报 backend 能力不足**：live 模式只接受当前可达且能力快照覆盖截图场景的
  registry，不按名称猜测。确认目标 backend 已启动并被 API 同步；无 GPU 时启动
  `screenshot-ml-stub` 后改用 `--ml-backend-mode stub`。不要把浏览器的 `/minio`
  地址拿来配置 backend，后者必须同时对宿主 API 和 Celery 容器可达。
- **远程工作台一直「重连中」**：DEV 中的 WebSocket 默认跟随页面同源，由
  Vite 将 `:3000/ws` 升级并转发到本机 API。只有本机打开页面时才直连
  `localhost:8000`。不要把 Docker 默认 IP 或服务器端 `localhost` 发给远程浏览器；
  如果确需覆盖，使用对远程浏览器可达的 `VITE_WS_HOST`。
- **seed repair 后点项目被退回总览**：`--repair` 可能为 seed 自有项目生成新 UUID。
  旧页签或已缓存的项目卡片仍指向旧 UUID 时会跳回总览；修复数据后强制刷新
  项目总览一次。
- **中文路径**：仓库根含中文（`AI标注平台设计/`）时，`import.meta.url` 会 percent-encode；
  `screenshots.spec.ts` 已 `decodeURIComponent` 兜底，写到正确位置而非 `AI%E6%A0%87...` 镜像目录。
- **时间或动画导致截图漂移**：截图 driver 已固定测试时钟、语言、时区、DPR 并禁用动画；
  新场景还必须等待字体、图片解码和具体业务 ready selector，不要依赖单纯延时。

## 测试账号

> 仅 `development` / `staging` 环境可用（seed.py 拒绝在 production 执行）。

| 账号 | 角色 | 密码 | 初始视图 |
|------|------|------|---------|
| `admin` | super_admin | 123456 | Dashboard |
| `pm` | project_admin | 123456 | 项目总览 |
| `qa` | reviewer | 123456 | ReviewerDashboard |
| `anno` | annotator | 123456 | AnnotatorDashboard |
| `viewer` | viewer | 123456 | ViewerDashboard |
| `anno2` | annotator | 123456 | (标注组A) |
| `anno3` | annotator | 123456 | (标注组B) |

初始化：`cd apps/api && uv run python scripts/seed.py`

## 下一步计划

详见 [CHANGELOG.md](CHANGELOG.md) 顶部的 roadmap 与 [docs/plans/](docs/plans/) 下的具体计划。
