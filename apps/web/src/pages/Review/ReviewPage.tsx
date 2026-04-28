import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useProjects } from "@/hooks/useProjects";
import { useTaskList, useAnnotations, useApproveTask, useRejectTask } from "@/hooks/useTasks";
import type { TaskResponse } from "@/types";

function AnnotationPreview({ taskId }: { taskId: string }) {
  const { data: annotations } = useAnnotations(taskId);
  if (!annotations || annotations.length === 0) {
    return <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>无标注</span>;
  }
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {annotations.map((a) => (
        <Badge key={a.id} variant={a.parent_prediction_id ? "ai" : "accent"} style={{ fontSize: 10, padding: "1px 5px" }}>
          {a.class_name} {a.confidence ? `${(a.confidence * 100).toFixed(0)}%` : ""}
        </Badge>
      ))}
    </div>
  );
}

function TaskReviewRow({ task, onApprove, onReject }: {
  task: TaskResponse;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      border: "1px solid var(--color-border)",
      borderRadius: "var(--radius-md)",
      background: "var(--color-bg-elev)",
      marginBottom: 8,
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 200px 140px",
          alignItems: "center",
          gap: 12,
          padding: "10px 14px",
          cursor: "pointer",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 12, fontWeight: 600 }}>{task.display_id}</span>
            <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>{task.file_name}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
            {task.total_annotations} 个标注 · {task.total_predictions} 个预测
          </div>
        </div>
        <AnnotationPreview taskId={task.id} />
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); onApprove(task.id); }}>
            <Icon name="check" size={11} />通过
          </Button>
          <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); onReject(task.id); }}>
            <Icon name="x" size={11} />退回
          </Button>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid var(--color-border)" }}>
          <div style={{ paddingTop: 10 }}>
            <AnnotationPreview taskId={task.id} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewPage() {
  const pushToast = useToastStore((s) => s.push);
  const { data: projects } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const projectId = selectedProjectId || projects?.[0]?.id;
  const { data: taskListData, isLoading } = useTaskList(projectId, { status: "review" });
  const tasks = taskListData?.items ?? [];

  const approveMut = useApproveTask();
  const rejectMut = useRejectTask();

  const handleApprove = (taskId: string) => {
    approveMut.mutate(taskId, {
      onSuccess: () => pushToast({ msg: "任务已通过审核", kind: "success" }),
    });
  };

  const handleReject = (taskId: string) => {
    rejectMut.mutate({ taskId }, {
      onSuccess: () => pushToast({ msg: "任务已退回标注员", kind: "success" }),
    });
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 960 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>质检审核</h1>
          <p style={{ fontSize: 13, color: "var(--color-fg-muted)", margin: "4px 0 0" }}>
            审核标注员提交的任务，通过或退回
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
          <div style={{ fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 12 }}>
            共 {tasks.length} 个待审核任务
          </div>
          {tasks.map((t) => (
            <TaskReviewRow key={t.id} task={t} onApprove={handleApprove} onReject={handleReject} />
          ))}
        </>
      )}
    </div>
  );
}
