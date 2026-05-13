import type { VideoStageGeom } from "./videoStageTypes";

export type VideoStageEvent =
  | { type: "drawn"; geom: VideoStageGeom; className: string }
  | { type: "moved"; id: string; geom: VideoStageGeom }
  | { type: "resized"; id: string; geom: VideoStageGeom }
  | { type: "selected"; id: string | null }
  | { type: "canceled" };

export function isGeometryStageEvent(event: VideoStageEvent): event is Extract<VideoStageEvent, { geom: VideoStageGeom }> {
  return event.type === "drawn" || event.type === "moved" || event.type === "resized";
}
