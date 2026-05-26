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

## [0.11.13] - 2026-05-26

> **类别 / 属性孤儿数据治理。** 删除类别或属性前展示受影响标注数；工作台可隐藏孤儿标注；导出跳过孤儿类别并收敛属性；新增 owner/superadmin cleanup 端点。

### Added

- **类别 / 属性删除确认用量统计**: 新增 `GET /projects/{id}/class-usage`，项目设置删除类别或属性时拉取当前 active 标注计数，确认文案明确“删除定义不删除标注，加回同名 / 同 key 可恢复”。
- **工作台隐藏孤儿标注开关**: Topbar ⚙ 菜单新增“隐藏孤儿标注”，同时作用于画布与右侧人工列表；未隐藏时孤儿行显示“已删除”标记。
- **孤儿 cleanup 运维端点**: 新增 `POST /projects/{id}/cleanup-orphans`，默认 `dry_run=true` 返回孤儿标注数与孤儿属性 key 计数；`dry_run=false` 软删孤儿类别标注并移除有效类别标注中的孤儿用户属性 key。→ [plan](docs/plans/2026-05-26-v0.11.13-orphan-class-attr-cleanup.md)

### Changed

- **导出兜底过滤孤儿数据**: COCO / YOLO / VOC / AAP JSON / Video JSON 统一在加载后跳过当前类别定义中不存在的标注，并只导出当前 attribute schema 内的用户属性 key，避免 schema 与 data 自相矛盾。

## [0.11.12] - 2026-05-25

> **评论画布批注交互完善。** 评论批注改为点击 pin 持续显示在 konva 画布上；正在编辑的评论的 pending 批注实时预览到画布；修复白板快速绘制丢点。

### Changed

- **评论画布批注：hover-reveal → 点击 pin** ([useHoveredCommentStore.ts](apps/web/src/pages/Workbench/state/useHoveredCommentStore.ts) · [CommentsPanel.tsx](apps/web/src/pages/Workbench/shell/CommentsPanel.tsx)): 此前评论的画布批注仅在 hover 评论卡片时半透明叠加到 konva 画布、鼠标一移开即清空，无法移到画布定睛查看。改为「点击评论卡片 = pin 其批注到画布持续显示」（再次点击同条 / 切换标注则取消），hover 保留为快速 peek。落实「批注线 ⟷ 评论绑定、聚焦即显示」的可见性模型。
- **正在编辑的评论 pending 批注预览到画布** ([CommentInput.tsx](apps/web/src/pages/Workbench/shell/CommentInput.tsx) · [useHoveredCommentStore.ts](apps/web/src/pages/Workbench/state/useHoveredCommentStore.ts)): 此前「弹窗批注」保存后只更新评论区按钮、主画布不显示，须再点「在题图上绘制」才载入可见。现 CommentInput 把 pending 批注上报到 composing 预览通道，弹窗批注 / live 完成后即实时叠加到主 konva 画布，发送 / 切换标注后清除。画布叠加优先级统一为 `selectEffectiveShapes`: hover（peek）> composing（编辑中）> pinned（点击选中）。

### Fixed

- **白板（弹窗批注 CanvasDrawingEditor）快速绘制时笔画跟不上手** ([CanvasDrawingEditor.tsx](apps/web/src/components/CanvasDrawingEditor.tsx)): `handleMove` 用渲染闭包里的 `drawing` 做守卫，pointerdown 的 `setDrawing` 未 flush 时紧跟的快速 pointermove 命中旧闭包 `drawing===null` 被丢弃，笔画开头缺失。改用 pointerdown 同步置位的 ref 守卫，不受 React 渲染时机影响。

## [0.11.7] - 2026-05-25

> **Issue 视频帧图钉。** video stage 按当前播放帧显隐 issue 图钉，时间轴标记可跳帧。

### Added

- **Issue 视频帧图钉** ([VideoIssueLayer.tsx](apps/web/src/pages/Workbench/stage/VideoIssueLayer.tsx)): video stage 按当前播放帧（`anchor_position.frame`）显隐 pixel-anchored issue 图钉；时间轴对有 issue 的帧加标记可点击跳帧；DiscussionIssuesTab 列表项显示所属帧（`F{n}`）并支持单击跳帧定位。→ [plan](docs/plans/2026-05-25-v0.11.7-issue-video-frame-pin.md)

### Fixed

- **VideoStage `issueFrames` useMemo 提到 early-return 之前**: 帧标记 memo 误放在 `isLoading`/`error` 返回之后，违反 `react-hooks/rules-of-hooks`。

## [0.11.5] - 2026-05-25

> **DiscussionPanel 转正 + 右栏旧路径清理。** 去 flag、删旧 CommentsPanel 路径，并修复转正后实测发现的回退。

### Changed

- **DiscussionPanel 转正 + 右栏旧路径清理**: 移除 `DISCUSSION_PANEL_ENABLED` flag，两段右栏成为默认；AIInspectorPanel 瘦身（移除内嵌 CommentsPanel 及相关 props）；删除旧浮动 `IssueListPanel`（图钉点击与 issue FAB 统一改走 DiscussionPanel issues tab）。→ [plan](docs/plans/2026-05-25-v0.11.5-discussion-cutover-cleanup.md)

### Fixed

- **右栏列宽拖拽线在 DiscussionPanel 区域失效**（实测）: 列宽 `ResizeHandle` 原在 AIInspectorPanel 内，去 flag 后只覆盖右栏上段；提到 `.rightSplit` 全高层级，整列可拖。
- **评论内画布批注（live 绘图）+ 点评论跳帧（video）断开**（实测，v0.11.2 引入）: DiscussionPanel 复用 CommentsPanel 时漏传 `backgroundUrl`/`enableCanvasDrawing`/`liveCanvas`/`commentAnchor`/`onSeekFrame`，去 flag 后旧路径消失致功能失效；透传桥接 props + 恢复 shell model 的 `videoCommentAnchor` memo 与 `liveCanvas` 桥接。
- **标注评论删除后偶现重现**（实测）: 后端软删正确但前端 invalidate+refetch 在快速切换标注时有 stale 缓存竞态；`useDeleteComment` 改为乐观移除 + 失败回滚 + invalidate 兜底。

## [0.11.1] ~ [0.11.4] - 2026-05-25

> **工作台统一讨论面板 DiscussionPanel。** 右栏两段布局，评论 / 历史 / Issue 三 tab，Issue 列表 ↔ 画布图钉双向联动。

### Added

- **工作台统一讨论面板 DiscussionPanel** ([DiscussionPanel.tsx](apps/web/src/pages/Workbench/shell/DiscussionPanel.tsx)): 右栏改为两段固定布局（上 AIInspectorPanel + 下 DiscussionPanel，中间可拖拽 [ResizeHandle](apps/web/src/pages/Workbench/shell/ResizeHandle.tsx) 纵向、比例持久化 localStorage）。DiscussionPanel 含 3 个 tab: **评论**（标注级 / 任务级合并，复用 CommentsPanel `hideTabs`/`forceTab`）、**历史**（标注级 / 任务级 audit 时间线，复用既有 `GET /tasks/{id}/audit-history`）、**Issue**（[DiscussionIssuesTab](apps/web/src/pages/Workbench/shell/DiscussionIssuesTab.tsx) · `useFeedbacks(kind=issue)` 列表 + status 过滤）。Issue 列表 ↔ 画布图钉双向联动（[useActiveIssueStore](apps/web/src/pages/Workbench/state/useActiveIssueStore.ts): 单击列表项定位+高亮图钉，单击图钉切 tab+高亮行）。边界: 仅统一 comment/issue/history，bug/reject 保留各自专用入口。→ plan [v0.11.1](docs/plans/2026-05-25-v0.11.1-discussion-panel-shell.md) / [v0.11.2](docs/plans/2026-05-25-v0.11.2-discussion-comments-tab.md) / [v0.11.3](docs/plans/2026-05-25-v0.11.3-discussion-history-tab.md) / [v0.11.4](docs/plans/2026-05-25-v0.11.4-discussion-issues-tab.md)

## [0.11.0] - 2026-05-25

> **双写一致性对账 cron。** 补 ADR-0027 承诺的对账安全网，drift>0 写审计 + 通知 superadmin。

### Added

- **双写一致性对账 cron** ([feedback_reconcile.py](apps/api/app/services/feedback_reconcile.py) · [worker](apps/api/app/workers/feedback_reconcile.py)): 补 ADR-0027 承诺却未落地的对账。纯函数 `compute_feedback_drift` 按 `source_table` 对比 `v_annotation_feedback_unified` 与各旧表"应 mirror 行数"（排除 `bug_reports.project_id IS NULL` / `annotation_comments.is_active=false` / `tasks.status≠rejected` 等设计内不 mirror 行）；beat 任务 `reconcile_annotation_feedback`（每日 03:00 UTC）在 drift>0 时写 `FEEDBACK_RECONCILE_DRIFT` 审计 + 通知 superadmin。切单源前的数据一致性安全网。→ [plan](docs/plans/2026-05-25-v0.11.0-feedback-reconcile-cron.md)

### Fixed

- **通知中心补 `feedback.reconcile_drift` 标签** ([NotificationsPopover.tsx](apps/web/src/components/shell/NotificationsPopover.tsx)): 对账 cron 通知此前无 `TYPE_LABEL` 映射，会向 superadmin 显示原始点号字符串。

<!-- 0.11.x 版本变更按版本段追加到本区；开始开发 0.12 后整体移到 docs/changelogs/0.11.x.md -->
