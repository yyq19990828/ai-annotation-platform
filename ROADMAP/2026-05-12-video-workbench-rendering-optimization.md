# P0/P1 · 视频标注工作台 Epic（综合）

> 状态：**主线 M0-M5.0 / V2 / V3 已归档**（原 `2026-05-11-video-workbench.md`），后续 V4-V6 功能尾巴 + R1-R23 渲染/能力扩展进行中。
>
> 文件原名 `video-workbench-rendering-optimization`，保留以维持外链；实际范围包括：功能基线、剩余功能项 V4-V6、渲染体系优化 R1-R12、CVAT 视频专项借鉴 R13-R23。
>
> 触发动机：M5.0 后人工标注闭环已可用，但渲染体系是"最小可用"，没有为长视频 / 高分辨率 / 密集轨迹 / 流畅播放做工程化；AI tracker / segment 协同 / 章节系统都未覆盖。本文件给出从功能尾巴到长期演进的完整地图。

---

## 1. 当前基线（功能 + 渲染）

### 1.1 功能基线（M0-M5.0 / V2 / V3 已完成）

- `video-track` 人工标注闭环已可用。
- 视频任务通过 `WorkbenchStageHost` 分派到 `VideoWorkbench`，再由 `VideoWorkbench` 包装 `VideoStage`。
- `VideoStage` 已拆出 `VideoFrameOverlay`、`VideoSelectionActions`、`VideoTrackPanel`、`VideoQcWarnings` 与共享 geometry helpers，播放 / 拖拽状态仍由 `VideoStage` 编排。
- `video_bbox` 与 `video_track` 均为一等 geometry：
  - `video_bbox`：当前帧独立矩形框。
  - `video_track`：一条轨迹 annotation + compact keyframes。
- 视频工具独立于图片工具：
  - `B`：视频矩形框。
  - `T`：视频轨迹。
- 新建视频 bbox / track 已接入画完选类浮层。
- 选中视频对象后 `1-9` 改当前对象类别；无选中时切 active class。
- **V2** 已完成：轨迹侧栏支持 Shift / Cmd / Ctrl 多选，已覆盖批量改类、删除、显隐和锁定。
- **V3** 已完成：关键帧面板支持显式「复制当前关键帧」和「粘贴到当前帧」，暂不抢占全局 Ctrl+C / Ctrl+V。
- Track → `video_bbox` 转换已支持 `copy|split`、`frame|track`、`keyframes|all_frames`。
- 关键帧级撤销 / 重做、离线队列兜底、通用 conflict modal 已覆盖视频创建和更新主路径。
- `format=coco` 对 `video-track` 项目返回 Video Tracks JSON；YOLO / VOC 对视频项目返回 400。

### 1.2 渲染管线（apps/web/src/pages/Workbench/stage/）

- **视频帧渲染**：原生 HTML5 `<video>` 标签，单一 `manifest.video_url`，浏览器自带解码器，无前端介入。
- **标注图形层**：纯 SVG overlay（`VideoFrameOverlay.tsx`），标准化坐标系（viewBox 0–1），无 canvas/WebGL，无离屏。
- **时间对齐**：video 元素 `timeupdate` 与 `requestAnimationFrame` tick 双驱动 `frameIndex` state，SVG 通过 React 状态自然 re-render。
- **seek 模型**：`video.currentTime = frameIndex / fps`，依赖浏览器 `seeked` 事件回到目标帧。
- **轨迹插值**：`resolveTrackAtFrame()` 每次 O(n) 遍历当前 track 的 keyframes 做线性插值，无索引、无缓存。
- **状态层**：Zustand `useWorkbenchState()` + `useAnnotationHistory()` 提供关键帧级 undo/redo。

### 1.3 已知短板（不需要再讨论是否存在的部分）

- 帧定位精度依赖浏览器 `currentTime = idx / fps` 的浮点除法，长视频与变 fps 容易掉帧 / 跳帧。
- 切换帧时整个 SVG entries 重算并整树 re-render，无脏区、无分层缓存。
- 没有任何形式的帧预解码 / 缓存 / Worker，跨大段 seek 时白屏感明显。
- 没有 viewport / pan / zoom，高分辨率视频无法看清细节（与现有「暂不做 viewport」是产品决策，但渲染体系本身要为之留接口）。
- 密集轨迹场景下（>50 tracks @ 单帧）SVG 节点数膨胀，命中测试和 React diff 都会成为瓶颈。
- 时间轴 UI 不展示 keyframe 分布 / outside 段，操作盲目。

---

## 2. 行业对标：CVAT 做法摘要

> 来源：`/cvat` 仓库源码调研，重点关注「为什么这么做」。

| 维度 | CVAT 做法 | 给我们的启示 |
| --- | --- | --- |
| 帧获取 | 按 **chunk** 分段拉取，而不是依赖 video 元素本身 | 帧定位精确到帧 ID，不再受 `currentTime` 浮点误差影响 |
| 解码 | Broadway.js H.264 WASM + Web Worker（视频），JSZip + `createImageBitmap` Worker（图像包） | 解码不阻塞主线程；ImageBitmap 零拷贝上屏 |
| 缓存 | chunk 级 **LRU**，`decodedBlocksCacheSize` 上限，`PrefetchAnalyzer` 按访问模式智能预取 | 内存可控；播放流畅但不浪费 |
| 请求去重 | `latestFrameDecodeRequest` 单调 ID，过期请求直接丢弃 | 快速 scrub / 拖时间轴时不会被旧帧覆盖 |
| 渲染分层 | 背景 Canvas（帧位图）+ 主体 SVG（形状）+ 离屏 Canvas（命中测试） + Mask Canvas | 各层职责清晰，命中测试不走 SVG |
| Track 模型 | `shapes: Record<frame, Shape>` 仅存关键帧 + `outside[]` + `occluded[]` + `interpolationMode` | 与我们已有 `video_track` 结构高度对齐，差距在「outside 段」「插值方式可切换」 |
| 时间轴 | 展示 keyframe 标记、outside 段、ranges（已下载片段）、当前帧、播放范围 | 我们的 playbar 只是 seekbar，可视化严重欠缺 |
| 状态 | Redux + Thunk async action `changeFrameAsync` 统一帧切换 + 标注加载 + 延迟补偿 | 我们 Zustand 也能做，但需要把「seek + 解码 + 渲染就绪」做成一个原子 action |
| 解码内存 | Broadway.js 编译时 `TOTAL_MEMORY` / `ALLOW_MEMORY_GROWTH` 显式调优，支持 4K | 提示我们若走 wasm 路线必须在编译参数和内存监控上提前规划 |

**对标小结**：CVAT 的核心工程价值不在「画得多炫」，而在「把帧当一等资源管理」——分块、预取、LRU、Worker、去重，五件套缺一不可。我们当前完全依赖浏览器 video 元素隐式处理这一切，到一定规模一定崩。

---

## 3. 优化目标与原则

- **目标 1（流畅度）**：1080p / 30fps / 5 分钟视频，在中等机器上播放时主线程长任务 <50ms，跨段 seek <200ms 可见首帧。
- **目标 2（密度）**：单帧 200 个 track / bbox 可视范围内编辑无明显卡顿（拖拽 ≥30fps）。
- **目标 3（精确度）**：帧定位与导出帧号一致，无浮点漂移；变 fps 视频也能按帧索引精确 seek。
- **目标 4（可观测）**：时间轴可视化 keyframe / outside / 已下载范围 / 当前帧 / 播放范围。
- **原则**：
  - 不为「暂不做」清单里的功能（viewport、polygon track、SAM 3、多人协同）写新代码，但**渲染分层必须为之留接口**，不要把 SVG / video 写死耦合。
  - 渐进改造，每个阶段独立可上线，不做大爆炸重写。
  - 优先在不引入 wasm / 不更换 video 容器格式的前提下榨取性能；wasm / chunk 解码作为可选高阶阶段。

---

## 4. 功能尾巴（V4-V6，合并自原 2026-05-11-video-workbench.md）

> M5.0 后剩余三件功能项，与下述 R1-R23 正交。开发顺序见 §10 波次。

### V4 · Review 模式视频差异化

- **短期**：track 列表区分 `manual / interpolated / prediction` 来源，并支持 raw / final 视图（与 R4.1 时间轴 source 着色共用一份数据）。
- **中期**：审核评论锚定到 `(track_id, frame_index)`，与 R4.4 loop region、I18 像素级 Issue 形成统一的标注反馈面。
- **依赖**：R4 时间轴可视化已落地后做体验最佳。

### V5 · Probe / Poster 失败重试

- 后端把 probe / poster 抽成可重试 Celery task，与 B3「帧抽取与缓存」共用一套 ffmpeg 调用层。
- 管理侧展示失败视频并提供手动重试入口。
- **依赖**：B3 落地后顺手做。

### V6 · `video_bbox` → `video_track` 反向聚合

- 依赖 track 多选或 frame 列表选择。
- 选中多条同类、不同帧的 `video_bbox` 后合并成一条 `video_track`。
- 与 R15「Track merge」（CVAT 借鉴）属于同一类操作的两种入口：V6 是「散框聚合」，R15 是「整段合并」，二者算法可共享。

---

## 5. 分阶段优化方案

### R1 · 帧索引与 seek 精度（**必做，基础**）

- **状态（v0.9.21）**：R1.1 / R1.2 / R1.3 已落地第一版。前端新增 `useFrameClock.ts` 与 `frameTimebase.ts`，后端通过 `GET /api/v1/tasks/{task_id}/video/frame-timetable` 暴露 `pts_ms` 时间表；旧视频无时间表时按 fps 降级。
- **R1.1 引入 `FrameClock`**：在 `VideoStage` 之上抽一个 `useFrameClock(video, fps, totalFrames)` hook，集中处理：
  - `seekTo(frameIndex)`：使用 `video.requestVideoFrameCallback`（Chrome / Safari 已支持）回调确认到位，回退到 `seeked` + 容差比较。
  - `tick()`：以 `requestVideoFrameCallback` 取代 `requestAnimationFrame`，得到带 `mediaTime` 的精确帧号；浏览器不支持时回退当前实现。
  - 暴露 `currentFrame`、`isSeeking`、`onFrameReady(callback)` 三个原语。
- **R1.2 变 fps / 关键帧时间表**：后端 probe 时同时输出 `frame_timestamps: number[]`（可选，长视频走稀疏 + 插值），前端用二分查找把 frame ↔ time 映射做实表，替换 `frame / fps` 浮点除法。
- **R1.3 单元测试**：边界帧（0、last）、负向 scrub、快速连续 seek、暂停态点击 playbar。

**交付物**：`useFrameClock.ts`、`frameTimebase.ts`、变 fps mock 用例。

---

### R2 · 渲染分层与脏区（**必做，中等改动**）

- **状态（v0.9.22）**：R2.1 / R2.2 / R2.3 / R2.4 已落地第一版，并按 CVAT canvas 边界扩展为 Media / Bitmap / Grid / Objects / Text / Interaction / Attachment 七层。当前仍保留 React + SVG + HTML video，不引入 `fabric` / `svg.js`；Bitmap/Grid/Attachment 为 R5/R8/R17 预留入口。

把当前「video + 单层 SVG」拆成 CVAT-aligned surface，为后续 viewport / mask / 大密度做准备：

1. **Media 层**：`<video>` 或未来 `<canvas>`（chunk 解码模式），由 R1 的 `FrameClock` 驱动。
2. **Objects / Text 层**：SVG / HTML overlay，按 track id 做 React `memo` 切分，单 track 几何不变则跳过 diff，label 独立于交互命中。
3. **Interaction 层**：单独 SVG，承载选中态、resize handle、ghost、辅助线与统一 picker；与 Objects 层解耦，频繁更新只动这一层。
4. **Bitmap / Grid / Attachment 预留层**：为 R5.2 ImageBitmap、R8 viewport/grid、R17 hover thumbnail 与 review issue anchor 预留挂载点。

具体改造：

- **R2.1 拆 `VideoFrameOverlay`**：已拆为 `VideoStageSurface` + Media / Bitmap / Grid / Objects / Text / Interaction / Attachment 层；Objects 依赖 `entries`，Interaction 依赖 `selectionId` + `dragState`。
- **R2.2 Track 渲染 memo**：已新增 `VideoTrackShape`，bbox 主体使用稳定 props 和 `React.memo`；拖拽中 committed geometry 留在 Objects 层，预览只动 Interaction 层。
- **R2.3 命中测试外移**：已新增 `videoStagePicking.ts` 和 `videoStageCoordinates.ts`，把当前依赖 SVG 节点事件的 hit-test 改为基于几何的 picker，Interaction 层只挂一个主 `pointerdown`。
- **R2.4 viewport 接口预留**：已在 `VideoStageSurface` 和各 layer 保持统一 coordinate space；Bitmap/Grid/Attachment 层为后续 viewport / cache / hover 扩展预留。

**衡量**：用 Chrome Performance 录 200 tracks 拖拽场景，长任务个数 / 帧时间下降。

---

### R3 · 轨迹插值索引化（**必做，小改动**）

- **状态（v0.9.23）**：R3.1 / R3.2 / R3.3 / R3.4 已完成第一版。`video_track` 支持可选 `outside: [{ from, to, source }]` 闭区间，并向后兼容旧 `keyframes[].absent`；前端渲染、时间轴 marker、后端导出和 track → `video_bbox` 转换都走 effective outside 判断。
- **R3.1 keyframe 索引**：`video_track` 加载时构建 `sortedFrames: number[]` 缓存（已 sort 过的 `frame_index` 数组），`resolveTrackAtFrame` 改为二分查找前后 keyframe（O(log n) 替代 O(n)）。
- **R3.2 当前帧分桶**：对所有 track 维护 `frameBuckets: Map<frame, trackId[]>`（仅在 keyframe 上有桶），用于快速回答"帧 F 处需要插值的 track 集合"。注意：插值期间任意帧都可能出现轨迹，所以分桶只用于 keyframe 命中提示与时间轴标记。
- **R3.3 插值结果 LRU**：`LRU<trackId+frame, bbox>`，上限 1000 条，防止暂停状态下来回 scrub 重复算。
- **R3.4 outside 段一等公民**：已新增 `outside: [{from, to, source}]` 段表达（向后兼容旧 keyframe），渲染、时间轴、导出和 track 转独立框四处统一逻辑；新的「标记消失」写 outside 单帧区间，写入可见关键帧时清理该帧 outside 覆盖。

**衡量**：500 tracks × 平均 8 keyframes 场景下，单帧 resolve 时间从 ~ms 级降到亚 ms。

---

### R4 · 时间轴可视化升级（**必做，UI 改动**）

升级现有 `VideoPlaybackOverlay` 的 seekbar：

- **状态（v0.9.26）**：R4.1 / R4.2 / R4.3 / R4.4 已完成第一版。选中 `video_track` 时，`VideoPlaybackOverlay` 显示单轨 keyframe 圆点、outside 灰段、interpolated 虚线段和 prediction 标记；未选中 track 时显示全局 keyframe 密度条；`Shift+←/→` 在选中 track 时跳上/下可见 keyframe，未选中时保留 ±10 帧跳转；`Shift+drag` 时间轴可设置本地 loop region，播放越过范围末帧后回到起始帧。

- **R4.1 多轨时间轴**：已完成第一版。显示当前选中 track 一条轨道，叠加（a）keyframe 圆点、（b）outside 段灰色区间、（c）interpolated 段虚线、（d）prediction 段不同色 hatch。
- **R4.2 全局密度条**：已完成第一版。未选中时显示全部 track 的密度热度图（每 N 帧分桶计数），帮助跳到"有标注的区段"。
- **R4.3 keyframe 跳转快捷键**：已完成第一版。`Shift+←/→` 在选中 track 时跳上/下可见 keyframe（跳过 outside / absent），未选中时保持原有 ±10 帧跳转。
- **R4.4 播放范围（loop region）**：已完成第一版。拖选时间轴一段并以本地 sessionStorage 按 task 记忆，播放时循环该范围；为后续 review 评论锚点 `(track_id, frame_range)` 铺路。

**衡量**：用户测试，"找到第 N 个手工 keyframe"操作步数下降。

---

### R5 · 帧预取与缓存（**重头戏，引入 chunk 模式**）

这一阶段开始动「不再单纯依赖浏览器 video」的部分，做不做、做到哪一步取决于实际性能数据。建议先做 R5.1（poster 预取），观察再决定 R5.2 / R5.3。

- **R5.1 关键帧 poster 预取（轻量）**：后端给每个 track keyframe 出一张 thumbnail（probe 阶段同步生成，复用 V5 任务），前端在时间轴 hover / track 列表 hover 时直接展示，避免 seek 整段视频。**最小工程量、最大体感收益**。
- **R5.2 帧位图缓存层（中量）**：在 `<video>` 之外加一个 `FrameCache`（LRU，~64 张 ImageBitmap），seek 后用 `createImageBitmap(video)` 抓帧入缓存；scrub 时优先从缓存渲染到背景 canvas，video 异步追赶。需要把 Media 层从「单一 video」改为「video + bitmap canvas」双源。
- **R5.3 chunk 拉取 + Worker 解码（重量，按需）**：参考 CVAT，把后端视频切片为 N 秒 chunk，前端 Web Worker 解码（先用 `WebCodecs VideoDecoder`，比 ffmpeg.wasm / Broadway.js 现代且无 wasm 体积成本）。同时引入 `latestFrameDecodeRequest` 风格的请求去重。
  - 前置条件：浏览器矩阵确认（Chrome 94+/Safari 16.4+ 支持 WebCodecs）。
  - 落地范围：先只对「review 模式」和「长视频（>5 分钟）」启用，标注模式继续走原生 video。

**衡量**：seek 命中 ImageBitmap 缓存的首帧 <50ms；播放期主线程长任务消失。

---

### R6 · 状态与异步原子化（**配合 R1/R5，小改动**）

- **R6.1 `seekFrameAsync` thunk-like action**：在 Zustand 之上包一层异步原语 `await seekFrame(idx)`，串联「设置 currentTime → 等待 frame ready → 等待 annotation resolve → 触发 paint」，让上层（评论跳转、ML 结果 apply）能安全地 await。
- **R6.2 解耦帧索引与播放状态**：当前 `videoFrameIndex` 在 `useWorkbenchState` 全局，未来多 stage 并存（比对模式）会冲突，按 stage 实例隔离 frame 状态，外层只保留「当前 active stage」。
- **R6.3 撤销重做与 outside 段对齐**：R3.4 的 outside 段化要在 `useAnnotationHistory` 增加 `videoOutsideSegment` command kind，保持细粒度可撤销。

---

### R7 · 观测与回归（**贯穿，必做**）

- **状态（v0.9.21）**：R7.1 已有开发环境诊断对象 `window.__videoFrameClockDiagnostics`；R7.2 基准脚本和 R7.3 BugReportDrawer 自动附带仍未做。
- **R7.1 FPS / 长任务上报**：开发环境给 `VideoStage` 挂一个 `PerformanceObserver('longtask')`，把数据写到 console + 可选上报 endpoint，便于回归。
- **R7.2 基准用例**：固定 3 个 fixture 视频（720p/3min、1080p/5min、4K/30s）+ 3 套 annotation 密度（10/100/500 tracks），写到 `apps/web/scripts/video-bench/`，每次改动跑一遍录 trace。
- **R7.3 Bug 反馈对接**：BugReportDrawer 收到视频工作台 BUG 时自动附带最近 `frameClock.diagnostics()` 输出（最近 N 次 seek 耗时 / 解码失败次数）。

---

### R8 · Viewport / Pan-Zoom / Minimap（**升级自原"暂不做"，依赖 R2**）

> 原 ROADMAP 把 viewport 列为暂不做，理由是「直接迁图片 viewport 不合适」。R2 拆层后接口已就绪，加上高分辨率视频（≥1080p）和 SAM 框定子区域的需求，应该升级落地。

- **R8.1 复用图片 `useViewportTransform`**：图片工作台已有成熟实现（`apps/web/src/pages/Workbench/stage/useViewportTransform.ts`），把它抽到 `stage/shared/useViewportTransform.ts`，让图片 / 视频共用。
  - 状态：`{ scale, tx, ty }`，缩放 [0.2, 8]，Ctrl+滚轮锚点缩放，空格+拖平移。
  - 视频特殊点：seek 时保持当前 viewport，不复位；播放时禁止 zoom 操作（防误触）。
- **R8.2 Media 层 transform 同步**：R2 已经给三层留了 `transform: scale(s) translate(tx, ty)` 接口。Media 层的 `<video>` 直接用 CSS transform；Shapes / Interaction 层因为是标准化坐标系，只需更新 viewBox 或包一层 `<g transform>`。命中测试要把屏幕→图像坐标的换算函数从 viewport 里取。
- **R8.3 Minimap**：复用图片 `Minimap.tsx`，给视频版加一条「当前帧 + 已下载范围」的额外指示。条件显示阈值仍是「可视率 < 85%」。
- **R8.4 Fit / 1:1 / 适应宽度** 工具按钮和快捷键：`F` fit、`0` 1:1、双击 fit，与图片侧一致，降低学习成本。

**衡量**：4K/30s 视频可平滑缩放到 4x 检查标注边缘，无明显帧丢失。

---

### R9 · Polygon / Polyline / Mask Track（**升级自原"暂不做"，依赖 R3.4 + 后端协议**）

> 原 ROADMAP 暂缓理由是「需求和数据协议未明确」。在 R3 outside 段化、R4 时间轴可视化落地后，polygon track 的数据模型瓶颈基本解除；剩下的是协议设计 + 插值算法。

- **R9.1 协议设计**：扩展 `video_track` 的 `bbox` 字段为 `geometry: { kind: 'bbox' | 'polygon' | 'polyline' | 'mask', ...payload }`，向后兼容旧 bbox track（缺省 kind=bbox）。
- **R9.2 多边形插值算法**：直接借鉴 CVAT 的「曲线匹配 + 长度参数化」（cvat-core annotations-objects.ts L2525-2597）。要点：
  - 前后 keyframe 的顶点数可能不同 → 按周长归一化重采样到相同点数。
  - 提供 `interpolationMode: 'linear' | 'spline'` 切换。
  - 自相交检测沿用图片侧 `polygonGeom.ts` 的 `isSelfIntersecting`。
- **R9.3 Mask track**：仅在 R5.3（WebCodecs / 离屏 canvas）落地后做。Mask 用 RLE 存储（兼容 COCO），插值简化为「最近 keyframe」+ 可选 morphological 过渡，复杂插值留给 SAM 3 / 模型补帧。
- **R9.4 Polyline track**：作为 bbox / polygon 之外的第三种 kind，主要服务运动轨迹标注（球类、车道线）。算法上与 polygon 共享重采样。
- **R9.5 工具与撤销**：`P` 视频多边形、`L` 视频折线；`useAnnotationHistory` 加 `videoTrackGeometry` kind，差量存储顶点变化（不是整段几何快照）。

**前置依赖**：必须先与后端对齐 `video-track` JSON 导出协议；属于本 epic 与 `docs-site/dev/reference/` 的协议变更。

---

### R10 · AI Tracker / SAM 3 Video Predictor / 模型补帧（**升级自原"暂不做"，依赖后端 epic**）

> 原 ROADMAP 列为「另立 AI epic」。这里前端侧的 hook 点先列清楚，后端侧能力另见 `2026-05-12-video-backend-frame-service.md`。

- **R10.1 Tracker 协议**：前端定义统一接口 `requestTrackPropagation({ track_id, from_frame, to_frame, model })` → 返回流式 keyframe 增量。模型可选 SAM 2/3 / DEVA / Cutie / 简单 KCF。
- **R10.2 渐进式插帧 UX**：用户在帧 F 调整一个 bbox / mask → 浮层「向前 / 向后传播 N 帧 / 到下个 keyframe / 到结尾」→ 后台 Celery 跑，前端 SSE / WebSocket 拉增量结果，按帧顺序写入 track（标记 `source=prediction`），用户可随时打断 / 接受 / 拒绝。
- **R10.3 与 R3.4 outside 段集成**：模型预测置信度低于阈值或检测到目标消失 → 自动写 outside 段，不是写空白 keyframe。
- **R10.4 prediction 来源区分**：R4.1 时间轴已经按 source 着色，这一步把"接受/拒绝单帧 prediction"的细粒度操作做进 track 侧栏（CVAT 风格的 J/L 跳到下个 prediction）。
- **R10.5 离线模式**：模型推理是云端 Celery，但前端要能展示「队列中 / 处理中 / 完成 / 失败」状态，失败可重试，离线时排队等连上线后发。

**衡量**：用户在 30s 视频中手工标 3-5 个 keyframe + 一键模型补帧，剩余帧的 IoU @ 0.5 命中率 >80%（具体指标随模型定）。

---

### R11 · 长视频切片 / 多人协同 / 边缘抽样（**升级自原"暂不做"，依赖后端 epic**）

> 原列「属于架构级增强」，这里把前端侧的契约先固定下来。

- **R11.1 视频段（segment）模型**：前端层面把一条「视频任务」表示为 `segments: VideoSegment[]`，每段 `{ id, start_frame, end_frame, assignee?, status }`。短视频默认单段，长视频后端自动切。
- **R11.2 段切换 UI**：在时间轴左侧加段选择器（类似 CVAT job 列表），段间可跳转，跨段标注/查看靠后端聚合。
- **R11.3 协同**：单段单人锁定（行级 lock），他人只读。后续可扩展到 keyframe 级锁，但优先级低。Operational Transform / CRDT 不做（成本远高于收益），用「乐观锁 + 409 重试」沿用 V5 离线队列模式。
- **R11.4 边缘抽样**：长视频不必每帧标，工具栏加「关键帧抽样」按钮，按时间均匀 / 内容变化（后端先做粗检测）选 N 个候选帧，用户在这些帧上集中操作 + R10 模型补帧。
- **R11.5 Presence**：可选轻量功能，时间轴显示其他人光标位置（基于 WebSocket broadcast frame_index + cursor），不做实时编辑同步。

---

### R12 · 一致性与高级编辑（**追加项**）

- **R12.1 关键帧"对齐到边缘"**：seek 时若检测到目标对象边缘有强梯度，提示对齐建议（轻量 Canny / 形态学）。可放在 R5.2 的 ImageBitmap 缓存上做，复用解码后的帧位图。
- **R12.2 多 track 时间对齐线**：选中多条 track 时，时间轴显示所有 keyframe 的对齐线，方便用户对齐"同一动作"的多个对象。
- **R12.3 速度曲线编辑**：track 插值的速度可以非线性（slow-in / slow-out），给运动学场景用。
- **R12.4 track 合并 / 拆分初版**：基础入口（见 R14 / R15 详细方案）。

---

## 6. CVAT 视频专项追加借鉴（R13-R23）

> 二轮 CVAT 视频侧调研挖出的能力扩展，按"轨迹生命周期 / 时间轴与导航 / 数据组织 / 导入导出 / AI / 质量"五类组织。与 R1-R12 渲染体系正交，部分扩展现有 R 章节（标注 *扩展* / *新增*）。

### 轨迹生命周期

#### R13 · Chapter（章节）系统（**M，后端配套，新增**）

> CVAT 把视频按时间切成 chapter，每个 chapter 有标题和 metadata，时间轴上以分段竖线展示，可命名（"准备阶段 / 检测阶段 / 收尾"）。

- 长视频标注必备：标注员定位"哪段是有标注价值的内容"靠 chapter 比靠 frame 快得多。
- **R13.1 数据模型**：`VideoChapter(id, video_id, start_frame, end_frame, title, color, metadata)`，与 B4 segment 是不同维度（segment 是分配单位，chapter 是内容单位）。
- **R13.2 创建方式**：手工拖时间轴选段命名 / 后端 shot-detection 自动切（PySceneDetect）。
- **R13.3 跳转**：`PageUp/PageDown` 跳上/下 chapter；侧栏 chapter 树。
- 来源：`cvat-core/src/frames.ts` L87-105 + `cvat-ui/src/components/annotation-page/top-bar/chapter-menu.tsx`。

#### R14 · Track Split（在当前帧拆分轨迹）（**M，半后端，扩展 R12.4**）

> 在帧 F 处把一条 track 拆为两条独立 track（id 不同），适用于"原本以为是同一目标，看到后段发现是新目标"。

- **R14.1 操作**：选中 track + `Alt+S`，在当前 frame 处拆。新 track 继承类别和 immutable 属性，timeline 上从 F+1 开始。
- **R14.2 keyframe 处理**：F 之前归原 track（保留），F 及之后归新 track（重发 keyframe）。
- **R14.3 history**：单步 undo / redo（一对补偿命令）。
- 来源：`cvat-ui/src/actions/annotation-actions.ts:splitAnnotationsAsync` L1308+。

#### R15 · Track Merge（合并两条轨迹）（**M，半后端，扩展 V6**）

> 把两条无时间重叠的 track 合并为一条（id 复用），适用于"目标走出再走回的场景"。

- **R15.1 选择**：Shift+点击两条 track，工具栏出现「合并」按钮。
- **R15.2 校验**：必须同类别、时间不重叠；中间 outside 段自动填充。
- **R15.3 与 V6 的关系**：V6 是「散 bbox → 新 track」，R15 是「两条 track → 一条 track」，**底层走同一个 `compositeTrack(ids[])` API**，UI 是两个入口。
- 来源：`cvat-ui/src/actions/annotation-actions.ts:mergeAnnotationsAsync` L1308+。

#### R16 · Track Join（重连消失的目标）（**S，扩展 R10**）

> 目标走出画面 → 走回画面，AI 自动判断是否同一目标，命中时用 polyline 在时间轴上把两段 track 连起来（保持 id）。

- **R16.1 后端 Re-ID**：调用 Re-ID 模型（如 OSNet）对比两 track 末/首帧特征。
- **R16.2 UI 建议**：track 重新出现时，时间轴上 ghost 显示"建议合并到 track #42"，一键采纳。
- **R16.3 与 R10 关系**：R10 是"已知目标向后/向前传播"，R16 是"目标消失后重连"，前者是 tracker，后者是 Re-ID。
- 来源：`cvat-ui/src/actions/annotation-actions.ts:joinAnnotationsAsync`。

### 时间轴与导航

#### R17 · 时间轴章节可视化 + Hover 缩略图（**M，扩展 R4**）

> CVAT 时间轴鼠标 hover 任意位置时弹出该帧缩略图（已下载帧立即显示，否则触发后端单帧拉取）。

- **状态（v0.9.27）**：R17.1 + R5.1 第一版已完成。前端新增 `useVideoFramePreview`，时间轴 hover 显示 frame/time/缩略图；选中 track keyframes、bookmarks、loop region 起止帧会通过既有 `frames:prefetch` 预取。未引入 chapter、ImageBitmap 或 WebCodecs。
- **R17.1 缩略图**：已完成第一版。与 R5.1 keyframe poster 共用后端单帧缓存接口；前端按 hover 帧去重并维护内存 LRU，pending 自动重试一次。
- **R17.2 章节叠加**：R13 chapter 段在时间轴顶层用色带表示。
- **R17.3 已下载范围**：R5.2 / R5.3 缓存命中的帧用浅蓝条带覆盖，用户可见"哪些帧 seek 不会卡"。

#### R18 · 多速率播放（J / K / L NLE 风格）（**S，扩展 R4**）

> CVAT 的 `FrameSpeed: Fastest(100) | Fast(50) | Usual(25) | Slow(15) | Slower(12)` 多档速率切换；标准 NLE 编辑器的 J/K/L 三键习惯。

- **候选计划（未绑定版本）**：和 R6.1 `seekFrameAsync` 合并做。J/K/L 需要一个可 await 的 seek 原语，否则反向播放、loop region 边界和跳转历史会互相抢状态。
- **R18.1 五档播放速率**：键盘 `J`（反向 / 减速）、`K`（暂停）、`L`（正向 / 加速）。连按 L 提速。
- **R18.2 反向播放**：除常用 1x 外加入 0.25x / 0.5x / 2x / 4x；反向播放靠帧回退（不靠浏览器 video，因为 `playbackRate=-1` 不可靠）。
- **R18.3 与 R1 FrameClock 协同**：所有播放节奏统一从 FrameClock 走，video 元素只做被动渲染源。
- 来源：`cvat-ui/src/reducers/index.ts:FrameSpeed`。

#### R19 · Bookmark / 跳转栈（**S，新增**）

> 在视频中"打书签"快速回访；浏览栈记录最近 N 次 seek 位置，`Ctrl+[/]` 前进/后退（类似 IDE）。

- **状态（v0.9.26）**：轻量前端基础已完成。当前帧 bookmark、时间轴 marker 点击跳转、最近 50 次显式 seek 历史和 `sessionStorage` 恢复已落地；书签注释与侧栏列表仍留后续版本。
- **R19.1 bookmark**：已完成轻量版。`Ctrl+M` 在当前 frame 加 / 删书签，时间轴 marker 可点击跳转；注释和侧栏列表未做。
- **R19.2 跳转历史**：已完成第一版。显式 seek 推入栈，`Ctrl+[ / Ctrl+]` 在最近 50 个位置间游走；播放 tick 不写历史。
- 完全前端实现，状态隔离在 `VideoStage`，按 task 存到 sessionStorage；不占用后端帧服务 v0.9.25 接口。

#### R19.3 · 书签侧栏与注释（**S，后续**）

- 把当前轻量 bookmark 从时间轴 marker 扩展为侧栏列表，支持 label 编辑、排序、删除和点击跳转。
- 暂不接审核评论系统；等 V4 评论锚点 `(track_id, frame_index)` 落地后再决定是否把 bookmark 升级为正式 review anchor。

### 数据组织与切帧

#### R20 · 跳帧标注（frameStep）+ 自动插值（**M，后端配套，扩展 R3**）

> CVAT `frame_filter step=N` 模式：标注员只看每 N 帧一帧，其余帧用 keyframe 间插值或 hold 填充。长视频标注效率最重要的杠杆。

- **R20.1 项目级 frameStep 配置**：项目设置加"标注步长 step=5/10/30"，标注员只在这些帧上停留。
- **R20.2 UI 切换**：时间轴只显示 step 帧，`←/→` 跳 step 帧；`Shift+←/→` 强制单帧步进（调试 / 微调用）。
- **R20.3 中间帧策略**：默认线性插值；可改为"hold（保持上一个 keyframe）"或"AI 补帧（R10）"。
- **R20.4 与 R11 segment overlap**：开启 step 后，segment 边界要按 step 对齐，避免漏帧。
- 来源：`cvat-core/src/frames.ts` L111 frameStep。

#### R21 · Job Overlap（多 job 共享帧用于交叉校验）（**M，后端工程，扩展 R11 / B4**）

> CVAT 一个 task 切多个 job 时，可让相邻 job 重叠 N 帧，标注员 A 标 [0-100]，标注员 B 标 [90-200]，重叠区 [90-100] 用来做一致性检查。

- **R21.1 overlap_size 字段**：segment 模型加 `overlap_size: int`，长视频自动切时按比例叠。
- **R21.2 重叠区比对**：审核侧出"两人在重叠区标注的 IoU / IDF1"报告。
- **R21.3 冲突解决 UX**：重叠区可见两人版本，审核员选择 / 合并。
- 来源：`cvat/apps/engine/models.py:Segment`。

### 导入导出

#### R22 · MOT / KITTI Tracking / DAVIS 等专属格式（**L，后端工程，新增**）

> CVAT 支持 MOT 16/17/20、KITTI tracking、YouTube VOS、DAVIS 等视频专属格式，比通用 COCO Video JSON 更适合训练 MOT 模型。

- **R22.1 MOT 格式（重点）**：标准 CSV `frame,id,bbox_left,bbox_top,bbox_w,bbox_h,conf,class,visibility`，是 MOTChallenge 默认输入。
- **R22.2 KITTI Tracking**：包含 3D 信息字段（即使我们只标 2D，留向上兼容）。
- **R22.3 DAVIS（mask）**：mask track 的 PNG 序列导出。
- **R22.4 ImageNet Video / YouTube VOS**：低优先级，按客户需求加。
- **R22.5 outside 段处理**：导出时各格式对"目标消失"的表达方式不同，统一在后端导出层抹平。
- 来源：`cvat/apps/dataset_manager/formats/mot.py` L76-97。

### AI 与质量

#### R23 · 视频 Tracker Registry + 自动 Re-ID（**L，后端 epic，扩展 R10 + B5**）

> CVAT 视频 tracker 抽象统一：SAM 2 video / Cutie / DEVA / SORT / DeepSORT / 简单 KCF 都走同一接口。前端工具栏按可用 tracker 渲染选项。

- **R23.1 Tracker registry**：与图片侧 I20「Interactor 协议」共用注册基础设施（图片侧是单帧 SAM，视频侧是跨帧 tracker）。
- **R23.2 自动 outside**：tracker confidence 低于阈值时自动写 outside 段（已在 R10.3 提出，本条把"阈值由后端模型给"做实）。
- **R23.3 Re-ID 自动建议**：目标消失 N 秒后再出现，后端跑 Re-ID 比对，前端展示"疑似 track #42 重现"提示（R16 的实现侧）。
- **R23.4 Tracker state 持久化**：长视频跨多次会话的 tracker state（如 SAM 2 video 的 memory bank）后端 Redis 保存，下次打开继续。
- **R23.5 多模型比对**：同一帧范围分别跑 SAM 2 / Cutie / DEVA，UI 出"哪个更准"投票（与长期 L3 模型评估打通）。
- 来源：`/ai-models/tracker/sam2/func.py:_Sam2Tracker`。

#### R24 · Track 级 IAA / MOTA / IDF1（**L，后端 epic，与长期 L15 联动**）

> 视频 IAA 比图片复杂，需要按时间 + 空间双维度算：MOTA（多目标追踪准确度）、IDF1（id 一致性）、HOTA（综合）。

- **R24.1 评估 worker**：拉两个标注员的 track 集合，跑 MOT 标准评估，输出指标 + 错误分类（FP / FN / IDSW）。
- **R24.2 错误可视化**：在时间轴上标出"哪一帧出错了"，让标注员/审核员定位。
- **R24.3 与 R21 / R23 关联**：R21 重叠区可直接喂入 R24 评估；R23 多模型比对也走同一评估管线。
- **R24.4 与长期 L15 关系**：L15「标注质量 AI 审计」的视频侧实现，是其前置。
- 来源：`cvat/apps/quality_control/statistics.py`（基础设施，未含 MOTA 内置）。

---

## 7. 优先级与建议顺序

> 当前状态（2026-05-12 晚）：R1 / R2 / R3 / R4 / R19 轻量基础已经落地；后端 B1 / B2 / B3 / B6 / B7 第一版已落地。v0.9.27、v0.9.29 与 v0.9.31 已落地；之后版本会受并行开发影响，本文只给候选顺序，不预占版本号。

```
Wave 0 · 功能尾巴（接 M5.0 的最后三件，仍 open）
  V5 probe/poster 重试 (1 周，与 B3 共享后端)
  V4 review 差异化 (1-2 周，依赖 R4 时间轴 source 着色)
  V6 bbox→track 反向聚合 (1 周，与 R15 合并语义共享底层 API)

Wave 1 · 基础夯实（已完成第一版）
  R1 帧索引精度
  R2 渲染分层
  R3 插值索引化 + outside 段
  R4 时间轴可视化
  R19 轻量 bookmark / 跳转历史

Wave 2 · 当前近期体感收益
  R17.1 Hover 缩略图 + R5.1 keyframe/bookmark/loop 预取 (v0.9.27 已完成第一版)
    └→ R18 多速率播放 (J/K/L) + R6.1 seekFrameAsync (v0.9.29 已完成第一版)
         └→ R7.2/R7.3 视频基准与 BugReport 诊断附带 (v0.9.31 已完成第一版)

Wave 3 · 工程加固（按数据触发）
  R5.2 ImageBitmap 缓存 (1 周)
    └→ R5.3 WebCodecs chunk 解码 (2-3 周，依赖 backend epic)

Wave 4 · 能力上探（功能扩张）
  R8 Viewport / Minimap (1 周，复用图片侧)
    └→ R9 Polygon / Polyline / Mask track (2-3 周)
         └→ R13 Chapter 章节系统 (1-2 周)
         └→ R14 Track Split (1 周)
         └→ R15 Track Merge (1 周，与 V6 共享底层)
         └→ R20 跳帧标注 frameStep (1-2 周，后端配套)
         └→ R12 高级编辑 (按需)

Wave 5 · AI 与协同（依赖 backend epic）
  R10 AI Tracker / SAM 3 video (与 backend epic 并行)
    └→ R16 Track Join (Re-ID 重连)
    └→ R23 Tracker Registry + state 持久化 + 多模型比对
  R11 长视频切片 / 协同 (与 backend epic 并行)
    └→ R21 Job overlap (扩展 R11 / B4)

Wave 6 · 数据互操作（按客户场景）
  R22 MOT / KITTI Tracking / DAVIS 导出 (2-3 周)

Wave 7 · 质量与评估（与长期 L15 联动）
  R24 Track 级 IAA / MOTA / IDF1 (独立后端 epic)
```

- **Wave 0** 是功能闭环的最后三件，与渲染优化正交可并行；V5 / V6 与 R15 / B3 共享底层 API，落地时合并设计。
- **Wave 1** 已完成第一版，后续只补 R7 观测和回归。
- **Wave 2** 是当前最应该继续开发的切片：v0.9.27 已消费现有 frame cache，v0.9.29 已落地 J/K/L + atomic seek，v0.9.31 已补本地 bench 入口与 BugReport 诊断附带。
- **Wave 3** 按 Wave 1 的 trace 数据决定是否上 chunk 解码。
- **Wave 4 / Wave 5** 是能力扩展，必须先与 `2026-05-12-video-backend-frame-service.md` 后端 epic 对齐协议。
- **Wave 6 / Wave 7** 按客户场景与长期规划触发，不阻塞前面波次。

---

## 8. 不做 / 暂缓（硬约束清单）

> 原 V4/V5/V6 之外的「不做」项已被 R8-R24 大量升级落地。这里只保留硬约束 + 新追加的明确暂缓。

**硬约束（不会变）**：
- **不引入 fabric / 重写为纯 Konva / pixi**：现有 SVG 体系经 R2 拆层后足够，Mask 用单独的离屏 Canvas（R5.2 / R9.3）即可，不需要替换整体渲染框架。
- **不上 ffmpeg.wasm / Broadway.js**：体积大、维护成本高。WebCodecs（R5.3）作为唯一 wasm-free 路线。
- **不上 OT / CRDT**：R11.3 协同走「行级锁 + 乐观重试」，不引入实时协同编辑算法栈。
- **不重写 Zustand 为 Redux**：R6 增量优化，保持现有架构。
- **不为旧 `video_bbox` 写迁移脚本**：现有 schema 已向前兼容（继承自原 V0 决策）。

**追加暂缓**：
- **R22.4 ImageNet Video / YouTube VOS**：等客户具体提需求，不做兜底。
- **R23.5 多模型投票自动化**：先做 UI 显示，决策仍归人；自动选优待 L3 评估积累后再做。
- **录制宏 / 教程模式**：CVAT 调研中提到，但与核心标注流程交集小，等客户提再做。

---

## 9. 与其他 ROADMAP 的关系

- `[archived]2026-05-11-video-workbench.md` — **已合并入本文件**（V2/V3 历史 + V4/V5/V6 进入 §4 与 Wave 0）。
- [`2026-05-12-video-backend-frame-service.md`](2026-05-12-video-backend-frame-service.md) — **后端帧服务 epic**，承载 R5.3 / R10 / R11 / R20 / R21 / R23 的服务端能力。R22 导出格式也走那里的导出层。
- [`2026-05-12-image-workbench-optimization.md`](2026-05-12-image-workbench-optimization.md) — **图片工作台优化**。R2 / R8 复用图片侧的 viewport / minimap / rAF 节流；R23 Tracker Registry 与图片 I20 Interactor 协议共用注册基础设施。
- [`2026-05-12-long-term-strategy.md`](2026-05-12-long-term-strategy.md) — R24 Track 级 IAA 是 L15「标注质量 AI 审计」的视频侧实现，作为其前置。R23 多模型比对与 L3 模型评估打通。
- [`0.10.x.md`](0.10.x.md) — R23 Tracker Registry 与 v0.10.x SAM 3 协议同窗口，避免二次破窗。

---

## 10. 关键文件参考

### 我们要改的（apps/web/src/pages/Workbench/）

| 模块 | 当前文件 | 改造方向 |
| --- | --- | --- |
| FrameClock | `stage/useFrameClock.ts` / `stage/frameTimebase.ts` | 已完成 R1 第一版；后续接 R18 多速率播放 |
| 渲染分层 | `stage/VideoStageSurface.tsx` + `Video*Layer.tsx` | 已完成 CVAT-aligned surface；后续接 R5/R8/R17 |
| 插值 | `stage/videoStageGeometry.ts` / `stage/videoTrackOutside.ts` / `stage/videoFrameBuckets.ts` | R3.1-R3.4 已完成第一版；后续接 R4/R9 |
| 类型 | `types/index.ts` / `stage/videoStageTypes.ts` | `outside: Range[]` 已完成；`geometry.kind` 留给 R9 |
| 时间轴 | `stage/VideoPlaybackOverlay.tsx` / `stage/videoTrackTimeline.ts` / `stage/videoNavigationState.ts` | R4.1-R4.4 与 R19 轻量导航基础已完成；章节、hover 缩略图、多速率播放留给 R17/R18 |
| 状态 | `stage/VideoStage.tsx` / `state/useWorkbenchState.ts` L62-180 | loop/bookmark/history 先在 stage 内按 task 隔离；后续再做 `seekFrameAsync` 与全局 stage 状态收敛（R6） |
| 撤销重做 | `state/useAnnotationHistory.ts` | `videoOutsideSegment` / `trackSplit` / `trackMerge` kind（R3.4 / R14 / R15） |
| Track 编辑入口 | `stage/VideoTrackPanel.tsx` | 加 split / merge / join 操作（R14 / R15 / R16） |

### CVAT 参考路径

- `cvat-core/src/frames.ts` — 预取 / LRU / 请求去重 / Chapter / frameStep
- `cvat-core/src/annotations-objects.ts` — Track 插值与 outside 段
- `cvat-canvas/src/typescript/canvasView.ts` — 渲染分层
- `cvat-data/src/ts/cvat-data.ts` — Worker 解码管道
- `cvat-ui/src/actions/annotation-actions.ts` L1308+ — `splitAnnotationsAsync` / `mergeAnnotationsAsync` / `joinAnnotationsAsync` / `propagateObjectAsync`
- `cvat/apps/dataset_manager/formats/mot.py` L76-97 — MOT 导入导出
- `cvat/apps/engine/models.py:Segment` — 视频分段 + overlap
- `cvat/apps/quality_control/statistics.py` — 质量评估基础
- `ai-models/tracker/sam2/func.py` — SAM 2 video tracker

---

## 11. 近期开发切片

> 目的：把本 epic 从“大地图”收敛成可交付切片。v0.9.27、v0.9.29 与 v0.9.31 已落地；其余条目是候选顺序，不预占版本号。每个切片完成后再更新本文件状态、`CHANGELOG.md`、概念文档和对应 `docs/plans/` outcome。

### v0.9.27 · Video Timeline Hover Preview（已完成第一版）

- **范围来源**：R17.1 + R5.1。
- **核心交付（已落地）**：
  - `VideoPlaybackOverlay` hover 时间轴时显示当前 hover frame、时间戳、缩略图预览。
  - 新增前端 frame preview hook，调用后端 v0.9.25 已有 `GET /api/v1/tasks/{task_id}/video/frames/{frame_index}?format=webp&w=320`。
  - 对选中 track 的 keyframes、bookmark frames、loop region 起止帧做 `frames:prefetch` hint。
  - 缓存状态分三态：`ready` 显示图、`pending` 显示轻量 loading、`error` 显示 frame/time fallback。
- **不做**：
  - 不做 chapter 数据模型（R13/R17.2）。
  - 不做 ImageBitmap 背景缓存（R5.2）。
  - 不接 WebCodecs chunk 解码（R5.3）。
- **验证**：
  - 单测覆盖 hover debounce、pending retry、prefetch 去重。
  - 手动验证未命中 frame cache 时 API 返回 202 不会让 overlay 闪烁或报错。

### v0.9.29 · Video J/K/L Playback + Atomic Seek（已完成第一版）

- **范围来源**：R18 + R6.1。
- **核心交付（已落地）**：
  - `useFrameClock.seekToAsync(frame)` 返回 frame ready / stale 结果；连续 seek 时旧回调不再覆盖最新目标。
  - `VideoStage.seekFrameAsync(frame)` 统一承接时间轴 scrub、逐帧、关键帧跳转、bookmark、jump history 和 loop region 起跳。
  - `J/K/L` 多速率播放：`K` 暂停，`L` 正向播放 / 加速，`J` 反向播放 / 减速，支持 0.25x/0.5x/1x/2x/4x 档位。
  - 反向播放按帧步进调用 `seekFrameAsync`，不使用 `video.playbackRate = -1`；overlay 显示当前 jog 速度。
- **不做**：
  - 不引入 WebCodecs / chunk decode。
  - 不做 ImageBitmap 背景缓存。
  - 不把速度状态持久化到后端。
- **验证**：
  - 单测覆盖 J/K/L hotkey dispatch、正向速率、暂停、反向不使用负 `playbackRate`、overlay 速度显示。

### v0.9.31 · Video Observability Pack（已完成第一版）

- **范围来源**：R7.2 + R7.3。
- **核心交付（已落地）**：
  - 固化 720p/1080p/4K 三组视频 bench fixture 描述与脚本入口。
  - BugReportDrawer 在视频工作台自动附带 `window.__videoFrameClockDiagnostics`、最近 seek 耗时、frame cache 命中状态和当前 timeline mode。
  - docs-site 增加视频性能回归 how-to。
- **不做**：
  - 不把 trace 上传为长期资产；先保留本地生成和 PR 附件路径。

### v0.9.33 · Probe / Poster / Frame Asset Retry（已完成第一版）

- **范围来源**：V5 + B3 后续。
- **核心交付（已落地）**：
  - 后端统一列出 `probe_error` / `poster_error` / `frame_timetable_error` 与 chunk / frame cache 失败行。
  - 新增 `POST /storage/video-assets/retry`，复用 `generate_video_metadata` / `ensure_video_chunks` / `extract_video_frames` media 队列任务。
  - 存储管理页新增「视频资产失败」面板，展示项目、任务、失败类型、错误摘要与重试入口。
- **不做**：
  - 不引入新服务；仍复用 Celery media queue。
  - 第一版不做自动重试和长期失败趋势图。

### 候选 · Review Video Anchors

- **范围来源**：V4。
- **核心交付**：
  - Review 模式支持 raw / final 视图切换。
  - 审核反馈可锚定 `(annotation_id, track_id?, frame_index)`。
  - track 列表与时间轴区分 manual / interpolated / prediction，并能跳到下一条 prediction。
- **不做**：
  - 不做像素级视频 diff；先做对象级差异和锚点。

### 候选 · Track Composition

- **范围来源**：V6 + R14 + R15。
- **核心交付**：
  - `video_bbox` -> `video_track` 反向聚合。
  - Track split / merge 共用后端 composition service。
  - history 增加 `trackSplit` / `trackMerge` command kind。
- **触发条件**：
  - Review anchor 稳定后再做，避免同时改 track 生命周期和审核定位。
