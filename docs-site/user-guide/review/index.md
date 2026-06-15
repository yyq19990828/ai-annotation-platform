---
audience: [reviewer]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-06-10
---

# 审核流程

> 适用角色：审核员 / 项目管理员

## 审核工作台

![ReviewPage 左侧批次树 + 任务列表（缩略图 + 批量操作按钮）](../images/review/review-list-page.png)

![审核工作台](../images/review/workbench.png)

平台提供两个独立的审核入口：

- **ReviewPage**（`/review`）：批次树 + 任务列表入口。审核员在此浏览批次、选择待审任务，也可在列表侧直接通过 / 退回单条任务。
- **WorkbenchShell review 模式**（`/projects/:id/review`）：全屏审核工作台，进入后显示完整标注画布（图片任务）或时间轴（视频任务）以及 diff 视图，在顶部操作区执行通过 / 退回动作。

审核工作台与标注工作台共用同一个 `WorkbenchShell` 外壳，仅 `mode` 参数不同。审核模式只替换顶部操作、横幅、任务锁、通过 / 退回流程和 diff 视图，不复制一套独立页面。因此图片、视频和未来 Stage 的查看方式会同步进入审核入口。

## 审核操作

| 操作 | 含义 | 后果 |
|---|---|---|
| **通过** | 标注合格 | 任务进入 `completed` |
| **退回** | 需要修改，必须选「原因类型」（可附自由备注） | 任务回到原标注员，状态变 `rejected` |

### 退回原因类型

退回时必须从以下 4 类中选一项（`RejectReasonType` **结构化枚举**，便于后续 reject 率统计 → [super_admin 离线分析](../superadmin/analytics)）：

| 类型 | 中文 label | 适用场景 |
|---|---|---|
| `missing` | 漏标 | 应该标的目标没标到 |
| `extra` | 多标 | 标了不该标的（噪声框 / 误标） |
| `wrong_label` | 类别错误 | 几何形状对，类别选错 |
| `wrong_geometry` | 位置或尺寸不准 | 类别对，框位置 / 大小 / 形状不准 |

旁边的「补充说明」是**可选**自由文本，建议写清楚具体目标 / 帧号，例如 `trk_person_01 frame 128: 车辆消失后仍有插值框`。

![退回反馈表单](../images/review/reject-form.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 点「退回」弹出的备注表单，含原因下拉 + 富文本备注框。 -->

### 退回接口请求体

调用 `POST /api/v1/tasks/{task_id}/review/reject` 时的 JSON 请求体：

```json
{
  "reason_type": "missing",
  "reason": "trk_person_01 frame 128: 车辆消失后仍有插值框"
}
```

- `reason_type`：必填，取 4 枚举值之一。
- `reason`：可选自由文本，最长 2000 字符。

## 视频任务审核

视频任务会在审核工作台切到视频时间轴视图。审核时重点看：

- 轨迹列表里的类别和 `track_id` 是否能对应同一个对象。
- 第 1 帧、中间帧、最后一帧等关键位置的 bbox 是否贴合目标。
- 两个关键帧之间的虚线插值框是否发生明显漂移。
- 目标消失段是否标记了「消失」，避免插值框穿过不存在的对象。
- 被遮挡目标是否标记了「遮挡」，且框体仍覆盖可判断的目标区域。

退回视频任务时，建议在原因里写清楚 `track_id + frame_index`，例如：

```text
trk_person_01 frame 128: 车辆消失后仍有插值框，请标记为消失。
```

这样标注员重做时可以直接定位到问题轨迹和帧。

## 审核员绩效

审核员仪表板（`ReviewerDashboard`）显示以下 `ReviewerDashboardStats` 指标：

| 指标 | 字段 | 说明 |
|---|---|---|
| 待审队列 | `pending_review_count` | 当前仍在 `review` 状态的任务数 |
| 今日已审 | `today_reviewed` | 当日通过 + 退回合计 |
| 平均审核耗时 | `median_review_duration_ms` | 审核耗时中位数 |
| 累计审核 | `total_reviewed` | 历史总审核数 |
| 24h 通过率 | `approval_rate_24h` | 过去 24 小时通过 / (通过 + 退回) |
| 历史通过率 | `approval_rate` | 全量通过率 |
| 二次返修率 | `reopen_after_approve_rate` | 通过后被标注员 reopen 的比例 |
