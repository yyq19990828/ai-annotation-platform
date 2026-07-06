import type { VideoTrackGeometry, VideoTrackKeyframe, VideoTrackOutsideRange } from "@/types";
import {
  effectiveOutsideRanges,
  isFrameInOutsideRanges,
  outsideRangesIntersect,
} from "./videoTrackOutside";

export interface VideoTrackTimelineKeyframe {
  frame: number;
  source: "manual" | "prediction";
  occluded: boolean;
}

export interface VideoTrackTimelineSegment {
  from: number;
  to: number;
  hasPrediction: boolean;
}

export interface VideoTrackTimelineOutsideSegment {
  from: number;
  to: number;
  source: VideoTrackOutsideRange["source"];
}

export interface VideoTrackTimeline {
  trackId: string;
  keyframes: VideoTrackTimelineKeyframe[];
  outside: VideoTrackTimelineOutsideSegment[];
  interpolated: VideoTrackTimelineSegment[];
}

export interface VideoTimelineDensityBin {
  index: number;
  from: number;
  to: number;
  density: number;
  /**
   * 该 bin 内各轨迹的关键帧贡献数, 按数量降序 (legacy bbox 不计入)。
   * 用于把密度条按比例分段着色; 各 track count 之和可能小于 density (差额为 legacy bbox)。
   */
  tracks: { trackId: string; count: number }[];
}

function sortedLatestKeyframes(track: VideoTrackGeometry): VideoTrackKeyframe[] {
  const latestByFrame = new Map<number, VideoTrackKeyframe>();
  for (const keyframe of track.keyframes) {
    latestByFrame.set(keyframe.frame_index, keyframe);
  }
  return [...latestByFrame.values()].sort((a, b) => a.frame_index - b.frame_index);
}

export function visibleKeyframesForTimeline(track: VideoTrackGeometry): VideoTrackKeyframe[] {
  const outsideRanges = effectiveOutsideRanges(track);
  return sortedLatestKeyframes(track).filter(
    (keyframe) => !isFrameInOutsideRanges(outsideRanges, keyframe.frame_index),
  );
}

export function buildSelectedTrackTimeline(track: VideoTrackGeometry): VideoTrackTimeline {
  const outsideRanges = effectiveOutsideRanges(track);
  const visibleKeyframes = visibleKeyframesForTimeline(track);
  const interpolated: VideoTrackTimelineSegment[] = [];

  for (let i = 1; i < visibleKeyframes.length; i++) {
    const before = visibleKeyframes[i - 1];
    const after = visibleKeyframes[i];
    if (after.frame_index <= before.frame_index + 1) continue;
    if (outsideRangesIntersect(outsideRanges, before.frame_index + 1, after.frame_index - 1)) continue;
    interpolated.push({
      from: before.frame_index,
      to: after.frame_index,
      hasPrediction: before.source === "prediction" || after.source === "prediction",
    });
  }

  return {
    trackId: track.track_id,
    keyframes: visibleKeyframes.map((keyframe) => ({
      frame: keyframe.frame_index,
      source: keyframe.source === "prediction" ? "prediction" : "manual",
      occluded: Boolean(keyframe.occluded),
    })),
    outside: outsideRanges.map((range) => ({
      from: range.from,
      to: range.to,
      source: range.source ?? "manual",
    })),
    interpolated,
  };
}

export function buildGlobalTimelineDensity(
  tracks: readonly VideoTrackGeometry[],
  maxFrame: number,
  bins = 80,
  manualBboxFrames: readonly number[] = [],
): VideoTimelineDensityBin[] {
  const safeMaxFrame = Math.max(0, Math.floor(maxFrame));
  const binCount = Math.max(1, Math.min(Math.floor(bins), safeMaxFrame + 1 || 1));
  const counts = Array.from({ length: binCount }, () => 0);
  // 每个 bin 记录各轨迹贡献数, 取最多者作为该 bin 的着色轨迹。
  const trackCounts: Map<string, number>[] = Array.from({ length: binCount }, () => new Map());

  const binOf = (frameIndex: number) => {
    const frame = Math.max(0, Math.min(safeMaxFrame, Math.floor(frameIndex)));
    return safeMaxFrame > 0 ? Math.min(binCount - 1, Math.floor((frame / (safeMaxFrame + 1)) * binCount)) : 0;
  };

  for (const track of tracks) {
    for (const keyframe of sortedLatestKeyframes(track)) {
      const index = binOf(keyframe.frame_index);
      counts[index] += 1;
      const perTrack = trackCounts[index];
      perTrack.set(track.track_id, (perTrack.get(track.track_id) ?? 0) + 1);
    }
  }

  // legacy bbox 无 track 归属: 只计入密度高度, 不参与着色轨迹的判定。
  for (const frameIndex of manualBboxFrames) {
    counts[binOf(frameIndex)] += 1;
  }

  return counts.map((density, index) => {
    const from = Math.floor((index / binCount) * (safeMaxFrame + 1));
    const to = Math.max(from, Math.floor(((index + 1) / binCount) * (safeMaxFrame + 1)) - 1);
    // Map 迭代序 = 插入序; sort 稳定, 故同数量按首次出现的轨迹在前。
    const trackShares = [...trackCounts[index]]
      .map(([trackId, count]) => ({ trackId, count }))
      .sort((a, b) => b.count - a.count);
    return { index, from, to, density, tracks: trackShares };
  });
}

export interface PredictionDensityBin {
  index: number;
  from: number;
  to: number;
  count: number;
}

/**
 * 预测帧集合 → bucket 化密度轨。与 buildGlobalTimelineDensity 用同一 bin 划分 (等宽 binOf),
 * 保证预测密度条与人工密度条在时间轴上逐桶对齐; 但预测无轨迹归属, 单色渲染。
 */
export function buildPredictionDensity(
  predictedFrames: readonly number[],
  maxFrame: number,
  bins = 80,
): PredictionDensityBin[] {
  const safeMaxFrame = Math.max(0, Math.floor(maxFrame));
  const binCount = Math.max(1, Math.min(Math.floor(bins), safeMaxFrame + 1 || 1));
  const counts = Array.from({ length: binCount }, () => 0);
  const binOf = (frameIndex: number) => {
    const frame = Math.max(0, Math.min(safeMaxFrame, Math.floor(frameIndex)));
    return safeMaxFrame > 0 ? Math.min(binCount - 1, Math.floor((frame / (safeMaxFrame + 1)) * binCount)) : 0;
  };
  for (const frameIndex of predictedFrames) counts[binOf(frameIndex)] += 1;
  return counts.map((count, index) => {
    const from = Math.floor((index / binCount) * (safeMaxFrame + 1));
    const to = Math.max(from, Math.floor(((index + 1) / binCount) * (safeMaxFrame + 1)) - 1);
    return { index, from, to, count };
  });
}

export function nextVisibleKeyframeFrame(
  track: VideoTrackGeometry,
  frameIndex: number,
  dir: -1 | 1,
): number | null {
  const frames = visibleKeyframesForTimeline(track).map((keyframe) => keyframe.frame_index);
  if (frames.length === 0) return null;
  if (dir > 0) return frames.find((frame) => frame > frameIndex) ?? null;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i] < frameIndex) return frames[i];
  }
  return null;
}

/** 上一个可见关键帧（不在 outside 区间）；无则 null。 */
export function prevKeyframeFrame(track: VideoTrackGeometry, frameIndex: number): number | null {
  return nextVisibleKeyframeFrame(track, frameIndex, -1);
}

/** 下一个可见关键帧（不在 outside 区间）；无则 null。 */
export function nextKeyframeFrame(track: VideoTrackGeometry, frameIndex: number): number | null {
  return nextVisibleKeyframeFrame(track, frameIndex, 1);
}

/** 轨迹首次出现（最早可见关键帧）的源帧号；无可见关键帧则 null。 */
export function firstAppearFrame(track: VideoTrackGeometry): number | null {
  const frames = visibleKeyframesForTimeline(track);
  return frames.length > 0 ? frames[0].frame_index : null;
}

/** 轨迹最后出现（最晚可见关键帧）的源帧号；无可见关键帧则 null。 */
export function lastAppearFrame(track: VideoTrackGeometry): number | null {
  const frames = visibleKeyframesForTimeline(track);
  return frames.length > 0 ? frames[frames.length - 1].frame_index : null;
}
