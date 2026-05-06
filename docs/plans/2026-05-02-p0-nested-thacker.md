# ROADMAP P0 收口 + 杂项 quick win 实施计划

## Context

ROADMAP「v0.6.2 落地后发现的尾巴」中列出了 5 项「必修硬伤」，目前在主分支上仍未修复，会出现「看起来正常但实际坏」：
1. 评论附件链接点击 404（端点不存在）
2. tmpId 上的 undo 必然 404 + 视觉撤销失败
3. 离线 create→update/delete 链路跨 op 仍带 tmpId 导致后续同步 404
4. polygon 创建无离线兜底；bbox 的 update/delete 离线时缺乏乐观 cache 更新
5. alembic 0020 不会自动应用，部署时「列不存在」

本计划把这 5 项一起修掉，同时顺手做两个**与 P0 改动文件强相关的** quick win（不扩散范围）：
- 离线队列 op 加 `retry_count` 字段（同改 `offlineQueue.ts`，让 drain 失败可观测）
- 后端 attribute_change 审计行批量 flush（同属后端运维优化，1 个 PATCH 改 N 属性 → 一次 flush）

## P0-A · 评论附件下载端点

**改动文件：**
- `apps/api/app/api/v1/annotation_comments.py`（新增 GET 路由）
- `apps/web/src/pages/Workbench/shell/CommentsPanel.tsx:135`（替换 href）

**后端实现（追加在 `comment_attachment_upload_init` 之后）：**

```python
@router.get("/annotations/{annotation_id}/comment-attachments/download")
async def comment_attachment_download(
    annotation_id: uuid.UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(*_ALL_ANNOTATORS)),
):
    expected_prefix = f"{ATTACHMENT_KEY_PREFIX}{annotation_id}/"
    if not key.startswith(expected_prefix):
        raise HTTPException(status_code=400, detail="invalid attachment key")
    ann = await db.get(Annotation, annotation_id)
    if not ann or not ann.is_active:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if ann.project_id is not None:
        await assert_project_visible(ann.project_id, db, current_user)
    url = storage_service.generate_download_url(key, expires_in=300)
    return RedirectResponse(url, status_code=302)
```

需在文件顶部 import 增加 `from fastapi.responses import RedirectResponse` 和 `from app.deps import assert_project_visible`。`require_roles(*_ALL_ANNOTATORS)` 已在文件中定义，不引入额外角色。`expires_in=300`：下载链接 5 分钟够用，比上传更短，降低分享风险。

**前端实现：** `CommentsPanel.tsx:135` 把
```tsx
href={`/api/v1/files/download?key=${encodeURIComponent(a.storageKey)}`}
```
改为（需要拿到 annotationId — 已在 prop 链路上 `annotationId={selectedId}`，组件内已知）：
```tsx
href={`/api/v1/annotations/${annotationId}/comment-attachments/download?key=${encodeURIComponent(a.storageKey)}`}
```

**验证：** ① 上传一张图片附件 → 点附件 → 浏览器跟随 302 → 看到图片 ② 改 storageKey 前缀（如借另一个 annotation 的 key）→ 期望 400 ③ 切登出再访问 → 401。

---

## P0-B · 离线 tmpId 三件套（applyLeaf undo / 跨 op 替换 / polygon + update/delete 乐观 cache）

**改动文件：**
- `apps/web/src/pages/Workbench/state/offlineQueue.ts`（增 `replaceAnnotationId` API + `retry_count` 字段）
- `apps/web/src/pages/Workbench/state/useAnnotationHistory.ts`（applyLeaf create undo 检测 tmpId 走纯本地分支）
- `apps/web/src/pages/Workbench/shell/WorkbenchShell.tsx`（executeOp create 成功调 replaceAnnotationId；submitPolygon / handleCommitMove / handleCommitResize / handleDeleteBox 加乐观 cache）

### B-1 offlineQueue.ts 增 `replaceAnnotationId`

在 `removeById` 之后追加：

```typescript
/** v0.6.3 P0：离线 create 成功拿到 realId 后，把队列里后续 update/delete op 的 annotationId 同步替换。
 *  调用方：WorkbenchShell.executeOp 的 create 分支。 */
export async function replaceAnnotationId(oldId: string, newId: string): Promise<void> {
  const q = await load();
  let changed = false;
  for (const op of q) {
    if ((op.kind === "update" || op.kind === "delete") && op.annotationId === oldId) {
      op.annotationId = newId;
      changed = true;
    }
  }
  if (changed) await persist();
}
```

### B-2 useAnnotationHistory.ts: applyLeaf create undo tmpId 分支

需要给 hook 注入两个能力：① 从 cache 删 tmpId 条目 ② 从离线队列删对应 create op。最小入侵方案：在 `HistoryHandlers` 加可选钩子 `removeLocalCreate?: (annotationId: string) => Promise<void> | void`，由 `WorkbenchShell` 实例化时注入（闭包内访问 `queryClient` 和 `offlineQueue`）。

`useAnnotationHistory.ts:60-66` 改为：

```typescript
if (cmd.kind === "create") {
  if (direction === "undo") {
    if (cmd.annotationId.startsWith("tmp_") && h.removeLocalCreate) {
      await h.removeLocalCreate(cmd.annotationId);
    } else {
      await h.deleteAnnotation(cmd.annotationId);
    }
  } else {
    const fresh = await h.createAnnotation(cmd.payload);
    cmd.annotationId = fresh.id;
  }
}
```

### B-3 WorkbenchShell.executeOp create 成功后跨队列替换 annotationId

`WorkbenchShell.tsx:375-380` 在 `history.replaceAnnotationId` + `setQueryData` 之后追加：
```typescript
await offlineQueueModule.replaceAnnotationId(op.tmpId, real.id);
```
（import 用现有 `enqueue` 同名空间，新增导入 `replaceAnnotationId as queueReplaceAnnotationId`）。

并在传给 `useAnnotationHistory` 的 handlers 里注入 `removeLocalCreate`：
```typescript
removeLocalCreate: async (id: string) => {
  // 1. 从 cache 删
  if (!taskId) return;
  queryClient.setQueryData<AnnotationResponse[]>(
    ["annotations", taskId],
    (prev) => (prev ?? []).filter((a) => a.id !== id),
  );
  // 2. 从离线队列删对应 create op
  const all = await offlineQueueGetAll();
  const target = all.find((op) => op.kind === "create" && op.tmpId === id);
  if (target) await offlineQueueRemoveById(target.id);
},
```

### B-4 submitPolygon 套用 tmpId 乐观插入模板

`WorkbenchShell.tsx:276-301` 把 `createAnnotation.mutate(payload, { onSuccess: ... })` 增加 `onError` 与 bbox 等价的乐观插入分支（参照 `handlePickPendingClass:632-663`），抽出公共闭包 `optimisticInsertOnError(payload)` 复用即可。

### B-5 handleCommitMove / handleCommitResize / handleDeleteBox 加乐观 cache

三个位置（711-727 / 755-775 / 464-478）的 `enqueueOnError` fallback 内，先 `setQueryData` 立即把变更写入 cache，再 enqueue：

- update：`(prev ?? []).map(a => a.id === id ? { ...a, geometry: afterG } : a)`
- delete：`(prev ?? []).filter(a => a.id !== id)`

**验证：** ① 离线画一个 bbox → Ctrl+Z → 框消失（不是 toast 报错）② 离线 create→update→恢复在线 → 后端均成功，无 404 ③ 离线断网拖动框 → 立即看到位置变更 ④ 离线画 polygon → 立即看到，恢复在线后入库。

---

## P0-C · alembic 自动应用

**决策：** 用 entrypoint 脚本，不改 docker-compose（api service 整段被注释，本地开发用 `cd apps/api && alembic upgrade head && uvicorn`）。容器化部署用 entrypoint 自动跑 migration。

**改动：**
- 新增 `apps/api/scripts/entrypoint.sh`：
```bash
#!/bin/sh
set -e
alembic upgrade head
exec "$@"
```
- `infra/docker/Dockerfile.api` 改 CMD：
```dockerfile
COPY apps/api/scripts/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```
- `DEV.md` 部署章节加一行：本地启动需先 `cd apps/api && alembic upgrade head`。

**验证：** ① 在 dev 库 `alembic downgrade -1` → 删 entrypoint 之外重启 uvicorn → 期望写评论失败（缺 0020 列）② 改成 entrypoint → 重起容器 → 启动日志含 `Running upgrade ... -> 0020`，写评论恢复。

---

## 杂项 quick win（与 P0 改动文件同区域）

### Q-1 离线队列 op 加 `retry_count`

`offlineQueue.ts` 的 `OfflineOp` 联合类型每个分支加可选 `retry_count?: number`；`drain` 失败一次时把 `q[0].retry_count = (q[0].retry_count ?? 0) + 1` 然后 persist 再 break。`OfflineQueueDrawer`（如有）显示该字段；本计划不改 drawer UI，仅落字段，未来抽屉就能直接读。

### Q-2 后端 attribute_change 审计行批量插

文件位置：`apps/api/app/api/v1/tasks.py`（`PATCH /annotations/{id}` 内对每个变化的 attribute key 单独 `await AuditService.log()`）。改为：先收集 `entries: list[AuditLog]`，循环结束 `db.add_all(entries)` + `await db.flush()` 一次。`AuditService.log` 当前是否有「攒批」入口需要确认；若没有，本任务在 `app/services/audit.py` 加一个 `log_many(entries: list[dict])` 公共方法，逻辑与 `log` 单条对齐但不 flush，flush 由调用方控制。

**验证：** pytest 测一次 PATCH 改 N 个 attributes，断言 ① audit_logs 多 N 行 ② 数据库 round-trip 次数从 N 降到 1（用 SQL echo 或事件钩子验）。

---

## 实施顺序与验证

1. **后端 P0-A（评论附件下载）** → curl 验证 302。
2. **后端 P0-C（entrypoint）** → docker build + 启动日志。
3. **后端 Q-2（attribute_change 批量）** → pytest。
4. **前端 P0-B-1（offlineQueue replaceAnnotationId + retry_count）** → 单测 / 手测。
5. **前端 P0-B-2（useAnnotationHistory removeLocalCreate）**。
6. **前端 P0-B-3/4/5（WorkbenchShell executeOp + polygon + update/delete 乐观 cache）**。
7. **前端 P0-A（CommentsPanel href 改写）**。
8. **联调：** 模拟离线 → 画 bbox + polygon + 拖动 + 删除 + Ctrl+Z → 恢复在线 → 看 IndexedDB 队列清空、cache 实际数据与服务器一致。

## 不做（本期外）

- WorkbenchShell 拆 hook（A 应修级，体量大，单独立项）
- OfflineQueueDrawer 按 task 分组 / retry_count 视觉呈现（先落字段，UI 下期）
- alembic drift CI 校验（B 测试/工程化项）
- 评论附件 90 天 TTL（需要 MinIO bucket lifecycle + celery，独立）
