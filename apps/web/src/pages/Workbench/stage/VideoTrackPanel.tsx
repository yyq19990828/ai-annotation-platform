import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import type { AttributeSchema } from "@/api/projects";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import type { VideoTrackerJobState } from "@/hooks/useVideoTrackerJobs";
import type { DiffMode } from "../modes/types";
import { displayClassName, getTrackColor } from "./colors";
import { deriveTrackNumber, resolveTrackAtFrame, shortTrackId, sortedKeyframes } from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import { VideoAttributesEditor } from "./VideoAttributesEditor";
import { VideoTrackColorPicker } from "./VideoTrackColorPicker";
import {
  VideoTrackComposeDialog,
  type VideoTrackGapMode,
} from "./VideoTrackComposeDialog";
import {
  VideoKeyframesPropagateDialog,
  type VideoKeyframesPropagateSubmit,
} from "./VideoKeyframesPropagateDialog";
import type { TrackMarkPatch } from "./useVideoTrackActions";
import styles from "./VideoTrackPanel.module.css";
import type {
  VideoFrameEntry,
  VideoTrackAnnotation,
  VideoTrackConversionOptions,
  VideoTrackGhost,
} from "./videoStageTypes";
import { VideoTrackerJobBadge } from "./VideoTrackerJobBadge";

interface VideoTrackPanelProps {
  videoTracks: VideoTrackAnnotation[];
  selectedId: string | null;
  selectedTrackIds: Set<string>;
  selectedTrack: VideoTrackAnnotation | null;
  selectedTrackGhost: VideoTrackGhost | null;
  selectedTrackLocked: boolean;
  currentFrameOutside: boolean;
  frameIndex: number;
  userId?: string | null;
  trackFilter?: TrackFilter;
  readOnly: boolean;
  selectedBboxCount?: number;
  classes?: string[];
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  onSelect: (id: string, opts?: { toggle?: boolean }) => void;
  onToggleHiddenTrack: (trackId: string) => void;
  onToggleLockedTrack: (trackId: string) => void;
  onSeekFrame?: (frameIndex: number) => void;
  onStartNewTrack?: () => void;
  onChangeUserBoxClass?: (id: string, anchor?: { left: number; top: number }) => void;
  onBatchRenameTracks?: (className: string) => void;
  onBatchDeleteTracks?: () => void;
  onAggregateSelectedBboxes?: () => void;
  onSplitSelectedTrack?: () => void;
  onMergeSelectedTracks?: () => void;
  canMergeSelectedTracks?: boolean;
  // v0.10.30 · 2.5 Join: 选中两条同类且帧号不重叠的轨迹时跳连, gapMode 由 ComposeDialog 选定。
  onJoinSelectedTracks?: (gapMode: VideoTrackGapMode) => void;
  canJoinSelectedTracks?: boolean;
  onShowSelectedTracks?: () => void;
  onHideSelectedTracks?: () => void;
  onLockSelectedTracks?: () => void;
  onUnlockSelectedTracks?: () => void;
  onMarkSelectedTrack: (patch: TrackMarkPatch) => void;
  onCopySelectedTrackToCurrentFrame: () => void;
  copiedKeyframeLabel?: string | null;
  canCopyCurrentKeyframe: boolean;
  canPasteKeyframe: boolean;
  onCopyCurrentKeyframe: () => void;
  onPasteKeyframeToCurrentFrame: () => void;
  onDeleteTrackKeyframe: (annotation: VideoTrackAnnotation, targetFrame: number) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  reviewDisplayMode?: DiffMode;
  trackerJobsByAnnotation?: Record<string, VideoTrackerJobState>;
  onPropagateTrack?: (annotation: VideoTrackAnnotation) => void;
  onCancelTrackerJob?: (jobId: string) => void;
  onAcceptPredictionKeyframe?: (annotation: VideoTrackAnnotation, frameIndex: number) => void;
  onRejectPredictionKeyframe?: (annotation: VideoTrackAnnotation, frameIndex: number) => void;
  // v0.10.30 · 2.3 属性 UI: 当前激活工具的属性 schema + track/帧级属性回写。
  // 全部可选, 未接线时编辑器自动隐藏 (Wave 2 由主进程经 Sidebar 透传)。
  attributeSchema?: AttributeSchema;
  onUpdateTrackAttributes?: (annotation: VideoTrackAnnotation, attributes: Record<string, unknown>) => void;
  onUpdateKeyframeAttributes?: (annotation: VideoTrackAnnotation, frameIndex: number, attributes: Record<string, unknown>) => void;
  // v0.10.30 · 2.6 Propagate: 当前帧框复制到后续 N 帧 (纯前端)。
  onPropagateKeyframe?: (
    annotation: VideoTrackAnnotation,
    fromFrame: number,
    count: number,
    options: { direction: "forward" | "backward"; overwrite: boolean },
  ) => void;
  // v0.10.30 · 2.1 semantic_label inline 编辑 (回写 geometry.semantic_label)。
  onUpdateSemanticLabel?: (annotation: VideoTrackAnnotation, semanticLabel: string) => void;
  // v0.10.30 · 1A 选色器: session 级覆盖 (trackId → oklch), 未接线时回落到 classColor。
  trackColorOverrides?: Record<string, string>;
  onSetTrackColor?: (trackId: string, colorToken: string | null) => void;
  // v0.10.35 · §A: 采样网格步长, 透传给 propagate 对话框 (>1 时 count 以网格格子为单位)。
  samplingStep?: number;
  propagateOverwrite?: boolean | null;
}

function frameRange(frames: number[]): string {
  if (frames.length === 0) return "无帧";
  const min = Math.min(...frames);
  const max = Math.max(...frames);
  return min === max ? `F${min}` : `F${min}-F${max}`;
}

function keyframeStatus(kf: VideoTrackKeyframe, outside: boolean): string {
  if (outside) return "消失";
  if (kf.occluded) return "遮挡";
  return "正常";
}

function firstVisibleTrackFrame(track: VideoTrackAnnotation["geometry"]): number | null {
  if (track.keyframes.length === 0) return null;
  const visible = track.keyframes.filter((kf) => !isFrameOutside(track, kf.frame_index));
  const frames = (visible.length > 0 ? visible : track.keyframes).map((kf) => kf.frame_index);
  return Math.min(...frames);
}

function exactFrameLabel(selectedTrack: VideoTrackAnnotation | null, frameIndex: number, outside: boolean): string {
  if (!selectedTrack) return `F${frameIndex}`;
  if (outside) return `F${frameIndex} · 消失`;
  const exact = selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex);
  if (exact?.occluded) return `F${frameIndex} · 遮挡`;
  return `F${frameIndex} · ${exact ? "关键帧" : "非关键帧"}`;
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function statusChipText(kf: VideoTrackKeyframe | undefined, outside = false): string {
  if (outside) return "当前消失";
  if (kf?.occluded) return "当前遮挡";
  return kf ? "关键帧" : "非关键帧";
}

function sourceChipText(source: VideoFrameEntry["source"] | null): string {
  if (source === "prediction") return "prediction";
  if (source === "interpolated") return "interpolated";
  if (source === "legacy") return "legacy bbox";
  if (source === "manual") return "manual";
  return "无当前帧";
}

function sourceChipClass(source: VideoFrameEntry["source"] | null): string | null {
  if (source === "prediction") return styles.sourcePrediction;
  if (source === "interpolated") return styles.sourceInterpolated;
  if (source === "manual" || source === "legacy") return styles.sourceManual;
  return null;
}

function visibleInReviewMode(source: VideoFrameEntry["source"] | null, mode?: DiffMode): boolean {
  if (!mode || mode === "diff") return true;
  if (!source) return false;
  if (mode === "raw") return source === "prediction" || source === "interpolated";
  return source === "manual" || source === "legacy";
}

function nextPredictionFrame(track: VideoTrackAnnotation["geometry"], frameIndex: number): number | null {
  const predictionFrames = sortedKeyframes(track)
    .filter((kf) => kf.source === "prediction" && !isFrameOutside(track, kf.frame_index))
    .map((kf) => kf.frame_index);
  return predictionFrames.find((frame) => frame > frameIndex) ?? predictionFrames[0] ?? null;
}

export type TrackFilter = "all" | "current";

export function VideoTrackPanel({
  videoTracks,
  selectedId,
  selectedTrackIds,
  selectedTrack,
  selectedTrackGhost,
  selectedTrackLocked,
  currentFrameOutside,
  frameIndex,
  userId,
  trackFilter = "all",
  readOnly,
  selectedBboxCount = 0,
  classes,
  hiddenTrackIds,
  lockedTrackIds,
  onSelect,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onSeekFrame,
  onStartNewTrack,
  onChangeUserBoxClass,
  onBatchRenameTracks,
  onBatchDeleteTracks,
  onAggregateSelectedBboxes,
  onSplitSelectedTrack,
  onMergeSelectedTracks,
  canMergeSelectedTracks = false,
  onJoinSelectedTracks,
  canJoinSelectedTracks = false,
  onShowSelectedTracks,
  onHideSelectedTracks,
  onLockSelectedTracks,
  onUnlockSelectedTracks,
  onMarkSelectedTrack,
  onCopySelectedTrackToCurrentFrame,
  copiedKeyframeLabel,
  canCopyCurrentKeyframe,
  canPasteKeyframe,
  onCopyCurrentKeyframe,
  onPasteKeyframeToCurrentFrame,
  onDeleteTrackKeyframe,
  onConvertToBboxes,
  reviewDisplayMode,
  trackerJobsByAnnotation = {},
  onPropagateTrack,
  onCancelTrackerJob,
  onAcceptPredictionKeyframe,
  onRejectPredictionKeyframe,
  attributeSchema,
  onUpdateTrackAttributes,
  onUpdateKeyframeAttributes,
  onPropagateKeyframe,
  onUpdateSemanticLabel,
  trackColorOverrides,
  onSetTrackColor,
  samplingStep,
  propagateOverwrite,
}: VideoTrackPanelProps) {
  const batchCount = selectedTrackIds.size;
  const batchSelectionDisabled = batchCount <= 1;
  const batchMutationDisabled = readOnly || batchSelectionDisabled;
  const canAggregateBboxes = !readOnly && selectedBboxCount > 1 && Boolean(onAggregateSelectedBboxes);
  const currentFrameLabel = exactFrameLabel(selectedTrack, frameIndex, currentFrameOutside);
  // 属性区折叠态（v0.11.28：与图片侧栏一致，属性区可折叠让出空间）。
  const [attrCollapsed, setAttrCollapsed] = useState(false);
  const [propagateOpen, setPropagateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  // 当前打开取色器的 trackId; null 表示关闭。
  const [colorPickerTrackId, setColorPickerTrackId] = useState<string | null>(null);
  const canEditColor = !readOnly && Boolean(onSetTrackColor);
  // semantic_label inline 编辑草稿; null 表示同步 selectedTrack 当前值。
  const [semanticDraft, setSemanticDraft] = useState<string | null>(null);
  const selectedTrackKey = selectedTrack?.id ?? null;
  // 切换选中 track 时重置草稿, 避免上一条 track 的编辑残留。
  useEffect(() => {
    setSemanticDraft(null);
  }, [selectedTrackKey]);
  const semanticValue = semanticDraft ?? selectedTrack?.geometry.semantic_label ?? "";
  const commitSemanticLabel = () => {
    if (!selectedTrack || semanticDraft === null) return;
    const next = semanticDraft.trim();
    if (next === (selectedTrack.geometry.semantic_label ?? "")) {
      setSemanticDraft(null);
      return;
    }
    onUpdateSemanticLabel?.(selectedTrack, next);
    setSemanticDraft(null);
  };
  // 当前帧是否有可写关键帧 (非消失帧)。
  const currentFrameHasKeyframe = selectedTrack
    ? resolveTrackAtFrame(selectedTrack.geometry, frameIndex) !== null
    : false;
  const canPropagate = Boolean(
    selectedTrack
    && !readOnly
    && !selectedTrackLocked
    && onPropagateKeyframe
    && resolveTrackAtFrame(selectedTrack.geometry, frameIndex) !== null,
  );
  const filteredVideoTracks = useMemo(
    () => videoTracks.filter((ann) => {
      const currentSource = resolveTrackAtFrame(ann.geometry, frameIndex)?.source ?? null;
      if (trackFilter === "all") return true;
      if (!currentSource) return false;
      return visibleInReviewMode(currentSource, reviewDisplayMode);
    }),
    [frameIndex, reviewDisplayMode, trackFilter, videoTracks],
  );
  const trackNumbers = useMemo(() => deriveTrackNumber(videoTracks), [videoTracks]);
  const selectedTrackNextPredictionFrame = selectedTrack
    ? nextPredictionFrame(selectedTrack.geometry, frameIndex)
    : null;
  const selectedTrackCurrentSource = selectedTrack
    ? resolveTrackAtFrame(selectedTrack.geometry, frameIndex)?.source ?? null
    : null;
  const selectedTrackCurrentKeyframe = selectedTrack
    ? selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex) ?? null
    : null;
  const selectedTrackOccluded = !currentFrameOutside && Boolean(selectedTrackCurrentKeyframe?.occluded);
  const selectedTrackFrames = selectedTrack?.geometry.keyframes.map((kf) => kf.frame_index) ?? [];
  const convertTrackMenuItems = useMemo<DropdownItem[]>(() => {
    const disabled = !selectedTrack || readOnly || !onConvertToBboxes;
    return [
      {
        id: "copy-keyframes",
        label: "复制关键帧",
        icon: "box",
        disabled,
        onSelect: () => selectedTrack && onConvertToBboxes?.(selectedTrack, {
          operation: "copy",
          scope: "track",
          frameMode: "keyframes",
        }),
      },
      {
        id: "copy-all-frames",
        label: "复制全帧",
        icon: "film",
        disabled,
        onSelect: () => selectedTrack && onConvertToBboxes?.(selectedTrack, {
          operation: "copy",
          scope: "track",
          frameMode: "all_frames",
        }),
      },
      { id: "convert-divider", divider: true, label: "" },
      {
        id: "split-keyframes",
        label: "拆关键帧",
        icon: "scissors",
        disabled,
        onSelect: () => selectedTrack && onConvertToBboxes?.(selectedTrack, {
          operation: "split",
          scope: "track",
          frameMode: "keyframes",
        }),
      },
      {
        id: "split-all-frames",
        label: "拆全帧",
        icon: "film",
        disabled,
        onSelect: () => selectedTrack && onConvertToBboxes?.(selectedTrack, {
          operation: "split",
          scope: "track",
          frameMode: "all_frames",
        }),
      },
    ];
  }, [onConvertToBboxes, readOnly, selectedTrack]);

  return (
    <div className={styles.panelRoot}>
      <div className={styles.filterCard}>
        <div className={styles.rowBetween}>
          <div className={styles.headingActionGroup}>
            <b className={styles.heading}>轨迹</b>
            <Button
              size="sm"
              className={styles.iconButton}
              disabled={readOnly || !onStartNewTrack}
              title="清除当前轨迹选择，下一次画框会新建轨迹"
              aria-label="新建轨迹"
              onClick={onStartNewTrack}
            >
              <Icon name="plus" size={14} />
            </Button>
          </div>
          <span className={cn("mono", styles.mutedMono)}>
            {trackFilter === "current" ? `${filteredVideoTracks.length}/${videoTracks.length}` : videoTracks.length}
          </span>
        </div>
        {selectedBboxCount > 1 && (
          <Button
            size="sm"
            className={styles.aggregateButton}
            disabled={!canAggregateBboxes}
            title="把已多选的单帧 video_bbox 聚合为一条 video_track"
            onClick={onAggregateSelectedBboxes}
          >
            <Icon name="link" size={13} />聚合 {selectedBboxCount} 个框
          </Button>
        )}
      </div>
      <div className={cn(styles.section, selectedTrack && styles.trackListSection)}>
        {batchCount > 1 && (
          <div
            data-testid="video-track-batch-toolbar"
            className={styles.batchToolbar}
          >
            <div className={styles.rowBetween}>
              <b className={styles.subheading}>已选 {batchCount} 条轨迹</b>
              <select
                aria-label="批量改类"
                value=""
                disabled={batchMutationDisabled || !onBatchRenameTracks || !classes?.length}
                onChange={(e) => {
                  if (!e.target.value) return;
                  onBatchRenameTracks?.(e.target.value);
                  e.target.value = "";
                }}
                className={styles.batchSelect}
              >
                <option value="">改类</option>
                {(classes ?? []).map((cls) => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </select>
            </div>
            <div className={styles.buttonRow}>
              <Button size="sm" className={styles.compactButton} disabled={!onShowSelectedTracks} onClick={onShowSelectedTracks}>显示</Button>
              <Button size="sm" className={styles.compactButton} disabled={!onHideSelectedTracks} onClick={onHideSelectedTracks}>隐藏</Button>
              <Button size="sm" className={styles.compactButton} disabled={batchSelectionDisabled || !onLockSelectedTracks} onClick={onLockSelectedTracks}>锁定</Button>
              <Button size="sm" className={styles.compactButton} disabled={batchSelectionDisabled || !onUnlockSelectedTracks} onClick={onUnlockSelectedTracks}>解锁</Button>
              <Button
                size="sm"
                className={styles.compactButton}
                disabled={batchMutationDisabled || !canMergeSelectedTracks || !onMergeSelectedTracks}
                title={canMergeSelectedTracks ? "合并两条同类且不重叠的轨迹" : "只支持合并两条同类轨迹"}
                onClick={onMergeSelectedTracks}
              >
                合并
              </Button>
              <Button
                size="sm"
                className={styles.compactButton}
                disabled={batchMutationDisabled || !canJoinSelectedTracks || !onJoinSelectedTracks}
                title={canJoinSelectedTracks ? "跳连两条同类且帧号不重叠的轨迹 (补 gap)" : "只支持跳连两条同类且帧号不重叠的轨迹"}
                onClick={() => setJoinOpen(true)}
              >
                跳连
              </Button>
              <Button size="sm" className={styles.compactButton} variant="danger" disabled={batchMutationDisabled || !onBatchDeleteTracks} onClick={onBatchDeleteTracks}>
                删除
              </Button>
            </div>
          </div>
        )}
      <div className={styles.section}>
        {filteredVideoTracks.map((ann) => {
          const track = ann.geometry;
          const color = getTrackColor(track.track_id, ann.class_name, trackColorOverrides);
          const hasColorOverride = Boolean(trackColorOverrides?.[track.track_id]);
          const primarySelected = ann.id === selectedId;
          const selected = selectedTrackIds.has(ann.id) || primarySelected;
          const hidden = hiddenTrackIds.has(track.track_id);
          const locked = lockedTrackIds.has(track.track_id);
          const exact = track.keyframes.find((kf) => kf.frame_index === frameIndex);
          const outside = isFrameOutside(track, frameIndex);
          const currentSource = resolveTrackAtFrame(track, frameIndex)?.source ?? null;
          const sourceLabel = ann.source === "prediction_based" ? "AI 采纳" : "手动";
          const frames = track.keyframes.map((kf) => kf.frame_index);
          return (
            <div
              key={ann.id}
              data-testid="video-track-row"
              aria-selected={selected}
              onClick={(e) => {
                const toggle = e.shiftKey || e.metaKey || e.ctrlKey;
                if (!toggle) {
                  const targetFrame = firstVisibleTrackFrame(track);
                  if (targetFrame !== null) onSeekFrame?.(targetFrame);
                }
                onSelect(ann.id, { toggle });
              }}
              className={cn(
                styles.trackRow,
                selected && styles.trackRowSelected,
                primarySelected && batchCount > 1 && styles.trackRowPrimarySelected,
              )}
            >
              <div className={styles.trackRowTop}>
                <div className={styles.trackMeta}>
                  <button
                    type="button"
                    className={styles.colorDotButton}
                    data-testid="video-track-color-dot"
                    title={canEditColor ? "修改轨迹颜色" : undefined}
                    disabled={!canEditColor}
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorPickerTrackId((prev) => (prev === track.track_id ? null : track.track_id));
                    }}
                  >
                    <svg className={styles.trackColorDot} aria-hidden="true" viewBox="0 0 10 10">
                      <circle cx="5" cy="5" r="5" fill={color} />
                    </svg>
                    {colorPickerTrackId === track.track_id && (
                      <div className={styles.colorPickerPopover} onClick={(e) => e.stopPropagation()}>
                        <VideoTrackColorPicker
                          currentColor={color}
                          hasOverride={hasColorOverride}
                          onPick={(picked) => {
                            onSetTrackColor?.(track.track_id, picked);
                            setColorPickerTrackId(null);
                          }}
                          onReset={() => {
                            onSetTrackColor?.(track.track_id, null);
                            setColorPickerTrackId(null);
                          }}
                          onClose={() => setColorPickerTrackId(null)}
                        />
                      </div>
                    )}
                  </button>
                  <div className={styles.trackTitleRow}>
                    <span className={cn("mono", styles.trackNumberBadge)}>
                      #{trackNumbers.get(ann.id) ?? "?"}
                    </span>
                    <b className={styles.truncateTitle}>
                      {displayClassName(ann.class_name)}
                    </b>
                    <span className={styles.compactBadge}>
                      <Badge variant={ann.source === "prediction_based" ? "default" : "accent"}>
                        {sourceLabel}
                      </Badge>
                    </span>
                    <span className={cn("mono", styles.mutedMono)}>{shortTrackId(track.track_id)}</span>
                  </div>
                  <div className={cn("mono", styles.trackMetaText)}>
                    {track.keyframes.length} 关键帧 · {frameRange(frames)}
                  </div>
                </div>
                <div className={styles.trackRowActions}>
                  <Button
                    size="sm"
                    className={cn(styles.iconButton, styles.iconButtonLarge)}
                    title={hidden ? "显示轨迹" : "隐藏轨迹"}
                    onClick={(e) => { e.stopPropagation(); onToggleHiddenTrack(track.track_id); }}
                  >
                    <Icon name={hidden ? "eyeOff" : "eye"} size={14} />
                  </Button>
                  <Button
                    size="sm"
                    className={cn(styles.iconButton, styles.iconButtonLarge)}
                    title={locked ? "解锁轨迹" : "锁定轨迹"}
                    onClick={(e) => { e.stopPropagation(); onToggleLockedTrack(track.track_id); }}
                  >
                    <Icon name={locked ? "lock" : "unlock"} size={14} />
                  </Button>
                  <Button
                    size="sm"
                    className={cn(styles.iconButton, styles.iconButtonLarge)}
                    title="重命名轨迹类别"
                    disabled={readOnly || !onChangeUserBoxClass}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      onChangeUserBoxClass?.(ann.id, { left: rect.left, top: rect.bottom + 6 });
                    }}
                  >
                    <Icon name="edit" size={14} />
                  </Button>
                </div>
              </div>
              <div className={styles.trackSignals}>
                <span
                  className={cn(styles.statusChip, outside && styles.statusChipDanger)}
                >
                  {statusChipText(exact, outside)}
                </span>
                <span
                  data-testid="video-track-current-source"
                  className={cn(styles.sourceChip, sourceChipClass(currentSource))}
                >
                  {sourceChipText(currentSource)}
                </span>
              </div>
            </div>
          );
        })}
        {videoTracks.length === 0 && (
          <div className={styles.emptyText}>
            暂无轨迹。暂停后画框会创建第一条轨迹。
          </div>
        )}
        {videoTracks.length > 0 && filteredVideoTracks.length === 0 && (
          <div className={styles.emptyText}>
            当前帧暂无轨迹。
          </div>
        )}
      </div>
      </div>

      <div className={cn(styles.sectionWithTopPadding, selectedTrack && styles.selectedTrackSection)}>
        <div className={styles.rowBetween}>
          <b className={styles.heading}>当前轨迹</b>
          {selectedTrack && (
            <span className={cn("mono", styles.mutedMono)}>
              {shortTrackId(selectedTrack.geometry.track_id)}
            </span>
          )}
        </div>
        {selectedTrack ? (
          <div className={styles.selectedTrackCard}>
            <div className={styles.selectedHeader}>
              <div className={styles.trackMeta}>
                <svg className={styles.trackColorDot} aria-hidden="true" viewBox="0 0 10 10">
                  <circle cx="5" cy="5" r="5" fill={getTrackColor(selectedTrack.geometry.track_id, selectedTrack.class_name, trackColorOverrides)} />
                </svg>
                <div className={styles.trackTitleRow}>
                  <b className={styles.truncateTitle}>
                    {displayClassName(selectedTrack.class_name)}
                  </b>
                  <span className={styles.compactBadge}>
                    <Badge variant={selectedTrack.source === "prediction_based" ? "default" : "accent"}>
                      {selectedTrack.source === "prediction_based" ? "AI 采纳" : "手动"}
                    </Badge>
                  </span>
                  <span className={cn("mono", styles.mutedMono)}>
                    {shortTrackId(selectedTrack.geometry.track_id)}
                  </span>
                </div>
              </div>
              <div className={styles.selectedHeaderActions}>
                <Button
                  size="sm"
                  className={styles.iconButton}
                  title="复制轨迹 ID"
                  onClick={() => copyText(selectedTrack.geometry.track_id)}
                >
                  <Icon name="copy" size={13} />
                </Button>
                <DropdownMenu
                  items={convertTrackMenuItems}
                  minWidth={168}
                  trigger={({ open, toggle, ref }) => (
                    <Button
                      ref={ref}
                      type="button"
                      size="sm"
                      className={styles.iconButton}
                      disabled={readOnly || !onConvertToBboxes}
                      title="转换为独立框"
                      aria-label="转换为独立框"
                      aria-expanded={open}
                      onClick={toggle}
                    >
                      <Icon name="more" size={14} />
                    </Button>
                  )}
                />
              </div>
            </div>
            <div className={styles.selectedStatsGrid}>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>当前帧</span>
                <b className={cn("mono", styles.statValue)}>{currentFrameLabel}</b>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>当前来源</span>
                <b className={cn(styles.statValue, sourceChipClass(selectedTrackCurrentSource))}>
                  {sourceChipText(selectedTrackCurrentSource)}
                </b>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>关键帧</span>
                <b className={cn("mono", styles.statValue)}>{selectedTrack.geometry.keyframes.length}</b>
              </div>
              <div className={styles.statCell}>
                <span className={styles.statLabel}>范围</span>
                <b className={cn("mono", styles.statValue)}>{frameRange(selectedTrackFrames)}</b>
              </div>
            </div>
            <details
              className={styles.actionDisclosure}
              data-testid="video-track-actions-disclosure"
            >
              <summary
                className={styles.actionSummary}
                data-testid="video-track-actions-summary"
              >
                <span className={styles.summaryTitle}>轨迹操作</span>
                <span className={styles.summaryMeta}>4 个动作</span>
                <Icon name="chevDown" size={14} className={styles.summaryChevron} />
              </summary>
              <div className={styles.actionDisclosureBody}>
                <div className={styles.actionGrid}>
                  <Button
                    size="sm"
                    className={styles.currentActionButton}
                    disabled={readOnly || selectedTrackLocked || !onSplitSelectedTrack}
                    title="在当前帧之后拆出后段轨迹"
                    onClick={onSplitSelectedTrack}
                  >
                    <Icon name="scissors" size={13} />拆轨迹
                  </Button>
                  <Button
                    size="sm"
                    className={styles.currentActionButton}
                    disabled={selectedTrackNextPredictionFrame === null || !onSeekFrame}
                    title="跳转到下一条 prediction 关键帧"
                    onClick={() => {
                      if (selectedTrackNextPredictionFrame !== null) onSeekFrame?.(selectedTrackNextPredictionFrame);
                    }}
                  >
                    <Icon name="arrowRight" size={13} />下一预测
                  </Button>
                  <Button
                    size="sm"
                    className={styles.currentActionButton}
                    disabled={readOnly || selectedTrackLocked || !onPropagateTrack}
                    title="发起 AI 传播 (Shift+T)"
                    onClick={() => onPropagateTrack?.(selectedTrack)}
                  >
                    <Icon name="bot" size={13} />AI 传播
                  </Button>
                  <Button
                    size="sm"
                    className={styles.currentActionButton}
                    disabled={!canPropagate}
                    title="把当前帧的框复制到后续/向前 N 帧"
                    onClick={() => setPropagateOpen(true)}
                  >
                    <Icon name="layers" size={13} />复制后续
                  </Button>
                </div>
              </div>
            </details>
            {onUpdateSemanticLabel && (
              <label className={styles.semanticRow}>
                <span className={styles.semanticLabel}>语义标签</span>
                <input
                  type="text"
                  data-testid="video-track-semantic-label-input"
                  className={styles.semanticInput}
                  placeholder="如 car_3 (跨任务 Re-ID)"
                  value={semanticValue}
                  disabled={readOnly || selectedTrackLocked}
                  onChange={(e) => setSemanticDraft(e.target.value)}
                  onBlur={commitSemanticLabel}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setSemanticDraft(null);
                  }}
                />
              </label>
            )}
            {trackerJobsByAnnotation[selectedTrack.id] && (
              <div data-testid="video-tracker-job-row" className={styles.trackerJobRow}>
                <VideoTrackerJobBadge
                  job={trackerJobsByAnnotation[selectedTrack.id]}
                  onCancel={onCancelTrackerJob}
                />
              </div>
            )}
            <details
              className={styles.actionDisclosure}
              data-testid="video-frame-actions-disclosure"
            >
              <summary
                className={styles.actionSummary}
                data-testid="video-frame-actions-summary"
              >
                <span className={styles.summaryTitle}>当前帧操作</span>
                <span className={cn("mono", styles.summaryMeta)}>
                  {copiedKeyframeLabel ? `已复制 ${copiedKeyframeLabel}` : "未复制关键帧"}
                </span>
                <Icon name="chevDown" size={14} className={styles.summaryChevron} />
              </summary>
              <div className={styles.actionDisclosureBody}>
                <div className={styles.actionGrid}>
                  <Button
                    size="sm"
                    className={styles.frameActionButton}
                    disabled={!selectedTrackGhost || readOnly || selectedTrackLocked}
                    title="使用最近关键帧的框在当前帧创建关键帧"
                    onClick={onCopySelectedTrackToCurrentFrame}
                  >
                    <Icon name="plus" size={14} />复制到当前帧
                  </Button>
                  <Button
                    size="sm"
                    className={styles.frameActionButton}
                    disabled={!canCopyCurrentKeyframe}
                    title="复制当前轨迹在当前帧的关键帧"
                    onClick={onCopyCurrentKeyframe}
                  >
                    <Icon name="copy" size={14} />复制关键帧
                  </Button>
                  <Button
                    size="sm"
                    className={styles.frameActionButton}
                    disabled={!canPasteKeyframe}
                    title="把已复制的关键帧粘贴到当前帧"
                    onClick={onPasteKeyframeToCurrentFrame}
                  >
                    <Icon name="clipboardPaste" size={14} />粘贴关键帧
                  </Button>
                  <Button
                    size="sm"
                    className={styles.frameActionButton}
                    disabled={!selectedTrack || readOnly || selectedTrackLocked}
                    aria-pressed={currentFrameOutside}
                    title={currentFrameOutside ? "恢复当前帧为正常状态" : "标记当前帧消失"}
                    onClick={() => onMarkSelectedTrack(currentFrameOutside
                      ? { outside: false, occluded: false }
                      : { outside: true, occluded: false })}
                  >
                    <Icon name="eyeOff" size={14} />标记消失
                  </Button>
                  <Button
                    size="sm"
                    className={styles.frameActionButton}
                    disabled={!selectedTrack || readOnly || selectedTrackLocked}
                    aria-pressed={selectedTrackOccluded}
                    title={selectedTrackOccluded ? "恢复当前帧为正常状态" : "标记当前帧遮挡"}
                    onClick={() => onMarkSelectedTrack(selectedTrackOccluded
                      ? { outside: false, occluded: false }
                      : { outside: false, occluded: true })}
                  >
                    <Icon name="rect" size={14} />标记遮挡
                  </Button>
                </div>
              </div>
            </details>
          </div>
        ) : (
          <div className={styles.emptyCompactText}>选择一条轨迹后编辑当前帧状态。</div>
        )}
        {selectedTrack && (
          <>
            <div className={styles.keyframePanel}>
              <div className={styles.keyframePanelHeader}>
                <b className={styles.heading}>关键帧</b>
                <span className={cn("mono", styles.mutedMono)}>
                  {selectedTrack.geometry.keyframes.length}
                </span>
              </div>
              <div className={styles.keyframeTable}>
                <div className={styles.keyframeHeader}>
                  <span>帧</span>
                  <span>状态</span>
                  <span>操作</span>
                </div>
                {sortedKeyframes(selectedTrack.geometry).map((kf) => {
                  const kfOutside = isFrameOutside(selectedTrack.geometry, kf.frame_index);
                  return (
                  <div
                    key={kf.frame_index}
                    data-testid={kf.source === "prediction" ? "video-prediction-keyframe-row" : "video-track-keyframe-row"}
                    className={cn(styles.keyframeRow, kf.source === "prediction" && styles.keyframePredictionRow)}
                  >
                    <span className={cn("mono", styles.keyframeFrame)}>F{kf.frame_index}</span>
                    <span className={cn(styles.keyframeStatus, kfOutside && styles.keyframeStatusAbsent)}>
                      <svg className={styles.keyframeStatusDot} aria-hidden="true" viewBox="0 0 7 7">
                        <circle
                          cx="3.5"
                          cy="3.5"
                          r="3.5"
                          fill={kfOutside ? "var(--color-danger)" : kf.source === "prediction" ? "oklch(0.78 0.14 78)" : "oklch(0.68 0.16 145)"}
                        />
                      </svg>
                      {keyframeStatus(kf, kfOutside)}
                      {kf.source === "prediction" && (
                        <span className={styles.compactBadge}>
                          <Badge variant="default">预测</Badge>
                        </span>
                      )}
                    </span>
                    <span className={styles.keyframeActionRow}>
                      <Button
                        size="sm"
                        className={styles.keyframeButton}
                        disabled={!onSeekFrame}
                        title="跳转到关键帧"
                        aria-label="跳转到关键帧"
                        onClick={() => onSeekFrame?.(kf.frame_index)}
                      >
                        <Icon name="arrowRight" size={13} />
                      </Button>
                      {kf.source === "prediction" && onAcceptPredictionKeyframe && (
                        <Button
                          size="sm"
                          className={cn(styles.keyframeButton, styles.successButton)}
                          disabled={readOnly}
                          title="接受预测：source 改为 manual"
                          aria-label="接受预测"
                          onClick={() => onAcceptPredictionKeyframe(selectedTrack, kf.frame_index)}
                        >
                          <Icon name="check" size={13} />
                        </Button>
                      )}
                      {kf.source === "prediction" && onRejectPredictionKeyframe && (
                        <Button
                          size="sm"
                          className={cn(styles.keyframeButton, styles.dangerButton)}
                          disabled={readOnly}
                          title="拒绝预测：把该帧并入 outside"
                          aria-label="拒绝预测"
                          onClick={() => onRejectPredictionKeyframe(selectedTrack, kf.frame_index)}
                        >
                          <Icon name="x" size={13} />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className={styles.keyframeButton}
                        disabled={readOnly || kfOutside}
                        title="复制此关键帧为独立框"
                        aria-label="复制此关键帧为独立框"
                        onClick={() => onConvertToBboxes?.(selectedTrack, {
                          operation: "copy",
                          scope: "frame",
                          frameIndex: kf.frame_index,
                        })}
                      >
                        <Icon name="box" size={13} />
                      </Button>
                      <Button
                        size="sm"
                        className={styles.keyframeButton}
                        disabled={readOnly || kfOutside}
                        title="拆此关键帧为独立框"
                        aria-label="拆此关键帧为独立框"
                        onClick={() => onConvertToBboxes?.(selectedTrack, {
                          operation: "split",
                          scope: "frame",
                          frameIndex: kf.frame_index,
                        })}
                      >
                        <Icon name="scissors" size={13} />
                      </Button>
                      <Button
                        size="sm"
                        className={cn(styles.keyframeButton, styles.dangerButton)}
                        disabled={readOnly || selectedTrack.geometry.keyframes.length <= 1}
                        title="删除关键帧"
                        aria-label="删除关键帧"
                        onClick={() => onDeleteTrackKeyframe(selectedTrack, kf.frame_index)}
                      >
                        <Icon name="trash" size={13} />
                      </Button>
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>
            {attributeSchema && (onUpdateTrackAttributes || onUpdateKeyframeAttributes) && (
              <div className={styles.attrSection}>
                <button
                  type="button"
                  className={styles.attrSectionHeader}
                  onClick={() => setAttrCollapsed((v) => !v)}
                  aria-expanded={!attrCollapsed}
                  title={attrCollapsed ? "展开属性" : "折叠属性"}
                >
                  <Icon name={attrCollapsed ? "chevRight" : "chevDown"} size={13} />
                  <span>属性</span>
                  <span className={styles.attrSectionClass}>{displayClassName(selectedTrack.class_name)}</span>
                </button>
                {!attrCollapsed && (
                  <VideoAttributesEditor
                    schema={attributeSchema}
                    className={selectedTrack.class_name}
                    trackAttributes={selectedTrack.attributes}
                    keyframeAttributes={
                      (selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex) as
                        | { attributes?: Record<string, unknown> | null }
                        | undefined)?.attributes ?? undefined
                    }
                    frameIndex={frameIndex}
                    canEditKeyframe={currentFrameHasKeyframe}
                    readOnly={readOnly || selectedTrackLocked}
                    onChangeTrackAttributes={(attrs) => onUpdateTrackAttributes?.(selectedTrack, attrs)}
                    onChangeKeyframeAttributes={(attrs) => onUpdateKeyframeAttributes?.(selectedTrack, frameIndex, attrs)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
      <VideoKeyframesPropagateDialog
        open={propagateOpen}
        frameIndex={frameIndex}
        userId={userId}
        samplingStep={samplingStep}
        overwriteOverride={propagateOverwrite}
        onCancel={() => setPropagateOpen(false)}
        onSubmit={(payload: VideoKeyframesPropagateSubmit) => {
          setPropagateOpen(false);
          if (!selectedTrack) return;
          onPropagateKeyframe?.(selectedTrack, frameIndex, payload.count, {
            direction: payload.direction,
            overwrite: payload.overwrite,
          });
        }}
      />
      <VideoTrackComposeDialog
        open={joinOpen}
        onCancel={() => setJoinOpen(false)}
        onSubmit={(gapMode: VideoTrackGapMode) => {
          setJoinOpen(false);
          onJoinSelectedTracks?.(gapMode);
        }}
      />
    </div>
  );
}
