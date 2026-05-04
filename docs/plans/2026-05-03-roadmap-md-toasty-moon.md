# BUG 反馈机制增强 — 评论闭环 + 重开 + 通知中心

## Context

当前 BUG 反馈是单向链路：用户经 `BugReportDrawer` 提交（含 v0.6.6 截图涂抹），管理员在 `BugsPage` triage、改状态、写处理结果。但有三处闭环缺口：

1. **提交者无法回复**：`BugReportDrawer` 详情页评论区是 read-only（仅展示 `body` + 时间戳），管理员的回复 / 追问无法在原会话中继续。
2. **「已修复」是终态**：`status` 进到 `fixed` / `wont_fix` / `duplicate` 后没有回路。回归 BUG 只能新提交一份，丢失上下文。
3. **管理员动作无声**：状态变更与评论都只写 `audit_log`，提交者主动打开抽屉才看见；没有 push 通道。

ROADMAP 已列「Bug 反馈延伸 LLM 聚类去重 + 邮件通知」「通知中心实时推送（v0.4.8 30s 轮询 → Redis Pub/Sub WS）」两项；本期把通知中心基座一起做掉，BUG 反馈是其首位消费方，后续 audit / 任务分派也能挂入。

**用户决策**：
- Reopen 触发方式：**仅评论触发**（提交者在终态评论 → 自动 `triaged`，零按钮）
- 评论扩展深度：**纯文本 + 提交者也能评论**（不做 mentions / 附件 / soft-delete）
- 通知机制：**新建 `notifications` 表 + WS 推送**（不复用 audit_log 通道）

---

## Approach

### 1. 数据模型（alembic 0025）

`bug_reports` 加 2 列：
- `reopen_count INTEGER NOT NULL DEFAULT 0`
- `last_reopened_at TIMESTAMPTZ NULL`

新建 `notifications` 表（通用，BUG 反馈是首位消费方）：
```
id              UUID PK
user_id         UUID FK users(id) ON DELETE CASCADE     -- 收件人
type            VARCHAR(60) NOT NULL                    -- 'bug_report.commented' | 'bug_report.status_changed' | 'bug_report.reopened'
target_type     VARCHAR(30) NOT NULL                    -- 'bug_report'
target_id       UUID NOT NULL
payload         JSONB NOT NULL DEFAULT '{}'             -- {display_id, title, actor_name, new_status, snippet}
read_at         TIMESTAMPTZ NULL
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()

INDEX (user_id, read_at, created_at DESC)
INDEX (target_type, target_id)
```
不与 `audit_log` 合并：通知 = 收件人视角，审计 = 操作者视角，索引取向相反。

### 2. 后端

**`app/db/models/bug_report.py`** —
- `BugReport` 加 `reopen_count` / `last_reopened_at`。
- `BugComment` 不动（保留单 `body` 字段）。

**`app/db/models/notification.py`** （新建） —
- `Notification` ORM。

**`app/services/notification.py`** （新建） —
- `NotificationService.notify(db, user_id, type, target_type, target_id, payload)`：写一行 + 调用 `WebSocketBroadcaster.publish(channel=f"notify:{user_id}", message=...)`。
- 复用现有 Redis Pub/Sub 基础设施（ROADMAP B 标注「Redis Pub/Sub 已就位」，进 impl 时核对 `app/services/realtime.py` 或同义文件名）。

**`app/services/bug_report.py`** —
- `add_comment(report_id, author_id, body)` 改造：
  1. 取 report；
  2. 如 `author_id == report.reporter_id` 且 `report.status in {'fixed','wont_fix','duplicate'}` → 同事务内将 status 切回 `triaged`，`reopen_count += 1`，`last_reopened_at = now()`。
  3. 写 comment。
  4. 返回 `(comment, was_reopened: bool)`，由 router 决定后续审计 + 通知。

**`app/api/v1/bug_reports.py`** —
- `POST /bug_reports/{id}/comments`：
  - 鉴权收紧：`reporter_id == current_user.id` 或 `is_admin` 才放行（当前是任何登录用户都能评论，是 BUG）。
  - 调用 service 后：
    - 写 `bug_comment.created` audit；如 reopen 则追加 `bug_report.reopened` audit。
    - 通知 fan-out：
      - 提交者评论 → 通知 `assigned_to_id`（兜底取最近 `bug_report.status_changed` 的 actor，或全部 `SUPER_ADMIN`）；如 reopen 同时携带 `reopen=true` 标记。
      - 管理员评论 → 通知 `reporter_id`。
- `PATCH /bug_reports/{id}` 状态变更：通知 `reporter_id`（type=`bug_report.status_changed`，payload 含 `from`/`to`/`resolution`）。
- `GET /bug_reports/{id}` 返回 `BugReportDetail` 加 `reopen_count` / `last_reopened_at`；评论 `BugCommentOut` 在 service 端 join `User` 把 `author_name` / `author_role` 填进 schema。

**`app/api/v1/notifications.py`** （新建） —
- `GET /notifications?unread_only&limit&offset` — 当前用户。
- `GET /notifications/unread-count` — TopBar 角标用。
- `POST /notifications/{id}/read`、`POST /notifications/mark-all-read`。
- `WS /ws/notifications` — JWT 鉴权后订阅 `notify:{user_id}` Redis 频道。

**`app/schemas/bug_report.py`** —
- `BugReportOut` / `BugReportDetail` 加 `reopen_count`、`last_reopened_at`。
- `BugCommentOut` 加 `author_name: str`、`author_role: str`。

### 3. 前端

**`apps/web/src/api/notifications.ts`** —
- 改造：当前是 `/auth/me/notifications` 消费 audit_log，改为消费新表 `/notifications`；保留同名 hook 接口以减少调用方改动；删除 audit_log 派生逻辑。

**`apps/web/src/components/notifications/`**（新建） —
- `NotificationBell.tsx`：TopBar 铃铛 + 红点角标（`useUnreadCount` 30s 轮询作为 WS 兜底）。
- `NotificationList.tsx`：下拉/抽屉，每行 `{icon, title, snippet, time, unread dot}`，点击 → 标记 read + 跳 BUG 详情。
- `useNotificationSocket.ts`：app 启动时连 `/ws/notifications`，收到 push 调用 `queryClient.invalidateQueries(['notifications'])` 与 unread-count。

**`apps/web/src/components/bugreport/BugReportDrawer.tsx`** —
- detail 视图（line 571-642）：
  - status chip 旁加 `reopen_count > 0 ? "曾重开 ${n} 次"` 小徽章。
  - 评论列表每行加 `<author_name> · <role>` 头部。
  - 列表底部新增 `<textarea> + <button>发送</button>`：
    - placeholder：`fixed/wont_fix/duplicate` 时显示「发送将重新打开此反馈」橙色 hint；其它状态「写下你的回复...」。
    - 提交后乐观插入 + 调 `bugReportsApi.addComment(id, body)`，refetch detail。

**`apps/pages/Bugs/BugsPage.tsx`**（admin 端） —
- 列表与详情显示 reopen 徽章；评论显示 author_name + role；其余不变。

### 4. 鉴权与速率

- 评论端点：限 `60/hour/user`（防刷屏，与现 create 的 `10/hour` 区分）。
- 通知端点：仅查询自己 `user_id` 的行；DB 层 WHERE 强制。
- WS 鉴权：连接 query string 带 JWT，握手时校验，绑定 channel = `notify:{user.id}`。

---

## Critical files

修改：
- `apps/api/app/db/models/bug_report.py`（加 2 列）
- `apps/api/app/services/bug_report.py`（reopen 自动机）
- `apps/api/app/api/v1/bug_reports.py`（鉴权收紧 + notify fan-out + status PATCH 通知）
- `apps/api/app/schemas/bug_report.py`（新字段）
- `apps/web/src/components/bugreport/BugReportDrawer.tsx`（detail 加评论框 + reopen 徽章）
- `apps/pages/Bugs/BugsPage.tsx`（reopen 徽章 + author 名）
- `apps/web/src/api/notifications.ts`（指向新表）

新增：
- `apps/api/alembic/versions/0025_bug_reopen_and_notifications.py`
- `apps/api/app/db/models/notification.py`
- `apps/api/app/services/notification.py`
- `apps/api/app/api/v1/notifications.py` + 注册到主 router
- `apps/api/app/schemas/notification.py`
- `apps/web/src/components/notifications/NotificationBell.tsx`
- `apps/web/src/components/notifications/NotificationList.tsx`
- `apps/web/src/hooks/useNotificationSocket.ts`

---

## 分阶段交付（建议合两个 PR，方便 review 和回滚）

**PR A · BUG 反馈闭环**（不依赖 WS）
- 0025 migration 仅 `bug_reports` 加 2 列。
- service 自动 reopen + author_name/role 透传。
- BugReportDrawer 加评论框。
- BugsPage 加徽章。
- 这一刀单独发版 v0.6.8，已经能解决核心痛点。

**PR B · 通知中心**
- 0026 migration `notifications` 表。
- NotificationService + WS 端点 + 前端铃铛。
- 把 PR A 的 audit-only 通知点改为同时写 notification 表。
- 发版 v0.6.9。

---

## 验证

### 单元 / 集成

- `apps/api/tests/test_bug_reports.py`：
  - 提交者在 `fixed` 状态评论 → status 变 `triaged`、`reopen_count=1`、产生两条 audit（`commented` + `reopened`）。
  - 管理员评论不触发 reopen。
  - 第三方用户调评论端点 → 403。
- `apps/api/tests/test_notifications.py`（新）：
  - notify 写行 + Redis publish；mark_read / unread_count 路径。

### 手动 E2E（Docker compose 起栈）

1. `docker compose up -d`，浏览器登录 reporter A 与 admin B 两个会话。
2. A 提交 BUG → B 收到通知（铃铛红点 +1）。
3. B 改状态 `fixed` 并写 resolution → A 收到通知，BugReportDrawer 详情页 status = 已修复。
4. A 在详情页评论框写「还是有问题」→ 提交后状态自动回 `已确认`，徽章显示「曾重开 1 次」；B 收到「reopen」通知。
5. WS 验证：开 A 的浏览器 devtools，B 操作时 console 看 WS 消息进来；断网 30s 后用轮询兜底。

### 数据库脚本（参照 CLAUDE.md BUG 查询风格）

```bash
docker exec ai-annotation-platform-postgres-1 psql -U user -d annotation -c \
  "SELECT display_id, status, reopen_count, last_reopened_at FROM bug_reports WHERE reopen_count > 0 ORDER BY last_reopened_at DESC LIMIT 10;"
```

### Roadmap 维护

- 实施完成后在 `ROADMAP.md` 删除 / 移动以下条目到 CHANGELOG：
  - 「Bug 反馈延伸 LLM 聚类去重 + 邮件通知」（注：本期未做 LLM/邮件，仍保留）
  - 「通知中心实时推送（v0.4.8 30s 轮询已落；待升级为 Redis Pub/Sub WS 推送）」→ 已落
- 新增观察项：管理员侧批量已读 / 通知偏好（按 type 静音）。
