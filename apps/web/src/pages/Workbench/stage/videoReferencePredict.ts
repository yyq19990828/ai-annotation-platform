/**
 * 视频参考框「运动预测」本地开关(实验特性,localStorage)。
 *
 * 默认关 = 现状:参考框 = 最近关键帧 bbox。开启后参考框改为按当前帧之前最近两个
 * 关键帧恒速外推到当前帧(恒速卡尔曼的预测步)。完整卡尔曼(带噪声平滑)见 ROADMAP。
 *
 * 用一个极小的外部 store(useSyncExternalStore)让设置抽屉切换后**无需刷新**即时生效。
 */
import { useSyncExternalStore } from "react";

export const VIDEO_REFERENCE_PREDICT_STORAGE_KEY = "wb:video:referencePredict";

const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(VIDEO_REFERENCE_PREDICT_STORAGE_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

export function readVideoReferencePredict(): boolean {
  return read();
}

export function writeVideoReferencePredict(value: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(VIDEO_REFERENCE_PREDICT_STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* local device flag is best-effort */
    }
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useVideoReferencePredict(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
