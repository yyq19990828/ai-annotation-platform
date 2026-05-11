# P0 · 视频标注工作台 Epic

> 状态：M0 + M1 已在 v0.9.16 落地；M2 + M3 已在 v0.9.17 落地；M4 已在 v0.9.18 落地。
>
> 范围：先交付 `video-track` 人工标注闭环。`video-mm`、视频 AI tracker、SAM 3 video predictor、长视频切片和多人协同都作为后续增强。

---

## 0. 目标

把现有 image-det / polygon 工作台扩展到视频任务，先交付一个可用的 **video-track 工作台 MVP**：

- 项目管理员可以导入视频并创建视频任务。
- 标注员可以在视频时间轴上逐帧查看、播放 / 暂停、逐帧画框。
- v0.9.16 先用 `video_bbox` 表达单帧视频框，保存 `frame_index`。
- 后续 M2+ 再引入 `video_track`、`track_id`、关键帧、插值、轨迹审核和展开导出。

## 1. 范围边界

| 类型 | 首版处理 |
|---|---|
| `video-track` | P0 主线，支持视频目标跟踪标注 |
| `video-mm` | 暂不单独做多模态 UI，等 `video-track` 稳定后复用视频外壳 |
| image-seg / image-kp | 不塞进视频首版，避免工作台抽象过早膨胀 |
| lidar / point_cloud | 独立 Three.js / WebGL 工作台，另列 epic |
| 视频 AI tracker / SAM 3 video predictor | 后续增强，不阻塞人工视频工作台 MVP |

## 2. 设计原则

1. 复用现有 `WorkbenchShell` 的队列、权限、提交、审核、离线队列、评论、快捷键分发和批次状态。
2. 新增 `<VideoStage>`，不要把视频逻辑硬塞进 `<ImageStage>`。
3. 先让人工标注闭环可靠，再接视频 AI。
4. v0.9.16 数据模型先表达“视频帧上的框”，后续再升级为“轨迹”与“关键帧”。
5. 大文件、解码、缩略图、关键帧预览都按异步处理设计，避免前端直接承担重活。

## 3. 当前基线

- 项目类型里已经出现 `video-mm` / `video-track`，Dashboard 也有视频图标。
- 数据集导入支持视频文件类型，单文件上限仍受当前上传链路限制。
- `Task.file_type` / `Task.sequence_order` 能表达一部分序列信息，但缺少视频元数据。
- v0.9.16 已新增 `VideoStage`，`WorkbenchShell` 可按 `Task.file_type="video"` 或 `video-track` 项目类型切换。
- 视频任务下已禁用 SAM / polygon / canvas AI 工具，图片工作台仍沿用 `ImageStage` + Bbox / Polygon / SAM 工具。

---

## 4. 里程碑

### M0 · 视频数据底座

**状态**：v0.9.16 已落地。

**目标**：视频能被稳定导入、解析、建任务，并提供前端播放所需元数据。

- 数据模型：
  - 在 `dataset_items.metadata["video"]` 保存视频元数据：`duration_ms`、`fps`、`frame_count`、`width`、`height`、`codec`、`poster_frame_path`。
  - 明确 `Task.file_type="video"` 的语义：一个 task 对应一个视频片段或一个完整视频。
  - 记录可寻址帧：统一使用 `frame_index`，展示层再换算时间码。
- 后端处理：
  - 上传完成后异步 probe 视频元数据，API / Celery 镜像安装 `ffmpeg` / `ffprobe`。
  - 生成 poster 缩略图并复用现有 `thumbnail_path` 流程，供任务队列和列表快速展示。
  - probe / poster 失败写入 metadata 错误字段，不生成破损前端状态。
- API：
  - `GET /tasks/{id}` 返回 `video_metadata`。
  - `GET /tasks/{id}/video/manifest` 返回 presigned 播放 URL、poster URL、fps、frame_count 等标准化元数据。
- 验收：
  - 已覆盖 ffprobe 解析、poster 失败记录、`GET /tasks/{id}` 暴露 `video_metadata`、manifest 视频 / 非视频分支。
  - 手工导入多个真实视频、损坏视频和超长视频策略仍需后续环境验证。
  - 前端不依赖读取完整视频后再推断基础信息。

### M1 · `<VideoStage>` 与时间轴 MVP

**状态**：v0.9.16 已落地。

**目标**：标注员能打开视频任务、播放 / 暂停、逐帧定位，并在当前帧画 bbox。

- 前端结构：
  - 新建 `VideoStage`，与 `ImageStage` 并列挂到 `WorkbenchShell`。
  - `WorkbenchShell` 根据项目类型 / task file_type 选择 stage。
  - 时间轴包含播放头、帧号、时间码和已标注帧标记；时间轴缩放留到 M2+。
- 交互：
  - 空格播放 / 暂停。
  - 左右方向键逐帧移动，Shift + 左右按较大步长跳转。
  - 当前帧支持 bbox 创建、选择、拖拽、缩放、删除。
  - 任务队列仍沿用现有左侧面板。
- 状态：
  - 播放时默认只读，暂停后进入编辑，避免拖框和播放争抢焦点。
  - 当前帧只显示当前 `frame_index` 的 `video_bbox`。
- Annotation schema：
  - v0.9.16 新增 `geometry.type="video_bbox"`。
  - 几何格式：`{ type: "video_bbox", frame_index, x, y, w, h }`。
  - `annotation_type="video_bbox"`；`video_track` 留到 M2。
- 验收：
  - 已覆盖 `VideoStage` 当前帧过滤、暂停编辑、`video_bbox` 几何转换和 image / video stage 选择。
  - 现有图片工作台行为不回退。
  - 第 0 / 中间 / 最后一帧真实视频手工保存 / reload 验证仍需后续环境执行。

### M2 · Track 数据模型与关键帧编辑

**状态**：v0.9.17 已落地。

**目标**：把视频标注从“单帧框”升级为“对象轨迹”。

- Annotation schema：
  - `geometry.type="video_track"`。
  - 每个轨迹有稳定 `track_id`、`keyframes[]`；类别继续复用 annotation `class_name`。
  - `keyframes[]` 至少包含 `frame_index`、`bbox`、`source=manual|interpolated|prediction`，并支持 `absent` / `occluded`。
  - 支持 track 级属性和 frame 级属性的扩展位置，但 v0.9.17 只落必要字段。
- 前端能力：
  - “新建轨迹”模式：第一次画框生成 track。
  - “延续轨迹”模式：在其它帧调整同一对象，形成关键帧。
  - 轨迹列表：按类别 / track_id 展示，支持显隐、锁定、重命名。
  - 当前帧 overlay 同时显示手工关键帧和插值结果，视觉上区分来源。
- 保存策略：
  - 编辑关键帧时保存整个 track 的 compact JSON，不逐帧膨胀写库。
  - 保留 optimistic update 和冲突提示，沿用现有工作台提交体验。
- 验收：
  - 同一对象在 3 个关键帧上调整后，轨迹列表只出现 1 条 track。
  - 已覆盖同一轨迹新增关键帧、插值显示、旧 `video_bbox` 兼容和图片 geometry 兼容。
  - 删除中间关键帧后重新计算插值的独立 UI 入口留到后续增强。

### M3 · 关键帧插值与质量检查

**状态**：v0.9.17 已落地。

**目标**：让视频工作台具备生产效率，而不是只能逐帧手工画。

- 插值：
  - bbox 先做线性插值：`x/y/w/h` 按 frame distance 计算。
  - 插值只在相邻关键帧之间生效，不跨越被用户标记为 absent 的区间；occluded 作为当前关键帧视觉状态展示。
  - 首版不做光流 / tracker 自动传播，避免不确定性过高。
- 质量检查：
  - 轨迹断裂提示：同一 track 中间缺口过大。
  - bbox 越界 clamp。
  - 极小框提示，不静默保存。
  - 同一帧同类高度重叠框提示。
- 审核：
  - 审核员可以通过轨迹列表按 track 浏览。
  - 当前轨迹面板展示 `track_id` + `frame_index`，可用于 reject reason 定位。
- 验收：
  - 标注第 1 / 30 / 60 帧后，第 2-29 / 31-59 帧能显示插值框。
  - 标注员可以把某一段标记为目标消失，插值不会穿过该区间。
  - 当前轨迹面板能指出某个 track 某一帧的问题。

### M4 · 导出与文档闭环

**状态**：v0.9.18 已落地。

**目标**：视频标注结果能被训练和质检流程消费。

- 导出格式：
  - JSON 首选：保留 track / keyframe / interpolated metadata。
  - v0.9.18 复用 `format=coco` 兼容入口，但 `video-track` 返回专用 Video Tracks JSON（`export_type="video_tracks"`），不是 COCO。
  - `video_frame_mode=keyframes|all_frames` 可选“仅关键帧”或“展开所有帧”；默认 `keyframes`。
  - `all_frames` 导出在后端按相邻有效关键帧线性插值，`absent=true` 阻断跨段插值。
  - YOLO / VOC 对视频项目返回清晰 400，避免丢失 track 语义。
- 文档：
  - 用户手册说明 Video JSON、关键帧 / 所有帧模式和 `absent` 语义。
  - 开发文档新增 Video Tracks JSON schema 与快捷键中心化说明。
  - 本期未新增数据库表或迁移，不补 ADR。
- 验收：
  - 已覆盖 video project `format=coco` 返回 Video JSON、batch filter、`all_frames` 插值、`absent` 阻断、`include_attributes=false`、video `yolo/voc` 400。
  - 导出的 frame index 与前端时间轴一致，均从 0 开始。
  - 文档已说明关键帧、插值帧、目标消失段的语义。

---

## 5. 后续增强

- 视频 AI tracker：基于首帧框传播轨迹，人工再修。
- SAM 3 video predictor：依赖单独 backend 能力验证，不阻塞人工 MVP。
- 自动镜头切分 / scene detection。
- 长视频切片：按时间段拆 task，支持跨片段 track merge。
- 多人协同：同一视频按时间段分派，最终合并轨迹。

## 6. 风险与决策点

| 风险 | 决策 |
|---|---|
| 长视频浏览卡顿 | 首版限制单 task 视频长度；后续做分片 / 代理转码 |
| 逐帧展开导致数据库膨胀 | 保存 compact track + keyframes，导出时按需展开 |
| 浏览器解码差异 | 后端 probe + manifest 固定元数据，前端只消费统一字段 |
| 快捷键与现有工作台冲突 | 视频播放快捷键只在 VideoStage active 时接管 |
| 过早抽象多类型工具系统 | 只抽 `Stage` 边界和必要工具接口，不重写全部工作台 |

## 7. 不做清单

- 不在首版支持 3D / lidar。
- 不在首版支持 polygon track。
- 不在首版做自动目标跟踪训练闭环。
- 不把每一帧拆成一个独立 task。
- 不重写 `WorkbenchShell` 为全新框架；只抽视频必须的边界。
