# 视频工作台 vs 图片工作台 · 当前差距与可执行优化

> 类型：P0 调研报告 / 优化路线图。
>
> 状态：**已清理过时内容（2026-05-11）**。O11–O14 主路径已在 v0.9.20 落地，WorkbenchShell stage 分发已在 M6 中改为 `WorkbenchStageHost`，V1 `VideoStage` 拆分已落地，V2/V3 已完成。本文只保留当前仍 open 的差距和建议顺序。

---

## 0. 当前结论

视频工作台已经具备人工标注主链路：视频播放、逐帧定位、`video_bbox`、`video_track`、关键帧插值、轨迹列表、track 多选与批量操作、关键帧复制 / 粘贴、关键帧级撤销 / 重做、离线队列、track → bbox 转换、Video Tracks JSON 导出。

和图片工作台相比，当前仍有价值的差距集中在：

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
- V2 Track 多选与批量操作：**已完成**。当前轨迹侧栏支持 Shift / Cmd / Ctrl 多选，批量改类、删除、显隐和锁定。
- V3 Keyframe 复制 / 粘贴：**已完成**。当前支持显式「复制当前关键帧」和「粘贴到当前帧」，暂不绑定全局 Ctrl+C / Ctrl+V。

## 2. 仍然 Open 的差距

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

1. **V4 Review 视频差异化**：补 raw / final、track + frame 定位。
2. **V5 Probe / poster 重试**：独立后端 / 管理侧增强，可穿插做。
3. **V6 bbox → track 聚合**：等多选稳定后做。

## 5. 暂缓项

- 视频 viewport / 高分辨率 ROI 编辑。
- 视频 AI tracker / SAM 3 video predictor。
- Polygon track。
- 长视频切片和多人协同。
- MOT Challenge / COCO Video 等行业格式导出。
