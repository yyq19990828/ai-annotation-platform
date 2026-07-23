/**
 * v0.10.16 · Topbar 异步任务铃铛（ROADMAP §1.7）。
 *
 * 5s polling /async-jobs?limit=20，把 in-progress 进度 + 最近完成历史塞进 drawer。
 * 与 PreannotateJobsBadge 互补：那个走 Redis pub/sub 只展示预标 job 实时进度；
 * 本组件走 polling 涵盖所有 kind（包括 predictions_import / audit_archive 等没有
 * pub/sub 通道的任务），同时记录终态历史。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { asyncJobsApi, type AsyncJob, type AsyncJobStatus } from "@/api/asyncJobs";

const POLL_INTERVAL_MS = 5000;

// v0.11.17 · 浮层显示层（纯前端，不触后端 / 不调删除接口）。
const FILTER_KEY = "wb:jobsbell:filter";
const DISMISSED_KEY = "wb:jobsbell:dismissed";

type JobFilter = "all" | "active";

const TERMINAL_STATUSES: AsyncJobStatus[] = ["completed", "failed", "cancelled"];
const isTerminal = (s: AsyncJobStatus) => TERMINAL_STATUSES.includes(s);

function readFilter(): JobFilter {
  try {
    return localStorage.getItem(FILTER_KEY) === "active" ? "active" : "all";
  } catch {
    return "all";
  }
}

function persistFilter(filter: JobFilter) {
  try {
    localStorage.setItem(FILTER_KEY, filter);
  } catch {
    /* localStorage 不可用时忽略，显示退回默认 */
  }
}

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function persistDismissed(set: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set]));
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

const KIND_LABEL: Record<string, string> = {
  batch_predict: "批量预标",
  video_tracker: "视频追踪",
  video_correction: "视频 Mask 纠错",
  audit_archive: "审计分区归档",
  predictions_import: "预测导入",
  prediction_retry: "失败预测重试",
  dataset_import: "数据集导入",
  create_tasks: "建任务",
  export: "数据导出",
  mask_qc: "Mask 质检",
  mask_repair: "Mask 批量修复",
  mask_repair_rollback: "Mask 修复回滚",
  mask_format_import: "Mask 格式导入",
};

/** export job 完成时 result 的下载字段（后端 mark_complete 写入）。 */
function exportDownloadUrl(result: Record<string, unknown>): string | null {
  const url = result?.download_url;
  return typeof url === "string" && url ? url : null;
}

/** 从 payload 取一段副标题（导出 job 显示「项目 display_id · 格式」）。 */
function jobDetail(job: AsyncJob): string | null {
  const p = job.payload || {};
  const display = typeof p.project_display_id === "string" ? p.project_display_id : null;
  const fmt = typeof p.format === "string" ? p.format.toUpperCase() : null;
  const parts = [display, fmt].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const STATUS_LABEL: Record<AsyncJobStatus, string> = {
  pending: "等待中",
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

function ProgressBar({ pct, status }: { pct: number; status: AsyncJobStatus }) {
  const ref = useElementStyle<HTMLDivElement>({
    "--async-job-progress": `${pct}%`,
  } as CSSProperties);
  const fillColor =
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-rose-500"
        : status === "cancelled"
          ? "bg-muted-foreground"
          : "bg-brand";
  return (
    <div className="h-[3px] overflow-hidden rounded-[2px] bg-border">
      <div
        ref={ref}
        className={`h-full w-[var(--async-job-progress)] transition-[width] duration-200 ease-out ${fillColor}`}
      />
    </div>
  );
}

function StatusPill({ status }: { status: AsyncJobStatus }) {
  const cls =
    status === "running"
      ? "bg-brand/20 text-brand"
      : status === "completed"
        ? "bg-emerald-500/[0.18] text-status-positive"
        : status === "failed"
          ? "bg-rose-500/[0.18] text-status-danger"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={`rounded-full px-1.5 py-px text-2xs font-semibold uppercase ${cls}`}
      data-testid={`job-status-${status}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function JobRow({ job, onDismiss }: { job: AsyncJob; onDismiss?: (id: string) => void }) {
  const kindLabel = KIND_LABEL[job.kind] ?? job.kind;
  const pct = Math.max(0, Math.min(100, job.progress_pct));
  // v0.10.27 · 导出完成后的下载链接（预签名 URL，7 天内可反复点）。
  const downloadUrl =
    job.kind === "export" && job.status === "completed" ? exportDownloadUrl(job.result) : null;
  const detail = jobDetail(job);
  // v0.11.17 · 仅终态任务可单条本地 dismiss；进行中永不可隐藏。
  const canDismiss = onDismiss && isTerminal(job.status);
  return (
    <div
      className="flex w-full flex-col gap-1 rounded-sm px-2.5 py-2 text-left"
      data-testid={`job-row-${job.id}`}
    >
      <div className="flex justify-between gap-3 text-xs font-medium text-foreground">
        <span>
          {kindLabel}
          {detail && <span className="font-normal text-muted-foreground"> · {detail}</span>}
        </span>
        <div className="inline-flex flex-shrink-0 items-center gap-1">
          <StatusPill status={job.status} />
          {canDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(job.id)}
              className="inline-flex h-[18px] w-[18px] cursor-pointer appearance-none items-center justify-center rounded-sm border-0 bg-transparent text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground"
              title="从列表隐藏（不影响历史记录）"
              aria-label="隐藏此任务"
              data-testid={`job-dismiss-${job.id}`}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      </div>
      <ProgressBar pct={pct} status={job.status} />
      <div className="text-xs tabular-nums text-muted-foreground">
        {job.status === "running" || job.status === "pending"
          ? `${pct}%`
          : job.status === "failed"
            ? (job.error_message ?? "失败").slice(0, 80)
            : new Date(job.completed_at ?? job.updated_at).toLocaleString("zh-CN")}
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          download
          className="mt-0.5 inline-flex cursor-pointer items-center gap-1 self-start rounded-sm border border-border bg-muted px-2 py-1 text-xs font-semibold text-brand no-underline transition-colors duration-200 hover:border-brand hover:bg-popover"
          data-testid={`job-download-${job.id}`}
        >
          <Icon name="download" size={12} />
          下载
        </a>
      )}
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

  const [filter, setFilter] = useState<JobFilter>(readFilter);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);

  const changeFilter = (next: JobFilter) => {
    setFilter(next);
    persistFilter(next);
  };

  // 终态任务才进 dismiss 集合；进行中无 dismiss 入口，集合永不含其 id。
  const dismissOne = (id: string) => {
    setDismissed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      persistDismissed(next);
      return next;
    });
  };

  // dismiss 集合收敛：轮询窗口只回最近 20 条，已滑出窗口的 dismiss id 既不会再渲染、
  // 又会让 localStorage 无限增长，故每次窗口更新后用当前 id 集合求交集裁剪。
  // 守卫 data：loading 态 jobs 为空，若此时收敛会把整个集合误清空。
  useEffect(() => {
    if (!data) return;
    setDismissed((prev) => {
      if (prev.size === 0) return prev;
      const windowIds = new Set(jobs.map((j) => j.id));
      const next = new Set([...prev].filter((id) => windowIds.has(id)));
      if (next.size === prev.size) return prev;
      persistDismissed(next);
      return next;
    });
  }, [data, jobs]);

  // 渲染列表：先按 filter 过滤，再剔除已 dismiss 的终态项（进行中永不隐藏）。
  const visibleJobs = useMemo(() => {
    return jobs.filter((j) => {
      if (filter === "active" && isTerminal(j.status)) return false;
      if (isTerminal(j.status) && dismissed.has(j.id)) return false;
      return true;
    });
  }, [jobs, filter, dismissed]);

  const visibleTerminalIds = useMemo(
    () => visibleJobs.filter((j) => isTerminal(j.status)).map((j) => j.id),
    [visibleJobs],
  );

  const dismissAllTerminal = () => {
    if (visibleTerminalIds.length === 0) return;
    setDismissed((prev) => {
      const next = new Set(prev);
      visibleTerminalIds.forEach((id) => next.add(id));
      persistDismissed(next);
      return next;
    });
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="后台任务"
        aria-label="后台任务"
        className={`relative inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-sm border bg-transparent transition-colors duration-100 ${
          open
            ? "border-border bg-muted text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
        data-testid="jobs-bell-trigger"
      >
        <Icon name="layers" size={15} />
        {runningCount > 0 && (
          <span
            className="absolute right-0.5 top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-center text-2xs font-semibold leading-4 text-white"
            data-testid="jobs-bell-badge"
          >
            {runningCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-notification-backdrop" />
          <div
            role="dialog"
            aria-label="后台任务"
            className="absolute right-0 top-[calc(100%+6px)] z-notification flex max-h-[480px] w-[min(420px,calc(100vw-24px))] min-w-0 flex-col overflow-hidden rounded-md border border-border bg-popover shadow-lg"
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5 text-xs font-semibold text-muted-foreground">
              <span>后台任务 {runningCount > 0 ? `(${runningCount} 进行中)` : ""}</span>
            </div>
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div
                role="tablist"
                aria-label="任务筛选"
                className="inline-flex rounded-sm bg-muted p-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "all"}
                  onClick={() => changeFilter("all")}
                  className={`cursor-pointer appearance-none rounded-sm border-0 bg-transparent px-2.5 py-1 text-xs font-semibold transition-colors duration-100 ${
                    filter === "all"
                      ? "bg-popover text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="jobs-bell-filter-all"
                >
                  全部
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={filter === "active"}
                  onClick={() => changeFilter("active")}
                  className={`cursor-pointer appearance-none rounded-sm border-0 bg-transparent px-2.5 py-1 text-xs font-semibold transition-colors duration-100 ${
                    filter === "active"
                      ? "bg-popover text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid="jobs-bell-filter-active"
                >
                  进行中
                </button>
              </div>
              {visibleTerminalIds.length > 0 && (
                <button
                  type="button"
                  onClick={dismissAllTerminal}
                  className="cursor-pointer appearance-none rounded-sm border border-border bg-transparent px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors duration-100 hover:border-muted-foreground hover:bg-muted hover:text-foreground"
                  data-testid="jobs-bell-clear-terminal"
                >
                  清空已结束
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {visibleJobs.length === 0 ? (
                <div className="px-3 py-5 text-center text-xs text-muted-foreground">
                  {filter === "active" ? "暂无进行中任务" : "暂无后台任务"}
                </div>
              ) : (
                visibleJobs.map((j) => <JobRow key={j.id} job={j} onDismiss={dismissOne} />)
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
