import { useEffect, useRef, type ReactNode } from "react";
import type { Viewport } from "../state/useViewportTransform";
import styles from "./VideoStageSurface.module.css";

interface VideoStageSurfaceProps {
  width: number;
  height: number;
  viewport: Viewport;
  children: ReactNode;
}

export function VideoStageSurface({ width, height, viewport, children }: VideoStageSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--video-stage-width", `${width}px`);
    el.style.setProperty("--video-stage-height", `${height}px`);
    el.style.setProperty("--video-stage-transform", `translate(${viewport.tx}px, ${viewport.ty}px) scale(${viewport.scale})`);
  }, [height, viewport.scale, viewport.tx, viewport.ty, width]);

  return (
    <div
      ref={ref}
      data-testid="video-stage-surface"
      className={styles.surface}
    >
      {children}
    </div>
  );
}
