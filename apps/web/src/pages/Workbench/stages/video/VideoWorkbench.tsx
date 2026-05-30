import { forwardRef } from "react";
import type {
  AnnotationResponse,
  TaskVideoFrameTimetableResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoSamplingConfig,
  VideoTrackGeometry,
} from "@/types";
import { VideoStage, type VideoStageControls } from "../../stage/VideoStage";
import type { AnnotationFeedback } from "@/api/feedbacks";
import type { VideoTimelineChapter } from "../../stage/VideoPlaybackOverlay";
import type { VideoTrackAnnotation } from "../../stage/videoStageTypes";
import type { PendingDrawing, VideoTool } from "../../state/useWorkbenchState";
import type { DiffMode } from "../../modes/types";
import type { VideoConvertOptions, VideoTrackCompositionOptions } from "./useVideoAnnotationActions";

type Geom = { x: number; y: number; w: number; h: number };
type VideoGeometry = VideoBboxGeometry | VideoTrackGeometry;

export interface VideoWorkbenchProps {
  manifest: TaskVideoManifestResponse | undefined;
  frameTimetable?: TaskVideoFrameTimetableResponse;
  isLoading?: boolean;
  error?: unknown;
  annotations: AnnotationResponse[];
  selectedId: string | null;
  activeClass: string;
  frameIndex: number;
  /** 边栏开合时 +1, 触发 VideoStage 重新适应窗口。 */
  fitTick?: number;
  selectedIds?: string[];
  reviewDisplayMode?: DiffMode;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  trackColorOverrides?: Record<string, string>;
  readOnly: boolean;
  videoTool: VideoTool;
  pendingDrawing: PendingDrawing;
  chapters?: VideoTimelineChapter[];
  videoSampling?: VideoSamplingConfig | null;
  onSelect: (id: string | null, opts?: { shift?: boolean }) => void;
  onFrameIndexChange: (frameIndex: number) => void;
  onCreate: (frameIndex: number, geom: Geom) => void;
  onPendingDraw: (
    kind: "video_bbox" | "video_track",
    frameIndex: number,
    geom: Geom,
    anchor: { left: number; top: number },
  ) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoGeometry) => void;
  onRename: (annotation: AnnotationResponse, className: string) => void;
  onChangeUserBoxClass: (id: string) => void;
  onDeleteUserBox: (id: string) => void;
  onConvertToBboxes: (annotation: AnnotationResponse, options: VideoConvertOptions) => void;
  onComposeTracks?: (options: VideoTrackCompositionOptions) => void;
  onToggleHiddenTrack?: (trackId: string) => void;
  onToggleLockedTrack?: (trackId: string) => void;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;
  // v0.11.7 · pixel-anchored issue 图钉 (按当前帧显隐 + 时间轴标记)。
  issuePixelFeedbacks?: AnnotationFeedback[];
  issueHighlightId?: string | null;
  onIssuePinClick?: (id: string) => void;
}

export const VideoWorkbench = forwardRef<VideoStageControls, VideoWorkbenchProps>(
  function VideoWorkbench({
    manifest,
    frameTimetable,
    isLoading,
    error,
    annotations,
    selectedId,
    activeClass,
    frameIndex,
    fitTick,
    selectedIds = [],
    reviewDisplayMode,
    hiddenTrackIds,
    lockedTrackIds,
    trackColorOverrides,
    readOnly,
    videoTool,
    pendingDrawing,
    chapters,
    videoSampling,
    onSelect,
    onFrameIndexChange,
    onCreate,
    onPendingDraw,
    onUpdate,
    onRename,
    onChangeUserBoxClass,
    onDeleteUserBox,
    onConvertToBboxes,
    onComposeTracks,
    onToggleHiddenTrack,
    onToggleLockedTrack,
    onPropagateTrack,
    onCursorMove,
    issuePixelFeedbacks,
    issueHighlightId,
    onIssuePinClick,
  }, ref) {
    return (
      <VideoStage
        ref={ref}
        manifest={manifest}
        frameTimetable={frameTimetable}
        isLoading={isLoading}
        error={error}
        annotations={annotations}
        selectedId={selectedId}
        activeClass={activeClass}
        frameIndex={frameIndex}
        fitTick={fitTick}
        selectedIds={selectedIds}
        reviewDisplayMode={reviewDisplayMode}
        hiddenTrackIds={hiddenTrackIds}
        lockedTrackIds={lockedTrackIds}
        trackColorOverrides={trackColorOverrides}
        readOnly={readOnly}
        videoTool={videoTool}
        pendingDrawing={pendingDrawing}
        chapters={chapters}
        videoSampling={videoSampling}
        onSelect={onSelect}
        onFrameIndexChange={onFrameIndexChange}
        onCreate={onCreate}
        onPendingDraw={onPendingDraw}
        onUpdate={onUpdate}
        onRename={onRename}
        onChangeUserBoxClass={onChangeUserBoxClass}
        onDelete={(ann) => onDeleteUserBox(ann.id)}
        onConvertToBboxes={onConvertToBboxes}
        onComposeTracks={onComposeTracks}
        onToggleHiddenTrack={onToggleHiddenTrack}
        onToggleLockedTrack={onToggleLockedTrack}
        onPropagateTrack={onPropagateTrack}
        onCursorMove={onCursorMove}
        issuePixelFeedbacks={issuePixelFeedbacks}
        issueHighlightId={issueHighlightId}
        onIssuePinClick={onIssuePinClick}
      />
    );
  },
);
