// v0.10.18 · WorkbenchLayout focused render tests.
// 验证布局 shell 把 12 个子组件按预期插槽渲染, gridTemplateColumns 写入 CSS 变量,
// 可选模块 (rejectModal / guidePanel) 不传时不渲染.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef, forwardRef } from "react";
import type { VideoStageControls } from "../stage/VideoStage";

vi.mock("./TaskQueuePanel", () => ({
  TaskQueuePanel: () => <div data-testid="task-queue" />,
}));
vi.mock("./ToolDock", () => ({
  ToolDock: () => <div data-testid="tool-dock" />,
}));
vi.mock("./WorkbenchBanners", () => ({
  WorkbenchBanners: () => <div data-testid="banners" />,
}));
vi.mock("./Topbar", () => ({
  Topbar: () => <div data-testid="topbar" />,
}));
vi.mock("./WorkbenchStageHost", () => ({
  WorkbenchStageHost: forwardRef(function WorkbenchStageHost() {
    return <div data-testid="stage-host" />;
  }),
}));
vi.mock("./StatusBar", () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));
vi.mock("./AIInspectorPanel", () => ({
  AIInspectorPanel: () => <div data-testid="inspector" />,
  AIPredictionPopover: () => <div data-testid="ai-popover" />,
}));
vi.mock("./DiscussionPanel", () => ({
  DiscussionPanel: () => <div data-testid="discussion-panel" />,
}));
vi.mock("./HotkeyCheatSheet", () => ({
  HotkeyCheatSheet: () => <div data-testid="hotkeys" />,
}));
vi.mock("./OfflineQueueDrawer", () => ({
  OfflineQueueDrawer: () => <div data-testid="offline-queue" />,
}));
vi.mock("@/components/workbench/ConflictModal", () => ({
  ConflictModal: () => <div data-testid="conflict" />,
}));
vi.mock("@/pages/Review/RejectReasonModal", () => ({
  RejectReasonModal: () => <div data-testid="reject-modal" />,
}));
vi.mock("../sidebar/GuidePanel", () => ({
  GuidePanel: () => <div data-testid="guide-panel" />,
}));

import { WorkbenchLayout } from "./WorkbenchLayout";

const baseProps = {
  gridTemplateColumns: "200px 1fr 320px",
  taskQueue: {} as never,
  toolDock: {} as never,
  banners: {} as never,
  topbar: {} as never,
  stageHost: {} as never,
  videoControlsRef: createRef<VideoStageControls>(),
  statusBar: {} as never,
  inspector: {} as never,
  aiPopover: {} as never,
  hotkeys: {} as never,
  offlineQueue: {} as never,
  conflict: {} as never,
  discussionPanel: {} as never,
};

describe("WorkbenchLayout", () => {
  it("renders all required slots (no optional modals/panels)", () => {
    render(<WorkbenchLayout {...baseProps} />);

    expect(screen.getByTestId("task-queue")).toBeTruthy();
    expect(screen.getByTestId("tool-dock")).toBeTruthy();
    expect(screen.getByTestId("banners")).toBeTruthy();
    expect(screen.getByTestId("topbar")).toBeTruthy();
    expect(screen.getByTestId("stage-host")).toBeTruthy();
    expect(screen.getByTestId("status-bar")).toBeTruthy();
    expect(screen.getByTestId("inspector")).toBeTruthy();
    expect(screen.getByTestId("ai-popover")).toBeTruthy();
    expect(screen.getByTestId("hotkeys")).toBeTruthy();
    expect(screen.getByTestId("offline-queue")).toBeTruthy();
    expect(screen.getByTestId("conflict")).toBeTruthy();

    // 可选项缺省时不渲染
    expect(screen.queryByTestId("reject-modal")).toBeNull();
    expect(screen.queryByTestId("guide-panel")).toBeNull();
  });

  it("renders optional rejectModal and guidePanel when provided", () => {
    render(
      <WorkbenchLayout
        {...baseProps}
        rejectModal={{} as never}
        guidePanel={{} as never}
      />,
    );

    expect(screen.getByTestId("reject-modal")).toBeTruthy();
    expect(screen.getByTestId("guide-panel")).toBeTruthy();
  });

  it("writes gridTemplateColumns to --workbench-grid-template CSS var", () => {
    const { container } = render(
      <WorkbenchLayout {...baseProps} gridTemplateColumns="100px 1fr 200px" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--workbench-grid-template")).toBe(
      "100px 1fr 200px",
    );
  });
});
