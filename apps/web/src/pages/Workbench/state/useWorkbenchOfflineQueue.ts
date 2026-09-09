// v0.6.3 P1：从 WorkbenchShell 拆出的离线队列接线层。
// 集中管理：online 状态 + 单条 op 远端执行 + drain 全量同步 + drawer 开关
// + 错误归类（网络抖动入队 / 业务错 toast）。
//
// 不在这里管的：乐观 cache 写入（依赖 taskId / projectId / meUserId / s.setSelectedId 太多 shell 上下文，
// 仍由 WorkbenchShell 持有 `optimisticEnqueueCreate` helper），以及 history 的 push 行为本身。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { tasksApi } from "@/api/tasks";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { isCurrentAuthOwner } from "@/stores/authStore";
import type { AnnotationResponse } from "@/types";

import {
  drain,
  isOfflineCandidate,
  replaceAnnotationId as offlineQueueReplaceAnnotationId,
  type OfflineQueueScope,
  type OfflineOp,
} from "./offlineQueue";

interface ToastInput {
  msg: string;
  sub?: string;
  kind?: "success" | "warning" | "error" | "";
}

interface HistoryLike {
  replaceAnnotationId: (oldId: string, newId: string) => void;
}

export interface UseWorkbenchOfflineQueueArgs {
  history: HistoryLike;
  queryClient: QueryClient;
  pushToast: (toast: ToastInput) => void;
  /** The account that owns the current Workbench queue. */
  userId?: string | null;
  /** Current task owner for history/UI writebacks; queue syncing may include other tasks. */
  taskId?: string;
}

export interface UseWorkbenchOfflineQueueReturn {
  online: boolean;
  queueCount: number;
  queueReady: boolean;
  queueScope?: OfflineQueueScope;
  syncError: string | null;
  /** 网络抖动 / 5xx → fallback() 入队；业务错（4xx 等）→ 直接 toast */
  enqueueOnError: (err: unknown, fallback: () => void | Promise<void>) => Promise<void>;
  /** 单条 op 的远端执行；create 成功时调 history.replaceAnnotationId + 改 cache + 跨队列替换 tmpId */
  flushOne: (op: OfflineOp) => Promise<void>;
  /** 顺序消费整个队列；带 toast 通知与 invalidate */
  flushAll: () => Promise<void>;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export function useWorkbenchOfflineQueue({
  history,
  queryClient,
  pushToast,
  userId,
  taskId,
}: UseWorkbenchOfflineQueueArgs): UseWorkbenchOfflineQueueReturn {
  const queueScope = useMemo<OfflineQueueScope | undefined>(() => {
    return {
      userId: userId ?? "",
      isCurrent: () => !!userId && isCurrentAuthOwner(userId),
    };
  }, [userId]);
  const { online, queueCount, queueReady, queueReadError } = useOnlineStatus(queueScope);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const currentTaskRef = useRef<string | undefined>(taskId);
  currentTaskRef.current = taskId;

  useEffect(() => {
    setSyncError(null);
  }, [userId]);
  useEffect(() => {
    if (queueCount === 0) setSyncError(null);
  }, [queueCount]);

  const assertCurrentOwner = useCallback(() => {
    if (!queueScope || !isCurrentAuthOwner(queueScope.userId)) {
      throw new Error("离线队列所属账号已切换，已暂停同步");
    }
  }, [queueScope]);

  const enqueueOnError = useCallback(
    async (err: unknown, fallback: () => void | Promise<void>) => {
      const ownsUi = () =>
        !!userId && isCurrentAuthOwner(userId) && currentTaskRef.current === taskId;
      if (isOfflineCandidate(err)) {
        try {
          await fallback();
          if (!ownsUi()) return;
          pushToast({ msg: "已暂存到离线队列", sub: "恢复连接后将自动同步", kind: "warning" });
        } catch {
          if (!ownsUi()) return;
          setSyncError("无法保存到本机，请保留当前页面并检查浏览器存储");
          pushToast({ msg: "本机保存失败，修改尚未保存", kind: "error" });
        }
      } else {
        if (!ownsUi()) return;
        pushToast({ msg: "操作失败", sub: String(err), kind: "error" });
      }
    },
    [pushToast, taskId, userId],
  );

  const flushOne = useCallback(
    async (op: OfflineOp) => {
      try {
        assertCurrentOwner();
        if (!op.userId || op.userId !== userId) {
          throw new Error("离线操作没有当前账号归属，已保留待原账号处理");
        }
        if (op.kind === "create") {
          const real = await tasksApi.createAnnotation(
            op.taskId,
            op.payload as Parameters<typeof tasksApi.createAnnotation>[1],
            op.id,
          );
          const canWriteCurrentTask =
            !!userId && isCurrentAuthOwner(userId) && currentTaskRef.current === op.taskId;
          if (op.tmpId) {
            // A queue can contain another task from the same account. Its server
            // result is safe to cache, but the current task's history owner is not.
            if (canWriteCurrentTask) {
              history.replaceAnnotationId(op.tmpId, real.id);
              queryClient.setQueryData<AnnotationResponse[]>(["annotations", op.taskId], (prev) =>
                (prev ?? []).map((a) =>
                  a.id === op.tmpId ? { ...real, render_key: a.render_key ?? op.tmpId } : a,
                ),
              );
            }
            // v0.6.3 P0：跨队列替换 tmpId → realId，保后续 update/delete 不 404
            await offlineQueueReplaceAnnotationId(op.tmpId, real.id, queueScope);
          } else if (canWriteCurrentTask) {
            queryClient.invalidateQueries({ queryKey: ["annotations", op.taskId] });
          }
        } else if (op.kind === "update") {
          await tasksApi.updateAnnotation(
            op.taskId,
            op.annotationId,
            op.payload as Parameters<typeof tasksApi.updateAnnotation>[2],
          );
        } else {
          await tasksApi.deleteAnnotation(op.taskId, op.annotationId);
        }
      } catch (error) {
        if (userId && isCurrentAuthOwner(userId))
          setSyncError("离线操作同步失败，请检查网络或任务权限后重试");
        throw error;
      }
    },
    [assertCurrentOwner, currentTaskRef, history, queryClient, queueScope, userId],
  );

  const flushAll = useCallback(async () => {
    if (!queueScope) return;
    const result = await drain(flushOne, queueScope);
    if (!queueScope.isCurrent?.()) return;
    if (result.ok > 0) {
      setSyncError(null);
      queryClient.invalidateQueries({ queryKey: ["annotations"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      pushToast({ msg: `已同步 ${result.ok} 条离线操作`, kind: "success" });
    }
    if (result.failed > 0) {
      setSyncError("部分离线操作同步失败");
      pushToast({ msg: "部分操作仍未能同步", sub: "请检查网络后重试", kind: "warning" });
    }
  }, [flushOne, pushToast, queryClient, queueScope]);

  const flushAllRef = useRef(flushAll);
  flushAllRef.current = flushAll;
  // Retry on connection/queue changes, not on every history or error render.
  useEffect(() => {
    if (online && queueReady && queueCount > 0) void flushAllRef.current();
  }, [online, queueCount, queueReady, userId]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return {
    online,
    queueCount,
    queueReady,
    queueScope,
    syncError: queueReadError ?? syncError,
    enqueueOnError,
    flushOne,
    flushAll,
    drawerOpen,
    openDrawer,
    closeDrawer,
  };
}
