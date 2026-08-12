import type {
  RasterMaskComputeFailureStage,
  RasterMaskCpuStrategy,
  RasterMaskMorphologyBackend,
  RasterMaskPrepareStrategy,
  RasterMaskWebGpuCircuitState,
  RasterMaskWebGpuFallbackReason,
} from "@/pages/Workbench/stage/shared/rasterMaskWorkerProtocol";

const MAX_EVENTS = 20;
const MAX_DIAGNOSTIC_JSON_CHARS = 8_000;

export interface RasterMaskComputeDiagnosticEvent {
  recordedAt: string;
  backend: RasterMaskMorphologyBackend;
  cpuStrategy: RasterMaskCpuStrategy;
  prepareStrategy: RasterMaskPrepareStrategy;
  fallbackReason: RasterMaskWebGpuFallbackReason | null;
  failureStage: RasterMaskComputeFailureStage | null;
  inputPixels: number;
  corePixels: number;
  timingsMs: {
    prepare: number;
    compute: number;
    uploadSubmit: number | null;
    readback: number | null;
    patch: number;
    total: number;
  };
  bytes: {
    cpuBudget: number;
    gpuBudget: number;
    cpuTransient: number;
    denseTransient: number;
    packedIntermediate: number;
    baseCacheRetained: number;
    sourceScratchCapacity: number;
    gpuAllocated: number;
  };
  cache: {
    hits: number;
    misses: number;
    evictions: number;
  };
  webGpu: {
    circuitState: RasterMaskWebGpuCircuitState;
    cooldownRemainingMs: number;
    consecutiveFailures: number;
    deviceLost: number;
  };
  pool: {
    queued: number;
    running: number;
    sessions: number;
    gpuOwnerWorkers: number;
  };
}

export interface RasterMaskComputeDiagnosticsSnapshot {
  route: string;
  updatedAt: string;
  events: RasterMaskComputeDiagnosticEvent[];
}

interface RasterMaskComputeDiagnosticsStore extends RasterMaskComputeDiagnosticsSnapshot {
  activeTaskId: string;
}

function diagnosticsWindow(): {
  __rasterMaskComputeDiagnostics?: RasterMaskComputeDiagnosticsStore;
} | null {
  if (typeof window === "undefined") return null;
  return window as unknown as {
    __rasterMaskComputeDiagnostics?: RasterMaskComputeDiagnosticsStore;
  };
}

function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function stableStringify(value: unknown): string {
  const json = JSON.stringify(value, null, 2);
  return json.length <= MAX_DIAGNOSTIC_JSON_CHARS
    ? json
    : `${json.slice(0, MAX_DIAGNOSTIC_JSON_CHARS)}\n... truncated`;
}

export function activateRasterMaskComputeDiagnostics(taskId: string): void {
  const target = diagnosticsWindow();
  if (!target) return;
  const route = currentRoute();
  if (
    !target.__rasterMaskComputeDiagnostics ||
    target.__rasterMaskComputeDiagnostics.activeTaskId !== taskId ||
    target.__rasterMaskComputeDiagnostics.route !== route
  ) {
    target.__rasterMaskComputeDiagnostics = {
      activeTaskId: taskId,
      route,
      updatedAt: new Date().toISOString(),
      events: [],
    };
  }
}

export function publishRasterMaskComputeDiagnostic(
  taskId: string,
  event: RasterMaskComputeDiagnosticEvent,
): void {
  activateRasterMaskComputeDiagnostics(taskId);
  const store = diagnosticsWindow()?.__rasterMaskComputeDiagnostics;
  if (!store || store.activeTaskId !== taskId) return;
  store.updatedAt = event.recordedAt;
  store.events.push(event);
  if (store.events.length > MAX_EVENTS) {
    store.events.splice(0, store.events.length - MAX_EVENTS);
  }
}

export function clearRasterMaskComputeDiagnostics(taskId: string): void {
  const target = diagnosticsWindow();
  if (target?.__rasterMaskComputeDiagnostics?.activeTaskId === taskId) {
    delete target.__rasterMaskComputeDiagnostics;
  }
}

export function getRasterMaskComputeDiagnosticsSnapshot(): RasterMaskComputeDiagnosticsSnapshot | null {
  const store = diagnosticsWindow()?.__rasterMaskComputeDiagnostics;
  if (!store || store.route !== currentRoute() || store.events.length === 0) return null;
  return {
    route: store.route,
    updatedAt: store.updatedAt,
    events: store.events.map((event) => ({
      ...event,
      timingsMs: { ...event.timingsMs },
      bytes: { ...event.bytes },
      cache: { ...event.cache },
      webGpu: { ...event.webGpu },
      pool: { ...event.pool },
    })),
  };
}

export function appendRasterMaskComputeDiagnostics(
  description: string,
  snapshot: RasterMaskComputeDiagnosticsSnapshot | null,
): string {
  if (!snapshot) return description;
  return `${description}\n\n---\n\n### Raster Mask Compute Diagnostics\n\n\`\`\`json\n${stableStringify(snapshot)}\n\`\`\``;
}

export function rasterMaskComputeDiagnosticsConsoleEntry(
  snapshot: RasterMaskComputeDiagnosticsSnapshot | null,
): { msg: string; stack: string } | null {
  if (!snapshot) return null;
  return {
    msg: "[raster-mask-compute-diagnostics]",
    stack: stableStringify(snapshot),
  };
}
