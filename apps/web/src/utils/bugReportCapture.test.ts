import { afterEach, describe, expect, it, vi } from "vitest";
import { getRecentApiCalls, patchFetchForBugCapture } from "./bugReportCapture";

afterEach(() => vi.unstubAllGlobals());

describe("API diagnostics preserve request failures", () => {
  it.each([new TypeError("Failed to fetch"), new DOMException("aborted", "AbortError")])(
    "records a failed request without changing %s",
    async (error) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      patchFetchForBugCapture();
      await expect(window.fetch("/api/v1/tasks/task/annotations", { method: "POST" })).rejects.toBe(
        error,
      );
      const calls = getRecentApiCalls();
      expect(calls[calls.length - 1]).toMatchObject({ method: "POST", status: 0 });
    },
  );
});
