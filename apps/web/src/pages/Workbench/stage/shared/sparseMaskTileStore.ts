import type { CocoRle } from "./geometry/maskRle";
import {
  rasterizeMaskBrush,
  rasterizeMaskPolygon,
  type MaskRasterBrushShape,
} from "./geometry/maskRasterization";
import type { MaskKernelShape, MaskMorphologyOperation } from "./geometry/maskOperations";
import {
  createMaskHistoryCommandFromPatches,
  MaskHistoryCheckpoint,
  MASK_HISTORY_TILE_SIZE,
  type MaskHistoryCommand,
  type MaskHistoryPatch,
} from "./maskHistory";
import type {
  RasterMaskComputeResources,
  RasterMaskWorkerPriority,
  RasterMaskWorkerRunOptions,
} from "./rasterMaskWorkerPool";
import type {
  RasterMaskTileOverride,
  RasterMaskMorphologyBackendPolicy,
  RasterMaskMorphologyRoiResponse,
  RasterMaskPackedTileOverride,
  RasterMaskTileRect,
  RasterMaskTransferredRle,
} from "./rasterMaskWorkerProtocol";

const MIB = 1024 * 1024;
const TILE_METADATA_BYTES = 96;
const MAX_VIEWPORT_MATERIALIZED_TILES = 16;
const MAX_CONCURRENT_TILE_DECODES = 2;
const MAX_ROI_PIXELS = 16_777_216;

export interface SparseMaskTileBackend {
  registerSession: (sessionId: string, sha256: string, rle: CocoRle) => void;
  releaseSession: (sessionId: string) => void;
  decodeTile: (
    sessionId: string,
    sha256: string,
    rect: RasterMaskTileRect,
    options?: RasterMaskWorkerRunOptions,
  ) => Promise<{ sessionId: string; sha256: string; rect: RasterMaskTileRect; alpha: Uint8Array }>;
  mergeTiles: (
    sessionId: string,
    sha256: string,
    tiles: readonly RasterMaskTileOverride[],
    options?: RasterMaskWorkerRunOptions,
  ) => Promise<{ sessionId: string; sha256: string; rle: RasterMaskTransferredRle }>;
  morphologyRoi: (
    request: {
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
      dirtyOverrides: readonly RasterMaskPackedTileOverride[];
      backendPolicy: RasterMaskMorphologyBackendPolicy;
      cpuComputeBudgetBytes: number;
      gpuBufferBudgetBytes: number;
    },
    options?: RasterMaskWorkerRunOptions,
  ) => Promise<RasterMaskMorphologyRoiResponse>;
  warmupWebGpu?: (options?: RasterMaskWorkerRunOptions) => Promise<unknown>;
  getComputeResources?: () => RasterMaskComputeResources;
}

export interface SparseMaskViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SparseMaskRenderableTile extends RasterMaskTileRect {
  key: string;
  tileX: number;
  tileY: number;
  alpha: Uint8Array;
  revision: number;
  dirty: boolean;
}

export interface SparseMaskTileResources {
  maxBytes: number;
  retainedBytes: number;
  reservedBytes: number;
  liveTiles: number;
  dirtyTiles: number;
  viewportPinnedTiles: number;
  historyReferencedTiles: number;
  decodeInFlight: number;
  tilesCreated: number;
  tilesEvicted: number;
  overviewOnly: boolean;
  admissionBlocked: boolean;
  compute: RasterMaskComputeResources | null;
  disposed: boolean;
}

interface SparseMaskTile extends SparseMaskRenderableTile {
  baseBits: Uint8Array;
  currentBits: Uint8Array;
  byteSize: number;
  historyReferences: number;
  viewportPinned: boolean;
  lastAccess: number;
}

export class SparseMaskTileStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SparseMaskTileStoreError";
  }
}

export class SparseMaskTileBudgetError extends SparseMaskTileStoreError {
  constructor(requiredBytes: number, budgetBytes: number) {
    super(
      `mask tile requires ${requiredBytes} bytes but the ${budgetBytes}-byte cache budget is exhausted`,
    );
    this.name = "SparseMaskTileBudgetError";
  }
}

export class LargeMaskFullScanRequiredError extends SparseMaskTileStoreError {
  readonly reason = "large_mask_full_scan_required";

  constructor(message = "large Mask operation requires a bounded viewport ROI") {
    super(message);
    this.name = "LargeMaskFullScanRequiredError";
  }
}

export function sparseMaskTileBudgetBytes(deviceMemory?: number | null): number {
  if (
    deviceMemory != null &&
    Number.isFinite(deviceMemory) &&
    deviceMemory > 0 &&
    deviceMemory <= 2
  ) {
    return 32 * MIB;
  }
  if (deviceMemory != null && Number.isFinite(deviceMemory) && deviceMemory >= 8) return 128 * MIB;
  return 64 * MIB;
}

export function sparseMaskCpuComputeBudgetBytes(deviceMemory?: number | null): number {
  if (
    deviceMemory != null &&
    Number.isFinite(deviceMemory) &&
    deviceMemory > 0 &&
    deviceMemory <= 2
  ) {
    return 32 * MIB;
  }
  if (deviceMemory != null && Number.isFinite(deviceMemory) && deviceMemory >= 8) return 128 * MIB;
  return 64 * MIB;
}

export function sparseMaskGpuBufferBudgetBytes(deviceMemory?: number | null): number {
  if (
    deviceMemory != null &&
    Number.isFinite(deviceMemory) &&
    deviceMemory > 0 &&
    deviceMemory <= 2
  ) {
    return 0;
  }
  if (deviceMemory != null && Number.isFinite(deviceMemory) && deviceMemory >= 8) return 128 * MIB;
  return 64 * MIB;
}

function navigatorDeviceMemory(): number | undefined {
  if (typeof navigator === "undefined") return undefined;
  const value = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  return typeof value === "number" ? value : undefined;
}

function navigatorTileBudgetBytes(): number {
  return sparseMaskTileBudgetBytes(navigatorDeviceMemory());
}

function keyFor(tileX: number, tileY: number): string {
  return `${tileY}:${tileX}`;
}

function bitIsSet(bits: Uint8Array, index: number): boolean {
  return (bits[index >> 3] & (1 << (index & 7))) !== 0;
}

function packBits(alpha: Uint8Array): Uint8Array {
  const bits = new Uint8Array(Math.ceil(alpha.length / 8));
  for (let index = 0; index < alpha.length; index += 1) {
    if (alpha[index] !== 0) bits[index >> 3] |= 1 << (index & 7);
  }
  return bits;
}

function setBit(bits: Uint8Array, index: number, enabled: boolean): void {
  const mask = 1 << (index & 7);
  if (enabled) bits[index >> 3] |= mask;
  else bits[index >> 3] &= ~mask;
}

function bitsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function patchHasOnlyValidBits(patch: MaskHistoryPatch): boolean {
  const pixelCount = patch.width * patch.height;
  const remainder = pixelCount & 7;
  if (remainder === 0 || patch.xorBits.length === 0) return true;
  const validMask = (1 << remainder) - 1;
  return (patch.xorBits[patch.xorBits.length - 1] & ~validMask) === 0;
}

function forEachPatchBit(patch: MaskHistoryPatch, visit: (index: number) => void): void {
  const pixelCount = patch.width * patch.height;
  for (let byteIndex = 0; byteIndex < patch.xorBits.length; byteIndex += 1) {
    const byte = patch.xorBits[byteIndex];
    if (byte === 0) continue;
    for (let bit = 0; bit < 8; bit += 1) {
      if ((byte & (1 << bit)) === 0) continue;
      const index = byteIndex * 8 + bit;
      if (index < pixelCount) visit(index);
    }
  }
}

class CocoRleRunIndex {
  readonly height: number;
  readonly width: number;
  private readonly runEnds: Uint32Array;

  constructor(rle: CocoRle) {
    const [height, width] = rle.size;
    const pixels = height * width;
    if (
      rle.encoding !== "coco_rle" ||
      !Number.isSafeInteger(height) ||
      height <= 0 ||
      !Number.isSafeInteger(width) ||
      width <= 0 ||
      !Number.isSafeInteger(pixels) ||
      pixels > 0xffff_ffff ||
      !Array.isArray(rle.counts) ||
      rle.counts.length === 0
    )
      throw new SparseMaskTileStoreError("base RLE is invalid");
    this.height = height;
    this.width = width;
    this.runEnds = new Uint32Array(rle.counts.length);
    let total = 0;
    for (let index = 0; index < rle.counts.length; index += 1) {
      const count = rle.counts[index];
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new SparseMaskTileStoreError(`base RLE counts[${index}] is invalid`);
      }
      total += count;
      if (total > pixels)
        throw new SparseMaskTileStoreError("base RLE counts exceed its dimensions");
      this.runEnds[index] = total;
    }
    if (total !== pixels)
      throw new SparseMaskTileStoreError("base RLE counts do not fill its dimensions");
  }

  contains(x: number, y: number): boolean {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height
    ) {
      return false;
    }
    const offset = x * this.height + y;
    let low = 0;
    let high = this.runEnds.length;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (this.runEnds[mid] <= offset) low = mid + 1;
      else high = mid;
    }
    return (low & 1) === 1;
  }
}

export class SparseMaskTileStore {
  readonly width: number;
  readonly height: number;
  readonly sessionId: string;
  readonly sha256: string;
  readonly maxCacheBytes: number;

  private readonly baseIndex: CocoRleRunIndex;
  private readonly tiles = new Map<string, SparseMaskTile>();
  private readonly inFlight = new Map<string, Promise<SparseMaskTile>>();
  private viewportKeys = new Set<string>();
  private retainedBytes = 0;
  private reservedBytes = 0;
  private accessCounter = 0;
  private tilesCreated = 0;
  private tilesEvicted = 0;
  private overviewOnly = false;
  private admissionBlocked = false;
  private disposed = false;
  private mutationGeneration = 0;
  private readonly morphologyBackendPolicy: RasterMaskMorphologyBackendPolicy;
  private readonly cpuComputeBudgetBytes: number;
  private readonly gpuBufferBudgetBytes: number;

  constructor(options: {
    sessionId: string;
    sha256: string;
    baseRle: CocoRle;
    backend: SparseMaskTileBackend;
    maxCacheBytes?: number;
    deviceMemory?: number | null;
    morphologyBackendPolicy?: RasterMaskMorphologyBackendPolicy;
    cpuComputeBudgetBytes?: number;
    gpuBufferBudgetBytes?: number;
  }) {
    this.sessionId = options.sessionId;
    this.sha256 = options.sha256;
    this.backend = options.backend;
    this.baseIndex = new CocoRleRunIndex(options.baseRle);
    this.width = this.baseIndex.width;
    this.height = this.baseIndex.height;
    this.maxCacheBytes =
      options.maxCacheBytes ??
      (options.deviceMemory === undefined
        ? navigatorTileBudgetBytes()
        : sparseMaskTileBudgetBytes(options.deviceMemory));
    if (!Number.isFinite(this.maxCacheBytes) || this.maxCacheBytes <= 0) {
      throw new SparseMaskTileStoreError("mask tile cache budget must be positive");
    }
    const deviceMemory =
      options.deviceMemory === undefined ? navigatorDeviceMemory() : options.deviceMemory;
    this.cpuComputeBudgetBytes =
      options.cpuComputeBudgetBytes ?? sparseMaskCpuComputeBudgetBytes(deviceMemory);
    this.gpuBufferBudgetBytes =
      options.gpuBufferBudgetBytes ?? sparseMaskGpuBufferBudgetBytes(deviceMemory);
    this.morphologyBackendPolicy =
      options.morphologyBackendPolicy === "webgpu-candidate" && this.gpuBufferBudgetBytes > 0
        ? "webgpu-candidate"
        : "cpu";
    if (!Number.isSafeInteger(this.cpuComputeBudgetBytes) || this.cpuComputeBudgetBytes <= 0) {
      throw new SparseMaskTileStoreError("mask CPU compute budget must be a positive integer");
    }
    if (!Number.isSafeInteger(this.gpuBufferBudgetBytes) || this.gpuBufferBudgetBytes < 0) {
      throw new SparseMaskTileStoreError("mask GPU buffer budget must be a non-negative integer");
    }
    this.backend.registerSession(this.sessionId, this.sha256, options.baseRle);
  }

  private readonly backend: SparseMaskTileBackend;

  tileRect(tileX: number, tileY: number): RasterMaskTileRect {
    if (!Number.isInteger(tileX) || tileX < 0 || !Number.isInteger(tileY) || tileY < 0) {
      throw new SparseMaskTileStoreError("tile coordinates must be non-negative integers");
    }
    const x = tileX * MASK_HISTORY_TILE_SIZE;
    const y = tileY * MASK_HISTORY_TILE_SIZE;
    const width = Math.min(MASK_HISTORY_TILE_SIZE, this.width - x);
    const height = Math.min(MASK_HISTORY_TILE_SIZE, this.height - y);
    if (width <= 0 || height <= 0) throw new SparseMaskTileStoreError("tile is outside the mask");
    return { x, y, width, height };
  }

  private assertActive(): void {
    if (this.disposed) throw new SparseMaskTileStoreError("mask tile store is disposed");
  }

  private requiredBytes(rect: RasterMaskTileRect): number {
    const pixels = rect.width * rect.height;
    return pixels + Math.ceil(pixels / 8) * 2 + TILE_METADATA_BYTES;
  }

  private evictFor(requiredBytes: number): boolean {
    while (this.retainedBytes + this.reservedBytes + requiredBytes > this.maxCacheBytes) {
      const candidate = [...this.tiles.values()]
        .filter((tile) => !tile.dirty && !tile.viewportPinned && tile.historyReferences === 0)
        .sort((left, right) => left.lastAccess - right.lastAccess)[0];
      if (!candidate) return false;
      this.tiles.delete(candidate.key);
      this.retainedBytes -= candidate.byteSize;
      this.tilesEvicted += 1;
    }
    return true;
  }

  private evictTile(tile: SparseMaskTile): void {
    if (!this.tiles.delete(tile.key)) return;
    this.retainedBytes -= tile.byteSize;
    this.tilesEvicted += 1;
  }

  async materializeTile(
    tileX: number,
    tileY: number,
    options: { priority?: RasterMaskWorkerPriority; signal?: AbortSignal } = {},
  ): Promise<SparseMaskRenderableTile> {
    this.assertActive();
    const key = keyFor(tileX, tileY);
    const cached = this.tiles.get(key);
    if (cached) {
      cached.lastAccess = ++this.accessCounter;
      return cached;
    }
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const rect = this.tileRect(tileX, tileY);
    const byteSize = this.requiredBytes(rect);
    if (!this.evictFor(byteSize)) {
      this.admissionBlocked = true;
      throw new SparseMaskTileBudgetError(byteSize, this.maxCacheBytes);
    }
    this.reservedBytes += byteSize;
    const promise = Promise.resolve()
      .then(() =>
        this.backend.decodeTile(this.sessionId, this.sha256, rect, {
          priority: options.priority ?? "current",
          signal: options.signal,
        }),
      )
      .then((response) => {
        this.assertActive();
        if (
          response.sessionId !== this.sessionId ||
          response.sha256 !== this.sha256 ||
          response.rect.x !== rect.x ||
          response.rect.y !== rect.y ||
          response.rect.width !== rect.width ||
          response.rect.height !== rect.height ||
          !(response.alpha instanceof Uint8Array) ||
          response.alpha.length !== rect.width * rect.height
        )
          throw new SparseMaskTileStoreError("tile decode response does not match its request");
        for (const value of response.alpha) {
          if (value !== 0 && value !== 255) {
            throw new SparseMaskTileStoreError("tile decode response must contain binary alpha");
          }
        }
        const baseBits = packBits(response.alpha);
        const tile: SparseMaskTile = {
          key,
          tileX,
          tileY,
          ...rect,
          alpha: response.alpha,
          baseBits,
          currentBits: new Uint8Array(baseBits),
          byteSize,
          historyReferences: 0,
          viewportPinned: this.viewportKeys.has(key),
          dirty: false,
          revision: 0,
          lastAccess: ++this.accessCounter,
        };
        this.tiles.set(key, tile);
        this.retainedBytes += byteSize;
        this.tilesCreated += 1;
        this.admissionBlocked = false;
        return tile;
      })
      .finally(() => {
        this.reservedBytes -= byteSize;
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  beginHistoryCheckpoint(): MaskHistoryCheckpoint {
    this.assertActive();
    return new MaskHistoryCheckpoint(this.width, this.height);
  }

  finishHistoryCheckpoint(
    checkpoint: MaskHistoryCheckpoint,
    name: string,
    sourceRevision: number,
  ): MaskHistoryCommand | null {
    this.assertActive();
    return checkpoint.finish(name, sourceRevision, (tileX, tileY) => {
      const tile = this.tiles.get(keyFor(tileX, tileY));
      if (!tile)
        throw new SparseMaskTileStoreError("history checkpoint tile is no longer materialized");
      return tile.alpha;
    });
  }

  private tileRange(bounds: SparseMaskViewportRect): Array<{ tileX: number; tileY: number }> {
    const x0 = Math.max(0, Math.floor(bounds.x));
    const y0 = Math.max(0, Math.floor(bounds.y));
    const x1 = Math.min(this.width, Math.ceil(bounds.x + bounds.width));
    const y1 = Math.min(this.height, Math.ceil(bounds.y + bounds.height));
    if (x1 <= x0 || y1 <= y0) return [];
    const tiles: Array<{ tileX: number; tileY: number }> = [];
    for (
      let tileY = Math.floor(y0 / MASK_HISTORY_TILE_SIZE);
      tileY <= Math.floor((y1 - 1) / MASK_HISTORY_TILE_SIZE);
      tileY += 1
    ) {
      for (
        let tileX = Math.floor(x0 / MASK_HISTORY_TILE_SIZE);
        tileX <= Math.floor((x1 - 1) / MASK_HISTORY_TILE_SIZE);
        tileX += 1
      ) {
        tiles.push({ tileX, tileY });
      }
    }
    return tiles;
  }

  private refreshCurrentBits(
    tile: SparseMaskTile,
    bounds: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    for (let y = bounds.y0; y < bounds.y1; y += 1) {
      const row = y * tile.width;
      for (let x = bounds.x0; x < bounds.x1; x += 1) {
        const index = row + x;
        setBit(tile.currentBits, index, tile.alpha[index] !== 0);
      }
    }
    this.markTileChanged(tile);
  }

  private markTileChanged(tile: SparseMaskTile): void {
    tile.dirty = !bitsEqual(tile.currentBits, tile.baseBits);
    tile.revision += 1;
    tile.lastAccess = ++this.accessCounter;
    this.mutationGeneration += 1;
  }

  private async materializeCoords(
    coords: readonly { tileX: number; tileY: number }[],
    options: { priority: RasterMaskWorkerPriority; signal?: AbortSignal },
  ): Promise<SparseMaskRenderableTile[]> {
    const materialized: SparseMaskRenderableTile[] = [];
    for (let index = 0; index < coords.length; index += MAX_CONCURRENT_TILE_DECODES) {
      materialized.push(
        ...(await Promise.all(
          coords
            .slice(index, index + MAX_CONCURRENT_TILE_DECODES)
            .map(({ tileX, tileY }) => this.materializeTile(tileX, tileY, options)),
        )),
      );
    }
    return materialized;
  }

  async brush(options: {
    cx: number;
    cy: number;
    radius: number;
    value: 0 | 255;
    shape: MaskRasterBrushShape;
    checkpoint?: MaskHistoryCheckpoint;
    signal?: AbortSignal;
  }): Promise<number> {
    const radius = Math.max(0.5, options.radius);
    const tiles = this.tileRange({
      x: options.cx - radius,
      y: options.cy - radius,
      width: radius * 2 + 1,
      height: radius * 2 + 1,
    });
    const materialized = await this.materializeCoords(tiles, {
      priority: "editing",
      signal: options.signal,
    });
    let changedPixels = 0;
    for (const value of materialized) {
      const tile = value as SparseMaskTile;
      options.checkpoint?.captureTile(tile.tileX, tile.tileY, tile.width, tile.height, tile.alpha);
      const change = rasterizeMaskBrush(tile.alpha, tile.width, tile.height, {
        cx: options.cx,
        cy: options.cy,
        radius: options.radius,
        value: options.value,
        shape: options.shape,
        originX: tile.x,
        originY: tile.y,
      });
      changedPixels += change.changedPixels;
      if (change.changedPixels > 0 && change.touchedBounds) {
        this.refreshCurrentBits(tile, change.touchedBounds);
      }
    }
    return changedPixels;
  }

  async lasso(
    points: ReadonlyArray<readonly [number, number]>,
    value: 0 | 255,
    options: { checkpoint?: MaskHistoryCheckpoint; signal?: AbortSignal } = {},
  ): Promise<number> {
    if (points.length < 3) return 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new SparseMaskTileStoreError("lasso points must be finite");
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const coords = this.tileRange({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
    });
    const materialized = await this.materializeCoords(coords, {
      priority: "editing",
      signal: options.signal,
    });
    let changedPixels = 0;
    for (const valueTile of materialized) {
      const tile = valueTile as SparseMaskTile;
      options.checkpoint?.captureTile(tile.tileX, tile.tileY, tile.width, tile.height, tile.alpha);
      const change = rasterizeMaskPolygon(
        tile.alpha,
        tile.width,
        tile.height,
        points,
        value,
        tile.x,
        tile.y,
      );
      changedPixels += change.changedPixels;
      if (change.changedPixels > 0 && change.touchedBounds) {
        this.refreshCurrentBits(tile, change.touchedBounds);
      }
    }
    return changedPixels;
  }

  async morphologyRoi(
    rect: SparseMaskViewportRect,
    operation: {
      operation: MaskMorphologyOperation;
      kernelShape: MaskKernelShape;
      radius: number;
    },
    options: {
      name: string;
      sourceRevision: number;
      signal?: AbortSignal;
    },
  ): Promise<MaskHistoryCommand | null> {
    this.assertActive();
    const coreX0 = Math.max(0, Math.floor(rect.x));
    const coreY0 = Math.max(0, Math.floor(rect.y));
    const coreX1 = Math.min(this.width, Math.ceil(rect.x + rect.width));
    const coreY1 = Math.min(this.height, Math.ceil(rect.y + rect.height));
    if (coreX1 <= coreX0 || coreY1 <= coreY0) {
      throw new LargeMaskFullScanRequiredError(
        "current viewport does not contain an editable Mask ROI",
      );
    }
    const passes = operation.operation === "open" || operation.operation === "close" ? 2 : 1;
    const halo = operation.radius * passes;
    const inputX0 = Math.max(0, coreX0 - halo);
    const inputY0 = Math.max(0, coreY0 - halo);
    const inputX1 = Math.min(this.width, coreX1 + halo);
    const inputY1 = Math.min(this.height, coreY1 + halo);
    const inputWidth = inputX1 - inputX0;
    const inputHeight = inputY1 - inputY0;
    if (inputWidth * inputHeight > MAX_ROI_PIXELS) {
      throw new LargeMaskFullScanRequiredError(
        `viewport ROI plus halo exceeds the ${MAX_ROI_PIXELS}-pixel compute budget`,
      );
    }

    const core = {
      x: coreX0,
      y: coreY0,
      width: coreX1 - coreX0,
      height: coreY1 - coreY0,
    };
    const input = { x: inputX0, y: inputY0, width: inputWidth, height: inputHeight };
    const coreCoords = this.tileRange(core);
    await this.materializeCoords(coreCoords, {
      priority: "editing",
      signal: options.signal,
    });
    const expectedMutationGeneration = this.mutationGeneration;
    const expectedRevisions = new Map<string, number>();
    for (const { tileX, tileY } of coreCoords) {
      const tile = this.tiles.get(keyFor(tileX, tileY));
      if (!tile) throw new SparseMaskTileStoreError("ROI core tile is no longer materialized");
      expectedRevisions.set(tile.key, tile.revision);
    }
    const dirtyOverrides = [...this.tiles.values()]
      .filter(
        (tile) =>
          tile.dirty &&
          tile.x < inputX1 &&
          tile.x + tile.width > inputX0 &&
          tile.y < inputY1 &&
          tile.y + tile.height > inputY0,
      )
      .map((tile) => ({
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        tileX: tile.tileX,
        tileY: tile.tileY,
        revision: tile.revision,
        bits: tile.currentBits,
      }));
    for (const override of dirtyOverrides) {
      expectedRevisions.set(keyFor(override.tileX, override.tileY), override.revision);
    }
    const compute = this.backend.getComputeResources?.();
    if (
      this.morphologyBackendPolicy === "webgpu-candidate" &&
      operation.operation === "dilate" &&
      operation.kernelShape === "square" &&
      operation.radius <= 31 &&
      inputWidth * inputHeight >= 4_194_304 &&
      (!compute || compute.webGpuState === "idle")
    ) {
      void this.backend.warmupWebGpu?.({ priority: "editing" }).catch(() => undefined);
    }
    const response = await this.backend.morphologyRoi(
      {
        sessionId: this.sessionId,
        sha256: this.sha256,
        sourceRevision: options.sourceRevision,
        core,
        input,
        operation,
        dirtyOverrides,
        backendPolicy: this.morphologyBackendPolicy,
        cpuComputeBudgetBytes: this.cpuComputeBudgetBytes,
        gpuBufferBudgetBytes: this.gpuBufferBudgetBytes,
      },
      { priority: "editing", signal: options.signal },
    );
    this.assertActive();
    if (this.mutationGeneration !== expectedMutationGeneration) {
      throw new SparseMaskTileStoreError("morphology source changed while the Worker was running");
    }
    if (
      response.sessionId !== this.sessionId ||
      response.sha256 !== this.sha256 ||
      response.sourceRevision !== options.sourceRevision
    ) {
      throw new SparseMaskTileStoreError("morphology response belongs to a stale session");
    }
    for (const [key, revision] of expectedRevisions) {
      if (this.tiles.get(key)?.revision !== revision) {
        throw new SparseMaskTileStoreError(
          "morphology source changed while the Worker was running",
        );
      }
    }

    const seenPatches = new Set<string>();
    let validatedChangedPixels = 0;
    let minChangedX = this.width;
    let minChangedY = this.height;
    let maxChangedX = -1;
    let maxChangedY = -1;
    for (const patch of response.patches) {
      const key = keyFor(patch.tileX, patch.tileY);
      if (seenPatches.has(key)) {
        throw new SparseMaskTileStoreError("morphology response contains duplicate tile patches");
      }
      seenPatches.add(key);
      const tile = this.tiles.get(key);
      if (!tile || tile.width !== patch.width || tile.height !== patch.height) {
        throw new SparseMaskTileStoreError("morphology patch dimensions do not match the tile");
      }
      if (
        !(patch.xorBits instanceof Uint8Array) ||
        patch.xorBits.length !== Math.ceil((patch.width * patch.height) / 8) ||
        !patchHasOnlyValidBits(patch)
      ) {
        throw new SparseMaskTileStoreError("morphology patch bitset is invalid");
      }
      let patchChangedPixels = 0;
      forEachPatchBit(patch, (index) => {
        const x = tile.x + (index % tile.width);
        const y = tile.y + Math.floor(index / tile.width);
        if (x < coreX0 || x >= coreX1 || y < coreY0 || y >= coreY1) {
          throw new SparseMaskTileStoreError("morphology patch writes outside the core ROI");
        }
        patchChangedPixels += 1;
        validatedChangedPixels += 1;
        minChangedX = Math.min(minChangedX, x);
        minChangedY = Math.min(minChangedY, y);
        maxChangedX = Math.max(maxChangedX, x);
        maxChangedY = Math.max(maxChangedY, y);
      });
      if (patchChangedPixels === 0) {
        throw new SparseMaskTileStoreError("morphology response contains an empty tile patch");
      }
    }
    const validatedBounds =
      validatedChangedPixels === 0
        ? null
        : {
            x: minChangedX,
            y: minChangedY,
            width: maxChangedX - minChangedX + 1,
            height: maxChangedY - minChangedY + 1,
          };
    if (
      response.changedPixels !== validatedChangedPixels ||
      JSON.stringify(response.changedBounds) !== JSON.stringify(validatedBounds)
    ) {
      throw new SparseMaskTileStoreError("morphology response summary does not match its patches");
    }
    const command = createMaskHistoryCommandFromPatches(
      options.name,
      options.sourceRevision,
      response.patches,
    );
    if ((command?.changedPixels ?? 0) !== response.changedPixels) {
      throw new SparseMaskTileStoreError("morphology history command does not match its response");
    }
    if (!command) return null;
    this.applyValidatedPatches(command.patches);
    return command;
  }

  private applyValidatedPatches(patches: readonly MaskHistoryPatch[]): void {
    for (const patch of patches) {
      const tile = this.tiles.get(keyFor(patch.tileX, patch.tileY))!;
      for (let byteIndex = 0; byteIndex < patch.xorBits.length; byteIndex += 1) {
        tile.currentBits[byteIndex] ^= patch.xorBits[byteIndex];
      }
      forEachPatchBit(patch, (index) => {
        tile.alpha[index] = bitIsSet(tile.currentBits, index) ? 255 : 0;
      });
      this.markTileChanged(tile);
    }
  }

  retainHistoryCommand(command: MaskHistoryCommand): void {
    for (const patch of command.patches) {
      const tile = this.tiles.get(keyFor(patch.tileX, patch.tileY));
      if (!tile) throw new SparseMaskTileStoreError("cannot retain history for an evicted tile");
      tile.historyReferences += 1;
    }
  }

  releaseHistoryCommand(command: MaskHistoryCommand): void {
    for (const patch of command.patches) {
      const tile = this.tiles.get(keyFor(patch.tileX, patch.tileY));
      if (!tile) continue;
      tile.historyReferences = Math.max(0, tile.historyReferences - 1);
      if (tile.historyReferences === 0 && !tile.dirty && !tile.viewportPinned) this.evictTile(tile);
    }
  }

  applyHistoryCommand(command: MaskHistoryCommand): void {
    this.assertActive();
    for (const patch of command.patches) {
      const tile = this.tiles.get(keyFor(patch.tileX, patch.tileY));
      if (!tile) throw new SparseMaskTileStoreError("history tile is no longer materialized");
      if (tile.width !== patch.width || tile.height !== patch.height) {
        throw new SparseMaskTileStoreError("history patch dimensions do not match the tile");
      }
      if (
        !(patch.xorBits instanceof Uint8Array) ||
        patch.xorBits.length !== Math.ceil((patch.width * patch.height) / 8) ||
        !patchHasOnlyValidBits(patch)
      ) {
        throw new SparseMaskTileStoreError("history patch bitset is invalid");
      }
    }
    this.applyValidatedPatches(command.patches);
  }

  containsPixel(x: number, y: number): boolean {
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height
    ) {
      return false;
    }
    const tileX = Math.floor(x / MASK_HISTORY_TILE_SIZE);
    const tileY = Math.floor(y / MASK_HISTORY_TILE_SIZE);
    const tile = this.tiles.get(keyFor(tileX, tileY));
    if (!tile) return this.baseIndex.contains(x, y);
    tile.lastAccess = ++this.accessCounter;
    return tile.alpha[(y - tile.y) * tile.width + x - tile.x] !== 0;
  }

  setViewport(rect: SparseMaskViewportRect | null): RasterMaskTileRect[] {
    this.assertActive();
    let coords: Array<{ tileX: number; tileY: number }> = [];
    if (rect) {
      const visible = this.tileRange(rect);
      const expanded = new Map<string, { tileX: number; tileY: number }>();
      const maxTileX = Math.ceil(this.width / MASK_HISTORY_TILE_SIZE) - 1;
      const maxTileY = Math.ceil(this.height / MASK_HISTORY_TILE_SIZE) - 1;
      for (const tile of visible) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const tileX = tile.tileX + dx;
            const tileY = tile.tileY + dy;
            if (tileX < 0 || tileY < 0 || tileX > maxTileX || tileY > maxTileY) continue;
            expanded.set(keyFor(tileX, tileY), { tileX, tileY });
          }
        }
      }
      coords = [...expanded.values()];
      this.overviewOnly = coords.length > MAX_VIEWPORT_MATERIALIZED_TILES;
      if (this.overviewOnly) coords = [];
    } else {
      this.overviewOnly = false;
    }
    this.viewportKeys = new Set(coords.map(({ tileX, tileY }) => keyFor(tileX, tileY)));
    for (const tile of this.tiles.values()) tile.viewportPinned = this.viewportKeys.has(tile.key);
    return coords.map(({ tileX, tileY }) => this.tileRect(tileX, tileY));
  }

  async loadViewport(signal?: AbortSignal): Promise<void> {
    const coords = [...this.viewportKeys].map((key) => {
      const [tileY, tileX] = key.split(":").map(Number);
      return { tileX, tileY };
    });
    const results = await Promise.allSettled(
      coords.map(({ tileX, tileY }) =>
        this.materializeTile(tileX, tileY, { priority: "prefetch", signal }),
      ),
    );
    const unexpected = results.find(
      (result) =>
        result.status === "rejected" && !(result.reason instanceof SparseMaskTileBudgetError),
    );
    this.admissionBlocked = results.some(
      (result) =>
        result.status === "rejected" && result.reason instanceof SparseMaskTileBudgetError,
    );
    if (unexpected?.status === "rejected") throw unexpected.reason;
  }

  getRenderableTiles(): SparseMaskRenderableTile[] {
    return [...this.tiles.values()]
      .sort((left, right) => left.tileY - right.tileY || left.tileX - right.tileX)
      .map((tile) => ({
        key: tile.key,
        tileX: tile.tileX,
        tileY: tile.tileY,
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        alpha: tile.alpha,
        revision: tile.revision,
        dirty: tile.dirty,
      }));
  }

  async merge(options: { signal?: AbortSignal } = {}): Promise<CocoRle> {
    this.assertActive();
    const overrides = [...this.tiles.values()]
      .filter((tile) => tile.dirty)
      .map((tile) => ({
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        alpha: tile.alpha,
      }));
    const response = await this.backend.mergeTiles(this.sessionId, this.sha256, overrides, {
      priority: "editing",
      signal: options.signal,
    });
    if (response.sessionId !== this.sessionId || response.sha256 !== this.sha256) {
      throw new SparseMaskTileStoreError("tile merge response belongs to a stale session");
    }
    if (response.rle.size[0] !== this.height || response.rle.size[1] !== this.width) {
      throw new SparseMaskTileStoreError("tile merge response dimensions do not match the store");
    }
    return {
      encoding: "coco_rle",
      size: [response.rle.size[0], response.rle.size[1]],
      counts: Array.from(response.rle.counts),
    };
  }

  snapshot(): SparseMaskTileResources {
    const values = [...this.tiles.values()];
    return {
      maxBytes: this.maxCacheBytes,
      retainedBytes: this.retainedBytes,
      reservedBytes: this.reservedBytes,
      liveTiles: values.length,
      dirtyTiles: values.filter((tile) => tile.dirty).length,
      viewportPinnedTiles: values.filter((tile) => tile.viewportPinned).length,
      historyReferencedTiles: values.filter((tile) => tile.historyReferences > 0).length,
      decodeInFlight: this.inFlight.size,
      tilesCreated: this.tilesCreated,
      tilesEvicted: this.tilesEvicted,
      overviewOnly: this.overviewOnly,
      admissionBlocked: this.admissionBlocked,
      compute: this.backend.getComputeResources?.() ?? null,
      disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.backend.releaseSession(this.sessionId);
    this.tiles.clear();
    this.viewportKeys.clear();
    this.retainedBytes = 0;
  }
}
