import { useState, useEffect, useRef, useCallback } from "react";
import { tasksApi } from "@/api/tasks";
import type { TaskLockResponse } from "@/types";

const HEARTBEAT_INTERVAL_MS = 120_000;

export function useTaskLock(taskId: string | undefined) {
  const [lock, setLock] = useState<TaskLockResponse | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const currentTaskRef = useRef<string>();

  const release = useCallback(async (tid: string) => {
    try {
      await tasksApi.releaseLock(tid);
    } catch {
      // ignore release errors
    }
  }, []);

  useEffect(() => {
    if (!taskId) {
      setLock(null);
      setLockError(null);
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
        // lock lost
        if (!cancelled) {
          setLock(null);
          setLockError("Lock expired");
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalRef.current);
      release(taskId);
    };
  }, [taskId, release]);

  return { lock, lockError, isLocked: !!lock };
}
