import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { DiscussionIssuesTab } from "./DiscussionIssuesTab";

const mocks = vi.hoisted(() => ({
  useInfiniteFeedbacks: vi.fn(),
  patchMutate: vi.fn(),
  deleteMutate: vi.fn(),
  query: null as Record<string, any> | null,
  store: {
    highlightId: null as string | null,
    focusIssue: vi.fn(),
    detailRequestTick: 0,
    detailTarget: null as AnnotationFeedback | null,
    detailTargetId: null as string | null,
    detailOwnerId: null as string | null,
    detailScope: null as { projectId: string; taskId: string | null } | null,
    openIssueDetail: vi.fn(),
    closeIssueDetail: vi.fn(),
  },
  detailProps: null as Record<string, any> | null,
}));

vi.mock("@/hooks/useFeedbacks", () => ({
  useInfiniteFeedbacks: (...args: unknown[]) => mocks.useInfiniteFeedbacks(...args),
  usePatchFeedback: () => ({ mutate: mocks.patchMutate }),
  useDeleteFeedback: () => ({ mutate: mocks.deleteMutate }),
}));

vi.mock("../state/useActiveIssueStore", () => ({
  useActiveIssueStore: (selector: (state: typeof mocks.store) => unknown) => selector(mocks.store),
}));

vi.mock("./DiscussionIssueDetail", () => ({
  DiscussionIssueDetail: (props: Record<string, any>) => {
    mocks.detailProps = props;
    return (
      <div data-testid="discussion-issue-detail" data-issue-id={props.rootId}>
        <button type="button" onClick={props.onBack}>
          返回问题列表
        </button>
      </div>
    );
  },
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
  mocks.store.detailRequestTick = 0;
  mocks.store.detailTarget = null;
  mocks.store.detailTargetId = null;
  mocks.store.detailOwnerId = null;
  mocks.store.detailScope = null;
  mocks.detailProps = null;
  mocks.query = query();
  mocks.useInfiniteFeedbacks.mockImplementation(() => mocks.query);
});

describe("DiscussionIssuesTab", () => {
  it("defaults to open, sends server filters, exposes exact counts and aria-pressed state", () => {
    setup();
    expect(screen.getByTestId("issue-status-open")).toHaveAttribute("aria-pressed", "true");
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
    expect(screen.getByTestId("issue-status-resolved")).toHaveAttribute("aria-pressed", "true");
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "resolved", root_only: true }),
    );
  });

  it("keeps unknown instead of deriving a count from loaded rows", () => {
    mocks.query = query({
      data: { pages: [{ items: [issue(), issue({ id: "issue-2" })], next_cursor: null }] },
    });
    setup();
    expect(screen.getByTestId("issue-open-count")).toHaveAttribute("data-state", "unknown");
    expect(screen.getByTestId("issue-open-count")).toHaveTextContent("待处理 —");
  });

  it("keeps task and pixel creation intents separate", () => {
    const view = setup();
    fireEvent.click(screen.getByTestId("issue-create-task"));
    fireEvent.click(screen.getByTestId("issue-create-pixel"));
    expect(view.onCreateTaskIssue).toHaveBeenCalledTimes(1);
    expect(view.onCreatePixelIssue).toHaveBeenCalledTimes(1);
  });

  it("opens a readable detail from the title without invoking canvas focus", () => {
    const target = issue({ id: "task-only", title: "任务层问题" });
    mocks.query = query({
      data: { pages: [{ items: [target], next_cursor: null, status_counts: { open: 1 } }] },
    });
    setup();
    fireEvent.click(screen.getByTestId("discussion-issue-open-task-only"));
    expect(screen.getByTestId("discussion-issue-detail")).toHaveAttribute(
      "data-issue-id",
      "task-only",
    );
    expect(mocks.store.openIssueDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "task-only" }),
      { projectId: "P1", taskId: "T1" },
    );
    expect(mocks.store.focusIssue).not.toHaveBeenCalled();
  });

  it("keeps card identity and uses an explicit locate action with the full snapshot", () => {
    const target = issue({
      id: "pixel-1",
      title: "画布问题",
      anchor_type: "pixel",
      anchor_position: { x: 0.2, y: 0.4, frame: 8 },
    });
    mocks.query = query({ data: { pages: [{ items: [target], next_cursor: null }] } });
    setup();
    expect(screen.getByTestId("discussion-issue-card-pixel-1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("discussion-issue-locate-pixel-1"));
    expect(mocks.store.focusIssue).toHaveBeenCalledWith(target);
    expect(screen.getByTestId("discussion-issue-open-pixel-1")).toHaveAttribute(
      "aria-label",
      "打开问题：画布问题",
    );
  });

  it("opens a filtered-out pin snapshot directly and preserves the selected list filter", () => {
    const view = setup({ allowProjectScope: true });
    fireEvent.click(screen.getByTestId("issue-status-resolved"));
    mocks.store.detailTarget = issue({ id: "pin-unloaded", status: "resolved", task_id: "T1" });
    mocks.store.detailTargetId = "pin-unloaded";
    mocks.store.detailScope = { projectId: "P1", taskId: "T1" };
    mocks.store.detailRequestTick = 1;
    view.rerender(<DiscussionIssuesTab {...view.props} allowProjectScope />);
    expect(screen.getByTestId("discussion-issue-detail")).toHaveAttribute(
      "data-issue-id",
      "pin-unloaded",
    );
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "resolved" }),
    );
  });

  it("passes project read capability to task-scope detail and switches to project scope", () => {
    const target = issue({ id: "foreign", task_id: "T2", title: "其他任务问题" });
    mocks.store.detailTarget = target;
    mocks.store.detailTargetId = target.id;
    mocks.store.detailScope = { projectId: "P1", taskId: "T2" };
    mocks.store.detailRequestTick = 1;
    const view = setup({ allowProjectScope: true });
    expect(screen.getByTestId("discussion-issue-detail")).toHaveAttribute(
      "data-issue-id",
      "foreign",
    );
    expect(mocks.detailProps).toEqual(
      expect.objectContaining({
        allowProjectScope: true,
        listScope: "task",
        taskId: "T1",
        rootSnapshot: target,
        onRequestProjectScope: expect.any(Function),
      }),
    );
    act(() => {
      mocks.detailProps?.onRequestProjectScope();
    });
    expect(mocks.detailProps).toEqual(expect.objectContaining({ listScope: "project" }));
    expect(mocks.store.focusIssue).not.toHaveBeenCalled();
    view.unmount();
  });

  it("remembers list scroll before an external pin opens detail", () => {
    const view = setup({ allowProjectScope: true });
    const list = screen.getByTestId("discussion-issue-list-scroll");
    Object.defineProperty(list, "scrollTop", { configurable: true, value: 123, writable: true });
    fireEvent.scroll(list);
    mocks.store.detailTarget = issue({ id: "pin-scroll", task_id: "T1" });
    mocks.store.detailTargetId = "pin-scroll";
    mocks.store.detailScope = { projectId: "P1", taskId: "T1" };
    mocks.store.detailRequestTick = 1;
    view.rerender(<DiscussionIssuesTab {...view.props} allowProjectScope />);
    fireEvent.click(screen.getByRole("button", { name: "返回问题列表" }));
    expect(screen.getByTestId("discussion-issue-list-scroll")).toHaveProperty("scrollTop", 123);
  });

  it("ignores a stale detail snapshot from another task owner", () => {
    mocks.store.detailTarget = issue({ id: "foreign", task_id: "T2" });
    mocks.store.detailTargetId = "foreign";
    mocks.store.detailScope = { projectId: "P1", taskId: "T2" };
    mocks.store.detailRequestTick = 1;
    setup();
    expect(screen.queryByTestId("discussion-issue-detail")).toBeNull();
  });

  it("keeps failed status/delete mutations visible and ignores old owner callbacks", () => {
    const view = setup();
    fireEvent.click(screen.getByTitle("标为已解决"));
    expect(mocks.patchMutate).toHaveBeenCalledTimes(1);
    const oldPatch = mocks.patchMutate.mock.calls[0][1];
    view.rerender(<DiscussionIssuesTab {...view.props} taskId="T2" />);
    act(() => {
      oldPatch.onError(new Error("旧状态错误"));
      oldPatch.onSettled();
    });
    expect(screen.queryByTestId("issue-mutation-error")).toBeNull();
    fireEvent.click(screen.getByTestId("issue-delete-issue-1"));
    fireEvent.click(screen.getByTestId("issue-delete-confirm-issue-1"));
    expect(mocks.deleteMutate).toHaveBeenCalledTimes(1);
    const oldDelete = mocks.deleteMutate.mock.calls[0][1];
    view.rerender(<DiscussionIssuesTab {...view.props} taskId="T3" />);
    act(() => {
      oldDelete.onError(new Error("旧删除错误"));
      oldDelete.onSettled();
    });
    expect(screen.queryByTestId("issue-mutation-error")).toBeNull();
  });
});
