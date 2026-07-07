import { describe, expect, it } from "vitest";
import { buildFrameCategories, nextInCategory, nextCategory } from "./frameObjectCycle";

describe("buildFrameCategories", () => {
  it("sorts each category by y↑ then x↑ then id", () => {
    const cats = buildFrameCategories(
      [{ id: "a2", x: 0.5, y: 0.5 }, { id: "a1", x: 0.1, y: 0.1 }],
      [{ id: "u2", x: 0.9, y: 0.2 }, { id: "u1", x: 0.1, y: 0.2 }],
      [],
    );
    expect(cats.ai).toEqual(["a1", "a2"]);
    // 同 y 下按 x 升序
    expect(cats.user).toEqual(["u1", "u2"]);
    expect(cats.track).toEqual([]);
  });

  it("tie-breaks equal x/y deterministically by id", () => {
    const cats = buildFrameCategories(
      [{ id: "b", x: 0.3, y: 0.3 }, { id: "a", x: 0.3, y: 0.3 }],
      [],
      [],
    );
    expect(cats.ai).toEqual(["a", "b"]);
  });
});

const CATS = {
  ai: ["a1", "a2", "a3"],
  user: ["u1", "u2"],
  track: ["t1"],
};

describe("nextInCategory (同类流转)", () => {
  it("cycles within the selected object's category (ring)", () => {
    expect(nextInCategory(CATS, "a1", 1)).toBe("a2");
    expect(nextInCategory(CATS, "a3", 1)).toBe("a1"); // 环回头
    expect(nextInCategory(CATS, "a1", -1)).toBe("a3"); // 反向环
    expect(nextInCategory(CATS, "u1", 1)).toBe("u2");
    expect(nextInCategory(CATS, "u2", 1)).toBe("u1");
  });

  it("stays put for a single-item category", () => {
    expect(nextInCategory(CATS, "t1", 1)).toBe("t1");
  });

  it("falls to first non-empty category's head when nothing selected", () => {
    expect(nextInCategory(CATS, null, 1)).toBe("a1");
    expect(nextInCategory({ ai: [], user: ["u1"], track: [] }, null, 1)).toBe("u1");
  });

  it("returns null when all categories empty", () => {
    expect(nextInCategory({ ai: [], user: [], track: [] }, "x", 1)).toBeNull();
  });
});

describe("nextCategory (跨类跳转)", () => {
  it("jumps to next non-empty category's head (AI→user→track→wrap)", () => {
    expect(nextCategory(CATS, "a2", 1)).toBe("u1");
    expect(nextCategory(CATS, "u1", 1)).toBe("t1");
    expect(nextCategory(CATS, "t1", 1)).toBe("a1"); // 回环
    expect(nextCategory(CATS, "u1", -1)).toBe("a1");
  });

  it("skips empty categories", () => {
    const cats = { ai: ["a1"], user: [], track: ["t1"] };
    expect(nextCategory(cats, "a1", 1)).toBe("t1"); // 跳过空 user
    expect(nextCategory(cats, "t1", 1)).toBe("a1");
  });

  it("lands on first / last non-empty category when nothing selected", () => {
    expect(nextCategory(CATS, null, 1)).toBe("a1");
    expect(nextCategory(CATS, null, -1)).toBe("t1");
  });

  it("returns null when all categories empty", () => {
    expect(nextCategory({ ai: [], user: [], track: [] }, null, 1)).toBeNull();
  });
});
