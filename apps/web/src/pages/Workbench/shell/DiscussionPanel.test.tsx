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
  it("把 Mask 质检与人工 Issue 作为独立页签", () => {
    render(<DiscussionPanel {...baseProps} maskQc={{} as never} />);

    fireEvent.click(screen.getByRole("tab", { name: "Mask 质检" }));
    expect(screen.getByTestId("mask-qc-panel")).toBeTruthy();
    expect(screen.queryByTestId("human-issues")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Issue" }));
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
});
