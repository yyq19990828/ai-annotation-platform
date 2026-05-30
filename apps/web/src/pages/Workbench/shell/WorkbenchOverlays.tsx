import type { PendingDrawing, EditingClass, Geom } from "../state/useWorkbenchState";
import type { Viewport } from "../state/useViewportTransform";
import { ClassPickerPopover, type ClassPickerCancelReason, type ClassPickerAttrEditing } from "./ClassPickerPopover";

type StageGeometry = {
  imgW: number;
  imgH: number;
};

type BatchChangeTarget = {
  geom: Geom;
  className: string;
  count: number;
} | null;

interface WorkbenchOverlaysProps {
  pendingDrawing: PendingDrawing;
  editingClass: EditingClass;
  samPendingGeom: Geom | null;
  samDefaultClass: string;
  batchChanging: boolean;
  batchChangeTarget: BatchChangeTarget;
  imageOverlayEnabled: boolean;
  stageGeom: StageGeometry;
  vp: Viewport;
  classes: string[];
  recentClasses: string[];
  activeClass: string;
  onPickPendingClass: (cls: string) => void;
  onCancelPending: (reason: ClassPickerCancelReason) => void;
  onCommitChangeClass: (cls: string) => void;
  /** v0.11.28：改类悬浮框含属性时用此回调——提交改类但不关闭悬浮框，便于接着编辑属性。 */
  onChangeClassKeepOpen?: (cls: string) => void;
  /** v0.11.28：改类悬浮框内联属性编辑（按当前选中标注派生；缺省时退化为纯改类、点选即关）。 */
  changeClassAttrEditing?: ClassPickerAttrEditing;
  onCancelChangeClass: () => void;
  onSamCommitClass: (cls: string) => void;
  onSamCancelClass: () => void;
  onCommitBatchChangeClass: (cls: string) => void;
  onCancelBatchChange: () => void;
}

function isAnchoredPending(
  pending: PendingDrawing,
): pending is NonNullable<PendingDrawing> & { anchor: { left: number; top: number } } {
  return !!pending && "anchor" in pending;
}

function hasFixedAnchor<T extends { anchor?: { left: number; top: number } } | null>(
  value: T,
): value is NonNullable<T> & { anchor: { left: number; top: number } } {
  return !!value?.anchor;
}

export function WorkbenchOverlays({
  pendingDrawing,
  editingClass,
  samPendingGeom,
  samDefaultClass,
  batchChanging,
  batchChangeTarget,
  imageOverlayEnabled,
  stageGeom,
  vp,
  classes,
  recentClasses,
  activeClass,
  onPickPendingClass,
  onCancelPending,
  onCommitChangeClass,
  onChangeClassKeepOpen,
  changeClassAttrEditing,
  onCancelChangeClass,
  onSamCommitClass,
  onSamCancelClass,
  onCommitBatchChangeClass,
  onCancelBatchChange,
}: WorkbenchOverlaysProps) {
  const canUseImagePosition = imageOverlayEnabled && stageGeom.imgW > 0 && stageGeom.imgH > 0;

  return (
    <>
      {pendingDrawing && isAnchoredPending(pendingDrawing) && (
        <ClassPickerPopover
          position="fixed"
          anchor={pendingDrawing.anchor}
          classes={classes}
          recent={recentClasses}
          defaultClass={activeClass}
          onPick={onPickPendingClass}
          onCancel={onCancelPending}
        />
      )}
      {pendingDrawing && !isAnchoredPending(pendingDrawing) && canUseImagePosition && (
        <ClassPickerPopover
          geom={pendingDrawing.geom}
          imgW={stageGeom.imgW}
          imgH={stageGeom.imgH}
          vp={vp}
          classes={classes}
          recent={recentClasses}
          defaultClass={activeClass}
          onPick={onPickPendingClass}
          onCancel={onCancelPending}
        />
      )}
      {editingClass && hasFixedAnchor(editingClass) && !pendingDrawing && (
        <ClassPickerPopover
          position="fixed"
          anchor={editingClass.anchor}
          classes={classes}
          recent={recentClasses}
          defaultClass={editingClass.currentClass}
          title={`改类别 (当前: ${editingClass.currentClass})`}
          onPick={changeClassAttrEditing && onChangeClassKeepOpen ? onChangeClassKeepOpen : onCommitChangeClass}
          onCancel={onCancelChangeClass}
          attrEditing={changeClassAttrEditing}
        />
      )}
      {editingClass && !hasFixedAnchor(editingClass) && canUseImagePosition && !pendingDrawing && (
        <ClassPickerPopover
          geom={editingClass.geom}
          imgW={stageGeom.imgW}
          imgH={stageGeom.imgH}
          vp={vp}
          classes={classes}
          recent={recentClasses}
          defaultClass={editingClass.currentClass}
          title={`改类别 (当前: ${editingClass.currentClass})`}
          onPick={changeClassAttrEditing && onChangeClassKeepOpen ? onChangeClassKeepOpen : onCommitChangeClass}
          onCancel={onCancelChangeClass}
          attrEditing={changeClassAttrEditing}
        />
      )}
      {samPendingGeom && canUseImagePosition && !pendingDrawing && !editingClass && (
        <ClassPickerPopover
          geom={samPendingGeom}
          imgW={stageGeom.imgW}
          imgH={stageGeom.imgH}
          vp={vp}
          classes={classes}
          recent={recentClasses}
          defaultClass={samDefaultClass}
          title="接受 SAM 候选 → 选类别"
          onPick={onSamCommitClass}
          onCancel={onSamCancelClass}
        />
      )}
      {batchChanging && batchChangeTarget && canUseImagePosition && !pendingDrawing && !editingClass && (
        <ClassPickerPopover
          geom={batchChangeTarget.geom}
          imgW={stageGeom.imgW}
          imgH={stageGeom.imgH}
          vp={vp}
          classes={classes}
          recent={recentClasses}
          defaultClass={batchChangeTarget.className}
          title={`批量改类别 (${batchChangeTarget.count} 个)`}
          onPick={onCommitBatchChangeClass}
          onCancel={onCancelBatchChange}
        />
      )}
    </>
  );
}
