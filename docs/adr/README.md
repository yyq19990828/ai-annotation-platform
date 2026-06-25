# Architecture Decision Records

本目录记录关键架构决策，采用 [Michael Nygard 模板](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)。

## 何时写一份 ADR

满足以下任一即应写：

- 选了一个会影响后续 6 个月以上代码结构的方案
- 在两个以上方案间纠结，最终选了不那么显然的一个
- 引入了新的核心库 / 框架
- 改了某个跨多模块的约定（命名、层次、契约）

## 何时**不**写

- 单个 bug 修复 → CHANGELOG 即可
- 临时方案、技术债 → 在代码里加 TODO + issue 链接
- 可被 git log 解释清楚的小重构

## 命名

`NNNN-short-kebab-title.md`，编号自增，**不**复用、**不**删除。

如果决策被推翻，新建一份 ADR，把旧的状态改为 `Superseded by ADR-XXXX`，但**保留旧文档**。

## 模板

见 [`TEMPLATE.md`](TEMPLATE.md)。复制为 `NNNN-short-kebab-title.md`，填入元数据与各章节即可。

规范化要点（所有 ADR 应满足）：

- 标题：`# NNNN — 简短中文标题`（em-dash，不写 `ADR-NNNN:` 前缀）
- 元数据块（紧跟标题，列表形式）：`Status` / `Date` / `Deciders` / `Supersedes` 四项必填
- 章节顺序：`Context` → `Decision` → `Consequences`（正向 / 负向）→ `Alternatives Considered`（可选）→ `Notes`（可选）
- 引用代码：`path/to/file.py:NN`，便于跳转

## 索引

- [0001](0001-record-architecture-decisions.md) — Record architecture decisions
- [0002](0002-backend-stack-fastapi-sqlalchemy-alembic.md) — 后端选型：FastAPI + SQLAlchemy 2.0 async + Alembic
- [0003](0003-openapi-client-codegen.md) — 前端 OpenAPI 客户端生成方案：@hey-api/openapi-ts
- [0004](0004-canvas-stack-konva.md) — 标注画布引擎：Konva（4 Layer 架构）
- [0005](0005-task-lock-and-review-matrix.md) — 任务锁（5min TTL）与审核流转角色矩阵
- [0006](0006-predictions-partition-by-month.md) — predictions 表按月 RANGE 分区
- [0007](0007-audit-log-partitioning.md) — 审计日志月分区
- [0008](0008-batch-admin-locked-status.md) — 批次 admin-locked 字段（与状态机正交）
- [0009](0009-task-events-table-and-partition.md) — task_events 表与按月分区方案
- [0010](0010-security-headers-middleware.md) — Production Security Headers Middleware
- [0011](0011-websocket-token-reauth.md) — WebSocket 鉴权过期重连
- [0012](0012-sam-backend-as-independent-gpu-service.md) — SAM 系列 backend 独立 GPU 服务化
- [0013](0013-mask-to-polygon-server-side.md) — mask→polygon 转换在 ML backend 端做
- [0014](0014-prediction-jobs-table.md) — Prediction Jobs 历史表与 Worker 三时点写入
- [0015](0015-ml-backend-url-validation.md) — ML Backend URL 验证：拒绝 loopback
- [0016](0016-docs-ia-redesign.md) — 文档 IA 重构：Diátaxis 框架 + audience 元数据
- [0017](0017-workbench-shell-mode-and-stage-adapters.md) — 工作台 Shell 采用 Mode Hooks 与 Stage Adapters
- [0018](0018-video-frame-service-segments-and-tracker-boundary.md) — 视频帧服务 Segment 与 Tracker 边界
- [0019](0019-prompt-first-tooldock-1n-arch.md) — ToolDock prompt-first 1:n 架构
- [0020](0020-ml-backend-capability-negotiation.md) — ML Backend capability 协商
- [0021](0021-polygon-lod-and-spatial-index.md) — 多边形 LOD 与空间索引
- [0022](0022-mask-editor-tool-architecture.md) — Mask 编辑器工具架构
- [0023](0023-project-template-vs-clone.md) — 项目模板 vs 克隆策略
- [0024](0024-aap-json-format.md) — AAP JSON v1.0 平台原生格式
- [0025](0025-webhook-event-envelope-versioning.md) — Webhook 事件信封与版本化（草案，未实现）
- [0026](0026-tool-unit-class-and-attribute-binding.md) — 类别与属性按工具单位 (tool_unit) 强隔离绑定
- [0027](0027-annotation-feedback-unified-table.md) — AnnotationFeedback 统一反馈表(三段式迁移)
- [0028](0028-annotations-import-semantics.md) — 标注导入语义
- [0029](0029-task-dataset-item-multi-link.md) — 点云任务-数据项多文件关联中间表（保留 2D 1:1）
- [0030](0030-sensor-calibration-in-dataset-item-metadata.md) — 相机标定存进 DatasetItem.metadata_（不加列）
- [0031](0031-dual-canvas-konva-three.md) — 双画布架构：Konva 2D / Three.js 3D 双栈并存
- [0032](0032-3d-box-editing-main-view-gizmo.md) — 3D 框编辑交互形态：主视图 gizmo + 数值面板（推迟三正交视图）
- [0033](0033-3d-to-2d-projection-overlay.md) — 3D→2D 投影联动：实时纯函数投影 + canvas overlay（不预存）
- [0034](0034-lidar-axis-convention.md) — 点云数据集 lidar 坐标系约定：dataset 级声明 + 加载侧归一化
- [0035](0035-scene-and-frame-foundation.md) — Scene + frame_index 跨 task 时序帧序列地基
- [0036](0036-ml-backend-capability-protocol-v2-multi-model.md) — ML Backend 能力声明协议 v2（多模型目录 + infra）
- [0037](0037-protocol-capability-catalog-decoupling.md) — 协议能力目录与 backend 注册解耦
- [0038](0038-defer-ml-backend-base-class.md) — ML backend 基类抽象推迟到 N≥4
- [0039](0039-protocol-field-name-unification.md) — Protocol field name unification with model_variants
- [0040](0040-shared-annotation-visual-spec-not-stack-merge.md) — 标注视觉:统一参数规格(共享 annotationVisual.ts),不合并图片/视频渲染栈
- [0041](0041-video-canvas-unify-to-konva.md) — 视频渲染栈统一到 Konva(帧合成 / 坐标模型 / 测试基建)
- [0042](0042-tailwind-shadcn-design-system.md) — 前端样式体系迁移到 Tailwind v4 + shadcn/ui
- [0043](0043-staged-preannotation-pipeline.md) — 多阶段预标注编排（路径 B：平台层跨 backend pipeline）
- [0044](0044-global-ml-backend-registry-and-project-enablement.md) — ML Backend 全局注册表 + 项目级启用（解耦能力声明与项目绑定）
