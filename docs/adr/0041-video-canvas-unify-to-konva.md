# 0041 — 视频渲染栈统一到 Konva（帧合成 / 坐标模型 / 测试基建）

- **Status:** Accepted（决策 A = A1，v0.16.0 spike 实测确认；坐标/测试决策 B/C 随地基落地）
- **Date:** 2026-06-16
- **Deciders:** core team
- **Supersedes:** —

## Context

图片工作台是 Konva（[ADR-0004](0004-canvas-stack-konva.md)，5 Layer），视频工作台却是另一套栈:原生 `<video>` + `<canvas>` 位图 + 多层裸 SVG（`<rect>/<polyline>/<circle>`）+ DOM 文字 + CSS `transform` pan/zoom + 归一化 `[0,1]×[0,1/aspect]` 坐标经 SVG CTM 转换。

双栈的长期税不在选型对错（CVAT 全 SVG、Label Studio 全 Konva 都能扛），而在**本仓库混用**导致:

1. **视觉参数永久双份维护**:标签字号 / 线宽 / 填充透明度等默认值在图片(Konva)与视频(SVG/DOM)两条 draw 路径各写一遍,长期悄悄漂移(B-32/36/38/39 系列、v0.15.27 收口的根因)。
2. **坐标模型分裂**:图片用「像素空间 + Konva transform」,视频用「归一化 + SVG CTM + viewBoxHeight=1/aspect」,scale 抵消 / fit / 滚轮缩放各写一套。
3. **能力实现两遍**:任何新交互(snap、resize 手柄范式、issue pin)都要在两套命中模型里落地两次。

[ADR-0004 Notes](0004-canvas-stack-konva.md) 当年预言「VideoStage react-konva 同栈」,但现实走了 SVG——本 ADR 来收口这一分裂。

| 统一方向 | 可行性 | 结论 |
|---|---|---|
| **视频 SVG → Konva** | 视频形状稀疏,可迁就图片 | **选它** |
| 图片 Konva → SVG | 图片有数百顶点 polygon、SAM 像素级掩膜、重度顶点拖拽,SVG 做不了,无法离开 Konva | 不可能 |

## Decision

**上线前把视频渲染栈统一到 Konva,与图片同栈。** 方向唯一(只能视频迁就图片)。分版串行推进(v0.16.0 地基 → .1 媒体层 → .2 标注层 → .3 交互层+测试 → .4 切默认 → .5 删旧栈),全程 flag 双栈并行、像素级对照验收、数据零迁移。Epic 见 [`docs/plans/2026-06-16-v0.16.x-canvas-unification-epic.md`](../plans/2026-06-16-v0.16.x-canvas-unification-epic.md)。

本 ADR 钉死三个核心抉择(epic 的脊柱)。

### 决策 A — 视频像素怎么进 Konva【需性能 spike 闸门】

| 方案 | 做法 | 优 | 劣 |
|---|---|---|---|
| **A1 帧合成进 Konva（推荐）** | `Konva.Image` 以隐藏 `<video>` 为 source,**视频单独一层** `batchDraw`;播放时 rAF 逐帧重绘视频层,标注层静止;暂停时贴 bitmap 缓存 | 真·单栈单坐标单 transform,根治漂移;标注与底图同一命中模型 | 播放时视频层整帧重绘有成本,高分辨率/高帧率需实测 |
| A2 透明 Konva 盖在 `<video>` 上 | `<video>` 仍是 DOM,Konva Stage 透明只画标注 | 不重绘视频像素,perf 稳 | 没真正统一:仍两个 transform 要同步(正是要消灭的漂移源),坐标双轨 |

**推荐 A1 + 分层**(video 层 / 标注层各自独立 canvas)。理由:本 epic 全部价值在「单栈」,A2 等于没迁。两个缓解几乎让 perf 风险归零:① 分层——播放时只 `videoLayer.batchDraw()`,数百标注形状静止;② 暂停态走 bitmap 缓存不进重绘循环——精修都在暂停态,逐帧重绘只发生在「播放观看」时,不伤精修体验。

**量化闸门(契约)**:在**分层前提下**,标注主力场景 **1080p@30 视频层单帧 batchDraw < ~8ms 且无明显掉帧 → A1 通过**;4K@60 仅作上限参考,可结合「暂停态走 bitmap 缓存、播放态才重绘」的实际使用模式放宽。**仅当分层后 A1 仍不达标才降级 A2**,届时把「双 transform 同步契约」写成本 ADR 里有测试守护的一等不变量(非临时补丁)。

**实测结论(2026-06-16,Chromium · 已采集)**:**A1 通过,无需降级 A2。** 用隔离 spike(`apps/web/src/pages/Workbench/stage/_spikes/videoKonvaFrameSpike.tsx`,合成 canvas 帧源 + 分层/单层对照,同步 `layer.draw()` 计时)跑全 24 格矩阵({720p,1080p,4K}×{30,60}×{0,20框}×{分层,单层}):

- **门槛格 1080p@30 分层**:单帧合成均值 0.13ms / p95 0.20ms / 掉帧 0%,**比 8ms 闸门快约 40×**。
- **上限 4K@60+20框**:分层 p95 0.30ms / 单层 p95 0.40ms,仍远低于 8ms。
- **全矩阵 p95 ≤ 0.40ms**;成本由**目标舞台像素**绑定、与源分辨率几乎无关(4K 解码归 `<video>`,A1/A2 共担、已比掉)。即 A1 相对 A2 的**增量**合成成本是亚毫秒级,「单栈」收益不被 perf 抵消。

数据表、方法学与测量教训(必须用同步 `draw()` 而非异步 `batchDraw()` 度量)见 [`docs/plans/_spike-results/2026-06-16-video-konva-frame-perf.md`](../plans/_spike-results/2026-06-16-video-konva-frame-perf.md)。

### 决策 B — 坐标模型统一到「像素空间 + Konva transform」

- 采图片范式:**存储仍是归一化**(数据零迁移),渲染边界用视频固有宽高换算成像素(等价图片的 `imgW/imgH`),Konva Stage 负责 scale/pan。
- **废弃**视频的 SVG CTM 转换(`videoStageCoordinates.ts`)与 `viewBoxHeight=1/aspect`,改用图片的 `toImg()` 同款逆变换。
- 收益:scale 抵消、fit-to-canvas、滚轮缩放与图片**同一套**纯函数。v0.16.0 已抽出公共原语 `apps/web/src/pages/Workbench/stage/shared/viewport/`(`fit.ts` / `zoom.ts` / `scaleCancel.ts`),图片作为第一个消费者验证等价,视频 v0.16.1 复用。

### 决策 C — 三层测试分工(迁移前硬前置)

视频现有强 RTL 覆盖查 SVG DOM 节点,Konva 渲染到 canvas 无 DOM 可查会整片失效;图片侧此前零组件测试。迁移前必须立起测试策略:

1. **纯逻辑测试照旧**(picking / resize / geometry,本就栈无关)——100% 保留。
2. **react-konva mock**(`apps/web/src/test/konvaMock.tsx`):把 `Stage/Layer/Rect/Line/...` mock 成带 `data-konva` + `data-testid` 的 DOM stand-in,事件 props 挂 DOM,让组件交互测试沿用 RTL `fireEvent` + `getByTestId` 风格(保住现有断言风格,降低视频测试迁移改动量)。**明示局限**:mock 只验证交互 / props,**不验证真实 canvas 绘制**。
3. **Playwright 冒烟**:真浏览器跑端到端关键路径(画框 / 选中 / 播放)+ 截图基线,守 canvas 真渲染回归。

此基建图片侧同样受益(补上其缺失的组件测试)。

### 视频 Layer 结构提案(对齐图片 5 Layer,供 v0.16.2 落地)

```
VideoStage (Konva.Stage)
├─ Layer · media     — 视频帧(Konva.Image,A1 单独一层 batchDraw)/ 暂停态 bitmap
├─ Layer · track     — 框 / 轨迹 / keyframe 圆点(抄 ImageStageShapes)
├─ Layer · overlay   — 当前绘制中的 draft / 选中变换 controls
└─ Layer · issue     — issue pin(抄 image/IssueLayer.tsx)
```

## Consequences

正向:

- 双栈塌缩为单栈:视觉参数双份维护税归零(v0.15.27 `annotationVisual.ts` 的双 draw 路径在 v0.16.5 塌缩为单 Konva 路径);坐标模型、scale 抵消、fit/zoom 全仓一套。
- 视频白嫖图片侧现成范式:scale 抵消、Label+Tag+Text、ToolPointerContext 工具解耦。

负向(已知,接受):

- 视频失去 SVG 三个白送项,迁移后需在 Konva 手动等价实现:① CSS 主题/暗色直接管文字 → tokens 值经 JS 注入;② `non-scaling-stroke` 恒定线宽 → scale 抵消(`screenToWorld`);③ DOM 文字的字体/i18n/断行 → Konva Text(无自动断行,抄图片 Label 处理)。
- A1 若实测不达标需降级 A2,坐标退回双 transform 同步——风险已登记,缓解见决策 A。
- 视频侧 draw 代码在 v0.15.27→v0.16.2 过渡期写两遍(SVG 一遍、Konva 一遍),已接受(`annotationVisual.ts` 纯函数跨栈不变,只换最后 draw 调用)。

## Alternatives Considered（详）

**保持双栈(不迁)**:维持现状最省事,但视觉参数双份维护、坐标分裂、能力两遍实现的税永久存在,且每加一个视觉设置都要在两栈各写一遍(v0.15.27 已是明证)。上线前不收口,日后形状只会更多、迁移成本只增不减。否决。

**视频也用 SVG 把图片迁过去**:不可能——图片有数百顶点 polygon、SAM 像素级 `getImageData` 掩膜、重度顶点拖拽,SVG 扛不住(ADR-0004 已验证 1000+ 节点 DOM 卡死)。

## Notes

- 实现代码位置:
  - 公共 viewport 原语:`apps/web/src/pages/Workbench/stage/shared/viewport/{fit,zoom,scaleCancel}.ts`(v0.16.0)
  - react-konva mock:`apps/web/src/test/konvaMock.tsx`(v0.16.0)
  - perf spike:`apps/web/src/pages/Workbench/stage/_spikes/videoKonvaFrameSpike.tsx`(v0.16.0,验收后可删)
  - 待迁视频栈:`VideoMediaLayer.tsx` / `VideoObjectsLayer.tsx` / `VideoTrackShape.tsx` / `VideoTextLayer.tsx` / `VideoInteractionLayer.tsx` / `VideoIssueLayer.tsx` / `videoStageCoordinates.ts`
- 相关 ADR:[ADR-0004](0004-canvas-stack-konva.md)(图片 Konva,本 ADR 补视频帧合成 / Layer 结构)、[ADR-0017](0017-workbench-shell-mode-and-stage-adapters.md)(Shell + Stage Adapter 接缝不变)、[ADR-0031](0031-dual-canvas-konva-three.md)(视频从 SVG 归入 Konva 2D 栈)、[ADR-0040](0040-shared-annotation-visual-spec-not-stack-merge.md)(共享视觉规格,本 epic 是其双路径塌缩的终点)。
- 后续触发条件:决策 A 已实测定为 A1(2026-06-16);v0.16.5 删旧栈后回 ADR-0004 / 0031 扩写定稿。若后续在低端机 / 高 DPR / 更大舞台实测发现 A1 不达标,再依决策 A 的契约触发 A2 降级。
