import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createRef, useEffect, useState } from "react";
import type { DockviewApi } from "dockview-react";
import { createWorkspacePreset } from "./workbenchLayoutPresets";
import { getCanvasPlacement } from "./workbenchLayoutExecutor";
import type { WorkbenchWorkspaceCommands } from "./workbenchPanelRegistry";
import type { WorkspaceContext, WorkspaceSnapshot } from "./workbenchLayoutSnapshot";

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
) {
  return (
    <WorkbenchDockWorkspace
      context={context}
      legacy={{}}
      commandsRef={commands}
      slots={{
        canvas: <Canvas />,
        "task-queue": <p>任务</p>,
        "class-palette": <p>类别</p>,
        inspector: <p>详情</p>,
        discussion: <Draft />,
        "ai-task": <input aria-label="AI 草稿" defaultValue="保留" />,
        "video-tracker": <input aria-label="追踪草稿" defaultValue="保留" />,
        "tri-view": null,
        "camera-view": null,
      }}
      renderTopbar={(menu) => <header>{menu}</header>}
    />
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
  it("header X hides only the active tab and restores its draft without remounting canvas", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    render(fixture("annotate:image", commands));
    const draft = await screen.findByLabelText("讨论草稿");
    fireEvent.change(draft, { target: { value: "保留编辑" } });
    act(() => {
      state
        .api!.getPanel("discussion")!
        .api.moveTo({ group: state.api!.getPanel("inspector")!.group, position: "center" });
      state.api!.getPanel("discussion")!.api.setActive();
    });
    fireEvent.click(await screen.findByRole("button", { name: "隐藏讨论 / Issue" }));
    await waitFor(() => expect(state.api!.getPanel("discussion")!.group.id).toBe("parking"));
    expect(state.api!.getPanel("inspector")!.group.id).not.toBe("parking");
    expect(screen.queryByRole("button", { name: "隐藏画布" })).toBeNull();
    act(() => commands.current!.show("discussion"));
    await waitFor(() => expect(screen.getByLabelText("讨论草稿")).toHaveValue("保留编辑"));
    fireEvent.click(screen.getByRole("button", { name: "讨论 / Issue菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "浮动面板" }));
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

  it.each(["停靠到左侧", "停靠到右侧", "停靠到底部"])(
    "keeps unrelated sidebar widths through %s and merging the panel back",
    async (command) => {
      const commands = createRef<WorkbenchWorkspaceCommands>();
      render(fixture("annotate:image", commands));
      await screen.findByTestId("canvas-marker");
      act(() => commands.current!.show("ai-task"));
      const panels = ["task-queue", "class-palette", "inspector", "discussion"].map(
        (id) => state.api!.getPanel(id)!,
      );
      const widths = panels.map((panel) => panel.group.api.width);
      fireEvent.click(screen.getByRole("button", { name: "当前题 AI菜单" }));
      fireEvent.click(screen.getByRole("menuitem", { name: command }));
      expect(panels.map((panel) => panel.group.api.width)).toEqual(widths);
      fireEvent.click(screen.getByRole("button", { name: "当前题 AI菜单" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "与标注详情合并为标签" }));
      expect(panels.map((panel) => panel.group.api.width)).toEqual(widths);
      expect(state.owner.failRestore).not.toHaveBeenCalled();
      expect(mounts).toBe(1);
    },
  );

  it("preserves docked widths when the AI tab floats out of a narrow sidebar", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    render(fixture("annotate:image", commands));
    await screen.findByTestId("canvas-marker");
    act(() => commands.current!.show("ai-task"));
    const panels = ["task-queue", "canvas", "inspector", "discussion"].map(
      (id) => state.api!.getPanel(id)!,
    );
    const widths = panels.map((panel) => panel.group.api.width);
    fireEvent.click(screen.getByRole("button", { name: "当前题 AI菜单" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "浮动面板" }));
    await waitFor(() => expect(state.api!.getPanel("ai-task")!.api.location.type).toBe("floating"));
    expect(panels.map((panel) => panel.group.api.width)).toEqual(widths);
    expect(state.owner.failRestore).not.toHaveBeenCalled();
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
      fireEvent.click(screen.getByRole("menuitem", { name: "审核协作布局" }));
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

  it("moves and maximizes the same canvas from the layout menu", async () => {
    render(fixture());
    const marker = await screen.findByTestId("canvas-marker");
    for (const [command, placement] of [
      ["画布移到左侧", "left"],
      ["画布移到右侧", "right"],
      ["画布移到上方", "above"],
      ["画布移到下方", "below"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: "布局" }));
      fireEvent.click(screen.getByRole("menuitem", { name: command }));
      const calls = (state.owner.save as ReturnType<typeof vi.fn>).mock.calls;
      const saved = calls[calls.length - 1]?.[0];
      expect(getCanvasPlacement(saved as WorkspaceSnapshot)).toBe(placement);
      expect(screen.getByTestId("canvas-marker")).toBe(marker);
    }
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "最大化画布" }));
    expect(state.api!.hasMaximizedGroup()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复画布" }));
    expect(state.api!.hasMaximizedGroup()).toBe(false);
    expect(mounts).toBe(1);
  });

  it("restores sidebar sizes from a maximized saved layout on hydration", async () => {
    state.owner.snapshot = createWorkspacePreset("focus", bounds);
    render(fixture());
    await screen.findByTestId("canvas-marker");
    expect(state.api!.hasMaximizedGroup()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "恢复画布" }));
    expect(state.api!.getPanel("inspector")!.group.api.width).toBe(240);
    expect(state.owner.failRestore).not.toHaveBeenCalled();
    expect(mounts).toBe(1);
  });

  it("filters tool panels by context and hides them without unmounting content", async () => {
    const commands = createRef<WorkbenchWorkspaceCommands>();
    const view = render(fixture("annotate:video", commands));
    fireEvent.click(await screen.findByRole("button", { name: "布局" }));
    expect(screen.getByRole("menuitem", { name: "当前题 AI" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "视频追踪" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "视频追踪" }));
    const draft = screen.getByLabelText("追踪草稿");
    act(() => commands.current!.hide("video-tracker"));
    expect((draft.closest("[data-workbench-panel]") as HTMLElement).inert).toBe(true);
    act(() => commands.current!.show("video-tracker"));
    expect(screen.getByLabelText("追踪草稿")).toBe(draft);

    view.rerender(fixture("review:video", commands));
    fireEvent.click(screen.getByRole("button", { name: "布局" }));
    expect(screen.queryByRole("menuitem", { name: "当前题 AI" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "视频追踪" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "视频追踪布局" })).toBeNull();
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
    expect(screen.getByRole("menuitem", { name: "重置为标准布局" })).toBeDisabled();
    expect(mounts).toBe(1);
  });
});
