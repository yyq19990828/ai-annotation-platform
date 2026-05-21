import { describe, expect, it } from "vitest";
import {
  deriveSamplingStep,
  gridNext,
  gridPrev,
  microStep,
  snapToGrid,
} from "./videoSamplingGrid";

describe("deriveSamplingStep", () => {
  it("defaults to 1 for nullish / none / empty config", () => {
    expect(deriveSamplingStep(undefined, 30)).toBe(1);
    expect(deriveSamplingStep(null, 30)).toBe(1);
    expect(deriveSamplingStep({ mode: "none" }, 30)).toBe(1);
    expect(deriveSamplingStep({}, 30)).toBe(1);
  });

  it("mode=step uses frame_step", () => {
    expect(deriveSamplingStep({ mode: "step", frame_step: 5 }, 30)).toBe(5);
    expect(deriveSamplingStep({ mode: "step", frame_step: 1 }, 30)).toBe(1);
  });

  it("mode=step falls back to 1 when frame_step missing / invalid", () => {
    expect(deriveSamplingStep({ mode: "step" }, 30)).toBe(1);
    expect(deriveSamplingStep({ mode: "step", frame_step: null }, 30)).toBe(1);
    expect(deriveSamplingStep({ mode: "step", frame_step: 0 }, 30)).toBe(1);
  });

  it("mode=fps derives round(sourceFps/target_fps), min 1", () => {
    expect(deriveSamplingStep({ mode: "fps", target_fps: 5 }, 60)).toBe(12);
    expect(deriveSamplingStep({ mode: "fps", target_fps: 10 }, 30)).toBe(3);
    // target >= source → clamps to 1
    expect(deriveSamplingStep({ mode: "fps", target_fps: 60 }, 30)).toBe(1);
  });

  it("mode=fps non-integer ratio 60→25 rounds to nearest (step=2)", () => {
    expect(deriveSamplingStep({ mode: "fps", target_fps: 25 }, 60)).toBe(2);
  });

  it("mode=fps falls back to 1 when target / source invalid", () => {
    expect(deriveSamplingStep({ mode: "fps" }, 30)).toBe(1);
    expect(deriveSamplingStep({ mode: "fps", target_fps: null }, 30)).toBe(1);
    expect(deriveSamplingStep({ mode: "fps", target_fps: 10 }, 0)).toBe(1);
  });
});

describe("grid navigation step=1 (degenerate, backward compat)", () => {
  const max = 9;
  it("gridNext ≡ +1 clamped at max", () => {
    expect(gridNext(0, 1, max)).toBe(1);
    expect(gridNext(5, 1, max)).toBe(6);
    expect(gridNext(9, 1, max)).toBe(9);
  });
  it("gridPrev ≡ -1 clamped at 0", () => {
    expect(gridPrev(5, 1, max)).toBe(4);
    expect(gridPrev(0, 1, max)).toBe(0);
  });
  it("snapToGrid is identity", () => {
    expect(snapToGrid(0, 1, max)).toBe(0);
    expect(snapToGrid(7, 1, max)).toBe(7);
    expect(snapToGrid(9, 1, max)).toBe(9);
  });
});

describe("grid navigation step=5 (e.g. 5fps from 25fps)", () => {
  const step = 5;
  const max = 100;

  it("gridNext jumps to next strict-greater grid point", () => {
    expect(gridNext(0, step, max)).toBe(5);
    expect(gridNext(5, step, max)).toBe(10);
    expect(gridNext(37, step, max)).toBe(40);
  });

  it("gridPrev jumps to previous strict-smaller grid point", () => {
    expect(gridPrev(5, step, max)).toBe(0);
    expect(gridPrev(10, step, max)).toBe(5);
    expect(gridPrev(37, step, max)).toBe(35);
  });

  it("off-grid frame f=3 navigates correctly", () => {
    expect(gridNext(3, step, max)).toBe(5);
    expect(gridPrev(3, step, max)).toBe(0);
    expect(snapToGrid(3, step, max)).toBe(5); // round(3/5)=1 → 5
  });

  it("off-grid frame f=2 snaps down", () => {
    expect(snapToGrid(2, step, max)).toBe(0); // round(2/5)=0
  });

  it("snapToGrid rounds to nearest grid point", () => {
    expect(snapToGrid(7, step, max)).toBe(5);
    expect(snapToGrid(8, step, max)).toBe(10);
    expect(snapToGrid(37, step, max)).toBe(35);
    expect(snapToGrid(38, step, max)).toBe(40);
  });

  it("microStep moves ±1 source frame", () => {
    expect(microStep(5, 1, max)).toBe(6);
    expect(microStep(5, -1, max)).toBe(4);
    expect(microStep(37, 1, max)).toBe(38);
  });
});

describe("grid navigation boundaries", () => {
  const step = 5;
  it("gridNext clamps to maxFrame at the tail", () => {
    expect(gridNext(98, step, 99)).toBe(99); // ceil(99/5)*5=100 → clamp 99
    expect(gridNext(99, step, 99)).toBe(99);
  });
  it("gridPrev clamps to 0 at the head", () => {
    expect(gridPrev(0, step, 99)).toBe(0);
    expect(gridPrev(1, step, 99)).toBe(0);
  });
  it("snapToGrid clamps both ends", () => {
    expect(snapToGrid(0, step, 99)).toBe(0);
    expect(snapToGrid(99, step, 99)).toBe(99); // round(99/5)*5=100 → clamp 99
  });
  it("microStep clamps both ends", () => {
    expect(microStep(0, -1, 99)).toBe(0);
    expect(microStep(99, 1, 99)).toBe(99);
  });
});
