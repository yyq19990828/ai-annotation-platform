import { describe, expect, it } from "vitest";
import {
  LEGACY_CROSS_FRAME_OVERLAY_K_KEY,
  LEGACY_POINT_MASK_MODE_KEY,
  buildPointcloudLegacyMigration,
  finishPointcloudLegacyMigration,
  readPointcloudStickyToggle,
  writePointcloudStickyToggle,
} from "./pointcloudPreferenceStorage";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

describe("pointcloudPreferenceStorage", () => {
  it("builds a one-time preferences seed from legacy global keys", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_POINT_MASK_MODE_KEY, "lasso");
    storage.setItem(LEGACY_CROSS_FRAME_OVERLAY_K_KEY, "5");

    const migration = buildPointcloudLegacyMigration("u1", storage);

    expect(migration?.patch).toEqual({
      pointcloud: { pointMaskSelectMode: "lasso" },
      common: { crossFrameOverlayEnabled: true, crossFrameOverlayK: 5 },
    });

    finishPointcloudLegacyMigration(migration!, storage);
    expect(storage.getItem(LEGACY_POINT_MASK_MODE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_CROSS_FRAME_OVERLAY_K_KEY)).toBeNull();
    expect(buildPointcloudLegacyMigration("u1", storage)).toBeNull();
  });

  it("ignores invalid legacy values but still produces a migration marker", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_POINT_MASK_MODE_KEY, "circle");
    storage.setItem(LEGACY_CROSS_FRAME_OVERLAY_K_KEY, "2");

    const migration = buildPointcloudLegacyMigration("u1", storage);

    expect(migration?.patch).toBeNull();
    finishPointcloudLegacyMigration(migration!, storage);
    expect(buildPointcloudLegacyMigration("u1", storage)).toBeNull();
  });

  it("stores sticky fusion toggles by user id", () => {
    const storage = new MemoryStorage();

    writePointcloudStickyToggle("u1", "colorizeOn", true, storage);
    writePointcloudStickyToggle("u2", "colorizeOn", false, storage);

    expect(readPointcloudStickyToggle("u1", "colorizeOn", storage)).toBe(true);
    expect(readPointcloudStickyToggle("u2", "colorizeOn", storage)).toBe(false);
  });
});
