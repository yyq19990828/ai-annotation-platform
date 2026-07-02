# ROADMAP：平台层多阶段预标注编排（路径 B）

> 状态：**已落地（v0.18.1 → v0.18.3）**。路径 B 三个里程碑（M1 顺序 2 阶段 MVP / M2 类别路由·并行扇出·降级·逐阶段统计 / M3 审阅侧分步采纳·运行态可视化）已在 0.18.x patch 序列实装，详见 CHANGELOG 与 `docs/plans/2026-06-23-v0.18.{1,2,3}-*.md`。本文件保留为**设计决策与拓扑分析的来源**（编排界面形态、节点图边界、ROI 平台裁等决议）。
>
> 按实测「未出现驱动」暂未实装、留待真实需求：下游产独立几何 `write=new_shape`、`stage_index`/`parent_prediction_id` 正式表列、并行兄弟 Celery `chord` 并行、「一键采纳整条 pipeline」。
>
> 创建于 2026-06-23。

## 1. 背景与定位

需求形态：**检测 → 拿到标注框 → 对每个框跑分类/OCR 模型 → 把结果写回成框的属性**。

实现这种级联有两条路：

- **路径 A — backend 内部级联**（v0.18.0，先行）：串联逻辑下沉到某个 backend 内部，平台只调一次 `/predict`，backend 返回 `{value(几何), attributes(二阶段结果)}`。平台几乎零改动。适合**领域专用 pipeline**（如 onnxtools 车辆：rtdetr 检测车 → ROI → va 出车型/颜色 → 写 `attributes`）。缺点：每种级联组合都要写死成一个 backend，不可自由编排。
- **路径 B — 平台层通用编排（本文）**：平台负责「调 detect backend → 拿框 → 裁剪 ROI / 构造 context → 调 classify backend → 合并写回」。优点：**任意检测器 × 任意分类器自由组合**，复用现有任意 backend。代价：要把单轮预标 worker 改造成阶段化编排，把现有 `/ai-pre` 升级成「编排界面」。

**核心产品判断（本轮新增）**：现有 `/ai-pre` 单模型预标注 = **编排的退化特例（单节点单阶段）**。路径 B 不是另起一套界面，而是把现有「选一个 backend+model+阈值批量跑」的表单，泛化为「**有序阶段列表**，每个阶段复用同一份配置表单」。单阶段时与现状完全等价、向后兼容；加第二阶段即变成 detect→classify 级联。

**拓扑形态：顺序链 + 单层并行扇出**。除「detect→classify」单链外，需支持「检测后**并行跑多个分类/OCR 模型，各写不同属性**」（如车辆框 → 颜色分类器 + 车型分类器 + 车牌 OCR，三者并行、各写一个属性键、互不依赖）。这是**深度 2 的扇出树**（一个父阶段 → N 个并行子阶段），**不是任意 DAG**——无条件分支、无循环、子阶段间无交叉依赖。数据模型用「有序 stage 数组 + 每阶段显式 `parent_stage`」即可表达：多个子阶段共享 `parent_stage=0` 就是并行兄弟。这也是 `parent_stage` 做成**显式字段**（而非隐式「上一阶段」）的理由。

> **行业现状**：CVAT（Nuclio 四类函数各自独立调用，纯表单无编排）、xtreme1（1 模型 1 调用）、Label Studio（仅 Adala 文档画过 Skill pipeline，内核未实装）——**均无生产级平台层级联编排**。最贴近我们场景的是 **Roboflow Workflows**：`dynamic_crop` 块把检测块的每个 bbox 自动裁成 crop 批（输出升维），下游分类块对每个 crop 各跑一次，`DetectionsClassesReplacement` 保留 bbox 坐标、用下游预测覆盖/补充标签。**「检测→裁剪→分类→写回」是它的招牌 pattern，直接对标我们的需求**，B 可重度借鉴其语义约定。

## 2. 现状能力盘点

### 2.1 后端已就绪（可直接复用）

| 能力 | 位置 | 说明 |
|---|---|---|
| 协议 `attributes` 字段 | `docs-site/dev/reference/ml-backend-protocol.md` §3 / §4.1.8 | `result[].attributes` 承载 OCR/分类结果；`output_attribute_types` 半开放 |
| 协议③ 属性自描述 | 同上（v0.18.0 路径 A 新增） | `/setup` 的 model 条目自报 `output_attribute_schema`（含 select options），平台一键导入项目 `attribute_schema`。**B 直接复用，不重做** |
| 属性透传落库 | `apps/api/app/services/prediction.py::to_internal_shape` | LS result → 内部 geometry，`attributes` 原样透传进 `Annotation.attributes` JSONB |
| 标注属性模型 | `apps/api/app/db/models/annotation.py:40-57` | `class_name`（主类）+ `attributes` JSONB + `parent_annotation_id`（层级） |
| 多模型路由 | `apps/api/app/workers/tasks.py::_build_predict_context:39` | `context.model_id` / `task_type` / `model_variants` 已支持单 backend 多模型选择 |
| 批量预标 worker | `apps/api/app/workers/tasks.py::_run_batch:118` | 进度发布、predict_mode、失败软记录（`failed_predictions`）成熟 |

### 2.2 前端 `/ai-pre` 现状（编排界面的演进基座）

| 层 | 文件 | 角色 |
|---|---|---|
| 路由入口 | `apps/web/src/App.tsx:392-402` | `/ai-pre`（index=执行预标 / `/jobs`=历史），`AIPreAnnotateLayout` 顶部 tab |
| 主页 | `apps/web/src/pages/AIPreAnnotate/AIPreAnnotatePage.tsx` | 项目卡片网格 + 详情面板 |
| **编排基座** | `apps/web/src/pages/AIPreAnnotate/components/ProjectDetailPanel.tsx` | 单项目多批次预标：批次多选 + 配置 + predict_mode + 并发 + 运行。**升级为「阶段列表容器」的落点** |
| **单节点配置单元** | `PreannotateConfigForm.tsx` + `usePreannotateConfig.ts` | 选 backend/model/variant/阈值/类别白名单/prompt 的完整表单，状态由 hook 单一事实源供给。**也被工作台 `AIInspectorPanel` 复用** → 编排化 = 把它实例化成「每阶段一份」 |
| 发起请求 | `hooks/usePreannotation.ts` → `POST /projects/{pid}/preannotate` | 请求体 `PreannotateRequest`（`ml_backend_id`/`model_id`/`task_type`/`model_variants`/`params`/`class_filter`/`predict_mode`…） |
| 能力数据源 | `GET .../ml-backends/{bid}/capabilities` + `/setup` | backend 可选 model、variant 轴、参数 schema、协议③ 属性 schema |

> 状态管理用 React hooks + React Query（**无 zustand**）。`usePreannotateConfig` 是单节点配置的单一事实源——这正是「每阶段一份配置」要复用的对象。

### 2.3 缺口（B 需新增）

| 缺口 | 现状 | 需要 |
|---|---|---|
| **阶段编排** | `_run_batch` 是 `for task in tasks` 单轮循环 | 改造成「阶段 0 → 阶段 1 …」，前阶段输出喂后阶段输入 |
| **中间状态链** | `predictions` 表无 stage / parent 字段（`apps/api/app/db/models/prediction.py:35-51`） | 追溯「哪个框产出了哪个属性」。MVP 暂存 `PredictionMeta.extra`，验证后再考虑加正式列 |
| **ROI 输入构造** | context 由前端固定参数生成 | 后阶段需以前阶段 bbox 裁剪图片喂下游模型（平台内置 `dynamic_crop` 约定） |
| **跨 backend 编排** | `MAX_ML_BACKENDS_PER_PROJECT=1` | B 天然需 ≥2 backend（detect + classify），需放开并解决多 backend 选择 |
| **编排界面** | 单模型表单 | 升级为「有序阶段卡列表」（见 §4） |

## 3. 设计草案

### 3.1 阶段声明（请求体扩展，向后兼容）

`POST /api/v1/projects/{pid}/preannotate` 增加可选 `pipeline_stages`：

```jsonc
{
  "pipeline_stages": [
    { "stage": 0, "ml_backend_id": "<detect-uuid>", "model_id": "detect",
      "model_variants": { "series": "yolo11", "size": "l" },
      "params": { "conf": 0.35 } },
    { "stage": 1, "ml_backend_id": "<color-uuid>", "model_id": "color",
      "task_type": "classification",
      "parent_stage": 0,                        // 依赖 stage 0 的框
      "parent_class_filter": ["car","truck"],   // 只对这些类的父框跑（Roboflow 风格过滤）
      "roi": { "mode": "crop", "pad": 0.05 },   // 如何把父框喂给本阶段
      "write": { "target": "attributes", "keys": ["color"] } },
    { "stage": 2, "ml_backend_id": "<vtype-uuid>", "model_id": "vehicle_type",
      "task_type": "classification",
      "parent_stage": 0,                        // 与 stage 1 同父 → 并行兄弟
      "parent_class_filter": ["car","truck"],
      "roi": { "mode": "crop", "pad": 0.05 },
      "write": { "target": "attributes", "keys": ["vehicle_type"] } }
  ],
  "predict_mode": "skip_predicted"
}
```

stage 1、2 同为 `parent_stage=0` 的并行兄弟，各写不同属性键（`color` / `vehicle_type`），union 合并进同一个框。`write.keys` 显式声明本阶段写哪些键，用于**冲突检测**（两阶段写同键时告警，见 §7.6）。

**`parent_class_filter` 即「按类别路由」**：它声明本阶段吃哪些父框类别——不同阶段设**不相交**类别集 = 不同模型只对指定类别启动（如 `[car,truck]`→车辆属性模型、`[person]`→行人属性模型、`[plate]`→OCR），**用一个声明式过滤器表达类别路由，无需条件分支节点**；设**重叠**类别集 = 同类框喂多个模型（并行扇出）。框命中多个阶段 → 各属性 union；命中零个 → 保持纯检测框（降级）。

**缺省（无 `pipeline_stages`）= 现有单阶段路径**。现有 `PreannotateRequest` 等价于 `pipeline_stages=[单个 stage]`，完全向后兼容。

### 3.2 Worker 阶段化（MVP 同步顺序）

```python
# apps/api/app/workers/tasks.py — _run_batch 改造（伪码）
for stage in pipeline_stages:
    parents = {} if stage.parent_stage is None else \
              fetch_predictions(task_ids, stage_index=stage.parent_stage)
    for task in tasks:
        if stage.parent_stage is not None:
            boxes = [b for b in parents.get(task.id, [])
                     if not stage.parent_class_filter or b.class_name in stage.parent_class_filter]
            if not boxes:            # 降级：前驱无（符合过滤的）框 → 跳过本框二阶段
                continue
            inputs = build_roi_inputs(task, boxes, stage.roi)  # 平台裁剪 crop
        else:
            inputs = [{"id": task.id, "file_path": presigned_url(task)}]
        ctx = _build_predict_context(..., model_id=stage.model_id,
                                     task_type=stage.task_type,
                                     model_variants=stage.model_variants)
        results = await client(stage.ml_backend_id).predict(inputs, ctx)
        save_with_stage(results, stage_index=stage.stage,
                        parent_pred_ids=[b.id for b in boxes], write=stage.write)
```

### 3.3 结果合并写回

两种 `write.target`：

- **`attributes`（推荐默认）**：二阶段结果**合并进父框预测的 `attributes`**（如 `attributes.vehicle_type="truck"`），不新增框。维持「一个框 + 一串属性」模型，**前端采纳/编辑零改动**（`accept_prediction` 已原样拷贝 attributes，`AttributeForm` 已支持 select 编辑）。**多个并行兄弟阶段各写不同键时做 union 合并**（如 stage1 写 `color`、stage2 写 `vehicle_type` → 同框得 `{color, vehicle_type}`）；键冲突时按 §7.6 处理。
- **`new_shape`**：二阶段产出独立几何（少见，如 detect→二次 seg），新建 prediction 行，`parent_prediction_id` 关联。**M3 才做**。

### 3.4 ROI 裁剪：平台内置（决议见 §7.3）

借鉴 Roboflow `dynamic_crop`：**平台**按父框 bbox（+`pad` 边界扩展）裁好图，作为独立 input 传给下游 classify backend。下游 backend **无感**——它只是收到一张「小图」跑分类，不需要懂 region context。代价是平台要处理图像裁剪（OpenCV/Pillow）并管理临时 crop（presigned URL 或内存传递）。换来的收益：**任意现成 classify backend 零改造即可作为下游**，这正是 B「自由组合」的命门。

### 3.5 数据模型改动（向后兼容，MVP 不改表）

```python
# MVP：阶段元信息暂存 PredictionMeta.extra JSONB，不改表
extra = { "stage_index": 1, "parent_prediction_id": "<uuid>" }
# 验证价值后（M3）再考虑加正式列：
#   predictions.stage_index: int | None
#   predictions.parent_prediction_id: uuid | None
```

### 3.6 现有 backend 的改造面（结论：零强制）

B 的级联完全在**平台侧 worker** 编排，每个 backend 仍只被调一次普通 `/predict`，与今天一致——这是 §3.4「平台裁 ROI、backend 无感」决策的直接回报，也是 B 相对路径 A 的核心卖点（任意现成 backend 自由组合）。现有 backend（`apps/yolo-backend` / `apps/grounded-sam2-backend` / `apps/sam3-backend` / `apps/onnxtools-backend`）按角色：

| 角色 | 改造面 | 说明 |
|---|---|---|
| **stage 0 检测器** | **零改动** | 产框行为就是今天的单模型 predict，B 不碰 |
| **下游 classify/OCR stage** | **零改动（若本就支持分类/OCR 并返回 `attributes`）** | 平台把 crop 当普通小图喂入，backend 跑它本就支持的任务、把结果塞 `attributes` 返回——协议 §3 已有能力，非 B 新增。纯检测器只能当 stage 0（能力事实，非缺改造） |
| **下游 + 想免手配属性 options** | **可选**：`/setup` 补 `output_attribute_schema`（协议③，同 onnxtools v0.18.0） | opt-in、逐 backend、向后兼容；不补也能用（项目侧手配 select options）。**非强制迁移**。`yolo-backend` 已现 `output_attribute` 线索，届时确认即可 |

**不强制项**：协议版本不需再升（均已 v2.x）；`MAX_ML_BACKENDS_PER_PROJECT` 放开是平台配置非 backend 改动；worker 传 crop 走现有 image input 格式。

> **唯一要留意的非代码问题 —— crop 域偏移**：平台传「紧贴框的小图」，全图场景训练的模型吃紧 crop 可能掉点。属**模型质量**问题非协议改造，`roi.pad`（§3.4）即为缓解；适合当下游的 backend 应能容忍小尺寸输入（绝大多数分类器可以）。

## 4. 编排界面形态（本轮核心对齐，决议）

**结论：MVP 用「线性阶段卡列表」，不上节点图。** 数据模型设计成「有序 stage 数组」，保留远期升级 React Flow 的路径，但在出现真正的分支/循环/用户自助编排需求前不引入节点图（对零自由度拓扑是过度设计，违反 CLAUDE.md §2）。

| 维度 | 线性阶段卡（选定） | 轻量节点图（不选） |
|---|---|---|
| 拓扑表达力 | 顺序链 + 单层并行扇出（够用） | 任意 DAG（用不上） |
| 用户认知负担 | 低（像填表） | 中高（要懂拖拽连线），用户是非工程师管理员 |
| 前端实现量级 | **小**：阶段列表容器 + 复用现有 `PreannotateConfigForm` ×N + 阶段间映射约定 + 逐阶段进度。约现界面 1.5–2× | **大**：画布+自定义节点+边/handle+inspector+运行态高亮+布局。配置面板/字段映射/校验是大头，业界生产级 14–25 周 |
| 远期分支/循环 | 需重构为图 | 已就位 |

**界面形态**：`ProjectDetailPanel` 内，把现有「单个配置表单」改成「**可增删排序的阶段卡列表**」：

```
┌ 阶段 1 · 检测 ───────────────────┐
│ backend: yolo-backend            │   ← 复用 PreannotateConfigForm
│ model: detect / yolo11-l         │
│ conf: 0.35   类别: [car,truck…]  │
└──────────────────────────────────┘
              ↓ 对每个框裁剪 ROI（内置约定，无需连线）
   ┌──────────────┴──────────────┐         ← 并行扇出（同父）
┌ 阶段 2 · 颜色 ────────┐  ┌ 阶段 3 · 车型 ────────┐
│ backend: onnxtools    │  │ backend: onnxtools    │
│ 父框类别: [car,truck] │  │ 父框类别: [car,truck] │  ← parent_class_filter
│ ROI 扩展: 5%          │  │ ROI 扩展: 5%          │  ← roi.pad
│ 写回 → attributes.    │  │ 写回 → attributes.    │
│        color          │  │        vehicle_type   │  ← write.keys（各写不同键）
└───────────────────────┘  └───────────────────────┘
        [+ 串接下一阶段]   [+ 并行添加同级阶段]
```

**关键交互（均借鉴行业、不暴露通用映射 UI）**：
- **数据流是内置约定**：「上游每个 bbox → 下游 ROI」「下游结果 → 写回框属性」是固定语义，不让用户手动连线/映射。用户只配「只对哪些父框类别跑」（轻量过滤器）和「写回哪个属性键」。
- **并行扇出靠分组、不靠连线**：同一父阶段下可「并行添加同级阶段」，UI 上呈现为该父阶段下的一组同级卡片（Roboflow 风格——多个块引用同一上游）。仍是卡片列表，不是画布。
- **按类别路由 = 每张卡的「父框类别」过滤器**：每个阶段卡选「只对哪些父框类别启动」（`parent_class_filter`）。不相交 = 不同类走不同模型，重叠 = 同类喂多模型。这是声明式过滤，不是 if/else 分支节点——用户只勾类别，不画路由线。
- **配置面板 = 卡片本身**：点开阶段卡即展开该阶段的模型/参数表单（复用现有组件），无需画布+独立 inspector 双区。
- **运行态 = 逐阶段进度条 + 批量成功率**：每张卡显示状态徽标（pending/running/done/failed）+ 统计（如「检测出 1240 框，颜色成功 1198 / 失败 42」）。并行兄弟各自一条进度。比节点图「绿框」更适合批量标注（关心批统计而非单次执行追踪）。

> **重审节点图边界**：单层扇出 + 按类别路由仍是固定结构（子阶段挂在唯一父阶段上，靠声明式类别过滤分流），卡片分组 + 类别勾选即可表达，**按类别路由不算条件分支、不构成上节点图的理由**。**只有当出现「子阶段再扇出（深度 ≥3）/ 运行时动态分支（路由依据超出静态类别集，如按某属性预测值再决定下游）/ 循环 / 用户自助编排任意拓扑」时**，才重新评估 React Flow。在此之前上节点图即过度设计。

## 5. 工作台 AI 面板的衔接（编排的审阅侧）

> 结论先行：工作台 `AIInspectorPanel`（右栏侧栏，可分离浮窗）**要改，但只改「审阅/采纳属性」与可选的「单框增强」两点，绝不变成 pipeline 编排器**。编排是批量域（`/ai-pre`）的事；工作台是逐对象审阅 + 可选单框增强，altitude 不同。

**现状（探查结论）**：

- `AIInspectorPanel` = `apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx`，复用 `PreannotateConfigForm`/`usePreannotateConfig`。
- 交互本质：点「开始预标」→ 对**当前整张图**跑一遍 → 候选 `AiBox` 列表 → 逐个 accept/reject/refine。走 `POST .../preannotate` 带 `task_ids=[taskId]`（单 task 的批量，**非逐框交互**）。
- 请求体**无** `region`/`roi`/选中框信息；选中框只用于展示/编辑它**自己**的属性（`AttributeForm`，仅图片任务）。
- 候选预测行（`BoxListItem`）只显示几何/类别/置信度，**不显示候选 `AiBox.attributes`**；accept 为几何「一步全采纳」（仅 OCR/doc_layout 文本经 `pickCarryAttributes` 带入）。

**触点 1 — 审阅/采纳「流水线产出的属性」（必改；v0.18.0 路径 A 已触发）**

batch 跑完 detect→classify，候选 `AiBox` 就带属性（`vehicle_type`/`color`…）。面板缺：候选行不渲染候选属性；accept 无「先看属性预测 → 改 → 再 commit」分步。这**不是 B 才有的新需求**——v0.18.0 onnxtools 在 batch 就产出带属性候选（路径 A 的「缺口 A · 采纳前预览」即此，只读最小版）。**B 把它从「只显示 OCR 文本」泛化为「任意 select/multiselect 属性都要能在候选上渲染 + 审阅」**。

**触点 2 — 对选中框跑单个属性模型（交互式，可选，靠后）**

B 的「对每个框跑分类」有交互式对应：选中一个框 →「对它跑颜色/车型分类器」→ 填属性。**工作台已有该框几何，ROI 就是它本身，无需检测阶段**——这是「单阶段、单框」的交互版，复用 B 的 crop + 写属性机器。现状整条缺：请求体无 `region/roi`，面板无 `onRunAiForBox(boxId)`（只有全局 `handleRunAi` 跑全图）。非上线前置，是 enrich 体验。

**红线（动手时极易踩）**：

- 面板**不 host 阶段卡列表**。扇出 / 按类别路由对「单框一次交互」毫无意义，只在批量有意义。
- **共享组件耦合**：`usePreannotateConfig`/`PreannotateConfigForm` 被 `/ai-pre` 与工作台两边共用。给 `ProjectDetailPanel` 加阶段列表时，**阶段编排必须做成「容器持有 N 个共享表单实例」，而不是改共享表单本身**——否则工作台面板会被动继承它不该有的 pipeline UI，破坏其「单节点退化特例」的纯净。

**落 0.18.x**：

| 触点 | 改什么 | 版本 |
|---|---|---|
| 1 候选属性**只读预览** | `BoxListItem`/inspector 渲染候选 `AiBox.attributes` | 随 **v0.18.0**（路径 A 缺口 A，最小只读） |
| 1 候选属性**审阅 + 分步采纳** | accept 前可见可改任意 select 属性，非一步全采纳 | **v0.18.2 / v0.18.3**（B 泛化） |
| 2 选中框**交互式跑属性模型** | 请求体加 `region`/`selected_box_id` + 面板「对该框跑属性」入口 | **v0.18.3+**（可选 enrich） |
| 红线 | 阶段编排不进共享表单 / 不进工作台面板 | 贯穿 |

## 6. 里程碑（→ 0.18.x 版本映射）

> M0 设计冻结折进 v0.18.1 设计章节，不单独成版本。每个 patch 一份独立 plan（待启动时按 v0.18.0 plan 的精度展开）。

- **v0.18.1 — M1 · 顺序 2 阶段 MVP**
  放开 `MAX_ML_BACKENDS_PER_PROJECT`；请求体 `pipeline_stages`；`_run_batch` 阶段化**同步顺序**执行；单 detect→单 classify，`write=attributes`，不改表（走 `PredictionMeta.extra`）；ROI 平台裁剪（`crop`+固定 pad）。UI 先给最小可用：`ProjectDetailPanel` 支持「加第二阶段」（复用 `PreannotateConfigForm` 第二实例）。**验证目标**：「框+属性」全链路跑通、采纳后属性入库可编辑。

- **v0.18.2 — M2 · ROI 与降级**
  `roi.mode/pad` 可配；`parent_class_filter`（只对指定父框类跑）；前驱无框跳过；阶段级失败策略（下游失败 → 保留上游框、属性留空 vs 整框丢弃）；进度/成功率**按阶段上报**（逐阶段进度条数据）。

- **v0.18.3 — M3 · 编排界面产品化**
  线性阶段卡列表完整 UI（增删排序、逐阶段进度条、批量成功率可视化）；`write=new_shape`；评估正式表字段（`stage_index`/`parent_prediction_id`）与 Celery `chord` 并行化；「一键采纳整条 pipeline 输出」（视实测决定，见 §7.4）。

## 7. 开放问题决议（M0）

1. **同步 vs 异步** → **MVP 同步**。v0.18.1 在单 Celery task 内顺序跑各阶段（简单、中间状态易管），并行兄弟阶段先也顺序跑。规模化后（v0.18.3）再评估拆 `chord`：同父的并行兄弟阶段无交叉依赖，是 `group`/`chord` 的天然并行单元。
2. **属性取值域对齐** → **复用路径 A 协议③**。backend 输出 `attributes.color="blue"`，靠 `/setup` 自报 `output_attribute_schema`（含 options）一键导入项目 `attribute_schema`，三处 key 对齐。A、B 共用同一套机制，B 不重做。
3. **ROI 裁剪在哪做** → **平台裁**（§3.4）。平台按 bbox 裁好 crop 传给下游，backend 无感。换取「任意现成 classify backend 零改造可作下游」，这是 B 自由组合的命门。代价（平台处理图像 + 临时 crop 管理）可接受。
4. **采纳粒度** → **MVP 维持逐框 accept**。属性 merge 进父框，前端零改动。「一键采纳整条 pipeline 输出」留 v0.18.3，按实测数据质量再定是否值得。
5. **编排界面形态** → **线性阶段卡 + 单层并行扇出分组，不上节点图**（§4 决议）。
6. **并行兄弟属性键冲突** → **声明 + 检测**。每阶段 `write.keys` 显式声明写哪些属性键；编排校验期对「多个阶段写同键」给告警（默认拒绝该配置或末位覆盖，按实测定）。不同键 union 合并无冲突，是常态。

## 8. 参考

- 路径 A（先行验证，v0.18.0）：[`docs/plans/archive/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md`](../docs/plans/archive/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md) —— onnxtools 内 `detector`/`VehicleAttributeORT` 保持独立单元，B 可直接拆成原子 model 编排；协议③（`/setup` 自报 attribute schema）在 A 先落地，B 复用。
- 协议：`docs-site/dev/reference/ml-backend-protocol.md` §3 / §4.1.7（ONNX 聚合 backend）/ §4.1.8（OCR/DocLayout 输出约定）/ 属性自描述小节（v0.18.0 新增）。
- backend 骨架参考：`apps/yolo-backend/`；协议形态参考：`docs-site/dev/examples/mock-v2-backend/`。
- 行业编排 UI：
  - [Roboflow Workflows 多模型（检测→裁剪→分类）](https://inference.roboflow.com/workflows/gallery/workflows_with_multiple_models/) / [Dynamic Crop block](https://inference.roboflow.com/workflows/blocks/dynamic_crop/) —— 最贴近本场景，重度借鉴。
  - [CVAT 自动标注（线性表单基线）](https://docs.cvat.ai/docs/annotation/auto-annotation/automatic-annotation/)
  - [React Flow Workflow Editor 模板](https://reactflow.dev/ui/templates/workflow-editor) / [build-vs-buy 隐藏成本（14–25 周）](https://www.workflowbuilder.io/blog/build-vs-buy-workflow-editor-hidden-cost-react-flow) —— 远期若上节点图的成本参照。
  - [Dify 变量引用](https://legacy-docs.dify.ai/guides/workflow/variables) / [n8n 数据映射](https://docs.n8n.io/data/data-mapping/data-mapping-ui/) —— 字段级映射做法（本场景不采用，留作参照）。
