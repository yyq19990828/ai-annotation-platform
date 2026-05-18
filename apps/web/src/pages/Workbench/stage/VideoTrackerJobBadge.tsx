import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import styles from "./VideoTrackerJobBadge.module.css";

import type { VideoTrackerJobState } from "@/hooks/useVideoTrackerJobs";

const STATUS_STYLE: Record<
  VideoTrackerJobState["status"],
  { label: string; className: string; cancelClassName: string }
> = {
  queued: { label: "排队中", className: styles.statusQueued, cancelClassName: styles.cancelMuted },
  running: { label: "运行中", className: styles.statusRunning, cancelClassName: styles.cancelAccent },
  completed: { label: "完成", className: styles.statusCompleted, cancelClassName: styles.cancelSuccess },
  failed: { label: "失败", className: styles.statusFailed, cancelClassName: styles.cancelDanger },
  cancelled: { label: "已取消", className: styles.statusCancelled, cancelClassName: styles.cancelMuted },
};

interface VideoTrackerJobBadgeProps {
  job: VideoTrackerJobState;
  onCancel?: (jobId: string) => void;
}

export function VideoTrackerJobBadge({ job, onCancel }: VideoTrackerJobBadgeProps) {
  const statusMeta = STATUS_STYLE[job.status];
  const canCancel = onCancel && (job.status === "queued" || job.status === "running");
  const progressLabel = job.windowProgress
    ? `${job.windowProgress.current}/${job.windowProgress.total}`
    : null;

  return (
    <div
      data-testid="video-tracker-job-badge"
      title={job.errorMessage ?? `${job.modelKey} · F${job.fromFrame}-F${job.toFrame}`}
      className={[styles.badge, statusMeta.className].join(" ")}
    >
      <Icon name="bot" size={12} />
      <span>{statusMeta.label}</span>
      {progressLabel && (
        <span className={`mono ${styles.progress}`}>
          {progressLabel}
        </span>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="ghost"
          className={[styles.cancelButton, statusMeta.cancelClassName].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            onCancel(job.jobId);
          }}
          title="取消任务"
        >
          ✕
        </Button>
      )}
    </div>
  );
}
