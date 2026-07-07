# v0.5.5 phase 2 部分落地的延续 — 实施计划

## Context

ROADMAP.md「v0.5.5 phase 2 部分落地的延续」段落列了 6 大项历史欠账。phase 2 已铺好基建（BroadcastChannel 多 tab 同步、`replaceAnnotationId` 命令栈替换、`include_attributes` query 参数、`@hey-api/openapi-ts` 配置、`AttributeForm` hotkey 上下文优先级、字段级 audit 索引等），剩下的都是「最后一公里」收尾工作。本轮把 6 项一次性收口，目标是清空这一段 backlog，让 ROADMAP.md 此节归零。

用户已确认范围：全部 6 项（含评论 polish 三层一次做完）。评论 polish 工程量最大，建议作为最后一阶段独立 PR；其它 5 项可合并为一到两个 PR。

## 仓库结构关键事实（已核对）

- 前端：`apps/web/src/`（不是 `frontend/`）
- 后端：`apps/api/app/`（不是 `backend/`）
- 最新 alembic 迁移是 `0019_task_batches.py` —— 本轮新增的迁移号是 **0020 / 0021**（roadmap 文中写的「0016」已过时）
- `apps/web/src/api/` 下手写 interface 实际只有 4 个文件（`users.ts` / `projects.ts` / `audit.ts` / `datasets.ts`）；`annotations.ts` **不存在**，roadmap 里列的 5 个文件实际是 4 个

---

## 阶段 A · 前端纯改动小块（可合并为一个 PR）

### A1. OfflineQueueDrawer 抽屉 UI + tmpId 端到端接入

**关键文件**

- `apps/web/src/pages/Workbench/state/offlineQueue.ts:7-13` — `OfflineOp.tmpId` 字段已可选预留，无需改类型
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx:356-363, 610-613` — `enqueueOnError` + create onError
- `apps/web/src/pages/Workbench/state/useAnnotationHistory.ts:109-125` — `replaceAnnotationId` 已就位
- `apps/web/src/pages/Workbench/shell/StatusBar.tsx:85-102` — 离线徽章 onClick 当前直接 `onFlushOffline`
- `apps/web/src/components/ui/Modal.tsx` — 复用此 portal/Escape 模板

**实施步骤**

1. **新建** `apps/web/src/pages/Workbench/shell/OfflineQueueDrawer.tsx`
   - 受控 `open` / `onClose` 抽屉（沿用 `Modal.tsx` 的 portal 思路，但右侧抽屉布局：`position: fixed; right: 0; top: 0; height: 100vh; width: 360px`）
   - 内部状态：列表态读 `offlineQueue.subscribe()` 实时订阅；按 `kind`（create/update/delete）+ 时间戳列出
   - 单条操作：「重试此项」（`drain` 单条）/「删除此项」（队列内移除）；底部「全部清空」「立即同步全部」
   - 为空时显示「暂无离线操作」+ 上次同步时间
2. **改** `WorkbenchShell.tsx` create mutation `onError` 入队改为 `enqueue({ kind: "create", id: crypto.randomUUID(), tmpId: \`tmp_${crypto.randomUUID()}\`, taskId, payload, ts: Date.now() })`，并把这个 `tmpId` 用作乐观插入的 annotation id 写入 react-query cache（`queryClient.setQueryData(["annotations", taskId], …)` 追加一项 `{id: tmpId, ...payload, _pending: true}`）
3. **新增** `flushOffline` handler（`offlineQueue.drain` 的回调）成功 create 时：从后端响应取真实 id → 调 `useAnnotationHistory.replaceAnnotationId(tmpId, realId)` → `queryClient.setQueryData` 把 cache 中 tmpId 那条 swap 成真实记录（去掉 `_pending`）
4. **改** `StatusBar.tsx` 离线徽章 onClick 从 `onFlushOffline` 改为 `setDrawerOpen(true)`，`drawerOpen` 状态由 `WorkbenchShell` 持有；徽章 hover/title 文案「点击查看离线队列详情」
5. **改** `WorkbenchShell.tsx` 渲染树底部挂载 `<OfflineQueueDrawer open={drawerOpen} onClose={...} onFlush={flushOffline} />`

**验证**

- 断网（Chrome DevTools Offline）→ 创建/编辑/删除标注 → 离线徽章数字递增 → 点击徽章弹抽屉，3 条记录可见
- 恢复网络 → 「立即同步全部」→ 抽屉清空 → cache 中 tmpId 已替换为真实 id（DevTools React Query devtool 验证）
- 多 tab：tab A 入队 → tab B 抽屉自动同步显示（BroadcastChannel）
- Undo/Redo：离线时 create + update + 同步后 → undo 仍能正确回滚到 update 之前

### A2. 导出 ExportSection + include_attributes 复选框

**关键文件**

- `apps/web/src/pages/DashboardPage.tsx:108-128` — 行内 `<select>`
- `apps/api/app/api/v1/projects.py` — 后端 `include_attributes: bool = Query(True)` 已就位
- `apps/web/src/api/projects.ts` — `exportProject(id, fmt)` 当前签名

**实施步骤**

1. **新建** `apps/web/src/pages/Dashboard/ExportSection.tsx`：props `{ project: ProjectResponse }`
   - 一个 `<select>`（COCO/VOC/YOLO）+ 一个「包含属性数据」`<input type="checkbox">`（默认勾选，对齐后端 default True）
   - 提交按钮 onClick → `projectsApi.exportProject(project.id, fmt, { includeAttributes })`
2. **改** `apps/web/src/api/projects.ts` `exportProject` 签名增加 `options?: { includeAttributes?: boolean }`，拼到 query string `?include_attributes=false` 仅在显式 false 时附加
3. **改** `DashboardPage.tsx:108-128` 行内 `<select>` 替换为 `<ExportSection project={p} />`

**验证**

- 默认导出（不勾去）→ 后端响应的 zip 含 `attributes` 字段
- 取消勾选 → URL 含 `?include_attributes=false` → 导出 zip 不含 attributes（与 v0.4.9 之前格式兼容）

### A3. HotkeyCheatSheet 动态注入属性快捷键分组

**关键文件**

- `apps/web/src/pages/Workbench/shell/HotkeyCheatSheet.tsx:1-64` — 当前按 `HOTKEYS` 静态 `group` 渲染
- `apps/web/src/pages/Workbench/state/hotkeys.ts:4-12` — `HotkeyGroup = "view" | "draw" | "ai" | "nav" | "system"`
- `apps/api/app/db/models/project.py:25` — `attribute_schema` JSONB
- `apps/web/src/pages/Workbench/shell/AttributeForm.tsx` — 字段结构 `{ key, label, hotkey?, ... }`

**实施步骤**

1. **改** `HotkeyCheatSheet.tsx`
   - 接收 prop `attributeSchema?: { fields: AttributeField[] }`（由 `WorkbenchShell` 透传 `currentProject.attribute_schema`）
   - 在静态 5 组之后追加一组「属性快捷键」：来自 `attributeSchema.fields.filter(f => f.hotkey)`
   - 每条文案规则：`{label}: {hotkey}` + 副标题「选中标注后，1-9 切换属性值」
   - 当 `attributeSchema?.fields` 为空或无 hotkey 字段时整组不渲染
2. **改** `WorkbenchShell.tsx` 把 `currentProject.attribute_schema` 透传给 `HotkeyCheatSheet`

**验证**

- 项目无 attribute_schema → cheatsheet 与今日一致（5 组）
- 项目 schema 含 3 个带 hotkey 字段 → cheatsheet 多出第 6 组，3 行

---

## 阶段 B · 后端 + 全栈中等改动（独立 PR）

### B1. 属性 schema 余项：AI 预标 description + audit `attribute_change`

**关键文件**

- `apps/api/app/schemas/prediction.py` — `PredictionOut.result: list[dict]`，目前不带 `attributes.description`
- `apps/api/app/services/ml_backend*` / `apps/api/app/api/v1/predictions*` — 预测响应序列化点
- `apps/api/app/services/audit.py:14-38` — `AuditAction` 枚举
- `apps/api/app/api/v1/tasks.py:165-216` — `PATCH /{task_id}/annotations/{annotation_id}` 已在 line 203-212 写 `annotation.update`

**实施步骤**

1. **预测 description 携带**
   - 找到把后端 ML response 转成 `result: list[dict]` 的位置（`ml_backend_service` 内）
   - 在每条 result 的 `attributes` 子对象中，按 `project.attribute_schema.fields` 反查 `description`，把 `attributes[key].description` 写入（schema 未声明 description 的字段保持原样）
   - 前端 `AttributeForm.tsx` 渲染时若 `description` 存在则在 label 旁边浮出（hover tooltip）
2. **audit 字段级动作**
   - `audit.py` 加常量 `AuditAction.ANNOTATION_ATTRIBUTE_CHANGE = "annotation.attribute_change"`
   - `tasks.py` PATCH 路由：在 `svc.update()` 后 diff `attributes` 字段，若变化则在原有 `annotation.update` 之外**额外**写一条 `annotation.attribute_change` 行，detail 含 `{ before, after, fieldKey }`（每个 fieldKey 一行，便于 GIN 索引按字段过滤）

**验证**

- 触发一次 AI 预标 → 前端 inspector 面板属性字段 hover 出 description
- 修改一条标注的 `attributes.severity` → audit_logs 同时多两行：`annotation.update` + `annotation.attribute_change`（fieldKey=severity, before/after 完整）
- 多字段同时改 → 按字段数生成多条 `attribute_change` 行
- pytest：`apps/api/tests/test_audit.py` 加测试断言两条审计行的 detail 结构

### B2. OpenAPI codegen 完整迁移 + prebuild gate

**关键文件**

- `apps/web/package.json:11-12` — `codegen` / `codegen:watch` 脚本
- `apps/web/openapi-ts.config.ts` — input http://localhost:8000/openapi.json，output `src/api/generated`
- `apps/web/.gitignore:2` — `src/api/generated/` 已 ignore
- `apps/web/src/api/{users,projects,audit,datasets}.ts` 顶部手写 interface 块（`annotations.ts` 不存在，可忽略 roadmap 写错）

**实施步骤**

1. 启动后端（`docker compose up api` 或本地 uvicorn）→ `cd apps/web && pnpm codegen` 生成 `src/api/generated/{types.gen.ts, schemas.gen.ts, ...}`
2. 4 个 api 文件顶部替换：删手写 `interface XxxResponse {...}` → 改为 `export type { XxxResponse } from "./generated/types.gen"`（generated 类型名可能与手写不同，需对齐：`UserResponse` ↔ generated 的 `UserOut` 等，视 `@hey-api` 命名策略）
3. 全仓 `tsc --noEmit` 跑通；如 generated 类型与手写有字段差异，**信任 generated**（它来自后端 Pydantic schema），调上层用法
4. `package.json` 加 `"prebuild": "pnpm codegen"` script
5. `README.md` / `DEV.md` 加一段：本地开发新增字段流程 = 后端改 schema → 重启 → 前端 `pnpm codegen` → tsc 引导改用法

**验证**

- `pnpm tsc --noEmit && pnpm build` 全绿
- 临时给后端 `UserOut` 加一个字段 → 不跑 codegen → `pnpm build` 失败（prebuild gate 跑了 codegen，新字段已在 generated 里 → build 成功）→ 撤销，确认 gate 工作
- 前端 4 个 api 文件 grep 不到 `interface UserResponse` 等手写块

---

## 阶段 C · 评论 polish 三层（独立 PR，工程量最大）

### 关键文件

- `apps/api/app/db/models/annotation_comment.py:9-21` — 表结构，无 mentions/attachments/canvas
- `apps/api/alembic/versions/` — 最新 0019，本次新增 `0020_comment_polish.py`
- `apps/api/app/schemas/annotation_comment.py` — `AnnotationCommentCreate.body` 1-4000 字符
- `apps/api/app/api/v1/annotation_comments.py:46-150` — 4 个路由
- `apps/api/app/api/v1/files.py:15-37` — `/upload-init` 模式，可镜像
- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx:44-119` — 当前 textarea 简易输入
- `apps/web/src/pages/Review/ReviewWorkbench.tsx` + `apps/web/src/pages/Workbench/stage/ImageStage.tsx` — Konva 画布

### C1. DB + 后端

**alembic 0020 `comment_polish`**

```python
op.add_column("annotation_comments", sa.Column("mentions", JSONB, server_default="[]", nullable=False))
op.add_column("annotation_comments", sa.Column("attachments", JSONB, server_default="[]", nullable=False))
op.add_column("annotation_comments", sa.Column("canvas_drawing", JSONB, nullable=True))
```

**`annotation_comment.py` model** 加三列。

**`annotation_comment.py` schema**：

- `AnnotationCommentCreate.mentions: list[Mention]`（默认 `[]`），`Mention = { userId: UUID, displayName: str, offset: int, length: int }`
- `AnnotationCommentCreate.attachments: list[Attachment]`（默认 `[]`），`Attachment = { storageKey: str, fileName: str, mimeType: str, size: int }`
- `AnnotationCommentCreate.canvas_drawing: dict | None`（svg path JSON）
- 校验器：① `mentions[].userId` 必须是该 project 成员（查 `project_members` 表）② `attachments[].storageKey` 必须以 `comment-attachments/` 前缀开头（防止任意 key 注入）

**新增路由** `apps/api/app/api/v1/annotation_comments.py`：

- `POST /annotations/{aid}/comment-attachments/upload-init` → 返回 `{ uploadUrl, storageKey: "comment-attachments/{aid}/{uuid}-{filename}" }`，逻辑镜像 `files.py:15-37`

### C2. 前端 CommentInput

**新建** `apps/web/src/pages/Workbench/shell/CommentInput.tsx`

- contenteditable `<div>`（不用 `<textarea>`，需富格式）
- 输入 `@` 触发：在光标位置弹 `<UserPicker>` popup（候选 = 项目成员 list 取自 `useProjectMembers(projectId)`），选中后插入 `<span data-mention-uid="...">@displayName</span>` chip
- 提交时序列化：DOM 遍历，取 chips 的 `data-mention-uid` + offset/length → mentions[]
- 附件：`<input type="file" multiple>` → 每个文件先调 `/comment-attachments/upload-init` → presigned PUT → 收集 storageKey 推入 attachments[]
- mention chip 在历史评论渲染时点击 → `navigate(/audit?actor=${userId})` 跳转用户审计追溯
- **新建** `apps/web/src/components/UserPicker.tsx`（如不存在）：受控 popup，列表 + 上下键 + 回车选中

**改** `CommentsPanel.tsx:44-56` 简易 textarea → 替换为 `<CommentInput />`；展示历史评论时把 mentions 还原成可点击 chip。

### C3. ReviewWorkbench 画布批注层

**改** `apps/web/src/pages/Review/ReviewWorkbench.tsx`

- 在现有 `ImageStage` 之上叠加一个 Konva `Layer`（z-index 高于标注层）
- 工具栏新增「红圈批注」按钮（仅 reviewer 可见），激活后画 `Konva.Line` / `Konva.Arrow`
- 提交评论时把 stage 上的批注序列化为 svg path 字符串数组 → 写入 `canvas_drawing` 字段
- annotator 端 `WorkbenchShell` 渲染历史评论时若该评论有 `canvas_drawing` → 在画布上以只读 overlay 显示 reviewer 批注（用户可在 inspector 面板点开评论时高亮）

### 验证

- 评论输入 `@张三 这里漏标了` → 数据库 mentions = `[{userId, displayName, offset, length}]`
- 上传一张图作为附件 → MinIO 桶有 `comment-attachments/{aid}/...` key → 评论详情可下载
- reviewer 在画布画一个红圈提交 → annotator 端看到红圈半透明 overlay
- 防御：mentions 含非项目成员 userId → 422；attachments storageKey 不含前缀 → 422
- pytest 加 4 个 case：合法 mentions、非法 userId、合法 attachment、非法 storageKey
- 前端 vitest 加 CommentInput 序列化往返测试

---

## 执行顺序

| 阶段 | 内容 | 预估 |
|---|---|---|
| A | OfflineQueueDrawer + 导出复选框 + HotkeyCheatSheet 动态 | 1 PR |
| B1 | 属性 schema 余项（AI predict + audit） | 同 A 或独立小 PR |
| B2 | OpenAPI codegen 迁移（生成 + 替换 + gate） | 独立 PR（要全仓 tsc 跑通） |
| C | 评论 polish 三层（alembic + 后端 + CommentInput + Konva overlay） | 独立 PR，最后做 |

阶段 A → B1 → B2 → C 顺序执行，每完成一阶段给 ROADMAP.md 划掉对应行。

## 全局验证

1. `cd apps/api && pytest` — 后端 audit + comment 新增测试全绿
2. `cd apps/web && pnpm tsc --noEmit && pnpm test && pnpm build` — 前端类型 + vitest + prebuild gate 全绿
3. 手测 5 条核心流程：
   - 断网创建标注 → 抽屉显示 → 恢复 → 真实 id 替换 → undo 仍正确
   - 项目导出勾/不勾 attributes → zip 内容差异
   - 项目配置 attribute schema with hotkey → cheatsheet 第 6 组出现
   - PATCH 标注 attributes → audit_logs 出现 `annotation.attribute_change` 行
   - 评论中 @某成员 + 上传附件 + reviewer 画红圈 → annotator 端能看见
4. ROADMAP.md「v0.5.5 phase 2 部分落地的延续」段落全部划掉或删除

## Out of scope

- 阶段 A 不做 ProjectsPage/DashboardPage 其它 dropdown 收编（roadmap 另一行 P2 项，独立做）
- 不做 OfflineQueueDrawer 的「按 task 分组」「队列容量上限」等高级特性
- 评论 polish 不做 markdown 渲染、不做 reaction emoji、不做引用回复
- AI predict description 仅做项目级 schema 字段的浅层映射，不做多语言/i18n
