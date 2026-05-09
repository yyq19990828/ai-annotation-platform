---
audience: [dev]
type: explanation
since: v0.9.14
status: draft
last_reviewed: 2026-05-10
---

# 批次生命周期（端到端）

本文是 batch 端到端流程的占位页，后续会专门串起：

1. 创建 batch
2. 分派 annotator / reviewer
3. 激活进入生产
4. task 推动 batch 自动转 `annotating`
5. 送审进入 `reviewing`
6. `approved / rejected / archived / reset`

适合作为“功能配合总览”，但当前先不展开到逐 API / 逐通知级别。

当前先参考：

- [批次模块](./batch-module)
- [任务模块](./task-module)
- [状态机总览](./state-machines)
