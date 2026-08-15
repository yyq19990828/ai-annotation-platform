---
title: 更新文档截图
description: 如何新增场景、更新现有截图、维护视觉回归基线
audience: [developer]
type: how-to
status: stable
last_reviewed: 2026-07-23
---

# 更新文档截图

本平台采用 Playwright 自动化产出文档图片，支持矩阵化截图（多视口 / 多主题）、
元素级裁切、SVG 注释叠加、网络状态 mock 以及流程录制（GIF/WebM）。

## 快速运行

截图自动化使用专用 `annotation_screenshots_test` 数据库和 `3001/8010`
端口，不复用日常开发的 `annotation` 数据库或 `3000/8000` 进程。

### 1. 准备、迁移并填充专用库

```bash
docker compose up -d postgres redis minio

cd apps/api
export SCREENSHOT_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/annotation_screenshots_test
DATABASE_URL="$SCREENSHOT_DATABASE_URL" uv run python scripts/prepare_e2e_db.py
DATABASE_URL="$SCREENSHOT_DATABASE_URL" uv run alembic upgrade head
DATABASE_URL="$SCREENSHOT_DATABASE_URL" PYTHONPATH=. uv run python scripts/seed.py \
  --profile screenshots --repair --ml-backend-mode live
```

`prepare_e2e_db.py` 可重复执行，且会拒绝库名不以 `_e2e` 或 `_test` 结尾的
目标。无 GPU 时先启动 `screenshot-ml-stub`，再把 seed 命令的模式改为
`stub`。

### 2. 启动专用 API 和 Web

在两个窗口分别运行：

```bash
# 窗口 A：数据库必须与建库、迁移、seed 完全一致
cd apps/api
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/annotation_screenshots_test \
  E2E_SEED_ENABLED=true ENVIRONMENT=development \
  uv run uvicorn app.main:app --host 127.0.0.1 --port 8010

# 窗口 B：Web 只代理到上面的专用 API
cd apps/web
API_PROXY_TARGET=http://127.0.0.1:8010 PORT=3001 pnpm dev --host 127.0.0.1
```

`E2E_SEED_ENABLED` 仅对这个专用 API 进程临时开启。路由还会在数据库会话中
验证 `_test` 后缀，不要将 API 命令的 `DATABASE_URL` 改为开发库。

### 3. 运行截图矩阵

```bash
cd apps/web
export PLAYWRIGHT_BASE_URL=http://127.0.0.1:3001
export PLAYWRIGHT_API_BASE=http://127.0.0.1:8010

pnpm screenshots                  # desktop-light 全量（最常用）
pnpm screenshots:dark             # desktop-dark 变体
pnpm screenshots:matrix           # desktop-light / dark / mobile
pnpm screenshots:flows            # 流程录制 → 简短文档 GIF（需 ffmpeg）
pnpm screenshots:marketing        # 4K60 MKV 采集源 + MP4/H.264 通用母版（需 X11/NVIDIA/ffmpeg）
pnpm screenshots:regression       # 比较高价值视觉回归基线
pnpm screenshots:regression:update # 有意改变 UI 后更新基线
pnpm screenshots:lint             # 快速检查静态引用与 manifest

# 开发/验证场景：执行真实导航和 locator 校验，但不写 PNG/manifest
SCREENSHOT_VALIDATE_ONLY=1 pnpm screenshots

# 首页 Hero 静态卡片源图更新后，重新生成轻量 WebP
pnpm --filter @anno/docs-site media:home-hero
```

截图脚本从只读 screenshot catalog 获取当次运行的 UUID，并分别使用 seed 中的
`admin`、`anno` 和 `qa` 账号呈现超管、标注员和审核员的真实项目关系。
AI 场景必须先绑定能力匹配的 ML Backend；无 GPU 时启动
`screenshot-ml-stub` 并把 seed 命令的模式改为 `stub`。
stub 模式可以验证并更新普通截图与 GIF，但不得用于替换首页媒体所依赖的 4K60 SAM3 母版，
避免协议替身进入对外展示的真实模型流程。

### 录制高清营销母版

`screenshots:marketing` 复用同一组 flow 和隔离数据库，但使用独立的
`marketing-master` project。工作台保持 1440×810 的逻辑 viewport，再以 1.8 设备像素倍率渲染为
2592×1458；控件、文字和画布内容因此保持文档工作台的视觉比例。这个采集尺寸能在无物理显示器的
远程 X11 会话中稳定保留真实 60Hz 动作，随后使用 Lanczos 统一生成 3840×2160 交付母版。
录制器先用校准色块从 X11 画面测出 Chromium 内容区的实际边界，不依赖窗口装饰高度或底部对齐裁切；
只有测得区域恰好为 2592×1458 时才会启动正式流程。成功的单目标流程会让
X11 按 60Hz 主动采样 Chromium 窗口，再由 `h264_nvenc` 硬件编码，
精确裁出内容区并将按核心动作窗口裁切后的 4K MKV/H.264 作为不可变采集源，同时转码一份
MP4/H.264 通用母版，两者都存到仓库根目录的
`.artifacts/marketing/`，不直接生成或覆盖文档 GIF、首页视频和海报；站点成品统一由后续派生命令生成。

每个营销目标必须在[高清营销资产目录](../reference/marketing-asset-catalog.md)
登记后才能归档。一个 `asset_id` 对应一个独立测试和一个明确主题；不要把无关功能混在
同一段录制中。包含登录、画框、提交和导入标注的 `e2e-quickstart` 是文档组合教程，营销 project
会显式跳过它。归档器会用 `ffprobe` 强制检查两份视频的 3840×2160、60fps，并检查两份母版的
最短/最长时长、编码和非全黑画面；任一门禁不符合时录制直接失败。MKV 与 MP4 使用相同的绝对动作时间窗口，
都会去掉登录、白屏、骨架屏和网络等待，未裁切缓存只在生成期间存在并在结束时删除。核心动作短于规格下限时，
不得向前回填登录或加载画面，也不得通过慢放、故意放慢操作或无意义重复动作满足时长门禁；应补齐与主题相关的必要镜头，
或修正该资产的最短时长。

营销录制必须运行在本机 X11 显示上，并要求 Chromium 硬件合成、ffmpeg 的 X11 采集与 `h264_nvenc`。启动器会在录制前
测量 120 个 `requestAnimationFrame`，并录制 1.1 秒 GPU 合成层校准动画后解码检查有效帧节奏：软件渲染、
GPU 合成未启用、p95 帧间隔超过 20ms、校准段少于 58 个采样帧、有效独立画面低于 55fps，
或独立帧占比低于 90% 都会直接失败。拖拽路径逐帧使用受信任的 Playwright 鼠标事件按 60Hz
节拍发送，避免浏览器指针状态与 Konva 拖拽状态脱节而在松手时跳到终点。
桌面至少需要 2700×1750，以容纳 2592×1458 内容区和浏览器边框；
`--resize-display` 会临时调整 X11 framebuffer，并在成功、失败或中断后恢复原尺寸。

全量录制前建议先定向跑一个流程：

```bash
cd apps/web
MARKETING_CAPTURE_DISPLAY=:0 \
MARKETING_XAUTHORITY=/run/user/1000/gdm/Xauthority \
pnpm screenshots:marketing -- --resize-display --grep "bbox-draw"
```

每次命令使用独立的 `<UTC 时间>-<commit>` 目录。批次身份在启动 Playwright 前就已固定；
即使某项失败导致 worker 重启，后续成功资产仍写入同一份 manifest，不会被拆成多个伪批次：

```text
.artifacts/marketing/<run-id>/
├── manifest.json
├── raw/
│   └── <asset-id>/
│       └── <sha256>.mkv
└── masters/
    └── <asset-id>/
        └── <sha256>.mp4
```

`manifest.json` 记录源 commit、工作树是否有未提交修改、seed revision、浏览器，
以及 `capture` 中的驱动、采集源尺寸、4K 交付尺寸、重采样方式、逻辑 viewport、设备像素倍率、60fps 合同，
以及校准段时长、采集帧数、独立帧数、有效独立帧率和独立帧占比；
`files.capture_source` 和 `files.universal_mp4` 记录各自的 codec / 分辨率 / 帧率 /
时长、字节数、SHA-256 和预留 `storage_key`。每个 entry 的 `content` 还会固化资产标题、主题、目标、时长策略、
分镜和剪辑提示，作为后期 Agent 的机器可读交接信息。初始 `review_status` 固定为
`pending`；对外上传或剪辑前必须人工检查敏感信息、个人数据、模型结果和画面构图。
`source_clip_seconds` 会同时记录 MKV 与 MP4 相对未裁切缓存的起点和请求时长；
两份可交付母版都只保留已稳定页面中的核心动作窗口。

工作台流程必须使用 seed catalog 中经过复核的 `normalized_media` 锚点，并根据图片或视频在 stage
中的实际渲染矩形换算坐标，不能用包含 letterbox 的整个容器边界。人工工具在结束前必须选择锚点声明的
精确类别，并等待 annotation 创建/更新接口成功；AI 工具还必须录全真实目标提示、候选、人工采纳和落库结果。

`.artifacts/marketing/` 整体被 Git 忽略，是待同步的本地私有母版区，不是备份。
在 Google Drive / R2 / S3 上传和摘要校验尚未完成前，不要删除该运行目录。录制命令不读取
也不保存对象存储凭证。

Playwright 在整次运行开始时只做一次严格 catalog 预检，并把同一逻辑键快照提供给
desktop-light、dark、mobile 和 regression project。运行期间不要 repair seed 或删除项目；
场景自己的正常读取不会触发跨 project 的第二次全库预检。

不要在文档里手写 PNG、GIF 或视频数量。当前数量由静态 `manifest.json`、流程
`flow-manifest.json`、磁盘文件和文档引用实时计算；发布判断以这些来源的一致性为准。

## 目录结构

```
apps/web/e2e/screenshots/
├── scenes/                    # 场景声明（按功能分文件）
│   ├── _types.ts              # ScreenshotScene 接口定义
│   ├── auth.ts
│   ├── workbench-polygon.ts
│   ├── workbench-ai.ts
│   ├── workbench-media.ts
│   ├── projects.ts
│   ├── review.ts
│   ├── export.ts
│   ├── ai-pre.ts
│   └── index.ts               # 聚合导出
├── catalog.ts                     # fixture / backend capability 预检
├── catalog-runtime.ts             # 单次运行共享的 catalog 快照
├── environment.ts                 # 固定时钟、禁动画、资源 ready
├── global-setup.ts                # 整次 Playwright 运行的 fail-closed 预检
├── manifest-reporter.ts           # 成功矩阵后原子重建 manifest
├── _helpers/
│   ├── annotate.ts            # SVG overlay 注释
│   ├── mock-state.ts          # page.route 网络状态 mock
│   ├── recorder.ts            # video → GIF / WebM / WebP 海报转换
│   ├── marketing-assets.ts    # 营销资产主题、分镜与时长规格
│   ├── marketing-external-recorder.ts # 4K60 外部采集与 GPU/刷新率门禁
│   └── marketing-recorder.ts  # 高清母版转码、归档与 manifest
├── flows/                     # 流程录制脚本
│   ├── e2e-quickstart.ts
│   ├── ai-prediction-import.ts
│   ├── ai-preannotate.ts
│   ├── ai-tracker-panel.ts
│   ├── sam-interactive.ts
│   ├── review-reject.ts
│   └── flows.spec.ts
├── regression/                # 视觉回归
│   ├── regression.spec.ts
│   └── __screenshots__/       # 基线截图（提交入 git）
├── outputs/
│   ├── manifest.json          # 提交入 git 的 v2 图片清单
│   ├── flow-manifest.json     # GIF、文档 MP4、首页视频与封面的生成来源清单
│   └── flows/                 # GIF / WebM 临时目录（不提交）
└── screenshots.spec.ts        # 主 driver

.artifacts/marketing/             # 高清私有母版与运行 manifest（Git 忽略）
```

## 新增一个截图场景

### 1. 在对应类别文件中添加 scene

```typescript
// apps/web/e2e/screenshots/scenes/projects.ts
export const PROJECT_SCENES: ScreenshotScene[] = [
  // ... 已有场景

  {
    name: "projects/my-new-scene",
    role: "admin",
    fixture: {
      project: "image_demo",
      task: "annotating",
    },
    route: (catalog) => `/projects/${catalog.projects.image_demo.id}/settings`,

    prepare: async (page, catalog) => {
      await page.getByText(catalog.projects.image_demo.name, { exact: true }).waitFor();
      // 打开目标 tab / modal / 交互
    },

    // 截图模式（不填 = viewport）
    capture: { kind: "locator", selector: '[data-testid="my-panel"]', padding: 8 },

    // 自动注释（可选）
    annotate: [{ selector: '[data-testid="key-button"]', style: "rect-red", label: "点击这里" }],

    // 数据脱敏（可选，叠加到默认 mask 之上）
    mask: ["[data-testid='sensitive-info']"],

    // 矩阵（可选，不填只跑 desktop-light）
    matrix: { themes: ["light", "dark"] },

    target: "docs-site/user-guide/images/projects/my-new-scene.png",
  },
];
```

### 2. 定向验证场景

```bash
cd apps/web
# 先只验证，不写正式资产
SCREENSHOT_VALIDATE_ONLY=1 pnpm screenshots --grep "my-new-scene"
# 需要检查画面时可定向生成目标图；这不会发布完整 manifest
pnpm screenshots --grep "my-new-scene"
```

### 3. 在文档中引用

推荐使用 `<AutoImage>` 组件（自动显示「自动产出」badge）：

```md
<AutoImage src="projects/my-new-scene.png" alt="我的新场景" />
```

或普通 Markdown 图片：

```md
![我的新场景](../images/projects/my-new-scene.png)
```

### 4. 发布完整矩阵和 manifest

```bash
cd apps/web
pnpm screenshots:matrix
pnpm screenshots:lint

cd ../..
node docs-site/scripts/check-image-manifest.mjs --release
node docs-site/scripts/check-orphan-images.mjs --strict
pnpm docs:media:audit -- --release
```

只有 desktop-light、desktop-dark、mobile 三个 project 全部成功时，reporter 才会原子
重建 manifest；失败、定向运行、`--list` 和 `SCREENSHOT_VALIDATE_ONLY=1` 都不会替换它。
每个自动条目记录 scene、源码文件、capture/fixture、seed revision、commit、浏览器、
视口/主题/语言、生成时间、SHA-256 和像素尺寸。`--strict` 检查现有资产四方一致性；
全量重拍交付前再用 `--release` 要求所有当前 scene 和 seed revision 都已更新。

人工审阅时至少检查每张 PNG 的主体内容、加载状态和敏感信息；GIF / MP4 / WebM 除首帧外
还要抽查核心动作和最终结果，并确认动效完整、体积合理。首页 WebM 与 MP4 fallback 还需检查对应 WebP 海报能独立说明
场景，主图不被浮动面板遮挡，且移动端与 `prefers-reduced-motion` 下不自动播放。Hero 源图更新后还要
重新生成派生 WebP。录制结束后 `outputs/flows/` 必须为空。

## 生成来源与人工复核版本

生成来源和人工复核是两个独立事实：

- `manifest.json` 与 `flow-manifest.json` 记录素材在哪个 commit、seed 和录制流程上生成。
- `docs-site/maintainers/media-reviews.json` 记录素材最后一次完成视觉和内容复核的 commit、时间、哈希、复核人和关联路径。

先运行 `pnpm docs:media:audit` 查看 `broken / stale / review-due / current`。只有工作树干净、素材已经提交且人工检查完成后，才能执行：

```bash
pnpm docs:media:approve -- --asset docs-site/public/media/video/tracker-box-seed.mp4
pnpm docs:media:audit -- --release
```

批准命令拒绝在脏工作树上运行，避免把视觉结论绑定到不完整的 SHA。普通审计只阻断文件缺失、已批准文件哈希变化或关联路径变化；发布审计还要求所有引用素材有生成来源、使用当前 seed、生成时工作树干净，并且人工复核未超过 30 天。每周工作流只生成报告，不自动重录或自动批准。

较长流程从私有 4K60 母版派生文档媒体：

```bash
pnpm docs:media:derive
```

派生器读取最新营销运行 manifest，为用户手册输出 1280×720、30fps、H.264/yuv420p MP4 和 WebP 封面；首页的 AI 辅助、OCR 与三种 SAM 工具同时输出 1280×720、30fps 的 VP9 WebM、H.264 MP4 fallback 和 WebP 封面。两类成品都会把母版运行 ID、资产 ID、来源 SHA 和派生哈希写入 `flow-manifest.json`。文档正文使用 `<DocsVideo>`；组件初始只加载封面，首次进入可视区域才挂载 MP4 来源并按设置播放，离开可视区域后暂停，减少同页多段视频的并发下载和解码。简单且不超过约 6 秒的微交互才保留 GIF。

## `ScreenshotScene` 完整字段说明

| 字段        | 类型                                         | 说明                                                       |
| ----------- | -------------------------------------------- | ---------------------------------------------------------- |
| `name`      | `string`                                     | 唯一标识，用于 `--grep` 过滤                               |
| `role`      | `Role \| Role[]`                             | 登录角色（admin / annotator / reviewer）                   |
| `fixture`   | 可选对象                                     | 场景依赖的 catalog 项目、任务、批次、backend 和 capability |
| `route`     | `(catalog: ScreenshotSeedCatalog) => string` | 用 catalog 逻辑键构造页面路由                              |
| `prepare`   | 可选函数                                     | 截图前交互（打开 modal / 切 tab 等）                       |
| `capture`   | 可选                                         | 截图模式：fullPage / locator / clip                        |
| `annotate`  | 可选数组                                     | 自动红框 / 编号注释                                        |
| `mask`      | 可选 `string[]`                              | 额外脱敏选择器                                             |
| `mockState` | 可选                                         | 网络状态：empty / error / loading / rate-limited           |
| `matrix`    | 可选                                         | 矩阵维度：viewports / themes / locales                     |
| `target`    | `string`                                     | 输出 PNG 路径（相对仓库根）                                |

## 视觉回归基线更新

当 UI 有意改变导致 regression 失败时：

```bash
cd apps/web
# 先在 protocol stub + screenshots seed 环境更新基线
pnpm screenshots:regression:update

# 无更新模式复跑，确认基线可稳定比较
pnpm screenshots:regression

# 查看 diff（在 test-results/ 目录）
# 确认无误后提交基线变更
git add e2e/screenshots/regression/__screenshots__/
git commit -m "chore(screenshots): 更新视觉回归基线 — <变更原因>"
```

## 手动维护的图

手工合成且没有可复现场景的图片使用 `auto: false`。自动 driver 在写文件前会拒绝覆盖
这类 target，完整矩阵只会保留磁盘上真实存在的手工条目。手工图片改变后必须同步更新
哈希、尺寸和时间，再运行严格检查：

```json
{
  "schema_version": 2,
  "entries": {
    "docs-site/user-guide/images/<page>/<figure>.png": {
      "auto": false,
      "target": "docs-site/user-guide/images/<page>/<figure>.png",
      "note": "示意图需人工合成，自动化无法复现",
      "provenance": "manual",
      "sha256": "<64 位摘要>",
      "width": 1440,
      "height": 900
    }
  }
}
```

## 常见问题

**Q: seed/catalog 报项目、任务或 backend 缺失**
确认已启动 live backend 或截图协议 stub，然后重跑 `scripts/seed.py --profile screenshots
--repair --ml-backend-mode <live|stub>`。catalog 会在导航前报出具体逻辑键和缺失能力，
不会退化为任意项目。

**Q: locator 截图失败（元素找不到）**
检查 `data-testid` 是否正确，或在 `prepare` 里等待具体业务 ready selector。
locator capture 不会退化为整页图；元素缺失必须修复场景或产品问题。

**Q: 远程打开工作台一直显示「重连中」**
DEV 远程页面应连当前 `:3000` 同源的 `/ws`，由 Vite 升级并转发到 API。
不要把 Docker 默认 IP 或服务器的 `localhost:8000` 当成远程浏览器可达地址。
同理，媒体应走同源 `/minio`。详见 [WebSocket 调试](./debug-websocket.md)。

**Q: ffmpeg 不可用，GIF 无法生成**
安装 ffmpeg：`sudo apt install ffmpeg` 或 `brew install ffmpeg`，
或设置 `FFMPEG_PATH=/path/to/ffmpeg`。
营销母版还会调用同一安装包提供的 `ffprobe` 校验实际媒体参数。

**Q: 视觉回归误报（字体渲染差异）**
先确认 CI 与本机都使用 Playwright Chromium、固定时区/语言/DPR 和 protocol stub。
确有平台级渲染差异时，再在 `regression.spec.ts` 里对单个场景调整阈值，避免放宽全部基线。
