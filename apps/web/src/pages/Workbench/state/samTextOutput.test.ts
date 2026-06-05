import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAM_OUTPUT_STORAGE_PREFIX,
  defaultOutputMode,
  readStoredOutputMode,
  resolveInitialOutputMode,
  samOutputStorageKey,
  writeStoredOutputMode,
} from "./samTextOutput";

describe("samTextOutput", () => {
  beforeEach(() => window.sessionStorage.clear());
  afterEach(() => window.sessionStorage.clear());

  it("samOutputStorageKey 按 projectId 分桶", () => {
    expect(samOutputStorageKey("p1")).toBe(`${SAM_OUTPUT_STORAGE_PREFIX}p1`);
  });

  it("defaultOutputMode: image-det → box，其它 → mask", () => {
    expect(defaultOutputMode("image-det")).toBe("box");
    expect(defaultOutputMode("image-seg")).toBe("mask");
    expect(defaultOutputMode(undefined)).toBe("mask");
    expect(defaultOutputMode(null)).toBe("mask");
  });

  it("read/writeStoredOutputMode 往返，非法值返回 null", () => {
    expect(readStoredOutputMode("p1")).toBeNull();
    writeStoredOutputMode("p1", "both");
    expect(readStoredOutputMode("p1")).toBe("both");
    // 直接写入非法值 → 读出 null
    window.sessionStorage.setItem(samOutputStorageKey("p1"), "garbage");
    expect(readStoredOutputMode("p1")).toBeNull();
  });

  it("resolveInitialOutputMode 优先级: projectDefault > sessionStorage > typeKey 默认", () => {
    // projectDefault 命中
    expect(resolveInitialOutputMode("p1", "image-det", "mask")).toBe("mask");
    // projectDefault 非法 → 忽略，落 sessionStorage
    writeStoredOutputMode("p1", "box");
    expect(resolveInitialOutputMode("p1", "image-seg", "nope")).toBe("box");
    // 无 projectDefault、无 stored → typeKey 智能默认
    window.sessionStorage.clear();
    expect(resolveInitialOutputMode("p2", "image-det")).toBe("box");
    expect(resolveInitialOutputMode(undefined, "image-seg")).toBe("mask");
  });
});
