/**
 * v0.10.16 · Topbar 异步任务铃铛（ROADMAP §1.7）。
 *
 * 5s polling /async-jobs?limit=20，把 in-progress 进度 + 最近完成历史塞进 drawer。
 * 与 PreannotateJobsBadge 互补：那个走 Redis pub/sub 只展示预标 job 实时进度；
 * 本组件走 polling 涵盖所有 kind（包括 predictions_import / audit_archive 等没有
 * pub/sub 通道的任务），同时记录终态历史。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { asyncJobsApi, type AsyncJob, type AsyncJobStatus } from "@/api/asyncJobs";
import styles from "./JobsBell.module.css";

const POLL_INTERVAL_MS = 5000;

const KIND_LABEL: Record<string, string> = {
  batch_predict: "批量预标",
  video_tracker: "视频追踪",
  audit_archive: "审计分区归档",
  predictions_import: "预测导入",
};

const STATUS_LABEL: Record<AsyncJobStatus, string> = {
  pending: "等待中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function ProgressBar({ pct, status }: { pct: number; status: AsyncJobStatus }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.style.setProperty("--async-job-progress", `${pct}%`);
  }, [pct]);
  const fillClass =
    status === "completed"
      ? styles.progressFillCompleted
      : status === "failed"
        ? styles.progressFillFailed
        : status === "cancelled"
          ? styles.progressFillCancelled
          : styles.progressFill;
  return (
    <div className={styles.progressTrack}>
      <div ref={ref} className={`${styles.progressFill} ${fillClass}`} />
    </div>
  );
}

function StatusPill({ status }: { status: AsyncJobStatus }) {
  const cls =
    status === "running"
      ? styles.statusRunning
      : status === "completed"
        ? styles.statusCompleted
        : status === "failed"
          ? styles.statusFailed
          : status === "cancelled"
            ? styles.statusCancelled
            : styles.statusPending;
  return (
    <span className={`${styles.statusPill} ${cls}`} data-testid={`job-status-${status}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function JobRow({ job }: { job: AsyncJob }) {
  const kindLabel = KIND_LABEL[job.kind] ?? job.kind;
  const pct = Math.max(0, Math.min(100, job.progress_pct));
  return (
    <div className={styles.jobRow} data-testid={`job-row-${job.id}`}>
      <div className={styles.jobHeader}>
        <span>{kindLabel}</span>
        <StatusPill status={job.status} />
      </div>
      <ProgressBar pct={pct} status={job.status} />
      <div className={styles.jobMeta}>
        {job.status === "running" || job.status === "pending"
          ? `${pct}%`
          : job.status === "failed"
            ? (job.error_message ?? "失败").slice(0, 80)
            : new Date(job.completed_at ?? job.updated_at).toLocaleString("zh-CN")}
      </div>
    </div>
  );
}

export function JobsBell() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const { data } = useQuery({
    queryKey: ["async-jobs", "recent"],
    queryFn: () => asyncJobsApi.list({ limit: 20 }),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const jobs = useMemo(() => data?.items ?? [], [data]);
  const runningCount = useMemo(
    () => jobs.filter((j) => j.status === "running" || j.status === "pending").length,
    [jobs],
  );

  return (
    <div className={styles.root}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="后台任务"
        aria-label="后台任务"
        className={`${styles.trigger} ${open ? styles.triggerActive : ""}`}
        data-testid="jobs-bell-trigger"
      >
        <Icon name="layers" size={15} />
        {runningCount > 0 && (
          <span className={styles.badge} data-testid="jobs-bell-badge">
            {runningCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} className={styles.backdrop} />
          <div role="dialog" aria-label="后台任务" className={styles.panel}>
            <div className={styles.panelTitle}>
              <span>后台任务 {runningCount > 0 ? `(${runningCount} 进行中)` : ""}</span>
            </div>
            <div className={styles.list}>
              {jobs.length === 0 ? (
                <div className={styles.empty}>暂无后台任务</div>
              ) : (
                jobs.map((j) => <JobRow key={j.id} job={j} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
