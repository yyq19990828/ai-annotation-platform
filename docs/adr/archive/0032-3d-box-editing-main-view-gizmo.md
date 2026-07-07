# 0032 — 3D 框编辑交互形态:主视图 gizmo + 数值面板(推迟三正交视图)

- **Status:** Accepted
- **Date:** 2026-06-03(实际决策发生于 v0.13.3 阶段)
- **Deciders:** core team
- **Supersedes:** —

## Context

v0.13.2 把点云查看器做成只读;v0.13.3 要让用户**画 / 选 / 编辑 3D 框**(`Box3DGeometry`,7-DoF:center + size + yaw)。3D 框编辑的交互形态有两条成熟路线,工作量与体验差异很大,需要先定方向,免得在错误的地基上堆代码。

承双画布架构(ADR-0031):3D 走裸 Three.js 命令式编辑器(`PointCloudScene`),与 2D Konva 栈隔离。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A:主视图 gizmo + 数值面板** | 官方 `TransformControls` 开箱即用;配数值面板足够精确;工作量小,能在本切片落地 | 透视视图里纯拖拽不够精准(靠数值面板兜底) |
| 方案 B:SUSTechPOINTS 式三正交视图 | 体验最好,俯/侧/正视图边线 + 方向线拖拽,精修最准 | 工作量极大(`side_view_op.js` ~1100 行 + `box_editor.js` ~1800 行的单框版),一个切片吞不下 |

## Decision

**v0.13.3 采用方案 A;方案 B 列为独立后续切片,建在 A 之上。**

### A 的落地约束

- **gizmo**:官方 `TransformControls`(three addon,非 r3f),三模式 W 平移 / E 绕 Z 转 / R 缩放,`setSpace("local")` 在框自身轴系编辑;旋转模式只放开 Z(yaw,7-DoF)。**不自写 8 角点 handle** —— 精修活儿留给 B 的三视图,主视图 gizmo 保持轻。
- **数值面板**:PSR 精确数值(center / size / yaw)输入,与 gizmo 经**选中框 PSR 单一真值**双向同步。
- **放置**:点地面射线落点(`z=groundZ` 水平面,`groundZ` 取 z 直方图低分位)+ 默认尺寸框,再用面板 / gizmo 精修。透视拖拽不准,故不做"拖画足迹"。
- **数据层为 B 预留**:选中框 PSR 同时驱动 gizmo / 数值面板,并预留同一驱动入口;PSR↔8 角点纯函数(`three-d/geometry/box3d.ts`,移植 SUSTechPOINTS 矩阵 + 单测)抽离,B 的三视图与 v0.13.4 投影复用同一套。

### A 不是一次性投入,B 建在 A 之上

SUSTechPOINTS / xtreme1 里主 3D 视图(导航 / 放置 / 选中)与三视图(精修)并存:主视图建 / 选框,三视图是"选中框的聚焦精修面板"。迁到 B = 在 A 上**加一个三视图面板**,A 的 PSR 纯函数 / 框数据模型 / 主视图放置选中 / 类别属性持久化全部复用,数据层零改。

## Consequences

正向:

- 工作量可控,3D 框标注在 v0.13.3 一个切片内落地(`apps/web/src/pages/Workbench/stages/three-d/`),后端零改动。
- 数值面板把"透视拖拽不准"这一核心风险兜住:精度不依赖手感。
- 纯函数 + 单一真值的数据层让 B(三视图)、v0.13.4(投影)增量接入,不重构。

负向:

- 主视图透视下纯 gizmo 拖拽的精度体验不如三正交视图,标注员需要配合数值面板 / 后续 BEV 视角。
- 在 B 落地前,复杂遮挡场景的精修效率受限。

## Alternatives Considered(详)

**方案 B(三正交视图)直接做**:体验最佳,但单框版即 ~2900 行移植量,远超一个切片的预算,且会在尚未验证数据层约定(PSR↔角点、欧拉角顺序)前就堆重交互。决定先用 A 验证数据层与端到端持久化,B 作为 A 之上的独立切片,风险更可控。

## Notes

- 实现代码:`apps/web/src/pages/Workbench/stages/three-d/`(`PointCloudScene.ts` 渲染 / 拾取 / gizmo / 放置;`ThreeDWorkbench.tsx` 面板 / 放置 / 持久化接线;`geometry/box3d.ts` + `.test.ts` PSR 纯函数)。
- 后端:无改动、无迁移;`box_3d` / `lidar_box_3d` 链路在 v0.13.0 已备好。测试 `apps/api/tests/test_pointcloud_box3d_annotation.py`。
- 相关 ADR / 计划:ADR-0031(双画布)、ADR-0026(tool-unit 类别/属性绑定)、ADR-0030(标定存储)、`docs/plans/2026-06-02-v0.13.3-pointcloud-3d-box-annotation.md`。
- 后续:方案 B(三正交视图精修)与 v0.13.4(标定驱动 3D→2D 投影联动、`group_id` 跨模态聚合)。
