import { forwardRef, type ReactNode } from "react";
import type {
  Annotation,
  AnnotationResponse,
  RotatedBboxGeometry,
  TaskVideoFrameTimetableResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoSamplingConfig,
  VideoTrackGeometry,
} from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";
import type { AiBox } from "../state/transforms";
import type { PendingDrawing, SamPolarity, SamSubTool, Tool, VideoTool } from "../state/useWorkbenchState";
import type { Viewport } from "../state/useViewportTransform";
import type { DiffMode } from "../modes/types";
import type { PolygonDraftHandle } from "../stage/tools";
import type { VideoStageControls } from "../stage/VideoStage";
import type { VideoTimelineChapter } from "../stage/VideoPlaybackOverlay";
import type { VideoTrackAnnotation } from "../stage/videoStageTypes";
import { ImageWorkbench } from "../stages/image/ImageWorkbench";
import type { StageKind } from "../stages/types";
import { ThreeDWorkbenchPlaceholder } from "../stages/three-d/ThreeDWorkbench.placeholder";
import { VideoWorkbench } from "../stages/video/VideoWorkbench";
import type { VideoConvertOptions, VideoTrackCompositionOptions } from "../stages/video/useVideoAnnotationActions";
import type { UseMaskEditorReturn } from "../state/useMaskEditor";
import type { ImageContextMenuClipboardActions } from "../stage/imageStageContextMenu";
import styles from "./WorkbenchStageHost.module.css";

type Geom = { x: number; y: number; w: number; h: number };
type StageGeometry = { imgW: number; imgH: number; vpSize: { w: number; h: number } };
type VideoGeometry = VideoBboxGeometry | VideoTrackGeometry;

/**
 * v0.10.18 · 字段按语义分组 (JSDoc only, 类型仍平铺以兼容 WorkbenchShell 调用面):
 *   - common: stageKind / overlays / readOnly / activeClass / selectedId / annotations + selection 回调
 *   - video : video* / hidden|lockedVideoTrackIds + video 回调 (stageKind="video" 才消费)
 *   - image : fileUrl / blurhash / thumbnailUrl / tool / vp / sam* / canvas* + image 回调 (stageKind="image" 才消费)
 *   - ai    : samCandidates / samActive* / sam 子工具 / onRefineSamCandidate
 *   - editor: maskEditor / polygonDraft / pendingDrawing / projectRenderingConfig
 *
 * 后续若 Shell 再次膨胀, 可以按以上分组拆嵌套 prop 对象 (call site 一并改).
 */
interface WorkbenchStageHostProps {
  // ── common ────────────────────────────────────────────────
  stageKind: StageKind;
  overlays: ReactNode;
  readOnly: boolean;
  activeClass: string;
  selectedId: string | null;
  annotations: AnnotationResponse[];
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;

  // ── video stage ───────────────────────────────────────────
  videoManifest: TaskVideoManifestResponse | undefined;
  videoFrameTimetable?: TaskVideoFrameTimetableResponse;
  videoManifestLoading?: boolean;
  videoManifestError?: unknown;
  videoChapters?: VideoTimelineChapter[];
  /** v0.10.29 · 项目级采样配置 → VideoStage 软网格导航。 */
  videoSampling?: VideoSamplingConfig | null;
  videoTool: VideoTool;
  videoFrameIndex: number;
  videoReviewDisplayMode?: DiffMode;
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
  onVideoComposeTracks?: (options: VideoTrackCompositionOptions) => void;
  onToggleHiddenVideoTrack?: (trackId: string) => void;
  onToggleLockedVideoTrack?: (trackId: string) => void;
  onPropagateVideoTrack?: (annotation: VideoTrackAnnotation) => void;

  // ── image stage ───────────────────────────────────────────
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
  onPatchShapeFlag?: (
    id: string,
    flag: "z_order" | "is_locked" | "is_hidden" | "is_occluded",
    value: number | boolean,
  ) => void;
  imageClipboardActions?: ImageContextMenuClipboardActions | null;
  onCommitDrawing: (geo: Geom) => void;
  /** v0.10.28 · 旋转框: 拖出矩形 → 提交 angle=0 的 rotated_bbox。 */
  onCommitRotatedBbox: (geo: Geom) => void;
  /** v0.10.28 · 旋转框: 旋转手柄落定 → 更新 angle。 */
  onCommitRotateBbox: (id: string, before: RotatedBboxGeometry, after: RotatedBboxGeometry) => void;
  onSamPrompt: (prompt:
    | { kind: "point"; pt: [number, number]; alt: boolean }
    | { kind: "bbox"; bbox: [number, number, number, number] }
    | { kind: "exemplar"; bbox: [number, number, number, number] }
  ) => void;
  // ── ai (SAM 候选) ─────────────────────────────────────────
  samCandidates: {
    id: string;
    type: "polygonlabels" | "rectanglelabels";
    points?: [number, number][];
    bbox?: { x: number; y: number; width: number; height: number };
  }[];
  samActiveIdx: number;
  samSubTool: SamSubTool | null;
  samPolarity: SamPolarity;
  onCommitMove: (id: string, before: Geom, after: Geom) => void;
  onCommitResize: (id: string, before: Geom, after: Geom) => void;
  onCommitPolygonGeometry: (id: string, before: [number, number][], after: [number, number][]) => void;
  // v0.10.28 · keypoint 节点几何/可见性变更。
  onCommitKeypointGeometry?: (id: string, before: import("@/types").Keypoint[], after: import("@/types").Keypoint[]) => void;
  onChangeUserBoxClass: (id: string) => void;
  onBatchDelete: () => void;
  onBatchChangeClass: () => void;
  onStageGeometry: (g: StageGeometry) => void;
  // ── editors (mask / polygon / keypoint / canvas) ─────────────────────
  polygonDraft?: PolygonDraftHandle;
  // v0.10.28 · keypoint 工具草稿 + 骨骼模板。
  keypointDraft?: import("../stage/tools").KeypointDraftHandle;
  keypointSchema?: import("@/types").KeypointSchema | null;
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
  /** v0.10.8 · I11 · Mask 编辑器状态；仅图像舞台消费。 */
  maskEditor?: UseMaskEditorReturn;
  /** v0.10.9 · SAM 候选「精修」入口（画布浮按钮 + R 键）。 */
  onRefineSamCandidate?: (idx: number) => void;
  /** v0.10.10 · I17.3 · 项目级 rendering_config 覆盖（仅图像舞台消费）。 */
  projectRenderingConfig?: import("@/api/projects").ProjectRenderingConfig | null;
  // ── v0.10.20 · I18 IssueLayer (仅图像舞台消费) ─────────────
  issuePixelFeedbacks?: import("@/api/feedbacks").AnnotationFeedback[];
  highlightIssueId?: string | null;
  onIssuePinClick?: (id: string) => void;
  issuePinDropArmed?: boolean;
  onIssuePinDrop?: (x: number, y: number) => void;
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
    videoFrameTimetable,
    videoManifestLoading,
    videoManifestError,
    videoChapters,
    videoSampling,
    videoTool,
    videoFrameIndex,
    videoReviewDisplayMode,
    hiddenVideoTrackIds,
    lockedVideoTrackIds,
    onVideoFrameIndexChange,
    onVideoCreate,
    onVideoPendingDraw,
    onVideoUpdate,
    onVideoRename,
    onVideoConvertToBboxes,
    onVideoComposeTracks,
    onToggleHiddenVideoTrack,
    onToggleLockedVideoTrack,
    onPropagateVideoTrack,
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
    onPatchShapeFlag,
    imageClipboardActions,
    onCommitDrawing,
    onCommitRotatedBbox,
    onCommitRotateBbox,
    onSamPrompt,
    samCandidates,
    samActiveIdx,
    samSubTool,
    samPolarity,
    onCommitMove,
    onCommitResize,
    onCommitPolygonGeometry,
    onCommitKeypointGeometry,
    onChangeUserBoxClass,
    onBatchDelete,
    onBatchChangeClass,
    onStageGeometry,
    polygonDraft,
    keypointDraft,
    keypointSchema,
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
    maskEditor,
    onRefineSamCandidate,
    projectRenderingConfig,
    issuePixelFeedbacks,
    highlightIssueId,
    onIssuePinClick,
    issuePinDropArmed,
    onIssuePinDrop,
  }, ref) {
    return (
      <div className={styles.root} data-workbench-stage>
        {stageKind === "3d" ? (
          <ThreeDWorkbenchPlaceholder />
        ) : stageKind === "video" ? (
          <VideoWorkbench
            ref={ref}
            manifest={videoManifest}
            frameTimetable={videoFrameTimetable}
            isLoading={videoManifestLoading}
            error={videoManifestError}
            annotations={annotations}
            selectedId={selectedId}
            activeClass={activeClass}
            frameIndex={videoFrameIndex}
            reviewDisplayMode={videoReviewDisplayMode}
            hiddenTrackIds={hiddenVideoTrackIds}
            lockedTrackIds={lockedVideoTrackIds}
            selectedIds={selectedIds}
            readOnly={readOnly}
            videoTool={videoTool}
            pendingDrawing={pendingDrawing}
            chapters={videoChapters}
            videoSampling={videoSampling}
            onSelect={onSelectBox}
            onFrameIndexChange={onVideoFrameIndexChange}
            onCreate={onVideoCreate}
            onPendingDraw={onVideoPendingDraw}
            onUpdate={onVideoUpdate}
            onRename={onVideoRename}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onDeleteUserBox={onDeleteUserBox}
            onConvertToBboxes={onVideoConvertToBboxes}
            onComposeTracks={onVideoComposeTracks}
            onToggleHiddenTrack={onToggleHiddenVideoTrack}
            onToggleLockedTrack={onToggleLockedVideoTrack}
            onPropagateTrack={onPropagateVideoTrack}
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
            onPatchShapeFlag={onPatchShapeFlag}
            clipboardActions={imageClipboardActions}
            onCommitDrawing={onCommitDrawing}
            onCommitRotatedBbox={onCommitRotatedBbox}
            onCommitRotateBbox={onCommitRotateBbox}
            onSamPrompt={onSamPrompt}
            samCandidates={samCandidates}
            samActiveIdx={samActiveIdx}
            samSubTool={samSubTool}
            samPolarity={samPolarity}
            onCommitMove={onCommitMove}
            onCommitResize={onCommitResize}
            onCommitPolygonGeometry={onCommitPolygonGeometry}
            onCommitKeypointGeometry={onCommitKeypointGeometry}
            onCursorMove={onCursorMove}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onBatchDelete={onBatchDelete}
            onBatchChangeClass={onBatchChangeClass}
            onStageGeometry={onStageGeometry}
            polygonDraft={polygonDraft}
            keypointDraft={keypointDraft}
            keypointSchema={keypointSchema}
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
            maskEditor={maskEditor}
            onRefineSamCandidate={onRefineSamCandidate}
            projectRenderingConfig={projectRenderingConfig}
            issuePixelFeedbacks={issuePixelFeedbacks}
            highlightIssueId={highlightIssueId}
            onIssuePinClick={onIssuePinClick}
            issuePinDropArmed={issuePinDropArmed}
            onIssuePinDrop={onIssuePinDrop}
          />
        )}
        {stageKind !== "image" && overlays}
      </div>
    );
  },
);
