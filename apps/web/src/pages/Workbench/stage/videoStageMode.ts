import type { VideoDragState } from "./videoStageTypes";

export type VideoStageMode = "idle" | "draw" | "drag" | "resize" | "interact" | "pan" | "zoom";

export interface VideoStageModeGuard {
  mode: VideoStageMode;
  canSetupFrame: boolean;
  canBeginDraw: boolean;
  canBeginDrag: boolean;
  canBeginResize: boolean;
}

export function modeFromDrag(drag: VideoDragState): VideoStageMode {
  if (!drag) return "idle";
  if (drag.kind === "draw") return "draw";
  if (drag.kind === "move") return "drag";
  return "resize";
}

export function getVideoStageModeGuard(mode: VideoStageMode): VideoStageModeGuard {
  const idle = mode === "idle";
  return {
    mode,
    canSetupFrame: idle || mode === "interact" || mode === "pan" || mode === "zoom",
    canBeginDraw: idle,
    canBeginDrag: idle,
    canBeginResize: idle,
  };
}
