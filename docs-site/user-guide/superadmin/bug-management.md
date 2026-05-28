---
audience: [super_admin]
type: how-to
since: v0.7.0
status: stable
last_reviewed: 2026-05-29
---

# BUG 反馈管理

平台右下角浮动的「BUG 反馈」按钮收集到的反馈会落在 `bug_reports` 表中，
超级管理员通过侧边栏 **管理 → BUG 反馈** 进入处理界面（`/bugs`）。

> 入口仅对 `super_admin` 角色可见；非超管用户提交反馈后只能在「设置 → 我的反馈」里查看自己提交的工单。

## 列表与筛选

进入后默认展示最近 50 条工单，支持按 **状态 + 严重度** 两个维度过滤：

| 状态 | 含义 |
|---|---|
| `new` 新提交 | 未经分诊 |
| `triaged` 已确认 | 已被认领，需排期 |
| `in_progress` 处理中 | 已在修复 |
| `fixed` 已修复 | 修复已上线 |
| `wont_fix` 不修复 | 复现失败或非缺陷 |
| `duplicate` 重复 | 关联到已存在工单 |

| 严重度 | 触发场景 |
|---|---|
| `low` | 文案、对齐、不影响流程 |
| `medium` | 单点功能问题 |
| `high` | 工作流被阻断 |
| `critical` | 数据丢失或安全风险 |

列表每行展示 `display_id`（B-1、B-2 …）、标题、严重度徽标、状态、提交时间。如果该工单被重开过，状态后会显示 `↻N` 徽标，鼠标悬停可看最近一次重开时间。

## 详情面板

点击行打开右侧详情面板，自上而下包含：

1. **元信息**：用户提交时所在路由（`route`）、提交者角色、视口尺寸（`viewport`）、重开次数。
2. **描述正文**：用户填写的 markdown（已渲染为 HTML，由 `MarkdownBlock` 组件做安全过滤）。
3. **截图附件**：所有 attachments 以图标链接形式列出，文件大小标注在右侧；点击在新标签页打开签名 URL（`bug_reports.attachmentDownloadUrl(id, key)`）。
4. **处理结果（resolution）**：若已填写，显示在状态按钮上方。
5. **状态切换按钮**：6 个状态按钮并排，点击直接落库并广播 `bug_report.status_changed` 通知给提交者。当前状态高亮显示，不可重复点击。
6. **评论区**：内联 markdown 评论，所有评论者的 `author_role` 会跟在名字后；评论会作为 `bug_report.commented` 通知发给提交者。

> 状态从 `fixed` / `wont_fix` 回退到任意非终态时，会触发 `bug_report.reopened` 通知，并把 `reopen_count` +1、`last_reopened_at` 更新为当前时间。

## 通知触达

详细规约见 [开发文档 · 审计与通知](../../dev/concepts/audit-and-notifications)。BUG 工单相关的 in-app 通知 type：

- `bug_report.commented` — 工单被评论
- `bug_report.status_changed` — 状态被改动
- `bug_report.reopened` — 已关闭工单被重开

用户可在 **设置 → 通知偏好** 中单独静音以上 type。

## 反馈循环

- 用户在「设置 → 我的反馈」中可看到自己提交的所有工单及其当前状态、resolution、最新评论。
- 触发 `bug_report.reopened` 后，超管侧详情面板中元信息行会显示 `曾重开 N 次` 徽标，便于识别高频回归。

## 后端 API

详见 [API 文档](../../api/) 的 `/api/v1/bug-reports/*` 端点；服务实现位于 `apps/api/app/services/bug_report.py`。

::: tip 提交者排查路径
当用户报告问题时，可让其点击右下角「BUG 反馈」按钮提交：系统会**自动附带**最近 10 条 API 调用日志与 console error 日志，大幅减少复现成本。无需手工抓 HAR / DevTools。
:::
