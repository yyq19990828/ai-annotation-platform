---
audience: [dev]
type: explanation
since: v0.9.14
status: stable
last_reviewed: 2026-07-11
---

# 可见性与权限

本文讲 project / batch / task 三层的可见性和权限规则，重点是“用户为什么能看到这条数据”。

代码真值源：

- `apps/api/app/deps.py`
- `apps/api/app/services/scheduler.py`
- `apps/api/app/api/v1/tasks/_shared.py`
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

### 项目作用域 ML Backend

`/projects/{project_id}/ml-backends/*` 不能只依赖 `require_roles`。当前端点按动作分三组：

- 可见成员读 / 推理：list、get、setup、capabilities 和交互推理使用 `require_project_visible`；指定 backend 还必须已对该项目启用。
- owner 管理：创建、编辑、停用、enablement、health、capabilities refresh、warmup、predict-test 使用 `require_project_owner`。
- 平台运维（全局共享态）：reload、unload 使用 `require_roles(super_admin)`。二者改写的是「全局 backend 显存驻留 / 常驻变体」——同一物理 backend 被多个项目共用，若允许项目 owner 触发就会驱逐 / 换掉其他项目正在用的权重。故这类破坏性驻留操作收口到超级管理员，且不叠加 `require_project_owner`（全局操作按 backend 定位、与 path 里的 project 无归属关系）。构造性的 warmup 是项目自身预标 / 交互推理前置，仍留在 owner 组。

所有带 `task_id` 的推理入口还要校验 `task.project_id == project_id`。不存在与跨项目 task 都返回 404，不允许 A 项目成员拿 A 的 backend 处理 B 项目 task。该边界与“用户角色是 project_admin”不同：角色只决定动作类别，project dependency 决定具体资源范围。

## 项目级范围收敛（成员绩效端点）

除了「看不看得见某条数据」，还有一类是「聚合数字按哪个项目口径切分」。
成员绩效端点 `GET /dashboard/admin/people` 及其详情 / 导出从 v0.12.6（A3）起遵循统一的范围解析（`dashboard._resolve_people_scope`）：

- `super_admin`：`project` 可选；给定则走 `assert_project_visible` 校验存在（对 super_admin 恒可见），缺省则全局聚合。
- `project_admin`：`project` **必填**，且必须是其 **owner** 的项目；
  - 严格校验 `project.owner_id == current_user.id`，**不复用** `assert_project_visible`；越权或项目不存在均返回 `404`（隐藏存在性，不泄露「项目存在但你无权」）；
  - 缺省 `project` → `403`。

为什么不复用 `assert_project_visible`：后者对 project_admin 的 owner 校验失败后会 **fallback 到 `ProjectMember` 查询**（见 [`apps/api/app/deps.py`](https://github.com/yyq19990828/ai-annotation-platform/blob/main/apps/api/app/deps.py) `assert_project_visible`），这是项目级数据访问的通用宽松策略，但对成员绩效语义过宽——会让「身为他人项目 member 的 project_admin」读到他人产能 / reject 率 / 类别分布。`_resolve_people_scope` 自行校验 `owner_id` 以收死边界，与「能不能看见 task」用同一把锁是错的口径。

这把「越权读他人项目绩效」收成 IDOR 安全边界：role 门只放行 `super_admin + project_admin`，
而 `project_admin` 被严格锁定在 **owner 自有项目** 范围，所有产能 / 质量 / 活跃聚合都按该 `project_id` 过滤
（此前 `project` 仅过滤「返回哪些用户」，聚合仍是跨项目全局数字 → 误导且越权）。

同一原则也适用于视频追踪任务聚合：`GET /video-tracker-jobs` 的 role 门只决定谁能进入管理列表；`project_admin` 的 items、counts 和显式 `project_id` 过滤还必须与 `Project.owner_id == current_user.id` 求交集。工作台恢复候选使用任务级 reviewable 端点：先校验 task 可见性，普通用户再按 `created_by` 收窄，项目 owner / 超级管理员才可恢复该 task 的全部候选。

## 现阶段最该注意的坑

- 不要把 task lock 当成权限系统
- 不要把 reviewer 和 project owner 的权限混为一谈
- 改 batch 状态集合时，要同步审视 task 可见性是否跟着变

## 相关文档

- [项目模块](./project-module)
- [任务模块](./task-module)
- [批次模块](./batch-module)
- [Scheduler 与派题](./scheduler-and-task-dispatch)
