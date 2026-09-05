import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  DockviewReact,
  type DockviewApi,
  type IDockviewPanelProps,
  type IDockviewPanelHeaderProps,
  type DockviewWillShowOverlayLocationEvent,
  type DockviewWillDropEvent,
} from "dockview-react";
import { toast } from "sonner";
import { DropdownMenu, type DropdownItem } from "@/components/ui/DropdownMenu";
import { Icon } from "@/components/ui/Icon";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";
import { useActiveIssueStore } from "../state/useActiveIssueStore";
import { useWorkbenchWorkspaceLayout } from "../state/useWorkbenchWorkspaceLayout";
import { createWorkbenchLayoutExecutor } from "./workbenchLayoutExecutor";
import {
  createWorkspacePreset,
  migrateLegacyWorkspace,
  presetSupportsContext,
  type WorkspacePresetId,
} from "./workbenchLayoutPresets";
import type { PanelId, WorkspaceContext } from "./workbenchLayoutSnapshot";
import {
  PERIPHERAL_PANELS,
  WORKBENCH_PANEL_REGISTRY,
  panelSupportsContext,
  type WorkbenchPanelSlots,
  type WorkbenchWorkspaceCommands,
  type WorkbenchWorkspaceState,
} from "./workbenchPanelRegistry";
import "dockview-react/dist/styles/dockview.css";
import styles from "./WorkbenchDockWorkspace.module.css";

export interface WorkbenchDockWorkspaceProps {
  context: WorkspaceContext;
  legacy: Parameters<typeof migrateLegacyWorkspace>[0];
  commandsRef?: Ref<WorkbenchWorkspaceCommands>;
  onStateChange?: (state: WorkbenchWorkspaceState) => void;
  slots: WorkbenchPanelSlots;
  renderTopbar: (menu: ReactNode, state: WorkbenchWorkspaceState) => ReactNode;
}

type Executor = ReturnType<typeof createWorkbenchLayoutExecutor>;
const SlotsContext = createContext<WorkbenchPanelSlots | null>(null);
const TabMenuContext = createContext<(id: PanelId) => DropdownItem[]>(() => []);

// Dockview owns these stable React portals. Reparenting a panel does not recreate its content.
function PanelContent({ api, containerApi }: IDockviewPanelProps) {
  const slots = useContext(SlotsContext)!;
  const [visible, setVisible] = useState(api.isVisible);
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (element.current) element.current.inert = !visible;
  }, [visible]);
  useEffect(() => {
    const update = () =>
      setVisible(api.group.id !== "parking" && api.isVisible && api.group.api.isVisible);
    let groupVisibility = api.group.api.onDidVisibilityChange(update);
    const subscriptions = [
      api.onDidVisibilityChange(update),
      api.onDidGroupChange(() => {
        groupVisibility.dispose();
        groupVisibility = api.group.api.onDidVisibilityChange(update);
        update();
      }),
      containerApi.onDidLayoutChange(update),
    ];
    update();
    return () => {
      groupVisibility.dispose();
      subscriptions.forEach((subscription) => subscription.dispose());
    };
  }, [api, containerApi]);
  return (
    <div
      ref={element}
      className={styles.panel}
      data-workbench-panel={api.id}
      aria-hidden={!visible}
    >
      {slots[api.id as PanelId]}
    </div>
  );
}

function PanelTab({ api }: IDockviewPanelHeaderProps) {
  const items = useContext(TabMenuContext)(api.id as PanelId);
  return (
    <div
      className="flex h-full items-center gap-1 pl-2 text-xs"
      data-workbench-layout-control
      onContextMenu={(event) => {
        event.preventDefault();
        event.currentTarget.querySelector("button")?.click();
      }}
    >
      <span>{WORKBENCH_PANEL_REGISTRY[api.id as PanelId].title}</span>
      <DropdownMenu
        items={items}
        trigger={({ ref, toggle, open }) => (
          <button
            ref={ref}
            type="button"
            aria-label={`${WORKBENCH_PANEL_REGISTRY[api.id as PanelId].title}菜单`}
            aria-haspopup="menu"
            aria-expanded={open}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
            className="rounded-sm p-1 text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon name="more" size={14} />
          </button>
        )}
      />
    </div>
  );
}
const components = { "workbench-panel": PanelContent };
const theme = { name: "workbench", className: "workbench-dock-theme" };
const EMPTY_STATE: WorkbenchWorkspaceState = {
  taskQueueVisible: true,
  inspectorVisible: true,
  aiTaskVisible: false,
  videoTrackerVisible: false,
  canvasMaximized: false,
  taskQueueWidth: 220,
  inspectorWidth: 260,
  disabled: true,
};
const PRESET_LABELS: Record<WorkspacePresetId, string> = {
  standard: "标准标注",
  focus: "专注画布",
  review: "审核协作",
  "ai-review": "图片 AI 审阅",
  "video-tracking": "视频追踪",
};

export function WorkbenchDockWorkspace(props: WorkbenchDockWorkspaceProps) {
  const { context, commandsRef, slots, renderTopbar } = props;
  const user = useAuthStore((state) => state.user);
  const userId = user?.id;
  const legacyAccount = useRef(userId);
  const compact = useMediaQuery("(max-width: 1024px)");
  const availablePanels = useMemo(
    () => PERIPHERAL_PANELS.filter((id) => panelSupportsContext(id, context)),
    [context],
  );
  const host = useRef<HTMLDivElement>(null);
  const bounds = useCallback(
    () => ({
      width: host.current?.clientWidth || window.innerWidth,
      height: host.current?.clientHeight || Math.max(320, window.innerHeight - 100),
    }),
    [],
  );
  // Legacy preferences are a one-time seed, never a second layout owner.
  const fallback = useMemo(() => {
    const seed =
      legacyAccount.current === userId ? props.legacy : (user?.preferences?.workbench ?? {});
    legacyAccount.current = userId;
    let rightSplitTop: number | undefined;
    try {
      const stored = localStorage.getItem("workbench.rightSplit.topHeight");
      if (stored !== null && Number.isFinite(Number(stored))) rightSplitTop = Number(stored);
    } catch {
      /* Account preferences still work when local storage is unavailable. */
    }
    return migrateLegacyWorkspace({ ...seed, rightSplitTop }, bounds());
  }, [context, userId]); // eslint-disable-line react-hooks/exhaustive-deps
  const standard = useMemo(
    () => createWorkspacePreset("standard", bounds(), context),
    [bounds, context],
  );
  const owner = useWorkbenchWorkspaceLayout(context, fallback, standard, compact);
  const [api, setApi] = useState<DockviewApi | null>(null);
  const executor = useRef<Executor | null>(null);
  const latest = useRef({ owner, compact, onStateChange: props.onStateChange });
  latest.current = { owner, compact, onStateChange: props.onStateChange };
  const [view, setView] = useState(EMPTY_STATE);
  const published = useRef(EMPTY_STATE);
  const [visiblePanels, setVisiblePanels] = useState<PanelId[]>([...PERIPHERAL_PANELS]);
  const restoring = useRef(false);
  const pointerDown = useRef(false);
  const interaction = useRef(false);
  const pendingFrame = useRef<number | null>(null);
  const undo = useRef<string | number | null>(null);
  const hydration = useRef<{ api: DockviewApi; session: string; revision: number } | null>(null);

  const publish = useCallback(() => {
    const engine = executor.current;
    if (!api || !engine) return;
    engine.syncConstraints();
    const opened = PERIPHERAL_PANELS.filter((id) => engine.isVisible(id));
    const next = {
      taskQueueVisible: opened.includes("task-queue"),
      inspectorVisible: opened.includes("inspector"),
      aiTaskVisible: opened.includes("ai-task"),
      videoTrackerVisible: opened.includes("video-tracker"),
      canvasMaximized: engine.isCanvasMaximized(),
      taskQueueWidth: api.getPanel("task-queue")?.api.width ?? 220,
      inspectorWidth: api.getPanel("inspector")?.api.width ?? 260,
      disabled: latest.current.owner.readOnly,
    };
    if (JSON.stringify(published.current) !== JSON.stringify(next)) {
      published.current = next;
      setView(next);
      latest.current.onStateChange?.(next);
    }
    setVisiblePanels((previous) => (previous.join() === opened.join() ? previous : opened));
  }, [api]);

  const persist = useCallback(() => {
    if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      if (restoring.current || !executor.current) return;
      publish();
      if (
        !interaction.current ||
        pointerDown.current ||
        executor.current.isCompact() ||
        latest.current.owner.readOnly
      )
        return;
      interaction.current = false;
      try {
        latest.current.owner.save(executor.current.capture());
      } catch {
        latest.current.owner.failRestore();
      }
    });
  }, [publish]);

  const run = useCallback(
    (action: (engine: Executor) => void, allowCompact = false) => {
      const engine = executor.current;
      if (!engine || latest.current.owner.readOnly || (!allowCompact && engine.isCompact())) return;
      restoring.current = true;
      try {
        action(engine);
        publish();
        if (!engine.isCompact()) latest.current.owner.save(engine.capture());
      } catch {
        latest.current.owner.failRestore();
      } finally {
        restoring.current = false;
      }
    },
    [publish],
  );

  const commands = useMemo<WorkbenchWorkspaceCommands>(
    () => ({
      show: (id) => {
        if (panelSupportsContext(id, context)) run((engine) => engine.show(id), true);
      },
      hide: (id) => run((engine) => engine.hide(id), true),
      toggle: (id) => {
        if (panelSupportsContext(id, context))
          run((engine) => (engine.isVisible(id) ? engine.hide(id) : engine.show(id)), true);
      },
    }),
    [context, run],
  );
  useImperativeHandle(commandsRef, () => commands, [commands]);

  const dismissUndo = useCallback(() => {
    if (undo.current !== null) toast.dismiss(undo.current);
    undo.current = null;
  }, []);
  const preset = (id: WorkspacePresetId) =>
    run((engine) => {
      const before = engine.capture();
      engine.applyPreset(id);
      undo.current = toast(`已切换到${PRESET_LABELS[id]}布局`, {
        id: undo.current ?? undefined,
        action: { label: "撤销", onClick: () => run((current) => current.restore(before)) },
        duration: 8000,
        position: "bottom-center",
      });
    });
  const reset = () => {
    if (
      compact ||
      !owner.initialized ||
      owner.readOnlyReason === "newer-schema" ||
      !executor.current
    )
      return;
    restoring.current = true;
    try {
      dismissUndo();
      executor.current.applyPreset("standard");
      owner.reset(executor.current.capture());
      publish();
    } catch {
      owner.failRestore();
    } finally {
      restoring.current = false;
    }
  };
  const tabItems = useCallback(
    (id: PanelId): DropdownItem[] => [
      ...(
        [
          ["left", "停靠到左侧"],
          ["right", "停靠到右侧"],
          ["below", "停靠到底部"],
        ] as const
      ).map(([position, label]) => ({
        id: position,
        label,
        disabled: owner.readOnly || compact || id === "canvas",
        onSelect: () => run((engine) => engine.dock(id, position)),
      })),
      ...availablePanels
        .filter((target) => target !== id)
        .map((target) => ({
          id: `tab-${target}`,
          label: `与${WORKBENCH_PANEL_REGISTRY[target].title}合并为标签`,
          disabled: owner.readOnly || compact || id === "canvas",
          onSelect: () => run((engine) => engine.tab(id, target)),
        })),
      {
        id: "float",
        label: "浮动面板",
        disabled: owner.readOnly || compact || id === "canvas",
        onSelect: () => run((engine) => engine.float(id)),
      },
      {
        id: "hide",
        label: "隐藏面板",
        disabled: owner.readOnly || id === "canvas",
        onSelect: () => commands.hide(id),
      },
    ],
    [availablePanels, commands, compact, owner.readOnly, run],
  );

  useLayoutEffect(() => {
    if (!api) return;
    const session = `${userId ?? "anonymous"}:${context}`;
    const previous = hydration.current;
    if (
      previous?.api === api &&
      previous.session === session &&
      previous.revision === owner.restoreRevision
    )
      return;
    restoring.current = true;
    interaction.current = false;
    dismissUndo();
    const engine =
      previous?.api === api && previous.session === session
        ? executor.current!
        : createWorkbenchLayoutExecutor(api, bounds);
    executor.current = engine;
    try {
      let maximizeAfterHydration = false;
      // The only whole-tree restore seam: cold start and the settled initial authority.
      if (
        !previous ||
        previous.api !== api ||
        previous.session !== session ||
        !owner.readOnlyReason
      ) {
        if (engine.isCanvasMaximized()) engine.toggleCanvasMaximized();
        const layout = structuredClone(owner.snapshot.layout);
        maximizeAfterHydration = !!layout.grid.maximizedNode;
        delete layout.grid.maximizedNode;
        api.fromJSON(layout, { reuseExistingPanels: true });
        engine.setReturns(owner.snapshot.returns);
      } else {
        engine.recover(owner.snapshot);
      }
      hydration.current = { api, session, revision: owner.restoreRevision };
      for (const panel of api.panels) {
        const spec = WORKBENCH_PANEL_REGISTRY[panel.id as PanelId];
        panel.api.setRenderer(spec.renderer);
        panel.api.setConstraints({ minimumWidth: spec.minWidth, minimumHeight: spec.minHeight });
      }
      const canvas = api.groups.find((group) => group.id === "canvas");
      if (canvas) {
        canvas.api.locked = true;
        canvas.header.hidden = true;
      }
      const parking = api.groups.find((group) => group.id === "parking");
      if (parking) {
        parking.api.locked = "no-drop-target";
        parking.header.hidden = true;
        parking.api.setVisible(false);
      }
      for (const id of PERIPHERAL_PANELS) if (!availablePanels.includes(id)) engine.hide(id);
      if (maximizeAfterHydration) {
        engine.syncConstraints();
        engine.toggleCanvasMaximized();
      }
      if (compact && owner.initialized) engine.enterCompact();
      publish();
    } catch {
      hydration.current = { api, session, revision: owner.restoreRevision };
      owner.failRestore();
    } finally {
      restoring.current = false;
    }
  }, [api, availablePanels, bounds, compact, context, dismissUndo, owner, publish, userId]);

  useLayoutEffect(() => {
    const engine = executor.current;
    if (!api || !engine || !owner.initialized || compact === engine.isCompact()) return;
    restoring.current = true;
    interaction.current = false;
    try {
      dismissUndo();
      if (compact && !engine.isCompact()) engine.enterCompact();
      if (!compact && engine.isCompact()) {
        if (engine.exitCompact()) owner.save(engine.capture());
      }
      publish();
    } catch {
      owner.failRestore();
    } finally {
      restoring.current = false;
    }
  }, [api, compact, owner, publish, dismissUndo]);

  useEffect(() => {
    if (!api) return;
    api.updateOptions({ locked: owner.readOnly || compact, disableDnd: owner.readOnly || compact });
    publish();
  }, [api, owner.readOnly, compact, publish]);

  useEffect(() => {
    if (!api) return;
    const blocked = () => latest.current.owner.readOnly || latest.current.compact;
    let restoreDragSizes: ReturnType<Executor["preserveGridSizes"]> | undefined;
    let movedPanel: string | undefined;
    let movedGroup: string | undefined;
    const guardDrop = (event: DockviewWillDropEvent | DockviewWillShowOverlayLocationEvent) => {
      const source = event.getData();
      const target = event.group;
      if (
        blocked() ||
        source?.panelId === "canvas" ||
        source?.groupId === "canvas" ||
        target?.id === "parking" ||
        (target?.id === "canvas" && event.position === "center") ||
        target?.api.location.type === "popout" ||
        (target?.api.location.type === "floating" && event.position !== "center")
      )
        event.preventDefault();
    };
    const subscriptions = [
      api.onWillMutateLayout((event) => {
        if (
          !blocked() &&
          event.origin === "user" &&
          ["move", "float", "remove"].includes(event.kind)
        )
          restoreDragSizes ??= executor.current?.preserveGridSizes();
      }),
      api.onDidMutateLayout(() => {
        const restore = restoreDragSizes;
        restoreDragSizes = undefined;
        if (!restore) return;
        try {
          restore(movedPanel ? api.getPanel(movedPanel)?.group.id : movedGroup);
        } catch {
          latest.current.owner.failRestore();
        }
        movedPanel = movedGroup = undefined;
      }),
      api.onWillDragPanel((event) => {
        if (blocked() || event.panel.id === "canvas") event.nativeEvent.preventDefault();
      }),
      api.onWillDragGroup((event) => {
        if (blocked() || event.group.id === "canvas" || event.group.id === "parking")
          event.nativeEvent.preventDefault();
      }),
      api.onWillShowOverlay(guardDrop),
      api.onWillDrop((event) => {
        guardDrop(event);
        if (!event.defaultPrevented) {
          // Root-edge drops create a grid branch before Dockview emits its mutation event.
          restoreDragSizes ??= executor.current?.preserveGridSizes();
          const source = event.position !== "center" ? event.getData() : undefined;
          movedPanel = source?.panelId ?? undefined;
          movedGroup = source?.groupId;
        }
      }),
      api.onDidLayoutChange(persist),
      api.onDidActivePanelChange(persist),
      api.onDidMovePanel(persist),
    ];
    const release = () => {
      restoreDragSizes = undefined;
      movedPanel = movedGroup = undefined;
      pointerDown.current = false;
      persist();
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("dragend", release);
    // Moving a tab can remove the drag source before dragend reaches window.
    window.addEventListener("drop", release, true);
    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      window.removeEventListener("pointerup", release);
      window.removeEventListener("dragend", release);
      window.removeEventListener("drop", release, true);
      if (pendingFrame.current !== null) cancelAnimationFrame(pendingFrame.current);
    };
  }, [api, persist]);

  useEffect(() => {
    if (!host.current || !api) return;
    const observer = new ResizeObserver(() => {
      if (executor.current?.isCompact()) executor.current.resizeCompact();
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [api]);
  useEffect(() => dismissUndo, [dismissUndo]);
  useEffect(
    () =>
      useActiveIssueStore.subscribe((next, previous) => {
        if (next.tabRequestTick !== previous.tabRequestTick) commands.show("discussion");
      }),
    [commands],
  );

  const menu = (
    <DropdownMenu
      items={[
        ...(Object.keys(PRESET_LABELS) as WorkspacePresetId[])
          .filter((id) => presetSupportsContext(id, context))
          .map((id) => ({
            id,
            label: `${PRESET_LABELS[id]}布局`,
            disabled: owner.readOnly || compact,
            onSelect: () => preset(id),
          })),
        { id: "separator", label: "", divider: true },
        ...availablePanels.map((id) => ({
          id,
          label: WORKBENCH_PANEL_REGISTRY[id].title,
          active: visiblePanels.includes(id),
          disabled: owner.readOnly,
          onSelect: () => commands.show(id),
        })),
        { id: "separator-canvas", label: "", divider: true },
        ...(
          [
            ["left", "画布移到左侧"],
            ["right", "画布移到右侧"],
            ["above", "画布移到上方"],
            ["below", "画布移到下方"],
          ] as const
        ).map(([position, label]) => ({
          id: `canvas-${position}`,
          label,
          disabled: owner.readOnly || compact,
          onSelect: () => run((engine) => engine.moveCanvas(position)),
        })),
        {
          id: "canvas-maximize",
          label: view.canvasMaximized ? "恢复画布" : "最大化画布",
          disabled: owner.readOnly || compact,
          onSelect: () => run((engine) => engine.toggleCanvasMaximized()),
        },
        { id: "separator-reset", label: "", divider: true },
        {
          id: "reset",
          label: "重置为标准布局",
          disabled: !owner.initialized || compact || owner.readOnlyReason === "newer-schema",
          onSelect: reset,
        },
      ]}
      trigger={({ ref, toggle, open }) => (
        <button
          ref={ref}
          type="button"
          data-workbench-layout-control
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
        >
          布局
          <Icon name="chevDown" size={12} />
        </button>
      )}
    />
  );
  return (
    <SlotsContext.Provider value={slots}>
      <TabMenuContext.Provider value={tabItems}>
        {renderTopbar(menu, view)}
        {(owner.error || owner.readOnlyReason) && (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-3 py-1 text-xs text-muted-foreground"
          >
            {owner.error ??
              (owner.readOnlyReason === "newer-schema"
                ? "此布局来自新版，当前使用只读标准布局。"
                : "保存的布局无法恢复，请从布局菜单重置。")}
          </div>
        )}
        <div
          ref={host}
          className={cn(
            "min-h-0 min-w-0 flex-1 overflow-hidden",
            styles.workspace,
            owner.readOnly && styles.locked,
            compact && styles.compact,
          )}
          data-workbench-workspace
          data-compact={compact}
          onPointerDownCapture={(event) => {
            if (
              (event.target as HTMLElement).closest(
                '.dv-tab, .dv-tabs-and-actions-container, .dv-sash, [class*="dv-resize-handle-"]',
              )
            ) {
              pointerDown.current = true;
              interaction.current = true;
            }
          }}
          onKeyDown={(event) => {
            if (
              (event.target as HTMLElement).closest(
                '[role="tab"], [role="menu"], [role="menuitem"], [data-workbench-layout-control]',
              )
            ) {
              interaction.current = true;
              persist();
              event.stopPropagation();
            }
          }}
          onDoubleClick={(event) => {
            if (!(event.target as HTMLElement).closest("[data-workbench-canvas]"))
              event.stopPropagation();
          }}
        >
          <DockviewReact
            components={components}
            defaultTabComponent={PanelTab}
            theme={theme}
            onReady={(event) => setApi(event.api)}
            floatingGroupBounds="boundedWithinViewport"
            floatingGroupDragHandle="tabbar"
          />
        </div>
      </TabMenuContext.Provider>
    </SlotsContext.Provider>
  );
}
