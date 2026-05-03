import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { useNavigate } from "react-router-dom";
import { useToastStore } from "@/components/ui/Toast";
import { useReviewerStats, useMyRecentReviews } from "@/hooks/useDashboard";
import { useApproveTask, useRejectTask } from "@/hooks/useTasks";
import { useQueryClient } from "@tanstack/react-query";
import type { ReviewTaskItem, RecentReviewItem } from "@/api/dashboard";

export function ReviewerDashboard() {
  const { data: stats, isLoading } = useReviewerStats();
  const { data: recentReviews = [] } = useMyRecentReviews(20);
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const approveMut = useApproveTask();
  const rejectMut = useRejectTask();

  const handleApprove = (taskId: string) => {
    approveMut.mutate(taskId, {
      onSuccess: () => {
        pushToast({ msg: "任务已通过审核", kind: "success" });
        qc.invalidateQueries({ queryKey: ["dashboard", "reviewer"] });
      },
    });
  };

  const handleReject = (taskId: string) => {
    const reason = window.prompt("退回原因（必填）");
    if (!reason || !reason.trim()) return;
    rejectMut.mutate({ taskId, reason: reason.trim() }, {
      onSuccess: () => {
        pushToast({ msg: "任务已退回标注员", kind: "success" });
        qc.invalidateQueries({ queryKey: ["dashboard", "reviewer"] });
      },
    });
  };

  if (isLoading || !stats) {
    return (
      <div style={{ padding: "60px 28px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
        加载中...
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 28px 40px", maxWidth: 1480, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>质检工作台</h1>
          <p style={{ color: "var(--color-fg-muted)", fontSize: 13, margin: 0 }}>审核标注质量，确保数据准确性</p>
        </div>
        <Button variant="primary" onClick={() => navigate("/review")}>
          <Icon name="check" size={13} />进入审核页面
        </Button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        <StatCard icon="flag" label="待审队列" value={stats.pending_review_count} />
        <StatCard icon="check" label="今日已审" value={stats.today_reviewed} />
        <StatCard icon="activity" label="24h 通过率" value={`${stats.approval_rate_24h}%`} />
        <StatCard icon="activity" label="历史通过率" value={`${stats.approval_rate}%`} />
        <StatCard icon="layers" label="累计审核" value={stats.total_reviewed} />
      </div>

      <Card>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            待审核任务
            {stats.pending_tasks.length > 0 && (
              <Badge variant="warning" style={{ marginLeft: 8, fontSize: 11 }}>{stats.pending_tasks.length}</Badge>
            )}
          </h3>
        </div>

        {stats.pending_tasks.length === 0 ? (
          <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--color-fg-subtle)" }}>
            <Icon name="check" size={36} style={{ opacity: 0.25, marginBottom: 10 }} />
            <div style={{ fontSize: 14, marginBottom: 4 }}>暂无待审核任务</div>
            <div style={{ fontSize: 12 }}>所有标注任务已审核完毕</div>
          </div>
        ) : (
          <div>
            {stats.pending_tasks.map((task) => (
              <ReviewTaskRow
                key={task.task_id}
                task={task}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </Card>

      {(stats.reviewing_batches?.length ?? 0) > 0 && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
              审核中批次
              <Badge variant="warning" style={{ marginLeft: 8, fontSize: 11 }}>
                {stats.reviewing_batches!.length}
              </Badge>
            </h3>
          </div>
          <div style={{ padding: "8px 0" }}>
            {stats.reviewing_batches!.map((b) => {
              const remaining = Math.max(0, b.total_tasks - b.completed_tasks - b.review_tasks);
              const reviewPct = b.total_tasks
                ? Math.round((b.completed_tasks / b.total_tasks) * 100)
                : 0;
              return (
                <button
                  key={b.batch_id}
                  type="button"
                  onClick={() => navigate(`/review?project=${b.project_id}&batch=${b.batch_id}`)}
                  style={{
                    display: "flex",
                    width: "100%",
                    padding: "10px 16px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                    borderTop: "1px solid var(--color-border-subtle)",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{b.batch_name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                      <span className="mono">{b.batch_display_id}</span>
                      <span> · {b.project_name}</span>
                      <span> · 共 {b.total_tasks} 任务</span>
                      {b.review_tasks > 0 && <span> · {b.review_tasks} 待审</span>}
                      {remaining > 0 && <span> · {remaining} 未交</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                    <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }} className="mono">
                      {reviewPct}%
                    </span>
                    <Icon name="chevron-right" size={14} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
            我的最近审核记录
            {recentReviews.length > 0 && (
              <Badge variant="outline" style={{ marginLeft: 8, fontSize: 11 }}>{recentReviews.length}</Badge>
            )}
          </h3>
        </div>
        {recentReviews.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
            暂无审核记录
          </div>
        ) : (
          <div>
            {recentReviews.map((r) => (
              <RecentReviewRow key={r.task_id} item={r} onClick={() => navigate(`/projects/${r.project_id}/annotate?task=${r.task_id}`)} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function RecentReviewRow({ item, onClick }: { item: RecentReviewItem; onClick: () => void }) {
  const reviewedAt = item.reviewed_at ? new Date(item.reviewed_at).toLocaleString("zh-CN") : "—";
  const statusBadge =
    item.status === "completed" ? <Badge variant="success" dot>已通过</Badge> :
    item.status === "review" ? <Badge variant="warning" dot>重审中</Badge> :
    <Badge variant="outline">{item.status}</Badge>;
  return (
    <div
      onClick={onClick}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 200px 100px 160px",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        borderBottom: "1px solid var(--color-border)",
        cursor: "pointer",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)" }}>
            {item.task_display_id}
          </span>
          <span style={{ fontSize: 12.5 }}>{item.file_name}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
          <Badge variant="outline" style={{ fontSize: 10, padding: "0 5px" }}>{item.project_name}</Badge>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>审于 {reviewedAt}</div>
      <div>{statusBadge}</div>
      <div style={{ textAlign: "right" }}>
        <Icon name="chevRight" size={12} />
      </div>
    </div>
  );
}

function ReviewTaskRow({ task, onApprove, onReject }: {
  task: ReviewTaskItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const updated = task.updated_at ? new Date(task.updated_at).toLocaleDateString("zh-CN") : "—";

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 140px 100px 160px",
      alignItems: "center",
      gap: 12,
      padding: "10px 16px",
      borderBottom: "1px solid var(--color-border)",
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)" }}>
            {task.task_display_id}
          </span>
          <span style={{ fontSize: 12.5 }}>{task.file_name}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
          <Badge variant="outline" style={{ fontSize: 10, padding: "0 5px", marginRight: 6 }}>{task.project_name}</Badge>
          {task.total_annotations} 个标注 · {task.total_predictions} 个预测
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--color-fg-muted)" }}>
        更新 {updated}
      </div>
      <div>
        <Badge variant="warning" dot>待审核</Badge>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <Button variant="primary" size="sm" onClick={() => onApprove(task.task_id)}>
          <Icon name="check" size={11} />通过
        </Button>
        <Button variant="danger" size="sm" onClick={() => onReject(task.task_id)}>
          <Icon name="x" size={11} />退回
        </Button>
      </div>
    </div>
  );
}
