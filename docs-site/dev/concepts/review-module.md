---
audience: [dev]
type: explanation
since: v0.9.14
status: draft
last_reviewed: 2026-05-10
---

# 审核模块

本文是 review 模块的占位页，后续会补成完整手册。

计划覆盖：

- reviewer 的 task 审核流
- `review_claim / approve / reject / reopen` 的角色矩阵
- batch `reviewing / approved / rejected` 的业务语义
- reviewer 页面与通知联动

当前先参考：

- `apps/api/app/api/v1/tasks.py`
- `apps/api/app/api/v1/batches.py`
- [任务模块](./task-module)
- [批次模块](./batch-module)
- [ADR-0005](/dev/adr/0005-task-lock-and-review-matrix)
