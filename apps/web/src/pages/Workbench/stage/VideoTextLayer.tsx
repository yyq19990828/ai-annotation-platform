import {
  BOX_LABEL_FONT_PX,
  VIDEO_LABEL_OFFSET,
} from "./boxVisual";
import type { VideoStageGeom } from "./videoStageTypes";

export type VideoLabelEntry = {
  key: string;
  geom: VideoStageGeom;
  color: string;
  text: string;
  opacity?: number;
};

interface VideoTextLayerProps {
  labels: VideoLabelEntry[];
}

export function VideoTextLayer({ labels }: VideoTextLayerProps) {
  return (
    <div
      data-testid="video-label-overlay"
      data-layer="text"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {labels.map((label) => (
        <div
          key={label.key}
          data-testid="video-label"
          data-color={label.color}
          style={{
            position: "absolute",
            left: `${Math.max(0, Math.min(98, label.geom.x * 100))}%`,
            top: `${Math.max(0, Math.min(100, label.geom.y * 100))}%`,
            transform: label.geom.y > VIDEO_LABEL_OFFSET ? "translateY(calc(-100% - 4px))" : "translateY(4px)",
            maxWidth: "min(220px, calc(100% - 8px))",
            padding: `${Math.max(2, BOX_LABEL_FONT_PX / 4)}px ${Math.max(5, BOX_LABEL_FONT_PX / 2)}px`,
            borderRadius: 3,
            background: label.color,
            color: "white",
            fontSize: BOX_LABEL_FONT_PX,
            fontFamily: "var(--font-sans, sans-serif)",
            fontWeight: 700,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            opacity: label.opacity ?? 1,
            textShadow: "0 1px 2px rgba(0,0,0,0.55)",
            boxShadow: "0 1px 5px rgba(0,0,0,0.28)",
          }}
        >
          {label.text}
        </div>
      ))}
    </div>
  );
}
