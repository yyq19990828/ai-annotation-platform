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

| 视频 | 目标 |
|---|---|
| 720p / 3 min | 常规标注回归 |
| 1080p / 5 min | 主流长视频场景 |
| 4K / 30 sec | 高分辨率拖拽和 seek 压力 |

每组视频覆盖 10 / 100 / 500 tracks 三档密度，场景包含打开工作台、时间轴 scrub、拖拽选中轨迹、J/K/L 播放和 hover preview。

## BUG 反馈诊断

视频工作台会维护当前 task 的诊断快照：

```js
window.__videoWorkbenchDiagnostics
window.__videoFrameClockDiagnostics
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
