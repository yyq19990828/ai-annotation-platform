import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { useWorkbenchShellModel } from "../state/useWorkbenchShellModel";
import { IssueCreateModal } from "./IssueCreateModal";
import { WorkbenchLayout } from "./WorkbenchLayout";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";

const ISSUE_FAB_CLASS =
  "tw-scope fixed right-6 z-[90] inline-flex size-10 cursor-pointer appearance-none items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg hover:bg-muted";

export function WorkbenchShell({ mode = "annotate" }: { mode?: "annotate" | "review" }) {
  const model = useWorkbenchShellModel({ mode });

  if (model.kind === "loading") {
    return <WorkbenchSkeleton />;
  }

  if (model.kind === "empty") {
    return (
      <div className="tw-scope flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Icon name={model.emptyState.icon} size={40} />
        <div className="text-[15px]">{model.emptyState.message}</div>
        <Button onClick={model.emptyState.onBack}><Icon name="chevLeft" size={12} />返回</Button>
      </div>
    );
  }

  return (
    <>
      <WorkbenchLayout {...model.layout} />
      <VideoTrackerPropagateDialog {...model.propagateDialog} />
      {model.issueSection && (
        <>
          <button
            type="button"
            aria-label={`查看讨论面板 Issue (${model.issueSection.openIssueCount} 待处理)`}
            title={`Issue: ${model.issueSection.openIssueCount} 个待处理`}
            onClick={model.issueSection.onOpenList}
            className={`${ISSUE_FAB_CLASS} bottom-20`}
            data-testid="issue-fab"
          >
            <Icon name="flag" size={14} />
            {model.issueSection.openIssueCount > 0 && (
              <span className="absolute -right-1 -top-1 min-w-4 rounded-[10px] bg-amber-500 px-1.5 py-px text-center text-[10px] text-white">{model.issueSection.openIssueCount}</span>
            )}
          </button>
          {model.issueSection.stageKind === "image" && (
            <button
              type="button"
              aria-label={model.issueSection.issuePinDropArmed ? "取消像素 issue 落点模式" : "进入像素 issue 落点模式"}
              title={model.issueSection.issuePinDropArmed ? "再次点击取消" : "单击图像落点创建像素 issue"}
              onClick={model.issueSection.onToggleIssuePinDrop}
              className={`${ISSUE_FAB_CLASS} bottom-32${model.issueSection.issuePinDropArmed ? " !border-amber-500 text-amber-600 dark:text-amber-400" : ""}`}
              data-testid="issue-pin-fab"
              data-armed={model.issueSection.issuePinDropArmed ? "true" : "false"}
            >
              <Icon name="crosshair" size={14} />
            </button>
          )}
          <IssueCreateModal {...model.issueSection.createModal} />
        </>
      )}
    </>
  );
}
