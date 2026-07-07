import { describe, expect, it } from "vitest";
import { draftCanCommit, draftMinPoints } from "./useVideoPolygonDraft";

describe("useVideoPolygonDraft helpers", () => {
  it("draftMinPoints: polygon(闭合)=3, polyline(开)=2", () => {
    expect(draftMinPoints(true)).toBe(3);
    expect(draftMinPoints(false)).toBe(2);
  });

  it("draftCanCommit: polygon 需 ≥3 点", () => {
    expect(draftCanCommit(null)).toBe(false);
    expect(draftCanCommit({ closed: true, points: [[0, 0], [1, 0]] })).toBe(false);
    expect(draftCanCommit({ closed: true, points: [[0, 0], [1, 0], [1, 1]] })).toBe(true);
  });

  it("draftCanCommit: polyline 需 ≥2 点", () => {
    expect(draftCanCommit({ closed: false, points: [[0, 0]] })).toBe(false);
    expect(draftCanCommit({ closed: false, points: [[0, 0], [1, 0]] })).toBe(true);
  });
});
