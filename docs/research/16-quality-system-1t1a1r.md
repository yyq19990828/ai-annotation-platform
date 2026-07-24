# 质量体系前置调研:1 task : 1 annotator : 1 reviewer 下的 GT / Honeypot / Consensus

> 调研日期:2026-06-07
>
> 背景:本平台当前主流程是 **1 task : 1 annotator : 1 reviewer**。在这个前提下,不能直接把 CVAT / Label Studio / Kili / Labelbox 的 GT、Honeypot、Consensus、IAA 方案当成 sprint backlog。本文先回答一个更基础的问题:在单人标注 + 单人审核模式下,哪些质量能力能先做,哪些能力必须等 overlap / 多人分发 / job slice 出现后再做。
>
> 使用方式:这是 research 输入,不是版本实施计划。若要落地,先写 ADR,再拆版本计划。

---

## 0. 摘要

**结论一**:当前模式下,`Consensus / IAA` 不能直接落地。IAA 的定义要求同一资产被多个 annotator 独立标注;当前平台没有 overlap 分发、replica task、隐藏副本、多人答案归并,所以现阶段只能做算法和数据模型设计,不能做可用产品能力。

**结论二**:`GT / Benchmark` 可以先做一个非隐藏、显式评测版,但它不是 honeypot。它适合 onboarding、培训、标注员校准、模型回归验证。真正的 honeypot 要求把标准题隐藏混入生产队列,这会破坏当前 1:1:1 的调度/审核语义,必须等 job slice 或 assignment replica 体系。

**结论三**:质量体系应该拆成三层,不要混成一个 score:

| 层              |   当前是否能做 | 作用                                        | 依赖                              |
| --------------- | -------------: | ------------------------------------------- | --------------------------------- |
| Review quality  |    已有,可深化 | reviewer reject / reopen 派生的相对质量信号 | 现有 task / annotation / feedback |
| Benchmark / GT  | 可先做显式评测 | 标准答案对比,评估绝对正确率                 | GT task set + comparator          |
| Consensus / IAA |       暂不落地 | 多人一致性,识别歧义与标注指南问题           | overlap / replica / merge         |

**建议路线**:

1. 先把 review-derived quality 的 drilldown 做扎实:冲突类型、per-class、unresolved feedback、任务下钻。
2. 写 ADR 设计 GT task set + comparator,先做显式 benchmark,不做 hidden honeypot。
3. 单独设计 overlap / assignment replica / job slice。这个地基出现后,再落 Consensus / IAA 和 hidden honeypot。

---

## 1. 当前约束

### 1.1 现有流程

当前平台的生产闭环大体是:

```
Task
  -> assigned / locked by one annotator
  -> submitted
  -> reviewed by one reviewer
  -> approved or rejected / reopened
```

这个模型的优点是状态简单、审核成本可控、任务锁和 reviewer 责任清楚。它的限制也明确:

- 同一 task 没有多个独立 annotation attempt。
- `annotation` 主要表达最终答案,不是多个候选答案集合。
- reviewer 的 reject 是质量信号,但它依赖 reviewer 是否发现问题,不是客观标准答案。
- 当前 `precomputed_agreement` 这类字段即使存在,也没有 overlap 输入可计算。

### 1.2 对 GT / Honeypot / Consensus 的影响

| 能力              | 在 1:1:1 下的问题                                                    |
| ----------------- | -------------------------------------------------------------------- |
| GT benchmark      | 可做,但应显式。标注员知道这是训练/评测题也没关系。                   |
| Hidden honeypot   | 不适合直接做。隐藏题要混入生产调度,且结果不应污染真实任务吞吐/审核。 |
| Consensus / IAA   | 缺核心输入。没有多人独立标同一题,就没有 agreement。                  |
| Conflict taxonomy | 可以做。对单个答案 vs GT 或 reviewer feedback 都能分类。             |
| Confusion matrix  | 对 GT 可做;对普通 review 不应硬算成“真实混淆矩阵”。                  |

---

## 2. 外部平台拆解后的可复用部分

### 2.1 CVAT:GT job 与 Quality Report

CVAT 的质量体系围绕 GT job / honeypot job / quality report:

- 用 GT 标注作为标准答案。
- 将标注员结果与 GT 比较,输出 missing / extra / label mismatch / low overlap / attribute mismatch 等冲突。
- 报告可以聚合到 job / task / project 级。

可借鉴:

- comparator 和 conflict taxonomy。
- per-label accuracy / precision / recall / mean IoU。
- quality threshold 项目级可配置。

不直接照搬:

- CVAT 的 job/segment 层级不能直接替换现有 task/batch。
- hidden GT 题混入生产流需要先有 job slice / assignment replica,否则会污染当前 1:1:1 语义。

### 2.2 Label Studio:overlap + agreement

LS 的关键输入是 overlap:同一 task 被多个 annotator 标注,再计算 agreement。其企业版才提供完整 agreement 计算。

可借鉴:

- `overlap` 是调度层概念,不是绩效页上的后算字段。
- `precomputed_agreement` 适合作为 task 级缓存结果。
- 不同 control / tool 类型应有不同权重和算法。

不直接照搬:

- XML label config / control tag DSL 不应引入。
- 当前平台 typed `tool_bindings` 已经是更好的边界。

### 2.3 商业平台:Benchmark 与 Consensus 是两把尺

Labelbox / Kili / Scale / SuperAnnotate 的共同点:

- Benchmark/Honeypot 衡量“对标准答案的绝对正确率”。
- Consensus 衡量“多人之间的一致性”。
- Calibration 可把 benchmark 结果用于准入/路由,但这是众包/大团队场景的后续能力。

对本平台的启示:

- 不要把 review reject rate、GT accuracy、consensus score 混成单一质量分。
- 先做能解释的指标,再做路由或奖惩。

---

## 3. 建议的数据模型方向

### 3.1 显式 Benchmark / GT task set

建议先设计一个显式评测集合:

```
quality_benchmarks
  id
  project_id
  name
  description
  status
  created_by

quality_benchmark_tasks
  benchmark_id
  task_id
  answer_annotation_id | answer_snapshot
  weight

quality_benchmark_runs
  benchmark_id
  assignee_id
  status
  started_at
  completed_at

quality_benchmark_results
  run_id
  task_id
  score
  conflicts[]
  metrics JSONB
```

关键决策:

- GT answer 应保存 snapshot,不要只引用可变 annotation。
- Benchmark run 结果不应污染生产 task 的 `status` / `completed_tasks`。
- 首版只覆盖 image bbox / polygon / rotated_bbox / keypoint 中已稳定的几何;video track / 3D 先不进。

### 3.2 Hidden honeypot 的前置地基

hidden honeypot 需要:

- 调度器能把“评测副本”伪装成普通任务。
- 标注员提交后,系统把结果写入 benchmark result,而不是覆盖生产标准答案。
- reviewer 流程要知道这个 task 是否需要正常审核,或由 comparator 自动评分。
- 绩效统计要能排除/单列 honeypot 时间和产出。

这已经超出当前 task 模型。建议等 assignment/job slice 出现后再做。

### 3.3 Consensus / IAA 的前置地基

Consensus 需要:

```
assignment_group / replica_group
  source_task_id
  replica_task_ids[]
  required_replicas
  merge_policy

annotation_attempt
  task_id
  user_id
  submitted_at
  annotations_snapshot

agreement_result
  source_task_id
  score
  conflicts
  per_tool_metrics
```

关键决策:

- 是复制 task,还是复制 assignment? 推荐先做 assignment/job slice,避免复制 dataset item 与 task 主体。
- reviewer 看的是 merged result,还是所有 replica? 高质量项目通常需要 reviewer 能看分歧。
- agreement 是否参与 task 完成判定? 不建议首版参与,先只做报告。

---

## 4. Comparator 设计

建议做成 typed geometry comparator,不写一个大函数:

| 几何                    | 首版算法                     | 输出                       |
| ----------------------- | ---------------------------- | -------------------------- |
| 分类 / tag              | exact match                  | accuracy                   |
| bbox / rotated_bbox     | IoU + label match            | TP / FP / FN / low_overlap |
| polygon / multi_polygon | mask IoU 或 polygon area IoU | TP / FP / FN / low_overlap |
| keypoint                | OKS 或距离阈值               | missing / low_quality      |
| attributes              | exact / type-aware match     | mismatching_attribute      |

冲突类型建议比现有 reject reason 更细:

- `missing_annotation`
- `extra_annotation`
- `mismatching_label`
- `low_overlap`
- `mismatching_attribute`
- `mismatching_group`
- `covered_annotation`
- `direction_or_rotation_error`

这些类型既能用于 GT result,也能反哺 reviewer reject reason 细化。

---

## 5. 推荐路线

### Phase R1:继续深化 review-derived quality

不需要新调度模型:

- task/batch 列表暴露 unresolved feedback 数。
- 绩效页按 reject reason / class / project / reviewer 下钻。
- annotation feedback thread 支持 resolve、跳转、筛选。

### Phase R2:显式 Benchmark MVP

不做 hidden honeypot:

- project admin 创建 benchmark set。
- 从已完成 task 选择 GT answer snapshot。
- 指派给 annotator 做评测 run。
- comparator 出 conflicts + per-class score。
- 结果单独展示,不并入生产 task 进度。

### Phase R3:overlap / replica 地基

这一步是 Consensus / IAA 和 hidden honeypot 的共同前置:

- 引入 assignment/job slice 或 replica group。
- 支持同一 source task 的多个独立作答。
- 支持 reviewer 查看多份答案与差异。

### Phase R4:Consensus / IAA

- 接 `precomputed_agreement`。
- 支持 per-tool comparator。
- 输出 task/project/user 级 agreement。
- 低一致性任务进入 reviewer queue。

### Phase R5:hidden honeypot / calibration

- 把 benchmark task 混入生产队列。
- 指标从 training 扩展到 production calibration。
- 只有真实众包/外包场景出现后再做。

---

## 6. 不建议现在做

- 不建议直接排 `GT/Honeypot + Consensus` 实现版本。
- 不建议在当前 task 表上加 `overlap_count` 后强行多人标同一 task;这会破坏锁、审核和 annotation ownership。
- 不建议把 benchmark score 混入现有 `quality_score = 1 - reopen_rate`。
- 不建议先做 hidden honeypot。隐藏题的产品边界和统计口径比显式 benchmark 难很多。
- 不建议一开始支持 video track / 3D benchmark。它们的 comparator 与时序对齐依赖 v0.15 以后地基。

---

## 7. 与现有文档的关系

- [`15-annotator-performance.md`](15-annotator-performance.md) 已确认质量体系两大结构性盲区:GT/Honeypot 与 Consensus/IAA。本文补充的是 **为什么当前 1:1:1 模式不能直接排实现**。
- [`2026-06-03-annotator-performance-deepening.md`](../plans/archive/2026-06-03-annotator-performance-deepening.md) 已把 B 轨标为“只设计,暂不排版本”。本文为这个判断补研究依据。
- 后续若要落地,建议先写 ADR:「质量评测与多人一致性地基」,再拆显式 benchmark MVP。
