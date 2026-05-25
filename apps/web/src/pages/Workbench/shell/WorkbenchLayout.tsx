import { useCallback, useEffect, useRef, useState, type ComponentProps, type ComponentPropsWithoutRef, type Ref } from "react";
import { ConflictModal } from "@/components/workbench/ConflictModal";
import { RejectReasonModal } from "@/pages/Review/RejectReasonModal";
import type { VideoStageControls } from "../stage/VideoStage";
import { AIInspectorPanel, AIPredictionPopover } from "./AIInspectorPanel";
import { DiscussionPanel } from "./DiscussionPanel";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { OfflineQueueDrawer } from "./OfflineQueueDrawer";
import { ResizeHandle } from "./ResizeHandle";
import { StatusBar } from "./StatusBar";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { ToolDock } from "./ToolDock";
import { Topbar } from "./Topbar";
import { WorkbenchBanners } from "./WorkbenchBanners";
import { WorkbenchStageHost } from "./WorkbenchStageHost";
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
  conflict: ComponentProps<typeof ConflictModal>;
  rejectModal?: ComponentProps<typeof RejectReasonModal>;
  // v0.10.13 · E1 · 标注指引浮层 (可选; 项目无 guide 时不渲染).
  guidePanel?: ComponentProps<typeof GuidePanel>;
  // v0.11.5 · B 组 · 右栏下段统一讨论面板 (转正; 上 AIInspectorPanel + 下 DiscussionPanel 两段固定).
  discussionPanel: ComponentProps<typeof DiscussionPanel>;
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
  conflict,
  rejectModal,
  guidePanel,
  discussionPanel,
}: WorkbenchLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const splitTopRef = useRef<HTMLDivElement>(null);
  const [splitTopHeight, setSplitTopHeight] = useState(readRightSplitTop);

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
          <TaskQueuePanel {...taskQueue} />
        </div>
        <ToolDock {...toolDock} />

        <div className={styles.centerColumn}>
          <WorkbenchBanners {...banners} />
          <WorkbenchStageHost ref={videoControlsRef} {...stageHost} />
          <StatusBar {...statusBar} />
        </div>

        <div className={styles.sideSlot}>
          <div className={styles.rightSplit}>
            <div ref={splitTopRef} className={styles.rightSplitTop}>
              <AIInspectorPanel {...inspector} />
              <ResizeHandle
                side="bottom"
                width={splitTopHeight}
                onResize={onSplitResize}
                min={RIGHT_SPLIT_TOP_MIN}
                max={RIGHT_SPLIT_TOP_MAX}
                resetTo={RIGHT_SPLIT_TOP_DEFAULT}
              />
            </div>
            <div className={styles.rightSplitBottom}>
              <DiscussionPanel {...discussionPanel} />
            </div>
          </div>
        </div>
      </div>

      <AIPredictionPopover {...aiPopover} />
      <HotkeyCheatSheet {...hotkeys} />
      <OfflineQueueDrawer {...offlineQueue} />
      <ConflictModal {...conflict} />
      {rejectModal && <RejectReasonModal {...rejectModal} />}
      {guidePanel && <GuidePanel {...guidePanel} />}
    </div>
  );
}
