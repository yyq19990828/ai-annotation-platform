# 0024 — AAP JSON v1.0 平台原生无损中间格式

- **Status:** Accepted
- **Date:** 2026-05-19
- **Deciders:** core team
- **Supersedes:** —

## Context

平台当前支持 COCO / YOLO / VOC 三种导出格式（`ExportService` in `apps/api/app/services/export.py`），但这些格式都是**有损**的：丢失 `attribute_schema` 值、prediction 的 confidence / model_version、annotation 的 source / lead_time、project 的 `annotation_guide` 与 `classes_config`、视频 keyframe 的 source 标记等。

ROADMAP §A 列出的关键缺口：

1. **Predictions Import 端点**：客户自家训好的模型 / 不愿托管在平台 backend 的场景（学术、初创、合规）无法把外部模型结果灌进来做"AI 预标 → 人工修正 → 导出"工作流。
2. **跨实例迁移 / SDK / Plugin / dataset snapshot 锚点**：缺一个稳定的无损序列化形态。

取经合集 §6 "决策底线" 也列了几个 CVAT / Label Studio 踩过的反模式（DSL 配置、type 字段混用 annotations/predictions、内部 ID 跨实例匹配），新格式需要主动避坑。

## Decision

新增 **AAP JSON v1.0** 作为平台原生无损中间格式，与 COCO / YOLO / VOC 并列接入到现有导出端点；同时新增 `POST /projects/{id}/predictions/import` 端点同时接受 COCO 与 AAP JSON。

### Schema 关键决策

1. **`schema_version` 必备** + breaking change 升 major。`apps/api/app/schemas/aap_json.py:check_schema_major` 在导入时显式拒绝 `major > 1`，避免静默吃下未知 breaking change。
2. **`annotations[]` 和 `predictions[]` 分开两个数组**，不混 type 字段。CVAT 部分格式用 `type: "manual" | "prediction"` 区分混在同一数组里，导致下游消费者要先 filter 才能用；AAP JSON 永远双数组，消费者按数组取即可。
3. **导出严格写满 null，导入 lenient 忽略未知**：导出端 `model_dump_json(exclude_none=False)`；导入端 pydantic `model_config = ConfigDict(extra="ignore")`。这样客户手工编辑漏字段 / 多字段都不会让整批挂。
4. **`geometry` 使用平台内部格式**（`{type: bbox|polygon|multi_polygon, ...}`，与 `annotation.geometry` JSONB 对齐），**不**走 LabelStudio shape 的 `{type: rectanglelabels, value: {x, y, width, height, rectanglelabels: [...]}}` 嵌套。LS shape 只在 `predictions.result` 列内部存储（与 ML backend 协议同源），AAP JSON 层抽象掉这层细节。
5. **`task_match` 是 oneof**：`display_id`（全局唯一）优先，`file_path`（项目内）fallback；导入时跨项目 `display_id` 命中视为不匹配（防偷换项目），fallback 走 `file_path`。

### 端点契约

- `GET /projects/{id}/export?format=aap_json`：项目级导出。
- `GET /projects/{id}/batches/{bid}/export?format=aap_json`：批次级导出（`exported_from.batch_display_id` 填充）。
- `POST /projects/{id}/predictions/import?format=aap_json|coco&dry_run=true|false`：multipart/form-data；`overwrite_existing=true` 时按 task 维度替换 `source='external_import'` 的旧 prediction；权限 = project owner / super_admin。

### 数据库变更

- alembic 0069：`predictions.source` String(20) NOT NULL DEFAULT `'ml_backend'` + 索引。老数据按默认值回填（当前唯一出口是 ML backend，含义准确）。外部导入行 `source='external_import'`，`ml_backend_id=NULL`。

### 不在范围内（留后续 epic）

- **annotations import 端点**：AAP JSON `annotations[]` 字段在导出端写满，导入端 v0.10.15 只警告日志不入库（涉及 batch / owner / audit 协议复杂度，单列下一版做）。
- **Task 表加 `external_id` 字段**：跨实例匹配本期用 `display_id` + `file_path` 两元组够；external_id 留 v0.11+ 单列 epic。
- **ProjectTemplate 进 AAP JSON manifest**：与 [[ADR-0023]] 模板 epic 触发条件挂钩，本期只约定 manifest schema 预留位（envelope 末层 `template?: AAPProjectTemplateBlock` 留前向扩展窗口）。
- **datumaro 链转换**：其它非平台格式走 datumaro 中转，本期不引入。

## Consequences

正向：

- 客户能直接把外部模型结果导入平台做 AI 预标流程，降低准入门槛（学术 / 初创 / 合规客户尤其受益）。
- AAP JSON 作为跨实例迁移锚点，为后续 §3.1 公开 SDK / §3.4 Plugin / §2.5 项目快照 / dataset snapshot 铺路 —— schema 一次性定型，避免后续二次破窗。
- `predictions.source` 字段为 admin failed-predictions / Annotator Performance Dashboard 提供"按来源筛"能力。
- `geometry` 内部格式统一让 AAP JSON 与未来 SDK / Plugin 协议同源，不必维护 LabelStudio shape 与内部 shape 两套适配器。

负向 / 已知风险：

- 多一种格式 = 多一套维护成本；通过把读路径放在 ExportService 单点、写路径放在 `predictions_import.py` 单点收口最小化。
- AAP JSON v1.0 是平台私有格式，跨工具兼容性不如 COCO；目标场景是平台间迁移 / 客户自家模型导入，不替代 COCO。
- `predictions.source` 老数据回填为 `ml_backend` 是基于"当前唯一出口"的假设；如果未来发现有别的写入路径（直接 SQL / 历史脚本），需要单独迁移。

## Implementation Anchor

- 后端 schema: `apps/api/app/schemas/aap_json.py`
- 后端导出: `apps/api/app/services/export.py:export_aap_json`
- 后端导入: `apps/api/app/services/predictions_import.py`
- 后端 task 匹配: `apps/api/app/services/task_matcher.py`
- 后端端点: `apps/api/app/api/v1/predictions.py:import_predictions`
- 前端导入向导: `apps/web/src/components/predictions/PredictionImportWizard.tsx`
- 前端导出选项: `apps/web/src/pages/Dashboard/ExportSection.tsx`
- 后端测试: `apps/api/tests/test_predictions_import.py` + `tests/test_export_aap_json.py`
- 前端测试: `apps/web/src/components/predictions/PredictionImportWizard.test.tsx`
