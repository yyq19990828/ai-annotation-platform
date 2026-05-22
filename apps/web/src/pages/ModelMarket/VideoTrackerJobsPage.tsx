/**
 * v0.10.36 · /model-market/video-jobs — 视频追踪任务聚合监控页.
 *
 * 拉 /video-tracker-jobs (video_tracker_jobs 全量), 含 queued/running/completed/failed/cancelled.
 * 形态参照 AIPreAnnotateJobsPage: cursor 分页 + 状态过滤 + Card 表格.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import {
  videoTrackerJobsApi,
  type VideoTrackerJobListItem,
  type VideoTrackerJobStatus,
} from "@/api/videoTrackerJobs";
import styles from "./VideoTrackerJobsPage.module.css";

type StatusFilter = "" | VideoTrackerJobStatus;

const STATUS_ORDER: VideoTrackerJobStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];

const STATUS_LABEL: Record<VideoTrackerJobStatus, string> = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export default function VideoTrackerJobsPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [modelKey, setModelKey] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? undefined;

  const jobsQ = useQuery({
    queryKey: ["video-tracker-jobs", statusFilter, modelKey, currentCursor],
    queryFn: () =>
      videoTrackerJobsApi.list({
        status: statusFilter || undefined,
        model_key: modelKey.trim() || undefined,
        cursor: currentCursor,
        limit: 20,
      }),
    staleTime: 1000 * 30,
  });

  const items = jobsQ.data?.items ?? [];
  const nextCursor = jobsQ.data?.next_cursor;
  const counts = jobsQ.data?.counts;

  return (
    <div className={styles.page}>
      <div className={styles.pageIntro}>
        <h1 className={styles.pageTitle}>视频追踪任务</h1>
        <span className={styles.pageSubtitle}>
          覆盖 video_tracker_jobs 全量 (排队 / 运行 / 完成 / 失败 / 取消)。
          在视频工作台按 Shift+T 可发起新的追踪任务。
        </span>
      </div>

      <div className={styles.countCards}>
        {STATUS_ORDER.map((s) => (
          <Card key={s}>
            <div className={styles.countCard}>
              <CountBadge status={s} />
              <span className={styles.countValue}>{counts?.[s] ?? 0}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <div className={styles.cardHeader}>
          <span>任务列表 ({items.length})</span>
          <div className={styles.filterGroup}>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setCursorStack([]);
              }}
              className={styles.selectControl}
            >
              <option value="">全部状态</option>
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={modelKey}
              onChange={(e) => {
                setModelKey(e.target.value);
                setCursorStack([]);
              }}
              placeholder="按 model_key 过滤..."
              className={styles.searchInput}
            />
          </div>
        </div>
        <div className={styles.cardBody}>
          {jobsQ.isLoading ? (
            <div className={styles.message}>加载中…</div>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr className={styles.headerRow}>
                    <th className={styles.tableHeaderCell}>项目</th>
                    <th className={styles.tableHeaderCell}>状态</th>
                    <th className={styles.tableHeaderCell}>模型</th>
                    <th className={styles.tableHeaderCell}>帧范围</th>
                    <th className={styles.tableHeaderCell}>方向</th>
                    <th className={styles.tableHeaderCell}>开始</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <JobRow key={it.id} job={it} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(cursorStack.length > 0 || nextCursor) && (
            <div className={styles.pagination}>
              <span className={styles.helperInline}>
                第 {cursorStack.length + 1} 页
              </span>
              <div className={styles.inlineActions}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cursorStack.length === 0}
                  onClick={() => setCursorStack((s) => s.slice(0, -1))}
                >
                  <Icon name="chevLeft" size={11} /> 上一页
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!nextCursor}
                  onClick={() =>
                    nextCursor && setCursorStack((s) => [...s, nextCursor])
                  }
                >
                  下一页 <Icon name="chevRight" size={11} />
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function JobRow({ job }: { job: VideoTrackerJobListItem }) {
  return (
    <>
      <tr>
        <td className={styles.tableCell}>
          {job.project_name ?? "(已删除)"}
          {job.project_display_id && (
            <span className={styles.projectDisplayId}>
              ({job.project_display_id})
            </span>
          )}
        </td>
        <td className={styles.tableCell}>
          <StatusBadge status={job.status} />
        </td>
        <td className={`${styles.tableCell} ${styles.mutedCell}`}>
          {job.model_key ?? <span className={styles.subtle}>—</span>}
        </td>
        <td className={`${styles.tableCell} ${styles.numeric}`}>
          {job.from_frame != null && job.to_frame != null ? (
            `F${job.from_frame}→F${job.to_frame}`
          ) : (
            <span className={styles.subtle}>—</span>
          )}
        </td>
        <td className={`${styles.tableCell} ${styles.mutedCell}`}>
          {job.direction ?? <span className={styles.subtle}>—</span>}
        </td>
        <td className={`${styles.tableCell} ${styles.mutedCell}`}>
          {formatRelative(job.started_at)}
        </td>
      </tr>
      {job.status === "failed" && job.error_message && (
        <tr>
          <td className={styles.tableCell} colSpan={6}>
            <div className={styles.errorMessage}>{job.error_message}</div>
          </td>
        </tr>
      )}
    </>
  );
}

function statusVariant(status: VideoTrackerJobStatus) {
  if (status === "running") return "ai" as const;
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "default" as const; // queued / cancelled
}

function StatusBadge({ status }: { status: VideoTrackerJobStatus }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABEL[status]}</Badge>;
}

function CountBadge({ status }: { status: VideoTrackerJobStatus }) {
  return (
    <span className={styles.countLabel}>
      <Badge variant={statusVariant(status)}>{STATUS_LABEL[status]}</Badge>
    </span>
  );
}

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <Icon name="sparkles" size={28} />
      <div className={styles.emptyTitle}>暂无视频追踪任务</div>
      <div className={styles.emptyHint}>
        去视频工作台按 Shift+T 发起一次追踪，任务会出现在这里。
      </div>
    </div>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return d.toLocaleDateString("zh-CN");
}
