import type {
  MaskInstanceOperationPlan,
  MaskInstanceOperationSpec,
} from "./geometry/maskInstanceOperations";
import type { MaskOperationResult, MaskOperationSpec } from "./geometry/maskOperations";
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

export type RasterMaskWorkerJobRequest =
  | AnalysisWorkerRequest
  | OperationWorkerRequest
  | InstanceOperationWorkerRequest
  | TileDecodeWorkerRequest
  | TileMergeWorkerRequest
  | CompareMetricsWorkerRequest
  | CompareTileWorkerRequest;

export type RasterMaskWorkerControlRequest =
  | {
      kind: "register_session";
      sessionId: string;
      sha256: string;
      rle: RasterMaskTransferredRle;
    }
  | { kind: "release_session"; sessionId: string };

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
