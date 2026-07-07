# 0031 — 双画布架构:Konva 2D / Three.js 3D 双栈并存

- **Status:** Accepted
- **Date:** 2026-06-02
- **Deciders:** core team
- **Supersedes:** —

## Context

工作台原本只有 Konva 2D 画布(图像 / 视频)。点云联合标注需要 3D 渲染(WebGL),Konva 不胜任。要在不破坏成熟 2D 工作台的前提下接入 3D。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **方案 A:Three.js 独立模块 + 裸封装,与 Konva 双栈并存** | 2D 零改动;命令式交互编辑器更顺 | 两套渲染栈各自维护 |
| 方案 B:react-three-fiber(声明式 R3F) | React 心智统一 | 命令式编辑(拖拽 8 角点 / 实时投影)绕 R3F reconciler 别扭;调研 §14.10.4 反面 |
| 方案 C:统一到一个渲染抽象层 | 理论优雅 | 过度抽象;2D/3D 交互模型差异大,强行统一得不偿失 |

## Decision

采用**方案 A**:Three.js **裸 + React 薄封装**,作为与 Konva 平行的独立画布栈。

落地约束:

1. **分流接缝**:`useWorkbenchShellModel` 按 `project.type_key === "lidar"` 派生 `stageKind="3d"`;`WorkbenchStageHost` 三路 switch(`image` / `video` / `3d`)。
2. **模块隔离**:3D 代码独立目录 `src/pages/Workbench/stages/three-d/`,**不污染** Konva `stage/`。命令式场景封装 `PointCloudScene.ts`(renderer/camera/controls/dispose 生命周期),React 组件只持实例。
3. **不用 react-three-fiber**:3D 是命令式编辑器(后续拖拽角点 / 投影),裸 Three.js 更直接(epic §14.10.4 决策)。
4. **lazy 加载**:three(~500KB)经 `React.lazy` + 独立 `vendor-three` chunk,只在打开 lidar 任务时加载,**不进主 bundle**、不拖累 2D 工作台首屏(实测主 bundle 不含 three)。
5. **数据契约**:3D 舞台经 `GET /tasks/{id}/point-cloud/manifest` 拿主点云 URL + 各相机图 + 标定;`task.file_url` 已直出主点云(v0.13.1)。

## Consequences

正向:
- 现有 Konva 2D / 视频工作台**零改动**;3D 模块可独立演进(v0.13.3 框标注 / v0.13.4 投影)。
- bundle 隔离:2D 用户不付 three 的体积代价。
- 命令式封装贴合 3D 编辑交互,避免 R3F reconciler 的别扭。

负向:
- 两套渲染栈(Konva / Three.js)各自维护,跨栈共享(选中态 / 类别色)需在 shell 层显式桥接。
- WebGL 资源生命周期需手动 `dispose`(切任务 / 卸载),封装层收口,漏了会泄漏。

## Notes
- 实现:`apps/web/src/pages/Workbench/stages/three-d/`(`PointCloudScene.ts` / `ThreeDWorkbench.tsx` / `usePointCloudManifest.ts`)、`WorkbenchStageHost.tsx`(lazy + Suspense)、`vite.config.ts`(`vendor-three` chunk)
- 后端契约:`GET /tasks/{id}/point-cloud/manifest`(`api/v1/tasks.py`)
- 相关:ADR-0029(多文件关联)、ADR-0030(标定存储)、调研 §14.10.4(裸 Three.js / 双栈决策)
- 后续:v0.13.3 3D 框标注(`Box3DGeometry` 编辑)、v0.13.4 标定驱动投影联动
