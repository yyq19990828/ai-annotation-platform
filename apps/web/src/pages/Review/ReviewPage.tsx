import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useProjects } from "@/hooks/useProjects";
import { useTaskList, useAnnotations, useApproveTask, useRejectTask } from "@/hooks/useTasks";
import { useBatches, useRejectBatch } from "@/hooks/useBatches";
import type { TaskResponse } from "@/types";
import { ReviewWorkbench } from "./ReviewWorkbench";
import { RejectReasonModal } from "./RejectReasonModal";

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
  const { data: projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedBatchId, setSelectedBatchId] = useState<string>("");

  const projectId = selectedProjectId || projects?.[0]?.id;
  const { data: batchList } = useBatches(projectId ?? "", undefined);
  const reviewBatches = useMemo(
    () => (batchList ?? []).filter((b) => ["reviewing", "active", "annotating"].includes(b.status)),
    [batchList],
  );
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
    setSearchParams({ taskId: id });
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
    <div style={{ padding: "24px 28px", maxWidth: 1100 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>质检审核</h1>
          <p style={{ fontSize: 13, color: "var(--color-fg-muted)", margin: "4px 0 0" }}>
            点击行可在右侧画布预览；多选可批量通过 / 退回
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>项目:</span>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            style={{
              padding: "5px 10px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-border)", fontSize: 12,
              background: "var(--color-bg-elev)",
            }}
          >
            <option value="">全部项目</option>
            {(projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {reviewBatches.length > 0 && (
            <>
              <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>批次:</span>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                style={{
                  padding: "5px 10px", borderRadius: "var(--radius-md)",
                  border: "1px solid var(--color-border)", fontSize: 12,
                  background: "var(--color-bg-elev)",
                }}
              >
                <option value="">全部批次</option>
                {reviewBatches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.review_tasks})</option>
                ))}
              </select>
            </>
          )}
          {selectedBatchId && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (confirm("确定整批退回？所有任务将重置为待标注状态。")) {
                  rejectBatchMut.mutate(selectedBatchId, {
                    onSuccess: () => pushToast({ msg: "整批已退回", kind: "success" }),
                    onError: (e) => pushToast({ msg: "退回失败", sub: (e as Error).message }),
                  });
                }
              }}
            >
              <Icon name="x" size={11} />整批退回
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>加载中...</div>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--color-fg-subtle)" }}>
          <Icon name="check" size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
          <div style={{ fontSize: 14 }}>暂无待审核任务</div>
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

      {openTaskId && (
        <>
          <div
            onClick={closeTask}
            style={{ position: "fixed", inset: 0, background: "oklch(0 0 0 / 0.4)", zIndex: 40, backdropFilter: "blur(2px)" }}
          />
          <div
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0,
              width: "70vw", minWidth: 800, zIndex: 41,
              background: "var(--color-bg)", boxShadow: "var(--shadow-lg)",
              display: "flex", flexDirection: "column",
            }}
          >
            <ReviewWorkbench
              taskId={openTaskId}
              onApprove={() => handleApprove(openTaskId)}
              onReject={() => handleRejectSingle(openTaskId)}
              onPrev={openTaskIdx > 0 ? goPrev : undefined}
              onNext={openTaskIdx >= 0 && openTaskIdx < tasks.length - 1 ? goNext : undefined}
            />
          </div>
        </>
      )}

      <RejectReasonModal
        open={!!rejectingIds}
        count={rejectingIds?.length ?? 0}
        onClose={() => setRejectingIds(null)}
        onConfirm={(reason) => {
          if (rejectingIds) runBatchReject(rejectingIds, reason);
        }}
      />
    </div>
  );
}
