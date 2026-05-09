import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { AssigneeAvatarStack } from "@/components/ui/AssigneeAvatarStack";
import { useMyBatches } from "@/hooks/useDashboard";
import { batchesApi, type BatchResponse } from "@/api/batches";
import type { MyBatchItem } from "@/api/dashboard";

const STATUS_LABEL: Record<string, { label: string; variant: "accent" | "warning" | "danger" | "outline" }> = {
  active: { label: "未开始", variant: "outline" },
  annotating: { label: "标注中", variant: "accent" },
  reviewing: { label: "审核中", variant: "warning" },
  rejected: { label: "已驳回", variant: "danger" },
};

/** B-20：标注员视角的三段进度条 — 已动工 / 送审 / 通过。
 *  三条进度独立显示，文字小号附在右侧，避免占用太多行高。 */
function ProgressTriple({
  startedPct,
  reviewPct,
  approvedPct,
  startedCount,
  reviewCount,
  approvedCount,
  total,
}: {
  startedPct: number;
  reviewPct: number;
  approvedPct: number;
  startedCount: number;
  reviewCount: number;
  approvedCount: number;
  total: number;
}) {
  const ROWS: { label: string; pct: number; count: number; bar: string }[] = [
    { label: "标注中", pct: startedPct, count: startedCount, bar: "var(--color-accent)" },
    { label: "送审", pct: reviewPct, count: reviewCount, bar: "var(--color-warning)" },
    { label: "通过", pct: approvedPct, count: approvedCount, bar: "var(--color-success)" },
  ];
  return (
    <div style={{ marginTop: 6, display: "grid", gap: 3, maxWidth: 420 }}>
      {ROWS.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--color-fg-muted)" }}>
          <span style={{ flex: "0 0 36px" }}>{r.label}</span>
          <div style={{ flex: 1, height: 4, background: "var(--color-bg-sunken)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, r.pct)}%`, height: "100%", background: r.bar }} />
          </div>
          <span className="mono" style={{ flex: "0 0 80px", textAlign: "right", color: "var(--color-fg-subtle)" }}>
            {r.count}/{total} · {r.pct}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** v0.7.1 · 标注员 dashboard 的「我的批次」卡片，行版式与 ReviewerDashboard
 *  「审核中批次」对齐：button-row + display_id · 项目 · 计数 + 右侧进度% + chev。
 *  额外的 状态徽章 / 提交质检 / 修改 等动作放在右侧 action 区。 */
export function MyBatchesCard() {
  const { data: batches = [], isLoading } = useMyBatches();
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const qc = useQueryClient();
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  // B-22：多选提交 — 选中态以 batch_id 集合保存，触发批量提交时按顺序串行调用。
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

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

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  // B-22 改：可批量提交的批次 = annotating 且至少有一个任务已动工或更进。
  // 用户反馈"提交质检仍无效"是因为旧门槛要求所有任务都送审，这里放宽到只要批次状态合适即可，
  // 让标注员可以中途整批提交（剩余 pending 任务由 confirm 提示）。
  const submittable = sorted.filter((b) => b.status === "annotating");
  const selectedSubmittable = submittable.filter((b) => selectedIds.has(b.batch_id));

  const handleBulkSubmit = async () => {
    if (selectedSubmittable.length === 0) return;
    if (
      !window.confirm(
        `确认批量将 ${selectedSubmittable.length} 个批次提交质检？提交后无法继续修改。`,
      )
    )
      return;
    setBulkSubmitting(true);
    let okCount = 0;
    const errors: string[] = [];
    for (const b of selectedSubmittable) {
      try {
        await batchesApi.transition(b.project_id, b.batch_id, "reviewing");
        okCount += 1;
      } catch (e) {
        errors.push(`${b.batch_display_id}: ${e instanceof Error ? e.message : "失败"}`);
      }
    }
    setBulkSubmitting(false);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: ["dashboard", "annotator"] });
    qc.invalidateQueries({ queryKey: ["batches"] });
    if (errors.length === 0) {
      pushToast({ msg: `已批量提交 ${okCount} 个批次`, sub: "等待审核员处理", kind: "success" });
    } else {
      pushToast({
        msg: `${okCount} 成功 / ${errors.length} 失败`,
        sub: errors.slice(0, 2).join("; "),
        kind: "warning",
      });
    }
  };

  return (
    <Card style={{ marginTop: 16 }}>
      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>
          我的批次
          <Badge variant="accent" style={{ marginLeft: 8, fontSize: 11 }}>
            {batches.length}
          </Badge>
        </h3>
        {submittable.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
              已选 {selectedSubmittable.length} / {submittable.length} 可提交
            </span>
            <Button
              size="sm"
              variant="primary"
              disabled={selectedSubmittable.length === 0 || bulkSubmitting}
              onClick={handleBulkSubmit}
              title="批量将选中批次提交质检"
            >
              <Icon name="check" size={11} />批量提交质检
            </Button>
          </div>
        )}
      </div>
      <div style={{ padding: "8px 0" }}>
        {sorted.map((b, idx) => {
          const meta = STATUS_LABEL[b.status] ?? { label: b.status, variant: "outline" as const };
          // B-20：分三档进度，每档独立条 — "标注中"(已动工含 in_progress) / "送审" / "审核通过"。
          // 旧版只用 completed/total 计算，导致 reviewer 没批复前进度永远 0%，且与后端三态语义脱节。
          const inProgress = b.in_progress_tasks ?? 0;
          const startedDone = inProgress + b.review_tasks + b.completed_tasks;
          const reviewDone = b.review_tasks + b.completed_tasks;
          const approvedDone = b.completed_tasks;
          const pendingTasks = Math.max(0, b.total_tasks - startedDone);
          const total = b.total_tasks || 1;
          const startedPct = Math.round((startedDone / total) * 1000) / 10;
          const reviewPct = Math.round((reviewDone / total) * 1000) / 10;
          const approvedPct = Math.round((approvedDone / total) * 1000) / 10;
          const annotateUrl = `/annotate?batch=${b.batch_id}`;

          const canSelect = b.status === "annotating";
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
                color: "inherit",
                borderTop: idx === 0 ? "none" : "1px solid var(--color-border-subtle, var(--color-border))",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              {canSelect && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(b.batch_id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelected(b.batch_id)}
                  title="选中以批量提交质检"
                  style={{ flex: "0 0 auto", cursor: "pointer", margin: 0 }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{b.batch_name}</span>
                  <Badge variant={meta.variant} dot>{meta.label}</Badge>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginTop: 2 }}>
                  <span className="mono">{b.batch_display_id}</span>
                  <span> · {b.project_name}</span>
                  <span> · 共 {b.total_tasks} 任务</span>
                  {pendingTasks > 0 && <span> · 待标 {pendingTasks}</span>}
                  {inProgress > 0 && <span> · 标注中 {inProgress}</span>}
                  {b.review_tasks > 0 && <span> · 送审 {b.review_tasks}</span>}
                  {b.completed_tasks > 0 && <span> · 已通过 {b.completed_tasks}</span>}
                </div>
                <ProgressTriple
                  startedPct={startedPct}
                  reviewPct={reviewPct}
                  approvedPct={approvedPct}
                  startedCount={startedDone}
                  reviewCount={reviewDone}
                  approvedCount={approvedDone}
                  total={b.total_tasks}
                />
                {b.reviewer && (
                  <div style={{ marginTop: 6 }}>
                    <AssigneeAvatarStack
                      users={[b.reviewer]}
                      label="审核员"
                      max={1}
                    />
                  </div>
                )}
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
                    disabled={submittingId === b.batch_id || bulkSubmitting}
                    title={pendingTasks > 0 ? `仍有 ${pendingTasks} 个未开始；确认后整批提交` : "整批提交质检"}
                    onClick={(e) => {
                      e.stopPropagation();
                      const warn = pendingTasks > 0
                        ? `批次「${b.batch_name}」仍有 ${pendingTasks} 个任务未开始。确认整批提交质检？提交后无法继续修改。`
                        : `确认将批次「${b.batch_name}」提交质检？提交后无法继续修改。`;
                      if (!window.confirm(warn)) return;
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
                <Icon name="chevRight" size={14} />
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
