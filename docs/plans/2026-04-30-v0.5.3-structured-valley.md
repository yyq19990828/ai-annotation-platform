# v0.5.3 — 工作台 UI/工具层重构 + 多边形工具

## Context

ROADMAP 中 C 标注台共有 7 项待办浮在表面（Konva 分层 / Topbar 重设计 / 暗色模式 / 多边形工具 / 属性 schema / 逐框评论 / 离线队列），全部在一个版本完成工时 ≈ 3 周且回归面过大。本期 **v0.5.3 收敛到「工作台 UI 与工具层」4 项**——这 4 项围绕画布与工具栏强耦合、必须一起改才不会 merge 冲突；剩余 3 项「数据模型扩展」（属性 schema + 评论 + 离线队列）解耦到 v0.5.4 单独发布。

驱动本期的两条主线：
1. **多工具时代到来**：`stage/tools/index.ts:16-23` 已声明 `CanvasTool` 接口但未激活，BboxTool 仍内联在 `ImageStage.tsx:283-367` + `WorkbenchShell.tsx:560-715` hotkey useEffect 里；polygon、keypoint、SAM 等后续工具落地必须先把工具层抽出来。
2. **Topbar 单行已挤爆**：当前 `Topbar.tsx:74-178` 一行塞 9+ 控件，1280px 宽度文件名都被挤压，多工具加入前必须重构信息架构。

预期产出：v0.5.3 发布后能看到画布左侧 ToolDock + 右下 FloatingDock + 顶部三段精简 Topbar；工具插件接口激活；BboxTool 与新增 PolygonTool 平等注册；暗色模式可切换；geometry 字段升级为 discriminated union 并通过 migration 兼容存量数据。

---

## 范围（4 大项）

### 1. Konva 分层 hit-detection
当前单 Layer 装一切（`ImageStage.tsx:440`）；目标拆为三层降低 hit-test 开销，并为后续 SAM mask 浮层等留位。

### 2. Topbar 重新设计（ToolDock + FloatingDock + 三段 Topbar）
- 新增**左侧 ToolDock**（垂直工具栏，hotkey + icon）
- 新增**画布右下 FloatingDock**（撤销/重做/缩放/适应悬浮岛）
- 顶 Topbar 精简为「左：标题/索引 · 中：上一/下一/提交 · 右：AI 预标 + 阈值 + 帮助 + 主题切换 + ⋯ 溢出菜单」
- 工具插件接口激活，BboxTool 抽出为正式工具

### 3. 暗色模式
- `tokens.css` 加 `[data-theme="dark"]` 选择器
- `useTheme` hook（light / dark / system）+ localStorage 持久化
- `<html data-theme>` 根属性切换；TopBar 溢出菜单 toggle

### 4. 多边形工具（polygon）
- geometry 字段升级为 discriminated union：`{type:'bbox',x,y,w,h}` / `{type:'polygon',points:[[x,y],...]}`
- alembic migration 一次性补全存量 bbox 行的 `type` 字段
- 新增 `PolygonTool`（hotkey `P`），实现 `CanvasTool` 接口
- 复用 history / clipboard / IoU / minimap / 提交质检流程，扩展 polygon 分支

**显式不在本期**：属性 schema、逐框评论、离线队列、classes 升级为 `{id,name,color,order}[]`。这 4 项由 v0.5.4 统一处理（同一次 Project + Annotation migration）。

---

## 关键设计决策（已与用户对齐）

| 决策 | 选择 | 影响 |
|---|---|---|
| geometry 形状区分 | discriminated union（`geometry.type` 自描述）⭐ | 一次 SQL 给存量行补 type；后续 keypoint/mask/cuboid 加分支即可，类型守卫无歧义 |
| classes 升级时机 | **不在 v0.5.3，移到 v0.5.4 与 attribute_schema 同期** | 多边形渲染用现有 `classColorForCanvas()` hash 推导色已足够；单 migration 同时改 Project 两列降低复杂度 |
| Topbar 工具按钮承载 | 左侧垂直 ToolDock + 顶 Topbar 不再放工具切换 | 多工具横向无限扩展；Topbar 行内 ≤ 8 元素 |
| 撤销/重做/缩放/适应位置 | 画布右下 FloatingDock | 与 Konva viewport 贴合，Topbar 留给主操作 |
| 暗色模式触发 | `[data-theme="dark"]` 根选择器 + `useTheme(light\|dark\|system)` | CSS 变量层即可覆盖，Konva 内层颜色（已用 oklch）不动 |
| `annotation_type` 是否合并到 geometry.type | **保留独立，二者正交** | annotation_type = 业务分类维度（vehicle_part 等），geometry.type = 几何形状；不合并 |

---

## 实现顺序（4 个 Phase）

### Phase 1 · 工具层抽离（基础设施，~1.5 天）

**目标**：激活 `CanvasTool` 接口，把内联在 ImageStage / WorkbenchShell 里的 BboxTool 提取为独立模块；hotkey 分发提纯为可单测的纯函数。**完成此 Phase 后画布行为对用户完全等价**。

修改 / 新增：
- `apps/web/src/pages/Workbench/stage/tools/index.ts` — 激活 `CanvasTool` 接口，导出 `registry`
- `apps/web/src/pages/Workbench/stage/tools/BboxTool.ts` ⭐ 新建，从 `ImageStage.tsx:283-367, 349-367` 抽出 onMouseDown/Move/Up
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx` — 改为按当前 tool 调用对应工具的 lifecycle 方法；剥离 box-only 硬编码
- `apps/web/src/pages/Workbench/state/hotkeys.ts` — 提取 `dispatch(event, ctx) → Action` 纯函数；`HOTKEYS` 表按 group 重组
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:560-715` — 改为调 `dispatch()`，原 useEffect 瘦身

复用：`useAnnotationHistory.ts` 命令模式已用 `AnnotationPayload` 抽象，**无需改动**。

### Phase 2 · UI 重构（~3 天）

**目标**：ToolDock + FloatingDock + 三段 Topbar 落地，多工具横向扩展无障碍。

修改 / 新增：
- `apps/web/src/pages/Workbench/shell/ToolDock.tsx` ⭐ 新建，垂直工具栏，从 `tools/registry` 自动渲染
- `apps/web/src/pages/Workbench/shell/FloatingDock.tsx` ⭐ 新建，画布右下角悬浮，承载撤销/重做/缩放/适应（从 `Topbar.tsx:83-100` 迁出）
- `apps/web/src/pages/Workbench/shell/Topbar.tsx` — 删除工具切换/缩放/撤销区段；保留三段（标题段 / 任务导航段 / AI 主操作段）；右段尾加溢出 ⋯ 收次要按钮（设置 / 视图 / 快捷键 / 主题）
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` — 主 grid 加左侧 ToolDock 列；FloatingDock 锚到画布容器右下
- `apps/web/src/pages/Workbench/shell/HotkeyCheatSheet.tsx` — 与新 hotkey 表同步

验收：Topbar 行内元素 ≤ 8；1280px 单行不换行；ToolDock 注册新工具不影响 Topbar 布局。

### Phase 3 · Konva 分层 + 暗色模式（~1.5 天）

**目标**：Konva 三层拆分；暗色模式可切换。

#### 3a. Konva 分层（`ImageStage.tsx:427-537`）

```
<Stage>
  <Layer name="bg">     ← 图像 + 棋盘格背景
  <Layer name="ai" listening={false}>  ← AI 框（默认不响应 hit-test）
  <Layer name="user">   ← 用户框 + 选中态
  <Layer name="overlay" listening={false}>  ← 预览框 / ghost / drag indicator
```

- AI 框层默认 `listening:false`；当 `selectedAIBoxId` 非空时，把该实例 `listening:true` 让 SelectionOverlay 可工作
- 修改点：`ImageStage.tsx:440-487`（拆 Layer）+ `:445-458`（AI 框 listening 动态切换）

#### 3b. 暗色模式

- `apps/web/src/styles/tokens.css` — 现有变量保持 light，新增 `[data-theme="dark"] { --color-bg-*: ...; }` 块（参照 light 反转 lightness）
- `apps/web/src/hooks/useTheme.ts` ⭐ 新建：`useTheme(): { theme, setTheme, resolved }`，`setTheme('light'|'dark'|'system')`，写 `document.documentElement.dataset.theme` + `localStorage`，监听 `prefers-color-scheme`
- `apps/web/src/main.tsx`（或 App 根） — 启动时读 localStorage 应用初始主题，避免 flash
- Topbar 溢出菜单加 toggle 按钮 (light / dark / system)

不动：Konva 内层 oklch 色（已对暗色背景对比度合理）；棋盘格画布背景。

### Phase 4 · 多边形工具（~3 天）

**目标**：多边形工具完整落地，复用 history / clipboard / IoU / minimap / 提交流程。

#### 4a. 数据模型升级

- `apps/api/alembic/versions/0011_geometry_type_field.py` ⭐ 新建：
  ```sql
  UPDATE annotations
  SET geometry = geometry || '{"type":"bbox"}'::jsonb
  WHERE geometry ? 'x' AND NOT geometry ? 'type';
  ```
  predictions 表同样处理。downgrade 反向移除 type 字段。
- `apps/api/app/schemas/annotation.py` — `geometry: dict` 加 pydantic validator：`type` ∈ {`bbox`, `polygon`}；`bbox` 必有 x/y/w/h；`polygon` 必有 points（≥3）
- `apps/web/src/types/index.ts` — `Annotation.geometry` 改为 discriminated union；新增 `PolygonGeometry`

#### 4b. PolygonTool 实现

- `apps/web/src/pages/Workbench/stage/tools/PolygonTool.ts` ⭐ 新建，实现 `CanvasTool`：
  - 状态：`drawing | idle`，drawing 时维护 `currentPoints: [x,y][]`
  - 交互：左键落点 / 拖动预览下一段 / 双击 / Enter 闭合 / Esc 撤销当前未闭合 / Backspace 删最近一点 / 闭合后顶点拖动 / Alt+点击边新增顶点 / Shift+点击顶点删除
  - 渲染：Konva `Line` + `closed=true` + 半透明填充 + 顶点 hit-circle
  - 校验：自相交检测（segment-intersect 算法）+ 最少 3 点
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx` — Konva user 层条件渲染 polygon vs bbox（按 `geom.type`）
- `apps/web/src/pages/Workbench/shell/ToolDock.tsx` — 注册 `PolygonTool`，hotkey `P`

#### 4c. 周边适配

- `apps/web/src/pages/Workbench/state/useClipboard.ts:41` — 删除硬编码 `annotation_type:"bbox"`，改为读 source.annotation_type；粘贴坐标偏移逻辑按 geom.type 分支（polygon 走 points 整体平移）
- `apps/web/src/pages/Workbench/stage/iou.ts` — 加 `iouPolygon(a, b)` 重载（轻量实现：polygon → bounding bbox 走原 IoU 作为快速近似；TODO 注释精确计算后续接 polygon-clipping）
- `apps/web/src/pages/Workbench/state/useAnnotationHistory.ts` — 命令 payload 已抽象，仅校验 polygon update 命令的 before/after 序列化正确
- Minimap (`ImageStage.tsx:905-915`) — polygon 用 `Line` 缩略
- `WorkbenchShell.tsx` 提交质检 / 批量编辑流程 — 校验 polygon 标注分支不退化

#### 4d. 文档与版本

- `ROADMAP.md` — 划掉已完成的 4 项（Konva 分层 / Topbar 重设计 / 暗色模式 / 多边形）
- `CHANGELOG.md` — 加 v0.5.3 条目
- `apps/web/src/components/Workbench/HotkeyCheatSheet.*` — 加 polygon 工具快捷键说明（P / Enter / Esc / Backspace / Alt-click / Shift-click）

---

## 关键文件清单（按修改密度排序）

**画布与工具层**
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx` ⚠ 重构（拆 Layer + 移除 bbox 内联 + 适配 polygon 渲染）
- `apps/web/src/pages/Workbench/stage/tools/index.ts` ⚠ 激活接口
- `apps/web/src/pages/Workbench/stage/tools/BboxTool.ts` ⭐ 新建
- `apps/web/src/pages/Workbench/stage/tools/PolygonTool.ts` ⭐ 新建
- `apps/web/src/pages/Workbench/stage/iou.ts` 扩展 polygon 分支

**Shell 与 UI**
- `apps/web/src/pages/Workbench/shell/Topbar.tsx` ⚠ 三段重构
- `apps/web/src/pages/Workbench/shell/ToolDock.tsx` ⭐ 新建
- `apps/web/src/pages/Workbench/shell/FloatingDock.tsx` ⭐ 新建
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx` ⚠ 布局 + hotkey 收口
- `apps/web/src/components/Workbench/HotkeyCheatSheet.*` 同步快捷键

**状态与 hook**
- `apps/web/src/pages/Workbench/state/hotkeys.ts` 提纯 dispatch
- `apps/web/src/pages/Workbench/state/useClipboard.ts` 解耦 bbox 硬编码
- `apps/web/src/pages/Workbench/state/useWorkbenchState.ts` `tool` 类型扩展加 `polygon`
- `apps/web/src/hooks/useTheme.ts` ⭐ 新建

**主题**
- `apps/web/src/styles/tokens.css` 加 `[data-theme="dark"]`
- `apps/web/src/main.tsx` 启动应用初始主题

**类型与 API**
- `apps/web/src/types/index.ts` Annotation.geometry 升级
- `apps/web/src/api/annotations.ts` 类型同步
- `apps/web/src/api/tasks.ts` 类型同步

**后端**
- `apps/api/alembic/versions/0011_geometry_type_field.py` ⭐ 新建
- `apps/api/app/schemas/annotation.py` geometry validator

**版本与文档**
- `ROADMAP.md` 划掉已完成项
- `CHANGELOG.md` v0.5.3 条目

---

## 验证（end-to-end）

### 单元测试
- `apps/web/src/pages/Workbench/stage/iou.test.ts` 现有 6 例不退化；新增 `iouPolygon` 4-6 例
- 新增 `apps/web/src/pages/Workbench/state/hotkeys.test.ts` 覆盖 dispatch 主要分支（Ctrl+A/C/V/D / a/d AI 接受 / Tab 循环 / Shift+Tab / N/U / 字母类映射）
- 新增 `apps/web/src/pages/Workbench/stage/tools/PolygonTool.test.ts` 覆盖：闭合 / 自相交拒绝 / 最少 3 点 / 顶点新增删除

### 后端
- `cd apps/api && alembic upgrade head` 在测试库验证 0011 migration 正确补 type 字段
- `alembic downgrade -1` 反向能跑通
- 重新 upgrade 不破坏数据

### 手工 E2E（启动 dev server 后浏览器验证）
1. 旧 bbox 任务打开仍可正常画框 / 撤销重做 / 复制粘贴 / 提交
2. ToolDock 切到 P，画多边形：左键落点 → 双击闭合；闭合后顶点拖动；Alt+点击边加顶点；Shift+点击删顶点
3. 自相交场景拒绝并提示
4. 多边形复制粘贴坐标偏移正确
5. Konva FPS：1000+ 框场景 hit-test 不阻塞（开 Chrome DevTools Performance）
6. Topbar 1280px 单行不换行；窄屏溢出菜单生效
7. 主题切换 light → dark → system，画布与右侧栏所有面板对比度通过 Lighthouse Accessibility ≥ 90
8. 提交质检流程对 polygon 标注不退化（ETag、AI confidence、IoU 去重）

### 回归
- `apps/web/src/pages/Workbench/...` 既有冒烟脚本 / vitest / tsc 全绿
- `apps/api/tests/`（若有）冒烟通过
- ROADMAP 中 v0.5.2 的 6 例 IoU 测试不变

---

## 风险与回滚

| 风险 | 概率 | 缓解 |
|---|---|---|
| 0011 migration 在大表上慢 | 低 | UPDATE 仅命中存量 bbox 行；建议 production 离峰执行；downgrade 路径明确 |
| Konva 分层后 hit-test 行为微变（AI 单选） | 中 | Phase 3a 单独 PR；先在 dev 跑 1 天观察 |
| Topbar 重构破坏 muscle memory | 中 | hotkey 完全保持向后兼容；ToolDock 默认展开；CHANGELOG 高亮新位置 |
| polygon 自相交校验误判（边界情况） | 中 | 先实现宽松版本（segment-intersect），单测覆盖凹多边形等典型形状 |
| iouPolygon 用 bbox 近似不精确 | 低 | TODO 注释；当前 IoU 仅作 AI vs AI 视觉去重，user-drawn polygon 互相重叠目前不去重 |

回滚：每个 Phase 一个独立 PR，可单独 revert；migration 0011 有完整 downgrade。
