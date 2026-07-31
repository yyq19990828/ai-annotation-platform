import type {
  MaskInstanceOperationPlan,
  MaskInstanceOperationSpec,
} from "./geometry/maskInstanceOperations";
import type { MaskOperationResult, MaskOperationSpec } from "./geometry/maskOperations";
import type { MaskKernelShape, MaskMorphologyOperation } from "./geometry/maskOperations";
import type { MaskHistoryPatch } from "./maskHistory";
import type { RasterMaskAnalysis } from "./rasterMaskRender";

export interface RasterMaskOperationContext {
  sessionId: string;
  generation: number;
  operationId: number;
}

export interface RasterMaskTransferredRle {
  size: [number, number];
  counts: Uint32Array;
}

export interface RasterMaskTileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RasterMaskTileOverride extends RasterMaskTileRect {
  alpha: Uint8Array;
}

export interface RasterMaskPackedTileOverride extends RasterMaskTileRect {
  tileX: number;
  tileY: number;
  revision: number;
  bits: Uint8Array;
}

export type RasterMaskMorphologyBackendPolicy = "cpu" | "webgpu-candidate";
export type RasterMaskMorphologyBackend = "cpu" | "webgpu" | "cpu-fallback";
export type RasterMaskCpuStrategy = "not-run" | "dense" | "packed-separable";
export type RasterMaskPrepareStrategy = "dense-cpu" | "direct-rle" | "packed-cache";
export type RasterMaskXorOutputStrategy =
  | "cpu-dense"
  | "cpu-after-gpu-failure"
  | "dense-word-scatter";
export type RasterMaskWebGpuFallbackReason =
  | "gate-disabled"
  | "unsupported-operation"
  | "below-pixel-threshold"
  | "budget-insufficient"
  | "navigator-gpu-unavailable"
  | "adapter-unavailable"
  | "initializing"
  | "initialization-failed"
  | "device-lost"
  | "gpu-runtime-failed";
export type RasterMaskComputeFailureStage =
  | "adapter-request"
  | "device-request"
  | "shader-compile"
  | "pipeline-create"
  | "buffer-create"
  | "queue-write"
  | "encode"
  | "submit"
  | "map"
  | "readback-validate"
  | "patch-build";
export type RasterMaskWebGpuCircuitState = "eligible" | "cooldown" | "page-fixed";

export interface RasterMaskMorphologyMetrics {
  totalMs: number;
  cpuStrategy: RasterMaskCpuStrategy;
  failureStage: RasterMaskComputeFailureStage | null;
  inputPixels: number;
  corePixels: number;
  backendPrepareMs: number;
  prepareStrategy: RasterMaskPrepareStrategy;
  directRleScanMs: number;
  baseCacheFillMs: number;
  packedAssembleMs: number;
  dirtyOverlayMs: number;
  baseCacheHitTiles: number;
  baseCacheMissTiles: number;
  baseCacheEvictedTiles: number;
  baseCacheRetainedBytes: number;
  sourceScratchCapacityBytes: number;
  computeMs: number;
  diffOrPatchMs: number;
  xorOutputStrategy: RasterMaskXorOutputStrategy;
  xorTotalWords: number;
  xorNonZeroWords: number;
  xorWordDensity: number;
  xorChangedPixels: number;
  xorTouchedTiles: number;
  xorScanMs: number;
  xorPatchAllocateMs: number;
  xorPatchScatterMs: number;
  wordPatchBuildMs: number;
  gpuUploadSubmitMs: number | null;
  gpuReadbackMs: number | null;
  gpuPassMs: number | null;
  fallbackMaterializeMs: number | null;
  cpuBudgetBytes: number;
  gpuBudgetBytes: number;
  cpuTransientBytes: number;
  denseTransientBytes: number;
  packedIntermediateBytes: number;
  patchUpperBoundBytes: number;
  inputAlphaBytes: number;
  packedSourceBytes: number;
  xorReadbackBytes: number;
  allocatedGpuBytes: number;
  gpuSourceCapacityBytes: number;
  gpuXorCapacityBytes: number;
  gpuReadbackCapacityBytes: number;
  webGpuCircuitState: RasterMaskWebGpuCircuitState;
  webGpuCooldownRemainingMs: number;
  webGpuConsecutiveFailures: number;
  webGpuDeviceLost: number;
}

export interface RasterMaskWebGpuWorkerSnapshot {
  state: "disabled" | "idle" | "warming" | "ready" | "unavailable" | "lost" | "closed";
  allocatedBytes: number;
  sourceCapacityBytes: number;
  xorCapacityBytes: number;
  readbackCapacityBytes: number;
  initAttempts: number;
  deviceLost: number;
  lastFailure: RasterMaskWebGpuFallbackReason | null;
  lastFailureStage: RasterMaskComputeFailureStage | null;
  circuitState: RasterMaskWebGpuCircuitState;
  cooldownRemainingMs: number;
  consecutiveFailures: number;
}

export interface RasterMaskMorphologyRoiResponse {
  kind: "morphology_roi";
  id: number;
  ok: true;
  sessionId: string;
  sha256: string;
  sourceRevision: number;
  backend: RasterMaskMorphologyBackend;
  fallbackReason: RasterMaskWebGpuFallbackReason | null;
  changedPixels: number;
  changedBounds: RasterMaskTileRect | null;
  patches: MaskHistoryPatch[];
  metrics: RasterMaskMorphologyMetrics;
}

export type RasterMaskCompareMode = "overlay" | "boundary" | "xor" | "added" | "removed";

export interface RasterMaskCompareSessionRef {
  sessionId: string;
  sha256: string;
}

export interface RasterMaskCompareMetrics {
  currentAreaPixels: number;
  baselineAreaPixels: number;
  intersectionPixels: number;
  unionPixels: number;
  changedPixels: number;
  addedPixels: number;
  removedPixels: number;
}

export type RasterMaskWorkerJobKind =
  | "analyze"
  | "operation"
  | "instance_operation"
  | "morphology_roi"
  | "webgpu_warmup"
  | "tile_decode"
  | "tile_merge"
  | "compare_metrics"
  | "compare_tile";

type AnalysisWorkerRequest = {
  kind: "analyze";
  id: number;
  rle: RasterMaskTransferredRle;
};

type OperationWorkerRequest = {
  kind: "operation";
  id: number;
  rle: RasterMaskTransferredRle;
  operation: MaskOperationSpec;
  context: RasterMaskOperationContext;
};

type InstanceOperationWorkerRequest = {
  kind: "instance_operation";
  id: number;
  rle: RasterMaskTransferredRle;
  operation: MaskInstanceOperationSpec;
  context: RasterMaskOperationContext;
};

type TileDecodeWorkerRequest = {
  kind: "tile_decode";
  id: number;
  sessionId: string;
  sha256: string;
  rect: RasterMaskTileRect;
};

type TileMergeWorkerRequest = {
  kind: "tile_merge";
  id: number;
  sessionId: string;
  sha256: string;
  tiles: RasterMaskTileOverride[];
};

export type RasterMaskMorphologyRoiRequest = {
  kind: "morphology_roi";
  id: number;
  sessionId: string;
  sha256: string;
  sourceRevision: number;
  core: RasterMaskTileRect;
  input: RasterMaskTileRect;
  operation: {
    operation: MaskMorphologyOperation;
    kernelShape: MaskKernelShape;
    radius: number;
  };
  dirtyOverrides: RasterMaskPackedTileOverride[];
  backendPolicy: RasterMaskMorphologyBackendPolicy;
  cpuComputeBudgetBytes: number;
  gpuBufferBudgetBytes: number;
};

type CompareTileWorkerRequest = {
  kind: "compare_tile";
  id: number;
  current: RasterMaskCompareSessionRef;
  baseline: RasterMaskCompareSessionRef;
  rect: RasterMaskTileRect;
  mode: RasterMaskCompareMode;
  sampleStep: number;
};

type CompareMetricsWorkerRequest = {
  kind: "compare_metrics";
  id: number;
  current: RasterMaskCompareSessionRef;
  baseline: RasterMaskCompareSessionRef;
};

type WebGpuWarmupWorkerRequest = {
  kind: "webgpu_warmup";
  id: number;
};

export type RasterMaskWorkerJobRequest =
  | AnalysisWorkerRequest
  | OperationWorkerRequest
  | InstanceOperationWorkerRequest
  | TileDecodeWorkerRequest
  | TileMergeWorkerRequest
  | RasterMaskMorphologyRoiRequest
  | WebGpuWarmupWorkerRequest
  | CompareMetricsWorkerRequest
  | CompareTileWorkerRequest;

export type RasterMaskWorkerControlRequest =
  | {
      kind: "register_session";
      sessionId: string;
      sha256: string;
      rle: RasterMaskTransferredRle;
    }
  | { kind: "release_session"; sessionId: string }
  | { kind: "release_compute" }
  | { kind: "reset_webgpu" };

export type RasterMaskWorkerRequest = RasterMaskWorkerJobRequest | RasterMaskWorkerControlRequest;

export type RasterMaskWorkerResponse =
  | { kind: "analyze"; id: number; ok: true; analysis: RasterMaskAnalysis }
  | {
      kind: "operation";
      id: number;
      ok: true;
      context: RasterMaskOperationContext;
      result: MaskOperationResult;
    }
  | {
      kind: "instance_operation";
      id: number;
      ok: true;
      context: RasterMaskOperationContext;
      plan: MaskInstanceOperationPlan | null;
    }
  | {
      kind: "tile_decode";
      id: number;
      ok: true;
      sessionId: string;
      sha256: string;
      rect: RasterMaskTileRect;
      alpha: Uint8Array;
    }
  | {
      kind: "tile_merge";
      id: number;
      ok: true;
      sessionId: string;
      sha256: string;
      rle: RasterMaskTransferredRle;
    }
  | RasterMaskMorphologyRoiResponse
  | {
      kind: "webgpu_warmup";
      id: number;
      ok: true;
      snapshot: RasterMaskWebGpuWorkerSnapshot;
    }
  | {
      kind: "compare_metrics";
      id: number;
      ok: true;
      current: RasterMaskCompareSessionRef;
      baseline: RasterMaskCompareSessionRef;
      metrics: RasterMaskCompareMetrics;
    }
  | {
      kind: "compare_tile";
      id: number;
      ok: true;
      current: RasterMaskCompareSessionRef;
      baseline: RasterMaskCompareSessionRef;
      rect: RasterMaskTileRect;
      mode: RasterMaskCompareMode;
      sampleStep: number;
      codes: Uint8Array;
    }
  | { kind: RasterMaskWorkerJobKind; id: number; ok: false; error: string };
