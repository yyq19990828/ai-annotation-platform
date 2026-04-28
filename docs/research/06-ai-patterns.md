# AI 赋能模式拆解（对你最有用的部分）

> 拆分自《AI标注平台深度调研报告》§3

## 3.1 五种典型 AI 赋能模式

| 模式 | 触发方式 | 后端形态 | 代表实现 | 你应该实现哪个 |
|---|---|---|---|---|
| **A. 批量预标** | 上传/创建项目时跑一次 | 异步队列 | LS `MLBackend.predict`、CVAT `auto-annotate` | ✅ 优先 |
| **B. 交互式提示** | 鼠标点 / 拖框 | 同步低延迟 | SAM（LS interactive、CVAT interactor、X-AL marks） | ✅ 优先 |
| **C. Active Learning** | 标完一个再下一个 | 调度器 | LS uncertainty sampling | ⏰ 中期 |
| **D. 持续训练** | 累计 N 条标注后 | 异步训练 + 部署 | LS `MLBackend.train` + webhook | ⏰ 中期 |
| **E. Agent 自动化** | 全自动跑 + HITL 抽检 | LLM 流水线 | Adala / Refuel / CVAT AI Agents | 🎯 你说要重点研究 |

## 3.2 模式 A:批量预标（最简单,先做这个）

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

## 3.3 模式 B:交互式提示（SAM）

**协议设计**（直接抄 LS）:

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
- 同一帧的点连续点,前端做请求合并（debounce 80-120ms）

**模型部署**:
- SAM 系列建议**单独部署**到一个常驻 GPU 容器（预热 + 缓存 image embedding）
- 输入图像 embedding 在第一次进入图片时预计算,后续点击只跑 mask decoder（<50ms）
- 这一点 X-AnyLabeling 实现得很细,可以照抄 `segment_anything_2.py`

## 3.4 模式 C:Active Learning（中期再上）

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
- 给 task 跑一次预标注后,**用聚类算法**（k-means on embeddings）把 prediction 标 cluster
- 这部分 LS 自己也是"留口子由用户跑脚本",企业版自带

## 3.5 模式 D:持续训练 + 自动部署（高级）

**LS 的设计**（可以学但别一开始就上）:
- 项目设置 `min_annotations_to_start_training=100`
- 每次有 `Annotation` 创建,触发 webhook 给 ML Backend
- ML Backend 内部决定是否要训练（攒够 N 条 → 开始训练 → 训完更新 `model_version`）
- LS 调用 `/versions` 拉新版本号,后续 `predict` 用新版

**对你**:这套至少 v0.5+ 再考虑。先把 A+B 跑通。

## 3.6 模式 E:Agent 自动化标注流水线（你的重点）

**两种思路**:

### 思路 1:LLM 直接当标注员（适合简单分类、属性、文本 OCR 校正）

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

### 思路 2:LLM 做"质检 / Judge"（性价比最高）

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

### 思路 3:Pipeline 链（高级,Adala 风格）

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
