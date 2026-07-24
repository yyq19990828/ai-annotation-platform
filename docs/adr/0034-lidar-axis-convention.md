# 0034 — 点云数据集 lidar 坐标系约定:dataset 级声明 + 加载侧归一化

- **Status:** Proposed
- **Date:** 2026-06-05
- **Deciders:** core team
- **Supersedes:** —

## Context

平台 3D 链路全部硬编码假设 lidar/world 系 = **ISO 8855**(`+X 前 / +Y 左 / +Z 上`):

- `cameraAnchor.ts` 按外参 forward 判 anchor(`extWithForward(1,0,0) → top`)。
- `frontCameraForward`(`apps/web/src/pages/Workbench/stages/three-d/ThreeDWorkbench.tsx:167`)取 front 相机外参 row 2 作 BEV「正上方」朝向。
- `psrFromPoints`(`apps/web/src/pages/Workbench/stages/three-d/geometry/autofit.ts:265`)框选拟合,新建 PSR 朝向 `rotation=[0,0,0]`,即沿世界 +X / +Y 对齐。
- 高度着色、地面估计、autofit 全部用 world Z = 物理高度。

但 lidar/ego 系约定在业界**碎片化**:KITTI 用 camera-as-world(`+X 右 / +Y 下 / +Z 前`),Apollo 用 `+Y 前`,SUSTechPOINTS 自带示例数据集是 `+X 车左 / +Y 车后 / +Z 天`,Velodyne raw 常见 `+Y 前`。**任何非 ISO 数据集进来,BEV 都会"歪",画框 yaw=0 的初始朝向也对不上车身长轴。**

实测案例(`third-party/SUSTechPOINTS/data/example/calib/camera/front.json`):front 相机外参 row 2 ≈ `(-0.033, -0.999, 0.042)` ≈ -Y 朝前。该数据集 lidar 系实际是 ISO 绕 Z 转 180° + 镜像,与平台默认假设完全错位。

| 选项                                                   | 主要卖点                        | 主要劣势                                                                                                                                                                |
| ------------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **方案 C:dataset 声明约定 + 加载侧归一化**             | 上层几何代码全部无感知;单一开关 | 每次打开页面要旋转点云一次(实测 < 50ms)                                                                                                                                 |
| 方案 A:平台内部多约定共存,几何代码读 convention 走分支 | 不动任何字节                    | `cameraAnchor` / `frontCameraForward` / `psrFromPoints` / `applyHeightColors` / `estimateGroundZ` / `fitYaw` 6+ 个函数全要加 convention 参数,新增 convention 全链路回归 |
| 方案 B:导入时改写 PCD 字节 + 改写外参 JSON             | 后续工具读到的就是 ISO          | 破坏「不动用户原始数据」原则;导出要反写;PCD 重写慢                                                                                                                      |
| 方案 D:不支持,要求用户先在外部预处理成 ISO             | 平台零工作                      | 把痛点甩给用户;自带的 SUSTechPOINTS 示例直接不能用                                                                                                                      |

## Decision

采用**方案 C**:

1. `Dataset` 新增 `metadata_` jsonb 列(目前没有该列);其中 `axis_convention: LidarAxisConvention` 字段声明该数据集 lidar/world 系约定,枚举值包括 `iso_8855` / `ros_rep103` / `kitti_camera` / `opencv_camera` / `apollo` / `y_forward` / `sustechpoints_demo` / `raw`,默认 `iso_8855`,历史数据集留 `null` ⇒ 不旋转(向后兼容)。

2. **加载侧归一化**:每个 convention 对应一个固定 3×3 旋转矩阵 `R_norm`(src → ISO)。`PointCloudScene.loadPcd` 加载 PCD 后立即对 positions 调用 `applyConventionToPositions`;`ThreeDWorkbench` 把 `cameras[*].calibration.extrinsic` 调用 `applyConventionToExtrinsic`。归一化后,上层几何代码(`cameraAnchor` / `frontCameraForward` / `psrFromPoints` / 全套 `autofit` / `projection`)**继续锁死 ISO 8855**,不需要也不允许知道 convention 存在。

3. **外参数学契约**:`E_iso = E_src · diag(R_normᵀ, 1)`。推导:相机物理位姿不变,`p_cam = E_src · p_src = E_iso · p_iso`,而 `p_src = R_normᵀ · p_iso` ⇒ `E_iso = E_src · diag(R_normᵀ, 1)`。平移列不变(extrinsic 平移是「相机系下表达的 lidar 原点」,该量与 lidar 系基无关)。

4. **annotation payload 加 `convention_at_create: LidarAxisConvention`**:每个 3D 标注落库时记录创建时所用约定。旧框无此字段 → 假定 `iso_8855`(v0.13.11 之前都是按 ISO 默认假设画的)。dataset convention 中途切换且与历史标注 `convention_at_create` 不匹配 → 前端 toast warn,**v1 不自动重投影**,留给用户决策。

5. **不动用户原始数据**:PCD 字节、calibration JSON 永远不改写;归一化只发生在内存中。

落地约束:

- 纯几何层 `apps/web/src/pages/Workbench/stages/three-d/geometry/axisConvention.ts` 实现 + 单测,可独立合入,不影响渲染。
- 后端迁移:`datasets` 加 `metadata` jsonb 列默认 `'{}'::jsonb`,non-null。
- `DatasetMetadata` Pydantic 子 schema 走 `extra="allow"`,未来其它 dataset 级 metadata(导出预设、默认标签集等)共用此列。
- 自动嗅探端点 `POST /datasets/{id}/sniff-axis-convention`:用 front 相机外参 row 2 与 8 种 convention 的预期 forward 比对(夹角阈值 15°),返回最匹配 convention 让用户确认。

## Consequences

正向:

- 上层几何代码不被污染:`cameraAnchor` / `frontCameraForward` / `psrFromPoints` / `applyHeightColors` / `estimateGroundZ` / `fitYaw` 等 6+ 个纯几何函数全部维持「假设 ISO 8855」,新增 convention 不触发任何回归。
- 用户原始数据零改动,符合「不动客户文件」原则;导出回原系仅需一次反向矩阵作用。
- 自带 SUSTechPOINTS 示例数据集 + 任何非 ISO 数据集进来即可用,不再需要外部预处理。
- `Dataset.metadata_` jsonb 列同时为未来其它 dataset 级元数据(默认导出预设、推荐标签集、数据来源标记等)开口子。

负向:

- 每次打开 3D 工作台需对当前帧点云做一次原地旋转(实测 100w 点 DECIMATE 后 < 50ms,可忽略)。
- annotation payload 多一个 `convention_at_create` 字段,前端 / 导出 / 重投影都要尊重它,不能假定所有框都在同一约定下。
- 用户中途切换 dataset convention 后,旧标注与新约定错位,v1 仅 warn 不自动重投影 → 责任在用户。
- 单数据集多 lidar 不同系的场景 v1 不支持(假定一个数据集一个 lidar 系)。

## Alternatives Considered

**方案 A(几何层多约定分支)**:`cameraAnchor.ts` / `frontCameraForward` / `psrFromPoints` / `applyHeightColors` / `estimateGroundZ` / `fitYaw` 都要新增 `convention: LidarAxisConvention` 参数,且每个函数内部要按 convention 切换轴向假设。问题不在每个函数本身复杂(每个加 4-6 行),而在于:(1)新增任意一个 convention 全链路要回归;(2)`autofit.ts` 用 `world X` 当「length 轴」、`world Z` 当「高度轴」的语义会与 convention 强耦合,跨函数的轴向假设难以保持一致;(3)三视图 `triview.ts` / TransformControls / gizmo 轴向约束也都要适配。**拒绝**:扩散面太大,长期维护成本远高于加载侧一次旋转。

**方案 B(导入时改写字节)**:PCD 字节根据 convention 改写、calibration JSON 改写存盘。问题:(1)破坏「不动客户原始数据」原则,用户后期想换 convention 或导出原系几何要从源数据集重新跑一遍;(2)PCD 二进制重写慢且要保留原文件副本,存储翻倍;(3)增量标定更新(用户传新 calib)要级联重写所有帧。**拒绝**:把可逆的内存运算变成不可逆的字节级操作,没有正向收益。

**方案 D(要求用户外部预处理)**:不支持非 ISO,要求用户用脚本预先把数据集转成 ISO 系再上传。问题:(1)把痛点甩给用户;(2)平台自带的 SUSTechPOINTS 示例数据集会无法直接打开,作为开箱即用体验严重不及格;(3)实际客户数据集多来自不同传感器供应商,完全可能跨 convention,平台层缺这个能力就是产品缺陷。**拒绝**。

## Notes

- 实现代码位置(规划):
  - 纯几何:`apps/web/src/pages/Workbench/stages/three-d/geometry/axisConvention.ts`(+ `__tests__/`)
  - 接通:`apps/web/src/pages/Workbench/stages/three-d/PointCloudScene.ts:loadPcd`、`apps/web/src/pages/Workbench/stages/three-d/ThreeDWorkbench.tsx` 的 `normalizedCameras` memo
  - DB:`apps/api/app/db/models/dataset.py:Dataset.metadata_`、`apps/api/alembic/versions/XXXX_dataset_metadata.py`
  - schema:`apps/api/app/schemas/_jsonb_types.py:LidarAxisConvention` / `DatasetMetadata`、`apps/api/app/schemas/dataset.py`
  - API:`apps/api/app/api/v1/datasets.py`(`POST` / `PATCH` 透传)、嗅探端点 `POST /datasets/{id}/sniff-axis-convention`
  - UI:`apps/web/src/pages/Admin/Datasets/AxisConventionPicker.tsx`
  - 文档:`docs-site/user-guide/admin/datasets.md` / `docs-site/dev/reference/lidar-axis-conventions.md`
- 相关 alembic:`XXXX_dataset_metadata.py`(新增 `datasets.metadata` jsonb)
- 相关 ADR:ADR-0030(标定就近存进 DatasetItem.metadata,同一思路;本 ADR 把 dataset 级 metadata 列也开起来)
- 相关 plan:`docs/plans/archive/2026-06-05-v0.13.11-lidar-axis-convention.md`
- 已知 TODO / 后续演进:
  - **多 lidar 不同系**:v1 单数据集单约定;若支持多 lidar 融合,需把 `axis_convention` 下沉到 sensor 级。
  - **导出反向映射**:`coco_pcd_export` / `aap_export` 加 `--restore-original-axis` 选项(留 v0.13.12+)。
  - **跨约定重投影 batch UI**:用户切换 convention 后批量重投影旧框(留 v0.14.x)。
