import type { VideoFrameEntry, VideoStageGeom, VideoTrackGhost } from "./videoStageTypes";
import type { VideoPoint } from "./videoStageCoordinates";

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

export function pickTopVideoEntryAt<T extends PickableVideoEntry>(
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
