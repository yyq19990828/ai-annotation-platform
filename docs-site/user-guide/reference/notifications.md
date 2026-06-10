---
audience: [annotator, reviewer, project_admin, super_admin]
type: reference
since: v0.10.50
status: stable
last_reviewed: 2026-06-10
---

# 通知中心

右上角铃铛是个人通知中心。通知会持久保存，浏览器离线或 WebSocket 断开后，重新打开面板仍能看到未读消息。面板按时间分组，并支持按类型筛选。

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/notifications/panel-overview.png — 通知面板展开态（筛选 tab + 分组 + 加载更多） -->

## 通知类型完整列表

下表列出平台当前全部 21 种通知类型，以及点击行为与所属筛选 tab：

| type | 业务含义 | 点击行为 | 筛选 tab |
|---|---|---|---|
| `task.approved` | 任务审核通过 | 仅标已读（无跳转） | 任务 |
| `task.rejected` | 任务被退回 | 仅标已读（无跳转） | 任务 |
| `task.reopened` | 任务重新打开 | 仅标已读（无跳转） | 任务 |
| `batch.rejected` | 批次被驳回 | 跳转工作台（批次视图） | 批次 |
| `batch.review_reopened` | 批次审核重新打开 | 跳转工作台（批次视图） | 批次 |
| `batch.admin_locked` | 管理员锁定批次 | 跳转工作台（批次视图） | 批次 |
| `batch.admin_unlocked` | 管理员解锁批次 | 跳转工作台（批次视图） | 批次 |
| `batch.unarchived` | 批次取消归档 | 跳转工作台（批次视图） | 批次 |
| `failed_prediction.retry.started` | 失败预测重试已开始 | 仅标已读（无跳转） | 全部 |
| `failed_prediction.retry.succeeded` | 失败预测重试成功 | 仅标已读（无跳转） | 全部 |
| `failed_prediction.retry.failed` | 失败预测重试失败 | 仅标已读（无跳转） | 全部 |
| `export.ready` | 导出完成，可下载 | 直接触发文件下载（payload 带 `download_url`） | 导出 |
| `export.failed` | 导出失败 | 仅标已读（失败无下载链接） | 导出 |
| `job.completed` | 后台任务完成 | 跳转 `/ai-pre/jobs`（数据集导入则跳数据集列表） | 后台任务 |
| `job.failed` | 后台任务失败 | 跳转 `/ai-pre/jobs` | 后台任务 |
| `job.cancelled` | 后台任务已取消 | 跳转 `/ai-pre/jobs` | 后台任务 |
| `bug_report.commented` | BUG 反馈收到评论 | super_admin/project_admin 跳 `/bugs`，其他角色打开反馈抽屉 | 反馈 |
| `bug_report.status_changed` | BUG 反馈状态变更 | 同上 | 反馈 |
| `bug_report.reopened` | BUG 反馈重新打开 | 同上 | 反馈 |
| `user.deactivation_requested` | 申请注销账号 | 仅标已读 | 全部 |
| `user.deactivation_completed` | 账号注销完成 | 仅标已读 | 全部 |

> **任务类通知点击行为说明**：`task.*` 通知点击后只会标记为已读，不会自动跳转到对应任务。如需进入工作台处理退回任务，请从 Dashboard 的「退回提示」区块直接进入，或在项目卡片点击「打开」后在任务队列筛选。
>
> **可跳转的只有 4 类 `target_type`**：`bug_report`（→ `/bugs` 或反馈抽屉）、`batch`（→ 工作台批次视图）、`export`（payload 带 `download_url` 时触发下载）、`async_job`（→ `/ai-pre/jobs`，数据集导入跳 `/datasets`）。其余 `target_type`（`task` / `failed_prediction` / `user`）点击仅标已读。「后台任务」筛选 tab 只匹配 `async_job`，因此 `failed_prediction.retry.*` 只出现在「全部」tab。
>
> **失败预测重试**：`failed_prediction.retry.started` 会落一条通知中心条目；`succeeded` / `failed` 主要作为 WebSocket 实时进度事件，重试最终结果通常以后台任务通知（`job.completed` / `job.failed`）形式落地。三者均可在 [通知偏好](./settings#通知偏好) 单独静音。

## 已读、删除和清空

- 点开某条通知会自动标记为已读，部分类型同时跳转到对应目标（见上表）。
- 通知行右侧的删除按钮会删除该条通知；如果删除的是未读通知，未读数量会同步减少。
- 「全部已读」只把当前未读通知标记为已读。
- 「清空已读」会删除当前用户所有已读通知，不影响未读通知。
- 同一账号开在多个浏览器 / 设备时，一端执行已读、删除或清空后，其他在线端会通过通知 WebSocket 立即刷新，不必等 30 秒轮询。

删除只影响自己的通知记录，不会影响其他用户，也不会删除后台任务、导出产物或原始业务对象。

## 浏览历史通知

- 列表按 `今天` / `本周` / `更早` 分组，组内仍按创建时间倒序。
- 顶部筛选支持 `全部` / `任务` / `批次` / `反馈` / `后台任务` / `导出`，筛选只作用于当前已加载通知。
- 每条通知左侧图标按类型和结果着色：失败 / 退回为危险色，完成 / 通过为成功色，后台任务为 AI 色，反馈为强调色。
- 首次打开默认加载最近 30 条；有更多历史时底部出现「加载更多」按钮并继续累积显示。

## 通知偏好

进入 [设置 → 通知偏好](./settings#通知偏好) 可以按通知类型关闭站内通知。关闭后，新事件不会写入通知中心，也不会推送到在线会话；已经存在的历史通知不受影响。

以上表格中全部 21 种 type 均可单独静音。静音机制说明见 [设置页 · 通知偏好](./settings#通知偏好)。
