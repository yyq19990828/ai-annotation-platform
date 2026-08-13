import { useState, useEffect, useRef, useCallback } from "react";
import { ApiError } from "@/api";
import { tasksApi } from "@/api/tasks";
import type { TaskLockConflictDetail, TaskLockResponse } from "@/types";

const HEARTBEAT_INTERVAL_MS = 60_000;

function parseLockConflict(err: unknown): TaskLockConflictDetail | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const detail = err.detailRaw;
  if (!detail || typeof detail !== "object") return null;
  const typed = detail as TaskLockConflictDetail;
  return typed.reason === "task_locked_by_other" ? typed : null;
}

export function useTaskLock(taskId: string | undefined, enabled = true) {
  const [lock, setLock] = useState<TaskLockResponse | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockConflict, setLockConflict] = useState<TaskLockConflictDetail | null>(null);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const currentTaskRef = useRef<string>();

  const release = useCallback((tid: string) => {
    // v0.6.7 B-13：用 keepalive 保证 DELETE 在 unmount / 页面跳转时仍能送达，
    // 否则浏览器会取消请求 → 残留 lock 行 → 用户重进时被自己的旧锁挡住。
    void tasksApi.releaseLockKeepalive(tid);
  }, []);

  useEffect(() => {
    if (!taskId || !enabled) {
      if (currentTaskRef.current) release(currentTaskRef.current);
      currentTaskRef.current = undefined;
      setLock(null);
      setLockError(null);
      setLockConflict(null);
      setRemainingMs(0);
      return;
    }

    if (currentTaskRef.current && currentTaskRef.current !== taskId) {
      release(currentTaskRef.current);
    }
    currentTaskRef.current = taskId;

    let cancelled = false;

    async function acquire(allowRetry = true): Promise<void> {
      try {
        const result = await tasksApi.acquireLock(taskId!);
        if (!cancelled) {
          setLock(result);
          setLockError(null);
          setLockConflict(null);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        const conflict = parseLockConflict(err);
        if (conflict) {
          // 真冲突：他人持锁 → 显示「该任务正被 X 编辑」横幅
          setLock(null);
          setLockConflict(conflict);
          setLockError("Task is locked by another user");
          return;
        }
        // 非 409（多为退出重进的瞬时竞态：500 / 网络抖动）。重试一次；仍失败则静默，
        // 不把它误渲染成「他人正在编辑」横幅（全局拦截器已对 5xx 弹 toast）。
        if (allowRetry) {
          await acquire(false);
          return;
        }
        setLock(null);
        setLockConflict(null);
      }
    }

    acquire();

    intervalRef.current = setInterval(async () => {
      if (cancelled) return;
      try {
        await tasksApi.heartbeatLock(taskId);
      } catch {
        // lock lost — try to re-acquire once
        try {
          const newLock = await tasksApi.acquireLock(taskId);
          if (!cancelled) {
            setLock(newLock);
            setLockError(null);
            setLockConflict(null);
          }
        } catch (err: unknown) {
          if (!cancelled) {
            setLock(null);
            const conflict = parseLockConflict(err);
            setLockConflict(conflict);
            setLockError(conflict ? "Task is locked by another user" : "Lock expired");
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    // countdown timer: update remainingMs every second
    timerRef.current = setInterval(() => {
      if (cancelled) return;
      setLock((prev) => {
        if (!prev?.expire_at) return prev;
        const ms = new Date(prev.expire_at).getTime() - Date.now();
        setRemainingMs(Math.max(0, ms));
        return prev;
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      clearInterval(timerRef.current);
      release(taskId);
    };
  }, [taskId, enabled, release]);

  return { lock, lockError, lockConflict, remainingMs, isLocked: !!lock };
}
