import type { ReactNode } from "react";
import type { Annotation, RotatedBboxGeometry, Keypoint, KeypointSchema } from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";
import { CanvasToolbar } from "../../stage/CanvasToolbar";
import { FloatingDock } from "../../shell/FloatingDock";
import { ImageStage } from "../../stage/ImageStage";
import { Minimap } from "../../stage/Minimap";
import type { AiBox } from "../../state/transforms";
import type { PendingDrawing, SamPolarity, SamSubTool, Tool } from "../../state/useWorkbenchState";
import type { Viewport } from "../../state/useViewportTransform";
import type { KeypointDraftHandle, PolygonDraftHandle } from "../../stage/tools";
import type { UseMaskEditorReturn } from "../../state/useMaskEditor";
import type { ImageContextMenuClipboardActions } from "../../stage/imageStageContextMenu";

type Geom = { x: number; y: number; w: number; h: number };
type StageGeometry = { imgW: number; imgH: number; vpSize: { w: number; h: number } };

export interface ImageWorkbenchProps {
  readOnly: boolean;
  fileUrl: string | null;
  blurhash?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  thumbnailUrl: string | null;
  tool: Tool;
  activeClass: string;
  selectedId: string | null;
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
  onSelectBox: (id: string | null, opts?: { shift?: boolean }) => void;
  onAcceptPrediction: (b: AiBox) => void;
  onRejectPrediction: (b: AiBox) => void;
  onDeleteUserBox: (id: string) => void;
  onPatchShapeFlag?: (
    id: string,
    flag: "z_order" | "is_locked" | "is_hidden",
    value: number | boolean,
  ) => void;
  clipboardActions?: ImageContextMenuClipboardActions | null;
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
  samCandidates: {
    id: string;
    type: "polygonlabels" | "rectanglelabels";
    points?: [number, number][];
    bbox?: { x: number; y: number; width: number; height: number };
  }[];
  samActiveIdx: number;
  /** v0.10.2 · 派生自 tool, 非 AI 工具时为 null. */
  samSubTool: SamSubTool | null;
  samPolarity: SamPolarity;
  onCommitMove: (id: string, before: Geom, after: Geom) => void;
  onCommitResize: (id: string, before: Geom, after: Geom) => void;
  onCommitPolygonGeometry: (id: string, before: [number, number][], after: [number, number][]) => void;
  onCommitKeypointGeometry?: (id: string, before: Keypoint[], after: Keypoint[]) => void;
  onCursorMove: (pt: { x: number; y: number } | null) => void;
  onChangeUserBoxClass: (id: string) => void;
  onJoinSelected: () => void;
  onCropSelected: (baseId: string) => void;
  onApplyAttributeMode?: (id: string) => boolean;
  onStageGeometry: (g: StageGeometry) => void;
  polygonDraft?: PolygonDraftHandle;
  keypointDraft?: KeypointDraftHandle;
  keypointSchema?: KeypointSchema | null;
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
  overlays?: ReactNode;
  /** v0.10.8 · I11 · Mask 编辑器状态；传给 ImageStage 用于 Konva overlay 与 paintAt。 */
  maskEditor?: UseMaskEditorReturn;
  /** v0.10.9 · SAM 候选「精修」入口（画布浮按钮 + R 键）。 */
  onRefineSamCandidate?: (idx: number) => void;
  /** v0.10.10 · I17.3 · 项目级 rendering_config 覆盖；透传给 ImageStage 内的 useWorkbenchConfig。 */
  projectRenderingConfig?: import("@/api/projects").ProjectRenderingConfig | null;
  /** v0.10.20 · I18 · pixel-anchored issue feedback 数据源 (Shell 通过 useFeedbacks 提供). */
  issuePixelFeedbacks?: import("@/api/feedbacks").AnnotationFeedback[];
  highlightIssueId?: string | null;
  onIssuePinClick?: (id: string) => void;
  issuePinDropArmed?: boolean;
  onIssuePinDrop?: (x: number, y: number) => void;
}

export function ImageWorkbench({
  readOnly,
  fileUrl,
  blurhash,
  imageWidth,
  imageHeight,
  thumbnailUrl,
  tool,
  activeClass,
  selectedId,
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
  onSelectBox,
  onAcceptPrediction,
  onRejectPrediction,
  onDeleteUserBox,
  onPatchShapeFlag,
  clipboardActions,
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
  onCursorMove,
  onChangeUserBoxClass,
  onJoinSelected,
  onCropSelected,
  onApplyAttributeMode,
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
  overlays,
  maskEditor,
  onRefineSamCandidate,
  projectRenderingConfig,
  issuePixelFeedbacks,
  highlightIssueId,
  onIssuePinClick,
  issuePinDropArmed,
  onIssuePinDrop,
}: ImageWorkbenchProps) {
  return (
    <ImageStage
      readOnly={readOnly}
      fileUrl={fileUrl}
      blurhash={blurhash}
      imageWidth={imageWidth}
      imageHeight={imageHeight}
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
      pendingDrawing={pendingDrawing}
      onSelectBox={onSelectBox}
      onAcceptPrediction={onAcceptPrediction}
      onRejectPrediction={onRejectPrediction}
      onDeleteUserBox={onDeleteUserBox}
      onCommitDrawing={onCommitDrawing}
      onPatchShapeFlag={onPatchShapeFlag}
      clipboardActions={clipboardActions}
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
      onJoinSelected={onJoinSelected}
      onCropSelected={onCropSelected}
      onApplyAttributeMode={onApplyAttributeMode}
      onStageGeometry={onStageGeometry}
      polygonDraft={polygonDraft}
      keypointDraft={keypointDraft}
      keypointSchema={keypointSchema}
      canvasShapes={canvasShapes}
      canvasEditable={canvasEditable}
      canvasStroke={canvasStroke}
      onCanvasStrokeCommit={onCanvasStrokeCommit}
      historicalShapes={historicalShapes}
      maskEditor={maskEditor}
      onRefineSamCandidate={onRefineSamCandidate}
      projectRenderingConfig={projectRenderingConfig}
      issuePixelFeedbacks={issuePixelFeedbacks}
      highlightIssueId={highlightIssueId}
      onIssuePinClick={onIssuePinClick}
      issuePinDropArmed={issuePinDropArmed}
      onIssuePinDrop={onIssuePinDrop}
      overlay={
        <>
          <FloatingDock
            scale={vp.scale}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={onUndo}
            onRedo={onRedo}
            onZoomIn={() => setVp((cur) => ({ ...cur, scale: Math.min(8, cur.scale * 1.2) }))}
            onZoomOut={() => setVp((cur) => ({ ...cur, scale: Math.max(0.2, cur.scale / 1.2) }))}
            onFit={() => setFitTick((n) => n + 1)}
          />
          {canvasEditable && (
            <CanvasToolbar
              stroke={canvasStroke}
              onSetStroke={onSetCanvasStroke}
              shapeCount={canvasShapeCount}
              onUndo={onUndoCanvasShape}
              onClear={onClearCanvasShapes}
              onCancel={onCancelCanvasDraft}
              onDone={onDoneCanvasDraft}
            />
          )}
          {stageGeom.imgW > 0 && stageGeom.vpSize.w > 0 && (
            <Minimap
              imgW={stageGeom.imgW}
              imgH={stageGeom.imgH}
              vpSize={stageGeom.vpSize}
              vp={vp}
              setVp={setVp}
              thumbnailUrl={thumbnailUrl}
              fileUrl={fileUrl}
            />
          )}
          {overlays}
        </>
      }
    />
  );
}
