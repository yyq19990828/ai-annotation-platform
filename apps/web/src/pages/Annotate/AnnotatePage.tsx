import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useToastStore } from "@/components/ui/Toast";
import { Thumbnail } from "@/components/Thumbnail";
import { useTaskList } from "@/hooks/useTasks";
import { useMyBatches } from "@/hooks/useDashboard";
import { batchesApi, type BatchResponse } from "@/api/batches";
import type { MyBatchItem } from "@/api/dashboard";
import type { TaskResponse } from "@/types";
import { AnnotateSidebar } from "./AnnotateSidebar";

const STATUS_BADGE: Record<string, { label: string; variant: "accent" | "warning" | "danger" | "outline" }> = {
  active: { label: "未开始", variant: "outline" },
  annotating: { label: "标注中", variant: "accent" },
  reviewing: { label: "审核中", variant: "warning" },
  rejected: { label: "已驳回", variant: "danger" },
};

function TaskRow({ task, onOpen }: { task: TaskResponse; onOpen: () => void }) {
  const isLocked = task.status === "review" || task.status === "completed";
  const statusLabel =
    task.status === "completed" ? "已通过"
    : task.status === "review" ? "送审中"
    : task.total_annotations > 0 ? "进行中"
    : task.total_predictions > 0 ? "AI 已预标"
    : "未开始";
  const statusVariant =
    task.status === "completed" ? "success" as const
    : task.status === "review" ? "warning" as const
    : task.total_annotations > 0 ? "accent" as const
    : "outline" as const;

  return (
    <div
      onClick={onOpen}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-elev)",
        marginBottom: 8,
        display: "grid",
        gridTemplateColumns: "48px 1fr 140px 100px 100px",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        cursor: "pointer",
      }}
    >
      <Thumbnail src={task.thumbnail_url} blurhash={task.blurhash} width={40} height={40} />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{task.display_id}</span>
          <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.file_name}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
          {task.total_annotations} 个标注 · {task.total_predictions} 个预测
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
        <Badge variant={statusVariant} dot>{statusLabel}</Badge>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-fg-subtle)" }}>
        {isLocked && (
          <span title="已锁定" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="lock" size={11} />已锁定
          </span>
        )}
      </div>
      <div style={{ textAlign: "right" }}>
        <Button
          size="sm"
          variant="primary"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
        >
          <Icon name="target" size={11} />打开
        </Button>
      </div>
    </div>
  );
}

export function AnnotatePage() {
  const pushToast = useToastStore((s) => s.push);
  const navigate = useNavigate();
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
    const q = new URLSearchParams({ batch: selectedBatch.batch_id });
    if (taskId) q.set("task", taskId);
    navigate(`/projects/${selectedBatch.project_id}/annotate?${q.toString()}`);
  };

  const remaining = selectedBatch
    ? Math.max(0, selectedBatch.total_tasks - selectedBatch.completed_tasks)
    : 0;
  const allDone = selectedBatch && selectedBatch.total_tasks > 0 && remaining === 0;

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
            按项目分组的我的批次
          </div>
        </div>
        {batchesLoading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 12 }}>加载中...</div>
        ) : (
          <AnnotateSidebar
            batches={batches}
            selectedBatchId={selectedBatchId}
            onSelect={handleSelectBatch}
          />
        )}
      </aside>

      <section style={{ minWidth: 0, overflow: "auto", maxHeight: "calc(100vh - 80px)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              {selectedBatch ? selectedBatch.batch_name : "标注工作台"}
            </h1>
            <p style={{ fontSize: 13, color: "var(--color-fg-muted)", margin: "4px 0 0" }}>
              {selectedBatch ? (
                <>
                  <span className="mono" style={{ color: "var(--color-accent)" }}>{selectedBatch.batch_display_id}</span>
                  <span> · {selectedBatch.project_name}</span>
                  <span> · 共 {selectedBatch.total_tasks} 任务 · 完成 {selectedBatch.completed_tasks}</span>
                  {remaining > 0 && <span> · 待标 {remaining}</span>}
                </>
              ) : (
                <>左侧选择批次开始标注；任务进度在画布内自动同步</>
              )}
            </p>
          </div>
          {selectedBatch && (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {selectedBatch.status === "annotating" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!allDone || submitMut.isPending}
                  title={allDone ? "整批提交质检" : `还剩 ${remaining} 个任务未完成`}
                  onClick={() => {
                    if (!window.confirm(`确认将批次「${selectedBatch.batch_name}」提交质检？提交后无法继续修改。`)) return;
                    submitMut.mutate(selectedBatch);
                  }}
                >
                  <Icon name="check" size={11} />提交质检
                </Button>
              )}
              <Button size="sm" onClick={() => openWorkbench()}>
                <Icon name="target" size={11} />打开画布
              </Button>
            </div>
          )}
        </div>

        {selectedBatch?.status === "rejected" && selectedBatch.review_feedback && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              background: "color-mix(in oklab, var(--color-danger) 10%, transparent)",
              borderLeft: "3px solid var(--color-danger)",
              borderRadius: "var(--radius-sm)",
              fontSize: 12.5,
              color: "var(--color-fg)",
            }}
          >
            <strong style={{ color: "var(--color-danger)" }}>审核员驳回反馈：</strong>
            <div style={{ marginTop: 4, color: "var(--color-fg-muted)" }}>{selectedBatch.review_feedback}</div>
          </div>
        )}

        {selectedBatch && (
          <div style={{ marginBottom: 12, padding: "10px 12px", border: "1px solid var(--color-border)", borderRadius: "var(--radius-md)", background: "var(--color-bg-elev)" }}>
            <ProgressBar value={selectedBatch.progress_pct} />
            <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span>
                进度 {selectedBatch.progress_pct}% ·
                <span className="mono"> {selectedBatch.completed_tasks} / {selectedBatch.total_tasks}</span>
              </span>
              <Badge variant={STATUS_BADGE[selectedBatch.status]?.variant ?? "outline"} dot>
                {STATUS_BADGE[selectedBatch.status]?.label ?? selectedBatch.status}
              </Badge>
            </div>
          </div>
        )}

        {!selectedBatch ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--color-fg-subtle)" }}>
            <Icon name="target" size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14 }}>请从左侧选择一个批次</div>
          </div>
        ) : tasksLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "var(--color-fg-subtle)" }}>加载中...</div>
        ) : tasks.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "var(--color-fg-subtle)" }}>
            <Icon name="inbox" size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontSize: 14 }}>该批次暂无任务</div>
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 12,
                padding: "8px 12px",
                background: "var(--color-bg-elev)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-md)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}
            >
              <span>
                共 {total} 个任务{tasks.length < total && `（已加载 ${tasks.length}）`}
              </span>
              <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
                点击行打开画布 · 进度自动保存
              </span>
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
