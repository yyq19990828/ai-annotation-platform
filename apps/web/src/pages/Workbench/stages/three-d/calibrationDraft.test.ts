import { describe, expect, it } from "vitest";

import type { SensorCalibration } from "@/types";
import {
  changedCalibrationParts,
  formatCalibrationDraft,
  parseCalibrationDraft,
} from "./calibrationDraft";

const CALIBRATION: SensorCalibration = {
  intrinsic: [100, 0, 50, 0, 100, 40, 0, 0, 1],
  extrinsic: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  rect: null,
};

describe("calibrationDraft", () => {
  it("格式化后可无损解析", () => {
    expect(parseCalibrationDraft(formatCalibrationDraft(CALIBRATION))).toEqual({
      ok: true,
      value: CALIBRATION,
    });
  });

  it.each([
    ["{", "JSON 语法不正确"],
    [JSON.stringify({ intrinsic: [], extrinsic: CALIBRATION.extrinsic }), "intrinsic"],
    [JSON.stringify({ ...CALIBRATION, vendor: "x" }), "vendor"],
  ])("拒绝无效草稿", (source, message) => {
    const result = parseCalibrationDraft(source);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("只报告真正改变的矩阵", () => {
    expect(
      changedCalibrationParts(CALIBRATION, {
        ...CALIBRATION,
        intrinsic: [110, 0, 50, 0, 100, 40, 0, 0, 1],
      }),
    ).toEqual(["intrinsic"]);
  });
});
