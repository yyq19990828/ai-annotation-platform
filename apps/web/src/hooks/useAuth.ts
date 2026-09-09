import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi, type LoginPayload } from "../api/auth";
import { tasksApi } from "../api/tasks";
import {
  count as offlineQueueCount,
  drain as drainOfflineQueue,
  replaceAnnotationId as replaceOfflineAnnotationId,
  type OfflineOp,
  type OfflineQueueScope,
} from "../pages/Workbench/state/offlineQueue";
import { useAuthStore } from "../stores/authStore";

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth);

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { access_token } = await authApi.login(payload);
      localStorage.setItem("token", access_token);
      const user = await authApi.me().catch((err) => {
        localStorage.removeItem("token");
        throw err;
      });
      setAuth(access_token, user);
      return user;
    },
  });
}

export type LogoutDecision = "sync" | "keep";

export interface LogoutPrompt {
  userId: string;
  pendingCount: number;
}

export interface LogoutController {
  requestLogout: () => Promise<void>;
  confirmLogout: (decision: LogoutDecision) => Promise<void>;
  cancelLogout: () => void;
  prompt: LogoutPrompt | null;
  syncError: string | null;
  isLoggingOut: boolean;
}

function scopeForUser(userId: string): OfflineQueueScope {
  return {
    userId,
    isCurrent: () => useAuthStore.getState().user?.id === userId,
  };
}

async function flushLogoutOperation(op: OfflineOp, scope: OfflineQueueScope): Promise<void> {
  if (op.kind === "create") {
    const real = await tasksApi.createAnnotation(
      op.taskId,
      op.payload as Parameters<typeof tasksApi.createAnnotation>[1],
    );
    if (op.tmpId) await replaceOfflineAnnotationId(op.tmpId, real.id, scope);
    return;
  }
  if (op.kind === "update") {
    await tasksApi.updateAnnotation(
      op.taskId,
      op.annotationId,
      op.payload as Parameters<typeof tasksApi.updateAnnotation>[2],
    );
    return;
  }
  await tasksApi.deleteAnnotation(op.taskId, op.annotationId);
}

/**
 * Logout is deliberately owned here so every caller clears the local auth state
 * only after the best-effort server logout, while the offline queue stays intact.
 */
export function useLogout(): LogoutController {
  const clearLocal = useAuthStore((s) => s.logout);
  const [prompt, setPrompt] = useState<LogoutPrompt | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const completeLogout = useCallback(
    async (ownerId?: string) => {
      const currentUserId = useAuthStore.getState().user?.id;
      if (ownerId && currentUserId && currentUserId !== ownerId) return;
      if (currentUserId) await authApi.logout().catch(() => {});
      if (
        (ownerId && useAuthStore.getState().user?.id !== ownerId) ||
        (!ownerId && useAuthStore.getState().user?.id !== currentUserId)
      )
        return;
      clearLocal();
    },
    [clearLocal],
  );

  const requestLogout = useCallback(async () => {
    const ownerId = useAuthStore.getState().user?.id;
    if (!ownerId) {
      clearLocal();
      return;
    }
    setIsLoggingOut(true);
    try {
      const pendingCount = await offlineQueueCount(scopeForUser(ownerId));
      if (useAuthStore.getState().user?.id !== ownerId) {
        return;
      }
      if (pendingCount > 0) {
        setSyncError(null);
        setPrompt({ userId: ownerId, pendingCount });
        return;
      }
      await completeLogout(ownerId);
    } finally {
      setIsLoggingOut(false);
    }
  }, [clearLocal, completeLogout]);

  const confirmLogout = useCallback(
    async (decision: LogoutDecision) => {
      const pending = prompt;
      if (!pending) return;
      setIsLoggingOut(true);
      try {
        if (decision === "keep") {
          setPrompt(null);
          setSyncError(null);
          await completeLogout(pending.userId);
          return;
        }
        if (useAuthStore.getState().user?.id !== pending.userId) {
          setPrompt(null);
          setSyncError(null);
          return;
        }
        let result: { ok: number; failed: number };
        try {
          const scope = scopeForUser(pending.userId);
          result = await drainOfflineQueue((op) => flushLogoutOperation(op, scope), scope);
        } catch (error) {
          if (useAuthStore.getState().user?.id !== pending.userId) {
            setPrompt(null);
            setSyncError(null);
            return;
          }
          setSyncError(`同步失败：${error instanceof Error ? error.message : String(error)}`);
          return;
        }
        if (useAuthStore.getState().user?.id !== pending.userId) {
          setPrompt(null);
          setSyncError(null);
          return;
        }
        if (result.failed > 0) {
          setSyncError(`仍有 ${result.failed} 条操作未同步，请重试或保留记录并退出`);
          return;
        }
        setPrompt(null);
        setSyncError(null);
        await completeLogout(pending.userId);
      } finally {
        setIsLoggingOut(false);
      }
    },
    [completeLogout, prompt],
  );

  const cancelLogout = useCallback(() => {
    if (!isLoggingOut) {
      setPrompt(null);
      setSyncError(null);
    }
  }, [isLoggingOut]);

  return { requestLogout, confirmLogout, cancelLogout, prompt, syncError, isLoggingOut };
}

export function useLogoutAll() {
  const { setToken } = useAuthStore();
  return useMutation({
    mutationFn: async () => {
      const { access_token } = await authApi.logoutAll();
      setToken(access_token);
    },
  });
}

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}
