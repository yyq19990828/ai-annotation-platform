# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

## [Unreleased]

> **§2.2 AnnotationFeedback 收敛 epic 启动（v0.11）。** 见 [epic 索引](docs/plans/2026-05-25-v0.11-annotation-feedback-convergence.md) 与 [ADR-0027](docs/adr/0027-annotation-feedback-unified-table.md)。本窗口落地 A 组（双写对账安全网）与 B 组（工作台统一讨论面板 DiscussionPanel）；C 组（ADR refined-C 决策）/ D 组（切单源）待后续。关键决策：refined-C —— comment/issue 单源进 `annotation_feedbacks`，bug/reject 保持权威在 `bug_reports`/`tasks`，`v_annotation_feedback_unified` view 作永久统一读表面。

### Added

- **双写一致性对账 cron（v0.11.0）** ([feedback_reconcile.py](apps/api/app/services/feedback_reconcile.py) · [worker](apps/api/app/workers/feedback_reconcile.py))：补 ADR-0027 承诺却未落地的对账。纯函数 `compute_feedback_drift` 按 `source_table` 对比 `v_annotation_feedback_unified` 与各旧表"应 mirror 行数"（排除 `bug_reports.project_id IS NULL` / `annotation_comments.is_active=false` / `tasks.status≠rejected` 等设计内不 mirror 行）；beat 任务 `reconcile_annotation_feedback`（每日 03:00 UTC）在 drift>0 时写 `FEEDBACK_RECONCILE_DRIFT` 审计 + 通知 superadmin。切单源前的数据一致性安全网。→ [plan](docs/plans/2026-05-25-v0.11.0-feedback-reconcile-cron.md)
- **工作台统一讨论面板 DiscussionPanel（v0.11.1-4）** ([DiscussionPanel.tsx](apps/web/src/pages/Workbench/shell/DiscussionPanel.tsx))：右栏改为两段固定布局（上 AIInspectorPanel + 下 DiscussionPanel，中间可拖拽 [ResizeHandle](apps/web/src/pages/Workbench/shell/ResizeHandle.tsx) 纵向、比例持久化 localStorage）。DiscussionPanel 含 3 个 tab：**评论**（标注级 / 任务级合并，复用 CommentsPanel `hideTabs`/`forceTab`）、**历史**（标注级 / 任务级 audit 时间线，复用既有 `GET /tasks/{id}/audit-history`）、**Issue**（[DiscussionIssuesTab](apps/web/src/pages/Workbench/shell/DiscussionIssuesTab.tsx) · `useFeedbacks(kind=issue)` 列表 + status 过滤）。Issue 列表 ↔ 画布图钉双向联动（[useActiveIssueStore](apps/web/src/pages/Workbench/state/useActiveIssueStore.ts)：单击列表项定位+高亮图钉，单击图钉切 tab+高亮行）。边界：仅统一 comment/issue/history，bug/reject 保留各自专用入口。→ plan [v0.11.1](docs/plans/2026-05-25-v0.11.1-discussion-panel-shell.md) / [v0.11.2](docs/plans/2026-05-25-v0.11.2-discussion-comments-tab.md) / [v0.11.3](docs/plans/2026-05-25-v0.11.3-discussion-history-tab.md) / [v0.11.4](docs/plans/2026-05-25-v0.11.4-discussion-issues-tab.md)
- **Issue 视频帧图钉（v0.11.7）** ([VideoIssueLayer.tsx](apps/web/src/pages/Workbench/stage/VideoIssueLayer.tsx))：video stage 按当前播放帧（`anchor_position.frame`）显隐 pixel-anchored issue 图钉；时间轴对有 issue 的帧加标记可点击跳帧；DiscussionIssuesTab 列表项显示所属帧（`F{n}`）并支持单击跳帧定位。→ [plan](docs/plans/2026-05-25-v0.11.7-issue-video-frame-pin.md)

### Changed

- **DiscussionPanel 转正 + 右栏旧路径清理（v0.11.5）**：移除 `DISCUSSION_PANEL_ENABLED` flag，两段右栏成为默认；AIInspectorPanel 瘦身（移除内嵌 CommentsPanel 及相关 props）；删除旧浮动 `IssueListPanel`（图钉点击与 issue FAB 统一改走 DiscussionPanel issues tab）。→ [plan](docs/plans/2026-05-25-v0.11.5-discussion-cutover-cleanup.md)

### Fixed

- **通知中心补 `feedback.reconcile_drift` 标签** ([NotificationsPopover.tsx](apps/web/src/components/shell/NotificationsPopover.tsx))：对账 cron 通知此前无 `TYPE_LABEL` 映射，会向 superadmin 显示原始点号字符串。
- **VideoStage `issueFrames` useMemo 提到 early-return 之前**：v0.11.7 的帧标记 memo 误放在 `isLoading`/`error` 返回之后，违反 `react-hooks/rules-of-hooks`。
- **右栏列宽拖拽线在 DiscussionPanel 区域失效**（实测）：列宽 `ResizeHandle` 原在 AIInspectorPanel 内，去 flag 后只覆盖右栏上段；提到 `.rightSplit` 全高层级，整列可拖。
- **评论内画布批注（live 绘图）+ 点评论跳帧（video）断开**（实测，v0.11.2 回退）：DiscussionPanel 复用 CommentsPanel 时漏传 `backgroundUrl`/`enableCanvasDrawing`/`liveCanvas`/`commentAnchor`/`onSeekFrame`，去 flag 后旧路径消失致功能失效；透传桥接 props + 恢复 shell model 的 `videoCommentAnchor` memo 与 `liveCanvas` 桥接。
- **标注评论删除后偶现重现**（实测）：后端软删正确但前端 invalidate+refetch 在快速切换标注时有 stale 缓存竞态；`useDeleteComment` 改为乐观移除 + 失败回滚 + invalidate 兜底。

<!-- v0.11.0 起的版本变更直接追加到本节；当开始开发 0.12 版本后再移到 docs/changelogs/0.11.x.md -->
