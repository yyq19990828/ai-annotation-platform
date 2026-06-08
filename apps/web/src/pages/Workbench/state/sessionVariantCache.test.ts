import { afterEach, describe, expect, it } from "vitest";
import {
  isVariantWarm,
  markVariantWarm,
  _resetVariantWarmCache,
} from "./sessionVariantCache";

describe("sessionVariantCache", () => {
  afterEach(() => {
    _resetVariantWarmCache();
  });

  it("isWarm 默认为 false (空 cache)", () => {
    expect(isVariantWarm("b1", { series: "yolo11", size: "s" })).toBe(false);
  });

  it("markWarm 后同 variant 返回 true", () => {
    markVariantWarm("b1", { series: "yolo11", size: "s" });
    expect(isVariantWarm("b1", { series: "yolo11", size: "s" })).toBe(true);
  });

  it("不同 variant 互不影响", () => {
    markVariantWarm("b1", { series: "yolo11", size: "s" });
    expect(isVariantWarm("b1", { series: "yolo11", size: "n" })).toBe(false);
    expect(isVariantWarm("b1", { series: "yolov8", size: "s" })).toBe(false);
  });

  it("不同 backend 互不影响", () => {
    markVariantWarm("b1", { series: "yolo11", size: "s" });
    expect(isVariantWarm("b2", { series: "yolo11", size: "s" })).toBe(false);
  });

  it("backendId 为 null/undefined 时 isWarm/markWarm 是 noop", () => {
    markVariantWarm(null, { series: "yolo11", size: "s" });
    markVariantWarm(undefined, { series: "yolo11", size: "s" });
    expect(isVariantWarm(null, { series: "yolo11", size: "s" })).toBe(false);
    expect(isVariantWarm("b1", { series: "yolo11", size: "s" })).toBe(false);
  });

  it("axis_key 顺序无关 (markWarm 用 a/b vs isWarm 用 b/a)", () => {
    markVariantWarm("b1", { series: "yolo11", size: "s" });
    expect(isVariantWarm("b1", { size: "s", series: "yolo11" })).toBe(true);
  });

  it("非 string value 被忽略 (不污染 key)", () => {
    markVariantWarm("b1", { series: "yolo11", count: 42, weight: null });
    // 只有 series 入 key, 单 axis variant
    expect(isVariantWarm("b1", { series: "yolo11" })).toBe(true);
  });
});
