# CVAT:CV 专用,视频追踪强

> 拆分自《AI标注平台深度调研报告》§2.3

**仓库**:`cvat-ai/cvat`（Star 13k+,develop 分支高频）

## 2.3.1 三层任务结构（VAT 比 LS 复杂的核心）

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
- `Job.stage` 表达"标注 → 复核 → 验收"的工序流（比 Annotation 上的 `is_labeled` 更严）
- `parent_job` 让"共识标注"（同一段给 3 个人独立标然后合并）成为头等公民
- `ValidationFrame` 把"金标题"嵌入正常工作流（检验标注员）

## 2.3.2 标注模型（支持视频追踪）

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

**视频追踪的实现**（LS 没这么干）:
- `LabeledTrack` 存"对象一生"
- `TrackedShape` 存关键帧位置
- 中间帧由前端**线性插值**,标注员只标关键帧
- `outside` 字段表示对象暂时离开画面

## 2.3.3 AI 集成的两条路:Nuclio + AI Agents

**老路:Nuclio Serverless（2018-2023）**

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

**新路:CVAT AI Agents（2024-2025 推出,主推）**

不再要求模型部署成 Nuclio function,而是:
1. 用户写一个 Python 模块（用 cvat-sdk）
2. 用 CLI `cvat-cli function register` 把元数据注册到 CVAT（不上传代码/权重）
3. 用户在自己的 GPU 机器上跑 `cvat-cli agent` 进程
4. 这个 agent 进程**反向连接**到 CVAT,从队列拉任务、跑模型、回写结果

**为什么这么改**:
- 模型权重永远不离开用户机器（隐私 / 合规）
- 用户不用懂 Nuclio / Knative
- agent 可以用任何 GPU/CPU/MPS,不需要在 K8s 集群里
- 2.31.0 起支持 attributes,2.32.0 起支持 skeleton

## 2.3.4 质量保证（LS 企业版才有的,CVAT 开源就有）

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

跑出 `QualityReport` → 一堆 `AnnotationConflict`（每个冲突按 frame 定位,标记类型 / 严重度）。

**这是 CVAT 比 LS 开源版强的点**——LS OSS 没有 IAA,要 LSE 才有。
