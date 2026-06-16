import { describe, expect, it } from "vitest";
import {
  VIDEO_KONVA_FLAG_QUERY_KEY,
  VIDEO_KONVA_FLAG_STORAGE_KEY,
  isVideoKonvaEnabled,
} from "./videoKonvaFlag";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: (key) => (key === VIDEO_KONVA_FLAG_STORAGE_KEY ? value : null) };
}

describe("isVideoKonvaEnabled", () => {
  it("缺省关闭(无 query 无 storage)", () => {
    expect(isVideoKonvaEnabled("", storageWith(null))).toBe(false);
    expect(isVideoKonvaEnabled(null, null)).toBe(false);
  });

  it("URL query 真值开启", () => {
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=1`, storageWith(null))).toBe(true);
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=true`, storageWith(null))).toBe(true);
  });

  it("URL query 假值关闭,且短路 localStorage", () => {
    // query 显式存在(=0)时优先级高于 storage 的真值。
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=0`, storageWith("1"))).toBe(false);
  });

  it("无 query 时回落 localStorage", () => {
    expect(isVideoKonvaEnabled("", storageWith("1"))).toBe(true);
    expect(isVideoKonvaEnabled("", storageWith("true"))).toBe(true);
    expect(isVideoKonvaEnabled("", storageWith("0"))).toBe(false);
    expect(isVideoKonvaEnabled("", storageWith("nope"))).toBe(false);
  });

  it("非法 search 串不抛,回落 localStorage", () => {
    expect(isVideoKonvaEnabled("%", storageWith("1"))).toBe(true);
  });
});
