---
audience: [annotator]
type: how-to
since: v0.10.8
status: stable
last_reviewed: 2026-06-10
---

# Mask 笔刷编辑器

> 用笔刷 / 橡皮把粗略的 polygon 精修到像素级，或从空白开始画一块 mask 直接落库为 polygon。

Mask 笔刷工具使用 `M` 键进入。常见用法：

- **AI 候选过糙** —— 文本 / SmartBox 出来的 polygon 边缘偏移几个像素 → 一笔刷快速纠
- **已落库 polygon 局部修正** —— 不想重画整个轮廓，只想把右上角凸出去的几个像素擦掉
- **从零开始** —— 当 AI 没合适候选、polygon 工具又嫌点位太繁琐时，直接刷个 mask

mask 编辑器走的是「polygon 中转」：mask 在前端临时态编辑，提交时转回 polygon 落库，schema 不变。

## 四种进入方式

<!-- TODO(v0.14.18) IMAGE_CHECKLIST: images/mask-brush/toolbar-overview.png — Mask 笔刷浮动工具栏全貌（笔刷/橡皮 chip + 半径 slider + 状态文字） [auto] -->

1. **空白 mask（从零开始）**
   - 按 `M` 或工具栏点 Mask 图标 → 鼠标在画布上拖拽即开始画
   - 完成后按 `Enter` 提交，落一个 polygon annotation（label = 工具栏当前类别）

2. **AI prediction polygon 精修**
   - 右侧 AIInspector 中找到 polygon 候选行 → 点该行的「精修」按钮
   - 自动进 mask 工具，buffer 从候选 polygon 初始化（已涂为红色 mask）
   - 用 `B`(笔刷)/`E`(橡皮) 修正 → `Enter` 提交
   - 原候选会自动 reject，新 polygon 用候选 label 落库

3. **SAM 候选精修**
   - SAM 工具（SmartPoint / SmartBox）出 polygon 候选后，**不要按 Enter 采纳**
   - 按 `R`，或点画布上候选附近的「✎ 精修」浮按钮
   - 进 mask 编辑 → `Enter` 提交 → 原 SAM 候选消失，新 polygon 入库

4. **已落库 user polygon 精修**
   - 选中右侧侧栏的 polygon 行 → 点该行「精修」按钮（用户行 / AI 行都有）
   - mask 编辑 → `Enter` 提交：直接 **update** 原 annotation 的 geometry（不新建，可 undo 回原状）

## 快捷键

| 键 | 作用 |
|---|---|
| `M` | 切到 Mask 工具 |
| `B` | mask 工具激活时切笔刷（涂） |
| `E` | mask 工具激活时切橡皮（擦） |
| `Shift + 滚轮` | 调笔刷半径 ±2px（clamp [1, 200]） |
| `Enter` | 提交 mask → polygon 落库 / 更新 |
| `Esc` | 取消，丢弃当前 mask buffer |
| `R` | SAM 候选存在时启动「精修」（同浮按钮） |

完整快捷键索引见 [hotkeys.generated.md](./hotkeys.generated.md)。

## 浮动工具栏控件说明

进入 Mask 工具后，画布顶部居中会出现浮动工具栏，从左到右依次为：

- **笔刷 / 橡皮 chip**：两个互斥按钮，分别对应 `B` 和 `E` 快捷键；当前激活态高亮。
- **半径 slider**：范围 `[1, 200]` px，默认 **16px**；可拖动或用 `Shift + 滚轮` 微调（±2px/格）。右侧实时显示当前半径数值。
- **状态文字**：未开始涂抹时显示「就绪」，涂抹后变「未保存」（dirty 态）。
- **取消 / 确认按钮**：确认按钮在 `active && dirty` 同时为真时才可点击；仅 active 但尚未涂抹（`!dirty`）时确认按钮置灰。

## 已知限制

- **bbox 候选不支持初始化**：AI 给的是 bbox 时「精修」按钮不显示。
- **多连通区只保留最大外环**：mask 包含多块互不相连的区域时，只把最大连通块转回 polygon 入库，其它区域丢弃 + toast 提示
- **不支持 RLE 持久化**：mask 不入库；提交即转 polygon。跨任务连续编辑同一 mask 不可行
- **大画布性能**：MaskBuffer 使用 dirtyRect 增量重绘；极大图仍建议降低笔刷半径并分段精修。

## 故障排查

- **按 M 不响应**：确认非只读模式（task 已锁定 / 已审完），输入框聚焦时 hotkey 会被吞
- **Enter 后无 polygon 落库**：mask 尚未涂抹（`dirty` 为假）或涂抹区域过小（转出顶点 < 3）时 `commitToPolygon` 返回 null，工具栏确认按钮置灰（`!active || !dirty`）；Enter 键虽可触发提交流程，但同样会被 null 结果拦截并弹 toast 提示
- **mask 与 SAM 候选重叠看不清**：mask 是半透红，透明度可在工作台设置的「图片 → Mask 覆盖透明度」调整；SAM 是紫虚线，可按 `E` 临时擦掉 mask 中已被 SAM 覆盖的部分

## 相关 ADR

- [ADR-0022 · Mask 编辑器工具架构](/dev/adr/0022-mask-editor-tool-architecture)
