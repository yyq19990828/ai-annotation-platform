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

const FIELD_CLASS =
  "appearance-none rounded-sm border border-border bg-muted px-2.5 py-1 text-xs text-foreground outline-none";
const TABLE_CLASS =
  "w-full border-collapse text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5";
const TH_CLASS =
  "select-none border-b border-border px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground";

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
    <div className="flex flex-col gap-4 px-7 py-5 text-foreground">
      <Card>
        <div className="flex items-center justify-between gap-2.5 border-b border-border px-4 py-3 text-sm font-semibold">
          <span>任务列表 ({total})</span>
          <div className="inline-flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(0);
              }}
              className={FIELD_CLASS}
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
              className={`${FIELD_CLASS} w-[200px]`}
            />
          </div>
        </div>
        <div className="flex flex-col gap-3 p-4">
          {jobsQ.isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">加载中…</div>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="overflow-x-auto">
              <table className={TABLE_CLASS}>
                <thead>
                  <tr className="bg-muted">
                    <th className={TH_CLASS}>项目</th>
                    <th className={TH_CLASS}>状态</th>
                    <th className={TH_CLASS}>模型</th>
                    <th className={TH_CLASS}>帧范围</th>
                    <th className={TH_CLASS}>方向</th>
                    <th className={TH_CLASS}>开始</th>
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
            <div className="flex items-center justify-between pt-1.5">
              <span className="text-xs text-muted-foreground">
                第 {page + 1} 页 / 共 {total} 条
              </span>
              <div className="inline-flex gap-1.5">
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
        <td>
          {job.project_name ?? "(已删除)"}
          {job.project_display_id && (
            <span className="ml-1.5 text-muted-foreground">
              ({job.project_display_id})
            </span>
          )}
        </td>
        <td>
          <StatusBadge status={job.status} />
        </td>
        <td className="text-muted-foreground">
          {modelKey ?? <span className="text-muted-foreground">—</span>}
        </td>
        <td className="tabular-nums">
          {fromFrame != null && toFrame != null ? (
            `F${fromFrame}→F${toFrame}`
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="text-muted-foreground">
          {direction ?? <span className="text-muted-foreground">—</span>}
        </td>
        <td className="text-muted-foreground">
          {formatRelative(job.started_at)}
        </td>
      </tr>
      {job.status === "failed" && job.error_message && (
        <tr>
          <td colSpan={6}>
            <div className="break-words text-xs text-status-danger">{job.error_message}</div>
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
    <div className="flex flex-col items-center gap-2 p-8 px-4 text-center text-muted-foreground">
      <Icon name="sparkles" size={28} />
      <div className="text-xs text-muted-foreground">暂无视频追踪任务</div>
      <div className="text-xs">
        去视频工作台按 Ctrl+B 发起一次追踪，任务会出现在这里。
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
