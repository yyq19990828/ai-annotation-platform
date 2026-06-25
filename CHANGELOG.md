# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md) |
| 0.8.x | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md) |
| 0.7.x | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md) |
| 0.6.x | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md) |
| 0.5.x | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md) |
| 0.4.x | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md) |
| 0.3.x | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md) |
| 0.2.x | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md) |
| 0.1.x | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md) |


---

## 最新版本

<!-- 0.18.x 版本变更按版本段追加到本区；进入 0.19.x 后整体移到 docs/changelogs/0.18.x.md -->
<!-- 0.18.7（并行扇出规模化 / Celery chord）为规模驱动的「按需」版本，无实测 wall-clock 压力前不实施，故版本号留空，见 docs/plans/2026-06-23-v0.18.7-staged-preannotate-chord-parallelism.md -->

## [0.18.23] - 2026-06-26

yolo-backend 开集 epic 收官 (第 3/3 版): YOLOE **visual prompt exemplar** 接成交互工具——工作台拖框圈一个样例, YOLOE 在全图找出同类目标 (框 / mask), 与 sam3 的 exemplar「找全图相似」同列。后端推理链路 + 平台能力透传 + 前端工具门控全部落地。规划见 [`docs/plans/2026-06-25-v0.18.23-yoloe-visual-prompt-exemplar.md`](docs/plans/2026-06-25-v0.18.23-yoloe-visual-prompt-exemplar.md)。

### Added

- **YOLOE 视觉提示交互模型 (yolo-backend)**：`/setup` 新增 `exemplar-yoloe`（`is_interactive=true`、`supported_prompts=["exemplar"]`、`task=interactive_seg`、几何输出 `bbox`+`polygon`、仅 yoloe series），令 yolo-backend 整体成为交互 backend——工作台 ExemplarTool 在选定 yolo-backend 时自动启用。声明 `exemplar_capabilities`（`multi_box`、`negative_box=false`、`text_combination=false`、`threshold_refilter`）供前端按能力渲染控件。
- **visual prompt 推理分支**：`type=exemplar` 走 `_predict_visual_prompt`——仅取正框样例（YOLOE 无负框）、归一化 bbox→像素、`visual_prompts={bboxes, cls=0}`（MVP 单类）、`refer_image=源图自身`（同图）、统一用 `YOLOEVPSegPredictor`（`-seg` 权重一次产出框+mask，按 `output` 取 box/mask/both）；`score_threshold` 映射 conf。独立 pool key（与文本句柄隔离，避免 VP 改写模型状态污染文本嵌入缓存）。

- **exemplar 能力门控 (平台 + 前端)**：平台 `ml_capabilities` 透传各模型的 `exemplar_capabilities`（此前被规范化丢弃）；工作台 AI 抽屉据此按能力渲染 exemplar 控件——YOLOE（`negative_box=false`/`text_combination=false`）隐藏负极性按钮与叠加文本输入，并强制正极性（防 smart-point 残留负极性误发被剔除的负框）；sam3（全支持）行为不变。输出形态三选（box/mask/both）恒显示。

### Changed

- **yolo-backend `/predict` 兼容交互单数 wire**：`BatchPredictRequest` 接受平台交互调用的单数 `{task, context}`（归一成 `tasks=[task]`），使同一端点同时收批量（`tasks`）与交互（`task`）两种形态。

## [0.18.22] - 2026-06-26

yolo-backend 开集文本能力补齐**实例分割**：批量文本面板用自然语言类名让 YOLOE 出多边形 mask（与 grounded-sam2 文本分割同形）。复用 v0.18.21 的文本推理链路与 PE 缓存，同一 `-seg` 权重检测/分割共用一份句柄——`detect-yoloe` 与 `segment-yoloe` 走同一 pool key，仅按 `output`（box/mask/both）取框 / mask / 两者。YOLO-World 无分割头，本版仅涉及 YOLOE。yolo 开集 epic 第 2/3 版。规划见 [`docs/plans/2026-06-25-v0.18.22-yoloe-openvocab-text-segmentation.md`](docs/plans/2026-06-25-v0.18.22-yoloe-openvocab-text-segmentation.md)。

### Added

- **开集文本分割模型（yolo-backend）**：`/setup` 新增 `segment-yoloe`（YOLOE，series `yoloe-v8`/`yoloe-11`/`yoloe-26` × 档位），`task=segmentation`、`supported_geometric_outputs=["polygon"]`、`supported_text_outputs=["mask","both"]`、`supported_prompts=["text"]`、`is_interactive=false`。前端文本面板据 `supported_text_outputs` 派生输出形态三选，与 gsam2 文本分割同列。
- **文本→mask 推理分支**：`_predict_open_text` 按 `ctx.output` 分流——`box` 出 `rectanglelabels`、`mask` 出 `polygonlabels`（复用闭集 segment 的 mask→polygon 简化链路）、`both` 同时返回；world 系列即便请求 mask 也退回检测框（无分割头）。`detect-yoloe`/`segment-yoloe` 同 `-seg` 权重共用 pool 句柄，切换输出形态无需重载（实测 mask 复用 warm 句柄 ~12ms）。

## [0.18.21] - 2026-06-25

yolo-backend 从「纯闭集批量」扩出**开集文本检测**：在批量文本面板用自然语言类名（如 `person, bus`）让 YOLO-World / YOLOE 出框，与 grounded-sam2 的文本能力同列。零新仓（ultralytics 8.4.x 原生内置 `YOLOWorld`/`YOLOE`），权重按 release v8.4.0 实测核对可下载。yolo 开集 epic 第 1/3 版（后续 v0.18.22 文本分割、v0.18.23 visual prompt exemplar 交互）。规划见 [`docs/plans/2026-06-25-v0.18.21-yolo-openvocab-text-detection.md`](docs/plans/2026-06-25-v0.18.21-yolo-openvocab-text-detection.md)。

### Added

- **开集文本检测模型（yolo-backend）**：`/setup` 新增 `detect-world`（YOLO-World，series `yolo-worldv2`/`yolo-world` × s/m/l/x）与 `detect-yoloe`（YOLOE，series `yoloe-v8`/`yoloe-11`/`yoloe-26`），`supported_prompts=["text"]`、`task=detection`、`is_interactive=false`（文本=批量，进批量面板不进交互工具栏）。开集 series 独立命名空间，不混入闭集 `MODEL_MATRIX`；YOLOE 复用 `-seg` 权重取 box（同权重供后续分割/视觉提示共用）。
- **文本提示推理链路**：`Context` 支持平台文本扁平 wire（`type=text` + `text` + `model_id` + `model_variants` + 顶层 conf/iou/max_det 收拢）；按 series 派生 family（world→`YOLOWorld`/yoloe→`YOLOE`），文本经 CLIP（World）/ MobileCLIP（YOLOE）编码后检测，结果映射 `rectanglelabels`。
- **文本嵌入缓存**：同一组类名（含顺序）跨图复用不重复编码；YOLOE 另存 PE 字典，切换 prompt 再切回仍命中（实测新类名编码 ~350ms，缓存命中 ~17ms）。

### Changed

- **yolo-backend 镜像**：Dockerfile 加 `git` + 烤入 ultralytics CLIP fork（修复此前文本提示因无 git 致运行时 AutoUpdate 安装 CLIP 失败的硬阻塞）；文本编码器权重（CLIP ViT-B/32 ~338MB + `mobileclip_blt.ts` ~572MB）经 `/app/weights` 软链落 checkpoints 持久卷，首下后跨重启复用，不烤进镜像层。

## [0.18.19] - 2026-06-25

SAM 3 PCS exemplar 从「一发定生死」升级为**无状态迭代 refine 会话**，解决「全图相似不好用」：可累加多正负框（正框扩召回 / 负框排误检）、叠加 text 概念、拖阈值实时增减结果。源码证实 PCS 原生支持多 exemplar 累加（`append_boxes` concat 非覆盖）、负框（`add_geometric_prompt(label=False)`）、text+几何组合与阈值重过滤，此前 backend 每请求只发单正框、阈值写死，把官方交互循环整组丢弃。规划详见 [`docs/plans/2026-06-25-v0.18.19-sam3-pcs-iterative-refinement.md`](docs/plans/2026-06-25-v0.18.19-sam3-pcs-iterative-refinement.md)。

### Added

- **多正负框 + text 组合 exemplar（sam3-backend）**：`context.exemplars[]`（`[{bbox, label}]`，优先于单 `bbox`）顺序累加经 `add_geometric_prompt`；`label=true` 正框 / `false` 负框。可与 `context.text` 同时传，组合为「概念 + 视觉示例」。`predict_exemplars()` 统一三分支输出（box/mask/both），单框 `predict_bbox` / `predict_exemplar` 退化为薄封装。`/setup` 新增 `exemplar_capabilities`（`multi_box` / `negative_box` / `text_combination` / `threshold_refilter`）供前端开关。
- **前端 exemplar refine 会话**：exemplar 工具从单发升级为会话——拖框出全图相似实例后，继续加正框扩召回 / 加负框去误检（Alt 拖框或负极性切换）/ 拖阈值滑块实时重过滤 / 叠加文本概念，每次操作重发全量。画布 overlay 渲染会话已落的正框（绿色实线）/ 负框（红色虚线），`Esc`·切 prompt·切 task·backend 时清除。
- **候选紫虚线视觉强化**：SAM 候选「待确认」边框整体加粗（选中 / 未选中都更醒目），并加 marching-ants 流动虚线动效。渲染抽成独立 overlay 组件，逐帧动画用 `requestAnimationFrame` 隔离在该子树，不带动整个画布重渲。

### Changed

- **per-request 阈值重过滤**：无状态下每次重发全量 exemplars + 阈值，backbone 缓存命中时只重跑 grounding head（不重跑 backbone），略贵换可扩展性。

### Compatibility

- 向后兼容：旧单框请求（`type=exemplar` + 单 `context.bbox`）行为回归不破；新字段 `exemplars[]` 均可选。无 DB migration，无新增环境变量。

## [0.18.18] - 2026-06-25

交互分割多点精修质量优化：`mask_input` 回灌增量 + 会话点位可视化。SAM2/SAM3 的 `predict()` 接收上一轮 256×256 low-res logits 回灌，多点精修时稳住 mask 边界、修复「过度点击反而崩坏」。为保持 backend 无状态，logits 由前端携带往返（响应 `mask_input_next` → 下次点击 `context.mask_input`，前端只搬运不解析）；仅 `multimask_output=false` 的单 mask 精修阶段启用，规避多候选 index 歧义。同时补齐多点精修的可用性短板：画布渲染会话已落的正/负点（正绿圆 / 负红叉）。规划与量化详见 [`docs/plans/2026-06-25-v0.18.18-interactive-seg-mask-input-refeed.md`](docs/plans/2026-06-25-v0.18.18-interactive-seg-mask-input-refeed.md)。

### Added

- **`mask_input` 回灌（迭代精修增量）**：两 backend 解码 `context.mask_input` 透传上游 `predict(mask_input=...)`，单 mask 阶段把本轮 `low_res_masks` 编码回 `mask_input_next`；前端存储并在 ≥2 点精修时回传。编解码（`float16 + zlib + base64`）集中在共享包 `aap_protocol_v2.mask_codec`，对前端是不透明 token。GPU 实测（gsam2 large / coco8-seg）5-click IoU 中位 +1.86%、均值 +7.16%，并消除 OFF 在末次点击的退化；真实往返体积 <1KB（zlib 压饱和 logits）。
- **会话点位可视化**：`smart-point` 多点精修时画布 overlay 渲染已落的正点（绿色实心圆）/ 负点（红色叉），跟随视口缩放平移；提交 / `Esc` / 切 prompt·task·backend 时随会话清除。

### Changed

- **交互单实例响应携带 `mask_input_next`**：`PredictionResult` 新增可选字段（协议 §2.2 编码约定同步）；平台层透传，仅交互单实例路径非空。坏 / 过期 `mask_input` 串 backend 静默忽略，不让单次精修整体失败。

### Compatibility

- 纯增量、向后兼容：新增字段均可选，老前端 / 老 backend 缺字段时行为不变。无 DB migration，无新增环境变量。

## [0.18.17] - 2026-06-25

双 backend SAM-style 单实例交互对齐 + 协议统一。sam3-backend 开启 `enable_inst_interactivity` 解锁 SAM-style `point` / `interactive_box` 交互（走 `model.predict_inst`，与 PCS 共用同一 `backbone_out` 缓存）；grounded-sam2-backend 复用已加载权重透传 `multimask_output`。两 backend 点交互升级为正/负点累加（前端重发全量点、后端无状态），单点歧义出 `multimask_output` 三候选。同时统一交互 prompt 命名：单框单 mask 走 `interactive_box`、PCS 找全图相似走 `exemplar`，`bbox` 退出交互命名空间。规划详见 [`docs/plans/2026-06-25-v0.18.17-interactive-seg-dual-backend-sam-iterative.md`](docs/plans/2026-06-25-v0.18.17-interactive-seg-dual-backend-sam-iterative.md)。

### Added

- **sam3 原生单实例交互**：新增 `predict_interactive`（走 `model.predict_inst`，复用 PCS 同一 `backbone_out` 缓存），解锁 SAM-style `point` / `interactive_box`；`/setup.supported_prompts` = `[point, interactive_box, text, exemplar]`。
- **正/负点累加迭代精修**：前端点工具改为累加会话（每次重发全量点，后端无状态），首点 `multimask_output=true` 出 3 候选（按 iou 降序、`Tab` 切换、默认 top-1），≥2 点转单 mask 精修；会话在提交 / `Esc` / 切 task·backend 时重置。

### Changed

- **sam3 图像模型 checkpoint → `sam3.pt`（3.0）**：官方 image+inst 路径所用权重；`sam3.1_multiplex.pt`（视频权重）保留供后续视频追踪——multiplex 的 inst 权重命名/结构与 vendored image-inst 代码不兼容，强用会静默加载随机权重产生噪声 mask。模型变体名随之由 `sam3.1` 改为 `sam3`（前后端一致：`/setup` 变体轴 / `model_version` / 缓存 variant）。
- **交互 prompt 命名统一**：`bbox` 退出交互 prompt 命名空间（仅保留为几何形状），单框单 mask 统一走 `interactive_box`；PCS「找全图相似」统一走 `exemplar`。gsam2 `predict_point` / `predict_bbox`（更名 `interactive_box`）透传 `multimask_output`。前端工具门控 / 路由 / 兜底全部对齐新命名。
- **候选归一化补多连通 mask**：后端多环 mask 用 `value.polygons` 承载（单环仍用 `value.points`），前端 `normalizeResult` 取面积最大外环——修复 inst 点 mask 常多连通导致候选被静默丢弃、「同位置时好时坏」。

### Compatibility

- **破坏性**：旧 `type=bbox` 交互请求返回 422（项目未正式上线，不留兼容别名）。模型变体名 `sam3.1`→`sam3`，已注册 sam3 backend 需重读 `/setup`（重新绑定或刷新能力快照）以更新变体值。
- gsam2 的几何 seed（tracker / box-seg）仍用 `bbox`（几何形状，非交互 prompt），不受影响。无 DB migration，无新增环境变量。

## [0.18.16] - 2026-06-25

把 `/ai-pre` 的受限树形编排从**竖排阶段卡**重做成**两列：左 DAG 画布 + 右节点检查器**。竖排卡片随并行 / 嵌套阶段无限拉长页面、结构靠缩进脑补；新画布让拓扑一眼可见、页面高度恒定（右列永远一张卡）。纯前端重做，后端零改动（仍由 `stagesGraph` 派生 `pipeline_stages`，复用 0.18.15 的校验 / 投递烘焙 / 几何回映）。规划详见 [`docs/plans/2026-06-25-v0.18.16-staged-preannotate-dag-canvas-draft.md`](docs/plans/2026-06-25-v0.18.16-staged-preannotate-dag-canvas-draft.md)。

### Added

- **受限树形 DAG 画布**：新增 `PipelineGraphCanvas`（`@xyflow/react` v12，经 `React.lazy` 隔离成独立 chunk、不进主包），把 `stagesGraph` 派生成分层 DAG（`col=depth-1`，源 → 子 → 孙）。节点带角色徽标（检测 / 分割 / 分类）、运行态圆点、迷你计数；产几何的节点才有出向 handle（「叶子不可有子」编码进 UI）。点选节点 → 右列检查器切到其参数。
- **节点编辑手势**：节点上 `+` 加子 / `🗑` 级联删；拖节点连接点到空白 → 新建子阶段；**拖动连线改父**（re-parent）。受限规则（无环 / 深度 ≤ 3 / 父产几何）收敛到纯函数 `canReparent`，`isValidConnection` 实时校验、非法连接回弹 + toast 原因。
- **纯函数图层 `utils/pipelineGraph.ts`**：`buildFlow` / `depthBySid` / `descendantsOf` / `subtreeHeight` / `canAddChild` / `canReparent` / `reparent` / `roleOf` / `detailOf`，与 react-flow 运行时解耦、可单测。
- **节点信息增强（§13）**：节点直显 backend / 「待配置」态 / 父框过滤芯片 / 运行进度条 / 可达性 ⚠ 标红，hover 浮层显全量（模型·任务·投递·变体·写回键）。可达性前移——`StageCard` 上抛 `StageCaps`，`stageWarning` 纯函数按端点 422 同判据标红（仅提示、不硬拦）。拖拽改父时合法落点高亮、非法变淡；方向键在节点间移动选中；>4 节点出 MiniMap；删带后代节点提示连带数。

### Changed

- **检查器持久化**：所有 `StageCard` 与源参数表单常驻挂载、非选中者 CSS 隐藏（`hidden`），切换选中节点不丢各自 `usePreannotateConfig` 状态。
- **运行态落到画布节点**：源节点显检出框数，下游节点显运行态圆点 + 「目标 / 成功」计数；键冲突节点 danger 描边（顶部预警与末位覆盖开关保留）。
- 移除竖排阶段卡的「加第二阶段 / 并行加同级 / 加子阶段」按钮、缩进渲染与只读 `StageGraphSummary` ASCII 摘要条（被画布取代）。

### Compatibility

- 纯前端编排 UI 重做；`pipeline_stages` 组装逻辑、`StageCard` 配置体、`usePreannotateConfig`、运行 / 并发 / 键冲突逻辑全部复用。无协议改动、无 DB migration、无新增环境变量。

## [0.18.15] - 2026-06-25

承接 0.18.14 显式推迟的两块 plumbing，补齐**几何 depth-3**：`person → 在 person crop 上检测 hat → 给 hat 分类 color` 现在真能跑——检测器在父框 crop 上检出的子物体几何按仿射变换**回映回原图坐标**，并作为新框供下游消费。同时把「模型 I/O 输入契约」做成一等协议字段 `supported_inputs`，让投递方式与父子可达性可声明、可校验。前端补齐受限树形构建器（「加子阶段」+ ASCII 摘要条），用户搭出的 depth-3 链路所见即所跑。规划详见 [`docs/plans/2026-06-25-v0.18.15-model-io-contract-and-crop-remap-draft.md`](docs/plans/2026-06-25-v0.18.15-model-io-contract-and-crop-remap-draft.md)。

### Added

- **crop 坐标回映**：`roi.py` 的 `CropBatch` 增 `transforms`（每个 crop 在原图的归一化仿射变换 `{ox,oy,sx,sy}`，旁路不入线格式），新增 `remap_geometry_to_image()`（crop-local 几何反投影回原图坐标，bbox + polygon）与 `compose_transforms()`（链式 crop 变换合成）。crop / geometry-prompt 原语支持 **polygon 父框**（取外接框裁剪 / 归一化）。
- **一等模型 I/O 输入契约 `supported_inputs`**：协议新增 `supported_inputs`（`full_image | crop | bbox_prompt | point_prompt`），与 `supported_prompts`（交互 prompt）解耦。`extract_capabilities` 规范化 + 扁平并集透传；老 backend 缺字段按 `supported_prompts` 合成兼容默认（零退化）。前端类型 + 模型市场卡片「可接受输入」行改读 `supported_inputs`（整图 / 裁剪 / 框提示 / 点提示）。
- **受限树形前端构建器**：`ProjectDetailPanel` 从扁平 `downstreamIds`（恒 `parent_stage=0`）升级为 `stagesGraph` 树（`{sid, parentSid}`）；产几何的阶段卡（框→分割 / 检测）在 `depth<3` 时出「加子阶段」按钮，子卡缩进渲染；新增只读 `StageGraphSummary` ASCII 摘要条。`StageCard` 增「子物体命名」（`label`）输入、下游模型新增 `detection`（crop-detect 几何子）。

### Changed

- **Worker crop-detect 第三态**：crop 分支按 `write.target` 分流——`attributes` 走属性合并（现状）；`geometry/intermediate` 走 crop-detect（下游在 crop 上检出几何 → `remap_geometry_to_image` 回映回原图 → 写 `stage_outputs` 供下游消费、`geometry` 追加进预测）。每个 crop 均裁自原图、transform 即相对原图，无需链式 compose（且避免逐层 JPEG 误差累积）。
- **端点按 `supported_inputs` 解析投递 + 可达性门控**：`POST /preannotate` 按子模型 `supported_inputs` 把投递方式烘焙进阶段 `input.mode`（box-seg→geometry、普通检测器→crop）；产几何的子若 `supported_inputs` 既不含 `bbox_prompt` 也不含 `crop` → 422。修复 0.18.14 端点未透传 `label` / `input` 到 worker 的链路缺口（子物体属性前缀此前在真实端点下不生效）。
- **前端键冲突检测对齐后端**：改按「加完 `label` 前缀的最终键」去重（`hat_color` 与 `shoe_color` 不冲突），消除跨 label 同原始键的误报。

### Compatibility

- `supported_inputs` 协议字段 additive，老 backend 缺省由平台合成，零退化。`roi.py` `transforms` 为新增旁路返回，单阶段 / depth-2 路径不读它即保持原行为。0.18.14 的全部接受 / 拒绝用例不退化；新增门控仅在 backend 有能力快照时生效。API 路由不变，无 DB migration，无新增环境变量。

## [0.18.14] - 2026-06-25

阶段化预标注 `/ai-pre` 从「单源 + 一层扇出」扩展为**受限树形流水线**（最大深度 3）：一个下游阶段可以消费另一个下游阶段的输出。后端 schema / 校验 / worker 执行 / provenance meta 全部到位；前端模型市场卡片同步补齐字段展示。**本版交付结构骨架**——depth-3 的 attribute 链（`detect → classify A → classify B`，属性累加到 root）可跑；真正的几何 depth-3（`person → 检测 hat → color`，需要 crop 内检测 + 坐标回映）所需的 ROI 原语不在本版，见 0.18.15 计划。规划详见 [`docs/plans/2026-06-25-v0.18.14-staged-preannotate-tree-dag-draft.md`](docs/plans/2026-06-25-v0.18.14-staged-preannotate-tree-dag-draft.md)。

### Added

- **受限树形流水线（max depth 3）**：`PipelineStage` 新增 `label`（写回属性键前缀，子物体命名空间如 `hat_color`）、`input.mode`（显式投递模式覆盖）、`write.target_stage`（祖先选择扩展位，本版仅接受 `root`）；`write.target` 增 `intermediate`（只产几何给下游消费、不落库为候选）。校验从「单层扇出」替换为受限树形校验器：`parent_stage` 须指向更早且产几何的阶段、链路深度 ≤ 3、属性键按「加完 label 前缀的最终键」去重。
- **模型市场卡片字段统一**：`ModelCard` 的「原子 / 内置流程」徽标恒显（缺省回落 `atom`）；「输出几何 / 输出属性 / 资源」三行改为恒渲染、空值占位 `—`，不再整行消失；新增「可接受输入」行（读 `supported_prompts`，无 prompt 接口的纯分类器显示「整图」）。

### Changed

- **Worker 拓扑执行**：`_run_task_pipeline` 引入按 `stage` 号索引的 `stage_outputs` map，下游阶段从 `parent_stage` 取上游输出（不再恒为 root）。投递模式判据从下游 `supported_prompts` 反推改为按子 `write.target` 正推（`attributes → crop`、`geometry/intermediate → geometry-prompt`），crop 钉死在「只产属性」；crop pad 缺省按深度取默认（`{1:0.05, 2:0.08, 3:0.12}`）、新增 `min_crop_side_px=32` 守卫（短边过小的嵌套裁剪跳过、计 `skipped_geometry`、父框靠 `keep_parent` 保留）；属性写回支持 `label` 前缀（设了才加、缺省写原始键保双阶段零退化）。
- **provenance meta**：`PredictionMeta.extra.pipeline` 增 `max_depth` 及每阶段 `depth / parent_stage / label / write_target / target_stage`（JSONB additive，旧记录读取兼容）。

### Compatibility

- v0.18.13 的 `pipeline_stages` payload（`parent_stage=0` 的双阶段树）不改字节即通过新校验、跑通新 worker；新字段全部可选并带向后兼容默认。API 路由不变（`POST /projects/{id}/preannotate`），无 DB migration，无新增环境变量。

## [0.18.13] - 2026-06-24

onnxtools 原子层直架单模型推理类 + 删 `visibility` 字段改用 `composition` 单轴过滤 + 单阶段配置修复。修了 v0.18.9 拆原子时把单后端「检测+属性一把梭」从单阶段路径弄丢的回归（用户无感）：onnxtools 三个 model 各架在自己的单模型类上（`vehicle-detect`→独立 `RtdetrORT`、`vehicle-attr-classify`→独立 `VehicleAttributeORT`、`vehicle-attr` 一锅端→`VehicleAttributePipeline`），按 model_id 懒加载——detect-only 部署只加载检测器、classify-only 只加载分类器。同时把 v0.18.11 引入的 `visibility` 字段整体删除（全平台仅 onnxtools 一处用、且与 `composition` 语义重载），过滤统一收敛到 `composition` 一根轴：编排下游 stage 只组合 `atom`，单阶段/工作台不过滤、一锅端 `vehicle-attr` 可作开箱即用默认。

### Added

- **onnxtools `/unload` + idle-unload**：新增 `POST /unload`（ModelMarket 卸载按钮直接生效，UI 零改动）+ 空闲计时器（`ONNXTOOLS_IDLE_UNLOAD_SECONDS` 默认 600s），按 model 句柄粒度释放显存。与 yolo/gsam2 体验对齐。
- **单阶段「当前模型」只读展示**：预标配置面板在单一可选 model 时不再「什么都不显示」，改出只读「当前模型」行（模型市场卡片标题），任何 backend 单阶段都能看到将跑哪个 model。模型市场卡片视图（ModelCard）补「原子 / 内置流程」徽标，与列表视图一致。

### Changed

- **onnxtools 原子层解耦**：`VehicleAttributePredictor` 改为持有 detector / va_classifier / pipeline 三句柄（经注入工厂懒加载），`detect_one`/`classify_one` 走各自独立单模型实例、不再「伸手」借 pipeline 子模型；类名取自 `detector.class_names`（ONNX metadata），不绕 pipeline。
- **删 `visibility` 字段，过滤改 `composition` 轴**：协议 schema（`ModelCapability` / `InstanceModelItem`）、service 透传、前端类型与 5 个过滤点统一去 `visibility`。编排下游 stage 选择器 + 属性导入源改按 `composition`（只收 / 只留 `atom`）；单阶段默认模型/几何模型列表、工作台多模型选择器取消过滤（含 composite，可手动选）。`vehicle-attr` 由 `internal` 改为 `composite`（单阶段可选）。

## [0.18.12] - 2026-06-24

多阶段预标注（路径 B）下游几何原子化 + 配置 UX 彻底 model-first 统一：gsam2 暴露独立的「框→掩膜」纯几何原子（开放/非交互/原子），使「检测（出框）→ 几何分割（吃框出掩膜）」可端到端跑通；协议升 v2.2（纯加法）引入 `composition`（atom/composite）维度与几何 prompt 批量入参。同时把预标配置面板的三条配置路径（doc / 几何 / 文本）统一收敛为「选 model（= 模型市场卡片）」的 model-first 范式——所有 ml 后端统一走 `model_id + task_type + model_variants` 这一套 wire，文本路径（gsam2/sam3）不再是输出形态开关的特例。

### Added

- **gsam2 暴露「框→掩膜」几何原子 model**：新增 `grounded-sam2-box-seg`（`task=segmentation`，`supported_prompts=["bbox"]`，开放/非交互/`composition=atom`），`set_image` 一次、N 个父框共享 embedding 批量出多边形，每个结果回带 `parent_box_idx` 以便与上游框对齐合并。
- **协议 v2.2 `composition` 维度（纯加法）**：model 条目可声明 `composition: "atom" | "composite"`（缺省 `atom`），与 `visibility` 解耦，标识该能力是原子单元还是内置多步流程。平台 schema / service 全链路透传；模型市场目录加「原子 / 内置流程」徽标。
- **几何 prompt 批量入参（路径 B 下游链路）**：下游几何分割阶段接收整图 URL + N 个父框（归一化坐标）的批量入参（`tasks[].prompts[]`），worker 端 `_stage_input_mode` 依据下游 model 的 `supported_prompts` 自动判定 `geometry` / `crop` 投递模式。

### Changed

- **预标配置面板彻底 model-first 统一**：原文本路径（gsam2/sam3）以「输出形态开关」驱动、不带 model_id 的特例已取消。「模型任务」改为单一下拉选择器（`value` 直接绑 `model_id`，文案 = 模型市场卡片标题 `display_name`），doc / 几何 / 文本三路径共用同一套「选 model」交互与 `model_id + task_type + model_variants` wire。
- **gsam2 / sam3 批量按 model_id 路由**：detection model_id → 出框、segmentation model_id → `output||mask`，无 model_id 时回落 `ctx.output`（向后兼容）。onnxtools-backend 在纯分类原子（v0.18.9）之外再拆出独立的纯检测 model，使「检测 → 分类」可全部由 onnxtools 自身的两个原子组成；同时引入协议级 `visibility` 字段，把原「检测+分类一锅端」pipeline 标为内部能力——目录可见但不进任何对外选用入口。

### Added

- **onnxtools-backend 暴露纯检测 model（0.2.0 → 0.3.0）**：`/setup` 在一锅端 `vehicle-attr` 与纯分类 `vehicle-attr-classify` 之外新增 `vehicle-detect`（`[专用]车辆检测`，`task=detection`，复用常驻 pipeline 内的 `detector` 只跑 rtdetr、跳过 va 属性分类，纯出 bbox 不写 `attributes`，故不声明 `output_attribute_schema`）。`/predict` 按 `context.model_id` 增加纯检测路由（`model_version=onnxtools-rtdetr`）。至此 backend 暴露三 model：一锅端检测+属性、纯检测、纯分类。
- **能力可见性 `visibility` 字段（协议 v2.1）**：model 条目可声明 `visibility: "internal" | "public"`（缺省 `public`，老 backend 无字段即按对外开放处理）。`internal` 表示在能力目录可见但不对外开放选用。平台 schema / service 全链路透传（`ModelCapability` / `InstanceModelItem` 增字段，`_normalize_model` / `_shape_models` 透传）。

### Changed

- **一锅端 pipeline 转为内部能力**：`vehicle-attr`（rtdetr 检测 + va 分类一体）display_name 改为「[专用]车辆检测+属性」并标 `visibility=internal`。多阶段编排改用「纯检测（上游）+ 纯分类（下游）」两原子组合，一体管线保留备查。
- **对外选用入口过滤内部能力**：预标配置（默认模型 + 几何模型列表）、工作台多模型选择器、ML Backend 属性导入三处统一过滤 `visibility=internal`；模型市场目录仍展示该 model 并加「内部」徽标。

## [0.18.10] - 2026-06-24

0.18.x 跨 ML Backend 编排开放后的工作台语义收口：工作台 AI 悬浮面板明确为「当前题 AI 执行 + 候选审阅」，项目级 backend 从「默认 ML Backend」改称「项目主后端」，视频工作台保留显式选择工具并退役独立平移工具。方案见 [`docs/plans/2026-06-24-v0.18.10-workbench-ai-default-backend-video-tools.md`](docs/plans/2026-06-24-v0.18.10-workbench-ai-default-backend-video-tools.md)。

### Changed

- **工作台 AI 面板语义收口**：AI 浮层标题、运行按钮、候选筛选和 backend selector 文案改为当前题语义；候选筛选只描述当前题可见候选，不再暗示批量 pipeline 或全局编排。
- **项目主后端命名**：项目 ML 模型页、预标配置 selector、文档和快捷操作统一改为「项目主后端 / 主后端」，保留 `ml_backend_id` 作为初始选择 / fallback，不改变 API 或 DB schema。
- **视频工具栏退役 hand/pan**：视频 ToolDock 展示选择 `V`、矩形框 `B` 与轨迹 `T`；`V` / `Alt+3` 切选择工具，不再切换视频平移工具，`Esc` 不再回落到 hidden hand 状态。
- **视频默认画布交互补齐**：已有标注的选择、移动、resize 继续优先于空白创建；右键拖拽与 `Space`+拖拽可平移视频视图，`Space` 单按仍用于播放 / 暂停。

### Notes

- GSAM2 / grounded-sam2 这类 backend 内部复合 pipeline 的长期拆分或原子化不在本版处理，后续单独开 plan。

## [0.18.9] - 2026-06-24

多阶段预标注（路径 B）下游分类原子化：把 onnxtools-backend 从「只暴露一条完整检测+分类 pipeline」拆出独立的纯分类 model，并让平台多阶段编排的下游阶段自动用它。这样「检测（如 grounded-sam2）→ 裁 ROI → 分类（onnxtools）」是真正的跨 backend 原子编排，下游不再在已裁好的单车 ROI 上重复跑检测器（冗余 + 紧 crop 域偏移漏检）。

### Added

- **onnxtools-backend 暴露纯分类 model（0.1.0 → 0.2.0）**：`/setup` 在原 `vehicle-attr`（完整 rtdetr 检测 + va 分类）之外新增 `vehicle-attr-classify`（`task=classification`，复用同一常驻 pipeline 内的 `VehicleAttributeORT`，跳过 rtdetr，把整张输入 ROI 当一辆车直接出车型/颜色属性）。`/predict` 按 `context.model_id` 路由两条路径，两 model 共用同一份 `output_attribute_schema`。

### Changed

- **下游阶段优先纯分类 model**：`StageCard` 在所选 backend 暴露 `task=classification` 的 model 时，stage payload 自动改用该 model（覆盖 `buildArgs` 默认取的 `models[0]`，常为检测 model），并显式提示「下游模型：…（纯分类，跳过检测）」。无分类 model 时回落原行为。修复了「下游分类阶段会误用检测 model」的实际缺口。

### Notes

- 端到端实测（P-8 苏州图片，grounded-sam2 检测 + onnxtools 纯分类）：阶段 0 检出 32 框 → 阶段 1 目标 27 / 成功 27 / 几何跳过 5，属性 `{vehicle_type, color}` 正确写回各检测框，crop 经 presigned URL 投递（复用 v0.18.4 通用投递）。

## [0.18.8] - 2026-06-23

多阶段预标注（路径 B）编排 UI 美化：把功能优先搭起来的多阶段界面提到与全站 shadcn 设计体系一致的水准。纯前端视觉 / 交互层，不改编排语义、校验、请求体。方案见 [`docs/plans/2026-06-23-v0.18.8-staged-preannotate-ui-polish.md`](docs/plans/2026-06-23-v0.18.8-staged-preannotate-ui-polish.md)。

### Changed

- **StageCard 卡面升级**：裸描边块换成 `Card` 卡面 + 左侧角色轨，卡头为角色图标 + 角色 `Badge`（分类）+「阶段 N」+ 运行态 `Badge`（待运行 / 运行中 / 已完成 / 失败，语义色 + 暗色配对）。
- **运行态可视化升级**：逐阶段统计从纯文本行升为 `ProgressBar`（成功 / 目标比例）+ StatCard 风格计数块（目标 · 成功 · 失败 · 几何跳过），替换 v0.18.6 的自定义文本徽标。
- **流水线视觉隐喻**：源（检测）与下游分类卡之间加「↓ 对每个检测框裁 ROI 喂下游分类」连接线，多个并行兄弟显「并行 ×N」标，直观呈现单层扇出（仍非节点图）。
- **空态引导**：未加下游阶段时给一句「检测 → 分类」流水线示意文案。

### Notes

- 折叠/展开卡、加删卡过渡动效、候选属性审阅区（AIInspectorPanel）打磨为后续可分离的细化项，本期未含。
- 全量走语义 token + 暗色配对，过 `check-tw-tokens`。

## [0.18.6] - 2026-06-23

多阶段预标注（路径 B）运行态实时化：把逐阶段统计从「跑完才在底部出一条扁平文本」改成「跑批过程中实时下放到各阶段卡」。方案见 [`docs/plans/2026-06-23-v0.18.6-staged-preannotate-live-runstate.md`](docs/plans/2026-06-23-v0.18.6-staged-preannotate-live-runstate.md)。

### Changed

- **逐阶段统计实时化 + 下放到卡**：worker 跑批过程中按 5% 步长把逐阶段累加快照随进度推上 WS（复用现有项目预标通道，不新增通道）；前端实时消费，统计从底部脱节的扁平条移到各阶段卡上——源阶段显「检出 N 框」，每张下游卡显运行态徽标（待运行 / 运行中 / 已完成）+「目标·成功·失败·几何跳过」计数，并行兄弟各一条。运行中用实时快照，job 终态 / 重连回落 `result.pipeline_stages`（终态真值，不丢）。

### Notes

- 仍为同步顺序执行，只是把已有累加器中途也推一份；无新并发模型（chord 并行留后续版本）。
- crop 预览（展开看实际投递给下游的 ROI 缩略图）为可选诊断项，本期未实装，留待后续。

## [0.18.5] - 2026-06-23

多阶段预标注（路径 B）配置硬化：把下游阶段卡里最容易让人「配了没反应」的自由文本框升级为选择器，并把键冲突校验从「跑完才 422」前移到配置期。纯前端。方案见 [`docs/plans/2026-06-23-v0.18.5-staged-preannotate-config-hardening.md`](docs/plans/2026-06-23-v0.18.5-staged-preannotate-config-hardening.md)。

### Changed

- **父框类别 / 写回属性键选择器化**：阶段卡的 `parent_class_filter` 与 `write.keys` 从逗号分隔文本框改为 chip 多选——类别取项目类别，属性键优先取下游 backend 自报的 `output_attribute_schema`（回落项目 `attribute_schema`）。非工程师管理员全程点选、不再手敲，杜绝拼写误配静默过滤。

### Added

- **键冲突配置期预警**：多张并行阶段卡写同一属性键时，配置期即红字提示 + 涉事 chip 标红；默认拦截运行（对应后端 `on_key_conflict=reject`），勾选「允许末位覆盖」后放行（`last_wins`），不再跑完才 422。
- **下游 backend 能力门控**：阶段卡选中的下游 backend 若不自报输出属性（纯检测器），给 ⚠ 警示「作下游只会重新检测、属性恒空」。
- **单 backend 兜底**：项目只绑 1 个 backend 时，加分类阶段处提示「需先绑定第二个 ML backend」，不再静默不可用。

## [0.18.4] - 2026-06-23

多阶段预标注（路径 B）后端补强：修一处实质兼容缺口——下游 crop 此前用 `data:` base64 内联投递，只有支持 `data:` 的后端（onnxtools/yolo）能作下游，而走 `httpx.get` 的 gsam2/sam3 收到 data URI 直接失败。本期把 crop 投递改成对所有后端通用，并补健壮性/可观测/测试。方案见 [`docs/plans/2026-06-23-v0.18.4-staged-preannotate-backend-hardening.md`](docs/plans/2026-06-23-v0.18.4-staged-preannotate-backend-hardening.md)。

### Changed

- **crop 投递通用化**：平台裁好的 ROI crop 改为上传对象存储（import 桶，挂 7 天 lifecycle 自动清）→ presigned URL 投递，所有走 `httpx.get` 的下游后端零改造可作分类阶段（此前 data URI 仅部分后端兼容）。crop URL 与 task URL 共用同一 host 解析逻辑（抽成 `StorageService.rewrite_host_for_ml_backend`）。`data:` 内联保留为纯函数快路径（单测/已知支持的后端）。

### Added

- **crop 编码复用**：并行兄弟阶段 target 同一批父框时，按 `(box_idx, pad)` 复用已裁/已上传 crop，不重复裁剪 + 重编码 + 重上传。
- **pipeline 拓扑落库**：`PredictionMeta.extra.pipeline.stages` 记每阶段 `{stage, ml_backend_id, model_id, parent_class_filter, write_keys}`，让「这框的某属性来自哪个 backend/model」可追溯。
- **几何跳过统计**：命中阶段路由但因几何不支持（旋转框/多边形/退化框）无法裁 crop 的父框数，计入逐阶段统计 `skipped_geometry`，不再静默跳过。

### Notes

- 下游分类失败由 `print()` 改 `logger.warning()`，对齐 worker 模块日志约定。
- crop 临时对象依赖 import 桶 lifecycle 清理；高频大批量下堆积量需观测，必要时 job 终态主动删前缀。

## [0.18.3] - 2026-06-23

多阶段预标注（路径 B）收尾：补审阅侧与运行态，把整条「检测→分类→写属性→人审」闭环跑通。方案见 [`docs/plans/2026-06-23-v0.18.3-staged-preannotate-ui-productization.md`](docs/plans/2026-06-23-v0.18.3-staged-preannotate-ui-productization.md)。

### Added

- **候选属性审阅 + 分步采纳**：工作台选中未落库的 AI 候选时，底部「属性审阅」区从只读升为**可编辑**——先看多阶段预标产出的 select/multiselect 属性、改后再采纳；改动经采纳端点的 `attribute_overrides` 原子落库（而非一步全采纳原值再改）。
- **运行态逐阶段统计**：`/ai-pre` 多阶段批跑完后，展示逐阶段统计（阶段 1 检出框数 / 各下游分类阶段「目标·成功·失败」计数），轮询 async_job 结果实时刷新。
- **采纳端点 `attribute_overrides`**：`POST /tasks/{id}/predictions/{pid}/accept` 新增可选 body `attribute_overrides`，按属性键覆盖 shape 自带 attributes 落库（内部键 `_shape_index` 等不受影响）。

### Notes

- 编排界面维持**线性阶段卡**形态，未引入节点图（路径 B 决议：无深度≥3 扇出 / 运行时动态分支 / 循环 / 用户自助任意拓扑，节点图即过度设计）。
- 下列项按「实测未出现驱动」暂不实装、留待真实需求：下游产独立几何 `write=new_shape`、`stage_index`/`parent_prediction_id` 正式表列、并行兄弟 Celery `chord` 并行、「一键采纳整条 pipeline」。

## [0.18.2] - 2026-06-23

多阶段预标注（路径 B）第二块：把 0.18.1 的「单 detect→单 classify 顺序链」升级为**可控编排**——按类别路由、并行扇出、降级策略、逐阶段统计。方案见 [`docs/plans/2026-06-23-v0.18.2-staged-preannotate-roi-routing.md`](docs/plans/2026-06-23-v0.18.2-staged-preannotate-roi-routing.md)。

### Added

- **单层并行扇出**：一个源检测阶段下可挂多个共享 `parent_stage` 的下游分类阶段（如车辆框 → 颜色 + 车型 + 车牌 OCR 各写不同属性键，结果 union 合并进同一框）。`/ai-pre` 支持「并行加同级阶段」，每张阶段卡自持配置实例。
- **按类别路由 `parent_class_filter`**：每个下游阶段声明只对哪些父框 `class_name` 启动——不相交类别集 = 不同类走不同模型，重叠 = 同类喂多模型；命中零阶段的框保持纯检测（降级）。声明式过滤，非条件分支节点。
- **ROI 可配**：`roi.pad`（0–0.5）按请求可调，`roi.mode` 校验（本期仅 `crop`）。
- **阶段级失败策略 `on_failure`**：`keep_parent`（默认，下游失败保留上游框、属性留空 + 软告警）/ `drop_box`（丢弃该父框）。下游失败不再整 task 失败。
- **并行兄弟键冲突检测**：多个阶段声明写同一属性键时，默认 `on_key_conflict=reject`（422）；`last_wins` 时按阶段顺序末位覆盖。
- **逐阶段统计**：多阶段预标的检出框数 / 各下游富集成功失败数写入 async_job 结果（`pipeline_stages`），供后续逐阶段可视化。

### Changed

- 阶段卡 UI 补「父框类别 / ROI pad / 写回属性键」字段；下游阶段从「单一第二阶段」泛化为「可增删的并行兄弟列表」。

多阶段预标注（路径 B）第一块落地：把「检测 → 拿框 → 对每个框跑分类 → 写回属性」的级联从单 backend 内部（0.18.0 路径 A）泛化为**平台层跨 backend 编排**。任意检测器 × 任意分类器自由组合，复用现有任意 backend、零改造。本版聚焦顺序 2 阶段 MVP，方案见 [`docs/plans/2026-06-23-v0.18.1-staged-preannotate-mvp.md`](docs/plans/2026-06-23-v0.18.1-staged-preannotate-mvp.md)。

### Added

- **多阶段预标注编排（顺序 detect→classify）**：`POST /projects/{id}/preannotate` 新增可选 `pipeline_stages`（有序阶段列表）。源阶段产框后，平台按每个检测框的 bbox 裁 ROI crop（`pad` 默认 5%、`data:` base64 内存传递，下游 backend 无感），喂下游分类 backend，把返回的 `attributes` 合并（union）进对应框——维持「一个框 + 一串属性」模型，前端采纳/编辑零改动。缺省（无 `pipeline_stages`）与现有单模型预标逐字等价，完全向后兼容。
- **`/ai-pre` 加第二阶段**：项目详情面板预标配置区可勾选「加第二阶段」，容器持第二份配置表单实例（复用 `PreannotateConfigForm`），选下游 backend/model 即组成 detect→classify 级联。
- **阶段元信息追溯**：多阶段预标的 `stage_count` / `enriched_attr_keys` 暂存 `PredictionMeta.extra`，可追溯「哪个属性来自哪个阶段」（MVP 不改表）。

### Changed

- **`MAX_ML_BACKENDS_PER_PROJECT` 默认 1 → 3**：多阶段编排天然需 ≥2 backend（detect + classify）；仍保留上限挡入口防显存爆炸，生产按显存预算调整。

## [0.18.0] - 2026-06-23

二阶段预标注落地：新增**自维护的第四个 ML backend `onnxtools-backend`**——「检测 → 拿到框 → 对机动车做车型/颜色分类 → 写入框属性」一条流水线打通，并扩展协议让 backend 自报输出属性 schema、前端一键导入。Path B（平台层跨 backend 可视化编排）作为后续 Epic 单列 [`ROADMAP`](ROADMAP/2026-06-23-staged-preannotation-pipeline-roadmap.md)。本版方案见 [`docs/plans/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md`](docs/plans/2026-06-23-v0.18.0-onnxtools-vehicle-attribute-backend.md)。

### Added

- **onnxtools 第四 backend（二阶段车辆属性）**：独立 FastAPI 微服务（端口 8004、compose profile `gpu-onnxtools`），与 gsam2 / sam3 / yolo 同构（HTTP 协议 v2.1）但单一固定 pipeline。基于 onnxtools 的 `VehicleAttributePipeline`：rtdetr 检测 → 对机动车框裁 ROI → va 模型出**车型（13 类）+ 颜色（11 类）**→ 写入框 `attributes`。`class_name` 为 rtdetr 粗检测类，`attributes.vehicle_type` / `attributes.color` 为细分类（value 与 onnxtools 枚举严格对齐）；车牌作独立检测类，本轮不做父子。
- **协议扩展 · backend 自报输出属性 schema**：`/setup` 的 model 目录新增 `output_attribute_schema`（含每个 select 字段的 `options`，value+中文 label）与 `output_attribute_types`，沿 `ml_capabilities`（protocol → capability_instances）透传到前端。
- **「从 ML Backend 导入属性」**：项目设置「类别与属性」区新增按钮，列出所有自报输出属性的在线 backend / model，预览并勾选字段后一键合并进当前工具单位的 `attribute_schema`（同 key 覆盖、新 key 追加），免去手抄选项 + key 对齐。
- **采纳前候选属性预览**：工作台选中尚未落库的 AI 候选时，画布选中卡与右侧标注详情都以只读 `AttributeForm` 预览其 `attributes`（经项目 schema 的 options 解析为中文）；候选列表行补属性摘要 chip。无需先采纳即可核对车型 / 颜色。

### Removed

- **画布「属性模式」浮条**：移除 v0.14.10 引入的属性快速赋值模式（顶部浮条 + `[` / `]` / `1`-`9` / `N` 快捷键 + `attributeMode` 状态）。属性改在选中卡 / 右栏属性表单中按对象编辑。

### Notes

- onnxtools 经 `git+https://github.com/yyq19990828/onnxtools.git@main` 安装（`VehicleAttributePipeline` 已合入 main）；两个 onnx 模型经 volume 挂载注入、不打进镜像。镜像复用本机已缓存的 `pytorch/pytorch:2.7.1-cuda12.8-cudnn9-devel`（cuda12.8 + cudnn9 满足 onnxruntime-gpu 1.22）。
- entrypoint 把 torch 自带的 `nvidia/*/lib` 加进 `LD_LIBRARY_PATH`，否则 onnxruntime CUDAExecutionProvider 找不到 cudnn 静默退回 CPU；实测 GPU ~35ms/图 vs CPU ~940ms。缺 GPU 时自动 fallback CPU，功能不受影响。
- `accept_prediction` 复制候选 attributes 时对项目 select 字段做软校验：值不在 options 内只告警、不阻断（保留原值），避免 backend 枚举与项目配置漂移时丢数据。
