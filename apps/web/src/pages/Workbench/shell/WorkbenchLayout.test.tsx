// v0.10.18 · WorkbenchLayout focused render tests.
// 验证布局 shell 把 12 个子组件按预期插槽渲染, gridTemplateColumns 写入 CSS 变量,
// 可选模块 (rejectModal / deleteConfirm / guidePanel) 不传时不渲染.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef, forwardRef } from "react";
import type { VideoStageControls } from "../stage/videoStageControls";

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
  WorkbenchStageHost: forwardRef(function WorkbenchStageHost() {
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
  gridTemplateColumns: "200px 1fr 320px",
  taskQueue: {} as never,
  toolDock: {} as never,
  banners: {} as never,
  topbar: {} as never,
  stageHost: {} as never,
  videoControlsRef: createRef<VideoStageControls>(),
  statusBar: {} as never,
  inspector: baseInspectorProps as never,
  aiPopover: {} as never,
  hotkeys: {} as never,
  offlineQueue: {} as never,
  workbenchSettings: {} as never,
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

  it("writes gridTemplateColumns to --workbench-grid-template CSS var", () => {
    const { container } = render(
      <WorkbenchLayout {...baseProps} gridTemplateColumns="100px 1fr 200px" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--workbench-grid-template")).toBe("100px 1fr 200px");
  });

  it("在中间画布定位容器内渲染 stage overlay", () => {
    render(<WorkbenchLayout {...baseProps} stageOverlay={<div data-testid="stage-overlay" />} />);

    const stage = screen.getByTestId("stage-host");
    const overlay = screen.getByTestId("stage-overlay");
    expect(overlay.parentElement).toBe(stage.parentElement);
  });

  it("renders detached inspector in a floating shell while keeping discussion embedded", () => {
    const onMergeBack = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkbenchLayout
        {...baseProps}
        floatingInspector={{
          detached: true,
          position: { x: 120, y: 80, w: 360, h: 500 },
          onPositionChange: vi.fn(),
          onMergeBack,
          onClose,
        }}
      />,
    );

    expect(screen.getByTestId("floating-inspector")).toBeTruthy();
    expect(screen.queryByTestId("inspector")).toBeNull();
    expect(screen.getByTestId("discussion-panel")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("合并回侧栏"));
    fireEvent.click(screen.getByLabelText("关闭浮窗"));
    expect(onMergeBack).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the right split when inspector and discussion are both detached", () => {
    render(
      <WorkbenchLayout
        {...baseProps}
        floatingInspector={{
          detached: true,
          position: { x: 120, y: 80, w: 360, h: 500 },
          onPositionChange: vi.fn(),
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
        floatingDiscussion={{
          detached: true,
          position: { x: 540, y: 120, w: 420, h: 520 },
          onPositionChange: vi.fn(),
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByTestId("inspector")).toBeNull();
    expect(screen.queryByTestId("discussion-panel")).toBeNull();
    expect(screen.getByTestId("floating-inspector")).toBeTruthy();
    expect(screen.getByTestId("floating-discussion-panel")).toBeTruthy();
    expect(screen.getAllByLabelText("合并回侧栏")).toHaveLength(2);
  });

  it("renders detached left sidebar sections as independent floating shells", () => {
    render(
      <WorkbenchLayout
        {...baseProps}
        floatingTaskQueue={{
          detached: true,
          position: { x: 24, y: 72, w: 320, h: 600 },
          onPositionChange: vi.fn(),
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
        floatingClassPalette={{
          detached: true,
          position: { x: 24, y: 420, w: 300, h: 360 },
          onPositionChange: vi.fn(),
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
      />,
    );

    expect(screen.getByTestId("task-queue")).toBeTruthy();
    expect(screen.getByTestId("floating-task-queue")).toBeTruthy();
    expect(screen.getByTestId("floating-class-palette")).toBeTruthy();
  });

  it("does not mount embedded right panels while the right sidebar is closed", () => {
    render(
      <WorkbenchLayout
        {...baseProps}
        inspector={{ ...baseInspectorProps, open: false } as never}
      />,
    );

    expect(screen.queryByTestId("inspector")).toBeNull();
    expect(screen.queryByTestId("discussion-panel")).toBeNull();
  });

  it("clamps all detached side panels to the same minimum size", async () => {
    const onTaskQueuePositionChange = vi.fn();
    const onClassPalettePositionChange = vi.fn();
    const onInspectorPositionChange = vi.fn();
    const onDiscussionPositionChange = vi.fn();
    render(
      <WorkbenchLayout
        {...baseProps}
        floatingTaskQueue={{
          detached: true,
          position: { x: 80, y: 80, w: 100, h: 100 },
          onPositionChange: onTaskQueuePositionChange,
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
        floatingClassPalette={{
          detached: true,
          position: { x: 120, y: 120, w: 100, h: 100 },
          onPositionChange: onClassPalettePositionChange,
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
        floatingInspector={{
          detached: true,
          position: { x: 160, y: 160, w: 100, h: 100 },
          onPositionChange: onInspectorPositionChange,
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
        floatingDiscussion={{
          detached: true,
          position: { x: 200, y: 200, w: 100, h: 100 },
          onPositionChange: onDiscussionPositionChange,
          onMergeBack: vi.fn(),
          onClose: vi.fn(),
        }}
      />,
    );

    await waitFor(() => {
      expect(onTaskQueuePositionChange).toHaveBeenCalledWith({ w: 320, h: 320 });
      expect(onClassPalettePositionChange).toHaveBeenCalledWith({ w: 320, h: 320 });
      expect(onInspectorPositionChange).toHaveBeenCalledWith({ w: 320, h: 320 });
      expect(onDiscussionPositionChange).toHaveBeenCalledWith({ w: 320, h: 320 });
    });
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
