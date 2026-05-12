import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import type { DiffMode } from "../modes/types";
import { classColor } from "./colors";
import { resolveTrackAtFrame, shortTrackId, sortedKeyframes } from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import type {
  VideoFrameEntry,
  VideoTrackAnnotation,
  VideoTrackConversionOptions,
  VideoTrackGhost,
} from "./videoStageTypes";

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
  onShowSelectedTracks?: () => void;
  onHideSelectedTracks?: () => void;
  onLockSelectedTracks?: () => void;
  onUnlockSelectedTracks?: () => void;
  onMarkSelectedTrack: (patch: Partial<VideoTrackKeyframe>) => void;
  onCopySelectedTrackToCurrentFrame: () => void;
  copiedKeyframeLabel?: string | null;
  canCopyCurrentKeyframe: boolean;
  canPasteKeyframe: boolean;
  onCopyCurrentKeyframe: () => void;
  onPasteKeyframeToCurrentFrame: () => void;
  onDeleteTrackKeyframe: (annotation: VideoTrackAnnotation, targetFrame: number) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
  reviewDisplayMode?: DiffMode;
}

function frameRange(frames: number[]): string {
  if (frames.length === 0) return "无帧";
  const min = Math.min(...frames);
  const max = Math.max(...frames);
  return min === max ? `F${min}` : `F${min}-F${max}`;
}

function keyframeStatus(kf: VideoTrackKeyframe): string {
  if (kf.absent) return "消失";
  if (kf.occluded) return "遮挡";
  return "正常";
}

function firstVisibleTrackFrame(track: VideoTrackAnnotation["geometry"]): number | null {
  if (track.keyframes.length === 0) return null;
  const visible = track.keyframes.filter((kf) => !kf.absent);
  const frames = (visible.length > 0 ? visible : track.keyframes).map((kf) => kf.frame_index);
  return Math.min(...frames);
}

function exactFrameLabel(selectedTrack: VideoTrackAnnotation | null, frameIndex: number, outside: boolean): string {
  if (!selectedTrack) return `F${frameIndex}`;
  if (outside) return `F${frameIndex} · 消失`;
  const exact = selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex);
  if (exact?.absent) return `F${frameIndex} · 消失`;
  if (exact?.occluded) return `F${frameIndex} · 遮挡`;
  return `F${frameIndex} · ${exact ? "关键帧" : "非关键帧"}`;
}

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  paddingTop: 12,
};

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  padding: 0,
  justifyContent: "center",
  borderRadius: 8,
};

const compactButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  padding: "4px 8px",
};

const keyframeButtonStyle: React.CSSProperties = {
  borderRadius: 8,
  padding: "3px 8px",
  minWidth: 38,
  justifyContent: "center",
};

function copyText(text: string): void {
  void navigator.clipboard?.writeText(text);
}

function statusChipText(kf: VideoTrackKeyframe | undefined, outside = false): string {
  if (outside) return "当前消失";
  if (kf?.absent) return "当前消失";
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

function sourceChipColor(source: VideoFrameEntry["source"] | null): React.CSSProperties {
  if (source === "prediction") return { color: "var(--color-ai)", borderColor: "color-mix(in oklab, var(--color-ai) 40%, var(--color-border))" };
  if (source === "interpolated") return { color: "var(--color-warning)", borderColor: "color-mix(in oklab, var(--color-warning) 45%, var(--color-border))" };
  if (source === "manual" || source === "legacy") return { color: "var(--color-success)", borderColor: "color-mix(in oklab, var(--color-success) 40%, var(--color-border))" };
  return { color: "var(--color-fg-muted)" };
}

function visibleInReviewMode(source: VideoFrameEntry["source"] | null, mode?: DiffMode): boolean {
  if (!mode || mode === "diff") return true;
  if (!source) return false;
  if (mode === "raw") return source === "prediction" || source === "interpolated";
  return source === "manual" || source === "legacy";
}

function nextPredictionFrame(track: VideoTrackAnnotation["geometry"], frameIndex: number): number | null {
  const predictionFrames = sortedKeyframes(track)
    .filter((kf) => kf.source === "prediction" && !kf.absent)
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
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        marginTop: 7,
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--color-bg)",
      }}
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
            style={{
              height: 24,
              border: 0,
              borderLeft: index === 0 ? 0 : "1px solid var(--color-border)",
              background: active ? "var(--color-accent-soft)" : "transparent",
              color: active ? "var(--color-accent-fg)" : "var(--color-fg-muted)",
              fontSize: 11,
              fontWeight: active ? 600 : 500,
              cursor: "pointer",
            }}
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
}: VideoTrackPanelProps) {
  const batchCount = selectedTrackIds.size;
  const batchSelectionDisabled = batchCount <= 1;
  const batchMutationDisabled = readOnly || batchSelectionDisabled;
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
    <div style={{ display: "grid", gap: 12, padding: "2px 0 8px" }}>
      <div
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: 8,
          background: "var(--color-bg-elev)",
          padding: "7px 10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <b style={{ fontSize: 13 }}>轨迹</b>
          <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
            {trackFilter === "current" ? `${filteredVideoTracks.length}/${videoTracks.length}` : videoTracks.length}
          </span>
        </div>
        <TrackFilterTabs value={trackFilter} onChange={setTrackFilter} />
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <b style={{ fontSize: 13 }}>轨迹列表</b>
      {batchCount > 1 && (
        <div
          data-testid="video-track-batch-toolbar"
          style={{
            display: "grid",
            gap: 8,
            padding: "6px 8px",
            border: "1px solid color-mix(in oklab, var(--color-accent) 35%, var(--color-border))",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--color-accent) 8%, var(--color-bg-elev))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <b style={{ fontSize: 12 }}>已选 {batchCount} 条轨迹</b>
            <select
              aria-label="批量改类"
              value=""
              disabled={batchMutationDisabled || !onBatchRenameTracks || !classes?.length}
              onChange={(e) => {
                if (!e.target.value) return;
                onBatchRenameTracks?.(e.target.value);
                e.target.value = "";
              }}
              style={{
                minWidth: 96,
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                background: "var(--color-bg)",
                color: "var(--color-fg)",
                fontSize: 12,
                padding: "4px 6px",
              }}
            >
              <option value="">改类</option>
              {(classes ?? []).map((cls) => (
                <option key={cls} value={cls}>{cls}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button size="sm" style={compactButtonStyle} disabled={!onShowSelectedTracks} onClick={onShowSelectedTracks}>显示</Button>
            <Button size="sm" style={compactButtonStyle} disabled={!onHideSelectedTracks} onClick={onHideSelectedTracks}>隐藏</Button>
            <Button size="sm" style={compactButtonStyle} disabled={batchSelectionDisabled || !onLockSelectedTracks} onClick={onLockSelectedTracks}>锁定</Button>
            <Button size="sm" style={compactButtonStyle} disabled={batchSelectionDisabled || !onUnlockSelectedTracks} onClick={onUnlockSelectedTracks}>解锁</Button>
            <Button size="sm" style={compactButtonStyle} variant="danger" disabled={batchMutationDisabled || !onBatchDeleteTracks} onClick={onBatchDeleteTracks}>
              删除
            </Button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
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
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                borderRadius: 8,
                background: selected ? "color-mix(in oklab, var(--color-accent) 12%, var(--color-bg-elev))" : "transparent",
                cursor: "pointer",
                boxShadow: primarySelected && batchCount > 1 ? "inset 3px 0 0 var(--color-accent)" : undefined,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 8px", alignItems: "center", minWidth: 0 }}>
                <span style={{ gridRow: "1 / span 2", width: 10, height: 10, borderRadius: 999, background: color }} />
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ann.class_name}
                  </b>
                  <Badge variant={ann.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 10, padding: "1px 6px" }}>
                    {sourceLabel}
                  </Badge>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{shortTrackId(track.track_id)}</span>
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {track.keyframes.length} 关键帧 · {frameRange(frames)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "5px 8px",
                    fontSize: 11,
                    color: outside || exact?.absent ? "var(--color-danger)" : "var(--color-fg-muted)",
                    background: "var(--color-bg-elev)",
                  }}
                >
                  {statusChipText(exact, outside)}
                </span>
                <span
                  data-testid="video-track-current-source"
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    padding: "5px 8px",
                    fontSize: 11,
                    background: "var(--color-bg-elev)",
                    ...sourceChipColor(currentSource),
                  }}
                >
                  {sourceChipText(currentSource)}
                </span>
                <Button
                  size="sm"
                  style={{ ...iconButtonStyle, width: 30, height: 30 }}
                  title={hidden ? "显示轨迹" : "隐藏轨迹"}
                  onClick={(e) => { e.stopPropagation(); onToggleHiddenTrack(track.track_id); }}
                >
                  <Icon name={hidden ? "eyeOff" : "eye"} size={14} />
                </Button>
                <Button
                  size="sm"
                  style={{ ...iconButtonStyle, width: 30, height: 30 }}
                  title={locked ? "解锁轨迹" : "锁定轨迹"}
                  onClick={(e) => { e.stopPropagation(); onToggleLockedTrack(track.track_id); }}
                >
                  <Icon name={locked ? "lock" : "unlock"} size={14} />
                </Button>
                <Button
                  size="sm"
                  style={{ ...iconButtonStyle, width: 30, height: 30 }}
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
          <div style={{ color: "var(--color-fg-muted)", fontSize: 12, lineHeight: 1.6 }}>
            暂无轨迹。暂停后画框会创建第一条轨迹。
          </div>
        )}
        {videoTracks.length > 0 && filteredVideoTracks.length === 0 && (
          <div style={{ color: "var(--color-fg-muted)", fontSize: 12, lineHeight: 1.6 }}>
            当前帧暂无轨迹。
          </div>
        )}
      </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <b style={{ fontSize: 13 }}>当前轨迹</b>
          {selectedTrack && (
            <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
              {shortTrackId(selectedTrack.geometry.track_id)}
            </span>
          )}
        </div>
        {selectedTrack ? (
          <div
            style={{
              display: "grid",
              gap: 10,
              padding: "10px 12px",
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--color-bg-elev)",
              boxShadow: "inset 4px 0 0 var(--color-accent)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 8px", alignItems: "center", minWidth: 0 }}>
                <span style={{ gridRow: "1 / span 2", width: 10, height: 10, borderRadius: 999, background: classColor(selectedTrack.class_name) }} />
                <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                  <b style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {selectedTrack.class_name}
                  </b>
                  <Badge variant={selectedTrack.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 10, padding: "1px 6px" }}>
                    {selectedTrack.source === "prediction_based" ? "AI 采纳" : "手动"}
                  </Badge>
                  <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
                    {shortTrackId(selectedTrack.geometry.track_id)}
                  </span>
                </div>
                <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
                  当前帧 F{frameIndex} · {currentFrameLabel.replace(/^F\d+ · /, "")}
                </span>
              </div>
              <Button
                size="sm"
                style={{ ...compactButtonStyle, height: 30 }}
                disabled={readOnly || !onStartNewTrack}
                title="清除当前轨迹选择，下一次画框会新建轨迹"
                onClick={onStartNewTrack}
              >
                <Icon name="plus" size={13} />新建轨迹
              </Button>
              <Button
                size="sm"
                style={{ ...compactButtonStyle, height: 30 }}
                title="复制轨迹 ID"
                onClick={() => copyText(selectedTrack.geometry.track_id)}
              >
                <Icon name="copy" size={13} />复制 ID
              </Button>
              <Button
                size="sm"
                style={{ ...compactButtonStyle, height: 30 }}
                disabled={selectedTrackNextPredictionFrame === null || !onSeekFrame}
                title="跳转到下一条 prediction 关键帧"
                onClick={() => {
                  if (selectedTrackNextPredictionFrame !== null) onSeekFrame?.(selectedTrackNextPredictionFrame);
                }}
              >
                <Icon name="arrowRight" size={13} />下一预测
              </Button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
              <Button
                size="sm"
                style={{ borderRadius: 8, justifyContent: "center", minHeight: 34, padding: "4px 6px" }}
                disabled={!selectedTrackGhost || readOnly || selectedTrackLocked}
                title="使用最近关键帧的框在当前帧创建关键帧"
                onClick={onCopySelectedTrackToCurrentFrame}
              >
                <Icon name="copy" size={14} />复制到当前帧
              </Button>
              <Button
                size="sm"
                style={{ borderRadius: 8, justifyContent: "center", minHeight: 34, padding: "4px 6px" }}
                disabled={!selectedTrack || readOnly || selectedTrackLocked}
                onClick={() => onMarkSelectedTrack({ absent: true, occluded: false })}
              >
                <Icon name="eyeOff" size={14} />标记消失
              </Button>
              <Button
                size="sm"
                style={{ borderRadius: 8, justifyContent: "center", minHeight: 34, padding: "4px 6px" }}
                disabled={!selectedTrack || readOnly || selectedTrackLocked}
                onClick={() => onMarkSelectedTrack({ absent: false, occluded: true })}
              >
                <Icon name="rect" size={14} />标记遮挡
              </Button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
              {copiedKeyframeLabel ? (
                <>
                  <Icon name="info" size={14} style={{ color: "var(--color-fg-muted)" }} />
                  <span className="mono" style={{ flex: 1, fontSize: 11, color: "var(--color-fg-muted)" }}>
                    已复制: {copiedKeyframeLabel}（关键帧）
                  </span>
                </>
              ) : (
                <span className="mono" style={{ flex: 1, fontSize: 11, color: "var(--color-fg-subtle)" }}>
                  可复制当前关键帧后粘贴到其它帧
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                style={{ ...compactButtonStyle, color: "var(--color-fg-muted)" }}
                disabled={!canCopyCurrentKeyframe}
                title="复制当前轨迹在当前帧的关键帧"
                onClick={onCopyCurrentKeyframe}
              >
                复制关键帧
              </Button>
              <Button
                size="sm"
                variant="ghost"
                style={{ ...compactButtonStyle, color: "var(--color-fg-muted)" }}
                disabled={!canPasteKeyframe}
                title="把已复制的关键帧粘贴到当前帧"
                onClick={onPasteKeyframeToCurrentFrame}
              >
                粘贴
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--color-fg-muted)", fontSize: 12 }}>选择一条轨迹后编辑当前帧状态。</div>
        )}
        {selectedTrack && (
          <>
            <div style={{ ...sectionStyle, paddingTop: 12 }}>
              <b style={{ fontSize: 13 }}>关键帧</b>
              <div style={{ border: "1px solid var(--color-border)", borderRadius: 8, overflow: "hidden" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "58px minmax(64px, 1fr) auto",
                    gap: 8,
                    padding: "7px 10px",
                    borderBottom: "1px solid var(--color-border)",
                    color: "var(--color-fg-muted)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  <span>帧</span>
                  <span>状态</span>
                  <span>操作</span>
                </div>
                {sortedKeyframes(selectedTrack.geometry).map((kf) => (
                  <div
                    key={kf.frame_index}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "58px minmax(64px, 1fr) auto",
                      gap: 8,
                      alignItems: "center",
                      padding: "7px 10px",
                      borderTop: "1px solid var(--color-border)",
                      background: "var(--color-bg-elev)",
                      fontSize: 12,
                    }}
                  >
                    <span className="mono" style={{ fontSize: 13 }}>F{kf.frame_index}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, color: kf.absent ? "var(--color-danger)" : "var(--color-fg)" }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 999,
                          background: kf.absent ? "var(--color-danger)" : "oklch(0.68 0.16 145)",
                        }}
                      />
                      {keyframeStatus(kf)}
                    </span>
                    <span style={{ display: "flex", gap: 5 }}>
                      <Button
                        size="sm"
                        style={keyframeButtonStyle}
                        disabled={!onSeekFrame}
                        title="跳转到关键帧"
                        onClick={() => onSeekFrame?.(kf.frame_index)}
                      >
                        <Icon name="arrowRight" size={12} />跳转
                      </Button>
                      <Button
                        size="sm"
                        style={keyframeButtonStyle}
                        disabled={readOnly || Boolean(kf.absent)}
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
                        style={keyframeButtonStyle}
                        disabled={readOnly || Boolean(kf.absent)}
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
                        style={{ ...iconButtonStyle, color: "var(--color-danger)" }}
                        disabled={readOnly || selectedTrack.geometry.keyframes.length <= 1}
                        title="删除关键帧"
                        onClick={() => onDeleteTrackKeyframe(selectedTrack, kf.frame_index)}
                      >
                        <Icon name="trash" size={12} />
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <details open style={{ ...sectionStyle, paddingTop: 8, border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 10px" }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "var(--color-fg)",
                  fontSize: 12,
                  fontWeight: 600,
                  listStylePosition: "inside",
                }}
              >
                转换为独立框...
              </summary>
              <div style={{ display: "grid", gap: 2, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--color-border)" }}>
                <Button
                  size="sm"
                  variant="ghost"
                  style={{ ...compactButtonStyle, justifyContent: "flex-start", boxShadow: "none" }}
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
                  style={{ ...compactButtonStyle, justifyContent: "flex-start", boxShadow: "none" }}
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
                  style={{ ...compactButtonStyle, justifyContent: "flex-start", boxShadow: "none" }}
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
                  style={{ ...compactButtonStyle, justifyContent: "flex-start", boxShadow: "none" }}
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
