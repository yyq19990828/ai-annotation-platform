# CVAT / Label Studio 取经合集（2026-05-18）

> **性质**：研究输入，不是行动清单。
> **来源**：对照阅读 `cvat`（v2.x 主干）+ `label-studio`（OSS 1.x 主干）两份代码，结合当前平台 ROADMAP.md / CHANGELOG.md 的现状摸底。
> **使用方式**：
> 1. 先看 §7 "与现 ROADMAP 的映射表"，确认每条**是否已在主 ROADMAP 覆盖** / **需要升级范围** / **本次新增**。
> 2. "新增"或"升级"条目，按颗粒度决定是回流到 `ROADMAP.md` 的 §A/§B/§C，还是单独拆 epic 子文档。
> 3. "避坑清单（§6）"不是 TODO，而是**保持当前正确选择**的备忘，未来 PR review 时引用。
>
> **不要**把这份文档当 sprint backlog 用 —— 它没经过价值/成本评估排序。

---

## 1. 立即可做的小颗粒（每条 ≤ 3 天，可塞进任一 v0.11.x 收尾窗口）

按"工作量 / 风险"从低到高排，每条都不依赖未做的基建。

### 1.1 Annotation Guide（项目级 Markdown 指引 + asset）

- **来源**：CVAT [`cvat/apps/engine/models.py`](../../cvat/cvat/apps/engine/models.py) `Project.annotation_guide` 字段 + `AnnotationGuide` / `Asset` 两张表（asset 是允许在指引里贴的截图）。
- **平台现状**：没有项目级标注指引；标注规则只能口头传达或写在外部文档。
- **价值**：对**标注一致性**的提升远超技术 ROI。一份"什么算合格 / 边界情况怎么处理 / 反例图"的指引能直接降低 reject 率。
- **设计**：
  - DB：`projects` 加 `guide_markdown TEXT`、`guide_assets JSONB`（asset 走对象存储，记 URL + alt + size）。
  - UI：ProjectSettingsPage 加「📖 标注指引」section（Markdown 编辑器 + 拖拽截图上传）。
  - 工作台左侧栏加「📖 指引」浮层（默认折叠，新标注员首次进入自动展开一次，写 localStorage 标记）。
- **工作量**：1.5d（后端 0.5d schema + 上传复用 dataset upload；前端 1d，Markdown 编辑器用 `react-markdown` + 已有 `MarkdownView` 组件）。
- **建议节奏**：与「项目模板/复制」（v0.10.11 已落基础形态）共用 ProjectSettingsPage 破窗窗口。

### 1.2 `reject_reason_type` 结构化枚举

- **来源**：CVAT `AnnotationConflictType`（`missing / extra / mismatching_label / low_overlap / mismatching_direction`）。
- **平台现状**：`reject_reason` 是自由文本，丢失了"漏标率 / 错标率 / 标错类别率"的可分析信号。
- **设计**：
  - DB：`annotations` / `tasks` 上 reject 路径加 `reject_reason_type ENUM`，原 `reject_reason` 留作 free text 补充。
  - 枚举初版收紧到 4 类：`missing / extra / wrong_label / wrong_geometry`。
  - reviewer UI 强制先选类型再写文本。
- **工作量**：1d（migration + 前端下拉）。
- **联动**：§4.1 Annotator Performance Dashboard 的关键维度。
- **风险**：枚举一旦上线就难改，第一版要刻意收紧；后续按 reviewer 反馈再细分。

### 1.3 Webhook payload 加 `event_version` 字段

- **来源**：Label Studio 历史教训 —— webhook 升级时客户端全挂。
- **平台现状**：Webhook 完整体本身还没做（§2.1）；但**协议规范可以先定**。
- **设计**：写进未来 ADR-0018 草稿（不必现在实现），约定所有 webhook payload 顶层带：
  ```json
  {
    "event_version": "2026-05-18",
    "event": "annotation.created",
    "delivery_id": "...",
    "data": { ... }
  }
  ```
- **工作量**：0.5d（写 ADR 草案 + Pydantic schema 占位）。
- **价值**：未来做 §2.1 时不会重写。

### 1.4 截图 fixture 数据补齐 + 重跑

- 主 ROADMAP 已有，本研究文档**不重复**，仅在映射表（§7）登记。

### 1.5 Predictions Import 端点

- **来源**：Label Studio `POST /api/predictions/` + 批量 JSON 上传。
- **平台现状**：Prediction 只能由内部 ML backend 生成，外部模型结果进不来。
- **价值**：客户已有自家模型预测（不愿托管在你的 backend）时，能"上传 COCO predictions → 平台审核修正 → 导出"。**直接降低准入门槛**，对学术/初创客户尤其。
- **设计**：
  - 新端点 `POST /projects/{id}/predictions/import`，body 接两种格式：① COCO（反向解析现有 export schema）；② **平台原生 AAP JSON**（见 §2.6，推荐主格式）。
  - 后端按 task `external_id` 或 `file_path` 匹配 → 写 `predictions` 表，`source='external_import'`，附 `model_version` 字符串。
  - **导入宽容**：只校验必备字段（`task_match` + `geometry.kind` + 对应几何字段 + `class_name`），未知字段忽略不报错；缺失字段按默认值（如 `confidence=1.0`）。
- **工作量**：单做 1.5d；**与 §2.6 AAP JSON 同窗口做共 ~4.5d**，多 ~3d 但为 §3.1 SDK / §3.4 Plugin / §2.5 项目快照 铺路。**强烈建议合并**。
- **联动**：与 §5.1 LLM-as-Judge 共享"外部 prediction 入库"通道。

### 1.6 DuckDB 离线分析视图（不上 ClickHouse）

- **来源**：CVAT 用 ClickHouse 存 events 做 OLAP，但平台数据量没到那个量级。
- **平台现状**：`task_events` + `audit_log` 已 partition，但 ad-hoc 分析查询走 PostgreSQL 慢，没有现成 dashboard。
- **设计**：
  - Celery beat 每天把 `task_events` + `audit_log` 增量同步成 DuckDB 文件（`/var/lib/duckdb/analytics.duckdb`）。
  - 加 `/admin/analytics` 页面（super_admin 可见），调几个固定 query：人均吞吐 / 项目 reject 率 / 标注耗时分布。
  - **不暴露任意 SQL**，只给固定面板（防注入 + 防慢查询）。
- **工作量**：2d（同步 worker 0.5d + 前端图表 1.5d，用现有 charts 组件）。
- **价值**：为 §4.1 Annotator Dashboard 提供数据源；为 §3 公开 SDK 的"导出统计 API"铺路。
- **升级路径**：等数据量超过 DuckDB 单机能扛（亿级 task_events），再考虑 ClickHouse。

### 1.7 统一异步任务表 `async_jobs`（MVP）

- **来源**：CVAT `RequestAction` enum 把 autoannotate / import / export / batch 操作合并到一张 Request 表。
- **平台现状**：Celery task 离散（预标、导出、视频转码、tracker job、partition archive 各管各的），前端没有"我的后台任务"统一入口。
- **设计**：
  - 新表 `async_jobs(id, kind, project_id, user_id, status, progress_pct, payload JSONB, result JSONB, error_message, created_at, updated_at)`。
  - Celery task 在 enqueue / progress update / finish 时写这张表（用 Celery signals）。
  - 前端右上"任务铃铛"列出进行中作业 + 最近完成历史（用现有 NotificationDrawer 复用 UI）。
- **工作量**：3d（schema + 改造 5~7 个现有 Celery task signal hook + 前端列表）。
- **价值**：**越早做收益越大** —— Celery task 类型还会继续加，迁移成本会越来越高。
- **强依赖**：无（纯增量）。

---

## 2. 协议 / 数据模型类（中等颗粒，需 ADR）

### 2.1 Webhook 系统（一等公民）

- **来源**：CVAT [`cvat/apps/webhooks`](../../cvat/cvat/apps/webhooks)。两表分离：`Webhook(scope, events[])` + `WebhookDelivery(status_code, request, response, redelivered_at)`。
- **现 ROADMAP**：§B 治理/合规只有一句「Slack/Webhook 集成」，缺设计。
- **建议**：升级为独立 ADR + epic。
- **核心字段**：
  ```python
  class Webhook:
      id: UUID
      scope: Literal["organization", "project"]
      scope_id: int
      target_url: str
      secret: str  # HMAC sign payload
      events: list[str]  # ["annotation.created", "task.approved", ...]
      enable_ssl: bool
      is_active: bool

  class WebhookDelivery:
      id: UUID
      webhook_id: UUID
      event: str
      payload: JSONB  # 含 event_version (§1.3)
      status_code: int | None
      response_body: str | None
      attempt: int
      next_retry_at: datetime | None
  ```
- **重试策略**：失败指数退避（30s / 5m / 1h / 6h / 24h）共 5 次，全失败标记 `webhook.is_active=false` + 给 owner 发通知。
- **事件清单（首版）**：5 类够用 —— `annotation.created/updated`、`task.assigned/approved/rejected`、`batch.state_changed`、`prediction.completed/failed`、`bug_report.created`。
- **签名头**：`X-Signature-256: sha256=<hmac>`（GitHub 同款），客户端可直接复用 GitHub webhook 验签代码。
- **UI**：ProjectSettings + AdminDashboard 各加「Webhook 管理」section（增删改 + 测试投递 + 最近 20 次 delivery 历史）。

### 2.2 AnnotationFeedback 表（Issue / Comment / BugReport 收敛）

- **来源**：CVAT [`Issue`](../../cvat/cvat/apps/engine/issue.py) + Comment thread，所有反馈都锚到 `(frame, position)`。
- **现 ROADMAP**：§C.7 I18 只把"Issue 锚定到像素位置"放在 P2 图片侧，没看到收敛规划。
- **风险**：平台已有 `BugReportDrawer` / `TaskComment` / `reject_reason` 三处反馈入口，**越演化越难合并**。
- **建议**：在 v0.11 前期做一次模型收敛，**早做比晚做便宜**。
- **统一模型**：
  ```python
  class AnnotationFeedback:
      id: UUID
      kind: Literal["bug", "issue", "comment", "reject"]
      anchor_type: Literal["project", "task", "annotation", "pixel"]
      anchor_id: int | None  # task_id / annotation_id
      anchor_position: JSONB | None  # {frame, x, y} for pixel
      status: Literal["open", "resolved", "wont_fix"]
      severity: Literal["info", "warn", "blocker"] | None
      created_by: int
      thread: list[Comment]  # 子评论
  ```
- **迁移**：保留 `bug_reports` / `task_comments` 现表，新表加 view 合并，前端先切到统一 API，旧表后续收尾。
- **联动**：§C.7 I18 自动满足，BugReportDrawer 的 LLM 聚类去重（§B）也直接复用。

### 2.3 Consensus / Replica Jobs（与 GT honeypot 分开做）

- **来源**：CVAT `Task.consensus_replicas` + [`cvat/apps/consensus`](../../cvat/cvat/apps/consensus) 的 intersect_merge。
- **现 ROADMAP**：§C.7 I19 把 GT job / Consensus / IAA 捆成一个 L 体量 epic。
- **建议拆分**：
  - **I19a · Consensus replicas（先做，更容易）**：`task.consensus_n: int = 1`，>1 时调度器自动分给 N 个不同标注员；提交后 IoU > 0.7 自动合并，否则进 reviewer 队列。**不需要"看不见"的伪装机制**。
  - **I19b · GT honeypot（后做，更难）**：从已完成 task 抽 N% 标记为 GT，新任务里偷偷重新分发；标注员视角无法分辨。需要 task 复制 + 标注隐藏 + 评分回灌。
- **价值**：低预算高质量场景（医疗影像 / 法务）通常用 consensus 而非 honeypot —— 业主愿意付双倍标注成本换取共识 ground truth。

### 2.4 Tracker / Auto-Annotation 协议层抽象（先于 R23 UI）

- **来源**：CVAT `FunctionKind` enum (`DETECTOR / INTERACTOR / REID / TRACKER`)。
- **现 ROADMAP**：§C.5 R23 "Tracker Registry UI" 直接做 UI 层，缺协议层。
- **建议**：R23 前置一个"capabilities 协议统一"小项（§C.7 I20.4 已提，但没和 R23 关联）。
  - 后端 `/setup` 返回 `supported_capabilities: ["detector", "interactor", "tracker", "reid"]`。
  - 平台按 capability 分类路由（图片 detector 走预标、视频 tracker 走 R10 job、interactor 走 ToolDock）。
  - UI 注册时按 capability 显示可选项，避免误配。
- **工作量**：1d（协议层）+ R23 UI 维持原估。

### 2.5 标注规则版本化（Project Fork / Branch）

- **来源**：CVAT 没做，Label Studio 也没做 —— 这是**真空地带**，但客户场景常见。
- **场景**：「类别 schema 改了，老数据按老规则保留，新数据按新规则跑」。
- **现 ROADMAP**：只有"数据集 snapshot"（L1），没有"项目规则 snapshot"。
- **建议**：
  - `projects.config_version: int`（每次 classes_config / attributes_schema 修改 +1）。
  - `annotations.config_version: int`（继承自标注时项目当前版本）。
  - 导出时按 config_version 分组（避免混合规则的标注被错误归到同一类）。
- **优先级**：P3，等第一个客户反馈"我改了类别现在历史数据怎么办" 再做。

### 2.6 平台原生 task JSON 格式（"AAP JSON"）

- **问题**：当前导出走 COCO/YOLO/VOC 三件套，但这三种都是**有损投影**——
  - COCO 没法存 attributes 多字段 / version / source(manual/prediction) / reviewer 元数据 / batch_id / locked/hidden/occluded / reject_reason_type / multiPolygon holes。
  - YOLO 更扁平，连类别属性都丢。
  - 想做 §1.5 Predictions Import / §3.1 SDK / §3.4 Plugin tool I/O / §2.5 项目规则版本化 / dataset snapshot，**都需要一个无损中间格式**。
- **建议**：定义平台原生 task JSON（暂命名 **AAP JSON**），作为：
  1. 导出可选格式（`--format=aap`），和 COCO/YOLO/VOC 并列。
  2. §1.5 Predictions Import 的**推荐主格式**（lenient 模式）。
  3. §3.1 SDK / §3.4 Plugin tool 的统一 I/O 协议。
  4. 未来 §2.5 项目规则版本化 / dataset snapshot 的"快照单元"。

#### 关键设计

**a. `schema_version` 必备**：和 §1.3 webhook `event_version` 同源思路，但这是 schema 不是 payload，单独版本（建议 `"schema_version": "1.0"`，跟随 SemVer）。breaking change 升 major。

**b. 导出严格、导入宽容**（Postel's law）：
- **导出**：所有字段写满，未设字段写 `null`（不省略 key），便于客户端做 schema 校验。
- **导入**：只解析必备 + 已知字段，未知字段忽略不报错；缺失字段按默认值。

**c. 必备字段最小集（import as prediction）**：

```json
{
  "schema_version": "1.0",
  "task_match": {
    "file_path": "datasets/foo/img001.jpg"
  },
  "predictions": [
    {
      "geometry": { "kind": "bbox", "bbox": [x1, y1, x2, y2] },
      "class_name": "car"
    }
  ]
}
```

- `task_match` 三选一：`file_path` / `external_id` / `task_id`，按优先级匹配。
- `geometry.kind` 按 enum 走（`bbox | polygon | polyline | ellipse | skeleton | mask | multiPolygon`），每个 kind 对应自己的必备字段。
- `class_name` 必备（或 `class_id` 二选一）。
- 其它一切（`confidence` / `model_version` / `attributes` / `cost_meta`）**可省**。

**d. 完整字段（export 无损模式）**：

```json
{
  "schema_version": "1.0",
  "export_meta": {
    "platform": "ai-annotation-platform",
    "exported_at": "2026-05-18T10:00:00Z",
    "exported_by": 42,
    "filter": { "batch_id": 7, "status": "completed" }
  },
  "task": {
    "id": 123,
    "external_id": "...",
    "file_path": "...",
    "dimensions": { "width": 1920, "height": 1080 },
    "status": "completed",
    "batch_id": 7,
    "assignee_id": 5,
    "config_version": 3,
    "metadata": { }
  },
  "annotations": [
    {
      "id": 456,
      "version": 2,
      "geometry": {
        "kind": "polygon",
        "polygon": [[x, y]],
        "holes": []
      },
      "class_name": "car",
      "attributes": { "color": "red" },
      "source": "manual",
      "ground_truth": false,
      "locked": false,
      "hidden": false,
      "occluded": false,
      "created_by": 5,
      "created_at": "...",
      "updated_at": "...",
      "reviewer_id": 12,
      "review_status": "approved",
      "reject_reason_type": null,
      "reject_reason": null,
      "group_id": null
    }
  ],
  "predictions": [
    {
      "id": 789,
      "geometry": { "kind": "bbox", "bbox": [x1, y1, x2, y2] },
      "class_name": "car",
      "confidence": 0.92,
      "model_version": "sam3-base@2026-05-01",
      "cost_meta": { "prompt_tokens": 0, "total_cost_usd": 0 }
    }
  ]
}
```

> **关键规则**：`annotations` 和 `predictions` **双数组分开**，不混到同一个数组用 `type` 字段区分（CVAT 部分格式走过这条路，分析时永远要先 filter，痛苦）。

**e. 任务粒度 vs 项目粒度打包**：
- 单 task 一个文件：`tasks/{task_id}.json`。
- 整个项目导出 ZIP：`project_{id}_aap.zip`：
  ```
  manifest.json          # 项目元数据 + classes_config + attributes_schema + guide_markdown + config_version
  tasks/
    1.json
    2.json
    ...
  assets/                # （可选）guide_assets 引用的截图
  ```
- 客户可单独导出/导入单 task，也可批量；SDK 用 ZIP，CLI 单 task 走单文件。

**f. 与 COCO/YOLO/VOC 的关系**：
- **不替代，并列**。AAP JSON 是无损中间格式，COCO/YOLO/VOC 是有损投影。
- 想要其它格式（KITTI/MOT/Cityscapes/...）→ 走 §3.3 datumaro 转换链：
  ```
  AAP JSON ↔ Datumaro internal ↔ { COCO, YOLO, VOC, KITTI, MOT, ... }
  ```
- AAP JSON 是 datumaro 链的**原生输入源**（无损），datumaro 出口都是有损投影。

**g. JSON Schema 文件**：写 `docs-site/dev/reference/aap-json-schema.json`，前后端共用，可 codegen TypeScript / Python types（与 OpenAPI schema 并列发布）。

#### 工作量

| 模块 | 工时 |
|---|---|
| 后端 export adapter（复用 COCO export 逻辑） | 1.5d |
| 后端 import lenient 解析（§1.5 自然走这个） | 2d |
| JSON Schema 文件 + 文档 | 1d |
| 前端 ImportPredictionsModal（兼容 COCO + AAP JSON） | 0.5d |
| **合计** | **~5d** |

#### 优先级与触发

- **与 §1.5 Predictions Import 同窗口做最划算**：单做 Predictions Import 1.5d，合并做 5d，多 ~3.5d 但**为 §3.1 SDK + §3.4 Plugin + §2.5 项目快照 全员铺路**。
- 第一波（见 §8）就该做，越往后做 SDK / Plugin 越被迫定一个临时格式，到时再迁更贵。

#### 避免的反面

- ❌ 不要把 AAP JSON 设计成"COCO 加几个扩展字段"——LS 走过这条路，他们的 JSON 看着像 task 列表但语义和 COCO 互不兼容，client 库写起来痛苦。**设计为完全独立的 schema，与 COCO 平行**。
- ❌ 不要把 predictions 和 annotations 塞同一个数组用 `type` 字段区分。**两个数组分开放**。
- ❌ 不要用平台内部主键（`user_id` / `annotation_id` 数字 ID）当稳定标识符。导出时写内部 ID 用于审计可，但**导入匹配走 `external_id` + `file_path` + `schema_version` 三元组**保证跨实例可移植。

---

## 3. 生态扩面类（差异化竞争点）

### 3.1 公开 Python SDK + CLI

- **来源**：CVAT [`cvat-sdk`](../../cvat/cvat-sdk) + [`cvat-cli`](../../cvat/cvat-cli)。
- **现 ROADMAP**：L7 "公开 SDK"在 12 月+ 长期规划里。
- **建议升级到 P2**：SDK 是**客户决策物料**——大学实验室 / 初创公司在选标注工具时几乎都会问"有没有 Python SDK"。
- **零成本做法**：
  - FastAPI OpenAPI schema 已完整 → `openapi-python-client` 一键生成 typed client。
  - CLI 用 `typer` 包一层，覆盖 8 个动作：`login / project list/create / dataset push/pull / task list / annotation export / prediction import`。
  - 发到 PyPI（`ai-annotation-sdk` 包名占住）。
  - docs-site 加 `dev/sdk/` 一栏 + 3~5 个 Jupyter notebook 示例。
- **工作量**：3~4d（codegen + CLI + 文档）。
- **强依赖**：API schema 稳定性（当前已经够稳）。

### 3.2 Cloud Storage Sync（pull 模式）

- **来源**：Label Studio `io_storages` + CVAT `CloudStorage`。
- **平台现状**：上传只有 push 模式（用户从浏览器上传）。
- **价值**：客户场景"数据已经在我的 S3 bucket，不想再上传一遍"，**且数据合规上数据不离自家 bucket** 是企业客户硬需求。
- **设计**：
  - 新表 `external_storage_sources(id, project_id, provider, bucket, prefix, credentials_ref, sync_state, last_synced_at)`。
  - Celery beat 周期 list bucket → 差量同步：新增文件创 task，已删除文件软删 task。
  - 复用现有 StorageService 抽象。
- **工作量**：4~5d（S3 first，GCS/Azure 留扩展点）。
- **触发**：第一个企业客户提需求即做。

### 3.3 Datumaro 集成（中间格式 / 导入导出中转层）

- **来源**：CVAT 用 [`datumaro`](https://github.com/openvinotoolkit/datumaro) 做 25+ 格式适配的中转层。
- **现 ROADMAP**：导出格式靠自己实现 COCO/YOLO/VOC 三件套。
- **建议**：**不要自己加格式**。客户要 KITTI / MOT / DAVIS / Cityscapes / LabelMe 时，走"先导 COCO/JSON → 用 datumaro CLI 转"路径，文档里附 datumaro 命令模板。
- **进阶**：把 datumaro 装进 `apps/api` 作可选依赖，加 `POST /export?format=datumaro:kitti` 透传。
- **配合 §2.6**：转换链 `AAP JSON ↔ Datumaro internal ↔ { COCO, YOLO, VOC, KITTI, MOT, ... }`，AAP JSON 是 datumaro 链的原生输入源（无损），COCO/YOLO/VOC 是 datumaro 链的有损投影。
- **价值**：用 30 行代码换 20+ 格式支持，**不增加维护负担**。

### 3.4 Tool Plugin Registration（L7 公开 SDK 的具体接口形态）

- **来源**：CVAT Lambda + Nuclio（不要学，太重）；建议自创"webhook-only plugin"轻量形态。
- **设计**：
  ```json
  {
    "id": "custom-polygon-snap",
    "label": "智能贴边",
    "hotkey": "Alt+S",
    "applies_to": ["polygon"],
    "endpoint": "https://my-tool.example.com/snap",
    "input_schema": { "geometry": "polygon", "image_url": "string" },
    "output_schema": { "geometry": "polygon" }
  }
  ```
- **平台只做**：注册 manifest（JSON 粘贴）+ 工作台按 manifest 在工具栏加按钮 + 调用时发签名 POST → 拿结果落地标注。
- **客户负担**：自己 host HTTP 端点，自己升级。
- **价值**：开放生态又不背安全锅；和长期 L7 SDK 协同。
- **优先级**：P3，等第一个客户问"能不能加自定义工具" 再做。

---

## 4. 分析与观测类

### 4.1 Annotator Performance Dashboard

- **数据源已齐**：`task_events.duration_ms` + `mv_user_perf_daily` 物化视图 + §1.6 DuckDB 视图。
- **缺**：前端面板。
- **设计**：
  - super_admin / project_admin 可见的 `/admin/performance` 页面。
  - 维度：人均吞吐（task/h）/ 平均耗时分布（直方图）/ reject 率 / IAA（如已计算）/ 类别覆盖。
  - 时间筛选：今日 / 本周 / 本月 / 自定义 range。
  - 个人页 `/me/performance`：标注员看自己的趋势，对标团队平均线。
- **工作量**：3d（前端图表 + SQL）。
- **价值**：**付费决策项**。项目管理客户能据此发奖金 / 排红线，对标注员能据此自我改进。CVAT 有简版，LS Enterprise 才完整 —— **可做差异化**。

### 4.2 请求级 Trace ID（轻量 OpenTelemetry）

- **现状**：API / Celery / ML backend 三段日志没串起来。
- **建议**：
  - API 入口生成 `X-Trace-Id` UUID，贯穿 Celery task header + ML backend `/predict` header。
  - 三段日志都打 trace_id。
  - **暂不上 OTel collector**（运维负担太重）；先满足"按 trace_id grep 全链路日志"即可。
- **工作量**：1.5d。
- **升级路径**：未来需要分布式追踪时换 OTel exporter，trace_id 兼容。

### 4.3 ClickHouse 升级触发条件

- **观察项，不做**。
- 触发条件：`task_events` 单月行数 > 1000万 或 DuckDB 查询 > 10s。
- 之前先用 §1.6 DuckDB 顶。

---

## 5. LLM 时代差异化

### 5.1 LLM-as-Judge / Prompts 模块

- **来源**：Label Studio 新加的 [Prompts](https://github.com/HumanSignal/label-studio) 模块；Adala 项目。
- **场景**：
  - **Reject 原因建议**：reviewer reject 时 LLM 看一眼标注 + 图，给一个 `reject_reason_type` 候选 + 文字理由初稿。
  - **类别澄清助手**：标注员对某 task 不确定时，调 VLM 拿"这张图里 X 在哪 / 是不是 Y"的辅助回答。
  - **BugReport 聚类去重**：§B 已规划，本质是同一类 LLM 接入。
- **平台优势**：`PredictionMeta(prompt_tokens, completion_tokens, cost)` 已落，**成本追踪基建就绪**。
- **建议**：先做"reject 原因建议"作 MVP（与 §1.2 reject_reason_type 同窗口），LLM SDK 接入收口一次。
- **工作量**：MVP 2d（LLM SDK + 一个固定 prompt + reviewer UI 集成）。
- **优先级**：P2，因为这是**对标 LS Prompts 的关键差异化点**，做了能进 demo 视频。

### 5.2 Adala-style 主动学习闭环（MVP 形态）

- **来源**：Label Studio + Adala 项目的 agent loop。
- **现 ROADMAP**：L1/L2 主动学习闭环太抽象，没拆触发条件。
- **建议 MVP**：闭环打通**比效果调优更重要**。
  ```
  unlabeled pool
   → 调 ML backend 预测
   → uncertainty 排序写入 next_task 优先级
   → 标注员领取
   → 提交后入"已标注 pool"
   → 触发 webhook 给外部训练系统（Vertex / Sagemaker / 客户自托管）
   → 外部训练完成回调 ML backend 新版本注册
   → 回到第 1 步
  ```
- **平台只做前后两端**：webhook out + ml_backend 版本注册；**训练系统不内置**（避免和 §A "训练队列"占位绑死）。
- **工作量**：3d，前提是 §2.1 Webhook 已落。
- **价值**：能讲完整 "AI 辅助标注 → 模型迭代" 故事，对学术/AI lab 客户尤其。

---

## 6. 避坑清单（保持当前选择，不要走回头路）

这一节**不是 TODO**，而是 PR review 时的参考底线。

| 主题 | CVAT / LS 的坑 | 平台当前正确选择 | 何时检查 |
|---|---|---|---|
| Job 状态字段 | CVAT `Job.status`/`stage`/`state` 三字段并存（[models.py:1165](../../cvat/cvat/apps/engine/models.py)） | 单 status enum | 加新状态前看一眼是否能用现有 enum 表达 |
| Label Config | LS XML DSL 难维护、难校验 | JSONB `classes_config` + `attributes_schema` | 永远不要回退到 DSL，要灵活就扩 JSONB schema |
| Task 双重含义 | LS task 既是标注题目也是后台 job | 题目 / Celery 分离 | §1.7 async_jobs 落地后强化 |
| Django app 碎片 | LS 24+ apps 跨 module 依赖混乱 | apps/api 单仓 | 不要因为"模块化"动机拆出新 apps/* |
| Enterprise vs OSS 分叉 | LS `if settings.LABEL_STUDIO_EE` 满地 | 单分支无功能开关 | 商业化前不要拆 OSS/EE，灰度走 feature_flags |
| 格式适配膨胀 | CVAT 维护 25+ 格式适配 | COCO/YOLO/VOC 三件套 | 客户要新格式走 §3.3 datumaro，**不自己加** |
| 权限引擎 | CVAT Rego/OPA 学习成本高 | 单 RBAC 中间件 | 不引入 policy engine；权限复杂化时先看是否能在 RBAC 内表达 |
| AI backend 部署 | CVAT Nuclio 运维复杂 | HTTP `/predict` 协议 + 独立容器（ADR-0012） | 保持；§3.4 plugin 也走 HTTP |
| Skeleton 递归嵌套 | CVAT sublabel 无限递归实际很少用 | 当前无 skeleton 实现 | §C.7 I10 实现时**只支持 2 层**（label + sublabel），不开放任意嵌套 |
| Consensus 合并规则 | CVAT 用 Rego 配置 | 当前未实现 | §2.3 I19a 实现时用固定算法 + 阈值参数，不引入策略 DSL |

---

## 7. 与现 ROADMAP 的映射表

| 本文档条目 | 现 ROADMAP 状态 | 建议动作 |
|---|---|---|
| §1.1 Annotation Guide | **新增** | 回流到 §A "项目模块" 群（1 行钩子） |
| §1.2 reject_reason_type | **新增** | 回流到 §A "项目模块" 或 §B "可观测性" |
| §1.3 webhook event_version | **新增** | 与 §2.1 合并到一份 ADR 草案 |
| §1.4 截图 fixture | 已在 §A 后续观察项 | 不动 |
| §1.5 Predictions Import | **新增** | 回流到 §A "AI / 模型" 群 |
| §1.6 DuckDB 离线视图 | **新增** | 回流到 §B "可观测性" |
| §1.7 async_jobs 统一表 | **新增** | 回流到 §B "性能 / 扩展"，注明"早做收益越大" |
| §2.1 Webhook 系统 | §B 治理/合规 有 1 句话 | **升级范围**：拆独立 epic + ADR-0018 草案 |
| §2.2 AnnotationFeedback 收敛 | §C.7 I18 仅图片侧 | **升级范围**：从 I18 扩为统一模型收敛任务 |
| §2.3 Consensus / GT 拆分 | §C.7 I19 是 L 体量打包 | **升级范围**：建议 I19a/I19b 拆分 |
| §2.4 Tracker 协议层 | §C.5 R23 + §C.7 I20.4 散落 | **升级范围**：R23 前置协议统一 |
| §2.5 项目规则版本化 | **新增** | 回流到 §A "数据 & 存储" 或长期规划 |
| §2.6 平台原生 AAP JSON | **新增** | 与 §1.5 合并回流到 §A "AI / 模型"（单 bullet 同窗口） |
| §3.1 公开 SDK + CLI | 长期规划 L7（12 月+） | **优先级升级**：建议从 L7 提升到 P2 |
| §3.2 Cloud Storage Sync | **新增** | 回流到 §A "数据 & 存储"，触发=企业客户需求 |
| §3.3 Datumaro 集成 | **新增** | 写入 §A "导出" 子节（如有），或新增 |
| §3.4 Tool Plugin 注册式 | 长期规划 L7 | **细化**：作 L7 的具体接口形态备忘 |
| §4.1 Annotator Dashboard | **新增** | 回流到 §B "可观测性"，标"付费决策项" |
| §4.2 Trace ID | **新增** | 回流到 §B "测试 / 开发体验" |
| §4.3 ClickHouse 升级 | **新增** | 回流到 "等业务规模触发" 区块 |
| §5.1 LLM-as-Judge | §B Bug 反馈 LLM 聚类是同源 | **升级范围**：扩为 LLM SDK 接入统一窗口（聚类 / reject 建议 / 类别澄清） |
| §5.2 主动学习闭环 MVP | 长期规划 L1/L2 抽象 | **细化**：作 L1/L2 的 MVP 形态备忘，依赖 §2.1 Webhook |
| §6 避坑清单 | 散落于各处 | **新增**：在 ROADMAP.md 末尾或单独维护"决策底线"备忘 |

---

## 8. 建议的回流节奏

不一次性全部回流，按下面三波推进，每波收尾后再评估下一波：

**第 1 波（v0.11 内开工）**：§1.1 Annotation Guide / §1.2 reject_reason_type / §1.5 Predictions Import / §1.7 async_jobs。
**特征**：低风险、低工作量、高可见价值；落地后给后续大项铺基建。

**第 2 波（v0.11 中后期）**：§2.1 Webhook 系统 / §2.2 AnnotationFeedback 收敛 / §3.1 公开 SDK。
**特征**：协议层 + 生态扩面；做完平台从"内部工具"升级为"可对外集成的产品"。

**第 3 波（v0.12+）**：§2.3 Consensus / §4.1 Annotator Dashboard / §5.1 LLM-as-Judge。
**特征**：差异化竞争点；前提是前两波铺好基建。

> **注**：以上节奏未做价值/成本量化评估，只是基于依赖关系的合理顺序。具体排期以客户反馈和业务优先级为准。
