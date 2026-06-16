import type { VideoFrameEntry, VideoPoint, VideoStageGeom, VideoTrackGhost } from "./videoStageTypes";

export type PickableVideoEntry = VideoFrameEntry | VideoTrackGhost;

type PickOptions = {
  padding?: number;
};

function containsPoint(geom: VideoStageGeom, point: VideoPoint, padding: number) {
  return (
    point.x >= geom.x - padding &&
    point.x <= geom.x + geom.w + padding &&
    point.y >= geom.y - padding &&
    point.y <= geom.y + geom.h + padding
  );
}

// v0.16.3 · 约束放宽到「带 geom 的对象」:命中只读 .geom,泛型保持回传原对象。
// 让 Konva 栈用轻量 { id, geom } 视图复用同一套 z 序逆序 + padding 容差命中,
// 不必造第二份命中实现(SVG 栈仍传完整 PickableVideoEntry,行为零变化)。
export function pickTopVideoEntryAt<T extends { geom: VideoStageGeom }>(
  entries: readonly T[],
  point: VideoPoint,
  options: PickOptions = {},
): T | null {
  const padding = options.padding ?? 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (containsPoint(entry.geom, point, padding)) return entry;
  }
  return null;
}
