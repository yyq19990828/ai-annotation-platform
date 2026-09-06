// v0.10.18 · WorkbenchLayout focused render tests.
// 验证布局 shell 把七个稳定面板交给工作区,
// 可选模块 (rejectModal / deleteConfirm / guidePanel) 不传时不渲染.

import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef, forwardRef } from "react";
import type { VideoStageControls } from "../stage/videoStageControls";

const workbenchStageHostMock = vi.hoisted(() => vi.fn());

vi.mock("../layout/WorkbenchDockWorkspace", () => ({
  WorkbenchDockWorkspace: ({
    slots,
    renderTopbar,
  }: {
    slots: Record<string, React.ReactNode>;
    renderTopbar: (menu: React.ReactNode, state: object) => React.ReactNode;
  }) => (
    <>
      {renderTopbar(null, {})}
      {Object.entries(slots).map(([id, content]) => (
        <div key={id} data-panel={id}>
          {content}
        </div>
      ))}
    </>
  ),
}));
vi.mock("./TaskQueuePanel", () => ({
  TaskQueuePanel: ({ floatingSection }: { floatingSection?: "queue" | "palette" }) => (
    <div
      data-testid={
        floatingSection === "queue"
          ? "floating-task-queue"
          : floatingSection === "palette"
            ? "floating-class-palette"
            : "task-queue"
      }
    />
  ),
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
  WorkbenchStageHost: forwardRef(function WorkbenchStageHost(props, _ref) {
    workbenchStageHostMock(props);
    return <div data-testid="stage-host" />;
  }),
}));
vi.mock("./StatusBar", () => ({
  StatusBar: () => <div data-testid="status-bar" />,
}));
vi.mock("./AIInspectorPanel", () => ({
  AIInspectorPanel: ({ floating }: { floating?: boolean }) => (
    <div data-testid={floating ? "floating-inspector" : "inspector"} />
  ),
  AIPredictionPopover: () => <div data-testid="ai-popover" />,
}));
vi.mock("../stage/VideoTrackerPropagateDialog", () => ({
  VideoTrackerPropagateDialog: () => <div data-testid="video-tracker" />,
}));
vi.mock("./DiscussionPanel", () => ({
  DiscussionPanel: ({ floating }: { floating?: boolean }) => (
    <div data-testid={floating ? "floating-discussion-panel" : "discussion-panel"} />
  ),
}));
vi.mock("./HotkeyCheatSheet", () => ({
  HotkeyCheatSheet: () => <div data-testid="hotkeys" />,
}));
vi.mock("./OfflineQueueDrawer", () => ({
  OfflineQueueDrawer: () => <div data-testid="offline-queue" />,
}));
vi.mock("./WorkbenchSettingsDialog", () => ({
  WorkbenchSettingsDialog: () => <div data-testid="workbench-settings-dialog" />,
}));
vi.mock("@/components/workbench/ConflictModal", () => ({
  ConflictModal: () => <div data-testid="conflict" />,
}));
vi.mock("@/pages/Review/RejectReasonModal", () => ({
  RejectReasonModal: () => <div data-testid="reject-modal" />,
}));
vi.mock("./DeleteConfirmModal", () => ({
  DeleteConfirmModal: () => <div data-testid="delete-confirm-modal" />,
}));
vi.mock("../sidebar/GuidePanel", () => ({
  GuidePanel: () => <div data-testid="guide-panel" />,
}));

import { WorkbenchLayout } from "./WorkbenchLayout";

const baseInspectorProps = { open: true, width: 280, onResize: vi.fn() };

const baseProps = {
  workspace: { context: "annotate:image" as const, legacy: {} },
  taskQueue: {} as never,
  toolDock: {} as never,
  banners: {} as never,
  topbar: {} as never,
  stageHost: {} as never,
  videoControlsRef: createRef<VideoStageControls>(),
  statusBar: {} as never,
  inspector: baseInspectorProps as never,
  aiPopover: {} as never,
  videoTracker: {} as never,
  hotkeys: {} as never,
  offlineQueue: {} as never,
  workbenchSettings: {} as never,
  conflict: {} as never,
  discussionPanel: {} as never,
};

describe("WorkbenchLayout", () => {
  it("renders all required slots (no optional modals/panels)", () => {
    render(<WorkbenchLayout {...baseProps} />);

    expect(screen.getByTestId("floating-task-queue")).toBeTruthy();
    expect(screen.getByTestId("tool-dock")).toBeTruthy();
    expect(screen.getByTestId("banners")).toBeTruthy();
    expect(screen.getByTestId("topbar")).toBeTruthy();
    expect(screen.getByTestId("stage-host")).toBeTruthy();
    expect(screen.getByTestId("status-bar")).toBeTruthy();
    expect(screen.getByTestId("floating-inspector")).toBeTruthy();
    expect(screen.getByTestId("ai-popover")).toBeTruthy();
    expect(screen.getByTestId("video-tracker")).toBeTruthy();
    expect(screen.getByTestId("hotkeys")).toBeTruthy();
    expect(screen.getByTestId("offline-queue")).toBeTruthy();
    expect(screen.getByTestId("workbench-settings-dialog")).toBeTruthy();
    expect(screen.getByTestId("conflict")).toBeTruthy();

    // 可选项缺省时不渲染
    expect(screen.queryByTestId("reject-modal")).toBeNull();
    expect(screen.queryByTestId("delete-confirm-modal")).toBeNull();
    expect(screen.queryByTestId("guide-panel")).toBeNull();
  });

  it("renders optional modals and guidePanel when provided", () => {
    render(
      <WorkbenchLayout
        {...baseProps}
        rejectModal={{} as never}
        deleteConfirm={{} as never}
        guidePanel={{} as never}
      />,
    );

    expect(screen.getByTestId("reject-modal")).toBeTruthy();
    expect(screen.getByTestId("delete-confirm-modal")).toBeTruthy();
    expect(screen.getByTestId("guide-panel")).toBeTruthy();
  });

  it("在中间画布定位容器内渲染 stage overlay", () => {
    render(<WorkbenchLayout {...baseProps} stageOverlay={<div data-testid="stage-overlay" />} />);

    const stage = screen.getByTestId("stage-host");
    const overlay = screen.getByTestId("stage-overlay");
    expect(overlay.parentElement).toBe(stage.parentElement);
  });

  it("makes the expanded selection card cover the pet upper body in pet mode", () => {
    window.localStorage.setItem("workbench.pet.pos", JSON.stringify({ x: 500, y: 500 }));
    render(
      <WorkbenchLayout
        {...baseProps}
        floatingSelection={{
          title: "car",
          position: { x: 80, y: 90, w: 300, h: 260 },
          onPositionChange: vi.fn(),
          collapsed: false,
          onCollapse: vi.fn(),
          onExpand: vi.fn(),
          children: <div>选中详情</div>,
        }}
        pet={{
          enabled: true,
          context: {
            selection: { count: 1, title: "car", collapsed: false, sourceKind: "manual" },
            ai: { running: false, candidateCount: 0, backendOnline: true },
            workflow: {
              saving: false,
              offline: false,
              offlineQueueCount: 0,
              readOnly: false,
              reviewMode: false,
            },
            quality: { warningCount: 0, primaryWarning: null },
            counts: { annotationCount: 0 },
          },
          onExpand: vi.fn(),
        }}
      />,
    );

    const panel = screen.getByText("car").closest("[data-floating-panel]") as HTMLElement;
    expect(panel.style.getPropertyValue("--floating-panel-x")).toBe("378px");
    expect(panel.style.getPropertyValue("--floating-panel-y")).toBe("268px");
    expect(panel.className).toContain("z-overlay-high");
    expect(screen.getByLabelText("工作台桌宠(可拖动)")).toBeTruthy();
  });

  it("shares the draggable pet anchor with the active stage", () => {
    window.localStorage.setItem("workbench.pet.pos", JSON.stringify({ x: 500, y: 500 }));
    render(
      <WorkbenchLayout
        {...baseProps}
        pet={{
          enabled: true,
          context: {
            selection: { count: 0, title: null, collapsed: false, sourceKind: "unknown" },
            ai: { running: false, candidateCount: 0, backendOnline: true },
            workflow: {
              saving: false,
              offline: false,
              offlineQueueCount: 0,
              readOnly: false,
              reviewMode: false,
            },
            quality: { warningCount: 0, primaryWarning: null },
            counts: { annotationCount: 0 },
          },
          onExpand: vi.fn(),
        }}
      />,
    );

    const stageProps = workbenchStageHostMock.mock.lastCall?.[0] as {
      petDock?: {
        enabled: boolean;
        position: { x: number; y: number };
        onPositionChange: (position: { x: number; y: number }) => void;
      };
    };
    expect(stageProps.petDock).toEqual(
      expect.objectContaining({ enabled: true, position: { x: 500, y: 500 } }),
    );

    act(() => stageProps.petDock?.onPositionChange({ x: 420, y: 360 }));
    expect(window.localStorage.getItem("workbench.pet.pos")).toBe('{"x":420,"y":360}');
  });

  it("falls back to the text capsule when pet mode is disabled", () => {
    render(
      <WorkbenchLayout
        {...baseProps}
        floatingSelection={{
          title: "car",
          position: { x: 80, y: 90, w: 300, h: 260 },
          onPositionChange: vi.fn(),
          collapsed: true,
          onCollapse: vi.fn(),
          onExpand: vi.fn(),
          children: <div>选中详情</div>,
        }}
        pet={{
          enabled: false,
          context: {
            selection: { count: 1, title: "car", collapsed: true, sourceKind: "manual" },
            ai: { running: false, candidateCount: 0, backendOnline: true },
            workflow: {
              saving: false,
              offline: false,
              offlineQueueCount: 0,
              readOnly: false,
              reviewMode: false,
            },
            quality: { warningCount: 0, primaryWarning: null },
            counts: { annotationCount: 0 },
          },
          onExpand: vi.fn(),
        }}
      />,
    );

    expect(screen.getByLabelText("展开选中信息卡(可拖动)")).toBeTruthy();
    expect(screen.queryByLabelText("工作台桌宠(可拖动)")).toBeNull();
  });
});
