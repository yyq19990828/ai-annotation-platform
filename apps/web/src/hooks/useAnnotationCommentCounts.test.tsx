import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "@/stores/authStore";

const getCounts = vi.hoisted(() => vi.fn());
const createComment = vi.hoisted(() => vi.fn());
vi.mock("@/api/discussion", () => ({
  discussionApi: { getAnnotationCommentCounts: getCounts },
}));
vi.mock("@/api/comments", () => ({ commentsApi: { create: createComment } }));
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (selector: (state: { push: () => void }) => unknown) =>
    selector({ push: vi.fn() }),
}));

import {
  annotationCommentCountsQueryKey,
  useAnnotationCommentCounts,
} from "./useAnnotationCommentCounts";
import { useCreateComment } from "./useAnnotationComments";

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("useAnnotationCommentCounts", () => {
  beforeEach(() => {
    getCounts.mockReset();
    createComment.mockReset();
    useAuthStore.getState().setAuth("token", { id: "user-a" } as never);
  });

  it("fetches one task summary and keeps the server response intact", async () => {
    getCounts.mockResolvedValue({ counts: { "annotation-a": 10 } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useAnnotationCommentCounts("task-a", "project-a", true), {
      wrapper: wrapper(client),
    });

    await waitFor(() =>
      expect(view.result.current.data).toEqual({ counts: { "annotation-a": 10 } }),
    );
    expect(getCounts).toHaveBeenCalledOnce();
    expect(getCounts.mock.calls[0][0]).toBe("task-a");
    expect(getCounts.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    expect(view.result.current.data?.counts["annotation-a"]).toBe(10);
  });

  it("does not request while disabled and separates project/user cache identities", () => {
    const client = new QueryClient();
    const view = renderHook(() => useAnnotationCommentCounts("task-a", "project-a", false), {
      wrapper: wrapper(client),
    });
    expect(view.result.current.fetchStatus).toBe("idle");
    expect(getCounts).not.toHaveBeenCalled();
    expect(annotationCommentCountsQueryKey("task-a", "project-a", "user-a")).not.toEqual(
      annotationCommentCountsQueryKey("task-a", "project-b", "user-a"),
    );
    expect(annotationCommentCountsQueryKey("task-a", "project-a", "user-a")).not.toEqual(
      annotationCommentCountsQueryKey("task-a", "project-a", "user-b"),
    );
    expect(annotationCommentCountsQueryKey("task-a", "project-a", "user-a").slice(0, 2)).toEqual([
      "task-discussion",
      "task-a",
    ]);
    view.unmount();
  });

  it("shares the task discussion invalidation prefix with comment mutations", async () => {
    createComment.mockResolvedValue({ annotation_id: "annotation-a" });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const key = annotationCommentCountsQueryKey("task-a", "project-a", "user-a");
    client.setQueryData(key, { counts: { "annotation-a": 1 } });
    const view = renderHook(() => useCreateComment("annotation-a", "task-a"), {
      wrapper: wrapper(client),
    });

    await view.result.current.mutateAsync("new comment");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });
});
