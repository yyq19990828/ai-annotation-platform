---
audience: [dev]
type: explanation
since: v0.9.14
status: stable
last_reviewed: 2026-05-10
---

# 可见性与权限

本文讲 project / batch / task 三层的可见性和权限规则，重点是“用户为什么能看到这条数据”。

代码真值源：

- `apps/api/app/deps.py`
- `apps/api/app/services/scheduler.py`
- `apps/api/app/api/v1/tasks.py`
- `apps/api/app/api/v1/batches.py`

## 三层边界

可见性不是一个 if，而是三层叠加：

1. **项目层**：用户是否看得见这个 project
2. **批次层**：这个 batch 当前状态是否对该角色开放
3. **任务层**：这个 task 是否挂在可见 batch 上，并满足分派约束

## 项目层

项目层核心规则：

- `super_admin`：全部可见
- 项目 owner：当前项目越权可见
- 其他用户：必须命中 `ProjectMember(project_id, user_id)`

真值主要在 `deps.assert_project_visible()`。

## 批次层

批次层当前最重要的规则在 `scheduler.batch_visibility_clause()`：

- reviewer：可见 `active / annotating / reviewing`
- annotator：
  - `active / annotating` 且 batch 未分派或分配给自己
  - `rejected` 且分配给自己

这就是为什么某些 task 明明存在，但用户仍然拿不到、也查不到。

## 任务层

`GET /tasks` 和 `GET /tasks/{id}` 会继续把 batch 可见性规则压到 task 上。

关键点：

- 无 batch 的 orphan task 对非特权用户不可见
- reviewer 不受 annotator 约束
- annotator 对 `rejected` 是特例放行

## 操作权限不等于可见性

即使看得见，也不一定能操作。

例如：

- annotator 可能看见 `rejected` task，但不能做 reviewer approve
- reviewer 能看见 reviewing task，但不能激活 batch
- owner 越权可见，不代表绕过所有 task 状态机约束

## 现阶段最该注意的坑

- 不要把 task lock 当成权限系统
- 不要把 reviewer 和 project owner 的权限混为一谈
- 改 batch 状态集合时，要同步审视 task 可见性是否跟着变

## 相关文档

- [项目模块](./project-module)
- [任务模块](./task-module)
- [批次模块](./batch-module)
- [Scheduler 与派题](./scheduler-and-task-dispatch)
