# 工作台「当前题 AI」与批量预标执行语义分离

Issue: [工作台「当前题 AI」被批量预标注状态校验拒绝（409）](https://github.com/yyq19990828/ai-annotation-platform/issues/121)

## 目标

工作台对当前题运行 AI 时，不再套用数据管理批量预标的 `pending` + `active` 批次前置条件，
改为按当前用户对该题的编辑语义判定：允许 `in_progress` 任务与 `draft` 批次，保留管理员锁、
他人编辑锁与终态任务保护，且拒绝原因用中文返回给工作台面板。

## 现状

- 工作台 `handleRunAi` / `handleRunAiPipeline` 复用 `POST /projects/{projectId}/preannotate`，
  传 `task_ids: [当前题]`。
- API `trigger_preannotation` → `_validate_preannotate_task_scope` 要求任务 `pending`、
  批次 `active`、无有效编辑锁。
- worker `_run_batch` 对显式任务范围重复同样校验，并在 `base_conds` 里强制
  `Task.status == "pending"`，因此只放宽 API 仍会得到 0 任务或任务失败。

## 方案

1. `PreannotateRequest` 增加 `execution_scope: Literal["bulk", "workbench"] = "bulk"`。
   数据管理批量路径保持缺省 `bulk`，语义不变；工作台单题路径显式传 `workbench`。
2. API 新增 `_validate_workbench_task_scope`：要求恰一个任务、归属项目、批次非管理员锁、
   任务非 `review` / `completed`、编辑锁属于调用者或不存在。中文拒绝原因。
3. worker `batch_predict` / `_run_batch` 增 `execution_scope`：`workbench` 时跳过
   `pending` / `active` 批次限制，保留管理员锁与他人锁保护；`base_conds` 不再强制 `pending`。
4. Web：`TriggerPreannotationPayload` 增字段；`handleRunAi` 与 `buildPipelineRunPayload`
   发送 `workbench`。

## 验收

- 工作台当前题、`in_progress`、本人编辑锁、`draft` 批次 → 允许。
- 他人编辑锁 / 管理员锁 / 终态任务 / 多任务 → 拒绝且中文原因。
- 数据管理批量预标原有保护不退化。
- 覆盖 API 校验与 worker 选中任务的回归测试。

## Outcome

Landed on branch `fix/issue-121-workbench-current-task-ai` (awaiting maintainer review/merge).

- Backend: `apps/api/app/api/v1/projects.py` (`execution_scope`, `_validate_workbench_task_scope`),
  `apps/api/app/workers/tasks.py` (`batch_predict` / `_run_batch` workbench scope).
- Web: `apps/web/src/hooks/usePreannotation.ts`, `apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx`,
  `apps/web/src/pages/Workbench/state/useWorkbenchShellModel.helpers.ts`.
- Tests: `apps/api/tests/test_preannotate_workbench_scope.py`.
- User documentation: `docs-site/user-guide/ai/current-task-inference.md`.
- CHANGELOG: Unreleased → Fixed.
- Remaining work: live workbench verification after maintainer confirms environment.
