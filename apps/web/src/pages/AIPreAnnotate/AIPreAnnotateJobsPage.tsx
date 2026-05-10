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

import {
  PAGE_PADDING_X,
  PAGE_PADDING_Y,
  cardBodyStyle,
  cardHeaderStyle,
  helperTextStyle,
  tableHeaderCellStyle,
  tableBodyCellStyle,
  FS_XS,
  FS_SM,
  FS_XL,
} from "./styles";

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
    <div
      style={{
        padding: `${PAGE_PADDING_Y}px ${PAGE_PADDING_X}px`,
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ margin: 0, fontSize: FS_XL, fontWeight: 600 }}>
          完整预标历史
        </h1>
        <span style={{ fontSize: FS_SM, color: "var(--color-fg-muted)" }}>
          覆盖 prediction_jobs 全量 (含已结束 / 已重置批次 / 失败 job).
          仅 pre_annotated 当前批次可在「执行预标」页快速接管。
        </span>
      </div>

      <Card>
        <div style={cardHeaderStyle}>
          <span>历史 job ({items.length})</span>
          <div style={{ display: "inline-flex", gap: 8 }}>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setCursorStack([]);
              }}
              style={{
                padding: "4px 8px",
                fontSize: FS_XS,
                background: "var(--color-bg-sunken)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-fg)",
                outline: "none",
              }}
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
              style={{
                padding: "4px 10px",
                fontSize: FS_XS,
                background: "var(--color-bg-sunken)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--color-fg)",
                outline: "none",
                width: 200,
              }}
            />
          </div>
        </div>
        <div style={cardBodyStyle}>
          {jobsQ.isLoading ? (
            <div style={{ ...helperTextStyle, padding: 16, textAlign: "center" }}>
              加载中…
            </div>
          ) : items.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{ width: "100%", fontSize: FS_SM, borderCollapse: "collapse" }}
              >
                <thead>
                  <tr style={{ background: "var(--color-bg-sunken)" }}>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>项目</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>批次</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>Prompt</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>模式</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>状态</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>总数</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>失败</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>跑时长</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>开始</th>
                    <th style={{ ...tableHeaderCellStyle, cursor: "default" }}>操作</th>
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                paddingTop: 6,
              }}
            >
              <span style={{ ...helperTextStyle, marginTop: 0 }}>
                第 {cursorStack.length + 1} 页
              </span>
              <div style={{ display: "inline-flex", gap: 6 }}>
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
      <td style={tableBodyCellStyle}>
        {job.project_name ?? "(已删除)"}
        {job.project_display_id && (
          <span style={{ marginLeft: 6, color: "var(--color-fg-subtle)" }}>
            ({job.project_display_id})
          </span>
        )}
      </td>
      <td
        style={{
          ...tableBodyCellStyle,
          color: "var(--color-fg-muted)",
          fontFamily: "var(--font-mono, ui-monospace)",
          fontSize: FS_XS,
        }}
        title={job.batch_id ?? ""}
      >
        {job.batch_id ? job.batch_id.slice(0, 8) : "—"}
      </td>
      <td
        style={tableBodyCellStyle}
        title={job.prompt || "(无文本 prompt — image-only batch)"}
      >
        {job.prompt ? promptShort : (
          <span style={{ color: "var(--color-fg-subtle)" }}>—</span>
        )}
      </td>
      <td style={{ ...tableBodyCellStyle, color: "var(--color-fg-muted)" }}>
        {job.output_mode}
      </td>
      <td style={tableBodyCellStyle}>
        <StatusBadge status={job.status} />
      </td>
      <td style={{ ...tableBodyCellStyle, fontVariantNumeric: "tabular-nums" }}>
        {job.total_tasks}
      </td>
      <td style={tableBodyCellStyle}>
        {job.failed_count > 0 ? (
          <Badge variant="danger">{job.failed_count}</Badge>
        ) : (
          <span style={{ color: "var(--color-fg-subtle)" }}>0</span>
        )}
      </td>
      <td style={{ ...tableBodyCellStyle, color: "var(--color-fg-muted)" }}>
        {formatDuration(job.duration_ms)}
      </td>
      <td style={{ ...tableBodyCellStyle, color: "var(--color-fg-muted)" }}>
        {formatRelative(job.started_at)}
      </td>
      <td style={tableBodyCellStyle}>
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
    <div
      style={{
        padding: "32px 16px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        color: "var(--color-fg-subtle)",
      }}
    >
      <Icon name="sparkles" size={28} />
      <div style={{ fontSize: FS_SM, color: "var(--color-fg-muted)" }}>
        暂无 prediction job 历史
      </div>
      <div style={{ fontSize: FS_XS }}>
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
