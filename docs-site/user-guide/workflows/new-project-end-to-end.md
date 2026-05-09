---
title: 新项目端到端流程
audience: [project_admin, annotator, reviewer]
type: tutorial
since: v0.9.0
status: stable
last_reviewed: 2026-05-09
---

# 新项目端到端流程

本文描述一个完整标注项目从创建到导出的全流程，适合项目管理员作为操作手册使用。

## 角色分工

| 步骤 | 执行角色 |
|---|---|
| 创建项目、上传数据 | 项目管理员 |
| 配置 AI 预标注（可选） | 项目管理员 |
| 创建批次、分配任务 | 项目管理员 |
| 完成标注 | 标注员 |
| 审核标注 | 审核员 |
| 导出数据 | 项目管理员 |

---

## Step 1：创建项目

1. 左侧菜单 → **项目** → **新建项目**
2. 填写基本信息：
   - 项目名称（唯一）
   - 标注类型：bbox / polygon / keypoint / classification
   - 关联 AI 模型（可选，供预标注使用）
3. 上传数据集（支持批量图片 ZIP 或逐张上传）
4. 保存后系统自动生成对应 Task（状态 `unlabeled`）

详见 [项目管理](../for-project-admins/)。

## Step 2：配置 AI 预标注（可选）

如有可用 ML Backend，可在项目创建后立即触发批量预标注，减少标注员工作量。

1. 项目详情 → **AI 预标注** → 选择模型 → **启动**
2. 等待 Job 状态变为 `done`（可在超管 → 失败预测页面监控）
3. 每个 Task 会生成 Prediction（紫色候选框），标注员可采用（A）或拒绝（D）

详见 [AI 预标注](../for-project-admins/ai-preannotate)。

## Step 3：创建批次与分配任务

1. 项目详情 → **批次** → **新建批次**（按时间段或数据来源切分）
2. 批次创建后 → **分配** → 选择标注员（支持多人均分）
3. 被分配的标注员在任务列表中可看到新任务（状态 `in_progress`）

详见 [批次与分配](../for-project-admins/batch)。

## Step 4：标注员完成任务

标注员登录后：
1. 任务列表 → 选择待完成任务
2. 工作台完成标注 → **提交**
3. 任务状态变为 `submitted`

详见 [工作台概览](../for-annotators/)。

## Step 5：审核员审核

审核员进入审核工作台：
1. 队列自动分发待审核任务
2. 审核操作：**通过**（→ `approved`）/ **回退**（→ `rejected`，标注员可修改后重提）
3. 项目完成率在 Dashboard 实时更新

详见 [审核流程](../for-reviewers/)。

## Step 6：导出数据

所有任务 `approved` 后（或达到导出阈值）：
1. 项目详情 → **导出** → 选择格式（COCO / YOLO / Pascal VOC / Label Studio JSON）
2. 下载 ZIP 包

详见 [数据导出格式](../reference/export-formats)。
