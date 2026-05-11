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
  selectedTrack: VideoTrackAnnotation | null;
  selectedTrackGhost: VideoTrackGhost | null;
  selectedTrackLocked: boolean;
  frameIndex: number;
  readOnly: boolean;
  hiddenTrackIds: Set<string>;
  lockedTrackIds: Set<string>;
  onSelect: (id: string) => void;
  onToggleHiddenTrack: (trackId: string) => void;
  onToggleLockedTrack: (trackId: string) => void;
  onChangeUserBoxClass?: (id: string) => void;
  onMarkSelectedTrack: (patch: Partial<VideoTrackKeyframe>) => void;
  onCopySelectedTrackToCurrentFrame: () => void;
  onDeleteTrackKeyframe: (annotation: VideoTrackAnnotation, targetFrame: number) => void;
  onConvertToBboxes?: (annotation: AnnotationResponse, options: VideoTrackConversionOptions) => void;
}

export function VideoTrackPanel({
  videoTracks,
  selectedId,
  selectedTrack,
  selectedTrackGhost,
  selectedTrackLocked,
  frameIndex,
  readOnly,
  hiddenTrackIds,
  lockedTrackIds,
  onSelect,
  onToggleHiddenTrack,
  onToggleLockedTrack,
  onChangeUserBoxClass,
  onMarkSelectedTrack,
  onCopySelectedTrackToCurrentFrame,
  onDeleteTrackKeyframe,
  onConvertToBboxes,
}: VideoTrackPanelProps) {
  return (
    <aside style={{ minHeight: 0, overflow: "auto", borderLeft: "1px solid var(--color-border)", background: "var(--color-bg-elev)", padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <b style={{ fontSize: 13 }}>轨迹</b>
        <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-muted)" }}>{videoTracks.length}</span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {videoTracks.map((ann) => {
          const track = ann.geometry;
          const selected = ann.id === selectedId;
          const hidden = hiddenTrackIds.has(track.track_id);
          const locked = lockedTrackIds.has(track.track_id);
          const exact = track.keyframes.find((kf) => kf.frame_index === frameIndex);
          return (
            <div
              key={ann.id}
              data-testid="video-track-row"
              onClick={() => onSelect(ann.id)}
              style={{
                display: "grid",
                gap: 7,
                padding: 8,
                border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
                borderRadius: 8,
                background: selected ? "color-mix(in oklab, var(--color-accent) 12%, var(--color-bg-elev))" : "transparent",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: classColor(ann.class_name) }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {ann.class_name}
                </span>
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
        <div style={{ display: "flex", gap: 6 }}>
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
        </div>
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
    </aside>
  );
}
