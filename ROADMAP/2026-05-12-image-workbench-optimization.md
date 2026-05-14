# P2 · 图片工作台渲染体系 + 能力扩展

> 状态：**Wave α 已落地 v0.9.41（2026-05-13）**；Wave β/γ/δ/ε proposal。与视频工作台优化（`2026-05-12-video-workbench-rendering-optimization.md`）并行。
>
> v0.9.41 落地清单（详见 [docs/plans/2026-05-13-v0.9.41-image-workbench-wave-alpha.md](../docs/plans/2026-05-13-v0.9.41-image-workbench-wave-alpha.md)）：
> - ✅ **I3** selectedIds 签名稳定 + user 层按工具 listening
> - ✅ **I7** `stage/shared/` 抽取（useViewportTransform / Minimap / geometry/polygon / useRafThrottle）
> - ✅ **I8** `useWorkbenchPerf` + BugReport `[workbench-perf]` 快照
> - ✅ **I16** `useDirtyTracker` 基础设施（注：useWorkbenchAnnotationActions 早已字段级 PATCH，`polygonVertexBatch` kind 判定冗余未加）
> - ✅ **I17** `User.preferences` JSONB + `/auth/me/preferences` + Settings「标注偏好」+ KonvaImage `imageSmoothingEnabled` / 容器 `filter`
>
> 图片工作台是项目最成熟的一块：Konva + 五层结构、Viewport / Minimap / Blurhash 占位、rAF 节流、SAM 集成都已就位。本 epic 范围：
> 1. **§2 I1-I8**：渲染体系本身的薄弱点（大图、polygon LOD、selectedIds、共享 hooks、SAM 缓存、双图比对、批注时间线、观测）。
> 2. **§3 I9-I21**：从二轮 CVAT 调研挖出来的能力扩展（Ellipse / Skeleton / Mask 编辑器 / Object Group / Attribute Schema / Autoborder / z_order / 脏标记 / 渲染 Configuration / Issue 锚点 / GT-IAA / Interactor 协议 / 快捷键自定义）。
>
> 文件名沿用「rendering-optimization」是为了不破坏 ROADMAP.md 的外链；实际覆盖范围已超出"纯渲染"，包括形状能力、工作流、质量控制。

---

## 1. 当前基线

### 1.1 关键文件

- 入口：`apps/web/src/pages/Workbench/stages/image/ImageWorkbench.tsx`
- 渲染：`apps/web/src/pages/Workbench/stage/ImageStage.tsx`（5 层 Konva：bg / ai / user / canvas-drawing / overlay）
- 形状：`apps/web/src/pages/Workbench/stage/ImageStageShapes.tsx`（KonvaBox + KonvaPolygon）
- Viewport：`apps/web/src/pages/Workbench/stage/useViewportTransform.ts`（scale [0.2, 8]、Ctrl+滚轮锚点缩放、空格+拖平移）
- Minimap：`apps/web/src/pages/Workbench/stage/Minimap.tsx`（条件显示：可视率 <85%）
- 蓝图占位：`BlurhashLayer.tsx`
- 多边形几何：`polygonGeom.ts`（含 `isSelfIntersecting` 暴力 O(n²)）
- 工具：BboxTool / PolygonTool / SamTool / HandTool

### 1.2 已知短板（驱动本 epic）

1. **无大图分块**：>4K 图原图整张加载，缩放到 8x 时浏览器需要解码巨幅纹理，部分场景明显卡顿。
2. **多边形 LOD 缺失**：>100 顶点的 polygon 在缩放 / 平移时全顶点参与渲染和命中测试，FPS 下降。
3. **每次顶点拖拽都触发 props 变更**：`onCommitPolygonGeometry` 在拖动中频繁调用，造成上层 re-render 与 history stack 噪声。
4. **selectedIds 每帧重算 Set**（L141-143）：稳定引用缺失，下游 memo 失效。
5. **自相交检测 O(n²)**：复杂多边形（>50 顶点）每次顶点移动都全量扫描。
6. **批注（canvas-drawing 层）无时间感**：评论附带的批注画笔没有"时间线"概念，难以回放 / 对齐多条评论的笔迹时序。
7. **多图比对模式缺失**：审核场景下双图 / 多图并排对比是合理需求，当前无原生支持。

---

## 2. 优化方案

### I1 · 大图分块（Tile）加载（**必做，依赖后端**）

> 对标：地图栅格 tile 服务。CVAT 用 chunk 处理视频帧，图片侧可借鉴同思路处理大尺寸单图。

- **I1.1 后端 tile 服务**：上传 >4K 图时 Celery 生成 IIIF 或自定义 tile 金字塔（zoom 0/1/2/...，每级切 512×512 PNG/WebP）。元数据 `ImageTilePyramid(image_id, max_level, tile_size, format)`。
  - 这块写入 backend epic（与视频 chunk 共用一套切片服务基础设施，可放在 `2026-05-12-video-backend-frame-service.md` 同一服务下，或单独 minor epic）。
- **I1.2 前端 tile 加载器**：抽 `useTileSource(imageUrl, pyramid)` hook，按当前 viewport 计算可视 tile 集合，LRU 缓存解码后的 ImageBitmap。
  - 触发条件：图片尺寸 ≥ 4096 像素任一边时启用，否则继续走原 `use-image`。
- **I1.3 Konva 适配**：背景 bg 层从单一 `<Image>` 换成 `<Group>` 内多张 `<Image>` tile，按 viewport 动态挂载。Konva 原生支持，不需要换框架。
- **I1.4 加载体验**：低级别 tile 先渲染（金字塔顶层），高级别 tile 渐进替换；保留 BlurhashLayer 作为最低基线。

**衡量**：8K × 8K 图，4x 缩放查看局部时内存 <300MB，FPS ≥30。

---

### I2 · 多边形 LOD 与命中测试优化（**必做**）

> 对标 CVAT 的 martinez 几何库 + 离屏 canvas 命中测试。

- **I2.1 顶点 LOD**：渲染层根据当前 viewport scale，多边形顶点按 Douglas-Peucker 简化（保持视觉等价）。原始顶点存原表，渲染前过一次简化缓存。
  - 简化阈值 = 1px / scale，保证看不出差异。
  - 拖动 / hover 顶点时显示原始顶点（编辑模式无 LOD）。
- **I2.2 自相交检测算法升级**：从 O(n²) 改为基于 Bentley-Ottmann 扫描线（n log n），或干脆只做"新加边 vs 已有边"的增量检测（O(n)）。
- **I2.3 命中测试外移**：Konva 内置 hit-test 在密集 polygon 场景（100+ 形状）会有性能问题。可选优化：把当前帧所有形状的 bbox 建 R-tree（`rbush` 库），先用 bbox 粗筛再用精确几何检测。
- **I2.4 顶点拖拽差量提交**：拖动中只更新本地 ref，鼠标松开才走 `onCommitPolygonGeometry`；history stack 也只 push 一条 patch。配套 `useAnnotationHistory` 加 `polygonVertexBatch` kind。

**衡量**：500 顶点多边形拖动 ≥60fps；100 个 polygon 同屏选择无明显延迟。

---

### I3 · selectedIds / memo 稳定引用（**必做，小改**） — ✅ v0.9.41

- **I3.1** `selectedIds` 从 `new Set(...)` 改为带 dedup 的 `useMemo`，仅在内容变更时返回新引用。
- **I3.2** `currentShapes` 的衍生（filteredShapes / visibleShapes）走稳定 selector 模式，避免 Konva 每帧 re-create children。
- **I3.3** Konva `listening` 属性按工具状态切换，HandTool / 仅查看时关闭形状层 listening，节省 hit-test 开销。

**衡量**：Chrome Performance 录拖动场景，React commit 时间下降 ≥30%。

---

### I4 · 批注时间线（**借鉴自视频 R4**）

> 当前评论批注（canvas-drawing 层）只是静态笔迹叠加。把它加上"时间感"，让审核场景里多条评论的笔迹可按时序回放。

- **I4.1 笔迹时间戳**：批注笔画存储增加 `timeline: { stroke_id, started_at, ended_at }`，每条评论的笔迹按时序排队。
- **I4.2 时间线 UI**：评论侧栏底部加迷你时间轴，hover 单条评论时高亮对应笔迹时间段；可"播放"评论笔迹（从空到最终态）。
- **I4.3 与视频 loop region 对齐**：未来视频和图片用同一套 `TimelineRibbon` 组件，差异只在 x 轴单位（图片用 stroke 序号 / 视频用 frame index）。

**衡量**：评论笔迹可回放，多评论场景下可视化对齐。

---

### I5 · 多图比对（双视图）（**追加项**）

> 审核 / diff 场景刚需，与视频 segment 思路一致：把"单一画面"升级为"可多窗格"。

- **I5.1 双面板布局**：工作台支持左右 / 上下分屏，每个面板独立 ImageStage 实例。
- **I5.2 viewport 同步**：可选「锁定缩放 / 平移」按钮，两个面板共享 viewport。
- **I5.3 标注 diff**：左面板原标注，右面板审核标注，颜色 / 边框区分增删改。
- **I5.4 状态隔离**：R6（视频侧）已经把 stage 隔离 frame 状态，图片侧 viewport 状态也跟着 stage 实例化。

**衡量**：审核员能在同屏看到「修改前 / 修改后」的标注，光标 hover 跨面板高亮同一对象。

---

### I6 · SAM 候选缓存与异步预热（**借鉴自视频 R5.2 ImageBitmap**）

- **I6.1 SAM mask cache**：当前每次点击都重发 embed 请求。前端缓存 `(image_id, point_array) → mask_url`，重复点击秒回。
- **I6.2 图像 embedding 预热**：进入图片工作台时立即异步触发后端 `/sam/embed`，用户开始用 SAM 工具时通常已就绪。
- **I6.3 mask 预览离屏 canvas**：mask 叠加用单独离屏 canvas 渲染，不与 Konva 主层耦合，避免大 mask 拖累 hit-test。

**衡量**：连续 SAM 点击平均响应 <100ms。

---

### I7 · 工程一致性（**与视频侧统一**） — ✅ v0.9.41

- **I7.1 提取 `shared/useViewportTransform`**：图片侧已有的实现搬到 `stage/shared/`，视频侧 R8 直接复用。
- **I7.2 提取 `shared/Minimap`**：同上，加可选 props `accent`（用于视频版叠加帧位置）。
- **I7.3 提取 `shared/rAFThrottle`**：图片侧 `dragRef` + rAF flush 模式抽成公用 hook，供视频拖拽 / 时间轴拖动复用。
- **I7.4 几何 helpers 收敛**：`polygonGeom.ts` 移到 `stage/shared/geometry/polygon.ts`，视频 polygon track（R9）直接复用。

---

### I8 · 观测与回归（**贯穿，借鉴视频 R7**） — ✅ v0.9.41（基准 fixture 推迟到 Wave β）

- **I8.1 PerformanceObserver longtask 上报**：与视频侧共用一个 `useWorkbenchPerf()` hook。
- **I8.2 基准 fixture**：3 张图片（2K / 8K / 多边形密集）+ 3 套标注密度（10 / 100 / 500 shapes），与视频 fixture 并列。
- **I8.3 BugReport 附带 viewport 诊断**：截图时附 viewport state + 最近 N 次 hit-test 耗时。

---

## 3. CVAT 追加借鉴（I9-I20，渲染优化之外的能力扩展）

> 二轮 CVAT 调研挖出来的图片相关工程实践，按"形状能力 / 编辑增强 / 数据模型 / 工作流"四类组织。每条都标了体量和后端依赖。

### 形状能力扩展

#### I9 · Ellipse 形状（**S，纯前端**）

> CVAT 把椭圆作为一等 shape，参数化存储 `[cx, cy, rx, ry, rotation]`，与矩形并列。

- 我们当前只有 bbox / polygon / point，缺椭圆。生物医学、显微镜、瞳孔检测等场景刚需。
- 落地点：`stage/tools/EllipseTool.ts`、`stage/ImageStageShapes.tsx` 加 `KonvaEllipse`、`polygonGeom.ts` 旁加 `ellipseGeom.ts`（含旋转矩阵命中测试）。
- 协议：扩展 `bbox` 字段为 `geometry.kind: 'bbox' | 'polygon' | 'ellipse'`，与 R9 视频几何 kind 字段同期收口。
- 来源：`cvat-canvas/src/typescript/canvasView.ts` L3777-3811。

#### I10 · Skeleton（骨架关键点）（**L，后端 schema 改动**）

> CVAT 用 SVG 模板定义骨架结构（节点 + 连线），数据存所有节点坐标 + 可见性。姿态估计 / 人体动作 / 手势识别 / 商品多关键点必备。

- **I10.1 Label 配置器**：项目设置里加"骨架编辑器"，SVG 拖点 + 连线 + 子标签命名，导出标准化 JSON 模板（CVAT 用 svg.parser 反解，我们可直接 JSON）。
- **I10.2 标注工具**：`SkeletonTool`，点击图像时按模板顺序自动落点；可隐藏不可见节点（occluded / outside）。
- **I10.3 渲染**：Konva `<Line>` 连线 + `<Circle>` 节点，节点支持单个移动 / 整体平移 / 镜像翻转。
- **I10.4 数据协议**：新增 `geometry.kind: 'skeleton'`，payload `{ template_id, points: [{node_id, x, y, occluded}], links: [...] }`。后端 schema 扩展。
- 来源：`cvat-ui/src/components/labels-editor/skeleton-configurator.tsx`。

#### I11 · Mask 编辑器（笔刷 / 橡皮 / 多边形辅助）（**L，纯前端**）

> CVAT 对 mask 标注用单独的 `masksHandler.ts`：圆/方笔刷、橡皮、polygon-plus/polygon-minus、Shift+滚轮调笔刷大小，最后 RLE 压缩。

- 我们当前 SAM 出的 mask 是"接受 → polygon"流程，不可二次精修。要实现"AI 出粗结果 → 笔刷细修"必须有 mask 编辑器。
- 落地点：新 `stage/tools/MaskTool.tsx`，离屏 canvas 承载像素状态（与 I6 / R5.2 同套基础设施），编辑完触发 mask→RLE 压缩落地。
- 与 I1 大图 tile 共存：mask 编辑时仅在当前 viewport 范围内做像素操作，全图导出时合并。
- 来源：`cvat-canvas/src/typescript/masksHandler.ts`。

### 编辑增强

#### I12 · Object Group（分组 + 批量编辑）（**M，半后端**）

> CVAT 多个 shape 可共享 `group_id`，批量改类、改颜色、删除、复制粘贴。例如车 + 车牌 + 司机一组。

- 视频侧 R11 / V2 已经有 track 多选概念，本条把它扩展到图片侧的"group 持久化"。
- **I12.1 group_id 字段**：annotation 表加 `group_id: nullable int`，同 group 的对象渲染时同色边框 / 同侧栏分组。
- **I12.2 group 操作**：Ctrl+G 分组、Ctrl+Shift+G 拆组；侧栏支持折叠 / 展开 group。
- **I12.3 父子关系（可选）**：在 group 之上加 `parent_id` 表达"车牌属于车"，导出 COCO 时映射到 `parent` 字段。
- 来源：`cvat-core/src/annotations-collection.ts` L629-668。

#### I13 · Attribute Schema 进阶（mutable / immutable + 自动 Form）（**M，后端配套**）

> CVAT 给每个 label 配 attribute schema（select / radio / checkbox / number / text），区分 `mutable`（每帧可变）与 `immutable`（轨迹级）。前端按 schema 自动生成 form。

- 我们 v0.7.6 已经支持 attribute schema 配置，但缺以下能力：
  - **I13.1 input_type 完整支持**：当前只有简单 select，扩展 radio / checkbox / number / textarea。
  - **I13.2 mutable / immutable 区分**：视频侧的 track 属性必须区分（沿用到 R9 polygon track）；图片侧默认 immutable 即可。
  - **I13.3 自动 Form 渲染**：右栏对象属性面板按 schema 自动生成，无需为每个 label 写 UI。
  - **I13.4 必填校验**：保存 / 提交时校验必填属性，缺失时阻断 + 高亮。
- 来源：`cvat-core/src/server-response-types.ts` L172-180 + `cvat-ui/.../object-item-attribute.tsx`。

#### I14 · 多边形高级编辑（自动贴边 / 智能裁切）（**M，纯前端**）

> CVAT 的 `AutoborderHandler` 允许多边形画线时实时贴近其他形状的边（防双边重复）；`intelligentPolygonCrop` 允许新形状被已有形状裁切。

- 多对象密集标注场景（如细胞 / 道路网），相邻对象边界要严丝合缝，手工对齐效率低。
- **I14.1 Auto-border**：开关式工具，多边形顶点拖动 / 新增时若距其他形状边 < 阈值，自动吸附。
- **I14.2 Polygon crop**：新建多边形若与已有重叠，提供"裁切重叠区"选项（布尔差集，用 martinez）。
- 与 I2 自相交检测同一几何工具集。
- 来源：`cvat-canvas/src/typescript/autoborderHandler.ts`。

#### I15 · Z-Order / 锁定 / 隐藏 / occluded 一等态（**S，已部分实现 + 增强**）

> CVAT 每个 shape 有 `z_order` / `lock` / `hidden` / `outside` / `occluded` 五个独立状态位，可通过快捷键或右键菜单切换。

- 我们目前只有 `lock` / `hidden` 部分支持。
- **I15.1 z_order**：右键 / `[`、`]` 调整层级，影响渲染顺序与 hit-test 优先级。当前是按 array 顺序，需要持久化。
- **I15.2 occluded**：表示"被遮挡但仍存在"，视觉上变虚线 / 半透。视频 track 已有，图片侧也补上。
- 来源：`cvat-canvas/src/typescript/canvasView.ts`。

### 数据模型与协议

#### I16 · State 脏标记 + 增量序列化（**S，纯前端**） — ✅ v0.9.41（`useDirtyTracker` 基础设施；现有 actions 已字段级 PATCH，`polygonVertexBatch` kind 判定冗余）

> CVAT 用 `UpdateFlags`（每个 shape 上的 bit 位）追踪哪些字段变了，提交时只序列化变更字段，不发整段。

- 我们当前 PATCH `/annotations/{id}` 已经是字段级，但前端是按"全对象→后端"再 diff，序列化代价大。
- 落地点：在 `useAnnotations` 之上加一层 `useDirtyTracker`，每次 setShape 标记字段位，offline queue / 实时同步都从 dirty bits 选字段。
- 与 R11 协同段冲突合并对接（行锁 + 字段级 patch 减少冲突面）。
- 来源：`cvat-core/src/object-state.ts` UpdateFlags。

#### I17 · 渲染配置化（Configuration 系统）（**S，纯前端**） — ✅ v0.9.41（项目级覆盖留 Wave γ）

> CVAT 的 `canvasModel.ts` 暴露 `Configuration` 接口：`smoothImage`、`CSSImageFilter`、`adaptiveZoom`、`snapToPoint`、`controlPointsSize`、`autoborderHandler` 等十几个开关。

- 我们当前渲染参数散在各组件，需要的时候改源码。统一为 `useWorkbenchConfig()`，用户可调。
- **I17.1 用户级 config**：SettingsPage 加"标注偏好"区，存到 User 表 `preferences` JSONB。
- **I17.2 渲染配置项**：smoothImage（图像插值）、CSSImageFilter（亮度 / 对比度 / 反色，便于暗图标注）、controlPointsSize（顶点大小）、snapToGrid（网格吸附）。
- **I17.3 项目级覆盖**：项目设置可锁定某些配置（如医学影像强制"无插值 + 灰度反色"）。
- 来源：`cvat-canvas/src/typescript/canvasModel.ts` Configuration。

### 工作流增强

#### I18 · Issue 锚定到形状 / 像素位置（**M，后端配套**）

> CVAT 的 issue 是带空间坐标的 comment（`x, y, frame, job_id`），可锚定到任意位置，不只评论整张图。

- 我们当前评论是"挂在 task 上"或"挂在 annotation 上"，没有像素级锚点。
- **I18.1 Issue Pin**：审核工具栏加"Pin"按钮，点击图像任意位置生成图钉，输入评论；标注员看到图钉位置。
- **I18.2 Issue 状态**：open / resolved / wont-fix；resolved 后图钉变灰。
- **I18.3 与现有评论合流**：可选项 —— 把 BugReportDrawer / TaskComment / Issue 收敛到统一的 `AnnotationFeedback` 表。
- 来源：`cvat-core/src/issue.ts`。

#### I19 · GT job / Consensus / IAA（质量控制）（**L，后端工程**）

> CVAT 支持把项目部分数据划为 Ground Truth job，定期抽样让多人标，自动算 IAA（Inter-Annotator Agreement），生成质量报告。

- 我们当前 review 流是逐 task 人工，无 IAA、无自动质检。
- **I19.1 GT 抽样**：项目设置开关「质检」，从已完成 task 随机抽 N%（或 honeypot 模式 — 嵌入预定答案的诱饵 task）。
- **I19.2 双盲分配**：同一 GT task 分给 ≥2 个标注员，互不可见。
- **I19.3 IAA 自动计算**：bbox 走 mAP / IoU、polygon 走 mask IoU、class 走 Cohen's κ；按标注员维度滚动统计。
- **I19.4 质检 Dashboard**：每个标注员的准确率 / 召回率 / 时长，按周聚合。
- 与长期规划 L15「标注质量 AI 审计」配套，可作为 L15 的前置。
- 来源：`cvat-ui/src/components/quality-control/` + `cvat-ui/src/components/consensus-management-page/`。

#### I20 · Interactor 协议（通用 AI 工具）（**M，后端协议升级**）

> CVAT 的 Lambda Manager 把"Interactor（SAM 类）"、"Tracker（跟踪类）"、"Auto Annotation（批量预标）"抽成统一协议。后端写一个 Lambda，前端自动支持。

- 我们的 SAM 是硬编码在 `S` 工具里，新加一个交互式模型（比如 SEEM / SAM3 / 客户自训模型）要改前端。
- **I20.1 Interactor 协议**：标准化 `POST /interactors/{name}/invoke { image_id, points: [{x,y,polarity}], previous_mask? } → { mask: RLE }`。前端工具栏按可用 interactor 动态生成按钮。
- **I20.2 注册式工具**：每个 backend `/health` 返回 `capabilities: ['interactor', 'tracker', 'auto-annotation']`，前端工具栏据此渲染。
- **I20.3 协议向后兼容**：现有 SAM 集成走 Interactor 协议 v1，新模型按需升级。
- 与 v0.10.x SAM 3 接入同期推进，避免二次破窗。
- 来源：`cvat-core/src/lambda-manager.ts`。

#### I21 · 用户级快捷键自定义（**M，纯前端**）

> CVAT 用 mousetrap + 持久化的 keymap，用户可在 SettingsPage 改任意快捷键，可视化弹窗展示当前映射。

- 我们 hotkeys.ts 是硬编码，国际化键盘（如德语 ZY 互换）会撞键。
- **I21.1 keymap store**：User.preferences.keymap，写时校验冲突。
- **I21.2 SettingsPage UI**：列出所有快捷键 + "按下要绑定的键"录制框。
- **I21.3 工作台浮层**：`?` 弹出快捷键参考卡，按当前 keymap 渲染（取代硬编码 KeyboardHintOverlay）。

---

## 4. 双向借鉴清单

### 视频 → 图片

| 借鉴点 | 视频侧来源 | 图片侧落点 |
| --- | --- | --- |
| 二分查找 + LRU 缓存几何结果 | R3 | I2.1 LOD 缓存 / I2.4 拖动 batch |
| 时间线可视化 + 多分类着色 | R4 | I4 批注时间线 |
| longtask 上报 + 基准 fixture | R7 | I8 |
| stage 实例化状态（多视图） | R6.2 | I5 双视图 |
| ImageBitmap LRU 缓存 | R5.2 | I6 SAM mask cache |
| outside 段一等概念 | R3.4 | 图片不需要，但 polygon "未确定边" 标记可借这套思路 |

### 图片 → 视频

| 借鉴点 | 图片侧来源 | 视频侧落点 |
| --- | --- | --- |
| rAF + dragRef 节流 | ImageStage.tsx L229-247 | R2 拖拽优化、R4 时间轴拖动 |
| useViewportTransform | useViewportTransform.ts | R8 视频 viewport |
| Minimap 条件显示 | Minimap.tsx | R8.3 |
| 多边形自相交检测 + 红色高亮 | polygonGeom.ts | R9 polygon track |
| Konva 图层分离（ai / user 独立 listening） | ImageStage.tsx | R2 渲染分层时参考 |
| 标准化坐标系 [0,1] | ImageStageShapes.tsx | 已在视频侧实践 |
| BlurhashLayer 占位 | BlurhashLayer.tsx | R5.1 keyframe poster 加载时复用占位逻辑 |

### CVAT → 图片（汇总，含本次 I9-I21）

| 借鉴点 | CVAT 来源 | 图片侧落点 | 体量 | 后端 |
| --- | --- | --- | --- | --- |
| 离屏 Canvas 命中测试 | canvasView.ts L649 | I2.3 R-tree 之上再加一层 | M | 否 |
| martinez 多边形求交 | cvat-canvas 依赖 | I2.2 自相交算法升级 | S | 否 |
| WebP / ImageBitmap 零拷贝 | cvat-data L39 | I1.4 tile 解码 | S | 否 |
| outside 段统一渲染 | annotations-objects.ts | I4 批注时间线的"未生效"段 | S | 否 |
| Ellipse 形状 | canvasView.ts L3777 | **I9** | S | 否 |
| Skeleton 骨架 | skeleton-configurator.tsx | **I10** | L | 是 |
| Mask 编辑器（笔刷 / 橡皮 / polygon-plus/minus） | masksHandler.ts | **I11** | L | 否 |
| Object Group + 父子 | annotations-collection.ts L629 | **I12** | M | 是 |
| Attribute mutable/immutable + 自动 Form | object-item-attribute.tsx | **I13** | M | 是 |
| Autoborder / 智能裁切 | autoborderHandler.ts | **I14** | M | 否 |
| z_order / occluded 一等态 | canvasView.ts | **I15** | S | 否 |
| State 脏标记 + 增量序列化 | object-state.ts UpdateFlags | **I16** | S | 否 |
| Configuration 渲染配置 | canvasModel.ts | **I17** | S | 否 |
| Issue 锚定到像素位置 | issue.ts | **I18** | M | 是 |
| GT job / Consensus / IAA | quality-control / consensus | **I19** | L | 是 |
| Interactor 通用协议 | lambda-manager.ts | **I20** | M | 是 |
| 用户级快捷键自定义 | shortcuts-dialog | **I21** | M | 否 |

---

## 5. 优先级与建议顺序

```
Wave α · 基础稳态（必做） — ✅ 已落地 v0.9.41
  ✅ I3 selectedIds 稳定引用 (1-2 天)
  ✅ I7 共享 hooks 抽取 (3-5 天，与视频 R2/R8 同期收益)
  ✅ I8 观测接入 (随时)
  ✅ I16 State 脏标记 (3-5 天)
  ✅ I17 渲染 Configuration 收口 (3-5 天)

Wave β · 性能（必做）
  I2 polygon LOD + 命中测试 (1-2 周)
  I6 SAM 缓存与预热 (3-5 天)
    └→ I1 大图 tile (2-3 周，依赖后端切片服务)

Wave γ · 形状能力（按客户场景触发）
  I9 Ellipse (3-5 天，纯前端)
  I15 z_order / occluded 状态一等化 (1 周)
  I13 Attribute Schema 进阶 (1-2 周)
  I14 Autoborder / Crop (1-2 周)
  I11 Mask 编辑器 (2-3 周，与 v0.10.x SAM 3 同窗口)
  I10 Skeleton (3-4 周，依赖后端 schema)

Wave δ · 协作与质量（按规模触发）
  I12 Object Group (1-2 周，后端配套)
  I18 Issue 锚定 (1-2 周，后端配套)
  I20 Interactor 协议 (1-2 周，与 v0.10.x 同期)
  I21 快捷键自定义 (1 周)
  I19 GT / IAA 质量控制 (4-6 周，独立后端 epic，与长期 L15 配套)

Wave ε · 能力扩张
  I5 双图比对 (1-2 周)
  I4 批注时间线 (1 周)
```

---

## 6. 与其他文档的关联建议

部分 CVAT 借鉴点跨越本 epic 范围，建议在对应文档中也写一笔：

- **I10 Skeleton / I11 Mask 编辑器** → 应在后端 schema epic 中加协议扩展条目（与 R9 视频 geometry kind 一并设计）。
- **I19 GT / Consensus / IAA** → 与长期 L15「标注质量 AI 审计」合并为独立 epic，体量过大不适合塞本文。
- **I20 Interactor 协议** → 与 [v0.10.x SAM 3 接入](0.10.x.md) 同窗口推进，避免协议二次破窗。
- **I13 Attribute Schema** → 检查 v0.7.6 已有 attribute 实现，本条是「在已有 schema 上加 input_type / mutable / 必填 / 自动 form」。

---

## 7. 不做 / 暂缓

- **不换 Konva 为 fabric / pixi**：现有架构经 I1-I3 优化后足够，更换框架成本远高于收益。Mask 编辑器（I11）用独立离屏 canvas 即可，不与 Konva 主层耦合。
- **不做端侧 SAM 推理**：embedding 算力放后端 GPU 队列。
- **不做 IIIF 完整规范**：tile 服务用轻量自定义协议，IIIF 留作可选导出。
- **不做协同实时编辑**：图片任务单图单人，不引入 OT/CRDT。I12 group 是数据模型扩展，不是协同。
- **不内置自动 retrain**：长期 L2 主动学习方向，不纳入本 epic。

---

## 8. 关联文档

- [`2026-05-12-video-workbench-rendering-optimization.md`](2026-05-12-video-workbench-rendering-optimization.md) — 视频侧渲染优化，I7 共享 hooks 双向消费；I9 / I15 与 R9 几何 kind 同期设计
- [`2026-05-12-video-backend-frame-service.md`](2026-05-12-video-backend-frame-service.md) — 大图 tile 后端切片服务建议合并到此 epic 下，或独立 minor epic
- [`2026-05-12-long-term-strategy.md`](2026-05-12-long-term-strategy.md) — L15 标注质量 AI 审计 = I19 的下一步演进
- [`0.10.x.md`](0.10.x.md) — SAM 3 接入；I11 mask 编辑器 + I20 Interactor 协议同窗口
- 关键 CVAT 参考路径：
  - `cvat/cvat-canvas/src/typescript/canvasView.ts` — 离屏 canvas 命中、Ellipse、z_order
  - `cvat/cvat-canvas/src/typescript/masksHandler.ts` — Mask 笔刷 / 橡皮 / polygon-plus/minus
  - `cvat/cvat-canvas/src/typescript/autoborderHandler.ts` — Autoborder
  - `cvat/cvat-core/src/annotations-objects.ts` — 多边形重采样、UpdateFlags 脏标记
  - `cvat/cvat-core/src/annotations-collection.ts` — Object Group / 父子关系
  - `cvat/cvat-core/src/lambda-manager.ts` — Interactor / Tracker / Auto-annotation 统一协议
  - `cvat/cvat-core/src/issue.ts` — Issue 锚点模型
  - `cvat/cvat-ui/src/components/labels-editor/skeleton-configurator.tsx` — Skeleton 模板编辑器
  - `cvat/cvat-ui/src/components/quality-control/` + `consensus-management-page/` — GT / IAA
- 现有协议：`docs-site/dev/reference/ml-backend-protocol.md`（I20 改造对象）
