import { describe, expect, it } from "vitest";
import {
  planMaskComponentCopy,
  planMaskComponentSplit,
  planMaskJoin,
  planMaskSlice,
  type MaskSlicePath,
} from "./maskInstanceOperations";

function alpha(rows: number[][]): Uint8Array {
  return Uint8Array.from(rows.flat().map((value) => (value ? 255 : 0)));
}

function rows(value: Uint8Array, width: number): number[][] {
  const result: number[][] = [];
  for (let offset = 0; offset < value.length; offset += width) {
    result.push([...value.slice(offset, offset + width)].map((pixel) => (pixel ? 1 : 0)));
  }
  return result;
}

describe("Mask instance operation plans", () => {
  it("slice preserves all pixels of holed and disconnected non-square sources", () => {
    const source = alpha([
      [1, 1, 1, 0, 1],
      [1, 0, 1, 0, 1],
      [1, 1, 1, 0, 0],
    ]);
    const original = source.slice();
    const plan = planMaskSlice(source, 5, 3, [
      [0.5, 0],
      [0.5, 1],
    ]);
    expect(plan.sourceAreas).toEqual([10]);
    expect(plan.resultAreas).toEqual([8, 2]);
    for (let i = 0; i < source.length; i += 1) {
      expect(plan.primary[i] && plan.created[0][i]).toBe(0);
      expect(plan.primary[i] || plan.created[0][i]).toBe(source[i]);
    }
    expect(source).toEqual(original);
  });

  it("slice sends center ties to the directed left and reverses equal-area identity", () => {
    const source = alpha([
      [1, 1, 1],
      [1, 1, 1],
    ]);
    const forward = planMaskSlice(source, 3, 2, [
      [0, 0.5],
      [1, 0.5],
    ]);
    const reverse = planMaskSlice(source, 3, 2, [
      [1, 0.5],
      [0, 0.5],
    ]);
    expect(forward.resultAreas).toEqual([3, 3]);
    expect(rows(forward.primary, 3)).toEqual([
      [0, 0, 0],
      [1, 1, 1],
    ]);
    expect(reverse.primary).toEqual(forward.created[0]);
    const centers = planMaskSlice(source, 3, 2, [
      [0.5, 0],
      [0.5, 1],
    ]);
    expect(rows(centers.primary, 3)).toEqual([
      [1, 1, 0],
      [1, 1, 0],
    ]);
    const reversedCenters = planMaskSlice(source, 3, 2, [
      [0.5, 1],
      [0.5, 0],
    ]);
    expect(rows(reversedCenters.primary, 3)).toEqual([
      [0, 1, 1],
      [0, 1, 1],
    ]);
  });

  it.each<MaskSlicePath>([
    [
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [0, 1],
    ],
    [
      [0, 0],
      [Infinity, 1],
    ],
    [
      [0, 0],
      [2, 1],
    ],
  ])("rejects degenerate or empty slice %j", (start, end) => {
    expect(() => planMaskSlice(alpha([[1, 1, 1]]), 3, 1, [start, end])).toThrow();
  });
  it("copy component keeps the source and creates only the hit component", () => {
    const source = alpha([
      [1, 1, 0, 0],
      [1, 1, 0, 1],
    ]);
    const plan = planMaskComponentCopy(source, 4, 2, { x: 3, y: 1, connectivity: 4 });

    expect(plan?.kind).toBe("copy_component");
    expect(plan?.sourceAreas).toEqual([5]);
    expect(plan?.resultAreas).toEqual([5, 1]);
    expect(rows(plan!.primary, 4)).toEqual(rows(source, 4));
    expect(rows(plan!.created[0], 4)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ]);
  });

  it("split deterministically keeps the largest component and partitions every pixel", () => {
    const source = alpha([
      [1, 0, 0, 1, 1],
      [0, 0, 0, 1, 1],
      [0, 1, 0, 0, 0],
    ]);
    const plan = planMaskComponentSplit(source, 5, 3, { keep: "largest", connectivity: 4 });

    expect(plan?.resultCount).toBe(3);
    expect(plan?.resultAreas).toEqual([4, 1, 1]);
    expect(plan?.resultAreas.reduce((sum, value) => sum + value, 0)).toBe(6);
    expect(plan?.created).toHaveLength(2);
    expect([...source]).toEqual([
      ...alpha([
        [1, 0, 0, 1, 1],
        [0, 0, 0, 1, 1],
        [0, 1, 0, 0, 0],
      ]),
    ]);
  });

  it("split hit uses membership and returns null when the point is background", () => {
    const source = alpha([
      [1, 1, 1],
      [1, 0, 1],
      [1, 1, 1],
    ]);
    expect(
      planMaskComponentSplit(source, 3, 3, {
        keep: "hit",
        x: 1,
        y: 1,
        connectivity: 4,
      }),
    ).toBeNull();
    expect(
      planMaskComponentSplit(alpha([[1, 1, 1]]), 3, 1, {
        keep: "largest",
        connectivity: 4,
      }),
    ).toBeNull();
  });

  it("join unions overlapping sources without double-counting pixels", () => {
    const first = alpha([[1, 1, 0, 0]]);
    const second = alpha([[0, 1, 1, 0]]);
    const plan = planMaskJoin([first, second], 4, 1);

    expect(plan.sourceAreas).toEqual([2, 2]);
    expect(plan.resultAreas).toEqual([3]);
    expect(rows(plan.primary, 4)).toEqual([[1, 1, 1, 0]]);
    expect([...first]).toEqual([255, 255, 0, 0]);
    expect([...second]).toEqual([0, 255, 255, 0]);
  });
});
