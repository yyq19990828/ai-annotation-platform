# v0.5.4 — Polygon 编辑 / 属性 Schema / 评论 / 离线队列 / Classes 升级

## Context

v0.5.3 落地了 polygon MVP（创建 / 渲染 / 删除 / 改类 / 撤销重做）和工作台 UI 三段式重构，但显式留了 5 块到 v0.5.4：① polygon 顶点编辑 + 自相交校验 + 精确 IoU；② 项目级可配置属性 schema（标注从「单标签」升级为「结构化数据」，ROADMAP P1）；③ 逐框评论（reviewer 退回时直接在框上批注）；④ 自动保存 / 离线队列（网抖期间不丢操作）；⑤ classes 升级（结构化 + 颜色 + 拖排）。

业务驱动：所有真实项目都卡在「属性维度缺失」（车辆要标车型 / 朝向 / 遮挡，商品要标品牌 / SKU），polygon 编辑能力缺失则不规则物体只能画完一次重画；离线队列 + 评论 + classes 升级是体验闭环。一次性收进 v0.5.4 单一版本号交付。

---

## Scope（5 大块）

### A · Polygon 编辑能力收尾

**目标**：选中已落库 polygon 后，可拖顶点 / Alt+点边新增顶点 / Shift+点顶点删除（≤3 拒绝）；几何变更时实时检查自相交；polygon-vs-polygon 走精确 IoU。

**前端**

- 新增 vertex drag 状态机：`apps/web/src/pages/Workbench/state/useWorkbenchState.ts` 的 `drag` 联合类型加 `{ kind: "polyVertexDrag", id, vidx, start: [x,y] }`，与现有 `{kind:"draw"|"pan"}`、KonvaBox 的 move/resize 通道并列；commit 时复用 `useAnnotationHistory.push({kind:"update", before, after})` 单条命令（连续拖动期间走 `overrideGeom` 通道临时覆盖）。
- 新增组件 `apps/web/src/pages/Workbench/stage/PolygonEditOverlay.tsx`：仅当 `selectedId === polygon.id && tool !== "hand"` 时渲染；遍历 polygon 顶点画 8px 圆点 + 边的 hit-area；`onMouseDown(altKey)` 计算点到所有边的最近垂足，插入新顶点；`onMouseDown(shiftKey)` 删除顶点（≤3 时 toast 拒绝）；普通按下进 polyVertexDrag。挂在 Konva `overlay` Layer（v0.5.3 已分层，避免污染 ai/user）。
- 自相交校验：新建 `apps/web/src/pages/Workbench/stage/polygonGeom.ts`，导出 `isSelfIntersecting(points: [number,number][]): { ok: boolean; edges?: [number,number][] }` —— 段-段相交（O(n²) 暴力够用，n 通常 < 50）；`KonvaPolygon` 收 `selfIntersect?: boolean` prop，true 时 stroke 切红 + dash；commit 路径（vertex drag 结束 / Alt 新增 / Shift 删 / 草稿闭合）调一次，违规时弹 toast「polygon 自相交，已撤销」并不落库。
- 精确 IoU：复用 `apps/web/src/pages/Workbench/stage/iou.ts` 的 `iouShape()` —— 引入 `polygon-clipping@0.15.x`（小巧、无依赖、TS 友好）；polygon-vs-polygon 走 `intersection()` / `union()` 算面积比；polygon-vs-bbox 把 bbox 转 4 顶点走同分支；bbox-vs-bbox 保持原 `iou()`。`WorkbenchShell.tsx` 视觉去重处把 `iou()` 调用换成 `iouShape()`（grep 仅一处）。补 `iou.test.ts`：identical-polygon / disjoint / 半重叠 / polygon-vs-bbox 各一例。
- 快捷键：`hotkeys.ts` 不变（Alt/Shift 是事件级修饰，不进 dispatchKey）；`HotkeyCheatSheet.tsx` 加三行说明：Alt+点边、Shift+点顶点、拖顶点。

**后端**：无改动（geometry 形状已是 v0.5.3 discriminated union）。

**关键文件**
- 新建：`stage/PolygonEditOverlay.tsx`、`stage/polygonGeom.ts`
- 修改：`state/useWorkbenchState.ts`、`stage/ImageStage.tsx`（drag 分支 + overlay 挂载）、`stage/iou.ts`、`stage/iou.test.ts`、`stage/KonvaPolygon`（接 `selfIntersect` prop，目前可能内联在 ImageStage）、`shell/HotkeyCheatSheet.tsx`、`shell/WorkbenchShell.tsx`（iou → iouShape）

---

### B · 项目级属性 Schema + Annotation.attributes（P1）

**目标**：项目方在设置页 0 代码声明任意属性 → 标注员在右侧栏看到对应表单 → 落 `attributes JSONB` → 审核可按属性过滤；本期单 schema、覆盖式更新。

**数据模型**
- `apps/api/app/db/models/annotation.py` 加列：`attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)`
- `apps/api/app/db/models/project.py` 加列：`attribute_schema: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{\"fields\":[]}", default=lambda: {"fields": []})`
- migration 0012：`add_annotation_attributes_and_project_schema.py`（参照 0011 风格 + alembic op.add_column；空对象默认值，存量 0 风险）。downgrade drop 两列。

**Schema DSL**（约定，写进 `apps/api/app/schemas/project.py` pydantic）

```
{ fields: [
    { key, label, type: "text"|"number"|"boolean"|"select"|"multiselect"|"range",
      required?, default?, options?: [{value,label}], min?, max?, regex?,
      applies_to?: "*"|string[],     // 全局或限定 class_name
      visible_if?: { key: value },   // 条件级联（单层）
      hotkey?: string                // 1-9 快捷键，绑 boolean toggle / select cycle
    }
] }
```

**后端 API**
- `PATCH /projects/{id}` 已支持 exclude_unset，自动接 `attribute_schema`（仅需 `ProjectUpdate` schema 加可选字段 + pydantic validator 校验 DSL 合法性：key 唯一 / type 枚举内 / options 非空仅 select 系）。
- `PATCH /annotations/{id}`：`AnnotationUpdate` 加 `attributes: dict | None`，存在时直接覆盖（不 merge，避免幽灵字段）。
- `AnnotationOut` 新增 `attributes: dict` 字段（默认 `{}`，老客户端忽略安全）。

**前端**
- `apps/web/src/api/projects.ts`：`Project` type 加 `attribute_schema?: AttributeSchema`；定义 `AttributeSchema` / `AttributeField` types。
- `apps/web/src/api/annotations.ts` / `tasks.ts`：`Annotation` type 加 `attributes?: Record<string, unknown>`。
- 新建 `apps/web/src/pages/Workbench/shell/AttributeForm.tsx`：根据 `project.attribute_schema.fields × annotation.class_name × annotation.attributes` 渲染表单（react-hook-form 已在依赖里？若无则手撸 controlled state，不引新库）；字段联动 `visible_if`；改完防抖 400ms PATCH 落 `attributes`；多选时合并表单显示「— 多个 —」占位。
- `shell/AIInspectorPanel.tsx` 选中态下方挂 `<AttributeForm>`（左右双栏：上 = 类别 / 几何 meta，下 = 属性表单）。
- 项目设置页 schema 编辑器：定位 `apps/web/src/pages/Projects/sections/`，新建 `AttributesSection.tsx` 加到 ProjectSettings tabs；可视化列表（拖排 + add/remove 字段 + 字段类型 select + options 子表）；导入 / 导出 JSON。
- 必填校验：「提交质检」按钮（`Topbar`）若任意 annotation 有 required 字段缺失则 disabled + 红框高亮（`AttributeForm` 暴露 `getValidationState`）。

**Hotkey 加成**：本期仅占位（schema 里读 `hotkey` 字段，但不实际绑定）；hotkeys.ts 改造放 v0.5.5（避免与现有 1-9 类别快捷键冲突，需要单独决策层）。

**关键文件**
- 新建：alembic `0012_*.py`、`shell/AttributeForm.tsx`、`Projects/sections/AttributesSection.tsx`
- 修改：models `annotation.py` / `project.py`，schemas `annotation.py` / `project.py`，api `annotations.py`（PATCH 接 attributes）、api `projects.ts` / `annotations.ts`（前端 type）、`AIInspectorPanel.tsx`、`Topbar.tsx`（提交按钮 disabled）

---

### C · 逐框评论 annotation_comments

**目标**：reviewer 退回任务时可在某个框上留批注，annotator 接到通知中心提醒；评论独立表 + 通知复用 audit_log。

**数据模型**
- 新模型 `apps/api/app/db/models/annotation_comment.py`：
  ```
  id (UUID), annotation_id (FK -> annotations, index), author_id (FK -> users),
  body (Text), is_resolved (Bool, default False),
  created_at, updated_at
  ```
- migration 0013：建表 + 复合索引 `(annotation_id, created_at desc)`。

**后端 API**（新增 `apps/api/app/api/v1/annotation_comments.py`，注册到 `__init__.py`）
- `GET /annotations/{aid}/comments` → list（按 created_at desc）
- `POST /annotations/{aid}/comments` → create（body 必填）；写 audit_log `action="ANNOTATION_COMMENT"` + `target_type="annotation"` + `target_id=aid`，由现有通知中心 30s 轮询自动可见
- `PATCH /comments/{id}` → 改 body / 切 is_resolved（仅 author 或 super_admin）
- `DELETE /comments/{id}` → 软删（仅 author，置 is_active=false；本期硬删也可，体量小）
- 权限：复用 ProjectMember 权限矩阵（同项目内 annotator/reviewer/owner 都可读，作者可改）

**前端**
- `apps/web/src/api/comments.ts`：新增 `listComments(aid)` / `createComment(aid, body)` / `patchComment(id, ...)`；hooks `apps/web/src/hooks/useAnnotationComments.ts`（react-query）。
- `shell/AIInspectorPanel.tsx` 选中态再加一段「评论 (N)」可折叠区：input + 历史列表（按时间倒序，作者头像 + body + 「已解决」徽章）。
- 评论数徽章：`stage/SelectionOverlay.tsx` 浮按钮组加「💬 N」chip（N 来自 query 缓存的 commentsCount）。
- 通知中心：当前 `useNotifications` 拉 audit_log；新评论自然可见，无新代码（仅在 NotificationItem 渲染处把 `ANNOTATION_COMMENT` action 映射为「{author} 在 {project} 的标注上留言」）。

**关键文件**
- 新建：models `annotation_comment.py`、alembic `0013_*.py`、api v1 `annotation_comments.py`、schemas `annotation_comment.py`、前端 `api/comments.ts` + `hooks/useAnnotationComments.ts`
- 修改：`api/v1/__init__.py`（注册）、`AIInspectorPanel.tsx`、`SelectionOverlay.tsx`、`NotificationItem`（路径待确认，应在 `components/shell/` 或 `pages/Notifications/`）

---

### D · 自动保存 / 离线队列

**目标**：网络抖动 / 后端 5xx 期间，create/update/delete annotation mutation 落 IndexedDB 队列；StatusBar 显示「离线 · N 操作待同步」；恢复后自动 flush。

**前端**（无后端改动）
- 引入 `idb-keyval@6` —— 仅 ~2KB 无依赖；不上 Dexie。
- 新建 `apps/web/src/pages/Workbench/state/offlineQueue.ts`：暴露 `enqueue(op)` / `peek()` / `drain(handler)` / `count()` / `subscribe(cb)`；op 形如 `{ id: uuid, kind: "create"|"update"|"delete", payload, taskId, ts }`；持久化到 idb key `"anno.offline-queue"`；零网络依赖。
- `apps/web/src/api/client.ts` 的 `request()` 错误分流加分支：`fetch` 抛 TypeError（network error）或 5xx 时抛 `OfflineCandidateError(op)`；现有 401 / 403 路径不变。
- 新建 hook `apps/web/src/hooks/useOfflineMutations.ts`：包装 `useCreateAnnotation` / `useUpdateAnnotation` / `useDeleteAnnotation`（在 `hooks/useTasks.ts` 内定义）—— onError 时如果是 OfflineCandidate 就 enqueue + toast「已暂存到离线队列」+ 乐观更新缓存（已有 onMutate）；否则按原路径报错。
- 临时 ID 方案：`useCreateAnnotation` onMutate 里用 `tmp_${uuid()}` 作 id 写入 react-query 缓存 + history 栈；onSuccess 时 `queryClient.setQueryData` 把 tmp id 替换为真实 id（v0.5.3 的 history 已支持 ID 替换，第 60-65 行 `cmd.annotationId = fresh.id`）；离线场景下 tmp id 一直保留，flush 时再走替换。
- `online`/`offline` 监听：新 hook `useOnlineStatus()`；恢复在线时尝试 `drain(handler)`，每 op 调原 mutation function。
- StatusBar 徽章：`shell/StatusBar.tsx` 右侧 ETA 之前插入 `{count > 0 && <span>📡 离线 · {count} 操作待同步</span>}`；点击展开抽屉显示队列详情（最简版只显示数量 + 「立即重试」按钮，detail UI 留 v0.5.5）。

**关键文件**
- 新建：`state/offlineQueue.ts`、`hooks/useOfflineMutations.ts`、`hooks/useOnlineStatus.ts`
- 修改：`api/client.ts`、`hooks/useTasks.ts`（mutation onError + onMutate）、`shell/StatusBar.tsx`、`shell/WorkbenchShell.tsx`（注入 useOnlineStatus 触发 flush）

**风险**
- IndexedDB 写入在 incognito 模式可能失败 → 静默降级到内存队列（`offlineQueue` 内部 try/catch）。
- 同 task 同 annotation 的 create→update→delete 序列入队后 flush 顺序错可能 422 → 按 ts 严格 FIFO，单线程 drain。
- multi-tab 同步：本期不做（仅警告 toast「检测到多 tab，建议关闭其他」）。

---

### E · Classes 升级（color + order + 拖排）

**目标**：项目方可给每个 class 配 color；面板拖排持久化；前端 string[] 路径零改动（向下兼容）。

**数据模型**（按用户选定的「新增 classes_config JSONB 共存」策略）
- `apps/api/app/db/models/project.py` 加列：`classes_config: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}", default=dict)` —— 形如 `{"car": {"color": "#3b82f6", "order": 0}, "person": {"color": "#10b981", "order": 1}}`。
- migration 0014：加列 + 用 SQL 从存量 classes 数组生成默认 config（`order` = 数组下标，`color` = 从 v0.5.3 的 `colors.ts` 调色板按下标取）。
- `project.classes` 保持 `list[str]`，所有现有调用零改动。

**后端 API**
- `ProjectUpdate` schema 加 `classes_config: dict | None`；pydantic validator 校验 keys ⊆ classes、color 是 hex、order 唯一非负。
- 新端点（可选简化）：`PATCH /projects/{id}/classes-order`，body `{order: ["car","person",...]}` —— 更新 classes 数组顺序 + classes_config 对应 order；前端拖排专用，避免 round-trip 整 project。
  - 不做也行，直接走 PATCH /projects/{id} + 同时传 classes（重排后的）和 classes_config。**采用后者** 减少端点数。

**前端**
- `apps/web/src/api/projects.ts`：`Project` 加 `classes_config?: Record<string, { color?: string; order?: number }>`。
- `apps/web/src/pages/Workbench/stage/colors.ts` 改造：`getClassColor(name, classes_config?)` —— 优先 config.color，回落到原索引算法；调用点（KonvaBox / KonvaPolygon / ClassPalette / SelectionOverlay）均传 `project.classes_config`。
- `shell/ClassPalette.tsx`：渲染时按 `classes_config[name].order ?? Infinity` 排序（稳定）；color chip 走 `getClassColor`。零交互改动（readOnly 仍是预览）。
- 项目设置页 `Projects/sections/GeneralSection.tsx`（或新建 `ClassesSection.tsx`）：原 string list 升级为表格（name / color picker / 拖动 handle），dnd-kit（已在依赖里？grep 验证；若无则用原生 HTML5 drag）；保存时 PATCH 整 project 带 classes + classes_config。
- 新建 `apps/web/src/pages/Workbench/state/useRecentClasses.ts` 改造：本来按 string 存，无需改（key 仍是 name）。

**关键文件**
- 新建：`Projects/sections/ClassesSection.tsx`（或扩展 GeneralSection）、alembic `0014_*.py`
- 修改：models `project.py`、schemas `project.py`、`api/projects.ts`、`stage/colors.ts`、`shell/ClassPalette.tsx`、几何渲染处统一接 `getClassColor`

---

## Migration 顺序

依次落：
- `0012_add_annotation_attributes_and_project_schema.py`（B）
- `0013_create_annotation_comments.py`（C）
- `0014_add_project_classes_config.py`（E）

A、D 无 migration。每个 migration 独立 upgrade/downgrade，全部空对象 / 默认值，存量 0 影响。

---

## Verification

### A · Polygon 编辑
- 画一个 5 顶点 polygon → 选中 → 拖第 3 顶点（看到 vertex drag override 实时；松手落库；Ctrl+Z 还原）
- Alt+点击第 2-3 边中点 → 多出第 6 顶点
- Shift+点击第 4 顶点 → 删；连删到 3 顶点时 toast 拒绝
- 故意把第 1、3 顶点拖到交叉位置 → KonvaPolygon stroke 变红 + dash + toast「自相交，已撤销」+ 几何回退
- 同类两个 polygon 重叠 80% → AI 框 IoU 视觉去重生效（`iouShape` 走精确算法）
- vitest：`iou.test.ts` 新增 4 例 polygon 用例全过；自相交 unit 单测可选

### B · 属性 schema
- 项目设置页加一个 `select`（key=occluded, options=yes/no, applies_to=*, required=false）
- 工作台选中标注 → 右侧栏出现表单 → 改 yes → 网络面板看到 PATCH /annotations/{id} 带 attributes
- 重载页面 → 表单回显 yes
- 把 occluded 改 required=true → 创建一个新 annotation 不填 → 「提交质检」按钮 disabled
- visible_if 联动：加 vehicle_type=truck → door_count select（visible_if vehicle_type=truck）→ 切换 vehicle_type 验证字段显隐

### C · 评论
- reviewer 在某框写「车牌看不清」→ POST /annotations/{aid}/comments 200
- annotator 切到通知中心 → 30s 内看到「{reviewer} 在 {project} 的标注上留言」
- 同 annotation 选中后 → 右侧栏评论区可见、可标「已解决」

### D · 离线队列
- 工作台正常画 5 个框 → 全部成功
- DevTools Network 切 Offline → 再画 3 个框 → StatusBar 显示「📡 离线 · 3 操作待同步」+ 框正常显示在画布
- 切回 Online → 1-2s 内徽章消失 → 后端能查到 8 个 annotations
- 故意把后端关掉（5xx）→ 同样进队列；恢复后 flush

### E · Classes 升级
- 项目设置页拖动「person」到「car」上方 → 保存
- 工作台 ClassPalette 顺序更新；新画 person 框颜色为新设置 color
- 现有项目无 classes_config → 工作台仍走原调色板（向下兼容）

### 回归
- `pnpm --filter web exec tsc -b` 全绿
- `pnpm --filter web exec vitest run` 全绿（v0.5.3 33 例 + v0.5.4 新增）
- 后端启动 `uvicorn` 无报错；alembic upgrade head 成功；downgrade -3 成功

---

## Out of Scope（留 v0.5.5+）

- 属性 schema 的 hotkey 实际绑定（与 1-9 类别快捷键冲突协调）
- 离线队列的多 tab 同步、queue 详情 UI
- 评论的 @ 提及、评论附件
- classes 升级的 import/export schema、SAM 接入后的 polygon 精修
- COCO/YOLO 导出器读 attributes 的字段映射
