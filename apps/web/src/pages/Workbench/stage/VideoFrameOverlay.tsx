import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor } from "./colors";
import { VideoAttachmentLayer } from "./VideoAttachmentLayer";
import { VideoBitmapLayer } from "./VideoBitmapLayer";
import { VideoGridLayer } from "./VideoGridLayer";
import { VideoInteractionLayer } from "./VideoInteractionLayer";
import { VideoObjectsLayer } from "./VideoObjectsLayer";
import { VideoTextLayer, type VideoLabelEntry } from "./VideoTextLayer";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoResizeDirection,
  VideoStageGeom,
  VideoTrackGhost,
  VideoTrackPreview,
} from "./videoStageTypes";

interface VideoFrameOverlayProps {
  overlayRef: RefObject<SVGSVGElement>;
  entries: VideoFrameEntry[];
  trackPreviews: VideoTrackPreview[];
  pendingDraft?: { geom: VideoStageGeom; className: string } | null;
  aspectRatio: number;
  selectedId: string | null;
  selectedTrackGhost: VideoTrackGhost | null;
  draft: VideoStageGeom | null;
  drag: VideoDragState;
  activeClass: string;
  selectedTrackClassName?: string;
  readOnly: boolean;
  isPlaying: boolean;
  videoTool: VideoTool;
  selectedTrackLocked: boolean;
  onBeginDraw: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onBeginMove: (evt: ReactPointerEvent<SVGElement>, entry: VideoFrameEntry | VideoTrackGhost) => void;
  onBeginResize: (
    dir: VideoResizeDirection,
    evt: ReactPointerEvent<SVGElement>,
    entry: VideoFrameEntry | VideoTrackGhost,
  ) => void;
  onPointerMove: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onFinishDrag: (evt: ReactPointerEvent<SVGSVGElement>) => void;
  onCancelDrag: () => void;
  onPointerLeave: (evt: ReactPointerEvent<SVGSVGElement>) => void;
}

export function VideoFrameOverlay({
  overlayRef,
  entries,
  trackPreviews,
  pendingDraft,
  aspectRatio,
  selectedId,
  selectedTrackGhost,
  draft,
  drag,
  activeClass,
  selectedTrackClassName,
  readOnly,
  isPlaying,
  videoTool,
  selectedTrackLocked,
  onBeginDraw,
  onBeginMove,
  onBeginResize,
  onPointerMove,
  onFinishDrag,
  onCancelDrag,
  onPointerLeave,
}: VideoFrameOverlayProps) {
  const viewBoxHeight = Number.isFinite(aspectRatio) && aspectRatio > 0 ? 1 / aspectRatio : 9 / 16;
  const entryViews = entries.map((entry) => {
    const geom = entry.geom;
    const color = classColor(entry.className);
    const selected = entry.ann.id === selectedId;
    const canEditSelected = selected && !readOnly && !isPlaying && !(entry.trackId && selectedTrackLocked);
    const labelSuffix = entry.source === "interpolated"
      ? " · 插值"
      : entry.occluded
        ? " · 遮挡"
        : "";
    return {
      key: `${entry.id}-${entry.trackId ?? "legacy"}`,
      entry,
      geom,
      color,
      selected,
      canEditSelected,
      dashed: entry.source === "interpolated" || Boolean(entry.occluded),
      labelText: `${entry.className}${labelSuffix}`,
    };
  });
  const pendingDraftColor = pendingDraft ? classColor(pendingDraft.className) : "";
  const ghostColor = selectedTrackGhost ? classColor(selectedTrackGhost.className) : "";
  const labelEntries: VideoLabelEntry[] = [
    ...entryViews.map((view) => ({
      key: `entry-${view.key}`,
      geom: view.geom,
      color: view.color,
      text: view.labelText,
    })),
    ...(pendingDraft && !drag
      ? [{ key: "pending-draft", geom: pendingDraft.geom, color: pendingDraftColor, text: pendingDraft.className, opacity: 0.9 }]
      : []),
    ...(selectedTrackGhost && !drag
      ? [{
        key: `ghost-${selectedTrackGhost.ann.id}`,
        geom: selectedTrackGhost.geom,
        color: ghostColor,
        text: `${selectedTrackGhost.className} · 参考 F${selectedTrackGhost.originFrame}`,
        opacity: 0.86,
      }]
      : []),
  ];

  return (
    <>
      <VideoBitmapLayer />
      <VideoGridLayer viewBoxHeight={viewBoxHeight} />
      <VideoObjectsLayer
        viewBoxHeight={viewBoxHeight}
        entries={entryViews}
        trackPreviews={trackPreviews}
        pendingDraft={!drag ? pendingDraft : null}
      />
      <VideoTextLayer labels={labelEntries} />
      <VideoInteractionLayer
        overlayRef={overlayRef}
        entries={entryViews}
        viewBoxHeight={viewBoxHeight}
        selectedTrackGhost={selectedTrackGhost}
        draft={draft}
        drag={drag}
        activeClass={activeClass}
        selectedTrackClassName={selectedTrackClassName}
        readOnly={readOnly}
        isPlaying={isPlaying}
        videoTool={videoTool}
        selectedTrackLocked={selectedTrackLocked}
        onBeginDraw={onBeginDraw}
        onBeginMove={onBeginMove}
        onBeginResize={onBeginResize}
        onPointerMove={onPointerMove}
        onFinishDrag={onFinishDrag}
        onCancelDrag={onCancelDrag}
        onPointerLeave={onPointerLeave}
      />
      <VideoAttachmentLayer />
    </>
  );
}
