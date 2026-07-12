import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AnnotationResponse, Geometry } from "@/types";
import { isVideoMaskTrack, isVideoPointsTrack, resolvePointsTrackAtFrame, resolveVideoMaskTrackAtFrame } from "../../stage/videoStageGeometry";
import { IdentityHeader, annotationSourceKind } from "./IdentityHeader";
import { MetricGrid } from "./MetricGrid";
import { MetaFooter } from "./MetaFooter";
import { ActionBar } from "./ActionBar";
import { geometryMetrics } from "./geometryMetrics";

const BODY_CLASS =
  "flex min-h-0 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-3 pt-2.5";
const FRAME_CHIP_CLASS =
  "inline-flex flex-none items-center gap-1 rounded-full px-1.5 py-px text-2xs font-medium tabular-nums whitespace-nowrap bg-brand/10 text-brand";
const FRAME_TIME_CLASS = "text-brand/75";

export interface VideoPointsTrackCardContentProps {
  /** geometry.type 必为 video_track_polygon / video_track_polyline(点集轨迹)。 */
  annotation: AnnotationResponse;
  frameIndex: number;
  imageWidth: number | null;
  imageHeight: number | null;
  /** 视频帧率,用于把帧号换算成时间;缺省时只显示帧号。 */
  fps: number | null;
  readOnly: boolean;
  hidden: boolean;
  locked: boolean;
  onSeekFrame: (frameIndex: number) => void;
  onChangeClass: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleHidden: (trackId: string) => void;
  onToggleLock: (trackId: string) => void;
  onEditMask?: () => void;
  onPropagate?: () => void;
}

/** 秒 → 紧凑时间码 m:ss。 */
function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * v0.21.26 · 选中「点集轨迹」(video_track_polygon / video_track_polyline)的浮动卡内容。
 *
 * 点集轨迹的逐关键帧编辑(顶点对应 / 参数化插值 / 关键帧表)仍归 v0.21.20 多几何 track epic;
 * 本卡是「管理层补齐」的最小可用面:选中即显示当前帧几何指标 + 类别 + 帧定位,并提供
 * 改类 / 显隐 / 锁定 / 删除整条轨迹 —— 取代此前「空白卡、无任何操作」的现状。刻意不复用
 * bbox 轨迹卡 VideoTrackCardContent(其深度假设 keyframe.bbox),避免污染正在工作的 bbox 路径。
 */
export function VideoPointsTrackCardContent({
  annotation,
  frameIndex,
  imageWidth,
  imageHeight,
  fps,
  readOnly,
  hidden,
  locked,
  onSeekFrame,
  onChangeClass,
  onDelete,
  onToggleHidden,
  onToggleLock,
  onEditMask,
  onPropagate,
}: VideoPointsTrackCardContentProps) {
  if (!isVideoPointsTrack(annotation) && !isVideoMaskTrack(annotation)) return null;
  const track = annotation.geometry;
  const frames = track.keyframes.map((kf) => kf.frame_index);
  const firstFrame = frames.length ? Math.min(...frames) : null;
  const lastFrame = frames.length ? Math.max(...frames) : null;

  const resolved = isVideoPointsTrack(annotation) ? resolvePointsTrackAtFrame(annotation, frameIndex) : null;
  const metricsGeom: Geometry | null = resolved
    ? resolved.open
      ? { type: "video_polyline", frame_index: frameIndex, points: resolved.points }
      : { type: "video_polygon", frame_index: frameIndex, points: resolved.points }
    : null;
  const metrics = metricsGeom ? geometryMetrics(metricsGeom, imageWidth, imageHeight) : [];
  const resolvedMask = isVideoMaskTrack(annotation)
    ? resolveVideoMaskTrackAtFrame(annotation.geometry, frameIndex)
    : null;
  const exactMaskKeyframe = isVideoMaskTrack(annotation)
    && annotation.geometry.keyframes.some((keyframe) => keyframe.frame_index === frameIndex);

  const timeLabel = fps ? formatTimecode(frameIndex / fps) : null;
  const frameChip = (
    <span className={FRAME_CHIP_CLASS} title={`当前第 ${frameIndex} 帧`}>
      <Icon name="film" size={10} />F{frameIndex}
      {timeLabel && <span className={FRAME_TIME_CLASS}>· {timeLabel}</span>}
    </span>
  );

  return (
    <div className={BODY_CLASS}>
      <IdentityHeader
        className={annotation.class_name}
        source={annotationSourceKind(annotation)}
        trailing={frameChip}
      />

      <MetricGrid metrics={metrics} />

      <div className="border-t border-border pt-2 text-xs text-muted-foreground">
        {track.keyframes.length} 关键帧
        {firstFrame !== null && lastFrame !== null && (
          <span className="mono"> · F{firstFrame}–F{lastFrame}</span>
        )}
        <div className="mt-1 text-2xs">
          {isVideoMaskTrack(annotation)
            ? resolvedMask
              ? exactMaskKeyframe ? "当前帧为 Mask 关键帧。" : `当前帧保持 F${resolvedMask.keyframeFrame} 的 Mask；编辑会物化新关键帧。`
              : "当前帧位于 outside 区间。"
            : "点集轨迹的关键帧逐帧编辑暂未开放,可在画布上拖动顶点改形。"}
        </div>
      </div>

      <MetaFooter
        id={annotation.id}
        source={annotation.source}
        createdAt={annotation.created_at}
        updatedAt={annotation.updated_at}
        zOrder={annotation.z_order}
      />

      <ActionBar label={isVideoMaskTrack(annotation) ? "Mask 轨迹操作" : "点集轨迹操作"}>
        {isVideoMaskTrack(annotation) && (
          <Button
            variant="ghost"
            size="sm"
            title="编辑当前帧 Mask"
            disabled={readOnly || locked}
            onClick={onEditMask}
          >
            <Icon name="scissors" size={14} />
            编辑
          </Button>
        )}
        {isVideoMaskTrack(annotation) && (
          <Button
            variant="ghost"
            size="sm"
            title="AI 追踪当前 Mask"
            disabled={readOnly || locked}
            onClick={onPropagate}
          >
            <Icon name="sparkles" size={14} />
            追踪
          </Button>
        )}
        {firstFrame !== null && (
          <Button
            variant="ghost"
            size="sm"
            title="跳到首个关键帧"
            onClick={() => onSeekFrame(firstFrame)}
          >
            <Icon name="crosshair" size={14} />
            跳到首帧
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          title={hidden ? "显示轨迹" : "隐藏轨迹"}
          aria-label={hidden ? "显示轨迹" : "隐藏轨迹"}
          aria-pressed={hidden}
          onClick={() => onToggleHidden(track.track_id)}
        >
          <Icon name={hidden ? "eyeOff" : "eye"} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title={locked ? "解锁轨迹" : "锁定轨迹"}
          aria-label={locked ? "解锁轨迹" : "锁定轨迹"}
          aria-pressed={locked}
          onClick={() => onToggleLock(track.track_id)}
        >
          <Icon name={locked ? "lock" : "unlock"} size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          title="修改类别"
          aria-label="修改类别"
          disabled={readOnly || locked}
          onClick={() => onChangeClass(annotation.id)}
        >
          <Icon name="tag" size={14} />
        </Button>
        <Button
          variant="danger"
          size="sm"
          title="删除整条轨迹"
          aria-label="删除整条轨迹"
          disabled={readOnly || locked}
          onClick={() => onDelete(annotation.id)}
        >
          <Icon name="trash" size={14} />
        </Button>
      </ActionBar>
    </div>
  );
}
