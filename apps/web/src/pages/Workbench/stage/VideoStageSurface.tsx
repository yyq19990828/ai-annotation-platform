import type { ReactNode } from "react";
import type { Viewport } from "../state/useViewportTransform";

interface VideoStageSurfaceProps {
  width: number;
  height: number;
  viewport: Viewport;
  children: ReactNode;
}

export function VideoStageSurface({ width, height, viewport, children }: VideoStageSurfaceProps) {
  return (
    <div
      data-testid="video-stage-surface"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        transform: `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`,
        transformOrigin: "0 0",
      }}
    >
      {children}
    </div>
  );
}
