import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback, AnnotationFeedbackThreadPage } from "@/api/feedbacks";
import { ApiError } from "@/api/client";
import { useAuthStore } from "@/stores/authStore";
import { DiscussionDraftProvider } from "@/pages/Workbench/state/DiscussionDraftProvider";
import { flattenIssueThread, isValidIssueRoot, useIssueThread } from "./useIssueThread";

const threadMock = vi.hoisted(() => vi.fn());

vi.mock("@/api/feedbacks", () => ({
  feedbacksApi: { thread: (...args: unknown[]) => threadMock(...args) },
}));

function issue(overrides: Partial<AnnotationFeedback> = {}): AnnotationFeedback {
  return {
    id: "root-1",
    kind: "issue",
    anchor_type: "task",
    project_id: "P1",
    task_id: "T1",
    annotation_id: null,
    anchor_position: null,
    status: "open",
    severity: "warn",
    title: "需要复核",
    body: "根问题",
    author_id: "U1",
    author_name: "审核员",
    attachments: [],
    thread_parent_id: null,
    is_active: true,
    resolved_at: null,
    resolved_by_id: null,
    created_at: "2026-09-11T00:00:00.000Z",
    updated_at: null,
    actions: { edit: true, change_status: true, delete: true, reply: true },
    ...overrides,
  };
}

function page(
  root: AnnotationFeedback,
  items: AnnotationFeedback[],
  next_cursor: string | null = null,
) {
  return { root, items, next_cursor, total: items.length } satisfies AnnotationFeedbackThreadPage;
}

function reply(overrides: Partial<AnnotationFeedback> = {}): AnnotationFeedback {
  return issue({
    kind: "comment",
    title: null,
    severity: null,
    thread_parent_id: "root-1",
    ...overrides,
  });
}

function makeWrapper(client: QueryClient, userId = "U1", sessionId = "session-1") {
  return ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(DiscussionDraftProvider, { userId, sessionId, children }),
    );
}

beforeEach(() => {
  threadMock.mockReset();
  localStorage.clear();
  useAuthStore.getState().setAuth("token-1", { id: "U1" } as never);
});

describe("useIssueThread", () => {
  it("rejects non-Issue, nested and inactive roots before exposing content", () => {
    const root = issue();
    expect(isValidIssueRoot(root, { rootId: "other", projectId: "P1", taskId: "T1" })).toBe(false);
    expect(
      isValidIssueRoot(issue({ kind: "comment" as never }), {
        rootId: root.id,
        projectId: "P1",
        taskId: "T1",
      }),
    ).toBe(false);
    expect(
      isValidIssueRoot(issue({ thread_parent_id: "parent" }), {
        rootId: root.id,
        projectId: "P1",
        taskId: "T1",
      }),
    ).toBe(false);
    expect(
      isValidIssueRoot(issue({ is_active: false }), {
        rootId: root.id,
        projectId: "P1",
        taskId: "T1",
      }),
    ).toBe(false);
  });

  it("keeps the pin snapshot hidden until the independent root request validates it", async () => {
    let resolve!: (value: AnnotationFeedbackThreadPage) => void;
    threadMock.mockReturnValue(new Promise<AnnotationFeedbackThreadPage>((yes) => (resolve = yes)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const snapshot = issue({ body: "旧快照，不应先显示" });
    const view = renderHook(
      () =>
        useIssueThread({
          rootId: snapshot.id,
          projectId: "P1",
          taskId: "T1",
          rootSnapshot: snapshot,
        }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(threadMock).toHaveBeenCalledTimes(1));
    expect(view.result.current.root).toBeNull();
    expect(view.result.current.state).toBe("loading");
    await act(async () => {
      resolve(page(issue({ body: "服务端根问题" }), []));
      await Promise.resolve();
    });
    await waitFor(() => expect(view.result.current.state).toBe("ready"));
    expect(view.result.current.root?.body).toBe("服务端根问题");
  });

  it("uses the feedback-thread prefix plus owner/session/project/task and flattens 50+ nested replies oldest-first", async () => {
    const root = issue();
    const newestFirst = Array.from({ length: 52 }, (_, index) =>
      reply({
        id: `reply-${String(51 - index).padStart(2, "0")}`,
        body: `回复 ${51 - index}`,
        thread_parent_id: index === 0 ? root.id : `reply-${String(52 - index).padStart(2, "0")}`,
        created_at: `2026-09-11T00:${String(51 - index).padStart(2, "0")}:00.000Z`,
      }),
    );
    threadMock.mockResolvedValue(page(root, newestFirst));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = renderHook(
      () => useIssueThread({ rootId: root.id, projectId: "P1", taskId: "T1" }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(view.result.current.state).toBe("ready"));
    expect(view.result.current.replies).toHaveLength(52);
    expect(view.result.current.replies[0].id).toBe("reply-00");
    expect(view.result.current.replies[51].id).toBe("reply-51");
    expect(view.result.current.replies[1].parentContext).toMatchObject({
      id: "reply-02",
      available: true,
    });
    expect(
      client.getQueryCache().findAll({ queryKey: ["feedback-thread", root.id] })[0]?.queryKey,
    ).toEqual(["feedback-thread", root.id, "U1", "session-1", "P1", "T1"]);
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["feedback-thread", root.id] })[0]
        ?.queryKey.join(" "),
    ).not.toContain("token-1");
  });

  it("retains a child and labels an unloaded or unavailable parent", () => {
    const root = issue();
    const child = reply({
      id: "child",
      body: "仍然存在的子回复",
      thread_parent_id: "deleted-parent",
      created_at: "2026-09-11T00:01:00.000Z",
    });
    const result = flattenIssueThread(
      {
        pages: [page(root, [child])],
        pageParams: [null],
      },
      root,
    );
    expect(result[0].parentContext).toEqual({
      id: "deleted-parent",
      body: "上级回复尚未加载或已不可见",
      authorName: null,
      available: false,
    });
  });

  it("keeps native comment replies and legacy descendant kinds without admitting unrelated roots", () => {
    const root = issue();
    const nativeReply = reply({ id: "native-reply" });
    const legacyReply = reply({
      id: "legacy-reply",
      kind: "issue",
      thread_parent_id: nativeReply.id,
    });
    const result = flattenIssueThread(
      {
        pages: [page(root, [legacyReply, nativeReply, issue({ id: "unrelated-root" })])],
        pageParams: [null],
      },
      root,
    );
    expect(result.map((item) => item.id)).toEqual([nativeReply.id, legacyReply.id]);
    expect(result[1].parentContext?.available).toBe(true);
  });

  it("keeps the validated root after a 503 older-page failure and retries that page", async () => {
    const root = issue();
    const firstReply = reply({ id: "reply-1", thread_parent_id: root.id, body: "已加载回复" });
    const olderReply = reply({ id: "reply-0", thread_parent_id: root.id, body: "更早回复" });
    threadMock.mockImplementation((_id: string, params: { cursor?: string }) =>
      params.cursor
        ? Promise.reject(new ApiError(503, "Service Unavailable"))
        : Promise.resolve(page(root, [firstReply], "older-cursor")),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = renderHook(
      () => useIssueThread({ rootId: root.id, projectId: "P1", taskId: "T1" }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(view.result.current.state).toBe("ready"));
    await act(async () => {
      await view.result.current.loadEarlierReplies();
    });
    await waitFor(() => expect(view.result.current.paginationError).toBeInstanceOf(ApiError));
    expect(view.result.current.root?.id).toBe(root.id);
    expect(view.result.current.replies.map((reply) => reply.id)).toEqual(["reply-1"]);

    threadMock.mockImplementation((_id: string, params: { cursor?: string }) =>
      params.cursor
        ? Promise.resolve(page(root, [olderReply]))
        : Promise.resolve(page(root, [firstReply], "older-cursor")),
    );
    await act(async () => {
      await view.result.current.retryEarlierReplies();
    });
    await waitFor(() => expect(view.result.current.paginationError).toBeNull());
    expect(view.result.current.replies.map((reply) => reply.id)).toEqual(["reply-0", "reply-1"]);
  });

  it("filters descendants whose project/task does not match the validated root", async () => {
    const root = issue();
    threadMock.mockResolvedValue(
      page(root, [
        reply({ id: "valid", thread_parent_id: root.id, body: "保留" }),
        reply({ id: "foreign-project", project_id: "P2", thread_parent_id: root.id }),
        reply({ id: "foreign-task", task_id: "T2", thread_parent_id: root.id }),
      ]),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = renderHook(
      () => useIssueThread({ rootId: root.id, projectId: "P1", taskId: "T1" }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(view.result.current.state).toBe("ready"));
    expect(view.result.current.replies.map((reply) => reply.id)).toEqual(["valid"]);
  });

  it("reports permission denial distinctly from an unavailable root", async () => {
    threadMock.mockRejectedValueOnce(new ApiError(403, "forbidden"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = renderHook(
      () => useIssueThread({ rootId: "root-1", projectId: "P1", taskId: "T1" }),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(view.result.current.state).toBe("permission-denied"));
    expect(view.result.current.root).toBeNull();
  });

  it("passes React Query's signal and aborts the old shared observer on root change", async () => {
    const pending: Array<{
      signal: AbortSignal;
      resolve: (value: AnnotationFeedbackThreadPage) => void;
    }> = [];
    threadMock.mockImplementation((_id: string, _params: unknown, signal: AbortSignal) => {
      return new Promise<AnnotationFeedbackThreadPage>((resolve) => {
        pending.push({ signal, resolve });
      });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const view = renderHook(
      ({ rootId }: { rootId: string }) => useIssueThread({ rootId, projectId: "P1", taskId: "T1" }),
      { initialProps: { rootId: "root-a" }, wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    view.rerender({ rootId: "root-b" });
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[0].signal.aborted).toBe(true);
    expect(pending[1].signal.aborted).toBe(false);
  });
});
