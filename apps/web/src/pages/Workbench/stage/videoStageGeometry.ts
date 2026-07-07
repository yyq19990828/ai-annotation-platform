import type {
  AnnotationResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
  VideoTrackKeyframe,
  VideoTrackPolygonGeometry,
  VideoTrackPolygonKeyframe,
} from "@/types";
import type { VideoFrameEntry, VideoStageGeom } from "./videoStageTypes";
import { runReferenceKalman } from "./videoReferenceKalman";
import type { VideoReferenceMode, VideoReferencePreset } from "./videoReferencePredict";
import {
  effectiveOutsideRanges,
  isFrameInOutsideRanges,
  normalizeOutsideRanges,
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

/** v0.21.20 · polygon track 判定 (与 isVideoTrack 平行)。 */
export function isVideoPolygonTrack(
  ann: AnnotationResponse,
): ann is AnnotationResponse & { geometry: VideoTrackPolygonGeometry } {
  return ann.geometry.type === "video_track_polygon";
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

// ── v0.21.20 · polygon track 弧长参数化插值 (镜像后端 video_tracks.lerp_polygon) ──

type Point = [number, number];
export type ResolvedPolygonFrame = {
  points: Point[];
  source: VideoFrameEntry["source"];
  occluded?: boolean;
};

// round 到 6 位并把 -0 归一化为 0 (避免下游 toEqual / 序列化区分负零)。
const round6 = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

/** 把闭合多边形按弧长重采样为 n 个等距顶点 (从 index 0 起)。退化时安全回退。 */
export function resampleClosedPolygon(points: Point[], n: number): Point[] {
  const pts = points.filter((p) => p.length >= 2);
  if (n <= 0 || pts.length < 2) return pts.map((p) => [p[0], p[1]] as Point);
  const segLengths = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const perim = segLengths.reduce((a, b) => a + b, 0);
  if (perim === 0) return Array.from({ length: n }, () => [pts[0][0], pts[0][1]] as Point);
  const cum = [0];
  for (const len of segLengths) cum.push(cum[cum.length - 1] + len);
  const step = perim / n;
  const out: Point[] = [];
  for (let k = 0; k < n; k++) {
    const target = k * step;
    let seg = 0;
    while (seg < segLengths.length - 1 && cum[seg + 1] < target) seg++;
    const segLen = segLengths[seg];
    const t = segLen === 0 ? 0 : (target - cum[seg]) / segLen;
    const [x0, y0] = pts[seg];
    const [x1, y1] = pts[(seg + 1) % pts.length];
    out.push([round6(x0 + (x1 - x0) * t), round6(y0 + (y1 - y0) * t)]);
  }
  return out;
}

/** 选 b 的循环起点使与 a 逐点距离和最小, 减少插值中途扭曲。 */
function bestRotationOffset(a: Point[], b: Point[]): number {
  const n = a.length;
  if (n === 0 || b.length !== n) return 0;
  let bestOffset = 0;
  let bestCost = Infinity;
  for (let offset = 0; offset < n; offset++) {
    let cost = 0;
    for (let i = 0; i < n; i++) {
      const [bx, by] = b[(i + offset) % n];
      cost += (a[i][0] - bx) ** 2 + (a[i][1] - by) ** 2;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

/** polygon 关键帧插值: 弧长重采样到公共顶点数 + 旋转对齐后逐点 lerp。 */
export function interpolatePolygon(
  a: VideoTrackPolygonKeyframe,
  b: VideoTrackPolygonKeyframe,
  frameIndex: number,
): Point[] {
  const pa = a.points.filter((p) => p.length >= 2);
  const pb = b.points.filter((p) => p.length >= 2);
  if (!pa.length) return pb.map((p) => [p[0], p[1]] as Point);
  if (!pb.length) return pa.map((p) => [p[0], p[1]] as Point);
  const span = Math.max(1, b.frame_index - a.frame_index);
  const t = (frameIndex - a.frame_index) / span;
  const n = Math.max(pa.length, pb.length);
  const ra = resampleClosedPolygon(pa, n);
  const rb = resampleClosedPolygon(pb, n);
  const offset = bestRotationOffset(ra, rb);
  return ra.map((p, i) => {
    const q = rb[(i + offset) % n];
    return [round6(p[0] + (q[0] - p[0]) * t), round6(p[1] + (q[1] - p[1]) * t)] as Point;
  });
}

/** 解析 polygon track 在某帧的多边形 (精确关键帧 / 弧长插值 / outside → null)。 */
export function resolveVideoPolygonTrackAtFrame(
  track: VideoTrackPolygonGeometry,
  frameIndex: number,
): ResolvedPolygonFrame | null {
  const outsideRanges = normalizeOutsideRanges(track.outside ?? []);
  if (isFrameInOutsideRanges(outsideRanges, frameIndex)) return null;
  const keyframes = [...track.keyframes].sort((a, b) => a.frame_index - b.frame_index);
  const visible = keyframes.filter((kf) => !isFrameInOutsideRanges(outsideRanges, kf.frame_index));

  const exact = keyframes.find((kf) => kf.frame_index === frameIndex);
  if (exact) {
    return {
      points: exact.points.map((p) => [p[0], p[1]] as Point),
      source: exact.source === "prediction" ? "prediction" : "manual",
      occluded: exact.occluded,
    };
  }

  const afterIndex = lowerBound(visible, frameIndex, (kf) => kf.frame_index);
  const before = visible[afterIndex - 1];
  const after = visible[afterIndex];
  if (!before || !after) return null;
  if (outsideRangesIntersect(outsideRanges, before.frame_index + 1, after.frame_index - 1)) {
    return null;
  }
  return { points: interpolatePolygon(before, after, frameIndex), source: "interpolated" };
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
  /** true = 运动预测(linear / kalman);false = 直接取最近关键帧(回退或 mode=off)。 */
  predicted: boolean;
  /** 预测算法:`predicted` 为 true 时区分恒速外推 / 完整卡尔曼。 */
  predictedKind?: "linear" | "kalman";
  /** 参考来源帧:predicted 时为外推/滤波基准帧,否则为最近关键帧帧号。 */
  originFrame: number;
  /** kalman 模式输出的位置后验标准差(归一化坐标),用于画预测不确定度误差椭圆;其它模式 undefined。 */
  uncertainty?: { sx: number; sy: number; sw: number; sh: number };
}

/**
 * 选中轨迹在当前帧无实框时的「参考框」几何。
 *
 * - `mode="off"`(现状):直接取最近关键帧的 bbox。
 * - `mode="linear"`:取当前帧**之前**最近两个可见关键帧,按恒速线性外推到当前帧
 *   (恒速卡尔曼的预测步)。
 * - `mode="kalman"`:遍历当前帧之前**所有**可见关键帧前向滤波(predict→update)得到
 *   平滑后验,再外推到当前帧;`preset` 选噪声档位(平稳 / 灵敏)。见 `videoReferenceKalman.ts`。
 *
 * 先行可见关键帧不足两个时,linear / kalman 均回退到最近关键帧(`predicted=false`)。
 */
export function trackReferenceAtFrame(
  track: VideoTrackGeometry,
  frameIndex: number,
  mode: VideoReferenceMode,
  preset: VideoReferencePreset = "stable",
): TrackReferenceResult | null {
  const nearest = nearestTrackKeyframe(track, frameIndex);
  if (!nearest) return null;
  if (mode === "off") return { bbox: nearest.bbox, predicted: false, originFrame: nearest.frame_index };

  const keyframes = getTrackIndex(track).visibleKeyframes;
  const priorIndex = lowerBound(keyframes, frameIndex, (kf) => kf.frame_index) - 1;
  const k2 = keyframes[priorIndex];
  const k1 = keyframes[priorIndex - 1];
  if (!k2 || !k1) return { bbox: nearest.bbox, predicted: false, originFrame: nearest.frame_index };

  if (mode === "kalman") {
    // 当前帧之前的所有可见关键帧(升序、长度 ≥ 2,priorIndex+1 == k2 之后的切片端点)。
    const prior = keyframes.slice(0, priorIndex + 1);
    const result = runReferenceKalman(
      prior.map((kf) => ({
        frame: kf.frame_index,
        cx: kf.bbox.x + kf.bbox.w / 2,
        cy: kf.bbox.y + kf.bbox.h / 2,
        w: kf.bbox.w,
        h: kf.bbox.h,
      })),
      frameIndex,
      preset,
    );
    const bbox = clampGeom({
      x: result.cx - result.w / 2,
      y: result.cy - result.h / 2,
      w: result.w,
      h: result.h,
    });
    return {
      bbox,
      predicted: true,
      predictedKind: "kalman",
      originFrame: k2.frame_index,
      uncertainty: { sx: result.sx, sy: result.sy, sw: result.sw, sh: result.sh },
    };
  }

  const span = Math.max(1, k2.frame_index - k1.frame_index);
  const dt = frameIndex - k2.frame_index;
  const extrapolate = (a: number, b: number) => b + ((b - a) / span) * dt;
  const bbox = clampGeom({
    x: extrapolate(k1.bbox.x, k2.bbox.x),
    y: extrapolate(k1.bbox.y, k2.bbox.y),
    w: extrapolate(k1.bbox.w, k2.bbox.w),
    h: extrapolate(k1.bbox.h, k2.bbox.h),
  });
  return { bbox, predicted: true, predictedKind: "linear", originFrame: k2.frame_index };
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
