import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { Thumbnail } from "@/components/Thumbnail";
import { useElementStyle } from "@/components/ui/useElementStyle";
import { useTaskList } from "@/hooks/useTasks";
import { useMyBatches } from "@/hooks/useDashboard";
import { batchesApi, type BatchResponse } from "@/api/batches";
import type { MyBatchItem } from "@/api/dashboard";
import type { TaskResponse } from "@/types";
import { AnnotateSidebar } from "./AnnotateSidebar";
import { BatchCardGrid } from "./BatchCardGrid";
import { buildWorkbenchUrl, currentWorkbenchReturnTo } from "@/utils/workbenchNavigation";
import styles from "./AnnotatePage.module.css";
import type { CSSProperties } from "react";

const STATUS_BADGE: Record<
  string,
  { label: string; variant: "accent" | "warning" | "danger" | "outline" }
> = {
  active: { label: "未开始", variant: "outline" },
  annotating: { label: "标注中", variant: "accent" },
  reviewing: { label: "审核中", variant: "warning" },
  rejected: { label: "已驳回", variant: "danger" },
};

function ProgressFill({ pct, color }: { pct: number; color: string }) {
  const ref = useElementStyle<HTMLDivElement>({
    "--progress-pct": `${Math.min(100, pct)}%`,
    "--progress-color": color,
  } as CSSProperties);

  return <div ref={ref} className={styles.progressFill} />;
}

function TaskRow({ task, onOpen }: { task: TaskResponse; onOpen: () => void }) {
  const isLocked = task.status === "review" || task.status === "completed";
  // 与工作台任务队列 (TaskQueuePanel) 的标签 + 配色保持一致
  const statusLabel =
    task.status === "completed"
      ? "已完成"
      : task.status === "review"
        ? "待审核"
        : task.status === "rejected"
          ? "待重做"
          : task.total_annotations > 0
            ? "进行中"
            : task.total_predictions > 0
              ? "AI 已预标"
              : "未开始";
  const statusVariant =
    task.status === "completed"
      ? ("success" as const)
      : task.status === "review"
        ? ("warning" as const)
        : task.status === "rejected"
          ? ("danger" as const)
          : task.total_annotations > 0
            ? ("accent" as const)
            : task.total_predictions > 0
              ? ("ai" as const)
              : ("outline" as const);

  return (
    <div onClick={onOpen} className={styles.taskRow}>
      <Thumbnail src={task.thumbnail_url} blurhash={task.blurhash} width={40} height={40} />
      <div className={styles.taskMain}>
        <div className={styles.taskTitleRow}>
          <span className={`mono ${styles.taskId}`}>{task.display_id}</span>
          <span className={styles.taskFileName}>{task.file_name}</span>
        </div>
        <div className={styles.taskMeta}>
          {task.total_annotations} 个标注 · {task.total_predictions} 个预测
        </div>
      </div>
      <div className={styles.taskStatus}>
        <Badge variant={statusVariant} dot>
          {statusLabel}
        </Badge>
      </div>
      <div className={styles.lockCell}>
        {isLocked && (
          <span title="已锁定" className={styles.lockBadge}>
            <Icon name="lock" size={11} />
            已锁定
          </span>
        )}
      </div>
      <div className={styles.actionCell}>
        <Button
          size="sm"
          variant="primary"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <Icon name="target" size={11} />
          打开
        </Button>
      </div>
    </div>
  );
}

export function AnnotatePage() {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialBatchId = searchParams.get("batch") ?? "";
  const [selectedBatchId, setSelectedBatchId] = useState<string>(initialBatchId);

  const { data: batches = [], isLoading: batchesLoading } = useMyBatches();
  const selectedBatch = useMemo(
    () => batches.find((b) => b.batch_id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  const projectId = selectedBatch?.project_id;
  const taskListParams = useMemo(
    () => (selectedBatchId ? { batch_id: selectedBatchId } : undefined),
    [selectedBatchId],
  );
  const { data: taskListData, isLoading: tasksLoading } = useTaskList(projectId, taskListParams);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];
  const total = taskListData?.pages[0]?.total ?? tasks.length;

  const submitMut = useMutation({
    mutationFn: (b: MyBatchItem) =>
      batchesApi.transition(b.project_id, b.batch_id, "reviewing") as Promise<BatchResponse>,
    onSuccess: () => {
      pushToast({ msg: "已提交质检", sub: "等待审核员处理", kind: "success" });
      qc.invalidateQueries({ queryKey: ["dashboard", "annotator"] });
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "提交失败";
      pushToast({ msg: "提交质检失败", sub: msg, kind: "error" });
    },
  });

  const handleSelectBatch = (b: MyBatchItem | null) => {
    if (!b) {
      setSelectedBatchId("");
      setSearchParams({});
    } else {
      setSelectedBatchId(b.batch_id);
      setSearchParams({ batch: b.batch_id });
    }
  };

  const openWorkbench = (taskId?: string) => {
    if (!selectedBatch) return;
    navigate(
      buildWorkbenchUrl(selectedBatch.project_id, {
        batchId: selectedBatch.batch_id,
        taskId,
        returnTo: currentWorkbenchReturnTo(location),
      }),
    );
  };

  // B-20：分三档进度 — 已动工 / 送审 / 已通过；提交按钮不再以 allDone 强制门禁，
  // 让标注员能整批提交（剩余 pending 由 confirm 二次确认）。
  const inProgress = selectedBatch?.in_progress_tasks ?? 0;
  const startedDone = selectedBatch
    ? inProgress + selectedBatch.review_tasks + selectedBatch.completed_tasks
    : 0;
  const reviewDone = selectedBatch ? selectedBatch.review_tasks + selectedBatch.completed_tasks : 0;
  const approvedDone = selectedBatch?.completed_tasks ?? 0;
  const totalTasks = selectedBatch?.total_tasks ?? 0;
  const startedPct = totalTasks ? Math.round((startedDone / totalTasks) * 1000) / 10 : 0;
  const reviewPct = totalTasks ? Math.round((reviewDone / totalTasks) * 1000) / 10 : 0;
  const approvedPct = totalTasks ? Math.round((approvedDone / totalTasks) * 1000) / 10 : 0;
  const pendingTasks = Math.max(0, totalTasks - startedDone);

  return (
    <div className={styles.page}>
      <aside className={styles.sidebarShell}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarTitle}>项目 · 批次</div>
          <div className={styles.sidebarSubtitle}>按项目分组的我的批次</div>
        </div>
        {batchesLoading ? (
          <div className={styles.sidebarLoading}>加载中...</div>
        ) : (
          <AnnotateSidebar
            batches={batches}
            selectedBatchId={selectedBatchId}
            onSelect={handleSelectBatch}
          />
        )}
      </aside>

      <section className={styles.content}>
        <div className={styles.header}>
          <div className={styles.headerText}>
            {selectedBatch && (
              <button
                type="button"
                className={styles.backLink}
                onClick={() => handleSelectBatch(null)}
              >
                <Icon name="chevLeft" size={12} />
                返回全部批次
              </button>
            )}
            <h1 className={styles.title}>
              {selectedBatch ? selectedBatch.batch_name : "标注工作台"}
            </h1>
            <p className={styles.subtitle}>
              {selectedBatch ? (
                <>
                  <span className={`mono ${styles.accentText}`}>
                    {selectedBatch.batch_display_id}
                  </span>
                  <span> · {selectedBatch.project_name}</span>
                  <span> · 共 {selectedBatch.total_tasks} 任务</span>
                  {pendingTasks > 0 && <span> · 待标 {pendingTasks}</span>}
                  {inProgress > 0 && <span> · 标注中 {inProgress}</span>}
                  {selectedBatch.review_tasks > 0 && (
                    <span> · 送审 {selectedBatch.review_tasks}</span>
                  )}
                  {selectedBatch.completed_tasks > 0 && (
                    <span> · 已通过 {selectedBatch.completed_tasks}</span>
                  )}
                </>
              ) : (
                <>选择一个批次开始标注；任务进度在画布内自动同步</>
              )}
            </p>
          </div>
          {selectedBatch && (
            <div className={styles.headerActions}>
              {selectedBatch.status === "annotating" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={submitMut.isPending}
                  title={
                    pendingTasks > 0
                      ? `仍有 ${pendingTasks} 个未开始；确认后整批提交`
                      : "整批提交质检"
                  }
                  onClick={() => {
                    const warn =
                      pendingTasks > 0
                        ? `批次「${selectedBatch.batch_name}」仍有 ${pendingTasks} 个任务未开始。确认整批提交质检？提交后无法继续修改。`
                        : `确认将批次「${selectedBatch.batch_name}」提交质检？提交后无法继续修改。`;
                    if (!window.confirm(warn)) return;
                    submitMut.mutate(selectedBatch);
                  }}
                >
                  <Icon name="check" size={11} />
                  提交质检
                </Button>
              )}
              <Button size="sm" onClick={() => openWorkbench()}>
                <Icon name="target" size={11} />
                打开画布
              </Button>
            </div>
          )}
        </div>

        {selectedBatch?.status === "rejected" && selectedBatch.review_feedback && (
          <div className={styles.rejectFeedback}>
            <strong className={styles.dangerText}>审核员驳回反馈：</strong>
            <div className={styles.rejectFeedbackBody}>{selectedBatch.review_feedback}</div>
          </div>
        )}

        {selectedBatch && (
          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <span className={styles.progressTitle}>批次进度</span>
              <Badge variant={STATUS_BADGE[selectedBatch.status]?.variant ?? "outline"} dot>
                {STATUS_BADGE[selectedBatch.status]?.label ?? selectedBatch.status}
              </Badge>
            </div>
            {[
              { label: "标注中", pct: startedPct, count: startedDone, bar: "var(--sc-brand)" },
              { label: "送审", pct: reviewPct, count: reviewDone, bar: "var(--sc-caution)" },
              { label: "通过", pct: approvedPct, count: approvedDone, bar: "var(--sc-positive)" },
            ].map((r) => (
              <div key={r.label} className={styles.progressRow}>
                <span className={styles.progressLabel}>{r.label}</span>
                <div className={styles.progressTrack}>
                  <ProgressFill pct={r.pct} color={r.bar} />
                </div>
                <span className={`mono ${styles.progressValue}`}>
                  {r.count}/{selectedBatch.total_tasks} · {r.pct}%
                </span>
              </div>
            ))}
          </div>
        )}

        {!selectedBatch ? (
          batchesLoading ? (
            <div className={styles.loadingState}>加载中...</div>
          ) : batches.length === 0 ? (
            <div className={styles.emptyState}>
              <Icon name="inbox" size={40} className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>暂无分派批次</div>
            </div>
          ) : (
            <BatchCardGrid batches={batches} onSelect={handleSelectBatch} />
          )
        ) : tasksLoading ? (
          <div className={styles.loadingState}>加载中...</div>
        ) : tasks.length === 0 ? (
          <div className={styles.emptyState}>
            <Icon name="inbox" size={40} className={styles.emptyIcon} />
            <div className={styles.emptyTitle}>该批次暂无任务</div>
          </div>
        ) : (
          <>
            <div className={styles.taskListSummary}>
              <span>
                共 {total} 个任务{tasks.length < total && `（已加载 ${tasks.length}）`}
              </span>
              <span className={styles.taskListHint}>点击行打开画布 · 进度自动保存</span>
            </div>
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={() => openWorkbench(t.id)} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}
