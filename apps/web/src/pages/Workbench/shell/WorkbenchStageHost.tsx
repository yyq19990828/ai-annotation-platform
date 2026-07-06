import { forwardRef, lazy, Suspense, type ReactNode } from "react";
import type {
  Annotation,
  AnnotationResponse,
  Geometry,
  RotatedBboxGeometry,
  TaskVideoFrameTimetableResponse,
  TaskVideoManifestResponse,
  VideoBboxGeometry,
  VideoSamplingConfig,
  VideoTrackGeometry,
} from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";
import type {
  WorkbenchCommonPreferences,
  WorkbenchLayoutPreferences,
  WorkbenchPointcloudPreferences,
} from "@/api/auth";
import type { ProjectRenderingConfig } from "@/api/projects";
import type { AiBox } from "../state/transforms";
import type { PendingDrawing, SamPolarity, SamSubTool, ThreeDTool, Tool, VideoTool } from "../state/useWorkbenchState";
import type { WorkbenchConfigPatch, WorkbenchLayoutPatch } from "../state/useWorkbenchConfig";
import type { Viewport } from "../state/useViewportTransform";
import type { DiffMode } from "../modes/types";
import type { PolygonDraftHandle } from "../stage/tools";
import type { VideoStageControls } from "../stage/videoStageControls";
import type { VideoTimelineChapter, VideoTimelineChapterControls } from "../stage/VideoPlaybackOverlay";
import type { VideoTrackAnnotation } from "../stage/videoStageTypes";
import { ImageWorkbench } from "../stages/image/ImageWorkbench";
import type { StageKind } from "../stages/types";
// v0.13.2 · 点云 3D 模块 lazy import：three(~600KB)只在打开 lidar 任务时加载，不进主 bundle。
const ThreeDWorkbench = lazy(() => import("../stages/three-d/ThreeDWorkbench"));
import { VideoWorkbench } from "../stages/video/VideoWorkbench";
import type { VideoConvertOptions, VideoTrackCompositionOptions } from "../stages/video/useVideoAnnotationActions";
import type { UseMaskEditorReturn } from "../state/useMaskEditor";
import type { ImageContextMenuClipboardActions } from "../stage/imageStageContextMenu";

type Geom = { x: number; y: number; w: number; h: number };
type StageGeometry = { imgW: number; imgH: number; vpSize: { w: number; h: number } };
type VideoGeometry = VideoBboxGeometry | VideoTrackGeometry;

/**
 * v0.10.39 · WorkbenchStageHostProps 按语义嵌套:
 *   - common: stageKind / overlays / readOnly / activeClass / selectedId / annotations + selection 回调
 *   - video : video* / hidden|lockedVideoTrackIds + video 回调 (stageKind="video" 才消费)
 *   - image : fileUrl / blurhash / thumbnailUrl / tool / vp / image 标注回调 (stageKind="image" 才消费)
 *   - ai    : samCandidates / samActive* / sam 子工具 / onRefineSamCandidate
 *   - editors: maskEditor / polygonDraft / canvas* / projectRenderingConfig / issue*
 */
interface WorkbenchStageHostCommonProps {
  stageKind: StageKind;
  /** v0.13.2 · 当前任务 id，点云 3D 舞台据此拉 point-cloud manifest。 */
  taskId: string | null;
  overlays: ReactNode;
  readOnly: boolean;
  activeClass: string;
  selectedId: string | null;
  selectedIds: string[];
  annotations: AnnotationResponse[];
  pendingDrawing: PendingDrawing;
  /** 边栏开合时 +1, 触发 image/video stage 重新适应窗口 (两个舞台共用)。 */
  fitTick: number;
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;
  onDeleteUserBox: (id: string) => void;
  onChangeUserBoxClass: (id: string) => void;
  /** v0.13.3-5 · 点云 3D 台工具态(壳层共享,与 ToolDock 同源);非 3D 任务忽略。 */
  threeDTool: ThreeDTool;
  onSetThreeDTool: (t: ThreeDTool) => void;
  /** v0.14.1 · 跨帧目标延续 (Shift+→ / Shift+←): 把选中框 propagate 到同 scene 邻帧。 */
  onCrossFramePropagate: (direction: "next" | "prev") => void;
  /** v0.15.1 · 批量延续 (Ctrl+Shift+→/←): 当前帧全部 box_3d 延续到邻帧。 */
  onCrossFramePropagateBatch: (direction: "next" | "prev") => void;
  /** v0.15.1 · 把选中框延续到 scene 内指定帧 task(插值工作流的建链一步)。 */
  onCrossFramePropagateToTask: (targetTaskId: string, targetFrameIndex: number) => void;
  /** v0.15.1 · 区间插值: 当前 task(起点)与 toTask(终点)的同 track 框之间插值填充。 */
  onCrossFrameInterpolate: (trackId: string, toTaskId: string) => void;
  /** v0.13.10 · 3D 浮层避让右栏 + 三视图浮窗偏好。 */
  rightSidebarOpen: boolean;
  rightSidebarWidth: number;
  workbenchLayout: WorkbenchLayoutPreferences;
  onWorkbenchLayoutChange: (patch: WorkbenchLayoutPatch) => void;
  workbenchCommon: WorkbenchCommonPreferences;
  workbenchPointcloud: WorkbenchPointcloudPreferences;
  workbenchConfigLoaded: boolean;
  onWorkbenchConfigChange: (patch: WorkbenchConfigPatch) => void;
  onWorkbenchConfigUpdate: (patch: WorkbenchConfigPatch) => Promise<void>;
  projectRenderingConfig?: ProjectRenderingConfig | null;
}

interface WorkbenchStageHostVideoProps {
  videoManifest: TaskVideoManifestResponse | undefined;
  videoFrameTimetable?: TaskVideoFrameTimetableResponse;
  videoManifestLoading?: boolean;
  videoManifestError?: unknown;
  videoChapters?: VideoTimelineChapter[];
  /** v0.21.13 · 章节 × 时间轴联动控制器 (刷选建章节 / resize / hover)。 */
  videoTimelineChapterControls?: VideoTimelineChapterControls;
  /** v0.10.29 · 项目级采样配置 → VideoStage 软网格导航。 */
  videoSampling?: VideoSamplingConfig | null;
  videoTool: VideoTool;
  videoModes?: { box: boolean; track: boolean } | null;
  spacePan: boolean;
  onSpacePanDragStart: () => void;
  videoFrameIndex: number;
  videoReviewDisplayMode?: DiffMode;
  hiddenVideoTrackIds: Set<string>;
  lockedVideoTrackIds: Set<string>;
  trackColorOverrides?: Record<string, string>;
  onVideoFrameIndexChange: (frameIndex: number) => void;
  onVideoCreate: (frameIndex: number, geom: Geom) => void;
  onVideoPendingDraw: (
    kind: "video_bbox" | "video_track_bbox",
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
  // v0.21.4 · 视频单题 AI 候选(画布渲染 + 采纳/驳回)。
  aiBoxes?: AiBox[];
  onAcceptPrediction?: (b: AiBox) => void;
  onRejectPrediction?: (b: AiBox) => void;
}

interface WorkbenchStageHostImageProps {
  fileUrl: string | null;
  mediaKey?: string | null;
  blurhash?: string | null;
  // 已知图片尺寸 (task.image_width/height), 让 ImageStage 翻页时同步算 fit, 不必等 image onload。
  imageWidth?: number | null;
  imageHeight?: number | null;
  thumbnailUrl: string | null;
  tool: Tool;
  fadedAiIds: Set<string>;
  nudgeMap: Map<string, Geom>;
  /** v0.20.22 · 提交在途几何 override, 见 usePendingGeom (防松手闪回原尺寸)。 */
  pendingGeomMap: Map<string, import("@/types").Geometry>;
  userBoxes: Annotation[];
  aiBoxes: AiBox[];
  spacePan: boolean;
  vp: Viewport;
  setVp: React.Dispatch<React.SetStateAction<Viewport>>;
  setFitTick: React.Dispatch<React.SetStateAction<number>>;
  onAcceptPrediction: (b: AiBox, attributeOverrides?: Record<string, unknown>) => void;
  onRejectPrediction: (b: AiBox) => void;
  onPatchShapeFlag?: (
    id: string,
    flag: "z_order" | "is_locked" | "is_hidden",
    value: number | boolean,
  ) => void;
  secondaryBarHidden?: boolean;
  onToggleSecondaryBar?: () => void;
  imageClipboardActions?: ImageContextMenuClipboardActions | null;
  onCommitDrawing: (geo: Geom) => void;
  /** v0.10.28 · 旋转框: 拖出矩形 → 提交 angle=0 的 rotated_bbox。 */
  onCommitRotatedBbox: (geo: Geom) => void;
  /** v0.10.28 · 旋转框: 旋转手柄落定 → 更新 angle。 */
  onCommitRotateBbox: (id: string, before: RotatedBboxGeometry, after: RotatedBboxGeometry) => void;
  onSamPrompt: (prompt:
    | { kind: "point"; pt: [number, number]; alt: boolean }
    | { kind: "bbox"; bbox: [number, number, number, number] }
    | { kind: "exemplar"; bbox: [number, number, number, number]; alt: boolean }
  ) => void;
  onCommitMove: (
    id: string,
    before: Geom,
    after: Geom,
    childMoves?: { id: string; before: Geometry; after: Geometry }[],
  ) => void;
  onCommitResize: (id: string, before: Geom, after: Geom) => void;
  onCommitPolygonGeometry: (id: string, before: [number, number][], after: [number, number][]) => void;
  // v0.10.28 · keypoint 节点几何/可见性变更。
  onCommitKeypointGeometry?: (id: string, before: import("@/types").Keypoint[], after: import("@/types").Keypoint[]) => void;
  onJoinSelected: () => void;
  onCropSelected: (baseId: string) => void;
  onStageGeometry: (g: StageGeometry) => void;
}

interface WorkbenchStageHostAiProps {
  samCandidates: {
    id: string;
    type: "polygonlabels" | "rectanglelabels";
    points?: [number, number][];
    bbox?: { x: number; y: number; width: number; height: number };
  }[];
  samActiveIdx: number;
  /** v0.18.18 · §5.5 当前点会话已落的正/负点, 透传到画布 overlay 渲染。 */
  samSessionPoints: { pt: [number, number]; polarity: 1 | 0 }[];
  /** v0.18.19 · exemplar refine 会话已落的正/负框, 透传到画布 overlay 渲染。 */
  samSessionExemplars: { bbox: [number, number, number, number]; polarity: 1 | 0 }[];
  samSubTool: SamSubTool | null;
  samPolarity: SamPolarity;
  /** v0.10.9 · SAM 候选「精修」入口（画布浮按钮 + R 键）。 */
  onRefineSamCandidate?: (idx: number) => void;
}

interface WorkbenchStageHostEditorProps {
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
  /** v0.10.10 · I17.3 · 项目级 rendering_config 覆盖（仅图像舞台消费）。 */
  projectRenderingConfig?: import("@/api/projects").ProjectRenderingConfig | null;
  // ── v0.10.20 · I18 IssueLayer (仅图像舞台消费) ─────────────
  issuePixelFeedbacks?: import("@/api/feedbacks").AnnotationFeedback[];
  highlightIssueId?: string | null;
  onIssuePinClick?: (id: string) => void;
  issuePinDropArmed?: boolean;
  onIssuePinDrop?: (x: number, y: number) => void;
}

interface WorkbenchStageHostProps {
  common: WorkbenchStageHostCommonProps;
  video?: WorkbenchStageHostVideoProps;
  image?: WorkbenchStageHostImageProps;
  ai?: WorkbenchStageHostAiProps;
  editors?: WorkbenchStageHostEditorProps;
}

function requireStageGroup<T>(group: T | undefined, groupName: string, stageKind: StageKind): T {
  if (group) return group;
  throw new Error(`WorkbenchStageHost missing ${groupName} props for ${stageKind} stage`);
}

export const WorkbenchStageHost = forwardRef<VideoStageControls, WorkbenchStageHostProps>(
  function WorkbenchStageHost(props, ref) {
    const { common, video, image, ai, editors } = props;
    const {
      stageKind,
      taskId,
      overlays,
      readOnly,
      activeClass,
      selectedId,
      selectedIds,
      annotations,
      pendingDrawing,
      fitTick,
      onSelectBox,
      onCursorMove,
      onDeleteUserBox,
      onChangeUserBoxClass,
      threeDTool,
      onSetThreeDTool,
      onCrossFramePropagate,
      onCrossFramePropagateBatch,
      onCrossFramePropagateToTask,
      onCrossFrameInterpolate,
      rightSidebarOpen,
      rightSidebarWidth,
      workbenchLayout,
      onWorkbenchLayoutChange,
      workbenchCommon,
      workbenchPointcloud,
      workbenchConfigLoaded,
      onWorkbenchConfigChange,
      onWorkbenchConfigUpdate,
      projectRenderingConfig: stageProjectRenderingConfig,
    } = common;
    const videoProps = stageKind === "video" ? requireStageGroup(video, "video", stageKind) : undefined;
    const imageProps = stageKind === "image" ? requireStageGroup(image, "image", stageKind) : undefined;
    const aiProps = stageKind === "image" ? requireStageGroup(ai, "ai", stageKind) : undefined;
    const editorProps = stageKind === "image" ? requireStageGroup(editors, "editors", stageKind) : undefined;
    const {
      videoManifest,
      videoFrameTimetable,
      videoManifestLoading,
      videoManifestError,
      videoChapters,
      videoTimelineChapterControls,
      videoSampling,
      videoTool,
      videoModes,
      spacePan: videoSpacePan,
      onSpacePanDragStart: onVideoSpacePanDragStart,
      videoFrameIndex,
      videoReviewDisplayMode,
      hiddenVideoTrackIds,
      lockedVideoTrackIds,
      trackColorOverrides,
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
      // v0.21.4 · 视频单题 AI 候选(画布渲染 + 采纳/驳回); aiBoxes 属 video 组(非 image 组)。
      aiBoxes: videoAiBoxes,
      onAcceptPrediction: onVideoAcceptPrediction,
      onRejectPrediction: onVideoRejectPrediction,
    } = videoProps ?? ({} as WorkbenchStageHostVideoProps);
    const {
      fileUrl,
      mediaKey,
      blurhash,
      imageWidth,
      imageHeight,
      thumbnailUrl,
      tool,
      fadedAiIds,
      nudgeMap,
      pendingGeomMap,
      userBoxes,
      aiBoxes,
      spacePan,
      vp,
      setVp,
      setFitTick,
      onAcceptPrediction,
      onRejectPrediction,
      onPatchShapeFlag,
      secondaryBarHidden,
      onToggleSecondaryBar,
      imageClipboardActions,
      onCommitDrawing,
      onCommitRotatedBbox,
      onCommitRotateBbox,
      onSamPrompt,
      onCommitMove,
      onCommitResize,
      onCommitPolygonGeometry,
      onCommitKeypointGeometry,
      onJoinSelected,
      onCropSelected,
      onStageGeometry,
    } = imageProps ?? ({} as WorkbenchStageHostImageProps);
    const {
      samCandidates,
      samActiveIdx,
      samSessionPoints,
      samSessionExemplars,
      samSubTool,
      samPolarity,
      onRefineSamCandidate,
    } = aiProps ?? ({} as WorkbenchStageHostAiProps);
    const {
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
      projectRenderingConfig,
      issuePixelFeedbacks,
      highlightIssueId,
      onIssuePinClick,
      issuePinDropArmed,
      onIssuePinDrop,
    } = editorProps ?? ({} as WorkbenchStageHostEditorProps);
    return (
      <div className="relative flex min-h-0 flex-1 flex-col" data-workbench-stage>
        {stageKind === "3d" ? (
          <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">加载点云查看器…</div>}>
            <ThreeDWorkbench
              taskId={taskId}
              readOnly={readOnly}
              selectedId={selectedId}
              selectedIds={selectedIds}
              onSelectBox={onSelectBox}
              activeClass={activeClass}
              threeDTool={threeDTool}
              onSetThreeDTool={onSetThreeDTool}
              onCrossFramePropagate={onCrossFramePropagate}
              onCrossFramePropagateBatch={onCrossFramePropagateBatch}
              onCrossFramePropagateToTask={onCrossFramePropagateToTask}
              onCrossFrameInterpolate={onCrossFrameInterpolate}
              rightSidebarOpen={rightSidebarOpen}
              rightSidebarWidth={rightSidebarWidth}
              triViewFloat={workbenchLayout.triViewFloat}
              cameraPanels={workbenchLayout.cameraPanels}
              pointcloudCamera={workbenchLayout.pointcloudCamera}
              onWorkbenchLayoutChange={onWorkbenchLayoutChange}
              workbenchCommon={workbenchCommon}
              workbenchPointcloud={workbenchPointcloud}
              workbenchConfigLoaded={workbenchConfigLoaded}
              onWorkbenchConfigChange={onWorkbenchConfigChange}
              onWorkbenchConfigUpdate={onWorkbenchConfigUpdate}
              box3dDefaultSize={stageProjectRenderingConfig?.box3dDefaultSize ?? null}
            />
          </Suspense>
        ) : stageKind === "video" ? (
          <VideoWorkbench
            ref={ref}
            manifest={videoManifest}
            frameTimetable={videoFrameTimetable}
            isLoading={videoManifestLoading}
            error={videoManifestError}
            annotations={annotations}
            aiBoxes={videoAiBoxes}
            selectedId={selectedId}
            activeClass={activeClass}
            frameIndex={videoFrameIndex}
            reviewDisplayMode={videoReviewDisplayMode}
            hiddenTrackIds={hiddenVideoTrackIds}
            lockedTrackIds={lockedVideoTrackIds}
            trackColorOverrides={trackColorOverrides}
            selectedIds={selectedIds}
            readOnly={readOnly}
            videoTool={videoTool}
            videoModes={videoModes}
            spacePan={videoSpacePan}
            onSpacePanDragStart={onVideoSpacePanDragStart}
            pendingDrawing={pendingDrawing}
            chapters={videoChapters}
            timelineChapterControls={videoTimelineChapterControls}
            videoSampling={videoSampling}
            performanceTier={workbenchCommon.performanceTier}
            onSelect={onSelectBox}
            onFrameIndexChange={onVideoFrameIndexChange}
            onCreate={onVideoCreate}
            onPendingDraw={onVideoPendingDraw}
            onUpdate={onVideoUpdate}
            onRename={onVideoRename}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onDeleteUserBox={onDeleteUserBox}
            onConvertToBboxes={onVideoConvertToBboxes}
            onAcceptPrediction={onVideoAcceptPrediction}
            onRejectPrediction={onVideoRejectPrediction}
            onComposeTracks={onVideoComposeTracks}
            onToggleHiddenTrack={onToggleHiddenVideoTrack}
            onToggleLockedTrack={onToggleLockedVideoTrack}
            onPropagateTrack={onPropagateVideoTrack}
            onCursorMove={onCursorMove}
            issuePixelFeedbacks={issuePixelFeedbacks}
            issueHighlightId={highlightIssueId}
            onIssuePinClick={onIssuePinClick}
          />
        ) : (
          <ImageWorkbench
            readOnly={readOnly}
            fileUrl={fileUrl}
            mediaKey={mediaKey}
            blurhash={blurhash}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            thumbnailUrl={thumbnailUrl}
            tool={tool}
            activeClass={activeClass}
            selectedId={selectedId}
            selectedIds={selectedIds}
            fadedAiIds={fadedAiIds}
            nudgeMap={nudgeMap}
            pendingGeomMap={pendingGeomMap}
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
            secondaryBarHidden={secondaryBarHidden}
            onToggleSecondaryBar={onToggleSecondaryBar}
            clipboardActions={imageClipboardActions}
            onCommitDrawing={onCommitDrawing}
            onCommitRotatedBbox={onCommitRotatedBbox}
            onCommitRotateBbox={onCommitRotateBbox}
            onSamPrompt={onSamPrompt}
            samCandidates={samCandidates}
            samActiveIdx={samActiveIdx}
            samSessionPoints={samSessionPoints}
            samSessionExemplars={samSessionExemplars}
            samSubTool={samSubTool}
            samPolarity={samPolarity}
            onCommitMove={onCommitMove}
            onCommitResize={onCommitResize}
            onCommitPolygonGeometry={onCommitPolygonGeometry}
            onCommitKeypointGeometry={onCommitKeypointGeometry}
            onCursorMove={onCursorMove}
            onChangeUserBoxClass={onChangeUserBoxClass}
            onJoinSelected={onJoinSelected}
            onCropSelected={onCropSelected}
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
