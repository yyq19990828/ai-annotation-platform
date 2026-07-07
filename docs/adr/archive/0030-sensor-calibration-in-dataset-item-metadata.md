# 0030 — 相机标定存进 DatasetItem.metadata_（不加列）

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** core team
- **Supersedes:** —

## Context

点云 + 图像联合标注要把 3D 框投影到各相机视图,需要每个相机的标定(外参 `extrinsic` 4x4 + 内参 `intrinsic` 3x3)。标定是**每相机**一份(对该相机所有帧通用),需要随相机图像数据一起存取。

平台已有 `DatasetItem`(每个文件一行)且带一个未充分利用的 `metadata_` JSONB 列。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A:存进 `DatasetItem.metadata_["calibration"]`** | 零迁移;随相机项天然就近;Pydantic 校验 | 同一标定按帧去规范化存多份 |
| 方案 B:新增 `sensor_calibrations` 表(相机维度) | 规范化、无冗余 | 加表加迁移;查询要 join;相机维度尚无独立实体 |
| 方案 C:`DatasetItem` 加 `calibration` 列 | 强类型直观 | 破坏性迁移;只对点云相机项有意义的列污染所有 item |

## Decision

采用**方案 A**:标定写进相机 `DatasetItem.metadata_` 的约定 key `"calibration"`,用 Pydantic 子 schema `SensorCalibration` 校验,**不加任何列、不加表、零迁移**。

落地约束:

1. **schema**(`app/schemas/_jsonb_types.py`):`SensorCalibration{ extrinsic: list[float](16), intrinsic: list[float](9), rect: list[float]|None(16) }`;`DatasetItemMetadata{ calibration: SensorCalibration|None }` 带 `extra="allow"` 保留其它 metadata key。`DatasetItemOut.metadata` 用 `DatasetItemMetadata` 出强类型(codegen 流到前端)。
2. **写入**(`app/services/pointcloud_import.py:attach_calibration`):导入时读 `calib/camera/<cam>.json` → 校验 extrinsic/intrinsic 长度 → 写进该相机**所有帧** DatasetItem 的 `metadata_["calibration"]`。
3. **去规范化可接受**:标定体积小(25 个 float),按帧存多份的冗余成本远低于建相机维度表的复杂度。未来若需相机级实体再抽表(方案 B 作为演进路径保留)。
4. **标定降级**:无 calib 文件的 scene 跳过写入,退化为 3D-only 标注,不阻断导入。

## Consequences

正向:
- 零迁移、零破坏;标定随相机项就近存取,投影(v0.13.4)直接从 task 的 camera link → DatasetItem.metadata 拿。
- `extra="allow"` 让 metadata 既能强类型暴露 calibration,又不锁死其它键(视频等未来 metadata 共存)。

负向:
- 同一相机标定按帧冗余存储;若单 scene 帧数极大且标定频繁更新,冗余更新成本上升(当前不构成问题)。
- 标定正确性(外参准不准)本切片不校验,仅校验结构长度;投影可视化校验留后续版本。

## Notes
- 实现:`app/schemas/_jsonb_types.py`(`SensorCalibration` / `DatasetItemMetadata`)、`app/services/pointcloud_import.py:attach_calibration`、`app/schemas/dataset.py:DatasetItemOut`
- 投影语义:`extrinsic·[x,y,z,1] → 取 xyz → intrinsic·xyz → 透视除法 → 像素`(移植自 SUSTechPOINTS `image.js:points3d_homo_to_image2d`)
- 相关:ADR-0029(多文件关联)、`docs-site/dev/reference/point-cloud-data-model.md`、Epic `docs/plans/2026-06-02-v0.13.x-point-cloud-workbench-epic.md` G2
