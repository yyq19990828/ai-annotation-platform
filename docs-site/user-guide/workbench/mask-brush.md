---
audience: [annotator]
type: how-to
since: v0.10.8
status: stable
last_reviewed: 2026-07-21
---

# Mask 笔刷编辑器

> 开启项目原生 Mask 能力后，图片与视频都保存逐像素 RLE；未开启的旧图片项目仍保留 polygon 兼容提交。

Mask 笔刷工具使用 `M` 键进入。常见用法：

- **AI 候选过糙** —— 文本 / SmartBox 出来的 polygon 边缘偏移几个像素 → 一笔刷快速纠
- **已落库 polygon 局部修正** —— 不想重画整个轮廓，只想把右上角凸出去的几个像素擦掉
- **从零开始** —— 当 AI 没合适候选、polygon 工具又嫌点位太繁琐时，直接刷个 mask

图片工作台会先读取任务 Mask 能力。当部署总闸、项目开关与 `region` 工具均开启时，笔刷结果直接保存为
`raster_mask`；关闭时可只读渲染已有 Mask，或在后端明确允许时走旧 polygon 路径。能力加载失败不会被当成兼容许可。

## 图片任务的进入方式

![Mask 笔刷工具栏](../images/mask-brush/toolbar-overview.png)

![Mask 笔刷涂抹：拖拽绘制笔迹，Enter 提交](../images/mask-brush/draw-in-progress.gif)

1. **空白 mask（从零开始）**
   - 按 `M` 或工具栏点 Mask 图标 → 鼠标在画布上拖拽即开始画
   - 完成后按 `Enter` 提交；原生项目创建 `raster_mask`，兼容项目创建 polygon

2. **AI prediction polygon 精修**
   - 右侧 AIInspector 中找到 polygon 候选行 → 点该行的「精修」按钮
   - 自动进 mask 工具，buffer 从候选 polygon 初始化（已涂为红色 mask）
   - 用 `B`(笔刷)/`E`(橡皮) 修正 → `Enter` 提交
   - 原生提交前会显示 polygon → Mask 的面积、组件、孔洞和 XOR 报告，确认后用候选 label 落库

3. **SAM 候选精修**
   - SAM 工具（SmartPoint / SmartBox）出 polygon 候选后，**不要按 Enter 采纳**
   - 按 `R`，或点画布上候选附近的「✎ 精修」浮按钮
   - 进 mask 编辑 → `Enter` 提交 → 原 SAM 候选消失，新 Mask 或兼容 polygon 入库

4. **已落库 user polygon 精修**
   - 选中右侧侧栏的 polygon 行 → 点该行「精修」按钮（用户行 / AI 行都有）
   - mask 编辑 → `Enter` 提交：直接 **update** 原 annotation 的 geometry，保留 id、类别、属性、来源和层级

5. **已有 Raster Mask 再编辑**
   - 在列表或选中卡点「编辑 Mask」，工作台先加载已存 RLE，不会从空白 Buffer 覆盖真值
   - 保存顺序为读取、编辑、上传不可变内容、带版本条件更新 annotation；冲突或网络失败保留 Buffer 和笔画历史
   - 如果对象被擦空，提交时可选择删除对象、撤销本次擦空，或保持空白继续编辑
   - 也可保持选中对象并切到[智能笔迹](./sam-tool.md#智能笔迹smart-scribble在已存-mask-上做加减法)，用正负点、框或笔迹让 AI 原位精修；浏览器只提交 annotation ID 与版本

## Polygon 与 Mask 显式转换

选中卡提供单对象「转 Mask」或「转矢量」。转换会先显示源/目标类型、像素面积、组件、孔洞、顶点和 XOR 变化。默认不简化；报告为有损时还需第二次确认。

- polygon / multi-polygon → Mask 按原图分辨率和 pixel-center 规则栅格化，保留全部外环与孔洞。
- Mask → polygon / multi-polygon 追踪所有像素边界，不会只取最大外环。
- 转换原位更新同一 annotation，可用标注撤销/重做恢复。

## 视频 Mask 轨迹

<!-- TODO IMAGE_CHECKLIST: images/mask-brush/video-mask-track-edit.gif — 视频 Mask 创建、保持帧编辑与关键帧物化全过程 [auto-gif] -->

在视频任务中按 `M` 或点击「Mask 轨迹」工具：

1. 没有选中 Mask 轨迹时，在当前帧落笔会从空白画布开始；确认后创建一条只有当前帧关键帧的 Mask 轨迹。
2. 选中已有 Mask 轨迹再进入工具，会加载当前帧解析到的 mask。若当前帧只是关键帧之间的保持帧，提交会在当前帧物化一个人工关键帧，不会覆盖来源关键帧。
3. 时间轴把 Mask 关键帧之间显示为「保持」，不会标成 bbox 的线性插值。`outside` 帧不显示 mask；`occluded` 仍表示对象存在。
4. 每次按下到松开是一条独立的笔刷历史；`Ctrl/⌘+Z` 撤销一笔，`Ctrl/⌘+Shift+Z` 或 `Ctrl/⌘+Y` 重做（图片和视频路径一致）。
5. 选中卡支持编辑、AI 追踪、显隐、锁定、改类、删除和关键帧导航。Mask 不支持 bbox 专属的轨迹合并、拆框或转换操作。
6. 选中 Mask 轨迹时按 `Delete` 只删除当前关键帧；删除整条轨迹用 `Ctrl/⌘+Delete` 或右键菜单的「删除整条轨迹」。

当 Tracker 在某帧发生漂移时，编辑该帧 Mask 后可选择「仅保存」、向更早帧、向更晚帧或双向重传播。当前帧会先以人工关键帧单独保存；传播结果只进入待审候选，不会立即覆盖轨迹。窗口会同时受当前视频分段和模型单窗上限约束，纠错帧本身不进入候选。

模型能原生消费 Mask seed 时使用已保存的 RLE；只支持 bbox seed 的模型会明确显示降级原因，并要求手动确认和填写必需文本。作业创建失败时，已保存的人工帧保留；只有可重试错误才会复用同一版本与内容摘要重试创建作业。取消纠错作业会清除暂存候选，不会删除人工纠错帧。

## 快捷键

| 键 | 作用 |
|---|---|
| `M` | 切到 Mask 工具 |
| `B` | mask 工具激活时切笔刷（涂） |
| `E` | mask 工具激活时切橡皮（擦） |
| `Shift + 滚轮` | 调笔刷半径 ±2px（clamp [1, 200]） |
| `Enter` | 提交当前 Mask（需已有笔迹，否则不物化）；图片原生项目写入 RLE，兼容项目转 polygon，视频写入 RLE 关键帧 |
| `Esc` | 取消，丢弃当前 mask buffer |
| `Ctrl/⌘ + Z` | 撤销上一笔笔迹（图片 / 视频一致） |
| `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y` | 重做上一笔笔迹（图片 / 视频一致） |
| `Delete` | 视频：删除选中 Mask 轨迹的当前关键帧（非整轨） |
| `Ctrl/⌘ + Delete` | 视频：删除整条选中 Mask 轨迹 |
| `R` | SAM 候选存在时启动「精修」（同浮按钮） |

完整快捷键索引见 [hotkeys.generated.md](./hotkeys.generated.md)。

## 浮动工具栏控件说明

进入 Mask 工具后，画布顶部居中会出现浮动工具栏，从左到右依次为：

- **笔刷 / 橡皮 chip**：两个互斥按钮，分别对应 `B` 和 `E` 快捷键；当前激活态高亮。
- **半径 slider**：范围 `[1, 200]` px，默认 **16px**；可拖动或用 `Shift + 滚轮` 微调（±2px/格）。右侧实时显示当前半径数值。
- **状态文字**：明确显示加载中、就绪、未保存、保存中或失败；失败时可重试或恢复编辑。
- **笔画撤销 / 重做**：工具栏按钮与快捷键共用同一笔画历史。
- **取消 / 确认按钮**：确认按钮在 `active && dirty` 同时为真时才可点击；仅 active 但尚未涂抹（`!dirty`）时确认按钮置灰。

## 已知限制

- **bbox 候选不支持初始化**：AI 给的是 bbox 时「精修」按钮不显示。
- **兼容项目的 polygon 限制**：只有旧 polygon 提交路径才会在多连通或含孔时阻止有损落库；原生 Mask 路径保留全部像素。
- **大于编辑上限的图片**：当前单幅 Mask 最大边长与像素数由任务能力响应给出；超限时不进入编辑器。
- **大画布性能**：MaskBuffer 使用 dirtyRect 增量重绘；极大图仍建议降低笔刷半径并分段精修。

## 故障排查

- **按 M 不响应**：确认非只读模式（task 已锁定 / 已审完），输入框聚焦时 hotkey 会被吞
- **图片 Mask 无法保存**：先看工具栏是否为加载/保存失败，再确认项目原生开关、`region` 工具和任务状态。版本冲突后稿件保留，可刷新对象后重试。
- **锁定 Mask 无法修改或删除**：先在列表或选中卡解锁对象；后端也会拒绝锁定对象的几何替换和删除。
- **视频任务确认后无 Mask 关键帧**：先确认当前帧已产生有效笔迹且任务可编辑；若编辑的是保持帧，成功提交后应在当前帧新增人工关键帧，而不是改写来源关键帧
- **纠错帧已保存但传播未启动**：可重试的网络或队列错误可直接重试，不会重复保存关键帧；版本、内容摘要或模型能力冲突需关闭对话框、刷新标注后重新发起。
- **mask 与 SAM 候选重叠看不清**：mask 是半透红，透明度可在工作台设置的「图片 → Mask 覆盖透明度」调整；SAM 是紫虚线，可按 `E` 临时擦掉 mask 中已被 SAM 覆盖的部分

## 相关 ADR

- [ADR-0022 · Mask 编辑器工具架构](/dev/adr/archive/0022-mask-editor-tool-architecture)
- [ADR-0052 · 共享栅格 Mask 与图片 geometry 合同](/dev/adr/0052-shared-raster-mask-and-image-geometry)
