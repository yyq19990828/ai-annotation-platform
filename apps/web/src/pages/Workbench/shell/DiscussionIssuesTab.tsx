/**
 * DiscussionPanel 的 Issue 列表。
 *
 * Issue status 由服务端过滤；首屏的 status_counts.open 是精确待处理数，
 * 绝不从当前已经加载的卡片数量推导。图钉反向定位若遇到过滤掉或尚未
 * 加载的 Issue，会显式切换到当前任务/全部并按游标继续查找。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { useInfiniteFeedbacks, usePatchFeedback, useDeleteFeedback } from "@/hooks/useFeedbacks";
import {
  hasPixelAnchor,
  type AnnotationFeedback,
  type FeedbackSeverity,
  type FeedbackStatus,
  type ListFeedbacksParams,
} from "@/api/feedbacks";
import { useActiveIssueStore } from "../state/useActiveIssueStore";
import { readVideoIssueContext } from "../state/videoIssueContext";

interface Props {
  projectId: string;
  taskId: string;
  /** Open the task-only Issue form with an explicit task intent. */
  onCreateTaskIssue?: () => void;
  /** Arm the canvas for an actual confirmed pixel/frame point. */
  onCreatePixelIssue?: () => void;
  allowProjectScope?: boolean;
}

function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

const STATUS_FILTERS: { key: FeedbackStatus | "all"; label: string }[] = [
  { key: "open", label: "未解决" },
  { key: "all", label: "全部" },
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

type PinRecovery =
  | { id: string; state: "loading" }
  | { id: string; state: "error"; message: string }
  | { id: string; state: "unavailable" }
  | null;

interface PinRequestState {
  pinRequestTick?: number;
  pinTarget?: AnnotationFeedback | null;
}

function feedbackActions(issue: AnnotationFeedback) {
  // The server is authoritative. Missing capabilities are intentionally
  // fail-closed: an old or malformed response may still be located/read, but
  // must never expose a mutation it cannot prove is permitted.
  return {
    changeStatus: issue.actions?.change_status ?? false,
    delete: issue.actions?.delete ?? false,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function DiscussionIssuesTab({
  projectId,
  taskId,
  onCreateTaskIssue,
  onCreatePixelIssue,
  allowProjectScope = false,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "all">("open");
  const [scope, setScope] = useState<"task" | "project">("task");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingMutation, setPendingMutation] = useState<{
    kind: "status" | "delete";
    id: string;
  } | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<string | null>(null);
  const [pinRecovery, setPinRecovery] = useState<PinRecovery>(null);
  const recoveryGenerationRef = useRef(0);
  const recoveryFetchRef = useRef(false);
  const ownerKey = `${projectId}:${taskId}`;
  const ownerKeyRef = useRef(ownerKey);
  const itemsRef = useRef<AnnotationFeedback[]>([]);
  const scopeRef = useRef(scope);
  const statusFilterRef = useRef(statusFilter);
  ownerKeyRef.current = ownerKey;
  scopeRef.current = scope;
  statusFilterRef.current = statusFilter;

  const params: ListFeedbacksParams = useMemo(
    () => ({
      project_id: projectId,
      task_id: !allowProjectScope || scope === "task" ? taskId : undefined,
      kind: "issue",
      status: statusFilter === "all" ? undefined : statusFilter,
      root_only: true,
      include_counts: true,
      limit: 50,
    }),
    [projectId, taskId, scope, allowProjectScope, statusFilter],
  );
  const query = useInfiniteFeedbacks(params);
  const refetchIssueList = query.refetch;
  const fetchNextIssuePage = query.fetchNextPage;
  const patchMut = usePatchFeedback(params);
  const deleteMut = useDeleteFeedback(params);
  const highlightId = useActiveIssueStore((s) => s.highlightId);
  // highlightFromPin bumps the dedicated pin request tick even when the same
  // pin is clicked again. The optional cast keeps this F3 worktree compatible
  // with the pre-G1 store; the coordinator's shared store supplies the typed
  // fields at integration.
  const pinRequestTick = useActiveIssueStore(
    (s) => (s as typeof s & PinRequestState).pinRequestTick ?? 0,
  );
  const pinTarget = useActiveIssueStore((s) => (s as typeof s & PinRequestState).pinTarget ?? null);
  const focusIssue = useActiveIssueStore((s) => s.focusIssue);

  useEffect(() => {
    // A task replacement retires local mutation UI as well as pin recovery;
    // callbacks from the old owner must not surface an error in the new task.
    setMutationError(null);
    setPendingMutation(null);
    setDeleteCandidate(null);
    setPinRecovery(null);
    recoveryGenerationRef.current += 1;
    recoveryFetchRef.current = false;
  }, [ownerKey]);

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data?.pages],
  );
  itemsRef.current = items;
  // The server applies the selected status before pagination. Never filter
  // the loaded rows again: doing so makes a page-one-only match look absent.
  const openIssueCount = query.data?.pages[0]?.status_counts?.open;
  const countState = query.isError
    ? "error"
    : query.isLoading || (query.isFetching && !query.data)
      ? "loading"
      : typeof openIssueCount === "number"
        ? "exact"
        : "unknown";

  const reportMutationError = (error: unknown, fallback: string) => {
    setMutationError(errorMessage(error, fallback));
  };

  const setStatus = (id: string, next: FeedbackStatus) => {
    const requestOwner = ownerKey;
    setMutationError(null);
    setPendingMutation({ kind: "status", id });
    patchMut.mutate(
      { id, payload: { status: next } },
      {
        onError: (error) => {
          if (ownerKeyRef.current === requestOwner)
            reportMutationError(error, "状态更新失败，请重试");
        },
        onSettled: () => {
          if (ownerKeyRef.current === requestOwner) setPendingMutation(null);
        },
      },
    );
  };

  const deleteIssue = (id: string) => {
    const requestOwner = ownerKey;
    setMutationError(null);
    setPendingMutation({ kind: "delete", id });
    deleteMut.mutate(
      { id, scope: params },
      {
        onError: (error) => {
          if (ownerKeyRef.current === requestOwner) reportMutationError(error, "删除失败，请重试");
        },
        onSettled: () => {
          if (ownerKeyRef.current !== requestOwner) return;
          setPendingMutation(null);
          setDeleteCandidate(null);
        },
      },
    );
  };

  const retryPinRecovery = () => {
    if (!pinRecovery) return;
    recoveryGenerationRef.current += 1;
    recoveryFetchRef.current = false;
    setPinRecovery({ id: pinRecovery.id, state: "loading" });
    void refetchIssueList();
  };

  // A pin can be outside the current status/project view. Reset to an
  // including current-task query, then page until the exact ID is found or
  // the server cursor is exhausted. Each highlight gets a new generation so
  // a late request cannot announce an older target as unavailable/found.
  useEffect(() => {
    recoveryGenerationRef.current += 1;
    recoveryFetchRef.current = false;
    const targetMatchesCurrentTask =
      !pinTarget || (pinTarget.project_id === projectId && pinTarget.task_id === taskId);
    if (
      !targetMatchesCurrentTask ||
      !highlightId ||
      itemsRef.current.some((item) => item.id === highlightId)
    ) {
      setPinRecovery(null);
      return;
    }
    setPinRecovery({ id: highlightId, state: "loading" });
    if (scopeRef.current !== "task") setScope("task");
    if (statusFilterRef.current !== "all") setStatusFilter("all");
  }, [highlightId, pinRequestTick, pinTarget, projectId, taskId]); // The request itself is advanced by the effect below.

  useEffect(() => {
    const recovery = pinRecovery;
    if (!recovery || recovery.state !== "loading") return;
    const generation = recoveryGenerationRef.current;
    if (scope !== "task" || statusFilter !== "all") return;
    if (items.some((item) => item.id === recovery.id)) {
      setPinRecovery(null);
      return;
    }
    if (query.isLoading || query.isFetching || query.isFetchingNextPage || recoveryFetchRef.current)
      return;
    if (query.isError) {
      setPinRecovery({
        id: recovery.id,
        state: "error",
        message: errorMessage(query.error, "无法加载该 Issue"),
      });
      return;
    }
    if (!query.hasNextPage) {
      setPinRecovery({ id: recovery.id, state: "unavailable" });
      return;
    }
    recoveryFetchRef.current = true;
    void Promise.resolve(fetchNextIssuePage()).finally(() => {
      if (recoveryGenerationRef.current !== generation) return;
      recoveryFetchRef.current = false;
      // A mocked/aborted fetch may settle without changing a query flag. Nudge
      // this recovery state so the effect can observe the next cursor/error;
      // React Query's normal data transition remains the source of truth.
      setPinRecovery((current) =>
        current?.state === "loading" && current.id === recovery.id ? { ...current } : current,
      );
    });
  }, [
    pinRecovery,
    scope,
    statusFilter,
    items,
    query.isLoading,
    query.isFetching,
    query.isError,
    query.error,
    query.isFetchingNextPage,
    query.hasNextPage,
    fetchNextIssuePage,
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1">
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
            data-testid={`issue-status-${f.key}`}
          >
            {f.label}
          </button>
        ))}
        <span
          className="ml-auto text-2xs text-muted-foreground"
          data-testid="issue-open-count"
          data-state={countState}
        >
          {countState === "exact"
            ? `待处理 ${openIssueCount}`
            : countState === "loading"
              ? "待处理 …"
              : countState === "error"
                ? "待处理 —"
                : "待处理 —"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {onCreateTaskIssue && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCreateTaskIssue}
            data-testid="issue-create-task"
            data-workbench-issue-navigation
          >
            <Icon name="plus" size={12} /> 任务问题
          </Button>
        )}
        {onCreatePixelIssue && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCreatePixelIssue}
            data-testid="issue-create-pixel"
            data-workbench-issue-navigation
          >
            <Icon name="crosshair" size={12} /> 在画布选点
          </Button>
        )}
      </div>

      {pinRecovery?.state === "loading" && (
        <div
          className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground"
          data-testid="issue-pin-recovery"
          data-state="loading"
        >
          正在查找图钉 Issue…
        </div>
      )}
      {pinRecovery?.state === "error" && (
        <div
          className="flex items-center justify-between gap-2 rounded border border-status-danger/40 bg-status-danger-soft px-2 py-1.5 text-xs text-status-danger"
          data-testid="issue-pin-recovery"
          data-state="error"
        >
          <span>{pinRecovery.message}</span>
          <Button size="sm" variant="ghost" onClick={retryPinRecovery}>
            重试
          </Button>
        </div>
      )}
      {pinRecovery?.state === "unavailable" && (
        <div
          className="rounded border border-border bg-muted px-2 py-1.5 text-xs text-muted-foreground"
          data-testid="issue-pin-recovery"
          data-state="unavailable"
        >
          未找到该 Issue，可能已删除或当前账号不可见。
        </div>
      )}

      {query.isLoading && <div className="px-1 py-2 text-xs text-muted-foreground">加载中…</div>}
      {query.isError && (
        <div className="flex items-center justify-between gap-2 px-1 py-2 text-xs text-status-danger">
          <span>加载失败：{errorMessage(query.error, "请重试")}</span>
          <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>
            重试
          </Button>
        </div>
      )}
      {mutationError && (
        <div
          className="flex items-center justify-between gap-2 rounded border border-status-danger/40 bg-status-danger-soft px-2 py-1.5 text-xs text-status-danger"
          role="alert"
          data-testid="issue-mutation-error"
        >
          <span>{mutationError}</span>
          <Button size="sm" variant="ghost" onClick={() => setMutationError(null)}>
            关闭
          </Button>
        </div>
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <div className="px-1 py-2 text-xs text-muted-foreground">
          {scope === "task" ? "当前任务" : "当前项目"}暂无 Issue。
        </div>
      )}

      {items.map((it) => {
        const pixelAnchor = hasPixelAnchor(it) ? it.anchor_position : null;
        const hasPin = pixelAnchor !== null;
        const videoContext = readVideoIssueContext(it);
        const actions = feedbackActions(it);
        const pending = pendingMutation?.id === it.id;
        const isDeleteCandidate = deleteCandidate === it.id;
        return (
          <div
            key={it.id}
            ref={(node) => {
              if (highlightId === it.id && node) node.scrollIntoView?.({ block: "nearest" });
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
            {(actions.changeStatus || actions.delete) && (
              <div className="mt-1 flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                {actions.changeStatus && it.status !== "resolved" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setStatus(it.id, "resolved")}
                    title="标为已解决"
                  >
                    <Icon name="check" size={11} /> 解决
                  </Button>
                )}
                {actions.changeStatus && it.status !== "wont_fix" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setStatus(it.id, "wont_fix")}
                    title="搁置"
                  >
                    搁置
                  </Button>
                )}
                {actions.changeStatus && it.status !== "open" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => setStatus(it.id, "open")}
                    title="重开"
                  >
                    重开
                  </Button>
                )}
                {actions.delete && !isDeleteCandidate && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setMutationError(null);
                      setDeleteCandidate(it.id);
                    }}
                    title="删除"
                    data-testid={`issue-delete-${it.id}`}
                  >
                    <Icon name="trash" size={11} />
                  </Button>
                )}
                {actions.delete && isDeleteCandidate && (
                  <>
                    <span className="self-center text-2xs text-status-danger">确认删除？</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => deleteIssue(it.id)}
                      data-testid={`issue-delete-confirm-${it.id}`}
                    >
                      确认
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => setDeleteCandidate(null)}
                    >
                      取消
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {query.hasNextPage && (
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? "加载中…" : "加载更多问题"}
        </Button>
      )}
    </div>
  );
}
