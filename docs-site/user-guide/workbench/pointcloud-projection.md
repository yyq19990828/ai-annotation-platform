---
audience: [annotator]
type: how-to
since: v0.13.4
status: stable
last_reviewed: 2026-06-06
---

# 点云跨模态联动

3D 框经各相机标定**实时**投影到悬浮相机面板上，标注员可对照图像确认 / 校正 3D 框，3D↔2D 双向选中联动。相机面板本身的显示与上色见 [点云视图与上色](./pointcloud-view)。

- **3D→2D 投影**：3D 框经各相机标定实时投影为线框叠加在悬浮相机面板上（类别色）；最正对的相机角标「· 正对」。
- **2D→3D 反选**：单击相机面板里的投影框 → 反选对应 3D 框。
- **同物体高亮**：同 `group_id` 成员经选中联动一并高亮，方便对照确认。
- 相机面板贴主视图边缘；顶部锚点会避让工具条，工具条换行时自动下移，右侧锚点不再因为右栏宽度重复偏移。

> 标定 JSON 的 schema（`extrinsic` / `intrinsic` / `rect`）见 [点云 / 多模态数据集导入格式 · 标定 JSON schema](../datasets/import-formats#标定-json-schema)。
