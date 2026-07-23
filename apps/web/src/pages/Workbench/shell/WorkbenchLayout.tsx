import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { ConflictModal } from "@/components/workbench/ConflictModal";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { RejectReasonModal } from "@/pages/Review/RejectReasonModal";
import type { VideoStageControls } from "../stage/videoStageControls";
import { AIInspectorPanel, AIPredictionPopover } from "./AIInspectorPanel";
import { DeleteConfirmModal } from "./DeleteConfirmModal";
import { DiscussionPanel } from "./DiscussionPanel";
import { FloatingPanelShell, type FloatingPanelRect } from "./FloatingPanelShell";
import { clampFloatingPosition, type FloatingPanelPoint } from "./useDragMove";
import { SelectedAnnotationCard, type SelectedAnnotationCardProps } from "./SelectedAnnotationCard";
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
import {
  WorkbenchPet,
  WORKBENCH_PET_SIZE,
  readWorkbenchPetPosition,
  writeWorkbenchPetPosition,
  type WorkbenchPetProps,
} from "./pet/WorkbenchPet";
import { SIDE_FLOATING_PANEL_MAX_SIZE, SIDE_FLOATING_PANEL_MIN_SIZE } from "./floatingPanelSizing";
import { GuidePanel } from "../sidebar/GuidePanel";

const SIDE_SLOT_CLASS = "flex min-h-0 min-w-0 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1";

// v0.11.1 · 右栏两段布局：上段（AIInspectorPanel）高度持久化。
const RIGHT_SPLIT_TOP_KEY = "workbench.rightSplit.topHeight";
const RIGHT_SPLIT_TOP_DEFAULT = 360;
const RIGHT_SPLIT_TOP_MIN = 160;
const RIGHT_SPLIT_TOP_MAX = 720;
const PET_CARRY_VISIBLE_HEIGHT = WORKBENCH_PET_SIZE.h / 2;

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
  /** 相对中间画布居中的非模态浮层，例如视频 AI 追踪配置与候选审阅。 */
  stageOverlay?: ReactNode;
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
  deleteConfirm?: ComponentProps<typeof DeleteConfirmModal>;
  // v0.10.13 · E1 · 标注指引浮层 (可选; 项目无 guide 时不渲染).
  guidePanel?: ComponentProps<typeof GuidePanel>;
  // v0.11.5 · B 组 · 右栏下段统一讨论面板 (转正; 上 AIInspectorPanel + 下 DiscussionPanel 两段固定).
  discussionPanel: ComponentProps<typeof DiscussionPanel>;
  floatingTaskQueue?: FloatingWorkbenchPanel;
  floatingClassPalette?: FloatingWorkbenchPanel;
  floatingInspector?: FloatingWorkbenchPanel;
  floatingDiscussion?: FloatingWorkbenchPanel;
  // v0.16.8 · 选中标注浮动信息卡(图片 / 视频);null = 当前无选中 / 该端不显示。
  floatingSelection?: SelectedAnnotationCardProps | null;
  // v0.20.x · 工作台桌宠;enabled=false 时不挂载,折叠态回退为纯文字小条。
  pet?: ({ enabled: boolean } & WorkbenchPetProps) | null;
}

function carriedSelectionFromPet(
  selectionPosition: FloatingPanelRect,
  petPosition: FloatingPanelPoint,
): FloatingPanelRect {
  const x = petPosition.x + WORKBENCH_PET_SIZE.w / 2 - selectionPosition.w / 2;
  const y = petPosition.y + PET_CARRY_VISIBLE_HEIGHT - selectionPosition.h;
  const clamped = clampFloatingPosition(
    { x, y },
    { w: selectionPosition.w, h: selectionPosition.h },
  );
  return { ...selectionPosition, x: clamped.x, y: clamped.y };
}

function petPositionFromCarriedSelection(panelPosition: FloatingPanelRect): FloatingPanelPoint {
  return clampFloatingPosition(
    {
      x: panelPosition.x + panelPosition.w / 2 - WORKBENCH_PET_SIZE.w / 2,
      y: panelPosition.y + panelPosition.h - PET_CARRY_VISIBLE_HEIGHT,
    },
    WORKBENCH_PET_SIZE,
  );
}

export function WorkbenchLayout({
  gridTemplateColumns,
  taskQueue,
  toolDock,
  banners,
  topbar,
  stageHost,
  stageOverlay,
  videoControlsRef,
  statusBar,
  inspector,
  aiPopover,
  hotkeys,
  offlineQueue,
  workbenchSettings,
  conflict,
  rejectModal,
  deleteConfirm,
  guidePanel,
  discussionPanel,
  floatingTaskQueue,
  floatingClassPalette,
  floatingInspector,
  floatingDiscussion,
  floatingSelection,
  pet,
}: WorkbenchLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [splitTopHeight, setSplitTopHeight] = useState(readRightSplitTop);
  const [petPosition, setPetPositionState] = useState(readWorkbenchPetPosition);
  const taskQueueDetached = Boolean(floatingTaskQueue?.detached);
  const classPaletteDetached = Boolean(floatingClassPalette?.detached);
  const inspectorDetached = Boolean(floatingInspector?.detached);
  const discussionDetached = Boolean(floatingDiscussion?.detached);
  // v0.20.22 · 讨论区完全收起 (仅 tab 头一条); 与"分离"不同, 收起时上段自动吃满剩余高度。
  const discussionCollapsed = Boolean(discussionPanel.collapsed);
  const upperExpandsToFill = discussionDetached || discussionCollapsed;
  const rightHasEmbeddedPanel = !inspectorDetached || !discussionDetached;
  const rightShouldRenderEmbeddedPanel = inspector.open && rightHasEmbeddedPanel;
  const linkedFloatingSelection =
    pet?.enabled && floatingSelection && !floatingSelection.collapsed
      ? carriedSelectionFromPet(floatingSelection.position, petPosition)
      : null;

  const setPetPosition = useCallback((next: FloatingPanelPoint) => {
    setPetPositionState(next);
    writeWorkbenchPetPosition(next);
  }, []);

  const onSplitResize = useCallback((next: number) => {
    const clamped = Math.round(next);
    setSplitTopHeight(clamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RIGHT_SPLIT_TOP_KEY, String(clamped));
    }
  }, []);

  useEffect(() => {
    rootRef.current?.style.setProperty("--workbench-grid-template", gridTemplateColumns);
  }, [gridTemplateColumns]);

  const linkedSelectionPositionChange = useCallback(
    (patch: Partial<FloatingPanelRect>) => {
      if (!floatingSelection || !linkedFloatingSelection) return;
      floatingSelection.onPositionChange(patch);
      if (typeof patch.x === "number" || typeof patch.y === "number") {
        const nextPanelPosition = {
          ...linkedFloatingSelection,
          ...patch,
        };
        setPetPosition(petPositionFromCarriedSelection(nextPanelPosition));
      }
    },
    [floatingSelection, linkedFloatingSelection, setPetPosition],
  );

  // 高度用 useElementStyle 注入 CSS 变量：该上段 div 是条件渲染，收起右栏再展开会重新挂载成
  // 新 DOM；若仍用 useRef+useEffect([splitTopHeight])，依赖未变 effect 不重跑 → 新元素拿不到
  // --right-split-top-height → 高度回退到默认（B-56「展开收起后回到原位 / 第一次拖拽不跟手」）。
  // useElementStyle 用 state 持有元素，重挂载会重跑 effect 把变量重新写上。
  const splitTopStyleRef = useElementStyle<HTMLDivElement>(
    useMemo<CSSProperties>(
      () => ({ "--right-split-top-height": `${splitTopHeight}px` }) as CSSProperties,
      [splitTopHeight],
    ),
  );

  return (
    <div ref={rootRef} className="relative flex h-full flex-col overflow-hidden bg-muted">
      <Topbar {...topbar} />

      <div className="grid min-h-0 flex-1 overflow-hidden [grid-template-columns:var(--workbench-grid-template)]">
        <div className={SIDE_SLOT_CLASS}>
          <TaskQueuePanel
            {...taskQueue}
            detachedQueue={taskQueueDetached}
            detachedPalette={classPaletteDetached}
          />
        </div>
        <ToolDock {...toolDock} />

        <div className="flex min-w-0 flex-col overflow-hidden">
          <WorkbenchBanners {...banners} />
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <WorkbenchStageHost ref={videoControlsRef} {...stageHost} />
            {stageOverlay}
          </div>
          <StatusBar {...statusBar} />
        </div>

        {rightShouldRenderEmbeddedPanel && (
          <div className={SIDE_SLOT_CLASS}>
            <div className="relative flex min-h-0 flex-col overflow-hidden">
              {/* v0.11.5+ · 列宽拖拽 handle 提到右栏全高层级（原在 AIInspectorPanel 内，
                  导致只在上段可拖；这里覆盖 AIInspectorPanel + DiscussionPanel 整列高度）。 */}
              {inspector.open && (
                <ResizeHandle
                  side="left"
                  width={inspector.width}
                  onResize={inspector.onResize}
                  min={inspector.widthMin ?? 220}
                  max={inspector.widthMax ?? 600}
                  resetTo={inspector.widthResetTo}
                />
              )}
              {!inspectorDetached && (
                <div
                  ref={splitTopStyleRef}
                  className={
                    // v0.20.22 · 讨论区分离 or 完全收起 → 上段 flex-1 吃满 (复用同一分支);
                    // 仅"嵌入 + 展开"时才用 h-[var(--right-split-top-height)] 固定高。
                    upperExpandsToFill
                      ? "relative flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1"
                      : "relative flex min-h-0 flex-none flex-col h-[var(--right-split-top-height)] [&>*]:min-h-0 [&>*]:flex-1"
                  }
                >
                  <AIInspectorPanel {...inspector} />
                  {!upperExpandsToFill && (
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
                // v0.20.22 · 完全收起时下段收缩为 flex-none, 只按 tab 头自身内容高度; 否则
                // 会与上段 flex-1 (upperExpandsToFill) 争抢空间, 讨论 tab 头挂在正中间。
                <div
                  className={
                    discussionCollapsed
                      ? "flex min-h-0 flex-none flex-col overflow-hidden"
                      : "flex min-h-0 flex-1 flex-col overflow-hidden"
                  }
                >
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
          <TaskQueuePanel {...taskQueue} open floatingSection="queue" />
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
          <TaskQueuePanel {...taskQueue} open floatingSection="palette" />
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
          <AIInspectorPanel {...inspector} open floating onDetach={undefined} />
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
          <DiscussionPanel {...discussionPanel} floating onDetach={undefined} />
        </FloatingPanelShell>
      )}

      {/* 桌宠开启时吃掉折叠态:折叠小条不渲染(由像素小人举牌代替),仅展开态渲染完整卡。 */}
      {floatingSelection && (!pet?.enabled || !floatingSelection.collapsed) && (
        <SelectedAnnotationCard
          {...floatingSelection}
          position={linkedFloatingSelection ?? floatingSelection.position}
          onPositionChange={
            linkedFloatingSelection
              ? linkedSelectionPositionChange
              : floatingSelection.onPositionChange
          }
          linkedToPet={Boolean(linkedFloatingSelection)}
        />
      )}
      {pet?.enabled && (
        <WorkbenchPet
          context={pet.context}
          position={petPosition}
          onPositionChange={setPetPosition}
          onExpand={pet.onExpand}
        />
      )}

      <AIPredictionPopover {...aiPopover} />
      <HotkeyCheatSheet {...hotkeys} />
      <OfflineQueueDrawer {...offlineQueue} />
      <WorkbenchSettingsDrawer {...workbenchSettings} />
      <ConflictModal {...conflict} />
      {rejectModal && <RejectReasonModal {...rejectModal} />}
      {deleteConfirm && <DeleteConfirmModal {...deleteConfirm} />}
      {guidePanel && <GuidePanel {...guidePanel} />}
    </div>
  );
}
