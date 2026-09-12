import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useInfiniteFeedbacks: vi.fn(),
  patchFeedback: vi.fn(),
  deleteFeedback: vi.fn(),
  focusIssue: vi.fn(),
}));

vi.mock("@/hooks/useFeedbacks", () => ({
  useInfiniteFeedbacks: (...args: unknown[]) => mocks.useInfiniteFeedbacks(...args),
  usePatchFeedback: (...args: unknown[]) => {
    mocks.patchFeedback(...args);
    return { mutate: vi.fn(), isPending: false };
  },
  useDeleteFeedback: (...args: unknown[]) => {
    mocks.deleteFeedback(...args);
    return { mutate: vi.fn(), isPending: false };
  },
}));

vi.mock("../state/useActiveIssueStore", () => ({
  useActiveIssueStore: (selector: (state: unknown) => unknown) =>
    selector({ highlightId: null, focusIssue: mocks.focusIssue }),
}));

vi.mock("../state/videoIssueContext", () => ({
  readVideoIssueContext: () => null,
}));

import { DiscussionIssuesTab } from "./DiscussionIssuesTab";

function page() {
  return {
    data: {
      pages: [
        {
          items: [
            {
              id: "issue-1",
              kind: "issue",
              anchor_type: "task",
              project_id: "project-1",
              task_id: "task-1",
              annotation_id: null,
              anchor_position: null,
              status: "open",
              severity: "warn",
              title: "需要复核",
              body: "请检查",
              author_id: "user-1",
              author_name: "审核员",
              attachments: [],
              thread_parent_id: null,
              is_active: true,
              resolved_at: null,
              resolved_by_id: null,
              created_at: "2026-09-12T00:00:00Z",
              updated_at: null,
            },
            {
              id: "issue-2",
              kind: "issue",
              anchor_type: "task",
              project_id: "project-1",
              task_id: "task-1",
              annotation_id: null,
              anchor_position: null,
              status: "resolved",
              severity: "info",
              title: "已处理",
              body: "完成",
              author_id: "user-2",
              author_name: "审核员",
              attachments: [],
              thread_parent_id: null,
              is_active: true,
              resolved_at: "2026-09-12T00:00:00Z",
              resolved_by_id: "user-2",
              created_at: "2026-09-12T00:00:00Z",
              updated_at: null,
            },
          ],
          next_cursor: null,
        },
      ],
    },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
}

describe("DiscussionIssuesTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useInfiniteFeedbacks.mockReturnValue(page());
  });

  it("sends status to the server before cursor pagination", () => {
    render(<DiscussionIssuesTab projectId="project-1" taskId="task-1" allowProjectScope />);
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ task_id: "task-1", status: undefined }),
    );

    fireEvent.click(screen.getByRole("button", { name: "未解决" }));
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ task_id: "task-1", status: "open" }),
    );
    expect(screen.getByLabelText("当前任务已加载问题数量")).toHaveTextContent("已加载 1");
  });

  it("labels project issue counts as loaded rows and keeps the project scope in the request", () => {
    render(<DiscussionIssuesTab projectId="project-1" taskId="task-1" allowProjectScope />);
    fireEvent.change(screen.getByRole("combobox", { name: "问题列表范围" }), {
      target: { value: "project" },
    });
    expect(mocks.useInfiniteFeedbacks).toHaveBeenLastCalledWith(
      expect.objectContaining({ task_id: undefined, status: undefined }),
    );
    expect(screen.getByLabelText("整个项目已加载问题数量")).toHaveTextContent("已加载 2");
  });
});
