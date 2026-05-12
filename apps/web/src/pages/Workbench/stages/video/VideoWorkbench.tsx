import { forwardRef } from "react";
import type {
  AnnotationResponse,
  TaskVideoFrameTimetableResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
} from "@/types";
import { VideoStage, type VideoStageControls } from "../../stage/VideoStage";
import type { PendingDrawing, VideoTool } from "../../state/useWorkbenchState";
import type { DiffMode } from "../../modes/types";
import type { VideoConvertOptions } from "./useVideoAnnotationActions";

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
  reviewDisplayMode?: DiffMode;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  readOnly: boolean;
  videoTool: VideoTool;
  pendingDrawing: PendingDrawing;
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
  onCursorMove: (pt: { x: number; y: number } | null) => void;
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
    reviewDisplayMode,
    hiddenTrackIds,
    lockedTrackIds,
    readOnly,
    videoTool,
    pendingDrawing,
    onSelect,
    onFrameIndexChange,
    onCreate,
    onPendingDraw,
    onUpdate,
    onRename,
    onChangeUserBoxClass,
    onDeleteUserBox,
    onConvertToBboxes,
    onCursorMove,
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
        reviewDisplayMode={reviewDisplayMode}
        hiddenTrackIds={hiddenTrackIds}
        lockedTrackIds={lockedTrackIds}
        readOnly={readOnly}
        videoTool={videoTool}
        pendingDrawing={pendingDrawing}
        onSelect={onSelect}
        onFrameIndexChange={onFrameIndexChange}
        onCreate={onCreate}
        onPendingDraw={onPendingDraw}
        onUpdate={onUpdate}
        onRename={onRename}
        onChangeUserBoxClass={onChangeUserBoxClass}
        onDelete={(ann) => onDeleteUserBox(ann.id)}
        onConvertToBboxes={onConvertToBboxes}
        onCursorMove={onCursorMove}
      />
    );
  },
);
