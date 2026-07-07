import type { AnnotationResponse } from "@/types";
import type { DropdownItem } from "@/components/ui/DropdownMenu";
import { isVideoBbox, isVideoTrack } from "./videoStageGeometry";
import type { VideoTrackActions } from "./useVideoTrackActions";
import type {
  VideoTrackAnnotation,
  VideoTrackCompositionOptions,
  VideoTrackConversionOptions,
} from "./videoStageTypes";

/**
 * v0.16.4 · 视频右键上下文菜单条目构建(纯函数,栈无关)。
 *
 * 从旧 SVG 栈 VideoStage 的内联 `contextMenuItems` useMemo 原样抽出(逐项对齐),
 * 供 SVG `VideoStage` 与新 Konva `VideoKonvaStage` 共用——消除「同一份菜单两栈各写一遍」。
 * 命中/选中/trackActions 由各栈自备(SVG 用 SVG CTM 命中,Konva 用像素空间命中),
 * 本函数只把已解析的上下文映射成 DropdownItem[],无 DOM / 无副作用。
 */
export interface VideoContextMenuCtx {
  /** 右键命中的标注(可能与当前选中不同,如多选 bbox 聚合)。 */
  contextMenuAnnotation: AnnotationResponse | null;
  /** 当前选中标注(track 菜单分支以它为准)。 */
  selectedAnnotation: AnnotationResponse | null;
  contextMenuTargetId: string | null;
  /** 当前多选的 video_bbox(供「聚合为轨迹」)。 */
  selectedVideoBboxes: AnnotationResponse[];
  readOnly: boolean;
  frameIndex: number;
  trackActions: VideoTrackActions;
  canDeleteSelectedTrackKeyframe: boolean;
  deleteSelectedTrackKeyframe: () => boolean;
  onChangeUserBoxClass?: (id: string) => void;
  onComposeTracks?: (options: VideoTrackCompositionOptions) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  onDelete?: (annotation: AnnotationResponse) => void;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
  onToggleHiddenTrack?: (trackId: string) => void;
  onToggleLockedTrack?: (trackId: string) => void;
}

export function buildVideoContextMenuItems(ctx: VideoContextMenuCtx): DropdownItem[] {
  const {
    contextMenuAnnotation,
    selectedAnnotation,
    contextMenuTargetId,
    selectedVideoBboxes,
    readOnly,
    frameIndex,
    trackActions,
    canDeleteSelectedTrackKeyframe,
    deleteSelectedTrackKeyframe,
    onChangeUserBoxClass,
    onComposeTracks,
    onConvertToBboxes,
    onDelete,
    onPropagateTrack,
    onToggleHiddenTrack,
    onToggleLockedTrack,
  } = ctx;

  if (contextMenuAnnotation && isVideoBbox(contextMenuAnnotation)) {
    const aggregateTargets = selectedVideoBboxes.some((ann) => ann.id === contextMenuAnnotation.id)
      ? selectedVideoBboxes
      : [];
    const sameClass = new Set(aggregateTargets.map((ann) => ann.class_name)).size <= 1;
    const uniqueFrames = new Set(
      aggregateTargets.map((ann) => (isVideoBbox(ann) ? ann.geometry.frame_index : -1)),
    ).size === aggregateTargets.length;
    const canAggregate = aggregateTargets.length > 1 && sameClass && uniqueFrames;
    return [
      {
        id: "bbox-class",
        label: "改类别",
        icon: "tag",
        disabled: readOnly || !onChangeUserBoxClass,
        onSelect: () => onChangeUserBoxClass?.(contextMenuAnnotation.id),
      },
      ...(aggregateTargets.length > 1
        ? [
          { id: "bbox-divider", divider: true, label: "" } as DropdownItem,
          {
            id: "bbox-aggregate",
            label: "聚合为轨迹",
            disabled: readOnly || !onComposeTracks || !canAggregate,
            onSelect: () => onComposeTracks?.({
              operation: "aggregate_bboxes",
              annotationIds: aggregateTargets.map((ann) => ann.id),
              deleteSources: true,
            }),
          } satisfies DropdownItem,
        ]
        : []),
      { id: "bbox-delete-divider", divider: true, label: "" },
      {
        id: "bbox-delete",
        label: "删除",
        icon: "trash",
        kbd: "Del",
        disabled: readOnly || !onDelete,
        onSelect: () => onDelete?.(contextMenuAnnotation),
      },
    ];
  }

  if (!selectedAnnotation || selectedAnnotation.id !== contextMenuTargetId || !isVideoTrack(selectedAnnotation)) return [];
  const frameEditDisabled = !trackActions.canEditSelectedTrack;
  const trackMutationDisabled = readOnly || trackActions.selectedTrackLocked;
  return [
    {
      id: "outside",
      label: trackActions.currentFrameOutside ? "恢复显示" : "标记消失",
      icon: "eyeOff",
      kbd: "O",
      disabled: frameEditDisabled,
      onSelect: trackActions.toggleSelectedTrackOutside,
    },
    {
      id: "occluded",
      label: trackActions.currentFrameOccluded ? "取消遮挡" : "标记遮挡",
      icon: "rect",
      kbd: "Q",
      disabled: frameEditDisabled,
      onSelect: trackActions.toggleSelectedTrackOccluded,
    },
    { id: "state-divider", divider: true, label: "" },
    {
      id: "locked",
      label: trackActions.selectedTrackLocked ? "解锁轨迹" : "锁定轨迹",
      icon: trackActions.selectedTrackLocked ? "unlock" : "lock",
      kbd: "L",
      disabled: readOnly || !onToggleLockedTrack,
      onSelect: trackActions.toggleSelectedTrackLocked,
    },
    {
      id: "hidden",
      label: trackActions.selectedTrackHidden ? "显示轨迹" : "隐藏轨迹",
      icon: trackActions.selectedTrackHidden ? "eyeOff" : "eye",
      kbd: "H",
      disabled: readOnly || !onToggleHiddenTrack,
      onSelect: trackActions.toggleSelectedTrackHidden,
    },
    {
      id: "propagate",
      label: "AI 追踪",
      icon: "bot",
      kbd: "Ctrl+B",
      disabled: frameEditDisabled || !onPropagateTrack,
      onSelect: trackActions.propagateSelectedTrack,
    },
    { id: "edit-divider", divider: true, label: "" },
    {
      id: "class",
      label: "改类别",
      icon: "tag",
      disabled: trackMutationDisabled || !onChangeUserBoxClass,
      onSelect: () => onChangeUserBoxClass?.(selectedAnnotation.id),
    },
    {
      id: "split-frame",
      label: "当前帧转独立框",
      icon: "box",
      disabled: trackMutationDisabled || !onConvertToBboxes,
      onSelect: () => onConvertToBboxes?.(selectedAnnotation, {
        operation: "split",
        scope: "frame",
        frameIndex,
      }),
    },
    {
      id: "delete-keyframe",
      label: "删除当前关键帧",
      icon: "trash",
      kbd: "Del",
      disabled: !canDeleteSelectedTrackKeyframe,
      onSelect: deleteSelectedTrackKeyframe,
    },
    {
      id: "delete-track",
      label: "删除整条轨迹",
      icon: "trash",
      kbd: "Ctrl+Del",
      disabled: trackMutationDisabled || !onDelete,
      onSelect: () => onDelete?.(selectedAnnotation),
    },
  ];
}
