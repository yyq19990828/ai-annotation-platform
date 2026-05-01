// v0.6.4 · useWorkbenchHotkeys smoke 测试。
//
// 同 AnnotationActions：项目目前不依赖 @testing-library/react，
// 完整 keyboard event 单测留作后续 P2，这里仅做模块导出测试。

import { describe, expect, it } from "vitest";
import { useWorkbenchHotkeys } from "./useWorkbenchHotkeys";

describe("useWorkbenchHotkeys module", () => {
  it("exports the hook", () => {
    expect(typeof useWorkbenchHotkeys).toBe("function");
  });
});
