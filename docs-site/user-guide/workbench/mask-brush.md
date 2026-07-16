---
audience: [annotator]
type: how-to
since: v0.10.8
status: stable
last_reviewed: 2026-07-17
---

# Mask 笔刷编辑器

> 图片任务把笔刷结果转回 polygon；视频任务把逐像素结果保存为可跨帧保持的 Mask 轨迹关键帧。

Mask 笔刷工具使用 `M` 键进入。常见用法：

- **AI 候选过糙** —— 文本 / SmartBox 出来的 polygon 边缘偏移几个像素 → 一笔刷快速纠
- **已落库 polygon 局部修正** —— 不想重画整个轮廓，只想把右上角凸出去的几个像素擦掉
- **从零开始** —— 当 AI 没合适候选、polygon 工具又嫌点位太繁琐时，直接刷个 mask

图片工作台走「polygon 中转」：mask 在前端临时态编辑，提交时转回 polygon。视频工作台则保存标准 RLE，创建或更新
`video_track_mask`，不会为了落库把像素边界矢量化。

## 图片任务的四种进入方式

![Mask 笔刷工具栏](../images/mask-brush/toolbar-overview.png)

![Mask 笔刷涂抹：拖拽绘制笔迹，Enter 提交转 polygon 落库](../images/mask-brush/draw-in-progress.gif)

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

## 视频 Mask 轨迹

<!-- TODO IMAGE_CHECKLIST: images/mask-brush/video-mask-track-edit.gif — 视频 Mask 创建、保持帧编辑与关键帧物化全过程 [auto-gif] -->

在视频任务中按 `M` 或点击「Mask 轨迹」工具：

1. 没有选中 Mask 轨迹时，在当前帧落笔会从空白画布开始；确认后创建一条只有当前帧关键帧的 Mask 轨迹。
2. 选中已有 Mask 轨迹再进入工具，会加载当前帧解析到的 mask。若当前帧只是关键帧之间的保持帧，提交会在当前帧物化一个人工关键帧，不会覆盖来源关键帧。
3. 时间轴把 Mask 关键帧之间显示为「保持」，不会标成 bbox 的线性插值。`outside` 帧不显示 mask；`occluded` 仍表示对象存在。
4. 每次按下到松开是一条独立的笔刷历史；`Ctrl/⌘+Z` 撤销一笔，`Ctrl/⌘+Shift+Z` 或 `Ctrl/⌘+Y` 重做。
5. 选中卡支持编辑、AI 追踪、显隐、锁定、改类、删除和关键帧导航。Mask 不支持 bbox 专属的轨迹合并、拆框或转换操作。

## 快捷键

| 键 | 作用 |
|---|---|
| `M` | 切到 Mask 工具 |
| `B` | mask 工具激活时切笔刷（涂） |
| `E` | mask 工具激活时切橡皮（擦） |
| `Shift + 滚轮` | 调笔刷半径 ±2px（clamp [1, 200]） |
| `Enter` | 提交当前 Mask；图片任务转为 polygon，视频任务写入 RLE 关键帧 |
| `Esc` | 取消，丢弃当前 mask buffer |
| `Ctrl/⌘ + Z` | 视频 Mask 编辑时撤销上一笔 |
| `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` | 视频 Mask 编辑时重做 |
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
- **图片任务不持久化 RLE**：图片提交仍转 polygon；视频 Mask 轨迹会持久化 RLE。
- **大画布性能**：MaskBuffer 使用 dirtyRect 增量重绘；极大图仍建议降低笔刷半径并分段精修。

## 故障排查

- **按 M 不响应**：确认非只读模式（task 已锁定 / 已审完），输入框聚焦时 hotkey 会被吞
- **图片任务 Enter 后无 polygon 落库**：mask 尚未涂抹（`dirty` 为假）或涂抹区域过小（转出顶点 < 3）时 `commitToPolygon` 返回 null，工具栏确认按钮置灰（`!active || !dirty`）；Enter 键虽可触发提交流程，但同样会被 null 结果拦截并弹 toast 提示
- **视频任务确认后无 Mask 关键帧**：先确认当前帧已产生有效笔迹且任务可编辑；若编辑的是保持帧，成功提交后应在当前帧新增人工关键帧，而不是改写来源关键帧
- **mask 与 SAM 候选重叠看不清**：mask 是半透红，透明度可在工作台设置的「图片 → Mask 覆盖透明度」调整；SAM 是紫虚线，可按 `E` 临时擦掉 mask 中已被 SAM 覆盖的部分

## 相关 ADR

- [ADR-0022 · Mask 编辑器工具架构](/dev/adr/archive/0022-mask-editor-tool-architecture)
