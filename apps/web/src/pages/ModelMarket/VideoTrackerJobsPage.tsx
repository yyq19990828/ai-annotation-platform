/**
 * v0.10.36 · 视频追踪任务聚合监控.
 *
 * v0.10.45 起拉 /async-jobs?kind=video_tracker.
 * 形态参照 AIPreAnnotateJobsPage: offset 分页 + 状态过滤 + Card 表格.
 *
 * v0.10.38 · 由独立页 (原 /model-market/video-jobs) 改为可复用 Panel, 挂到 /ai-pre/jobs 的
 * 「视频」模态 tab (epic 阶段 3); 支持 projectId 过滤供引导卡片深链。
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import {
  asyncJobsApi,
  type AsyncJob,
  type AsyncJobStatus,
} from "@/api/asyncJobs";
import styles from "./VideoTrackerJobsPage.module.css";

type StatusFilter = "" | AsyncJobStatus;

const PAGE_SIZE = 20;
const STATUS_ORDER: AsyncJobStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
];

const STATUS_LABEL: Record<AsyncJobStatus, string> = {
  pending: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

export function VideoTrackerJobsPanel({ projectId }: { projectId?: string }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [modelKey, setModelKey] = useState("");
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const jobsQ = useQuery({
    queryKey: [
      "async-jobs",
      "video_tracker",
      projectId,
      statusFilter,
      modelKey,
      page,
    ],
    queryFn: () =>
      asyncJobsApi.list({
        kind: "video_tracker",
        project_id: projectId || undefined,
        status: statusFilter || undefined,
        search: modelKey.trim() || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    staleTime: 1000 * 30,
  });

  const items = jobsQ.data?.items ?? [];
  const total = jobsQ.data?.total ?? 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <div className={styles.page}>
      <Card>
        <div className={styles.cardHeader}>
          <span>任务列表 ({total})</span>
          <div className={styles.filterGroup}>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(0);
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
                setPage(0);
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

          {(page > 0 || hasNext) && (
            <div className={styles.pagination}>
              <span className={styles.helperInline}>
                第 {page + 1} 页 / 共 {total} 条
              </span>
              <div className={styles.inlineActions}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  <Icon name="chevLeft" size={11} /> 上一页
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!hasNext}
                  onClick={() => setPage((p) => p + 1)}
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

function JobRow({ job }: { job: AsyncJob }) {
  const modelKey = payloadString(job.payload, "model_key");
  const direction = payloadString(job.payload, "direction");
  const fromFrame = payloadNumber(job.payload, "from_frame");
  const toFrame = payloadNumber(job.payload, "to_frame");

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
          {modelKey ?? <span className={styles.subtle}>—</span>}
        </td>
        <td className={`${styles.tableCell} ${styles.numeric}`}>
          {fromFrame != null && toFrame != null ? (
            `F${fromFrame}→F${toFrame}`
          ) : (
            <span className={styles.subtle}>—</span>
          )}
        </td>
        <td className={`${styles.tableCell} ${styles.mutedCell}`}>
          {direction ?? <span className={styles.subtle}>—</span>}
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

function statusVariant(status: AsyncJobStatus) {
  if (status === "pending" || status === "running") return "ai" as const;
  if (status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "default" as const; // cancelled
}

function StatusBadge({ status }: { status: AsyncJobStatus }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABEL[status]}</Badge>;
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

function payloadString(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  if (typeof value === "string" && value) return value;
  return null;
}

function payloadNumber(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
