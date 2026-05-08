/**
 * v0.7.6 · 批次 Kanban 看板视图
 *
 * 7 态卡片墙（draft / active / annotating / reviewing / approved / rejected / archived），
 * 列内显示批次 mini-card；owner 视角支持 HTML5 drag-and-drop 拖拽迁移，受 VALID_TRANSITIONS 约束。
 * 非法目标列 drop 显示 toast。
 *
 * 与 BatchesSection 列表视图共用 useTransitionBatch；纯展示与拖拽分发，无独立后端调用。
 */
import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { AssigneeAvatarStack } from "@/components/ui/AssigneeAvatarStack";
import { useToastStore } from "@/components/ui/Toast";
import type { BatchResponse } from "@/api/batches";

const COLUMNS: { id: string; label: string; variant: "default" | "accent" | "warning" | "success" | "danger" | "ai" }[] = [
  { id: "draft", label: "草稿", variant: "default" },
  { id: "active", label: "激活", variant: "accent" },
  // v0.9.6 · pre_annotated: 让 admin 跑完 /ai-pre 后能在 Kanban 看到「AI 预标已就绪」紫色列
  { id: "pre_annotated", label: "AI 预标已就绪", variant: "ai" },
  { id: "annotating", label: "标注中", variant: "accent" },
  { id: "reviewing", label: "审核中", variant: "warning" },
  { id: "approved", label: "已通过", variant: "success" },
  { id: "rejected", label: "已退回", variant: "danger" },
  { id: "archived", label: "已归档", variant: "default" },
];

// VALID_TRANSITIONS 镜像 — 与 apps/api/app/services/batch.py 的 VALID_TRANSITIONS 字典保持一致
// 仅做前端 dryrun，最终鉴权与状态机由后端 transition 端点把关。
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(["active"]),
  // v0.9.6 · active 可去 pre_annotated (跑完 AI 预标自动转); 也保留原 annotating / archived
  active: new Set(["annotating", "pre_annotated", "archived"]),
  pre_annotated: new Set(["annotating", "active", "archived"]),
  annotating: new Set(["reviewing", "archived"]),
  reviewing: new Set(["approved", "rejected"]),
  approved: new Set(["archived", "reviewing"]),
  rejected: new Set(["active", "archived", "reviewing"]),
  archived: new Set(["active"]),
};

interface Props {
  batches: BatchResponse[];
  isOwner: boolean;
  onTransition: (batch: BatchResponse, target: string) => void;
}

export function BatchesKanbanView({ batches, isOwner, onTransition }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumn, setHoverColumn] = useState<string | null>(null);

  const grouped = COLUMNS.reduce<Record<string, BatchResponse[]>>((acc, col) => {
    acc[col.id] = batches.filter((b) => b.status === col.id);
    return acc;
  }, {});

  const draggingBatch = draggingId ? batches.find((b) => b.id === draggingId) ?? null : null;

  const handleDrop = (targetStatus: string) => {
    if (!draggingBatch) return;
    if (draggingBatch.status === targetStatus) {
      setDraggingId(null);
      setHoverColumn(null);
      return;
    }
    const allowed = VALID_TRANSITIONS[draggingBatch.status];
    if (!allowed?.has(targetStatus)) {
      pushToast({
        msg: "不合法的状态迁移",
        sub: `${draggingBatch.status} → ${targetStatus} 不在合法路径中`,
        kind: "warning",
      });
      setDraggingId(null);
      setHoverColumn(null);
      return;
    }
    onTransition(draggingBatch, targetStatus);
    setDraggingId(null);
    setHoverColumn(null);
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLUMNS.length}, minmax(180px, 1fr))`,
        gap: 8,
        padding: 8,
        overflowX: "auto",
      }}
    >
      {COLUMNS.map((col) => {
        const items = grouped[col.id] ?? [];
        const canDrop =
          isOwner &&
          draggingBatch !== null &&
          draggingBatch.status !== col.id &&
          VALID_TRANSITIONS[draggingBatch.status]?.has(col.id);
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              if (!isOwner || !draggingBatch) return;
              e.preventDefault();
              setHoverColumn(col.id);
            }}
            onDragLeave={() => {
              if (hoverColumn === col.id) setHoverColumn(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(col.id);
            }}
            style={{
              background: hoverColumn === col.id && canDrop
                ? "color-mix(in oklab, var(--color-accent) 12%, transparent)"
                : "var(--color-bg-sunken)",
              border: `1px ${canDrop ? "dashed var(--color-accent)" : "solid var(--color-border)"}`,
              borderRadius: "var(--radius-md)",
              padding: 8,
              minHeight: 240,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "2px 4px 6px",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              <Badge variant={col.variant} dot>
                {col.label}
              </Badge>
              <span style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>{items.length}</span>
            </div>
            {items.length === 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-fg-subtle)",
                  textAlign: "center",
                  padding: "16px 0",
                }}
              >
                —
              </div>
            )}
            {items.map((b) => (
              <KanbanCard
                key={b.id}
                batch={b}
                isOwner={isOwner}
                isDragging={draggingId === b.id}
                onDragStart={() => setDraggingId(b.id)}
                onDragEnd={() => {
                  setDraggingId(null);
                  setHoverColumn(null);
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function KanbanCard({
  batch,
  isOwner,
  isDragging,
  onDragStart,
  onDragEnd,
}: {
  batch: BatchResponse;
  isOwner: boolean;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const stackUsers = [batch.annotator, batch.reviewer].filter(
    (u): u is NonNullable<typeof u> => u !== null,
  );
  return (
    <div
      draggable={isOwner}
      onDragStart={() => onDragStart()}
      onDragEnd={() => onDragEnd()}
      style={{
        padding: "8px 10px",
        cursor: isOwner ? "grab" : "default",
        opacity: isDragging ? 0.5 : 1,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        background: "var(--color-bg-elev)",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--color-fg-subtle)" }}>
          {batch.display_id}
        </span>
        <AssigneeAvatarStack users={stackUsers} size="sm" max={2} />
      </div>
      <div
        style={{
          fontSize: 12.5,
          fontWeight: 500,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={batch.name}
      >
        {batch.name}
      </div>
      <ProgressBar value={batch.progress_pct ?? 0} />
      <div style={{ fontSize: 10.5, color: "var(--color-fg-muted)" }}>
        {batch.completed_tasks}/{batch.total_tasks} task
      </div>
    </div>
  );
}
