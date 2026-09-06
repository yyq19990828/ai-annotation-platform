import { describe, expect, it } from "vitest";

import { framePerspectiveBox } from "./viewFraming";

const BASE = {
  boxCenter: [3, 4, 5] as const,
  boxSize: [4, 2, 2] as const,
  cameraPosition: [0, -10, 5] as const,
  cameraTarget: [0, 0, 5] as const,
  fallbackDirection: [0, -2, 1] as const,
  verticalFovDeg: 60,
  aspect: 16 / 9,
  fullFrameFar: 500,
};

describe("framePerspectiveBox", () => {
  it("把 target 移到框中心并保留相机观察方向", () => {
    const framed = framePerspectiveBox(BASE);
    expect(framed.target).toEqual([3, 4, 5]);
    expect(framed.position[0]).toBeCloseTo(3);
    expect(framed.position[1]).toBeLessThan(4);
    expect(framed.position[2]).toBeCloseTo(5);
  });

  it("窄 viewport 由水平 FOV 约束，需要更远距离", () => {
    const wide = framePerspectiveBox({ ...BASE, aspect: 2 });
    const narrow = framePerspectiveBox({ ...BASE, aspect: 0.5 });
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it("默认增加 20% 包围球边距", () => {
    const framed = framePerspectiveBox(BASE);
    const halfFov = (BASE.verticalFovDeg * Math.PI) / 360;
    expect(framed.distance).toBeCloseTo((framed.radius * 1.2) / Math.sin(halfFov));
  });

  it("退化观察方向回退到既有默认方向", () => {
    const framed = framePerspectiveBox({
      ...BASE,
      cameraPosition: [1, 1, 1],
      cameraTarget: [1, 1, 1],
    });
    const offset = framed.position.map((value, index) => value - framed.target[index]);
    expect(offset[0]).toBeCloseTo(0);
    expect(offset[1]).toBeLessThan(0);
    expect(offset[2]).toBeGreaterThan(0);
  });

  it("同步 near/far，且 far 不低于整帧安全范围", () => {
    const framed = framePerspectiveBox({ ...BASE, boxSize: [0.1, 0.1, 0.1] });
    expect(framed.near).toBeGreaterThanOrEqual(0.01);
    expect(framed.near).toBeLessThan(framed.distance - framed.radius);
    expect(framed.far).toBe(500);
  });
});
