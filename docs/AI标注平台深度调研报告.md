# AI 标注平台深度调研报告

> 面向 CV(图像 / 视频)生产级私有部署平台。聚焦"模型预标注 + 人工校正"与"Agent 自动化标注流水线"两大方向。
>
> 对标基准:`yyq19990828/ai-annotation-platform` v0.2.0(2026-04-27)
>
> 调研者:Claude · 调研日期:2026-04-27

---

## 0. 摘要(给赶时间的人)

调研了 4 个**仍在活跃迭代**的开源平台 + 5 个商业产品的最新动向:

| 维度 | 你 (v0.2.0) | Label Studio | CVAT | X-AnyLabeling | Adala |
|---|---|---|---|---|---|
| 形态 | Web 全栈 | Web 全栈(Django) | Web 全栈(Django) | 桌面端 + 远程服务 | LLM Agent 框架 |
| AI 模型集成 | 字段占位 | HTTP MLBackend 抽象 | Nuclio Serverless | 本地 ONNX + 远程 server | Skill / Runtime / LiteLLM |
| 数据模型层级 | User/Project/Task/Annotation(4 张表) | + Org / Pred / TaskLock / Draft / PredMeta(20+ 张) | + Job / Segment / Track / GT(20+ 张) | 文件级,无后端 | Skill 注册表 |
| Active Learning | 未实现 | uncertainty + cluster 采样 | 通过 Job stage 流转 | 阈值过滤 | LLM judge + 反馈 |
| 视频/Tracking | 未实现 | 弱(主要图像) | **强**(LabeledTrack/TrackedShape) | SAM2 视频 | 不适用 |
| 质检 / 一致性 | 未实现 | LSE 才有 IAA + 低一致性队列 | quality_control + consensus 模块 | 无 | LLM judge |
| LLM/Agent | 无 | 通过 Adala 衔接 | AI Agents (2024-2025) | Florence2/Gemini API | 原生 |
| Cost tracking | 无 | **PredictionMeta 含 token cost** | 无 | 无 | runtime cost estimate |

**最值得抄给你 repo 的 5 件事**(后面有详细说明):

1. **把 Annotation 和 Prediction 拆成两张表**——你现在用 `source` 字段区分 `human / ai / ai-accepted`,会在多模型/多版本场景立刻爆掉
2. **抽象出 `MLBackend` 表,模型即 HTTP 服务**——LS 把模型当远端 REST 服务的设计是教科书级
3. **加 `TaskLock` + `is_labeled` + `overlap`**——分布式标注必备,缺一个就出脏数据
4. **`PredictionMeta` 记录 token cost / 推理耗时**——LLM 时代,谁不记账谁亏钱
5. **任务调度抽象成 `next_task` 策略链**——你 Workbench 现在是按 ID 顺序取的,这块直接抄 LS 的 6 策略链最快

---

## 1. 调研范围与方法

### 1.1 入选标准

- **仍在活跃迭代**(2025-2026 年有 release / 商业更新)
- **CV 优先**(图像 / 视频 / 检测 / 分割 / 追踪)
- **AI 能力是产品核心而非附属**
- 至少能拉到源码或者有详细公开文档

### 1.2 入选名单与定位

| 平台 | 类型 | 定位 | 调研深度 |
|---|---|---|---|
| **Label Studio** (HumanSignal) | 开源 + 企业版 | 通用全栈 + 配置驱动 | **源码深读** |
| **CVAT** (CVAT.ai) | 开源 + 企业版 | CV 专用,视频追踪强 | **源码深读** |
| **X-AnyLabeling** (CVHub520) | 纯开源 | 桌面端 SAM/foundation 模型 | **源码深读** |
| **Adala** (HumanSignal) | 纯开源 | LLM Agent 标注框架 | **源码深读** |
| Roboflow | 商业 | 一站式 + Universe 模型市场 | 文档分析 |
| Encord | 商业 | 数据策展 + SAM2 + GPT-4o | 文档分析 |
| V7 Darwin | 商业 | 医疗影像 + 视频 + SAM3 | 文档分析 |
| Refuel Autolabel | 开源库 | LLM 批量标注(NLP 主) | 文档分析 |
| Argilla | 开源(HF) | LLM/NLP 数据策展 | 文档分析 |

> 商业平台:无法拉到源码,基于公开文档与博客分析其暴露出来的工作流和能力点。

---

## 2. 平台深度拆解

### 2.1 Label Studio:通用框架的天花板

**仓库**:`HumanSignal/label-studio`(Star 22k+,周活跃,develop 分支日提交)

#### 2.1.1 核心架构

LS 是 **Django + DRF 后端** + **多 React 应用前端**(monorepo,nx 管理)。后端被拆成 24+ 个 Django app,职责非常正交:

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

#### 2.1.2 数据模型(精华全在这)

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
- 人工标注可以"派生自某个 Prediction"(`parent_prediction`),便于做 AI 接管率分析
- 多人交叉标注通过 `parent_annotation` 链表追踪
- LLM 推理的 token / 成本/失败完整回溯——这是企业版能算账的基础
- `cluster` + `mislabeling` 是 active learning 排序的物理基础

#### 2.1.3 ML Backend:模型 = 远端 HTTP 服务

```python
class MLBackend(models.Model):
    state          # CONNECTED / DISCONNECTED / ERROR / TRAINING / PREDICTING
    is_interactive # 是否支持交互式标注(SAM 那种)
    url            # 模型服务的 URL
    auth_method    # NONE / BASIC_AUTH
    project        # 关联到哪个项目
```

调用约定(`ml/api_connector.py`):

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
- 训练 / 预测 / 健康 用不同超时配置(`ML_TIMEOUT_TRAIN=30s`,`ML_TIMEOUT_PREDICT=100s`)
- `is_interactive=True` 的 backend 暴露 `interactive-annotating` 端点,前端鼠标点一下就调一次

#### 2.1.4 Next-Task 调度:6 策略链(精彩)

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

---

### 2.2 Adala:LLM Agent 标注框架

**仓库**:`HumanSignal/Adala`(Star 1.3k+,月度更新)

#### 2.2.1 核心抽象

Adala 不是一个标注 UI,而是一个**让 LLM 跑标注流水线**的框架。核心 4 个抽象:

```
Agent
 ├─ skills: SkillSet(技能集合,可线性 / DAG 编排)
 │           ├─ Skill (单个能力,最小单元)
 │           │   - name / instructions / input_template / output_template
 │           │   - response_model: Type[BaseModel]  ← Pydantic 严格输出 schema
 │           │   - field_schema: JSON schema
 │           ├─ TransformSkill / SampleSkill / SynthesisSkill
 │           └─ collection/  # 内置技能库:
 │              - classification / entity_extraction / qa / rag / summarization
 │              - translation / ontology_creation / prompt_improvement
 │              - **label_studio.py** ← 把 LS 的 XML 配置自动转成 Pydantic 模型
 ├─ runtimes: Dict[str, Runtime]
 │           ├─ OpenAIChatRuntime
 │           ├─ AsyncLiteLLMRuntime  # 接 100+ 模型供应商
 │           └─ AsyncLiteLLMVisionRuntime  # 多模态
 ├─ memories: Memory  # 长期记忆(向量库)
 ├─ environments: Environment  # 数据来源 + 反馈通道
 │           ├─ StaticEnvironment (DataFrame)
 │           ├─ AsyncEnvironment
 │           └─ servers/discord_bot.py 等
 └─ teacher_runtimes  # 用更强模型当老师改进 prompt
```

#### 2.2.2 LabelStudioSkill:衔接的精华

```python
class LabelStudioSkill(TransformSkill):
    label_config: str = "<View></View>"   # 拿 LS 的标签 XML
    allowed_control_tags: Optional[list[str]]
    allowed_object_tags: Optional[list[str]]

    @cached_property
    def label_interface(self) -> LabelInterface:
        return LabelInterface(self.label_config)  # 解析 XML

    # 自动从 XML 生成 Pydantic 模型 → LLM 必须输出符合该 schema 的 JSON
    # 通过 instructor / outlines 这种结构化输出库强制约束
```

**为什么强**:LS 用户不需要再单独写一份 prompt 和输出格式,把"配的标签界面"自动变成"LLM 必须遵守的输出 schema"。这就是同一个 owner(HumanSignal)做产品的协同优势。

#### 2.2.3 Server 部署形态

`server/app.py`:

```
FastAPI
 ├─ /worker_pool/*    (Worker 池管理 API)
 ├─ /infer/stream     (Kafka 流式推理)
 └─ ...

异步推理链:
   Client → FastAPI → Kafka topic (input)
                    → Celery worker(Adala Agent.run)
                    → Kafka topic (output)
                    → ResultHandler(LS webhook / file / stdout)
```

**生产化设计要点**:
- Kafka 解耦推理请求和工作器,便于水平扩展
- Celery worker 设置 `worker_max_memory_per_child` 防 LLM 内存泄漏
- Redis 既做 Celery broker 又做 worker pool 状态
- LiteLLM 兼容 100+ 供应商,切换模型不改代码
- `CostEstimate` 在跑之前预估 token 成本

---

### 2.3 CVAT:CV 专用,视频追踪强

**仓库**:`cvat-ai/cvat`(Star 13k+,develop 分支高频)

#### 2.3.1 三层任务结构(VAT 比 LS 复杂的核心)

```
Project
  └─ Task (mode=annotation/interpolation,dimension=2D/3D)
      ├─ Data         (raw 媒体存储 + 解码参数)
      ├─ Segment      (按帧切片,start_frame ~ stop_frame)
      │   └─ Job      (一个"工单",分配给一个标注员)
      │       - stage(annotation / validation / acceptance)
      │       - state(new / in progress / completed)
      │       - type(annotation / ground_truth / consensus_replica)
      │       - parent_job  ← 共识标注的父-子关系
      └─ ValidationParams / ValidationLayout / ValidationFrame  ← GT 验证子集
```

**为什么这么分**:
- 一个视频几千帧不能给一个人,要按 `Segment` 切,每个 `Job` 一段
- `Job.stage` 表达"标注 → 复核 → 验收"的工序流(比 Annotation 上的 `is_labeled` 更严)
- `parent_job` 让"共识标注"(同一段给 3 个人独立标然后合并)成为头等公民
- `ValidationFrame` 把"金标题"嵌入正常工作流(检验标注员)

#### 2.3.2 标注模型(支持视频追踪)

```python
class Annotation:                # 抽象基类
    job, label, frame, group, source

class LabeledImage(Annotation):  # 整图标签(分类)
class LabeledShape(Annotation, Shape):  # 单帧形状(检测/分割)
    parent      # 复合形状(skeleton 关键点)
    score       # 模型置信度

class LabeledTrack(Annotation):  # 跨帧轨迹(视频跟踪!)
    parent

class TrackedShape(Shape):       # 轨迹中的某一帧关键帧
    track, frame, occluded, outside, z_order

class Skeleton:                  # 姿态:Label 树(根+子节点+SVG)
class AttributeSpec:             # 标签的属性(颜色/材质/...)
class AttributeVal:              # 该属性的值
```

**视频追踪的实现**(LS 没这么干):
- `LabeledTrack` 存"对象一生"
- `TrackedShape` 存关键帧位置
- 中间帧由前端**线性插值**,标注员只标关键帧
- `outside` 字段表示对象暂时离开画面

#### 2.3.3 AI 集成的两条路:Nuclio + AI Agents

**老路:Nuclio Serverless(2018-2023)**

```
serverless/{framework}/{org}/{model}/nuclio/function.yaml
  例:serverless/pytorch/facebookresearch/sam/nuclio/function.yaml

每个模型一个 Nuclio function:
  - 独立 Docker 镜像
  - 独立 HTTP trigger
  - 标注:type=interactor / detector / tracker / reid
  - 元数据:min_pos_points, startswith_box_optional 等指导前端 UI
```

`cvat/apps/lambda_manager/views.py` 里 `LambdaGateway` 类,转发请求到 Nuclio 集群:`/api/functions/{name}/invoke`。

**新路:CVAT AI Agents(2024-2025 推出,主推)**

不再要求模型部署成 Nuclio function,而是:
1. 用户写一个 Python 模块(用 cvat-sdk)
2. 用 CLI `cvat-cli function register` 把元数据注册到 CVAT(不上传代码/权重)
3. 用户在自己的 GPU 机器上跑 `cvat-cli agent` 进程
4. 这个 agent 进程**反向连接**到 CVAT,从队列拉任务、跑模型、回写结果

**为什么这么改**:
- 模型权重永远不离开用户机器(隐私 / 合规)
- 用户不用懂 Nuclio / Knative
- agent 可以用任何 GPU/CPU/MPS,不需要在 K8s 集群里
- 2.31.0 起支持 attributes,2.32.0 起支持 skeleton

#### 2.3.4 质量保证(LS 企业版才有的,CVAT 开源就有)

```
cvat/apps/quality_control/
  ├─ models.py           # QualityReport / AnnotationConflict / QualitySettings
  ├─ quality_reports.py  # 报告生成
  ├─ statistics.py       # 各种指标
  └─ schema.py

cvat/apps/consensus/
  ├─ models.py           # ConsensusSettings (iou_threshold)
  ├─ intersect_merge.py  # 多人标注合并算法
  └─ merging_manager.py
```

`QualitySettings`:
```python
iou_threshold, oks_sigma, line_thickness, low_overlap_threshold,
point_size_base, compare_line_orientation, panoptic_comparison
```

跑出 `QualityReport` → 一堆 `AnnotationConflict`(每个冲突按 frame 定位,标记类型 / 严重度)。

**这是 CVAT 比 LS 开源版强的点**——LS OSS 没有 IAA,要 LSE 才有。

---

### 2.4 X-AnyLabeling:桌面端 SAM 工厂

**仓库**:`CVHub520/X-AnyLabeling`(Star 6k+,周活跃,中文社区氛围浓)

#### 2.4.1 不是平台,是"模型集成器"

X-AnyLabeling 是 PyQt6 桌面应用(LabelMe 的 fork 演化)。**它对你最有参考价值的不是架构,是模型适配代码**。

`anylabeling/services/auto_labeling/` 下塞了 **184 个模型 yaml 配置 + ~50 个适配类**:

```
SAM 系列:    segment_anything / segment_anything_2 / segment_anything_2_video
            segment_anything_3 / sam_hq / sam_med2d / sam_onnx
            edge_sam / efficientvit_sam
GroundingX:  grounding_dino / grounding_sam / grounding_sam2 / grounding_dino_api
检测/分割:   damo_yolo / dfine / deimv2 / rtdetr / rtdetrv2 / u_rtdetr / rfdetr
            doclayout_yolo / clrnet
分类/属性:   internimage_cls / pulc_attribute / ram
深度估计:    depth_anything / depth_anything_v2
姿态:        rtmdet_pose / pose/...
OCR:         ppocr_v4 / ppocr_v5
追踪:        trackers/...
多模态/通用: florence2 / open_vision / upn / geco / rmbg
远程 API:    grounding_dino_api / remote_server
```

#### 2.4.2 ModelManager 抽象——值得抄

```python
class ModelManager(QObject):
    # 信号(事件)
    new_model_status / model_loaded / new_auto_labeling_result
    auto_segmentation_model_selected / unselected
    prediction_started / finished
    download_progress / download_finished

    # 能力标志位(每个模型自己声明)
    _AUTO_LABELING_MARKS_MODELS         # 支持点 / 框作为 prompt
    _AUTO_LABELING_API_TOKEN_MODELS     # 需要 API token
    _AUTO_LABELING_RESET_TRACKER_MODELS # 支持 tracker reset
    _AUTO_LABELING_CONF_MODELS          # 支持置信度阈值
    _AUTO_LABELING_IOU_MODELS
    _AUTO_LABELING_MASK_FINENESS_MODELS
    _AUTO_LABELING_CROPPING_MODE_MODELS
    _AUTO_LABELING_PREFER_EXISTING_ANNO
    _AUTO_LABELING_PROMPT_MODELS        # 支持文本 prompt
    _ON_NEXT_FILES_CHANGED_MODELS       # 跨文件追踪需要预热

    def predict_shapes(self, image, ...):
        """统一入口,根据当前模型路由到具体实现"""
```

**精华**:把"模型可以做什么"用**能力位**而不是 if-else 表达,前端 UI 根据当前模型的能力位**动态显示/隐藏控件**(置信度滑块、IoU 滑块、prompt 输入框)。

#### 2.4.3 远程模式:RemoteServer

```python
class RemoteServer(Model):
    server_url = settings.get("server_url", env "XANYLABELING_SERVER_URL")
    predict_url = f"{server_url}/v1/predict"
    headers = {"Token": api_key}

    # POST {predict_url} { image: base64, marks: [...], ... }
```

桌面端不一定要本地装 PyTorch,可以连远程推理服务。**这套协议比 LS 的 ML Backend 更简单**(没有训练、没有 webhook),适合"只做推理"的场景。

---

### 2.5 商业平台速览

#### 2.5.1 Roboflow

- **Label Assist**:用同项目下你训练过的模型 / Universe 上的公开模型做预标
- **Smart Polygon**:基于 SAM2,一键画多边形
- 强项:从标注 → 训练 → 部署 一条龙(自家 Universe + Hosted Inference)
- 弱项:数据隐私差,默认数据上 Universe

#### 2.5.2 Encord

- 整合 SAM2 + GPT-4o + Gemini Pro 做预标
- **Encord Active**:数据策展模块(找异常 / 重复 / 难例),可独立买
- 强项:面向数据团队,有完整的"曲面/点云/医学影像"流水线
- 弱项:贵

#### 2.5.3 V7 Darwin

- 2025 年 Q4 集成 SAM3,支持**文本驱动批量类别检测**(全图所有该类对象一次画完)
- 医疗影像(DICOM)是杀手锏
- 视频标注体验业界第一档

#### 2.5.4 Refuel Autolabel

```yaml
# Python 库,3 步:
1. 写 JSON config(任务类型 + LLM + prompt + 标签)
2. dry-run 看 prompt 输出
3. 跑 dataset
```

- 主要做 NLP 文本标注
- 内置 few-shot / chain-of-thought / 多 LLM 投票
- 跟 Adala 重合度高,但 **Adala 更"框架",Refuel 更"开箱即用"**

#### 2.5.5 Argilla(Hugging Face)

- 主战场是 LLM 数据(SFT / RLHF preference / NLP)
- 整合到 HF Hub,可以直接 push 标注结果到数据集 repo
- CV 较弱,跟你的目标关联不大

---

## 3. AI 赋能模式拆解(对你最有用的部分)

### 3.1 五种典型 AI 赋能模式

| 模式 | 触发方式 | 后端形态 | 代表实现 | 你应该实现哪个 |
|---|---|---|---|---|
| **A. 批量预标** | 上传/创建项目时跑一次 | 异步队列 | LS `MLBackend.predict`、CVAT `auto-annotate` | ✅ 优先 |
| **B. 交互式提示** | 鼠标点 / 拖框 | 同步低延迟 | SAM(LS interactive、CVAT interactor、X-AL marks) | ✅ 优先 |
| **C. Active Learning** | 标完一个再下一个 | 调度器 | LS uncertainty sampling | ⏰ 中期 |
| **D. 持续训练** | 累计 N 条标注后 | 异步训练 + 部署 | LS `MLBackend.train` + webhook | ⏰ 中期 |
| **E. Agent 自动化** | 全自动跑 + HITL 抽检 | LLM 流水线 | Adala / Refuel / CVAT AI Agents | 🎯 你说要重点研究 |

### 3.2 模式 A:批量预标(最简单,先做这个)

**最小可用方案**:

```
[前端] 项目创建 → 选模型(从 ml_backends 表里挑一个)
                ↓
[后端] POST /api/v1/projects/{id}/preannotate
        → 创建 Job 记录(预测任务)
        → Celery 异步:
            for task in project.tasks:
                pred = ml_backend.predict(task.data)
                Prediction.objects.create(task=task, model_version=..., score=..., result=pred)
                PredictionMeta.objects.create(prediction=pred, inference_time=..., total_cost=...)
        → WebSocket 推进度给前端
```

**关键点**:
- `Prediction` 表独立于 `Annotation` —— 模型预测多次不污染人工标注
- 前端显示时,如果该 task 没有 `Annotation`,就把 `Prediction.result` 渲染为"待确认"状态
- 用户编辑/确认时,从 `Prediction` 派生一条 `Annotation`,设置 `parent_prediction_id`
- 这样可以统计"AI 接管率" = `Annotation.where(parent_prediction__isnull=False).count() / total`

> ⚠️ 你 v0.2.0 用 `Annotation.source ∈ {human, ai, ai-accepted}` 表达,这个粒度在多模型 / 多版本场景会立刻爆炸,建议直接重构。

### 3.3 模式 B:交互式提示(SAM)

**协议设计**(直接抄 LS):

```http
POST /api/v1/ml-backends/{id}/interactive-annotating
{
  "task": {"data": {...}},
  "context": {
    "type": "rectangle",          // 或 "keypoint"
    "value": {"x": 100, "y": 200, "w": 50, "h": 50}
  }
}

→ 200 OK
{
  "result": [{
    "type": "polygonlabels",
    "value": {"points": [[x1,y1], [x2,y2], ...]}
  }],
  "score": 0.93,
  "inference_time_ms": 180
}
```

**前端要点**:
- 鼠标松开后立刻调,**不等保存**
- 显示"AI 思考中"占位形状
- 失败 toast 但不影响人工继续标
- 同一帧的点连续点,前端做请求合并(debounce 80-120ms)

**模型部署**:
- SAM 系列建议**单独部署**到一个常驻 GPU 容器(预热 + 缓存 image embedding)
- 输入图像 embedding 在第一次进入图片时预计算,后续点击只跑 mask decoder(<50ms)
- 这一点 X-AnyLabeling 实现得很细,可以照抄 `segment_anything_2.py`

### 3.4 模式 C:Active Learning(中期再上)

直接抄 LS:

```python
def get_next_task(user, project):
    candidates = Task.where(project=project, is_labeled=False).exclude_already_labeled_by(user)

    if project.sampling == 'uncertainty':
        # 1. 优先 cluster_num_solved 低的
        # 2. 同 cluster 里优先 prediction.score 低的
        # 3. 多人协作时取 top-N 随机一个,避免冲突
        return uncertainty_sample(candidates)

    if project.show_overlap_first:
        return candidates.filter(overlap__gt=1).first()

    if project.sampling == 'sequence':
        return candidates.order_by('inner_id').first()

    return candidates.order_by('?').first()
```

**前置数据准备**:
- 给 task 跑一次预标注后,**用聚类算法**(k-means on embeddings)把 prediction 标 cluster
- 这部分 LS 自己也是"留口子由用户跑脚本",企业版自带

### 3.5 模式 D:持续训练 + 自动部署(高级)

**LS 的设计**(可以学但别一开始就上):
- 项目设置 `min_annotations_to_start_training=100`
- 每次有 `Annotation` 创建,触发 webhook 给 ML Backend
- ML Backend 内部决定是否要训练(攒够 N 条 → 开始训练 → 训完更新 `model_version`)
- LS 调用 `/versions` 拉新版本号,后续 `predict` 用新版

**对你**:这套至少 v0.5+ 再考虑。先把 A+B 跑通。

### 3.6 模式 E:Agent 自动化标注流水线(你的重点)

**两种思路**:

#### 思路 1:LLM 直接当标注员(适合简单分类、属性、文本 OCR 校正)

```python
# Adala / Refuel 风格
config = {
    "task_type": "classification",
    "labels": ["商品", "货架", "标签", "价格牌"],
    "llm": "gpt-4o",
    "prompt": "...",
    "few_shot_examples": [...]
}

for task in tasks:
    image = load(task.file_path)
    result = llm.predict(image, config)
    # 走人工抽检通道
    if result.confidence < 0.8 or random() < 0.05:
        Annotation(source='llm', is_pending_review=True, ...)
    else:
        Annotation(source='llm', is_auto_accepted=True, ...)
```

**适合你**:车牌 OCR 校正、属性标注、商品类别。**不适合**精确 bbox / mask。

#### 思路 2:LLM 做"质检 / Judge"(性价比最高)

```python
for ai_pred in predictions:
    # 让 LLM 看图 + 看 bbox 描述,判断 bbox 画得对不对
    judge = llm.predict(
        image=task.image,
        bbox=ai_pred.geometry,
        prompt="The model says this is a {label}. Is the box correct? Output: {accept|reject|adjust}"
    )
    if judge == 'accept':
        ai_pred.auto_accept = True  # 直接通过
    elif judge == 'reject':
        ai_pred.queue_for_human = True  # 进人工队列
    else:
        ai_pred.queue_for_human_with_hint = judge.suggestion  # 带 LLM 建议进人工
```

**这个模式比"LLM 自己画框"靠谱得多**。GroundingDINO + SAM2 画框 → GPT-4V/Qwen-VL 当裁判 → 大部分通过、少部分进人工。**Encord 主推就是这个**。

#### 思路 3:Pipeline 链(高级,Adala 风格)

```
Skill 1: GroundingDINO 检测候选区域
   ↓
Skill 2: SAM2 精细分割每个候选
   ↓
Skill 3: GPT-4V 判断 mask 质量 + 类别归属
   ↓
Skill 4: 高置信度 → 自动落库;低置信度 → 标记进人工队列
```

每个 Skill 是独立 Pydantic 输入输出,可单元测试,可单独换模型。这就是为什么 Adala 把 Skill 设计成可注册可组合。

---

## 4. 用户管理 / 数据存储 / 协同(生产级必备)

### 4.1 多租户:Org > Workspace > Project > Task

| 平台 | 层级 |
|---|---|
| LS | **Organization** → Project → Task |
| CVAT | **Organization** → Project → Task → Job |
| 你 v0.2.0 | (无 Org)→ Project → Task |

**建议**:加一层 `Organization`,即便单租户部署也保留(以后做 SaaS 不用迁移)。

```sql
organizations (id, name, contact_info, created_by, ...)
organization_members (org_id, user_id, role, joined_at, deleted_at)
projects.organization_id  (FK)
```

### 4.2 RBAC:角色不要写死在中文字符串里

你 v0.2.0:`role = "标注员"` / `"质检员"` / `"项目管理员"` —— **强烈建议改成枚举 + i18n**。

```python
class UserRole(str, Enum):
    SUPER_ADMIN = 'super_admin'
    ORG_ADMIN = 'org_admin'
    PROJECT_ADMIN = 'project_admin'
    REVIEWER = 'reviewer'
    ANNOTATOR = 'annotator'
    VIEWER = 'viewer'

# i18n 在前端:
const ROLE_LABELS = {
  super_admin: { 'zh-CN': '超级管理员', 'en': 'Super Admin' }
}
```

### 4.3 数据存储:Presigned URL 必须做

你 v0.2.0 把 `tasks.file_path` 存的是 MinIO 内部路径,但前端展示时怎么拿到图?**生产环境必须签发临时 URL**:

```python
@router.get("/tasks/{id}/file_url")
async def get_file_url(id, current_user, db):
    task = await db.get(Task, id)
    # 校验权限
    url = minio_client.get_presigned_url("GET", "annotations", task.file_path, expires=timedelta(hours=1))
    return {"url": url, "expires_in": 3600}
```

**LS / CVAT 的设计**(更彻底):
- LS 有 `io_storages` app,定义 `S3ImportStorage` / `GCSImportStorage` / `AzureBlobStorage` 等多种**存储源**
- CVAT 有 `cloud_provider.py` + `CloudStorage` 模型,用户绑定 AK/SK,平台代为生成 URL
- 都支持"双向同步":导入时拉数据下来 / 导出时把标注推回去

**给你的建议**(分阶段):
- v0.3:实现单一 MinIO 的 presigned upload + presigned download
- v0.5:抽象 `Storage` 表,支持 S3 / OSS / 本地 NFS

### 4.4 文件上传:大文件直传不要走 API

```
错误做法:前端 POST 文件 → API → MinIO  (吃 API 内存,带宽 *2)
正确做法:
  前端 POST /api/tasks/upload-init { filename, size }
        → 后端创建 task (status=uploading)
          + minio.get_presigned_url("PUT", expires=15min)
        → 返回 { task_id, upload_url }
  前端 PUT {upload_url} 直接上传到 MinIO(不经过 API)
        → 上传完 POST /api/tasks/{id}/upload-complete
        → 后端校验 ETag,创建 Task 记录,更新 status=pending
```

**LS / CVAT 都是这么做的**。

### 4.5 协同标注:TaskLock

你 v0.2.0 没有锁机制。两人同时打开同一个 task → 两份冲突标注。

```python
class TaskLock:
    task_id: UUID
    user_id: UUID
    expire_at: datetime  # 通常 5 分钟,前端有心跳续约
    unique_id: UUID

    class Meta:
        unique_together = ('task_id', 'user_id')
```

LS 的实现(`tasks/models.py`):锁过期机制,前端每 60s 续一次,关页面/切换任务自动释放。

### 4.6 审计日志

LS 有 `users/models.py:UserLastActivity` 等多张表,但更彻底的是 `webhooks` app:每个关键操作发 webhook,客户可以接到自己的审计系统。

**给你的建议**:加两张表:

```python
class AuditLog:
    id, user_id, org_id, action_type, target_type, target_id,
    payload (JSONB), ip_address, user_agent, created_at

class WebhookEndpoint:
    id, org_id, url, secret, events (JSONB), is_active

# 关键事件触发(用 SQLAlchemy event 或 FastAPI middleware):
- annotation.created / updated / deleted
- task.assigned / submitted / approved / rejected
- ml_backend.predicted / failed
- user.login / logout / role_changed
```

### 4.7 数据导出

你 v0.2.0 写了"待实现 COCO/VOC/YOLO"。CVAT 有专门的 `dataset_manager` app,LS 有 `data_export`。

**最简实现**:

```python
# app/services/exporters/
class COCOExporter:
    def export(self, project) -> dict:
        coco = {"images": [], "annotations": [], "categories": [...]}
        for task in project.tasks.iterator():
            coco["images"].append({"id": task.id, "file_name": task.file_name, ...})
            for anno in task.annotations.filter(is_active=True):
                coco["annotations"].append({
                    "image_id": task.id,
                    "category_id": class_to_id[anno.class_name],
                    "bbox": [anno.geometry["x"], ...],
                    "iscrowd": 0
                })
        return coco

# COCOExporter / VOCExporter / YOLOExporter 走同一个抽象基类
# 触发:POST /projects/{id}/export → 异步 Celery → 完成后存 MinIO + 邮件通知
```

**别忘了"导出过滤"**:导出时通常要选状态(只导已审核通过的)、按时间、按数据组等。

---

## 5. 关键能力对比矩阵

> ✅ 已具备 / 🟡 部分 / ❌ 缺失 / N/A 不适用

### 5.1 标注能力

| 能力 | LS | CVAT | X-AL | Roboflow | Encord | V7 | 你 v0.2.0 |
|---|---|---|---|---|---|---|---|
| 矩形框 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 多边形 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 实例分割(mask) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 关键点 / Skeleton | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 视频追踪 | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ❌ |
| OCR(文本框 + 内容) | ✅ | 🟡 | ✅(PPOCR) | 🟡 | 🟡 | 🟡 | ❌(但你有车牌项目) |
| 3D 点云 | ❌ | ✅ | 🟡 | ❌ | ✅ | ❌ | ❌ |
| 语义分割 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

### 5.2 AI 能力

| 能力 | LS | CVAT | X-AL | Roboflow | Encord | V7 | 你 v0.2.0 |
|---|---|---|---|---|---|---|---|
| 模型即 HTTP 服务 | ✅ | ✅(Nuclio + Agent) | 🟡(Remote) | ✅ | ✅ | ✅ | ❌ |
| 交互式 SAM | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| 批量预标 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Active Learning | 🟡 LSE | 🟡 stage | 🟡 阈值 | 🟡 | ✅ | ✅ | ❌ |
| LLM Judge / VLM | 🟡 通过 Adala | 🟡 | 🟡(Florence2/Gemini) | 🟡 | ✅ | ✅ | ❌ |
| 文本驱动检测 | ❌ | 🟡 | ✅(Grounding) | 🟡 | ✅ | ✅ SAM3 | ❌ |
| 持续训练 | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ | ❌ |
| Token 成本追踪 | ✅ PredictionMeta | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 5.3 协同与质量

| 能力 | LS | CVAT | 你 v0.2.0 |
|---|---|---|---|
| 多租户 (Org) | ✅ | ✅ | ❌ |
| 任务锁 (TaskLock) | ✅ | 🟡(state 字段) | ❌ |
| 多人交叉 | ✅ overlap | ✅ Job | ❌ |
| Ground Truth 验证 | ✅ | ✅ ValidationFrame | ❌ |
| IAA / 一致性 | 🟡 LSE | ✅ quality_control | ❌ |
| 共识标注 | ❌ | ✅ consensus | ❌ |
| 审核流(stage) | 🟡 | ✅ annotation/validation/acceptance | ❌ |
| 审计日志 | 🟡 | 🟡 | ❌ |
| Webhook | ✅ | ✅ | ❌ |

### 5.4 工程化

| 能力 | LS | CVAT | 你 v0.2.0 |
|---|---|---|---|
| Docker Compose | ✅ | ✅ | ✅ |
| Helm Chart | ❌ | ✅ | ❌ |
| Presigned URL 上传 | ✅ | ✅ | ❌ |
| 多源存储抽象 | ✅ io_storages | ✅ cloud_provider | ❌ |
| 异步任务队列 | ✅ RQ | ✅ RQ | 计划 Celery |
| WebSocket | 🟡 | ✅ | 计划 |
| JWT + RBAC | ✅ | ✅ | ✅ |
| 数据导出多格式 | ✅ | ✅ | 计划 |
| Webhook | ✅ | ✅ | ❌ |
| 国际化 i18n | ✅ | ✅ | ❌ |
| Feature Flags | ✅ | 🟡 | ❌ |

---

## 6. 给 `ai-annotation-platform` 的具体借鉴建议

> 你已经有的(JWT/RBAC/Alembic/前后端联调/设计系统/三页面)做得很扎实,这些不要改。下面**只列差距和优先级**。

### 6.1 数据模型重构(P0 — 越早做越好)

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

### 6.2 ML Backend 抽象(P0 — 跟数据模型一起做)

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

**模型服务侧**:用官方 `label-studio-ml-backend` 包做参考实现(MIT,可借鉴),自己写一个简化版:

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

### 6.3 交互式标注(P1 — 跟 Workbench 体验最相关)

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

### 6.4 Active Learning 调度(P2 — 数据量起来了再做)

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

### 6.5 Agent 流水线(P3 — 你的研究兴趣点)

**推荐路径**:

1. **第一步**:把 Adala 当**外部服务**接进来,不要 fork 进自己 repo
   - 部署一个 Adala server(FastAPI + Kafka + Redis)
   - 通过 ML Backend 协议接入(自己写一个 adapter,把 Adala 的 batch_inference 包装成 `/predict`)

2. **第二步**:写自己的 Skill
   - Skill 1: GroundingDINO 文本检测
   - Skill 2: SAM2 精细分割
   - Skill 3: VLM Judge(GPT-4V / Qwen2.5-VL)判断质量
   - Skill 4: 落库分流(高置信度 auto_accept,低置信度送人工)

3. **第三步**:HITL 闭环
   - 每个 Skill 输出落 `predictions` 表,带 `pipeline_stage`
   - 人工修订后,把 diff 喂回去做 prompt improvement(Adala 自带 `prompt_improvement.py` 技能)

**别一开始就做的**:
- 自己实现 Agent 框架(用 Adala 或 Refuel 即可)
- 在 Web 端跑 LLM(慢、贵,放服务端)

### 6.6 工程化补强(P1 — 跟 P0 同步推)

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

### 6.7 你已有的技术资产可以怎么用

看了你的 GitHub:

- **`Grounded-SAM-2`** → 直接包成你平台的"通用检测+分割" ML Backend,主推 mode B(交互式)
- **`DEIMv2`** → 包成专项检测 ML Backend(已经有 ONNX 友好的实现)
- **`HyperLPR3`、`chinese_license_plate_generator`、`2D_scripts`** → 车牌 OCR 是你最熟悉的场景,这块可以做成**第一个 vertical 模板**:
  - 项目模板:license_plate_ocr
  - 内置标签 schema:车牌区域 bbox + 车牌号文本
  - 内置 ML Backend:HyperLPR3
  - 内置导出器:你 `2D_scripts` 里的多线程下载工具的反过程
- **`lite.ai.toolkit`** → 一些轻量推理可以集成进 ML Backend SDK 中

---

## 7. 路线图建议

### v0.3(2-3 周)— 把 AI 落地

- [ ] 数据模型重构:加 Organization / TaskLock / AnnotationDraft
- [ ] **拆分 Annotation 和 Prediction**(关键!)
- [ ] **MLBackend 表 + HTTP 客户端 + CRUD API**
- [ ] 部署一个 Grounded-SAM-2 ML Backend Demo
- [ ] 批量预标:Celery 任务 + WebSocket 进度推送
- [ ] Workbench 接入交互式 SAM(鼠标点 → 出 mask)
- [ ] Presigned URL 上传

### v0.4(2 周)— 协同 + 质检

- [ ] 任务锁机制 + 多人交叉
- [ ] 审核流:annotator → reviewer 二级
- [ ] AI 接管率统计仪表盘(基于 `parent_prediction_id`)
- [ ] 数据导出 COCO/VOC/YOLO

### v0.5(3-4 周)— Active Learning + Agent

- [ ] Next-task 调度策略(uncertainty + uniform + sequence)
- [ ] Adala 服务集成 + LabelStudioSkill 适配自己 schema
- [ ] LLM Judge 模式(VLM 判别 AI 预标质量)
- [ ] PredictionMeta 完整 token cost 追踪

### v0.6+ — 生产化

- [ ] 多源存储抽象(S3 / 阿里云 OSS)
- [ ] 审计日志 + Webhook 出口
- [ ] 持续训练触发器
- [ ] Helm Chart + 高可用部署

---

## 8. 关键参考资料

### 8.1 源码(已 clone 到 /tmp/research/)

- **Label Studio**:https://github.com/HumanSignal/label-studio
  - 重点读:`label_studio/projects/functions/next_task.py`、`label_studio/ml/`、`label_studio/tasks/models.py`
- **CVAT**:https://github.com/cvat-ai/cvat
  - 重点读:`cvat/apps/lambda_manager/`、`cvat/apps/quality_control/`、`serverless/pytorch/facebookresearch/sam/nuclio/function.yaml`
- **Adala**:https://github.com/HumanSignal/Adala
  - 重点读:`adala/skills/_base.py`、`adala/skills/collection/label_studio.py`、`server/app.py`
- **X-AnyLabeling**:https://github.com/CVHub520/X-AnyLabeling
  - 重点读:`anylabeling/services/auto_labeling/model_manager.py`、`grounding_sam2.py`、`segment_anything_2.py`、`remote_server.py`

### 8.2 关键文档

- LS Active Learning:https://docs.humansignal.com/guide/active_learning.html
- LS ML Pipeline:https://labelstud.io/guide/ml.html
- CVAT Auto-Annotation:https://docs.cvat.ai/docs/annotation/auto-annotation/automatic-annotation/
- CVAT AI Agents 公告:https://www.cvat.ai/resources/changelog/announcing-cvat-ai-agents
- Adala README + Examples:`/tmp/research/adala/examples/`
- Refuel Autolabel:https://github.com/refuel-ai/autolabel

### 8.3 商业平台对比文章(2026 年)

- Encord 2026 Top Annotation Platforms:https://encord.com/blog/ai-annotation-platforms-with-the-best-data-curation/
- Lightly 12 Best Tools:https://www.lightly.ai/blog/data-annotation-tools

---

## 9. 一句话总结

> 你 v0.2.0 的工程底座(FastAPI + 异步 SQLAlchemy + Vite + 设计系统)做得**比 LS / CVAT 第一版当年更扎实**。但是 **AI 这块和数据模型层级**,你要么抄 LS(通用)要么抄 CVAT(CV 专用)的成熟设计,千万别自己从零想——他们俩的模型几乎是踩了 5 年坑积累出来的。直接照着 v0.3 路线图改造,**两周内就能从"前后端联通的标注 demo"变成"能接 GroundingSAM2 跑预标的可用平台"**。
