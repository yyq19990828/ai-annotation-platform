# 视频工作台 · 选中轨迹信息栏重构

> 规范命名建议:落地时把本文件重命名为 `2026-06-18-video-track-selection-card.md`(CLAUDE.md §7)。

## Context(为什么做)

引入"画布内悬浮信息卡"(`SelectedAnnotationCard`)后,图片端 / 视频单帧框已各自有了**聚焦单个对象**的卡片内容(`ImageSelectionCardContent` / `VideoFrameBoxCardContent`),用统一的五积木设计系统(`IdentityHeader` / `MetricGrid` / `AttributeForm` / `MetaFooter` / `ActionBar`)。

但视频**轨迹(track)**还是个例外:选中一条轨迹时,卡片直接把**整个右栏轨迹面板**搬进来(`useWorkbenchShellModel.tsx:1707-1709` 的 `renderVideoTrackSidebar("current")`),于是:

1. 卡里仍然带着**全部轨迹列表 + 多选批量工具**,跟"选中单条轨迹"的语义不符——还在整合多个轨迹。
2. 跟"标注详情弹窗"区别不大,没有形成专属的信息栏布局。
3. 操作(拆/传播/标记/复制粘贴/关键帧增删)和清单混在同一面板,右栏臃肿。
4. 关键帧跳转有**两套**入口:卡内关键帧表 + 画布右上角的 `<details>` 快跳浮层(`VideoKonvaStage.tsx:692-733`),冗余。

**目标产出**:让视频轨迹也拥有一张"聚焦单条轨迹"的信息卡,参考单帧卡的设计系统,承载**轨迹整体信息 + 当前帧信息**两层语义 + 整合后的关键帧导航;右栏退化为纯轨迹清单;退役老的快跳浮层。

## 已定决策(用户确认)

- **右栏 = 纯轨迹清单(roster)**:列出所有轨迹 + 行内显隐/锁/改类 + 多选批量(改类/合并/跳连/删除)。单条轨迹的详情/操作/关键帧/**属性**全部进选中卡。
- **属性进选中卡**:轨迹级 + 关键帧级 attributes(现 `VideoAttributesEditor`)随卡走,对齐单帧卡的内联属性。
- **老快跳浮层完全退役**:删除 `VideoKonvaStage.tsx:692-733` 的 `<details>` 浮层及整条 `hideKeyframeQuickJump` 透传链。

## 目标架构:职责拆分

| 区域 | 现状 | 重构后 |
|---|---|---|
| 右栏(`VideoTrackPanel`) | 轨迹清单 **+ 选中轨迹详情 + 操作 + 关键帧 + 属性 + 对话框** | **仅轨迹清单 roster**:过滤卡 + 轨迹行 + 多选批量工具栏 + `VideoTrackComposeDialog`(跳连) |
| 选中卡(视频轨迹) | 整块搬入 `VideoTrackSidebar`(含全部清单) | 新组件 `VideoTrackCardContent`:单轨迹两层语义 + 关键帧表 + 属性 + `VideoKeyframesPropagateDialog`(复制后续) |
| 画布右上快跳浮层 | `<details>` 关键帧快跳 | **删除**,由卡内关键帧表 + 上/下关键帧按钮取代 |

`VideoTrackSidebar` 继续作为**唯一**的状态/派生/动作编排容器(`selectedTrack`、`ghost`、`useVideoTrackActions`、`copiedKeyframe` 等都在它),新增 `view: "roster" | "card"` 入参,据此渲染 `VideoTrackPanel`(roster)或 `VideoTrackCardContent`(card),两者共享同一份派生状态,**不重复重逻辑**。

## 选中卡布局(`VideoTrackCardContent`)

参照 `VideoFrameBoxCardContent` 的 `cardLayout.module.css` body + sticky `ActionBar`,自上而下:

```
┌ body(可滚动) ──────────────────────────────┐
│ IdentityHeader  轨迹类别 + 源徽章(AI采纳/手动)  │  复用,trailing 注入 #轨迹号·短ID chip
│                                              │
│ ── 轨迹整体 ──                               │  小节标题(.heading)
│   MetricGrid  关键帧数 / 范围 F.-F. / 语义标签 / 源 │  复用 MetricGrid(自定义 Metric[])
│   语义标签 input(semantic_label,可编辑)       │  复用现 semanticRow 逻辑
│   tracker job badge(若有)                    │  复用 VideoTrackerJobBadge
│   轨迹属性(VideoAttributesEditor 的 track 段)  │
│                                              │
│ ── 当前帧 ──(参考单帧卡)                      │  小节标题
│   帧定位 chip  F{n} · 关键帧/非关键帧/消失/遮挡   │
│   MetricGrid  当前帧框几何(resolveTrackAtFrame→geometryMetrics) │  复用
│   关键帧属性(VideoAttributesEditor 的 keyframe 段) │
│                                              │
│ ── 关键帧(整合老快跳)──                       │  小节标题 + 计数
│   ◀上一关键帧  下一关键帧▶                     │  新增,用 prev/nextKeyframeFrame
│   关键帧表  F{n}|状态|跳转/接受/拒绝/复制/拆/删除  │  从 VideoTrackPanel 选中段平移
│                                              │
│ MetaFooter  轨迹 id/源/创建·更新时间           │  复用
├ ActionBar(sticky 贴底)─────────────────────┤
│ 当前帧:复制到当前帧 / 复制 / 粘贴 / 标记消失 / 标记遮挡 │
│ 轨迹:拆轨迹 / AI传播 / 复制后续 / 转换菜单       │
└──────────────────────────────────────────────┘
```

> 操作较多,`ActionBar` 用 `flex-wrap` 分两组(当前帧 / 轨迹),必要时把次要操作收进现有 `<details>` 模式,避免一排塞满。`VideoAttributesEditor` 暂整体复用(内部已分 track/keyframe 两段),不重写;放在"当前帧"小节内或拆到两层,落地时按视觉效果定。

## 实施步骤

### 阶段 1 · 瘦身 `VideoTrackPanel` 为 roster
- 删掉选中详情段(`VideoTrackPanel.tsx:583-972`)及其专属派生/本地 state(`propagateOpen`、`semanticDraft`、`attrCollapsed`、`VideoKeyframesPropagateDialog`)。这些迁到卡组件。
- 保留:过滤卡 + 轨迹行列表(437-580)+ 多选批量工具栏 + `VideoTrackComposeDialog`(join 属批量,留 roster)。
- 清理因删段产生的孤儿 import / helper(如 `keyframeStatus`、`sortedKeyframes` 等若仅详情段用)。

### 阶段 2 · 新建 `VideoTrackCardContent`
- 路径:`apps/web/src/pages/Workbench/shell/selectionCard/VideoTrackCardContent.tsx`(+ 同名 `.module.css` 放小节/帧chip专属样式,布局复用 `cardLayout.module.css`)。
- Props 取 `VideoTrackSidebar` 已有的派生 + 回调子集(`selectedTrack`、`selectedTrackGhost`、`selectedTrackLocked`、`currentFrameOutside`、`frameIndex`、`attributeSchema`、各 `on*` handler、`copiedKeyframeLabel`、`canCopy/PasteKeyframe`、`trackColorOverrides`、`trackerJob` 等),基本等于现 `VideoTrackPanel` 选中段所需的那批 prop。
- 复用积木:`IdentityHeader` / `MetricGrid` / `MetaFooter` / `ActionBar`(均在 `selectionCard/`),`VideoAttributesEditor` / `VideoTrackerJobBadge`(在 `stage/`),`VideoKeyframesPropagateDialog`(复制后续对话框 + `propagateOpen` state 随迁)。
- 复用助手:`resolveTrackAtFrame`(`videoStageGeometry.ts:142`)+ `geometryMetrics`(`selectionCard/geometryMetrics.ts:211`)算当前帧指标;`prevKeyframeFrame`/`nextKeyframeFrame`(`videoTrackTimeline.ts`)做上/下关键帧按钮;`frameRange`/`exactFrameLabel`/`sourceChipText` 等从 `VideoTrackPanel` 抽成共享小工具(或就近复制)。

### 阶段 3 · 接线 view 分支
- `VideoTrackSidebar` 增 `view?: "roster" | "card"`(默认 `"roster"`),据此渲染 `VideoTrackPanel` 或 `VideoTrackCardContent`。
- `useWorkbenchShellModel.tsx`:
  - `renderVideoTrackSidebar` 增 `view` 参数。
  - 右栏入口(`videoTrackPanel`,约 2182 行)→ `renderVideoTrackSidebar(frameFilter, "roster")`。
  - 选中卡视频轨迹分支(1704-1710)→ 直接 `renderVideoTrackSidebar("current", "card")`(去掉 `videoSelectionCardBody` 包裹,卡 body 由组件自带)。

### 阶段 4 · 退役老快跳浮层
- 删 `VideoKonvaStage.tsx:692-733` 的 `keyframeQuickJump` `<details>` 及相关样式类、`hideKeyframeQuickJump` prop。
- 顺链删 prop 透传:`VideoWorkbench.tsx:63-64,105,155`、`WorkbenchStageHost.tsx:121,292,428`、`useWorkbenchShellModel.tsx:2048-2051`。
- 清理 `VideoKonvaStage` 中仅服务该浮层的派生(`selectedTrackKeyframes`、`quickKeyframeStatus` 等,确认无他用再删)。

### 阶段 5 · 测试 / token / 文档
- 单测:新增 `VideoTrackCardContent.test.tsx`(渲染两层信息、关键帧表操作、上/下关键帧、属性回写);更新/精简 `VideoTrackSidebar.test.tsx`、`VideoTrackPanel` 相关测试(roster 不再含选中详情)。
- 新 CSS 严守 CLAUDE.md §6:只用 `tokens.css` 已有 `--color-*`、无 fallback、无硬编码色(沿用 `VideoFrameBoxCardContent.module.css` 写法)。跑 `pnpm lint:css-tokens`。
- 文档:`docs-site/user-guide/` 视频工作台章节若描述了"右栏轨迹操作 / 关键帧快跳浮层",同步改为"画布内选中卡承载",按 §9 写当前态、不留版本号。

## 待改文件清单

- `apps/web/src/pages/Workbench/stage/VideoTrackPanel.tsx` — 瘦身为 roster(删 583-972)
- `apps/web/src/pages/Workbench/shell/selectionCard/VideoTrackCardContent.tsx` — **新建** + `.module.css`
- `apps/web/src/pages/Workbench/stage/VideoTrackSidebar.tsx` — 增 `view` 分支渲染
- `apps/web/src/pages/Workbench/state/useWorkbenchShellModel.tsx` — `renderVideoTrackSidebar(view)` + 两处入口接线 + 删 `hideKeyframeQuickJump`
- `apps/web/src/pages/Workbench/stage/VideoKonvaStage.tsx` — 删快跳浮层 + prop
- `apps/web/src/pages/Workbench/stages/video/VideoWorkbench.tsx`、`shell/WorkbenchStageHost.tsx` — 删 `hideKeyframeQuickJump` 透传
- 对应 `*.test.tsx` + 视频章节 user-guide

## 复用清单(避免重造)

- 五积木:`selectionCard/{IdentityHeader,MetricGrid,MetaFooter,ActionBar}.tsx` + `cardLayout.module.css`
- 单帧卡范本:`selectionCard/VideoFrameBoxCardContent.tsx`(整张卡结构照搬)
- 几何指标:`geometryMetrics()`(`selectionCard/geometryMetrics.ts:211`)+ `resolveTrackAtFrame()`(`videoStageGeometry.ts:142`)
- 关键帧导航:`prevKeyframeFrame`/`nextKeyframeFrame`/`firstAppearFrame`(`videoTrackTimeline.ts`)
- 属性 / 任务徽章:`VideoAttributesEditor`、`VideoTrackerJobBadge`、`VideoKeyframesPropagateDialog`(均现成)
- 状态/动作:`VideoTrackSidebar` 内 `useVideoTrackActions` + 全部派生,**不动**

## 验证(端到端)

1. `pnpm --filter web test` 跑新增/受影响单测。
2. `pnpm lint`(含 `check-css-tokens.mjs`)零违规。
3. 起 dev 栈,用 Chrome MCP 在视频工作台(seed `P-VIDEO-DEV`,见记忆 `project_video_seed`)实测:
   - 选中一条轨迹 → 画布内卡只显示该轨迹两层信息,**右栏只剩清单**、无选中详情。
   - 卡内:轨迹整体指标 / 当前帧指标随 seek 更新;上/下关键帧按钮跳转正确;关键帧表接受/拒绝/删除生效;属性(轨迹级 + 关键帧级)回写。
   - 当前帧操作(标记消失/遮挡、复制粘贴关键帧、复制后续对话框)与重构前等效。
   - 画布右上**不再出现**老快跳 `<details>` 浮层(任何选中/折叠态)。
   - 多选多条轨迹 → 批量工具仍在右栏可用。
4. 暗色模式扫一遍卡片配色(历史 B-32/36/38/39 类回归)。

> 主进程合并 worktree 分支后再跑前端检查/实测——worktree 无 `node_modules`(记忆 `feedback_worktree_frontend_checks`)。
