# 视频工作台 vs 图片工作台 · 当前差距与可执行优化

> 类型：P0 调研报告 / 优化路线图。
>
> 状态：**已清理过时内容（2026-05-11）**。O11–O14 主路径已在 v0.9.20 落地，WorkbenchShell stage 分发已在 M6 中改为 `WorkbenchStageHost`，V1 `VideoStage` 拆分已落地。本文只保留当前仍 open 的差距和建议顺序。

---

## 0. 当前结论

视频工作台已经具备人工标注主链路：视频播放、逐帧定位、`video_bbox`、`video_track`、关键帧插值、轨迹列表、关键帧级撤销 / 重做、离线队列、track → bbox 转换、Video Tracks JSON 导出。

和图片工作台相比，当前仍有价值的差距集中在：

- 轨迹侧栏缺 track 多选与批量操作。
- keyframe 复制 / 粘贴语义尚未落地。
- review 模式缺视频 raw / final / diff 视图与精准评论锚点。
- probe / poster 失败缺重试和管理侧可见性。
- `video_bbox` → `video_track` 反向聚合未做。

## 1. 已完成项不再列入计划

以下条目已经完成或被 M6 架构取代，不再作为后续计划维护：

- O1 快捷键中心化。
- O2 track-aware 撤销 / 重做。
- O3 视频创建、更新、重命名进入离线队列；409 走通用 conflict modal。
- O8 删除中间关键帧入口。
- O9 Video Tracks JSON 导出。
- O11 视频矩形框 / 轨迹工具分离。
- O12 视频新建 bbox / track 接入 `pendingDrawing` + class picker。
- O13 track → `video_bbox` 转换。
- O14 选中视频对象后改类与轻量操作条主路径。
- M6 前的 Shell stage 分发描述。当前已由 `WorkbenchStageHost` 分派到 `ImageWorkbench` / `VideoWorkbench` / `ThreeDWorkbench.placeholder`。
- V1 `VideoStage` 子组件拆分。当前已拆出 `VideoFrameOverlay`、`VideoSelectionActions`、`VideoTrackPanel`、`VideoQcWarnings`、`videoStageGeometry`、`videoStageTypes`。

## 2. 仍然 Open 的差距

### V2 · Track 多选与批量操作

**现状**：视频侧只有单选。图片侧的 `selectedIds` / batch change class 不能直接复用到 track，因为视频对象是 track + keyframes。

**建议范围**：

- 只在 `VideoTrackPanel` 里做多选。
- Shift / Cmd 点击多选 track。
- 批量改类、删除、显隐、锁定。
- 不先做 overlay 多选。

**依赖**：V1 已完成；后续多选状态应落在 `VideoTrackPanel` 边界内，再由 `VideoStage` 编排批量命令。

### V3 · Keyframe 复制 / 粘贴

**现状**：已有“复制当前帧为独立 bbox”等转换能力，但没有“复制 keyframe 到另一帧”的高频编辑流。

**建议范围**：

- 先提供显式按钮或菜单项：复制当前 track 当前帧 keyframe，到目标帧粘贴。
- 可以从“复制到当前播放帧”开始，不抢 Ctrl+C / Ctrl+V。
- 后续再做整条 track 平移、复制整条 track。

**未决**：全局快捷键复制的是“当前 keyframe”还是“整条 track”。未定前不要绑定 Ctrl+C / Ctrl+V。

### V4 · Review 模式视频差异化

**现状**：图片侧有 diffMode，视频侧主要是只读查看。视频审核需要定位到 track + frame，而不是只定位 annotation。

**建议范围**：

- 短期：track 列表区分 manual / interpolated / prediction 来源。
- 增加 raw / final 视图切换，先不做复杂像素 diff。
- 审核退回文案辅助插入 `track_id + frame_index`。
- 中期：评论锚定 `(track_id, frame_index)`。

### V5 · Probe / poster 失败重试

**现状**：probe / poster 失败会写入错误字段，但缺少重试入口和管理侧失败列表。

**建议范围**：

- 后端把 probe / poster 抽为可重试 Celery task。
- 管理侧数据集列表显示失败视频。
- 提供手动重试按钮。

### V6 · `video_bbox` → `video_track` 反向聚合

**现状**：track → bbox 已有事务 API 和 UI；反向聚合尚未做。

**建议范围**：

- 依赖 V2 多选。
- 选中同类、不同帧的 `video_bbox`，合并为一条 `video_track`。
- 删除源 bbox 或保留源 bbox 需要明确 copy / split 语义，建议沿用 track → bbox 的 `copy|split`。

## 3. 不建议迁移的图片能力

这些能力不应机械搬到视频侧：

- 图片 viewport / Minimap：视频解码和 ROI 编辑是独立工程。
- 图片 polygon / SAM 工具：视频 polygon track 和 SAM video 需要独立协议。
- 图片 canvas 批注：视频评论更适合锚定 `(track_id, frame_index)`。
- 图片 clipboard 快捷键：视频复制对象可能是 keyframe、track 或 bbox，语义未统一前不要复用。

## 4. 建议执行顺序

1. **V2 Track 多选**：补批量改类 / 删除 / 显隐 / 锁定。
2. **V3 Keyframe 复制 / 粘贴**：先做显式 UI，后补快捷键。
3. **V4 Review 视频差异化**：补 raw / final、track + frame 定位。
4. **V5 Probe / poster 重试**：独立后端 / 管理侧增强，可穿插做。
5. **V6 bbox → track 聚合**：等多选稳定后做。

## 5. 暂缓项

- 视频 viewport / 高分辨率 ROI 编辑。
- 视频 AI tracker / SAM 3 video predictor。
- Polygon track。
- 长视频切片和多人协同。
- MOT Challenge / COCO Video 等行业格式导出。
