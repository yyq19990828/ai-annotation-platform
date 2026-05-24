# 0028 — annotations[] 导入语义（归属 / 来源 / 冲突 / 审计 / 状态机）

- **Status:** Accepted
- **Date:** 2026-05-24
- **Deciders:** core team（yyq19990828 + Claude）
- **Supersedes:** —

> **实现状态（2026-05-24）**：本 ADR 的语义已在 v0.10.54 **后端完整落地**（service / 端点 / 审计 / 测试）。**前端入口暂不暴露**——由 `ANNOTATIONS_IMPORT_ENABLED`（`apps/web/src/components/predictions/PredictionImportWizard.tsx`）控制，当前为 `false`：⋮ 菜单无「导入标注」、向导无「导入对象」切换。端点 `POST /projects/{id}/annotations/import` 仍可经 API 直接调用。翻 flag 为 `true` 即恢复 UI 入口。

## Context

AAP JSON envelope 是双数组 `annotations[]` / `predictions[]`。`predictions[]` 自 v0.10.15 起可导入（`source='external_import'` 落 `predictions` 表），但 `annotations[]` 至今**只导出、导入端仅警告日志后跳过**（[predictions_import.py:211](../../apps/api/app/services/predictions_import.py#L211)）。这使「导出 → 迁移 → 导入」只能重建预测，无法重建**人工标注**——跨实例完整复制的最后缺口（ROADMAP 第71行）。

geometry 适配不是难点（与预测导入共享 `internal_geometry_to_ls_shape` / `to_internal_shape`，v0.10.52/53 已铺好 bbox/polygon/rotated_bbox/polyline）。难点在**元数据归属与一致性语义**：annotation 是人工事实，牵涉用户归属、来源统计、与既有标注冲突、审计链、以及标注创建对 task/batch 状态机的副作用。这些不先定清就动代码会埋债。

关键既有事实（决策依据）：

- `Annotation.user_id` 是 **FK→users**（nullable，[annotation.py:30](../../apps/api/app/db/models/annotation.py#L30)）——源实例 UUID 在目标实例无对应行,硬塞会违反 FK 或造幽灵用户。
- `Annotation.source` 是 `String(20)`，现有值 `manual` / `prediction_based`；`create()` 按有无 `parent_prediction_id` 自动定（[annotation.py:131](../../apps/api/app/services/annotation.py#L131)）。
- `Annotation.parent_prediction_id` **无 FK**（软引用，[annotation.py:43-45](../../apps/api/app/db/models/annotation.py#L43)）。
- **状态机联动点 = `_update_task_stats`**（[annotation.py:941](../../apps/api/app/services/annotation.py#L941)）：创建标注会更新 `total_annotations` / `is_labeled`、把 task `pending → in_progress`、并触发 **batch 自动流转 + 计数重算**。
- `Annotation` 表**无 `external_id` 列**；AAP entry 有 `external_id`（forward-compat）→ 按 external_id upsert 需加列 + 唯一约束（DDL）。
- `AAPAnnotationEntry` 实际携带：`geometry / class_name / tool_unit_id / attributes / confidence / source / user_id / created_at / external_id`（[aap_json.py:53](../../apps/api/app/schemas/aap_json.py#L53)）——**不含 was_cancelled / lead_time**。

## Decision

新增 annotations 导入能力，按以下 6 点语义实现：

### D1 · user_id 归属 — 归当前操作者
导入的 annotation `user_id` = **当前导入操作者**（`current_user`）。源 entry 的 `user_id` 不写入 FK 列，转存 `attributes._imported_user_id`（字符串）作溯源。不信任、不插入外来 UUID。

### D2 · source 语义 — 保留原始 + 溯源标记
**保留 entry 原始 `source`**（`manual` / `prediction_based`，落库前校验在允许集合内；缺失默认 `manual`），并在 `attributes._imported = true` 标记导入来源。统计/查询既能区分人工 vs 预测来源（符合 AAP 无损精神），又能识别"是导入来的"。

### D3 · 冲突 / 去重 — append 默认 + 显式 overwrite
默认 **append**（只新增，绝不动现有标注，包括人工标注）。提供显式 `overwrite` 模式：导入前**只 purge 该 task 下 `attributes._imported = true` 的标注**（镜像预测导入的按来源清理），**绝不碰非导入的人工标注**。**不做** external_id upsert（需 DDL，本期非目标，留待后续）。

### D4 · 审计 — 汇总一条
新增审计动作 `ANNOTATION_IMPORT`（[audit.py](../../apps/api/app/services/audit.py)）。**每次导入记一条汇总**（imported / skipped 计数 + 操作者 + task 范围 + overwrite 标志），不逐条刷审计。

### D5 · 过程元数据 — 只导 envelope 携带字段
只落 envelope 实际携带的字段：`geometry / class_name / tool_unit_id / attributes / confidence / source`。`was_cancelled = False`、`lead_time = null`（本就不在 envelope）。`created_at`：若 entry 提供则**保留原值**作溯源,否则走 `server_default now()`。`ground_truth` 默认 False（如需 ground_truth 导入另议）。

### D6 · 状态机联动 — 计数+状态翻，抑制 batch 自动流转
导入结束后**按受影响 task 批量**更新 `total_annotations` / `is_labeled`、`pending → in_progress`（dashboard 进度准确），但**抑制 `batch.check_auto_transitions`**（防批量导入把整个 batch 意外推进到下一态）。计数重算每个受影响 batch 末尾跑一次,不在逐条插入时触发。

### 端点形态
独立端点 `POST /projects/{project_id}/annotations/import`（与预测导入分开：权限/审计/响应语义不同）。入参对齐预测导入：`file`(multipart) + `format=aap_json`（COCO/YOLO 的 annotations 导入后续再议）+ `dry_run` + `overwrite`。权限 `require_project_owner`。复用 `resolve_task` 做 task 匹配、`AAPImportResult` 做响应（imported/skipped/errors[]/dry_run）。

## Consequences

正向：
- 闭环「跨实例完整重建标注」（ROADMAP 第71行）。
- 默认 append + 按 `_imported` 标记的 overwrite，**永不破坏人工标注**——借力 `parent_prediction_id` 无 FK 的解耦事实，destructive 风险被限制在"导入来的"子集。
- 保留原始 source + 溯源标记，统计可解释；审计汇总不刷屏。
- 抑制 batch 自动流转,避免批量导入的意外副作用。

负向：
- `_imported` / `_imported_user_id` 写在 `attributes` JSONB 里（非一等列），按它查询/清理需 JSONB 谓词,大表上无专门索引（量大时再议加表达式索引）。
- 不做 external_id upsert → 同一文件重复导入（append 模式）会产生重复标注；需用户用 overwrite 模式或自行去重（可接受,与"暴力 overwrite"阶段性取向一致）。
- 保留 `created_at` 原值意味着导入行的时间戳非本地导入时刻,排序/审计阅读时需意识到。

## Alternatives Considered（详）

**D2 统一成 `imported` 单一桶**：统计简单，但丢失 manual vs prediction_based 区分，违背 AAP 无损精神。否。

**D3 skip-if-exists**：task 已有任何标注就整体跳过——太粗，无法增量补标。否。

**D3 external_id upsert**：最干净的幂等，但需给 `annotations` 表加 `external_id` 列 + 唯一约束（DDL + 迁移），且要定义 external_id 的跨实例稳定性契约。成本超出本期，留作后续演进触发项。

**D6 完全静默**：零副作用，但 dashboard/计数不准,用户导入后看不到进度,体验差。否。
**D6 完全联动**：语义最一致，但批量导入触发 batch 自动流转可能自动完成批次,是意外的破坏性副作用。否。

## Notes

- 实现版本：v0.10.54（计划 [2026-05-24-v0.10.54-annotations-import.md](../plans/2026-05-24-v0.10.54-annotations-import.md)）。
- 实现代码位置（预期）：`apps/api/app/services/annotations_import.py`（或并入 `predictions_import.py`）、`apps/api/app/api/v1/`（新端点）、`apps/web/src/components/predictions/PredictionImportWizard.tsx`（增"导入对象：预测/标注"或独立向导）。
- 相关 ADR：[ADR-0024 AAP JSON 格式](0024-aap-json-format.md)、[ADR-0006 predictions 分区](0006-predictions-partition-by-month.md)（parent_prediction_id 降级软引用的由来）、[ADR-0026 tool-unit 类别绑定](0026-tool-unit-class-and-attribute-binding.md)（class_name 软校验）。
- 后续触发项：external_id upsert（需 DDL）、COCO/YOLO 的 annotations 导入、ground_truth 导入语义、`_imported` 查询的表达式索引。
