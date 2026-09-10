import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockUseWorkbenchShellModel = vi.fn();

vi.mock("@/components/ui/Button", () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock("../state/useWorkbenchShellModel", () => ({
  useWorkbenchShellModel: (...args: unknown[]) => mockUseWorkbenchShellModel(...args),
}));
vi.mock("./WorkbenchLayout", () => ({
  WorkbenchLayout: ({
    stageOverlay,
    videoTracker,
  }: {
    stageOverlay?: React.ReactNode;
    videoTracker?: unknown;
  }) => (
    <div data-testid="layout">
      {Boolean(videoTracker) && <div data-testid="propagate-dialog" />}
      {stageOverlay}
    </div>
  ),
}));
vi.mock("./WorkbenchSkeleton", () => ({
  WorkbenchSkeleton: () => <div data-testid="skeleton" />,
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
        createModal: {} as never,
      },
    });

    render(<WorkbenchShell />);

    expect(screen.getByTestId("layout")).toBeTruthy();
    expect(screen.getByTestId("propagate-dialog")).toBeTruthy();
    expect(screen.getByTestId("issue-create-modal")).toBeTruthy();

    fireEvent.click(screen.getByTestId("issue-fab"));
    fireEvent.click(screen.getByTestId("issue-pin-fab"));

    expect(onOpenList).toHaveBeenCalledOnce();
    expect(onToggleIssuePinDrop).toHaveBeenCalledOnce();
  });
  it.each(["preparing", "ready", "cancelled", "timeout", "unavailable"] as const)(
    "video issues expose %s without claiming failed navigation is ready",
    (status) => {
      const onRetryIssueNavigation = vi.fn(async () => {});
      const onToggleIssuePinDrop = vi.fn();
      mockUseWorkbenchShellModel.mockReturnValue({
        kind: "ready",
        layout: {},
        issueSection: {
          openIssueCount: 0,
          stageKind: "video",
          issuePinDropArmed: false,
          onOpenList: vi.fn(),
          onToggleIssuePinDrop,
          issueNavigation: { status, frameIndex: 0 },
          onRetryIssueNavigation,
          createModal: {},
        },
      });
      render(<WorkbenchShell />);
      fireEvent.click(screen.getByTestId("issue-pin-fab"));
      expect(onToggleIssuePinDrop).toHaveBeenCalledOnce();
      const progress = screen.getByTestId("issue-frame-navigation");
      expect(screen.getByTestId("layout")).toContainElement(progress);
      expect(progress).toHaveAttribute("data-status", status);
      expect(progress).toHaveAttribute("data-frame-index", "0");
      expect(progress.textContent?.includes("已定位")).toBe(status === "ready");
      const retry = screen.queryByRole("button", { name: "重试" });
      if (status === "preparing" || status === "ready") expect(retry).toBeNull();
      else {
        expect(retry).not.toBeNull();
        fireEvent.click(retry!);
        expect(onRetryIssueNavigation).toHaveBeenCalledOnce();
      }
    },
  );
});
