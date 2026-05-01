// v0.6.3 P1：从 WorkbenchShell 拆出的离线队列接线层。
// 集中管理：online 状态 + 单条 op 远端执行 + drain 全量同步 + drawer 开关
// + 错误归类（网络抖动入队 / 业务错 toast）。
//
// 不在这里管的：乐观 cache 写入（依赖 taskId / projectId / meUserId / s.setSelectedId 太多 shell 上下文，
// 仍由 WorkbenchShell 持有 `optimisticEnqueueCreate` helper），以及 history 的 push 行为本身。

import { useCallback, useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { tasksApi } from "@/api/tasks";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import type { AnnotationResponse } from "@/types";

import {
  drain,
  isOfflineCandidate,
  replaceAnnotationId as offlineQueueReplaceAnnotationId,
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
}

export interface UseWorkbenchOfflineQueueReturn {
  online: boolean;
  queueCount: number;
  /** 网络抖动 / 5xx → fallback() 入队；业务错（4xx 等）→ 直接 toast */
  enqueueOnError: (err: unknown, fallback: () => void) => void;
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
}: UseWorkbenchOfflineQueueArgs): UseWorkbenchOfflineQueueReturn {
  const { online, queueCount } = useOnlineStatus();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const enqueueOnError = useCallback((err: unknown, fallback: () => void) => {
    if (isOfflineCandidate(err)) {
      fallback();
      pushToast({ msg: "已暂存到离线队列", sub: "恢复连接后将自动同步", kind: "warning" });
    } else {
      pushToast({ msg: "操作失败", sub: String(err), kind: "error" });
    }
  }, [pushToast]);

  const flushOne = useCallback(async (op: OfflineOp) => {
    if (op.kind === "create") {
      const real = await tasksApi.createAnnotation(
        op.taskId,
        op.payload as Parameters<typeof tasksApi.createAnnotation>[1],
      );
      if (op.tmpId) {
        history.replaceAnnotationId(op.tmpId, real.id);
        queryClient.setQueryData<AnnotationResponse[]>(
          ["annotations", op.taskId],
          (prev) => (prev ?? []).map((a) => (a.id === op.tmpId ? real : a)),
        );
        // v0.6.3 P0：跨队列替换 tmpId → realId，保后续 update/delete 不 404
        await offlineQueueReplaceAnnotationId(op.tmpId, real.id);
      } else {
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
  }, [history, queryClient]);

  const flushAll = useCallback(async () => {
    const result = await drain(flushOne);
    if (result.ok > 0) {
      queryClient.invalidateQueries({ queryKey: ["annotations"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      pushToast({ msg: `已同步 ${result.ok} 条离线操作`, kind: "success" });
    }
    if (result.failed > 0) {
      pushToast({ msg: "部分操作仍未能同步", sub: "请检查网络后重试", kind: "warning" });
    }
  }, [flushOne, queryClient, pushToast]);

  // online 事件触发自动 flush
  useEffect(() => {
    if (online && queueCount > 0) flushAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return {
    online,
    queueCount,
    enqueueOnError,
    flushOne,
    flushAll,
    drawerOpen,
    openDrawer,
    closeDrawer,
  };
}
