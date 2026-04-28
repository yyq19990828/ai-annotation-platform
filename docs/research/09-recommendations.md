# 给 `ai-annotation-platform` 的具体借鉴建议

> 拆分自《AI标注平台深度调研报告》§6

> 你已经有的（JWT/RBAC/Alembic/前后端联调/设计系统/三页面）做得很扎实,这些不要改。下面**只列差距和优先级**。

## 6.1 数据模型重构（P0 — 越早做越好）

**当前 4 张表 → 建议扩展到 ~12 张**:

```python
# 新增
organizations             (id, name, slug, contact_info, ...)
organization_members      (org_id, user_id, role, joined_at, deleted_at)

# 改造 projects
projects.organization_id  FK
projects.label_config     JSONB  # 标签schema(支持多种类型混标)
projects.sampling         enum   # sequence/uncertainty/uniform
projects.maximum_annotations  int  # 多人交叉数
projects.overlap_cohort_percentage  int
projects.show_overlap_first  bool
projects.model_version    str
projects.task_lock_ttl    int  # 任务锁超时秒数

# 改造 tasks(关键)
tasks.is_labeled          bool index
tasks.overlap             int  # 这一题需要几人标
tasks.total_annotations   int  # 已标人数
tasks.precomputed_agreement float

# 新增
task_locks                (task_id, user_id, expire_at, unique_id)
annotation_drafts         (task_id, user_id, data, was_postponed, ...)

# 改造 annotations
annotations.parent_prediction_id  FK 关键
annotations.parent_annotation_id  FK 关键
annotations.lead_time     float  # 标注耗时
annotations.was_cancelled bool
annotations.ground_truth  bool

# 新增 - 模型与预测拆开
ml_backends               (id, project_id, name, url, state, is_interactive, auth_method, auth_token, ...)
predictions               (id, task_id, ml_backend_id, model_version, score, geometry, class_name, cluster, mislabeling, created_at)
prediction_metas          (prediction_id, inference_time, prompt_tokens, completion_tokens, prompt_cost, completion_cost, total_cost, extra)
failed_predictions        (id, ml_backend_id, task_id, error_type, message, created_at)

# 新增 - 协同/审计
audit_logs                (id, org_id, user_id, action, target_type, target_id, payload, ip, ua, created_at)
webhook_endpoints         (id, org_id, url, secret, events, is_active)

# 新增 - 存储
storages                  (id, org_id, type, config, credentials_encrypted)
# tasks.file_path → tasks.storage_id + tasks.storage_key
```

**为什么这么改**:

- `predictions` 独立后,你可以**多模型对比同一任务**、记录 token 成本、做 active learning 排序
- `parent_prediction` 让"AI 接管率"统计精确
- `task_locks` 让多人协同不打架
- `audit_logs` 是合规底线

## 6.2 ML Backend 抽象（P0 — 跟数据模型一起做）

**抄 LS 的协议,落到你的 FastAPI**:

```python
# apps/api/app/services/ml/backend_client.py
class MLBackendClient:
    def __init__(self, backend: MLBackend):
        self.url = backend.url
        self.timeout = backend.timeout or 100

    async def health(self) -> bool: ...
    async def predict(self, tasks: list[Task]) -> list[PredictionResult]: ...
    async def predict_interactive(self, task: Task, context: dict) -> PredictionResult: ...
    async def setup(self) -> ModelSchema: ...

# apps/api/app/api/v1/ml.py
@router.post("/ml-backends")          # CRUD
@router.post("/ml-backends/{id}/predict-test")
@router.post("/ml-backends/{id}/interactive-annotating")  # SAM 用
@router.post("/projects/{id}/preannotate")  # 触发批量预标
```

**模型服务侧**:用官方 `label-studio-ml-backend` 包做参考实现（MIT,可借鉴）,自己写一个简化版:

```python
# 你的模型服务(单独 FastAPI)
@app.post("/predict")
async def predict(req: PredictRequest):
    # 加载 GroundingDINO+SAM2 / DEIMv2(你已有的)
    results = []
    for task_data in req.tasks:
        image = load(task_data.image_url)
        boxes = grounding_dino(image, prompt=req.prompt)
        masks = sam2(image, boxes=boxes)
        results.append({
            "task": task_data.id,
            "result": [{...}],
            "score": ...,
            "model_version": "v0.1"
        })
    return {"results": results}
```

**这一步对你最有价值的副产品**:你的 `Grounded-SAM-2` / `DEIMv2` repo 可以**当成 ML Backend 部署**,马上和标注平台联动。

## 6.3 交互式标注（P1 — 跟 Workbench 体验最相关）

你 Workbench 已经有"AI 预标框 + 用户确认框"的视觉,但点击产生预标的链路缺失。

**最小实现**:

```typescript
// apps/web/src/pages/Workbench/hooks/useInteractiveAI.ts
export function useInteractiveAI(taskId: string, projectId: string) {
  const mutation = useMutation({
    mutationFn: async (context: {type: 'rect'|'point', value: any}) => {
      return apiClient.post(`/projects/${projectId}/ml-backends/interactive`, {
        task: { id: taskId },
        context
      })
    }
  })
  return { predict: mutation.mutateAsync, isLoading: mutation.isPending }
}

// 在画布上:
onMouseUp={(e) => {
  const rect = computeRect(startPoint, e)
  predict({ type: 'rect', value: rect }).then(result => {
    addPendingAnnotation(result)  // 紫色虚线
  })
}}
```

**后端**:

```python
@router.post("/projects/{id}/ml-backends/interactive")
async def interactive(...):
    # 路由到当前项目配置的 is_interactive=True 的 ML backend
    backend = await get_interactive_backend(project_id)
    result = await MLBackendClient(backend).predict_interactive(task, context)
    # 不立即落 Annotation,只返回给前端
    return result
```

## 6.4 Active Learning 调度（P2 — 数据量起来了再做）

直接抄 LS 的 `next_task.py` 简化版:

```python
# apps/api/app/services/scheduler.py
async def get_next_task(user, project, db):
    candidates = (
        select(Task)
        .where(Task.project_id == project.id, Task.is_labeled == False)
        .where(~Task.id.in_(user_already_annotated_subq))
    )

    # 多人交叉
    if project.maximum_annotations > 1:
        candidates = candidates.where(Task.total_annotations < project.maximum_annotations)

    # uncertainty
    if project.sampling == 'uncertainty':
        candidates = candidates.join(Prediction).order_by(
            Prediction.cluster_solved_count.asc(),  # 物化视图维护
            Prediction.score.asc()
        )
    elif project.sampling == 'sequence':
        candidates = candidates.order_by(Task.sequence_order)
    else:  # uniform
        candidates = candidates.order_by(func.random())

    # 加锁
    next_task = await db.scalar(candidates.limit(1))
    if next_task:
        await create_or_extend_lock(next_task, user)
    return next_task
```

## 6.5 Agent 流水线（P3 — 你的研究兴趣点）

**推荐路径**:

1. **第一步**:把 Adala 当**外部服务**接进来,不要 fork 进自己 repo
   - 部署一个 Adala server（FastAPI + Kafka + Redis）
   - 通过 ML Backend 协议接入（自己写一个 adapter,把 Adala 的 batch_inference 包装成 `/predict`）

2. **第二步**:写自己的 Skill
   - Skill 1: GroundingDINO 文本检测
   - Skill 2: SAM2 精细分割
   - Skill 3: VLM Judge（GPT-4V / Qwen2.5-VL）判断质量
   - Skill 4: 落库分流（高置信度 auto_accept,低置信度送人工）

3. **第三步**:HITL 闭环
   - 每个 Skill 输出落 `predictions` 表,带 `pipeline_stage`
   - 人工修订后,把 diff 喂回去做 prompt improvement（Adala 自带 `prompt_improvement.py` 技能）

**别一开始就做的**:
- 自己实现 Agent 框架（用 Adala 或 Refuel 即可）
- 在 Web 端跑 LLM（慢、贵,放服务端）

## 6.6 工程化补强（P1 — 跟 P0 同步推）

| 项 | 怎么做 | 优先级 |
|---|---|---|
| Presigned URL 上传 | minio-py 的 `get_presigned_url("PUT")` + 前端 PUT | P1 |
| Celery + Redis | 已有 Redis,Celery 4.x 直接接,worker 单独 docker service | P1 |
| WebSocket | FastAPI 自带 + Redis Pub/Sub 跨 worker | P1 |
| 数据导出 | COCO/VOC/YOLO 三个 exporter,共同基类,异步 Celery 跑 | P1 |
| 审计日志 | SQLAlchemy event listener + 异步写入 | P2 |
| Webhook 出口 | 简单实现:saved 后异步 POST 给注册的 endpoint | P2 |
| Helm Chart | 跟 Docker Compose 同步维护 | P3 |
| i18n | react-i18next + 后端枚举抽出 messages | P2 |

## 6.7 你已有的技术资产可以怎么用

看了你的 GitHub:

- **`Grounded-SAM-2`** → 直接包成你平台的"通用检测+分割" ML Backend,主推 mode B（交互式）
- **`DEIMv2`** → 包成专项检测 ML Backend（已经有 ONNX 友好的实现）
- **`HyperLPR3`、`chinese_license_plate_generator`、`2D_scripts`** → 车牌 OCR 是你最熟悉的场景,这块可以做成**第一个 vertical 模板**:
  - 项目模板:license_plate_ocr
  - 内置标签 schema:车牌区域 bbox + 车牌号文本
  - 内置 ML Backend:HyperLPR3
  - 内置导出器:你 `2D_scripts` 里的多线程下载工具的反过程
- **`lite.ai.toolkit`** → 一些轻量推理可以集成进 ML Backend SDK 中
