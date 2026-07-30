import { MASK_HISTORY_TILE_SIZE } from "./maskHistory";
import type { RasterMaskPackedTileOverride } from "./rasterMaskWorkerProtocol";
import {
  buildRasterMaskPackedBaseTile,
  validatePackedTileOverride,
  validateRasterMaskMorphologyRoiRequest,
  type RasterMaskMorphologyRuntimeRequest,
  type RasterMaskPackedBaseTile,
  type RasterMaskPreparedPackedMorphologyRoi,
  type RasterMaskWorkerSession,
} from "./rasterMaskWorkerRuntime";

const MIB = 1024 * 1024;
const MAX_PACKED_BASE_CACHE_BYTES = 32 * MIB;

interface RasterMaskPackedBaseCacheEntry extends RasterMaskPackedBaseTile {
  key: string;
  sessionId: string;
  sha256: string;
  lastUsedSequence: number;
}

export interface RasterMaskPackedBaseCacheSnapshot {
  entries: number;
  retainedBytes: number;
  maxBytes: number;
  sourceScratchCapacityBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  fills: number;
  sessionPurges: number;
}

function runtimeNowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function lowBitsMask(bitCount: number): number {
  return bitCount === 32 ? 0xffff_ffff : 0xffff_ffff >>> (32 - bitCount);
}

function readWordPackedBits(
  words: Uint32Array,
  rowStart: number,
  wordsPerRow: number,
  bitOffset: number,
  bitCount: number,
): number {
  const wordIndex = bitOffset >>> 5;
  const shift = bitOffset & 31;
  const lower = words[rowStart + wordIndex] ?? 0;
  const upper = wordIndex + 1 < wordsPerRow ? words[rowStart + wordIndex + 1] : 0;
  const aligned = shift === 0 ? lower : (lower >>> shift) | (upper << (32 - shift));
  return (aligned & lowBitsMask(bitCount)) >>> 0;
}

function readBytePackedBits(bits: Uint8Array, bitOffset: number, bitCount: number): number {
  let value = 0;
  let written = 0;
  let offset = bitOffset;
  while (written < bitCount) {
    const shift = offset & 7;
    const take = Math.min(bitCount - written, 8 - shift);
    const mask = (1 << take) - 1;
    value |= ((bits[offset >>> 3] >>> shift) & mask) << written;
    written += take;
    offset += take;
  }
  return value >>> 0;
}

function writePackedBits(
  target: Uint32Array,
  targetWordIndex: number,
  targetShift: number,
  bitCount: number,
  value: number,
): void {
  const mask = (lowBitsMask(bitCount) << targetShift) >>> 0;
  target[targetWordIndex] =
    ((target[targetWordIndex] & ~mask) | ((value << targetShift) & mask)) >>> 0;
}

function copyWordPackedSpan(
  source: Uint32Array,
  sourceRow: number,
  sourceWordsPerRow: number,
  sourceBitOffset: number,
  target: Uint32Array,
  targetRow: number,
  targetWordsPerRow: number,
  targetBitOffset: number,
  bitLength: number,
): void {
  let copied = 0;
  while (copied < bitLength) {
    const targetOffset = targetBitOffset + copied;
    const targetShift = targetOffset & 31;
    const bitCount = Math.min(bitLength - copied, 32 - targetShift);
    const value = readWordPackedBits(
      source,
      sourceRow * sourceWordsPerRow,
      sourceWordsPerRow,
      sourceBitOffset + copied,
      bitCount,
    );
    writePackedBits(
      target,
      targetRow * targetWordsPerRow + (targetOffset >>> 5),
      targetShift,
      bitCount,
      value,
    );
    copied += bitCount;
  }
}

function copyBytePackedSpan(
  source: Uint8Array,
  sourceBitOffset: number,
  target: Uint32Array,
  targetRow: number,
  targetWordsPerRow: number,
  targetBitOffset: number,
  bitLength: number,
): void {
  let copied = 0;
  while (copied < bitLength) {
    const targetOffset = targetBitOffset + copied;
    const targetShift = targetOffset & 31;
    const bitCount = Math.min(bitLength - copied, 32 - targetShift);
    const value = readBytePackedBits(source, sourceBitOffset + copied, bitCount);
    writePackedBits(
      target,
      targetRow * targetWordsPerRow + (targetOffset >>> 5),
      targetShift,
      bitCount,
      value,
    );
    copied += bitCount;
  }
}

function clearUnusedRowBits(
  words: Uint32Array,
  width: number,
  height: number,
  wordsPerRow: number,
): void {
  const remainder = width & 31;
  if (remainder === 0) return;
  const mask = lowBitsMask(remainder);
  for (let y = 0; y < height; y += 1) {
    words[y * wordsPerRow + wordsPerRow - 1] &= mask;
  }
}

function nextScratchCapacityWords(requiredWords: number): number {
  if (!Number.isSafeInteger(requiredWords) || requiredWords <= 0) {
    throw new Error("packed source scratch length must be a positive safe integer");
  }
  let capacity = 1;
  while (capacity < requiredWords) {
    capacity *= 2;
    if (!Number.isSafeInteger(capacity)) {
      throw new Error("packed source scratch capacity exceeds the safe integer limit");
    }
  }
  return capacity;
}

export function rasterMaskPackedBaseCacheCapBytes(computeBudgetBytes: number): number {
  if (!Number.isSafeInteger(computeBudgetBytes) || computeBudgetBytes <= 0) return 0;
  return Math.min(MAX_PACKED_BASE_CACHE_BYTES, Math.floor(computeBudgetBytes / 4));
}

export class RasterMaskPackedBaseCache {
  private readonly entries = new Map<string, RasterMaskPackedBaseCacheEntry>();
  private retainedBytes = 0;
  private maxBytes = 0;
  private sourceScratch: Uint32Array | null = null;
  private sequence = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private fills = 0;
  private sessionPurges = 0;

  snapshot(): RasterMaskPackedBaseCacheSnapshot {
    return {
      entries: this.entries.size,
      retainedBytes: this.retainedBytes,
      maxBytes: this.maxBytes,
      sourceScratchCapacityBytes: this.sourceScratch?.byteLength ?? 0,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      fills: this.fills,
      sessionPurges: this.sessionPurges,
    };
  }

  prospectiveScratchCapacityBytes(requiredBytes: number): number {
    if (!Number.isSafeInteger(requiredBytes) || requiredBytes <= 0 || (requiredBytes & 3) !== 0) {
      throw new Error("packed source scratch bytes must be a positive multiple of four");
    }
    return Math.max(
      this.sourceScratch?.byteLength ?? 0,
      nextScratchCapacityWords(requiredBytes / 4) * 4,
    );
  }

  prepare(
    sessionId: string,
    session: RasterMaskWorkerSession,
    request: RasterMaskMorphologyRuntimeRequest,
    maxCacheBytes: number,
  ): RasterMaskPreparedPackedMorphologyRoi {
    if (!sessionId || !Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 0) {
      throw new Error("packed base cache preparation options are invalid");
    }
    validateRasterMaskMorphologyRoiRequest(session, request);
    const totalStarted = runtimeNowMs();
    this.maxBytes = maxCacheBytes;
    const evictionsBefore = this.evictions;
    this.trimToLimit(new Set());

    const wordsPerRow = Math.ceil(request.input.width / 32);
    const requiredWords = wordsPerRow * request.input.height;
    const scratchCapacityWords = nextScratchCapacityWords(requiredWords);
    if (!this.sourceScratch || this.sourceScratch.length < scratchCapacityWords) {
      this.sourceScratch = new Uint32Array(scratchCapacityWords);
    }
    const sourceWords = this.sourceScratch.subarray(0, requiredWords);
    sourceWords.fill(0);

    const tileX0 = Math.floor(request.input.x / MASK_HISTORY_TILE_SIZE);
    const tileY0 = Math.floor(request.input.y / MASK_HISTORY_TILE_SIZE);
    const tileX1 = Math.floor((request.input.x + request.input.width - 1) / MASK_HISTORY_TILE_SIZE);
    const tileY1 = Math.floor(
      (request.input.y + request.input.height - 1) / MASK_HISTORY_TILE_SIZE,
    );
    const protectedKeys = new Set<string>();
    for (let tileY = tileY0; tileY <= tileY1; tileY += 1) {
      for (let tileX = tileX0; tileX <= tileX1; tileX += 1) {
        protectedKeys.add(this.keyFor(sessionId, session.sha256, tileX, tileY));
      }
    }

    let requestHits = 0;
    let requestMisses = 0;
    let baseCacheFillMs = 0;
    let packedAssembleMs = 0;
    for (let tileY = tileY0; tileY <= tileY1; tileY += 1) {
      for (let tileX = tileX0; tileX <= tileX1; tileX += 1) {
        const key = this.keyFor(sessionId, session.sha256, tileX, tileY);
        let tile: RasterMaskPackedBaseTile;
        const cached = this.entries.get(key);
        if (cached) {
          cached.lastUsedSequence = ++this.sequence;
          tile = cached;
          requestHits += 1;
          this.hits += 1;
        } else {
          const fillStarted = runtimeNowMs();
          const built = buildRasterMaskPackedBaseTile(session, tileX, tileY);
          baseCacheFillMs += runtimeNowMs() - fillStarted;
          requestMisses += 1;
          this.misses += 1;
          this.fills += 1;
          const entry: RasterMaskPackedBaseCacheEntry = {
            ...built,
            key,
            sessionId,
            sha256: session.sha256,
            lastUsedSequence: ++this.sequence,
          };
          if (this.admit(entry.byteSize, protectedKeys)) {
            this.entries.set(key, entry);
            this.retainedBytes += entry.byteSize;
            tile = entry;
          } else {
            tile = built;
          }
        }

        const x0 = Math.max(request.input.x, tile.x);
        const y0 = Math.max(request.input.y, tile.y);
        const x1 = Math.min(request.input.x + request.input.width, tile.x + tile.width);
        const y1 = Math.min(request.input.y + request.input.height, tile.y + tile.height);
        const assembleStarted = runtimeNowMs();
        for (let y = y0; y < y1; y += 1) {
          copyWordPackedSpan(
            tile.words,
            y - tile.y,
            tile.wordsPerRow,
            x0 - tile.x,
            sourceWords,
            y - request.input.y,
            wordsPerRow,
            x0 - request.input.x,
            x1 - x0,
          );
        }
        packedAssembleMs += runtimeNowMs() - assembleStarted;
      }
    }

    const dirtyStarted = runtimeNowMs();
    this.applyDirtyOverrides(session, request, sourceWords, wordsPerRow);
    clearUnusedRowBits(sourceWords, request.input.width, request.input.height, wordsPerRow);
    const dirtyOverlayMs = runtimeNowMs() - dirtyStarted;
    return {
      sourceWords,
      wordsPerRow,
      packedPrepareMs: runtimeNowMs() - totalStarted,
      prepareStrategy: "packed-cache",
      directRleScanMs: 0,
      baseCacheFillMs,
      packedAssembleMs,
      dirtyOverlayMs,
      baseCacheHitTiles: requestHits,
      baseCacheMissTiles: requestMisses,
      baseCacheEvictedTiles: this.evictions - evictionsBefore,
      baseCacheRetainedBytes: this.retainedBytes,
      sourceScratchCapacityBytes: this.sourceScratch.byteLength,
    };
  }

  releaseSession(sessionId: string): void {
    let removed = false;
    for (const [key, entry] of this.entries) {
      if (entry.sessionId !== sessionId) continue;
      this.entries.delete(key);
      this.retainedBytes -= entry.byteSize;
      removed = true;
    }
    if (removed) this.sessionPurges += 1;
  }

  clear(): void {
    this.entries.clear();
    this.retainedBytes = 0;
    this.maxBytes = 0;
    this.sourceScratch = null;
  }

  private keyFor(sessionId: string, sha256: string, tileX: number, tileY: number): string {
    return `${sessionId}\u0000${sha256}\u0000${tileY}:${tileX}`;
  }

  private admit(additionalBytes: number, protectedKeys: ReadonlySet<string>): boolean {
    if (additionalBytes > this.maxBytes) return false;
    while (this.retainedBytes + additionalBytes > this.maxBytes) {
      const candidate = this.evictionCandidate(protectedKeys);
      if (!candidate) return false;
      this.entries.delete(candidate.key);
      this.retainedBytes -= candidate.byteSize;
      this.evictions += 1;
    }
    return true;
  }

  private trimToLimit(protectedKeys: ReadonlySet<string>): void {
    while (this.retainedBytes > this.maxBytes) {
      const candidate = this.evictionCandidate(protectedKeys);
      if (!candidate) break;
      this.entries.delete(candidate.key);
      this.retainedBytes -= candidate.byteSize;
      this.evictions += 1;
    }
  }

  private evictionCandidate(
    protectedKeys: ReadonlySet<string>,
  ): RasterMaskPackedBaseCacheEntry | null {
    let candidate: RasterMaskPackedBaseCacheEntry | null = null;
    for (const entry of this.entries.values()) {
      if (protectedKeys.has(entry.key)) continue;
      if (!candidate || entry.lastUsedSequence < candidate.lastUsedSequence) candidate = entry;
    }
    return candidate;
  }

  private applyDirtyOverrides(
    session: RasterMaskWorkerSession,
    request: RasterMaskMorphologyRuntimeRequest,
    target: Uint32Array,
    targetWordsPerRow: number,
  ): void {
    const seen = new Set<string>();
    for (const tile of request.dirtyOverrides) {
      validatePackedTileOverride(session, tile);
      const key = `${tile.tileY}:${tile.tileX}`;
      if (seen.has(key)) throw new Error("packed mask tile overrides contain duplicates");
      seen.add(key);
      this.copyDirtyIntersection(tile, request, target, targetWordsPerRow);
    }
  }

  private copyDirtyIntersection(
    tile: RasterMaskPackedTileOverride,
    request: RasterMaskMorphologyRuntimeRequest,
    target: Uint32Array,
    targetWordsPerRow: number,
  ): void {
    const x0 = Math.max(request.input.x, tile.x);
    const y0 = Math.max(request.input.y, tile.y);
    const x1 = Math.min(request.input.x + request.input.width, tile.x + tile.width);
    const y1 = Math.min(request.input.y + request.input.height, tile.y + tile.height);
    if (x1 <= x0 || y1 <= y0) return;
    for (let y = y0; y < y1; y += 1) {
      copyBytePackedSpan(
        tile.bits,
        (y - tile.y) * tile.width + x0 - tile.x,
        target,
        y - request.input.y,
        targetWordsPerRow,
        x0 - request.input.x,
        x1 - x0,
      );
    }
  }
}
