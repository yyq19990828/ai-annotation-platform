import { useEffect, useRef, useState } from "react";

const RING_SIZE = 20;
const MIN_SAMPLES = 10;

/**
 * 会话级统计：每次 currentTaskId 变化记录与上次切换的间隔，作为单题平均耗时。
 * < 10 个样本 → 不报 ETA（避免极端值）。
 */
export function useSessionStats(currentTaskId: string | null) {
  const lastTickRef = useRef<number | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const [samples, setSamples] = useState<number[]>([]);

  useEffect(() => {
    if (!currentTaskId) return;
    if (lastIdRef.current && lastIdRef.current !== currentTaskId && lastTickRef.current) {
      const dt = Date.now() - lastTickRef.current;
      // 排除 < 1.5s 的误触（点错任务立即跳回）和 > 30min 的离开座位
      if (dt > 1500 && dt < 30 * 60 * 1000) {
        setSamples((arr) => {
          const next = [...arr, dt];
          return next.length > RING_SIZE ? next.slice(-RING_SIZE) : next;
        });
      }
    }
    lastIdRef.current = currentTaskId;
    lastTickRef.current = Date.now();
  }, [currentTaskId]);

  const avgMs = samples.length >= MIN_SAMPLES
    ? samples.reduce((a, b) => a + b, 0) / samples.length
    : null;

  function etaMs(remainingCount: number): number | null {
    if (avgMs === null || remainingCount <= 0) return null;
    return Math.round(avgMs * remainingCount);
  }

  return { avgMs, samplesCount: samples.length, etaMs };
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
