# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

## [0.10.0] - 2026-05-13

> **SAM 3 接入 M0 — sam3-backend 容器化 + exemplar 协议落地.** v0.10.x 双 backend 并存策略的第一步: 把 `facebookresearch/sam3` (848M, 单档) + `facebook/sam3.1` 权重打包成独立 GPU 服务, 与 grounded-sam2-backend 并存. 镜像 grounded-sam2-backend 结构, 复用 `apps/_shared/mask_utils` 共享包. 协议新增 `context.type="exemplar"` (视觉示例 prompt → 全图相似实例), 仅 sam3-backend 支持; 前端 UI 入口与 apps/api 路由策略留 v0.10.1. → [plan](docs/plans/roadmap-0-10-x-md-0-10-0-mellow-lantern.md) · [roadmap](ROADMAP/0.10.x.md).

### Added

- **`apps/sam3-backend/`**: 全新 ML Backend service, 基于 `pytorch/pytorch:2.7.0-cuda12.6-cudnn-devel`, Python 3.12. 复用 grounded-sam2-backend 的 4 端点结构 (`/health` / `/setup` / `/versions` / `/predict` / `/metrics` / `/cache/stats`), 监听 8002. 四种 prompt: `point` / `bbox` / `text` / `exemplar`.
- **`exemplar` prompt 协议**: `Context.type="exemplar"` + `bbox=[x1,y1,x2,y2]` 视觉示例框 → SAM 3 PCS 一步出全图相似实例 polygons. `docs-site/dev/reference/ml-backend-protocol.md` §2.2 同步.
- **LRU embedding 缓存 (sam3.1)**: cap 默认 32 (env `SAM3_EMBEDDING_CACHE_SIZE` 覆盖); cache key 含 `sam3.1` variant, 与 grounded-sam2 缓存互不污染 (embedding 来自不同模型, 不能跨).
- **Prometheus 指标 `sam3_*` 前缀**: 与 grounded-sam2-backend 的 `embedding_cache_*` / `inference_latency_seconds` 等同名指标解耦, 两个 backend 同时 scrape 不冲突.
- **docker-compose profile `gpu-sam3`**: 独立于 grounded-sam2 的 `gpu` profile, 用户可单独启动 sam3-backend 或两个都启 (`docker compose --profile gpu --profile gpu-sam3 up`).
- **`scripts/sync_vendor.sh`** + **`scripts/download_checkpoints.py`**: 镜像 grounded-sam2-backend 的 vendor 同步流程 + HF gated repo 拉权重 (要求 `HF_TOKEN`, 否则 fail-fast).
- **Idle Unload + 懒重载**: 与 grounded-sam2-backend 对齐. `SAM3_IDLE_UNLOAD_SECONDS` (默认 600s, 0 关闭) 触发自动卸载释放显存; 下次 `/predict` 懒重载 (冷启动 ~8-12s, executor 异步加载不阻塞 event loop). 新增 `POST /unload` `POST /reload` 端点供运维显式控制; `/health` 暴露 `idle_unload_seconds` + `last_request_age_seconds`. **双 backend 并存场景下显存让渡的关键机制**: sam3 FP16 ~7GB, 3090 单卡同时挂 grounded-sam2 (~2GB) + sam3 (~7GB) 必须靠 idle unload 互让. `asyncio.Lock` 串行化并发懒加载避免双重构造 OOM; unload 时一并 `cache.clear()` 防 GPU 张量悬挂. env 命名 `SAM3_` 前缀, 与 grounded-sam2 的 `IDLE_UNLOAD_SECONDS` 解耦.
- **42 个单测**: schema (含 exemplar 校验) + embedding cache (sam3.1 variant 隔离 + cap=32 默认) + predictor mock 四种 prompt 路径 + idle unload 完整生命周期 (锁串行化 / 重载实例新建 / cache clear). 全部无 GPU 即可跑.
- **`.env.example`**: 新增 `HF_TOKEN` / `SAM3_EMBEDDING_CACHE_SIZE` / `SAM3_SCORE_THRESHOLD` / `SAM3_LOG_LEVEL` / `SAM3_IDLE_UNLOAD_SECONDS` / `SAM3_IDLE_CHECK_INTERVAL` 占位.

### Deferred (留给 v0.10.1+)

- 工作台 `S` 工具 Shift+拖框 = exemplar 入口 → v0.10.1
- ProjectSettings 「默认 text backend」单选 + 优先级标签 → v0.10.1
- apps/api 按 prompt.type + 项目偏好的路由表 (`route_interactive_request()`) → v0.10.1
- AB 对比工具 / `/ai-pre/compare` 页 → v0.10.2
- ADR-0012 双 backend 永久共存 / `deploy.md` 双拓扑章节 → v0.10.3


<!-- v0.10.0 起的版本变更直接追加到本节；当开始开发0.11版本后再移到 docs/changelogs/0.10.x.md -->
---
