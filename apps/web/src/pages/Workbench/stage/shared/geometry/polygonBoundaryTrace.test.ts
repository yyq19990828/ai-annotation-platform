import { describe, expect, it } from "vitest";
import type { Pt } from "../../polygonGeom";
import {
  appendBoundaryArc,
  boundaryPaths,
  pickBoundary,
  traceRing,
  traceUnsupportedReason,
} from "./polygonBoundaryTrace";

const ring: Pt[] = [
  [0.1, 0.1],
  [0.9, 0.1],
  [0.9, 0.8],
  [0.6, 0.8],
  [0.6, 0.4],
  [0.1, 0.4],
];
const hit = (points: Pt[], point: Pt) => pickBoundary(points, point, 1000, 500)!;

describe("polygon boundary tracing", () => {
  it("preserves concave vertices, directions and screen lengths independently of storage winding", () => {
    const paths = boundaryPaths(ring, hit(ring, [0.5, 0.1]), hit(ring, [0.6, 0.6]), 1000, 500)!;
    expect(paths.clockwise.points).toEqual([
      [0.5, 0.1],
      [0.9, 0.1],
      [0.9, 0.8],
      [0.6, 0.8],
      [0.6, 0.6],
    ]);
    expect(paths.counterclockwise.points).toEqual([
      [0.5, 0.1],
      [0.1, 0.1],
      [0.1, 0.4],
      [0.6, 0.4],
      [0.6, 0.6],
    ]);
    expect(paths.clockwise.length).toBeCloseTo(1150);
    expect(paths.counterclockwise.length).toBeCloseTo(1150);
    const reversed = [...ring].reverse();
    expect(
      boundaryPaths(reversed, hit(reversed, [0.5, 0.1]), hit(reversed, [0.6, 0.6]), 1000, 500),
    ).toEqual(paths);
  });
  it("wraps first/last vertices, canonicalizes vertex snaps and deduplicates the draft join only", () => {
    const closed = traceRing([...ring, ring[0], ring[0]]);
    expect(closed).toEqual(ring);
    const start = hit(closed, [0.102, 0.102]);
    expect(start.position).toBe(0);
    const paths = boundaryPaths(closed, start, hit(closed, [0.1, 0.3]), 1000, 500)!;
    expect(paths.counterclockwise.points).toEqual([
      [0.1, 0.1],
      [0.1, 0.3],
    ]);
    expect(
      appendBoundaryArc(
        [
          [0.8, 0.8],
          [0.1, 0.1],
        ],
        paths.counterclockwise.points,
      ),
    ).toEqual([[0.1, 0.3]]);
    expect(boundaryPaths(closed, start, start, 1000, 500)).toBeNull();
  });
  it("projects onto anisotropic screen segments and gives nearby vertices priority", () => {
    const triangle: Pt[] = [
      [0, 0],
      [1, 1],
      [0, 1],
    ];
    const projected = pickBoundary(triangle, [0.5, 0.52], 1000, 100)!;
    expect(projected.point[0]).toBeCloseTo(0.5001980198, 9);
    expect(projected.point[1]).toBeCloseTo(projected.point[0]);
    expect(pickBoundary(triangle, [0.003, 0.005], 1000, 100)?.position).toBe(0);
    expect(pickBoundary(ring, [0.5, 0.6], 1000, 500)).toBeNull();
  });
  it("rejects holes, multiple exteriors, degeneracy and self intersections without flattening", () => {
    expect(traceUnsupportedReason({ type: "polygon", points: ring })).toBeNull();
    expect(
      traceUnsupportedReason({
        type: "polygon",
        points: ring,
        holes: [
          [
            [0.2, 0.2],
            [0.3, 0.2],
            [0.3, 0.3],
          ],
        ],
      }),
    ).toMatch(/带孔/);
    expect(
      traceUnsupportedReason({
        type: "multi_polygon",
        polygons: [{ type: "polygon", points: ring }],
      }),
    ).toMatch(/多外环/);
    expect(
      traceUnsupportedReason({
        type: "polygon",
        points: [
          [0, 0],
          [0.5, 0],
          [1, 0],
        ],
      }),
    ).toMatch(/退化/);
    expect(
      traceUnsupportedReason({
        type: "polygon",
        points: [
          [0, 0],
          [1, 1],
          [1, 0],
          [0, 1],
        ],
      }),
    ).toMatch(/自相交/);
  });
});
