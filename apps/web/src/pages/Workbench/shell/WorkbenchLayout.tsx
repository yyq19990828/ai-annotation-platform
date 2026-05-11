import type { ComponentProps, ComponentPropsWithoutRef, Ref } from "react";
import { ConflictModal } from "@/components/workbench/ConflictModal";
import { RejectReasonModal } from "@/pages/Review/RejectReasonModal";
import type { VideoStageControls } from "../stage/VideoStage";
import { AIInspectorPanel } from "./AIInspectorPanel";
import { HotkeyCheatSheet } from "./HotkeyCheatSheet";
import { OfflineQueueDrawer } from "./OfflineQueueDrawer";
import { StatusBar } from "./StatusBar";
import { TaskQueuePanel } from "./TaskQueuePanel";
import { ToolDock } from "./ToolDock";
import { Topbar } from "./Topbar";
import { WorkbenchBanners } from "./WorkbenchBanners";
import { WorkbenchStageHost } from "./WorkbenchStageHost";

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
  hotkeys: ComponentProps<typeof HotkeyCheatSheet>;
  offlineQueue: ComponentProps<typeof OfflineQueueDrawer>;
  conflict: ComponentProps<typeof ConflictModal>;
  rejectModal?: ComponentProps<typeof RejectReasonModal>;
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
  hotkeys,
  offlineQueue,
  conflict,
  rejectModal,
}: WorkbenchLayoutProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns,
        height: "100%",
        overflow: "hidden",
        background: "var(--color-bg-sunken)",
      }}
    >
      <TaskQueuePanel {...taskQueue} />
      <ToolDock {...toolDock} />

      <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <WorkbenchBanners {...banners} />
        <Topbar {...topbar} />
        <WorkbenchStageHost ref={videoControlsRef} {...stageHost} />
        <StatusBar {...statusBar} />
      </div>

      <AIInspectorPanel {...inspector} />
      <HotkeyCheatSheet {...hotkeys} />
      <OfflineQueueDrawer {...offlineQueue} />
      <ConflictModal {...conflict} />
      {rejectModal && <RejectReasonModal {...rejectModal} />}
    </div>
  );
}
