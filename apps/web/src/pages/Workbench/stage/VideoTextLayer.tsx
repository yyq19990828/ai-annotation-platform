import { useEffect, useRef } from "react";
import { VIDEO_LABEL_OFFSET } from "./boxVisual";
import type { VideoStageGeom } from "./videoStageTypes";
import styles from "./VideoTextLayer.module.css";

export type VideoLabelEntry = {
  key: string;
  geom: VideoStageGeom;
  color: string;
  text: string;
  opacity?: number;
};

interface VideoTextLayerProps {
  labels: VideoLabelEntry[];
  // v0.15.27 · 标签字号基准 px(common.labelFontSize);视频固定 CSS px,不随画布缩放。
  fontSize: number;
}

export function VideoTextLayer({ labels, fontSize }: VideoTextLayerProps) {
  return (
    <div
      data-testid="video-label-overlay"
      data-layer="text"
      className={styles.overlay}
    >
      {labels.map((label) => (
        <VideoLabel
          key={label.key}
          label={label}
          fontSize={fontSize}
        />
      ))}
    </div>
  );
}

function VideoLabel({ label, fontSize }: { label: VideoLabelEntry; fontSize: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--video-label-left", `${Math.max(0, Math.min(98, label.geom.x * 100))}%`);
    el.style.setProperty("--video-label-top", `${Math.max(0, Math.min(100, label.geom.y * 100))}%`);
    el.style.setProperty(
      "--video-label-translate",
      label.geom.y > VIDEO_LABEL_OFFSET ? "translateY(calc(-100% - 4px))" : "translateY(4px)",
    );
    el.style.setProperty("--video-label-padding-y", `${Math.max(2, fontSize / 4)}px`);
    el.style.setProperty("--video-label-padding-x", `${Math.max(5, fontSize / 2)}px`);
    el.style.setProperty("--video-label-bg", label.color);
    el.style.setProperty("--video-label-font-size", `${fontSize}px`);
    el.style.setProperty("--video-label-opacity", `${label.opacity ?? 1}`);
  }, [label.color, label.geom.x, label.geom.y, label.opacity, fontSize]);

  return (
    <div
      ref={ref}
      data-testid="video-label"
      data-color={label.color}
      className={styles.label}
    >
      {label.text}
    </div>
  );
}
