import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import type { VideoTrackerJobState } from "@/hooks/useVideoTrackerJobs";
import type { DiffMode } from "../modes/types";
import { classColor, displayClassName } from "./colors";
import { resolveTrackAtFrame, shortTrackId, sortedKeyframes } from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import styles from "./VideoTrackPanel.module.css";
import type {
  VideoFrameEntry,
  VideoTrackAnnotation,
  VideoTrackConversionOptions,
  VideoTrackGhost,
} from "./videoStageTypes";
import { VideoTrackerJobBadge } from "./VideoTrackerJobBadge";

// v0.10.30 · 当前帧状态标记动作信号: outside 表示在当前帧把该 track 标记为消失
// (写入 outside range), occluded 表示该帧遮挡 (写入可见关键帧的 occluded)。
export type TrackMarkPatch = {
  outside?: boolean;
  occluded?: boolean;
  source?: "manual" | "prediction";
};

interface VideoTrackPanelProps {
  videoTracks: VideoTrackAnnotation[];
  selectedId: string | null;
  selectedTrackIds: Set<string>;
  selectedTrack: VideoTrackAnnotation | null;
  selectedTrackGhost: VideoTrackGhost | null;
  selectedTrackLocked: boolean;
  currentFrameOutside: boolean;
  frameIndex: number;
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
  onChangeUserBoxClass?: (id: string) => void;
  onBatchRenameTracks?: (className: string) => void;
  onBatchDeleteTracks?: () => void;
  onAggregateSelectedBboxes?: () => void;
  onSplitSelectedTrack?: () => void;
  onMergeSelectedTracks?: () => void;
  canMergeSelectedTracks?: boolean;
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

type TrackFilter = "all" | "current";

function TrackFilterTabs({ value, onChange }: { value: TrackFilter; onChange: (filter: TrackFilter) => void }) {
  const options: Array<{ value: TrackFilter; label: string }> = [
    { value: "all", label: "全部" },
    { value: "current", label: "当前帧" },
  ];
  return (
    <div
      role="tablist"
      aria-label="轨迹过滤"
      className={styles.filterTabs}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              styles.filterTab,
              index > 0 && styles.filterTabWithDivider,
              active && styles.filterTabActive,
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function VideoTrackPanel({
  videoTracks,
  selectedId,
  selectedTrackIds,
  selectedTrack,
  selectedTrackGhost,
  selectedTrackLocked,
  currentFrameOutside,
  frameIndex,
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
}: VideoTrackPanelProps) {
  const batchCount = selectedTrackIds.size;
  const batchSelectionDisabled = batchCount <= 1;
  const batchMutationDisabled = readOnly || batchSelectionDisabled;
  const canAggregateBboxes = !readOnly && selectedBboxCount > 1 && Boolean(onAggregateSelectedBboxes);
  const currentFrameLabel = exactFrameLabel(selectedTrack, frameIndex, currentFrameOutside);
  const [trackFilter, setTrackFilter] = useState<TrackFilter>("all");
  const filteredVideoTracks = useMemo(
    () => videoTracks.filter((ann) => {
      const currentSource = resolveTrackAtFrame(ann.geometry, frameIndex)?.source ?? null;
      if (trackFilter === "all") return true;
      if (!currentSource) return false;
      return visibleInReviewMode(currentSource, reviewDisplayMode);
    }),
    [frameIndex, reviewDisplayMode, trackFilter, videoTracks],
  );
  const selectedTrackNextPredictionFrame = selectedTrack
    ? nextPredictionFrame(selectedTrack.geometry, frameIndex)
    : null;

  return (
    <div className={styles.panelRoot}>
      <div className={styles.filterCard}>
        <div className={styles.rowBetween}>
          <b className={styles.heading}>轨迹</b>
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
        <TrackFilterTabs value={trackFilter} onChange={setTrackFilter} />
      </div>
      <div className={styles.section}>
        <b className={styles.heading}>轨迹列表</b>
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
            <Button size="sm" className={styles.compactButton} variant="danger" disabled={batchMutationDisabled || !onBatchDeleteTracks} onClick={onBatchDeleteTracks}>
              删除
            </Button>
          </div>
        </div>
      )}
      <div className={styles.section}>
        {filteredVideoTracks.map((ann) => {
          const track = ann.geometry;
          const color = classColor(ann.class_name);
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
              <div className={styles.trackMeta}>
                <svg className={styles.trackColorDot} aria-hidden="true" viewBox="0 0 10 10">
                  <circle cx="5" cy="5" r="5" fill={color} />
                </svg>
                <div className={styles.trackTitleRow}>
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
              <div className={styles.trackActionRow}>
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
                    onChangeUserBoxClass?.(ann.id);
                  }}
                >
                  <Icon name="edit" size={14} />
                </Button>
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

      <div className={styles.sectionWithTopPadding}>
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
            <div className={styles.rowBetween}>
              <div className={styles.trackMeta}>
                <svg className={styles.trackColorDot} aria-hidden="true" viewBox="0 0 10 10">
                  <circle cx="5" cy="5" r="5" fill={classColor(selectedTrack.class_name)} />
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
                <span className={cn("mono", styles.mutedMono)}>
                  当前帧 F{frameIndex} · {currentFrameLabel.replace(/^F\d+ · /, "")}
                </span>
              </div>
              <Button
                size="sm"
                className={styles.currentActionButton}
                disabled={readOnly || !onStartNewTrack}
                title="清除当前轨迹选择，下一次画框会新建轨迹"
                onClick={onStartNewTrack}
              >
                <Icon name="plus" size={13} />新建轨迹
              </Button>
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
                title="复制轨迹 ID"
                onClick={() => copyText(selectedTrack.geometry.track_id)}
              >
                <Icon name="copy" size={13} />复制 ID
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
            </div>
            {trackerJobsByAnnotation[selectedTrack.id] && (
              <div data-testid="video-tracker-job-row" className={styles.trackerJobRow}>
                <VideoTrackerJobBadge
                  job={trackerJobsByAnnotation[selectedTrack.id]}
                  onCancel={onCancelTrackerJob}
                />
              </div>
            )}
            <div className={styles.frameActionGrid}>
              <Button
                size="sm"
                className={styles.frameActionButton}
                disabled={!selectedTrackGhost || readOnly || selectedTrackLocked}
                title="使用最近关键帧的框在当前帧创建关键帧"
                onClick={onCopySelectedTrackToCurrentFrame}
              >
                <Icon name="copy" size={14} />复制到当前帧
              </Button>
              <Button
                size="sm"
                className={styles.frameActionButton}
                disabled={!selectedTrack || readOnly || selectedTrackLocked}
                onClick={() => onMarkSelectedTrack({ outside: true, occluded: false })}
              >
                <Icon name="eyeOff" size={14} />标记消失
              </Button>
              <Button
                size="sm"
                className={styles.frameActionButton}
                disabled={!selectedTrack || readOnly || selectedTrackLocked}
                onClick={() => onMarkSelectedTrack({ outside: false, occluded: true })}
              >
                <Icon name="rect" size={14} />标记遮挡
              </Button>
            </div>
            <div className={styles.copyStatusRow}>
              {copiedKeyframeLabel ? (
                <>
                  <Icon name="info" size={14} className={styles.mutedIcon} />
                  <span className={cn("mono", styles.copyStatusText)}>
                    已复制: {copiedKeyframeLabel}（关键帧）
                  </span>
                </>
              ) : (
                <span className={cn("mono", styles.subtleMono)}>
                  可复制当前关键帧后粘贴到其它帧
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                className={styles.ghostMutedButton}
                disabled={!canCopyCurrentKeyframe}
                title="复制当前轨迹在当前帧的关键帧"
                onClick={onCopyCurrentKeyframe}
              >
                复制关键帧
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={styles.ghostMutedButton}
                disabled={!canPasteKeyframe}
                title="把已复制的关键帧粘贴到当前帧"
                onClick={onPasteKeyframeToCurrentFrame}
              >
                粘贴
              </Button>
            </div>
          </div>
        ) : (
          <div className={styles.emptyCompactText}>选择一条轨迹后编辑当前帧状态。</div>
        )}
        {selectedTrack && (
          <>
            <div className={styles.sectionWithTopPadding}>
              <b className={styles.heading}>关键帧</b>
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
                        onClick={() => onSeekFrame?.(kf.frame_index)}
                      >
                        <Icon name="arrowRight" size={12} />跳转
                      </Button>
                      {kf.source === "prediction" && onAcceptPredictionKeyframe && (
                        <Button
                          size="sm"
                          className={cn(styles.keyframeButton, styles.successButton)}
                          disabled={readOnly}
                          title="接受预测：source 改为 manual"
                          onClick={() => onAcceptPredictionKeyframe(selectedTrack, kf.frame_index)}
                        >
                          <Icon name="check" size={12} />接受
                        </Button>
                      )}
                      {kf.source === "prediction" && onRejectPredictionKeyframe && (
                        <Button
                          size="sm"
                          className={cn(styles.keyframeButton, styles.dangerButton)}
                          disabled={readOnly}
                          title="拒绝预测：把该帧并入 outside"
                          onClick={() => onRejectPredictionKeyframe(selectedTrack, kf.frame_index)}
                        >
                          <Icon name="x" size={12} />拒绝
                        </Button>
                      )}
                      <Button
                        size="sm"
                        className={styles.keyframeButton}
                        disabled={readOnly || kfOutside}
                        title="复制此关键帧为独立框"
                        onClick={() => onConvertToBboxes?.(selectedTrack, {
                          operation: "copy",
                          scope: "frame",
                          frameIndex: kf.frame_index,
                        })}
                      >
                        <Icon name="copy" size={12} />复制
                      </Button>
                      <Button
                        size="sm"
                        className={styles.keyframeButton}
                        disabled={readOnly || kfOutside}
                        title="拆此关键帧为独立框"
                        onClick={() => onConvertToBboxes?.(selectedTrack, {
                          operation: "split",
                          scope: "frame",
                          frameIndex: kf.frame_index,
                        })}
                      >
                        <Icon name="scissors" size={12} />拆分
                      </Button>
                      <Button
                        size="sm"
                        className={cn(styles.iconButton, styles.dangerButton)}
                        disabled={readOnly || selectedTrack.geometry.keyframes.length <= 1}
                        title="删除关键帧"
                        onClick={() => onDeleteTrackKeyframe(selectedTrack, kf.frame_index)}
                      >
                        <Icon name="trash" size={12} />
                      </Button>
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>
            <details open className={styles.convertPanel}>
              <summary className={styles.convertSummary}>
                转换为独立框...
              </summary>
              <div className={styles.convertActions}>
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.menuButton}
                  disabled={readOnly || !onConvertToBboxes}
                  title="复制整条轨迹的关键帧为独立框"
                  onClick={() => onConvertToBboxes?.(selectedTrack, {
                    operation: "copy",
                    scope: "track",
                    frameMode: "keyframes",
                  })}
                >
                  <Icon name="copy" size={15} />复制关键帧
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.menuButton}
                  disabled={readOnly || !onConvertToBboxes}
                  title="复制整条轨迹插值后的所有帧为独立框"
                  onClick={() => onConvertToBboxes?.(selectedTrack, {
                    operation: "copy",
                    scope: "track",
                    frameMode: "all_frames",
                  })}
                >
                  <Icon name="film" size={15} />复制全帧
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.menuButton}
                  disabled={readOnly || !onConvertToBboxes}
                  title="拆整条轨迹关键帧为独立框并删除原轨迹"
                  onClick={() => onConvertToBboxes?.(selectedTrack, {
                    operation: "split",
                    scope: "track",
                    frameMode: "keyframes",
                  })}
                >
                  <Icon name="scissors" size={15} />拆关键帧
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={styles.menuButton}
                  disabled={readOnly || !onConvertToBboxes}
                  title="拆整条轨迹所有插值帧为独立框并删除原轨迹"
                  onClick={() => onConvertToBboxes?.(selectedTrack, {
                    operation: "split",
                    scope: "track",
                    frameMode: "all_frames",
                  })}
                >
                  <Icon name="film" size={15} />拆全帧
                </Button>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
}
