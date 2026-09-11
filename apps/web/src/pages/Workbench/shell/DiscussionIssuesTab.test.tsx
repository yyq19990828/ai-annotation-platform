import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { DiscussionIssuesTab } from "./DiscussionIssuesTab";

const mocks = vi.hoisted(() => ({
  useInfiniteFeedbacks: vi.fn(),
  patchMutate: vi.fn(),
  deleteMutate: vi.fn(),
  query: null as Record<string, unknown> | null,
  store: {
    highlightId: null as string | null,
    pinRequestTick: 0,
    pinTarget: null as AnnotationFeedback | null,
    focusIssue: vi.fn(),
  },
}));

vi.mock("@/hooks/useFeedbacks", () => ({
  useInfiniteFeedbacks: (...args: unknown[]) => mocks.useInfiniteFeedbacks(...args),
  usePatchFeedback: () => ({ mutate: mocks.patchMutate }),
  useDeleteFeedback: () => ({ mutate: mocks.deleteMutate }),
}));

vi.mock("../state/useActiveIssueStore", () => ({
  useActiveIssueStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));

function issue(overrides: Partial<AnnotationFeedback> = {}): AnnotationFeedback {
  return {
    id: "issue-1",
    kind: "issue",
    anchor_type: "task",
    project_id: "P1",
    task_id: "T1",
    annotation_id: null,
    anchor_position: null,
    status: "open",
    severity: "warn",
    title: null,
    body: "需要复核",
    author_id: "U1",
    author_name: "审核员",
    attachments: [],
    thread_parent_id: null,
    is_active: true,
    resolved_at: null,
    resolved_by_id: null,
    created_at: "2026-09-11T00:00:00Z",
    updated_at: null,
    actions: { edit: true, change_status: true, delete: true, reply: true },
    ...overrides,
  };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      pages: [
        {
          items: [issue()],
          next_cursor: null,
          status_counts: { open: 7, resolved: 2, wont_fix: 1 },
        },
      ],
      pageParams: [null],
    },
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    isError: false,
    error: null,
    hasNextPage: false,
    fetchNextPage: vi.fn(() => Promise.resolve()),
    refetch: vi.fn(() => Promise.resolve()),
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

function setup(overrides: Partial<ComponentProps<typeof DiscussionIssuesTab>> = {}) {
  const onCreateTaskIssue = vi.fn();
  const onCreatePixelIssue = vi.fn();
  const props: ComponentProps<typeof DiscussionIssuesTab> = {
    projectId: "P1",
    taskId: "T1",
    onCreateTaskIssue,
    onCreatePixelIssue,
    ...overrides,
  };
  return {
    ...render(<DiscussionIssuesTab {...props} />),
    props,
    onCreateTaskIssue,
    onCreatePixelIssue,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.highlightId = null;
  mocks.store.pinRequestTick = 0;
  mocks.store.pinTarget = null;
  mocks.query = query();
  mocks.useInfiniteFeedbacks.mockImplementation(() => mocks.query);
});

describe("DiscussionIssuesTab", () => {
  it("defaults to open and sends status/root/count filters to the server", () => {
    setup();
    expect(screen.getByTestId("issue-status-open").className).toContain("border-brand");
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({
        task_id: "T1",
        kind: "issue",
        status: "open",
        root_only: true,
        include_counts: true,
      }),
    );
    expect(screen.getByTestId("issue-open-count")).toHaveTextContent("待处理 7");

    fireEvent.click(screen.getByTestId("issue-status-resolved"));
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "resolved", root_only: true }),
    );
  });

  it("uses the exact server count and keeps a matching item from a later loaded page", () => {
    mocks.query = query({
      data: {
        pages: [
          { items: [], next_cursor: "next", status_counts: { open: 12 } },
          { items: [issue({ id: "issue-later" })], next_cursor: null },
        ],
        pageParams: [null, "next"],
      },
    });
    const view = setup();
    expect(screen.getByTestId("issue-open-count")).toHaveTextContent("待处理 12");
    expect(screen.getByTestId("discussion-issue-card-issue-later")).toBeTruthy();
    view.unmount();
  });

  it("shows unknown rather than a partial loaded-row count while counts are absent", () => {
    mocks.query = query({
      data: {
        pages: [{ items: [issue(), issue({ id: "issue-2" })], next_cursor: null }],
        pageParams: [null],
      },
    });
    setup();
    expect(screen.getByTestId("issue-open-count")).toHaveAttribute("data-state", "unknown");
    expect(screen.getByTestId("issue-open-count")).toHaveTextContent("待处理 —");
  });

  it("exposes separate task and pixel entry intents", () => {
    const view = setup();
    fireEvent.click(screen.getByTestId("issue-create-task"));
    fireEvent.click(screen.getByTestId("issue-create-pixel"));
    expect(view.onCreateTaskIssue).toHaveBeenCalledTimes(1);
    expect(view.onCreatePixelIssue).toHaveBeenCalledTimes(1);
  });

  it("honors server actions and surfaces status failures without hiding the Issue", async () => {
    const target = issue({
      actions: { edit: false, change_status: true, delete: false, reply: false },
    });
    mocks.query = query({
      data: { pages: [{ items: [target], next_cursor: null, status_counts: { open: 1 } }] },
    });
    setup();
    expect(screen.getByTitle("标为已解决")).toBeTruthy();
    expect(screen.queryByTitle("删除")).toBeNull();
    fireEvent.click(screen.getByTitle("标为已解决"));
    const callbacks = mocks.patchMutate.mock.calls[0][1] as {
      onError: (e: Error) => void;
      onSettled: () => void;
    };
    callbacks.onError(new Error("审核状态保存失败"));
    callbacks.onSettled();
    await waitFor(() =>
      expect(screen.getByTestId("issue-mutation-error")).toHaveTextContent("审核状态保存失败"),
    );
    expect(screen.getByTestId("discussion-issue-card-issue-1")).toBeTruthy();
  });

  it("requires confirmation before delete and keeps a failed deletion visible", async () => {
    setup();
    fireEvent.click(screen.getByTestId("issue-delete-issue-1"));
    expect(screen.getByText("确认删除？")).toBeTruthy();
    fireEvent.click(screen.getByTestId("issue-delete-confirm-issue-1"));
    const callbacks = mocks.deleteMutate.mock.calls[0][1] as {
      onError: (e: Error) => void;
      onSettled: () => void;
    };
    callbacks.onError(new Error("删除失败"));
    callbacks.onSettled();
    await waitFor(() =>
      expect(screen.getByTestId("issue-mutation-error")).toHaveTextContent("删除失败"),
    );
    expect(screen.getByTestId("discussion-issue-card-issue-1")).toBeTruthy();
  });

  it("restarts filtered-out pin recovery when the same pin is activated again", async () => {
    const hidden = query({
      data: { pages: [{ items: [], next_cursor: null }], pageParams: [null] },
    });
    mocks.query = hidden;
    const view = setup();

    fireEvent.click(screen.getByTestId("issue-status-resolved"));
    mocks.store.highlightId = "issue-1";
    mocks.store.pinRequestTick = 1;
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() =>
      expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("issue-pin-recovery")).toHaveAttribute("data-state", "unavailable"),
    );

    fireEvent.click(screen.getByTestId("issue-status-resolved"));
    mocks.store.pinRequestTick = 2;
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() =>
      expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("issue-pin-recovery")).toHaveAttribute("data-state", "unavailable"),
    );
  });

  it("does not recover a pin target from another task into the current Issue list", async () => {
    mocks.query = query({
      data: { pages: [{ items: [], next_cursor: "next" }], pageParams: [null] },
      hasNextPage: true,
    });
    const view = setup();
    mocks.store.highlightId = "foreign-target";
    mocks.store.pinTarget = issue({
      id: "foreign-target",
      project_id: "P2",
      task_id: "T2",
    });
    mocks.store.pinRequestTick = 1;
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() => expect(screen.queryByTestId("issue-pin-recovery")).toBeNull());
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "open", task_id: "T1" }),
    );
  });

  it("pages through three cursors before finding an unloaded pin", async () => {
    const second = deferred<unknown>();
    const third = deferred<unknown>();
    const fetchNextPage = vi
      .fn()
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    const page1 = {
      items: [issue({ id: "first-page" })],
      next_cursor: "cursor-2",
      status_counts: { open: 3 },
    };
    const page2 = {
      items: [issue({ id: "second-page" })],
      next_cursor: "cursor-3",
    };
    const page3 = {
      items: [issue({ id: "issue-target" })],
      next_cursor: null,
    };
    const page1Query = query({
      data: { pages: [page1], pageParams: [null] },
      hasNextPage: true,
      fetchNextPage,
    });
    mocks.query = page1Query;
    const view = setup();
    mocks.store.highlightId = "issue-target";
    mocks.store.pinRequestTick = 1;
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));

    mocks.query = query({
      data: { pages: [page1], pageParams: [null] },
      isFetchingNextPage: true,
      hasNextPage: true,
      fetchNextPage,
    });
    second.resolve({});
    await act(async () => {
      await second.promise;
    });
    mocks.query = query({
      data: { pages: [page1, page2], pageParams: [null, "cursor-2"] },
      hasNextPage: true,
      fetchNextPage,
    });
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(2));

    mocks.query = query({
      data: { pages: [page1, page2], pageParams: [null, "cursor-2"] },
      isFetchingNextPage: true,
      hasNextPage: true,
      fetchNextPage,
    });
    third.resolve({});
    await act(async () => {
      await third.promise;
    });
    mocks.query = query({
      data: { pages: [page1, page2, page3], pageParams: [null, "cursor-2", "cursor-3"] },
      hasNextPage: false,
      fetchNextPage,
    });
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() =>
      expect(screen.getByTestId("discussion-issue-card-issue-target")).toBeTruthy(),
    );
    expect(screen.queryByTestId("issue-pin-recovery")).toBeNull();
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("ignores a late recovery page after a new pin request supersedes it", async () => {
    const oldPage = deferred<unknown>();
    const newPage = deferred<unknown>();
    const fetchNextPage = vi
      .fn()
      .mockReturnValueOnce(oldPage.promise)
      .mockReturnValueOnce(newPage.promise);
    const firstPage = { items: [], next_cursor: "old-next" };
    const loadingQuery = () =>
      query({
        data: { pages: [firstPage], pageParams: [null] },
        isFetchingNextPage: true,
        hasNextPage: true,
        fetchNextPage,
      });
    mocks.query = query({
      data: { pages: [firstPage], pageParams: [null] },
      hasNextPage: true,
      fetchNextPage,
    });
    const view = setup();
    mocks.store.highlightId = "old-target";
    mocks.store.pinRequestTick = 1;
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(1));

    mocks.store.highlightId = "new-target";
    mocks.store.pinRequestTick = 2;
    mocks.query = loadingQuery();
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    oldPage.resolve({});
    await act(async () => {
      await oldPage.promise;
    });
    mocks.query = query({
      data: { pages: [firstPage], pageParams: [null] },
      hasNextPage: true,
      fetchNextPage,
    });
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() => expect(fetchNextPage).toHaveBeenCalledTimes(2));

    mocks.query = query({
      data: { pages: [firstPage], pageParams: [null] },
      isFetchingNextPage: true,
      hasNextPage: true,
      fetchNextPage,
    });
    newPage.resolve({});
    await act(async () => {
      await newPage.promise;
    });
    mocks.query = query({
      data: {
        pages: [firstPage, { items: [issue({ id: "new-target" })], next_cursor: null }],
        pageParams: [null, "old-next"],
      },
      hasNextPage: false,
      fetchNextPage,
    });
    view.rerender(<DiscussionIssuesTab {...view.props} />);
    await waitFor(() =>
      expect(screen.getByTestId("discussion-issue-card-new-target")).toBeTruthy(),
    );
    expect(screen.queryByTestId("discussion-issue-card-old-target")).toBeNull();
    expect(screen.queryByTestId("issue-pin-recovery")).toBeNull();
  });
});
