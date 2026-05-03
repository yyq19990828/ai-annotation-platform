import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useMyBatches } from "@/hooks/useDashboard";
import { batchesApi, type BatchResponse } from "@/api/batches";
import type { MyBatchItem } from "@/api/dashboard";

const STATUS_LABEL: Record<string, { label: string; variant: "accent" | "warning" | "danger" | "outline" }> = {
  active: { label: "未开始", variant: "outline" },
  annotating: { label: "标注中", variant: "accent" },
  reviewing: { label: "审核中", variant: "warning" },
  rejected: { label: "已驳回", variant: "danger" },
};

/** v0.7.1 · 标注员 dashboard 的「我的批次」卡片，行版式与 ReviewerDashboard
 *  「审核中批次」对齐：button-row + display_id · 项目 · 计数 + 右侧进度% + chev。
 *  额外的 状态徽章 / 提交质检 / 修改 等动作放在右侧 action 区。 */
export function MyBatchesCard() {
  const { data: batches = [], isLoading } = useMyBatches();
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const submitMut = useMutation({
    mutationFn: (b: MyBatchItem) =>
      batchesApi.transition(b.project_id, b.batch_id, "reviewing") as Promise<BatchResponse>,
    onMutate: (b) => setSubmittingId(b.batch_id),
    onSuccess: () => {
      pushToast({ msg: "已提交质检", sub: "等待审核员处理", kind: "success" });
      qc.invalidateQueries({ queryKey: ["dashboard", "annotator"] });
      qc.invalidateQueries({ queryKey: ["batches"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : "提交失败";
      pushToast({ msg: "提交质检失败", sub: msg, kind: "error" });
    },
    onSettled: () => setSubmittingId(null),
  });

  if (isLoading) {
    return (
      <Card style={{ marginTop: 16 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>我的批次</h3>
        </div>
        <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          加载中...
        </div>
      </Card>
    );
  }

  if (batches.length === 0) return null;

  // annotating 排前面，rejected 次之，其他靠后；同状态按 display_id 自然序
  const STATUS_ORDER: Record<string, number> = { annotating: 0, rejected: 1, active: 2, reviewing: 3 };
  const sorted = [...batches].sort((a, b) => {
    const ra = STATUS_ORDER[a.status] ?? 9;
    const rb = STATUS_ORDER[b.status] ?? 9;
    if (ra !== rb) return ra - rb;
    return a.batch_display_id.localeCompare(b.batch_display_id);
  });

  return (
    <Card style={{ marginTop: 16 }}>
      <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--color-border)" }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          我的批次
          <Badge variant="accent" style={{ marginLeft: 8, fontSize: 11 }}>
            {batches.length}
          </Badge>
        </h3>
      </div>
      <div style={{ padding: "8px 0" }}>
        {sorted.map((b, idx) => {
          const meta = STATUS_LABEL[b.status] ?? { label: b.status, variant: "outline" as const };
          const remaining = Math.max(0, b.total_tasks - b.completed_tasks);
          const allDone = b.total_tasks > 0 && remaining === 0;
          const pct = b.progress_pct;
          const annotateUrl = `/annotate?batch=${b.batch_id}`;

          return (
            <button
              key={b.batch_id}
              type="button"
              onClick={() => navigate(annotateUrl)}
              style={{
                display: "flex",
                width: "100%",
                padding: "10px 16px",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border-subtle, var(--color-border))",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{b.batch_name}</span>
                  <Badge variant={meta.variant} dot>{meta.label}</Badge>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                  <span className="mono">{b.batch_display_id}</span>
                  <span> · {b.project_name}</span>
                  <span> · 共 {b.total_tasks} 任务</span>
                  {b.completed_tasks > 0 && <span> · 完成 {b.completed_tasks}</span>}
                  {remaining > 0 && <span> · 待标 {remaining}</span>}
                  {b.review_tasks > 0 && <span> · 送审 {b.review_tasks}</span>}
                </div>
                {b.status === "rejected" && b.review_feedback && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: "4px 8px",
                      background: "color-mix(in oklab, var(--color-danger) 8%, transparent)",
                      borderLeft: "2px solid var(--color-danger)",
                      fontSize: 11,
                      color: "var(--color-fg-muted)",
                      maxWidth: 600,
                    }}
                    title={b.review_feedback}
                  >
                    <strong style={{ color: "var(--color-danger)" }}>驳回原因：</strong>
                    {b.review_feedback.length > 100 ? b.review_feedback.slice(0, 100) + "..." : b.review_feedback}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                {b.status === "annotating" && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!allDone || submittingId === b.batch_id}
                    title={allDone ? "整批提交质检" : `还剩 ${remaining} 个任务未完成`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(`确认将批次「${b.batch_name}」提交质检？提交后无法继续修改。`)) return;
                      submitMut.mutate(b);
                    }}
                  >
                    <Icon name="check" size={11} />提交质检
                  </Button>
                )}
                {b.status === "rejected" && (
                  <Button variant="primary" size="sm" onClick={(e) => { e.stopPropagation(); navigate(annotateUrl); }}>
                    <Icon name="refresh" size={11} />继续修改
                  </Button>
                )}
                <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }} className="mono">
                  {pct}%
                </span>
                <Icon name="chevRight" size={14} />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
