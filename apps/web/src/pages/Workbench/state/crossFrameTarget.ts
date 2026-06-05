/**
 * v0.14.1 · 跨帧目标延续的纯决策: 给定 neighbors + 方向, 解析应跳转的目标帧 task,
 * 或区分"无 scene" / "已到首末帧边界"(供调用方出对应 toast)。无副作用, 便于单测。
 */
import type { NeighborsResponse } from "@/types";

export type CrossFrameResolution =
  | { kind: "ok"; taskId: string; frameIndex: number }
  | { kind: "no-scene" }
  | { kind: "boundary"; direction: "next" | "prev" };

export function resolveCrossFrameTarget(
  neighbors: NeighborsResponse | null,
  direction: "next" | "prev",
): CrossFrameResolution {
  if (!neighbors || neighbors.scene_total_frames === 0) {
    return { kind: "no-scene" };
  }
  const target = direction === "next" ? neighbors.next?.[0] : neighbors.prev?.[0];
  if (!target) {
    return { kind: "boundary", direction };
  }
  return { kind: "ok", taskId: target.task_id, frameIndex: target.frame_index };
}
