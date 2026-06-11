import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentPropsWithoutRef, type Ref } from "react";
import { ConflictModal } from "@/components/workbench/ConflictModal";
import { RejectReasonModal } from "@/pages/Review/RejectReasonModal";
import type { VideoStageControls } from "../stage/VideoStage";
import { AIInspectorPanel, AIPredictionPopover } from "./AIInspectorPanel";
import { DiscussionPanel } from "./DiscussionPanel";
import { FloatingPanelShell, type FloatingPanelRect } from "./FloatingPanelShell";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { OfflineQueueDrawer } from "./OfflineQueueDrawer";
import { ResizeHandle } from "./ResizeHandle";
import { StatusBar } from "./StatusBar";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { ToolDock } from "./ToolDock";
import { Topbar } from "./Topbar";
import { WorkbenchBanners } from "./WorkbenchBanners";
import { WorkbenchSettingsDrawer } from "./WorkbenchSettingsDrawer";
import { WorkbenchStageHost } from "./WorkbenchStageHost";
import { SIDE_FLOATING_PANEL_MAX_SIZE, SIDE_FLOATING_PANEL_MIN_SIZE } from "./floatingPanelSizing";
import { GuidePanel } from "../sidebar/GuidePanel";
import styles from "./WorkbenchLayout.module.css";

// v0.11.1 · 右栏两段布局：上段（AIInspectorPanel）高度持久化。
const RIGHT_SPLIT_TOP_KEY = "workbench.rightSplit.topHeight";
const RIGHT_SPLIT_TOP_DEFAULT = 360;
const RIGHT_SPLIT_TOP_MIN = 160;
const RIGHT_SPLIT_TOP_MAX = 720;

function readRightSplitTop(): number {
  if (typeof window === "undefined") return RIGHT_SPLIT_TOP_DEFAULT;
  const raw = Number(window.localStorage.getItem(RIGHT_SPLIT_TOP_KEY));
  return Number.isFinite(raw) && raw > 0 ? raw : RIGHT_SPLIT_TOP_DEFAULT;
}

interface FloatingWorkbenchPanel {
  detached: boolean;
  position: FloatingPanelRect;
  onPositionChange: (patch: Partial<FloatingPanelRect>) => void;
  onMergeBack: () => void;
  onClose: () => void;
}

interface WorkbenchLayoutProps {
  gridTemplateColumns: string;
  taskQueue: ComponentProps<typeof TaskQueuePanel>;
  toolDock: ComponentProps<typeof ToolDock>;
  banners: ComponentProps<typeof WorkbenchBanners>;
  topbar: ComponentProps<typeof Topbar>;
  stageHost: ComponentPropsWithoutRef<typeof WorkbenchStageHost>;
  videoControlsRef: Ref<VideoStageControls>;
  statusBar: ComponentProps<typeof StatusBar>;
  inspector: ComponentProps<typeof AIInspectorPanel>;
  aiPopover: ComponentProps<typeof AIPredictionPopover>;
  hotkeys: ComponentProps<typeof HotkeyCheatSheet>;
  offlineQueue: ComponentProps<typeof OfflineQueueDrawer>;
  /** v0.15.3 · 工作台设置抽屉(齿轮菜单入口)。 */
  workbenchSettings: ComponentProps<typeof WorkbenchSettingsDrawer>;
  conflict: ComponentProps<typeof ConflictModal>;
  rejectModal?: ComponentProps<typeof RejectReasonModal>;
  // v0.10.13 · E1 · 标注指引浮层 (可选; 项目无 guide 时不渲染).
  guidePanel?: ComponentProps<typeof GuidePanel>;
  // v0.11.5 · B 组 · 右栏下段统一讨论面板 (转正; 上 AIInspectorPanel + 下 DiscussionPanel 两段固定).
  discussionPanel: ComponentProps<typeof DiscussionPanel>;
  floatingTaskQueue?: FloatingWorkbenchPanel;
  floatingClassPalette?: FloatingWorkbenchPanel;
  floatingInspector?: FloatingWorkbenchPanel;
  floatingDiscussion?: FloatingWorkbenchPanel;
}

export function WorkbenchLayout({
  gridTemplateColumns,
  taskQueue,
  toolDock,
  banners,
  topbar,
  stageHost,
  videoControlsRef,
  statusBar,
  inspector,
  aiPopover,
  hotkeys,
  offlineQueue,
  workbenchSettings,
  conflict,
  rejectModal,
  guidePanel,
  discussionPanel,
  floatingTaskQueue,
  floatingClassPalette,
  floatingInspector,
  floatingDiscussion,
}: WorkbenchLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const splitTopRef = useRef<HTMLDivElement>(null);
  const [splitTopHeight, setSplitTopHeight] = useState(readRightSplitTop);
  const taskQueueDetached = Boolean(floatingTaskQueue?.detached);
  const classPaletteDetached = Boolean(floatingClassPalette?.detached);
  const inspectorDetached = Boolean(floatingInspector?.detached);
  const discussionDetached = Boolean(floatingDiscussion?.detached);
  const rightHasEmbeddedPanel = !inspectorDetached || !discussionDetached;
  const rightShouldRenderEmbeddedPanel = inspector.open && rightHasEmbeddedPanel;

  const onSplitResize = useCallback((next: number) => {
    setSplitTopHeight(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_SPLIT_TOP_KEY, String(next));
    }
  }, []);

  useEffect(() => {
    rootRef.current?.style.setProperty("--workbench-grid-template", gridTemplateColumns);
  }, [gridTemplateColumns]);

  useEffect(() => {
    splitTopRef.current?.style.setProperty("--right-split-top-height", `${splitTopHeight}px`);
  }, [splitTopHeight]);

  return (
    <div
      ref={rootRef}
      className={styles.root}
    >
      <Topbar {...topbar} />

      <div className={styles.bodyGrid}>
        <div className={styles.sideSlot}>
          <TaskQueuePanel
            {...taskQueue}
            detachedQueue={taskQueueDetached}
            detachedPalette={classPaletteDetached}
          />
        </div>
        <ToolDock {...toolDock} />

        <div className={styles.centerColumn}>
          <WorkbenchBanners {...banners} />
          <WorkbenchStageHost ref={videoControlsRef} {...stageHost} />
          <StatusBar {...statusBar} />
        </div>

        {rightShouldRenderEmbeddedPanel && (
          <div className={styles.sideSlot}>
            <div className={styles.rightSplit}>
              {/* v0.11.5+ · 列宽拖拽 handle 提到右栏全高层级（原在 AIInspectorPanel 内，
                  导致只在上段可拖；这里覆盖 AIInspectorPanel + DiscussionPanel 整列高度）。 */}
              {inspector.open && (
                <ResizeHandle side="left" width={inspector.width} onResize={inspector.onResize} min={220} max={600} />
              )}
              {!inspectorDetached && (
                <div
                  ref={splitTopRef}
                  className={discussionDetached ? `${styles.rightSplitTop} ${styles.rightSplitTopFull}` : styles.rightSplitTop}
                >
                  <AIInspectorPanel {...inspector} />
                  {!discussionDetached && (
                    <ResizeHandle
                      side="bottom"
                      width={splitTopHeight}
                      onResize={onSplitResize}
                      min={RIGHT_SPLIT_TOP_MIN}
                      max={RIGHT_SPLIT_TOP_MAX}
                      resetTo={RIGHT_SPLIT_TOP_DEFAULT}
                    />
                  )}
                </div>
              )}
              {!discussionDetached && (
                <div className={styles.rightSplitBottom}>
                  <DiscussionPanel {...discussionPanel} />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {taskQueueDetached && floatingTaskQueue && (
        <FloatingPanelShell
          title="任务队列"
          position={floatingTaskQueue.position}
          onPositionChange={floatingTaskQueue.onPositionChange}
          onMergeBack={floatingTaskQueue.onMergeBack}
          onClose={floatingTaskQueue.onClose}
          minSize={SIDE_FLOATING_PANEL_MIN_SIZE}
          maxSize={SIDE_FLOATING_PANEL_MAX_SIZE}
        >
          <TaskQueuePanel
            {...taskQueue}
            open
            floatingSection="queue"
          />
        </FloatingPanelShell>
      )}

      {classPaletteDetached && floatingClassPalette && (
        <FloatingPanelShell
          title="类别面板"
          position={floatingClassPalette.position}
          onPositionChange={floatingClassPalette.onPositionChange}
          onMergeBack={floatingClassPalette.onMergeBack}
          onClose={floatingClassPalette.onClose}
          minSize={SIDE_FLOATING_PANEL_MIN_SIZE}
          maxSize={SIDE_FLOATING_PANEL_MAX_SIZE}
        >
          <TaskQueuePanel
            {...taskQueue}
            open
            floatingSection="palette"
          />
        </FloatingPanelShell>
      )}

      {inspectorDetached && floatingInspector && (
        <FloatingPanelShell
          title="标注详情"
          position={floatingInspector.position}
          onPositionChange={floatingInspector.onPositionChange}
          onMergeBack={floatingInspector.onMergeBack}
          onClose={floatingInspector.onClose}
          minSize={SIDE_FLOATING_PANEL_MIN_SIZE}
          maxSize={SIDE_FLOATING_PANEL_MAX_SIZE}
        >
          <AIInspectorPanel
            {...inspector}
            open
            floating
            onDetach={undefined}
          />
        </FloatingPanelShell>
      )}

      {discussionDetached && floatingDiscussion && (
        <FloatingPanelShell
          title="讨论 / Issue"
          position={floatingDiscussion.position}
          onPositionChange={floatingDiscussion.onPositionChange}
          onMergeBack={floatingDiscussion.onMergeBack}
          onClose={floatingDiscussion.onClose}
          minSize={SIDE_FLOATING_PANEL_MIN_SIZE}
          maxSize={SIDE_FLOATING_PANEL_MAX_SIZE}
        >
          <DiscussionPanel
            {...discussionPanel}
            floating
            onDetach={undefined}
          />
        </FloatingPanelShell>
      )}

      <AIPredictionPopover {...aiPopover} />
      <HotkeyCheatSheet {...hotkeys} />
      <OfflineQueueDrawer {...offlineQueue} />
      <WorkbenchSettingsDrawer {...workbenchSettings} />
      <ConflictModal {...conflict} />
      {rejectModal && <RejectReasonModal {...rejectModal} />}
      {guidePanel && <GuidePanel {...guidePanel} />}
    </div>
  );
}
