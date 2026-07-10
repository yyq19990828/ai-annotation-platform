# 0026 — 类别与属性按工具单位 (tool_unit) 强隔离绑定

- **Status:** Accepted (amended)
- **Date:** 2026-05-19
- **Deciders:** core team
- **Supersedes:** —

> **更新 (v0.10.22):** 完成派生列删除。`projects` / `project_templates` 的旧扁平列 `classes` / `classes_config` / `attribute_schema` 已 drop (migration 0078),写时双写 helper `apply_tool_bindings_legacy_sync` 移除 —— 至此 `tool_bindings` 是**唯一存储真值**,存储侧不再有第二份会漂移的数据。旧 `derive_legacy_*` 改名 `derive_*`,降级为**读时派生投影**(响应序列化 / COCO·YOLO·AAP 导出按需从 `tool_bindings` 拍平)。`ProjectOut` / `ProjectTemplateOut` 仍暴露三个扁平字段以兼容前端众多读端,但其值由 `model_validator` 从 `tool_bindings` 派生,非独立存储。旧客户端 / 旧 AAP JSON 的扁平**输入**仍由 `coalesce_legacy_into_tool_bindings` 反向折叠进 `tool_bindings`(保留输入兼容)。

> **修订 (2026-07-09):** `ai_interactive` 被确认是能力维度而非几何工具单位，现已从 `ToolUnitId` 退役。smart-point / smart-box / exemplar 的多边形归 `region`，Magic Box 的矩形框归 `bbox`；能否使用交互式 AI 由项目级 `ai_interactive_enabled` 控制。迁移 0115/0116 把存量 annotation / prediction 与项目 / 模板 binding 按几何归位，遗留客户端输入也在 schema 边界映射，不再写回退役值。本修订不改变“真实几何工具单位之间类别强隔离”的原决策。

## Context

v0.10.16 之前,项目的类别 (`classes` + `classes_config`) 与属性 schema (`attribute_schema`) 是**项目级扁平**字段,所有工具共享同一份:bbox 工具下拉里看到的类、polygon 工具下拉里看到的类、AI 交互工具的类必须完全一致。客户反馈的现实场景需要更细颗粒度:

> "我希望 bbox 工具标行人/车辆,polygon 工具标可行驶区/天空,AI 交互工具又有自己的类。一张大表混着塞不下,且现在的'类型' (image-det / image-seg) 枚举太死,新场景每来一次就要加 type_key。"

同期还有两条需求叠加:

- 新建项目向导的 type 枚举从 7 种(image-det / image-seg / image-kp / video-mm / video-track / mm / lidar)收敛 — 实际只有 image / video / lidar 三种数据载体,具体能做什么由"工具集"决定。
- TemplateEditModal 后端 schema 已支持 `classes_config / attribute_schema / rendering_config`,前端 Modal 没暴露;若工具维度生效,模板也得按工具单位携带。

| 选项 | 主要卖点 | 主要劣势 |
|---|---|---|
| **A: 工具独占类别 (强隔离)** | 不同工具的同名类是两条独立记录;可同名不同色;调色板 / 属性面板 / 导出 categories 都按工具单位天然分组 | bbox 与 polygon 同时想用「人」类要重复输入;客户跨工具复用类的场景需手工同步 |
| B: 工具选择类别子集 | 项目仍有一份扁平类别池,每工具勾选可用子集;复用方便 | UI 复杂度从「写一份」变成「写一份+按工具勾选」;后端导出仍需按工具分组,服务层逻辑跨字段 |
| C: 类别共享 + 属性绑定工具 | 类别保持项目级,只把 attribute_schema 按工具拆分 | "同一目标用不同工具时填不同属性"是少数场景;类别下拉无变化 → 客户原始诉求未解决 |

## Decision

**采用方案 A: 工具独占类别 (强隔离)**。每个被启用的工具单位 (`tool_unit_id`) 独立持有 `classes + attribute_schema`,bbox 工具的「人」与 region 工具的「人」是两条独立记录。

**工具单位枚举** (与后端 `app/schemas/_jsonb_types.ToolUnitId` Literal 严格对齐):

> **更新 (2026-07):** 枚举随 polyline / rotated_bbox / keypoint / point_mask_3d 落地扩展，并移除不产出独有几何的 `ai_interactive`。下表对齐当前 Literal。

| tool_unit_id | 包含工具 (Workbench ToolId) | type 限制 |
|---|---|---|
| `bbox` | BboxTool；Magic Box 产物 | image, video |
| `polyline` | PolylineTool | image, video |
| `region` | PolygonTool + MaskTool；smart-point / smart-box / exemplar 的多边形产物 | image, video |
| `lidar_box_3d` | Lidar3DBoxTool | lidar |
| `rotated_bbox` | RotatedBboxTool | image |
| `keypoint` | KeypointTool | image |
| `point_mask_3d` | PointMask3DTool | lidar |

**实施要点**

- 新增 `Project.tool_bindings: JSONB`,形状 `{ tool_unit_id: { enabled, classes: [...], attribute_schema: {...} } }`。
- `Annotation.tool_unit_id` / `Prediction.tool_unit_id` 列必填,默认 `bbox`;alembic 0072 按 `annotation_type` (polygon/mask → region) 反向 backfill。
- 旧 `Project.classes_config` 与 `attribute_schema` **保留为派生只读字段**,运行期由 `app/services/project.py` 的 `apply_tool_bindings_legacy_sync` 同步双写:
  - 写 tool_bindings → 派生覆盖 legacy
  - 旧客户端只写 legacy → `coalesce_legacy_into_tool_bindings` 按 type_key 反推到对应 unit
  - 单源真值 = tool_bindings;legacy 字段在 v0.10.18 删除。
- COCO 导出 categories 按 tool_unit 分组,带 `supercategory = tool_unit_id`;`cat_map` 改为 `(tool_unit_id, class_name) → category_id`。
- AAP JSON `schema_version` 升 `1.1`,envelope 加 `project.tool_bindings`,annotations / predictions 数组每条加 `tool_unit_id` (1.0 reader 走 `extra="ignore"` 仍兼容)。
- 工作台 `useToolBindings(project, activeToolId)` 派生当前激活工具的 classes / classesConfig / attributeSchema;切工具时若 activeClass 不在新 unit 类别集自动切首个类。
- ProjectTemplate 同步加 `tool_bindings` 字段 (alembic 0073) + `CLONEABLE_PROJECT_FIELDS` 收入。
- 交互式 AI 工具由 `Project.ai_interactive_enabled` 控制可见性，类别与属性始终读取产出几何所属的 `region` / `bbox` binding。

## Consequences

正向

- 客户原始诉求 (同项目内不同工具用不同类) 直接解决,无需手工 hack。
- 工具维度的类别天然解耦:同名不同色合法 (强隔离),不存在"项目级类名重复"歧义。
- 导出 COCO/AAP JSON 的语义更清晰:`supercategory` / `tool_unit_id` 标注了类别来源工具,下游训练 pipeline 能区分。
- 新建向导只需问"启用哪些工具单位",不再依赖 type_key 列出 7 种排列组合;新增工具时不破坏 type 枚举。
- ProjectTemplate 与 Project 共享同一份 tool_bindings 结构,模板的工具集 / 类别 / 属性可独立编辑 (TemplateEditModal v0.10.17 已实现 3-tab UI)。

负向

- 跨工具复用同名类需重复输入 (bbox 加「人」 / region 加「人」是两次操作);可选 `alias_to: (tool_unit, class_name)` 软关联链已于 v0.17.15 落地,见下方「附录 · alias_to 软关联」——它是**显示层继承**,不推翻强隔离。
- 老项目数据迁移:alembic 0072 默认把所有 image-det / video-track 等项目类塞到 `bbox` unit;若客户实际混用 polygon 工具,需事后到 ProjectSettings 把类**复制**到 `region` unit(强隔离,不能共享)。这条已在 CHANGELOG / docs-site/user-guide 标注。
- API 增加一层概念:annotation 创建必须带 `tool_unit_id`,旧 SDK / 第三方调用者需升级 (本版默认 `bbox` 保兼容,但服务层 422 校验严格)。
- v0.10.17 期间 legacy 字段双写,有短暂"数据冗余",约 v0.10.18 删除派生字段后回归单源。

## 附录 · alias_to 软关联 (v0.17.15)

强隔离的代价是同名类跨工具单位要重复填颜色 / alias。`alias_to` 在**不破坏强隔离底线**的前提下补这块体验:

- **存储仍强隔离**:每个 tool_unit 的类仍是独立 `ToolClassEntry` 记录;标注校验 `class_name ∈ 本 unit.classes` 不变;`alias_to` 只是该记录上一个可选指针 `{tool_unit_id, class_name}`,指向另一 unit 的类。
- **仅显示层继承**:本类 `color` / `alias` 为空时,读时派生层 (`services/project.resolve_class_visual`) 沿 `alias_to` 链继承目标值,填进扁平 `classes_config` 供画布取色。**不改 tool_bindings 原始存储、不改标注归属、不进导出** (COCO/YOLO category 仍按各 unit 独立类输出,`supercategory` 仍是 tool_unit_id)。
- **解析保护**:环 (visited 去重) / 悬空 (目标不存在 → 降级用自身值) / 超深 (>4 跳 backstop),纯读时,无副作用。
- **rename / delete 不级联**:改名 / 删类只动 `name` 与 annotations,不触碰指向它的 `alias_to`;悬空由解析降级兜底 (保持改动 surgical)。
- **编辑器 v1 限制**:前端 ClassesSection 链接后该类**完全继承**目标 color/alias (payload 省略自身值);后端 resolver 已支持"自身显式值覆盖继承 (可选叠加)",但编辑器 v1 暂不暴露 override 入口。客户需要"继承基础上再微调"时再开放。

底线不变 (PR review 红线):不要因 `alias_to` 回退到"项目级共享类别池";它是**叠加在强隔离之上的显示便利层**,不是合并存储。

## Alternatives Considered（详）

**方案 B (项目共享类别池 + 工具勾选子集)**:更折中的形态,但需要新增"类别池"实体 + 每工具的"可用子集"映射两层数据结构,UI 上还得引导用户先建池再勾。客户的诉求是"独立",不是"共享后再勾",方案 B 中间多了一层抽象不必要。否决。

**方案 C (类别共享 + 属性绑定工具)**:"同一目标用不同工具时填不同属性"是少数场景,不能覆盖原始诉求"bbox 标行人, polygon 标道路" — 道路根本不应该出现在 bbox 工具的类别下拉里。否决。

**方案 D (彻底打散为 N 个独立项目)**:把 image-det 与 image-seg 拆成两个项目,分别配类。问题:同一份图像数据(dataset)要跑两次标注,任务调度 / 进度 / 成员管理双轨,客户更头疼。否决。

## Notes

- 实现代码位置:
  - 后端: `apps/api/app/db/models/project.py`、`annotation.py`、`prediction.py`、`project_template.py`;`apps/api/app/schemas/_jsonb_types.py`;`apps/api/app/schemas/project.py` / `annotation.py` / `prediction.py` / `project_template.py` / `aap_json.py`;`apps/api/app/services/project.py` (含 `derive_classes_config` / `coalesce_legacy_into_tool_bindings`;v0.10.22 删 `apply_tool_bindings_legacy_sync`,`derive_legacy_*` 改名 `derive_*`);`apps/api/app/services/annotation.py` (class_name 软校验);`apps/api/app/services/prediction.py` (`derive_tool_unit_from_ls_type` 派生);`apps/api/app/services/export.py` (COCO categories);`apps/api/app/api/v1/projects.py` (create/update/rename_class);`apps/api/app/api/v1/tasks.py` (create_annotation 透传)。
  - 迁移: `alembic/versions/0072_project_tool_bindings.py`、`0073_template_tool_bindings.py`、`0115_project_ai_interactive_enabled.py`、`0116_retire_ai_interactive_tool_unit.py`。
  - 前端: `apps/web/src/constants/toolUnits.ts`、`apps/web/src/components/projects/CreateProjectWizard.tsx`、`apps/web/src/pages/Projects/sections/{ClassesSection,AttributesSection,ToolUnitTabs,useProjectToolBindings}.{tsx,ts}`、`apps/web/src/pages/Workbench/state/useToolBindings.ts`、`apps/web/src/pages/Workbench/stage/tools/{MagicBoxTool,toolUnits}.ts`、`apps/web/src/pages/Workbench/stage/shared/geometry/bbox.ts`、`apps/web/src/pages/ProjectTemplates/TemplateEditModal.tsx`。
- 相关 ROADMAP / ADR: ROADMAP §A「新建项目向导」「项目模板」、§C.3「Magic Box」、ADR-0023 (ProjectTemplate)、ADR-0024 (AAP JSON)。
- 触发后续工作: ROADMAP §A 加入 v0.10.18+ 「删除派生 classes_config / attribute_schema」「polyline / lidar_box_3d 工具实现」「跨 tool_unit 类别软关联 (alias_to)」「Snap-to-edge Canny/Sobel」「rendering_config 共享编辑器 (供 TemplateEditModal 复用)」等延伸项。
