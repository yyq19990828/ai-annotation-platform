import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { useIssueSequence } from "./useIssueSequence";

const mocks = vi.hoisted(() => ({
  auth: { user: { id: "user-a" } as { id: string } | null },
  store: {
    owner: { userId: "user-a", sessionId: "session-a" } as {
      userId: string;
      sessionId: string;
    } | null,
    isOwned: vi.fn(() => true),
  },
  query: null as MockQuery | null,
  apiList: vi.fn(),
  useInfiniteFeedbacks: vi.fn(),
}));

interface MockPage {
  items: AnnotationFeedback[];
  next_cursor: string | null;
}

interface MockQuery {
  data: { pages: MockPage[] } | undefined;
  hasNextPage: boolean;
  isError?: boolean;
  error?: unknown;
  fetchNextPage: () => Promise<unknown>;
  refetch: () => Promise<unknown>;
}

vi.mock("@/api/feedbacks", () => ({
  feedbacksApi: {
    list: (...args: unknown[]) => mocks.apiList(...args),
  },
}));

vi.mock("@/hooks/useFeedbacks", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useFeedbacks")>("@/hooks/useFeedbacks");
  return {
    ...actual,
    useInfiniteFeedbacks: (...args: Parameters<typeof actual.useInfiniteFeedbacks>) => {
      mocks.useInfiniteFeedbacks(...args);
      return mocks.query ?? actual.useInfiniteFeedbacks(...args);
    },
  };
});

vi.mock("./DiscussionDraftProvider", () => ({
  useDiscussionDraftStore: () => mocks.store,
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector: (state: typeof mocks.auth) => unknown) => selector(mocks.auth),
}));

function issue(
  id: string,
  createdAt: string,
  overrides: Partial<AnnotationFeedback> = {},
): AnnotationFeedback {
  return {
    id,
    kind: "issue",
    anchor_type: "task",
    project_id: "project-a",
    task_id: "task-a",
    annotation_id: null,
    anchor_position: null,
    status: "open",
    severity: "warn",
    title: null,
    body: id,
    author_id: "author",
    author_name: "Author",
    attachments: [],
    thread_parent_id: null,
    is_active: true,
    resolved_at: null,
    resolved_by_id: null,
    created_at: createdAt,
    updated_at: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function setupQuery(pages: MockPage[], nextPage?: MockPage) {
  let currentPages = pages;
  const query: MockQuery = {
    data: { pages: currentPages },
    hasNextPage: pages[pages.length - 1]?.next_cursor != null,
    fetchNextPage: vi.fn(async () => {
      if (nextPage) currentPages = [...currentPages, nextPage];
      query.data = { pages: currentPages };
      query.hasNextPage = currentPages[currentPages.length - 1]?.next_cursor != null;
      return query;
    }),
    refetch: vi.fn(async () => query),
  };
  mocks.query = query;
  return query;
}

function renderSequence(
  current: AnnotationFeedback | null,
  options: { projectId?: string; taskId?: string | null; enabled?: boolean } = {},
  client?: QueryClient,
) {
  const props = {
    projectId: options.projectId ?? "project-a",
    taskId: options.taskId === undefined ? "task-a" : options.taskId,
    current,
    enabled: options.enabled,
  };
  const wrapper = client
    ? ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    : undefined;
  return renderHook((value) => useIssueSequence(value), { initialProps: props, wrapper });
}

async function go(
  view: ReturnType<typeof renderSequence>,
  direction: "previous" | "next",
): Promise<AnnotationFeedback | null> {
  let result: AnnotationFeedback | null = null;
  await act(async () => {
    result = await view.result.current.go(direction);
  });
  return result;
}

beforeEach(() => {
  mocks.auth.user = { id: "user-a" };
  mocks.store.owner = { userId: "user-a", sessionId: "session-a" };
  mocks.store.isOwned.mockReturnValue(true);
  mocks.query = null;
  mocks.apiList.mockReset();
  mocks.useInfiniteFeedbacks.mockClear();
});

describe("useIssueSequence", () => {
  it("uses the shared open-root query family with a page size of 50", () => {
    const current = issue("current", "2026-09-11T00:00:00.000001Z");
    setupQuery([{ items: [current], next_cursor: null }]);
    renderSequence(current);
    expect(mocks.useInfiniteFeedbacks).toHaveBeenCalledWith(
      {
        project_id: "project-a",
        task_id: "task-a",
        kind: "issue",
        status: "open",
        root_only: true,
        limit: 50,
      },
      true,
    );
  });

  it("walks beyond the first 50 roots and does not wrap at either end", async () => {
    const first = Array.from({ length: 50 }, (_, index) =>
      issue(
        "root-" + String(index).padStart(2, "0"),
        "2026-09-11T00:00:" + String(50 - index).padStart(2, "0") + "Z",
      ),
    );
    const current = issue("root-50", "2026-09-11T00:00:00Z");
    const older = issue("root-51", "2026-09-10T23:59:59Z");
    const query = setupQuery([{ items: first, next_cursor: "page-2" }], {
      items: [current, older],
      next_cursor: null,
    });
    const view = renderSequence(current);

    expect(view.result.current.previousState).toBe("unknown");
    await expect(go(view, "next")).resolves.toBe(older);
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(view.result.current.nextState).toBe("available");
    expect(view.result.current.previousState).toBe("available");

    const newestView = renderSequence(first[0]);
    expect(newestView.result.current.previousState).toBe("unavailable");
    await expect(go(newestView, "previous")).resolves.toBeNull();

    const oldestView = renderSequence(older);
    expect(oldestView.result.current.nextState).toBe("unavailable");
    await expect(go(oldestView, "next")).resolves.toBeNull();
  });

  it("keeps exact microsecond and UUID ordering for a resolved insertion anchor", async () => {
    const newerSameMs = issue(
      "00000000-0000-0000-0000-000000000002",
      "2026-09-11T00:00:00.123456Z",
    );
    const olderSameMs = issue(
      "00000000-0000-0000-0000-000000000001",
      "2026-09-11T00:00:00.123455Z",
    );
    const current = issue("current", "2026-09-11T00:00:00.123455Z", { status: "resolved" });
    setupQuery([{ items: [newerSameMs, olderSameMs], next_cursor: null }]);
    const view = renderSequence(current);

    expect(view.result.current.previousState).toBe("available");
    expect(view.result.current.nextState).toBe("available");
    await expect(go(view, "previous")).resolves.toBe(newerSameMs);
    await expect(go(view, "next")).resolves.toBe(olderSameMs);
  });

  it("keeps a resolved insertion boundary unknown until the loaded tail is exhausted", async () => {
    const current = issue("resolved", "2026-09-11T00:00:00Z", { status: "resolved" });
    const newer = issue("newer", "2026-09-11T00:00:02Z");
    const older = issue("older", "2026-09-11T00:00:00Z");
    const query = setupQuery([{ items: [newer], next_cursor: "page-2" }], {
      items: [older],
      next_cursor: null,
    });
    const view = renderSequence(current);

    expect(view.result.current.previousState).toBe("unknown");
    await expect(go(view, "previous")).resolves.toBe(newer);
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["start", "2026-09-11T00:00:03Z", "unavailable", "first"],
    ["middle", "2026-09-11T00:00:01.500000Z", "available", "second"],
    ["end", "2026-09-11T00:00:00Z", "available", null],
  ] as const)(
    "finds a resolved root insertion point at the %s",
    (_name, anchor, previousState, nextId) => {
      const first = issue("first", "2026-09-11T00:00:02Z");
      const second = issue("second", "2026-09-11T00:00:01Z");
      const current = issue("resolved", anchor, { status: "wont_fix" });
      setupQuery([{ items: [first, second], next_cursor: null }]);
      const view = renderSequence(current);
      expect(view.result.current.previousState).toBe(previousState);
      if (nextId) expect(view.result.current.nextState).toBe("available");
      else expect(view.result.current.nextState).toBe("unavailable");
    },
  );

  it("filters task scope, permits project scope, and reports an explicit outside-scope root", () => {
    const current = issue("current", "2026-09-11T00:00:02Z");
    const sameProjectOtherTask = issue("other-task", "2026-09-11T00:00:03Z", { task_id: "task-b" });
    const otherProject = issue("other-project", "2026-09-11T00:00:04Z", {
      project_id: "project-b",
    });
    setupQuery([{ items: [otherProject, sameProjectOtherTask, current], next_cursor: null }]);
    const taskView = renderSequence(current);
    expect(taskView.result.current.previousState).toBe("unavailable");

    const projectView = renderSequence(current, { taskId: null });
    expect(projectView.result.current.previousState).toBe("available");
    expect(projectView.result.current.go).toBeDefined();

    const outsideView = renderSequence(current, { projectId: "project-b" });
    expect(outsideView.result.current.outsideScope).toBe(true);
    expect(outsideView.result.current.previousState).toBe("unavailable");
  });

  it("ignores invalid roots and stops on a repeating cursor instead of looping", async () => {
    const current = issue("current", "2026-09-11T00:00:01Z");
    const invalid = issue("invalid", "2026-09-11T00:00:02Z", { is_active: false });
    const query = setupQuery([{ items: [invalid], next_cursor: "repeat" }]);
    query.hasNextPage = true;
    query.fetchNextPage = vi.fn(async () => query);
    const view = renderSequence(current);

    await expect(go(view, "next")).resolves.toBeNull();
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(view.result.current.error).toBeInstanceOf(Error);
    expect(view.result.current.nextState).toBe("unknown");
    expect(view.result.current.previousState).toBe("unknown");
  });

  it("reports a malformed cursor as an error before issuing another page request", async () => {
    const current = issue("current", "2026-09-11T00:00:01Z");
    const query = setupQuery([{ items: [], next_cursor: 42 as unknown as string }]);
    query.hasNextPage = true;
    const view = renderSequence(current);

    await expect(go(view, "next")).resolves.toBeNull();
    expect(query.fetchNextPage).not.toHaveBeenCalled();
    expect(view.result.current.error).toBeInstanceOf(Error);
    expect(view.result.current.nextState).toBe("unknown");
  });

  it("retires a delayed walk when task, root, or session ownership changes", async () => {
    const currentA = issue("current-a", "2026-09-11T00:00:02Z");
    const currentB = issue("current-b", "2026-09-11T00:00:01Z");
    const pending = deferred<unknown>();
    const query = setupQuery([{ items: [], next_cursor: "page-2" }]);
    query.fetchNextPage = vi.fn(() => pending.promise);
    const view = renderSequence(currentA);
    let walk!: Promise<AnnotationFeedback | null>;
    act(() => {
      walk = view.result.current.go("next");
    });
    expect(view.result.current.loading).toBe(true);

    view.rerender({
      projectId: "project-a",
      taskId: "task-b",
      current: currentB,
      enabled: undefined,
    });
    expect(view.result.current.loading).toBe(false);
    pending.resolve({ data: { pages: [{ items: [currentA], next_cursor: null }] } });
    await expect(walk).resolves.toBeNull();
    expect(view.result.current.loading).toBe(false);

    mocks.store.owner = { userId: "user-a", sessionId: "session-b" };
    view.rerender({
      projectId: "project-a",
      taskId: "task-b",
      current: currentB,
      enabled: undefined,
    });
    mocks.auth.user = null;
    view.rerender({
      projectId: "project-a",
      taskId: "task-b",
      current: currentB,
      enabled: undefined,
    });
    expect(view.result.current.nextState).toBe("unavailable");
  });

  it("checks the originating draft owner again after a delayed page resolves", async () => {
    const current = issue("current", "2026-09-11T00:00:01Z");
    const pending = deferred<unknown>();
    const query = setupQuery([{ items: [], next_cursor: "page-2" }]);
    query.fetchNextPage = vi.fn(() => pending.promise);
    const view = renderSequence(current);
    let walk!: Promise<AnnotationFeedback | null>;
    act(() => {
      walk = view.result.current.go("next");
    });
    mocks.store.isOwned.mockReturnValue(false);
    pending.resolve({ data: { pages: [{ items: [], next_cursor: null }] } });
    await expect(walk).resolves.toBeNull();
    expect(mocks.store.isOwned).toHaveBeenCalled();
  });

  it("reports a query failure and lets a repeated go retry it", async () => {
    const current = issue("current", "2026-09-11T00:00:02Z");
    const next = issue("next", "2026-09-11T00:00:01Z");
    const query = setupQuery([{ items: [current], next_cursor: "page-2" }]);
    query.hasNextPage = true;
    const failure = new Error("page failed");
    query.fetchNextPage = vi.fn(async () => {
      query.isError = true;
      query.error = failure;
      throw failure;
    });
    query.refetch = vi.fn(async () => {
      query.data = { pages: [{ items: [current, next], next_cursor: null }] };
      query.hasNextPage = false;
      query.isError = false;
      query.error = null;
      return query;
    });
    const view = renderSequence(current);

    await expect(go(view, "next")).resolves.toBeNull();
    expect(view.result.current.error).toBe(failure);
    expect(view.result.current.nextState).toBe("unknown");

    await expect(go(view, "next")).resolves.toBe(next);
    expect(query.refetch).toHaveBeenCalledTimes(1);
    expect(query.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("joins an invalidation refetch before navigating a root whose status just changed", async () => {
    const currentOpen = issue("current", "2026-09-11T00:00:01Z");
    const newer = issue("newer", "2026-09-11T00:00:02Z");
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const fresh = deferred<{ items: AnnotationFeedback[]; next_cursor: null }>();
    let refreshed = false;
    mocks.apiList.mockImplementation((params: { cursor?: string }) => {
      if (refreshed) return fresh.promise;
      return Promise.resolve({
        items: [currentOpen],
        next_cursor: params.cursor ? null : null,
      });
    });
    const view = renderSequence(currentOpen, {}, client);
    await waitFor(() => expect(view.result.current.nextState).toBe("unavailable"));

    refreshed = true;
    const resolved = { ...currentOpen, status: "resolved" as const };
    view.rerender({
      projectId: "project-a",
      taskId: "task-a",
      current: resolved,
      enabled: undefined,
    });
    const invalidation = client.invalidateQueries({ queryKey: ["feedbacks", "project-a"] });
    await waitFor(() => expect(mocks.apiList).toHaveBeenCalledTimes(2));
    const navigation = go(view, "previous");
    fresh.resolve({ items: [newer], next_cursor: null });

    await expect(navigation).resolves.toMatchObject({ id: "newer" });
    await invalidation;
    view.unmount();
    client.clear();
  });

  it("does not fetch without an authenticated discussion owner or a current root", () => {
    const current = issue("current", "2026-09-11T00:00:01Z");
    setupQuery([{ items: [current], next_cursor: null }]);
    mocks.store.owner = null;
    const noOwner = renderSequence(current);
    expect(noOwner.result.current.previousState).toBe("unavailable");
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(expect.anything(), false);

    const noRoot = renderSequence(null);
    expect(noRoot.result.current.nextState).toBe("unavailable");
  });
});
