import { describe, expect, it, vi } from "vitest";
import type { AnnotationResponse } from "@/types";
import { maskRefineBlockReason, promptEmptyRasterMaskChoice } from "./useImageAnnotationActions";

function annotation(
  geometry: AnnotationResponse["geometry"],
  isLocked = false,
): AnnotationResponse {
  return { geometry, is_locked: isLocked } as AnnotationResponse;
}

describe("maskRefineBlockReason", () => {
  it("拒绝 task/annotation 锁定对象", () => {
    const polygon = annotation({
      type: "polygon",
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    });
    expect(maskRefineBlockReason(polygon, true)).toContain("锁定");
    expect(maskRefineBlockReason({ ...polygon, is_locked: true }, false)).toContain("锁定");
  });

  it("拒绝 multi_polygon 与带 holes 的复杂几何", () => {
    const multi = annotation({
      type: "multi_polygon",
      polygons: [
        {
          type: "polygon",
          points: [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
          holes: [],
        },
      ],
    });
    const holes = annotation({
      type: "polygon",
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      holes: [
        [
          [0.2, 0.2],
          [0.3, 0.2],
          [0.2, 0.3],
        ],
      ],
    } as AnnotationResponse["geometry"]);
    expect(maskRefineBlockReason(multi, false)).toContain("复杂几何");
    expect(maskRefineBlockReason(holes, false)).toContain("复杂几何");
  });
});

describe("promptEmptyRasterMaskChoice", () => {
  it("三态选择依次映射删除、撤销和继续编辑", () => {
    expect(promptEmptyRasterMaskChoice(vi.fn(() => true))).toBe("delete");
    expect(
      promptEmptyRasterMaskChoice(vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)),
    ).toBe("undo");
    expect(promptEmptyRasterMaskChoice(vi.fn(() => false))).toBe("continue");
  });
});
