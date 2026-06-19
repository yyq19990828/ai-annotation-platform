import type { VideoTrackKeyframe } from "@/types";
import { sortedKeyframes } from "./videoStageGeometry";
import { isFrameOutside } from "./videoTrackOutside";
import type { VideoFrameEntry, VideoTrackAnnotation } from "./videoStageTypes";

/**
 * 视频轨迹的只读展示格式化助手(纯函数)。
 * roster 列表(VideoTrackPanel)与选中卡(VideoTrackCardContent)共用,避免两处分叉。
 */

/** 关键帧帧号集合 → 「F{min}-F{max}」/「F{n}」/「无帧」。 */
export function frameRange(frames: number[]): string {
  if (frames.length === 0) return "无帧";
  const min = Math.min(...frames);
  const max = Math.max(...frames);
  return min === max ? `F${min}` : `F${min}-F${max}`;
}

/** 关键帧状态文案(消失 / 遮挡 / 正常)。 */
export function keyframeStatus(kf: VideoTrackKeyframe, outside: boolean): string {
  if (outside) return "消失";
  if (kf.occluded) return "遮挡";
  return "正常";
}

/** 轨迹首次出现(最早可见关键帧)的源帧号;无可见关键帧则回落到全部关键帧最小帧。 */
export function firstVisibleTrackFrame(track: VideoTrackAnnotation["geometry"]): number | null {
  if (track.keyframes.length === 0) return null;
  const visible = track.keyframes.filter((kf) => !isFrameOutside(track, kf.frame_index));
  const frames = (visible.length > 0 ? visible : track.keyframes).map((kf) => kf.frame_index);
  return Math.min(...frames);
}

/** 当前帧定位文案:F{n} · 关键帧 / 非关键帧 / 消失 / 遮挡。 */
export function exactFrameLabel(
  selectedTrack: VideoTrackAnnotation | null,
  frameIndex: number,
  outside: boolean,
): string {
  if (!selectedTrack) return `F${frameIndex}`;
  if (outside) return `F${frameIndex} · 消失`;
  const exact = selectedTrack.geometry.keyframes.find((kf) => kf.frame_index === frameIndex);
  if (exact?.occluded) return `F${frameIndex} · 遮挡`;
  return `F${frameIndex} · ${exact ? "关键帧" : "非关键帧"}`;
}

/** 当前帧状态短芯片文案(当前消失 / 当前遮挡 / 关键帧 / 非关键帧)。 */
export function statusChipText(kf: VideoTrackKeyframe | undefined, outside = false): string {
  if (outside) return "当前消失";
  if (kf?.occluded) return "当前遮挡";
  return kf ? "关键帧" : "非关键帧";
}

/** 当前帧来源短文案(prediction / interpolated / manual / legacy bbox / 无当前帧)。 */
export function sourceChipText(source: VideoFrameEntry["source"] | null): string {
  if (source === "prediction") return "prediction";
  if (source === "interpolated") return "interpolated";
  if (source === "legacy") return "legacy bbox";
  if (source === "manual") return "manual";
  return "无当前帧";
}

/** 当前帧之后(环绕)下一条 prediction 关键帧的帧号;无则 null。 */
export function nextPredictionFrame(
  track: VideoTrackAnnotation["geometry"],
  frameIndex: number,
): number | null {
  const predictionFrames = sortedKeyframes(track)
    .filter((kf) => kf.source === "prediction" && !isFrameOutside(track, kf.frame_index))
    .map((kf) => kf.frame_index);
  return predictionFrames.find((frame) => frame > frameIndex) ?? predictionFrames[0] ?? null;
}
