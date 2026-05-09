---
audience: [dev]
type: explanation
since: v0.9.14
status: draft
last_reviewed: 2026-05-10
---

# AI 预标注接管

本文是 AI 预标注接管流程的占位页，后续会补充：

- project 触发 `/preannotate`
- worker / prediction_jobs / predictions 写入
- batch `active → pre_annotated`
- 标注员接管后 `pre_annotated → annotating`
- 清 prediction / reset draft 的回滚路径

当前先参考：

- [预标注流水线](./prediction-pipeline)
- [批次模块](./batch-module)
- [项目模块](./project-module)
