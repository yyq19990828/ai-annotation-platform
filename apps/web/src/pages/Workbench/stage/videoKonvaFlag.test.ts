import { describe, expect, it } from "vitest";
import {
  VIDEO_KONVA_DEFAULT_ON,
  VIDEO_KONVA_FLAG_QUERY_KEY,
  VIDEO_KONVA_FLAG_STORAGE_KEY,
  isVideoKonvaEnabled,
  readVideoKonvaLocalFlag,
} from "./videoKonvaFlag";

function storageWith(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: (key) => (key === VIDEO_KONVA_FLAG_STORAGE_KEY ? value : null) };
}

describe("isVideoKonvaEnabled", () => {
  it("v0.16.4 切默认:无 query 无 storage → 默认开(VIDEO_KONVA_DEFAULT_ON)", () => {
    expect(VIDEO_KONVA_DEFAULT_ON).toBe(true);
    expect(isVideoKonvaEnabled("", storageWith(null))).toBe(true);
    expect(isVideoKonvaEnabled(null, null)).toBe(true);
  });

  it("URL query 真值开启", () => {
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=1`, storageWith(null))).toBe(true);
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=true`, storageWith(null))).toBe(true);
  });

  it("URL query 假值关闭(逃生舱),且短路 localStorage", () => {
    // query 显式 =0 时优先级高于 storage 的真值。
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=0`, storageWith("1"))).toBe(false);
    expect(isVideoKonvaEnabled(`?${VIDEO_KONVA_FLAG_QUERY_KEY}=false`, storageWith(null))).toBe(false);
  });

  it("无 query 时按 localStorage:显式真/假优先,未设置或无法识别 → 默认开", () => {
    expect(isVideoKonvaEnabled("", storageWith("1"))).toBe(true);
    expect(isVideoKonvaEnabled("", storageWith("true"))).toBe(true);
    expect(isVideoKonvaEnabled("", storageWith("0"))).toBe(false); // 用户显式关 = 逃生舱
    expect(isVideoKonvaEnabled("", storageWith("false"))).toBe(false);
    expect(isVideoKonvaEnabled("", storageWith("nope"))).toBe(true); // 无法识别 → 默认开
  });

  it("非法 search 串不抛,回落 localStorage", () => {
    expect(isVideoKonvaEnabled("%", storageWith("0"))).toBe(false);
    expect(isVideoKonvaEnabled("%", storageWith(null))).toBe(true);
  });
});

describe("readVideoKonvaLocalFlag(设置面板,仅看 localStorage)", () => {
  it("未设置 → 默认开;显式 0/false → 关;1/true → 开", () => {
    expect(readVideoKonvaLocalFlag(storageWith(null))).toBe(true);
    expect(readVideoKonvaLocalFlag(storageWith("0"))).toBe(false);
    expect(readVideoKonvaLocalFlag(storageWith("false"))).toBe(false);
    expect(readVideoKonvaLocalFlag(storageWith("1"))).toBe(true);
  });
});
