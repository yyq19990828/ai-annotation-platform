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

## [0.16.0] - 2026-06-16

画布栈统一 epic 的**硬前置地基版**。本版**不动任何用户可见行为**——只为「把视频工作台从 SVG/DOM 渲染栈迁到 Konva(与图片同栈)」立测试基建、量化帧合成性能、抽公共 stage 原语、定架构决策。架构取舍见 [ADR-0041](docs/adr/0041-video-canvas-unify-to-konva.md)(视频渲染栈统一到 Konva)。Epic 计划见 `docs/plans/2026-06-16-v0.16.x-canvas-unification-epic.md`。

### Added

- **公共 viewport 原语** `stage/shared/viewport/`:把散落在 ImageStage 与 useViewportTransform 各自内联的 fit-to-canvas(`fit.ts`)、围绕光标定点缩放与缩放上下限(`zoom.ts`,`SCALE_RANGE` 单一来源)、scale 抵消(`scaleCancel.ts`,等价 `px/scale`)收口成纯函数 + 单测,供图片现在、视频后续复用,消除「同段数学两份维护、悄悄漂移」的长期税。
- **Konva 测试基建**:`react-konva` mock(`src/test/konvaMock.tsx`,把 Stage/Layer/Rect/… 渲染成带 `data-konva`/`data-testid` 的 DOM stand-in,事件 props 挂 DOM,让组件交互测试沿用 RTL `fireEvent`+`getByTestId` 风格)+ 图片侧样板组件测试(`ImageStageShapes.konva.test.tsx`)+ Playwright 图片画框冒烟与渲染基线(`e2e/tests/workbench-image-konva-smoke.spec.ts`)。三层测试分工(纯函数 / konva mock / Playwright)见 ADR-0041 决策 C。
- **帧合成性能 spike**:隔离 demo(`stage/_spikes/videoKonvaFrameSpike.tsx`,合成 canvas 帧源 + 分层/单层对照 + 全矩阵批处理 + 同步 `draw()` 单帧合成耗时采样)+ 数据表/方法学文档(`docs/plans/_spike-results/2026-06-16-video-konva-frame-perf.md`)。实测(Chromium,24 格矩阵)**决策 A = A1 成立**:单帧合成全程 p95 ≤ 0.40ms(门槛格 1080p@30 分层 0.20ms),比 8ms 闸门快约 20–40×,成本由目标舞台像素绑定、与源分辨率几乎无关。

### Changed

- **ImageStage / useViewportTransform 改用公共 viewport 原语**:`fitNow`/`onWheel`/`fit`/`zoomAt`/`setScale` 与 ImageStageShapes 的 scale 抵消(`screenToWorld`)统一消费抽出的纯函数,图片作为第一个消费者验证等价——行为逐位不变(缩放/平移/fit/滚轮零回归)。
