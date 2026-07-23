import { describe, expect, it } from "vitest";
import {
  planMaskComponentCopy,
  planMaskComponentSplit,
  planMaskJoin,
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
