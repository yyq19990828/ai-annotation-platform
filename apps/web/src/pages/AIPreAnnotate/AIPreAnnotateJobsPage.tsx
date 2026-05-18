/**
 * v0.9.8 · /ai-pre/jobs — 完整 prediction job 历史页.
 *
 * 与 /ai-pre 主页 HistoryTable (仅列 pre_annotated 批次) 拆开:
 * 本页面拉 /admin/preannotate-jobs (prediction_jobs 全量), 含已结束/重置/失败 job.
 */

import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import {
  adminPreannotateJobsApi,
  type PredictionJobOut,
} from "@/api/adminPreannotateJobs";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import styles from "./AIPreAnnotateJobsPage.module.css";

type StatusFilter = "" | "running" | "completed" | "failed";

export default function AIPreAnnotateJobsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // v0.9.12 · ModelMarket failed tab redirect 来源支持 ?status=failed 直接落到失败筛选.
  const initialStatus = (() => {
    const s = searchParams.get("status");
    return s === "running" || s === "completed" || s === "failed" ? s : "";
  })() as StatusFilter;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const currentCursor = cursorStack[cursorStack.length - 1] ?? undefined;

  const jobsQ = useQuery({
    queryKey: ["admin", "preannotate-jobs", search, statusFilter, currentCursor],
    queryFn: () =>
      adminPreannotateJobsApi.list({
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        cursor: currentCursor,
        limit: 20,
      }),
    staleTime: 1000 * 30,
  });

  const items = jobsQ.data?.items ?? [];
  const nextCursor = jobsQ.data?.next_cursor;

  return (
    <div className={styles.page}>
      <div className={styles.pageIntro}>
        <h1 className={styles.pageTitle}>完整预标历史</h1>
        <span className={styles.pageSubtitle}>
          覆盖 prediction_jobs 全量 (含已结束 / 已重置批次 / 失败 job).
          仅 pre_annotated 当前批次可在「执行预标」页快速接管。
        </span>
      </div>

      <Card>
        <div className={styles.cardHeader}>
          <span>历史 job ({items.length})</span>
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
              <option value="running">运行中</option>
              <option value="completed">已完成</option>
              <option value="failed">失败</option>
            </select>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursorStack([]);
              }}
              placeholder="搜索 prompt..."
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
                    <th className={styles.tableHeaderCell}>批次</th>
                    <th className={styles.tableHeaderCell}>Prompt</th>
                    <th className={styles.tableHeaderCell}>模式</th>
                    <th className={styles.tableHeaderCell}>状态</th>
                    <th className={styles.tableHeaderCell}>总数</th>
                    <th className={styles.tableHeaderCell}>失败</th>
                    <th className={styles.tableHeaderCell}>跑时长</th>
                    <th className={styles.tableHeaderCell}>开始</th>
                    <th className={styles.tableHeaderCell}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <JobRow
                      key={it.id}
                      job={it}
                      navigate={navigate}
                      returnTo={currentWorkbenchReturnTo(location)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(cursorStack.length > 0 || nextCursor) && (
            <div className={styles.pagination}>
              <span className={styles.helperInline}>第 {cursorStack.length + 1} 页</span>
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

function JobRow({
  job,
  navigate,
  returnTo,
}: {
  job: PredictionJobOut;
  navigate: (path: string) => void;
  returnTo: string;
}) {
  const promptShort =
    job.prompt.length > 50 ? job.prompt.slice(0, 50) + "…" : job.prompt;

  return (
    <tr>
      <td className={styles.tableCell}>
        {job.project_name ?? "(已删除)"}
        {job.project_display_id && (
          <span className={styles.projectDisplayId}>
            ({job.project_display_id})
          </span>
        )}
      </td>
      <td
        className={`${styles.tableCell} ${styles.batchCell}`}
        title={job.batch_id ?? ""}
      >
        {job.batch_id ? job.batch_id.slice(0, 8) : "—"}
      </td>
      <td
        className={styles.tableCell}
        title={job.prompt || "(无文本 prompt — image-only batch)"}
      >
        {job.prompt ? promptShort : (
          <span className={styles.subtle}>—</span>
        )}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {job.output_mode}
      </td>
      <td className={styles.tableCell}>
        <StatusBadge status={job.status} />
      </td>
      <td className={`${styles.tableCell} ${styles.numeric}`}>
        {job.total_tasks}
      </td>
      <td className={styles.tableCell}>
        {job.failed_count > 0 ? (
          <Badge variant="danger">{job.failed_count}</Badge>
        ) : (
          <span className={styles.subtle}>0</span>
        )}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {formatDuration(job.duration_ms)}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {formatRelative(job.started_at)}
      </td>
      <td className={styles.tableCell}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            navigate(buildWorkbenchUrl(job.project_id, {
              batchId: job.batch_id,
              returnTo,
            }))
          }
          title="去工作台"
          disabled={!job.batch_id}
        >
          <Icon name="chevRight" size={11} />
        </Button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: PredictionJobOut["status"] }) {
  if (status === "running") return <Badge variant="ai">运行中</Badge>;
  if (status === "completed") return <Badge variant="success">已完成</Badge>;
  return <Badge variant="danger">失败</Badge>;
}

function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <Icon name="sparkles" size={28} />
      <div className={styles.emptyTitle}>
        暂无 prediction job 历史
      </div>
      <div className={styles.emptyHint}>
        在「执行预标」页跑一次预标，结果会出现在这里。
      </div>
    </div>
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}m`;
  const hr = min / 60;
  return `${hr.toFixed(1)}h`;
}

function formatRelative(iso: string): string {
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
