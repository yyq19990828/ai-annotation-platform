/**
 * v0.10.45 · /ai-pre/jobs — 统一 async_jobs AI 任务历史页.
 */

import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
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
import { useToastStore } from "@/components/ui/Toast";
import styles from "./AIPreAnnotateJobsPage.module.css";

type StatusFilter = "" | AsyncJobStatus;

const JOB_TABS = ["图像", "视频"];
const PAGE_SIZE = 20;
const IMAGE_JOB_KINDS = ["batch_predict", "prediction_retry"];
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
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [searchParams] = useSearchParams();
  // v0.9.12 · ModelMarket failed tab redirect 来源支持 ?status=failed 直接落到失败筛选.
  const initialStatus = (() => {
    const s = searchParams.get("status") as AsyncJobStatus | null;
    return s && STATUS_ORDER.includes(s) ? s : "";
  })() as StatusFilter;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(initialStatus);
  const [page, setPage] = useState(0);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const offset = page * PAGE_SIZE;

  const jobsQ = useQuery({
    queryKey: [
      "async-jobs",
      "image",
      projectId,
      search,
      statusFilter,
      page,
    ],
    queryFn: () =>
      asyncJobsApi.list({
        kind: IMAGE_JOB_KINDS,
        project_id: projectId || undefined,
        search: search.trim() || undefined,
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    staleTime: 1000 * 30,
  });
  const cancelMut = useMutation({
    mutationFn: (jobId: string) => asyncJobsApi.cancel(jobId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["async-jobs"] });
    },
    onSettled: () => setCancelingId(null),
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
                  <th className={styles.tableHeaderCell}>批次 / 任务</th>
                  <th className={styles.tableHeaderCell}>Prompt / 错误</th>
                  <th className={styles.tableHeaderCell}>模型 / 模式</th>
                  <th className={styles.tableHeaderCell}>状态</th>
                  <th className={styles.tableHeaderCell}>进度</th>
                  <th className={styles.tableHeaderCell}>总数</th>
                  <th className={styles.tableHeaderCell}>失败</th>
                  <th className={styles.tableHeaderCell}>成本</th>
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
                    cancelPending={cancelingId === it.id && cancelMut.isPending}
                    onOpenDetail={(jobId) => setSelectedJobId(jobId)}
                    onCancel={(jobId) => {
                      setCancelingId(jobId);
                      cancelMut.mutate(jobId);
                    }}
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
      <JobDetailModal
        jobId={selectedJobId}
        onClose={() => setSelectedJobId(null)}
        onRetryQueued={(queued) => {
          pushToast({ kind: "success", msg: `已排队重试 ${queued} 条失败项` });
          queryClient.invalidateQueries({ queryKey: ["async-jobs"] });
          queryClient.invalidateQueries({ queryKey: ["admin", "failed-predictions"] });
        }}
      />
    </Card>
  );
}

function JobRow({
  job,
  navigate,
  returnTo,
  cancelPending,
  onOpenDetail,
  onCancel,
}: {
  job: AsyncJob;
  navigate: (path: string) => void;
  returnTo: string;
  cancelPending: boolean;
  onOpenDetail: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}) {
  const isRetry = job.kind === "prediction_retry";
  const batchId = payloadString(job.payload, "batch_id");
  const failedPredictionId = payloadString(job.payload, "failed_prediction_id");
  const taskDisplayId = payloadString(job.payload, "task_display_id");
  const batchLabel =
    isRetry
      ? taskDisplayId ?? failedPredictionId?.slice(0, 8)
      : payloadString(job.payload, "batch_display_id") ?? batchId?.slice(0, 8);
  const prompt = isRetry
    ? (payloadString(job.payload, "error_type") ??
      payloadString(job.payload, "message") ??
      "")
    : payloadString(job.payload, "prompt") ?? "";
  const promptShort = prompt.length > 50 ? prompt.slice(0, 50) + "…" : prompt;
  // 几何 backend (yolo): 展示实际模型 (如 yolov8l, 由 worker 从 model_variants 派生);
  // 文本 prompt 路径: 展示 output_mode (box/mask/both)。retry job 固定 "retry"。
  const modelLabel = payloadString(job.payload, "model_label");
  const outputMode = isRetry
    ? "retry"
    : modelLabel ?? payloadString(job.payload, "output_mode") ?? "—";
  const totalTasks = isRetry ? 1 : payloadNumber(job.payload, "total_tasks") ?? 0;
  const isTerminal = ["completed", "failed", "cancelled"].includes(job.status);
  const failedCount =
    isTerminal
      ? payloadNumber(job.result, "failed_count") ?? 0
      : null;
  const durationMs =
    isTerminal ? payloadNumber(job.result, "duration_ms") : null;
  const cost = payloadNumber(job.result, "total_cost");
  const canCancel =
    job.kind === "batch_predict" &&
    (job.status === "pending" || job.status === "running");

  return (
    <tr
      className={styles.clickableRow}
      onClick={() => onOpenDetail(job.id)}
      title="查看 job 详情"
    >
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
        title={isRetry ? failedPredictionId ?? "" : batchId ?? ""}
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
      <td className={styles.tableCell}>
        <JobProgress job={job} />
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
      <td className={`${styles.tableCell} ${styles.numeric}`}>
        {formatCost(cost)}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {formatDuration(durationMs)}
      </td>
      <td className={`${styles.tableCell} ${styles.mutedCell}`}>
        {formatRelative(job.started_at)}
      </td>
      <td className={styles.tableCell}>
        {canCancel && (
          <Button
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              onCancel(job.id);
            }}
            title="取消 job"
            disabled={cancelPending}
          >
            <Icon name="x" size={11} />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
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
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onOpenDetail(job.id);
          }}
          title="详情"
        >
          <Icon name="info" size={11} />
        </Button>
      </td>
    </tr>
  );
}

function JobProgress({ job }: { job: AsyncJob }) {
  const color =
    job.status === "failed"
      ? "var(--color-danger)"
      : job.status === "completed"
      ? "var(--color-success)"
      : job.status === "cancelled"
      ? "var(--color-fg-muted)"
      : "var(--color-ai)";
  return (
    <div className={styles.progressCell}>
      <ProgressBar value={job.progress_pct} color={color} />
      <span className={styles.progressText}>{job.progress_pct}%</span>
    </div>
  );
}

function JobDetailModal({
  jobId,
  onClose,
  onRetryQueued,
}: {
  jobId: string | null;
  onClose: () => void;
  onRetryQueued: (queued: number) => void;
}) {
  const queryClient = useQueryClient();
  const jobQ = useQuery({
    queryKey: ["async-jobs", "detail", jobId],
    queryFn: () => asyncJobsApi.get(jobId as string),
    enabled: Boolean(jobId),
    retry: false,
  });
  const retryMut = useMutation({
    mutationFn: () => asyncJobsApi.retryFailed(jobId as string),
    onSuccess: (resp) => {
      onRetryQueued(resp.queued);
      queryClient.invalidateQueries({ queryKey: ["async-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["admin", "failed-predictions"] });
    },
  });

  if (!jobId) return null;

  const job = jobQ.data;
  const failedCount = job ? payloadNumber(job.result, "failed_count") ?? 0 : 0;
  const failedPredictionIds = job
    ? payloadStringArray(job.result, "failed_prediction_ids")
    : [];
  const canRetryFailed =
    Boolean(job) &&
    job?.kind === "batch_predict" &&
    failedCount > 0 &&
    failedPredictionIds.length > 0;

  return (
    <Modal open={Boolean(jobId)} onClose={onClose} title="Job 详情" width={720}>
      {jobQ.isLoading && <div className={styles.message}>加载中…</div>}
      {jobQ.isError && <div className={styles.message}>详情加载失败</div>}
      {job && (
        <div className={styles.detail}>
          <div className={styles.detailHeader}>
            <div>
              <div className={styles.detailKind}>{job.kind}</div>
              <div className={styles.detailId}>{job.id}</div>
            </div>
            <StatusBadge status={job.status} />
          </div>

          <div className={styles.detailStats}>
            <DetailStat label="进度" value={`${job.progress_pct}%`} />
            <DetailStat label="成功" value={String(payloadNumber(job.result, "success_count") ?? "—")} />
            <DetailStat label="失败" value={String(failedCount || "—")} />
            <DetailStat label="成本" value={formatCost(payloadNumber(job.result, "total_cost"))} />
            <DetailStat label="耗时" value={formatDuration(payloadNumber(job.result, "duration_ms"))} />
          </div>

          <div className={styles.detailTimeline}>
            <span>创建：{formatDateTime(job.created_at)}</span>
            <span>开始：{formatDateTime(job.started_at)}</span>
            <span>完成：{formatDateTime(job.completed_at)}</span>
          </div>

          {job.error_message && (
            <section className={styles.detailSection}>
              <h3>错误</h3>
              <pre className={styles.errorBlock}>{job.error_message}</pre>
            </section>
          )}

          <section className={styles.detailSection}>
            <h3>Payload</h3>
            <pre className={styles.jsonBlock}>{formatJson(job.payload)}</pre>
          </section>

          <section className={styles.detailSection}>
            <h3>Result</h3>
            <pre className={styles.jsonBlock}>{formatJson(job.result)}</pre>
          </section>

          {job.kind === "batch_predict" && failedCount > 0 && (
            <div className={styles.retryPanel}>
              <div>
                <div className={styles.retryTitle}>重试失败项</div>
                <div className={styles.retryHint}>
                  {failedPredictionIds.length > 0
                    ? `${failedPredictionIds.length} 条失败项可通过失败预测重试链路重新排队。`
                    : "此 job 未记录 failed_prediction_ids，无法快捷重试旧失败项。"}
                </div>
                {retryMut.isError && (
                  <div className={styles.retryError}>重试排队失败</div>
                )}
              </div>
              <Button
                size="sm"
                variant="ai"
                disabled={!canRetryFailed || retryMut.isPending}
                onClick={() => retryMut.mutate()}
              >
                <Icon name="refresh" size={12} />
                {retryMut.isPending ? "排队中…" : "重试失败项"}
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function payloadStringArray(
  record: Record<string, unknown>,
  key: string,
): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function formatCost(value: number | null | undefined): string {
  if (value == null) return "—";
  return `$${value.toFixed(4)}`;
}

function formatJson(record: Record<string, unknown>): string {
  return JSON.stringify(record ?? {}, null, 2);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN");
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
