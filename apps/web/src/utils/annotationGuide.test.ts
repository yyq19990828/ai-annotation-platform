import { describe, expect, it } from "vitest";
import {
  annotationGuideVersion,
  guideCollapsedStorageKey,
  guideSeenStorageKey,
  isGuideCollapsed,
  isGuideSeen,
  markGuideCollapsed,
  markGuideSeen,
} from "./annotationGuide";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } as Pick<Storage, "getItem" | "setItem">;
}

describe("annotation guide state", () => {
  it("creates a stable version and scopes browser state by user, project, and version", () => {
    const storage = memoryStorage();
    const first = annotationGuideVersion("# Car");
    const second = annotationGuideVersion("# Car\n");

    expect(first).toBe(annotationGuideVersion("# Car"));
    expect(second).not.toBe(first);
    markGuideSeen("user-a", "project-a", first, storage);
    markGuideCollapsed("user-a", "project-a", first, true, storage);

    expect(isGuideSeen("user-a", "project-a", first, storage)).toBe(true);
    expect(isGuideSeen("user-b", "project-a", first, storage)).toBe(false);
    expect(isGuideSeen("user-a", "project-a", second, storage)).toBe(false);
    expect(isGuideCollapsed("user-a", "project-a", first, storage)).toBe(true);
    expect(storage.getItem(guideSeenStorageKey("user-a", "project-a", first))).toBeTruthy();
    expect(storage.getItem(guideCollapsedStorageKey("user-a", "project-a", first))).toBe("1");
  });

  it("handles unavailable storage without blocking the guide", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    } as Pick<Storage, "getItem" | "setItem">;

    expect(() => isGuideSeen("user", "project", "version", unavailable)).not.toThrow();
    expect(() => isGuideCollapsed("user", "project", "version", unavailable)).not.toThrow();
    expect(() => markGuideSeen("user", "project", "version", unavailable)).not.toThrow();
    expect(() => markGuideCollapsed("user", "project", "version", true, unavailable)).not.toThrow();
  });
});
