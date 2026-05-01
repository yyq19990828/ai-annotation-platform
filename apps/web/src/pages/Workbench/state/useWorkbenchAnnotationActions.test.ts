// v0.6.4 · useWorkbenchAnnotationActions smoke 测试。
//
// 现有测试基线没有 @testing-library/react，因此完整 renderHook 单测留作后续 P2。
// 这里只做：模块导出存在 + 类型签名稳定（构造 args 不报 TS 错）。

import { describe, expect, it } from "vitest";
import { useWorkbenchAnnotationActions } from "./useWorkbenchAnnotationActions";

describe("useWorkbenchAnnotationActions module", () => {
  it("exports the hook", () => {
    expect(typeof useWorkbenchAnnotationActions).toBe("function");
  });
});
