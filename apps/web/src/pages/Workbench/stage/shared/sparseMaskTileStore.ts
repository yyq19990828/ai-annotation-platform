import type { CocoRle } from "./geometry/maskRle";
import {
  rasterizeMaskBrush,
  rasterizeMaskPolygon,
  type MaskRasterBrushShape,
} from "./geometry/maskRasterization";
import {
  applyMaskMorphology,
  type MaskKernelShape,
  type MaskMorphologyOperation,
} from "./geometry/maskOperations";
import {
  MaskHistoryCheckpoint,
  MASK_HISTORY_TILE_SIZE,
  type MaskHistoryCommand,
} from "./maskHistory";
import type { RasterMaskWorkerPriority, RasterMaskWorkerRunOptions } from "./rasterMaskWorkerPool";
import type {
  RasterMaskTileOverride,
  RasterMaskTileRect,
  RasterMaskTransferredRle,
} from "./rasterMaskWorkerProtocol";

const MIB = 1024 * 1024;
const TILE_METADATA_BYTES = 96;
const MAX_VIEWPORT_MATERIALIZED_TILES = 16;
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
  disposed: boolean;
}

interface SparseMaskTile extends SparseMaskRenderableTile {
  baseBits: Uint8Array;
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

function navigatorTileBudgetBytes(): number {
  if (typeof navigator === "undefined") return sparseMaskTileBudgetBytes();
  const value = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  return sparseMaskTileBudgetBytes(typeof value === "number" ? value : undefined);
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

  constructor(options: {
    sessionId: string;
    sha256: string;
    baseRle: CocoRle;
    backend: SparseMaskTileBackend;
    maxCacheBytes?: number;
    deviceMemory?: number | null;
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
    return pixels + Math.ceil(pixels / 8) + TILE_METADATA_BYTES;
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
        const tile: SparseMaskTile = {
          key,
          tileX,
          tileY,
          ...rect,
          alpha: response.alpha,
          baseBits: packBits(response.alpha),
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

  private refreshDirty(tile: SparseMaskTile): void {
    let matchesBase = true;
    for (let index = 0; index < tile.alpha.length; index += 1) {
      if ((tile.alpha[index] !== 0) !== bitIsSet(tile.baseBits, index)) {
        matchesBase = false;
        break;
      }
    }
    tile.dirty = !matchesBase;
    tile.revision += 1;
    tile.lastAccess = ++this.accessCounter;
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
    const materialized = await Promise.all(
      tiles.map(({ tileX, tileY }) =>
        this.materializeTile(tileX, tileY, { priority: "editing", signal: options.signal }),
      ),
    );
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
      if (change.touchedBounds) this.refreshDirty(tile);
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
    const materialized = await Promise.all(
      coords.map(({ tileX, tileY }) =>
        this.materializeTile(tileX, tileY, { priority: "editing", signal: options.signal }),
      ),
    );
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
      if (change.touchedBounds) this.refreshDirty(tile);
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
    options: { checkpoint?: MaskHistoryCheckpoint; signal?: AbortSignal } = {},
  ): Promise<number> {
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
        `viewport ROI plus halo exceeds the ${MAX_ROI_PIXELS}-pixel synchronous budget`,
      );
    }

    const inputCoords = this.tileRange({
      x: inputX0,
      y: inputY0,
      width: inputWidth,
      height: inputHeight,
    });
    await Promise.all(
      inputCoords.map(({ tileX, tileY }) =>
        this.materializeTile(tileX, tileY, { priority: "editing", signal: options.signal }),
      ),
    );
    const source = new Uint8Array(inputWidth * inputHeight);
    for (let y = inputY0; y < inputY1; y += 1) {
      for (let x = inputX0; x < inputX1; x += 1) {
        const tileX = Math.floor(x / MASK_HISTORY_TILE_SIZE);
        const tileY = Math.floor(y / MASK_HISTORY_TILE_SIZE);
        const tile = this.tiles.get(keyFor(tileX, tileY));
        if (!tile) throw new SparseMaskTileStoreError("ROI tile is no longer materialized");
        source[(y - inputY0) * inputWidth + x - inputX0] =
          tile.alpha[(y - tile.y) * tile.width + x - tile.x];
      }
    }
    const after = applyMaskMorphology(source, inputWidth, inputHeight, operation).alpha;
    const coreCoords = this.tileRange({
      x: coreX0,
      y: coreY0,
      width: coreX1 - coreX0,
      height: coreY1 - coreY0,
    });
    for (const { tileX, tileY } of coreCoords) {
      const tile = this.tiles.get(keyFor(tileX, tileY));
      if (!tile) throw new SparseMaskTileStoreError("ROI core tile is no longer materialized");
      options.checkpoint?.captureTile(tile.tileX, tile.tileY, tile.width, tile.height, tile.alpha);
    }
    const touched = new Set<SparseMaskTile>();
    let changedPixels = 0;
    for (let y = coreY0; y < coreY1; y += 1) {
      for (let x = coreX0; x < coreX1; x += 1) {
        const tile = this.tiles.get(
          keyFor(Math.floor(x / MASK_HISTORY_TILE_SIZE), Math.floor(y / MASK_HISTORY_TILE_SIZE)),
        );
        if (!tile) throw new SparseMaskTileStoreError("ROI core tile is no longer materialized");
        const tileIndex = (y - tile.y) * tile.width + x - tile.x;
        const next = after[(y - inputY0) * inputWidth + x - inputX0];
        if (tile.alpha[tileIndex] === next) continue;
        tile.alpha[tileIndex] = next;
        touched.add(tile);
        changedPixels += 1;
      }
    }
    for (const tile of touched) this.refreshDirty(tile);
    return changedPixels;
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
      for (let index = 0; index < tile.alpha.length; index += 1) {
        if (!bitIsSet(patch.xorBits, index)) continue;
        tile.alpha[index] = tile.alpha[index] === 0 ? 255 : 0;
      }
      this.refreshDirty(tile);
    }
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
