import { describe, expect, it } from "vitest";
import {
  analyzeRasterMaskRleAsync,
  executeRasterMaskInstanceOperationAsync,
  executeRasterMaskOperationAsync,
  RasterMaskWorkerCancelledError,
} from "./rasterMaskCompute";

describe("analyzeRasterMaskRleAsync", () => {
  it("测试显式降级保持非正方形的行主序边界", async () => {
    const analysis = await analyzeRasterMaskRleAsync(
      { encoding: "coco_rle", size: [2, 4], counts: [1, 2, 5] },
      { createWorker: null },
    );

    expect(analysis.sourceWidth).toBe(4);
    expect(analysis.sourceHeight).toBe(2);
    expect(analysis.area).toBe(2);
    expect(analysis.bounds).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });
});

describe("executeRasterMaskInstanceOperationAsync", () => {
  it("同步测试路径生成 split plan 并保留隔离上下文", async () => {
    const result = await executeRasterMaskInstanceOperationAsync(
      { encoding: "coco_rle", size: [1, 5], counts: [0, 1, 2, 2] },
      { type: "split_components", keep: "largest", connectivity: 4 },
      { sessionId: "task-a|frame-3", generation: 7, operationId: 11 },
      { createWorker: null },
    );

    expect(result.context).toEqual({
      sessionId: "task-a|frame-3",
      generation: 7,
      operationId: 11,
    });
    expect(result.plan?.sourceAreas).toEqual([3]);
    expect(result.plan?.resultAreas).toEqual([2, 1]);
  });
});

describe("executeRasterMaskOperationAsync", () => {
  it("显式同步测试路径保留 session / generation / operation 上下文", async () => {
    const result = await executeRasterMaskOperationAsync(
      { encoding: "coco_rle", size: [3, 5], counts: [7, 1, 7] },
      { type: "morphology", operation: "dilate", kernelShape: "disk", radius: 1 },
      { sessionId: "task-a|frame-2", generation: 4, operationId: 9 },
      { createWorker: null },
    );

    expect(result.context).toEqual({
      sessionId: "task-a|frame-2",
      generation: 4,
      operationId: 9,
    });
    expect(result.result.report.beforeArea).toBe(1);
    expect(result.result.report.afterArea).toBe(5);
  });

  it("AbortSignal 会终止 Worker，且不返回半成品", async () => {
    let terminated = false;
    const worker = {
      onmessage: null,
      onerror: null,
      postMessage: () => undefined,
      terminate: () => { terminated = true; },
    } as unknown as Worker;
    const controller = new AbortController();
    const pending = executeRasterMaskOperationAsync(
      { encoding: "coco_rle", size: [1, 1], counts: [1] },
      { type: "morphology", operation: "dilate", kernelShape: "square", radius: 1 },
      { sessionId: "s", generation: 1, operationId: 1 },
      { createWorker: () => worker, signal: controller.signal },
    );
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(RasterMaskWorkerCancelledError);
    expect(terminated).toBe(true);
  });
});
