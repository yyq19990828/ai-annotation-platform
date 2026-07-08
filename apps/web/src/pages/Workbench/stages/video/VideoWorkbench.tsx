import { forwardRef, useMemo } from "react";
import type {
  AnnotationResponse,
  TaskVideoFrameTimetableResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoSamplingConfig,
  VideoTrackGeometry,
} from "@/types";
import type { VideoStageControls } from "../../stage/videoStageControls";
import { VideoKonvaStage } from "../../stage/VideoKonvaStage";
import type { AiBox } from "../../state/transforms";
import type { WorkbenchCommonPreferences } from "@/api/auth";
import type { AnnotationFeedback } from "@/api/feedbacks";
import type { VideoTimelineChapter, VideoTimelineChapterControls } from "../../stage/VideoPlaybackOverlay";
import type { VideoTrackAnnotation } from "../../stage/videoStageTypes";
import type { PendingDrawing, VideoTool } from "../../state/useWorkbenchState";
import { useWorkbenchConfig } from "../../state/useWorkbenchConfig";
import { resolveAnnotationVisual } from "../../stage/annotationVisual";
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
  /** v0.21.4 · AI 候选框(全部帧); 舞台内按当前帧过滤渲染 + 采纳/驳回。 */
  aiBoxes?: AiBox[];
  selectedId: string | null;
  activeClass: string;
  frameIndex: number;
  selectedIds?: string[];
  reviewDisplayMode?: DiffMode;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  trackColorOverrides?: Record<string, string>;
  readOnly: boolean;
  videoTool: VideoTool;
  isVideoToolEnabled?: (t: VideoTool) => boolean;
  spacePan?: boolean;
  onSpacePanDragStart?: () => void;
  pendingDrawing: PendingDrawing;
  chapters?: VideoTimelineChapter[];
  timelineChapterControls?: VideoTimelineChapterControls;
  propagateRange?: { startFrame: number; endFrame: number } | null;
  videoSampling?: VideoSamplingConfig | null;
  performanceTier?: WorkbenchCommonPreferences["performanceTier"];
  onSelect: (id: string | null, opts?: { shift?: boolean }) => void;
  onFrameIndexChange: (frameIndex: number) => void;
  onCreate: (frameIndex: number, geom: Geom) => void;
  /** v0.21.20 · 由绘制顶点新建 polygon/polyline track。 */
  onCreatePointsTrack?: (
    type: "video_track_polygon" | "video_track_polyline",
    frameIndex: number,
    points: [number, number][],
  ) => void;
  /** v0.21.21 · 由绘制顶点新建单帧 polygon/polyline。 */
  onCreatePoints?: (
    type: "video_polygon" | "video_polyline",
    frameIndex: number,
    points: [number, number][],
  ) => void;
  onPendingDraw: (
    kind: "video_bbox" | "video_track_bbox",
    frameIndex: number,
    geom: Geom,
    anchor: { left: number; top: number },
  ) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoGeometry) => void;
  onRename: (annotation: AnnotationResponse, className: string) => void;
  onChangeUserBoxClass: (id: string) => void;
  onDeleteUserBox: (id: string) => void;
  onConvertToBboxes: (annotation: AnnotationResponse, options: VideoConvertOptions) => void;
  onAcceptPrediction?: (b: AiBox) => void;
  onRejectPrediction?: (b: AiBox) => void;
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
    aiBoxes,
    selectedId,
    activeClass,
    frameIndex,
    selectedIds = [],
    reviewDisplayMode,
    hiddenTrackIds,
    lockedTrackIds,
    trackColorOverrides,
    readOnly,
    videoTool,
    isVideoToolEnabled,
    spacePan = false,
    onSpacePanDragStart,
    pendingDrawing,
    chapters,
    timelineChapterControls,
    propagateRange,
    videoSampling,
    performanceTier,
    onSelect,
    onFrameIndexChange,
    onCreate,
    onCreatePointsTrack,
    onCreatePoints,
    onPendingDraw,
    onUpdate,
    onChangeUserBoxClass,
    onDeleteUserBox,
    onConvertToBboxes,
    onAcceptPrediction,
    onRejectPrediction,
    onComposeTracks,
    onToggleHiddenTrack,
    onToggleLockedTrack,
    onPropagateTrack,
    onCursorMove,
    issuePixelFeedbacks,
    issueHighlightId,
    onIssuePinClick,
  }, ref) {
    const { config: workbenchConfig } = useWorkbenchConfig();
    const workbenchVideo = workbenchConfig.video;
    // v0.15.27 · 共享标注视觉规格(线宽/填充/字号/标签显隐);与图片工作台共用 common 子集。
    const annotationVisual = useMemo(
      () => resolveAnnotationVisual(workbenchConfig.common),
      [workbenchConfig.common],
    );
    // v0.16.5 · 视频渲染栈统一到 Konva(删旧 SVG 栈,见 ADR-0041):唯一实现,无 flag 分支。
    return (
      <VideoKonvaStage
        ref={ref}
        manifest={manifest}
        frameTimetable={frameTimetable}
        isLoading={isLoading}
        error={error}
        frameIndex={frameIndex}
        autoFitOnResize={workbenchVideo.autoFitOnResize}
        trackContinueAutoAdvance={workbenchVideo.trackContinueAutoAdvance}
        focusSelectionEnabled={workbenchConfig.common.focusSelectionEnabled}
        performanceTier={performanceTier}
        onFrameIndexChange={onFrameIndexChange}
        annotations={annotations}
        aiBoxes={aiBoxes}
        selectedId={selectedId}
        hiddenTrackIds={hiddenTrackIds}
        reviewDisplayMode={reviewDisplayMode}
        trackColorOverrides={trackColorOverrides}
        activeClass={activeClass}
        pendingDrawing={pendingDrawing}
        issuePixelFeedbacks={issuePixelFeedbacks}
        issueHighlightId={issueHighlightId}
        onIssuePinClick={onIssuePinClick}
        visual={annotationVisual}
        videoTool={videoTool}
        isVideoToolEnabled={isVideoToolEnabled}
        spacePan={spacePan}
        onSpacePanDragStart={onSpacePanDragStart}
        readOnly={readOnly}
        lockedTrackIds={lockedTrackIds}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onCursorMove={onCursorMove}
        onCreate={onCreate}
        onCreatePointsTrack={onCreatePointsTrack}
        onCreatePoints={onCreatePoints}
        onPendingDraw={onPendingDraw}
        onUpdate={onUpdate}
        onChangeUserBoxClass={onChangeUserBoxClass}
        onComposeTracks={onComposeTracks}
        onConvertToBboxes={onConvertToBboxes}
        onAcceptPrediction={onAcceptPrediction}
        onRejectPrediction={onRejectPrediction}
        onDelete={(ann) => onDeleteUserBox(ann.id)}
        onPropagateTrack={onPropagateTrack}
        onToggleHiddenTrack={onToggleHiddenTrack}
        onToggleLockedTrack={onToggleLockedTrack}
        chapters={chapters}
        timelineChapterControls={timelineChapterControls}
        propagateRange={propagateRange}
        videoSampling={videoSampling}
        defaultPlaybackRate={workbenchVideo.defaultPlaybackRate}
        largeFrameStep={workbenchVideo.largeFrameStep}
      />
    );
  },
);
