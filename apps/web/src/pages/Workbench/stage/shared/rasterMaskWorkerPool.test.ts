import { describe, expect, it } from "vitest";
import type { RasterMaskWorkerRequest, RasterMaskWorkerResponse } from "./rasterMaskWorkerProtocol";
import {
  RasterMaskWorkerCancelledError,
  RasterMaskWorkerError,
  RasterMaskWorkerPool,
  RasterMaskWorkerQueueFullError,
  RasterMaskWorkerTimeoutError,
  type RasterMaskWorkerClock,
} from "./rasterMaskWorkerPool";

function zeroRle(width: number, height = 1) {
  return {
    encoding: "coco_rle" as const,
    size: [height, width] as [number, number],
    counts: [width * height],
  };
}

class FakeWorker {
  onmessage: ((event: MessageEvent<RasterMaskWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: Array<{ request: RasterMaskWorkerRequest; transfer: Transferable[] }> = [];
  terminateCalls = 0;

  constructor(private readonly autoAnalyze = false) {}

  postMessage(request: RasterMaskWorkerRequest, transfer: Transferable[] = []) {
    this.messages.push({ request, transfer });
    if (this.autoAnalyze && request.kind === "analyze") {
      queueMicrotask(() => this.respondAnalyze(request.id));
    }
  }

  terminate() {
    this.terminateCalls += 1;
  }

  jobRequests() {
    return this.messages.map((entry) => entry.request).filter((request) => "id" in request);
  }

  respondAnalyze(id: number) {
    const request = this.jobRequests().find((candidate) => candidate.id === id);
    if (!request || request.kind !== "analyze") throw new Error(`analyze request ${id} not found`);
    const [height, width] = request.rle.size;
    this.onmessage?.({
      data: {
        kind: "analyze",
        id,
        ok: true,
        analysis: {
          sourceWidth: width,
          sourceHeight: height,
          area: 0,
          componentCount: 0,
          holeCount: 0,
          boundaryPixelCount: 0,
          bounds: { x: 0, y: 0, w: 0, h: 0 },
          crop: { x: 0, y: 0, width: 0, height: 0, alpha: new Uint8Array() },
        },
      },
    } as MessageEvent<RasterMaskWorkerResponse>);
  }

  respondTile(id: number, alpha: Uint8Array) {
    const request = this.jobRequests().find((candidate) => candidate.id === id);
    if (!request || request.kind !== "tile_decode") throw new Error(`tile request ${id} not found`);
    this.onmessage?.({
      data: {
        kind: "tile_decode",
        id,
        ok: true,
        sessionId: request.sessionId,
        sha256: request.sha256,
        rect: request.rect,
        alpha,
      },
    } as MessageEvent<RasterMaskWorkerResponse>);
  }

  respondCompare(id: number, codes: Uint8Array) {
    const request = this.jobRequests().find((candidate) => candidate.id === id);
    if (!request || request.kind !== "compare_tile")
      throw new Error(`compare request ${id} not found`);
    this.onmessage?.({
      data: {
        kind: "compare_tile",
        id,
        ok: true,
        current: request.current,
        baseline: request.baseline,
        rect: request.rect,
        mode: request.mode,
        sampleStep: request.sampleStep,
        codes,
      },
    } as MessageEvent<RasterMaskWorkerResponse>);
  }

  respondCompareMetrics(id: number) {
    const request = this.jobRequests().find((candidate) => candidate.id === id);
    if (!request || request.kind !== "compare_metrics")
      throw new Error(`metrics request ${id} not found`);
    this.onmessage?.({
      data: {
        kind: "compare_metrics",
        id,
        ok: true,
        current: request.current,
        baseline: request.baseline,
        metrics: {
          currentAreaPixels: 2,
          baselineAreaPixels: 1,
          intersectionPixels: 1,
          unionPixels: 2,
          changedPixels: 1,
          addedPixels: 1,
          removedPixels: 0,
        },
      },
    } as MessageEvent<RasterMaskWorkerResponse>);
  }

  respond(response: RasterMaskWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<RasterMaskWorkerResponse>);
  }

  crash(message = "boom") {
    this.onerror?.({ message } as ErrorEvent);
  }
}

class FakeClock implements RasterMaskWorkerClock {
  private nextId = 0;
  private readonly callbacks = new Map<number, () => void>();

  setTimeout(callback: () => void): number {
    const id = ++this.nextId;
    this.callbacks.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.callbacks.delete(handle as number);
  }

  runNext(): void {
    const first = this.callbacks.entries().next().value as [number, () => void] | undefined;
    if (!first) throw new Error("no timer scheduled");
    this.callbacks.delete(first[0]);
    first[1]();
  }
}

describe("RasterMaskWorkerPool", () => {
  it("reuses a fixed worker set and transfers typed RLE inputs", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RasterMaskWorkerPool({
      size: 2,
      createWorker: () => {
        const worker = new FakeWorker(true);
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const input = zeroRle(3);

    await Promise.all(Array.from({ length: 20 }, () => pool.analyze(input)));

    expect(workers).toHaveLength(2);
    const first = workers
      .flatMap((worker) => worker.messages)
      .find((entry) => entry.request.kind === "analyze");
    expect(first?.request.kind).toBe("analyze");
    if (!first || first.request.kind !== "analyze") throw new Error("missing analyze request");
    expect(first.request.rle.counts).toBeInstanceOf(Uint32Array);
    expect(first.transfer).toEqual([first.request.rle.counts.buffer]);
    expect(input.counts).toEqual([3]);
    expect(pool.getSnapshot()).toMatchObject({
      liveWorkers: 2,
      queued: 0,
      running: 0,
      workersCreated: 2,
      completed: 20,
    });

    pool.dispose();
    expect(workers.map((worker) => worker.terminateCalls)).toEqual([1, 1]);
  });

  it("orders editing ahead of prefetch without preempting the running job", async () => {
    const worker = new FakeWorker();
    const pool = new RasterMaskWorkerPool({
      size: 1,
      createWorker: () => worker as unknown as Worker,
    });
    const current = pool.analyze(zeroRle(1), { priority: "current" });
    const prefetch = pool.analyze(zeroRle(2), { priority: "prefetch" });
    const editing = pool.analyze(zeroRle(3), { priority: "editing" });

    const first = worker.jobRequests()[0];
    if (!first || first.kind !== "analyze") throw new Error("missing first request");
    expect(first.rle.size).toEqual([1, 1]);
    worker.respondAnalyze(first.id);
    const second = worker.jobRequests()[1];
    if (!second || second.kind !== "analyze") throw new Error("missing second request");
    expect(second.rle.size).toEqual([1, 3]);
    worker.respondAnalyze(second.id);
    const third = worker.jobRequests()[2];
    if (!third || third.kind !== "analyze") throw new Error("missing third request");
    expect(third.rle.size).toEqual([1, 2]);
    worker.respondAnalyze(third.id);

    await Promise.all([current, prefetch, editing]);
    pool.dispose();
  });

  it("pins morphology to slot 0 without blocking ordinary work on slot 1", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RasterMaskWorkerPool({
      size: 2,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    pool.registerSession("mask", "sha", zeroRle(4, 4));
    const blocking = pool.analyze(zeroRle(1));
    const morphology = pool.morphologyRoi({
      sessionId: "mask",
      sha256: "sha",
      sourceRevision: 3,
      core: { x: 0, y: 0, width: 4, height: 4 },
      input: { x: 0, y: 0, width: 4, height: 4 },
      operation: { operation: "dilate", kernelShape: "square", radius: 1 },
      dirtyOverrides: [],
      backendPolicy: "cpu",
      computeBudgetBytes: 0,
    });
    const ordinary = pool.analyze(zeroRle(2));

    const slotOneRequest = workers[1].jobRequests()[0];
    expect(slotOneRequest?.kind).toBe("analyze");
    if (!slotOneRequest || slotOneRequest.kind !== "analyze") {
      throw new Error("missing slot 1 analyze request");
    }
    workers[1].respondAnalyze(slotOneRequest.id);
    const slotZeroBlocking = workers[0].jobRequests()[0];
    if (!slotZeroBlocking || slotZeroBlocking.kind !== "analyze") {
      throw new Error("missing slot 0 analyze request");
    }
    workers[0].respondAnalyze(slotZeroBlocking.id);

    const morphologyRequest = workers[0].jobRequests()[1];
    expect(morphologyRequest?.kind).toBe("morphology_roi");
    expect(workers[1].jobRequests().some((request) => request.kind === "morphology_roi")).toBe(
      false,
    );
    if (!morphologyRequest || morphologyRequest.kind !== "morphology_roi") {
      throw new Error("missing slot 0 morphology request");
    }
    workers[0].respond({
      kind: "morphology_roi",
      id: morphologyRequest.id,
      ok: true,
      sessionId: "mask",
      sha256: "sha",
      sourceRevision: 3,
      backend: "cpu",
      fallbackReason: "gate-disabled",
      changedPixels: 0,
      changedBounds: null,
      patches: [],
      metrics: {
        totalMs: 1,
        backendPrepareMs: 0.2,
        computeMs: 0.7,
        diffOrPatchMs: 0.1,
        gpuUploadSubmitMs: null,
        gpuReadbackMs: null,
        gpuPassMs: null,
        fallbackMaterializeMs: null,
        inputAlphaBytes: 16,
        packedSourceBytes: 0,
        xorReadbackBytes: 0,
        allocatedGpuBytes: 0,
        gpuSourceCapacityBytes: 0,
        gpuXorCapacityBytes: 0,
        gpuReadbackCapacityBytes: 0,
      },
    });

    await Promise.all([blocking, morphology, ordinary]);
    expect(pool.getComputeResources()).toMatchObject({
      lastMetrics: {
        inputAlphaBytes: 16,
        packedSourceBytes: 0,
        xorReadbackBytes: 0,
      },
      counters: {
        cpuJobs: 1,
        packedGpuJobs: 0,
        gpuAlphaMaterializations: 0,
        gpuRuntimeFallbackMaterializations: 0,
      },
    });
    pool.dispose();
  });

  it("tracks bounded WebGPU diagnostics and resets only the owner slot", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RasterMaskWorkerPool({
      size: 2,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const warmup = pool.warmupWebGpu();
    const request = workers[0].jobRequests()[0];
    expect(workers[1].jobRequests()).toEqual([]);
    if (!request || request.kind !== "webgpu_warmup") throw new Error("missing warmup request");
    workers[0].respond({
      kind: "webgpu_warmup",
      id: request.id,
      ok: true,
      snapshot: {
        state: "warming",
        allocatedBytes: 0,
        sourceCapacityBytes: 0,
        xorCapacityBytes: 0,
        readbackCapacityBytes: 0,
        initAttempts: 1,
        deviceLost: 0,
        lastFailure: null,
      },
    });
    await warmup;
    expect(pool.getSnapshot().compute).toMatchObject({
      webGpuState: "warming",
      gpuOwnerWorkers: 0,
      gpuAllocatedBytes: 0,
      counters: { initAttempts: 1 },
    });

    pool.releaseCompute();
    expect(workers[0].messages[workers[0].messages.length - 1]?.request).toEqual({
      kind: "reset_webgpu",
    });
    expect(workers[1].messages.some((entry) => entry.request.kind === "reset_webgpu")).toBe(false);
    expect(pool.getSnapshot().compute).toMatchObject({
      webGpuState: "disabled",
      gpuAllocatedBytes: 0,
      counters: { initAttempts: 0 },
    });
    pool.dispose();
    expect(pool.getSnapshot().compute.webGpuState).toBe("closed");
  });

  it("keeps shared compute alive until the final registered session is released", async () => {
    const worker = new FakeWorker();
    const pool = new RasterMaskWorkerPool({
      size: 1,
      createWorker: () => worker as unknown as Worker,
    });
    pool.registerSession("mask-a", "sha-a", zeroRle(2, 2));
    pool.registerSession("mask-b", "sha-b", zeroRle(2, 2));
    const warmup = pool.warmupWebGpu();
    const request = worker.jobRequests()[0];
    if (!request || request.kind !== "webgpu_warmup") throw new Error("missing warmup request");
    worker.respond({
      kind: "webgpu_warmup",
      id: request.id,
      ok: true,
      snapshot: {
        state: "ready",
        allocatedBytes: 1024,
        sourceCapacityBytes: 512,
        xorCapacityBytes: 256,
        readbackCapacityBytes: 256,
        initAttempts: 1,
        deviceLost: 0,
        lastFailure: null,
      },
    });
    await warmup;

    pool.releaseSession("mask-a");
    expect(worker.messages.some((entry) => entry.request.kind === "reset_webgpu")).toBe(false);
    expect(pool.getSnapshot().compute).toMatchObject({
      webGpuState: "ready",
      gpuAllocatedBytes: 1024,
    });

    pool.releaseSession("mask-b");
    expect(worker.messages[worker.messages.length - 1]?.request).toEqual({
      kind: "reset_webgpu",
    });
    expect(pool.getSnapshot()).toMatchObject({
      sessions: 0,
      compute: { gpuAllocatedBytes: 0 },
    });
    pool.dispose();
  });

  it("routes operation and instance-operation responses through one reusable slot", async () => {
    const worker = new FakeWorker();
    const pool = new RasterMaskWorkerPool({
      size: 1,
      createWorker: () => worker as unknown as Worker,
    });
    const context = { sessionId: "task-a", generation: 2, operationId: 7 };
    const operation = pool.executeOperation(
      zeroRle(2),
      { type: "morphology", operation: "dilate", kernelShape: "disk", radius: 1 },
      context,
    );
    const operationRequest = worker.jobRequests()[0];
    if (!operationRequest || operationRequest.kind !== "operation") {
      throw new Error("missing operation request");
    }
    worker.respond({
      kind: "operation",
      id: operationRequest.id,
      ok: true,
      context,
      result: {
        alpha: Uint8Array.from([255, 0]),
        report: {
          beforeArea: 0,
          afterArea: 1,
          changedPixels: 1,
          beforeComponents: 0,
          afterComponents: 1,
          beforeHoles: 0,
          afterHoles: 0,
          bounds: { x0: 0, y0: 0, x1: 1, y1: 1 },
        },
      },
    });
    await expect(operation).resolves.toMatchObject({
      context,
      result: { alpha: Uint8Array.from([255, 0]) },
    });

    const instance = pool.executeInstanceOperation(
      zeroRle(2),
      { type: "split_components", keep: "largest", connectivity: 4 },
      { ...context, operationId: 8 },
    );
    const instanceRequest = worker.jobRequests()[1];
    if (!instanceRequest || instanceRequest.kind !== "instance_operation") {
      throw new Error("missing instance operation request");
    }
    worker.respond({
      kind: "instance_operation",
      id: instanceRequest.id,
      ok: true,
      context: { ...context, operationId: 8 },
      plan: null,
    });
    await expect(instance).resolves.toMatchObject({
      context: { ...context, operationId: 8 },
      plan: null,
    });
    expect(pool.getSnapshot()).toMatchObject({ workersCreated: 1, completed: 2 });
    pool.dispose();
  });

  it("aborting one running slot replaces only that worker", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RasterMaskWorkerPool({
      size: 2,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const controller = new AbortController();
    const cancelled = pool.analyze(zeroRle(1), { signal: controller.signal });
    const cancellation = expect(cancelled).rejects.toBeInstanceOf(RasterMaskWorkerCancelledError);
    const healthy = pool.analyze(zeroRle(2));
    controller.abort();

    expect(workers).toHaveLength(3);
    expect(workers[0].terminateCalls).toBe(1);
    expect(workers[1].terminateCalls).toBe(0);
    const healthyRequest = workers[1].jobRequests()[0];
    if (!healthyRequest || healthyRequest.kind !== "analyze")
      throw new Error("missing healthy request");
    workers[1].respondAnalyze(healthyRequest.id);
    await cancellation;
    await healthy;
    expect(pool.getSnapshot()).toMatchObject({ workersReplaced: 1, cancelled: 1, completed: 1 });
    pool.dispose();
  });

  it("times out and replaces a stuck worker through the injected clock", async () => {
    const workers: FakeWorker[] = [];
    const clock = new FakeClock();
    const pool = new RasterMaskWorkerPool({
      size: 1,
      clock,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    const pending = pool.analyze(zeroRle(1), { timeoutMs: 50 });
    const timedOut = expect(pending).rejects.toBeInstanceOf(RasterMaskWorkerTimeoutError);

    clock.runNext();
    await timedOut;
    expect(workers).toHaveLength(2);
    expect(workers[0].terminateCalls).toBe(1);
    expect(pool.getSnapshot()).toMatchObject({ timedOut: 1, workersReplaced: 1 });
    pool.dispose();
  });

  it("rejects overflow beyond the bounded waiting queue", async () => {
    const worker = new FakeWorker();
    const pool = new RasterMaskWorkerPool({
      size: 1,
      queueLimit: 1,
      createWorker: () => worker as unknown as Worker,
    });
    const running = pool.analyze(zeroRle(1));
    const queued = pool.analyze(zeroRle(2));

    await expect(pool.analyze(zeroRle(3))).rejects.toBeInstanceOf(RasterMaskWorkerQueueFullError);
    pool.dispose();
    await expect(running).rejects.toBeInstanceOf(RasterMaskWorkerCancelledError);
    await expect(queued).rejects.toBeInstanceOf(RasterMaskWorkerCancelledError);
  });

  it("replays registered sessions after a crash and keeps tile requests key-scoped", async () => {
    const workers: FakeWorker[] = [];
    const pool = new RasterMaskWorkerPool({
      size: 1,
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
    pool.registerSession("session-a", "sha-a", zeroRle(4, 4));
    const registration = workers[0].messages[0];
    expect(registration.request.kind).toBe("register_session");
    if (registration.request.kind !== "register_session") throw new Error("missing registration");
    expect(registration.transfer).toEqual([registration.request.rle.counts.buffer]);

    const tile = pool.decodeTile("session-a", "sha-a", { x: 1, y: 1, width: 2, height: 2 });
    const rejected = expect(tile).rejects.toBeInstanceOf(RasterMaskWorkerError);
    workers[0].crash();
    await rejected;

    expect(workers).toHaveLength(2);
    expect(workers[1].messages[0]?.request.kind).toBe("register_session");
    expect(pool.getSnapshot()).toMatchObject({ workersReplaced: 1, sessions: 1 });
    pool.releaseSession("session-a");
    expect(pool.getSnapshot().sessions).toBe(0);
    pool.dispose();
  });

  it("compares two registered sessions and cancels when either side is released", async () => {
    const worker = new FakeWorker();
    const pool = new RasterMaskWorkerPool({
      size: 1,
      createWorker: () => worker as unknown as Worker,
    });
    pool.registerSession("current", "sha-current", zeroRle(4, 4));
    pool.registerSession("baseline", "sha-baseline", zeroRle(4, 4));
    const current = { sessionId: "current", sha256: "sha-current" };
    const baseline = { sessionId: "baseline", sha256: "sha-baseline" };
    const rect = { x: 0, y: 0, width: 2, height: 2 };
    const completed = pool.compareTile(current, baseline, rect, "xor");
    const request = worker.jobRequests()[0];
    if (!request || request.kind !== "compare_tile") throw new Error("missing compare request");
    worker.respondCompare(request.id, Uint8Array.from([0, 1, 2, 0]));
    await expect(completed).resolves.toMatchObject({
      current,
      baseline,
      rect,
      mode: "xor",
      sampleStep: 1,
      codes: Uint8Array.from([0, 1, 2, 0]),
    });

    const metrics = pool.compareMetrics(current, baseline);
    const metricsRequest = worker
      .jobRequests()
      .find((candidate) => candidate.kind === "compare_metrics");
    if (!metricsRequest) throw new Error("missing compare metrics request");
    worker.respondCompareMetrics(metricsRequest.id);
    await expect(metrics).resolves.toMatchObject({
      current,
      baseline,
      metrics: { changedPixels: 1 },
    });

    const cancelled = pool.compareTile(current, baseline, rect, "overlay");
    const rejection = expect(cancelled).rejects.toBeInstanceOf(RasterMaskWorkerCancelledError);
    pool.releaseSession("baseline");
    await rejection;
    expect(pool.getSnapshot()).toMatchObject({ sessions: 1, cancelled: 1 });
    pool.dispose();
  });
});
