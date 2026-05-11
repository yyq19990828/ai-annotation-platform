import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, VideoTrackKeyframe } from "@/types";
import { classColor } from "./colors";
import { shortTrackId, sortedKeyframes } from "./videoStageGeometry";
import type {
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
  frameIndex: number;
  readOnly: boolean;
  classes?: string[];
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  onSelect: (id: string, opts?: { toggle?: boolean }) => void;
  onToggleHiddenTrack: (trackId: string) => void;
  onToggleLockedTrack: (trackId: string) => void;
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
}

function frameRange(frames: number[]): string {
  if (frames.length === 0) return "无帧";
  const min = Math.min(...frames);
  const max = Math.max(...frames);
  return min === max ? `F${min}` : `F${min}-F${max}`;
}

function trackToolDetail(track: VideoTrackAnnotation["geometry"]): string {
  const frames = track.keyframes.map((kf) => kf.frame_index);
  const absent = track.keyframes.filter((kf) => kf.absent).length;
  const occluded = track.keyframes.filter((kf) => kf.occluded).length;
  return `${shortTrackId(track.track_id)} · ${track.keyframes.length} 关键帧 · ${frameRange(frames)}${absent ? ` · ${absent} 消失` : ""}${occluded ? ` · ${occluded} 遮挡` : ""}`;
}

export function VideoTrackPanel({
  videoTracks,
  selectedId,
  selectedTrackIds,
  selectedTrack,
  selectedTrackGhost,
  selectedTrackLocked,
  frameIndex,
  readOnly,
  classes,
  hiddenTrackIds,
  lockedTrackIds,
  onSelect,
  onToggleHiddenTrack,
  onToggleLockedTrack,
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
}: VideoTrackPanelProps) {
  const batchCount = selectedTrackIds.size;
  const batchSelectionDisabled = batchCount <= 1;
  const batchMutationDisabled = readOnly || batchSelectionDisabled;

  return (
    <div style={{ display: "grid", gap: 8, padding: "2px 0 8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 0" }}>
        <b style={{ fontSize: 13 }}>轨迹</b>
        <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{videoTracks.length}</span>
      </div>
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
            <Button size="sm" disabled={!onShowSelectedTracks} onClick={onShowSelectedTracks}>显示</Button>
            <Button size="sm" disabled={!onHideSelectedTracks} onClick={onHideSelectedTracks}>隐藏</Button>
            <Button size="sm" disabled={batchSelectionDisabled || !onLockSelectedTracks} onClick={onLockSelectedTracks}>锁定</Button>
            <Button size="sm" disabled={batchSelectionDisabled || !onUnlockSelectedTracks} onClick={onUnlockSelectedTracks}>解锁</Button>
            <Button size="sm" variant="danger" disabled={batchMutationDisabled || !onBatchDeleteTracks} onClick={onBatchDeleteTracks}>
              删除
            </Button>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {videoTracks.map((ann) => {
          const track = ann.geometry;
          const color = classColor(ann.class_name);
          const primarySelected = ann.id === selectedId;
          const selected = selectedTrackIds.has(ann.id) || primarySelected;
          const hidden = hiddenTrackIds.has(track.track_id);
          const locked = lockedTrackIds.has(track.track_id);
          const exact = track.keyframes.find((kf) => kf.frame_index === frameIndex);
          const sourceLabel = ann.source === "prediction_based" ? "AI 采纳" : "手动";
          return (
            <div
              key={ann.id}
              data-testid="video-track-row"
              aria-selected={selected}
              onClick={(e) => onSelect(ann.id, { toggle: e.shiftKey || e.metaKey || e.ctrlKey })}
              style={{
                display: "grid",
                gap: 7,
                padding: "6px 8px",
                border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                borderRadius: 8,
                background: selected ? "color-mix(in oklab, var(--color-accent) 12%, var(--color-bg-elev))" : "transparent",
                cursor: "pointer",
                boxShadow: primarySelected && batchCount > 1 ? "inset 3px 0 0 var(--color-accent)" : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ann.class_name}
                </span>
                <Badge variant={ann.source === "prediction_based" ? "default" : "accent"} style={{ fontSize: 9.5, padding: "1px 5px" }}>
                  {sourceLabel}
                </Badge>
                <span className="mono" style={{ fontSize: 10, color: "var(--color-fg-muted)" }}>{shortTrackId(track.track_id)}</span>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Button size="sm" title={hidden ? "显示轨迹" : "隐藏轨迹"} onClick={(e) => { e.stopPropagation(); onToggleHiddenTrack(track.track_id); }}>
                  <Icon name={hidden ? "eyeOff" : "eye"} size={12} />
                </Button>
                <Button size="sm" title={locked ? "解锁轨迹" : "锁定轨迹"} onClick={(e) => { e.stopPropagation(); onToggleLockedTrack(track.track_id); }}>
                  <Icon name={locked ? "lock" : "unlock"} size={12} />
                </Button>
                <Button
                  size="sm"
                  title="重命名轨迹类别"
                  disabled={readOnly || !onChangeUserBoxClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChangeUserBoxClass?.(ann.id);
                  }}
                >
                  <Icon name="edit" size={12} />
                </Button>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-fg-muted)" }}>
                  {exact?.absent ? "当前消失" : exact ? "关键帧" : "非关键帧"}
                </span>
              </div>
              <div
                className="mono"
                style={{
                  fontSize: 10,
                  color: "var(--color-fg-subtle)",
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    padding: "1px 5px",
                    borderRadius: 4,
                    border: "1px solid var(--color-border)",
                    background: "var(--color-bg-sunken)",
                    color: "var(--color-fg-muted)",
                    fontFamily: "inherit",
                  }}
                >
                  轨迹
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {trackToolDetail(track)}
                </span>
              </div>
            </div>
          );
        })}
        {videoTracks.length === 0 && (
          <div style={{ color: "var(--color-fg-muted)", fontSize: 12, lineHeight: 1.6 }}>
            暂无轨迹。暂停后画框会创建第一条轨迹。
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        <b style={{ fontSize: 13 }}>当前轨迹</b>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button
            size="sm"
            disabled={!selectedTrack || readOnly || selectedTrackLocked}
            onClick={() => onMarkSelectedTrack({ absent: true, occluded: false })}
          >
            消失
          </Button>
          <Button
            size="sm"
            disabled={!selectedTrack || readOnly || selectedTrackLocked}
            onClick={() => onMarkSelectedTrack({ absent: false, occluded: true })}
          >
            遮挡
          </Button>
          <Button
            size="sm"
            disabled={!selectedTrackGhost || readOnly || selectedTrackLocked}
            title="使用最近关键帧的框在当前帧创建关键帧"
            onClick={onCopySelectedTrackToCurrentFrame}
          >
            复制到当前帧
          </Button>
          <Button
            size="sm"
            disabled={!canCopyCurrentKeyframe}
            title="复制当前轨迹在当前帧的关键帧"
            onClick={onCopyCurrentKeyframe}
          >
            复制当前关键帧
          </Button>
          <Button
            size="sm"
            disabled={!canPasteKeyframe}
            title="把已复制的关键帧粘贴到当前帧"
            onClick={onPasteKeyframeToCurrentFrame}
          >
            粘贴到当前帧
          </Button>
        </div>
        {copiedKeyframeLabel && (
          <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>
            已复制: {copiedKeyframeLabel}
          </div>
        )}
        {selectedTrack && (
          <>
            <div className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)", lineHeight: 1.5 }}>
              track_id: {selectedTrack.geometry.track_id}<br />
              frame_index: {frameIndex}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <b style={{ fontSize: 12 }}>关键帧</b>
                <div style={{ display: "flex", gap: 4 }}>
                  <Button
                    size="sm"
                    disabled={readOnly}
                    title="复制整条轨迹的关键帧为独立框"
                    onClick={() => onConvertToBboxes?.(selectedTrack, {
                      operation: "copy",
                      scope: "track",
                      frameMode: "keyframes",
                    })}
                  >
                    复制关键帧
                  </Button>
                  <Button
                    size="sm"
                    disabled={readOnly}
                    title="复制整条轨迹插值后的所有帧为独立框"
                    onClick={() => onConvertToBboxes?.(selectedTrack, {
                      operation: "copy",
                      scope: "track",
                      frameMode: "all_frames",
                    })}
                  >
                    复制全帧
                  </Button>
                </div>
              </div>
              {sortedKeyframes(selectedTrack.geometry).map((kf) => (
                <div
                  key={kf.frame_index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 6,
                    alignItems: "center",
                    padding: "5px 6px",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                >
                  <span>
                    F{kf.frame_index}
                    {kf.absent ? " · 消失" : kf.occluded ? " · 遮挡" : ""}
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <Button
                      size="sm"
                      disabled={readOnly || Boolean(kf.absent)}
                      title="复制此关键帧为独立框"
                      onClick={() => onConvertToBboxes?.(selectedTrack, {
                        operation: "copy",
                        scope: "frame",
                        frameIndex: kf.frame_index,
                      })}
                    >
                      复制
                    </Button>
                    <Button
                      size="sm"
                      disabled={readOnly || Boolean(kf.absent)}
                      title="拆此关键帧为独立框"
                      onClick={() => onConvertToBboxes?.(selectedTrack, {
                        operation: "split",
                        scope: "frame",
                        frameIndex: kf.frame_index,
                      })}
                    >
                      拆
                    </Button>
                    <Button
                      size="sm"
                      disabled={readOnly || selectedTrack.geometry.keyframes.length <= 1}
                      title="删除关键帧"
                      onClick={() => onDeleteTrackKeyframe(selectedTrack, kf.frame_index)}
                    >
                      <Icon name="trash" size={11} />
                    </Button>
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Button
                size="sm"
                disabled={readOnly}
                title="拆整条轨迹关键帧为独立框并删除原轨迹"
                onClick={() => onConvertToBboxes?.(selectedTrack, {
                  operation: "split",
                  scope: "track",
                  frameMode: "keyframes",
                })}
              >
                拆关键帧
              </Button>
              <Button
                size="sm"
                disabled={readOnly}
                title="拆整条轨迹所有插值帧为独立框并删除原轨迹"
                onClick={() => onConvertToBboxes?.(selectedTrack, {
                  operation: "split",
                  scope: "track",
                  frameMode: "all_frames",
                })}
              >
                拆全帧
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
