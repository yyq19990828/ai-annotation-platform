import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DockviewApi } from "dockview-react";
import { createWorkspacePreset } from "./workbenchLayoutPresets";
import type { WorkbenchWorkspaceCommands, WorkbenchWorkspaceState } from "./workbenchPanelRegistry";
import { SelectedAnnotationCard } from "../shell/SelectedAnnotationCard";
import { resolveVideoSelectionCardCollapsed } from "../state/useWorkbenchShellModel.helpers";
import type { WorkspaceContext } from "./workbenchLayoutSnapshot";

const state = vi.hoisted(() => ({
  compact: false,
  owner: {} as Record<string, unknown>,
  api: null as DockviewApi | null,
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => state.compact }));
vi.mock("../state/useWorkbenchWorkspaceLayout", () => ({
  useWorkbenchWorkspaceLayout: () => ({ ...state.owner }),
}));
vi.mock("dockview-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("dockview-react")>();
  return {
    ...actual,
    DockviewReact: (props: React.ComponentProps<typeof actual.DockviewReact>) => (
      <actual.DockviewReact
        {...props}
        disableAutoResizing
        onReady={(event) => {
          state.api = event.api;
          event.api.layout(1600, 900);
          props.onReady?.(event);
        }}
      />
    ),
  };
});
import { WorkbenchDockWorkspace } from "./WorkbenchDockWorkspace";

const bounds = { width: 1600, height: 900 };
let mounts = 0;
function Canvas() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return (
    <div data-testid="canvas-marker">
      <canvas />
    </div>
  );
}
function Draft() {
  const [value, setValue] = useState("");
  return (
    <input aria-label="讨论草稿" value={value} onChange={(event) => setValue(event.target.value)} />
  );
}
function fixture(
  context: WorkspaceContext = "annotate:image",
  commands = createRef<WorkbenchWorkspaceCommands>(),
  canvas = <Canvas />,
  onStateChange?: (workspace: WorkbenchWorkspaceState) => void,
) {
  return (
    <WorkbenchDockWorkspace
      context={context}
      legacy={{}}
      commandsRef={commands}
      onStateChange={onStateChange}
      slots={{
        canvas,
        "task-queue": <p>任务</p>,
        "class-palette": <p>类别</p>,
        inspector: <p>详情</p>,
        discussion: <Draft />,
        "ai-task": <input aria-label="AI 草稿" defaultValue="保留" />,
        "video-tracker": <input aria-label="追踪草稿" defaultValue="保留" />,
        "tri-view": null,
        "camera-view": null,
      }}
      renderTopbar={(menu, _state, settings) => (
        <header>
          {menu}
          {settings}
        </header>
      )}
    />
  );
}
function VideoSelectionWorkspace() {
  const [commands] = useState(() => createRef<WorkbenchWorkspaceCommands>());
  const [workspace, setWorkspace] = useState<WorkbenchWorkspaceState | null>(null);
  const [preferredCollapsed, setPreferredCollapsed] = useState(true);
  return (
    <>
      {fixture("annotate:video", commands, undefined, setWorkspace)}
      <output data-testid="tracker-docked">{String(workspace?.videoTrackerVisible)}</output>
      <output data-testid="tracker-content-visible">
        {String(workspace?.videoTrackerContentVisible)}
      </output>
      <output data-testid="selection-collapse-preference">{String(preferredCollapsed)}</output>
      <SelectedAnnotationCard
        title="truck"
        position={{ x: 100, y: 80, w: 340, h: 440 }}
        onPositionChange={() => {}}
        collapsed={resolveVideoSelectionCardCollapsed(
          preferredCollapsed,
          true,
          workspace?.videoTrackerContentVisible ?? false,
        )}
        onCollapse={() => setPreferredCollapsed(true)}
        onExpand={() => setPreferredCollapsed(false)}
      >
        <button type="button">编辑当前帧 Mask</button>
      </SelectedAnnotationCard>
    </>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mounts = 0;
  state.compact = false;
  state.owner = {
    snapshot: createWorkspacePreset("standard", bounds),
    initialized: true,
    readOnly: false,
    readOnlyReason: null,
    restoreRevision: 0,
    save: vi.fn(() => true),
    reset: vi.fn(() => true),
    failRestore: vi.fn(),
  };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1600);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (
      this.classList.contains("dv-resize-container") ||
      this.classList.contains("dv-floating-overlay-host")
    )
      return new DOMRect(
        parseFloat(this.style.left || this.style.inset.split(/\s+/)[3]) || 0,
        parseFloat(this.style.top || this.style.inset.split(/\s+/)[0]) || 0,
        parseFloat(this.style.width) || 0,
        parseFloat(this.style.height) || 0,
      );
    if (
      this.classList.contains("dv-dockview") ||
      this.firstElementChild?.classList.contains("dv-dockview") ||
      this.firstElementChild?.classList.contains("dv-shell") ||
      this.classList.contains("dv-shell")
    )
      return new DOMRect(0, 0, 1600, 900);
    return new DOMRect();
  });
});
afterEach(async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("stable Dockview React workspace", () => {
  it.each(["left", "right"] as const)(
    "previews a new %s column at its docked width",
    async (side) => {
      vi.stubGlobal("PointerEvent", class extends MouseEvent {});
      vi.stubGlobal("DragEvent", MouseEvent);
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1600);
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(900);
      const { container } = render(fixture());
      await waitFor(() => expect(state.api?.getPanel("class-palette")).toBeDefined());
      const source = container.querySelector('[data-tab-panel-id="class-palette"]')!;
      const target = container.querySelector(".dv-dockview")!;
      const dataTransfer = {
        setData: vi.fn(),
        setDragImage: vi.fn(),
        types: [],
        items: [],
        effectAllowed: "move",
      };
      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(target, {
        dataTransfer,
        clientX: side === "left" ? 1 : 1599,
        clientY: 450,
      });
      const preview = container.querySelector<HTMLElement>(`.dv-drop-target-${side}`)!;
      expect(preview).not.toBeNull();
      expect(preview.style.width).toBe("15%");
      fireEvent.dragEnd(source, { dataTransfer });
    },
  );

  it("tool-menu portal keys do not save the workspace layout", async () => {
    render(
      fixture(
        "annotate:image",
        createRef(),
        <>
          <Canvas />
          {createPortal(
            <div role="menu" data-workbench-tool-menu tabIndex={-1}>
              工具
            </div>,
            document.body,
          )}
        </>,
      ),
    );
    await screen.findByTestId("canvas-marker");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(state.owner.save).not.toHaveBeenCalled();
    expect(state.owner.failRestore).not.toHaveBeenCalled();
  });

  it("allows selection-card editing when the retained tracking panel is a background docked tab", async () => {
    state.owner.snapshot = createWorkspacePreset("video-tracking", bounds, "annotate:video");
    render(<VideoSelectionWorkspace />);
    await screen.findByTestId("canvas-marker");
    const tracker = state.api!.getPanel("video-tracker")!;
    const inspector = state.api!.getPanel("inspector")!;
    expect(tracker.group).toBe(inspector.group);
    await waitFor(() =>
      expect(screen.getByTestId("tracker-content-visible")).toHaveTextContent("true"),
    );
    const draft = screen.getByLabelText("追踪草稿");
    fireEvent.change(draft, { target: { value: "保留追踪配置" } });

    act(() => inspector.api.setActive());
    await waitFor(() =>
      expect(draft.closest("[data-workbench-panel]")).toHaveAttribute("aria-hidden", "true"),
    );
    expect(screen.getByTestId("tracker-docked")).toHaveTextContent("true");
    fireEvent.click(screen.getByLabelText("展开选中信息卡(可拖动)"));
    expect(screen.getByTestId("selection-collapse-preference")).toHaveTextContent("false");
    await waitFor(
      () => expect(screen.getByTestId("tracker-content-visible")).toHaveTextContent("false"),
      { timeout: 800 },
    );
    await screen.findByRole("button", { name: "编辑当前帧 Mask" });

    // Activating the canvas must not hide a tracking panel displayed in its own group.
    act(() => tracker.api.setActive());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "编辑当前帧 Mask" })).toBeNull(),
    );
    act(() => state.api!.getPanel("canvas")!.api.setActive());
    expect(screen.getByTestId("tracker-content-visible")).toHaveTextContent("true");
    expect(screen.getByTestId("selection-collapse-preference")).toHaveTextContent("false");
    expect(screen.getByLabelText("追踪草稿")).toBe(draft);
    expect(draft).toHaveValue("保留追踪配置");

    act(() => inspector.api.setActive());
    await screen.findByRole("button", { name: "编辑当前帧 Mask" });
    fireEvent.click(screen.getByLabelText("收起浮窗"));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "编辑当前帧 Mask" })).toBeNull(),
    );
    expect(screen.getByTestId("selection-collapse-preference")).toHaveTextContent("true");
    act(() => tracker.api.setActive());
    await waitFor(() =>
      expect(screen.getByTestId("tracker-content-visible")).toHaveTextContent("true"),
    );
    act(() => inspector.api.setActive());
    await waitFor(() =>
      expect(screen.getByTestId("tracker-content-visible")).toHaveTextContent("false"),
    );
    expect(screen.queryByRole("button", { name: "编辑当前帧 Mask" })).toBeNull();
    expect(screen.getByTestId("selection-collapse-preference")).toHaveTextContent("true");
    expect(mounts).toBe(1);
  });

  it("tab X hides its own inactive panel and restores its draft without remounting canvas", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    render(fixture("annotate:image", commands));
    const draft = await screen.findByLabelText("讨论草稿");
    fireEvent.change(draft, { target: { value: "保留编辑" } });
    act(() => {
      state
        .api!.getPanel("discussion")!
        .api.moveTo({ group: state.api!.getPanel("inspector")!.group, position: "center" });
      state.api!.getPanel("inspector")!.api.setActive();
    });
    const close = await screen.findByRole("button", { name: "隐藏讨论 / Issue" });
    expect(screen.queryByRole("button", { name: /菜单$/ })).toBeNull();
    fireEvent.contextMenu(close.closest('[role="tab"]')!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(state.api!.getPanel("discussion")!.group.id).not.toBe("parking");
    expect(close.closest('[role="tab"]')).toHaveAttribute("data-tab-panel-id", "discussion");
    expect(close.closest('[role="tab"]')).toHaveAttribute("aria-selected", "false");
    fireEvent.click(close);
    await waitFor(() => expect(state.api!.getPanel("discussion")!.group.id).toBe("parking"));
    expect(state.api!.getPanel("inspector")!.group.id).not.toBe("parking");
    expect(screen.queryByRole("button", { name: "隐藏画布" })).toBeNull();
    act(() => commands.current!.show("discussion"));
    await waitFor(() => expect(screen.getByLabelText("讨论草稿")).toHaveValue("保留编辑"));
    act(() => state.api!.addFloatingGroup(state.api!.getPanel("discussion")!));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "隐藏讨论 / Issue" })).toHaveLength(1);
      expect(screen.getByRole("button", { name: "隐藏标注详情" })).toBeVisible();
    });
    expect(mounts).toBe(1);
  });

  it("keeps unfocused 3D panels visible and blocks Shift floating cameras", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    render(fixture("annotate:3d", commands));
    await screen.findByTestId("canvas-marker");
    act(() => {
      commands.current!.show("tri-view");
      commands.current!.setCameraPresentation("docked");
    });
    await screen.findByRole("button", { name: "隐藏相机视图" });
    const tri = document.querySelector('[data-workbench-panel="tri-view"]')!;
    const canvas = document.querySelector('[data-workbench-panel="canvas"]')!;
    await waitFor(() => {
      expect(tri).toHaveAttribute("aria-hidden", "false");
      expect(canvas).toHaveAttribute("aria-hidden", "false");
    });
    const tab = document.querySelector('[data-tab-panel-id="camera-view"]')!;
    const pointer = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
    });
    act(() => {
      tab.dispatchEvent(pointer);
    });
    expect(pointer.defaultPrevented).toBe(true);
    expect(state.api!.getPanel("camera-view")!.group.api.location.type).toBe("grid");
    fireEvent.click(screen.getByRole("button", { name: "悬浮显示" }));
    await waitFor(() => expect(state.api!.getPanel("camera-view")!.group.id).toBe("parking"));
    expect(mounts).toBe(1);
  });

  it.each([
    "annotate:image",
    "annotate:video",
    "annotate:3d",
    "review:image",
    "review:video",
    "review:3d",
  ] as WorkspaceContext[])(
    "preserves canvas and discussion draft through presets, parking and compact in %s",
    async (context) => {
      const commands = createRef<WorkbenchWorkspaceCommands>();
      const view = render(fixture(context, commands));
      const marker = await screen.findByTestId("canvas-marker");
      const draft = screen.getByLabelText("讨论草稿");
      fireEvent.change(draft, { target: { value: "尚未发送" } });
      act(() => commands.current!.hide("discussion"));
      expect((draft.closest("[data-workbench-panel]") as HTMLElement).inert).toBe(true);
      act(() => commands.current!.show("discussion"));
      expect(screen.getByLabelText("讨论草稿")).toBe(draft);
      fireEvent.click(screen.getByRole("button", { name: "布局" }));
      fireEvent.click(screen.getByRole("button", { name: "审核协作" }));
      expect(state.owner.failRestore).not.toHaveBeenCalled();
      expect(screen.getByTestId("canvas-marker")).toBe(marker);
      const fromJSON = vi.spyOn(state.api!, "fromJSON");
      state.compact = true;
      view.rerender(fixture(context, commands));
      act(() => commands.current!.show("discussion"));
      act(() => commands.current!.show("inspector"));
      state.compact = false;
      view.rerender(fixture(context, commands));
      expect(fromJSON).not.toHaveBeenCalled();
      expect(state.owner.failRestore).not.toHaveBeenCalled();
      expect(screen.getByTestId("canvas-marker")).toBe(marker);
      expect(screen.getByLabelText("讨论草稿")).toHaveValue("尚未发送");
      expect(mounts).toBe(1);
    },
  );

  it("gates initial commands and reuses canvas for the single authority restore", async () => {
    state.owner.initialized = false;
    state.owner.readOnly = true;
    const commands = createRef<WorkbenchWorkspaceCommands>();
    const view = render(fixture("annotate:image", commands));
    const marker = await screen.findByTestId("canvas-marker");
    act(() => commands.current!.hide("discussion"));
    expect(state.owner.save).not.toHaveBeenCalled();
    state.owner.snapshot = createWorkspacePreset("review", bounds);
    state.owner.initialized = true;
    state.owner.readOnly = false;
    state.owner.restoreRevision = 1;
    view.rerender(fixture("annotate:image", commands));
    await waitFor(() => expect(state.api!.getPanel("task-queue")?.group.id).toBe("parking"));
    expect(screen.getByTestId("canvas-marker")).toBe(marker);
    expect(mounts).toBe(1);
  });

  it("keeps only quick presets and settings in the menu and preserves the canvas", async () => {
    render(fixture());
    const marker = await screen.findByTestId("canvas-marker");
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "标准标注布局",
      "专注画布布局",
      "更多布局设置…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "专注画布布局" }));
    expect(state.api!.hasMaximizedGroup()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复画布布局" }));
    expect(state.api!.hasMaximizedGroup()).toBe(false);
    expect(screen.getByTestId("canvas-marker")).toBe(marker);
    expect(mounts).toBe(1);
  });

  it("highlights the live preset and custom layout after panel changes and focus restoration", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    render(fixture("annotate:image", commands));
    await screen.findByTestId("canvas-marker");
    const standard = screen.getByRole("button", { name: "标准标注" });
    expect(standard).toHaveAttribute("aria-pressed", "true");
    act(() => commands.current!.hide("discussion"));
    expect(screen.getByLabelText("自定义布局")).toHaveAttribute("aria-current", "true");
    expect(standard).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(standard);
    expect(standard).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "专注画布" }));
    expect(screen.getByRole("button", { name: "专注画布" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "专注画布" }));
    expect(standard).toHaveAttribute("aria-pressed", "true");
  });

  it("applies review collaboration after the left panels were hidden", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    render(fixture("review:image", commands));
    const marker = await screen.findByTestId("canvas-marker");
    const draft = screen.getByLabelText("讨论草稿");
    fireEvent.change(draft, { target: { value: "保留审核意见" } });
    act(() => {
      commands.current!.hide("task-queue");
      commands.current!.hide("class-palette");
    });
    const review = screen.getByRole("button", { name: "审核协作" });
    expect(review).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(review);
    expect(state.owner.failRestore).not.toHaveBeenCalled();
    expect(review).toHaveAttribute("aria-pressed", "true");
    expect(state.api!.getPanel("discussion")!.api.width).toBe(bounds.width);
    expect(screen.getByTestId("canvas-marker")).toBe(marker);
    expect(screen.getByLabelText("讨论草稿")).toHaveValue("保留审核意见");
    expect(mounts).toBe(1);
  });

  it.each(["preset", "hydration"])(
    "stops serializing an idle focus layout after %s",
    async (source) => {
      if (source === "hydration") state.owner.snapshot = createWorkspacePreset("focus", bounds);
      render(fixture());
      await screen.findByTestId("canvas-marker");
      if (source === "preset") fireEvent.click(screen.getByRole("button", { name: "专注画布" }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      const serialize = vi.spyOn(state.api!, "toJSON");
      fireEvent.pointerUp(window);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(serialize).not.toHaveBeenCalled();
      expect(state.api!.hasMaximizedGroup()).toBe(true);
      expect(screen.getByRole("button", { name: "专注画布" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "专注画布" }));
      expect(serialize).toHaveBeenCalled();
      expect(state.api!.hasMaximizedGroup()).toBe(false);
    },
  );

  it("restores sidebar sizes from a maximized saved layout on hydration", async () => {
    state.owner.snapshot = createWorkspacePreset("focus", bounds);
    render(fixture());
    await screen.findByTestId("canvas-marker");
    expect(state.api!.hasMaximizedGroup()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复画布布局" }));
    expect(state.api!.getPanel("inspector")!.group.api.width).toBe(240);
    expect(state.owner.failRestore).not.toHaveBeenCalled();
    expect(mounts).toBe(1);
  });

  it("filters tool panels by context and hides them without unmounting content", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    const view = render(fixture("annotate:video", commands));
    fireEvent.click(await screen.findByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByText("面板与高级布局"));
    expect(screen.getByRole("button", { name: "当前题 AI" })).toBeInTheDocument();
    expect(
      within(screen.getByText("面板与高级布局").closest("details")!).getByRole("button", {
        name: "视频追踪",
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByText("面板与高级布局").closest("details")!).getByRole("button", {
        name: "视频追踪",
      }),
    );
    const draft = screen.getByLabelText("追踪草稿");
    act(() => commands.current!.hide("video-tracker"));
    expect((draft.closest("[data-workbench-panel]") as HTMLElement).inert).toBe(true);
    act(() => commands.current!.show("video-tracker"));
    expect(screen.getByLabelText("追踪草稿")).toBe(draft);

    view.rerender(fixture("review:video", commands));
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    expect(screen.queryByRole("button", { name: "当前题 AI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "视频追踪" })).toBeNull();
    expect(screen.queryByRole("button", { name: "视频追踪布局" })).toBeNull();
  });

  it("does not replay the previous context desktop after switching in compact mode", async () => {
    const view = render(fixture("annotate:image"));
    await screen.findByTestId("canvas-marker");
    state.compact = true;
    view.rerender(fixture("annotate:image"));
    state.owner.snapshot = createWorkspacePreset("review", bounds);
    view.rerender(fixture("review:image"));
    state.compact = false;
    view.rerender(fixture("review:image"));
    expect(state.api!.getPanel("task-queue")?.group.id).toBe("parking");
    expect(state.owner.failRestore).not.toHaveBeenCalled();
  });

  it("recovers a compact 409 in place and keeps reset disabled", async () => {
    const view = render(fixture());
    const marker = await screen.findByTestId("canvas-marker");
    state.compact = true;
    view.rerender(fixture());
    state.owner.readOnly = true;
    state.owner.readOnlyReason = "newer-schema";
    state.owner.restoreRevision = 1;
    state.owner.snapshot = createWorkspacePreset("standard", bounds);
    view.rerender(fixture());
    expect(state.owner.failRestore).not.toHaveBeenCalled();
    expect(screen.getByTestId("canvas-marker")).toBe(marker);
    state.compact = false;
    view.rerender(fixture());
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByText("面板与高级布局"));
    expect(screen.getByRole("button", { name: "重置为标准布局" })).toBeDisabled();
    expect(mounts).toBe(1);
  });
});
