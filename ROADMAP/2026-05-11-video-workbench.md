# P0 · 视频标注工作台 Epic

> 状态：**主线已归档（2026-05-11）**。M0–M5.0 已完成：视频数据底座、`VideoStage`、`video_track`、关键帧插值、Video Tracks JSON 导出、工具语义补全均已落地。
>
> 本文件只保留视频工作台当前基线和后续增强。历史阶段细节不再维护，避免与代码和文档重复。

---

## 1. 当前基线

- `video-track` 人工标注闭环已可用。
- 视频任务通过 `WorkbenchStageHost` 分派到 `VideoWorkbench`，再由 `VideoWorkbench` 包装 `VideoStage`。
- `VideoStage` 已拆出 `VideoFrameOverlay`、`VideoSelectionActions`、`VideoTrackPanel`、`VideoQcWarnings` 与共享 geometry helpers，播放 / 拖拽状态仍由 `VideoStage` 编排。
- `video_bbox` 与 `video_track` 均为一等 geometry：
  - `video_bbox`：当前帧独立矩形框。
  - `video_track`：一条轨迹 annotation + compact keyframes。
- 视频工具独立于图片工具：
  - `B`：视频矩形框。
  - `T`：视频轨迹。
- 新建视频 bbox / track 已接入画完选类浮层。
- 选中视频对象后 `1-9` 改当前对象类别；无选中时切 active class。
- Track → `video_bbox` 转换已支持 `copy|split`、`frame|track`、`keyframes|all_frames`。
- 关键帧级撤销 / 重做、离线队列兜底、通用 conflict modal 已覆盖视频创建和更新主路径。
- `format=coco` 对 `video-track` 项目返回 Video Tracks JSON；YOLO / VOC 对视频项目返回 400。

## 2. 当前仍 Open

这些是视频工作台在 M5.0 后仍值得继续推进的项：

1. **Track 多选与批量操作**
   - 在轨迹侧栏支持 Shift / Cmd 多选 track。
   - 先做批量改类、批量删除、批量显隐 / 锁定。
   - 不先做 overlay 多选；同帧 overlay 多选收益低且交互复杂。

2. **Keyframe 复制 / 粘贴**
   - 先做显式 UI：复制当前 keyframe 到当前帧或指定帧。
   - 暂不抢占全局 Ctrl+C / Ctrl+V，避免和图片 clipboard 语义冲突。
   - 后续再评估整条 track 复制、按时间轴整体平移。

3. **Review 模式视频差异化**
   - 短期：track 列表区分 manual / interpolated / prediction 来源，并支持 raw / final 视图。
   - 中期：审核评论锚定到 `(track_id, frame_index)`。

4. **Probe / poster 失败重试**
   - 后端把 probe / poster 抽成可重试任务。
   - 管理侧展示失败视频并提供手动重试入口。

5. **`video_bbox` → `video_track` 反向聚合**
   - 依赖 track 多选或 frame 列表选择。
   - 选中多条同类、不同帧的 `video_bbox` 后合并成一条 `video_track`。

## 3. 暂不做

- 不做视频 viewport / Minimap。高分辨率视频 ROI 编辑是独立工程，不直接迁移图片 viewport。
- 不做 polygon track。需求和数据协议未明确。
- 不做视频 AI tracker / SAM 3 video predictor。依赖 backend 能力验证，另列 AI epic。
- 不做长视频切片 / 多人协同。属于架构级增强。
- 不为旧 `video_bbox` 写迁移脚本。现有 schema 已向前兼容。
- 不再重写 `WorkbenchShell`。当前路线是单 Shell + mode hooks + `WorkbenchStageHost`。

## 4. 建议顺序

1. 做 track 多选和批量操作。
2. 做 keyframe 复制 / 粘贴。
3. 做 review diff 与评论锚点。
4. 做 probe / poster 失败重试。
5. 做 `video_bbox` → `video_track` 反向聚合。
