---
audience: [annotator]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-05-09
---

# Polygon 标注

## 操作

1. 按 `P` 切到多边形工具
2. 沿目标边界依次单击落点，每点会生成一个顶点
3. 双击 / 按 `Enter` 闭合多边形
4. 右侧属性面板选择类别

## 编辑

- 选中已有多边形，鼠标悬停在边界上 → 出现「+」图标，单击插入新顶点
- 拖动顶点 → 修改形状
- 选中顶点 → `Delete` 删除
- 多选同类别 polygon / multi_polygon 后，可在浮条或右键菜单点「合并」生成一个新的 polygon / multi_polygon；原标注会被删除，整次操作可一次撤销
- 不同类别、锁定标注或非 polygon 几何不会合并；属性完全相同时保留，不一致时新标注属性为空

## 属性模式

当当前工具的属性 schema 包含 boolean / select / multiselect 字段时，画布顶部会显示属性模式栏。

1. 打开「属性模式」
2. 选择要补录的字段和值
3. 直接点击 bbox、旋转框或 polygon / multi_polygon 标注，把该值写入标注属性

text / number / range 字段仍在右侧属性面板编辑。

## 性能提示

- 顶点超过 200 个会触发性能警告，建议合并/简化
- 复杂形状可考虑拆分为多个多边形；Slice 切割工具仍在后续版本中补齐

## 典型场景

![顶点编辑](../images/polygon/vertex-edit.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 多边形选中态，鼠标悬停在边上出现 + 图标的瞬间。 -->

![闭合提示](../images/polygon/close-hint.png)
<!-- TODO(0.8.1) IMAGE_CHECKLIST: 三顶点已落点，第四点贴近第一点出现「单击闭合」提示。 -->
