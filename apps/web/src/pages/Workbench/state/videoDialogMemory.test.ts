import { beforeEach, describe, expect, it } from "vitest";
import {
  readDialogMemory,
  videoDialogMemoryStorageKey,
  writeDialogMemory,
} from "./videoDialogMemory";

describe("videoDialogMemory", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("按 userId 分桶读写对话框记忆", () => {
    writeDialogMemory("u1", "kfPropagate", { count: 30 });
    writeDialogMemory("u2", "kfPropagate", { count: 5 });

    const validate = (value: unknown) =>
      value && typeof value === "object"
        ? (value as { count: number })
        : null;

    expect(readDialogMemory("u1", "kfPropagate", validate)).toEqual({ count: 30 });
    expect(readDialogMemory("u2", "kfPropagate", validate)).toEqual({ count: 5 });
  });

  it("无 userId 时不读写,避免跨账号串台", () => {
    writeDialogMemory(null, "trackerPropagate", { modelKey: "sam2_video" });

    expect(window.localStorage.length).toBe(0);
    expect(readDialogMemory(null, "trackerPropagate", () => ({ ok: true }))).toBeNull();
  });

  it("脏 JSON 或 validate 不通过时返回 null", () => {
    window.localStorage.setItem(
      videoDialogMemoryStorageKey("u1", "trackerPropagate"),
      "{bad-json",
    );

    expect(readDialogMemory("u1", "trackerPropagate", () => ({ ok: true }))).toBeNull();

    window.localStorage.setItem(
      videoDialogMemoryStorageKey("u1", "trackerPropagate"),
      JSON.stringify({ modelKey: "unknown" }),
    );
    expect(readDialogMemory("u1", "trackerPropagate", () => null)).toBeNull();
  });
});
