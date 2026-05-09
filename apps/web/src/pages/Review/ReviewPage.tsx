import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useTaskList, useAnnotations, useApproveTask, useRejectTask } from "@/hooks/useTasks";
import { useRejectBatch } from "@/hooks/useBatches";
import { useReviewerStats } from "@/hooks/useDashboard";
import type { TaskResponse } from "@/types";
import type { ReviewingBatchItem } from "@/api/dashboard";
import { RejectReasonModal } from "./RejectReasonModal";
import { ReviewSidebar } from "./ReviewSidebar";

function AnnotationPreview({ taskId }: { taskId: string }) {
  const { data: annotations } = useAnnotations(taskId);
  if (!annotations || annotations.length === 0) {
    return <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>无标注</span>;
  }
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {annotations.slice(0, 6).map((a) => (
        <Badge key={a.id} variant={a.parent_prediction_id ? "ai" : "accent"} style={{ fontSize: 10, padding: "1px 5px" }}>
          {a.class_name} {a.confidence ? `${(a.confidence * 100).toFixed(0)}%` : ""}
        </Badge>
      ))}
      {annotations.length > 6 && (
        <span style={{ fontSize: 10, color: "var(--color-fg-subtle)" }}>+{annotations.length - 6}</span>
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
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-elev)",
        marginBottom: 8,
        display: "grid",
        gridTemplateColumns: "32px 1fr 200px 100px",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
      }}
    >
      <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>
        <input
          type="checkbox" checked={checked} onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          style={{ accentColor: "var(--color-accent)" }}
        />
      </label>
      <div onClick={onOpen} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{task.display_id}</span>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>{task.file_name}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
          {task.total_annotations} 个标注 · {task.total_predictions} 个预测
        </div>
      </div>
      <AnnotationPreview taskId={task.id} />
      <Button size="sm" onClick={onOpen}>
        <Icon name="rect" size={12} />预览
      </Button>
    </div>
  );
}

export function ReviewPage() {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    () => searchParams.get("project") ?? "",
  );
  const [selectedBatchId, setSelectedBatchId] = useState<string>(
    () => searchParams.get("batch") ?? "",
  );

  // v0.7.1 B-18：批次树数据来自 reviewer dashboard 聚合（已扩展为「reviewing 或 review_tasks>0」）。
  const { data: reviewerStats } = useReviewerStats();
  const sidebarBatches: ReviewingBatchItem[] = reviewerStats?.reviewing_batches ?? [];

  const selectedBatch = useMemo(
    () => sidebarBatches.find((b) => b.batch_id === selectedBatchId) ?? null,
    [sidebarBatches, selectedBatchId],
  );
  // 选中批次后 projectId 跟随；未选中走 selectedProjectId 兜底（用于「全部待审」筛选）。
  const projectId = selectedBatch?.project_id || selectedProjectId || undefined;
  const rejectBatchMut = useRejectBatch(projectId ?? "");

  const taskListParams = useMemo(
    () => ({ status: "review" as const, ...(selectedBatchId ? { batch_id: selectedBatchId } : {}) }),
    [selectedBatchId],
  );
  const { data: taskListData, isLoading } = useTaskList(projectId, taskListParams);
  const tasks = taskListData?.pages.flatMap((p) => p.items) ?? [];

  const approveMut = useApproveTask();
  const rejectMut = useRejectTask();

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [rejectingIds, setRejectingIds] = useState<string[] | null>(null);

  const handleSelectBatch = (b: ReviewingBatchItem | null) => {
    if (!b) {
      setSelectedBatchId("");
      setSelectedProjectId("");
      setSearchParams({});
    } else {
      setSelectedBatchId(b.batch_id);
      setSelectedProjectId(b.project_id);
      setSearchParams({ project: b.project_id, batch: b.batch_id });
    }
    setCheckedIds(new Set());
  };

  const openTaskId = searchParams.get("taskId");
  const openTaskIdx = useMemo(
    () => tasks.findIndex((t) => t.id === openTaskId),
    [tasks, openTaskId],
  );

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
      const params = new URLSearchParams({ task: id });
      if (selectedBatchId) params.set("batch", selectedBatchId);
      navigate(`/projects/${projectId}/review?${params}`);
    } else {
      setSearchParams({ taskId: id });
    }
  };
  const closeTask = () => setSearchParams({});

  const handleApprove = (id: string) => {
    approveMut.mutate(id, {
      onSuccess: () => {
        pushToast({ msg: "任务已通过", kind: "success" });
        closeTask();
      },
    });
  };
  const handleRejectSingle = (id: string) => setRejectingIds([id]);

  const runBatchReject = (ids: string[], reason: string) => {
    let succeeded = 0;
    let failed = 0;
    let pending = ids.length;
    ids.forEach((id) => {
      rejectMut.mutate({ taskId: id, reason }, {
        onSuccess: () => { succeeded++; },
        onError: () => { failed++; },
        onSettled: () => {
          pending--;
          if (pending === 0) {
            pushToast({
              msg: `已退回 ${succeeded}/${ids.length} 个任务`,
              sub: failed ? `${failed} 项失败` : `原因：${reason}`,
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

  const goPrev = () => {
    if (openTaskIdx > 0) openTask(tasks[openTaskIdx - 1].id);
  };
  const goNext = () => {
    if (openTaskIdx >= 0 && openTaskIdx < tasks.length - 1) openTask(tasks[openTaskIdx + 1].id);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr",
        gap: 16,
        padding: "20px 24px",
        maxWidth: 1480,
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <aside
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md)",
          background: "var(--color-bg-elev)",
          overflow: "auto",
          alignSelf: "stretch",
          maxHeight: "calc(100vh - 80px)",
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>项目 · 批次</div>
          <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
            按项目分组的待审核批次
          </div>
        </div>
        <ReviewSidebar
          batches={sidebarBatches}
          selectedBatchId={selectedBatchId}
          onSelect={handleSelectBatch}
        />
      </aside>

      <section style={{ minWidth: 0, overflow: "auto", maxHeight: "calc(100vh - 80px)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {selectedBatch ? selectedBatch.batch_name : "质检审核"}
            </h1>
            <p style={{ fontSize: 13, color: "var(--color-fg-muted)", margin: "4px 0 0" }}>
              {selectedBatch ? (
                <>
                  <span className="mono" style={{ color: "var(--color-accent)" }}>{selectedBatch.batch_display_id}</span>
                  <span> · {selectedBatch.project_name}</span>
                  <span> · 共 {selectedBatch.total_tasks} 任务 · {selectedBatch.review_tasks} 待审 · {selectedBatch.completed_tasks} 已通过</span>
                </>
              ) : (
                <>左侧选择批次开始审核；点击行可在右侧画布预览，多选支持批量通过 / 退回</>
              )}
            </p>
          </div>
          {selectedBatchId && (
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
          )}
        </div>

        {isLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>加载中...</div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--color-fg-subtle)" }}>
            <Icon name="check" size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14 }}>
              {selectedBatchId ? "该批次暂无待审核任务" : "暂无待审核任务"}
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 12,
                padding: "8px 12px",
                background: checkedIds.size > 0 ? "var(--color-accent-soft)" : "var(--color-bg-elev)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={checkedIds.size > 0 && checkedIds.size === tasks.length}
                  onChange={toggleAll}
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span>{checkedIds.size > 0 ? `已选 ${checkedIds.size}/${tasks.length}` : `共 ${tasks.length} 个待审核任务`}</span>
              </label>
              {checkedIds.size > 0 && (
                <div style={{ display: "flex", gap: 6 }}>
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
        onConfirm={(reason) => {
          if (rejectingIds) runBatchReject(rejectingIds, reason);
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
