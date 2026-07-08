import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import type { DiffMode } from "../modes/types";
import {
  isVideoBbox,
  isVideoTrack,
  trackReferenceAtFrame,
  resolveTrackAtFrame,
  shortTrackId,
  sortedKeyframes,
  upsertKeyframe,
} from "./videoStageGeometry";
import { addOutsideRange, isFrameOutside } from "./videoTrackOutside";
import { useVideoReferenceConfig } from "./videoReferencePredict";
import type { AttributeSchema } from "@/api/projects";
import { VideoTrackPanel, type TrackFilter } from "./VideoTrackPanel";
import { VideoTrackCardContent } from "../shell/selectionCard/VideoTrackCardContent";
import type { VideoTrackGapMode } from "./VideoTrackComposeDialog";
import { useVideoTrackActions } from "./useVideoTrackActions";
// VideoTrackerJobState type imported lazily via inline import in props
import type {
  VideoFrameEntry,
  VideoTrackAnnotation,
  VideoTrackCompositionOptions,
  VideoTrackConversionOptions,
  VideoTrackGhost,
} from "./videoStageTypes";

interface VideoTrackSidebarProps {
  annotations: AnnotationResponse[];
  selectedId: string | null;
  selectedIds?: string[];
  frameIndex: number;
  userId?: string | null;
  trackFilter?: TrackFilter;
  /** roster = 右栏纯轨迹清单(默认);card = 画布内选中卡的单轨迹两层信息。 */
  view?: "roster" | "card";
  /** 视频帧率 / 帧尺寸,仅 card 视图用于帧定位时间码 + 当前帧几何指标。 */
  fps?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  readOnly: boolean;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  classes?: string[];
  onSelect: (id: string | null) => void;
  onToggleHiddenTrack: (trackId: string) => void;
  onToggleLockedTrack: (trackId: string) => void;
  onSeekFrame?: (frameIndex: number) => void;
  onChangeUserBoxClass?: (id: string, anchor?: { left: number; top: number }) => void;
  onRenameTracks?: (annotations: AnnotationResponse[], className: string) => void;
  onDeleteTracks?: (annotations: AnnotationResponse[]) => void;
  onUpdate: (annotation: AnnotationResponse, geometry: VideoTrackAnnotation["geometry"]) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  onComposeTracks?: (options: VideoTrackCompositionOptions) => void;
  /** v0.21.16 WS3 · 上报轨迹多选态给 shell (浮卡多选批量卡消费)。仅 roster 实例传入。 */
  onSelectionChange?: (selectedTracks: VideoTrackAnnotation[]) => void;
  reviewDisplayMode?: DiffMode;
  trackerJobsByAnnotation?: Record<string, import("@/hooks/useVideoTrackerJobs").VideoTrackerJobState>;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
  onCancelTrackerJob?: (jobId: string) => void;
  // v0.10.30 · 1A 选色器透传 (session 级覆盖)。
  trackColorOverrides?: Record<string, string>;
  onSetTrackColor?: (trackId: string, colorToken: string | null) => void;
  // v0.10.30 · 1B 属性 / propagate / semantic_label 透传。
  attributeSchema?: AttributeSchema;
  onUpdateTrackAttributes?: (annotation: VideoTrackAnnotation, attributes: Record<string, unknown>) => void;
  onUpdateKeyframeAttributes?: (annotation: VideoTrackAnnotation, frameIndex: number, attributes: Record<string, unknown>) => void;
  onPropagateKeyframe?: (
    annotation: VideoTrackAnnotation,
    fromFrame: number,
    count: number,
    options: { direction: "forward" | "backward"; overwrite: boolean },
  ) => void;
  onUpdateSemanticLabel?: (annotation: VideoTrackAnnotation, semanticLabel: string) => void;
  /** v0.10.35 · §A: 采样网格步长, 透传给 propagate 对话框 (>1 时 count 以网格格子为单位)。 */
  samplingStep?: number;
  propagateOverwrite?: boolean | null;
  /** roster 视图「轨迹」分组头折叠态 (受控, 走 workbench.layout 服务端持久); card 视图忽略。 */
  trackSectionCollapsed?: boolean;
  onToggleTrackSection?: () => void;
}

interface CopiedKeyframe {
  trackId: string;
  className: string;
  frameIndex: number;
  keyframe: VideoTrackKeyframe;
}

function cloneKeyframe(keyframe: VideoTrackKeyframe): VideoTrackKeyframe {
  return {
    ...keyframe,
    bbox: { ...keyframe.bbox },
  };
}

// 取一条 track 的可见关键帧帧号区间 (排除 outside 帧)。无可见帧时回落到全部关键帧。
function visibleFrameRange(track: VideoTrackAnnotation["geometry"]): [number, number] | null {
  const visible = track.keyframes.filter((kf) => !isFrameOutside(track, kf.frame_index));
  const frames = (visible.length > 0 ? visible : track.keyframes).map((kf) => kf.frame_index);
  if (frames.length === 0) return null;
  return [Math.min(...frames), Math.max(...frames)];
}

// 两条 track 的可见帧区间是否重叠 (join 要求不重叠)。
export function trackRangesOverlap(a: VideoTrackAnnotation, b: VideoTrackAnnotation): boolean {
  const ra = visibleFrameRange(a.geometry);
  const rb = visibleFrameRange(b.geometry);
  if (!ra || !rb) return true;
  return ra[0] <= rb[1] && rb[0] <= ra[1];
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

export function VideoTrackSidebar({
  annotations,
  selectedId,
  selectedIds = [],
  frameIndex,
  userId,
  trackFilter = "all",
  view = "roster",
  fps = null,
  imageWidth = null,
  imageHeight = null,
  readOnly,
  hiddenTrackIds,
  lockedTrackIds,
  classes,
  onSelect,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onSeekFrame,
  onChangeUserBoxClass,
  onRenameTracks,
  onDeleteTracks,
  onUpdate,
  onConvertToBboxes,
  onComposeTracks,
  onSelectionChange,
  reviewDisplayMode,
  trackerJobsByAnnotation,
  onPropagateTrack,
  onCancelTrackerJob,
  trackColorOverrides,
  onSetTrackColor,
  attributeSchema,
  onUpdateTrackAttributes,
  onUpdateKeyframeAttributes,
  onPropagateKeyframe,
  onUpdateSemanticLabel,
  samplingStep,
  propagateOverwrite,
  trackSectionCollapsed = false,
  onToggleTrackSection,
}: VideoTrackSidebarProps) {
  const videoTracks = useMemo(() => annotations.filter(isVideoTrack), [annotations]);
  const selectedBboxes = useMemo(
    () => annotations.filter((ann) => isVideoBbox(ann) && selectedIds.includes(ann.id)),
    [annotations, selectedIds],
  );
  const selectedTrack = useMemo(
    () => videoTracks.find((ann) => ann.id === selectedId) ?? null,
    [selectedId, videoTracks],
  );
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set());
  const [copiedKeyframe, setCopiedKeyframe] = useState<CopiedKeyframe | null>(null);

  useEffect(() => {
    setSelectedTrackIds((prev) => {
      const availableIds = new Set(videoTracks.map((ann) => ann.id));
      const next = new Set([...prev].filter((id) => availableIds.has(id)));
      if (selectedTrack) {
        if (!next.has(selectedTrack.id)) {
          next.clear();
          next.add(selectedTrack.id);
        }
      } else if (!selectedId || !availableIds.has(selectedId)) {
        next.clear();
      }
      return sameStringSet(prev, next) ? prev : next;
    });
  }, [selectedId, selectedTrack, videoTracks]);

  const selectedTracks = useMemo(
    () => videoTracks.filter((ann) => selectedTrackIds.has(ann.id)),
    [selectedTrackIds, videoTracks],
  );
  // v0.21.16 WS3 · 把轨迹多选态上报给 shell (浮卡多选批量卡消费)。roster 实例是多选唯一 owner,
  // 浮卡实例 (view="card") 不传此回调, 不参与上报, 保证单一数据源。
  useEffect(() => {
    onSelectionChange?.(selectedTracks);
  }, [onSelectionChange, selectedTracks]);
  const canMergeSelectedTracks = selectedTracks.length === 2 && selectedTracks[0].class_name === selectedTracks[1].class_name;
  // join: 恰好两条同类且可见帧区间不重叠的 track。
  const canJoinSelectedTracks = selectedTracks.length === 2
    && selectedTracks[0].class_name === selectedTracks[1].class_name
    && !trackRangesOverlap(selectedTracks[0], selectedTracks[1]);
  // v0.21.14 · 合并 / 跳连禁用时按当前选择态给出动态原因 (差在哪), 而非笼统「只支持…」。
  const mergeDisabledReason = useMemo(() => {
    if (canMergeSelectedTracks) return null;
    if (selectedTracks.length !== 2) return `需恰好选中 2 条轨迹（当前 ${selectedTracks.length} 条）`;
    return "两条轨迹需同类";
  }, [canMergeSelectedTracks, selectedTracks]);
  const joinDisabledReason = useMemo(() => {
    if (canJoinSelectedTracks) return null;
    if (selectedTracks.length !== 2) return `需恰好选中 2 条轨迹（当前 ${selectedTracks.length} 条）`;
    if (selectedTracks[0].class_name !== selectedTracks[1].class_name) return "两条轨迹需同类";
    return "两条轨迹的可见帧区间不能重叠";
  }, [canJoinSelectedTracks, selectedTracks]);

  const currentKeyframe = useMemo(
    () => selectedTrack?.geometry.keyframes.find((kf) => kf.frame_index === frameIndex) ?? null,
    [frameIndex, selectedTrack],
  );

  const currentFrameEntries = useMemo(() => {
    const out: VideoFrameEntry[] = [];
    for (const ann of annotations) {
      if (isVideoBbox(ann) && ann.geometry.frame_index === frameIndex) {
        out.push({ id: ann.id, ann, geom: ann.geometry, className: ann.class_name, source: "legacy" });
      } else if (isVideoTrack(ann) && !hiddenTrackIds.has(ann.geometry.track_id)) {
        const resolved = resolveTrackAtFrame(ann.geometry, frameIndex);
        if (resolved) {
          out.push({
            id: ann.id,
            ann,
            geom: resolved.geom,
            className: ann.class_name,
            source: resolved.source,
            occluded: resolved.occluded,
            trackId: ann.geometry.track_id,
          });
        }
      }
    }
    return out;
  }, [annotations, frameIndex, hiddenTrackIds]);

  const referenceConfig = useVideoReferenceConfig();
  const selectedTrackGhost = useMemo<VideoTrackGhost | null>(() => {
    if (!selectedTrack || hiddenTrackIds.has(selectedTrack.geometry.track_id)) return null;
    // 锁定轨迹视为已确认,不再提示参考框(与画布 ghost 一致)。
    if (lockedTrackIds.has(selectedTrack.geometry.track_id)) return null;
    if (currentFrameEntries.some((entry) => entry.ann.id === selectedTrack.id)) return null;
    const reference = trackReferenceAtFrame(selectedTrack.geometry, frameIndex, referenceConfig.mode, referenceConfig.preset);
    if (!reference) return null;
    return {
      id: `ghost-${selectedTrack.id}`,
      ann: selectedTrack,
      geom: reference.bbox,
      className: selectedTrack.class_name,
      source: "manual",
      trackId: selectedTrack.geometry.track_id,
      originFrame: reference.originFrame,
    };
  }, [currentFrameEntries, frameIndex, hiddenTrackIds, lockedTrackIds, referenceConfig, selectedTrack]);

  const selectedTrackLocked = selectedTrack ? lockedTrackIds.has(selectedTrack.geometry.track_id) : false;
  const trackActions = useVideoTrackActions({
    selectedTrack,
    frameIndex,
    readOnly,
    hiddenTrackIds,
    lockedTrackIds,
    onUpdate,
    onToggleHiddenTrack,
    onToggleLockedTrack,
    onPropagateTrack,
  });

  const selectTrack = useCallback((id: string, opts?: { toggle?: boolean }) => {
    if (opts?.toggle) {
      const next = new Set(selectedTrackIds);
      if (next.has(id) && next.size > 1) {
        next.delete(id);
        setSelectedTrackIds(next);
        onSelect(next.values().next().value ?? id);
        return;
      }
      next.add(id);
      setSelectedTrackIds(next);
      onSelect(id);
      return;
    }
    setSelectedTrackIds(new Set([id]));
    onSelect(id);
  }, [onSelect, selectedTrackIds]);

  const startNewTrack = useCallback(() => {
    setSelectedTrackIds(new Set());
    onSelect(null);
  }, [onSelect]);

  const setSelectedTracksHidden = useCallback((hidden: boolean) => {
    for (const ann of selectedTracks) {
      const isHidden = hiddenTrackIds.has(ann.geometry.track_id);
      if (isHidden !== hidden) onToggleHiddenTrack(ann.geometry.track_id);
    }
  }, [hiddenTrackIds, onToggleHiddenTrack, selectedTracks]);

  // 全选中才算「已隐藏 / 已锁定」→ 切换按钮翻转为反向动作; 部分选中时仍显示正向动作。
  // 空选时 every 恒 true, 会让按钮显示成反向态 —— 故显式要求非空。
  const allSelectedTracksHidden = selectedTracks.length > 0
    && selectedTracks.every((ann) => hiddenTrackIds.has(ann.geometry.track_id));

  const allSelectedTracksLocked = selectedTracks.length > 0
    && selectedTracks.every((ann) => lockedTrackIds.has(ann.geometry.track_id));

  const setSelectedTracksLocked = useCallback((locked: boolean) => {
    for (const ann of selectedTracks) {
      const isLocked = lockedTrackIds.has(ann.geometry.track_id);
      if (isLocked !== locked) onToggleLockedTrack(ann.geometry.track_id);
    }
  }, [lockedTrackIds, onToggleLockedTrack, selectedTracks]);

  const renameSelectedTracks = useCallback((className: string) => {
    if (!className || selectedTracks.length <= 1) return;
    onRenameTracks?.(selectedTracks, className);
  }, [onRenameTracks, selectedTracks]);

  const deleteSelectedTracks = useCallback(() => {
    if (selectedTracks.length <= 1 || !onDeleteTracks) return;
    if (!window.confirm(`确定删除 ${selectedTracks.length} 条轨迹？`)) return;
    onDeleteTracks(selectedTracks);
    setSelectedTrackIds(new Set());
  }, [onDeleteTracks, selectedTracks]);

  // 单条轨迹删除:右栏每行 + 选中卡底部操作栏共用;删整条 = onDeleteTracks([ann])。
  const deleteTrack = useCallback((ann: VideoTrackAnnotation) => {
    if (readOnly || lockedTrackIds.has(ann.geometry.track_id) || !onDeleteTracks) return;
    if (!window.confirm("确定删除这条轨迹？")) return;
    onDeleteTracks([ann]);
  }, [lockedTrackIds, onDeleteTracks, readOnly]);

  const aggregateSelectedBboxes = useCallback(() => {
    if (selectedBboxes.length <= 1 || readOnly || !onComposeTracks) return;
    onComposeTracks({
      operation: "aggregate_bboxes",
      annotationIds: selectedBboxes.map((ann) => ann.id),
      deleteSources: true,
    });
  }, [onComposeTracks, readOnly, selectedBboxes]);

  const splitSelectedTrack = useCallback(() => {
    if (!selectedTrack || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id) || !onComposeTracks) return;
    onComposeTracks({
      operation: "split_track",
      annotationIds: [selectedTrack.id],
      frameIndex,
    });
  }, [frameIndex, lockedTrackIds, onComposeTracks, readOnly, selectedTrack]);

  const mergeSelectedTracks = useCallback(() => {
    if (!canMergeSelectedTracks || readOnly || !onComposeTracks) return;
    onComposeTracks({
      operation: "merge_tracks",
      annotationIds: selectedTracks.map((ann) => ann.id),
    });
  }, [canMergeSelectedTracks, onComposeTracks, readOnly, selectedTracks]);

  const joinSelectedTracks = useCallback((gapMode: VideoTrackGapMode) => {
    if (!canJoinSelectedTracks || readOnly || !onComposeTracks) return;
    onComposeTracks({
      operation: "join_tracks",
      annotationIds: selectedTracks.map((ann) => ann.id),
      gapMode,
    });
  }, [canJoinSelectedTracks, onComposeTracks, readOnly, selectedTracks]);

  const updateSemanticLabel = useCallback((ann: VideoTrackAnnotation, semanticLabel: string) => {
    if (readOnly || lockedTrackIds.has(ann.geometry.track_id)) return;
    onUpdate(ann, { ...ann.geometry, semantic_label: semanticLabel || undefined });
  }, [lockedTrackIds, onUpdate, readOnly]);

  const copySelectedTrackToCurrentFrame = useCallback(() => {
    if (!selectedTrack || !selectedTrackGhost || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    onUpdate(selectedTrack, upsertKeyframe(selectedTrack.geometry, frameIndex, selectedTrackGhost.geom));
  }, [frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack, selectedTrackGhost]);

  const deleteTrackKeyframe = useCallback((ann: VideoTrackAnnotation, targetFrame: number) => {
    if (readOnly || lockedTrackIds.has(ann.geometry.track_id) || ann.geometry.keyframes.length <= 1) return;
    onUpdate(ann, {
      ...ann.geometry,
      keyframes: sortedKeyframes(ann.geometry).filter((kf) => kf.frame_index !== targetFrame),
    });
  }, [lockedTrackIds, onUpdate, readOnly]);

  const copyCurrentKeyframe = useCallback(() => {
    if (!selectedTrack || !currentKeyframe) return;
    setCopiedKeyframe({
      trackId: selectedTrack.geometry.track_id,
      className: selectedTrack.class_name,
      frameIndex,
      keyframe: cloneKeyframe(currentKeyframe),
    });
  }, [currentKeyframe, frameIndex, selectedTrack]);

  const pasteKeyframeToCurrentFrame = useCallback(() => {
    if (!selectedTrack || !copiedKeyframe || readOnly || lockedTrackIds.has(selectedTrack.geometry.track_id)) return;
    onUpdate(
      selectedTrack,
      upsertKeyframe(
        selectedTrack.geometry,
        frameIndex,
        copiedKeyframe.keyframe.bbox,
        {
          source: "manual",
          occluded: copiedKeyframe.keyframe.occluded ?? false,
        },
      ),
    );
  }, [copiedKeyframe, frameIndex, lockedTrackIds, onUpdate, readOnly, selectedTrack]);

  const copiedKeyframeLabel = copiedKeyframe
    ? `${copiedKeyframe.className} ${shortTrackId(copiedKeyframe.trackId)} · F${copiedKeyframe.frameIndex}`
    : null;

  const acceptPredictionKeyframe = useCallback(
    (track: VideoTrackAnnotation, targetFrame: number) => {
      if (readOnly) return;
      const exact = track.geometry.keyframes.find((kf) => kf.frame_index === targetFrame);
      if (!exact || exact.source !== "prediction") return;
      const nextKeyframes = track.geometry.keyframes.map((kf) =>
        kf.frame_index === targetFrame ? { ...kf, source: "manual" as const } : kf,
      );
      onUpdate(track, { ...track.geometry, keyframes: nextKeyframes });
    },
    [onUpdate, readOnly],
  );

  const rejectPredictionKeyframe = useCallback(
    (track: VideoTrackAnnotation, targetFrame: number) => {
      if (readOnly) return;
      const exact = track.geometry.keyframes.find((kf) => kf.frame_index === targetFrame);
      if (!exact || exact.source !== "prediction") return;
      const nextKeyframes = track.geometry.keyframes.filter(
        (kf) => kf.frame_index !== targetFrame,
      );
      const withOutside = addOutsideRange(
        { ...track.geometry, keyframes: nextKeyframes },
        { from: targetFrame, to: targetFrame, source: "prediction" },
      );
      onUpdate(track, withOutside);
    },
    [onUpdate, readOnly],
  );

  if (view === "card") {
    if (!selectedTrack) return null;
    return (
      <VideoTrackCardContent
        selectedTrack={selectedTrack}
        selectedTrackGhost={selectedTrackGhost}
        selectedTrackLocked={selectedTrackLocked}
        currentFrameOutside={trackActions.currentFrameOutside}
        frameIndex={frameIndex}
        fps={fps}
        imageWidth={imageWidth}
        imageHeight={imageHeight}
        userId={userId}
        readOnly={readOnly}
        attributeSchema={attributeSchema}
        trackColorOverrides={trackColorOverrides}
        selectedTrackHidden={hiddenTrackIds.has(selectedTrack.geometry.track_id)}
        copiedKeyframeLabel={copiedKeyframeLabel}
        canCopyCurrentKeyframe={Boolean(selectedTrack && currentKeyframe)}
        canPasteKeyframe={Boolean(copiedKeyframe && selectedTrack && !readOnly && !selectedTrackLocked)}
        trackerJob={trackerJobsByAnnotation?.[selectedTrack.id]}
        samplingStep={samplingStep}
        propagateOverwrite={propagateOverwrite}
        onSeekFrame={onSeekFrame}
        onToggleHidden={() => onToggleHiddenTrack(selectedTrack.geometry.track_id)}
        onToggleLock={() => onToggleLockedTrack(selectedTrack.geometry.track_id)}
        onChangeClass={onChangeUserBoxClass ? (anchor) => onChangeUserBoxClass(selectedTrack.id, anchor) : undefined}
        onDeleteTrack={onDeleteTracks ? () => deleteTrack(selectedTrack) : undefined}
        onSplitSelectedTrack={onComposeTracks ? splitSelectedTrack : undefined}
        onPropagateTrack={onPropagateTrack}
        onMarkSelectedTrack={trackActions.markSelectedTrack}
        onCopySelectedTrackToCurrentFrame={copySelectedTrackToCurrentFrame}
        onCopyCurrentKeyframe={copyCurrentKeyframe}
        onPasteKeyframeToCurrentFrame={pasteKeyframeToCurrentFrame}
        onDeleteTrackKeyframe={deleteTrackKeyframe}
        onConvertToBboxes={onConvertToBboxes}
        onCancelTrackerJob={onCancelTrackerJob}
        onAcceptPredictionKeyframe={acceptPredictionKeyframe}
        onRejectPredictionKeyframe={rejectPredictionKeyframe}
        onUpdateTrackAttributes={onUpdateTrackAttributes}
        onUpdateKeyframeAttributes={onUpdateKeyframeAttributes}
        onPropagateKeyframe={onPropagateKeyframe}
        onUpdateSemanticLabel={onUpdateSemanticLabel ?? updateSemanticLabel}
      />
    );
  }

  return (
    <VideoTrackPanel
      videoTracks={videoTracks}
      selectedId={selectedId}
      selectedTrackIds={selectedTrackIds}
      selectedTrack={selectedTrack}
      frameIndex={frameIndex}
      trackFilter={trackFilter}
      readOnly={readOnly}
      selectedBboxCount={selectedBboxes.length}
      classes={classes}
      hiddenTrackIds={hiddenTrackIds}
      lockedTrackIds={lockedTrackIds}
      onSelect={selectTrack}
      onToggleHiddenTrack={onToggleHiddenTrack}
      onToggleLockedTrack={onToggleLockedTrack}
      onSeekFrame={onSeekFrame}
      onStartNewTrack={startNewTrack}
      onChangeUserBoxClass={onChangeUserBoxClass}
      onDeleteTrack={onDeleteTracks ? deleteTrack : undefined}
      onBatchRenameTracks={onRenameTracks ? renameSelectedTracks : undefined}
      onBatchDeleteTracks={onDeleteTracks ? deleteSelectedTracks : undefined}
      onAggregateSelectedBboxes={onComposeTracks ? aggregateSelectedBboxes : undefined}
      onMergeSelectedTracks={onComposeTracks ? mergeSelectedTracks : undefined}
      canMergeSelectedTracks={canMergeSelectedTracks}
      mergeDisabledReason={mergeDisabledReason}
      onJoinSelectedTracks={onComposeTracks ? joinSelectedTracks : undefined}
      canJoinSelectedTracks={canJoinSelectedTracks}
      joinDisabledReason={joinDisabledReason}
      allSelectedTracksHidden={allSelectedTracksHidden}
      allSelectedTracksLocked={allSelectedTracksLocked}
      onToggleSelectedTracksHidden={() => setSelectedTracksHidden(!allSelectedTracksHidden)}
      onToggleSelectedTracksLocked={() => setSelectedTracksLocked(!allSelectedTracksLocked)}
      reviewDisplayMode={reviewDisplayMode}
      trackColorOverrides={trackColorOverrides}
      onSetTrackColor={onSetTrackColor}
      collapsed={trackSectionCollapsed}
      onToggleCollapsed={onToggleTrackSection}
    />
  );
}
