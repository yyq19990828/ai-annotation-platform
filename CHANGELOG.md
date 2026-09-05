# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件                                                   |
| ------ | ------------------------------------------------------ |
| 0.24.x | [docs/changelogs/0.24.x.md](docs/changelogs/0.24.x.md) |
| 0.23.x | [docs/changelogs/0.23.x.md](docs/changelogs/0.23.x.md) |
| 0.22.x | [docs/changelogs/0.22.x.md](docs/changelogs/0.22.x.md) |
| 0.21.x | [docs/changelogs/0.21.x.md](docs/changelogs/0.21.x.md) |
| 0.20.x | [docs/changelogs/0.20.x.md](docs/changelogs/0.20.x.md) |
| 0.19.x | [docs/changelogs/0.19.x.md](docs/changelogs/0.19.x.md) |
| 0.18.x | [docs/changelogs/0.18.x.md](docs/changelogs/0.18.x.md) |
| 0.17.x | [docs/changelogs/0.17.x.md](docs/changelogs/0.17.x.md) |
| 0.16.x | [docs/changelogs/0.16.x.md](docs/changelogs/0.16.x.md) |
| 0.15.x | [docs/changelogs/0.15.x.md](docs/changelogs/0.15.x.md) |
| 0.14.x | [docs/changelogs/0.14.x.md](docs/changelogs/0.14.x.md) |
| 0.13.x | [docs/changelogs/0.13.x.md](docs/changelogs/0.13.x.md) |
| 0.12.x | [docs/changelogs/0.12.x.md](docs/changelogs/0.12.x.md) |
| 0.11.x | [docs/changelogs/0.11.x.md](docs/changelogs/0.11.x.md) |
| 0.10.x | [docs/changelogs/0.10.x.md](docs/changelogs/0.10.x.md) |
| 0.9.x  | [docs/changelogs/0.9.x.md](docs/changelogs/0.9.x.md)   |
| 0.8.x  | [docs/changelogs/0.8.x.md](docs/changelogs/0.8.x.md)   |
| 0.7.x  | [docs/changelogs/0.7.x.md](docs/changelogs/0.7.x.md)   |
| 0.6.x  | [docs/changelogs/0.6.x.md](docs/changelogs/0.6.x.md)   |
| 0.5.x  | [docs/changelogs/0.5.x.md](docs/changelogs/0.5.x.md)   |
| 0.4.x  | [docs/changelogs/0.4.x.md](docs/changelogs/0.4.x.md)   |
| 0.3.x  | [docs/changelogs/0.3.x.md](docs/changelogs/0.3.x.md)   |
| 0.2.x  | [docs/changelogs/0.2.x.md](docs/changelogs/0.2.x.md)   |
| 0.1.x  | [docs/changelogs/0.1.x.md](docs/changelogs/0.1.x.md)   |

---

## [Unreleased]

### Added

- 新增 Orca 工作树初始化 hook，共享 `.env` 和依赖一致时的 pnpm 目录，并独立准备 Python 环境与 API 类型，减少重复安装并避免跨分支源码混用。

- 3D 三视图精修加入自由布局，三张视图整体停靠、组成标签、浮动或隐藏；相机可在原有逐路悬浮和整组停靠图库之间切换，悬浮位置与折叠态、停靠位置分别记忆。
- 工作台辅助面板标题栏常驻 ×，可直接隐藏当前活动面板，从“布局”菜单找回并保留业务状态。

### Changed

- 工作台新建停靠列默认使用工作区宽度的 15%；顶部左右按钮按画布两侧的实际位置收起、展开面板，保留分栏尺寸与标签顺序，并记住收起状态。
- 3D 视角控件收为单行工具栏，框体精修、传感器融合、点级分割与恢复相机排列移到顶部“布局”菜单；切换工作方式保留主画布与其他面板位置。

### Fixed

- 修复从主分支创建 Orca 工作树时，Python 3.12 在 Apple Silicon 上编译旧版 Matplotlib 失败、初始化中断的问题；测试依赖改用兼容版本及预编译包。

- 修复工作台面板停靠、合并标签、拖放、浮动、隐藏或恢复时，侧栏被自动拉宽、画布被挤窄的问题；两列拖成上下排列时保留目标列宽，窗口从紧凑布局恢复时也会保留原有侧栏尺寸。
- 修复画布最大化或切换专注布局后，恢复时侧栏缩窄的问题；保存、重新加载及紧凑布局切换都会保留最大化前的侧栏尺寸。
- 修复面板分成上下布局、移动画布或恢复最大化后，分隔条被临时尺寸约束锁住，无法调整列宽和上下占比的问题。

## [0.25.2] - 2026-09-05

### Added

- 当前题 AI 与视频追踪加入工作台停靠布局，可停靠、成组、浮动、隐藏和恢复，并提供图片 AI 审阅、视频追踪预设；隐藏或切换布局不会取消运行或清空草稿。

## [0.25.1] - 2026-09-05

### Added

- 工作台画布可从“布局”菜单移到整个工作区的左、右、上、下边缘，并可最大化或恢复；换位会保留当前 Stage、媒体状态和编辑草稿。

### Fixed

- 点云性能基准从实际导航开始统计渲染耗时，并提前准备 WebGPU 三视图管线，避免交互防抖和首次管线编译误判为持续渲染回退。

## [0.25.0] - 2026-09-05

### Added

- 工作台新增“布局”菜单，任务队列、类别面板、标注详情和讨论可停靠、组成标签、浮动或隐藏，并提供标准标注、专注画布、审核协作预设与一次布局撤销。
- 工作台布局按账号及标注或审核、图片或视频或点云分别保存；窄窗口临时显示单个面板，放宽窗口后恢复桌面布局。

### Changed

- 工作台布局读取完成前暂时锁定布局操作；损坏布局可显式重置，来自新版的布局保持只读，避免旧客户端覆盖已保存的位置。

### Fixed

- 视频导出包的抽帧脚本兼容 FFmpeg 9，修复旧参数导致抽帧失败的问题。
- 录制夹具初始化补齐 nuScenes 地图文件，并按数据集隔离路径解析点云资源，修复全新开发库恢复时地图缺失和任务校验失败。
- 3D 点云工作台的选中信息栏会与桌宠共享位置并一起拖动，不再作为独立浮层停在画布右上角。
- KITTI 点云导出会在相机成员或标定变化后失效旧缓存，并按人工相机框的可见性写入遮挡级别，不再复用过期包或误读 3D 属性。
- 点云质量问题按状态筛选时会先刷新过期状态再分页，首屏不会因已失效问题占位而漏掉仍有效的问题。
- AAP JSON 标注导入的 dry-run 会校验相机角色、主 3D 轨迹关系与重复相机成员，预检结果现在与正式导入一致。
- 超限大图现在会同时禁用 Mask 按钮和 `M` 快捷键，并显示同一条尺寸上限原因。
- 批量预标现在按实际归一化后会持久化的重试上下文执行 8 KiB 限制，不再因大量空参数误报 422。

<!--
日常变更（含普通 bug 修复）按 Keep a Changelog 类型分组追加到本段：
Added / Changed / Deprecated / Removed / Fixed / Security（按此顺序，空组省略）。
发版时把「## [Unreleased]」重命名为「## [x.y.z] - 日期」，再在其上方留一个空的
「## [Unreleased]」。0.25.x 版本段累积在本区；进入 0.26.x 后整体移到 docs/changelogs/0.25.x.md。
-->
