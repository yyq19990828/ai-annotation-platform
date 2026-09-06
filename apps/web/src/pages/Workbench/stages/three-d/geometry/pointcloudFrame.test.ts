import { describe, expect, it } from "vitest";

import { decodePointCloudFrame } from "./pointcloudFrame";

function asciiPcd(points: Array<[number, number, number]>): ArrayBuffer {
  const text = [
    "VERSION .7",
    "FIELDS x y z",
    "SIZE 4 4 4",
    "TYPE F F F",
    "COUNT 1 1 1",
    `WIDTH ${points.length}`,
    "HEIGHT 1",
    "VIEWPOINT 0 0 0 1 0 0 0",
    `POINTS ${points.length}`,
    "DATA ascii",
    ...points.map((point) => point.join(" ")),
  ].join("\n");
  return new TextEncoder().encode(text).buffer;
}

describe("decodePointCloudFrame", () => {
  it("parses, decimates and normalizes the lidar convention outside the renderer", () => {
    const frame = decodePointCloudFrame(
      asciiPcd([
        [1, 2, 0],
        [2, 3, 1],
        [3, 4, 2],
        [4, 5, 3],
      ]),
      "y_forward",
      2,
    );

    expect(frame.totalPoints).toBe(4);
    expect(frame.renderedPoints).toBe(2);
    expect(frame.decimateStride).toBe(2);
    expect(Array.from(frame.positions)).toEqual([2, -1, 0, 4, -3, 2]);
    expect(frame.heightColors).toHaveLength(6);
    expect(frame.viewRadius).toBeGreaterThanOrEqual(5);
    expect(frame.groundZ).toBeGreaterThanOrEqual(0);
  });
});
