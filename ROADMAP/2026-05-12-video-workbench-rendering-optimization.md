# P0/P1 · 视频标注工作台 Epic（综合）

> 状态：**进行中**。主线 M0-M5.0 / V2 / V3 已归档；R1-R4、R17/R18/R19、V4/V5、V6、R5.2、R8 已完成第一版。当前剩余重点是后续 AI / 协同 / 专属导出能力。
>
> 文件原名 `video-workbench-rendering-optimization`，保留以维持外链；实际范围包括：视频功能尾巴、渲染体系优化、CVAT 视频专项借鉴。

---

## 1. 已完成基线

### 1.1 功能闭环

| 项目 | 版本 | 结果 |
| --- | --- | --- |
| M0 / M1 视频工作台 MVP | v0.9.16 | 视频 metadata / manifest、逐帧 `video_bbox`、暂停态 bbox 编辑、视频用户/开发文档 |
| `video_track` 轨迹模型 | v0.9.17 | compact keyframes、线性插值、absent / occluded、轨迹列表和基础 QC |
| 视频导出与快捷键收口 | v0.9.18 | `format=coco` 返回 Video Tracks JSON；视频快捷键并入统一 hotkeys |
| 关键帧历史与悬浮时间轴 | v0.9.19 | keyframe 级 undo/redo、离线队列兜底、悬浮 playback overlay |
| 视频工具语义 | v0.9.20 | `B` 创建 `video_bbox`，`T` 创建 / 延续 `video_track`；track → bbox 转换 |
| V2 多选轨迹操作 | v0.9.20+ | Shift / Cmd / Ctrl 多选，批量改类、删除、显隐、锁定 |
| V3 关键帧复制粘贴 | v0.9.20+ | 显式复制当前关键帧 / 粘贴到当前帧，不抢占全局剪贴板 |
| V5 Probe / Poster / Frame Asset Retry | v0.9.33 | 存储管理页展示失败视频资产，手动重试 probe / poster / timetable / chunk / frame cache |
| V4 Review Video Anchors | v0.9.35 | review raw/final/diff 视频来源视图；评论锚定 frame / track / source；prediction keyframe 导航 |
| V6 Track Composition | v0.9.37 | `video_bbox` 聚合为 `video_track`；track split；同类不重叠 track merge 并补 outside gap |

### 1.2 渲染与导航基建

| 项目 | 版本 | 结果 |
| --- | --- | --- |
| R1 帧索引与 seek 精度 | v0.9.21 | `useFrameClock`、`frameTimebase`、`frame-timetable` API、开发诊断对象 |
| R2 渲染分层与 picker | v0.9.22 | Media / Bitmap / Grid / Objects / Text / Interaction / Attachment 七层；几何命中测试外移 |
| R3 插值索引与 outside 段 | v0.9.23 | `outside: [{ from, to, source }]` 一等语义；二分 keyframe resolve；LRU 插值缓存 |
| R4 时间轴可视化 | v0.9.24 / v0.9.26 | 单轨 keyframe / outside / interpolated / prediction marker；全局密度条；keyframe 跳转；loop region |
| R19 轻量 bookmark / 跳转历史 | v0.9.26 | `Ctrl+M` 书签、timeline marker 点击跳帧、最近 50 次显式 seek 历史 |
| R17.1 Hover 缩略图 + R5.1 预取 | v0.9.27 | 时间轴 hover 单帧预览；选中轨迹 keyframe / bookmark / loop 边界预取 |
| R18 J/K/L 多速率播放 + R6.1 atomic seek | v0.9.29 | `seekToAsync`、J/K/L jog 播放、反向按帧步进、速度 overlay |
| R7.2/R7.3 观测包 | v0.9.31 | `video:bench` 入口、BugReport 自动附带视频诊断、性能回归 how-to |
| R5.2 ImageBitmap 缓存 | v0.9.39 | seek / scrub 可显示 `ImageBitmap` LRU 缓存帧，浏览器不支持时降级 |
| R8 Viewport / Minimap | v0.9.39 | 视频 media / bitmap / overlay 层共享 viewport；支持 fit、1:1、滚轮缩放、平移和 minimap |

### 1.3 后端相关已就位

| 项目 | 版本 | 说明 |
| --- | --- | --- |
| 后端帧服务 Wave B | v0.9.25 | chunk / frame cache / manifest v2 / prefetch API |
| 视频 segment 协作基线 | v0.9.28 | `video_segments`、manifest v2 segments、claim / heartbeat / release lock |
| timetable / frame cache repair | v0.9.30 | 旧视频帧表重建、单帧 cache retry、poster 复用 frame cache |
| tracker job shell | v0.9.32 | 独立 `video_tracker_jobs` 表和创建 / 查询 / 取消 API |
| tracker adapter MVP | v0.9.34 | `mock_bbox` adapter、worker 状态机、prediction keyframes 写回 |

---

## 2. 当前未完成 Backlog

### 已完成 · R5.2 ImageBitmap 缓存

**目标**：在不引入 WebCodecs / wasm 的前提下改善 scrub 和跨段 seek 体感。

- ✅ 在 Media 层旁增加 bitmap canvas。
- ✅ seek 后用 `createImageBitmap(video)` 抓帧入 LRU。
- ✅ scrub / seek 时优先显示缓存帧，video 元素异步追赶。
- ✅ Minimap 显示已缓存范围，接 R17.3。

**不做**：R5.3 chunk Worker 解码、ffmpeg.wasm、Broadway.js。

### 已完成 · R8 Viewport / Pan-Zoom / Minimap

**目标**：让 1080p / 4K 视频可以放大检查边缘。

- ✅ 复用图片侧 `useViewportTransform`。
- ✅ 视频 Media / Bitmap / Objects / Interaction 层同步 transform。
- ✅ 支持 `F` fit、`0` 1:1、Ctrl+滚轮缩放、右键拖拽平移。
- ✅ 复用图片 Minimap，额外显示当前帧和缓存范围。

**不做**：播放中复杂 zoom 操作、R9 polygon/mask track。

### P1 · R9 Polygon / Polyline / Mask Track

**目标**：扩展 `video_track` 的 geometry kind。

- 协议：`geometry: { kind: "bbox" | "polygon" | "polyline" | "mask", ... }`，旧 bbox track 缺省为 `bbox`。
- polygon / polyline 插值：按周长或长度参数化重采样。
- mask track 依赖 R5.2 / R5.3 的 canvas / frame bitmap 能力。
- 同步 `docs-site/dev/reference/` 与导出协议。

### P1 · R13 / R17.2 Chapter 系统

**目标**：长视频内容分段和快速定位。

- `VideoChapter(id, video_id, start_frame, end_frame, title, color, metadata)`。
- 时间轴章节色带。
- 章节侧栏与 `PageUp/PageDown` 跳转。
- 可后接后端 shot detection。

### P1 · R20 frameStep 跳帧标注

**目标**：长视频只标每 N 帧，其余帧插值 / hold / AI 补帧。

- 项目级 `frameStep` 配置。
- 时间轴和方向键按 step 导航。
- `Shift+←/→` 保留单帧微调。
- segment overlap 边界按 step 对齐。

### P1 · R10 / R16 / R23 AI Tracker 前端

**目标**：消费 v0.9.32-v0.9.34 已落地的 tracker 后端能力。

- 前端工具入口：向前 / 向后传播 N 帧 / 到下个 keyframe / 到结尾。
- 展示 queued / running / completed / failed / cancelled。
- SSE / WebSocket 增量结果写入 `video_track` prediction keyframes。
- prediction 接受 / 拒绝和下一条 prediction 导航。
- Re-ID join 和 tracker registry 属后续增强。

### P2 · R11 / R21 长视频协同与 overlap

- segment 切换 UI。
- 单段单人 lock 的只读提示。
- overlap 区 IAA / IDF1 报告。
- Presence 可选，不做 OT / CRDT。

### P2 · R22 视频专属导出

- MOT 16/17/20 CSV。
- KITTI Tracking。
- DAVIS mask 序列。
- outside 段在各格式中的统一映射。
- YouTube VOS / ImageNet Video 等客户明确需要再做。

### P2 · R24 Track 级质量评估

- MOTA / IDF1 / HOTA 评估 worker。
- 时间轴错误定位。
- 与 R21 overlap 和长期 L15「标注质量 AI 审计」打通。

---

## 3. 建议顺序

```text
Wave 0 · 功能闭环
  ✅ V5 Probe / Poster / Frame Asset Retry (v0.9.33)
  ✅ V4 Review Video Anchors (v0.9.35)
  ✅ V6 Track Composition (v0.9.37)

Wave 1 · 基础夯实
  ✅ R1 FrameClock / timetable (v0.9.21)
  ✅ R2 渲染分层 (v0.9.22)
  ✅ R3 outside / 插值索引 (v0.9.23)
  ✅ R4 时间轴可视化 (v0.9.24 / v0.9.26)
  ✅ R19 bookmark / jump history (v0.9.26)

Wave 2 · 体感收益
  ✅ R17.1 + R5.1 hover thumbnail / prefetch (v0.9.27)
  ✅ R18 + R6.1 J/K/L / atomic seek (v0.9.29)
  ✅ R7.2/R7.3 observability (v0.9.31)

Wave 3 · 工程加固
  ✅ R5.2 ImageBitmap 缓存 (v0.9.39)
  → R5.3 WebCodecs chunk decode（依赖后端帧服务，按数据触发）

Wave 4 · 能力上探
  ✅ R8 Viewport / Minimap (v0.9.39)
  → R9 Polygon / Polyline / Mask track
  → R13 Chapter
  → R20 frameStep

Wave 5 · AI 与协同
  → R10 AI Tracker 前端
  → R16 Track Join
  → R23 Tracker Registry
  → R11/R21 长视频 segment / overlap

Wave 6 · 数据互操作
  → R22 MOT / KITTI / DAVIS

Wave 7 · 质量评估
  → R24 Track 级 IAA / MOTA / IDF1
```

---

## 4. 硬约束 / 暂缓

- 不引入 fabric / 纯 Konva / pixi 重写；继续基于 React + SVG + HTML video 的分层架构。
- 不上 ffmpeg.wasm / Broadway.js；如需前端解码，仅考虑 WebCodecs。
- 不引入 OT / CRDT；协同优先用 segment lock + 乐观重试。
- 不重写 Zustand 为 Redux；只做增量 async primitive。
- 不为旧 `video_bbox` 写迁移脚本；schema 保持向前兼容。
- R23.5 多模型投票先保留人工决策，自动选优等模型评估体系成熟后再做。

---

## 5. 关键文件

| 模块 | 文件 | 当前状态 |
| --- | --- | --- |
| FrameClock | `apps/web/src/pages/Workbench/stage/useFrameClock.ts` / `frameTimebase.ts` | v0.9.21 已落地；后续接缓存和 tracker UI |
| 渲染分层 | `VideoStageSurface.tsx` + `Video*Layer.tsx` | v0.9.22 已落地；后续接 R5/R8/R17 |
| 插值 / outside | `videoStageGeometry.ts` / `videoTrackOutside.ts` / `videoFrameBuckets.ts` | v0.9.23 已落地 |
| 时间轴 / 导航 | `VideoPlaybackOverlay.tsx` / `videoTrackTimeline.ts` / `videoNavigationState.ts` | v0.9.24-v0.9.29 已落地 |
| 视频 stage | `VideoStage.tsx` | 当前仍是播放、拖拽、seek、review display 的编排中心 |
| 轨迹侧栏 | `VideoTrackPanel.tsx` / `VideoTrackSidebar.tsx` | 已支持多选、关键帧编辑、prediction 导航；后续加 split / merge |
| 评论锚点 | `CommentsPanel.tsx` / `CommentInput.tsx` / `annotation_comments.anchor` | v0.9.35 已落地 |
| 后端帧服务 | `apps/api/app/api/v1/task_videos.py` / media worker / frame cache models | v0.9.25+ 已落地 |
| tracker 后端 | `video_tracker_jobs` / tracker worker / adapter registry | v0.9.32-v0.9.34 已落地，前端入口待做 |

---

## 6. 关联 Roadmap

- [`2026-05-12-video-backend-frame-service.md`](2026-05-12-video-backend-frame-service.md)：后端帧服务、tracker、segment、frameStep、导出格式。
- [`2026-05-12-image-workbench-optimization.md`](2026-05-12-image-workbench-optimization.md)：viewport / minimap / rAF 节流复用来源。
- [`2026-05-12-long-term-strategy.md`](2026-05-12-long-term-strategy.md)：R24 与 L15 标注质量 AI 审计。
- [`0.10.x.md`](0.10.x.md)：SAM 3 / tracker registry 对齐窗口。
