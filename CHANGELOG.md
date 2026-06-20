# Changelog

本文件记录 AI 标注平台的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

历史版本详情见 [`docs/changelogs/`](docs/changelogs/)：

| 版本组 | 文件 |
|--------|------|
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

<!-- 0.17.x 版本变更按版本段追加到本区；进入 0.18.x 后整体移到 docs/changelogs/0.17.x.md -->

> **0.17.x 是一个 UI 迁移 Epic**:把 `apps/web` 自维护的 CSS Modules + `tokens.css` 视觉体系全量迁到 Tailwind v4 + shadcn/ui,直至旧 `*.module.css` 与 `tokens.css` 退役、CI 门禁完成时代切换。全程红线为「只换皮、行为零回退」(业务逻辑 / 数据流 / 路由 / 画布渲染逻辑均不动),逐阶段以 light/dark 双主题截图基线把关。Epic 与设计规范见 [`docs/plans/2026-06-19-v0.17.x-ui-shadcn-migration-epic.md`](docs/plans/2026-06-19-v0.17.x-ui-shadcn-migration-epic.md) 与 `docs-site/dev/reference/design-system.md`。

## [0.17.8] - 2026-06-20

设计系统第二阶段启动:把散落在组件 `className` 中的状态文字色与软底收敛到 `shadcn.css` 的语义工具类,减少暗色主题配对的人工维护。

### Changed

- **状态色语义化**:新增 `text-status-danger/caution/positive/info/info-alt` 与 `bg-status-*-soft`,等价替换 rose / amber / emerald / violet / sky 的状态文字和 `/10` 软底。
- **状态色门禁提示**:`check-tw-tokens.mjs` 对新增裸 `text-<hue>-600` / `bg-<hue>-500/10` 状态类输出 warning,提示改用语义工具类。

## [0.17.7] - 2026-06-19

shadcn 迁移 Epic 收官:旧 `tokens.css` 彻底退役,暗色统一由 `shadcn.css` 的 `--sc-*` + `data-theme` 单点驱动;Tailwind preflight 从 `.tw-scope` 局部 reset 转为全局;CSS Modules 时代门禁退役、Tailwind 时代门禁转硬阻断。

### Removed

- **删除 `tokens.css`**(全仓零消费者):含底部兼容别名段;`main.tsx` 移除其 import。
- **移除 `.tw-scope` 局部 reset**:全仓 45 处 className 去掉 `tw-scope`,preflight 转全局后不再需要局部隔离。
- **旧门禁 `check-css-tokens.mjs` 退役**:`*.module.css` 收敛后无可扫,从 `pnpm lint` 摘除。

### Changed

- **preflight 转全局**:`shadcn.css` 改回 `@import "tailwindcss"`(含 preflight)。
- **新门禁 `check-tw-tokens.mjs` 转 blocking**:修复 `!` / `hover:` 等前缀的匹配盲区后并入 `pnpm lint`,作为 Tailwind 时代的硬门禁(禁裸色 / 任意色值、暗色 token 化)。

### Notes

- 全仓仅剩 **60 个 `*.module.css`**:10 个 Konva 画布叠加层(白名单 + 注释)+ 50 个未纳入本 Epic 范围的组件 / 页面。typecheck 干净、lint 0 发现、全量 1607 测试绿。

## [0.17.6] - 2026-06-19

工作台迁移(Epic 阶段 6,最大一阶段:65 个 module.css / 8536 行)。按「DOM 面板」与「真 Konva 叠加层」分桶:前者全迁 Tailwind 并删 CSS,后者保留 CSS 但切断对 `tokens.css` 的依赖。

### Changed

- **桶 A · 55 个 DOM 面板全迁 Tailwind**:`shell`(31)+ `selectionCard`(8)+ 挂在 `stage/` 下的对话框 / 侧栏 / 工具栏(`VideoTrackPanel` / `VideoChapterSidebar` / `VideoAttributesEditor` / `CanvasToolbar` / `BoxListItem` / 各 `*Dialog` / 3D `ThreeDWorkbench` + `FramePicker` 等),引用的通用语义 token 1:1 映射 `--sc-*`,删除对应 `.module.css`。
- **桶 B · 10 个 Konva 画布叠加层改指 `--sc-*`**:像素定位 / z-index 编排的叠加层(`ImageStage` / `BoxRenderer` / `SelectionOverlay` / `VideoKonvaStage` / `VideoPlaybackOverlay` 等)保留为 CSS,但把内部 `var(--color-*)` 全部改指 `var(--sc-*)`,登记门禁白名单 + 注释。
- **画布棋盘格变量内迁**:画布专属的 `--color-canvas-checker-a/b` 折进 `shadcn.css` 为 `--sc-canvas-checker-a/b`(不另建 `canvas.css`)。

### Notes

- 退役 55 个 module.css(工作台对 `tokens.css` 的依赖彻底切断);亮 / 暗双主题对图像 / 视频 / 3D 工作台肉眼回归,画布渲染无回归。

## [0.17.5] - 2026-06-19

外壳 + 审核迁移(Epic 阶段 5):全站最显眼的 chrome 换新,完成度跃升。

### Changed

- **`components/shell`(6 件)**:Sidebar / TopBar / SidebarDrawer / JobsBell / NotificationsPopover / PreannotateJobsBadge。侧栏微沉 `bg-muted` + 激活项白底浮起(中性 elevated);顶栏品牌渐变 `from-brand to-violet-500`、workspace 点 emerald;SidebarDrawer portal 挂 `tw-scope`。
- **`pages/Review`(5 件,非画布部分)**:ReviewPage / ReviewSidebar / ReviewWorkbench(仅 chrome,画布零改)/ ReviewerMiniPanel / RejectReasonModal。
- **门禁收口**:进度条任意色 → 固定类、hover rose 单值、SKIP 徽标改柔底。

### Notes

- 退役 11 个 module.css;亮 / 暗双主题肉眼回归通过。

## [0.17.4] - 2026-06-19

数据密集页迁移(Epic 阶段 4):六区 40+ 个 module.css 退役。

### Changed

- **迁移范围**:`pages/ModelMarket`(10 + capability 4 子件)、`pages/Projects`(26,含 DataManager / Settings / sections + RenderingConfigEditor)、`pages/Datasets`、`pages/Settings`、`pages/Storage`、`pages/Users`。
- **破坏性操作按钮统一**:收敛到 `Button variant="danger"`(描边软底 rose),弃旧实心红底白字,跟随 v0.17.1 既定 variant 体系。
- 删共享 `CapabilityCatalogPanel.module.css`(← capability 4 件)、`RenderingConfigSection.module.css`(← RenderingConfigEditor)。

### Notes

- 退役 42 个 module.css;worktree 子 agent 按波次并行迁移;亮 / 暗双主题肉眼回归通过。

## [0.17.3] - 2026-06-19

页面 wave 1(Epic 阶段 3):低风险、高可见的「门面」先行 —— Login + Dashboard 家族 + Admin。

### Changed

- **`pages/Login`(3)**:Login / Forgot / Reset(+ VerifyEmail 随 Reset 同迁)。
- **`pages/Dashboard`(9)**:`DashboardPage` 原地重写为 Geist 范式并保留全部重交互(向导 / 权限 / FilterDrawer / grid-list / 批次链接);迁 AdminDashboard / Annotator / Reviewer / Viewer / ProjectGrid / MyBatchesCard / ExportModal / FilterDrawer。
- **`pages/Admin`(3)**:People / Analytics / SystemHealth。

### Removed

- 退役实验性 `DashboardPageNext` 与 `/dashboard-next` 路由(其范式已固化进正式 `DashboardPage`)。

### Notes

- 退役 15 个 module.css;`Modal` Content 挂 `tw-scope` 让弹窗内表单获 box-sizing reset。

## [0.17.2] - 2026-06-19

原语替换 wave 2(Epic 阶段 2):交互原语委托 shadcn / Radix,`components/ui/` 全部 16 个 module.css 退役。

### Changed

- **`Modal` → Radix `Dialog`**(全屏 / 抽屉用 `sheet`);**`Toast` → `sonner`**(保留 `useToastStore` 薄适配,内部转 `toast()`,**调用点不改**)。
- **`Switch` / `TabRow` / `SearchInput` / `Avatar` / `DropdownMenu` / `ContextMenu` / `Tooltip`** 委托对应 shadcn 组件;键盘 / 焦点 / a11y 走 Radix。
- 7 个可视化组件 module.css → Tailwind;修 `TabRow` 语义。

### Notes

- 退役 16 个 module.css(`components/ui/` CSS 全退役);`ui/` 物理删目录 + 全站 import repoint 推迟到 v0.17.7 统一收口(适配器无 CSS 债,留作 shadcn 薄适配层)。

## [0.17.1] - 2026-06-19

原语替换 wave 1(Epic 阶段 1):最高杠杆、最机械的基础原语适配 shadcn / lucide。

### Changed

- **`Icon`(139 引用)→ `lucide-react`** 具名图标(`IconName → Lucide` 映射 + codemod 批量替换)。
- **`Button`(105)/ `Badge`(55)/ `Card`(36)** API 对齐后 codemod 改 import + 必要 props 重命名;旧 `ui/*` 暂留作适配器(引用归零后于 v0.17.7 删除)。

### Fixed

- 适配过程中的 UA 默认样式漏样修复(`appearance` / `font-family: inherit` 等)。

### Notes

- 退役 4 个 module.css。

## [0.17.0] - 2026-06-19

地基(Epic 阶段 0):接入 Tailwind v4 + shadcn/ui,与既有 CSS Modules 共存,为后续逐页迁移立范式与门禁。本版不改任何用户可见行为。

### Added

- **Tailwind v4 + `@tailwindcss/vite` 接入**:与 CSS Modules 共存(跳过全局 preflight,`.tw-scope` 局部 reset);`shadcn.css` 落地 Geist + 彩色点缀 token,`dark` variant 重定向到 `[data-theme="dark"]`;`components.json` + `lib/utils.ts(cn)`。
- **补齐 shadcn 原语全集**:`dialog / sheet / dropdown-menu / context-menu / tooltip / switch / select / checkbox / popover / label / textarea / scroll-area / alert-dialog`(纯 `radix-ui`,无新依赖)+ `sonner`(新增依赖,Toaster 适配本项目 `useTheme().resolved` / `--sc-*`),`components/shadcn/ui/` 共 25 个原语。
- **新门禁 `check-tw-tokens.mjs`(warning 模式)**:扫 `*.tsx` 的 `className`(裸色 / Tailwind 任意色值 / 语义色暗色配对),并入 `pnpm lint`,先 `::warning::` 观测不阻断(v0.17.7 转 blocking)。
- **设计规范文档** + **`/dashboard-next` 垂直切片**(`DashboardPageNext.tsx`,参考实现 + 验收基线,于 v0.17.3 退役)。
