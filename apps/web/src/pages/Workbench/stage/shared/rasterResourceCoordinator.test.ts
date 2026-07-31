import { describe, expect, it, vi } from "vitest";
import {
  RasterResourceCoordinator,
  rasterResourceDeviceBudget,
  type RasterResourceReservation,
} from "./rasterResourceCoordinator";

const MIB = 1024 * 1024;

function coordinator(hardBudgetBytes = 100): RasterResourceCoordinator {
  return new RasterResourceCoordinator({
    budget: {
      tier: "standard",
      softBudgetBytes: Math.floor(hardBudgetBytes * 0.75),
      hardBudgetBytes,
      hiddenFreezeMs: 10,
    },
  });
}

describe("rasterResourceDeviceBudget", () => {
  it("freezes low, standard, and high task-scoped budgets", () => {
    expect(rasterResourceDeviceBudget(2)).toMatchObject({
      tier: "low",
      softBudgetBytes: 144 * MIB,
      hardBudgetBytes: 192 * MIB,
    });
    expect(rasterResourceDeviceBudget(null)).toMatchObject({
      tier: "standard",
      softBudgetBytes: 288 * MIB,
      hardBudgetBytes: 384 * MIB,
    });
    expect(rasterResourceDeviceBudget(8)).toMatchObject({
      tier: "high",
      softBudgetBytes: 576 * MIB,
      hardBudgetBytes: 768 * MIB,
    });
  });
});

describe("RasterResourceCoordinator", () => {
  it("atomically hands a reservation to committed usage without double charge", () => {
    const resources = coordinator();
    const reservation = resources.tryReserve({
      owner: "background",
      category: "background-detail",
      priority: 2,
      bytes: 40,
      reconstructible: true,
      pinned: false,
    });
    expect(reservation).not.toBeNull();
    expect(resources.getSnapshot()).toMatchObject({
      reservedBytes: 40,
      committedBytes: 0,
      chargedBytes: 40,
    });
    expect(reservation!.commit(35)).toBe(true);
    expect(resources.getSnapshot()).toMatchObject({
      reservedBytes: 0,
      committedBytes: 35,
      chargedBytes: 35,
      invariantOk: true,
    });
    reservation!.release();
    reservation!.release();
    expect(resources.getSnapshot().chargedBytes).toBe(0);
  });

  it("atomically replaces transient and retained charges with exact retained resources", () => {
    const resources = coordinator();
    const retained = resources.tryReserve({
      owner: "worker",
      category: "worker-base-cache",
      priority: 3,
      bytes: 30,
      reconstructible: true,
      pinned: false,
    })!;
    const transient = resources.tryReserve({
      owner: "worker",
      category: "cpu-transient",
      priority: 1,
      bytes: 50,
      reconstructible: true,
      pinned: true,
    })!;
    retained.commit();
    transient.commit();

    const replacements = resources.replaceCommittedResources(
      [retained, transient],
      [
        {
          owner: "worker",
          category: "worker-base-cache",
          priority: 3,
          bytes: 45,
          reconstructible: true,
          pinned: false,
        },
        {
          owner: "worker",
          category: "worker-scratch",
          priority: 3,
          bytes: 25,
          reconstructible: true,
          pinned: false,
        },
      ],
    );

    expect(replacements).toHaveLength(2);
    expect(retained.state).toBe("released");
    expect(transient.state).toBe("released");
    expect(resources.getSnapshot()).toMatchObject({
      chargedBytes: 70,
      peakChargedBytes: 80,
      invariantOk: true,
    });
  });

  it("releases a candidate when actual committed bytes cannot be admitted", () => {
    const resources = coordinator();
    const truth = resources.tryReserve({
      owner: "truth",
      category: "mask-edit",
      priority: 0,
      bytes: 70,
      reconstructible: false,
      pinned: true,
    })!;
    const candidate = resources.tryReserve({
      owner: "candidate",
      category: "cpu-transient",
      priority: 1,
      bytes: 20,
      reconstructible: true,
      pinned: true,
    })!;
    truth.commit();

    expect(candidate.commit(40)).toBe(false);
    expect(candidate.state).toBe("released");
    expect(resources.getSnapshot()).toMatchObject({
      chargedBytes: 70,
      reservedBytes: 0,
      deniedAdmissions: 1,
      invariantOk: true,
    });
  });

  it("evicts lower-priority reconstructible work before admitting foreground truth", () => {
    const resources = coordinator(100);
    const cached: RasterResourceReservation[] = [];
    resources.registerEvictor({
      owner: "background",
      evictableBytes: () => cached.reduce((total, item) => total + item.bytes, 0),
      evict: (target) => {
        let freed = 0;
        while (cached.length > 0 && freed < target) {
          const item = cached.shift()!;
          freed += item.bytes;
          item.release();
        }
        return freed;
      },
    });
    const detail = resources.tryReserve({
      owner: "background",
      category: "background-prefetch",
      priority: 4,
      bytes: 70,
      reconstructible: true,
      pinned: false,
    })!;
    detail.commit();
    cached.push(detail);

    const truth = resources.tryReserve({
      owner: "mask-editor",
      category: "mask-edit",
      priority: 0,
      bytes: 60,
      reconstructible: false,
      pinned: true,
    });
    expect(truth).not.toBeNull();
    expect(detail.state).toBe("released");
    expect(resources.getSnapshot()).toMatchObject({
      committedBytes: 0,
      reservedBytes: 60,
      evictedBytes: 70,
      invariantOk: true,
    });
  });

  it("denies admission when only pinned truth remains", () => {
    const resources = coordinator(100);
    const truth = resources.tryReserve({
      owner: "mask-editor",
      category: "mask-history",
      priority: 0,
      bytes: 80,
      reconstructible: false,
      pinned: true,
    })!;
    truth.commit();
    expect(
      resources.tryReserve({
        owner: "worker",
        category: "cpu-transient",
        priority: 0,
        bytes: 30,
        reconstructible: true,
        pinned: true,
      }),
    ).toBeNull();
    expect(resources.getSnapshot()).toMatchObject({
      chargedBytes: 80,
      deniedAdmissions: 1,
      invariantOk: true,
    });
  });

  it("rejects stale commits and releases the old generation charge", () => {
    const resources = coordinator();
    const reservation = resources.tryReserve({
      owner: "background",
      category: "background-detail",
      priority: 2,
      bytes: 40,
      reconstructible: true,
      pinned: false,
    })!;
    resources.advanceGeneration();
    expect(reservation.commit()).toBe(false);
    expect(resources.getSnapshot()).toMatchObject({
      chargedBytes: 0,
      staleCommits: 1,
      invariantOk: true,
    });
  });

  it("keeps only non-reconstructible pinned truth across BFCache generation changes", () => {
    const resources = coordinator();
    const truth = resources.tryReserve({
      owner: "mask-history",
      category: "mask-history",
      priority: 0,
      bytes: 30,
      reconstructible: false,
      pinned: true,
    })!;
    const visibleBitmap = resources.tryReserve({
      owner: "background",
      category: "background-coverage",
      priority: 1,
      bytes: 40,
      reconstructible: true,
      pinned: true,
    })!;
    truth.commit();
    visibleBitmap.commit();

    resources.handlePageHide(true);
    expect(resources.getSnapshot()).toMatchObject({
      generation: 2,
      committedBytes: 30,
      invariantOk: true,
    });
    expect(truth.state).toBe("committed");
    expect(visibleBitmap.state).toBe("released");
    expect(
      resources.replaceCommittedResources(
        [truth],
        [
          {
            owner: "worker",
            category: "worker-scratch",
            priority: 3,
            bytes: 20,
            reconstructible: true,
            pinned: false,
          },
        ],
      ),
    ).toBeNull();
    expect(truth.state).toBe("committed");
  });

  it("pauses P4/P5 during foreground work and resumes only after pressure clears", () => {
    const resources = coordinator();
    const pause = vi.fn();
    const resume = vi.fn();
    resources.registerEvictor({
      owner: "background",
      evictableBytes: () => 0,
      evict: () => 0,
      pausePrefetch: pause,
      resumePrefetch: resume,
    });
    const end = resources.beginForegroundOperation();
    expect(pause).toHaveBeenCalledWith("foreground-operation");
    end();
    expect(resume).toHaveBeenCalledWith(resources.generation);
  });

  it("sheds reconstructible resources after the hidden freeze threshold", () => {
    vi.useFakeTimers();
    try {
      const resources = coordinator();
      const detail = resources.tryReserve({
        owner: "background",
        category: "background-detail",
        priority: 3,
        bytes: 40,
        reconstructible: true,
        pinned: false,
      })!;
      detail.commit();
      resources.registerEvictor({
        owner: "background",
        evictableBytes: () => detail.bytes,
        evict: () => {
          const bytes = detail.bytes;
          detail.release();
          return bytes;
        },
      });
      resources.setVisible(false);
      vi.advanceTimersByTime(10);
      expect(resources.getSnapshot()).toMatchObject({
        visible: false,
        hiddenSheds: 1,
        chargedBytes: 0,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maintains the hard invariant under randomized reserve/commit/grow/release", () => {
    const resources = coordinator(512);
    const live: RasterResourceReservation[] = [];
    let seed = 0x23_24;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    for (let step = 0; step < 2_000; step += 1) {
      const action = Math.floor(random() * 4);
      if (action === 0 || live.length === 0) {
        const reservation = resources.tryReserve({
          owner: `owner-${Math.floor(random() * 3)}`,
          category: "cpu-transient",
          priority: Math.floor(random() * 6) as 0 | 1 | 2 | 3 | 4 | 5,
          bytes: 1 + Math.floor(random() * 32),
          reconstructible: true,
          pinned: false,
        });
        if (reservation) live.push(reservation);
      } else {
        const index = Math.floor(random() * live.length);
        const reservation = live[index];
        if (action === 1 && reservation.state === "reserved") {
          reservation.commit(Math.max(1, reservation.bytes + Math.floor(random() * 9) - 4));
        } else if (action === 2 && reservation.state !== "released") {
          reservation.update({
            bytes: Math.max(1, reservation.bytes + Math.floor(random() * 7) - 3),
          });
        } else {
          reservation.release();
          live.splice(index, 1);
        }
      }
      expect(resources.getSnapshot().invariantOk).toBe(true);
    }
    for (const reservation of live) reservation.release();
    expect(resources.getSnapshot().chargedBytes).toBe(0);
  });

  it("true dispose returns all logical usage to zero", () => {
    const resources = coordinator();
    resources
      .tryReserve({
        owner: "worker",
        category: "gpu-buffer",
        priority: 5,
        bytes: 50,
        reconstructible: true,
        pinned: false,
      })!
      .commit();
    resources.dispose();
    expect(resources.getSnapshot()).toMatchObject({
      committedBytes: 0,
      reservedBytes: 0,
      chargedBytes: 0,
      disposed: true,
      invariantOk: true,
    });
  });
});
