import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUseWorkbenchShellModel = vi.fn();

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));
vi.mock("@/components/ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock("../state/useWorkbenchShellModel", () => ({
  useWorkbenchShellModel: (...args: unknown[]) => mockUseWorkbenchShellModel(...args),
}));
vi.mock("./WorkbenchLayout", () => ({
  WorkbenchLayout: () => <div data-testid="layout" />,
}));
vi.mock("./WorkbenchSkeleton", () => ({
  WorkbenchSkeleton: () => <div data-testid="skeleton" />,
}));
vi.mock("../stage/VideoTrackerPropagateDialog", () => ({
  VideoTrackerPropagateDialog: () => <div data-testid="propagate-dialog" />,
}));
vi.mock("./IssueListPanel", () => ({
  IssueListPanel: () => <div data-testid="issue-list-panel" />,
}));
vi.mock("./IssueCreateModal", () => ({
  IssueCreateModal: () => <div data-testid="issue-create-modal" />,
}));

import { WorkbenchShell } from "./WorkbenchShell";

describe("WorkbenchShell", () => {
  it("renders WorkbenchSkeleton while model is loading", () => {
    mockUseWorkbenchShellModel.mockReturnValue({ kind: "loading" });

    render(<WorkbenchShell />);

    expect(screen.getByTestId("skeleton")).toBeTruthy();
    expect(screen.queryByTestId("layout")).toBeNull();
  });

  it("renders empty state and delegates back action", () => {
    const onBack = vi.fn();
    mockUseWorkbenchShellModel.mockReturnValue({
      kind: "empty",
      emptyState: {
        icon: "warning",
        message: "项目不存在或无访问权限",
        onBack,
      },
    });

    render(<WorkbenchShell />);

    expect(screen.getByText("项目不存在或无访问权限")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("renders layout, propagate dialog, and issue controls when ready", () => {
    const onOpenList = vi.fn();
    const onToggleIssuePinDrop = vi.fn();
    mockUseWorkbenchShellModel.mockReturnValue({
      kind: "ready",
      layout: {} as never,
      propagateDialog: {} as never,
      issueSection: {
        openIssueCount: 2,
        stageKind: "image",
        issuePinDropArmed: true,
        onOpenList,
        onToggleIssuePinDrop,
        listPanel: {} as never,
        createModal: {} as never,
      },
    });

    render(<WorkbenchShell />);

    expect(screen.getByTestId("layout")).toBeTruthy();
    expect(screen.getByTestId("propagate-dialog")).toBeTruthy();
    expect(screen.getByTestId("issue-list-panel")).toBeTruthy();
    expect(screen.getByTestId("issue-create-modal")).toBeTruthy();

    fireEvent.click(screen.getByTestId("issue-fab"));
    fireEvent.click(screen.getByTestId("issue-pin-fab"));

    expect(onOpenList).toHaveBeenCalledOnce();
    expect(onToggleIssuePinDrop).toHaveBeenCalledOnce();
  });
});
