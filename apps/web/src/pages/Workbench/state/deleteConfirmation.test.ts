import { describe, expect, it } from "vitest";
import { shouldConfirmAnnotationDelete } from "./deleteConfirmation";

describe("deleteConfirmation", () => {
  it("resolves delete confirmation policy", () => {
    expect(shouldConfirmAnnotationDelete("never", 2)).toBe(false);
    expect(shouldConfirmAnnotationDelete("multi_only", 1)).toBe(false);
    expect(shouldConfirmAnnotationDelete("multi_only", 2)).toBe(true);
    expect(shouldConfirmAnnotationDelete("always", 1)).toBe(true);
    expect(shouldConfirmAnnotationDelete("always", 0)).toBe(false);
  });
});
