# Epic — 图片工作台 Wave β + γ 关键能力收口（v0.10.4 ~ v0.10.7）

> 跨多个子版本，无单一 v-prefix。子计划见下方表格。
> 对应 roadmap：[ROADMAP/[archived]2026-05-12-image-workbench-optimization.md](../../ROADMAP/[archived]2026-05-12-image-workbench-optimization.md)（Wave β + Wave γ 中 I11/I13/I15）。

## Context

`ROADMAP/[archived]2026-05-12-image-workbench-optimization.md` 写于 v0.9.40 时点（2026-05-12），之后落地 v0.9.41（Wave α）与 v0.10.0-v0.10.3（SAM 3 接入 / Capability 协商 / Prompt-first ToolDock / 1:N 后端管理 UI）。Wave β（必做：I1 大图 tile + I2 polygon LOD + I6 SAM 缓存）与 Wave γ 关键能力（I11 Mask 编辑器 / I13 Attribute 进阶 / I15 z_order 等元数据一等态）一直没动。本 epic 把它们收口到 v0.10.4-v0.10.7 四个子版本，沿用 v0.10.0-0.10.3 的 M-letter 节奏。

## 范围与子版本拆分

| 子版本 | 范围 | 计划文件 | 状态 |
|---|---|---|---|
| **v0.10.4 (M4-α)** | I2 polygon LOD/命中/差量 + I6.1 前端 SAM mask cache + I6.2 embed 预热 | [2026-05-14-v0.10.4-polygon-lod-sam-cache.md](2026-05-14-v0.10.4-polygon-lod-sam-cache.md) | ✅ 已发布 ([c8f918b](#)) |
| **v0.10.5 (M4-β)** | I15 z_order / lock / hidden / occluded 字段一等态 + UI + 快捷键 | [2026-05-15-v0.10.5-shape-metadata.md](2026-05-15-v0.10.5-shape-metadata.md) | ✅ 已发布 ([41b69be](#)) |
| **v0.10.6 (M4-γ)** | I13 Attribute mutable/immutable + useDirtyTracker 首次消费（VideoTrackPanel 表格留到 v0.10.7） | [2026-05-15-v0.10.6-attribute-mutability.md](2026-05-15-v0.10.6-attribute-mutability.md) | ✅ 已发布 |
| **v0.10.7 (M4-δ)** | I11 Mask 编辑器 v1 **算法核**（MaskBuffer + maskToPolygon + ADR-0021/0022；UI 集成留 v0.10.7.1 / v0.11.0） | [2026-05-15-v0.10.7-mask-editor-v1.md](2026-05-15-v0.10.7-mask-editor-v1.md) | ✅ 算法核已发布 |
| **v0.10.8 (M4-ε，可选)** | I1 大图 tile 金字塔 | — 推迟到 **v0.11.0 独立 epic**（后端切片 worker 重） | ⏭ 不在本 epic |

## 已完成的 roadmap 校准

epic 启动时同步落地 [`docs(roadmap): 校准 image-workbench-optimization 与现状对齐`](#) 提交：把 I20 / I13 / I14 / I15 / I16 / I2 / I6 的描述更新为 v0.9.41+v0.10.3 时点的现状，Wave β/γ 表标记子版本归属。后续不再重复校准动作。

## 跨 sub-milestone 收尾（v0.10.7 已完成）

- ✅ CHANGELOG.md v0.10.4 / 5 / 6 / 7 段落均落到顶（沿用 v0.10.x 节奏）；
- ✅ v0.10.7 commit 把 ROADMAP Wave β / γ I2 / I6 / I15 / I13 / I11 全部 ✅（I11 状态拆为「算法核 ✅ / UI 集成待 v0.10.7.1」）；
- ✅ 新增 ADR：[0021-polygon-lod-and-spatial-index.md](../adr/0021-polygon-lod-and-spatial-index.md)（I2 决策回填）+ [0022-mask-editor-tool-architecture.md](../adr/0022-mask-editor-tool-architecture.md)（I11 决策）；
- ⏭ 完整 e2e 推迟到 v0.10.7.1 UI 集成时一并跑。

## 后继版本（不在本 epic）

- **v0.10.7.1 / v0.11.0**：MaskTool Konva 组件 + ToolDock 入口 + AIPredictionPopover「精修」+ B/E/Shift+滚轮/Esc/Enter 笔刷 hotkey；带完整 e2e。
- **v0.11+**：I1 大图 tile 金字塔 + I9 Ellipse / I10 Skeleton / I11 v2 RLE schema 一并做 geometry.kind 统一收口。

## 节奏建议（不写进交付物，仅供安排）

- **第 1-2 周（已过）**：v0.10.4 M4-α，roadmap 校准并入。
- **第 3 周（已过）**：v0.10.5 M4-β。
- **第 4-5 周**：v0.10.6 M4-γ。
- **第 6-8 周**：v0.10.7 M4-δ。
- I1 大图 tile → v0.11.0 独立 epic。
