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
