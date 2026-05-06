# v0.6.4 — ROADMAP「v0.6.2 落地后发现的尾巴」全量收口

## Context

ROADMAP.md 第 54–84 行列了 v0.6.2 上线后观察到的 8 项「应修（架构性短板）」。「必修」5 项已在 v0.6.3 修完（评论附件下载、tmpId undo、跨 op 替换、polygon onError、Dockerfile alembic）。本计划是把剩下的 8 项全部在一个版本（v0.6.4）里收口。

用户已确认两项有 caveat 的工作也一起做：
- ImageStage Konva 坐标系对齐（roadmap 标「单独立项」）→ 一起做
- display_id 风格统一（roadmap 标「Breaking change，需要灰度」）→ 一起做

风险提示（Plan agent 的判断，留给执行者把控）：8 项里 ImageStage 这一项最高危——它改的是全标注员日常路径的核心文件（`ImageStage.tsx` 862 行）。如果发布后回归，受影响的是全员而不是只有 commenter。执行时如发现冲突难收，**第 3 项**可以拆 commit 1–3（dormant 脚手架）随 v0.6.4 上车，commit 4–8 走 v0.6.5 + feature flag。其它 7 项与发布节奏无强耦合。

---

## 范围与项编号

| # | 任务 | 复杂度 |
|---|---|---|
| 1 | `useWorkbenchAnnotationActions` + `useWorkbenchHotkeys` 两把刀 | 中 |
| 2 | Pydantic JSONB 全字段强类型 + 删 `projects.ts` workaround | 中 |
| 3 | CanvasDrawing 入 ImageStage（5th Konva Layer + 新工具 C） | 高 |
| 4 | CanvasDrawingEditor / Preview 接 imageWidth/imageHeight，viewBox 真实比例 | 低 |
| 5 | annotator 端开放画布批注 → 双向沟通 | 低 |
| 6 | `AttributeField.description` 引入 react-markdown | 低 |
| 7 | OfflineQueueDrawer 按 task 分组 + 当前题筛选 + retry_count 视觉 | 低 |
| 8 | display_id 统一（B/T/D/P/BT-N）+ 迁移 0021 + 序列化生成器 | 中 |

> 项 4 与 项 3 强相关（项 3 上车后，项 4 编辑器在 ImageStage 内不再需要 600×400 viewBox，但 CommentsPanel 的 SVG Preview 仍使用，所以项 4 仍须独立做）。

---

## 实施细节（按依赖顺序）

### 项 1 · `useWorkbenchAnnotationActions` + `useWorkbenchHotkeys`

**目标**：`WorkbenchShell.tsx` 从 1305 行降到 ≤950 行。

**关键文件**：
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`
- 新建 `apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts`
- 新建 `apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts`
- 参考已落地 `apps/web/src/pages/Workbench/state/useWorkbenchOfflineQueue.ts`（128 行的模板）

**`useWorkbenchAnnotationActions` 签名**：
```ts
useWorkbenchAnnotationActions({
  taskId, projectId, meUserId, queryClient, history, s, pushToast,
  recordRecentClass,
  mutations: { create, update, delete: del },
  offlineQ,  // 上一把刀的返回值
}) → {
  optimisticEnqueueCreate,  // 内部用，也对外暴露给 polygon 提交
  handlePickPendingClass,   // bbox create
  submitPolygon,            // polygon create
  handleDeleteBox,
  handleCommitMove,
  handleCommitResize,
  handleCommitPolygonGeometry,
}
```
内部抽 helper：
- `optimisticUpdateGeom(id, afterG)` — `setQueryData` map 替换 geometry
- `optimisticDelete(id)` — `setQueryData` filter 删除
- `optimisticPatchAttrs(id, attrs)` — 给 attribute 改写预留

迁移源：`WorkbenchShell.tsx` 行 291–320（optimisticEnqueueCreate）、328–355（submitPolygon）、460–480（handleDeleteBox）、617–636（handlePickPendingClass）、682–707（handleCommitMove）、709–741（handleCommitPolygonGeometry）、743–771（handleCommitResize）。

**`useWorkbenchHotkeys` 签名**：
```ts
useWorkbenchHotkeys({
  s, history, polygonHandle, actions,
  imgRef, vp, recordRecentClass,
})
// 内部：
//   - 挂 window keydown / keyup
//   - 处理 spacePan、nudgeMap、polygon Enter/Esc/Backspace
//   - 调 dispatchKey（已是纯函数，不动）
```
迁移源：`WorkbenchShell.tsx` 行 276–277（state）、365–389（polygon useEffect）、391–407（flushNudges）、821–1037（主 keydown useEffect 包括 dispatchKey 调用、attribute hotkey 解析、spacePan toggle）。`dispatchKey` 自身保持在 `state/hotkeys.ts` 不动。

**单测**（vitest，沿用 `state/*.test.ts` 规约）：
- `useWorkbenchAnnotationActions.test.ts`：mock mutations + queryClient，断言 onError 路径调 `enqueueOnError`、onSuccess 调 `history.push` 且 cache 更新；create/update/delete 三态都跑一遍 optimistic + reconcile。
- `useWorkbenchHotkeys.test.ts`：mock `s` + `history`，模拟 keydown 事件，断言对应 action 被调用；nudge flush 时机。

---

### 项 2 · Pydantic JSONB 全字段强类型

**目标**：删除 `apps/web/src/api/projects.ts` 第 44–54 行 `Omit + 富类型` workaround，全部从 codegen 自动出强类型。覆盖 ProjectOut / AnnotationOut / AnnotationCommentOut / AuditLogOut。

**关键文件 / 改动**：

1. **新建** `apps/api/app/schemas/_jsonb_types.py`：把已有但散落的结构集中。新增类型：
   - `ClassConfig`、`ClassesConfig`（mirror 前端 `apps/web/src/api/projects.ts:6–42` 的 `AttributeField`/`AttributeSchema`/`ClassesConfig`，反向同步）
   - `BboxGeometry`、`PolygonGeometry`、`Geometry = Annotated[Union, Field(discriminator="type")]`
   - `AnnotationAttributes = dict[str, str | int | float | bool | None]`（保留 dict 但限元素类型）

2. `apps/api/app/schemas/project.py:130–131` — `classes_config: ClassesConfig`、`attribute_schema: AttributeSchema`

3. `apps/api/app/schemas/annotation.py:76,83` — `geometry: Geometry`、`attributes: AnnotationAttributes`。`_validate_geometry` (lines 6–38) 现在变成 Pydantic 的 discriminator 自动处理，可删（保留时间逻辑 e.g. polygon 自交检测下沉到 service 层）。

4. `apps/api/app/schemas/annotation_comment.py:59,60,61` — `mentions: list[Mention]`、`attachments: list[Attachment]`、`canvas_drawing: CanvasDrawing | None`。Backend 已有 `Mention`、`Attachment` 模型（`annotation_comment.py:11–28`），新增 `CanvasDrawing`：
   ```python
   class CanvasShape(BaseModel):
       type: Literal["line", "arrow", "rect", "ellipse"]
       points: list[float]
       stroke: str | None = None
   class CanvasDrawing(BaseModel):
       shapes: list[CanvasShape]
   ```

5. `apps/api/app/schemas/audit.py:20` — 引入 `AuditDetail` 注册表：
   ```python
   # apps/api/app/services/audit.py
   class AnnotationAttributeChangeDetail(BaseModel):
       task_id: int; field_key: str; before: Any; after: Any
   class UserProfileUpdateDetail(BaseModel):
       old_name: str; new_name: str
   class RequestIdOnlyDetail(BaseModel):
       request_id: str | None = None
   AuditDetail = Annotated[
       Union[AnnotationAttributeChangeDetail, UserProfileUpdateDetail, RequestIdOnlyDetail],
       Field(discriminator="kind")  # 写入端补 "kind" 字段
   ]
   ```
   写入端（`tasks.py:232–237`、`me.py`、`audit.py` 中间件）补 `kind` 字段。其它 23 个 action 暂用 `RequestIdOnlyDetail` 兜底；后续按需要细化。

6. **codegen 联动**：删 `apps/web/src/api/projects.ts` 第 44–54 行 workaround，让全站直接用 `import type { ProjectOut } from "@/api/generated/types.gen"`。前端 `apps/web/src/api/comments.ts:3–24` 的 `CommentMention/CommentAttachment/CommentCanvasDrawing` 类型可删，统一从 generated 导入。

7. **OpenAPI dump 脚本**：新建 `apps/api/scripts/dump-openapi.py`（roadmap 第 89 行 ask），落 CI 友好的 codegen：
   ```python
   from app.main import app
   import json, sys
   json.dump(app.openapi(), open(sys.argv[1], "w"))
   ```
   `apps/web/openapi-ts.config.ts` 支持 `OPENAPI_URL` 已在用。`pnpm codegen` 文档化「带后端」与「OPENAPI_URL=/tmp/openapi.json」两种模式。

**测试**：
- `apps/api/tests/schemas/test_jsonb_strong_types.py`：构造非法 geometry / 非法 mention offset → 422。
- 跑 `pnpm codegen && pnpm tsc -b`，确认前端不再依赖 `as unknown as` cast。

---

### 项 3 · CanvasDrawingLayer 入 ImageStage（高危核心）

**目标**：reviewer 在原图上直接画 → annotator 端 zoom/pan 时批注跟随。

**架构决策**：
- 存储格式 `{shapes: [{type, points, stroke}]}` 不变（normalized [0,1]），后端零改动。
- 在 ImageStage Konva Stage 内增第 5 个 Layer `<CanvasDrawingLayer>`，z-order：bg → ai → user → **canvas-drawing** → overlay。
- 新工具 `canvas`（hotkey `C`，待校验未占用），注册到 `apps/web/src/pages/Workbench/stage/tools/`。
- 草稿（draft）状态从 CommentInput 提到 `useWorkbenchState`（见下），通过 prop 已有的 state slice 一次贯通。
- 旧 SVG 编辑器 `CanvasDrawingEditor` modal **保留**（项目级评论无 ImageStage 时回退）；preview 也保留 SVG。

**关键文件**：
- 新建 `apps/web/src/pages/Workbench/stage/CanvasDrawingLayer.tsx`：渲染 + 编辑双模式，接 `shapes / draft / imgW / imgH / scale / editable / stroke`。Konva `<Line>` 的 `points` 从 normalized 乘 imgW/imgH，`strokeWidth = 2/scale` 保持屏幕粗细恒定。
- 新建 `apps/web/src/pages/Workbench/stage/tools/CanvasTool.ts`：`{id:"canvas", hotkey:"C", icon:"edit", onPointerDown/Move/Up}`，扩展 `Drag` 联合 `{kind:"canvasStroke"; points:number[]}`。
- 改 `apps/web/src/pages/Workbench/state/useWorkbenchState.ts`：加 slice
  ```ts
  canvasDraft: {
    active: boolean;
    annotationId: number | null;
    shapes: CommentCanvasDrawing["shapes"];
    stroke: string;
    pendingResult: CommentCanvasDrawing | null;
  }
  beginCanvasDraft(annotationId, initial?), appendCanvasShape(shape),
  endCanvasDraft() → returns drawing, cancelCanvasDraft(),
  setCanvasStroke(c), undoCanvasStroke(), clearCanvasShapes()
  ```
- 改 `apps/web/src/pages/Workbench/stage/ImageStage.tsx`：
  - 第 798 行附近挂 `<CanvasDrawingLayer>`
  - `handleStageMouseDown` (line 488)、`handleMouseMove` (line 411)、`handleMouseUp` 加 `canvasStroke` 分支
  - SelectionOverlay (line 802) 加 `&& tool !== "canvas"` 守卫
  - tool selector UI 加 C 键和 icon
- 改 `apps/web/src/pages/Workbench/shell/CommentInput.tsx`：在已有「弹窗编辑」按钮旁加「在题图上绘制」按钮（仅当 `enableLiveCanvas` 为 true 且能拿到 ImageStage 上下文）；effect 监听 `s.canvasDraft.pendingResult` 把结果写回 `setCanvasDrawing` 后清 pending。
- 改 `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`：`<ImageStage canvasDraft={s.canvasDraft} ...>`，`<AIInspectorPanel enableLiveCanvas ...>` 透传。
- 浮动工具条：`apps/web/src/pages/Workbench/stage/CanvasToolbar.tsx`（颜色 swatch + Done/Cancel/Undo），定位 absolute top-right of stage container。

**碰撞处理 checklist**：
- 旧 stroke 渲染层 `listening={false}`，仅空白区接 onPointerDown
- canvas 模式时禁用 BboxTool、SelectionOverlay、marquee 的 pointer 路径（守卫已列）
- 双击关闭 polygon (line 511) 与 canvas 不冲突（canvas 用 Done 按钮提交，不用双击）
- Konva 5 层在文档建议 ≤7 内，性能无忧
- 触屏 / 笔事件：container 加 `style={{touchAction:"none"}}`（nice-to-have）

**Commit 顺序**（如计划全量上车）：
1. 加 `CanvasDrawingLayer`（仅渲染，不 editable，empty array）
2. 加 `canvasDraft` state slice，无 UI
3. 加 `CanvasTool` + 类型扩展
4. 接 ImageStage onPointerDown/Move/Up，editable 联动
5. CommentInput 入口按钮 + pendingResult 回流
6. 守卫与碰撞（SelectionOverlay / marquee）
7. Playwright e2e：画一笔 → 缩放至 4× → 截图 diff 验证锚定

**回滚预案**：feature flag `enableLiveCanvas`（envvar 或 ProjectSettings）默认 true；出问题改 false 立即回退到 v0.6.3 的弹窗编辑器路径，DB 数据不受影响。

---

### 项 4 · Editor / Preview 接 imageWidth/imageHeight

**关键文件**：`apps/web/src/components/CanvasDrawingEditor.tsx`（行 23–24 hardcoded `CANVAS_W=600/CANVAS_H=400`，行 120 viewBox）。

- `CanvasDrawingEditor` 接 `imageWidth?, imageHeight?`，回退 600×400；外层尺寸按比例计算（保持纵向最大 ≤ 视口高 60%）；viewBox 仍 `0 0 1 1`（normalized）。
- `CanvasDrawingPreview` (行 185) 接 `imageWidth?, imageHeight?`，`height = (h/w) * width`。
- 调用方：`CommentInput.tsx` (行 349)、`CommentsPanel.tsx` (行 123) 透传。`enableLiveCanvas` 上车后，CommentInput 路径在 ImageStage 内画时 viewBox 已与图像对齐；弹窗回退路径用此 prop 修复比例。

**测试**：vitest 渲染快照比较不同 imageWidth/imageHeight 下 svg 出来的 viewport 尺寸。

---

### 项 5 · annotator 端启用画布批注

**关键文件**：`apps/web/src/pages/Workbench/shell/AIInspectorPanel.tsx` (行 39, 67, 181)。

把 `enableCommentCanvasDrawing` 从「reviewer 才有」改为默认 true（reviewer + annotator 都能画）。WorkbenchShell 不再需要按角色控制；AIInspectorPanel 内部已用 prop 透到 CommentsPanel/CommentInput。

`enableLiveCanvas` 同步暴露给两端。

无 schema / API 改动。

---

### 项 6 · AttributeField.description Markdown

**关键文件**：`apps/web/src/pages/Workbench/shell/AttributeForm.tsx` (行 99–120)。

1. `pnpm add react-markdown remark-gfm`（约 25KB gz）
2. 把 `f.description` 从 `title=` / `aria-label=` 的 plain string 渲染改为 hover/click popover，里头用 `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{a: ({href, children}) => <a href={href} target="_blank" rel="noreferrer">{children}</a>}}>`。
3. 默认仍展示 `i` 图标按钮；hover/focus 时弹 tooltip 容器（最大宽 280px，paragraph + link + bold + list）。
4. 安全：react-markdown 默认禁 raw HTML，无 XSS 风险；不开启 `rehype-raw`。

**测试**：vitest 单测覆盖 link 渲染、加粗、换行三种 case。

---

### 项 7 · OfflineQueueDrawer 分组 + 筛选 + retry_count 视觉

**关键文件**：`apps/web/src/pages/Workbench/shell/OfflineQueueDrawer.tsx` (325 行，flat list at 行 192–272)，`offlineQueue.ts:10–13` 已有 `retry_count` 字段。

1. 分组：在 `getAll()` 之后按 `op.taskId` group，渲染折叠组（Disclosure，默认展开当前 taskId 组、其它折叠）。
2. 筛选 chip：`全部 / 当前题`（接 prop `currentTaskId`）+ `全部 / 失败累计 ≥ 3`。
3. retry_count 视觉：每个 op 行右侧加小徽章，`retry_count >= 3` 红色 / `>= 1` 黄色 / 0 灰色。失败累计筛选 tab 联动该字段。
4. 顶部统计条加「跨题数 N · 当前题 M」。

**测试**：vitest 渲染 mock queue（5 ops 跨 3 task），断言分组后渲染数、筛选 chip 切换、retry_count 颜色阈值。

---

### 项 8 · display_id 统一（迁移 0021）

**目标**：所有 entity 的 display_id 走「字母前缀 + 顺序号」。bug_reports 已是顺序号（`B-N`）；tasks/datasets/projects/task_batches 改造。

**生成器**（**Postgres SEQUENCE**，非锁表 counter）：

新建 `apps/api/app/services/display_id.py`：
```python
ENTITY_TO_PREFIX = {
    "bug_reports": "B", "tasks": "T", "datasets": "D",
    "projects": "P", "batches": "BT",
}

async def next_display_id(db: AsyncSession, entity: str) -> str:
    seq = f"display_seq_{entity}"
    n = (await db.execute(text(f"SELECT nextval('{seq}')"))).scalar()
    return f"{ENTITY_TO_PREFIX[entity]}-{n}"
```

> **task_batches 用 `BT` 而非 `B`**：避免与 bug_reports `B-N` 冲突，明确语义。CHANGELOG 标注。

**迁移 `0021_unify_display_id.py`**（`down_revision = "0020"`）：

```python
def upgrade():
    # 1. 建 sequence
    for e in ("bug_reports","tasks","datasets","projects","batches"):
        op.execute(f"CREATE SEQUENCE IF NOT EXISTS display_seq_{e}")

    # 2. 回填（保留 'B-DEFAULT' 默认批次哨兵）
    for table, prefix, where in [
        ("projects","P", ""),
        ("datasets","D", ""),
        ("task_batches","BT", "WHERE display_id != 'B-DEFAULT'"),
        ("tasks","T", ""),
    ]:
        op.execute(f"""
            WITH numbered AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n
              FROM {table} {where}
            )
            UPDATE {table} t SET display_id = '{prefix}-' || numbered.n
            FROM numbered WHERE t.id = numbered.id
        """)

    # 3. setval 同步序列
    for table, prefix, e in [
        ("bug_reports","B","bug_reports"),
        ("projects","P","projects"),
        ("datasets","D","datasets"),
        ("task_batches","BT","batches"),
        ("tasks","T","tasks"),
    ]:
        op.execute(f"""
            SELECT setval('display_seq_{e}',
                COALESCE((SELECT MAX(CAST(SPLIT_PART(display_id,'-',2) AS BIGINT))
                          FROM {table}
                          WHERE display_id LIKE '{prefix}-%'
                            AND display_id != 'B-DEFAULT'), 0) + 1, false)
        """)

    # 4. unique constraint（projects/tasks/task_batches 之前不 unique）
    op.create_unique_constraint("uq_tasks_display_id","tasks",["display_id"])
    op.create_unique_constraint("uq_task_batches_display_id","task_batches",["display_id"])
    op.create_unique_constraint("uq_projects_display_id","projects",["display_id"])

    # 5. 完整性自检
    for t in ("projects","datasets","tasks","task_batches"):
        op.execute(f"""
            DO $$ BEGIN
              IF (SELECT COUNT(*) FROM {t}) != (SELECT COUNT(DISTINCT display_id) FROM {t})
              THEN RAISE EXCEPTION 'display_id collision in {t} after backfill';
              END IF;
            END $$;
        """)
```

**call site 改写**（项目内全替换）：
- `apps/api/app/services/bug_report.py:205–212` `_next_display_id` → `await next_display_id(db,"bug_reports")`，删 MAX+1 自实现
- `apps/api/app/services/dataset.py:90, 309` → `next_display_id(db,"datasets")`（旧 task 显示 id 也在 dataset.py:309 生成，注意分类）
- `apps/api/app/services/batch.py:70, 187, 229, 267` → `next_display_id(db,"batches")`，保留 `B-DEFAULT` 字符串字面量于 `batch.py:54,122`（默认批次哨兵）
- `apps/api/app/api/v1/projects.py:151` → `next_display_id(db,"projects")`
- `apps/api/app/api/v1/files.py:27` → `next_display_id(db,"tasks")`

**前端影响**：
- `apps/web/src/pages/Workbench/shell/TaskQueuePanel.tsx:72`、`apps/web/src/components/bugreport/BugReportDrawer.tsx:183,259`、`apps/web/src/pages/Projects/ProjectSettingsPage.tsx:81` — 仅展示文本，长度变短（`T-A3F2C1` → `T-42`），无 CSS min-width 锁宽，cosmetic only。
- 无 URL 路由用 display_id（仅 `Content-Disposition` 文件名，序列号 filename-safe）。
- 任何 snapshot test 含 `B-1` / `T-...` 字面量需 `pnpm vitest -u`。

**测试**：
- `apps/api/tests/services/test_display_id.py`：50 个 `asyncio.gather(next_display_id(db,"tasks"))` 并发，断言全 unique。
- `apps/api/tests/migrations/test_0021_upgrade.py`：fresh DB at 0020 → seed 100 项目 / 50 数据集 / 1000 任务（hex display_id）→ upgrade → assert 全 `^P-\d+$` / `^T-\d+$`、无重复、`nextval()` 等于 N+1、`B-DEFAULT` 仍存在。
- 灰度建议：staging 环境 dump prod 镜像跑一遍 upgrade，记录耗时（1000 万行 tasks 的 ROW_NUMBER 大概 30s 量级）；高峰外部署。

---

## 验证（端到端）

执行后按以下流程跑全链路验证：

1. **后端**：`cd apps/api && pytest -x` — 含新加 jsonb / display_id / migration 测试。
2. **前端单测**：`cd apps/web && pnpm vitest run` — 含两把刀、CanvasDrawingLayer、OfflineQueueDrawer 分组、AttributeField markdown。
3. **codegen 链**：`cd apps/web && pnpm codegen && pnpm tsc -b` — 强类型替换无残留 cast。
4. **alembic**：`docker compose up postgres -d && cd apps/api && alembic upgrade head` 然后 `alembic downgrade -1` 然后 `alembic upgrade head` 反复一次，无错。
5. **本地 docker**：`docker compose up --build`，登录后：
   - 进 Workbench：bbox 绘制、polygon 绘制、删除、移动、resize、键盘 nudge、空格平移、属性数字键 → 全部仍工作（项 1 验证）
   - 切到 canvas tool（C 键）→ 在原图上画几笔 → 缩放到 4×、平移 → 笔触锚定（项 3 验证）
   - 评论里点「在题图上绘制」→ 画完 Done → 评论卡片渲染该 drawing preview，比例与原图一致（项 3 + 4）
   - annotator 角色登录，发评论时也能画（项 5）
   - 项目类别 schema 设置一个带 `description: "[规范](https://...)"` 的 attribute → AttributeForm 鼠标悬停渲染链接（项 6）
   - 离线模拟（DevTools Network → Offline）连续操作 5 道题 → 打开 OfflineQueueDrawer 看到按 task 分组、retry_count 染色（项 7）
   - 新建项目、新建数据集、上传任务、提交 bug report → display_id 全部 `P-N / D-N / T-N / B-N` 顺序号（项 8）
6. **MCP 浏览器自动化**：核心 5 流程做一遍 GIF 留档（gif_creator）。
7. **回归**：v0.6.3 留下来的 11 例 vitest（offlineQueue + applyLeaf）必须全绿。

---

## 关键文件清单

后端：
- `apps/api/app/schemas/_jsonb_types.py` *(新)*
- `apps/api/app/schemas/{project,annotation,annotation_comment,audit}.py`
- `apps/api/app/services/audit.py`（AuditDetail 注册表）
- `apps/api/app/services/display_id.py` *(新)*
- `apps/api/app/services/bug_report.py:205-212`
- `apps/api/app/services/{dataset,batch}.py`
- `apps/api/app/api/v1/{projects,files,tasks,me}.py`
- `apps/api/app/middleware/audit.py`
- `apps/api/alembic/versions/0021_unify_display_id.py` *(新)*
- `apps/api/scripts/dump-openapi.py` *(新)*

前端：
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`
- `apps/web/src/pages/Workbench/state/useWorkbenchAnnotationActions.ts` *(新)*
- `apps/web/src/pages/Workbench/state/useWorkbenchHotkeys.ts` *(新)*
- `apps/web/src/pages/Workbench/state/useWorkbenchState.ts`（canvasDraft slice）
- `apps/web/src/pages/Workbench/stage/ImageStage.tsx`
- `apps/web/src/pages/Workbench/stage/CanvasDrawingLayer.tsx` *(新)*
- `apps/web/src/pages/Workbench/stage/CanvasToolbar.tsx` *(新)*
- `apps/web/src/pages/Workbench/stage/tools/CanvasTool.ts` *(新)*
- `apps/web/src/pages/Workbench/shell/{AttributeForm,CommentInput,CommentsPanel,AIInspectorPanel,OfflineQueueDrawer}.tsx`
- `apps/web/src/components/CanvasDrawingEditor.tsx`
- `apps/web/src/api/{projects,comments}.ts`（删 workaround / 删本地类型）

文档：
- `CHANGELOG.md`（v0.6.4 节，特别注明 `task_batches` 前缀 `B` → `BT` 的 breaking）
- `ROADMAP.md`（划掉「v0.6.2 落地后发现的尾巴 应修」全部 8 项 + 必修小结）

---

## 提交与发布建议（非强制）

按依赖链组织 PR 或大 commit：

1. **prepare**：项 2（Pydantic 强类型）+ 项 8（display_id 服务 + 迁移）。这两项后端独立，可以先合，前后端解耦。
2. **workbench refactor**：项 1（两把刀）。
3. **canvas pipeline**：项 4（Editor/Preview 比例）→ 项 3（CanvasDrawingLayer 入 ImageStage，按 8 步 commit 顺序内推）→ 项 5（annotator 启用）。
4. **polish**：项 6（markdown）+ 项 7（OfflineQueueDrawer）。

CHANGELOG v0.6.4 一段总结 + 8 项分述。
