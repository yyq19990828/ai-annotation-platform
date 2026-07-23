import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { useFabRevealed } from "@/stores/fabRevealStore";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { VideoMaskCorrectionDialog } from "../stage/VideoMaskCorrectionDialog";
import { MaskConversionDialog } from "../stage/MaskConversionDialog";
import { VideoTrackerReviewBar } from "../stage/VideoTrackerReviewBar";
import { useWorkbenchShellModel } from "../state/useWorkbenchShellModel";
import { IssueCreateModal } from "./IssueCreateModal";
import { WorkbenchLayout } from "./WorkbenchLayout";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";

const ISSUE_FAB_CLASS =
  "fixed right-6 z-workbench-top inline-flex size-10 cursor-pointer appearance-none items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-muted transition-all duration-300 ease-out";
// 日常隐藏态:滑出右屏外 + 淡出 + 不可点(光标进右下角指定区域时解除)。
const FAB_HIDDEN_CLASS = "translate-x-[150%] opacity-0 pointer-events-none";

export function WorkbenchShell({ mode = "annotate" }: { mode?: "annotate" | "review" }) {
  const model = useWorkbenchShellModel({ mode });
  const fabRevealed = useFabRevealed();

  if (model.kind === "loading") {
    return <WorkbenchSkeleton />;
  }

  if (model.kind === "empty") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Icon name={model.emptyState.icon} size={40} />
        <div className="text-md">{model.emptyState.message}</div>
        <Button onClick={model.emptyState.onBack}>
          <Icon name="chevLeft" size={12} />
          返回
        </Button>
      </div>
    );
  }

  return (
    <>
      <WorkbenchLayout
        {...model.layout}
        stageOverlay={
          <>
            <VideoTrackerPropagateDialog {...model.propagateDialog} />
            <VideoMaskCorrectionDialog {...model.maskCorrectionDialog} />
            <MaskConversionDialog {...model.conversionDialog} />
            <VideoTrackerReviewBar {...model.trackerReview} />
          </>
        }
      />
      {model.issueSection &&
        (() => {
          // 落点模式(armed)进行中强制保持露出,否则用户移开光标会丢失高亮指示。
          const fabShown = fabRevealed || model.issueSection.issuePinDropArmed;
          const hiddenCls = fabShown ? false : FAB_HIDDEN_CLASS;
          return (
            <>
              <button
                type="button"
                aria-label={`查看讨论面板 Issue (${model.issueSection.openIssueCount} 待处理)`}
                title={`Issue: ${model.issueSection.openIssueCount} 个待处理`}
                onClick={model.issueSection.onOpenList}
                className={cn(ISSUE_FAB_CLASS, "bottom-20", hiddenCls)}
                data-testid="issue-fab"
                data-workbench-fab
              >
                <Icon name="flag" size={14} />
                {model.issueSection.openIssueCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-[10px] bg-amber-500 px-1.5 py-px text-center text-2xs text-white">
                    {model.issueSection.openIssueCount}
                  </span>
                )}
              </button>
              {model.issueSection.stageKind === "image" && (
                <button
                  type="button"
                  aria-label={
                    model.issueSection.issuePinDropArmed
                      ? "取消像素 issue 落点模式"
                      : "进入像素 issue 落点模式"
                  }
                  title={
                    model.issueSection.issuePinDropArmed
                      ? "再次点击取消"
                      : "单击图像落点创建像素 issue"
                  }
                  onClick={model.issueSection.onToggleIssuePinDrop}
                  className={cn(
                    ISSUE_FAB_CLASS,
                    "bottom-32",
                    model.issueSection.issuePinDropArmed && "!border-amber-500 text-status-caution",
                    hiddenCls,
                  )}
                  data-testid="issue-pin-fab"
                  data-workbench-fab
                  data-armed={model.issueSection.issuePinDropArmed ? "true" : "false"}
                >
                  <Icon name="crosshair" size={14} />
                </button>
              )}
              <IssueCreateModal {...model.issueSection.createModal} />
            </>
          );
        })()}
    </>
  );
}
