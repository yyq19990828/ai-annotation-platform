import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { DiffMode } from "../modes/types";
import { displayClassName, getTrackColor } from "./colors";
import { deriveTrackNumber, resolveTrackAtFrame, shortTrackId } from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import { VideoTrackColorPicker } from "./VideoTrackColorPicker";
import {
  VideoTrackComposeDialog,
  type VideoTrackGapMode,
} from "./VideoTrackComposeDialog";
import styles from "./VideoTrackPanel.module.css";
import type { VideoFrameEntry, VideoTrackAnnotation } from "./videoStageTypes";
import { firstVisibleTrackFrame, frameRange, sourceChipText, statusChipText } from "./videoTrackFormat";

export type TrackFilter = "all" | "current";

interface VideoTrackPanelProps {
  videoTracks: VideoTrackAnnotation[];
  selectedId: string | null;
  selectedTrackIds: Set<string>;
  /** 仅用于列表态样式(选中时收紧列表高度);单轨迹详情已迁至选中卡。 */
  selectedTrack: VideoTrackAnnotation | null;
  frameIndex: number;
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
  onDeleteTrack?: (annotation: VideoTrackAnnotation) => void;
  onBatchRenameTracks?: (className: string) => void;
  onBatchDeleteTracks?: () => void;
  onAggregateSelectedBboxes?: () => void;
  onMergeSelectedTracks?: () => void;
  canMergeSelectedTracks?: boolean;
  // v0.10.30 · 2.5 Join: 选中两条同类且帧号不重叠的轨迹时跳连, gapMode 由 ComposeDialog 选定。
  onJoinSelectedTracks?: (gapMode: VideoTrackGapMode) => void;
  canJoinSelectedTracks?: boolean;
  onShowSelectedTracks?: () => void;
  onHideSelectedTracks?: () => void;
  onLockSelectedTracks?: () => void;
  onUnlockSelectedTracks?: () => void;
  reviewDisplayMode?: DiffMode;
  // v0.10.30 · 1A 选色器: session 级覆盖 (trackId → oklch), 未接线时回落到 classColor。
  trackColorOverrides?: Record<string, string>;
  onSetTrackColor?: (trackId: string, colorToken: string | null) => void;
}

function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
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

/**
 * 视频轨迹「清单」(roster):列出所有轨迹 + 行内显隐/锁/改类 + 多选批量(改类/合并/跳连/删除)。
 * 单条选中轨迹的详情 / 操作 / 关键帧 / 属性已迁至画布内选中卡(VideoTrackCardContent),
 * 由 VideoTrackSidebar 的 view="card" 分支渲染,与本清单共享同一份派生状态与回调。
 */
export function VideoTrackPanel({
  videoTracks,
  selectedId,
  selectedTrackIds,
  selectedTrack,
  frameIndex,
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
  onDeleteTrack,
  onBatchRenameTracks,
  onBatchDeleteTracks,
  onAggregateSelectedBboxes,
  onMergeSelectedTracks,
  canMergeSelectedTracks = false,
  onJoinSelectedTracks,
  canJoinSelectedTracks = false,
  onShowSelectedTracks,
  onHideSelectedTracks,
  onLockSelectedTracks,
  onUnlockSelectedTracks,
  reviewDisplayMode,
  trackColorOverrides,
  onSetTrackColor,
}: VideoTrackPanelProps) {
  const batchCount = selectedTrackIds.size;
  const batchSelectionDisabled = batchCount <= 1;
  const batchMutationDisabled = readOnly || batchSelectionDisabled;
  const canAggregateBboxes = !readOnly && selectedBboxCount > 1 && Boolean(onAggregateSelectedBboxes);
  const [joinOpen, setJoinOpen] = useState(false);
  // 当前打开取色器的 trackId; null 表示关闭。
  const [colorPickerTrackId, setColorPickerTrackId] = useState<string | null>(null);
  const canEditColor = !readOnly && Boolean(onSetTrackColor);
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
                  <Button
                    size="sm"
                    variant="danger"
                    className={cn(styles.iconButton, styles.iconButtonLarge)}
                    title="删除整条轨迹"
                    aria-label="删除整条轨迹"
                    disabled={readOnly || locked || !onDeleteTrack}
                    onClick={(e) => { e.stopPropagation(); onDeleteTrack?.(ann); }}
                  >
                    <Icon name="trash" size={14} />
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
