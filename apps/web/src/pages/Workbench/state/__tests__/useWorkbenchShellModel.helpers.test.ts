// v0.16.x 第 2 批 · useWorkbenchShellModel 纯函数测试守护(伴随逻辑提炼,锁定坐标公式行为)。
import { describe, it, expect, vi } from "vitest";
import {
  LatestTaskNavigationScheduler,
  annotationsForTask,
  commitAfterNavigationGuard,
  resolveMaskEditorSize,
  resolvePinViewport,
  resolveSamCandidateClass,
  samCandidateDisplayShapes,
  samCandidateGeom,
  shouldShowInManualAnnotationSection,
  videoAnnotationQueriesEnabled,
} from "../useWorkbenchShellModel.helpers";
import { resolveLocalTaskUrlSync } from "../useWorkbenchShellModel";

describe("resolveLocalTaskUrlSync", () => {
  it("本地目标尚未写入 URL 时不允许旧 requestedTaskId 回退当前任务", () => {
    expect(resolveLocalTaskUrlSync("task-old", "task-new")).toEqual({
      holdRequestedTask: true,
      clearPendingTarget: false,
    });
  });

  it("URL 追上本地目标后解除保护，之后恢复外部 URL 同步", () => {
    expect(resolveLocalTaskUrlSync("task-new", "task-new")).toEqual({
      holdRequestedTask: false,
      clearPendingTarget: true,
    });
    expect(resolveLocalTaskUrlSync("task-external", null)).toEqual({
      holdRequestedTask: false,
      clearPendingTarget: false,
    });
  });
});

describe("annotationsForTask", () => {
  it("切题时不渲染上一题的迟到标注缓存", () => {
    const annotations = [
      { id: "old", task_id: "task-1" },
      { id: "current", task_id: "task-2" },
    ];

    expect(annotationsForTask(annotations, "task-2")).toEqual([
      { id: "current", task_id: "task-2" },
    ]);
    expect(annotationsForTask(annotations, undefined)).toEqual([]);
    expect(annotationsForTask(undefined, "task-2")).toBeUndefined();
  });
});

describe("commitAfterNavigationGuard", () => {
  it("快速导航时不允许较旧 guard 的迟到结果提交切题", async () => {
    const firstController = new AbortController();
    let releaseFirst: ((allowed: boolean) => void) | undefined;
    const firstGuard = () =>
      new Promise<boolean>((resolve) => {
        releaseFirst = resolve;
      });
    const commits: string[] = [];
    const first = commitAfterNavigationGuard(firstGuard, firstController.signal, () =>
      commits.push("first"),
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

describe("LatestTaskNavigationScheduler", () => {
  it("立即提交首次导航，并把 100ms 连续输入合并成最终目标", async () => {
    vi.useFakeTimers();
    const scheduler = new LatestTaskNavigationScheduler(160);
    const committed: string[] = [];

    try {
      const first = scheduler.schedule("task-1", async () => {
        committed.push("task-1");
        return true;
      });
      await vi.advanceTimersByTimeAsync(0);

      const second = scheduler.schedule("task-2", async () => {
        committed.push("task-2");
        return true;
      });
      await vi.advanceTimersByTimeAsync(100);
      const latest = scheduler.schedule("task-3", async () => {
        committed.push("task-3");
        return true;
      });
      await vi.advanceTimersByTimeAsync(159);

      expect(committed).toEqual(["task-1"]);
      await vi.advanceTimersByTimeAsync(1);
      await expect(Promise.all([first, second, latest])).resolves.toEqual([true, false, true]);
      expect(committed).toEqual(["task-1", "task-3"]);
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });

  it("新目标会中止仍在等待 guard 的旧导航", async () => {
    vi.useFakeTimers();
    const scheduler = new LatestTaskNavigationScheduler(160);
    const observedSignals: AbortSignal[] = [];

    try {
      const first = scheduler.schedule("task-1", async (signal) => {
        observedSignals.push(signal);
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
        return !signal.aborted;
      });
      await vi.advanceTimersByTimeAsync(0);
      const latest = scheduler.schedule("task-2", async () => true);
      await vi.advanceTimersByTimeAsync(160);

      expect(observedSignals[0]).toBeInstanceOf(AbortSignal);
      expect(observedSignals[0]?.aborted).toBe(true);
      await expect(first).resolves.toBe(false);
      await expect(latest).resolves.toBe(true);
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });

  it("旧 guard 未结束时不会并发打开第二个 guard", async () => {
    vi.useFakeTimers();
    const scheduler = new LatestTaskNavigationScheduler(160);
    let finishFirst!: (allowed: boolean) => void;
    const secondRun = vi.fn().mockResolvedValue(true);

    try {
      const first = scheduler.schedule(
        "task-1",
        () =>
          new Promise<boolean>((resolve) => {
            finishFirst = resolve;
          }),
      );
      await vi.advanceTimersByTimeAsync(0);
      const second = scheduler.schedule("task-2", secondRun);
      await vi.advanceTimersByTimeAsync(160);

      expect(secondRun).not.toHaveBeenCalled();
      finishFirst(true);
      await vi.advanceTimersByTimeAsync(0);

      await expect(first).resolves.toBe(false);
      await expect(second).resolves.toBe(true);
      expect(secondRun).toHaveBeenCalledOnce();
    } finally {
      scheduler.dispose();
      vi.useRealTimers();
    }
  });
});

describe("videoAnnotationQueriesEnabled", () => {
  it("等待视频协同配置并在协同模式下要求当前 segment", () => {
    expect(videoAnnotationQueriesEnabled(true, false, false, null)).toBe(false);
    expect(videoAnnotationQueriesEnabled(true, true, true, null)).toBe(false);
    expect(videoAnnotationQueriesEnabled(true, true, true, "segment-1")).toBe(true);
    expect(videoAnnotationQueriesEnabled(true, true, false, null)).toBe(true);
    expect(videoAnnotationQueriesEnabled(false, false, false, null)).toBe(true);
  });
});

describe("resolveMaskEditorSize", () => {
  it("视频任务使用 manifest 的固有尺寸而不是未初始化的图片舞台尺寸", () => {
    expect(
      resolveMaskEditorSize(true, { imgW: 0, imgH: 0 }, { width: 1920, height: 1080 }),
    ).toEqual({ width: 1920, height: 1080 });
  });

  it("图片任务继续使用图片舞台尺寸", () => {
    expect(
      resolveMaskEditorSize(false, { imgW: 640, imgH: 480 }, { width: 1920, height: 1080 }),
    ).toEqual({ width: 640, height: 480 });
  });
});

describe("shouldShowInManualAnnotationSection", () => {
  it("视频轨迹型矩形框与 Mask 只进入各自轨迹分组", () => {
    expect(
      shouldShowInManualAnnotationSection({ geometry: { type: "video_track_bbox" } }, true),
    ).toBe(false);
    expect(
      shouldShowInManualAnnotationSection({ geometry: { type: "video_track_mask" } }, true),
    ).toBe(false);
  });

  it("保留视频单帧几何和图片 Mask 的人工分组归属", () => {
    expect(shouldShowInManualAnnotationSection({ geometry: { type: "video_bbox" } }, true)).toBe(
      true,
    );
    expect(shouldShowInManualAnnotationSection({ geometry: { type: "video_mask" } }, true)).toBe(
      true,
    );
    expect(shouldShowInManualAnnotationSection({ geometry: { type: "raster_mask" } }, false)).toBe(
      true,
    );
  });
});

describe("resolvePinViewport", () => {
  it("把归一 anchor 对应像素点平移到视口中心,保留 scale", () => {
    const out = resolvePinViewport({ scale: 2, tx: 0, ty: 0 }, { x: 0.5, y: 0.5 }, 100, 200, {
      w: 800,
      h: 600,
    });
    // tx = 800/2 - 0.5*100*2 = 300 ; ty = 600/2 - 0.5*200*2 = 100
    expect(out).toEqual({ scale: 2, tx: 300, ty: 100 });
  });

  it("anchor 在原点时只居中,保留其它视口字段", () => {
    const out = resolvePinViewport({ scale: 1, tx: 5, ty: 7 }, { x: 0, y: 0 }, 100, 100, {
      w: 400,
      h: 400,
    });
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
        previewPoints: [
          [0, 0],
          [2 / 3, 0],
          [2 / 3, 1],
          [0, 1],
        ] as [number, number][],
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
    expect(
      samCandidateDisplayShapes(
        Array.from({ length: 45 }, (_, index) => ({ ...candidates[1], id: `mask-${index}` })),
      ).map((shape) => shape.id),
    ).toEqual([...Array.from({ length: 45 }, (_, index) => `mask-${index}`)]);
  });

  it("does not synchronously scan legacy RLEs while building the full display list", () => {
    expect(
      samCandidateDisplayShapes([
        {
          id: "legacy-mask",
          type: "mask",
          rle: { encoding: "coco_rle", size: [2, 3], counts: [1, 2, 3] },
        },
      ]),
    ).toEqual([]);
  });
});
