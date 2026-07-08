/**
 * 标注详情面板「显示范围: 全部 / 当前帧」的帧归属判定。
 *
 * 六种视频几何都要认。此前只认矩形框(`video_bbox` / `video_track_bbox`),多边形与折线
 * 走 `return true` 兜底 —— 「当前帧」筛选对它们静默失效(跨帧的单帧多边形被全量列出),
 * 且 `firstTrackFrame` 返回 null 让点击列表行无法跳转到所属帧。
 */
import type { Annotation } from "@/types";
import {
  resolveTrackAtFrame,
  resolveVideoPolygonTrackAtFrame,
  resolveVideoPolylineTrackAtFrame,
} from "../stage/videoStageGeometry";
import { isFrameOutside } from "../stage/videoTrackOutside";
import type { AiBox } from "../state/transforms";

export type FrameFilter = "all" | "current";

/** 该标注是否出现在给定帧(轨迹含插值帧, 排除 outside 区间)。非视频几何恒为 true。 */
export function boxIsOnFrame(box: Annotation | AiBox, frameIndex: number): boolean {
  const geometry = box.geometry;
  if (!geometry) return true;
  // 单帧几何: 帧号相等即在该帧。
  if (geometry.type === "video_bbox" || geometry.type === "video_polygon" || geometry.type === "video_polyline") {
    return geometry.frame_index === frameIndex;
  }
  // 轨迹几何: 该帧能解析出形状即在该帧。
  if (geometry.type === "video_track_bbox") return resolveTrackAtFrame(geometry, frameIndex) !== null;
  if (geometry.type === "video_track_polygon") return resolveVideoPolygonTrackAtFrame(geometry, frameIndex) !== null;
  if (geometry.type === "video_track_polyline") return resolveVideoPolylineTrackAtFrame(geometry, frameIndex) !== null;
  return true;
}

/** 点击列表行跳转到的目标帧: 单帧几何取其帧号, 轨迹取首个可见关键帧。非视频几何返回 null。 */
export function firstTrackFrame(box: Annotation | AiBox): number | null {
  const geometry = box.geometry;
  if (!geometry) return null;
  if (geometry.type === "video_bbox" || geometry.type === "video_polygon" || geometry.type === "video_polyline") {
    return geometry.frame_index;
  }
  if (
    geometry.type !== "video_track_bbox"
    && geometry.type !== "video_track_polygon"
    && geometry.type !== "video_track_polyline"
  ) return null;
  if (geometry.keyframes.length === 0) return null;
  const visible = geometry.keyframes.filter((kf) => !isFrameOutside(geometry, kf.frame_index));
  const frames = (visible.length > 0 ? visible : geometry.keyframes).map((kf) => kf.frame_index);
  return Math.min(...frames);
}

export function filterBoxesByFrame<T extends Annotation | AiBox>(
  boxes: T[],
  frameIndex: number | undefined,
  filter: FrameFilter,
): T[] {
  if (filter !== "current" || typeof frameIndex !== "number") return boxes;
  return boxes.filter((box) => boxIsOnFrame(box, frameIndex));
}
