import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

import type { VideoTrackerJobState } from "@/hooks/useVideoTrackerJobs";

const STATUS_STYLE: Record<
  VideoTrackerJobState["status"],
  { label: string; color: string; bg: string }
> = {
  queued: { label: "排队中", color: "var(--color-fg-muted)", bg: "color-mix(in oklab, var(--color-fg-muted) 14%, var(--color-bg-elev))" },
  running: { label: "运行中", color: "var(--color-accent)", bg: "color-mix(in oklab, var(--color-accent) 14%, var(--color-bg-elev))" },
  completed: { label: "完成", color: "var(--color-success)", bg: "color-mix(in oklab, var(--color-success) 12%, var(--color-bg-elev))" },
  failed: { label: "失败", color: "var(--color-danger)", bg: "color-mix(in oklab, var(--color-danger) 12%, var(--color-bg-elev))" },
  cancelled: { label: "已取消", color: "var(--color-fg-muted)", bg: "var(--color-bg-elev)" },
};

interface VideoTrackerJobBadgeProps {
  job: VideoTrackerJobState;
  onCancel?: (jobId: string) => void;
}

export function VideoTrackerJobBadge({ job, onCancel }: VideoTrackerJobBadgeProps) {
  const style = STATUS_STYLE[job.status];
  const canCancel = onCancel && (job.status === "queued" || job.status === "running");
  const progressLabel = job.windowProgress
    ? `${job.windowProgress.current}/${job.windowProgress.total}`
    : null;

  return (
    <div
      data-testid="video-tracker-job-badge"
      title={job.errorMessage ?? `${job.modelKey} · F${job.fromFrame}-F${job.toFrame}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--color-border)",
        borderRadius: 999,
        padding: "2px 8px",
        background: style.bg,
        color: style.color,
        fontSize: 11,
        lineHeight: 1.4,
      }}
    >
      <Icon name="bot" size={12} />
      <span>{style.label}</span>
      {progressLabel && (
        <span className="mono" style={{ color: "var(--color-fg-muted)" }}>
          {progressLabel}
        </span>
      )}
      {canCancel && (
        <Button
          size="sm"
          variant="ghost"
          style={{ padding: "0 4px", minWidth: 0, height: 18, color: style.color }}
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
