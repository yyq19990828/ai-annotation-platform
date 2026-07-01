import { useMemo, useState } from "react";
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
  if (source === "prediction") return "text-status-info border-violet-500/40";
  if (source === "interpolated") return "text-status-caution border-amber-500/45";
  if (source === "manual" || source === "legacy") return "text-status-positive border-emerald-500/40";
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
    <div className="grid gap-3 py-0.5 pb-2">
      <div className="border border-border rounded-lg bg-card px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <b className="text-sm">轨迹</b>
            <Button
              size="sm"
              className="!w-7 !h-7 !p-0 !justify-center !rounded-lg"
              disabled={readOnly || !onStartNewTrack}
              title="清除当前轨迹选择，下一次画框会新建轨迹"
              aria-label="新建轨迹"
              onClick={onStartNewTrack}
            >
              <Icon name="plus" size={14} />
            </Button>
          </div>
          <span className={cn("mono", "text-xs text-muted-foreground")}>
            {trackFilter === "current" ? `${filteredVideoTracks.length}/${videoTracks.length}` : videoTracks.length}
          </span>
        </div>
        {selectedBboxCount > 1 && (
          <Button
            size="sm"
            className="!w-full !justify-center !mt-2 !rounded-lg !py-1 !px-2"
            disabled={!canAggregateBboxes}
            title="把已多选的单帧 video_bbox 聚合为一条 video_track"
            onClick={onAggregateSelectedBboxes}
          >
            <Icon name="link" size={13} />聚合 {selectedBboxCount} 个框
          </Button>
        )}
      </div>
      <div className={cn("grid gap-2", selectedTrack && "order-2")}>
        {/* 批量操作仅在「当前帧」tab 下可用:全局视图下多选极易误删整条跨帧轨迹。 */}
        {batchCount > 1 && trackFilter !== "current" && (
          <div data-testid="video-track-batch-hint" className="px-2 py-1.5 border border-dashed border-brand/30 rounded-lg bg-brand/5 text-muted-foreground text-xs">
            已选 {batchCount} 条轨迹 · 切换到「当前帧」可批量操作
          </div>
        )}
        {batchCount > 1 && trackFilter === "current" && (
          <div
            data-testid="video-track-batch-toolbar"
            className="grid gap-2 px-2 py-1.5 border border-brand/30 rounded-lg bg-brand/5"
          >
            <div className="flex items-center justify-between gap-2">
              <b className="text-xs">已选 {batchCount} 条轨迹</b>
              <select
                aria-label="批量改类"
                value=""
                disabled={batchMutationDisabled || !onBatchRenameTracks || !classes?.length}
                onChange={(e) => {
                  if (!e.target.value) return;
                  onBatchRenameTracks?.(e.target.value);
                  e.target.value = "";
                }}
                className="appearance-none min-w-24 border border-border rounded-md bg-background text-foreground text-xs py-1 px-1.5"
              >
                <option value="">改类</option>
                {(classes ?? []).map((cls) => (
                  <option key={cls} value={cls}>{cls}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <Button variant="ghost" size="sm" title="显示" aria-label="显示" disabled={!onShowSelectedTracks} onClick={onShowSelectedTracks}>
                <Icon name="eye" size={14} />
              </Button>
              <Button variant="ghost" size="sm" title="隐藏" aria-label="隐藏" disabled={!onHideSelectedTracks} onClick={onHideSelectedTracks}>
                <Icon name="eyeOff" size={14} />
              </Button>
              <Button variant="ghost" size="sm" title="锁定" aria-label="锁定" disabled={batchSelectionDisabled || !onLockSelectedTracks} onClick={onLockSelectedTracks}>
                <Icon name="lock" size={14} />
              </Button>
              <Button variant="ghost" size="sm" title="解锁" aria-label="解锁" disabled={batchSelectionDisabled || !onUnlockSelectedTracks} onClick={onUnlockSelectedTracks}>
                <Icon name="unlock" size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={canMergeSelectedTracks ? "合并两条同类且不重叠的轨迹" : "只支持合并两条同类轨迹"}
                aria-label="合并"
                disabled={batchMutationDisabled || !canMergeSelectedTracks || !onMergeSelectedTracks}
                onClick={onMergeSelectedTracks}
              >
                <Icon name="layers" size={14} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={canJoinSelectedTracks ? "跳连两条同类且帧号不重叠的轨迹 (补 gap)" : "只支持跳连两条同类且帧号不重叠的轨迹"}
                aria-label="跳连"
                disabled={batchMutationDisabled || !canJoinSelectedTracks || !onJoinSelectedTracks}
                onClick={() => setJoinOpen(true)}
              >
                <Icon name="link" size={14} />
              </Button>
              <Button variant="danger" size="sm" title="批量删除" aria-label="批量删除" disabled={batchMutationDisabled || !onBatchDeleteTracks} onClick={onBatchDeleteTracks}>
                <Icon name="trash" size={14} />
              </Button>
            </div>
          </div>
        )}
      <div className="grid gap-2">
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
              key={ann.render_key ?? ann.id}
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
                "grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-center p-2 px-2.5 border border-border rounded-lg bg-transparent cursor-pointer",
                selected && "!border-brand bg-brand/10",
                primarySelected && batchCount > 1 && "shadow-[inset_3px_0_0_var(--sc-brand)]",
              )}
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-1 gap-x-2 items-center min-w-0">
                  <button
                    type="button"
                    className="row-span-2 relative inline-flex items-center p-0 border-0 bg-transparent cursor-pointer disabled:cursor-default"
                    data-testid="video-track-color-dot"
                    title={canEditColor ? "修改轨迹颜色" : undefined}
                    disabled={!canEditColor}
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorPickerTrackId((prev) => (prev === track.track_id ? null : track.track_id));
                    }}
                  >
                    <svg className="row-span-2 w-2.5 h-2.5 overflow-visible" aria-hidden="true" viewBox="0 0 10 10">
                      <circle cx="5" cy="5" r="5" fill={color} />
                    </svg>
                    {colorPickerTrackId === track.track_id && (
                      <div className="absolute top-full left-0 z-local-overlay mt-1" onClick={(e) => e.stopPropagation()}>
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
                  <div className="flex items-center gap-[7px] min-w-0">
                    <span className={cn("mono", "shrink-0 inline-flex items-center text-xs font-semibold px-1.5 py-px rounded text-brand bg-brand/10")}>
                      #{trackNumbers.get(ann.id) ?? "?"}
                    </span>
                    <b className="text-sm overflow-hidden text-ellipsis whitespace-nowrap">
                      {displayClassName(ann.class_name)}
                    </b>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 px-1.5 py-px rounded-full text-2xs font-medium whitespace-nowrap",
                        ann.source === "prediction_based"
                          ? "bg-muted text-muted-foreground"
                          : "bg-brand/10 text-brand",
                      )}
                    >
                      {sourceLabel}
                    </span>
                    <span className={cn("mono", "text-xs text-muted-foreground")}>{shortTrackId(track.track_id)}</span>
                  </div>
                  <div className={cn("mono", "text-xs text-muted-foreground min-w-0 overflow-hidden text-ellipsis whitespace-nowrap")}>
                    {track.keyframes.length} 关键帧 · {frameRange(frames)}
                  </div>
                  <div className="col-start-2 flex flex-wrap gap-1 min-w-0 mt-0.5">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-px border border-border rounded bg-muted text-muted-foreground text-2xs whitespace-nowrap",
                        outside && "text-status-danger",
                      )}
                    >
                      {statusChipText(exact, outside)}
                    </span>
                    <span
                      data-testid="video-track-current-source"
                      className={cn(
                        "inline-flex items-center px-1.5 py-px border border-border rounded bg-muted text-muted-foreground text-2xs whitespace-nowrap",
                        sourceChipClass(currentSource),
                      )}
                    >
                      {sourceChipText(currentSource)}
                    </span>
                  </div>
                </div>
                {/* 操作区与单帧标注 AI 待审一致:默认只留一个常驻 ⋮ 在最右,hover 时其余操作向左浮出工具条。 */}
                <div className="flex gap-1.5 items-center">
                  <div className="relative flex items-center justify-end group/act">
                    <div
                      className={cn(
                        "absolute right-full top-1/2 z-base flex -translate-y-1/2 items-center gap-1 rounded-lg border border-border bg-card py-0.5 pl-1.5 pr-1 shadow-md",
                        "pointer-events-none translate-x-1.5 opacity-0 transition-all duration-200 ease-out",
                        "group-hover/act:pointer-events-auto group-hover/act:translate-x-0 group-hover/act:opacity-100",
                      )}
                    >
                      <Button
                        size="sm"
                        title={hidden ? "显示轨迹 (H)" : "隐藏轨迹 (H)"}
                        aria-label={hidden ? "显示轨迹" : "隐藏轨迹"}
                        aria-pressed={hidden}
                        onClick={(e) => { e.stopPropagation(); onToggleHiddenTrack(track.track_id); }}
                        className={cn(
                          "!w-[24px] !h-[24px] !justify-center !p-0 !rounded-md [&_svg]:!size-3",
                          !hidden && "!opacity-55",
                        )}
                      >
                        <Icon name={hidden ? "eyeOff" : "eye"} size={12} />
                      </Button>
                      <Button
                        size="sm"
                        title={locked ? "解锁轨迹 (L)" : "锁定轨迹 (L)"}
                        aria-label={locked ? "解锁轨迹" : "锁定轨迹"}
                        aria-pressed={locked}
                        onClick={(e) => { e.stopPropagation(); onToggleLockedTrack(track.track_id); }}
                        className={cn(
                          "!w-[24px] !h-[24px] !justify-center !p-0 !rounded-md [&_svg]:!size-3",
                          !locked && "!opacity-55",
                        )}
                      >
                        <Icon name={locked ? "lock" : "unlock"} size={12} />
                      </Button>
                      <Button
                        size="sm"
                        title="重命名轨迹类别"
                        aria-label="修改类别"
                        disabled={readOnly || !onChangeUserBoxClass}
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          onChangeUserBoxClass?.(ann.id, { left: rect.left, top: rect.bottom + 6 });
                        }}
                        className="!w-[24px] !h-[24px] !justify-center !p-0 !rounded-md [&_svg]:!size-3"
                      >
                        <Icon name="tag" size={12} />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        title="删除整条轨迹"
                        aria-label="删除整条轨迹"
                        disabled={readOnly || locked || !onDeleteTrack}
                        onClick={(e) => { e.stopPropagation(); onDeleteTrack?.(ann); }}
                        className="!w-[24px] !h-[24px] !justify-center !p-0 !rounded-md [&_svg]:!size-3"
                      >
                        <Icon name="trash" size={12} />
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      title="更多操作"
                      aria-label="更多操作"
                      onClick={(e) => e.stopPropagation()}
                      className="!w-[24px] !h-[24px] !justify-center !p-0 !rounded-md [&_svg]:!size-3 text-muted-foreground"
                    >
                      <Icon name="more" size={13} />
                    </Button>
                  </div>
                </div>
            </div>
          );
        })}
        {videoTracks.length === 0 && (
          <div className="text-muted-foreground text-xs leading-relaxed">
            暂无轨迹。暂停后画框会创建第一条轨迹。
          </div>
        )}
        {videoTracks.length > 0 && filteredVideoTracks.length === 0 && (
          <div className="text-muted-foreground text-xs leading-relaxed">
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
