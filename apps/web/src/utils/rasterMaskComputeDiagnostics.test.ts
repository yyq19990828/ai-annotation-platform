import { afterEach, describe, expect, it } from "vitest";
import {
  activateRasterMaskComputeDiagnostics,
  clearRasterMaskComputeDiagnostics,
  getRasterMaskComputeDiagnosticsSnapshot,
  publishRasterMaskComputeDiagnostic,
  rasterMaskComputeDiagnosticsConsoleEntry,
  type RasterMaskComputeDiagnosticEvent,
} from "./rasterMaskComputeDiagnostics";

function event(total: number): RasterMaskComputeDiagnosticEvent {
  return {
    recordedAt: `2026-07-31T00:00:${String(total).padStart(2, "0")}.000Z`,
    backend: "cpu",
    cpuStrategy: "packed-separable",
    prepareStrategy: "direct-rle",
    fallbackReason: "navigator-gpu-unavailable",
    failureStage: "adapter-request",
    inputPixels: 4_194_304,
    corePixels: 4_194_304,
    timingsMs: {
      prepare: 1,
      compute: 2,
      uploadSubmit: null,
      readback: null,
      patch: 3,
      total,
    },
    bytes: {
      cpuBudget: 64,
      gpuBudget: 0,
      cpuTransient: 16,
      denseTransient: 0,
      packedIntermediate: 8,
      baseCacheRetained: 0,
      sourceScratchCapacity: 4,
      gpuAllocated: 0,
    },
    cache: { hits: 0, misses: 1, evictions: 0 },
    webGpu: {
      circuitState: "cooldown",
      cooldownRemainingMs: 30_000,
      consecutiveFailures: 1,
      deviceLost: 0,
    },
    pool: { queued: 0, running: 1, sessions: 1, gpuOwnerWorkers: 0 },
  };
}

afterEach(() => {
  delete (
    window as unknown as {
      __rasterMaskComputeDiagnostics?: unknown;
    }
  ).__rasterMaskComputeDiagnostics;
});

describe("rasterMaskComputeDiagnostics", () => {
  it("keeps only the latest 20 typed events without exposing the task id", () => {
    const taskId = "sensitive-task-id";
    for (let index = 0; index < 25; index += 1) {
      publishRasterMaskComputeDiagnostic(taskId, event(index));
    }

    const snapshot = getRasterMaskComputeDiagnosticsSnapshot();
    expect(snapshot?.events).toHaveLength(20);
    expect(snapshot?.events[0]?.timingsMs.total).toBe(5);
    expect(snapshot?.events[19]?.timingsMs.total).toBe(24);
    expect(JSON.stringify(snapshot)).not.toContain(taskId);
    expect(rasterMaskComputeDiagnosticsConsoleEntry(snapshot)?.msg).toBe(
      "[raster-mask-compute-diagnostics]",
    );
  });

  it("clears diagnostics on task switch and only lets the owner clear the active scope", () => {
    publishRasterMaskComputeDiagnostic("task-a", event(1));
    activateRasterMaskComputeDiagnostics("task-b");
    expect(getRasterMaskComputeDiagnosticsSnapshot()).toBeNull();

    publishRasterMaskComputeDiagnostic("task-b", event(2));
    clearRasterMaskComputeDiagnostics("task-a");
    expect(getRasterMaskComputeDiagnosticsSnapshot()?.events[0]?.timingsMs.total).toBe(2);
    clearRasterMaskComputeDiagnostics("task-b");
    expect(getRasterMaskComputeDiagnosticsSnapshot()).toBeNull();
  });
});
