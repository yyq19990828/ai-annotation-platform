import { describe, expect, it } from "vitest";

import {
  formatMeasurementMeters,
  summarizeMeasurement,
  type MeasurementAnchor,
} from "./measurement";

function anchor(pointIndex: number, position: [number, number, number]): MeasurementAnchor {
  return { pointIndex, position };
}

describe("summarizeMeasurement", () => {
  it("空路径与单点没有距离", () => {
    expect(summarizeMeasurement([])).toEqual({
      segmentCount: 0,
      distance3d: 0,
      horizontalDistance: 0,
      elevationChange: 0,
    });
    expect(summarizeMeasurement([anchor(0, [1, 2, 3])])).toEqual({
      segmentCount: 0,
      distance3d: 0,
      horizontalDistance: 0,
      elevationChange: 0,
    });
  });

  it("按 3-4-12 三角形计算三维、水平和首尾高差", () => {
    expect(summarizeMeasurement([anchor(0, [0, 0, 0]), anchor(1, [3, 4, 12])])).toEqual({
      segmentCount: 1,
      distance3d: 13,
      horizontalDistance: 5,
      elevationChange: 12,
    });
  });

  it("多段路径累计长度但只报告首尾高差", () => {
    expect(
      summarizeMeasurement([anchor(0, [0, 0, 2]), anchor(1, [3, 4, 2]), anchor(2, [3, 4, -3])]),
    ).toEqual({
      segmentCount: 2,
      distance3d: 10,
      horizontalDistance: 5,
      elevationChange: -5,
    });
  });
});

describe("formatMeasurementMeters", () => {
  it("使用米和两位小数，并按需保留正号", () => {
    expect(formatMeasurementMeters(1.234)).toBe("1.23 m");
    expect(formatMeasurementMeters(1.234, true)).toBe("+1.23 m");
    expect(formatMeasurementMeters(-1.234, true)).toBe("-1.23 m");
    expect(formatMeasurementMeters(-0.0001, true)).toBe("0.00 m");
  });
});
