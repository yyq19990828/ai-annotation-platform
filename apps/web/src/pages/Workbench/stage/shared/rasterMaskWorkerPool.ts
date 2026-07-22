import type { CocoRle } from "./geometry/maskRle";
import type { MaskInstanceOperationPlan, MaskInstanceOperationSpec } from "./geometry/maskInstanceOperations";
import type { MaskOperationResult, MaskOperationSpec } from "./geometry/maskOperations";
import type { RasterMaskAnalysis } from "./rasterMaskRender";
import type {
  RasterMaskOperationContext,
  RasterMaskTileOverride,
  RasterMaskTileRect,
  RasterMaskTransferredRle,
  RasterMaskWorkerControlRequest,
  RasterMaskWorkerJobKind,
  RasterMaskWorkerJobRequest,
  RasterMaskWorkerResponse,
} from "./rasterMaskWorkerProtocol";

export type RasterMaskWorkerPriority = "editing" | "selected" | "current" | "prefetch";
export type RasterMaskWorkerFactory = () => Worker;

export interface RasterMaskWorkerClock {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface RasterMaskWorkerPoolOptions {
  size?: number;
  queueLimit?: number;
  createWorker?: RasterMaskWorkerFactory;
  clock?: RasterMaskWorkerClock;
}

export interface RasterMaskWorkerRunOptions {
  priority?: RasterMaskWorkerPriority;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RasterMaskWorkerPoolSnapshot {
  size: number;
  liveWorkers: number;
  queued: number;
  running: number;
  workersCreated: number;
  workersTerminated: number;
  workersReplaced: number;
  completed: number;
  failed: number;
  cancelled: number;
  timedOut: number;
  sessions: number;
  disposed: boolean;
}

interface RegisteredSession {
  sha256: string;
  rle: RasterMaskTransferredRle;
}

interface PoolJob {
  id: number;
  kind: RasterMaskWorkerJobKind;
  priority: number;
  sequence: number;
  request: RasterMaskWorkerJobRequest;
  transfer: Transferable[];
  timeoutMs: number;
  signal?: AbortSignal;
  sessionId?: string;
  abort?: () => void;
  timer?: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  read: (response: RasterMaskWorkerResponse) => unknown;
}

interface WorkerSlot {
  index: number;
  worker: Worker | null;
  current: PoolJob | null;
}

const DEFAULT_QUEUE_LIMIT = 32;
const ANALYZE_TIMEOUT_MS = 15_000;
const OPERATION_TIMEOUT_MS = 30_000;
const TILE_MERGE_TIMEOUT_MS = 60_000;

const nativeClock: RasterMaskWorkerClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class RasterMaskWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RasterMaskWorkerError";
  }
}

export class RasterMaskWorkerCancelledError extends Error {
  constructor(message = "Raster Mask operation was cancelled") {
    super(message);
    this.name = "RasterMaskWorkerCancelledError";
  }
}

export class RasterMaskWorkerTimeoutError extends RasterMaskWorkerError {
  constructor(kind: RasterMaskWorkerJobKind, timeoutMs: number) {
    super(`Raster Mask Worker ${kind} timed out after ${timeoutMs} ms`);
    this.name = "RasterMaskWorkerTimeoutError";
  }
}

export class RasterMaskWorkerQueueFullError extends RasterMaskWorkerError {
  constructor(limit: number) {
    super(`Raster Mask Worker queue is full (${limit})`);
    this.name = "RasterMaskWorkerQueueFullError";
  }
}

function createDefaultWorker(): Worker {
  return new Worker(new URL("./rasterMask.worker.ts", import.meta.url), { type: "module" });
}

export function defaultRasterMaskWorkerPoolSize(): number {
  if (typeof navigator === "undefined") return 2;
  const value = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  return typeof value === "number" && value > 0 && value <= 2 ? 1 : 2;
}

function normalizedLimit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function priorityValue(priority: RasterMaskWorkerPriority | undefined): number {
  if (priority === "editing") return 0;
  if (priority === "selected") return 1;
  if (priority === "prefetch") return 3;
  return 2;
}

function transferableRle(rle: CocoRle): RasterMaskTransferredRle {
  const [height, width] = rle.size;
  const pixels = height * width;
  if (
    !Number.isSafeInteger(height)
    || height <= 0
    || !Number.isSafeInteger(width)
    || width <= 0
    || !Number.isSafeInteger(pixels)
    || pixels > 0xffff_ffff
  ) {
    throw new RasterMaskWorkerError("mask size cannot be represented by the Worker protocol");
  }
  const counts = new Uint32Array(rle.counts.length);
  let total = 0;
  for (let index = 0; index < rle.counts.length; index += 1) {
    const count = rle.counts[index];
    if (!Number.isSafeInteger(count) || count < 0 || count > 0xffff_ffff) {
      throw new RasterMaskWorkerError(`counts[${index}] cannot be transferred as Uint32`);
    }
    counts[index] = count;
    total += count;
    if (total > pixels) throw new RasterMaskWorkerError("sum(counts) exceeds height * width");
  }
  if (counts.length === 0 || total !== pixels) {
    throw new RasterMaskWorkerError("sum(counts) must equal height * width");
  }
  return { size: [rle.size[0], rle.size[1]], counts };
}

function copyTransferredRle(rle: RasterMaskTransferredRle): RasterMaskTransferredRle {
  return { size: [rle.size[0], rle.size[1]], counts: new Uint32Array(rle.counts) };
}

export class RasterMaskWorkerPool {
  private readonly size: number;
  private readonly queueLimit: number;
  private readonly createWorker: RasterMaskWorkerFactory;
  private readonly clock: RasterMaskWorkerClock;
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PoolJob[] = [];
  private readonly sessions = new Map<string, RegisteredSession>();
  private initialized = false;
  private disposed = false;
  private nextId = 0;
  private sequence = 0;
  private workersCreated = 0;
  private workersTerminated = 0;
  private workersReplaced = 0;
  private completed = 0;
  private failed = 0;
  private cancelled = 0;
  private timedOut = 0;

  constructor(options: RasterMaskWorkerPoolOptions = {}) {
    this.size = normalizedLimit(options.size, defaultRasterMaskWorkerPoolSize());
    this.queueLimit = normalizedLimit(options.queueLimit, DEFAULT_QUEUE_LIMIT);
    this.createWorker = options.createWorker ?? createDefaultWorker;
    this.clock = options.clock ?? nativeClock;
  }

  getSnapshot(): RasterMaskWorkerPoolSnapshot {
    return {
      size: this.size,
      liveWorkers: this.slots.filter((slot) => slot.worker).length,
      queued: this.queue.length,
      running: this.slots.filter((slot) => slot.current).length,
      workersCreated: this.workersCreated,
      workersTerminated: this.workersTerminated,
      workersReplaced: this.workersReplaced,
      completed: this.completed,
      failed: this.failed,
      cancelled: this.cancelled,
      timedOut: this.timedOut,
      sessions: this.sessions.size,
      disposed: this.disposed,
    };
  }

  analyze(rle: CocoRle, options: RasterMaskWorkerRunOptions = {}): Promise<RasterMaskAnalysis> {
    const transferred = transferableRle(rle);
    const id = ++this.nextId;
    return this.enqueue({
      id,
      kind: "analyze",
      request: { kind: "analyze", id, rle: transferred },
      transfer: [transferred.counts.buffer],
      timeoutMs: options.timeoutMs ?? ANALYZE_TIMEOUT_MS,
      options,
      read: (response) => {
        if (response.kind !== "analyze" || !response.ok) throw new RasterMaskWorkerError("invalid analyze response");
        return response.analysis;
      },
    });
  }

  executeOperation(
    rle: CocoRle,
    operation: MaskOperationSpec,
    context: RasterMaskOperationContext,
    options: RasterMaskWorkerRunOptions = {},
  ): Promise<{ context: RasterMaskOperationContext; result: MaskOperationResult }> {
    const transferred = transferableRle(rle);
    const id = ++this.nextId;
    return this.enqueue({
      id,
      kind: "operation",
      request: { kind: "operation", id, rle: transferred, operation, context },
      transfer: [transferred.counts.buffer],
      timeoutMs: options.timeoutMs ?? OPERATION_TIMEOUT_MS,
      options,
      read: (response) => {
        if (response.kind !== "operation" || !response.ok) throw new RasterMaskWorkerError("invalid operation response");
        return { context: response.context, result: response.result };
      },
    });
  }

  executeInstanceOperation(
    rle: CocoRle,
    operation: MaskInstanceOperationSpec,
    context: RasterMaskOperationContext,
    options: RasterMaskWorkerRunOptions = {},
  ): Promise<{ context: RasterMaskOperationContext; plan: MaskInstanceOperationPlan | null }> {
    const transferred = transferableRle(rle);
    const id = ++this.nextId;
    return this.enqueue({
      id,
      kind: "instance_operation",
      request: { kind: "instance_operation", id, rle: transferred, operation, context },
      transfer: [transferred.counts.buffer],
      timeoutMs: options.timeoutMs ?? OPERATION_TIMEOUT_MS,
      options,
      read: (response) => {
        if (response.kind !== "instance_operation" || !response.ok) {
          throw new RasterMaskWorkerError("invalid instance operation response");
        }
        return { context: response.context, plan: response.plan };
      },
    });
  }

  registerSession(sessionId: string, sha256: string, rle: CocoRle): void {
    if (this.disposed) throw new RasterMaskWorkerError("Raster Mask Worker pool is disposed");
    const current = this.sessions.get(sessionId);
    if (current?.sha256 === sha256) return;
    if (current) this.releaseSession(sessionId);
    this.ensureWorkers();
    this.sessions.set(sessionId, { sha256, rle: transferableRle(rle) });
    for (const slot of this.slots) this.replaySession(slot, sessionId);
  }

  releaseSession(sessionId: string): void {
    if (!this.sessions.delete(sessionId)) return;
    this.cancelSessionJobs(sessionId);
    const request: RasterMaskWorkerControlRequest = { kind: "release_session", sessionId };
    for (const slot of this.slots) this.postControl(slot, request, []);
  }

  decodeTile(
    sessionId: string,
    sha256: string,
    rect: RasterMaskTileRect,
    options: RasterMaskWorkerRunOptions = {},
  ): Promise<{ sessionId: string; sha256: string; rect: RasterMaskTileRect; alpha: Uint8Array }> {
    this.assertSession(sessionId, sha256);
    const id = ++this.nextId;
    return this.enqueue({
      id,
      kind: "tile_decode",
      request: { kind: "tile_decode", id, sessionId, sha256, rect },
      transfer: [],
      timeoutMs: options.timeoutMs ?? OPERATION_TIMEOUT_MS,
      options,
      sessionId,
      read: (response) => {
        if (response.kind !== "tile_decode" || !response.ok) {
          throw new RasterMaskWorkerError("invalid tile decode response");
        }
        return response;
      },
    });
  }

  mergeTiles(
    sessionId: string,
    sha256: string,
    tiles: readonly RasterMaskTileOverride[],
    options: RasterMaskWorkerRunOptions = {},
  ): Promise<{ sessionId: string; sha256: string; rle: RasterMaskTransferredRle }> {
    this.assertSession(sessionId, sha256);
    const transferredTiles = tiles.map((tile) => ({ ...tile, alpha: new Uint8Array(tile.alpha) }));
    const id = ++this.nextId;
    return this.enqueue({
      id,
      kind: "tile_merge",
      request: { kind: "tile_merge", id, sessionId, sha256, tiles: transferredTiles },
      transfer: transferredTiles.map((tile) => tile.alpha.buffer),
      timeoutMs: options.timeoutMs ?? TILE_MERGE_TIMEOUT_MS,
      options,
      sessionId,
      read: (response) => {
        if (response.kind !== "tile_merge" || !response.ok) {
          throw new RasterMaskWorkerError("invalid tile merge response");
        }
        return { sessionId: response.sessionId, sha256: response.sha256, rle: response.rle };
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new RasterMaskWorkerCancelledError("Raster Mask Worker pool was disposed");
    while (this.queue.length > 0) this.rejectQueued(this.queue.shift()!, error);
    for (const slot of this.slots) {
      if (slot.current) this.rejectRunning(slot, error, false);
      this.terminateSlotWorker(slot);
    }
    this.sessions.clear();
  }

  private enqueue<T>({
    id,
    kind,
    request,
    transfer,
    timeoutMs,
    options,
    sessionId,
    read,
  }: {
    id: number;
    kind: RasterMaskWorkerJobKind;
    request: RasterMaskWorkerJobRequest;
    transfer: Transferable[];
    timeoutMs: number;
    options: RasterMaskWorkerRunOptions;
    sessionId?: string;
    read: (response: RasterMaskWorkerResponse) => T;
  }): Promise<T> {
    if (this.disposed) return Promise.reject(new RasterMaskWorkerError("Raster Mask Worker pool is disposed"));
    if (options.signal?.aborted) return Promise.reject(new RasterMaskWorkerCancelledError());
    this.ensureWorkers();
    if (!this.slots.some((slot) => slot.worker)) {
      return Promise.reject(new RasterMaskWorkerError("Raster Mask Worker is unavailable"));
    }
    if (this.queue.length >= this.queueLimit) {
      return Promise.reject(new RasterMaskWorkerQueueFullError(this.queueLimit));
    }
    return new Promise<T>((resolve, reject) => {
      const job: PoolJob = {
        id,
        kind,
        priority: priorityValue(options.priority),
        sequence: ++this.sequence,
        request,
        transfer,
        timeoutMs,
        signal: options.signal,
        sessionId,
        resolve: (value) => resolve(value as T),
        reject,
        read,
      };
      if (job.signal) {
        job.abort = () => this.abortJob(job.id);
        job.signal.addEventListener("abort", job.abort, { once: true });
      }
      this.queue.push(job);
      this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
      this.pump();
    });
  }

  private ensureWorkers(): void {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    for (let index = 0; index < this.size; index += 1) {
      const slot: WorkerSlot = { index, worker: null, current: null };
      this.slots.push(slot);
      this.installWorker(slot, false);
    }
  }

  private installWorker(slot: WorkerSlot, replacement: boolean): void {
    if (this.disposed) return;
    try {
      const worker = this.createWorker();
      slot.worker = worker;
      this.workersCreated += 1;
      if (replacement) this.workersReplaced += 1;
      worker.onmessage = (event: MessageEvent<RasterMaskWorkerResponse>) => {
        if (slot.worker !== worker) return;
        this.handleResponse(slot, event.data);
      };
      worker.onerror = (event) => {
        if (slot.worker !== worker) return;
        this.rejectRunning(
          slot,
          new RasterMaskWorkerError(event.message || "Raster Mask Worker failed"),
          true,
        );
      };
      for (const sessionId of this.sessions.keys()) this.replaySession(slot, sessionId);
    } catch {
      slot.worker = null;
    }
  }

  private replaySession(slot: WorkerSlot, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || !slot.worker) return;
    const rle = copyTransferredRle(session.rle);
    this.postControl(slot, {
      kind: "register_session",
      sessionId,
      sha256: session.sha256,
      rle,
    }, [rle.counts.buffer]);
  }

  private postControl(
    slot: WorkerSlot,
    request: RasterMaskWorkerControlRequest,
    transfer: Transferable[],
  ): void {
    const worker = slot.worker;
    if (!worker) return;
    try {
      worker.postMessage(request, transfer);
    } catch (error) {
      if (slot.current) {
        this.rejectRunning(slot, new RasterMaskWorkerError(String(error)), true);
      } else {
        this.replaceWorker(slot);
      }
    }
  }

  private pump(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (!slot.worker || slot.current || this.queue.length === 0) continue;
      const job = this.queue.shift()!;
      slot.current = job;
      job.timer = this.clock.setTimeout(() => {
        if (slot.current?.id !== job.id) return;
        this.timedOut += 1;
        this.rejectRunning(slot, new RasterMaskWorkerTimeoutError(job.kind, job.timeoutMs), true);
      }, job.timeoutMs);
      try {
        slot.worker.postMessage(job.request, job.transfer);
      } catch (error) {
        this.rejectRunning(slot, new RasterMaskWorkerError(String(error)), true);
      }
    }
  }

  private handleResponse(slot: WorkerSlot, response: RasterMaskWorkerResponse): void {
    const job = slot.current;
    if (!job || response.id !== job.id || response.kind !== job.kind) return;
    this.cleanupJob(job);
    slot.current = null;
    if (!response.ok) {
      this.failed += 1;
      job.reject(new RasterMaskWorkerError(response.error));
    } else {
      try {
        job.resolve(job.read(response));
        this.completed += 1;
      } catch (error) {
        this.failed += 1;
        job.reject(error);
      }
    }
    this.pump();
  }

  private cleanupJob(job: PoolJob): void {
    if (job.timer !== undefined) this.clock.clearTimeout(job.timer);
    if (job.abort && job.signal) job.signal.removeEventListener("abort", job.abort);
  }

  private abortJob(id: number): void {
    const queuedIndex = this.queue.findIndex((job) => job.id === id);
    if (queuedIndex >= 0) {
      this.cancelled += 1;
      this.rejectQueued(this.queue.splice(queuedIndex, 1)[0], new RasterMaskWorkerCancelledError());
      return;
    }
    const slot = this.slots.find((candidate) => candidate.current?.id === id);
    if (!slot) return;
    this.cancelled += 1;
    this.rejectRunning(slot, new RasterMaskWorkerCancelledError(), true);
  }

  private rejectQueued(job: PoolJob, error: unknown): void {
    this.cleanupJob(job);
    job.reject(error);
  }

  private rejectRunning(slot: WorkerSlot, error: unknown, replace: boolean): void {
    const job = slot.current;
    if (job) {
      this.cleanupJob(job);
      slot.current = null;
      if (!(error instanceof RasterMaskWorkerCancelledError) && !(error instanceof RasterMaskWorkerTimeoutError)) {
        this.failed += 1;
      }
      job.reject(error);
    }
    if (replace) this.replaceWorker(slot);
    this.pump();
  }

  private replaceWorker(slot: WorkerSlot): void {
    this.terminateSlotWorker(slot);
    this.installWorker(slot, true);
    if (!this.slots.some((candidate) => candidate.worker)) {
      const error = new RasterMaskWorkerError("Raster Mask Worker is unavailable");
      while (this.queue.length > 0) this.rejectQueued(this.queue.shift()!, error);
    }
  }

  private terminateSlotWorker(slot: WorkerSlot): void {
    const worker = slot.worker;
    slot.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    this.workersTerminated += 1;
  }

  private assertSession(sessionId: string, sha256: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.sha256 !== sha256) {
      throw new RasterMaskWorkerError("Raster Mask Worker session is missing or stale");
    }
  }

  private cancelSessionJobs(sessionId: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index].sessionId !== sessionId) continue;
      this.cancelled += 1;
      this.rejectQueued(this.queue.splice(index, 1)[0], new RasterMaskWorkerCancelledError());
    }
    for (const slot of this.slots) {
      if (slot.current?.sessionId !== sessionId) continue;
      this.cancelled += 1;
      this.rejectRunning(slot, new RasterMaskWorkerCancelledError(), true);
    }
  }
}
