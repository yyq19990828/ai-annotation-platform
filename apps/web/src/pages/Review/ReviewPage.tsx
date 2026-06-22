import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Thumbnail } from "@/components/Thumbnail";
import { useToastStore } from "@/components/ui/Toast";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useTaskList, useAnnotations, useApproveTask, useRejectTask } from "@/hooks/useTasks";
import { useRejectBatch } from "@/hooks/useBatches";
import { useReviewerStats } from "@/hooks/useDashboard";
import type { TaskResponse } from "@/types";
import type { ReviewingBatchItem } from "@/api/dashboard";
import { buildReviewWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import { RejectReasonModal } from "./RejectReasonModal";
import { ReviewSidebar } from "./ReviewSidebar";
import { ReviewBatchCardGrid } from "./ReviewBatchCardGrid";
import type { CSSProperties } from "react";

function ProgressFill({ pct, barClass }: { pct: number; barClass: string }) {
  const ref = useElementStyle<HTMLDivElement>({
    "--progress-pct": `${Math.min(100, pct)}%`,
  } as CSSProperties);

  return <div ref={ref} className={`h-full w-[var(--progress-pct)] ${barClass}`} />;
}

function AnnotationPreview({ taskId }: { taskId: string }) {
  const { data: annotations } = useAnnotations(taskId);
  if (!annotations || annotations.length === 0) {
    return <span className="text-xs text-muted-foreground">无标注</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {annotations.slice(0, 6).map((a) => (
        <span key={a.id} className="[&_span]:px-1.5 [&_span]:py-px [&_span]:text-2xs">
          <Badge variant={a.parent_prediction_id ? "ai" : "accent"}>
            {a.class_name} {a.confidence ? `${(a.confidence * 100).toFixed(0)}%` : ""}
          </Badge>
        </span>
      ))}
      {annotations.length > 6 && (
        <span className="text-2xs text-muted-foreground">+{annotations.length - 6}</span>
      )}
    </div>
  );
}

function TaskRow({
  task, checked, onToggle, onOpen,
}: {
  task: TaskResponse;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="mb-2 grid grid-cols-[32px_48px_minmax(0,1fr)_140px_200px_96px] items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2.5">
      <label className="inline-flex cursor-pointer items-center">
        <input
          type="checkbox" checked={checked} onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer accent-brand"
        />
      </label>
      <Thumbnail src={task.thumbnail_url} blurhash={task.blurhash} width={40} height={40} />
      <div onClick={onOpen} className="min-w-0 cursor-pointer">
        <div className="flex items-center gap-2">
          <span className="mono text-xs font-semibold">{task.display_id}</span>
          <span className="overflow-hidden text-ellipsis whitespace-nowrap text-sm">
            {task.file_name}
          </span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {task.total_annotations} 个标注 · {task.total_predictions} 个预测
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        <Badge variant="warning" dot>待审核</Badge>
      </div>
      <AnnotationPreview taskId={task.id} />
      <div className="text-right">
        <Button size="sm" variant="primary" onClick={onOpen}>
          <Icon name="target" size={11} />打开
        </Button>
      </div>
    </div>
  );
}

export function ReviewPage() {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    () => searchParams.get("project") ?? "",
  );
  const [selectedBatchId, setSelectedBatchId] = useState<string>(
    () => searchParams.get("batch") ?? "",
  );

  // v0.7.1 B-18：批次树数据来自 reviewer dashboard 聚合（已扩展为「reviewing 或 review_tasks>0」）。
  const { data: reviewerStats } = useReviewerStats();
  const sidebarBatches = useMemo<ReviewingBatchItem[]>(
    () => reviewerStats?.reviewing_batches ?? [],
    [reviewerStats?.reviewing_batches],
  );

  const selectedBatch = useMemo(
    () => sidebarBatches.find((b) => b.batch_id === selectedBatchId) ?? null,
    [sidebarBatches, selectedBatchId],
  );
  // 选中批次后 projectId 跟随；未选中走 selectedProjectId 兜底（用于「全部待审」筛选）。
  const projectId = selectedBatch?.project_id || selectedProjectId || undefined;
  const rejectBatchMut = useRejectBatch(projectId ?? "");

  // v0.12.5 · 绩效页项目下钻带入的 assignee 过滤(后端 tasks 已支持 assignee_id)。
  const assigneeFilter = searchParams.get("assignee") || "";
  const taskListParams = useMemo(
    () => ({
      status: "review" as const,
      ...(selectedBatchId ? { batch_id: selectedBatchId } : {}),
      ...(assigneeFilter ? { assignee_id: assigneeFilter } : {}),
    }),
    [selectedBatchId, assigneeFilter],
  );
  const { data: taskListData, isLoading } = useTaskList(projectId, taskListParams);
  const tasks = useMemo(
    () => taskListData?.pages.flatMap((p) => p.items) ?? [],
    [taskListData?.pages],
  );

  const approveMut = useApproveTask();
  const rejectMut = useRejectTask();

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [rejectingIds, setRejectingIds] = useState<string[] | null>(null);

  const handleSelectBatch = (b: ReviewingBatchItem | null) => {
    // 合并而非整体重写：保留 assignee 等下钻带入的过滤 param。
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    next.delete("batch");
    if (!b) {
      setSelectedBatchId("");
      setSelectedProjectId("");
    } else {
      setSelectedBatchId(b.batch_id);
      setSelectedProjectId(b.project_id);
      next.set("project", b.project_id);
      next.set("batch", b.batch_id);
    }
    setSearchParams(next);
    setCheckedIds(new Set());
  };

  const clearAssigneeFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("assignee");
    setSearchParams(next);
  };

  // 返回卡片网格概览：清掉 batch / project / assignee 三类选择。
  const backToOverview = () => {
    setSelectedBatchId("");
    setSelectedProjectId("");
    const next = new URLSearchParams(searchParams);
    next.delete("project");
    next.delete("batch");
    next.delete("assignee");
    setSearchParams(next);
    setCheckedIds(new Set());
  };

  const openTaskId = searchParams.get("taskId");
  // ESC 关 drawer
  useEffect(() => {
    if (!openTaskId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchParams({});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTaskId, setSearchParams]);

  const toggleChecked = (id: string) => {
    setCheckedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const toggleAll = () => {
    if (checkedIds.size === tasks.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(tasks.map((t) => t.id)));
  };

  const openTask = (id: string) => {
    if (projectId) {
      navigate(buildReviewWorkbenchUrl(projectId, {
        batchId: selectedBatchId,
        taskId: id,
        returnTo: currentWorkbenchReturnTo(location),
      }));
    } else {
      setSearchParams({ taskId: id });
    }
  };
  const runBatchReject = (
    ids: string[],
    payload: {
      reason_type: "missing" | "extra" | "wrong_label" | "wrong_geometry";
      reason?: string;
    },
  ) => {
    let succeeded = 0;
    let failed = 0;
    let pending = ids.length;
    ids.forEach((id) => {
      rejectMut.mutate({ taskId: id, ...payload }, {
        onSuccess: () => { succeeded++; },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            pushToast({
              msg: `已退回 ${succeeded}/${ids.length} 个任务`,
              sub: failed
                ? `${failed} 项失败`
                : `类型：${payload.reason_type}${payload.reason ? ` · ${payload.reason}` : ""}`,
              kind: failed ? "error" : "success",
            });
            setCheckedIds(new Set());
            setRejectingIds(null);
          }
        },
      });
    });
  };

  const runBatchApprove = () => {
    const ids = [...checkedIds];
    let succeeded = 0;
    let failed = 0;
    let pending = ids.length;
    ids.forEach((id) => {
      approveMut.mutate(id, {
        onSuccess: () => { succeeded++; },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            pushToast({
              msg: `已通过 ${succeeded}/${ids.length} 个任务`,
              sub: failed ? `${failed} 项失败` : undefined,
              kind: failed ? "error" : "success",
            });
            setCheckedIds(new Set());
          }
        },
      });
    });
  };

  const totalTasks = selectedBatch?.total_tasks ?? 0;
  const pendingReview = selectedBatch?.review_tasks ?? 0;
  const approvedDone = selectedBatch?.completed_tasks ?? 0;
  const unsubmitted = selectedBatch
    ? Math.max(0, selectedBatch.total_tasks - selectedBatch.review_tasks - selectedBatch.completed_tasks)
    : 0;
  const reviewPct = totalTasks ? Math.round((pendingReview / totalTasks) * 1000) / 10 : 0;
  const approvedPct = totalTasks ? Math.round((approvedDone / totalTasks) * 1000) / 10 : 0;

  // 纯落地态（无 batch / project / assignee 选择）展示批次卡片网格；其余维持任务列表。
  const showOverview =
    !selectedBatchId && !selectedProjectId && !assigneeFilter && sidebarBatches.length > 0;

  return (
    <div className="box-border grid h-full max-w-[1480px] grid-cols-[300px_1fr] gap-4 px-6 py-5 text-foreground max-[900px]:h-auto max-[900px]:grid-cols-1 max-[900px]:p-4">
      <aside className="max-h-[calc(100vh-80px)] self-stretch overflow-auto rounded-md border border-border bg-card max-[900px]:max-h-none">
        <div className="border-b border-border px-3.5 py-3">
          <div className="text-sm font-semibold">项目 · 批次</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            按项目分组的待审核批次
          </div>
        </div>
        <ReviewSidebar
          batches={sidebarBatches}
          selectedBatchId={selectedBatchId}
          onSelect={handleSelectBatch}
        />
      </aside>

      <section className="max-h-[calc(100vh-80px)] min-w-0 overflow-auto max-[900px]:max-h-none">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {!showOverview && (
              <button
                type="button"
                className="mb-1.5 inline-flex cursor-pointer appearance-none items-center gap-1 border-none bg-transparent p-0 text-xs text-muted-foreground hover:text-brand"
                onClick={backToOverview}
              >
                <Icon name="chevLeft" size={12} />返回全部批次
              </button>
            )}
            <h1 className="m-0 text-xl font-bold">
              {selectedBatch ? selectedBatch.batch_name : "质检审核"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {selectedBatch ? (
                <>
                  <span className="mono text-brand">{selectedBatch.batch_display_id}</span>
                  <span> · {selectedBatch.project_name}</span>
                  <span> · 共 {selectedBatch.total_tasks} 任务 · {selectedBatch.review_tasks} 待审 · {selectedBatch.completed_tasks} 已通过</span>
                </>
              ) : (
                <>选择一个批次开始审核；点击行可在右侧画布预览，多选支持批量通过 / 退回</>
              )}
            </p>
            {assigneeFilter && (
              <button
                type="button"
                className="mt-2 inline-flex cursor-pointer appearance-none items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-xs text-brand hover:bg-brand/20"
                onClick={clearAssigneeFilter}
                title="清除指派标注员过滤"
              >
                <Icon name="filter" size={11} />
                仅看指派标注员 · 清除
              </button>
            )}
          </div>
          {selectedBatchId && (
            <div className="flex shrink-0 gap-1.5">
              <Button size="sm" onClick={() => tasks[0] && openTask(tasks[0].id)} disabled={tasks.length === 0}>
                <Icon name="target" size={11} />打开画布
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  const feedback = window.prompt("整批退回原因（必填，最大 500 字）：");
                  if (!feedback || !feedback.trim()) return;
                  rejectBatchMut.mutate(
                    { batchId: selectedBatchId, feedback: feedback.trim() },
                    {
                      onSuccess: () =>
                        pushToast({ msg: "整批已退回，已通知被分派标注员", kind: "success" }),
                      onError: (e) => pushToast({ msg: "退回失败", sub: (e as Error).message }),
                    },
                  );
                }}
              >
                <Icon name="x" size={11} />整批退回
              </Button>
            </div>
          )}
        </div>

        {selectedBatch && (
          <div className="mb-3 rounded-md border border-border bg-card px-3 py-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">批次进度</span>
              <Badge variant="warning" dot>审核中</Badge>
            </div>
            {[
              { label: "待审", pct: reviewPct, count: pendingReview, bar: "bg-amber-500" },
              { label: "通过", pct: approvedPct, count: approvedDone, bar: "bg-emerald-500" },
            ].map((r) => (
              <div key={r.label} className="mt-1 flex items-center gap-2.5 text-xs text-muted-foreground">
                <span className="flex-[0_0_48px]">{r.label}</span>
                <div className="h-[5px] flex-1 overflow-hidden rounded-sm bg-muted">
                  <ProgressFill pct={r.pct} barClass={r.bar} />
                </div>
                <span className="mono flex-[0_0_100px] text-right text-muted-foreground">
                  {r.count}/{selectedBatch.total_tasks} · {r.pct}%
                </span>
              </div>
            ))}
            {unsubmitted > 0 && (
              <div className="mt-1.5 text-xs text-muted-foreground">
                仍有 {unsubmitted} 个任务尚未提交质检
              </div>
            )}
          </div>
        )}

        {showOverview ? (
          <ReviewBatchCardGrid batches={sidebarBatches} onSelect={handleSelectBatch} />
        ) : isLoading ? (
          <div className="p-10 text-center text-muted-foreground">加载中...</div>
        ) : tasks.length === 0 ? (
          <div className="p-15 text-center text-muted-foreground">
            <Icon name="check" size={40} className="mx-auto mb-3 opacity-30" />
            <div className="text-sm">
              {selectedBatchId ? "该批次暂无待审核任务" : "暂无待审核任务"}
            </div>
          </div>
        ) : (
          <>
            <div
              className={`mb-3 flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs text-muted-foreground ${
                checkedIds.size > 0 ? "bg-brand/10" : "bg-card"
              }`}
            >
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={checkedIds.size > 0 && checkedIds.size === tasks.length}
                  onChange={toggleAll}
                  className="cursor-pointer accent-brand"
                />
                <span>{checkedIds.size > 0 ? `已选 ${checkedIds.size}/${tasks.length}` : `共 ${tasks.length} 个待审核任务`}</span>
              </label>
              {checkedIds.size > 0 && (
                <div className="flex gap-1.5">
                  <Button variant="primary" size="sm" onClick={runBatchApprove}>
                    <Icon name="check" size={11} />批量通过 ({checkedIds.size})
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setRejectingIds([...checkedIds])}>
                    <Icon name="x" size={11} />批量退回 ({checkedIds.size})
                  </Button>
                </div>
              )}
            </div>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                checked={checkedIds.has(t.id)}
                onToggle={() => toggleChecked(t.id)}
                onOpen={() => openTask(t.id)}
              />
            ))}
          </>
        )}
      </section>

      <RejectReasonModal
        open={!!rejectingIds}
        count={rejectingIds?.length ?? 0}
        onClose={() => setRejectingIds(null)}
        onConfirm={(payload) => {
          if (rejectingIds) runBatchReject(rejectingIds, payload);
        }}
        // v0.8.8 · 单任务退回且该任务被跳过时透传 skip_reason 到 modal
        skipReasonHint={
          rejectingIds?.length === 1
            ? tasks.find((t) => t.id === rejectingIds[0])?.skip_reason ?? null
            : null
        }
      />
    </div>
  );
}
