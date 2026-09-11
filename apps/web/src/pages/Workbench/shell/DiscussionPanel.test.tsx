import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./CommentsPanel", () => ({
  CommentsPanel: ({ forceTab }: { forceTab: string }) => (
    <div data-testid={`comments-${forceTab}`} />
  ),
}));
vi.mock("./DiscussionIssuesTab", () => ({
  DiscussionIssuesTab: () => <div data-testid="human-issues" />,
}));
vi.mock("./MaskQcPanel", () => ({
  MaskQcPanel: () => <div data-testid="mask-qc-panel" />,
}));

import { DiscussionPanel } from "./DiscussionPanel";

const baseProps = {
  annotationId: null,
  taskId: "task-1",
  projectId: "project-1",
  currentUserId: "user-1",
};

describe("DiscussionPanel Mask 质检", () => {
  it("distinguishes an exact zero from pending and failed Issue counts", () => {
    const view = render(<DiscussionPanel {...baseProps} openIssueCount={0} />);
    expect(screen.getByRole("tab", { name: "问题 0 个未解决" })).toBeInTheDocument();
    view.rerender(<DiscussionPanel {...baseProps} openIssueCount={null} openIssueCountLoading />);
    expect(screen.getByRole("tab", { name: "问题 正在加载未解决数量" })).toHaveTextContent("…");
    view.rerender(<DiscussionPanel {...baseProps} openIssueCount={null} openIssueCountError />);
    expect(screen.getByRole("tab", { name: "问题 未解决数量暂不可用" })).toHaveTextContent("?");
  });

  it("把 Mask 质检与人工 Issue 作为独立页签", () => {
    render(<DiscussionPanel {...baseProps} maskQc={{} as never} />);

    fireEvent.click(screen.getByRole("tab", { name: "Mask 质检" }));
    expect(screen.getByTestId("mask-qc-panel")).toBeTruthy();
    expect(screen.queryByTestId("human-issues")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "问题" }));
    expect(screen.getByTestId("human-issues")).toBeTruthy();
    expect(screen.queryByTestId("mask-qc-panel")).toBeNull();
  });

  it("非审核上下文不暴露 Mask 质检页签", () => {
    render(<DiscussionPanel {...baseProps} />);
    expect(screen.queryByRole("tab", { name: "Mask 质检" })).toBeNull();
  });

  it("审核上下文消失时退回评论页签", () => {
    const view = render(<DiscussionPanel {...baseProps} maskQc={{} as never} />);
    fireEvent.click(screen.getByRole("tab", { name: "Mask 质检" }));
    view.rerender(<DiscussionPanel {...baseProps} />);
    expect(screen.getByTestId("comments-comments")).toBeTruthy();
  });

  it("跨任务重挂载时根据活动质检问题恢复页签", () => {
    render(<DiscussionPanel {...baseProps} maskQc={{ activeIssue: { id: "issue-1" } } as never} />);
    expect(screen.getByRole("tab", { name: "Mask 质检" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("mask-qc-panel")).toBeTruthy();
  });

  it("关联页签和面板，并支持方向键与 Home/End 导航", () => {
    render(<DiscussionPanel {...baseProps} />);
    expect(screen.getAllByRole("tab").map((element) => element.textContent)).toEqual([
      "评论",
      "问题",
      "历史",
    ]);
    const comments = screen.getByRole("tab", { name: "评论" });
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", comments.id);
    expect(comments).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
    comments.focus();
    fireEvent.keyDown(comments, { key: "ArrowRight" });
    const issues = screen.getByRole("tab", { name: "问题" });
    expect(issues).toHaveFocus();
    expect(issues).toHaveAttribute("aria-selected", "true");
    expect(comments).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(issues, { key: "End" });
    const history = screen.getByRole("tab", { name: "历史" });
    expect(history).toHaveFocus();
    fireEvent.keyDown(history, { key: "Home" });
    expect(comments).toHaveFocus();
  });

  it("将收起按钮放在页签列表外，并可通过键盘切换展开", () => {
    render(<DiscussionPanel {...baseProps} />);
    const collapse = screen.getByTestId("discussion-toggle-collapsed");
    expect(collapse.closest('[role="tablist"]')).toBeNull();
    fireEvent.click(collapse);
    expect(screen.queryByRole("tabpanel")).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "评论" }), { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel")).toBeTruthy();
    expect(screen.getByTestId("human-issues")).toBeTruthy();
  });
});
