/**
 * useDeleteComment 乐观删除单测：验证任务级聚合缓存 ["task-comments-page", *]
 * 也被乐观剔除（PR #21 审查 #4），且失败时回滚。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/api/comments", () => ({
  commentsApi: { remove: vi.fn() },
}));
vi.mock("@/components/ui/Toast", () => ({
  useToastStore: (sel: (s: { push: () => void }) => unknown) => sel({ push: vi.fn() }),
}));

import { commentsApi } from "@/api/comments";
import { useDeleteComment } from "./useAnnotationComments";

const mockRemove = commentsApi.remove as unknown as ReturnType<typeof vi.fn>;

function seedPage(items: { id: string }[]): InfiniteData<{ items: unknown[]; next_cursor: null }> {
  return { pages: [{ items, next_cursor: null }], pageParams: [undefined] };
}

let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useDeleteComment 乐观删除", () => {
  beforeEach(() => {
    // gcTime: Infinity —— seed 的缓存无观察者，gcTime:0 会在 onSettled invalidate 后被
    // 回收成 undefined，干扰对回滚结果的断言。
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    mockRemove.mockReset();
  });

  it("从任务级聚合缓存乐观剔除被删项", async () => {
    mockRemove.mockResolvedValue(undefined);
    qc.setQueryData(["task-comments-page", "task-1"], seedPage([{ id: "c1" }, { id: "c2" }]));

    // annotationId 为 null（未选中标注的任务级视图）
    const { result } = renderHook(() => useDeleteComment(null), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("c1");
    });

    const data = qc.getQueryData<InfiniteData<{ items: { id: string }[] }>>([
      "task-comments-page",
      "task-1",
    ]);
    expect(data?.pages[0].items.map((c) => c.id)).toEqual(["c2"]);
  });

  it("删除失败时回滚任务级缓存", async () => {
    mockRemove.mockRejectedValue(new Error("boom"));
    qc.setQueryData(["task-comments-page", "task-1"], seedPage([{ id: "c1" }, { id: "c2" }]));

    const { result } = renderHook(() => useDeleteComment(null), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("c1").catch(() => {});
    });

    const data = qc.getQueryData<InfiniteData<{ items: { id: string }[] }>>([
      "task-comments-page",
      "task-1",
    ]);
    expect(data?.pages[0].items.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
