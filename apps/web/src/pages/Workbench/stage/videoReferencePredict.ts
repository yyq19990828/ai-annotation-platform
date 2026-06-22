/**
 * 视频参考框「运动预测」本地配置(实验特性,localStorage)。
 *
 * 三档 mode + 两档 preset,编码进单个 token 存 localStorage:
 *   off            参考框 = 最近关键帧 bbox(默认 = 现状,守「默认=现状」红线)
 *   linear         前两个可见关键帧恒速外推到当前帧(恒速卡尔曼的预测步)
 *   kalman-stable  完整恒速卡尔曼,平稳档(信模型,顺滑抗噪)
 *   kalman-agile   完整恒速卡尔曼,灵敏档(信观测,紧跟最新关键帧)
 *
 * 向后兼容:旧值 "1"/"true" 读为 linear。
 * 用一个极小的外部 store(useSyncExternalStore)让设置抽屉切换后**无需刷新**即时生效。
 */
import { useSyncExternalStore } from "react";

export const VIDEO_REFERENCE_PREDICT_STORAGE_KEY = "wb:video:referencePredict";

export type VideoReferenceMode = "off" | "linear" | "kalman";
export type VideoReferencePreset = "stable" | "agile";

export interface VideoReferenceConfig {
  mode: VideoReferenceMode;
  preset: VideoReferencePreset;
}

/** 设置项 token(localStorage 真值,也是设置抽屉 select 的 value)。 */
export type VideoReferenceSetting = "off" | "linear" | "kalman-stable" | "kalman-agile";

const DEFAULT_SETTING: VideoReferenceSetting = "off";
const DEFAULT_CONFIG: VideoReferenceConfig = { mode: "off", preset: "stable" };

const listeners = new Set<() => void>();
// useSyncExternalStore 要求 getSnapshot 返回稳定引用 → 缓存解析后的 config,写时失效。
let cachedConfig: VideoReferenceConfig | null = null;

function readSetting(): VideoReferenceSetting {
  if (typeof window === "undefined") return DEFAULT_SETTING;
  try {
    const raw = window.localStorage.getItem(VIDEO_REFERENCE_PREDICT_STORAGE_KEY);
    if (raw === "1" || raw === "true" || raw === "linear") return "linear";
    if (raw === "kalman-stable" || raw === "kalman-agile" || raw === "off") return raw;
    return DEFAULT_SETTING;
  } catch {
    return DEFAULT_SETTING;
  }
}

function parseSetting(setting: VideoReferenceSetting): VideoReferenceConfig {
  switch (setting) {
    case "linear":
      return { mode: "linear", preset: "stable" };
    case "kalman-stable":
      return { mode: "kalman", preset: "stable" };
    case "kalman-agile":
      return { mode: "kalman", preset: "agile" };
    default:
      return DEFAULT_CONFIG;
  }
}

function readConfig(): VideoReferenceConfig {
  if (!cachedConfig) cachedConfig = parseSetting(readSetting());
  return cachedConfig;
}

/** 设置抽屉读 token。 */
export function readVideoReferenceSetting(): VideoReferenceSetting {
  return readSetting();
}

/** 设置抽屉写 token。 */
export function writeVideoReferenceSetting(value: VideoReferenceSetting): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(VIDEO_REFERENCE_PREDICT_STORAGE_KEY, value);
    } catch {
      /* local device flag is best-effort */
    }
  }
  cachedConfig = null;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 画布 / 侧栏读解析后的 mode + preset。 */
export function useVideoReferenceConfig(): VideoReferenceConfig {
  return useSyncExternalStore(subscribe, readConfig, () => DEFAULT_CONFIG);
}
