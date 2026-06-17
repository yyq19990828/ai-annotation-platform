import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_CONTENT, migrateLabelContent } from "./auth";

describe("migrateLabelContent", () => {
  it("旧扁平默认 [class,score] → 图片观感不变,track 用默认", () => {
    expect(migrateLabelContent(["class", "score"])).toEqual({
      single: [],
      track: ["id", "state"],
      ai: ["source", "score"],
    });
  });

  it("旧扁平带 id/attrs → single/ai 分发,class 丢弃,track 默认", () => {
    expect(migrateLabelContent(["class", "id", "attrs"])).toEqual({
      single: ["id", "attrs"],
      track: ["id", "state"],
      ai: ["source", "id", "attrs"],
    });
  });

  it("旧扁平含非法 token → 过滤", () => {
    expect(migrateLabelContent(["class", "bogus", "id"])).toEqual({
      single: ["id"],
      track: ["id", "state"],
      ai: ["source", "id"],
    });
  });

  it("空数组 → single 空、ai 仅 source、track 默认", () => {
    expect(migrateLabelContent([])).toEqual({
      single: [],
      track: ["id", "state"],
      ai: ["source"],
    });
  });

  it("新对象 → 逐段去重过滤,缺段补默认", () => {
    expect(migrateLabelContent({ single: ["id", "id"], ai: ["score"] })).toEqual({
      single: ["id"],
      track: ["id", "state"],
      ai: ["score"],
    });
  });

  it("对象段含非法 token → 过滤,其余段补默认", () => {
    expect(migrateLabelContent({ track: ["id", "bogus", "state"] })).toEqual({
      single: [],
      track: ["id", "state"],
      ai: ["source", "score"],
    });
  });

  it("undefined / null → 全默认", () => {
    expect(migrateLabelContent(undefined)).toEqual(DEFAULT_LABEL_CONTENT);
    expect(migrateLabelContent(null)).toEqual(DEFAULT_LABEL_CONTENT);
  });
});
