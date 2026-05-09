# 平台概念与术语

本页统一定义平台中常见的核心名词，避免在不同章节出现歧义。

## 核心实体

| 名词 | 英文 | 含义 |
|---|---|---|
| **项目** | Project | 一次标注任务的顶级容器，包含数据集配置、标注类型、分配规则等。一个项目对应一种标注目标（如「行人检测」）。 |
| **批次** | Batch | 项目内的一组任务切片，通常按时间或数据来源划分。标注员以批次为单位领取工作。 |
| **任务** | Task | 单条待标注数据（一张图像 / 一段文本）。任务状态流转：未分配 → 进行中 → 待审核 → 已通过 / 已回退。 |
| **标注** | Annotation | 标注员在某个任务上产出的具体结果，可包含多个标注对象（Bbox、Polygon 等）。 |
| **预测** | Prediction | 模型对某个任务生成的候选标注，供标注员修正或直接采用。与 Annotation 的区别：Prediction 由模型生成，Annotation 由标注员确认。 |
| **标注对象** | Label / Result | 单个几何形状 + 分类属性的组合（如一个 Bbox + 类别 "person"）。一个 Annotation 可含多个 Label。 |

## 角色

| 角色 | 英文 | 权限范围 |
|---|---|---|
| **标注员** | Annotator | 查看并完成分配给自己的任务 |
| **审核员** | Reviewer | 审核已提交任务，通过或回退 |
| **项目管理员** | Project Admin | 创建项目、上传数据、分配任务、查看项目统计 |
| **超级管理员** | Super Admin | 全平台用户管理、ML Backend 注册、系统监控 |

## AI 相关

| 名词 | 含义 |
|---|---|
| **ML Backend** | 外部模型服务，通过标准协议与平台对接，提供预测或批量预标注能力。详见 [ML Backend 协议](/dev/ml-backend-protocol)。 |
| **预标注（Pre-annotate）** | 在标注员介入前，先让模型对一批任务生成 Prediction，降低手工标注工作量。 |
| **Job** | 一次批量预标注请求，包含模型调用、结果写入等异步流程。状态：pending → running → done / failed。 |

## 状态流转速查

```
任务状态
  unlabeled（未标注）
    → in_progress（标注中）
      → submitted（待审核）
        → approved（已通过）
        → rejected（已回退）→ in_progress

Job 状态
  pending → running → done
                    → failed
```

## 常见混淆

- **Annotation vs Prediction**：前者由人产出、有效；后者由模型产出、需确认。
- **Task vs Batch**：Task 是最小粒度（一张图），Batch 是 Task 的集合切片。
- **Project vs Dataset**：Dataset 是数据的物理存储，Project 是对 Dataset 加标注配置之后的工作单元。
