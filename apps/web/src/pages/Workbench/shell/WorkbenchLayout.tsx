import { useEffect, useRef, type ComponentProps, type ComponentPropsWithoutRef, type Ref } from "react";
import { ConflictModal } from "@/components/workbench/ConflictModal";
import { RejectReasonModal } from "@/pages/Review/RejectReasonModal";
import type { VideoStageControls } from "../stage/VideoStage";
import { AIInspectorPanel, AIPredictionPopover } from "./AIInspectorPanel";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { OfflineQueueDrawer } from "./OfflineQueueDrawer";
import { StatusBar } from "./StatusBar";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { ToolDock } from "./ToolDock";
import { Topbar } from "./Topbar";
import { WorkbenchBanners } from "./WorkbenchBanners";
import { WorkbenchStageHost } from "./WorkbenchStageHost";
import { GuidePanel } from "../sidebar/GuidePanel";
import styles from "./WorkbenchLayout.module.css";

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
}: WorkbenchLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rootRef.current?.style.setProperty("--workbench-grid-template", gridTemplateColumns);
  }, [gridTemplateColumns]);

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
          <AIInspectorPanel {...inspector} />
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
