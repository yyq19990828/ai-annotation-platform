import { useState, useEffect, useRef, useCallback } from "react";
import { tasksApi } from "@/api/tasks";
import type { TaskLockResponse } from "@/types";

const HEARTBEAT_INTERVAL_MS = 60_000;

export function useTaskLock(taskId: string | undefined) {
  const [lock, setLock] = useState<TaskLockResponse | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
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
    if (!taskId) {
      setLock(null);
      setLockError(null);
      setRemainingMs(0);
      return;
    }

    if (currentTaskRef.current && currentTaskRef.current !== taskId) {
      release(currentTaskRef.current);
    }
    currentTaskRef.current = taskId;

    let cancelled = false;

    async function acquire() {
      try {
        const result = await tasksApi.acquireLock(taskId!);
        if (!cancelled) {
          setLock(result);
          setLockError(null);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setLock(null);
          const msg = err instanceof Error ? err.message : "Task is locked";
          setLockError(msg);
        }
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
          }
        } catch {
          if (!cancelled) {
            setLock(null);
            setLockError("Lock expired");
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
  }, [taskId, release]);

  return { lock, lockError, remainingMs, isLocked: !!lock };
}
