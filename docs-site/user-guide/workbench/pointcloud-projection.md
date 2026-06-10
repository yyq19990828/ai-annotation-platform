---
audience: [annotator]
type: how-to
since: v0.13.4
status: stable
last_reviewed: 2026-06-10
---

# 点云跨模态联动

3D 框经各相机标定**实时**投影到悬浮相机面板上，标注员可对照图像确认 / 校正 3D 框，3D↔2D 双向选中联动。相机面板本身的显示与上色见 [点云视图与上色](./pointcloud-view)。

## 前提：标定文件

相机投影与锚点推导依赖数据集上传时提供的**标定 JSON**（每个相机一份），须包含：

- `extrinsic`：4×4 world→camera 变换矩阵（行主序，长度 16）；锚点外参兜底分支用前 3 行提取光轴向量。
- `intrinsic`：相机内参（焦距 + 主点）。
- `rect`（可选）：校正矩阵。

schema 详情见 [点云 / 多模态数据集导入格式 · 标定 JSON schema](../datasets/import-formats#标定-json-schema)。没有标定文件时，相机面板仍显示图像，但无投影线框。

## 3D→2D 投影

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/workbench-pointcloud-projection/overlay-wireframe.png — 相机面板线框投影 overlay + 「正对」角标 [manual] -->

选中（或悬停）3D 框时，所有相机面板实时重绘投影线框（类别色）。对各相机可见角点数降序排列，可见角点最多的相机角标「· 正对」，用于快速定位主确认视角。

## 2D→3D 反选与命中测试

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/workbench-pointcloud-projection/click-to-select-3d.png — 点击投影框联动主视图高亮 [manual] -->

单击相机面板里的投影区域时，系统在画布坐标系做逐框扫描：

- 命中规则：鼠标落点 `(x, y)` 落在某框轴对齐包围盒 `[x0, x1] × [y0, y1]` 内则命中。
- 多框重叠时，选**面积最小**的框（前景 / 近处框面积通常较小，优先选中）。
- 命中后调用 `onSelectBox`，选中对应 3D 框；`Shift+点击` 支持多选叠加。

## 同物体高亮

同 `group_id` 成员经选中联动一并高亮，方便对照跨帧 / 跨视角确认同一物体的所有关联框。

## 相机面板贴边

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/workbench-pointcloud-projection/camera-panel-layout.png — 6 相机环绕布局全景 [manual] -->

## 相机面板锚点推导

每个相机根据 **role/name 优先、外参兜底** 的规则被分配到主视图四周某个边缘位置（`top / bottom / left / right` 及四角，认不出时落 `overflow` 兜底小条）：

1. **名字优先**：role 或 name 包含 `front/rear/back/left/right` 及复合（`front_left` 等）时直接映射，复合规则先于简单规则匹配。
2. **外参兜底**：取 `extrinsic` 第三行前两列提取光轴水平方位角，按 45°/22.5° 边界映射到 8 方位。此分支假设 LiDAR 系为 **X=前 / Y=左 / Z=上**（KITTI / ROS REP-103 标准）。
3. **都识别不了或光轴近垂直**：落 `overflow`（底部小条，不丢相机）。

锚点容器定位说明：

- 各方位锚点容器（`camAnchorTop` 等）通过 CSS `position: absolute` 贴在主视图 canvas 四边，定位偏移均为固定 12 px（CSS 硬编码，不读取工具条高度）。
- `max-height` 受 `--top-toolbar-height` CSS 自定义属性约束（运行时由 ResizeObserver 动态写入），可避免面板高度超出可视区；但面板的 `top` 起点不随工具条高度平移，工具条换行时顶部相机面板可能与工具条部分重叠。
- 右侧锚点容器的 `right: 12px` 是相对于主视图 canvas 包装元素（不含右侧标注列表）的右边界，不会重复叠加右栏宽度。
