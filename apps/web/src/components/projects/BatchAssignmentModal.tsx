import { useEffect, useMemo, useState } from "react";
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
 * v0.7.2 · 一 batch = 一标注员 + 一审核员（单选语义）。
 * 提交后 PATCH /batches/{id}（写 annotator_id / reviewer_id）。
 */
export function BatchAssignmentModal({ projectId, batch, onClose }: Props) {
  const pushToast = useToastStore((s) => s.push);
  const { data: members = [], isLoading } = useProjectMembers(projectId);
  const update = useUpdateBatch(projectId);

  const [annotatorId, setAnnotatorId] = useState<string | null>(batch.annotator_id);
  const [reviewerId, setReviewerId] = useState<string | null>(batch.reviewer_id);

  useEffect(() => {
    setAnnotatorId(batch.annotator_id);
    setReviewerId(batch.reviewer_id);
  }, [batch.id, batch.annotator_id, batch.reviewer_id]);

  const annotators = useMemo(() => members.filter((m) => m.role === "annotator"), [members]);
  const reviewers = useMemo(() => members.filter((m) => m.role === "reviewer"), [members]);

  const onSave = () => {
    update.mutate(
      {
        batchId: batch.id,
        payload: {
          annotator_id: annotatorId,
          reviewer_id: reviewerId,
        },
      },
      {
        onSuccess: () => {
          pushToast({ msg: "已更新分派", kind: "success" });
          onClose();
        },
        onError: (err) => pushToast({ msg: "保存失败", sub: (err as Error).message }),
      },
    );
  };

  const dirty = annotatorId !== batch.annotator_id || reviewerId !== batch.reviewer_id;

  return (
    <Modal open onClose={onClose} title={`分派批次 · ${batch.name}`} width={520}>
      <div style={{ fontSize: 13, color: "var(--color-fg-muted)", marginBottom: 12 }}>
        每个批次由 <strong>1 名标注员</strong> 负责标注、<strong>1 名审核员</strong> 负责审核。
        若需要批量分派项目下多个批次，请用「批次列表 → 按项目分派批次」。
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
            selectedId={annotatorId}
            onSelect={setAnnotatorId}
            roleColor="accent"
          />
          <Column
            title="审核员"
            members={reviewers}
            selectedId={reviewerId}
            onSelect={setReviewerId}
            roleColor="warning"
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
        <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>
          {annotatorId ? "已选标注员" : "未选标注员"}
          {" · "}
          {reviewerId ? "已选审核员" : "未选审核员"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={onSave}
            disabled={update.isPending || !dirty}
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
  selectedId,
  onSelect,
  roleColor,
}: {
  title: string;
  members: { id: string; user_id: string; user_name: string; user_email: string; role: string }[];
  selectedId: string | null;
  onSelect: (userId: string | null) => void;
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px 8px" }}>
        <Badge variant={roleColor} dot>{title}</Badge>
        {selectedId && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--color-fg-subtle)",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            title="清除选择"
          >
            <Icon name="x" size={11} /> 清除
          </button>
        )}
      </div>
      {members.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--color-fg-subtle)", padding: 16, textAlign: "center" }}>
          暂无成员，请先在「成员管理」中添加
        </div>
      )}
      {members.map((m) => {
        const checked = selectedId === m.user_id;
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => onSelect(checked ? null : m.user_id)}
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
                borderRadius: "50%",
                border: "1px solid var(--color-border)",
                background: checked ? "var(--color-accent)" : "var(--color-bg)",
                flexShrink: 0,
                position: "relative",
              }}
            >
              {checked && (
                <span
                  style={{
                    position: "absolute",
                    inset: 3,
                    borderRadius: "50%",
                    background: "#fff",
                  }}
                />
              )}
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
