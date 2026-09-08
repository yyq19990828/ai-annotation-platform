import { describe, expect, it } from "vitest";
import { createPolygonSampler } from "./polygonAutoPoints";
import type { Pt } from "./polygonGeom";

function sample(width: number, height: number, inputs: Pt[]) {
  const result: Pt[] = [];
  const sampler = createPolygonSampler([0, 0], width, height);
  for (const point of inputs)
    sampler.sample(point, (p) => {
      result.push(p);
      return true;
    });
  return result.map(([x, y]) => [x * width, y * height]);
}

describe("Polygon screen distance resampling", () => {
  it("emits multiple points per event and carries distance across short events", () => {
    const sparse = sample(1000, 500, [[0.1, 0]]);
    const dense = sample(
      1000,
      500,
      Array.from({ length: 100 }, (_, i) => [(i + 1) / 1000, 0]),
    );
    expect(sparse).toHaveLength(12);
    sparse.forEach(([x, y], i) => {
      expect(x).toBeCloseTo((i + 1) * 8);
      expect(y).toBe(0);
    });
    dense.forEach((point, i) => expect(point[0]).toBeCloseTo(sparse[i][0]));
    expect(dense).toHaveLength(sparse.length);
  });
  it("keeps CSS spacing across zoom levels and a corner", () => {
    for (const scale of [0.5, 1, 4]) {
      expect(
        sample(1000 * scale, 500 * scale, [
          [0.012 / scale, 0],
          [0.012 / scale, 0.04 / scale],
        ]),
      ).toEqual([
        [8, 0],
        [12, 4],
        [12, 12],
        [12, 20],
      ]);
    }
  });
  it("ignores repeated positions and stops promptly when the consumer reaches its budget", () => {
    expect(
      sample(100, 100, [
        [0, 0],
        [0, 0],
      ]),
    ).toEqual([]);
    const sampler = createPolygonSampler([0, 0], 1e12, 1e12);
    let count = 0;
    sampler.sample([1, 0], () => ++count < 3);
    expect(count).toBe(3);
  });
});
