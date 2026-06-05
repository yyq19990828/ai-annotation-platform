# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
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

<!-- 0.13.x 版本变更按版本段追加到本区；进入 0.14.x 后整体移到 docs/changelogs/0.13.x.md -->

## [0.14.2] - 2026-06-06

点云导入格式收敛 + 多相机/多 scene 实测:把"进数据"这一头的两个真实阻塞拆掉。修 ZIP 上传拍平路径(D1),让点云 scene ZIP 真能从向导上传;新增 nuScenes-mini 转换脚本(D2),作为 v0.14.0 scene 模型的第一个真实多 scene 消费者,scene_token 1:1 落到 `scenes.name`。不引入插件注册表 / 通用 importer 抽象,按"自家格式 + 一次性转换脚本"路线(与 SUSTechPOINTS / xtreme1 一致)。计划见 `docs/plans/2026-06-05-v0.14.2-import-format-and-multicam.md`。

### Fixed

- **ZIP 上传保留子目录(D1)**:`POST /api/v1/datasets/{id}/items/upload-zip` 此前用 `os.path.basename` 把每个文件拍平到 `{ds.name}/{basename}`,丢掉 ZIP 内子目录 → 点云 scene ZIP(`lidar/ camera/<cam>/ calib/camera/`)上传后 `group_frames` 找不到段名,整批不被识别为 scene。改为经新增的 `_normalize_zip_relpath` 规范化相对路径并保留子目录(`{ds.name}/lidar/000970.pcd`),附 zip-slip 防护(拒 `..` 段 / 绝对路径 / 隐藏文件 / `__MACOSX/`)。**该修复全局生效**,非点云 dataset 同样保留子目录。
- **去重键改 content_hash-only**:同一 scene 内 `camera/front/000970.jpg` 与 `camera/left/000970.jpg` 的 basename 相同但属合法的跨相机同帧;删掉原"同名追加 -1/-2 后缀"逻辑,仅当 content_hash 完全相同才去重,跨子目录同名不再误改名 / 误去重。

### Added

- **nuScenes-mini 转换脚本(D2)**:`apps/api/scripts/import_nuscenes_scene.py`,自读 nuScenes JSON(不依赖 `nuscenes-devkit`,只用 numpy + Pillow),把一个或多个 scene 转成平台原生目录 + 直接入库,并**显式调 v0.14.0 `scene_svc.create_scene` + `assign_items_to_scene`**:scene_token → `scenes.name`,sample 顺序 → `frame_index`,`.pcd.bin` 转 ASCII PCD,6 路相机 jpg + 每相机一份 lidar→camera 外参/内参标定。支持 `--scene-tokens a,b,c` 多 scene 共用一个 dataset。`axis_convention=iso_8855`(nuScenes 原生 ISO,无需旋转)。幂等(dataset 按 display_id、scene 按 name 复用)。
- **多 scene 帧 stem 全局唯一**:每个 scene 的帧号都从 0 起,而 `group_frames` 以文件名 stem 作帧键——多 scene 共用 dataset 时同号帧会撞键漏建 task。脚本给帧文件名加 `<scene_name>_` 前缀保证 stem 全局唯一(不动 `group_frames`);scene 内 `frame_index` 仍由 `assign_items_to_scene` 按顺序赋值,与文件名解耦。

### Verified / Tests

- `tests/test_datasets_upload_zip.py`(新):子目录保留、zip-slip 拒绝、跨子目录同名按 hash 去重、SUSTech 布局自动建 1 scene + `frame_index` 0..N、伪多 scene zip 建 2 scene。
- `tests/test_import_nuscenes_lite.py`(新):用 tmp_path 造极小 fake nuScenes 根目录(2 scene × 3 sample × 1 cam,不依赖真 4GB 数据),验证脚本骨架跑通 + 产生 2 个 scene + `frame_index` 按 sample 顺序 + **跨 scene neighbors 不串**。
- nuScenes 真实数据端到端(6 相机投影对齐 / BEV 车头朝上 / 跨 scene 隔离)走脚本 docstring 里的手动 checklist(dev 工具,CI 不跑真数据)。

### Docs

- `docs-site/user-guide/datasets/import-formats.md`(新):平台原生目录约定 + 多 scene 边界 + 标定 JSON schema + nuScenes/KITTI 转换索引;明确"只接受原生格式,其他走转换脚本"。sidebar 加入口。

### 未尽事项(留后续)

- 多 lidar 数据集(Waymo 5 路 lidar)、同 sample 跨相机微秒级 timestamp 偏差补偿(`ego_pose` 插值)、`group_frames` 路径段名抽象化(角色 pattern 配置):留 v0.15+。
- ZIP 单包 200MB 上限不放宽;多 scene 批量请走转换脚本而非向导。

## [0.14.1] - 2026-06-06

跨帧目标延续 UX:把 v0.14.0 的 scene + neighbors API 变成可用的标注效率特性。3D 工作台 `Shift+→` / `Shift+←` 一键把选中 box_3d 延续到同 scene 邻帧 task(共享 `group_id`),跳过去自动选中新框;三视图 / 主视图可叠加显示同 group_id 的前后 K 帧参考框。2D 图像序列同等用 `Alt+→` / `Alt+←`(2D 的 `Shift+方向` 已被 10px nudge 占用)。配套加 scheduler scene 连续标注调度开关。计划见 `docs/plans/2026-06-05-v0.14.1-cross-frame-ux.md`。

### Added

- **跨帧 propagate 端点**:`POST /api/v1/tasks/{task_id}/annotations/{annotation_id}/propagate-to-task`,body `{ target_task_id, override_psr? }`。复制源 annotation 的 geometry / class / attributes / tool_unit_id 到目标 task(同 project 才允许,否则 422),共享 `group_id`。仅支持静态几何(`box_3d` / `bbox` / `polygon` / `multi_polygon` / `rotated_bbox` / `polyline` / `keypoint`);`video_*` / `point_mask_3d` 拒(422)。
- **共享 group_id 序列**:跨帧链的 `group_id` 在源无 group 时从新建全局序列 `cross_frame_group_seq`(START 1000000000)分配并写回源,高位起始保证与 per-task `tasks.next_group_seq`(小整数)永不冲突,同 scene 跨帧 overlay 按 `group_id` 匹配不误命中无关分组。migration `0097`。
- **box_3d convention 安全网联动**:propagate 时 `box_3d.convention_at_create` 取**目标** dataset 的 `axis_convention`(DB 内 PSR 永远 ISO 字节,原值复制即对齐世界坐标;写目标 convention 仅为前端 banner 不误报,延续 v0.13.11 契约)。
- **前端跨帧 hook**:`useFrameNeighbors(taskId, k)` 包 neighbors 端点 + `refresh()` 强刷;`useNeighborAnnotations(taskIds, groupId)` 用 `useQueries` 跨邻帧 task 拉同 group_id 标注(复用 `["annotations",taskId]` 缓存,group=null 短路)。`api/tasks.ts` 加 `getNeighbors` / `propagateToTask`。
- **3D 工作台跨帧 UX**:`Shift+→` / `Shift+←` 把选中 box_3d propagate 到邻帧并跳转自动选中;`CrossFrameOverlayToggle`(0/1/3/5,localStorage 持久化)控制邻帧叠加 K;`PointCloudScene.setReferenceBoxes` 渲染半透明 dashed、不可拾取的参考框层;首/末帧给"已是该 scene 首/末帧" toast。
- **2D 图像序列跨帧 UX**:`Alt+→` / `Alt+←` 跨帧 propagate 选中 bbox / polygon(统一中央 hotkey,与 3D 共用壳层 orchestration);3D 额外保留 `Shift+→` / `Shift+←` 别名。

### Changed

- **scheduler scene 连续标注**:`Project` 加 `prefer_same_scene_continuation`(默认 `false`)+ `scene_continuation_window_min`(默认 30)。打开后 `get_next_task` 在套用既有 sampling 前,优先返回"用户窗口内最近标注 task 的同 scene 下一帧"(未锁、未由本人标过、可见);找不到回退既有策略。**默认 OFF,既有项目零回归**(关闭时整段不进入)。`PATCH /projects/{id}` 透出该开关。

### Docs

- `docs-site/user-guide/workbench/3d-box.md`:跨帧 propagate + 邻帧叠加操作说明。
- `docs-site/dev/concepts/scene-and-frame-index.md`:新增"跨帧 UX 如何消费 neighbors API"+ scheduler scene 优先小节。

### 未尽事项(留后续)

- 视频多段(case C)段内/段间 `Alt+→` 分流到 `video_tracker_runner`:本期未接(videoMode 下暂无动作)。
- 跨帧自动插值 / Kalman 预测、多目标批量 propagate、`point_mask_3d` 跨帧、邻帧 overlay K>5:留 v0.15+。

## [0.14.0] - 2026-06-06

跨 task 帧序列地基:`scenes` 模型 + `dataset_items.scene_id/frame_index` + neighbors API + 导入端口对齐 + manifest 透出。把 3D 点云逐帧 / 2D 抽帧序列 / 多段 mp4 拼接长录像统一到同一抽象,为 v0.14.1 跨帧 UX(`Shift+→` propagate / 邻帧叠加 / `useFrameNeighbors`)备好合法 backing。计划见 `docs/plans/2026-06-05-v0.14.0-scene-and-frame-index-foundation.md`。

### Added

- **`scenes` 表 + 两列**:新建 `scenes`(`display_id` SCN-N、`dataset_id` FK CASCADE、同 dataset name 唯一)+ `dataset_items.scene_id`(FK SET NULL)+ `frame_index`(int);复合索引 `idx_dataset_items_scene_frame` 给 neighbors 查询。migration `0096_scenes_and_frame_index.py`。
- **Scene service**(`services/scene.py`):`create_scene` / `assign_items_to_scene` / `list_for_dataset` / `get_neighbors_for_task`;双路径反查 task(`task.dataset_item_id` 直链 + `TaskDatasetItemLink role=primary_lidar`)。
- **Scene inference**(`services/scene_inference.py`):`infer_and_apply(mode=single|per_subdirectory|auto, dry_run)`;auto 模式按"顶层是否全为已知角色名"自适应单/多 scene。点云布局走 `group_frames` + 自然排序;非点云按 `file_name` 自然排序赋 0..N-1。幂等 + > 100 scene 安全阀。
- **Neighbors 端点**:`GET /api/v1/tasks/{id}/neighbors?k=1`,k ∈ [1,20]。响应 `{ scene_id, scene_name, frame_index, scene_total_frames, prev[], next[] }`;历史未 backfill task → 200 全空。
- **Scenes CRUD API**:`GET /api/v1/scenes?dataset_id=` / `GET /api/v1/scenes/{id}` / `PATCH /api/v1/scenes/{id}`。create 由 importer / backfill 自动发起。
- **Backfill 端点 + 脚本**:`POST /api/v1/datasets/{id}/scenes/backfill?mode=auto&dry_run=` + `scripts/backfill_scenes.py --dataset-id / --all-missing / --dry-run / --mode`。
- **导入端口对齐**:`pointcloud_import.build_pointcloud_tasks_for_link` 顶部自动跑 `single`-mode inference;`POST /datasets/{id}/items/upload-zip` 末尾跑 `auto`-mode,响应附 `scene_inference_notes[]`。
- **Manifest 透出**:`TaskPointCloudManifestResponse` 增 `scene_id` / `scene_name` / `frame_index` / `scene_total_frames`;前端 codegen 自动跟随。`ThreeDWorkbench` 写 `console.debug` 追踪,本期不消费 UX。
- **文档**:[`docs-site/dev/concepts/scene-and-frame-index.md`](docs-site/dev/concepts/scene-and-frame-index.md)。

### 不在本期(留后)

- 跨帧 UX(`useFrameNeighbors` / `Shift+→` propagate / 邻帧叠加)→ v0.14.1
- 跨 scene 段内段间无感导航(case C)→ v0.14.2+
- `get_next_task` 的 `prefer_same_scene_continuation` flag → v0.14.1+
- nuScenes 多 scene 转换脚本 → v0.14.2
- scene 跨多 dataset / ego_pose / 时间戳 → v0.15+

### 不动

- `services/scheduler.py` 一行不动;`get_next_task` 行为完全不变(既有项目零回归)。
- `VideoFrameIndex` / `VideoChunk` / `VideoFrameCache` / `video_tracker_runner.py`:case A 内部跨帧栈不动。

## [0.13.12] - 2026-06-05

3D 工作台收尾 + 点云分割 MVP。补齐 v0.13.11 留下的坐标系 UI、自动嗅探、标注创建约定记录、导出源系映射,并把 v0.13.0 已预留的 `point_mask_3d` 几何接入前端工作台。计划见 `docs/plans/2026-06-05-v0.13.12-3d-polish-and-pointmask.md`。

### Added

- **点云坐标系设置入口**:点云数据集创建向导与数据集详情设置面板新增 `AxisConventionPicker`,支持 `iso_8855` / `ros_rep103` / `kitti_camera` / `opencv_camera` / `apollo` / `y_forward` / `sustechpoints_demo` / `raw`。已关联项目的数据集切换时会先提示历史 3D 标注风险。
- **自动嗅探端点**:`POST /datasets/{id}/sniff-axis-convention` 根据 front 相机外参光轴方向返回最匹配 convention、分数和候选列表;前端设置面板可一键应用建议。
- **3D 几何创建约定记录**:`box_3d` 和 `point_mask_3d` geometry 新增 `convention_at_create`。3D 工作台发现历史框与当前数据集约定不一致时显示顶部提示,并支持对选中框按当前约定单框重投影。
- **导出坐标系选项**:项目/批次导出新增 `axis_frame=iso|source`,默认 `iso`。`source` 时 AAP 导出会把 `box_3d` PSR 反向映射回数据集源坐标系;导出缓存 key 同步纳入该参数。
- **点云分割工具 MVP**:3D 工具栏新增 `point_mask_3d` 分割工具和 `P` 快捷键。拖出屏幕矩形后,矩形内点云原始索引落为 `PointMaskGeometry { point_indices }`;再次选中分割标注会在主 3D 视图高亮所属点。

### Changed

- **前后端坐标系数学对齐**:后端新增 `axis_convention.py` 复刻 `R_NORM`、PSR apply/unapply 与导出转换逻辑;前端 `axisConvention.ts` 补齐 PSR apply、自动嗅探候选排序与回归测试。
- **OpenAPI / codegen 同步**:API schema 暴露 sniff response、`convention_at_create`、`decimate_stride`、导出 `axis_frame` 参数,前端生成类型同步更新。
- **文档同步**:`docs-site/user-guide/datasets/lidar-axis-convention.md` 更新为当前 UI/API 行为;`docs-site/user-guide/workbench/3d-box.md` 增补点云分割操作。

## [0.13.11] - 2026-06-05

点云 lidar 系约定 dataset 级声明 + 加载侧归一化。SUSTechPOINTS 示例及任何非 ISO 8855 (`+X 前 / +Y 左 / +Z 上`) 数据集进来后,3D 工作台不再因坐标系约定错位而出现「BEV 车头朝下 / 画框沿世界轴对齐错位 / 三视图躺歪」。计划见 `docs/plans/2026-06-05-v0.13.11-lidar-axis-convention.md`,架构决策见 `docs/adr/0034-lidar-axis-convention.md`。

### Added

- **dataset 级 `axis_convention` 字段**:`POST /datasets` / `PUT /datasets/{id}` 可声明 lidar 系约定,枚举 `iso_8855` / `ros_rep103` / `kitti_camera` / `opencv_camera` / `apollo` / `y_forward` / `sustechpoints_demo` / `raw`,默认 `iso_8855`。落到 `Dataset.metadata.axis_convention` (新增 `datasets.metadata` jsonb 列,迁移 `0095_dataset_metadata.py`)。
- **3D 工作台加载侧归一化**:`GET /tasks/{id}/point-cloud/manifest` 透出该数据集的 `axis_convention`;前端 `PointCloudScene.loadPcd` 加载 PCD 后立即把 positions 旋转到 ISO 系,`ThreeDWorkbench` 把所有相机 extrinsic 同步旋转。上层几何代码 (`cameraAnchor` / `frontCameraForward` / `psrFromPoints` / `autofit` / `projection` / `triview`) 全部不感知 convention,继续锁死 ISO 8855。
- **`apps/web/src/pages/Workbench/stages/three-d/geometry/axisConvention.ts`**:新增 8 种约定的 R_norm 旋转矩阵表 + `applyConventionToPositions` / `applyConventionToExtrinsic` / `unapplyConventionToPsr`。20 个单测覆盖合法性 (det=+1, R·Rᵀ=I) / 退化 (iso/raw 是 identity) / 数学契约 (E_iso = E_src·diag(R_normᵀ,1)) / SUSTechPOINTS 实测回归。
- **seed 夹具自动打标**:`apps/api/scripts/seed_pointcloud.py` 创建 SUSTechPOINTS 示例数据集时,自动写 `axis_convention=sustechpoints_demo`,开箱即用 BEV 车头朝上。

### Changed

- **seed 脚本归并到 `apps/api/scripts/`**:旧的 standalone `apps/api/scripts/seed_pointcloud.py` 删除;`scripts/seed_pointcloud_dev.py`(repo 根)移到 `apps/api/scripts/seed_pointcloud.py`。`scripts/seed.py` 不再用 `importlib.util.spec_from_file_location` 跨目录加载,改为标准 `from seed_pointcloud import seed_pointcloud`。

### Behavior

- **向后兼容**:历史数据集 `metadata={}` ⇒ `axis_convention=null` ⇒ 前端按 `iso_8855` 处理,与 v0.13.10 行为完全一致。
- **现有 dev 栈一次性回填** SUSTechPOINTS 数据集约定:
  ```sql
  UPDATE datasets SET metadata = jsonb_set(metadata, '{axis_convention}',
    '"sustechpoints_demo"') WHERE name = 'pc-scene-dev';
  ```

### Deferred (不在本版本)

- UI 数据集设置里的 axis_convention 下拉 + 8 种约定图示 (`AxisConventionPicker`)
- 自动嗅探端点 `POST /datasets/{id}/sniff-axis-convention`
- annotation payload `convention_at_create` 字段 + 跨约定切换 warning
- 导出时 `unapplyConventionToPsr` 反向回源系

## [0.13.10] - 2026-06-05

工作台布局偏好跨设备同步 + 左右侧栏四区块浮窗 + 3D 三视图浮层可拖拽。左右侧栏开合/宽度、任务队列 / 类别面板 / 标注详情 / 讨论 Issue 面板浮窗位置尺寸、3D 三视图位置尺寸/折叠态统一写入 `user.preferences.workbench.layout`；离线或未登录时继续用 localStorage 兜底。计划见 `docs/plans/2026-06-05-v0.13.10-workbench-prefs-and-floating-inspector.md`。

### Added

- **工作台 layout 偏好跨设备记忆**：`WorkbenchPreferences.layout` 新增 `leftOpen/rightOpen/leftWidth/rightWidth/floatingTaskQueue/floatingClassPalette/floatingInspector/floatingDiscussion/triViewFloat`；前端 `useWorkbenchConfig.setLayout()` 本地立即生效、localStorage 兜底，并 300ms debounce PATCH 全量 `workbench` 子树，避免只发 nested layout 覆盖旧渲染偏好。
- **左右栏四区块可分离为同窗口浮窗**：左栏任务队列 / 类别面板、右栏标注详情 / 讨论 Issue 面板都提供分离入口。分离后对应侧栏默认收起；用户再次展开侧栏时只显示仍嵌入的区块，不会把浮窗自动合并回去。若该侧栏两个区块都已分离，展开/收起按钮无可见变化。四个浮窗使用一致的最小尺寸，支持顶栏拖动、右下角 resize、合并回侧栏与关闭；合并回侧栏只恢复嵌入状态，不主动展开侧栏。位置/尺寸持久化到对应 `floating*` 字段。
- **通用 `FloatingPanelShell` + `useDragMove`**：统一处理 fixed 浮窗 chrome、pointer 拖动、右下角 resize、窗口 resize clamp 和边界防丢，供侧栏区块与三视图复用。
- **3D 三视图浮层升级**：`TriViewPanel` 改由 `FloatingPanelShell` 承载，顶栏可在 3D 画布范围内拖动、右下角可 resize，位置/尺寸/折叠态写入 `triViewFloat`；首次打开仍默认贴右下并避让右栏。

### Changed

- **3D 浮层避让与贴边修正**：`ThreeDWorkbench` 用右栏宽度计算三视图首次默认浮窗位置，但舞台内部右侧相机锚点和三视图折叠标签贴主视图边缘；顶部相机锚点随工具条实际高度下移。工具条高度由 `ResizeObserver` 跟踪，按钮换行后相机不会压住工具条。
- **侧栏宽度持久化迁移**：`leftWidth/rightWidth` 从只写 `localStorage` 升级为 `user.preferences.workbench.layout`，保留旧 localStorage key 作为远端缺省和离线兜底。

### Notes

- 不做真独立浏览器 window、浮窗层级管理或相机预览拖拽；本版只做同窗口浮窗形态。
- 后端 JSONB 无迁移；schema 只新增偏好子结构并保持 `/me/preferences` 顶层子树合并契约。

## [0.13.9] - 2026-06-04

点云标注台「初始画框」优化:**框选画框(frustum 选点)+ BEV 一键鸟瞰**。原先建框只能「点地面放一个固定尺寸框」,现支持在主 3D 视图按住拖出屏幕矩形 → 选中投影落在矩形内的真实点 → 取其包围盒建框并自动选中;并新增「俯视(BEV)」相机复位按钮,便于框选。调研(`docs/research/14-point-cloud-image-fusion.md`)表明主流工具(SUSTechPOINTS/xtreme1)均走「框选 + 点云拟合」范式,本版与之对齐。**关键:用屏幕投影选真实点而非投地面平面取 footprint**——后者对有高度的物体在透视视角下有视差(车顶投影偏到车后,框只捞到一层地面点),frustum 选点对视角/物体高度零视差。**纯前端、复用既有 geometry,后端零改动、零迁移、零端点**。计划见 `docs/plans/2026-06-04-v0.13.9-ground-rect-bev.md`。

### Added

- **框选画框(frustum 选点)**(`ThreeDWorkbench` + `PointCloudScene` + 纯几何 + 单测):box 工具下在主视图按住拖出屏幕矩形 → `PointCloudScene.selectPointsInScreenRect`(将每个点经 `projection·viewⁱⁿᵛ` 投到 NDC,落在矩形内且在相机前方 `w>0` 的点选中)→ `psrFromPoints`(`autofit.ts`,取选中点 world AABB:`center`=包围盒中心、`size`=跨度 + 2×padding、`rotation`=0)→ 建框并选中。拖动 < 4px 退化为旧的「点击放置固定框」(向后兼容)。拖拽期禁用 OrbitControls、屏上画半透明预览矩形;`window` 级 mousemove/mouseup 监听保证拖出视口也能收尾。
- **BEV 鸟瞰复位按钮**:控件浮条「俯视」(`PointCloudScene.bevView`)把相机摆到稠密区正上方俯看 -Z、车头朝屏幕上方(看 -Z 时 up 取水平 forward);仍是透视相机,不引入正交模式。「重置视角」(`frameView`)同步还原 `camera.up = (0,0,1)`,两者可随时切换。

### Notes

- frustum 选点天然把屏幕矩形对应的近垂直点柱内所有高度的点都选上(含车顶/车轮 + 周围地面),故 AABB 底自然贴地、高度到车顶、XY≈拖框范围;选不到点(空地拖框)→ 不建框。
- 朝向(yaw)取 0(轴对齐 AABB),斜置物体建框后可按「朝向⚗」(`fitYaw`)旋正,或手调。
- 仍建议在俯视(BEV)下框选体验最佳,但本法不再依赖视角的无视差性(透视斜视下也能选对点)。

## [0.13.8] - 2026-06-03

点云 + 图像联合标注工作台第九切片:**3D 框一键贴合 + RGB 上色 z-test 遮挡修复**。粗框 → 精框的「逐边拖到点云贴合」从手动 → 一键(`Q`);v0.13.6 RGB 上色背景被前景"染色"的视觉伪 feature 用既有深度栅格做 z-test 修真。**纯前端、复用 v0.13.5/0.13.6 既有 geometry,后端零改动、零迁移、零端点**。计划见 `docs/plans/2026-06-03-v0.13.8-fit-shrink-occlusion-fix.md`。

### Added

- **自动贴合内核**(`three-d/geometry/autofit.ts`,纯函数 + 单测 12 例):
  - `fitSize` 保中心 + 朝向,把 size 收到「框内点 box-local AABB + 2×padding」(默认 5cm),size 各分量下限 `MIN_SIZE`;
  - `fitBottom` 保中心 cx/cy + 朝向 + size,把 cz 下移到「框内 world 最低点 = box 下沿」;
  - `fitYaw`(实验)保中心 + size + pitch/roll,仅改 yaw = 框内点 XY 平面 PCA 主轴方向;闭式 2x2 协方差特征向量,点数 < 20 自动放弃避免反转。
  - `fitSizeAndBottom` 便捷连击(`Q` 默认动作);所有函数纯,inside 判定走 `q⁻¹·(p - center)` 米制 box-local,与 `box3d.boxLocalClipPlanes` 同口径(避开 `worldToBox` 的 scale 陷阱)。
- **贴合 UI + 快捷键**:`ThreeDWorkbench` 控件浮条加四按钮组(选中且可编辑时显示),细分隔线与上色/深度开关分开;
  - `Q` = 默认连击(收尺寸 + 贴地)/`Shift+Q` 仅收尺寸 / `Alt+Q` 仅贴地 / `朝向⚗` 仅按钮(实验,无快捷键避免盲操稀疏点 PCA 反转);
  - 共用 `applyFit` helper 立即提交 + 同步 form,不走 250ms 防抖(一键操作期望即时);焦点在输入框 / Ctrl-Meta 修饰 / 不可编辑时跳过。

### Changed

- **RGB 上色 z-test 遮挡修复**(`colorize.ts` 新增可选 `rasters` 参数 + 单测 +3):v0.13.6 上色 MVP 不做遮挡,背景点投到前景同像素被"染色";现把 v0.13.6 既有深度栅格按相机喂给 colorize,逐点投影时比对该像素格最近深度,深度差 > `OCCLUSION_TOL_M = 0.10m`(经验值,常见 LiDAR 噪声 ~3-5cm + 城市目标 10cm)判遮挡 → 不上色,保留高度色带。未传 rasters 时完全向后兼容 v0.13.6 行为。`ThreeDWorkbench` colorize useEffect 已透传深度栅格;UI 无新开关,上色开 = 自动启用 z-test。
- **autofit.test.ts unused vars 清理**:子代理 L0 commit 遗留的 `pts`/`pts2` 重复构造合并。

### Notes

- 性能:深度栅格 v0.13.6 已经按相机 + 帧建一次(供热力图 / hover 用),z-test 复用同一份栅格,新增 O(1) 哈希查询/点/相机,1e6 点 × 3 相机量级 10ms 级,主线程仍可接受;不进 worker 化(留 v0.14.x)。
- 自动贴合 padding 默认值 5cm 在示例集 `pc-scene-a` 上经目测均衡(太大见缝,太小压点云),不暴露给用户调。
- 范围:跨帧轨迹 / `track_id` schema / 邻帧标注复制本版**不做**(留 v0.13.9 完整切片):`group_id` 当前为 task 内自增空间(`annotation.py:50` 注释 + `task.py:114`),不可复用作 dataset-scoped track_id,需 schema + 迁移 + 端点 + UI,不应与纯前端体验项混做。
- 验证:全量 1153 测绿(autofit 12 + colorize 新 3 + 原 1138);`tsc --noEmit` 零错误;`pnpm lint` 零错误(170 baseline warning 全属既有);`check-css-tokens` 通过;宽屏(1568px)浏览器目测 Q 收紧、Shift+Q 只收尺寸、Alt+Q 只贴地、RGB 上色穿模消除。

## [0.13.7] - 2026-06-03

点云 + 图像联合标注工作台第八切片:**相机悬浮环绕布局**(SUSTech 式)。相机从「底部一字排 strip」改为按物理朝向悬浮在主 3D 视图四周,主视图全屏化;三视图精修栏从常驻右栏收为右下浮层。**纯前端、布局 + 交互重构,后端零改动**。计划见 `docs/plans/2026-06-03-v0.13.7-camera-surround-layout.md`。

### Added

- **相机朝向锚点推导**(`three-d/geometry/cameraAnchor.ts`,纯函数 + 单测 7 例):把每个相机推到主视图四周 9 个锚点之一(8 方位 + overflow)。**名字优先**(`front→顶 / rear→底 / left→左 / right→右`,复合 `front_left` 先于简单命中)、**外参兜底**(无可识别名字时按标准 lidar 约定 X=前 取光轴方位角)、都认不出 / 光轴近垂直 → overflow。
- **悬浮相机面板**(`FloatingCameraPanel.tsx`):相机按 `cameraAnchor` 分组贴主视图边缘(同朝向沿边堆叠),`front` 顶中 / `left` 左中 / `right` 右中。每个面板可「收起」折叠为贴边小标签,折叠态按 role 存 `localStorage`(刷新保留)。容器 `pointer-events:none` 不挡点云,子面板各自收事件。
- **相机放大浮层**:面板标题条「⛶」→ 居中大图浮层(复用 `CameraProjectionView`,图按 70vh 放大),投影 / 上色 / 深度 overlay 一致缩放;遮罩点击 / 关闭钮 / `ESC` 三途径关闭。

### Changed

- **主 3D 视图全屏化**:拆掉 `mainRow` 固定 240px 三视图右栏与底部相机 strip,viewport 铺满,gizmo 标注空间最大化且永不被压。
- **三视图精修收右下浮层**(`TriViewPanel` 容器从右栏改 `viewportWrap` 内 absolute 浮层):选中框才挂载浮出,可「收起」为小标签,未选框时零占位。
- **投影 / 上色 / 深度 / 命中零改动**:`CameraProjectionView` 已按 `clientWidth/naturalWidth` 自适应缩放,布局变更对其透明。

### Notes

- 当前示例集 `pc-scene-a` 仅 `front/left/right` 三相机(无 rear),网格自适应只渲染有相机的扇区,空朝向让主视图吃掉。外参兜底假设标准 lidar 约定(X=前);示例集前向实为 -Y(非标准),故走名字分支,回归测试锁定名字优先压过外参。
- 窄屏自适应(过窄自动折叠)未做:应用已在 <1024px 由 `MobileWorkbenchBlock` 拦截、且面板可手动折叠 + 记忆,留作 follow-up。相机面板自由拖动、6+ 相机(nuScenes)实测调优同列后续。

## [0.13.6] - 2026-06-03

点云 + 图像联合标注工作台第七切片:**点云 RGB 上色 + 深度联动**——继续吃满 0.13.4 的标定投影内核,把图像↔点云的融合做深一层。**纯前端、实时算不预存,后端零改动**。计划见 `docs/plans/2026-06-03-v0.13.6-rgb-colorize-depth-layout.md`(朝向环绕布局原 C3 已拆出顺延更下一版本)。

### Added

- **相机 RGB 上色点云**(`three-d/geometry/colorize.ts`,纯函数 + 单测 6 例):逐点投影到各标定相机像面采样像素 RGB 写回点云 `color`;落图内且在相机前方即候选,多候选取**归一化图像中心距最小**者(畸变最小、最可靠),无相机覆盖回退高度色带。控件加「相机上色」开关(默认关,仅在有标定相机时显示),一次性算不进每帧,关→还原原色。**三视图复用同一 geometry 自动跟随上色**。MVP 不做遮挡(背景点可能被前景串色)。
- **深度联动**(`three-d/geometry/depthmap.ts`,纯函数 + 单测 6 例):点云逐点投到相机像面建深度栅格(每像素格留最近点深度 + 3D 坐标 + 投影像素)。控件加「深度提示」开关 → 相机图叠**深度热力图**(近=红→远=蓝,画在框线下)+ 图上 **hover 读出最近点深度**(figcaption 显 `· X.Xm`)。栅格建一次(开关/换帧),hover 查 O(1) 且不触发重绘。

### Changed

- **`PointCloudScene` 暴露上色接口**:载帧存原色(高度色带);新增 `getPointPositions` / `getBaseColors` / `setPointColors`(原地写回 color buffer,`null` 还原原色)。
- **相机图加载为像素 buffer**:`crossOrigin="anonymous"` + offscreen canvas `getImageData`;跨域污染(SecurityError)则该相机降级跳过,不阻断其余。

### Notes

- 上色 / 深度均**默认关**:无标定相机本就降级,且省一次性投影采样开销。三个相机标定需齐备方可全覆盖(见本版前置的多相机夹具修复:重跑 `attach_calibration` 剥除陈旧 `extrinsic_ok` 杂键)。
- 性能:上色 1e6 点 × N 相机为一次性计算(不进每帧);深度栅格同。worker 化、遮挡 z-test 留迭代。

## [0.13.5] - 2026-06-03

点云 + 图像联合标注工作台第六切片:**三正交视图框精修编辑器**(ADR-0032 方案 B)。主 3D 视图右栏并排俯/侧/正三窗,框内点经 **GPU 裁切**逐窗渲染;在三视图里拖边/拖角改尺寸、拖方向线转三轴(yaw/pitch/roll),与主视图 gizmo / 数值面板 / 0.13.4 投影 overlay **四方实时同步**,松手防抖 PATCH。数值面板补齐 pitch/roll 三轴可编辑 + 朝向一键归零。**纯前端,后端零改动**。计划见 `docs/plans/2026-06-03-v0.13.5-tri-view-box-editor.md`。

### Added

- **三视图几何底座**(`three-d/geometry/triview.ts` + `box3d.ts`,纯函数 + 单测):`worldToBox` / `boxLocalClipPlanes`(box-local 6 裁剪面,含 margin)、`frameOrtho`(等比取景)、`dragEdge` / `dragCorner`(全边长口径 2D→PSR)、`dragRotation`(四元数 local 复合后分解 XYZ 欧拉,**避开多轴欧拉串轴**)、`dragHandle`(屏幕 handle→拖边/角分派)。`triview.test.ts` / `box3d.test.ts` 覆盖三视图映射 / 拖边·角数学 / 三轴旋转 round-trip / 逆变换 + 6 面方向。
- **三视图渲染基建**(`TriViewRenderer.ts`):**单** `WebGLRenderer` + 3 viewport/scissor + 3 正交相机,框内点用 GPU clipping planes 裁、**复用主视图同一份点 BufferGeometry**(零 CPU 拷贝,全程仅 2 个 WebGL context)。相机映射与 `VIEW_AXES` 同口径(右手系保证屏幕 u→右 / v→上),PSR 变只重算 6 面 + 相机。所有 WebGL 资源收口本类,点 geometry 属主场景不 dispose。
- **三视图面板 + 2D overlay**(`TriViewPanel.tsx` / `TriOrthoView.tsx`):WebGL 底 + 叠加 2D overlay 画框矩形 / handle / 方向线柄;拖边/角/方向线 → 回写选中框 PSR。拖拽期**冻结相机取景**(`setCameraRef`),裁剪面仍随实时 box,使框在屏上真实长/移/转而点云不动。
- **数值面板三轴朝向**(`ThreeDWorkbench.tsx`):PSR 编辑面板新增 pitch / roll 字段(°),与 yaw 同组可显示、可编辑;新增「**朝向归零**」按钮一键复位 `yaw/pitch/roll → [0,0,0]`(保留中心 / 尺寸)。

### Changed

- **点大小三视图联动**:三视图点大小跟随主视图点大小滑杆(`pointSize` 透传 → `setPointSize`)。
- **正交相机点大小修正**:`PointsMaterial.sizeAttenuation` 在正交相机下不生效(three.js 仅对透视相机生效),世界尺寸被当像素用 → 亚像素不可见。改为 `sizeAttenuation=false` + 每帧按本视图「米→px」比例(`sCss×dpr`)换算成真实像素,下限 1px。

### Fixed

- **拖拽不落 PATCH**(高危,顺带修好 B-2/B-3 提交):2D overlay 交互 `useEffect` 把频繁变化的 `selected` 放进依赖,拖拽中 draft 改 `selected` → effect 重跑 → cleanup 撤掉了命令式挂的 `mousemove`/`mouseup` 监听 → 松手没人处理,只剩刷新即回退的乐观 draft。改用 `propsRef` + 空依赖,监听全程稳定。
- **数值编辑抹掉 pitch/roll**:`schedulePatch` 原硬编码 `rotation: [0,0,yaw]`,三视图设好 pitch/roll 后再在面板改任一字段(如 cx)就把 pitch/roll 抹回 0。修复:补齐字段 + `rotation: [roll, pitch, yaw]`。

### Notes

- 性能:GPU clip 无 CPU 每帧重算,PSR 变只重算 6 个 `THREE.Plane` + 相机;1e6 点 ×3 viewport 顶点开销在预算内,掉帧预案为三视图相机降采样点集(本切片未触发)。
- 验证:拖拽数学纯函数单测绿(`triview.test.ts` 18 例);切任务 / 反复进出无 WebGL context lost、内存稳定。点云工作台尚无 Playwright e2e harness(0.13.x 各切片一致),三视图交互验证走纯函数单测 + 浏览器手测,e2e 待点云台整体补 harness 时统一加。
- 不做(顺延 v0.13.6+):多框批量 / 跨帧轨迹、自动拟合贴合(`fit_bottom` / `auto_shrink`)、`point_mask_3d` 3D 分割。

## [0.13.4] - 2026-06-03

点云 + 图像联合标注工作台第五切片:**联合标注 MVP 上线**——把 3D 框经相机标定**实时**投影到各相机视图。标注员对照图像确认 / 校正 3D 框,3D↔2D 双向选中联动,同物体共享 `group_id` 身份。**纯前端、实时算不预存,后端零改动、零新端点、零迁移**。计划见 `docs/plans/2026-06-03-v0.13.4-pointcloud-projection-linkage.md`,投影 overlay 架构决策见 ADR-0033。

### Added

- **3D→2D 投影内核**(`three-d/geometry/projection.ts`):`projectPoints(points, calib)` 实现 `extrinsic(行主 4x4) → 可选 rect → intrinsic(行主 3x3) → 透视除法`,`visible = w>0` 剔除相机后方角点;`BOX_EDGES` 12 边索引表。手写行主序矩阵·向量(避开 `THREE.Matrix4` 列主序陷阱)。与 SUSTechPOINTS 逐字对齐,`projection.test.ts` 用真实标定 + yaw-only 框做**像素级对拍**。
- **相机视图投影 overlay**(`CameraProjectionView.tsx`):相机图上叠等尺寸 canvas 画投影线框(类别色),消费同一份标注实时重绘;按 `clientWidth/naturalWidth` 缩放(intrinsic 基于原图分辨率),`ResizeObserver` + `onLoad` 重算,`devicePixelRatio` 适配高清屏。
- **3D↔2D 选中联动**:选中 3D 框 → 各相机投影高亮(白描边 + 淡填充);点相机投影框 → 命中测试反选对应 3D 框;状态条显示「投影可见于 N 相机 · 正对 X」,最正对相机标「· 正对」角标。
- **`group_id` 聚合高亮**:overlay 高亮集合 = 选中框 + 同 `group_id` 成员,为相机视图 2D 框成员(后续)预留跨模态身份。

### Changed

- **相机面板从只读 `<img>` 升级为图 + 投影 overlay**:相机图加大到 160px;无 `calibration` 的相机降级不画、不报错。
- **`useUpdateAnnotation` 乐观更新驱动实时性**:数值面板 / gizmo / 列表改框经乐观更新即时写缓存,overlay 立即跟随(gizmo 拖拽期间不逐帧透传,落点提交后跟随)。

### Fixed

- **3D 台按 E 键误把任务提交质检**:E 全局绑定「提交质检」(`hotkeys.ts` dispatch → submit),在 3D 工作台按 E 想切 gizmo 旋转模式却触发了全局提交。修复:`stageKind==="3d"` 时把 3D 自管的 `B/V/W/E/R` 经 `ignoredKeys` 交给 3D 本地 keydown 处理,全局 2D 热键跳过这些键(Ctrl+方向切题 / `?` / Esc 等全局键保留)。
- **Dashboard 陈旧测试**:`ViewerDashboard.test.tsx` 原用 `lidar` 项目断言「未实现工作台 → toast」,但 lidar 自 v0.13.x 已进白名单(导航进 3D 台);改用 `image-seg` 项目验证降级 toast。

### Notes

- three 仍走 `React.lazy` + 独立 `vendor-three` chunk(513KB);`ThreeDWorkbench` 懒加载块 67.75KB,konva 2D 栈隔离。
- 后端无改动:`/annotations/group` 要求 `len(ids) >= 2`,**单个 3D 框无法自分组**;本切片只做按 `group_id` 聚合高亮,孤立框退化为仅高亮自身。
- 不做:相机视图独立绘制 / 编辑 2D 框成员、投影预存生成 2D 标注、三正交视图精修(ADR-0032 方案 B)、`point_mask_3d` 分割——留 v0.13.5+。

## [0.13.3] - 2026-06-03

点云 + 图像联合标注工作台第四切片:把只读查看器升级为**可标注**——首个点云**可写**能力。在 Three.js 工作台画 / 选 / 编辑 **3D 框**(`Box3DGeometry`),类别复用 `tool_bindings["lidar_box_3d"]`,经现有标注 API 持久化。**纯前端 + 一处设置解禁,后端零改动、零新端点、零迁移**。计划见 `docs/plans/2026-06-02-v0.13.3-pointcloud-3d-box-annotation.md`,交互形态决策见 ADR-0032。

### Added

- **3D 框标注(可写)**:`ThreeDWorkbench` 支持放置 / 选中 / 编辑 / 删除 `box_3d` 框。「放置框 (B)」点地面落框(射线打 `z=groundZ` 水平面,`groundZ` 取 z 直方图低分位避免悬浮)→ 默认尺寸 → 自动选中精修。
- **PSR 编辑(主视图 gizmo + 数值面板)**:选中后官方 `TransformControls`(W 平移 / E 绕 Z 转 / R 缩放)+ 右上 PSR 数值面板,经选中框单一真值双向同步。缩放翻转出的负尺寸取绝对值兜底。
- **PSR↔角点纯函数**:`three-d/geometry/box3d.ts`(移植 SUSTechPOINTS 矩阵 + 单测,`boxToMatrix4` / `psrToCorners`),为 v0.13.4 投影复用同一套约定。
- **`lidar_box_3d` 设置解禁**:`lidar` 项目可在建项目向导 / 项目设置启用该工具单位并配类别。

### Changed

- **类别 / 属性绑定 + 持久化复用 2D 链路**:`box_3d` 创建 / 更新 / 删除直接走 `useCreateAnnotation/useUpdateAnnotation/useDeleteAnnotation`;class_name 校验复用 service 层 `_validate_class_name`(非 `lidar_box_3d` 类集合内的类别 422)。
- **只读接线**:锁定 task / viewer 角色(`readOnly`,壳层透传)不放置 / 不挂 gizmo / 面板禁用,仅可选中查看数值。

### Notes

- three 仍走 `React.lazy` + 独立 `vendor-three` chunk(`pnpm build` 核验),不进主 bundle。
- 后端加 `tests/test_pointcloud_box3d_annotation.py`(box_3d 创建命中 / 422 / 空 `tool_bindings` 放行)。
- 不做:3D→2D 投影联动、`group_id` 跨模态聚合、`point_mask_3d` 分割、三正交视图精修(ADR-0032 方案 B)——均留 v0.13.4+。

## [0.13.2] - 2026-06-02

点云 + 图像联合标注工作台第三切片：**前端点云查看器 MVP(只读)**——首个用户可见的点云能力。引入 Three.js,在工作台渲染主点云 + 各相机图,可旋转缩放、看不可标。计划见 `docs/plans/2026-06-02-v0.13.2-pointcloud-viewer-mvp.md`,架构决策见 ADR-0031。

### Added

- **点云 manifest API**:`GET /tasks/{id}/point-cloud/manifest` 返回主点云 presigned URL + 各相机图 URL + 标定(`SensorCalibration`)。非点云任务 409。
- **Three.js 点云查看器**:`project.type_key === "lidar"` 的任务在工作台进入 3D 舞台(`WorkbenchStageHost` 三路分流的 `3d` 分支)。裸 Three.js + React 薄封装(`PointCloudScene`):`PCDLoader` 加载点云、按高度上色、OrbitControls 旋转/平移/缩放、点大小调节、重置视角;大点云(>50 万点)自动抽稀。各相机图只读平铺(投影联动留 v0.13.4)。
- **dev proxy 可配**:`vite.config.ts` proxy 目标改 `API_PROXY_TARGET` 可覆盖(默认 8000),支持多 worktree 并行各连不同后端端口。

### Changed

- `DatasetItemOut`/3D 几何类型经 codegen 流到前端;three 经 `React.lazy` + 独立 `vendor-three` chunk 加载,**不进主 bundle**,不影响 2D 工作台首屏。

### Notes

- 双画布架构(Konva 2D / Three.js 3D)双栈并存、模块级隔离,2D 流程零改动(ADR-0031)。
- 本切片只读;3D 框标注(v0.13.3)与标定驱动投影联动(v0.13.4)后续。

## [0.13.1] - 2026-06-02

点云 + 图像联合标注工作台第二切片：scene 统一资产导入 + 标定存储。**仅 API、零迁移、无前端可见变化**。计划见 `docs/plans/2026-06-02-v0.13.1-pointcloud-scene-import.md`，决策见 ADR-0030。

### Added

- **标定 schema `SensorCalibration`（G2）**：`extrinsic[16]` + `intrinsic[9]`（+ KITTI 可选 `rect[16]`），存进相机 `DatasetItem.metadata_["calibration"]`，不加列。新增 `DatasetItemMetadata`（`extra="allow"`）让 `DatasetItemOut.metadata` 出强类型（codegen 流到前端），保留其它 metadata key。
- **scene 感知建任务管线**：复用既有「文件入库 → `POST /datasets/{id}/link`」管线，在 `build_tasks_for_link` 内按 `project.data_type == "lidar"` 分流到 `services/pointcloud_import.py`：按 `file_path`（`lidar/` `camera/<cam>/` `calib/camera/`）帧分组，每个 lidar 帧建一个 Task（`file_type=point_cloud`，`dataset_item_id` 指向主点云），用 `link_items` 关联 `primary_lidar` + 各 `camera_<cam>`；帧级 `NOT EXISTS` 去重、分块 commit、job 进度上报，沿用 2D 路径机制。
- **标定写入**：`attach_calibration` 导入时读 `calib/camera/<cam>.json` → 校验长度 → 写各相机帧 DatasetItem.metadata；无 calib 则跳过（标定降级为 3D-only，不阻断）；缺相机的帧只 link 主点云。

### Notes

- `task.dataset_item_id` 指向主点云，使假设单 item 的现存消费方（导出/列表/缩略图）不炸；多 item 消费走 link 表（后续切片验证）。
- 端到端测试以真实夹具 `third-party/SUSTechPOINTS/data/example`（front/left/right 三相机 + 缺相机帧 000950）对拍 link 与标定值。

## [0.13.0] - 2026-06-02

点云 + 图像联合标注工作台（Epic v0.13.x）第一切片：后端数据地基。纯新增、**无前端可见变化**，为后续 LiDAR 点云 + 相机图像联合标注打底。计划见 `docs/plans/2026-06-02-v0.13.0-pointcloud-data-foundation.md`，决策见 ADR-0029，数据模型见 `docs-site/dev/reference/point-cloud-data-model.md`。

### Added

- **多文件关联中间表 `TaskDatasetItemLink`（G1）**：一个 3D 任务（一帧 scene）经新表 `task_dataset_item_links` 关联多个数据项（主点云 + N 路相机图像），带 `role`（`primary_lidar` / `camera_<name>`）与 `sensor_name`；`UNIQUE(task_id, role)`。2D 单文件 task 的 `task.dataset_item_id` 1:1 路径完整保留，两条路径 service 层按 `project.data_type` 分流。迁移 `0094`。service 接口 `link_items` / `get_linked_items`（`app/services/task_dataset_link.py`）。
- **3D 几何类型（G3）**：`Geometry` discriminated union 新增 `Box3DGeometry`（`type=box_3d`，`center[3]`/`size[3]`/`rotation[3]`）与 `PointMaskGeometry`（`type=point_mask_3d`，`point_indices`）。零迁移（存 `annotations.geometry` JSONB）；旧 2D 几何不受影响。前端强类型由 OpenAPI codegen 产出。
- **工具单位 + file_type（G4）**：`lidar_box_3d` 工具单位从「留位」转为后端可用，新增 `point_mask_3d`；数据集 file_type 推断放开点云扩展名 `.pcd` / `.bin` / `.las` / `.ply` → `point_cloud`。
- **跨模态身份约定（G6）**：不新增模型，复用 `Annotation.group_id` 把同一物体的「3D 框 + 各相机 2D 框」聚为一个逻辑对象。约定见数据模型参考文档。
