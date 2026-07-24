---
audience: [dev]
type: how-to
since: v0.9.31
status: stable
last_reviewed: 2026-05-12
---

# How-to：视频工作台性能回归

v0.9.31 给视频工作台补了第一版本地观测包：固定 bench 矩阵、BugReport 自动诊断，以及 PR 附件路径约定。它不上传 trace，也不要求仓库提交真实视频 fixture。

## 快速运行

```bash
pnpm --filter @anno/web video:bench -- --dry-run
pnpm --filter @anno/web video:bench
```

默认产物写到 `test-results/video-bench/<run-id>/`：

- `manifest.json`：本次矩阵、预算、fixture 描述和 trace 目标路径。
- `README.md`：PR 附件说明。

可选参数：

```bash
pnpm --filter @anno/web video:bench -- --base-url http://localhost:3000
pnpm --filter @anno/web video:bench -- --out /tmp/video-bench
```

## Bench 矩阵

fixture 描述在 `apps/web/scripts/video-bench/fixtures.json`：

| 视频          | 目标                     |
| ------------- | ------------------------ |
| 720p / 3 min  | 常规标注回归             |
| 1080p / 5 min | 主流长视频场景           |
| 4K / 30 sec   | 高分辨率拖拽和 seek 压力 |

每组视频覆盖 10 / 100 / 500 tracks 三档密度，场景包含打开工作台、时间轴 scrub、拖拽选中轨迹、J/K/L 播放和 hover preview。

## WebCodecs 精确帧基准

```bash
pnpm --filter @anno/web video:bench -- --scenario precise-frame --dry-run
pnpm --filter @anno/web video:bench -- --scenario precise-frame
```

产物写到 `test-results/video-bench/<run-id>/`：

- `manifest.json`：分辨率（1080p/30、1080p/60、4K/30）× 场景矩阵、退出门 budget、Dedicated Worker 决策、环境记录字段（runner 填充 `chromiumVersion` / `gpuAdapter` / `hardwareAcceleration` / `fixtureCodec`）。
- `summary.md`：人类可读的退出门表与 Worker 决策结论。

字节预算三档（工作台设置 → 性能档位）：轻量 96/32 MiB、标准 256/96 MiB、激进 512/192 MiB（bitmap / chunk）。判读要点：

- **请求计数**：flag off 与连续播放的 precise 请求必须为 0（`data-video-precise-state=disabled`、播放态 `data-video-frame-source=video`）。
- **session / 逐帧**：同 GOP 顺序逐帧的 `encodedChunksSubmitted` 只增量增长；后退 / 跨 GOP 触发 `sessionResets`。
- **long task / 主线程**：用 PerformanceObserver 包围 pipeline JS 阶段，归因 ≥50ms long task 必须为 0、主线程 blocking p95 ≤16ms。
- **内存**：操作结束后 `liveVideoFrames` 归零、bitmap / chunk 字节账本回预算；优先账本与 close 计数，浏览器媒体进程的短时波动不算泄漏。
- **Worker 触发门**：未出现归因于 pipeline 的 long task 时**不引入** Dedicated Worker（`VideoDecoder.decode` / `createImageBitmap` 异步、主线程只编排）；出现则按计划 §9.2 实现 worker 并重跑全部 gate。

headless Chromium 无可用 `VideoDecoder` 软解，CI 只锁定 flag off 零请求与安全回退合同；warm seek / long task 等真实指标需有头 Chrome 或带 GPU 的 runner。

## BUG 反馈诊断

视频工作台会维护当前 task 的诊断快照：

```js
window.__videoWorkbenchDiagnostics;
window.__videoFrameClockDiagnostics;
```

用户在视频工作台提交 BUG 反馈时，`BugReportDrawer` 会自动把快照追加到描述末尾，并在 `recent_console_errors` 中插入 `[video-workbench-diagnostics]` JSON payload。排查时优先看：

- `frameClock.recentSeeks`：最近显式 seek 的 frame、耗时和 ready source。
- `frameClock.longTasks`：当前会话捕获到的长任务计数。
- `framePreview.cacheHits / cacheMisses`：hover thumbnail 是否命中缓存。
- `timelineMode`：当前是 selected-track timeline 还是 global-density timeline。
- `playbackRate`：J/K/L 当前方向与速率。

## PR 检查建议

涉及视频渲染、timeline、frame preview 或 J/K/L 播放时：

1. 跑 `video:bench -- --dry-run` 确认矩阵没有被破坏。
2. 手动用至少一组 1080p fixture 录制 Performance trace。
3. 把 `test-results/video-bench/<run-id>/` 和 trace 放到 PR 附件或评论。
4. 若用户通过 BUG 反馈提交问题，直接引用反馈详情中的 `Video Workbench Diagnostics`。

第一版只固定矩阵和诊断契约；真实 fixture 自动 seed 与 Playwright trace capture 留给后续 R7 扩展。
