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
  return ann.geometry.type === "video_track_bbox";
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
  const visibleKeyframes = keyframes.filter((kf) => !isFrameInOutsideRanges(outsideRanges, kf.frame_index));
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
    occluded: false,
    ...patch,
  } satisfies VideoTrackKeyframe;
  next.push({
    ...keyframe,
  });
  const withKeyframes = { ...track, keyframes: next.sort((a, b) => a.frame_index - b.frame_index) };
  // 新增可见关键帧时, 自动清除该帧上的 outside 标记。
  return removeOutsideFrame(withKeyframes, frameIndex);
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

export interface TrackReferenceResult {
  bbox: VideoStageGeom;
  /** true = 恒速外推预测;false = 直接取最近关键帧(回退或未开启预测)。 */
  predicted: boolean;
  /** 参考来源帧:predicted 时为外推基准帧,否则为最近关键帧帧号。 */
  originFrame: number;
}

/**
 * 选中轨迹在当前帧无实框时的「参考框」几何。
 *
 * - `predict=false`(现状):直接取最近关键帧的 bbox。
 * - `predict=true`:取当前帧**之前**最近两个可见关键帧,按恒速线性外推到当前帧
 *   (恒速卡尔曼的预测步)。先行关键帧不足两个时回退到最近关键帧。
 *   完整卡尔曼(带过程/观测噪声平滑)见 ROADMAP。
 */
export function trackReferenceAtFrame(
  track: VideoTrackGeometry,
  frameIndex: number,
  predict: boolean,
): TrackReferenceResult | null {
  const nearest = nearestTrackKeyframe(track, frameIndex);
  if (!nearest) return null;
  if (!predict) return { bbox: nearest.bbox, predicted: false, originFrame: nearest.frame_index };

  const keyframes = getTrackIndex(track).visibleKeyframes;
  const priorIndex = lowerBound(keyframes, frameIndex, (kf) => kf.frame_index) - 1;
  const k2 = keyframes[priorIndex];
  const k1 = keyframes[priorIndex - 1];
  if (!k2 || !k1) return { bbox: nearest.bbox, predicted: false, originFrame: nearest.frame_index };

  const span = Math.max(1, k2.frame_index - k1.frame_index);
  const dt = frameIndex - k2.frame_index;
  const extrapolate = (a: number, b: number) => b + ((b - a) / span) * dt;
  const bbox = clampGeom({
    x: extrapolate(k1.bbox.x, k2.bbox.x),
    y: extrapolate(k1.bbox.y, k2.bbox.y),
    w: extrapolate(k1.bbox.w, k2.bbox.w),
    h: extrapolate(k1.bbox.h, k2.bbox.h),
  });
  return { bbox, predicted: true, originFrame: k2.frame_index };
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

/**
 * v0.10.30 · D-2.1a 确定性派生 track_number, 不持久化。
 *
 * 按「首关键帧 frame_index 升序、并列再按 track_id 字典序」给每条 video_track 派生
 * 1..N 的显示/导出编号。改采样 / 增删 track 时编号自然重排, 符合 D2。
 * 返回 `Map<annotationId, number>`。
 */
export function deriveTrackNumber(
  tracks: ReadonlyArray<{ id: string; geometry: VideoTrackGeometry }>,
): Map<string, number> {
  const firstFrame = (geometry: VideoTrackGeometry) => {
    const frames = geometry.keyframes.map((kf) => kf.frame_index);
    return frames.length > 0 ? Math.min(...frames) : 0;
  };
  const ordered = [...tracks].sort((a, b) => {
    const fa = firstFrame(a.geometry);
    const fb = firstFrame(b.geometry);
    if (fa !== fb) return fa - fb;
    return a.geometry.track_id.localeCompare(b.geometry.track_id);
  });
  const result = new Map<string, number>();
  ordered.forEach((track, index) => result.set(track.id, index + 1));
  return result;
}
