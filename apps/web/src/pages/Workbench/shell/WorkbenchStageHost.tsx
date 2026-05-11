import { forwardRef, type ReactNode } from "react";
import type { Annotation, AnnotationResponse, TaskVideoManifestResponse, VideoBboxGeometry, VideoTrackGeometry } from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";
import type { AiBox } from "../state/transforms";
import type { PendingDrawing, SamPolarity, SamSubTool, Tool, VideoTool } from "../state/useWorkbenchState";
import type { Viewport } from "../state/useViewportTransform";
import type { PolygonDraftHandle } from "../stage/tools";
import type { VideoStageControls } from "../stage/VideoStage";
import { ImageWorkbench } from "../stages/image/ImageWorkbench";
import type { StageKind } from "../stages/types";
import { ThreeDWorkbenchPlaceholder } from "../stages/three-d/ThreeDWorkbench.placeholder";
import { VideoWorkbench } from "../stages/video/VideoWorkbench";
import type { VideoConvertOptions } from "../stages/video/useVideoAnnotationActions";

type Geom = { x: number; y: number; w: number; h: number };
type StageGeometry = { imgW: number; imgH: number; vpSize: { w: number; h: number } };
type VideoGeometry = VideoBboxGeometry | VideoTrackGeometry;

interface WorkbenchStageHostProps {
  stageKind: StageKind;
  overlays: ReactNode;
  readOnly: boolean;
  activeClass: string;
  selectedId: string | null;
  annotations: AnnotationResponse[];
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;

  videoManifest: TaskVideoManifestResponse | undefined;
  videoManifestLoading?: boolean;
  videoManifestError?: unknown;
  videoTool: VideoTool;
  videoFrameIndex: number;
  hiddenVideoTrackIds: Set<string>;
  lockedVideoTrackIds: Set<string>;
  onVideoFrameIndexChange: (frameIndex: number) => void;
  onVideoCreate: (frameIndex: number, geom: Geom) => void;
  onVideoPendingDraw: (
    kind: "video_bbox" | "video_track",
    frameIndex: number,
    geom: Geom,
    anchor: { left: number; top: number },
  ) => void;
  onVideoUpdate: (annotation: AnnotationResponse, geometry: VideoGeometry) => void;
  onVideoRename: (annotation: AnnotationResponse, className: string) => void;
  onVideoConvertToBboxes: (annotation: AnnotationResponse, options: VideoConvertOptions) => void;

  fileUrl: string | null;
  blurhash?: string | null;
  thumbnailUrl: string | null;
  tool: Tool;
  selectedIds: string[];
  fadedAiIds: Set<string>;
  nudgeMap: Map<string, Geom>;
  userBoxes: Annotation[];
  aiBoxes: AiBox[];
  spacePan: boolean;
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  fitTick: number;
  setFitTick: React.Dispatch<React.SetStateAction<number>>;
  pendingDrawing: PendingDrawing;
  onAcceptPrediction: (b: AiBox) => void;
  onRejectPrediction: (b: AiBox) => void;
  onDeleteUserBox: (id: string) => void;
  onCommitDrawing: (geo: Geom) => void;
  onSamPrompt: (prompt:
    | { kind: "point"; pt: [number, number]; alt: boolean }
    | { kind: "bbox"; bbox: [number, number, number, number] }
  ) => void;
  samCandidates: {
    id: string;
    type: "polygonlabels" | "rectanglelabels";
    points?: [number, number][];
    bbox?: { x: number; y: number; width: number; height: number };
  }[];
  samActiveIdx: number;
  samSubTool: SamSubTool;
  samPolarity: SamPolarity;
  onCommitMove: (id: string, before: Geom, after: Geom) => void;
  onCommitResize: (id: string, before: Geom, after: Geom) => void;
  onCommitPolygonGeometry: (id: string, before: [number, number][], after: [number, number][]) => void;
  onChangeUserBoxClass: (id: string) => void;
  onBatchDelete: () => void;
  onBatchChangeClass: () => void;
  onStageGeometry: (g: StageGeometry) => void;
  polygonDraft?: PolygonDraftHandle;
  canvasShapes: NonNullable<CommentCanvasDrawing["shapes"]>;
  canvasEditable: boolean;
  canvasStroke: string;
  onCanvasStrokeCommit: (points: number[], stroke: string) => void;
  historicalShapes?: NonNullable<CommentCanvasDrawing["shapes"]>;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSetCanvasStroke: (stroke: string) => void;
  canvasShapeCount: number;
  onUndoCanvasShape: () => void;
  onClearCanvasShapes: () => void;
  onCancelCanvasDraft: () => void;
  onDoneCanvasDraft: () => void;
  stageGeom: StageGeometry;
}

export const WorkbenchStageHost = forwardRef<VideoStageControls, WorkbenchStageHostProps>(
  function WorkbenchStageHost({
    stageKind,
    overlays,
    readOnly,
    activeClass,
    selectedId,
    annotations,
    onSelectBox,
    onCursorMove,
    videoManifest,
    videoManifestLoading,
    videoManifestError,
    videoTool,
    videoFrameIndex,
    hiddenVideoTrackIds,
    lockedVideoTrackIds,
    onVideoFrameIndexChange,
    onVideoCreate,
    onVideoPendingDraw,
    onVideoUpdate,
    onVideoRename,
    onVideoConvertToBboxes,
    fileUrl,
    blurhash,
    thumbnailUrl,
    tool,
    selectedIds,
    fadedAiIds,
    nudgeMap,
    userBoxes,
    aiBoxes,
    spacePan,
    vp,
    setVp,
    fitTick,
    setFitTick,
    pendingDrawing,
    onAcceptPrediction,
    onRejectPrediction,
    onDeleteUserBox,
    onCommitDrawing,
    onSamPrompt,
    samCandidates,
    samActiveIdx,
    samSubTool,
    samPolarity,
    onCommitMove,
    onCommitResize,
    onCommitPolygonGeometry,
    onChangeUserBoxClass,
    onBatchDelete,
    onBatchChangeClass,
    onStageGeometry,
    polygonDraft,
    canvasShapes,
    canvasEditable,
    canvasStroke,
    onCanvasStrokeCommit,
    historicalShapes,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onSetCanvasStroke,
    canvasShapeCount,
    onUndoCanvasShape,
    onClearCanvasShapes,
    onCancelCanvasDraft,
    onDoneCanvasDraft,
    stageGeom,
  }, ref) {
    return (
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {stageKind === "3d" ? (
          <ThreeDWorkbenchPlaceholder />
        ) : stageKind === "video" ? (
          <VideoWorkbench
            ref={ref}
            manifest={videoManifest}
            isLoading={videoManifestLoading}
            error={videoManifestError}
            annotations={annotations}
            selectedId={selectedId}
            activeClass={activeClass}
            frameIndex={videoFrameIndex}
            hiddenTrackIds={hiddenVideoTrackIds}
            lockedTrackIds={lockedVideoTrackIds}
            readOnly={readOnly}
            videoTool={videoTool}
            onSelect={onSelectBox}
            onFrameIndexChange={onVideoFrameIndexChange}
            onCreate={onVideoCreate}
            onPendingDraw={onVideoPendingDraw}
            onUpdate={onVideoUpdate}
            onRename={onVideoRename}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onDeleteUserBox={onDeleteUserBox}
            onConvertToBboxes={onVideoConvertToBboxes}
            onCursorMove={onCursorMove}
          />
        ) : (
          <ImageWorkbench
            readOnly={readOnly}
            fileUrl={fileUrl}
            blurhash={blurhash}
            thumbnailUrl={thumbnailUrl}
            tool={tool}
            activeClass={activeClass}
            selectedId={selectedId}
            selectedIds={selectedIds}
            fadedAiIds={fadedAiIds}
            nudgeMap={nudgeMap}
            userBoxes={userBoxes}
            aiBoxes={aiBoxes}
            spacePan={spacePan}
            vp={vp}
            setVp={setVp}
            fitTick={fitTick}
            setFitTick={setFitTick}
            pendingDrawing={pendingDrawing}
            onSelectBox={onSelectBox}
            onAcceptPrediction={onAcceptPrediction}
            onRejectPrediction={onRejectPrediction}
            onDeleteUserBox={onDeleteUserBox}
            onCommitDrawing={onCommitDrawing}
            onSamPrompt={onSamPrompt}
            samCandidates={samCandidates}
            samActiveIdx={samActiveIdx}
            samSubTool={samSubTool}
            samPolarity={samPolarity}
            onCommitMove={onCommitMove}
            onCommitResize={onCommitResize}
            onCommitPolygonGeometry={onCommitPolygonGeometry}
            onCursorMove={onCursorMove}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onBatchDelete={onBatchDelete}
            onBatchChangeClass={onBatchChangeClass}
            onStageGeometry={onStageGeometry}
            polygonDraft={polygonDraft}
            canvasShapes={canvasShapes}
            canvasEditable={canvasEditable}
            canvasStroke={canvasStroke}
            onCanvasStrokeCommit={onCanvasStrokeCommit}
            historicalShapes={historicalShapes}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={onUndo}
            onRedo={onRedo}
            onSetCanvasStroke={onSetCanvasStroke}
            canvasShapeCount={canvasShapeCount}
            onUndoCanvasShape={onUndoCanvasShape}
            onClearCanvasShapes={onClearCanvasShapes}
            onCancelCanvasDraft={onCancelCanvasDraft}
            onDoneCanvasDraft={onDoneCanvasDraft}
            stageGeom={stageGeom}
            overlays={overlays}
          />
        )}
        {stageKind !== "image" && overlays}
      </div>
    );
  },
);
