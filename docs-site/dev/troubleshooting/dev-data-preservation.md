---
audience: [dev]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# Dev 数据保护：DELETE vs TRUNCATE

## 症状

跑完 `pnpm test:e2e`（或 screenshots 自动化）后，本地数据库里的 admin/pm/qa/anno/viewer 等开发账号、自建项目、数据集、标注全部消失，需要重跑 `seed.py` 才能继续工作。

## 根因

老版 `seed/reset` 端点用 `TRUNCATE TABLE ... CASCADE` 一把清掉全表后重建 fixture，把开发者本地积累的数据连带清空。screenshot 自动化也同样调用了写路径。

## 修复

切换为**定向 DELETE**，仅清理 fixture 资源（@e2e.test 用户 + `name='E2E Demo Project'` 项目及其级联）。dev 数据完全保留。

落地踩了 3 个深坑：

### 1. SAVEPOINT 隔离每条 DELETE

asyncpg 单条 SQL 失败会让外层事务进入 `InFailedSQLTransactionError aborted` 状态，普通 `try/except` 救不了——必须用 `db.begin_nested()`（SAVEPOINT），失败时 rollback 这个 savepoint 才能继续后续 DELETE。

### 2. audit_logs immutability trigger 豁免

`DELETE users` 触发 `audit_logs.actor_id ON DELETE SET NULL`，这是个隐式 UPDATE，会被 audit immutability trigger 拒绝（"audit_logs rows are immutable"）。

需要在事务开头：

```sql
SET LOCAL "app.allow_audit_update" = 'true';
```

让本事务豁免 trigger，user 删除才能成功。

### 3. 反向引用清单按实际 schema 校对

不能凭直觉，必须读 model 文件。常见反向引用：

- `bug_reports.reporter_id`（**不是** `submitter_id`）
- `annotation_comments.author_id`
- `bug_comments`、`annotation_drafts` 等

`audit_logs` 自身不删（trigger 守护），fixture 用户在 audit_logs 中残留行通过 `ON DELETE SET NULL` 自动置 NULL。

## 验证

新增回归测试 `test_seed_reset_preserves_dev_data`：造 dev 用户 + dev 项目 → 跑 reset → 断言两者仍存在 + fixture 重建。

实测：跑全套 9 个 spec，dev 10 users / 3 projects 跑前跑后完全一致；7 个开发账号（admin/pm/qa/anno/viewer/anno2/anno3）保留。

## 教训

- **测试夹具必须是「我的」而不是「全部」**：用名字前缀 / 固定 ID / 标签字段标记，删除时只删自己造的。
- **TRUNCATE 在共享开发环境是核武器**，除非整库即用即抛（compose volume 每次重建）。
- **审计表的 ON DELETE 行为要专门 review**，trigger 守护可能让看似无关的删除整事务失败。

## 相关

- commit: `c3e0d94` fix(e2e): seed/reset 改为定向 DELETE
- commit: `3ab5ff0` fix(screenshots): 同样 TRUNCATE 陷阱修复
- 代码：`apps/api/app/api/v1/seed.py::reset`
