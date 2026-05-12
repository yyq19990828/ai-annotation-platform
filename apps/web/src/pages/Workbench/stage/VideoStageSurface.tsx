import type { ReactNode } from "react";

interface VideoStageSurfaceProps {
  aspectRatio: string;
  children: ReactNode;
}

export function VideoStageSurface({ aspectRatio, children }: VideoStageSurfaceProps) {
  return (
    <div
      data-testid="video-stage-surface"
      style={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        maxHeight: "100%",
        aspectRatio,
      }}
    >
      {children}
    </div>
  );
}
