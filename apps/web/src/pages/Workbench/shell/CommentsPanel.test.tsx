import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ComponentProps } from "react";
import type { TaskDiscussionPage } from "@/api/discussion";

const mocks = vi.hoisted(() => {
  const taskQuery = {
    data: undefined as { pages: TaskDiscussionPage[]; pageParams: unknown[] } | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
  const legacyQuery = {
    data: undefined as
      | { pages: Array<{ items: never[]; next_cursor: null }>; pageParams: unknown[] }
      | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
  return {
    taskQuery,
    legacyQuery,
    useTaskDiscussion: vi.fn(() => taskQuery),
    useAnnotationCommentsInfinite: vi.fn(() => legacyQuery),
    createComment: { mutateAsync: vi.fn(), isPending: false },
    patchComment: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    deleteComment: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    createFeedback: { mutateAsync: vi.fn(), isPending: false },
    patchFeedback: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    deleteFeedback: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    historyQuery: {
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    },
    members: { data: [] },
    store: null,
    snapshot: null,
  };
});

vi.mock("@/hooks/useTaskDiscussion", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useTaskDiscussion")>(
    "@/hooks/useTaskDiscussion",
  );
  return { ...actual, useTaskDiscussion: mocks.useTaskDiscussion };
});
vi.mock("@/hooks/useAnnotationComments", () => ({
  useAnnotationCommentsInfinite: mocks.useAnnotationCommentsInfinite,
  useCreateComment: () => mocks.createComment,
  usePatchComment: () => mocks.patchComment,
  useDeleteComment: () => mocks.deleteComment,
}));
vi.mock("@/hooks/useFeedbacks", () => ({
  useCreateFeedback: () => mocks.createFeedback,
  usePatchFeedback: () => mocks.patchFeedback,
  useDeleteFeedback: () => mocks.deleteFeedback,
}));
vi.mock("@/hooks/useProjects", () => ({ useProjectMembers: () => mocks.members }));
vi.mock("@/hooks/useAnnotationAuditHistory", () => ({
  useAnnotationAuditHistory: () => mocks.historyQuery,
  useTaskAuditHistory: () => mocks.historyQuery,
}));
vi.mock("../state/DiscussionDraftProvider", () => ({
  useDiscussionDraftStore: () => mocks.store,
  useDiscussionDraftSnapshot: () => mocks.snapshot,
}));
vi.mock("../state/useHoveredCommentStore", () => {
  const state = {
    setHover: vi.fn(),
    togglePin: vi.fn(),
    clearPin: vi.fn(),
    pinnedId: null,
    setComposing: vi.fn(),
  };
  return {
    useHoveredCommentStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});
vi.mock("./CommentInput", () => ({
  CommentInput: ({
    target,
    annotationId,
    taskId,
    targetAvailable,
    onReturnToTask,
  }: {
    target?: { kind: string };
    annotationId?: string | null;
    taskId?: string | null;
    targetAvailable?: boolean;
    onReturnToTask?: () => void;
  }) => (
    <div
      data-testid="mock-composer"
      data-target={target?.kind ?? (annotationId ? "annotation" : "none")}
      data-task-id={taskId ?? ""}
      data-target-available={targetAvailable === undefined ? "unknown" : String(targetAvailable)}
      data-has-return={onReturnToTask ? "true" : "false"}
    />
  ),
  renderCommentBody: (body: string) => body,
}));
vi.mock("@/components/CanvasDrawingEditor", () => ({
  CanvasDrawingPreview: () => <div data-testid="drawing-preview" />,
}));
vi.mock("@/components/ui/Icon", () => ({ Icon: () => <span aria-hidden="true" /> }));

import { CommentsPanel } from "./CommentsPanel";

const annotationData = (id: string, annotationId = "annotation-a") => ({
  id,
  annotation_id: annotationId,
  author_id: "user-a",
  author_name: "Nia Okafor",
  body: `annotation ${id}`,
  is_resolved: false,
  is_active: true,
  mentions: [],
  attachments: [],
  canvas_drawing: null,
  anchor: null,
  created_at: "2026-09-11T10:00:00.000Z",
  updated_at: null,
});

const feedbackData = (id: string) => ({
  id,
  kind: "comment" as const,
  anchor_type: "task" as const,
  project_id: "project-a",
  task_id: "task-a",
  annotation_id: null,
  anchor_position: null,
  status: "open" as const,
  severity: null,
  title: null,
  body: `task ${id}`,
  author_id: "user-b",
  author_name: "Priya Mehta",
  attachments: [],
  thread_parent_id: null,
  is_active: true,
  resolved_at: null,
  resolved_by_id: null,
  created_at: "2026-09-11T09:00:00.000Z",
  updated_at: null,
});

function renderPanel(props: Partial<ComponentProps<typeof CommentsPanel>> = {}) {
  return render(
    <MemoryRouter>
      <CommentsPanel
        annotationId={null}
        taskId="task-a"
        projectId="project-a"
        currentUserId="user-a"
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.taskQuery.data = {
    pages: [{ items: [], next_cursor: null, total: 0 }],
    pageParams: [undefined],
  };
  mocks.taskQuery.isPending = false;
  mocks.taskQuery.isError = false;
  mocks.taskQuery.error = null;
  mocks.taskQuery.hasNextPage = false;
  mocks.legacyQuery.data = undefined;
  mocks.store = null;
  mocks.snapshot = null;
  mocks.useTaskDiscussion.mockClear();
  mocks.useAnnotationCommentsInfinite.mockClear();
  mocks.taskQuery.refetch.mockClear();
  mocks.createFeedback.mutateAsync.mockReset();
  mocks.createComment.mutateAsync.mockReset();
  mocks.patchFeedback.mutate.mockReset();
  mocks.patchFeedback.mutateAsync.mockReset();
  mocks.patchComment.mutate.mockReset();
  mocks.patchComment.mutateAsync.mockReset();
  mocks.deleteFeedback.mutate.mockReset();
  mocks.deleteFeedback.mutateAsync.mockReset();
  mocks.deleteComment.mutate.mockReset();
  mocks.deleteComment.mutateAsync.mockReset();
  mocks.patchComment.mutateAsync.mockResolvedValue(undefined);
  mocks.deleteComment.mutateAsync.mockResolvedValue(undefined);
  mocks.patchFeedback.mutateAsync.mockResolvedValue(undefined);
  mocks.deleteFeedback.mutateAsync.mockResolvedValue(undefined);
});

describe("CommentsPanel discussion feed", () => {
  it("无标注时默认读取全部讨论并提供任务纯文本 composer", () => {
    renderPanel();

    expect(screen.getByRole("combobox", { name: "评论阅读范围" })).toHaveValue("all");
    expect(screen.getByRole("option", { name: "本任务全部讨论" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "仅任务留言" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "当前标注" })).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target", "task");
    expect(screen.getByText("暂无讨论")).toBeInTheDocument();
    expect(mocks.useAnnotationCommentsInfinite).toHaveBeenCalledWith(null);
    expect(mocks.useTaskDiscussion).toHaveBeenLastCalledWith(
      "task-a",
      "all",
      null,
      true,
      "project-a",
    );
  });

  it("阅读范围和发送目标彼此独立，选中标注后可显式切换发送目标", () => {
    renderPanel({
      annotationId: "annotation-a",
      annotationClassById: { "annotation-a": "person" },
    });

    fireEvent.change(screen.getByRole("combobox", { name: "评论阅读范围" }), {
      target: { value: "annotation" },
    });
    expect(mocks.useTaskDiscussion).toHaveBeenLastCalledWith(
      "task-a",
      "annotation",
      "annotation-a",
      true,
      "project-a",
    );
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target", "task");

    fireEvent.change(screen.getByRole("combobox", { name: "发送目标" }), {
      target: { value: JSON.stringify(["project-a", "task-a", "annotation", "annotation-a"]) },
    });
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target", "annotation");
  });

  it("保留任务内的旧发送目标，选中 B 后移除 A 仍禁用 A 并保留返回任务入口", () => {
    const store = {
      getSendTarget: vi.fn(() => ({
        projectId: "project-a",
        taskId: "task-a",
        kind: "annotation" as const,
        annotationId: "annotation-a",
      })),
      setSendTarget: vi.fn(),
    };
    (mocks as { store: typeof store | null }).store = store;
    const view = renderPanel({
      annotationId: "annotation-b",
      annotationClassById: { "annotation-a": "person", "annotation-b": "car" },
    });

    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target", "annotation");
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-task-id", "task-a");
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target-available", "true");

    view.rerender(
      <MemoryRouter>
        <CommentsPanel
          annotationId="annotation-b"
          taskId="task-a"
          projectId="project-a"
          currentUserId="user-a"
          annotationClassById={{ "annotation-b": "car" }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target", "annotation");
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-target-available", "false");
    expect(screen.getByTestId("mock-composer")).toHaveAttribute("data-has-return", "true");
  });

  it("候选或多选 ID 不会触发 annotation endpoint，并给出范围回退说明", () => {
    const view = renderPanel({
      annotationId: "annotation-a",
      annotationClassById: { "annotation-a": "person" },
    });
    const scope = screen.getByRole("combobox", { name: "评论阅读范围" });
    fireEvent.change(scope, { target: { value: "annotation" } });

    view.rerender(
      <MemoryRouter>
        <CommentsPanel
          annotationId="prediction-candidate-1"
          taskId="task-a"
          projectId="project-a"
          currentUserId="user-a"
          annotationClassById={{}}
        />
      </MemoryRouter>,
    );

    expect(mocks.useAnnotationCommentsInfinite).toHaveBeenCalledWith(null);
    expect(screen.getByRole("combobox", { name: "评论阅读范围" })).toHaveValue("task");
    expect(screen.getByText("当前没有可用的已保存标注，已切换为仅任务留言。")).toBeInTheDocument();
    expect(
      within(screen.getByRole("combobox", { name: "评论阅读范围" })).queryByRole("option", {
        name: "当前标注",
      }),
    ).not.toBeInTheDocument();
    expect(mocks.useTaskDiscussion).toHaveBeenLastCalledWith(
      "task-a",
      "task",
      null,
      true,
      "project-a",
    );
  });

  it("按 source+id 保留混合来源，即使两个来源 UUID 相同", () => {
    const sameId = "same-id";
    mocks.taskQuery.data = {
      pages: [
        {
          items: [
            {
              source: "annotation_comment",
              data: annotationData(sameId),
              actions: { edit: true, change_status: true, delete: true, reply: false },
            },
            {
              source: "feedback",
              data: feedbackData(sameId),
              actions: { edit: false, change_status: false, delete: false, reply: false },
            },
          ],
          next_cursor: null,
          total: 2,
        },
      ],
      pageParams: [undefined],
    };
    renderPanel({ annotationClassById: { "annotation-a": "person" } });

    expect(screen.getByText("评论 (2)")).toBeInTheDocument();
    expect(screen.getAllByTestId("discussion-comment-row")).toHaveLength(2);
    expect(screen.getAllByTestId("discussion-source-chip").map((node) => node.textContent)).toEqual(
      ["标注评论", "任务留言"],
    );
    expect(screen.getAllByText("same-id", { exact: false })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "删除评论" })).toHaveLength(1);
  });

  it("附件操作使用行数据的 annotation_id，任务 feedback 附件明确不可下载", () => {
    mocks.taskQuery.data = {
      pages: [
        {
          items: [
            {
              source: "annotation_comment",
              data: {
                ...annotationData("comment-a", "annotation-row"),
                attachments: [
                  {
                    storageKey: "comment-attachments/annotation-row/a.txt",
                    fileName: "a.txt",
                    mimeType: "text/plain",
                    size: 4,
                  },
                ],
              },
              actions: { edit: false, change_status: false, delete: false, reply: false },
            },
            {
              source: "feedback",
              data: {
                ...feedbackData("feedback-a"),
                attachments: [{ storage_key: "task-feedback/a.txt", file_name: "a.txt", size: 4 }],
              },
              actions: { edit: false, change_status: false, delete: false, reply: false },
            },
          ],
          next_cursor: null,
          total: 2,
        },
      ],
      pageParams: [undefined],
    };
    renderPanel({ annotationId: "annotation-current" });

    expect(screen.getByRole("link", { name: /a\.txt/ })).toHaveAttribute(
      "href",
      "/api/v1/annotations/annotation-row/comment-attachments/download?key=comment-attachments%2Fannotation-row%2Fa.txt",
    );
    expect(screen.getByText("a.txt（暂不支持下载）")).toBeInTheDocument();
  });

  it("服务端 actions 关闭时不渲染修改操作，并按来源路由状态/删除", async () => {
    mocks.taskQuery.data = {
      pages: [
        {
          items: [
            {
              source: "annotation_comment",
              data: annotationData("comment-a"),
              actions: { edit: false, change_status: true, delete: true, reply: false },
            },
            {
              source: "feedback",
              data: feedbackData("feedback-a"),
              actions: { edit: false, change_status: true, delete: true, reply: false },
            },
          ],
          next_cursor: null,
          total: 2,
        },
      ],
      pageParams: [undefined],
    };
    renderPanel();

    const rows = screen.getAllByTestId("discussion-comment-row");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "标为已解决" }));
    await waitFor(() => expect(mocks.patchComment.mutateAsync).toHaveBeenCalled());
    fireEvent.click(within(rows[0]).getByRole("button", { name: "删除评论" }));
    fireEvent.click(within(rows[1]).getByRole("button", { name: "标为已解决" }));
    await waitFor(() => expect(mocks.patchFeedback.mutateAsync).toHaveBeenCalled());
    fireEvent.click(within(rows[1]).getByRole("button", { name: "删除评论" }));

    expect(mocks.patchComment.mutateAsync).toHaveBeenCalledWith({
      id: "comment-a",
      payload: { is_resolved: true },
      annotationId: "annotation-a",
      taskId: "task-a",
    });
    expect(mocks.deleteComment.mutateAsync).toHaveBeenCalledWith({
      id: "comment-a",
      annotationId: "annotation-a",
      taskId: "task-a",
    });
    expect(mocks.patchFeedback.mutateAsync).toHaveBeenCalledWith({
      id: "feedback-a",
      payload: { status: "resolved" },
    });
    expect(mocks.deleteFeedback.mutateAsync).toHaveBeenCalledWith("feedback-a");
  });

  it("状态操作失败时在对应卡片显示错误，而不是静默消失", async () => {
    mocks.patchFeedback.mutateAsync.mockRejectedValueOnce(new Error("权限不足"));
    mocks.taskQuery.data = {
      pages: [
        {
          items: [
            {
              source: "feedback",
              data: feedbackData("feedback-a"),
              actions: { edit: false, change_status: true, delete: false, reply: false },
            },
          ],
          next_cursor: null,
          total: 1,
        },
      ],
      pageParams: [undefined],
    };
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "标为已解决" }));
    await waitFor(() =>
      expect(screen.getByTestId("discussion-row-error")).toHaveTextContent("权限不足"),
    );
    expect(screen.getByRole("button", { name: "标为已解决" })).toBeEnabled();
  });

  it("错误状态提供重试且不伪装成空结果", () => {
    mocks.taskQuery.isError = true;
    mocks.taskQuery.error = new Error("offline");
    renderPanel();

    expect(screen.getByRole("alert")).toHaveTextContent("无法加载讨论");
    expect(screen.queryByText("暂无讨论")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(mocks.taskQuery.refetch).toHaveBeenCalledTimes(1);
  });
});
