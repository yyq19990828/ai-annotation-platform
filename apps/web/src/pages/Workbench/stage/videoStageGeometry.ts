import type {
  AnnotationResponse,
  VideoBboxGeometry,
  VideoTrackGeometry,
  VideoTrackKeyframe,
} from "@/types";
import type { VideoFrameEntry, VideoStageGeom } from "./videoStageTypes";

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

export function sortedKeyframes(track: VideoTrackGeometry) {
  return [...track.keyframes].sort((a, b) => a.frame_index - b.frame_index);
}

export function upsertKeyframe(
  track: VideoTrackGeometry,
  frameIndex: number,
  bbox: VideoStageGeom,
  patch?: Partial<VideoTrackKeyframe>,
): VideoTrackGeometry {
  const next = sortedKeyframes(track).filter((kf) => kf.frame_index !== frameIndex);
  next.push({
    frame_index: frameIndex,
    bbox: clampGeom(bbox),
    source: "manual",
    absent: false,
    occluded: false,
    ...patch,
  });
  return { ...track, keyframes: next.sort((a, b) => a.frame_index - b.frame_index) };
}

function frameHasAbsentBetween(keyframes: VideoTrackKeyframe[], from: number, to: number) {
  return keyframes.some((kf) => kf.absent && kf.frame_index > from && kf.frame_index < to);
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
): { geom: VideoStageGeom; source: VideoFrameEntry["source"]; occluded?: boolean } | null {
  const keyframes = sortedKeyframes(track);
  const exact = keyframes.find((kf) => kf.frame_index === frameIndex);
  if (exact) {
    if (exact.absent) return null;
    return { geom: exact.bbox, source: exact.source === "prediction" ? "prediction" : "manual", occluded: exact.occluded };
  }

  const before = [...keyframes].reverse().find((kf) => kf.frame_index < frameIndex && !kf.absent);
  const after = keyframes.find((kf) => kf.frame_index > frameIndex && !kf.absent);
  if (!before || !after) return null;
  if (frameHasAbsentBetween(keyframes, before.frame_index, after.frame_index)) return null;
  return { geom: interpolate(before, after, frameIndex), source: "interpolated" };
}

export function nearestTrackBbox(track: VideoTrackGeometry, frameIndex: number): VideoStageGeom {
  const current = resolveTrackAtFrame(track, frameIndex);
  if (current) return current.geom;
  return nearestTrackKeyframe(track, frameIndex)?.bbox ?? { x: 0, y: 0, w: 0.1, h: 0.1 };
}

export function nearestTrackKeyframe(track: VideoTrackGeometry, frameIndex: number): VideoTrackKeyframe | null {
  const keyframes = sortedKeyframes(track).filter((kf) => !kf.absent);
  return keyframes.reduce<VideoTrackKeyframe | null>((best, kf) => {
    if (!best) return kf;
    return Math.abs(kf.frame_index - frameIndex) < Math.abs(best.frame_index - frameIndex) ? kf : best;
  }, null);
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
