import { describe, expect, it } from "vitest";
import type { Annotation, Geometry, PolygonGeometry } from "@/types";
import { polygonSliceUnavailableReason, slicePolygon, sliceSignedArea } from "./polygonSlice";
import { validatePolygonPartition } from "./polygonOps";

const square: PolygonGeometry = {
  type: "polygon",
  points: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.8, 0.8],
    [0.2, 0.8],
  ],
};
const concave: PolygonGeometry = {
  type: "polygon",
  points: [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.9, 0.8],
    [0.6, 0.8],
    [0.6, 0.4],
    [0.1, 0.4],
  ],
};

describe("Polygon Slice partition", () => {
  it("accepts boundary endpoints so a full-image polygon can be sliced", () => {
    const full: PolygonGeometry = {
      type: "polygon",
      points: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    };
    const parts = slicePolygon(full, [
      [0.5, 0],
      [0.5, 1],
    ]);
    expect(validatePolygonPartition(full, parts)).toBe(true);
    expect(Math.abs(sliceSignedArea(parts[0].points))).toBe(0.5);
  });
  it("keeps the larger concave part and preserves the input for either winding", () => {
    const input = structuredClone(concave);
    for (const geometry of [concave, { ...concave, points: [...concave.points].reverse() }]) {
      const parts = slicePolygon(geometry, [
        [0.7, 0],
        [0.7, 1],
      ]);
      expect(validatePolygonPartition(geometry, parts)).toBe(true);
      expect(Math.abs(sliceSignedArea(parts[0].points))).toBeCloseTo(0.22);
      expect(Math.abs(sliceSignedArea(parts[1].points))).toBeCloseTo(0.14);
    }
    expect(concave).toEqual(input);
  });
  it("accepts a bent interior cut and a cut through boundary vertices", () => {
    expect(
      validatePolygonPartition(
        concave,
        slicePolygon(concave, [
          [0, 0.3],
          [0.65, 0.3],
          [0.7, 0.6],
          [1, 0.6],
        ]),
      ),
    ).toBe(true);
    const parts = slicePolygon(square, [
      [0, 0],
      [1, 1],
    ]);
    expect(parts[0].points).toContainEqual([0.2, 0.8]);
    expect(parts[1].points).toContainEqual([0.8, 0.2]);
  });
  it("breaks equal-area ties by centroid independently of cut direction", () => {
    const forward = slicePolygon(square, [
      [0.5, 0],
      [0.5, 1],
    ]);
    const reversed = slicePolygon(square, [
      [0.5, 1],
      [0.5, 0],
    ]);
    for (const parts of [forward, reversed]) {
      expect(parts[0].points.every(([x]) => x <= 0.5)).toBe(true);
      expect(Math.abs(sliceSignedArea(parts[0].points))).toBeCloseTo(0.18);
    }
  });
  it.each([
    [
      [0, 0.2],
      [1, 0.2],
    ],
    [
      [0, 0.4],
      [0.2, 0.2],
      [0, 0],
    ],
    [
      [0.5, 0.5],
      [1, 0.5],
    ],
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ],
    [
      [0, 0.5],
      [1, 0.5],
      [0, 0.5],
    ],
    [
      [0, 0],
      [0, 0],
    ],
    [
      [NaN, 0],
      [1, 1],
    ],
  ] as [number, number][][])(
    "rejects tangent, overlapping, interior, degenerate and self-crossing cuts %j",
    (...points) => {
      expect(() => slicePolygon(square, points)).toThrow();
    },
  );
  it("rejects multiple entries, holes, multipart and a bow-tie source", () => {
    expect(() =>
      slicePolygon(concave, [
        [0, 0.3],
        [1, 0.3],
        [1, 0.6],
        [0, 0.6],
      ]),
    ).toThrow(/两次/);
    const invalid: Geometry[] = [
      {
        ...square,
        holes: [
          [
            [0.3, 0.3],
            [0.4, 0.3],
            [0.3, 0.4],
          ],
        ],
      },
      { type: "multi_polygon", polygons: [square] },
      {
        type: "polygon",
        points: [
          [0.2, 0.2],
          [0.8, 0.8],
          [0.2, 0.8],
          [0.8, 0.2],
        ],
      },
    ];
    for (const geometry of invalid)
      expect(() =>
        slicePolygon(geometry, [
          [0.5, 0],
          [0.5, 1],
        ]),
      ).toThrow();
  });
  it("guards saved versions, locks and active children before a preview session", () => {
    const annotation = { id: "saved", geometry: square, version: 1 } as Annotation;
    expect(polygonSliceUnavailableReason(annotation, [annotation])).toBeNull();
    expect(polygonSliceUnavailableReason({ ...annotation, is_locked: true }, [])).toMatch(/解锁/);
    expect(polygonSliceUnavailableReason({ ...annotation, id: "tmp_1" }, [])).toMatch(/保存/);
    expect(
      polygonSliceUnavailableReason(annotation, [
        { ...annotation, id: "child", parent_annotation_id: annotation.id },
      ]),
    ).toMatch(/子对象/);
  });
});
