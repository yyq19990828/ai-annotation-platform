// v0.16.x 第 2 批 · useWorkbenchShellModel 纯函数测试守护(伴随逻辑提炼,锁定坐标公式行为)。
import { describe, it, expect } from "vitest";
import {
  commitAfterNavigationGuard,
  resolveMaskEditorSize,
  resolvePinViewport,
  resolveSamCandidateClass,
  samCandidateDisplayShapes,
  samCandidateGeom,
} from "../useWorkbenchShellModel.helpers";

describe("commitAfterNavigationGuard", () => {
  it("快速导航时不允许较旧 guard 的迟到结果提交切题", async () => {
    const firstController = new AbortController();
    let releaseFirst: ((allowed: boolean) => void) | undefined;
    const firstGuard = () => new Promise<boolean>((resolve) => { releaseFirst = resolve; });
    const commits: string[] = [];
    const first = commitAfterNavigationGuard(
      firstGuard,
      firstController.signal,
      () => commits.push("first"),
    );
    firstController.abort();
    const second = commitAfterNavigationGuard(
      async () => true,
      undefined,
      () => commits.push("second"),
    );
    await expect(second).resolves.toBe(true);
    releaseFirst?.(true);
    await expect(first).resolves.toBe(false);
    expect(commits).toEqual(["second"]);
  });
});

describe("resolveMaskEditorSize", () => {
  it("视频任务使用 manifest 的固有尺寸而不是未初始化的图片舞台尺寸", () => {
    expect(resolveMaskEditorSize(
      true,
      { imgW: 0, imgH: 0 },
      { width: 1920, height: 1080 },
    )).toEqual({ width: 1920, height: 1080 });
  });

  it("图片任务继续使用图片舞台尺寸", () => {
    expect(resolveMaskEditorSize(
      false,
      { imgW: 640, imgH: 480 },
      { width: 1920, height: 1080 },
    )).toEqual({ width: 640, height: 480 });
  });
});

describe("resolvePinViewport", () => {
  it("把归一 anchor 对应像素点平移到视口中心,保留 scale", () => {
    const out = resolvePinViewport(
      { scale: 2, tx: 0, ty: 0 },
      { x: 0.5, y: 0.5 },
      100,
      200,
      { w: 800, h: 600 },
    );
    // tx = 800/2 - 0.5*100*2 = 300 ; ty = 600/2 - 0.5*200*2 = 100
    expect(out).toEqual({ scale: 2, tx: 300, ty: 100 });
  });

  it("anchor 在原点时只居中,保留其它视口字段", () => {
    const out = resolvePinViewport(
      { scale: 1, tx: 5, ty: 7 },
      { x: 0, y: 0 },
      100,
      100,
      { w: 400, h: 400 },
    );
    expect(out).toEqual({ scale: 1, tx: 200, ty: 200 });
  });
});

describe("native Mask candidate presentation", () => {
  it("never reuses an active class from another tool unit", () => {
    expect(resolveSamCandidateClass("object", ["road", "sky"], "car")).toBe("road");
    expect(resolveSamCandidateClass("sky", ["road", "sky"], "car")).toBe("sky");
    expect(resolveSamCandidateClass(undefined, ["road", "sky"], "road")).toBe("road");
  });

  it("represents every RLE candidate immediately with its polygon preview", () => {
    const candidates = [
      {
        id: "mask-a",
        type: "mask" as const,
        rle: { encoding: "coco_rle" as const, size: [2, 3] as [number, number], counts: [1, 2, 3] },
        previewPoints: [[0, 0], [2 / 3, 0], [2 / 3, 1], [0, 1]] as [number, number][],
      },
      {
        id: "mask-b",
        type: "mask" as const,
        rle: { encoding: "coco_rle" as const, size: [2, 3] as [number, number], counts: [5, 1] },
        previewPoints: [
          [2 / 3, 0.5],
          [1, 0.5],
          [1, 1],
          [2 / 3, 1],
        ] as [number, number][],
      },
    ];

    expect(samCandidateDisplayShapes(candidates)).toEqual([
      {
        id: "mask-a",
        type: "polygonlabels",
        points: candidates[0].previewPoints,
      },
      {
        id: "mask-b",
        type: "polygonlabels",
        points: candidates[1].previewPoints,
      },
    ]);
    const bounds = samCandidateGeom(candidates[1]);
    expect(bounds).not.toBeNull();
    expect(bounds?.x).toBeCloseTo(2 / 3);
    expect(bounds?.y).toBeCloseTo(0.5);
    expect(bounds?.w).toBeCloseTo(1 / 3);
    expect(bounds?.h).toBeCloseTo(0.5);
    expect(samCandidateDisplayShapes(Array.from(
      { length: 45 },
      (_, index) => ({ ...candidates[1], id: `mask-${index}` }),
    )).map((shape) => shape.id)).toEqual([
      ...Array.from({ length: 45 }, (_, index) => `mask-${index}`),
    ]);
  });

  it("does not synchronously scan legacy RLEs while building the full display list", () => {
    expect(samCandidateDisplayShapes([{
      id: "legacy-mask",
      type: "mask",
      rle: { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 3] },
    }])).toEqual([]);
  });
});
