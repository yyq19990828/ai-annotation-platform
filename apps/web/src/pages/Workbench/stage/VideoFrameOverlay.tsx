import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import type { VideoTool } from "../state/useWorkbenchState";
import { classColor, getTrackColor } from "./colors";
import { VideoAttachmentLayer } from "./VideoAttachmentLayer";
import { VideoBitmapLayer } from "./VideoBitmapLayer";
import { VideoGridLayer } from "./VideoGridLayer";
import { VideoInteractionLayer } from "./VideoInteractionLayer";
import { VideoIssueLayer } from "./VideoIssueLayer";
import { VideoObjectsLayer } from "./VideoObjectsLayer";
import { VideoTextLayer, type VideoLabelEntry } from "./VideoTextLayer";
import { shouldShowLabel, type AnnotationVisualConfig } from "./annotationVisual";
import type {
  VideoDragState,
  VideoFrameEntry,
  VideoResizeDirection,
  VideoStageGeom,
  VideoTrackGhost,
  VideoTrackPreview,
} from "./videoStageTypes";
import type { CachedVideoBitmap } from "./useVideoBitmapCache";
import type { AnnotationFeedback } from "@/api/feedbacks";

interface VideoFrameOverlayProps {
  overlayRef: RefObject<SVGSVGElement>;
  /** v0.11.7 · pixel-anchored issue 图钉 (按当前帧显隐)。 */
  issuePixelFeedbacks?: AnnotationFeedback[];
  frameIndex: number;
  issueHighlightId?: string | null;
  onIssuePinClick?: (id: string) => void;
  cachedBitmap?: CachedVideoBitmap | null;
  showCachedBitmap?: boolean;
  entries: VideoFrameEntry[];
  trackNumbers: ReadonlyMap<string, number>;
  trackPreviews: VideoTrackPreview[];
  trackColorOverrides?: Record<string, string>;
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
  // v0.15.27 · 共享视觉规格(线宽/填充/字号/标签显隐);图片与视频共用同一 common 子集。
  visual: AnnotationVisualConfig;
  onBeginPan: (evt: ReactPointerEvent<SVGSVGElement>) => void;
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
  issuePixelFeedbacks,
  frameIndex,
  issueHighlightId,
  onIssuePinClick,
  cachedBitmap = null,
  showCachedBitmap = false,
  entries,
  trackNumbers,
  trackPreviews,
  trackColorOverrides,
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
  visual,
  onBeginPan,
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
    const color = entry.trackId
      ? getTrackColor(entry.trackId, entry.className, trackColorOverrides)
      : classColor(entry.className);
    const selected = entry.ann.id === selectedId;
    const canEditSelected = selected && !readOnly && !isPlaying && !(entry.trackId && selectedTrackLocked);
    const labelSuffix = entry.source === "interpolated"
      ? " · 插值"
      : entry.occluded
        ? " · 遮挡"
        : "";
    const trackNumber = trackNumbers.get(entry.ann.id);
    const labelPrefix = trackNumber !== undefined ? `#${trackNumber} · ` : "";
    return {
      key: `${entry.id}-${entry.trackId ?? "legacy"}`,
      entry,
      geom,
      color,
      selected,
      canEditSelected,
      dashed: entry.source === "interpolated" || Boolean(entry.occluded),
      labelText: `${labelPrefix}${entry.className}${labelSuffix}`,
    };
  });
  const pendingDraftColor = pendingDraft ? classColor(pendingDraft.className) : "";
  const ghostColor = selectedTrackGhost
    ? getTrackColor(selectedTrackGhost.trackId, selectedTrackGhost.className, trackColorOverrides)
    : "";
  const selectedTrackColor = entryViews.find((view) => view.entry.ann.id === selectedId)?.color
    ?? (ghostColor || classColor(selectedTrackClassName ?? activeClass));
  // v0.15.27 · 标签显隐门控:always 恒显 / selected 仅选中对象 / none 全隐。
  // 草稿与 ghost 是当前正在画 / 选中的对象,按 selected=true 门控(none 时也隐)。
  const labelVisibility = visual.labelVisibility;
  const labelEntries: VideoLabelEntry[] = [
    ...entryViews
      .filter((view) => shouldShowLabel(view.selected, labelVisibility))
      .map((view) => ({
        key: `entry-${view.key}`,
        geom: view.geom,
        color: view.color,
        text: view.labelText,
      })),
    ...(pendingDraft && !drag && shouldShowLabel(true, labelVisibility)
      ? [{ key: "pending-draft", geom: pendingDraft.geom, color: pendingDraftColor, text: pendingDraft.className, opacity: 0.9 }]
      : []),
    ...(selectedTrackGhost && !drag && shouldShowLabel(true, labelVisibility)
      ? [{
        key: `ghost-${selectedTrackGhost.ann.id}`,
        geom: selectedTrackGhost.geom,
        color: ghostColor,
        text: `${trackNumbers.has(selectedTrackGhost.ann.id) ? `#${trackNumbers.get(selectedTrackGhost.ann.id)} · ` : ""}${selectedTrackGhost.className} · 参考 F${selectedTrackGhost.originFrame}`,
        opacity: 0.86,
      }]
      : []),
  ];

  return (
    <>
      <VideoBitmapLayer bitmap={cachedBitmap} visible={showCachedBitmap} />
      <VideoGridLayer viewBoxHeight={viewBoxHeight} />
      <VideoObjectsLayer
        viewBoxHeight={viewBoxHeight}
        entries={entryViews}
        trackPreviews={trackPreviews}
        trackColorOverrides={trackColorOverrides}
        pendingDraft={!drag ? pendingDraft : null}
        visual={visual}
      />
      <VideoTextLayer labels={labelEntries} fontSize={visual.labelFontSize} />
      <VideoInteractionLayer
        overlayRef={overlayRef}
        entries={entryViews}
        viewBoxHeight={viewBoxHeight}
        selectedTrackGhost={selectedTrackGhost}
        draft={draft}
        drag={drag}
        activeClass={activeClass}
        selectedTrackClassName={selectedTrackClassName}
        selectedTrackColor={selectedTrackColor}
        readOnly={readOnly}
        isPlaying={isPlaying}
        videoTool={videoTool}
        selectedTrackLocked={selectedTrackLocked}
        onBeginPan={onBeginPan}
        onBeginDraw={onBeginDraw}
        onBeginMove={onBeginMove}
        onBeginResize={onBeginResize}
        onPointerMove={onPointerMove}
        onFinishDrag={onFinishDrag}
        onCancelDrag={onCancelDrag}
        onPointerLeave={onPointerLeave}
      />
      <VideoIssueLayer
        pixelIssues={(issuePixelFeedbacks ?? []).filter(
          (f) => f.kind === "issue" && f.anchor_type === "pixel" && !!f.anchor_position,
        )}
        frameIndex={frameIndex}
        viewBoxHeight={viewBoxHeight}
        highlightId={issueHighlightId}
        onPinClick={onIssuePinClick}
      />
      <VideoAttachmentLayer />
    </>
  );
}
