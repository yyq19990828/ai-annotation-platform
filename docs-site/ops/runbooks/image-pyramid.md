---
title: 图片金字塔运行手册
audience: [ops]
type: how-to
status: stable
last_reviewed: 2026-07-31
---

# 图片金字塔运行手册

本手册用于部署、回填和诊断超大图金字塔。自动生成默认关闭；API、数据库和专用 Worker 可以先上线，再按
容量证据启用。

## 部署检查

应用镜像必须包含 libvips、pyvips 和可用的 sRGB ICC profile。代码、Python 依赖或 Dockerfile 有变化时
需要重建：

```bash
docker compose build celery-worker-image-pyramid
docker compose up -d celery-worker-image-pyramid celery-worker celery-beat
```

先执行数据库迁移，再确认专用 Worker 只消费 `image-pyramid` 队列且并发为 1：

```bash
docker exec <api-container> alembic upgrade head
docker compose ps celery-worker-image-pyramid
docker compose logs --tail=100 celery-worker-image-pyramid
```

容器内快速检查：

```bash
docker compose exec celery-worker-image-pyramid \
  python -c "import pyvips; print(pyvips.version(0), pyvips.version(1), pyvips.version(2))"
docker compose exec celery-worker-image-pyramid \
  test -r /usr/share/color/icc/sRGB.icc
```

## 关键配置

| 配置                                   |        默认值 | 作用                          |
| -------------------------------------- | ------------: | ----------------------------- |
| `IMAGE_PYRAMID_AUTO_GENERATE`          |       `false` | 上传/缩略图流程是否自动入队   |
| `IMAGE_PYRAMID_OPTIONAL_PIXELS`        |    `16777216` | 允许生成的最低像素数          |
| `IMAGE_PYRAMID_REQUIRED_PIXELS`        |    `50000000` | 客户端必须走 tile 的像素门    |
| `IMAGE_PYRAMID_MAX_PIXELS`             |   `300000000` | 最大解码像素                  |
| `IMAGE_PYRAMID_MAX_DIMENSION`          |       `32768` | 任一边最大尺寸                |
| `IMAGE_PYRAMID_MAX_TILES`              |       `20000` | 单代次最大 tile 数            |
| `IMAGE_PYRAMID_MAX_SOURCE_BYTES`       |  `8589934592` | 最大压缩源字节                |
| `IMAGE_PYRAMID_MAX_DERIVED_BYTES`      |  `8589934592` | 最大持久派生字节              |
| `IMAGE_PYRAMID_MAX_TEMP_BYTES`         | `12884901888` | source 与生成目录临时空间上限 |
| `IMAGE_PYRAMID_JOB_TIMEOUT_SECONDS`    |        `1800` | Worker soft timeout           |
| `IMAGE_PYRAMID_LEASE_SECONDS`          |        `2100` | generation lease              |
| `IMAGE_PYRAMID_URL_EXPIRY_SECONDS`     |         `900` | overview/tile URL 有效期      |
| `IMAGE_PYRAMID_RETRY_COOLDOWN_SECONDS` |         `300` | 失败后重试冷却                |
| `IMAGE_PYRAMID_VIPS_CONCURRENCY`       |           `4` | 单 job libvips 并发           |
| `VITE_EXPERIMENTAL_LARGE_IMAGE_TILES`  |        `true` | 前端是否选择 ready pyramid    |

`profile_version` 或 `normalization_version` 变更会产生新资产身份/输出合同，不能只改一台 Worker。所有 API、
media Worker 和 image-pyramid Worker 必须使用一致值。

`VITE_EXPERIMENTAL_LARGE_IMAGE_TILES` 是 Vite build-time 开关，修改后必须重建 Web 镜像。它与
`IMAGE_PYRAMID_AUTO_GENERATE` 独立：前者只控制浏览器选择，后者只控制新资产是否自动入队。

## 安全启用与回填

先保持自动生成关闭，用 dry-run 估算 DatasetItem 数量：

```bash
cd apps/api
PYTHONPATH=. uv run python scripts/backfill_image_pyramids.py \
  --owner-kind dataset_item --dry-run --limit 100
```

按 cursor 小批量入队：

```bash
PYTHONPATH=. uv run python scripts/backfill_image_pyramids.py \
  --owner-kind dataset_item --cursor <uuid> --limit 100
```

legacy direct Task 没有持久化尺寸，必须显式选择；Worker 会先 probe，再应用硬上限：

```bash
PYTHONPATH=. uv run python scripts/backfill_image_pyramids.py \
  --owner-kind task --dry-run --limit 100
```

浏览器 E2E、性能基准和文档截图可按需下载固定的现实大图 seed；原图写入 gitignored 的
`test-results/image-seeds/`，下载后必须通过固定字节数与 SHA-256：

```bash
pnpm --filter @anno/web image:seeds -- --list
pnpm --filter @anno/web image:seeds
pnpm --filter @anno/web image:seeds -- --verify-only
```

清单包含高熵 RGB PNG、接近硬上限的超宽 JPEG 和 optional 边界的超高 RGBA 竖图。每项记录 NASA
官方来源页、原始下载地址、署名和媒体使用政策；自动化输出不得暗示 NASA 或合作机构背书。

当前开发栈可把已校验原图导入固定项目/数据集，并显式等待专用 Worker 生成完成：

```bash
cd apps/api
PYTHONPATH=. uv run python scripts/seed_large_images.py \
  --enqueue-pyramids --wait-seconds 1800
```

命令幂等创建 `P-LARGE-IMG` / `DS-LARGE-IMG` 与逐图 Task。它不会开启全局
`IMAGE_PYRAMID_AUTO_GENERATE`，只为本次选中的 eligible 夹具入队；重复运行复用同源 active
generation。可用重复的 `--id <fixture-id>` 缩小范围。production 环境会拒绝执行。

观察连续任务的 RSS、临时盘、失败率和队列积压稳定后，才把
`IMAGE_PYRAMID_AUTO_GENERATE=true` 注入 API/media Worker 与专用 Worker，并重建或重启对应服务。

## 观测与告警

重点指标：

- `image_pyramid_generations_total{outcome,error_code}`：成功与稳定故障码；
- `image_pyramid_phase_duration_seconds{phase,outcome}`：下载、生成、校验和上传耗时；
- `image_pyramid_source_bytes`、`image_pyramid_decoded_pixels`、`image_pyramid_tile_count`；
- `image_pyramid_derived_bytes`、`image_pyramid_temp_bytes`、`image_pyramid_asset_bytes`；
- `image_pyramid_api_requests_total{operation,outcome}`；
- `image_pyramid_gc_total{outcome}`。

建议告警：

- `failed` 比例持续升高；
- `lease_expired`、`timeout` 或 `resource_limit` 突增；
- `object_missing`/`inconsistent_ready` 非零；
- 队列持续增长且 Worker 无 ready 结果；
- Worker RSS 接近 `--max-memory-per-child` 或临时卷接近容量上限。

浏览器 BUG 反馈会附带 `Large Image Tile Diagnostics`，其中包括 current level、visible/desired tile、
queue/fetch/decode 状态、cache hit/eviction、requested/decoded/reserved/retained/budget bytes、
ImageBitmap/HTML image/ObjectURL 存量、abort、stale commit、签发批次数、URL 刷新和目标细节
coverage。该快照不包含签名 URL、storage key 或文件名。排查长会话时应确认停止交互后
retained/live/request 进入平台档位内 plateau，离开任务后 reserved/retained/live 全部归零。

## 故障码处理

| 错误码                                  | 含义                                   | 处理                                             |
| --------------------------------------- | -------------------------------------- | ------------------------------------------------ |
| `source_missing` / `source_unavailable` | 源对象不存在或无法读取                 | 先修复 source/MinIO，不要盲目重试                |
| `source_changed`                        | 生成期间或读取时源身份变化             | 确认替换完成后重试新 generation                  |
| `unsupported_dimensions`                | 尺寸或像素超过硬门                     | 保留原路径或调整产品限制，不能只放大内存         |
| `resource_limit`                        | source、tile、derived 或 temp 预算超限 | 检查输入和容量证据后再调整单项上限               |
| `decode_failed`                         | 损坏或 loader 不支持                   | 校验源文件格式                                   |
| `multi_page_unsupported`                | 多页输入                               | 先显式抽取目标页再入库                           |
| `dimension_mismatch`                    | DB 逻辑尺寸与规范化输出不一致          | 不自动迁移已有标注；人工核查 EXIF/历史数据       |
| `color_profile_unavailable`             | sRGB profile 缺失                      | 修复镜像或配置路径                               |
| `upload_verification_failed`            | 上传对象集合/大小不一致                | 检查 MinIO、网络与凭据                           |
| `object_missing` / `inconsistent_ready` | ready 资产不完整                       | API 会停止签发；检查 lifecycle 和 reconciliation |
| `lease_expired` / `lease_lost`          | Worker 超时、重启或竞争                | 检查 Worker 健康，等待 reconciliation 后重试     |

## GC 与回滚

Celery beat 每日触发 reconciliation，分批处理过期 lease、失败/旧 ready generation 和孤儿对象前缀。
不要给 `image-pyramids/` 单独配置固定天数 lifecycle，否则会留下 ready 数据库行指向缺失对象。

紧急回滚时：

1. 设 `IMAGE_PYRAMID_AUTO_GENERATE=false` 并重启 API/media Worker；
2. 如需停止客户端选择，设 `VITE_EXPERIMENTAL_LARGE_IMAGE_TILES=false` 并重建 Web 镜像；
3. 停止专用 Worker，保留数据库表和 ready 对象；
4. required 大图会显示当前产品限制与安全预览，不会自动退回无界整图解码；
5. 不通过批量删除 ready 对象回滚。

保留状态后可以修复 Worker 并显式 retry，无需重新上传 source。
