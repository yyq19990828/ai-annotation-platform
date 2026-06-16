import { forwardRef, useMemo, useState } from "react";
import type {
  AnnotationResponse,
  TaskVideoFrameTimetableResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoSamplingConfig,
  VideoTrackGeometry,
} from "@/types";
import { VideoStage, type VideoStageControls } from "../../stage/VideoStage";
import { VideoKonvaStage } from "../../stage/VideoKonvaStage";
import { resolveVideoKonvaEnabledFromEnv } from "../../stage/videoKonvaFlag";
import type { WorkbenchCommonPreferences } from "@/api/auth";
import type { AnnotationFeedback } from "@/api/feedbacks";
import type { VideoTimelineChapter } from "../../stage/VideoPlaybackOverlay";
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
  pendingDrawing: PendingDrawing;
  chapters?: VideoTimelineChapter[];
  videoSampling?: VideoSamplingConfig | null;
  performanceTier?: WorkbenchCommonPreferences["performanceTier"];
  onSelect: (id: string | null, opts?: { shift?: boolean }) => void;
  onFrameIndexChange: (frameIndex: number) => void;
  onCreate: (frameIndex: number, geom: Geom) => void;
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
    performanceTier,
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
    const { config: workbenchConfig } = useWorkbenchConfig();
    const workbenchVideo = workbenchConfig.video;
    // v0.15.27 · 共享标注视觉规格(线宽/填充/字号/标签显隐);与图片工作台共用 common 子集。
    const annotationVisual = useMemo(
      () => resolveAnnotationVisual(workbenchConfig.common),
      [workbenchConfig.common],
    );
    // v0.16.1–.3 · 画布栈统一 epic:flag 开启时走实验性 Konva 视频栈(底图/播放/缩放 +
    // 标注渲染 + 交互画框/移动/缩放/选中,见 VideoKonvaStage)。flag 刷新后生效,挂载时解析一次。
    const [videoKonvaEnabled] = useState(resolveVideoKonvaEnabledFromEnv);
    if (videoKonvaEnabled) {
      return (
        <VideoKonvaStage
          ref={ref}
          manifest={manifest}
          frameTimetable={frameTimetable}
          isLoading={isLoading}
          error={error}
          frameIndex={frameIndex}
          autoFitOnResize={workbenchVideo.autoFitOnResize}
          performanceTier={performanceTier}
          onFrameIndexChange={onFrameIndexChange}
          annotations={annotations}
          selectedId={selectedId}
          hiddenTrackIds={hiddenTrackIds}
          reviewDisplayMode={reviewDisplayMode}
          trackColorOverrides={trackColorOverrides}
          activeClass={activeClass}
          pendingDrawing={pendingDrawing}
          issuePixelFeedbacks={issuePixelFeedbacks}
          issueHighlightId={issueHighlightId}
          visual={annotationVisual}
          videoTool={videoTool}
          readOnly={readOnly}
          lockedTrackIds={lockedTrackIds}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onCreate={onCreate}
          onPendingDraw={onPendingDraw}
          onUpdate={onUpdate}
          onChangeUserBoxClass={onChangeUserBoxClass}
          onComposeTracks={onComposeTracks}
          onConvertToBboxes={onConvertToBboxes}
          onDelete={(ann) => onDeleteUserBox(ann.id)}
          onPropagateTrack={onPropagateTrack}
          onToggleHiddenTrack={onToggleHiddenTrack}
          onToggleLockedTrack={onToggleLockedTrack}
        />
      );
    }
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
        performanceTier={performanceTier}
        defaultPlaybackRate={workbenchVideo.defaultPlaybackRate}
        largeFrameStep={workbenchVideo.largeFrameStep}
        autoFitOnResize={workbenchVideo.autoFitOnResize}
        visual={annotationVisual}
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
