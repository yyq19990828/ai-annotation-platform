# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |

---

## 最新版本
## [0.9.2] - 2026-05-07

> **Grounded-SAM-2 接入 M2 — 工作台 `S` 工具 + 文本入口 + DINO 阈值项目级 override（Luminous Canvas）。** v0.9.0 / v0.9.1 把 backend 容器化 + embedding 缓存铺好后，标注员仍然没有任何入口能触发 SAM；本版把后端能力下沉到工作台：新工具 `S` 让标注员**点 / Alt+点 / 拖框** 都能 < 50ms（命中缓存）拿到 polygon 候选，AI 助手在 S 模式下露出**文本提示**输入框（"person" 这样的英文 prompt 一键全图召回）；候选以**紫虚线**叠加 Konva 画布，`Enter` 接受 / `Esc` 取消 / `Tab` 切候选。同窗口把 GroundingDINO 的 box / text 阈值做成 ProjectSettings 项目级旋钮（默认 0.35 / 0.25），不同业务图（车牌 / 商品 / 卫星）可独立调参。

### Added

- **`apps/web/src/pages/Workbench/state/useInteractiveAI.ts`**（新 hook）：所有 prompt 都走 `mlBackendsApi.interactiveAnnotate`；`runPoint` 80ms 防抖合并连续点击（最后一次为准），`runBbox` / `runText` 不防抖；`inflightRef` 单调计数让晚到的过期请求不会覆盖最新候选；mlBackendId 缺失守卫 + toast「项目未绑定 ML Backend」；返回 `candidates` / `activeIdx` / `cycle` / `consume` / `cancel` / `isRunning`。
- **`apps/web/src/pages/Workbench/stage/tools/SamTool.ts`**（新工具）：`id="sam"` / `hotkey="S"` / `icon="sparkles"`；`onPointerDown` 返回新的 `samProbe` DragInit（保留 evt.altKey 给 negative point），与 BboxTool 完全隔离避免互相污染。
- **`ImageStage` SAM 路径**：DragInit / Drag union 加 `samProbe`；松手时按几何尺寸分流 — `dx<0.005 && dy<0.005` 视为单击 → `onSamPrompt({kind:"point", pt, alt})`；否则 → `onSamPrompt({kind:"bbox", bbox})`；拖框过程中渲染**紫色虚线预览框**（与候选 polygon 视觉同源）。新增 `samCandidates` / `samActiveIdx` props，候选 polygon 以 `Konva.Line(closed, dash, fill α=0.18 当前 / 0.06 其它)` 叠加，当前候选 stroke 加粗 2.5x、其它 1.4x、opacity 0.55 半透。
- **WorkbenchShell SAM 接受流**：捕获阶段（`window.addEventListener("keydown", ..., true)`）拦 `Enter` / `Esc` / `Tab` —— S 工具 + 候选非空时介入，否则透传给主 dispatcher；接受时锁定 `samPendingAccept = { idx }`，按候选 polygon AABB（`polygonBounds`）锚 `ClassPickerPopover`，DINO 短语恰好匹配项目类别时作为默认值；`handleSamCommitClass` 复用 `submitPolygon` 落库 + `sam.consume(idx)` 出队；切题（`taskId` 变化）和退出 SAM（`s.tool` 改非 sam）都自动 `sam.cancel()`，避免残留紫虚线。
- **`AIInspectorPanel` SAM 文本入口**（`SamTextPanel` 子组件，仅 `tool === "sam"` 时渲染）：「SAM 文本提示」区段，输入框 + 「找全图」按钮 + 候选数 chip + 「英文 prompt 召回最佳」hint；输入框 Enter 直接触发 `onRunSamText(trimmed)`，推理中按钮置灰显「推理中…」。
- **快捷键**：`hotkeys.ts` `setTool` union 加 `"sam"`；`HOTKEYS` 列表加 `S` 键（group "ai"）；`RESERVED_LETTERS` 加 `s/S` 防止落到 `setClassByLetter`；`HotkeyCheatSheet` 自动从 SoT 渲染。
- **Project 阈值字段**：`Project.box_threshold` / `text_threshold` `REAL NOT NULL DEFAULT 0.35 / 0.25`，CHECK `0..1`；`ProjectCreate` / `ProjectUpdate` / `ProjectOut` 全部加字段；`GeneralSection.tsx` 新增两条 range 滑块（step 0.05），`dirty` 检测 + `onSave` payload 一并透传。
- **`/ml-backends/{bid}/interactive-annotating` 阈值注入**：`type=text` 时读 project 字段写入 `context.box_threshold` / `text_threshold`；客户端如已显式给阈值则尊重客户端（`setdefault` 语义）；point / bbox 不注入（DINO 不参与，避免污染缓存键 / 协议噪声）。
- **`apps/grounded-sam2-backend` 阈值 override**：`predictor.predict_text(box_threshold, text_threshold)` 关键字参数，None 回退到 instance 默认（来自 backend env）；`main.py::_run_prompt` 从 `ctx` 读取并透传。
- **测试**：`useInteractiveAI.test.ts` 10 case（point / bbox / text 路由 + Alt 极性 + 防抖合并 + 守卫 + 失败 toast + 空结果提示 + cycle wrap + cancel）；`hotkeys.test.ts` 加 `S → setTool sam` 断言；`apps/api/tests/test_interactive_threshold_inject.py` 3 case（text 注入 / 客户端显式覆盖 / point 不注入）。
- **Alembic `0048_project_dino_thresholds`**：DO 块幂等加 NOT NULL 列 + 0..1 CHECK 约束；downgrade 反向干净。

### Changed

- **OpenAPI snapshot 重生**：`apps/api/openapi.snapshot.json` + `docs-site/api/openapi.json` 一并刷新（`scripts/export_openapi.py`），前端 `apps/web/src/api/generated/types.gen.ts` 经 `pnpm codegen` 加入 `box_threshold` / `text_threshold`。
- **ToolDock 顺序**：`ALL_TOOLS = [Bbox, Sam, Polygon, Hand]`，`SamTool` 排在矩形 / polygon 之间，强调它是 AI 加速的"高级矩形"；`canvas` 工具不入 ToolDock（仅评论批注用，从入口语义切走）。

### Notes

- **不做翻译**：v0.9.x §5 待决问题决策 1 — 后端尚无 LLM client，引入会挤压 6 天预算；改在文本框旁加 hint「英文 prompt 召回最佳」。后续如客户反馈强烈，单开 micro-feature 走平台 LLM 网关。
- **E2E 推迟**：完整 SAM E2E 需要 `/_test_seed` 加 `seed_ml_backend` 工厂（属于 E2E 基础设施扩展），范围超出 M2；vitest（349 全过）+ pytest（277 全过）已守住核心链路。E2E 在 v0.9.3 / M3 收口前补。
- **协议契约**：`ml-backend-protocol.md` 不动；`context` 仍是开放 dict，`box_threshold` / `text_threshold` 是 backend 可选感知字段（缺省走 backend env 全局值）。

详细计划：[`docs/plans/2026-05-07-v0.9.2-luminous-canvas.md`](docs/plans/2026-05-07-v0.9.2-luminous-canvas.md)。

---

## [0.9.1] - 2026-05-07

> **Grounded-SAM-2 接入 M1 — SAM 2 image embedding LRU 缓存 + Prometheus 观测。** 工作台 `S` 工具的典型动作是同图反复点击/拖框；v0.9.0 每次都跑完整 `set_image()` ≈ 1.5 s（4060 / tiny），全是 image encoder 重复花费。本版给 `apps/grounded-sam2-backend/` 加 LRU 缓存、Prometheus `/metrics`、人类可读 `/cache/stats`，让同图 N+1 次 point/bbox 操作直降到 < 50 ms，为 v0.9.2 工作台 `S` 工具铺路。范围严格限定在 backend 容器内：协议契约不动、平台 API 不感知、ml-backend-protocol.md 不改。

### Added

- **`apps/grounded-sam2-backend/embedding_cache.py`**（新模块）：基于 `collections.OrderedDict` + `threading.Lock` 的线程安全 LRU；`compute_cache_key(file_path, sam_variant)` 用 `urllib.parse.urlsplit` 取 `scheme://netloc/path` 拼 variant 后做 sha1，**剥掉 query string** —— MinIO presigned URL 的 `X-Amz-Signature` / `X-Amz-Date` 跨 TTL 滚动不应让缓存失效（同一对象逻辑身份恒定）；`get` / `put` / `peek`（不计 hits/misses 的 main 层短路用）/ `clear` / `stats` / `size` 接口；默认 `capacity=16`（`EMBEDDING_CACHE_SIZE` env 可调，4060 16、3090 32、A100 64）。
- **`apps/grounded-sam2-backend/observability.py`**（新模块）：`prometheus_client` 集中注册 4 个 metric — `embedding_cache_hits_total{prompt_type}` / `embedding_cache_misses_total{prompt_type}` / `embedding_cache_size` / `inference_latency_seconds{prompt_type,cache}`（bucket `[0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]`，专为 hit 毫秒尾巴 + miss 秒级长尾打的两段）；helper `record_cache(prompt_type, hit)` / `record_inference(prompt_type, cache_status, duration)` / `update_cache_size(size)` 风格对齐 `apps/api/app/observability/metrics.py`。
- **`predictor.py` snapshot/restore SAM 内部状态**：新增 `_snapshot_sam(w,h)` / `_restore_sam(entry)` 读写 `SAM2ImagePredictor` 的 `_features` / `_orig_hw` / `_is_image_set` / `_is_batch`（vendor `IDEA-Research/Grounded-SAM-2` commit `b7a9c29` 的内部 API；sync_vendor.sh 升级时必须人肉跑 5-clicks 集成验收）。SAM 2 image encoder 输出的 GPU tensor 直接存引用、不 deepcopy，内存上限由 LRU 容量物理保证。
- **三种 prompt 路径全部接缓存**（`predict_point` / `predict_bbox` / `predict_text` 加 `cache_key` 关键字参数；返回签名变成 `(results, cache_hit)`）：point/bbox 命中跳过 SAM `set_image()` + 跳过 main.py `_fetch_image()`（image=None 也允许）；text 命中跳过 SAM `set_image()`，但 DINO 仍需原图（caption 每次不同），所以 text 路径不省 fetch。
- **`GET /metrics`**：`prometheus_client.generate_latest()` 原始 exposition；scrape 配置见 `docs-site/dev/architecture/ai-models.md` §4.3。`embedding_cache_size` Gauge 在每次 `/predict` 完成 + 每次 `/metrics` 抓取时同步当前 size（懒采样、避免 LRU 内 lock 持有过久）。
- **`GET /cache/stats`**：人类可读 JSON `{size, capacity, hits, misses, hit_rate, variant}`，运维排错或快速验收用；不进 ml-backend-protocol（backend 内部端点）。
- **`docs-site/dev/architecture/ai-models.md`**（新文档）：v0.9.x grounded-sam2 + v0.10.x sam3 并存的部署拓扑、三种 prompt 路由表、cache key 设计 + 命中/未命中收益矩阵、容量与显存预算表（`tiny`/`small`/`base_plus`/`large` 四档）、vendor 内部 API 升级风险提示、Prometheus 指标表 + scrape 配置 + 关键 PromQL 查询。
- **`apps/grounded-sam2-backend/tests/test_embedding_cache.py`**（新单测文件，15 case）：`compute_cache_key` query string 剥离 / 路径区分 / variant 区分 / 本地路径覆盖；`EmbeddingCache` put/get 往返、miss 计数、hit 计数、LRU 淘汰顺序、容量上限、同 key 更新值且提到最近、`peek` 不动 LRU 不计数、`clear` 重置、非法 capacity、`hit_rate` 0.7 舍入、4 线程并发 200 次 put/get 锁安全。无需 GPU，纯逻辑；接 pyproject `[project.optional-dependencies] dev` + `[tool.pytest.ini_options]`。

### Changed

- **`apps/grounded-sam2-backend/main.py` `/predict` 流程重构**：取出 `file_path` 后先算 `cache_key`，对 point/bbox 走 `_cache.peek()`（不计 hits/misses 的纯存在性查询）决定要不要 `_fetch_image()`；text 始终拉图。完成后 `_observe(prompt_type, hit, started)` 一次性更新 `embedding_cache_hits|misses_total` + `inference_latency_seconds` + `embedding_cache_size`。批量分支同样按图记录 hit/miss，单图失败降级时记 miss。
- **`apps/grounded-sam2-backend/pyproject.toml`**：版本 `0.9.0` → `0.9.1`；新增 `prometheus-client>=0.20`；新增 `[project.optional-dependencies] dev = ["pytest>=8"]` + `[tool.pytest.ini_options] testpaths=["tests"], pythonpath=["."]`；`py-modules` 加入 `embedding_cache` / `observability`。
- **`apps/grounded-sam2-backend/main.py`** `FastAPI(version=...)` 同步 `0.9.1`；startup 日志多打 `cache_size`。
- **`apps/grounded-sam2-backend/README.md`**：`v0.9.0 (M0)` → `v0.9.1 (M1)` 头部声明；目录结构补 `embedding_cache.py` / `observability.py` / `tests/`；端点速查表新增 `/metrics` + `/cache/stats`；环境变量表新增 `EMBEDDING_CACHE_SIZE`；性能参考段从「M0 不实现 LRU」改为命中策略说明 + 链回 `ai-models.md`；后续切片标 v0.9.1 ✅。

### Notes

- **何时升缓存容量**：observability 给 `embedding_cache_size` Gauge + 命中率 PromQL，长期看到命中率 < 30% 可能是 capacity 过小或工作台流量分散到太多图；< 30% 同时 size 长期顶到 capacity 的，把 `EMBEDDING_CACHE_SIZE` 调大。`large` 变体下不要超 16，否则单缓存就能 ~400 MB 起跳。
- **vendor 升级清单**：`scripts/sync_vendor.sh` 后做两件事 —— ① 在 `predictor.py` 内 grep `_features` / `_orig_hw` / `_is_image_set` / `_is_batch`，确认上游属性名未改；② 跑 README §性能参考的 5-clicks 集成验收（同图连点 5 次，第 1 次 ≤ 500ms，第 2-5 次 ≤ 50ms）。
- **协议契约 / 平台 API 零改动**：缓存对 `apps/api` 透明，`docs-site/dev/ml-backend-protocol.md` 完全不动；后续 v0.10.x sam3-backend 可复用同一缓存模块（M3 抽 `mask_utils` 到 `apps/_shared/` 时一并把 `embedding_cache` 也搬过去）。

详细计划：[`docs/plans/2026-05-07-v0.9.1-declarative-feather.md`](docs/plans/2026-05-07-v0.9.1-declarative-feather.md)。

---

## [0.9.0] - 2026-05-07

> **Grounded-SAM-2 接入 M0 — backend 容器化。** v0.9.x AI 基座主轴启动；本版只做「把服务跑起来 + 协议 4 端点 + docker-compose 接入 + ProjectSettings 测试连接绿灯」，M1 embedding 缓存 / M2 工作台 `S` 工具 / M3 polygon 调参 / M4 `/ai-pre` UI / M5 运维收口都在 v0.9.1 ~ v0.9.5 单独切片。新服务 `apps/grounded-sam2-backend/` 是独立 GPU 容器（`docker compose --profile gpu` 启动，dev 笔记本无 GPU 默认不拉起），底层链路 GroundingDINO + SAM 2.1 → mask → polygon，三种 prompt（point / bbox / text）共用同一 `/predict` 端点按 body shape 自动分流。

### Added

- **`apps/grounded-sam2-backend/`**（新服务）：基于 `pytorch/pytorch:2.3.1-cuda12.1-cudnn8-devel`（与官仓 `IDEA-Research/Grounded-SAM-2/Dockerfile` 对齐 — Python 3.10 + torch 2.3.1 + torchvision 0.18.1 + CUDA 12.1 + gcc-10/g++-10；GroundingDINO Deformable Attention CUDA 算子需 nvcc 现场编译，故必须 devel 而非 runtime）；`TORCH_CUDA_ARCH_LIST="7.0;7.5;8.0;8.6;8.9;9.0"` 覆盖 V100 / T4 / A100 / RTX 30 / RTX 40 (Ada) / H100；FastAPI 单 worker（GPU 模型不可多进程共享显存），暴露 `/health` `/setup` `/versions` `/predict` 4 端点；`/predict` 按 `task+context` vs `tasks[]` 自动分流交互式 / 批量；返回 polygonlabels（mask→polygon: `cv2.findContours(RETR_EXTERNAL)` + `shapely.simplify(tolerance=1.0)` + 顶点归一化 [0,1]）。
- **三种 prompt 路由**（`predictor.py`）：`type=point` / `type=bbox` 跳过 DINO 直接 SAM image_predictor；`type=text` 走 GroundingDINO（caption 强制小写 + 末尾 `.`）→ boxes（cxcywh→xyxy 像素）→ SAM 2.1 多框 batch → mask 数组 → 多 polygon。
- **vendor 形态决策**：vendored copy + `scripts/sync_vendor.sh <commit-sha>`（git clone --filter=blob:none → checkout → rsync → 删 .git → 写 `.commit`）；不用 submodule（上游 demo 脚本结构常变，CI 无需额外 init 步骤）。Dockerfile build 期检测 `vendor/grounded-sam-2/` 为空则 fail-fast；分两步 editable install — 仓库根 `pip install -e .` 装 `sam2` 包，`grounding_dino/` 子目录 `pip install --no-build-isolation -e .` 装 `groundingdino` + 编译 Deformable Attention CUDA 算子。
- **checkpoints 启动时下载**（`scripts/download_checkpoints.py`）：幂等检查 `sam2.1_hiera_{tiny,small,base_plus,large}.pt` + `groundingdino_swin{t_ogc,b_cogcoor}.pth` 是否落盘；缺失时 `huggingface_hub.hf_hub_download` 拉到 `/app/checkpoints` (volume `gsam2_checkpoints`)，任一失败 sys.exit(1) 让容器启动失败避免半残上线。
- **变体可配置**（env 覆盖）：`SAM_VARIANT=tiny|small|base_plus|large`（默认 tiny，4060 8GB 友好）+ `DINO_VARIANT=T|B`（默认 T）+ `BOX_THRESHOLD=0.35` + `TEXT_THRESHOLD=0.25`；切换后重启容器生效（v0.9.x 不做运行时多变体共存）。
- **docker-compose service `grounded-sam2-backend`**（`profiles: ["gpu"]`）：`deploy.resources.reservations.devices` 锁 nvidia/count=1/capabilities=[gpu]，healthcheck `start_period=120s`（首次冷启动权重下载缓冲）；新增 volumes `gsam2_checkpoints` + `gsam2_hf_cache`（HF_HOME=`/app/.cache/huggingface`）。
- **`.env.example`**：加 `SAM_VARIANT` / `DINO_VARIANT` / `BOX_THRESHOLD` / `TEXT_THRESHOLD` / `GSAM2_LOG_LEVEL` 注释行。
- **`apps/grounded-sam2-backend/README.md`**：含能力盘点、目录结构、vendor 同步流程、本地启动 3 步、变体配置表、端点速查、性能参考、排错段、后续切片。

### Changed

- `docker-compose.yml`：补 GPU profile service + 2 个命名 volume（`gsam2_checkpoints` / `gsam2_hf_cache`）。dev 默认 profile 不启动 GPU service，无 GPU 笔记本不受影响。

### Fixed

实跑（RTX 4060 8GB / driver 580 / docker 29 + CDI nvidia）排查中暴露并修复的 4 个 bug，全部为 vendor 接入侧而非协议侧问题，未来 v0.9.x 各小版迭代时若再 bump vendor commit 需复核：

- **SAM 2 hydra config 路径漏 `configs/sam2.1/` 前缀**（`predictor.py:35-40`）：`build_sam2(cfg_name, ...)` 走 `pkg://sam2` hydra search path，必须给到 `configs/sam2.1/sam2.1_hiera_t.yaml` 完整相对包路径而非裸文件名（与 vendor 内 `grounded_sam2_local_demo.py:20` 对齐）。
- **vendor 内 GroundingDINO `inference.py` 把 vendor 根当顶层包名**（`predictor.py` 模块顶部）：上游代码 `import grounding_dino.groundingdino.datasets.transforms as T` 依赖 demo 运行时 cwd 隐式提供 sys.path，本 backend 显式 `sys.path.insert(0, "/app/vendor/grounded-sam-2")` 兜底。
- **httpx 默认不跟 301**（`main.py:_fetch_image`）：MinIO presigned URL / CDN 直链常带 redirect，`httpx.Client(follow_redirects=True)` 必加。
- **transformers 5.x 与 torch 2.3.1 backends 检测不兼容**（`Dockerfile` + `pyproject.toml`）：原约束 `transformers>=4.40` 拉到最新 5.8.0，`BertModel.from_pretrained` 触发 `BertModel requires PyTorch library` 假阳性；pin `transformers>=4.40,<5` + 顺手 pin `huggingface_hub>=0.23,<1.0`（1.x 移除了 vendor 依赖的旧 API）。

### Verified

实跑端到端（公交车样图 https://raw.githubusercontent.com/ultralytics/yolov5/master/data/images/bus.jpg，RTX 4060 / SAM tiny + DINO-T 默认变体）：

| Prompt | 耗时 | 结果数 | polygon 顶点 | score | 备注 |
|---|---|---|---|---|---|
| `bbox [0.05,0.05,0.95,0.7]` | 2408ms | 1 | 469 pts | 0.82 | 框选公交车上半 |
| `text "person"` | 3559ms | **4** | 125/85/71/52 | 0.98 | 4 个人全召回，label 透传 |
| `point (0.5, 0.5)` | 1602ms | 1 | 437 pts | 0.84 | 中心点定位单对象 |

顶点偏多（400+）是预期，M3 调 `simplify` tolerance 时降到 ~50-150。M1 加 LRU embedding cache 后同图二次点击预期 < 50ms。

### Notes

- **M0 范围边界**：本版**不做** LRU embedding 缓存（M1）/ 工作台 `S` UI（M2）/ polygon tolerance 调参评估（M3，本期用默认 1.0 inline 在 predictor.py，M3 抽到 `apps/_shared/mask_utils/`）/ 中→英翻译层（M2 一起做）/ 显存监控 / ADR-0010 / ADR-0011（M5）。
- **协议 §2.2 `text` 类型 docstring** v0.8.6 已扩，本版只在 backend 侧实现该 type 的实际处理；协议文档**未改**。
- **vendor 进仓策略**：`apps/grounded-sam2-backend/.gitattributes` 把 `vendor/**` 标 `linguist-vendored=true linguist-generated=true`，GitHub PR diff 默认折叠 + 仓库语言统计排除 + git blame UI 跳过；vendored copy（不用 submodule）让任何人 clone 后零 setup `docker build`，CI / 离线机器同理。当前固定 commit：`b7a9c29f196edff0eb54dbe14588d7ae5e3dde28`（IDEA-Research/Grounded-SAM-2 main HEAD @ 2026-05-07）。
- **maintainer 接入步骤**（首次部署）：① `bash apps/grounded-sam2-backend/scripts/sync_vendor.sh <commit-sha>` 同步 vendor + 选定 commit 写入 `README.md`；② `docker compose --profile gpu up --build grounded-sam2-backend`（首次冷启动 ~30 min，base image cuda12.1-devel ~9GB + apt + pip + GroundingDINO Deformable Attention 编译 ~3.7 min + image export ~3 min）；③ `/admin/ml-backends` 新建 backend 指向 `http://grounded-sam2-backend:8001` → 测试连接绿灯。
- **权重落 docker named volume**：`pensive-brown-3a8e41_gsam2_checkpoints` (~811MB) + `pensive-brown-3a8e41_gsam2_hf_cache`；compose project name 决定 volume 名，跨 worktree / 切回 main 后会创建新 volume，建议仓库根 `.env` 固定 `COMPOSE_PROJECT_NAME=ai-annotation-platform` 一次性消除复用问题。
- **`MLBackendClient` / 健康检查 / ProjectSettings 测试连接** v0.8.6 + v0.8.7 已就位，本版**未改任何 platform 侧代码**，复用现有链路；故意停容器后红灯 ≤ 70s（健康检查周期 60s + 抖动）。

---


<!-- v0.9.0 起的版本变更直接追加到本节；累积满整个 0.9.x 后再移到 docs/changelogs/0.9.x.md -->

---
