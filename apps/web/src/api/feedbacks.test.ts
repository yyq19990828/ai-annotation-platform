import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn((..._args: unknown[]) => Promise.resolve({}));

vi.mock("./client", () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
  },
}));

import { feedbacksApi } from "./feedbacks";

beforeEach(() => get.mockClear());

describe("feedbacksApi · Issue list and thread contract", () => {
  it("serializes server filters, root mode and exact-count mode", () => {
    const signal = new AbortController().signal;
    feedbacksApi.list(
      {
        project_id: "P1",
        task_id: "T1",
        kind: "issue",
        status: "open",
        root_only: true,
        include_counts: true,
        limit: 200,
      },
      signal,
    );
    expect(get).toHaveBeenCalledWith(
      "/feedbacks?project_id=P1&task_id=T1&kind=issue&status=open&root_only=true&include_counts=true&limit=200",
      { signal },
    );
  });

  it("exposes a root-bound paged thread read with AbortSignal", () => {
    const signal = new AbortController().signal;
    feedbacksApi.thread("root-1", { limit: 50, cursor: "next page" }, signal);
    expect(get).toHaveBeenCalledWith("/feedbacks/root-1/thread?limit=50&cursor=next+page", {
      signal,
    });
  });
});
