---
audience: [annotator]
type: how-to
since: v0.1.0
status: stable
last_reviewed: 2026-06-10
---

# Polygon 标注

## 操作

1. 按 `P` 切到多边形工具
2. 沿目标边界依次单击落点，每点会生成一个顶点
3. 双击 / 按 `Enter` 闭合多边形
4. 在多边形旁弹出的类别浮层中选择 `region` 类别

<DocsVideo
  src="/media/polygon/draw.mp4"
  poster="/media/polygon/draw-poster.webp"
  alt="沿目标边界逐点绘制多边形并按 Enter 闭合提交"
  caption="沿边界依次落点，观察预览线和闭合提示，按 Enter 完成多边形并选择类别。"
/>

## 绘制快捷键

| 操作                     | 快捷键                                           |
| ------------------------ | ------------------------------------------------ |
| 撤销最后一个落点         | `Backspace`                                      |
| 取消当前草稿             | `Esc`                                            |
| 闭合多边形（≥ 3 个顶点） | `Enter` 或双击                                   |
| 自动闭合                 | 单击第一个顶点（首点高亮时出现「单击闭合」提示） |

## 编辑

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/polygon/vertex-insert-alt.png — 按住 Alt 悬停边上光标变「+」的瞬间 -->

- 选中已有多边形，鼠标悬停在**边**上 → 出现「+」图标，按住 `Alt` 后单击边插入新顶点
- 拖动顶点 → 修改形状
- `Shift + 单击顶点` → 删除该顶点（多边形 ≤ 3 个顶点时拒绝删除）
- 绘制 polygon / polyline 或拖动 polygon 顶点时，会在 8px 屏幕距离内吸附到可见 polygon / multi_polygon 的顶点或边界；按住 `Alt` 可临时关闭吸附
- 多选同类别 polygon / multi_polygon 后，可在浮条或右键菜单点「合并」生成一个新的 polygon / multi_polygon；原标注会被删除，整次操作可一次撤销
- 不同类别、锁定标注或非 polygon 几何不会合并；属性完全相同时保留，不一致时新标注属性为空
- 多选 ≥ 2 个 polygon / multi_polygon 后，在**右键的那个**多边形上点右键菜单「裁切重叠区」，会从它身上减去其余选中多边形的重叠区域（布尔差集）：被裁的框作基准、几何就地更新（可裁出孔洞），其余框原样保留。常用于遮挡场景（前景物体压在背景上时，让背景多边形不再覆盖前景），不要求同类别；若重叠区覆盖整个基准则裁切失败并提示

## 性能提示

- 渲染层 LOD（Douglas-Peucker 简化）：未选中态下顶点数超过 **60** 时，画布渲染会按当前视口缩放级别自动简化；编辑态和选中态始终使用完整顶点，保证拖拽手感。
- 顶点数量本身没有硬性上限，但顶点过多（如 > 500）会明显增加序列化和 API 传输开销，建议合并/简化后再提交。
- 复杂形状可考虑拆分为多个多边形；Slice 切割工具仍在后续版本中补齐。

<!-- IMAGE_CHECKLIST: images/polygon/vertex-edit.png — 暗色多边形选中态，鼠标悬停在边上出现 + 图标的瞬间；旧图未展示该状态，已删除。 -->
<!-- IMAGE_CHECKLIST: images/polygon/close-hint.png — 暗色三顶点已落点，下一点贴近第一点出现「单击闭合」提示；旧图未展示该状态，已删除。 -->
