import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { videoTrackerJobsApi } from "@/api/videoTrackerJobs";
import type {
  VideoTrackerJobCounts,
  VideoTrackerJobListItem,
  VideoTrackerJobStatus,
} from "@/api/videoTrackerJobs";
import { projectsApi } from "@/api/projects";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icon";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";

const FIELD_CLASS =
  "appearance-none rounded-sm border border-border bg-muted px-2.5 py-1 text-xs text-foreground outline-none";
const TABLE_CLASS =
  "w-full border-collapse text-xs [&_td]:border-b [&_td]:border-border [&_td]:px-2.5 [&_td]:py-2";
const TH_CLASS =
  "select-none border-b border-border px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted-foreground";

type StatusFilter = "" | VideoTrackerJobStatus;

const PAGE_SIZE = 20;
const STATUS_ORDER: VideoTrackerJobStatus[] = [
  "queued",
  "running",
  "pending_review",
  "partially_reviewed",
  "accepted",
  "discarded",
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
  pending_review: "待审阅",
  partially_reviewed: "部分审阅",
  accepted: "已采纳",
  discarded: "已丢弃",
};

const FEATURED_STATUSES: VideoTrackerJobStatus[] = [
  "running",
  "pending_review",
  "accepted",
  "discarded",
];

const EMPTY_COUNTS: VideoTrackerJobCounts = {
  queued: 0,
  running: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
  pending_review: 0,
  partially_reviewed: 0,
  accepted: 0,
  discarded: 0,
};

export function VideoTrackerJobsPanel({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("");
  const [modelKey, setModelKey] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<Array<string | null>>([]);

  useEffect(() => {
    setSelectedProjectId(projectId ?? "");
    setCursor(null);
    setPreviousCursors([]);
  }, [projectId]);

  const projectsQ = useQuery({
    queryKey: ["projects", "video-tracker-job-filter"],
    queryFn: () => projectsApi.list({ data_type: ["video"] }),
    staleTime: 1000 * 60,
  });

  const jobsQ = useQuery({
    queryKey: ["video-tracker-jobs", selectedProjectId, statusFilter, modelKey, cursor],
    queryFn: () =>
      videoTrackerJobsApi.list({
        project_id: selectedProjectId || undefined,
        status: statusFilter || undefined,
        model_key: modelKey.trim() || undefined,
        cursor: cursor || undefined,
        limit: PAGE_SIZE,
      }),
    staleTime: 1000 * 30,
  });

  const items = jobsQ.data?.items ?? [];
  const counts = jobsQ.data?.counts ?? EMPTY_COUNTS;
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const nextCursor = jobsQ.data?.next_cursor ?? null;
  const resetPagination = () => {
    setCursor(null);
    setPreviousCursors([]);
  };

  return (
    <div className="flex flex-col gap-4 px-7 py-5 text-foreground">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-semibold">视频追踪任务 ({total})</div>
            <div className="mt-1 text-xs text-muted-foreground">
              追踪计算与候选审阅状态来自同一任务记录
            </div>
          </div>
          <div className="inline-flex flex-wrap items-center gap-2" aria-label="关键状态计数">
            {FEATURED_STATUSES.map((status) => (
              <Badge key={status} variant={statusVariant(status)}>
                {STATUS_LABEL[status]} {counts[status]}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="inline-flex flex-wrap gap-2">
            <select
              aria-label="筛选视频项目"
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                resetPagination();
              }}
              className={`${FIELD_CLASS} max-w-[240px]`}
            >
              <option value="">全部视频项目</option>
              {(projectsQ.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                  {project.display_id ? ` (${project.display_id})` : ""}
                </option>
              ))}
            </select>
            <select
              aria-label="筛选视频任务状态"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter);
                resetPagination();
              }}
              className={FIELD_CLASS}
            >
              <option value="">全部状态</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
            <input
              aria-label="筛选追踪模型"
              type="text"
              value={modelKey}
              onChange={(event) => {
                setModelKey(event.target.value);
                resetPagination();
              }}
              placeholder="按 model_key 精确过滤..."
              className={`${FIELD_CLASS} w-[210px]`}
            />
          </div>
          {(selectedProjectId || statusFilter || modelKey) && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setSelectedProjectId("");
                setStatusFilter("");
                setModelKey("");
                resetPagination();
              }}
            >
              清除筛选
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-3 p-4">
          {jobsQ.isLoading ? (
            <div className="p-4 text-center text-xs text-muted-foreground">加载中…</div>
          ) : jobsQ.isError ? (
            <div className="p-4 text-center text-xs text-status-danger">
              视频追踪任务加载失败，请稍后重试。
            </div>
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
                    <th className={TH_CLASS}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onOpenWorkbench={() =>
                        navigate(
                          buildWorkbenchUrl(job.project_id, {
                            taskId: job.task_id,
                            trackId: job.annotation_id,
                            frameIndex: job.from_frame,
                            returnTo: currentWorkbenchReturnTo(location),
                          }),
                        )
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(previousCursors.length > 0 || nextCursor) && (
            <div className="flex items-center justify-between pt-1.5">
              <span className="text-xs text-muted-foreground">
                第 {previousCursors.length + 1} 页 · 当前 {items.length} 条
              </span>
              <div className="inline-flex gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={previousCursors.length === 0}
                  onClick={() => {
                    setPreviousCursors((history) => {
                      const next = [...history];
                      setCursor(next.pop() ?? null);
                      return next;
                    });
                  }}
                >
                  <Icon name="chevLeft" size={11} /> 上一页
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!nextCursor}
                  onClick={() => {
                    if (!nextCursor) return;
                    setPreviousCursors((history) => [...history, cursor]);
                    setCursor(nextCursor);
                  }}
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
  onOpenWorkbench,
}: {
  job: VideoTrackerJobListItem;
  onOpenWorkbench: () => void;
}) {
  return (
    <>
      <tr>
        <td>
          {job.project_name ?? "(已删除)"}
          {job.project_display_id && (
            <span className="ml-1.5 text-muted-foreground">({job.project_display_id})</span>
          )}
        </td>
        <td>
          <StatusBadge status={job.status} />
        </td>
        <td className="text-muted-foreground">{job.model_key || "—"}</td>
        <td className="tabular-nums">
          {job.from_frame != null && job.to_frame != null
            ? `F${job.from_frame} → F${job.to_frame}`
            : "—"}
        </td>
        <td className="text-muted-foreground">{directionLabel(job.direction)}</td>
        <td className="text-muted-foreground">{formatRelative(job.started_at)}</td>
        <td>
          <Button
            size="xs"
            variant={job.status === "pending_review" ? "ai" : "ghost"}
            disabled={!job.task_id}
            onClick={onOpenWorkbench}
          >
            返回视频工作台 <Icon name="arrowRight" size={11} />
          </Button>
        </td>
      </tr>
      {job.status === "failed" && job.error_message && (
        <tr>
          <td colSpan={7}>
            <div className="break-words text-xs text-status-danger">{job.error_message}</div>
          </td>
        </tr>
      )}
    </>
  );
}

function statusVariant(status: VideoTrackerJobStatus) {
  if (status === "running") return "ai" as const;
  if (status === "pending_review" || status === "partially_reviewed") return "warning" as const;
  if (status === "accepted" || status === "completed") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "default" as const;
}

function StatusBadge({ status }: { status: VideoTrackerJobStatus }) {
  return (
    <Badge variant={statusVariant(status)} dot={status === "running"}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 p-8 px-4 text-center text-muted-foreground">
      <Icon name="sparkles" size={28} />
      <div className="text-xs text-muted-foreground">暂无视频追踪任务</div>
      <div className="text-xs">去视频工作台发起追踪，任务与候选审阅状态会出现在这里。</div>
    </div>
  );
}

function directionLabel(direction: string | null) {
  if (direction === "forward") return "向后追踪";
  if (direction === "backward") return "向前追踪";
  if (direction === "bidirectional") return "双向追踪";
  return direction || "—";
}

function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffMs = Date.now() - date.getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} 天前`;
  return date.toLocaleDateString("zh-CN");
}
