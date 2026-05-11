import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { ReviewClaimResponse, TaskResponse } from "@/types";

interface WorkbenchBannersProps {
  mode: "annotate" | "review";
  task: TaskResponse | undefined;
  lockError: string | null;
  claimInfo: ReviewClaimResponse | null;
  canWithdraw: boolean;
  isWithdrawing: boolean;
  isReopening: boolean;
  isAcceptingRejection: boolean;
  onWithdraw: () => void;
  onReopen: () => void;
  onAcceptRejection: () => void;
}

export function WorkbenchBanners({
  mode,
  task,
  lockError,
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
          style={{
            padding: "6px 14px",
            background: "var(--color-danger-soft)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12, color: "var(--color-danger)",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Icon name="warning" size={13} />
          {lockError === "Lock expired" ? "任务锁已过期，请刷新页面" : "该任务正被其他用户编辑"}
        </div>
      )}

      {mode === "review" && claimInfo && !claimInfo.is_self && (
        <div
          style={{
            padding: "6px 14px",
            background: "oklch(0.95 0.05 70)",
            borderBottom: "1px solid oklch(0.85 0.10 70)",
            fontSize: 12, color: "oklch(0.40 0.15 70)",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Icon name="warning" size={13} />
          已被其他审核员认领（{new Date(claimInfo.reviewer_claimed_at).toLocaleString("zh-CN")}），仍可接力处理
        </div>
      )}
      {mode === "review" && task?.skip_reason && (
        <div
          style={{
            padding: "6px 14px",
            background: "oklch(0.94 0.06 300)",
            borderBottom: "1px solid oklch(0.78 0.12 300)",
            fontSize: 12, color: "oklch(0.35 0.18 300)",
            display: "flex", alignItems: "center", gap: 6,
          }}
        >
          <Icon name="warning" size={13} />
          标注员跳过此题 · 可通过（无目标即视为完成）或退回重派
        </div>
      )}

      {mode === "annotate" && task?.status === "review" && (
        <div
          style={{
            padding: "8px 14px",
            background: "var(--color-accent-soft)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12, color: "var(--color-accent-fg)",
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <Icon name="check" size={13} />
          <span style={{ flex: 1 }}>
            已提交质检 · 等待审核
            {task.reviewer_claimed_at && <span style={{ marginLeft: 8, opacity: 0.7 }}>· 审核员已介入</span>}
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
          style={{
            padding: "8px 14px",
            background: "var(--color-success-soft)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12, color: "var(--color-success)",
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <Icon name="check" size={13} />
          <span style={{ flex: 1 }}>
            已通过审核 · 任务已锁定
            {task.reopened_count > 0 && (
              <span style={{ marginLeft: 8, opacity: 0.7 }}>· 历史重开 {task.reopened_count} 次</span>
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
          style={{
            padding: "8px 14px",
            background: "var(--color-danger-soft)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12, color: "var(--color-danger)",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <Icon name="warning" size={13} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}><b>审核员退回：</b>{task.reject_reason}</span>
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
          style={{
            padding: "8px 14px",
            background: "color-mix(in oklab, var(--color-warning) 10%, transparent)",
            borderBottom: "1px solid var(--color-border)",
            fontSize: 12, color: "var(--color-fg-muted)",
            display: "flex", alignItems: "flex-start", gap: 8,
          }}
        >
          <Icon name="rotate-ccw" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>重做中 · <b>退回原因：</b>{task.reject_reason}</span>
        </div>
      )}
    </>
  );
}
