import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFilterDraftValidity } from "./useFilterDraftValidity";

describe("useFilterDraftValidity", () => {
  it("tracks only the current owner and clears its invalid editors on owner change", () => {
    const { result, rerender } = renderHook(({ owner }) => useFilterDraftValidity(owner), {
      initialProps: { owner: "tasks:view-a" },
    });

    act(() => result.current.onDraftValidityChange(false, "tasks:view-a:field:0"));
    expect(result.current.hasInvalidDraft).toBe(true);
    act(() => result.current.onDraftValidityChange(false, "tasks:view-b:field:0"));
    expect(result.current.hasInvalidDraft).toBe(true);

    rerender({ owner: "tasks:view-b" });
    expect(result.current.hasInvalidDraft).toBe(false);
    act(() => result.current.onDraftValidityChange(true, "tasks:view-a:field:0"));
    expect(result.current.hasInvalidDraft).toBe(false);
    act(() => result.current.onDraftValidityChange(false, "tasks:view-b:field:0"));
    expect(result.current.hasInvalidDraft).toBe(true);
    act(() => result.current.onDraftValidityChange(true, "tasks:view-b:field:0"));
    expect(result.current.hasInvalidDraft).toBe(false);
  });
});
