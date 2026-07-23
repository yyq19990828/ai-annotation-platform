import { describe, expect, it } from "vitest";
import { toolUnitForGeometryType } from "./toolUnits";

describe("toolUnitForGeometryType", () => {
  it.each([
    ["bbox", "bbox"],
    ["rotated_bbox", "rotated_bbox"],
    ["polygon", "region"],
    ["raster_mask", "region"],
    ["video_mask", "region"],
    ["video_track_mask", "region"],
    ["video_polyline", "polyline"],
    ["keypoint", "keypoint"],
  ])("maps %s to %s", (geometryType, unit) => {
    expect(toolUnitForGeometryType(geometryType)).toBe(unit);
  });
});
