import { useState, useEffect, useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icon";
import { Badge } from "@/components/ui/Badge";
import { useToastStore } from "@/components/ui/Toast";
import { useProjectMembers } from "@/hooks/useProjects";
import { useUpdateBatch } from "@/hooks/useBatches";
import type { BatchResponse } from "@/api/batches";

interface Props {
  projectId: string;
  batch: BatchResponse;
  onClose: () => void;
}

/**
 * v0.6.7 B-12-②：把 batch 分派给标注员 / 审核员。
 * 多选；按 role 分两栏；提交后 PATCH /batches/{id} 写 assigned_user_ids。
 */
export function BatchAssignmentModal({ projectId, batch, onClose }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const { data: members = [], isLoading } = useProjectMembers(projectId);
  const update = useUpdateBatch(projectId);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelected(new Set(batch.assigned_user_ids ?? []));
  }, [batch.id, batch.assigned_user_ids]);

  const annotators = useMemo(() => members.filter((m) => m.role === "annotator"), [members]);
  const reviewers = useMemo(() => members.filter((m) => m.role === "reviewer"), [members]);

  const toggle = (userId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const onSave = () => {
    update.mutate(
      { batchId: batch.id, payload: { assigned_user_ids: Array.from(selected) } },
      {
        onSuccess: () => {
          pushToast({ msg: "已更新分派", kind: "success" });
          onClose();
        },
        onError: (err) => pushToast({ msg: "保存失败", sub: (err as Error).message }),
      },
    );
  };

  return (
    <Modal open onClose={onClose} title={`分派批次 · ${batch.name}`} width={520}>
      <div style={{ fontSize: 13, color: "var(--color-fg-muted)", marginBottom: 12 }}>
        从项目成员中选择该批次可见的标注员 / 审核员。未分派的批次仍可激活，但前端列表会提示「请先分派」。
      </div>

      {isLoading && (
        <div style={{ padding: 16, textAlign: "center", color: "var(--color-fg-subtle)", fontSize: 13 }}>
          加载成员…
        </div>
      )}

      {!isLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Column
            title="标注员"
            members={annotators}
            selected={selected}
            onToggle={toggle}
            roleColor="accent"
          />
          <Column
            title="审核员"
            members={reviewers}
            selected={selected}
            onToggle={toggle}
            roleColor="warning"
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
          已选 <strong style={{ color: "var(--color-fg)" }}>{selected.size}</strong> 人
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={onSave}
            disabled={update.isPending}
            style={{ background: "var(--color-accent)", color: "#fff" }}
          >
            {update.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Column({
  title,
  members,
  selected,
  onToggle,
  roleColor,
}: {
  title: string;
  members: { id: string; user_id: string; user_name: string; user_email: string; role: string }[];
  selected: Set<string>;
  onToggle: (userId: string) => void;
  roleColor: "accent" | "warning";
}) {
  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-sunken)",
        padding: 8,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-fg-muted)", padding: "4px 6px 8px" }}>
        <Badge variant={roleColor} dot>
          {title}
        </Badge>
      </div>
      {members.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", padding: 16, textAlign: "center" }}>
          暂无成员，请先在「成员管理」中添加
        </div>
      )}
      {members.map((m) => {
        const checked = selected.has(m.user_id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onToggle(m.user_id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "6px 8px",
              borderRadius: "var(--radius-sm)",
              background: checked ? "var(--color-accent-soft)" : "transparent",
              border: `1px solid ${checked ? "var(--color-accent)" : "transparent"}`,
              cursor: "pointer",
              textAlign: "left",
              marginBottom: 2,
              fontFamily: "inherit",
              color: "var(--color-fg)",
            }}
          >
            <span
              style={{
                width: 14,
                height: 14,
                borderRadius: 3,
                border: "1px solid var(--color-border)",
                background: checked ? "var(--color-accent)" : "var(--color-bg)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {checked && <Icon name="check" size={10} />}
            </span>
            <Avatar initial={(m.user_name || "?").slice(0, 1).toUpperCase()} size="sm" />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>{m.user_name}</span>
              <span style={{ fontSize: 11, color: "var(--color-fg-subtle)", marginLeft: 6 }}>{m.user_email}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
