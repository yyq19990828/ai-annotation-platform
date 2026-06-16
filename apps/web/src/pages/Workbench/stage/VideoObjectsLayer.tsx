import { classColor, getTrackColor } from "./colors";
import { VideoTrackShape } from "./VideoTrackShape";
import type { VideoFrameEntry, VideoStageGeom, VideoTrackPreview } from "./videoStageTypes";
import { isFrameOutside } from "./videoTrackOutside";
import { fillAlpha, strokeWidthFor, type AnnotationVisualConfig } from "./annotationVisual";
import styles from "./VideoObjectsLayer.module.css";

const TRACK_KEYFRAME_DOT_RADIUS = 0.0038;
const TRACK_OCCLUDED_DOT_RADIUS = 0.0052;

type VideoObjectEntry = {
  key: string;
  entry: VideoFrameEntry;
  geom: VideoStageGeom;
  color: string;
  selected: boolean;
  dashed: boolean;
};

interface VideoObjectsLayerProps {
  viewBoxHeight: number;
  entries: VideoObjectEntry[];
  trackPreviews: VideoTrackPreview[];
  trackColorOverrides?: Record<string, string>;
  pendingDraft?: { geom: VideoStageGeom; className: string } | null;
  // v0.15.27 · 共享视觉规格(线宽/填充);视频侧 non-scaling-stroke,原样取最终值。
  visual: AnnotationVisualConfig;
}

export function VideoObjectsLayer({
  viewBoxHeight,
  entries,
  trackPreviews,
  trackColorOverrides,
  pendingDraft,
  visual,
}: VideoObjectsLayerProps) {
  return (
    <svg
      data-testid="video-objects-layer"
      viewBox={`0 0 1 ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      className={styles.layer}
    >
      {trackPreviews.map((preview) => {
        const color = getTrackColor(preview.trackId, preview.className, trackColorOverrides);
        const previewTrack = {
          type: "video_track_bbox" as const,
          track_id: preview.trackId,
          keyframes: preview.keyframes,
          outside: preview.outside,
        };
        const points = [...preview.keyframes]
          .filter((kf) => !isFrameOutside(previewTrack, kf.frame_index))
          .sort((a, b) => a.frame_index - b.frame_index)
          .map((kf) => ({
            frame: kf.frame_index,
            x: kf.bbox.x + kf.bbox.w / 2,
            y: (kf.bbox.y + kf.bbox.h / 2) * viewBoxHeight,
            occluded: Boolean(kf.occluded),
          }));
        if (points.length === 0) return null;
        const showKeyframeDots = preview.selected;
        if (points.length === 1 && !showKeyframeDots) return null;
        const pointAttr = points.map((p) => `${p.x},${p.y}`).join(" ");
        return (
          <g
            key={preview.id}
            data-testid="video-track-path-preview"
            opacity={preview.selected ? 0.82 : 0.42}
          >
            {points.length > 1 && (
              <polyline
                points={pointAttr}
                fill="none"
                stroke={color}
                strokeWidth={preview.selected ? 2.5 : 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={preview.selected ? undefined : "4 4"}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {showKeyframeDots && points.map((p) => (
              <circle
                key={`${preview.id}-${p.frame}`}
                data-testid="video-track-keyframe-dot"
                cx={p.x}
                cy={p.y}
                r={p.occluded ? TRACK_OCCLUDED_DOT_RADIUS : TRACK_KEYFRAME_DOT_RADIUS}
                fill={p.occluded ? "var(--color-bg-elev)" : color}
                stroke={color}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
      {entries.map(({ key, geom, color, selected, dashed }) => (
        <g key={key}>
          <VideoTrackShape
            geom={geom}
            color={color}
            dashed={dashed}
            viewBoxHeight={viewBoxHeight}
            strokeWidth={strokeWidthFor(selected, visual)}
            fillOpacity={fillAlpha(selected, visual)}
          />
        </g>
      ))}
      {pendingDraft && (
        <g data-testid="video-pending-draft" opacity={0.9}>
          <rect
            x={pendingDraft.geom.x}
            y={pendingDraft.geom.y * viewBoxHeight}
            width={pendingDraft.geom.w}
            height={pendingDraft.geom.h * viewBoxHeight}
            fill={classColor(pendingDraft.className)}
            fillOpacity={fillAlpha(false, visual)}
            stroke={classColor(pendingDraft.className)}
            strokeWidth={strokeWidthFor(false, visual)}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </svg>
  );
}
