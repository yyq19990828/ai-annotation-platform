import type {
  AnnotationResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
  VideoTrackKeyframe,
} from "@/types";
import type { VideoFrameEntry, VideoStageGeom } from "./videoStageTypes";
import {
  effectiveOutsideRanges,
  isFrameInOutsideRanges,
  outsideRangesIntersect,
  removeOutsideFrame,
} from "./videoTrackOutside";

export function clamp01(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function clampGeom(g: VideoStageGeom): VideoStageGeom {
  const w = clamp01(g.w);
  const h = clamp01(g.h);
  return {
    x: Math.max(0, Math.min(1 - w, clamp01(g.x))),
    y: Math.max(0, Math.min(1 - h, clamp01(g.y))),
    w,
    h,
  };
}

export function normalizeGeom(a: { x: number; y: number }, b: { x: number; y: number }): VideoStageGeom {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

export function isVideoBbox(ann: AnnotationResponse): ann is AnnotationResponse & { geometry: VideoBboxGeometry } {
  return ann.geometry.type === "video_bbox";
}

export function isVideoTrack(ann: AnnotationResponse): ann is AnnotationResponse & { geometry: VideoTrackGeometry } {
  return ann.geometry.type === "video_track";
}

type ResolvedTrackFrame = { geom: VideoStageGeom; source: VideoFrameEntry["source"]; occluded?: boolean };
type TrackIndex = {
  keyframes: VideoTrackKeyframe[];
  visibleKeyframes: VideoTrackKeyframe[];
  outsideRanges: ReturnType<typeof effectiveOutsideRanges>;
};

const trackIndexCache = new WeakMap<VideoTrackGeometry, TrackIndex>();
const resolvedFrameCache = new WeakMap<VideoTrackGeometry, Map<number, ResolvedTrackFrame | null>>();
const resolvedFrameCacheOrder: Array<{ track: VideoTrackGeometry; frameIndex: number }> = [];
const RESOLVED_FRAME_CACHE_LIMIT = 1000;

function lowerBound<T>(items: T[], target: number, pick: (item: T) => number) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (pick(items[mid]) < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function getTrackIndex(track: VideoTrackGeometry): TrackIndex {
  const cached = trackIndexCache.get(track);
  if (cached) return cached;
  const keyframes = [...track.keyframes].sort((a, b) => a.frame_index - b.frame_index);
  const outsideRanges = effectiveOutsideRanges(track);
  const visibleKeyframes = keyframes.filter((kf) => !kf.absent && !isFrameInOutsideRanges(outsideRanges, kf.frame_index));
  const index = { keyframes, visibleKeyframes, outsideRanges };
  trackIndexCache.set(track, index);
  return index;
}

function getResolvedCache(track: VideoTrackGeometry) {
  let cache = resolvedFrameCache.get(track);
  if (!cache) {
    cache = new Map();
    resolvedFrameCache.set(track, cache);
  }
  return cache;
}

function setResolvedCache(track: VideoTrackGeometry, frameIndex: number, value: ResolvedTrackFrame | null) {
  const cache = getResolvedCache(track);
  if (cache.has(frameIndex)) {
    cache.set(frameIndex, value);
    return;
  }
  cache.set(frameIndex, value);
  resolvedFrameCacheOrder.push({ track, frameIndex });
  while (resolvedFrameCacheOrder.length > RESOLVED_FRAME_CACHE_LIMIT) {
    const oldest = resolvedFrameCacheOrder.shift();
    if (!oldest) break;
    resolvedFrameCache.get(oldest.track)?.delete(oldest.frameIndex);
  }
}

export function sortedKeyframes(track: VideoTrackGeometry) {
  return getTrackIndex(track).keyframes;
}

export function upsertKeyframe(
  track: VideoTrackGeometry,
  frameIndex: number,
  bbox: VideoStageGeom,
  patch?: Partial<VideoTrackKeyframe>,
): VideoTrackGeometry {
  const next = sortedKeyframes(track).filter((kf) => kf.frame_index !== frameIndex);
  const keyframe = {
    frame_index: frameIndex,
    bbox: clampGeom(bbox),
    source: "manual",
    absent: false,
    occluded: false,
    ...patch,
  } satisfies VideoTrackKeyframe;
  next.push({
    ...keyframe,
  });
  const withKeyframes = { ...track, keyframes: next.sort((a, b) => a.frame_index - b.frame_index) };
  return keyframe.absent ? withKeyframes : removeOutsideFrame(withKeyframes, frameIndex);
}

function interpolate(a: VideoTrackKeyframe, b: VideoTrackKeyframe, frameIndex: number): VideoStageGeom {
  const span = Math.max(1, b.frame_index - a.frame_index);
  const t = (frameIndex - a.frame_index) / span;
  return {
    x: a.bbox.x + (b.bbox.x - a.bbox.x) * t,
    y: a.bbox.y + (b.bbox.y - a.bbox.y) * t,
    w: a.bbox.w + (b.bbox.w - a.bbox.w) * t,
    h: a.bbox.h + (b.bbox.h - a.bbox.h) * t,
  };
}

export function resolveTrackAtFrame(
  track: VideoTrackGeometry,
  frameIndex: number,
): ResolvedTrackFrame | null {
  const cache = getResolvedCache(track);
  if (cache.has(frameIndex)) return cache.get(frameIndex) ?? null;

  const { keyframes, visibleKeyframes, outsideRanges } = getTrackIndex(track);
  if (isFrameInOutsideRanges(outsideRanges, frameIndex)) {
    setResolvedCache(track, frameIndex, null);
    return null;
  }

  const exactIndex = lowerBound(keyframes, frameIndex, (kf) => kf.frame_index);
  const exact = keyframes[exactIndex]?.frame_index === frameIndex ? keyframes[exactIndex] : null;
  if (exact) {
    if (exact.absent) {
      setResolvedCache(track, frameIndex, null);
      return null;
    }
    const resolved = { geom: exact.bbox, source: exact.source === "prediction" ? "prediction" : "manual", occluded: exact.occluded } satisfies ResolvedTrackFrame;
    setResolvedCache(track, frameIndex, resolved);
    return resolved;
  }

  const afterIndex = lowerBound(visibleKeyframes, frameIndex, (kf) => kf.frame_index);
  const before = visibleKeyframes[afterIndex - 1];
  const after = visibleKeyframes[afterIndex];
  if (!before || !after) {
    setResolvedCache(track, frameIndex, null);
    return null;
  }
  if (outsideRangesIntersect(outsideRanges, before.frame_index + 1, after.frame_index - 1)) {
    setResolvedCache(track, frameIndex, null);
    return null;
  }
  const resolved = { geom: interpolate(before, after, frameIndex), source: "interpolated" } satisfies ResolvedTrackFrame;
  setResolvedCache(track, frameIndex, resolved);
  return resolved;
}

export function nearestTrackBbox(track: VideoTrackGeometry, frameIndex: number): VideoStageGeom {
  const current = resolveTrackAtFrame(track, frameIndex);
  if (current) return current.geom;
  return nearestTrackKeyframe(track, frameIndex)?.bbox ?? { x: 0, y: 0, w: 0.1, h: 0.1 };
}

export function nearestTrackKeyframe(track: VideoTrackGeometry, frameIndex: number): VideoTrackKeyframe | null {
  const keyframes = getTrackIndex(track).visibleKeyframes;
  if (keyframes.length === 0) return null;
  const afterIndex = lowerBound(keyframes, frameIndex, (kf) => kf.frame_index);
  if (afterIndex <= 0) return keyframes[0];
  if (afterIndex >= keyframes.length) return keyframes[keyframes.length - 1];
  const before = keyframes[afterIndex - 1];
  const after = keyframes[afterIndex];
  return Math.abs(before.frame_index - frameIndex) <= Math.abs(after.frame_index - frameIndex) ? before : after;
}

export function shapeIou(a: VideoStageGeom, b: VideoStageGeom) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

export function shortTrackId(trackId: string) {
  return trackId.length > 8 ? trackId.slice(0, 8) : trackId;
}
