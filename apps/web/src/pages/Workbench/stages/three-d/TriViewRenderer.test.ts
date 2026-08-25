import { describe, expect, it } from "vitest";

import { triViewportY } from "./TriViewRenderer";

describe("triViewportY", () => {
  it("uses the upper-left origin of WebGPURenderer and its WebGL2 fallback", () => {
    expect(triViewportY(12, 40, 200, "webgpu")).toBe(12);
    expect(triViewportY(12, 40, 200, "webgl2-fallback")).toBe(12);
  });

  it("converts to the lower-left origin only for legacy WebGLRenderer", () => {
    expect(triViewportY(12, 40, 200, "legacy-webgl2")).toBe(148);
  });
});
