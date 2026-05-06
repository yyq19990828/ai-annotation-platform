import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { meApi, type TaskEventIn } from "../../../api/me";

const RING_SIZE = 20;
const MIN_SAMPLES = 10;
const FLUSH_THRESHOLD = 20;

/**
 * 会话级统计：每次 currentTaskId 变化记录与上次切换的间隔，作为单题平均耗时。
 * < 10 个样本 → 不报 ETA（避免极端值）。
 *
 * v0.8.4：同时缓冲 task_events 并在 buffer >= 20 / unmount 时 flush 到
 * POST /auth/me/task-events:batch。projectId 缺失时不上报（仅本地 ETA）。
 */
export function useSessionStats(
  currentTaskId: string | null,
  projectId?: string | null,
  kind: "annotate" | "review" = "annotate",
) {
  const lastTickRef = useRef<number | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const pendingRef = useRef<TaskEventIn[]>([]);
  const [samples, setSamples] = useState<number[]>([]);

  useEffect(() => {
    if (!currentTaskId) return;
    if (lastIdRef.current && lastIdRef.current !== currentTaskId && lastTickRef.current) {
      const dt = Date.now() - lastTickRef.current;
      // 排除 < 1.5s 的误触（点错任务立即跳回）和 > 30min 的离开座位
      if (dt > 1500 && dt < 30 * 60 * 1000) {
        setSamples((arr: number[]) => {
          const next = [...arr, dt];
          return next.length > RING_SIZE ? next.slice(-RING_SIZE) : next;
        });
        // 同时缓冲一条上报事件（仅当 projectId 已知；前一题 task_id 才是耗时归属）
        if (projectId) {
          const startedAt = new Date(lastTickRef.current).toISOString();
          const endedAt = new Date(lastTickRef.current + dt).toISOString();
          pendingRef.current.push({
            task_id: lastIdRef.current,
            project_id: projectId,
            kind,
            started_at: startedAt,
            ended_at: endedAt,
            duration_ms: dt,
          });
          if (pendingRef.current.length >= FLUSH_THRESHOLD) {
            void flushPending(pendingRef);
          }
        }
      }
    }
    lastIdRef.current = currentTaskId;
    lastTickRef.current = Date.now();
  }, [currentTaskId, projectId, kind]);

  // unmount / page hide → 兜底 flush（sendBeacon 已不需要，apiClient 同步带 token）
  useEffect(() => {
    const onHide = () => {
      void flushPending(pendingRef);
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      void flushPending(pendingRef);
    };
  }, []);

  const avgMs = samples.length >= MIN_SAMPLES
    ? samples.reduce((a: number, b: number) => a + b, 0) / samples.length
    : null;

  function etaMs(remainingCount: number): number | null {
    if (avgMs === null || remainingCount <= 0) return null;
    return Math.round(avgMs * remainingCount);
  }

  return { avgMs, samplesCount: samples.length, etaMs };
}

async function flushPending(ref: MutableRefObject<TaskEventIn[]>) {
  if (ref.current.length === 0) return;
  const batch = ref.current.splice(0, ref.current.length);
  try {
    await meApi.submitTaskEvents(batch);
  } catch {
    // 失败 → 静默丢弃，不影响标注。后端有 sync fallback 路径，broker 抖动可恢复。
    // 不重新入队，避免雪崩。
  }
}

/** 把毫秒格式化为 mm:ss / h:mm。 */
export function formatDuration(ms: number): string {
  if (ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
