import { createElement, StrictMode, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback, AnnotationFeedbackThreadPage } from "@/api/feedbacks";
import type { TaskDiscussionItem } from "@/api/discussion";
import type { WorkbenchDiscussionRequest } from "@/utils/workbenchNavigation";
import { issueThreadQueryKey } from "@/hooks/useIssueThread";
import { useIssueThread } from "@/hooks/useIssueThread";
import { useAuthStore } from "@/stores/authStore";
import { DiscussionDraftProvider } from "./DiscussionDraftProvider";
import { useDiscussionNavigation } from "./useDiscussionNavigation";

const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  annotation: vi.fn(),
  legacy: vi.fn(),
  feed: vi.fn(),
  thread: vi.fn(),
}));
vi.mock("@/api/tasks", () => ({ tasksApi: { get: (...args: unknown[]) => mocks.task(...args) } }));
vi.mock("@/api/discussionTargets", () => ({
  resolveActiveDiscussionAnnotation: (...args: unknown[]) => mocks.annotation(...args),
}));
vi.mock("@/api/comments", () => ({
  commentsApi: { listByAnnotationKeyset: (...args: unknown[]) => mocks.legacy(...args) },
}));
vi.mock("@/api/feedbacks", () => ({
  feedbacksApi: { thread: (...args: unknown[]) => mocks.thread(...args) },
}));
vi.mock("@/api/discussion", async (original) => ({
  ...(await original<typeof import("@/api/discussion")>()),
  discussionApi: { listTaskDiscussion: (...args: unknown[]) => mocks.feed(...args) },
}));

const root = {
  id: "root",
  project_id: "project",
  task_id: "task",
  kind: "issue",
  is_active: true,
  thread_parent_id: null,
  body: "根问题",
  anchor_type: "task",
  attachments: [],
  annotation_id: null,
  anchor_position: null,
  status: "open",
  severity: null,
  title: null,
  author_id: "user",
  author_name: "测试作者",
  resolved_at: null,
  resolved_by_id: null,
  created_at: "2026-09-11T00:00:00Z",
  updated_at: null,
} as AnnotationFeedback;
const reply = (id: string) => ({
  ...root,
  id,
  kind: "comment" as const,
  thread_parent_id: root.id,
  body: `回复 ${id}`,
});
const threadPage = (
  items: AnnotationFeedback[],
  cursor: string | null = null,
): AnnotationFeedbackThreadPage => ({ root, items, next_cursor: cursor, total: items.length });
const comment = (id: string): TaskDiscussionItem => ({
  source: "annotation_comment",
  data: { id, annotation_id: "annotation", body: `评论 ${id}` } as never,
  actions: { edit: false, change_status: false, delete: false, reply: true },
});
const issueRequest = (replyId?: string): WorkbenchDiscussionRequest => ({
  status: "valid",
  taskId: "task",
  target: { kind: "issue", issueId: root.id, replyId },
});
const commentRequest: WorkbenchDiscussionRequest = {
  status: "valid",
  taskId: "task",
  target: { kind: "comment", annotationId: "annotation", commentId: "old" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(request = issueRequest(), strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const options = {
    request,
    navigationKey: "location-1",
    projectId: "project",
    taskId: "task",
    reveal: vi.fn(),
    selectAnnotation: vi.fn().mockResolvedValue(true),
  };
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(DiscussionDraftProvider, {
        userId: "user",
        sessionId: "session",
        children: strict ? createElement(StrictMode, null, children) : children,
      }),
    );
  return { client, options, wrapper };
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  useAuthStore.getState().setAuth("token", { id: "user" } as never);
  mocks.task.mockResolvedValue({ id: "task", project_id: "project", file_type: "image" });
  mocks.annotation.mockResolvedValue({ id: "annotation", task_id: "task", project_id: "project" });
});

describe("Workbench discussion URL navigation", () => {
  it("waits for a pre-navigation fetch and then refreshes without cancelling the other reader", async () => {
    const env = setup(issueRequest("new"));
    const held = deferred<AnnotationFeedbackThreadPage>();
    let sharedSignal: AbortSignal | undefined;
    mocks.thread
      .mockImplementationOnce((_id, _params, options) => {
        sharedSignal = options;
        return held.promise;
      })
      .mockResolvedValue(threadPage([reply("new")]));
    const reader = renderHook(
      () => useIssueThread({ rootId: root.id, projectId: "project", taskId: "task" }),
      { wrapper: env.wrapper },
    );
    await waitFor(() => expect(mocks.thread).toHaveBeenCalledTimes(1));
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() =>
      expect(view.result.current.state).toMatchObject({
        status: "loading",
        message: "正在刷新问题对话",
      }),
    );
    expect(mocks.thread).toHaveBeenCalledTimes(1);
    await act(async () => held.resolve(threadPage([])));
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(mocks.thread).toHaveBeenCalledTimes(2);
    expect(sharedSignal).toBeInstanceOf(AbortSignal);
    expect(sharedSignal?.aborted).toBe(false);
    view.unmount();
    reader.unmount();
    env.client.clear();
  });

  it("refreshes a warm thread before finding a newly created native comment reply", async () => {
    const env = setup(issueRequest("new"));
    const key = issueThreadQueryKey(root.id, "user", "session", "project", "task");
    env.client.setQueryData(key, { pages: [threadPage([])], pageParams: [null] });
    mocks.thread.mockResolvedValue(threadPage([reply("new")]));
    const view = renderHook((props) => useDiscussionNavigation(props), {
      initialProps: env.options,
      wrapper: env.wrapper,
    });
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(mocks.thread).toHaveBeenCalledTimes(1);
    expect(view.result.current.state).toMatchObject({
      target: { kind: "issue", replyId: "new" },
      root: { id: root.id },
    });
    expect(env.options.selectAnnotation).not.toHaveBeenCalled();
    view.unmount();
    env.client.clear();
  });

  it("loads an old nested reply beyond the first fifty records through the root-bound cursor", async () => {
    const env = setup(issueRequest("old"));
    mocks.thread
      .mockResolvedValueOnce(
        threadPage(
          Array.from({ length: 50 }, (_, i) => reply(String(i))),
          "older",
        ),
      )
      .mockResolvedValueOnce(
        threadPage([{ ...reply("old"), thread_parent_id: "historical-parent" }]),
      );
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(mocks.thread.mock.calls.map((call) => call[1].cursor)).toEqual([undefined, "older"]);
    view.unmount();
    env.client.clear();
  });

  it("reports an exhausted missing or foreign-thread reply, not a ready root", async () => {
    const env = setup(issueRequest("foreign"));
    mocks.thread
      .mockResolvedValueOnce(threadPage([reply("first")], "older"))
      .mockResolvedValueOnce(threadPage([reply("second")]));
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() =>
      expect(view.result.current.state).toMatchObject({
        status: "error",
        message: "回复已删除或不属于这个问题",
      }),
    );
    expect(mocks.thread).toHaveBeenCalledTimes(2);
    view.unmount();
    env.client.clear();
  });

  it("rejects a root from a different task even when the task lookup was valid", async () => {
    const env = setup();
    mocks.thread.mockResolvedValue({ ...threadPage([]), root: { ...root, task_id: "different" } });
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() =>
      expect(view.result.current.state).toMatchObject({
        status: "error",
        message: "问题已删除或不属于当前任务",
      }),
    );
    view.unmount();
    env.client.clear();
  });

  it("waits for the actual requested task instead of applying to a temporary old task", async () => {
    const env = setup();
    mocks.thread.mockResolvedValue(threadPage([]));
    const view = renderHook((props) => useDiscussionNavigation(props), {
      initialProps: { ...env.options, taskId: "previous" },
      wrapper: env.wrapper,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.task).not.toHaveBeenCalled();
    view.rerender(env.options);
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    view.unmount();
    env.client.clear();
  });

  it("cancels page traversal without allowing a late page to open the target", async () => {
    const env = setup(issueRequest("old"));
    const held = deferred<AnnotationFeedbackThreadPage>();
    mocks.thread
      .mockResolvedValueOnce(threadPage([reply("first")], "older"))
      .mockReturnValueOnce(held.promise);
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(mocks.thread).toHaveBeenCalledTimes(2));
    act(() => view.result.current.cancel());
    await act(async () => {
      held.resolve(threadPage([reply("old")], "third"));
    });
    expect(view.result.current.state.status).toBe("cancelled");
    expect(mocks.thread).toHaveBeenCalledTimes(2);
    view.unmount();
    env.client.clear();
  });

  it("retires a lookup on user change without replaying it for the next user", async () => {
    const env = setup();
    const held = deferred<AnnotationFeedbackThreadPage>();
    mocks.thread.mockReturnValue(held.promise);
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(mocks.thread).toHaveBeenCalledTimes(1));
    act(() => useAuthStore.getState().setAuth("other-token", { id: "other" } as never));
    await act(async () => {
      held.resolve(threadPage([]));
    });
    expect(view.result.current.state.status).toBe("idle");
    expect(mocks.task).toHaveBeenCalledTimes(1);
    view.unmount();
    env.client.clear();
  });

  it("consumes once, ignores background renders, and permits a later explicit same-target navigation", async () => {
    const env = setup();
    mocks.thread.mockResolvedValue(threadPage([]));
    const view = renderHook((props) => useDiscussionNavigation(props), {
      initialProps: env.options,
      wrapper: env.wrapper,
    });
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    const state = view.result.current.state;
    if (state.status !== "ready") throw new Error("Expected ready");
    act(() => view.result.current.consume(state.requestId));
    view.rerender({ ...env.options, request: issueRequest() });
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.state.status).toBe("complete");
    expect(mocks.task).toHaveBeenCalledTimes(1);
    view.rerender({ ...env.options, navigationKey: "location-2" });
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(mocks.task).toHaveBeenCalledTimes(2);
    view.unmount();
    env.client.clear();
  });

  it("survives StrictMode without a duplicate or permanently cancelled dispatch", async () => {
    const env = setup(issueRequest(), true);
    mocks.thread.mockResolvedValue(threadPage([]));
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(mocks.task).toHaveBeenCalledTimes(1);
    view.unmount();
    env.client.clear();
  });

  it("finds the original old comment, then populates the server-authorized annotation feed", async () => {
    const env = setup(commentRequest);
    mocks.legacy
      .mockResolvedValueOnce({ items: [comment("new").data], next_cursor: "legacy-old" })
      .mockResolvedValueOnce({ items: [comment("old").data], next_cursor: null });
    mocks.feed
      .mockResolvedValueOnce({ items: [comment("new")], next_cursor: "feed-old", total: 2 })
      .mockResolvedValueOnce({ items: [comment("old")], next_cursor: null, total: 2 });
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(mocks.legacy.mock.calls.map((call) => call[1].cursor)).toEqual([
      undefined,
      "legacy-old",
    ]);
    expect(mocks.feed.mock.calls.map((call) => call[1])).toEqual([
      { scope: "annotation", annotation_id: "annotation", limit: 50, cursor: undefined },
      { scope: "annotation", annotation_id: "annotation", limit: 50, cursor: "feed-old" },
    ]);
    expect(env.options.selectAnnotation).toHaveBeenCalledTimes(1);
    expect(mocks.thread).not.toHaveBeenCalled();
    view.unmount();
    env.client.clear();
  });

  it("does not reveal legacy comments for an annotation that is no longer active", async () => {
    const env = setup(commentRequest);
    mocks.annotation.mockResolvedValue(null);
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(view.result.current.state.status).toBe("error"));
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.feed).not.toHaveBeenCalled();
    expect(env.options.selectAnnotation).not.toHaveBeenCalled();
    view.unmount();
    env.client.clear();
  });

  it("keeps the original canvas owner when the guarded annotation selection is declined", async () => {
    const env = setup(commentRequest);
    env.options.selectAnnotation.mockResolvedValue(false);
    mocks.legacy.mockResolvedValue({ items: [comment("old").data], next_cursor: null });
    mocks.feed.mockResolvedValue({ items: [comment("old")], next_cursor: null, total: 1 });
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(view.result.current.state.status).toBe("cancelled"));
    view.unmount();
    env.client.clear();
  });

  it("retries a failed page by refreshing the thread, retaining a specific error until retry", async () => {
    const env = setup(issueRequest("old"));
    mocks.thread
      .mockResolvedValueOnce(threadPage([reply("first")], "older"))
      .mockRejectedValueOnce(new Error("503"));
    const view = renderHook(() => useDiscussionNavigation(env.options), { wrapper: env.wrapper });
    await waitFor(() => expect(view.result.current.state.status).toBe("error"));
    mocks.thread.mockResolvedValue(threadPage([reply("old")]));
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    view.unmount();
    env.client.clear();
  });
});
