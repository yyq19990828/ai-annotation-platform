import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateFeedbackPayload, ListFeedbacksParams } from "@/api/feedbacks";
import { feedbacksQueryKey, useCreateFeedback } from "./useFeedbacks";

const create = vi.fn();

vi.mock("@/api/feedbacks", () => ({
  feedbacksApi: {
    create: (...args: unknown[]) => create(...args),
    list: vi.fn(),
    patch: vi.fn(),
    remove: vi.fn(),
    reply: vi.fn(),
  },
}));

const scopeA: ListFeedbacksParams = {
  project_id: "PA",
  task_id: "TA",
  kind: "issue",
  root_only: true,
  include_counts: true,
};
const scopeB: ListFeedbacksParams = {
  ...scopeA,
  project_id: "PB",
  task_id: "TB",
};

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useFeedbacks query ownership", () => {
  it("isolates the same list filters by authenticated owner", () => {
    expect(feedbacksQueryKey(scopeA, "user-a")).not.toEqual(feedbacksQueryKey(scopeA, "user-b"));
    expect(feedbacksQueryKey(scopeA, null)).not.toEqual(feedbacksQueryKey(scopeA, "user-a"));
  });

  it("uses response scope when an A mutation resolves after the hook moves to B", async () => {
    let resolve!: (value: unknown) => void;
    create.mockReturnValue(new Promise((yes) => (resolve = yes)));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidations = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(
      ({ params }: { params: ListFeedbacksParams }) => useCreateFeedback(params),
      {
        initialProps: { params: scopeA },
        wrapper: wrapper(client),
      },
    );
    const payload: CreateFeedbackPayload = {
      kind: "issue",
      anchor_type: "task",
      project_id: "PA",
      task_id: "TA",
      body: "A",
    };
    act(() => view.result.current.mutate(payload));
    view.rerender({ params: scopeB });
    await act(async () => {
      resolve({ project_id: "PA", task_id: "TA", annotation_id: null });
      await Promise.resolve();
    });
    expect(invalidations).toHaveBeenCalledWith({ queryKey: ["feedbacks", "PA"] });
    expect(invalidations).not.toHaveBeenCalledWith({ queryKey: ["feedbacks", "PB"] });
  });
});
