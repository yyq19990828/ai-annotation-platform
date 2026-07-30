import { describe, expect, it } from "vitest";
import { MaskBuffer } from "./geometry/maskBuffer";
import {
  chargeMaskHistoryPatches,
  createMaskHistoryCommandFromPatches,
  MaskHistoryCheckpoint,
  MaskHistoryStore,
  MASK_HISTORY_MAX_COMMANDS,
  MASK_HISTORY_TILE_SIZE,
  maskHistoryBudgetBytes,
  type MaskHistoryCommand,
} from "./maskHistory";

function applyCommand(buffer: MaskBuffer, command: MaskHistoryCommand): void {
  for (const patch of command.patches) {
    buffer.applyXorBits(
      patch.tileX * MASK_HISTORY_TILE_SIZE,
      patch.tileY * MASK_HISTORY_TILE_SIZE,
      patch.width,
      patch.height,
      patch.xorBits,
    );
  }
}

function syntheticCommand(name: string, chargedBytes: number): MaskHistoryCommand {
  return {
    name,
    sourceRevision: 0,
    patches: [],
    changedPixels: 1,
    chargedBytes,
  };
}

describe("MaskHistoryCheckpoint", () => {
  it("builds a charged command directly from non-empty Worker XOR patches", () => {
    const nonEmpty = {
      tileX: 0,
      tileY: 0,
      width: 8,
      height: 1,
      xorBits: Uint8Array.from([0b1000_0001]),
    };
    const empty = { ...nonEmpty, tileX: 1, xorBits: new Uint8Array(1) };
    const command = createMaskHistoryCommandFromPatches("worker", 9, [empty, nonEmpty]);

    expect(command).toEqual({
      name: "worker",
      sourceRevision: 9,
      patches: [nonEmpty],
      changedPixels: 2,
      chargedBytes: chargeMaskHistoryPatches([nonEmpty]),
    });
    expect(createMaskHistoryCommandFromPatches("empty", 0, [empty])).toBeNull();
  });

  it("captures only touched tiles and applies one XOR command in both directions", () => {
    const width = MASK_HISTORY_TILE_SIZE + 2;
    const height = 3;
    const buffer = new MaskBuffer({ width, height });
    const checkpoint = new MaskHistoryCheckpoint(width, height);
    checkpoint.captureDenseRect(buffer.data, { x0: 510, y0: 0, x1: 514, y1: 3 });
    buffer.data[1 * width + 511] = 255;
    buffer.data[1 * width + 512] = 255;

    const command = checkpoint.finishDense("cross-tile", 7, buffer.data);
    expect(command).not.toBeNull();
    expect(command?.sourceRevision).toBe(7);
    expect(command?.changedPixels).toBe(2);
    expect(command?.patches.map((patch) => patch.tileX)).toEqual([0, 1]);

    applyCommand(buffer, command!);
    expect(buffer.countSet()).toBe(0);
    applyCommand(buffer, command!);
    expect(buffer.get(511, 1)).toBe(255);
    expect(buffer.get(512, 1)).toBe(255);
  });

  it("collapses repeated changes back to a no-op", () => {
    const buffer = new MaskBuffer({ width: 8, height: 8 });
    const checkpoint = new MaskHistoryCheckpoint(8, 8);
    checkpoint.captureDenseRect(buffer.data, { x0: 3, y0: 3, x1: 4, y1: 4 });
    buffer.data[3 * 8 + 3] = 255;
    buffer.data[3 * 8 + 3] = 0;
    expect(checkpoint.finishDense("no-op", 0, buffer.data)).toBeNull();
  });
});

describe("MaskHistoryStore", () => {
  it("releases retained commands on redo reset, eviction, and clear", () => {
    const retained: string[] = [];
    const released: string[] = [];
    const store = new MaskHistoryStore(120, 3, {
      onRetain: (command) => retained.push(command.name),
      onRelease: (command) => released.push(command.name),
    });
    const first = syntheticCommand("first", 60);
    const second = syntheticCommand("second", 60);
    const third = syntheticCommand("third", 60);
    const fourth = syntheticCommand("fourth", 60);

    store.push(first);
    store.push(second);
    store.undo(() => {});
    store.push(third);
    store.push(fourth);
    store.clear();

    expect(retained).toEqual(["first", "second", "third", "fourth"]);
    expect(released).toEqual(["second", "first", "third", "fourth"]);
  });

  it("counts redo in the budget, evicts oldest undo, and clears redo on a new write", () => {
    const store = new MaskHistoryStore(120, 3);
    const first = syntheticCommand("first", 60);
    const second = syntheticCommand("second", 60);
    const third = syntheticCommand("third", 60);
    expect(store.push(first)).toBe(true);
    expect(store.push(second)).toBe(true);
    expect(store.undo(() => {})).toBe(second);
    expect(store.snapshot()).toMatchObject({
      retainedBytes: 120,
      undoCommands: 1,
      redoCommands: 1,
    });

    expect(store.push(third)).toBe(true);
    expect(store.snapshot()).toMatchObject({
      retainedBytes: 120,
      undoCommands: 2,
      redoCommands: 0,
      evictedCommands: 0,
    });
    expect(store.push(syntheticCommand("fourth", 60))).toBe(true);
    expect(store.snapshot()).toMatchObject({
      retainedBytes: 120,
      undoCommands: 2,
      evictedCommands: 1,
    });
  });

  it("drops an oversized discontinuity instead of retaining an invalid undo chain", () => {
    const store = new MaskHistoryStore(100);
    expect(store.push(syntheticCommand("before", 80))).toBe(true);
    expect(store.push(syntheticCommand("oversized", 101))).toBe(false);
    expect(store.snapshot()).toMatchObject({
      retainedBytes: 0,
      undoCommands: 0,
      redoCommands: 0,
      droppedCommands: 1,
    });
  });

  it("keeps stack ownership unchanged when applying a command fails", () => {
    const store = new MaskHistoryStore(100);
    const command = syntheticCommand("recoverable", 80);
    store.push(command);
    expect(() =>
      store.undo(() => {
        throw new Error("apply failed");
      }),
    ).toThrow("apply failed");
    expect(store.snapshot()).toMatchObject({
      retainedBytes: 80,
      undoCommands: 1,
      redoCommands: 0,
    });
  });

  it("enforces the 100-command cap independently of the byte budget", () => {
    const store = new MaskHistoryStore(1_000_000);
    for (let index = 0; index <= MASK_HISTORY_MAX_COMMANDS; index += 1) {
      store.push(syntheticCommand(String(index), 1));
    }
    expect(store.snapshot()).toMatchObject({
      undoCommands: MASK_HISTORY_MAX_COMMANDS,
      retainedBytes: MASK_HISTORY_MAX_COMMANDS,
      evictedCommands: 1,
    });
  });

  it("admits a full 8192 square XOR bitset in the low-memory budget", () => {
    const tileBits = new Uint8Array((MASK_HISTORY_TILE_SIZE * MASK_HISTORY_TILE_SIZE) / 8);
    const patches = Array.from({ length: 16 * 16 }, (_, index) => ({
      tileX: index % 16,
      tileY: Math.floor(index / 16),
      width: MASK_HISTORY_TILE_SIZE,
      height: MASK_HISTORY_TILE_SIZE,
      xorBits: tileBits.slice(),
    }));
    const chargedBytes = chargeMaskHistoryPatches(patches);
    expect(chargedBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(chargedBytes).toBeLessThan(maskHistoryBudgetBytes(2));
    const store = new MaskHistoryStore(maskHistoryBudgetBytes(2));
    expect(
      store.push({
        name: "full-canvas",
        sourceRevision: 0,
        patches,
        changedPixels: 8192 * 8192,
        chargedBytes,
      }),
    ).toBe(true);
  });

  it("uses the frozen low, standard, and high device budgets", () => {
    expect(maskHistoryBudgetBytes(2)).toBe(16 * 1024 * 1024);
    expect(maskHistoryBudgetBytes(undefined)).toBe(32 * 1024 * 1024);
    expect(maskHistoryBudgetBytes(4)).toBe(32 * 1024 * 1024);
    expect(maskHistoryBudgetBytes(8)).toBe(64 * 1024 * 1024);
  });
});
