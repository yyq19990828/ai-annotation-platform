---
audience: [dev]
type: explanation
since: v0.9.14
status: draft
last_reviewed: 2026-05-10
---

# 标注模块

本文是 annotation 模块的占位页，后续会扩展为完整手册。

计划覆盖：

- `Annotation` / `AnnotationDraft` 的数据模型
- `annotation.py` service 的创建、更新、软删除
- prediction → annotation 的采纳路径
- annotation 写入如何回推 task / batch counters 与状态
- 工作台里的 optimistic update 与版本控制

当前先参考：

- `apps/api/app/services/annotation.py`
- `apps/api/app/api/v1/tasks.py`
- [任务模块](./task-module)
- [状态机总览](./state-machines)
