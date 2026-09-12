/**
 * v0.11.4 · DiscussionPanel issues tab。
 *
 * 列出 kind=issue 的 feedback (含 pixel 锚点)，按 status 过滤；
 * 单击列表项 → useActiveIssueStore.focusIssue → model 把视口平移到对应图钉并高亮。
 * 反向 (图钉单击) 写 store.highlightId，本列表对应行加亮 + 滚动可见。
 *
 * status 配色 / 卡片样式:status open=琥珀 / resolved=翠绿 / wont_fix=中性;severity info=天蓝 / warn=琥珀 / blocker=玫红。
 */
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useInfiniteFeedbacks, usePatchFeedback, useDeleteFeedback } from "@/hooks/useFeedbacks";
import {
  hasPixelAnchor,
  type FeedbackSeverity,
  type FeedbackStatus,
  type ListFeedbacksParams,
} from "@/api/feedbacks";
import { useActiveIssueStore } from "../state/useActiveIssueStore";
import { readVideoIssueContext } from "../state/videoIssueContext";

interface Props {
  projectId: string;
  taskId: string;
  onCreateTaskIssue?: () => void;
  allowProjectScope?: boolean;
}

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

const STATUS_FILTERS: { key: FeedbackStatus | "all"; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "open", label: "未解决" },
  { key: "resolved", label: "已解决" },
  { key: "wont_fix", label: "搁置" },
];

// 卡片整体减淡(已解决 / 搁置)。
const STATUS_CARD_DIM: Record<FeedbackStatus, string> = {
  open: "",
  resolved: "opacity-60",
  wont_fix: "opacity-55",
};

// status chip:柔底 + 同色描边/文字。
const STATUS_CHIP: Record<FeedbackStatus, string> = {
  open: "border-amber-500/60 bg-status-caution-soft text-status-caution",
  resolved: "border-emerald-500/60 bg-status-positive-soft text-status-positive",
  wont_fix: "border-border bg-muted text-muted-foreground",
};

// severity chip:仅文字着色(沿用原设计,描边走默认 border)。
const SEVERITY_CHIP: Record<FeedbackSeverity, string> = {
  info: "text-status-info-alt",
  warn: "text-status-caution",
  blocker: "text-status-danger",
};

export function DiscussionIssuesTab({
  projectId,
  taskId,
  onCreateTaskIssue,
  allowProjectScope = false,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("all");
  const [scope, setScope] = useState<"task" | "project">("task");
  const params: ListFeedbacksParams = useMemo(
    () => ({
      project_id: projectId,
      task_id: !allowProjectScope || scope === "task" ? taskId : undefined,
      kind: "issue",
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [projectId, taskId, scope, allowProjectScope, statusFilter],
  );
  const { data, isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteFeedbacks(params);
  const patchMut = usePatchFeedback(params);
  const deleteMut = useDeleteFeedback(params);
  const highlightId = useActiveIssueStore((s) => s.highlightId);
  const focusIssue = useActiveIssueStore((s) => s.focusIssue);

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  // The API applies status before cursor pagination. Keep the local guard for
  // older servers during the rollout without treating loaded rows as totals.
  const filtered = statusFilter === "all" ? items : items.filter((i) => i.status === statusFilter);

  const setStatus = (id: string, next: FeedbackStatus) => {
    patchMut.mutate({ id, payload: { status: next } });
  };

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
      <div className="flex flex-wrap gap-1">
        {allowProjectScope && (
          <select
            aria-label="问题列表范围"
            data-testid="issue-list-scope"
            value={scope}
            onChange={(event) => setScope(event.target.value as "task" | "project")}
            className="rounded border border-border bg-muted px-1 py-0.5 text-xs text-foreground"
          >
            <option value="task">当前任务</option>
            <option value="project">整个项目</option>
          </select>
        )}
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStatusFilter(f.key)}
            className={cn(
              "cursor-pointer appearance-none rounded-[10px] border border-border bg-transparent px-2 py-0.5 text-2xs text-muted-foreground [font:inherit]",
              statusFilter === f.key && "border-brand text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
        {onCreateTaskIssue && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCreateTaskIssue}
            data-testid="issue-create-task"
            data-workbench-issue-navigation
          >
            <Icon name="plus" size={12} /> 记录任务级问题
          </Button>
        )}
        <span
          className="ml-auto self-center text-2xs text-muted-foreground"
          aria-label={`${scope === "task" ? "当前任务" : "整个项目"}已加载问题数量`}
        >
          {scope === "task" ? "当前任务" : "整个项目"} · 已加载 {filtered.length}
        </span>
      </div>

      {isLoading && <div className="px-1 py-2 text-xs text-muted-foreground">加载中…</div>}
      {isError && <div className="px-1 py-2 text-xs text-status-danger">加载失败</div>}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="px-1 py-2 text-xs text-muted-foreground">
          {scope === "task" ? "当前任务" : "当前项目"}暂无 issue。在画布工具栏「落点」可记录第一条。
        </div>
      )}

      {filtered.map((it) => {
        const pixelAnchor = hasPixelAnchor(it) ? it.anchor_position : null;
        const hasPin = pixelAnchor !== null;
        const videoContext = readVideoIssueContext(it);
        return (
          <div
            key={it.id}
            ref={(node) => {
              if (highlightId === it.id && node) node.scrollIntoView({ block: "nearest" });
            }}
            onClick={() => {
              if (hasPin) focusIssue(it);
            }}
            className={cn(
              "flex flex-col gap-1 rounded-md border border-border bg-muted px-2.5 py-2",
              STATUS_CARD_DIM[it.status],
              highlightId === it.id && "border-amber-500 shadow-[0_0_0_1px_var(--sc-caution)]",
              hasPin && "cursor-pointer hover:border-brand",
            )}
            data-testid={`discussion-issue-card-${it.id}`}
          >
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span
                className={cn("rounded-[10px] border px-2 py-px text-2xs", STATUS_CHIP[it.status])}
              >
                {it.status === "open" ? "未解决" : it.status === "resolved" ? "已解决" : "搁置"}
              </span>
              {it.severity && (
                <span
                  className={cn(
                    "rounded-[10px] border border-border px-2 py-px text-2xs",
                    SEVERITY_CHIP[it.severity],
                  )}
                >
                  {it.severity === "blocker" ? "阻断" : it.severity === "warn" ? "警告" : "提示"}
                </span>
              )}
              {hasPin && (
                <span className="text-2xs text-muted-foreground" title="像素锚点 · 单击定位">
                  <Icon name="crosshair" size={11} /> ({pixelAnchor.x.toFixed(2)},{" "}
                  {pixelAnchor.y.toFixed(2)})
                </span>
              )}
              {pixelAnchor && typeof pixelAnchor.frame === "number" && (
                <span className="text-2xs text-muted-foreground" title="所属帧 · 单击跳转">
                  {videoContext?.frame_range
                    ? `F${videoContext.frame_range.from_frame}–F${videoContext.frame_range.to_frame}`
                    : `F${pixelAnchor.frame}`}
                </span>
              )}
              {scope === "project" && it.task_id && it.task_id !== taskId && (
                <span className="text-2xs text-muted-foreground" title={it.task_id}>
                  其他任务
                </span>
              )}
              <span className="ml-auto text-2xs text-muted-foreground">
                {it.author_name ?? "—"} · {new Date(it.created_at).toLocaleString()}
              </span>
            </div>
            {it.title && <div className="text-xs font-semibold text-foreground">{it.title}</div>}
            <div className="whitespace-pre-wrap text-xs text-foreground">{it.body}</div>
            <div className="mt-1 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {it.status !== "resolved" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStatus(it.id, "resolved")}
                  title="标为已解决"
                >
                  <Icon name="check" size={11} /> 解决
                </Button>
              )}
              {it.status !== "wont_fix" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStatus(it.id, "wont_fix")}
                  title="搁置"
                >
                  搁置
                </Button>
              )}
              {it.status !== "open" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStatus(it.id, "open")}
                  title="重开"
                >
                  重开
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMut.mutate(it.id)}
                title="删除"
              >
                <Icon name="trash" size={11} />
              </Button>
            </div>
          </div>
        );
      })}
      {hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
        >
          {isFetchingNextPage ? "加载中…" : "加载更多问题"}
        </Button>
      )}
    </div>
  );
}
