import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationFeedback } from "@/api/feedbacks";
import { DiscussionIssueDetail } from "./DiscussionIssueDetail";

const mocks = vi.hoisted(() => ({
  thread: null as Record<string, any> | null,
  sequence: {
    previousState: "available" as string,
    nextState: "available" as string,
    loading: false,
    error: null as Error | null,
    outsideScope: false,
    lastArgs: null as unknown[] | null,
    go: vi.fn((_direction: string) => Promise.resolve(null as AnnotationFeedback | null)),
    cancel: vi.fn(),
  },
  patchAsync: vi.fn(() => Promise.resolve({})),
  deleteAsync: vi.fn(() => Promise.resolve(undefined)),
  replyAsync: vi.fn(() => Promise.resolve({})),
  commentInputProps: null as Record<string, any> | null,
}));

vi.mock("@/hooks/useIssueThread", () => ({
  useIssueThread: () => mocks.thread,
}));

vi.mock("../state/useIssueSequence", () => ({
  useIssueSequence: (...args: unknown[]) => {
    mocks.sequence.lastArgs = args;
    return mocks.sequence;
  },
}));

vi.mock("@/hooks/useFeedbacks", () => ({
  usePatchFeedback: () => ({ mutateAsync: mocks.patchAsync }),
  useDeleteFeedback: () => ({ mutateAsync: mocks.deleteAsync }),
  useReplyFeedback: () => ({ mutateAsync: mocks.replyAsync }),
}));

vi.mock("./CommentInput", () => ({
  CommentInput: (props: Record<string, any>) => {
    mocks.commentInputProps = props;
    return (
      <button
        type="button"
        data-testid="mock-comment-input"
        onClick={() =>
          void props.onSubmit({
            body: "新回复",
            mentions: [],
            attachments: [],
            canvas_drawing: null,
          })
        }
      >
        回复编辑器
      </button>
    );
  },
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
    body: "根问题描述",
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

function reply(id: string, overrides: Partial<AnnotationFeedback> = {}): AnnotationFeedback {
  return issue({
    id,
    body: `回复 ${id}`,
    title: null,
    thread_parent_id: "root-1",
    created_at: `2026-09-11T00:${id.slice(-1).padStart(2, "0")}:00.000Z`,
    ...overrides,
  });
}

function readyThread(overrides: Record<string, unknown> = {}) {
  return {
    root: issue(),
    replies: [reply("reply-1")],
    state: "ready",
    isLoading: false,
    isFetching: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    paginationError: null,
    loadEarlierReplies: vi.fn(() => Promise.resolve()),
    retryEarlierReplies: vi.fn(() => Promise.resolve()),
    retry: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

function setup(overrides: Record<string, unknown> = {}) {
  const onBack = vi.fn();
  const onOpenIssue = vi.fn();
  const onLocate = vi.fn();
  const onRequestProjectScope = vi.fn();
  const props = {
    rootId: "root-1",
    projectId: "P1",
    taskId: "T1",
    onBack,
    onOpenIssue,
    onLocate,
    onRequestProjectScope,
    ...overrides,
  };
  const view = render(<DiscussionIssueDetail {...props} />);
  return { ...view, props, onBack, onOpenIssue, onLocate, onRequestProjectScope };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.thread = readyThread();
  mocks.sequence.previousState = "available";
  mocks.sequence.nextState = "available";
  mocks.sequence.loading = false;
  mocks.sequence.error = null;
  mocks.sequence.outsideScope = false;
  mocks.sequence.go.mockResolvedValue(null);
  mocks.patchAsync.mockResolvedValue({});
  mocks.deleteAsync.mockResolvedValue(undefined);
  mocks.replyAsync.mockResolvedValue({});
  mocks.commentInputProps = null;
});

describe("DiscussionIssueDetail", () => {
  it("does not expose a pin snapshot before the independent root request is ready", () => {
    mocks.thread = readyThread({ root: null, replies: [], state: "loading" });
    setup({ rootSnapshot: issue({ body: "不应先显示" }) });
    expect(screen.getByTestId("discussion-issue-detail")).toHaveAttribute(
      "data-issue-id",
      "root-1",
    );
    expect(screen.queryByText("不应先显示")).toBeNull();
    expect(screen.queryByTestId("mock-comment-input")).toBeNull();
  });

  it("renders the root, 50+ chronological replies, parent context and older-page control", () => {
    const replies = Array.from({ length: 53 }, (_, index) =>
      reply(`reply-${String(index).padStart(2, "0")}`, {
        created_at: `2026-09-11T00:${String(52 - index).padStart(2, "0")}:00.000Z`,
        thread_parent_id: index === 0 ? "root-1" : "reply-00",
      }),
    );
    replies[52] = {
      ...reply("reply-52", { thread_parent_id: "deleted-parent" }),
      parentContext: {
        id: "deleted-parent",
        body: "上级回复尚未加载或已不可见",
        authorName: null,
        available: false,
      },
    } as (typeof replies)[number];
    mocks.thread = readyThread({ replies, hasNextPage: true });
    setup();
    expect(screen.getByTestId("discussion-issue-root-root-1")).toHaveTextContent("根问题描述");
    expect(screen.getAllByTestId(/^discussion-issue-reply-/)).toHaveLength(53);
    expect(screen.getByTestId("discussion-issue-reply-reply-52")).toHaveTextContent(
      "尚未加载或已不可见",
    );
    expect(screen.getByRole("button", { name: "加载更早回复" })).toBeTruthy();
  });

  it("posts replies to the active root through the one session-backed composer target", async () => {
    setup();
    expect(mocks.commentInputProps?.target).toEqual({
      projectId: "P1",
      taskId: "T1",
      kind: "issue",
      rootIssueId: "root-1",
    });
    fireEvent.click(screen.getByTestId("mock-comment-input"));
    await waitFor(() =>
      expect(mocks.replyAsync).toHaveBeenCalledWith({
        id: "root-1",
        body: "新回复",
        attachments: [],
      }),
    );
  });

  it("keeps detail mounted while resolving and uses server action capabilities", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "解决" }));
    await waitFor(() =>
      expect(mocks.patchAsync).toHaveBeenCalledWith({
        id: "root-1",
        payload: { status: "resolved" },
      }),
    );
    expect(screen.getByTestId("discussion-issue-detail")).toBeTruthy();
    expect(screen.getByText("根问题描述")).toBeTruthy();
  });

  it("requires explicit delete confirmation and leaves a deleted root unavailable", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    expect(screen.getByText("确认删除这个问题？")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    await waitFor(() =>
      expect(mocks.deleteAsync).toHaveBeenCalledWith(expect.objectContaining({ id: "root-1" })),
    );
    expect(screen.getByTestId("discussion-issue-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("mock-comment-input")).toBeNull();
  });

  it("renders permission denial separately and never offers mutation controls", () => {
    mocks.thread = readyThread({ root: null, replies: [], state: "permission-denied" });
    setup();
    expect(screen.getByTestId("discussion-issue-permission-denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "解决" })).toBeNull();
    expect(screen.queryByTestId("mock-comment-input")).toBeNull();
  });

  it("keeps the validated thread visible when an older-page request fails", async () => {
    const retryEarlierReplies = vi.fn(() => Promise.resolve());
    mocks.thread = readyThread({
      state: "error",
      error: new Error("503 Service Unavailable"),
      paginationError: new Error("503 Service Unavailable"),
      hasNextPage: true,
      retryEarlierReplies,
    });
    setup();
    expect(screen.getByTestId("discussion-issue-root-root-1")).toHaveTextContent("根问题描述");
    expect(screen.getByTestId("discussion-issue-reply-reply-1")).toHaveTextContent("回复 reply-1");
    expect(screen.getByTestId("discussion-issue-thread-error")).toHaveAttribute("role", "alert");
    expect(screen.getByTestId("discussion-issue-thread-error")).toHaveTextContent(
      "无法加载更早回复：503 Service Unavailable",
    );
    fireEvent.click(
      within(screen.getByTestId("discussion-issue-thread-error")).getByRole("button", {
        name: "重试",
      }),
    );
    await waitFor(() => expect(retryEarlierReplies).toHaveBeenCalledTimes(1));
  });

  it("keeps location explicit and opens the sequence result without locating the canvas", async () => {
    const next = issue({ id: "next-root", body: "下一条" });
    const located = issue({
      anchor_type: "pixel",
      anchor_position: { x: 0.2, y: 0.4, frame: 8 },
    });
    mocks.thread = readyThread({ root: located });
    mocks.sequence.go.mockResolvedValue(next);
    const view = setup();
    fireEvent.click(screen.getByRole("button", { name: "定位问题：需要复核" }));
    expect(view.onLocate).toHaveBeenCalledWith(located);
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    await waitFor(() => expect(view.onOpenIssue).toHaveBeenCalledWith(next));
    expect(mocks.sequence.lastArgs?.[0]).toEqual(
      expect.objectContaining({ projectId: "P1", taskId: "T1", current: expect.anything() }),
    );
  });

  it("keeps project-scope navigation available across tasks", () => {
    mocks.thread = readyThread({ root: issue({ task_id: "T2" }) });
    setup({ allowProjectScope: true, listScope: "project" });
    expect(
      screen.queryByText("该问题不在当前任务范围内，切换到项目范围后可使用上一条 / 下一条。"),
    ).toBeNull();
    expect(mocks.sequence.lastArgs?.[0]).toEqual(expect.objectContaining({ taskId: null }));
  });

  it("switches an out-of-task detail to project scope before sequence navigation", async () => {
    mocks.thread = readyThread({ root: issue({ task_id: "T2" }) });
    mocks.sequence.outsideScope = true;
    const view = setup({ listScope: "task", allowProjectScope: true });
    const onRequestProjectScope = vi.fn(() => {
      mocks.sequence.outsideScope = false;
      view.rerender(
        <DiscussionIssueDetail
          {...view.props}
          listScope="project"
          onRequestProjectScope={onRequestProjectScope}
        />,
      );
    });
    view.rerender(
      <DiscussionIssueDetail
        {...view.props}
        listScope="task"
        allowProjectScope
        onRequestProjectScope={onRequestProjectScope}
      />,
    );
    expect(
      screen.getByText("该问题不在当前任务范围内，切换到项目范围后可使用上一条 / 下一条。"),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("discussion-issue-switch-project-root-1"));
    expect(onRequestProjectScope).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("discussion-issue-switch-project-root-1")).toBeNull();
    expect(mocks.sequence.lastArgs?.[0]).toEqual(expect.objectContaining({ taskId: null }));
    const next = issue({ id: "next-root", task_id: "T2" });
    mocks.sequence.go.mockResolvedValue(next);
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    await waitFor(() => expect(view.onOpenIssue).toHaveBeenCalledWith(next));
    expect(view.onLocate).not.toHaveBeenCalled();
  });

  it("retries the last requested sequence direction through go", async () => {
    const view = setup();
    mocks.sequence.error = new Error("暂时失败");
    view.rerender(<DiscussionIssueDetail {...view.props} />);
    fireEvent.click(screen.getByRole("button", { name: "下一条" }));
    await waitFor(() => expect(mocks.sequence.go).toHaveBeenCalledWith("next"));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.sequence.go).toHaveBeenCalledTimes(2));
    expect(mocks.sequence.go).toHaveBeenLastCalledWith("next");
  });
});
