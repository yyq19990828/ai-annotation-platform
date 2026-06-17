# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

<!-- 0.16.x 版本变更按版本段追加到本区；进入 0.17.x 后整体移到 docs/changelogs/0.16.x.md -->

## [0.16.7] - 2026-06-17

「标签内容」设置从一维扁平多选重做为**按标注类型分段**(单帧 / 轨迹 / AI 预测),每段只列该类型有意义的字段;视频轨迹标签首次接入这套配置(此前为硬编码)。

### Changed

- **标签内容按类型分段**:工作台设置「标签内容」改为分段控件,顶部切换「单帧 / 轨迹 / AI预测」,下方按段勾选字段。`类别名` 三段恒显;单帧可选分组号 / 属性,轨迹可选轨迹号 / 状态(插值·遮挡)/ 属性,AI 预测可选来源前缀 / 置信度 / 分组号 / 属性。同时修掉旧控件右对齐换行 chip 的观感问题。
- **AI 来源前缀可关**:AI 框 `✦ 模型 / 导入` 前缀由恒显改为 AI 段 `来源` 可选项(默认开)。
- **视频轨迹标签接入设置**:视频 track 框标签此前硬编码 `#轨迹号 · 类别 · 状态`,现按轨迹段配置渲染,默认配置等于原观感。
- **偏好数据结构**:`common.labelContent` 从 `string[]` 改为 `{ single, track, ai }` 分段对象;后端 `before` validator 与前端 sanitize 自动迁移旧扁平值(图片观感不变),旧用户无感。

### Tests

- 前端:`buildLabelText` / `buildTrackLabelText` 三段字段组合、`migrateLabelContent` 旧值迁移、分段控件渲染。
- 后端:旧扁平 list 迁移、新对象去重 / 缺段补默认 / 非法 token 拒绝。

### Docs

- 用户指南「工作台设置」标签内容小节改写为按类型分段;`settings.generated.md` 重新生成。

## [0.16.6] - 2026-06-17

画布栈统一 epic 收尾(ADR-0041):**删除视频 SVG/DOM 旧栈,Konva 成为视频工作台唯一渲染栈**。观察期无回退后兑现不可逆清理——双栈塌缩为单栈,视觉参数/坐标模型/scale 抵消/fit/zoom 全仓与图片同一套,双份维护税归零。删除前补齐切默认观察期遗留的对等缺口,确保删栈不丢功能。

### Removed

- 删除整套 SVG/DOM 视频渲染栈(16 个文件):`VideoStage` / `VideoFrameOverlay` / `VideoObjectsLayer` / `VideoTrackShape` / `VideoTextLayer` / `VideoInteractionLayer` / `VideoIssueLayer` / `VideoMediaLayer` / `VideoGridLayer` / `VideoAttachmentLayer` / `VideoBitmapLayer` / `VideoStageSurface` / `VideoSelectionActions` / `videoStageCoordinates`(SVG CTM 坐标路径)/ `useChunkSamples` / `videoChunkDemux`,及其旧测试与 `.module.css`。
- 移除 `videoKonvaFlag`(URL query `?videoKonva=` / localStorage 逃生舱)与设置面板「视频 Konva 渲染栈」开关(`experiment.videoKonva`);`VideoWorkbench` 去掉 flag 分流,无条件渲染 `VideoKonvaStage`。
- 清理 `boxVisual.ts` 中仅 SVG 用的归一化常量(`VIDEO_HANDLE_SIZE` / `VIDEO_LABEL_*` 等)。

### Fixed

- **删栈前对齐功能**:补齐 Konva 视频栈缺失的三处能力——① 光标坐标上报(`onCursorMove` → 状态栏像素坐标读出);② 本地视口/导航快捷键 `F`(fit)/`0`(实际尺寸)/`Home`·`End`(选中轨迹首/末出现帧);③ issue 图钉点击(可点击跳到讨论面板,pointerdown `cancelBubble` 防误触发画框)。
- **标注标签「字号」设置失效**:Konva `Text` 的 `fontFamily` 误用 CSS `var(--font-sans, …)`,canvas 无法解析致整串非法、字号恒回退 10px;改用字面字体栈(图片 + 视频两栈)。
- **工作台设置滑条数值不实时**:拖动时数字读出冻结到松手才更新;提升拖动期实时值用于显示,commit 仍仅在松手发生。

## [0.16.5] - 2026-06-16

画布栈统一 epic 的**功能对等补全**:v0.16.4 切默认后发现 Konva 视频栈缺了一整套环绕画布的「视频 chrome」——时间轴/播放浮层、Minimap、QC 警告、关键帧快跳——以及大量热键驱动的导航命令(关键帧跳转/书签/循环区间/跳转历史/采样网格步进/jog 连播/轨迹状态切换),这些此前只存在于旧 SVG `VideoStage`。本版把这些非画布机制补齐到 Konva 栈,使其与旧栈**真·功能对等**,为后续删旧栈(原计划 v0.16.5,顺延为下一独立 release)扫清前置。旧 SVG 栈与 flag 仍全保留作逃生舱。

### Added

- **视频播放控制器** `useVideoPlaybackController`:从 `VideoStage` 抽出的栈无关 hook,封装播放/逐帧/jog 连播(含反向 rAF)/循环区间/书签/跳转历史(sessionStorage 持久化)/采样网格导航/关键帧跳转/暂停吸附,以及派生的时间轴密度、选中轨迹时间线、QC 质量警告、帧悬停预览。复用既有纯函数(`videoSamplingGrid`/`videoNavigationState`/`videoTrackTimeline`/`videoTrackOutside` 等),不重复造轮子。
- **Konva 视频栈补齐 chrome**:`VideoKonvaStage` 现渲染 `VideoPlaybackOverlay`(时间轴:章节/书签/循环区间/全局密度/jog 速率)、`Minimap`、`VideoQcWarnings`、关键帧快跳浮层;`useImperativeHandle` 接控制器真实命令(此前 `seekToKeyframe`/`toggleBookmark`/`jumpHistory`/`clearLoopRegion`/`toggleSelectedTrack*`/`propagateSelectedTrack`/`deleteSelectedTrackKeyframe` 均为 no-op,现全部生效)。QC 警告用当前帧 `frameViews.entries`(`VideoEntryView` 新增 `className` 字段)计算,覆盖关键帧间隔/极小框/高重叠三类。

### Changed

- **`VideoStageControls` / `VideoPoint` 类型解耦**:从 `VideoStage.tsx` 抽到 `videoStageControls.ts` / `videoStageTypes.ts`,供两栈共用,为删旧栈断开类型耦合。

### Notes

- **WebCodecs 精确帧解码路径暂未迁到 Konva 栈**(`useVideoChunkDecoder` 等,flag-gated 实验特性,默认关):Konva 栈精确帧走 `useVideoBitmapCache`,与旧栈默认路径一致;WebCodecs 迁移留作后续。

## [0.16.4] - 2026-06-16

画布栈统一 epic 第五步:**视频工作台默认切到 Konva 渲染栈(可逆,不删旧栈)**。`experiment.videoKonva` 未显式设置时默认开启,视频工作台默认走统一的 Konva 栈;**旧 SVG 栈与开关全部保留作逃生舱**——`?videoKonva=0` 或设置面板关闭即秒级回退,行为与切换前完全一致。删旧栈是下一个独立 release(v0.16.5,待观察期无回退后才做)。前置功能对等(画框/移动/缩放/平移/选中 + 右键菜单)已在 v0.16.3 与本版补齐。架构见 [ADR-0041](docs/adr/0041-video-canvas-unify-to-konva.md)。计划见 `docs/plans/2026-06-16-v0.16.4-cutover-default-on-and-observe.md`。

### Changed

- **视频默认渲染栈 → Konva**:`isVideoKonvaEnabled` / `resolveVideoKonvaEnabledFromEnv` 默认值改为开(`VIDEO_KONVA_DEFAULT_ON`),设置面板「实验特性 · 视频 Konva 渲染栈」默认显示开启;显式 `?videoKonva=0` / 关闭开关 / localStorage `video.experimental.konva=0` 仍可回退旧 SVG 栈(逃生舱,优先级:URL > localStorage > 默认)。
- **观察期面包屑**:视频工作台挂载时在控制台打 `[video-stack] 渲染栈 = konva|svg(回退)`,便于切默认后判断是否有人回退旧栈。聚合遥测需客户端事件管线(仓库暂无),按计划 §3.2 推迟到具备 sink 时再补。

### Notes

- 本版**不删任何代码**:旧 SVG 视频栈(`VideoStage` 等)及其测试原样保留,仅供回退;切默认与删栈硬性拆两个 release(expand/contract 迁移纪律,见 v0.16.4 计划 §1.1)。

## [0.16.3] - 2026-06-16

画布栈统一 epic 第四步:**视频交互层迁到 Konva(实验 flag 后,默认关)**。在 v0.16.2 的渲染层之上,把画框、移动、缩放(8 向句柄)、平移、选中从 SVG 事件迁到 Konva 事件。命中复用纯函数 `pickTopVideoEntryAt`(同一 z 序 + padding),缩放计算复用 `applyResize`,提交语义复刻旧栈 `finishDrag`——坐标源从 SVG CTM 换成 Konva 像素空间,几何判定不变。新栈仍与旧 SVG 栈经 flag 并行,关 flag 零行为变化。架构见 [ADR-0041](docs/adr/0041-video-canvas-unify-to-konva.md)。计划见 `docs/plans/2026-06-16-v0.16.3-video-interaction-and-test-migration.md`。

### Added

- **视频交互 Konva 层**:`VideoKonvaInteractionLayer`(listening 层:选中框 8 向 resize 句柄 + 画框/移动/缩放实时虚线预览,句柄尺寸/线宽走 `/scale` 屏幕恒定)+ `videoKonvaInteraction`(`useVideoKonvaInteraction` hook + `advanceDrag`/`resolveDragCommit` 纯函数,Konva 事件 → draw/move/resize 状态机,松手按工具/选中态落到建框/关键帧/几何更新)。空白拖→画框、命中框→移动、句柄→缩放、右键/hand 工具→平移、点击空白→取消选中,与旧栈对等。
- **交互纯函数 + konva-mock 测试**:`advanceDrag`/`resolveDragCommit` 单测(画框/移动/缩放推进与提交分支)、`VideoKonvaInteractionLayer` konva-mock 测试(句柄数量/方向回传/像素几何/虚线预览),与既有纯函数测试(`videoStagePicking`/`ResizeHandles`)共同守回归。

### Changed

- **`pickTopVideoEntryAt` 泛型约束放宽**到「带 `geom` 的对象」(命中只读 `.geom`):让 Konva 栈用轻量 `{ id, geom }` 视图复用同一套命中实现,不再造第二份(SVG 栈仍传完整对象,行为零变化)。
- **VideoKonvaStage 接交互**:Stage `pointerdown` 接 `onStagePointerDown`、挂 `VideoKonvaInteractionLayer`、容器 `beginPan` 兼顾 hand 工具左键平移;移除 v0.16.1 占位的「点击 Stage 切播放」(对齐旧栈:画布点击用于画框/选中,播放走热键)。关闭 flag 时视频工作台仍走旧 `VideoStage`(SVG 栈),旧栈与其 RTL 测试不动。

## [0.16.2] - 2026-06-16

画布栈统一 epic 第三步:**视频标注可视层迁到 Konva(实验 flag 后,默认关)**。在 v0.16.1 的底图层之上,把 track 框、轨迹预览线、关键帧圆点、ghost 参考框、pending 草稿、标签、issue 图钉从 SVG/DOM 迁到 Konva 形状,抄图片 `ImageStageShapes` 范式。**本版只渲染、不接交互**(交互在 v0.16.3,Konva 形状 `listening=false`)。视觉设置(线宽/填充/字号/标签显隐+内容)复用 v0.15.27 的 `annotationVisual.ts` 纯函数,与图片同源。新栈仍与旧 SVG 栈经 flag 并行,关 flag 零行为变化。架构见 [ADR-0041](docs/adr/0041-video-canvas-unify-to-konva.md)。计划见 `docs/plans/2026-06-16-v0.16.2-video-annotation-layers-to-konva.md`。

### Added

- **视频标注 Konva 层**:`VideoKonvaTracksLayer`(track 框 + 轨迹预览线 + 选中态关键帧圆点 + ghost)、`VideoKonvaOverlayLayer`(pending 草稿 + Konva Label/Tag/Text 标签)、`VideoKonvaIssueLayer`(issue 图钉,按帧显隐)。线宽/虚线走 `/scale` 屏幕恒定(替代旧 SVG `non-scaling-stroke`),圆点/图钉半径世界单位随画布缩放,填充用类别/轨迹色(经 oklch→hex)+ `annotationVisual` 的 fill alpha;线宽/填充/标签文本全复用同一批共享纯函数,与图片栈同源。
- **标注渲染派生纯函数** `videoFrameViews.ts`:从 `annotations + frameIndex` 派生当前帧应显示的框 / 轨迹预览 / ghost / 标签(关键帧/插值/遮挡判定、复审显示模式过滤、标签门控),栈无关、可单测,供新 Konva 栈消费(与 VideoStage 现状对齐,epic 接受的双 draw 路径中 Konva 那条)。

### Changed

- **VideoKonvaStage 挂载 tracks/overlay/issue 三层**(对齐图片 5 Layer 结构);`colors.ts` 导出 `colorToHex` + 新增 `cssVarToHex`(供 Konva canvas 解析 oklch token / CSS 变量为 hex)。关闭 flag 时视频工作台仍走旧 `VideoStage`(SVG 栈),旧栈不动。

画布栈统一 epic 第二步:**视频底图层迁到 Konva(实验 flag 后,默认关)**。把视频「底图显示 + 视口」从「`<video>` 元素 + CSS transform」迁到 Konva——视频帧进 `Konva.Image`(决策 A1),pan/zoom 走 Konva Stage 原生 transform,坐标改像素空间(决策 B,存储仍归一化、数据零迁移)。**只迁底图与视口,标注/交互尚未迁**(v0.16.2/.3),新栈与旧 SVG 栈经 flag 并行,仅供开发态视觉对照,不作生产默认。架构取舍见 [ADR-0041](docs/adr/0041-video-canvas-unify-to-konva.md)。计划见 `docs/plans/2026-06-16-v0.16.1-video-media-layer-to-konva.md`。

### Added

- **视频 Konva 渲染栈(实验)**:新增 `experiment.videoKonva` 开关(设置面板「实验特性」分组 / URL `?videoKonva=1` / localStorage `video.experimental.konva`,粘性,刷新后生效,默认关)。开启后视频工作台走新栈 `VideoKonvaStage`:`Konva.Image` 以隐藏 `<video>` 为解码源,播放态 `Konva.Animation` 逐帧重绘媒体层、暂停态贴 `useVideoBitmapCache` 精确帧(A1);pan(右键拖)/zoom(ctrl+滚轮 / FloatingDock)/fit(双击)复用 v0.16.0 公共 viewport 原语;播放/逐帧复用与旧栈同一引擎(`useFrameClock` + bitmap 缓存),经转发的 `VideoStageControls` 让工作台热键直接驱动。
- **视频像素空间坐标模型**(决策 B):`videoKonvaCoordinates.ts` 纯函数(归一化↔像素、client↔world,与图片 `toImg()` 同构),废弃旧栈 SVG CTM 路径;存储仍归一化,数据零迁移。

### Changed

- **关闭 flag 时零行为变化**:视频工作台默认仍走旧 `VideoStage`(SVG 栈),新栈完全在 flag 后并行,旧栈代码与测试不动。

画布栈统一 epic 的**硬前置地基版**。本版**不动任何用户可见行为**——只为「把视频工作台从 SVG/DOM 渲染栈迁到 Konva(与图片同栈)」立测试基建、量化帧合成性能、抽公共 stage 原语、定架构决策。架构取舍见 [ADR-0041](docs/adr/0041-video-canvas-unify-to-konva.md)(视频渲染栈统一到 Konva)。Epic 计划见 `docs/plans/2026-06-16-v0.16.x-canvas-unification-epic.md`。

### Added

- **公共 viewport 原语** `stage/shared/viewport/`:把散落在 ImageStage 与 useViewportTransform 各自内联的 fit-to-canvas(`fit.ts`)、围绕光标定点缩放与缩放上下限(`zoom.ts`,`SCALE_RANGE` 单一来源)、scale 抵消(`scaleCancel.ts`,等价 `px/scale`)收口成纯函数 + 单测,供图片现在、视频后续复用,消除「同段数学两份维护、悄悄漂移」的长期税。
- **Konva 测试基建**:`react-konva` mock(`src/test/konvaMock.tsx`,把 Stage/Layer/Rect/… 渲染成带 `data-konva`/`data-testid` 的 DOM stand-in,事件 props 挂 DOM,让组件交互测试沿用 RTL `fireEvent`+`getByTestId` 风格)+ 图片侧样板组件测试(`ImageStageShapes.konva.test.tsx`)+ Playwright 图片画框冒烟与渲染基线(`e2e/tests/workbench-image-konva-smoke.spec.ts`)。三层测试分工(纯函数 / konva mock / Playwright)见 ADR-0041 决策 C。
- **帧合成性能 spike**:隔离 demo(`stage/_spikes/videoKonvaFrameSpike.tsx`,合成 canvas 帧源 + 分层/单层对照 + 全矩阵批处理 + 同步 `draw()` 单帧合成耗时采样)+ 数据表/方法学文档(`docs/plans/_spike-results/2026-06-16-video-konva-frame-perf.md`)。实测(Chromium,24 格矩阵)**决策 A = A1 成立**:单帧合成全程 p95 ≤ 0.40ms(门槛格 1080p@30 分层 0.20ms),比 8ms 闸门快约 20–40×,成本由目标舞台像素绑定、与源分辨率几乎无关。

### Changed

- **ImageStage / useViewportTransform 改用公共 viewport 原语**:`fitNow`/`onWheel`/`fit`/`zoomAt`/`setScale` 与 ImageStageShapes 的 scale 抵消(`screenToWorld`)统一消费抽出的纯函数,图片作为第一个消费者验证等价——行为逐位不变(缩放/平移/fit/滚轮零回归)。
