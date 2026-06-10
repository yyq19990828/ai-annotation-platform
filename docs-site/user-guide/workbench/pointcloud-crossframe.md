---
audience: [annotator]
type: how-to
since: v0.14.1
status: stable
last_reviewed: 2026-06-10
---

# 点云与序列跨帧标注

scene 模式的项目里，同一物体会在一段录像里连续出现多帧。跨帧能力让你不必每帧从零画框，并能叠加邻帧参考检查时序连续性。本功能同时适用于 **3D 点云框**和 **2D 图像序列框**（bbox / polygon / rotated_bbox / polyline / keypoint 等）。scene 与 `frame_index` 的概念见 [Scene + frame_index 跨 task 帧序列地基](/dev/concepts/scene-and-frame-index)。

## 跨帧目标延续

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/pointcloud-crossframe/crossframe-propagate-toast.png — 按 Alt+→ 跳帧自动选中新框 + toast [manual] -->

同一物体在一段录像里连续出现多帧时，不必每帧从零画框：

- **`Alt+→`**（主键，2D 与 3D 通用）：把当前选中的标注延续到**同 scene 的下一帧** task —— 系统在下一帧新建一个几何相同的框（与源框共享 `group_id`，表示"同一物体"），自动跳到下一帧工作台并选中这个新框，你只需微调位置即可继续 `Alt+→`。
- **`Alt+←`**：同理延续到上一帧。
- **`Shift+→` / `Shift+←`**（3D 补充键）：3D 点云舞台额外支持 Shift+方向键触发同一跨帧延续。2D 舞台中 `Shift+方向` 已用于 10px 平移，故 2D 只能用 `Alt+方向`。
- 已到 scene 末帧再按 `Alt+→`、首帧再按 `Alt+←`，提示"已是该 scene 最后 / 首帧"，**不会**误跳到别的 scene。
- 仅在选中了一个标注时生效，且该标注的几何类型须属于可跨帧复制的类型（`bbox / polygon / multi_polygon / rotated_bbox / polyline / keypoint / box_3d`）；未选中或选中点云分割（`point_mask_3d`）会有相应提示。

> 跨帧延续不是破坏性操作：新框只是源框的副本，调坏了可直接删除或撤销。

## 邻帧参考叠加（仅 3D 点云）

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/pointcloud-crossframe/overlay-k3-triview.png — K=3 时主视图 + 三视图半透明虚线参考框 [manual] -->

工具条「邻帧叠加」切换前后各显示几帧的同 `group_id` 历史 / 未来框作时序参考：

- 档位 **关 / 1 / 3 / 5 / 7**；选 K>0 后，选中某个有跨帧链（`group_id`）的框时，主视图 + 三视图叠加显示前后各 K 帧该物体的框。
- 参考框为**半透明虚线、不可选不可拖**，只读参考，方便判断时序连续性（这一帧的位置和上一帧是否对得上）。
- 当前档位记在浏览器本地（`localStorage`），切 task 不重置。
