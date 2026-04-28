# Label Studio:通用框架的天花板

> 拆分自《AI标注平台深度调研报告》§2.1

**仓库**:`HumanSignal/label-studio`（Star 22k+,周活跃,develop 分支日提交）

## 2.1.1 核心架构

LS 是 **Django + DRF 后端** + **多 React 应用前端**（monorepo,nx 管理）。后端被拆成 24+ 个 Django app,职责非常正交:

```
label_studio/
├─ organizations/       # 多租户根:Organization + OrganizationMember
├─ users/               # 用户、Profile
├─ projects/            # 项目、ProjectMember、ProjectOnboarding、ProjectSummary
├─ tasks/               # Task / Annotation / Prediction / TaskLock / AnnotationDraft / PredictionMeta / FailedPrediction
├─ ml/                  # MLBackend 表 + HTTP 客户端
├─ ml_models/           # 内置模型库注册
├─ ml_model_providers/  # 模型供应商抽象(OpenAI/Anthropic/Vertex/Azure...)
├─ data_import/         # 数据导入
├─ data_export/         # 数据导出(支持 COCO/VOC/YOLO/...)
├─ data_manager/        # 数据管理(过滤、视图、批量操作)
├─ io_storages/         # 多源存储(S3/GCS/Azure/Redis/Local)
├─ labels_manager/      # 标签管理
├─ webhooks/            # 事件 webhook
├─ jwt_auth/            # JWT 认证
├─ session_policy/      # 会话策略(超时/IP)
├─ feature_flags.json   # 特性开关(LSE 与 OSS 共用此机制)
└─ fsm/                 # 有限状态机基类
```

## 2.1.2 数据模型（精华全在这）

LS 把"标注"和"预测"分成两张完全独立的表,这是**最关键的架构决定**:

```python
# tasks/models.py 节选
class Task:
    project, is_labeled, overlap, total_annotations, total_predictions,
    precomputed_agreement, comment_count, file_upload, inner_id

class TaskLock:                       # 防止两人同时标同一题
    task, expire_at, user, unique_id

class Annotation:                     # 人工标注
    task, project, completed_by, was_cancelled, ground_truth, lead_time,
    parent_prediction,                # 关键:从哪个预测来的
    parent_annotation,                # 关键:复制自哪个标注(多人标注链)
    last_action, last_created_by, draft_created_at, result_count

class AnnotationDraft:                # 自动保存草稿
    task, annotation, user, was_postponed

class Prediction:                     # 模型预测(独立表!)
    task, project, score, model_version,
    model,                            # FK 到 ML 模型库
    model_run,                        # FK 到一次推理任务
    cluster,                          # 用于 active learning 的聚类标记
    mislabeling                       # 误标分数

class PredictionMeta:                 # LLM 时代的灵魂
    prediction, failed_prediction,
    inference_time,
    prompt_tokens_count, completion_tokens_count, total_tokens_count,
    prompt_cost, completion_cost, total_cost,
    extra (JSON)

class FailedPrediction:               # 失败也记录
    message, error_type, ml_backend_model, model_version, model_run, project, task
```

**这套模型解决了什么**:
- 多模型多版本对同一任务的预测都能保留并对比
- 人工标注可以"派生自某个 Prediction"（`parent_prediction`）,便于做 AI 接管率分析
- 多人交叉标注通过 `parent_annotation` 链表追踪
- LLM 推理的 token / 成本/失败完整回溯——这是企业版能算账的基础
- `cluster` + `mislabeling` 是 active learning 排序的物理基础

## 2.1.3 ML Backend:模型 = 远端 HTTP 服务

```python
class MLBackend(models.Model):
    state          # CONNECTED / DISCONNECTED / ERROR / TRAINING / PREDICTING
    is_interactive # 是否支持交互式标注(SAM 那种)
    url            # 模型服务的 URL
    auth_method    # NONE / BASIC_AUTH
    project        # 关联到哪个项目
```

调用约定（`ml/api_connector.py`）:

```
POST {url}/predict           — 批量推理
POST {url}/predict/test      — 测试一条
POST {url}/train             — 触发训练
GET  {url}/health            — 健康检查
GET  {url}/setup             — 取参数 schema
GET  {url}/versions          — 模型版本列表
GET  {url}/job_status        — 异步任务状态
POST {url}/webhook           — 事件回调(标注完成时)
```

**抽象的好处**:
- 任何语言/框架的模型都能接入,只要实现这几个 REST 接口
- LS 提供官方 `label-studio-ml-backend` SDK 把 PyTorch/TF/HF 模型一键封装成 ML Backend
- 训练 / 预测 / 健康 用不同超时配置（`ML_TIMEOUT_TRAIN=30s`,`ML_TIMEOUT_PREDICT=100s`）
- `is_interactive=True` 的 backend 暴露 `interactive-annotating` 端点,前端鼠标点一下就调一次

## 2.1.4 Next-Task 调度:6 策略链（精彩）

`label_studio/projects/functions/next_task.py` ~600 行,是整个项目最聪明的代码。流程:

```
prepared_tasks
  → 排除当前用户已标过 / postponed 草稿
  → 分支 1:LSE 的低一致性优先(若启用 agreement_threshold)
  → 分支 2:LSE 的评估窗口(GT 题目检测新人能力)
  → 分支 3:常规 → is_labeled=False

→ 是否有 dm_queue(用户在数据管理器里手动选的)→ 直接用第一条

→ 是否有锁定的任务?有则继续上次

→ 多人标注,且 prioritize_low_agreement → 低一致性优先

→ 是否需要 GT 引导(新标注员)→ Onboarding GT 队列

→ 多人交叉(maximum_annotations > 1)→ Breadth-first(每题凑够 N 人)

→ Show overlap first → 优先做需要交叉验证的

→ 三选一采样:
   ├─ Sequence(顺序)
   ├─ Uncertainty(模型分数低 + cluster 多样性二维排序)
   └─ Uniform(随机)

→ Postponed Drafts 队列(用户搁置过的)
→ Skipped 队列(用户跳过过的)
→ 加锁、记录 stream_history、返回
```

`Uncertainty` 实现非常巧:

```python
def _try_uncertainty_sampling(...):
    task_with_predictions = tasks.filter(predictions__model_version=project.model_version)

    # 统计当前用户已经标过的"聚类",做"未覆盖优先"
    user_solved_clusters = Counter(
        prepared_tasks.filter(pk__in=user_solved).annotate(cluster=Max('predictions__cluster'))
        .values_list('cluster', flat=True)
    )

    # 二维排序:已解决次数最少的 cluster 优先 → 模型分最低优先
    possible_next_tasks = task_with_predictions.annotate(
        cluster_num_solved=Case(*cluster_num_solved_map, default=0)
    ).order_by('cluster_num_solved', 'predictions__score')

    # 多人协作时随机抽 top-N 之一,避免冲突
    if num_annotators > 1:
        next_task = _get_random_unlocked(possible_next_tasks, user, upper_limit=min(num_annotators+1, ...))
```

**为什么强**:既不会陷入"全都标同类难例"的退化,也照顾了多人不冲突。LSE 还在外面套了一层"低一致性优先",把质量管理嵌入调度。
