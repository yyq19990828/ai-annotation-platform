# 0033 — 3D→2D 投影联动:实时纯函数投影 + canvas overlay(不预存)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.13.3 让用户在 3D 工作台画 / 选 / 编辑 `box_3d` 框,但相机图仍是只读平铺,3D 框与图像彼此无关。联合标注的核心价值差最后一步:把 3D 框经相机标定**投影**到各相机视图,标注员对照图像确认 / 校正 3D 框,且同物体的 3D 与 2D 表示共享身份(`group_id`)。

约束已就位:标定在 `DatasetItem.metadata_`(ADR-0030)、manifest 的 `cameras[].calibration` 直出;`group_id` 自增机制(`task.next_group_seq`)v0.13.0 起就在;PSR↔8 角点纯函数(`box3d.ts`)v0.13.3 已抽离。需要定的是**投影怎么算、画在哪、怎么联动**。

## Decision

**实时纯函数投影 + canvas overlay,不预存投影结果,后端零改动。**

### D1 · 实时投影,不预存(承 epic 基线)

每次按 `calibration` 现算 8 角点像素,不落库。省存储、改框即时反映;性能靠「只投非隐藏框 + canvas 批量重绘 + 乐观更新驱动」。投影是**可视化**,不生成 2D 框标注。

### D2 · 投影纯函数与 `box3d.ts` 同模块、同坐标约定

`three-d/geometry/projection.ts`:`projectPoints(points, calib) → { pixels, visible }`,投影链 `extrinsic(行主 4x4) → 可选 rect → intrinsic(行主 3x3) → 透视除法`,`visible = w>0`。与 SUSTechPOINTS `image.js`/`util.js` **逐字对齐**,像素级对拍验证(`projection.test.ts`)。**手写行主序矩阵·向量**(`THREE.Matrix4.elements` 列主序,直接喂行主序标定会转置出错)。作为 3D↔2D 单一真值,三视图(v0.13.5)与未来 2D 联动复用。

### D3 · overlay 用 canvas(非 SVG),消费同一份标注

`CameraProjectionView.tsx`:相机图上叠等尺寸 canvas,消费同一份 `annotations` + `selectedId`(无额外状态),数十框 × 12 边线 canvas 全量重绘比 SVG 节点更省(SUSTechPOINTS 亦 canvas)。`useUpdateAnnotation` 乐观更新让面板 / gizmo / 列表改框后 overlay 即时跟随。缩放按 `clientWidth/naturalWidth`(intrinsic 基于原图分辨率),`ResizeObserver` + `onLoad` 重算。

### D4 · 标定缺失降级 + 反选命中

无 `calibration` 的相机不画、不报错(承 ADR-0030 降级)。反选用投影包围盒命中测试(含点取最小面积框);MVP 不做画面裁剪 / 凸包精确命中。

## Consequences

正向:

- 投影联动在 v0.13.4 一个切片落地,后端零改动、零新端点、零迁移。
- 纯函数 + 单一真值 + 像素级对拍,坐标约定一次锁死,三视图 / 未来 2D 联动复用。
- overlay 与主视图消费同源标注,实时一致天然成立。

负向 / 已知取舍:

- **gizmo 拖拽期间 overlay 不连续跟随**:`TransformControls` 只在拖拽结束 emit PSR → 提交 → 乐观更新后 overlay 才更新(拖拽中不逐帧透传,避免 60fps React 重渲)。数值面板 / 列表改框因乐观更新即时跟随。
- **命中测试用包围盒非凸包**:重叠框场景反选可能不够精确(取最小面积框兜底)。
- **`group_id` 单框无法自分组**:后端 `/annotations/group` 要求 `len(ids) >= 2`(不动后端的前提下无法给单个新建 3D 框分配 group_id)。本切片只做**按 `group_id` 聚合高亮**:孤立框 `group_id` 为空时退化为仅高亮自身,待相机视图上落地 2D 框成员(v0.13.5+)再聚合。

## Alternatives Considered

- **预存投影结果**:导入 / 改框时算好 2D 框落库。省前端算力但增存储 + 改框要回算 + 标定更新要全量重投,且把「实时可视化」误当「2D 标注」。否决,留实时。
- **SVG overlay**:声明式、命中测试天然(DOM 事件),但数十框 × 12 边线 × 多相机的节点量与重排成本高于 canvas 全量重绘。否决。
- **gizmo 拖拽逐帧透传 PSR 给 overlay**:体验更顺(拖 3D 框看图像里同步动),但需 60fps setState,重渲风险高;MVP 用乐观更新的「提交即更新」兜住,逐帧透传留后续按需。

## Notes

- 实现:`apps/web/src/pages/Workbench/stages/three-d/geometry/projection.ts`(+ `.test.ts` 对拍)、`CameraProjectionView.tsx`、`ThreeDWorkbench.tsx`(高亮集合 / 最佳相机 / overlay 接线)。
- 后端:无改动、无迁移;标定 / group 链路在 v0.13.0~v0.13.1 已备好。
- 相关 ADR / 计划:ADR-0030(标定存储)、ADR-0031(双画布)、ADR-0032(3D 框编辑)、`docs/plans/2026-06-03-v0.13.4-pointcloud-projection-linkage.md`。
- 后续:相机视图独立绘制 / 编辑 2D 框成员、三正交视图精修(ADR-0032 方案 B,v0.13.5)、gizmo 拖拽逐帧投影。
