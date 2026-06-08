import { afterEach, describe, expect, it } from "vitest";
import {
  isVariantWarm,
  markVariantWarm,
  recordPredictCacheHit,
  isVariantHot,
  _resetVariantWarmCache,
  _resetVariantHotMap,
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

describe("variantHotMap (v0.14.14 真信号 cache_hit)", () => {
  afterEach(() => {
    _resetVariantHotMap();
  });

  it("未记录时返回 undefined (未知, 调用方按克制路径)", () => {
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBeUndefined();
  });

  it("record(true) 后 isHot 返回 true", () => {
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, true);
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBe(true);
  });

  it("record(false) 后 isHot 返回 false (协议 §4.2 真信号: 本次冷启动)", () => {
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, false);
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBe(false);
  });

  it("backend evict 后响应 cache_hit=false → Map 自我修正", () => {
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, true);
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBe(true);
    // backend evict 后下一次 predict 响应 cache_hit=false
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, false);
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBe(false);
  });

  it("cache_hit=null/undefined 时不污染 Map (协议 §4.2 缺省)", () => {
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, null);
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBeUndefined();
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, undefined);
    expect(isVariantHot("b1", { series: "yolo11", size: "s" })).toBeUndefined();
  });

  it("不同 backend / variant 互不影响", () => {
    recordPredictCacheHit("b1", { series: "yolo11", size: "s" }, true);
    expect(isVariantHot("b2", { series: "yolo11", size: "s" })).toBeUndefined();
    expect(isVariantHot("b1", { series: "yolo11", size: "m" })).toBeUndefined();
  });

  it("backendId 为 null/undefined 时是 noop", () => {
    recordPredictCacheHit(null, { series: "yolo11", size: "s" }, true);
    recordPredictCacheHit(undefined, { series: "yolo11", size: "s" }, true);
    expect(isVariantHot(null, { series: "yolo11", size: "s" })).toBeUndefined();
  });
});
