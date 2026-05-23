import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { VideoTrackerPropagateDialog } from "../stage/VideoTrackerPropagateDialog";
import { useWorkbenchShellModel } from "../state/useWorkbenchShellModel";
import { IssueCreateModal } from "./IssueCreateModal";
import { IssueListPanel } from "./IssueListPanel";
import { WorkbenchLayout } from "./WorkbenchLayout";
import { WorkbenchSkeleton } from "./WorkbenchSkeleton";
import styles from "./WorkbenchShell.module.css";

export function WorkbenchShell({ mode = "annotate" }: { mode?: "annotate" | "review" }) {
  const model = useWorkbenchShellModel({ mode });

  if (model.kind === "loading") {
    return <WorkbenchSkeleton />;
  }

  if (model.kind === "empty") {
    return (
      <div className={styles.emptyState}>
        <Icon name={model.emptyState.icon} size={40} />
        <div className={styles.emptyStateText}>{model.emptyState.message}</div>
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
            aria-label={`查看 issue 列表 (${model.issueSection.openIssueCount} 待处理)`}
            title={`Issue: ${model.issueSection.openIssueCount} 个待处理`}
            onClick={model.issueSection.onOpenList}
            className={styles.issueFab}
            data-testid="issue-fab"
          >
            <Icon name="flag" size={14} />
            {model.issueSection.openIssueCount > 0 && (
              <span className={styles.issueFabBadge}>{model.issueSection.openIssueCount}</span>
            )}
          </button>
          {model.issueSection.stageKind === "image" && (
            <button
              type="button"
              aria-label={model.issueSection.issuePinDropArmed ? "取消像素 issue 落点模式" : "进入像素 issue 落点模式"}
              title={model.issueSection.issuePinDropArmed ? "再次点击取消" : "单击图像落点创建像素 issue"}
              onClick={model.issueSection.onToggleIssuePinDrop}
              className={`${styles.issueFab} ${styles.issuePinFab}${model.issueSection.issuePinDropArmed ? " " + styles.issuePinFabArmed : ""}`}
              data-testid="issue-pin-fab"
              data-armed={model.issueSection.issuePinDropArmed ? "true" : "false"}
            >
              <Icon name="crosshair" size={14} />
            </button>
          )}
          <IssueListPanel {...model.issueSection.listPanel} />
          <IssueCreateModal {...model.issueSection.createModal} />
        </>
      )}
    </>
  );
}
