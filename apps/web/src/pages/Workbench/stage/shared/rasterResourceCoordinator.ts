const MIB = 1024 * 1024;

export type RasterResourceCategory =
  | "background-coverage"
  | "background-detail"
  | "background-prefetch"
  | "mask-render"
  | "mask-edit"
  | "mask-history"
  | "mask-compare"
  | "worker-base-cache"
  | "worker-scratch"
  | "cpu-transient"
  | "gpu-buffer";

export type RasterResourcePriority = 0 | 1 | 2 | 3 | 4 | 5;
export type RasterResourcePressureReason =
  | "soft-budget"
  | "hard-budget"
  | "foreground-operation"
  | "hidden"
  | "bfcache"
  | "manual";
export type RasterResourceDeviceTier = "low" | "standard" | "high";

export interface RasterResourceDeviceBudget {
  tier: RasterResourceDeviceTier;
  softBudgetBytes: number;
  hardBudgetBytes: number;
  hiddenFreezeMs: number;
}

export function rasterResourceDeviceBudget(
  deviceMemory?: number | null,
): RasterResourceDeviceBudget {
  if (
    deviceMemory != null &&
    Number.isFinite(deviceMemory) &&
    deviceMemory > 0 &&
    deviceMemory <= 2
  ) {
    return {
      tier: "low",
      softBudgetBytes: 144 * MIB,
      hardBudgetBytes: 192 * MIB,
      hiddenFreezeMs: 10_000,
    };
  }
  if (deviceMemory != null && Number.isFinite(deviceMemory) && deviceMemory >= 8) {
    return {
      tier: "high",
      softBudgetBytes: 576 * MIB,
      hardBudgetBytes: 768 * MIB,
      hiddenFreezeMs: 30_000,
    };
  }
  return {
    tier: "standard",
    softBudgetBytes: 288 * MIB,
    hardBudgetBytes: 384 * MIB,
    hiddenFreezeMs: 15_000,
  };
}

export interface RasterResourceRequest {
  owner: string;
  category: RasterResourceCategory;
  priority: RasterResourcePriority;
  bytes: number;
  reconstructible: boolean;
  pinned: boolean;
  generation?: number;
}

export interface RasterResourceReservation {
  readonly id: string;
  readonly owner: string;
  readonly generation: number;
  readonly category: RasterResourceCategory;
  readonly priority: RasterResourcePriority;
  readonly bytes: number;
  readonly state: "reserved" | "committed" | "released";
  commit(actualBytes?: number): boolean;
  update(
    patch: Partial<
      Pick<RasterResourceRequest, "category" | "priority" | "bytes" | "reconstructible" | "pinned">
    >,
  ): boolean;
  release(): void;
}

export interface RasterResourceEvictor {
  owner: string;
  evictableBytes(): number;
  evict(targetBytes: number, reason: RasterResourcePressureReason): Promise<number> | number;
  pausePrefetch?(reason: RasterResourcePressureReason): void;
  resumePrefetch?(generation: number): void;
}

export interface RasterResourceOwnerSnapshot {
  owner: string;
  committedBytes: number;
  reservedBytes: number;
  evictableBytes: number;
  pinnedBytes: number;
}

export interface RasterResourceCategorySnapshot {
  category: RasterResourceCategory;
  committedBytes: number;
  reservedBytes: number;
  evictableBytes: number;
  pinnedBytes: number;
}

export interface WorkbenchRasterResourceSnapshot {
  tier: RasterResourceDeviceTier;
  generation: number;
  softBudgetBytes: number;
  hardBudgetBytes: number;
  committedBytes: number;
  reservedBytes: number;
  chargedBytes: number;
  peakChargedBytes: number;
  pressureLevel: "normal" | "soft" | "hard" | "foreground" | "hidden";
  pressureReason: RasterResourcePressureReason | null;
  foregroundOperations: number;
  visible: boolean;
  hiddenSheds: number;
  evictionRounds: number;
  evictedBytes: number;
  deniedAdmissions: number;
  staleCommits: number;
  releasedReservations: number;
  owners: RasterResourceOwnerSnapshot[];
  categories: RasterResourceCategorySnapshot[];
  invariantOk: boolean;
  disposed: boolean;
}

interface AllocationRecord extends RasterResourceRequest {
  id: string;
  generation: number;
  state: "reserved" | "committed";
}

interface RasterResourceCoordinatorOptions {
  budget?: RasterResourceDeviceBudget;
  deviceMemory?: number | null;
  generation?: number;
}

function positiveSafeBytes(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function pressureTimeout<T>(promise: Promise<T>, timeoutMs = 16): Promise<T | undefined> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    }, timeoutMs);
    void promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timeout);
        resolve(undefined);
      },
    );
  });
}

export class RasterResourceCoordinator {
  private readonly budget: RasterResourceDeviceBudget;
  private readonly allocations = new Map<string, AllocationRecord>();
  private readonly evictors = new Map<string, RasterResourceEvictor>();
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private generationValue: number;
  private peakChargedBytes = 0;
  private foregroundOperations = 0;
  private visible = true;
  private disposed = false;
  private inPressure = false;
  private prefetchPaused = false;
  private bfcacheSuspended = false;
  private pressureReason: RasterResourcePressureReason | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenSheds = 0;
  private evictionRounds = 0;
  private evictedBytes = 0;
  private deniedAdmissions = 0;
  private staleCommits = 0;
  private releasedReservations = 0;

  constructor(options: RasterResourceCoordinatorOptions = {}) {
    this.budget = options.budget ?? rasterResourceDeviceBudget(options.deviceMemory);
    this.generationValue = options.generation ?? 1;
    if (!Number.isSafeInteger(this.generationValue) || this.generationValue <= 0) {
      throw new Error("Raster resource generation must be a positive safe integer");
    }
    positiveSafeBytes(this.budget.softBudgetBytes, "Raster resource soft budget");
    positiveSafeBytes(this.budget.hardBudgetBytes, "Raster resource hard budget");
    if (this.budget.softBudgetBytes > this.budget.hardBudgetBytes) {
      throw new Error("Raster resource soft budget cannot exceed the hard budget");
    }
  }

  get generation(): number {
    return this.generationValue;
  }

  get hardBudgetBytes(): number {
    return this.budget.hardBudgetBytes;
  }

  get availableBytes(): number {
    return Math.max(0, this.budget.hardBudgetBytes - this.chargedBytes());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  registerEvictor(evictor: RasterResourceEvictor): () => void {
    if (this.disposed) return () => undefined;
    const existing = this.evictors.get(evictor.owner);
    if (existing && existing !== evictor) {
      throw new Error(`Raster resource owner already registered: ${evictor.owner}`);
    }
    this.evictors.set(evictor.owner, evictor);
    if (this.prefetchPaused) evictor.pausePrefetch?.(this.pressureReason ?? "soft-budget");
    return () => {
      if (this.evictors.get(evictor.owner) === evictor) this.evictors.delete(evictor.owner);
    };
  }

  tryReserve(request: RasterResourceRequest): RasterResourceReservation | null {
    this.assertRequest(request);
    if (this.disposed || this.inPressure || this.bfcacheSuspended) {
      this.deniedAdmissions += 1;
      this.notify();
      return null;
    }
    const generation = request.generation ?? this.generationValue;
    if (generation !== this.generationValue) {
      this.deniedAdmissions += 1;
      this.notify();
      return null;
    }
    this.maybeApplySoftPressure(request.bytes);
    if (this.chargedBytes() + request.bytes > this.budget.hardBudgetBytes) {
      this.applyPressureSync(request.bytes, request.priority, "hard-budget");
    }
    if (this.chargedBytes() + request.bytes > this.budget.hardBudgetBytes) {
      this.deniedAdmissions += 1;
      this.pressureReason = "hard-budget";
      this.notify();
      return null;
    }
    return this.createReservation({ ...request, generation });
  }

  async reserve(request: RasterResourceRequest): Promise<RasterResourceReservation | null> {
    const immediate = this.tryReserve(request);
    if (immediate) return immediate;
    if (this.disposed || this.inPressure || this.bfcacheSuspended) return null;
    const generation = request.generation ?? this.generationValue;
    if (generation !== this.generationValue) return null;
    await this.applyPressureAsync(request.bytes, request.priority, "hard-budget");
    if (this.disposed || generation !== this.generationValue) return null;
    if (this.chargedBytes() + request.bytes > this.budget.hardBudgetBytes) return null;
    this.deniedAdmissions = Math.max(0, this.deniedAdmissions - 1);
    return this.createReservation({ ...request, generation });
  }

  beginForegroundOperation(): () => void {
    if (this.disposed) return () => undefined;
    this.foregroundOperations += 1;
    this.pressureReason = "foreground-operation";
    this.pausePrefetch("foreground-operation");
    this.applyPressureSync(0, 0, "foreground-operation", 4);
    this.notify();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.foregroundOperations = Math.max(0, this.foregroundOperations - 1);
      this.maybeResumePrefetch();
      this.notify();
    };
  }

  setVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    if (this.hiddenTimer) {
      globalThis.clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    if (!visible) {
      this.pressureReason = "hidden";
      this.pausePrefetch("hidden");
      this.hiddenTimer = globalThis.setTimeout(() => {
        this.hiddenTimer = null;
        if (!this.visible && !this.disposed) {
          this.hiddenSheds += 1;
          this.applyPressureSync(0, 0, "hidden", 2);
          this.notify();
        }
      }, this.budget.hiddenFreezeMs);
    } else {
      this.maybeResumePrefetch();
    }
    this.notify();
  }

  handlePageHide(persisted: boolean): void {
    if (this.disposed) return;
    if (!persisted) {
      this.dispose();
      return;
    }
    this.bfcacheSuspended = true;
    this.pausePrefetch("bfcache");
    this.shedForBfcache();
    this.advanceGeneration(true);
  }

  handlePageShow(persisted: boolean): void {
    if (this.disposed || !persisted) return;
    this.bfcacheSuspended = false;
    this.visible = true;
    this.maybeResumePrefetch();
    this.notify();
  }

  advanceGeneration(preservePinned = false): number {
    if (this.disposed) return this.generationValue;
    this.generationValue += 1;
    for (const [id, allocation] of this.allocations) {
      if (
        preservePinned &&
        allocation.state === "committed" &&
        allocation.pinned &&
        !allocation.reconstructible
      ) {
        allocation.generation = this.generationValue;
      } else {
        this.allocations.delete(id);
        this.releasedReservations += 1;
      }
    }
    this.updatePeak();
    this.notify();
    return this.generationValue;
  }

  requestPressure(reason: RasterResourcePressureReason = "manual"): number {
    const before = this.chargedBytes();
    this.applyPressureSync(0, 0, reason, 1);
    return Math.max(0, before - this.chargedBytes());
  }

  getSnapshot(): WorkbenchRasterResourceSnapshot {
    let committedBytes = 0;
    let reservedBytes = 0;
    const owners = new Map<string, RasterResourceOwnerSnapshot>();
    const categories = new Map<RasterResourceCategory, RasterResourceCategorySnapshot>();
    for (const allocation of this.allocations.values()) {
      if (allocation.state === "committed") committedBytes += allocation.bytes;
      else reservedBytes += allocation.bytes;
      const owner = owners.get(allocation.owner) ?? {
        owner: allocation.owner,
        committedBytes: 0,
        reservedBytes: 0,
        evictableBytes: 0,
        pinnedBytes: 0,
      };
      const category = categories.get(allocation.category) ?? {
        category: allocation.category,
        committedBytes: 0,
        reservedBytes: 0,
        evictableBytes: 0,
        pinnedBytes: 0,
      };
      if (allocation.state === "committed") {
        owner.committedBytes += allocation.bytes;
        category.committedBytes += allocation.bytes;
      } else {
        owner.reservedBytes += allocation.bytes;
        category.reservedBytes += allocation.bytes;
      }
      if (allocation.reconstructible && !allocation.pinned) {
        owner.evictableBytes += allocation.bytes;
        category.evictableBytes += allocation.bytes;
      }
      if (allocation.pinned) {
        owner.pinnedBytes += allocation.bytes;
        category.pinnedBytes += allocation.bytes;
      }
      owners.set(allocation.owner, owner);
      categories.set(allocation.category, category);
    }
    const chargedBytes = committedBytes + reservedBytes;
    return {
      tier: this.budget.tier,
      generation: this.generationValue,
      softBudgetBytes: this.budget.softBudgetBytes,
      hardBudgetBytes: this.budget.hardBudgetBytes,
      committedBytes,
      reservedBytes,
      chargedBytes,
      peakChargedBytes: this.peakChargedBytes,
      pressureLevel: !this.visible
        ? "hidden"
        : this.foregroundOperations > 0
          ? "foreground"
          : chargedBytes >= this.budget.hardBudgetBytes
            ? "hard"
            : chargedBytes >= this.budget.softBudgetBytes
              ? "soft"
              : "normal",
      pressureReason: this.pressureReason,
      foregroundOperations: this.foregroundOperations,
      visible: this.visible,
      hiddenSheds: this.hiddenSheds,
      evictionRounds: this.evictionRounds,
      evictedBytes: this.evictedBytes,
      deniedAdmissions: this.deniedAdmissions,
      staleCommits: this.staleCommits,
      releasedReservations: this.releasedReservations,
      owners: [...owners.values()].sort((left, right) => left.owner.localeCompare(right.owner)),
      categories: [...categories.values()].sort((left, right) =>
        left.category.localeCompare(right.category),
      ),
      invariantOk: chargedBytes <= this.budget.hardBudgetBytes,
      disposed: this.disposed,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.hiddenTimer) globalThis.clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
    this.pausePrefetch("manual");
    this.allocations.clear();
    this.evictors.clear();
    this.notify();
    this.listeners.clear();
  }

  private createReservation(
    record: Omit<AllocationRecord, "id" | "state">,
  ): RasterResourceReservation {
    const id = `rr-${this.generationValue}-${++this.sequence}`;
    this.allocations.set(id, { ...record, id, state: "reserved" });
    if (this.chargedBytes() >= this.budget.softBudgetBytes) {
      this.pressureReason = "soft-budget";
      this.pausePrefetch("soft-budget");
    }
    this.updatePeak();
    this.notify();
    return new ReservationHandle(this, id);
  }

  private assertRequest(request: RasterResourceRequest): void {
    if (!request.owner.trim()) throw new Error("Raster resource owner is required");
    positiveSafeBytes(request.bytes, "Raster resource bytes");
    if (!Number.isInteger(request.priority) || request.priority < 0 || request.priority > 5) {
      throw new Error("Raster resource priority must be between P0 and P5");
    }
  }

  private committedAndReserved(): { committed: number; reserved: number } {
    let committed = 0;
    let reserved = 0;
    for (const allocation of this.allocations.values()) {
      if (allocation.state === "committed") committed += allocation.bytes;
      else reserved += allocation.bytes;
    }
    return { committed, reserved };
  }

  private chargedBytes(): number {
    const usage = this.committedAndReserved();
    return usage.committed + usage.reserved;
  }

  private updatePeak(): void {
    this.peakChargedBytes = Math.max(this.peakChargedBytes, this.chargedBytes());
  }

  private maybeApplySoftPressure(additionalBytes: number): void {
    if (this.chargedBytes() + additionalBytes < this.budget.softBudgetBytes) return;
    this.pressureReason = "soft-budget";
    this.pausePrefetch("soft-budget");
    this.applyPressureSync(0, 0, "soft-budget", 4);
  }

  private evictorCandidates(requestPriority: RasterResourcePriority): RasterResourceEvictor[] {
    const maxPriorityByOwner = new Map<string, number>();
    for (const allocation of this.allocations.values()) {
      if (
        allocation.state !== "committed" ||
        allocation.pinned ||
        !allocation.reconstructible ||
        allocation.priority <= requestPriority
      ) {
        continue;
      }
      maxPriorityByOwner.set(
        allocation.owner,
        Math.max(maxPriorityByOwner.get(allocation.owner) ?? -1, allocation.priority),
      );
    }
    return [...this.evictors.values()]
      .filter((evictor) => (maxPriorityByOwner.get(evictor.owner) ?? -1) > requestPriority)
      .sort(
        (left, right) =>
          (maxPriorityByOwner.get(right.owner) ?? -1) -
            (maxPriorityByOwner.get(left.owner) ?? -1) ||
          right.evictableBytes() - left.evictableBytes(),
      );
  }

  private applyPressureSync(
    requestedBytes: number,
    requestPriority: RasterResourcePriority,
    reason: RasterResourcePressureReason,
    targetMinimumPriority?: RasterResourcePriority,
  ): void {
    if (this.inPressure || this.disposed) return;
    this.inPressure = true;
    this.pressureReason = reason;
    this.evictionRounds += 1;
    try {
      const target = Math.max(
        0,
        this.chargedBytes() + requestedBytes - this.budget.hardBudgetBytes,
      );
      let remaining = target;
      const effectivePriority =
        targetMinimumPriority == null
          ? requestPriority
          : ((targetMinimumPriority - 1) as RasterResourcePriority);
      for (const evictor of this.evictorCandidates(effectivePriority)) {
        const before = this.chargedBytes();
        const requestedEviction =
          target === 0 ? Math.max(evictor.evictableBytes(), 1) : Math.max(remaining, 1);
        const result = evictor.evict(requestedEviction, reason);
        if (result instanceof Promise) continue;
        const freed = Math.max(0, before - this.chargedBytes());
        this.evictedBytes += freed;
        remaining = Math.max(0, remaining - freed);
        if (target > 0 && remaining === 0) break;
      }
    } finally {
      this.inPressure = false;
      this.maybeResumePrefetch();
      this.notify();
    }
  }

  private shedForBfcache(): void {
    if (this.inPressure || this.disposed) return;
    this.inPressure = true;
    this.pressureReason = "bfcache";
    this.evictionRounds += 1;
    try {
      for (const evictor of this.evictors.values()) {
        const before = this.chargedBytes();
        const result = evictor.evict(Number.MAX_SAFE_INTEGER, "bfcache");
        if (result instanceof Promise) continue;
        this.evictedBytes += Math.max(0, before - this.chargedBytes());
      }
    } finally {
      this.inPressure = false;
      this.notify();
    }
  }

  private async applyPressureAsync(
    requestedBytes: number,
    requestPriority: RasterResourcePriority,
    reason: RasterResourcePressureReason,
  ): Promise<void> {
    if (this.inPressure || this.disposed) return;
    this.inPressure = true;
    this.pressureReason = reason;
    this.evictionRounds += 1;
    try {
      let remaining = Math.max(
        0,
        this.chargedBytes() + requestedBytes - this.budget.hardBudgetBytes,
      );
      for (const evictor of this.evictorCandidates(requestPriority)) {
        const before = this.chargedBytes();
        const result = evictor.evict(Math.max(remaining, 1), reason);
        if (result instanceof Promise) await pressureTimeout(result);
        const freed = Math.max(0, before - this.chargedBytes());
        this.evictedBytes += freed;
        remaining = Math.max(0, remaining - freed);
        if (remaining === 0) break;
      }
    } finally {
      this.inPressure = false;
      this.maybeResumePrefetch();
      this.notify();
    }
  }

  private pausePrefetch(reason: RasterResourcePressureReason): void {
    if (this.prefetchPaused) return;
    this.prefetchPaused = true;
    for (const evictor of this.evictors.values()) evictor.pausePrefetch?.(reason);
  }

  private maybeResumePrefetch(): void {
    if (
      !this.prefetchPaused ||
      !this.visible ||
      this.bfcacheSuspended ||
      this.foregroundOperations > 0 ||
      this.chargedBytes() >= this.budget.softBudgetBytes
    ) {
      return;
    }
    this.prefetchPaused = false;
    this.pressureReason = null;
    for (const evictor of this.evictors.values()) {
      evictor.resumePrefetch?.(this.generationValue);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  allocation(id: string): AllocationRecord | undefined {
    return this.allocations.get(id);
  }

  commit(id: string, generation: number, actualBytes?: number): boolean {
    const allocation = this.allocations.get(id);
    if (!allocation) {
      if (!this.disposed && generation !== this.generationValue) {
        this.staleCommits += 1;
        this.notify();
      }
      return false;
    }
    if (allocation.state !== "reserved") return false;
    if (
      this.disposed ||
      generation !== this.generationValue ||
      allocation.generation !== generation
    ) {
      this.allocations.delete(id);
      this.staleCommits += 1;
      this.releasedReservations += 1;
      this.notify();
      return false;
    }
    const nextBytes = actualBytes ?? allocation.bytes;
    positiveSafeBytes(nextBytes, "Raster resource committed bytes");
    const additional = Math.max(0, nextBytes - allocation.bytes);
    if (additional > 0 && this.chargedBytes() + additional > this.budget.hardBudgetBytes) {
      this.applyPressureSync(additional, allocation.priority, "hard-budget");
    }
    if (this.chargedBytes() + additional > this.budget.hardBudgetBytes) {
      this.allocations.delete(id);
      this.deniedAdmissions += 1;
      this.releasedReservations += 1;
      this.pressureReason = "hard-budget";
      this.notify();
      return false;
    }
    allocation.bytes = nextBytes;
    allocation.state = "committed";
    this.updatePeak();
    this.notify();
    return true;
  }

  update(
    id: string,
    generation: number,
    patch: Partial<
      Pick<RasterResourceRequest, "category" | "priority" | "bytes" | "reconstructible" | "pinned">
    >,
  ): boolean {
    const allocation = this.allocations.get(id);
    if (!allocation || allocation.generation !== generation || this.disposed) return false;
    if (patch.bytes != null) {
      positiveSafeBytes(patch.bytes, "Raster resource updated bytes");
      const additional = Math.max(0, patch.bytes - allocation.bytes);
      if (additional > 0 && this.chargedBytes() + additional > this.budget.hardBudgetBytes) {
        this.applyPressureSync(additional, patch.priority ?? allocation.priority, "hard-budget");
      }
      if (this.chargedBytes() + additional > this.budget.hardBudgetBytes) return false;
      allocation.bytes = patch.bytes;
    }
    if (patch.priority != null) allocation.priority = patch.priority;
    if (patch.category != null) allocation.category = patch.category;
    if (patch.reconstructible != null) allocation.reconstructible = patch.reconstructible;
    if (patch.pinned != null) allocation.pinned = patch.pinned;
    this.updatePeak();
    this.notify();
    return true;
  }

  replaceCommittedResources(
    current: readonly RasterResourceReservation[],
    requests: readonly RasterResourceRequest[],
  ): RasterResourceReservation[] | null {
    if (this.disposed || this.inPressure || this.bfcacheSuspended) return null;
    const currentIds = new Set(current.map((resource) => resource.id));
    if (currentIds.size !== current.length) {
      throw new Error("Raster resource replacement cannot contain duplicate allocations");
    }
    for (const request of requests) {
      this.assertRequest(request);
      if ((request.generation ?? this.generationValue) !== this.generationValue) return null;
    }
    const currentRecords = [...currentIds].map((id) => this.allocations.get(id));
    if (
      currentRecords.some(
        (record) =>
          !record || record.state !== "committed" || record.generation !== this.generationValue,
      )
    ) {
      return null;
    }
    const releasedBytes = currentRecords.reduce((total, record) => total + (record?.bytes ?? 0), 0);
    const requestedBytes = requests.reduce((total, request) => {
      const next = total + request.bytes;
      if (!Number.isSafeInteger(next)) {
        throw new Error("Raster resource replacement bytes exceed the safe integer limit");
      }
      return next;
    }, 0);
    const additional = Math.max(0, requestedBytes - releasedBytes);
    if (this.chargedBytes() + additional > this.budget.hardBudgetBytes) {
      const priority = requests.reduce<RasterResourcePriority>(
        (highest, request) => Math.min(highest, request.priority) as RasterResourcePriority,
        5,
      );
      this.applyPressureSync(additional, priority, "hard-budget");
    }
    const refreshedRecords = [...currentIds].map((id) => this.allocations.get(id));
    if (
      refreshedRecords.some(
        (record) =>
          !record || record.state !== "committed" || record.generation !== this.generationValue,
      )
    ) {
      return null;
    }
    const refreshedReleasedBytes = refreshedRecords.reduce(
      (total, record) => total + (record?.bytes ?? 0),
      0,
    );
    if (
      this.chargedBytes() - refreshedReleasedBytes + requestedBytes >
      this.budget.hardBudgetBytes
    ) {
      this.deniedAdmissions += 1;
      this.pressureReason = "hard-budget";
      this.notify();
      return null;
    }

    for (const id of currentIds) this.allocations.delete(id);
    this.releasedReservations += currentIds.size;
    const replacements: RasterResourceReservation[] = [];
    for (const request of requests) {
      const id = `rr-${this.generationValue}-${++this.sequence}`;
      this.allocations.set(id, {
        ...request,
        id,
        generation: this.generationValue,
        state: "committed",
      });
      replacements.push(new ReservationHandle(this, id));
    }
    this.updatePeak();
    this.maybeResumePrefetch();
    this.notify();
    return replacements;
  }

  release(id: string): void {
    if (!this.allocations.delete(id)) return;
    this.releasedReservations += 1;
    this.maybeResumePrefetch();
    this.notify();
  }
}

class ReservationHandle implements RasterResourceReservation {
  private readonly initialOwner: string;
  private readonly initialGeneration: number;
  private readonly initialCategory: RasterResourceCategory;
  private readonly initialPriority: RasterResourcePriority;
  private released = false;

  constructor(
    private readonly coordinator: RasterResourceCoordinator,
    readonly id: string,
  ) {
    const record = coordinator.allocation(id);
    if (!record) throw new Error("Raster resource reservation was not created");
    this.initialOwner = record.owner;
    this.initialGeneration = record.generation;
    this.initialCategory = record.category;
    this.initialPriority = record.priority;
  }

  private get record(): AllocationRecord | undefined {
    return this.coordinator.allocation(this.id);
  }

  get owner(): string {
    return this.record?.owner ?? this.initialOwner;
  }

  get generation(): number {
    return this.record?.generation ?? this.initialGeneration;
  }

  get category(): RasterResourceCategory {
    return this.record?.category ?? this.initialCategory;
  }

  get priority(): RasterResourcePriority {
    return this.record?.priority ?? this.initialPriority;
  }

  get bytes(): number {
    return this.record?.bytes ?? 0;
  }

  get state(): "reserved" | "committed" | "released" {
    return this.record?.state ?? "released";
  }

  commit(actualBytes?: number): boolean {
    if (this.released) return false;
    const committed = this.coordinator.commit(this.id, this.initialGeneration, actualBytes);
    if (!committed && !this.record) this.released = true;
    return committed;
  }

  update(
    patch: Partial<
      Pick<RasterResourceRequest, "category" | "priority" | "bytes" | "reconstructible" | "pinned">
    >,
  ): boolean {
    const generation = this.generation;
    return generation > 0 && this.coordinator.update(this.id, generation, patch);
  }

  release(): void {
    this.released = true;
    this.coordinator.release(this.id);
  }
}
