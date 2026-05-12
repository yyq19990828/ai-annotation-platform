import { classColor } from "./colors";
import { VideoTrackShape } from "./VideoTrackShape";
import type { VideoFrameEntry, VideoStageGeom, VideoTrackPreview } from "./videoStageTypes";
import { isFrameOutside } from "./videoTrackOutside";

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
  pendingDraft?: { geom: VideoStageGeom; className: string } | null;
}

export function VideoObjectsLayer({
  viewBoxHeight,
  entries,
  trackPreviews,
  pendingDraft,
}: VideoObjectsLayerProps) {
  return (
    <svg
      data-testid="video-objects-layer"
      viewBox={`0 0 1 ${viewBoxHeight}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 4,
        pointerEvents: "none",
      }}
    >
      {trackPreviews.map((preview) => {
        const color = classColor(preview.className);
        const previewTrack = {
          type: "video_track" as const,
          track_id: preview.trackId,
          keyframes: preview.keyframes,
          outside: preview.outside,
        };
        const points = [...preview.keyframes]
          .filter((kf) => !kf.absent && !isFrameOutside(previewTrack, kf.frame_index))
          .sort((a, b) => a.frame_index - b.frame_index)
          .map((kf) => ({
            frame: kf.frame_index,
            x: kf.bbox.x + kf.bbox.w / 2,
            y: (kf.bbox.y + kf.bbox.h / 2) * viewBoxHeight,
            occluded: Boolean(kf.occluded),
          }));
        if (points.length === 0) return null;
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
            {points.map((p) => (
              <circle
                key={`${preview.id}-${p.frame}`}
                cx={p.x}
                cy={p.y}
                r={p.occluded ? 0.008 : 0.006}
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
            selected={selected}
            dashed={dashed}
            viewBoxHeight={viewBoxHeight}
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
            fill="rgba(255,255,255,0.08)"
            stroke={classColor(pendingDraft.className)}
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
    </svg>
  );
}
