/**
 * v0.10.45 · /ai-pre/jobs — 统一 async_jobs AI 任务历史页.
 */

import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { TabRow } from "@/components/ui/TabRow";
import {
  asyncJobsApi,
  type AsyncJob,
  type AsyncJobStatus,
} from "@/api/asyncJobs";
import { VideoTrackerJobsPanel } from "@/pages/ModelMarket/VideoTrackerJobsPage";
import {
  buildWorkbenchUrl,
  currentWorkbenchReturnTo,
} from "@/utils/workbenchNavigation";
import styles from "./AIPreAnnotateJobsPage.module.css";

type StatusFilter = "" | AsyncJobStatus;

const JOB_TABS = ["图像", "视频"];
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

/**
 * v0.10.38 · /ai-pre/jobs 统一 AI 任务历史 (epic 阶段 3): 「图像」 /
 * 「视频」两个模态 tab。tab 用 ?tab 同步,
 * 供 ProjectDetailPanel 视频引导卡片深链 (?tab=video&project_id=)。
 */
export default function AIPreAnnotateJobsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "video" ? "video" : "image";
  const projectId = searchParams.get("project_id") ?? undefined;
  const setTab = (next: "image" | "video") => {
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      n.set("tab", next);
      return n;
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageIntro}>
        <h1 className={styles.pageTitle}>AI 任务历史</h1>
        <span className={styles.pageSubtitle}>
          图像批量预标 + 视频追踪，一处看全模态后台任务。
        </span>
      </div>
      <TabRow
        tabs={JOB_TABS}
        active={tab === "video" ? "视频" : "图像"}
        onChange={(label) => setTab(label === "视频" ? "video" : "image")}
      />
      {tab === "video" ? (
        <VideoTrackerJobsPanel projectId={projectId} />
      ) : (
        <ImageJobsPanel projectId={projectId} />
      )}
    </div>
  );
}

function ImageJobsPanel({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // v0.9.12 · ModelMarket failed tab redirect 来源支持 ?status=failed 直接落到失败筛选.
  const initialStatus = (() => {
    const s = searchParams.get("status") as AsyncJobStatus | null;
    return s && STATUS_ORDER.includes(s) ? s : "";
  })() as StatusFilter;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [page, setPage] = useState(0);
  const offset = page * PAGE_SIZE;

  const jobsQ = useQuery({
    queryKey: [
      "async-jobs",
      "batch_predict",
      projectId,
      search,
      statusFilter,
      page,
    ],
    queryFn: () =>
      asyncJobsApi.list({
        kind: "batch_predict",
        project_id: projectId || undefined,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    staleTime: 1000 * 30,
  });

  const items = jobsQ.data?.items ?? [];
  const total = jobsQ.data?.total ?? 0;
  const hasNext = offset + PAGE_SIZE < total;

  return (
    <Card>
      <div className={styles.cardHeader}>
        <span>历史 job ({total})</span>
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
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
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
  );
}

function JobRow({
  job,
  navigate,
  returnTo,
}: {
  job: AsyncJob;
  navigate: (path: string) => void;
  returnTo: string;
}) {
  const batchId = payloadString(job.payload, "batch_id");
  const batchLabel =
    payloadString(job.payload, "batch_display_id") ?? batchId?.slice(0, 8);
  const prompt = payloadString(job.payload, "prompt") ?? "";
  const promptShort = prompt.length > 50 ? prompt.slice(0, 50) + "…" : prompt;
  const outputMode = payloadString(job.payload, "output_mode") ?? "—";
  const totalTasks = payloadNumber(job.payload, "total_tasks") ?? 0;
  const failedCount =
    job.status === "completed"
      ? payloadNumber(job.result, "failed_count") ?? 0
      : null;
  const durationMs =
    job.status === "completed" ? payloadNumber(job.result, "duration_ms") : null;

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
        title={batchId ?? ""}
      >
        {batchLabel ?? "—"}
      </td>
      <td
        className={styles.tableCell}
        title={prompt || "(无文本 prompt — image-only batch)"}
      >
        {prompt ? promptShort : (
          <span className={styles.subtle}>—</span>
        )}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {outputMode}
      </td>
      <td className={styles.tableCell}>
        <StatusBadge status={job.status} />
      </td>
      <td className={`${styles.tableCell} ${styles.numeric}`}>
        {totalTasks}
      </td>
      <td className={styles.tableCell}>
        {failedCount == null ? (
          <span className={styles.subtle}>—</span>
        ) : failedCount > 0 ? (
          <Badge variant="danger">{failedCount}</Badge>
        ) : (
          <span className={styles.subtle}>0</span>
        )}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {formatDuration(durationMs)}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {formatRelative(job.started_at)}
      </td>
      <td className={styles.tableCell}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!job.project_id) return;
            navigate(buildWorkbenchUrl(job.project_id, {
              batchId,
              returnTo,
            }));
          }}
          title="去工作台"
          disabled={!job.project_id || !batchId}
        >
          <Icon name="chevRight" size={11} />
        </Button>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: AsyncJobStatus }) {
  if (status === "pending") return <Badge variant="ai">排队中</Badge>;
  if (status === "running") return <Badge variant="ai">运行中</Badge>;
  if (status === "completed") return <Badge variant="success">已完成</Badge>;
  if (status === "failed") return <Badge variant="danger">失败</Badge>;
  return <Badge variant="default">已取消</Badge>;
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
