# 平台概念与术语

本页统一定义平台中常见的核心名词，避免在不同章节出现歧义。

## 核心实体

| 名词 | 英文 | 含义 |
|---|---|---|
| **项目** | Project | 一次标注任务的顶级容器，包含数据集配置、标注类型、分配规则等。一个项目对应一种标注目标（如「行人检测」）。 |
| **批次** | Batch | 项目内的一组任务切片，通常按时间或数据来源划分。标注员以批次为单位领取工作。 |
| **任务** | Task | 单条待标注数据（一张图像 / 一段视频 / 一段文本）。任务状态流转：未开始 → 进行中 → 待审核 → 已完成 / 待重做。 |
| **标注** | Annotation | 标注员在某个任务上产出的具体结果，可包含多个标注对象（Bbox、Polygon 等）。 |
| **预测** | Prediction | 模型对某个任务生成的候选标注，供标注员修正或直接采用。与 Annotation 的区别：Prediction 由模型生成，Annotation 由标注员确认。 |
| **标注对象** | Label / Result | 单个几何形状 + 分类属性的组合（如一个 Bbox + 类别 "person"）。一个 Annotation 可含多个 Label。 |

## 视频标注术语

| 名词 | 英文 | 含义 |
|---|---|---|
| **轨迹** | Track | 视频里同一个对象跨多个帧的标注结果。一条轨迹保存为一条 `video_track_bbox` annotation。 |
| **关键帧** | Keyframe | 用户手工确认或模型预测出的轨迹控制点，包含 `frame_index` 和 bbox。 |
| **插值帧** | Interpolated frame | 两个有效关键帧之间由前端线性计算出的显示结果，不会逐帧写入数据库。 |
| **消失** | Outside | 目标在某帧或某段中不存在，用闭区间 `outside` 段表达；插值不会跨过消失段。 |
| **遮挡** | Occluded | 目标仍存在但可见性差，用于提醒审核和后续质检。 |

## 角色

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/concepts/role-permission-matrix.png — /users 权限矩阵 5 角色行，标注红框：viewer 行 [auto] -->

| 角色 | 英文 | 权限范围 |
|---|---|---|
| **标注员** | Annotator | 查看并完成分配给自己的任务 |
| **审核员**（质检员） | Reviewer | 审核已提交任务，通过或回退 |
| **项目管理员** | Project Admin | 创建项目、上传数据、分配任务、查看项目统计 |
| **超级管理员** | Super Admin | 全平台用户管理、ML Backend 注册、系统监控 |
| **观察者** | Viewer | 仅查看，无法操作任务或项目；开放注册默认角色，需管理员升级才可参与标注 |

## AI 相关

| 名词 | 含义 |
|---|---|
| **ML Backend** | 外部模型服务，通过标准协议与平台对接，提供预测或批量预标注能力。详见 [ML Backend 协议](/dev/reference/ml-backend-protocol)。 |
| **预标注（Pre-annotate）** | 在标注员介入前，先让模型对一批任务生成 Prediction，降低手工标注工作量。 |
| **Job** | 一次后台任务请求，覆盖多种异步流程（见下方 kind 列表）。状态：pending → running → completed / failed / cancelled。 |

Job 的 `kind` 完整列表：

| kind | 中文含义 |
|---|---|
| `batch_predict` | 批量预标 |
| `video_tracker` | 视频追踪 |
| `predictions_import` | 预测导入 |
| `prediction_retry` | 失败预测重试 |
| `export` | 标注导出 |
| `dataset_import` | 数据集（连接器）导入 |
| `create_tasks` | 建任务（大数据集关联） |
| `audit_archive` | 审计日志月分区归档 |

## 状态流转速查

### Task 状态

Task 状态描述单条数据的生命周期：

```
pending（未开始）
  → in_progress（进行中，已有人工标注）
    → review（待审核，已提交）
      → completed（已完成，审核通过）
      → rejected（被退回）
        → in_progress（标注员重做）→ review → …
```

> `rejected` 是审核退回任务的真实运行时状态（M1 引入），落库为字符串；它**不在** `TaskStatus` 5 值枚举（`uploading` / `pending` / `in_progress` / `review` / `completed`）内，但可按 `reject_reason_type` 过滤，并在工作台任务队列显示为「待重做」。
>
> `uploading` 是大数据集异步建任务期间（超过 `TASK_CREATE_SYNC_THRESHOLD`）的短暂内部态，建完即转 `pending`，标注员通常看不到。
>
> 各状态在任务队列里的显示标签见 [工作台 · 任务队列里的状态标签](./workbench/#任务队列里的状态标签)。

### Batch 状态

Batch 状态描述一批任务的整体推进阶段（独立于 Task 状态）：

```
draft（草稿）→ active（已激活）
  → pre_annotated（AI 已预标，等待人工接管）
  → annotating（标注中）
    → reviewing（审核中）
      → approved（已通过）
      → rejected（被驳回）
  → archived（已归档）
```

> `pre_annotated` 是 Batch 的状态，表示该批次的 AI 预标注已完成、等待分配给标注员；它不是 Task 级别的状态。
>
> `approved` / `rejected` / `archived` 的逆向迁移由 owner 手动触发（需填原因）：`rejected → reviewing`（跳过重标直接复审）、`rejected → active`（重激活）、`任意 → archived`。**驳回后「回到标注」是两跳** `rejected →（owner 重激活）→ active →（标注员开始做退回任务，自动）→ annotating`，并非自动单跳。完整状态机（含逆向白名单）见 [批次与分配 · 批次状态机](./projects/batch)。

### Job 状态

```
pending → running → completed
                  → failed
                  → cancelled
```

## 常见混淆

- **Annotation vs Prediction**：前者由人产出、有效；后者由模型产出、需确认。
- **Task vs Batch**：Task 是最小粒度（一张图），Batch 是 Task 的集合切片。
- **Project vs Dataset**：Dataset 是数据的物理存储，Project 是对 Dataset 加标注配置之后的工作单元。
