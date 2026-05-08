/**
 * v0.9.4 phase 2 · SAM text 输出模式工具.
 *
 * 智能默认按项目 type_key:
 *   image-det → "box"  (DINO 直出, 跳过 SAM mask, 标注员要的就是 bbox)
 *   其它      → "mask" (与 v0.9.2 当前行为一致, 兼容 image-seg / mm / video / lidar)
 *
 * "both" 不作智能默认, 仅作用户 opt-in (Tab 切活跃几何, 复杂度高).
 *
 * 用户切换写 sessionStorage `wb:sam:textOutput:{projectId}` 跨切题保留;
 * 跨 project 不串扰 (key 含 projectId).
 */

import type { TextOutputMode } from "./useInteractiveAI";

export const SAM_OUTPUT_STORAGE_PREFIX = "wb:sam:textOutput:";

export function samOutputStorageKey(projectId: string): string {
  return `${SAM_OUTPUT_STORAGE_PREFIX}${projectId}`;
}

export function defaultOutputMode(typeKey: string | undefined | null): TextOutputMode {
  if (typeKey === "image-det") return "box";
  return "mask";
}

const VALID: ReadonlySet<TextOutputMode> = new Set(["box", "mask", "both"]);

export function readStoredOutputMode(projectId: string): TextOutputMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(samOutputStorageKey(projectId));
    if (raw && VALID.has(raw as TextOutputMode)) return raw as TextOutputMode;
  } catch {
    // sessionStorage 不可用 (隐私模式 / SSR) 静默回退
  }
  return null;
}

export function writeStoredOutputMode(projectId: string, mode: TextOutputMode): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(samOutputStorageKey(projectId), mode);
  } catch {
    // 同上
  }
}

/**
 * 计算初始 outputMode: 项目级 text_output_default 优先 (v0.9.5 持久化),
 * 其次 sessionStorage (用户最近选择), 最后 type_key 智能默认.
 */
export function resolveInitialOutputMode(
  projectId: string | undefined,
  typeKey: string | undefined | null,
  projectDefault?: string | null | undefined,
): TextOutputMode {
  if (projectDefault && VALID.has(projectDefault as TextOutputMode)) {
    return projectDefault as TextOutputMode;
  }
  if (projectId) {
    const stored = readStoredOutputMode(projectId);
    if (stored) return stored;
  }
  return defaultOutputMode(typeKey);
}
