import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ReviewClaimResponse, TaskLockConflictDetail, TaskResponse } from "@/types";
import styles from "./WorkbenchBanners.module.css";

interface WorkbenchBannersProps {
  mode: "annotate" | "review";
  task: TaskResponse | undefined;
  lockError: string | null;
  lockConflict?: TaskLockConflictDetail | null;
  claimInfo: ReviewClaimResponse | null;
  canWithdraw: boolean;
  isWithdrawing: boolean;
  isReopening: boolean;
  isAcceptingRejection: boolean;
  onWithdraw: () => void;
  onReopen: () => void;
  onAcceptRejection: () => void;
}

function lockErrorText(lockError: string, lockConflict?: TaskLockConflictDetail | null): string {
  if (lockError === "Lock expired") return "任务锁已过期，请刷新页面";
  const name = lockConflict?.locked_by?.name?.trim();
  return name ? `该任务正被 ${name} 编辑` : "该任务正被其他用户编辑";
}

export function WorkbenchBanners({
  mode,
  task,
  lockError,
  lockConflict,
  claimInfo,
  canWithdraw,
  isWithdrawing,
  isReopening,
  isAcceptingRejection,
  onWithdraw,
  onReopen,
  onAcceptRejection,
}: WorkbenchBannersProps) {
  return (
    <>
      {lockError && (
        <div
          className={`${styles.banner} ${styles.lockBanner}`}
        >
          <Icon name="warning" size={13} />
          {lockErrorText(lockError, lockConflict)}
        </div>
      )}

      {mode === "review" && claimInfo && !claimInfo.is_self && (
        <div
          className={`${styles.banner} ${styles.claimBanner}`}
        >
          <Icon name="warning" size={13} />
          已被其他审核员认领（{new Date(claimInfo.reviewer_claimed_at).toLocaleString("zh-CN")}），仍可接力处理
        </div>
      )}
      {mode === "review" && task?.skip_reason && (
        <div
          className={`${styles.banner} ${styles.skipBanner}`}
        >
          <Icon name="warning" size={13} />
          标注员跳过此题 · 可通过（无目标即视为完成）或退回重派
        </div>
      )}

      {mode === "annotate" && task?.status === "review" && (
        <div
          className={`${styles.banner} ${styles.actionBanner} ${styles.reviewBanner}`}
        >
          <Icon name="check" size={13} />
          <span className={styles.flexText}>
            已提交质检 · 等待审核
            {task.reviewer_claimed_at && <span className={styles.mutedNote}>· 审核员已介入</span>}
          </span>
          <Button
            size="sm"
            disabled={!canWithdraw || isWithdrawing}
            onClick={onWithdraw}
            title={canWithdraw ? "撤回提交，回到编辑态" : "审核员已介入，无法撤回"}
          >
            撤回提交
          </Button>
        </div>
      )}
      {mode === "annotate" && task?.status === "completed" && (
        <div
          className={`${styles.banner} ${styles.actionBanner} ${styles.completedBanner}`}
        >
          <Icon name="check" size={13} />
          <span className={styles.flexText}>
            已通过审核 · 任务已锁定
            {task.reopened_count > 0 && (
              <span className={styles.mutedNote}>· 历史重开 {task.reopened_count} 次</span>
            )}
          </span>
          <Button
            size="sm"
            disabled={isReopening}
            onClick={onReopen}
          >
            继续编辑
          </Button>
        </div>
      )}
      {mode === "annotate" && task?.status === "rejected" && (
        <div
          className={`${styles.banner} ${styles.rejectedBanner}`}
        >
          <Icon name="warning" size={13} className={styles.shrinkIcon} />
          <span className={styles.flexText}><b>审核员退回：</b>{task.reject_reason}</span>
          <Button
            size="sm"
            variant="danger"
            disabled={isAcceptingRejection}
            onClick={onAcceptRejection}
          >
            接受退回开始重做
          </Button>
        </div>
      )}
      {mode === "annotate" && task?.status === "in_progress" && task.reject_reason && (
        <div
          className={`${styles.banner} ${styles.redoBanner}`}
        >
          <Icon name="rotate-ccw" size={13} className={styles.redoIcon} />
          <span>重做中 · <b>退回原因：</b>{task.reject_reason}</span>
        </div>
      )}
    </>
  );
}
