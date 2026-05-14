import type { ReactNode } from "react";
import type { Annotation } from "@/types";
import type { CommentCanvasDrawing } from "@/api/comments";
import { CanvasToolbar } from "../../stage/CanvasToolbar";
import { FloatingDock } from "../../shell/FloatingDock";
import { ImageStage } from "../../stage/ImageStage";
import { Minimap } from "../../stage/Minimap";
import type { AiBox } from "../../state/transforms";
import type { PendingDrawing, SamPolarity, SamSubTool, Tool } from "../../state/useWorkbenchState";
import type { Viewport } from "../../state/useViewportTransform";
import type { PolygonDraftHandle } from "../../stage/tools";

type Geom = { x: number; y: number; w: number; h: number };
type StageGeometry = { imgW: number; imgH: number; vpSize: { w: number; h: number } };

export interface ImageWorkbenchProps {
  readOnly: boolean;
  fileUrl: string | null;
  blurhash?: string | null;
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
  onCommitDrawing: (geo: Geom) => void;
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
  onCursorMove: (pt: { x: number; y: number } | null) => void;
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
  overlays?: ReactNode;
}

export function ImageWorkbench({
  readOnly,
  fileUrl,
  blurhash,
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
  onCommitDrawing,
  onSamPrompt,
  samCandidates,
  samActiveIdx,
  samSubTool,
  samPolarity,
  onCommitMove,
  onCommitResize,
  onCommitPolygonGeometry,
  onCursorMove,
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
  overlays,
}: ImageWorkbenchProps) {
  return (
    <ImageStage
      readOnly={readOnly}
      fileUrl={fileUrl}
      blurhash={blurhash}
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
