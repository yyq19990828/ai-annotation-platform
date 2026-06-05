# Scene + frame_index(跨 task 帧序列地基)

> v0.14.0 引入。把"一段录像被切成多个 task"型场景(3D 点云逐帧 / 2D 抽帧图像序列 / 多段 mp4 拼接长录像)统一到同一数据基地。本期**不**含跨帧 UX——`Shift+→` propagate、邻帧叠加等留 v0.14.1+。

## 背景:为什么要 scene

平台之前对"跨 task 时序"无表示:

- **task 内的帧序列已有**:`VideoFrameIndex` 解决"单段 mp4 一个 task,内部跨帧"。
- **task 之间缺失**:`DatasetItem` 没有 `scene_id` / `frame_index` 列;"哪些 task 是同一段录像的连续帧"靠 `file_name` 字符串排序的弱约定推断,跨多 scene 直接破。

结果:跨帧 propagate / track / 邻帧叠加三类 UX 没有合法实现路径;一个 dataset 跨多 scene(典型 nuScenes 一 dataset 含 10 个 scene)时,`file_name` 排序会让 scene-A 末帧"邻居"是 scene-B 首帧,语义错。

## 四种"时序录像"形态共用同一抽象

| 存法 | 一个 task = | "下一帧"在哪 | v0.14.0 覆盖 |
|---|---|---|---|
| A. 整段 mp4 一个文件 | 一段视频 | task 内 `VideoFrameIndex.frame_index` | 保留现状,不动 |
| B. 抽帧图像序列 | 一张 jpg | 跨 task | ✅ |
| C. 多段 mp4 拼成长录像 | 一段 mp4 片段 | 跨 task(段级)+ task 内(段内) | ✅ 段级跨 task |
| D. 3D 点云逐帧 | 一帧 .pcd | 跨 task | ✅ |

`scene_id + frame_index` 是面向"时序录像"的抽象,**与文件类型正交**——一立起来 B/C/D 共用,前端跨帧 UX 写一份就够。

## 数据模型

```
┌──────────┐  CASCADE  ┌──────────────┐   SET NULL   ┌──────────────┐
│ datasets │ ─────────→│   scenes     │ ←─────────── │ dataset_items│
└──────────┘           └──────────────┘              │  scene_id    │
                                                     │  frame_index │
                                                     └──────────────┘
                                                            ↑
                                                            │
                                          Task ─── task.dataset_item_id (2D)
                                          Task ─── TaskDatasetItemLink role=primary_lidar (3D)
```

### `scenes` 表

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID PK | gen_random_uuid() |
| `display_id` | str unique | "SCN-N",走 `display_seq_scenes` |
| `dataset_id` | UUID FK datasets CASCADE | 一 scene 隶属一 dataset(本期不跨 dataset) |
| `name` | str | 业务名(如 "scene-0061") |
| `source_format` | str? | "sustechpoints" / "nuscenes" / "inferred" / "manual" 等 |
| `source_metadata` | JSONB | 自由格式;importer 自填 |
| `created_by` | UUID? FK users | 创建者 |
| 唯一性 | `(dataset_id, name)` | 允许跨 dataset 同名 |

### `dataset_items` 新增两列

| 列 | 类型 | 说明 |
|---|---|---|
| `scene_id` | UUID? FK scenes SET NULL | 历史数据兼容 NULL |
| `frame_index` | int? | scene 内的有序位置;同 scene 同 frame_index **允许重复**(lidar + 多 cam 共享) |

**索引**:`idx_dataset_items_scene_frame` on `(scene_id, frame_index)`,给 neighbors 查询。**不**加 UNIQUE——多模态同帧 3 行 + calib NULL 多行需共存。

### 设计选择

- **为什么单独建表而不只在 `dataset_items` 加 `scene_id` 字符串**?scene 有自身元数据 + 唯一性约束 + 跨 item 一致性;字符串列做不到。
- **为什么不复用既有 `metadata_` JSONB**?(a) 索引差(JSONB GIN < BTree FK)、(b) 缺乏跨 item 约束、(c) 跨 dataset 的 scene 列表会变成 JSON 扫表。
- **为什么 nullable**?向后兼容。历史 dataset 不动,backfill 走显式脚本。

## API

### `GET /api/v1/tasks/{task_id}/neighbors?k=1`

返回 task 在所属 scene 内前后 k 个邻居 task。`k ∈ [1, 20]`(超出 400)。

```json
{
  "scene_id": "uuid",
  "scene_name": "scene-0061",
  "frame_index": 42,
  "scene_total_frames": 80,
  "prev": [{"task_id": "uuid", "frame_index": 41}, ...],
  "next": [{"task_id": "uuid", "frame_index": 43}, ...]
}
```

- prev / next 都按"距离 cur 远近"排序——cur-1 在 `prev[0]`,cur+1 在 `next[0]`。
- 首/末帧 → 对应方向数组为空(不报错)。
- task 无 scene_id(历史未 backfill)→ 200 + 全空响应(与首末帧一致,前端不区分)。
- scene_id 非空但 frame_index NULL(异常状态)→ 409。

### `GET /api/v1/scenes?dataset_id=<uuid>` / `GET /api/v1/scenes/{id}` / `PATCH /api/v1/scenes/{id}`

scene 元数据 CRUD;create 由 importer / backfill 自动发起,API 不暴露。

### `POST /api/v1/datasets/{id}/scenes/backfill?mode=auto&dry_run=false`

对 dataset 跑 `scene_inference`。`mode ∈ {single, per_subdirectory, auto}`,默认 `auto`。

### Manifest 透出

`GET /api/v1/tasks/{id}/point-cloud/manifest` 新增 `scene_id` / `scene_name` / `frame_index` / `scene_total_frames` 四字段(全 None 表示历史未 backfill)。前端调试可见,本期不消费 UX。

## scene_inference 算法

`services/scene_inference.py` 暴露 `infer_and_apply(db, *, dataset_id, mode, dry_run)`。

### 三种 mode

- **`single`**:整 dataset = 1 scene,`scene.name` 取 `dataset.name`。
- **`per_subdirectory`**:按 `file_path` 中 dataset_name 之后第一段分组,每组一 scene。
- **`auto`**(默认):顶层目录全是已知角色名 → single;否则 per_subdirectory。

`ROLE_DIR_NAMES = {lidar, camera, calib, image, video, images, videos}`。

### frame_index 赋值(点云 / 多模态)

1. 调 `pointcloud_import.group_frames(items)` 拿 `{frame_stem: {lidar, cameras}} + {cam: calib}`。
2. frame_stem 自然排序("000001" < "000010")后 lidar 取 0..N-1。
3. 同帧 cam item 共享 lidar 的 frame_index。
4. calib_items 仅写 scene_id,frame_index=NULL。

### frame_index 赋值(非点云)

`file_name` 自然排序,所有 items 取 0..N-1。

### 边界

- dataset 已有 scene → 跳过(幂等)。
- 部分 items 已有 scene_id → 跳过,notes 报"partial migration"。
- 推断出 > 100 scene → ValueError(防误识别巨型 jpg 序列为伪 scene)。

### 几种 ZIP 布局命中

| ZIP 顶层 | mode=auto 推断 | scene.name |
|---|---|---|
| `lidar/ camera/ calib/`(SUSTech 单 scene) | single | dataset.name |
| `scene_a/lidar/ scene_b/lidar/ ...` | per_subdirectory(2 scene) | `scene_a`, `scene_b` |
| `nu-scene-0061/lidar/ nu-scene-0103/...` | per_subdirectory(N scene) | `nu-scene-0061`, ... |
| `lidar/ camera/ scene_extra/`(混搭) | per_subdirectory(`_single` + `scene_extra`) | 见 notes 警告 |

## 导入端口

两处自动挂上:

1. **`pointcloud_import.build_pointcloud_tasks_for_link`**:函数顶部跑 `single`-mode inference(SUSTechPOINTS / wizard 上传点云项目)。
2. **`POST /datasets/{id}/items/upload-zip`**:上传完跑 `auto`-mode inference;notes 透回响应字段 `scene_inference_notes`。

`nuScenes` 转换脚本走显式 `scene_svc.create_scene` + `assign_items_to_scene` 路径(留 v0.14.2),不依赖启发式。

## Backfill 历史数据

```bash
cd apps/api

# 单 dataset
PYTHONPATH=. uv run python scripts/backfill_scenes.py --dataset-id <uuid>

# 全部缺 scene
PYTHONPATH=. uv run python scripts/backfill_scenes.py --all-missing

# 预览
PYTHONPATH=. uv run python scripts/backfill_scenes.py --all-missing --dry-run
```

**不**在 docker 启动时自动跑——管理员人工 review 后执行。脚本默认 `mode=auto`;对文件名编码 scene 信息(如 `<ds>/scene_a_000001.pcd` 平铺)会误判为单 scene,需显式 `--mode=per_subdirectory` 或人工 PATCH。

## 不在本期(留后)

- 跨帧 UX(`useFrameNeighbors` / `Shift+→` propagate / 邻帧参考框叠加)→ v0.14.1
- 跨 scene 段内段间无感导航(case C)→ v0.14.2+
- 跨帧自动插值 / Kalman 预测 → v0.14.2+
- `get_next_task` 的 `prefer_same_scene_continuation` flag → v0.14.1+
- scene 跨多 dataset(一 scene 横跨 lidar + image dataset)→ v0.15+
- ego_pose / 时间戳(nuScenes sample_data 等价物)→ v0.15+
