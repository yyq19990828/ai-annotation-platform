import { describe, expect, it } from "vitest";
import { classNameForCommittedDrawing, wheelZoomFactor } from "./imageStageSettings";

describe("imageStageSettings", () => {
  it("afterBoxCreate=reuse_active 时仅有当前类别才直接提交类别", () => {
    expect(classNameForCommittedDrawing("pick_class", "Car")).toBeUndefined();
    expect(classNameForCommittedDrawing("reuse_active", "")).toBeUndefined();
    expect(classNameForCommittedDrawing("reuse_active", "Car")).toBe("Car");
  });

  it("wheelZoomFactor 使用配置步长", () => {
    expect(wheelZoomFactor(-1, 1.15)).toBe(1.15);
    expect(wheelZoomFactor(1, 1.15)).toBeCloseTo(1 / 1.15);
  });
});
