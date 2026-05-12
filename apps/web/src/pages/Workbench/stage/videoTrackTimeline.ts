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
    (keyframe) => !keyframe.absent && !isFrameInOutsideRanges(outsideRanges, keyframe.frame_index),
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
): VideoTimelineDensityBin[] {
  const safeMaxFrame = Math.max(0, Math.floor(maxFrame));
  const binCount = Math.max(1, Math.min(Math.floor(bins), safeMaxFrame + 1 || 1));
  const counts = Array.from({ length: binCount }, () => 0);

  for (const track of tracks) {
    for (const keyframe of sortedLatestKeyframes(track)) {
      const frame = Math.max(0, Math.min(safeMaxFrame, Math.floor(keyframe.frame_index)));
      const index = safeMaxFrame > 0 ? Math.min(binCount - 1, Math.floor((frame / (safeMaxFrame + 1)) * binCount)) : 0;
      counts[index] += 1;
    }
  }

  return counts.map((density, index) => {
    const from = Math.floor((index / binCount) * (safeMaxFrame + 1));
    const to = Math.max(from, Math.floor(((index + 1) / binCount) * (safeMaxFrame + 1)) - 1);
    return { index, from, to, density };
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
